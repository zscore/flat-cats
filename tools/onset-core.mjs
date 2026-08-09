/**
 * onset-core.mjs — find where the notes start, and say what is in each one.
 *
 * The measurement, with no file I/O and no console around it. `onsets.mjs` is
 * the command-line wrapper that writes the report and the click track; this is
 * what it wraps, and what any other stage calls when it needs the same numbers.
 *
 * Split out for one reason: out/ is derived and disposable, so nothing may read
 * out/onsets.json as if it were input. A stage that wants these onsets has to
 * compute them from the wav, which means being able to import them.
 *
 * Three separate jobs, in order, and they are worth keeping straight because
 * two of them get called "pitch" in casual conversation:
 *
 *   1. ONSETS — the times at which something new begins. Spectral flux: how much
 *      energy entered the spectrum since the last frame, counting only bins that
 *      got louder. Silent about what the note is.
 *
 *   2. FUNDAMENTALS — where the harmonic series sit. This piece is polyphonic:
 *      several fundamentals sound at once, so a single f0 per onset would be a
 *      confident lie. Peaks are grouped into harmonic series instead, and each
 *      series reported separately.
 *
 *   3. FORMANTS — peaks in the spectral ENVELOPE, the broad shape across
 *      frequency. Not the fundamental, not a harmonic. A formant stays put when
 *      the pitch moves; that is the whole distinction, and it is why
 *      spectral.mjs can paste a cat's formants onto a synth without retuning it.
 *      On a synthesised track these are resonances of the patch, not of a mouth.
 *
 * Pitches are also reported as 17-EDO degrees, because Blackwood's etude is not
 * in 12 and rounding it to semitones would throw away the only interesting thing
 * about its tuning. `ref` sets the frequency that degree 0 sits on.
 */
import { resolve } from 'node:path';
import { readWav } from './wav.mjs';
import { hann, frameFFT, magnitudes, cepstralEnvelope } from './spectral.mjs';

export const N = 2048;      // ~43 ms at 48 k
export const HOP = 512;     // ~11 ms — the resolution of every time in the report
const LAMBDA = 1000;        // log compression: log(1 + LAMBDA·mag), standard for flux
const MIN_IOI = 0.05;       // two onsets closer than this are one onset
const MED_SECS = 0.1;       // half-width of the adaptive threshold's median window

const PITCH_N = 4096;       // ~85 ms of note to measure — long enough to resolve a bass partial
const PAD = 16384;          // zero-padded to 2.9 Hz bins before interpolating
const PITCH_SKIP = 0.015;   // start measuring 15 ms in, past the transient
const MAX_H = 8;            // harmonics counted when scoring a candidate fundamental
/**
 * How far off a harmonic may land and still count, as a fraction of frequency.
 *
 * A 17-EDO step is 2^(1/17) — 4.2%, or 71 cents. Anything looser than half a
 * step lets a harmonic of one note be claimed by its neighbour, which in a piece
 * built out of adjacent degrees is not a rare accident. 2% is 34 cents.
 */
export const TOL = 0.02;

// -------------------------------------------------------------- 1. the onsets --

/** Spectral flux per frame, plus the time each frame is centred on. */
function flux(mono, sr) {
  const w = hann(N);
  const df = [], times = [];
  let prev = null;
  for (let s = 0; s + N <= mono.length; s += HOP) {
    const { re, im } = frameFFT(mono, s, w);
    const mag = magnitudes(re, im);
    const cur = new Float64Array(mag.length);
    for (let k = 0; k < mag.length; k++) cur[k] = Math.log(1 + LAMBDA * mag[k]);
    let d = 0;
    // Half-wave rectified: a bin going quiet is a note ending, and note endings
    // are not onsets. Only the rises are summed.
    if (prev) for (let k = 0; k < cur.length; k++) if (cur[k] > prev[k]) d += cur[k] - prev[k];
    df.push(d);
    // Centre, not start. A note beginning at T first fills the window when the
    // window is centred near T, so this is the unbiased attribution.
    times.push((s + N / 2) / sr);
    prev = cur;
  }
  return { df, times };
}

/**
 * Peak-pick the flux curve against a threshold that follows it.
 *
 * A fixed threshold cannot work on a piece with a quiet passage in it: set it
 * for the loud bars and the quiet ones vanish. The local median tracks the
 * ambient level of change, so `delta` means the same thing everywhere — "this
 * much busier than the last fifth of a second". The absolute floor exists only
 * to stop the median finding structure in near-silence, where it is tiny and
 * anything at all clears delta times it.
 */
function pick(df, times, sr, delta) {
  const half = Math.max(1, Math.round((MED_SECS * sr) / HOP));
  const sorted = [...df].sort((a, b) => a - b);
  const floor = 0.1 * sorted[Math.floor(0.9 * sorted.length)];
  const minGap = Math.round((MIN_IOI * sr) / HOP);
  const onsets = [];
  let last = -Infinity;
  for (let t = 1; t < df.length - 1; t++) {
    if (df[t] <= df[t - 1] || df[t] < df[t + 1]) continue;      // not a local max
    const win = df.slice(Math.max(0, t - half), t + half + 1).sort((a, b) => a - b);
    const med = win[win.length >> 1];
    if (df[t] < delta * med + floor) continue;
    if (t - last < minGap) continue;
    last = t;
    onsets.push({ t: times[t], frame: t, strength: df[t] / (med + 1e-12) });
  }
  return onsets;
}

// ------------------------------------------------- 2. what is in an onset --

/** Interpolated spectral peaks, loudest first. Frequency in Hz, amp linear. */
function spectralPeaks(mag, sr, nfft) {
  const out = [];
  let max = 0;
  for (let k = 1; k < mag.length - 1; k++) if (mag[k] > max) max = mag[k];
  for (let k = 2; k < mag.length - 1; k++) {
    if (!(mag[k] > mag[k - 1] && mag[k] >= mag[k + 1])) continue;
    if (mag[k] < max * 0.008) continue;                        // -42 dB and below is not a partial
    // Parabola through the log magnitudes; its vertex is the real peak. Bins are
    // 2.9 Hz here and a 17-EDO step down at 130 Hz is 5 Hz, so the fractional
    // part is not a nicety.
    const a = Math.log(mag[k - 1] + 1e-12), b = Math.log(mag[k] + 1e-12), c = Math.log(mag[k + 1] + 1e-12);
    const den = a - 2 * b + c;
    const sh = den ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
    const freq = ((k + sh) * sr) / nfft;
    if (freq < 40 || freq > 5000) continue;
    out.push({ freq, amp: Math.exp(b - 0.25 * (a - c) * sh), taken: false });
  }
  return out.sort((x, y) => y.amp - x.amp).slice(0, 40);
}

/** Sum of a candidate's harmonic amplitudes, weighted down as 1/h. */
function harmonicScore(f0, pool) {
  let score = 0, hits = 0;
  const claimed = [];
  for (let h = 1; h <= MAX_H; h++) {
    const f = f0 * h;
    if (f > 5000) break;
    let best = null;
    for (const p of pool) if (!p.taken && Math.abs(p.freq - f) / f < TOL && (!best || p.amp > best.amp)) best = p;
    if (best) { score += best.amp / h; hits++; claimed.push(best); }
  }
  // One peak is not a harmonic series, it is a peak. Reporting it as a note
  // would turn every bit of broadband noise into a pitch.
  return hits >= 2 ? { score, hits, claimed } : null;
}

/**
 * Pull up to K harmonic series out of the peak list, strongest first.
 *
 * The octave guard is the part worth reading. A series at f0 also scores well at
 * 2·f0 (the even harmonics alone look like a complete series one octave up), and
 * amplitude alone does not break the tie because the second harmonic is often
 * the loudest partial. So among candidates that score within 15% of the best,
 * the LOWEST is taken. That is the standard fix and it is the standard fix
 * because the failure it prevents — everything reported an octave high — is both
 * common and silent.
 */
function fundamentals(pool, k) {
  const found = [];
  let first = 0;
  while (found.length < k) {
    const seen = [];
    for (const p of pool) {
      if (p.taken) continue;
      for (const div of [1, 2, 3]) {
        const f0 = p.freq / div;
        if (f0 < 40) continue;
        if (seen.some((c) => Math.abs(c.f0 - f0) / f0 < TOL)) continue;
        const r = harmonicScore(f0, pool);
        if (r) seen.push({ f0, ...r });
      }
    }
    if (!seen.length) break;
    const best = Math.max(...seen.map((c) => c.score));
    if (!first) first = best;
    if (best < 0.03 * first) break;                            // into the noise
    const win = seen.filter((c) => c.score >= 0.85 * best).sort((a, b) => a.f0 - b.f0)[0];
    win.claimed.forEach((p) => { p.taken = true; });
    found.push(win);
  }
  return found;
}

/** Peaks of the cepstral envelope — the resonances, independent of the pitch. */
function formants(mag, sr, f0) {
  // Coarser than the harmonic spacing, or the envelope starts tracking harmonics
  // and reports the pitch back at us under a different name.
  const ord = Math.max(6, Math.min(60, Math.round(sr / Math.max(300, f0 * 1.1))));
  const env = cepstralEnvelope(mag, ord);
  const nyq = sr / 2;
  const out = [];
  let max = -Infinity;
  for (let k = 0; k < env.length; k++) if (env[k] > max) max = env[k];
  for (let k = 1; k < env.length - 1; k++) {
    const f = (k / (env.length - 1)) * nyq;
    if (f < 150 || f > 6000) continue;
    if (env[k] > env[k - 1] && env[k] >= env[k + 1]) {
      out.push({ hz: +f.toFixed(0), db: +((env[k] - max) * 8.6859).toFixed(1) });
    }
  }
  return out.sort((a, b) => b.db - a.db).slice(0, 3);
}

/**
 * Find the frequency a 17-EDO grid has to sit on for these notes to land on it.
 *
 * Assuming A=440 produced a report in which four fifths of the notes were 30-odd
 * cents from a degree — and a 17-EDO step is 71 cents, so "30-odd" is halfway
 * between two of them, which is the one place a real tuning never sits. A
 * uniform offset like that is the reference being wrong, not the piece.
 *
 * So: express every measured pitch in degrees, throw away the whole-number part
 * and keep the fraction, and take the circular mean of what is left. Circular
 * because the fraction wraps — an average of 0.49 and -0.49 is 0.5, not 0.
 *
 * `R` is the concentration, 0 to 1, and it is the honest part of this. If the
 * music really is on a 17-note grid the fractions cluster and R is near 1. If it
 * is not, this function still returns a reference, confidently, and R is the
 * only thing that says so.
 */
function fitReference(freqs, anchor) {
  let sx = 0, sy = 0;
  for (const f of freqs) {
    const turn = 2 * Math.PI * 17 * Math.log2(f / anchor);
    sx += Math.cos(turn); sy += Math.sin(turn);
  }
  const R = Math.hypot(sx, sy) / freqs.length;
  return {
    ref: anchor * 2 ** (Math.atan2(sy, sx) / (2 * Math.PI) / 17),
    R,
    cents: (Math.sqrt(-2 * Math.log(Math.max(R, 1e-9))) / (2 * Math.PI)) * (1200 / 17),
  };
}

/** Degree and cents-off for one measured frequency, against a fitted reference. */
function degreeOf(hz, ref) {
  const deg = 17 * Math.log2(hz / ref);
  const near = Math.round(deg);
  return { degree: near, cents: +(((deg - near) * 1200) / 17).toFixed(0) };
}

/** A Hann of length `n` inside a zero-padded buffer of length `pad`. */
function padWindow(pad, n) {
  const w = new Float64Array(pad);
  const h = hann(n);
  for (let i = 0; i < n; i++) w[i] = h[i];
  return w;
}

/** Everything measurable about one onset. */
function analyse(mono, sr, time, k) {
  const start = Math.round((time + PITCH_SKIP) * sr);
  if (start + PITCH_N > mono.length) return null;
  const w = hann(PITCH_N);
  const { re, im } = frameFFT(mono, start, w);
  const mag = magnitudes(re, im);
  // The same samples again, zero-padded: the padding buys frequency precision
  // for the peak interpolation. The envelope is taken from the unpadded
  // spectrum, whose bins are measurements rather than interpolation ripple.
  const p = frameFFT(mono, start, padWindow(PAD, PITCH_N));
  const peaks = spectralPeaks(magnitudes(p.re, p.im), sr, PAD);
  const notes = fundamentals(peaks, k).map((c) => ({
    hz: +c.f0.toFixed(1),
    harmonics: c.hits,
    db: +(20 * Math.log10(c.claimed[0].amp / peaks[0].amp)).toFixed(1),
  }));
  // The HIGHEST note sets how smooth the envelope has to be, which reads
  // backwards until you write it down: harmonics of a 700 Hz note are 700 Hz
  // apart, and an envelope fine enough to resolve 700 Hz will happily wander up
  // and down between them and call each one a formant.
  const top = notes.length ? Math.max(...notes.map((n) => n.hz)) : 300;
  return { notes, formants: formants(mag, sr, top) };
}

// ---------------------------------------------------------------- the wav --

/** An interleaved wav as its separate channels plus their mono sum. */
export function readMono(path, secs = 0) {
  const { sr, channels, data } = readWav(resolve(path));
  let frames = Math.floor(data.length / channels);
  if (secs > 0) frames = Math.min(frames, Math.round(secs * sr));
  const chans = [];
  for (let c = 0; c < channels; c++) {
    const ch = new Float32Array(frames);
    for (let i = 0; i < frames; i++) ch[i] = data[i * channels + c];
    chans.push(ch);
  }
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += chans[c][i];
    mono[i] = s / channels;
  }
  return { sr, channels, frames, chans, mono };
}

/**
 * The three jobs above, run over one mono signal.
 *
 * `picked` is the raw peak-pick — times and flux strengths only, kept because
 * the click track wants every one of them. `onsets` is the subset that had
 * enough signal after them to measure, which is what the report carries.
 */
export function onsetReport(mono, sr, { delta = 1.8, k = 4, ref = 'auto' } = {}) {
  const { df, times } = flux(mono, sr);
  const picked = pick(df, times, sr, delta);

  const onsets = [];
  for (const o of picked) {
    const a = analyse(mono, sr, o.t, k);
    if (a) onsets.push({ t: +o.t.toFixed(3), strength: +o.strength.toFixed(2), ...a });
  }

  const all = onsets.flatMap((e) => e.notes.map((n) => n.hz));
  const fit = ref === 'auto' ? fitReference(all, 440) : { ref: Number(ref), R: null, cents: null };
  for (const e of onsets) for (const n of e.notes) Object.assign(n, degreeOf(n.hz, fit.ref));

  return {
    frames: df.length,
    picked,
    fit,
    onsets,
    params: { N, HOP, delta, maxNotes: k, tolerance: TOL },
  };
}
