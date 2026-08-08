/**
 * crossyn.mjs — play a song through cats without retuning it.
 *
 *   node tools/crossyn.mjs --in=song.wav --out=out/meowed.wav
 *
 * Cross-synthesis. Every frame of the song is split into its excitation (where
 * the harmonics sit — the pitch) and its envelope (the shape across frequency —
 * the timbre). The song's envelope is thrown away and a meow's is put in its
 * place. What comes out has a cat's formants on the song's own oscillators.
 *
 * The reason it is built this way rather than as a sampler: the pitch is never
 * measured. Not estimated, not rounded to a note, not looked up in a table. The
 * harmonic peaks stay in the exact bins they arrived in and the phase is passed
 * through untouched, so whatever tuning the song is in — 17-EDO, 12, a scala
 * file, something drifting — comes out the far side unchanged, because it was
 * never represented as a note in the first place.
 *
 * Needs the meow bank: run tools/pick.mjs first to make public/meows/.
 */
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { readWav, writeWav } from './wav.mjs';
import { fft, hann, frameFFT, magnitudes, cepstralEnvelope, regridEnvelope } from './spectral.mjs';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};

/**
 * WHICH CAT PLAYS WHAT.
 *
 * A stereo mix does not say which synth is which, so register stands in for it:
 * a bass, a pad and a lead usually occupy different bands, and a band is
 * something we can actually measure. Where two synths overlap in register they
 * will share a voice — that is the honest limit of working from a mix.
 *
 * `hi` is the top of the band in Hz. Retune these by ear against your own
 * track; they are the first thing to reach for if a voice is landing on the
 * wrong part. The voices are pick.mjs's three situations: brush, food,
 * isolation. Swapping the names here swaps which cat is on which synth.
 */
const BANDS = [
  { name: 'low',  hi:  260,      voice: 'isolation', for: 'bass, sub' },
  { name: 'mid',  hi: 1400,      voice: 'brush',     for: 'pads, chords, body' },
  { name: 'high', hi: Infinity,  voice: 'food',      for: 'leads, plucks, air' },
];

const N = 2048;                 // ~46 ms at 44.1 k — long enough to resolve a bass partial
const HOP = N / 4;              // Hann at 75% overlap sums to a constant
const MEOW_N = 512;             // meows are 8 kHz, so a shorter frame: ~64 ms
const MEOW_HOP = MEOW_N / 4;
const ONSET_RATIO = 1.7;        // band energy over its own recent mean = new meow
const ONSET_FLOOR_DB = -48;     // below this a "rise" is just noise coming back

/**
 * How smooth an envelope has to be, stated in Hz rather than in coefficients.
 *
 * Keeping the first Q cepstral coefficients keeps spectral detail spaced wider
 * than sr/Q Hz — so a bare Q means different things at 8 kHz and 44.1 kHz, and
 * a single constant for both was wrong in a way that mattered:
 *
 *   The SONG's envelope must stay coarser than the spacing of its own
 *   harmonics. If it starts tracking them, dividing by it flattens them, and
 *   flat is the absence of pitch — the very thing this whole file exists to
 *   protect. 2600 Hz leaves headroom above any fundamental a synth is likely
 *   to be playing.
 *
 *   The MEOW's envelope must stay coarser than that meow's own f0, or the
 *   cat's pitch rides in on the envelope and gets stamped onto your track.
 *   pick.mjs already measured and stored each f0, so this is per meow rather
 *   than one number for the bank.
 */
const SONG_ENV_HZ = 2600;
const order = (sr, spacingHz) => Math.max(6, Math.min(60, Math.round(sr / spacingHz)));

// ------------------------------------------------------------- the meow bank --

/**
 * Every meow of one voice, as a sequence of log-magnitude envelopes already
 * regridded onto the song's bins. Precomputed because the same 8 or so meows
 * get retriggered hundreds of times and their envelopes never change.
 */
function loadVoice(dir, manifest, voice, sr) {
  const bins = N / 2 + 1;
  const w = hann(MEOW_N);
  const meows = [];
  for (const m of manifest.filter((x) => x.voice === voice)) {
    const { sr: msr, data } = readWav(join(dir, m.name));
    // Smooth away this cat's own harmonic ripple, whose spacing is its f0.
    // Falls back to 250 Hz for a manifest without one rather than guessing high.
    const ord = order(msr, Math.max(250, (m.f0 || 0) * 1.1));
    const frames = [];
    for (let s = 0; s + MEOW_N <= data.length; s += MEOW_HOP) {
      const { re, im } = frameFFT(data, s, w);
      const env = cepstralEnvelope(magnitudes(re, im), ord);
      frames.push(regridEnvelope(env, msr, bins, sr));
    }
    if (frames.length) meows.push({ name: m.name, frames, hopSecs: MEOW_HOP / msr });
  }
  return meows;
}

// ------------------------------------------------------- pass 1: the schedule --

/**
 * Walk the mono sum once and decide, per frame per band, which meow is sounding
 * and how far into it we are.
 *
 * Done on mono and up front for one reason: both channels must retrigger on the
 * same frames. Deciding per channel lets left and right drift onto different
 * meows, and two different cats hard-panned against each other stops sounding
 * like one animal in a room.
 */
function schedule(mono, sr, voices) {
  const w = hann(N);
  const nyq = sr / 2;
  const edges = BANDS.map((b) => Math.min(N / 2, Math.round((Math.min(b.hi, nyq) / nyq) * (N / 2))));
  const state = BANDS.map(() => ({ mean: 0, idx: -1, frame: 0, hits: 0 }));
  const plan = [];
  for (let s = 0; s + N <= mono.length + HOP; s += HOP) {
    const { re, im } = frameFFT(mono, s, w);
    const mag = magnitudes(re, im);
    const row = [];
    let lo = 0;
    for (let b = 0; b < BANDS.length; b++) {
      let e = 0;
      for (let k = lo; k < edges[b]; k++) e += mag[k] * mag[k];
      const st = state[b];
      const db = 10 * Math.log10(e + 1e-12);
      const rising = e > st.mean * ONSET_RATIO && db > ONSET_FLOOR_DB;
      if (rising && voices[b].length) {
        st.idx = (st.idx + 1) % voices[b].length; // round-robin, so repeats vary
        st.frame = 0;
        st.hits++;
      } else if (st.idx >= 0) {
        st.frame++;
      }
      // Slew the reference upward fast and downward slowly, so a decaying note
      // does not read as a fresh onset every time it wobbles.
      st.mean = e > st.mean ? st.mean * 0.4 + e * 0.6 : st.mean * 0.92 + e * 0.08;
      row.push({ idx: st.idx, frame: st.frame });
      lo = edges[b];
    }
    plan.push(row);
  }
  return { plan, edges, hits: state.map((s) => s.hits) };
}

// ------------------------------------------- pass 2: put the cat on the synth --

/**
 * Rebuild one channel with each band's envelope replaced by its meow's.
 *
 * Per band the original energy is measured and restored afterwards, so this
 * changes the colour of the mix without changing its balance — a bass line
 * stays as loud relative to the lead as it was when it arrived.
 */
function render(chan, sr, voices, plan, edges) {
  const w = hann(N);
  const songOrder = order(sr, SONG_ENV_HZ);
  const out = new Float64Array(chan.length + N);
  const norm = new Float64Array(chan.length + N);
  const bins = N / 2 + 1;
  let f = 0;
  for (let s = 0; s + N <= chan.length + HOP && f < plan.length; s += HOP, f++) {
    const { re, im } = frameFFT(chan, s, w);
    const mag = magnitudes(re, im);
    const songEnv = cepstralEnvelope(mag, songOrder);
    const gain = new Float64Array(bins);
    let lo = 0;
    for (let b = 0; b < BANDS.length; b++) {
      const { idx, frame } = plan[f][b];
      const meow = idx >= 0 ? voices[b][idx] : null;
      // Past the end of a meow, hold its last frame. Looping it back to the
      // start reads as tremolo, which no cat does and every listener notices.
      const env = meow ? meow.frames[Math.min(frame, meow.frames.length - 1)] : null;
      let before = 0, after = 0;
      for (let k = lo; k < edges[b]; k++) {
        // exp(meow envelope - song envelope) — divide out the synth's timbre,
        // multiply in the cat's. The excitation between them is untouched.
        gain[k] = env ? Math.exp(env[k] - songEnv[k]) : 1;
        before += mag[k] * mag[k];
        after += (mag[k] * gain[k]) ** 2;
      }
      if (after > 0) {
        const fix = Math.sqrt(before / after);
        for (let k = lo; k < edges[b]; k++) gain[k] *= fix;
      }
      lo = edges[b];
    }
    for (let k = 0; k < bins; k++) {
      const g = gain[k];
      re[k] *= g; im[k] *= g;
      if (k > 0 && k < N / 2) { re[N - k] *= g; im[N - k] *= g; } // keep it real
    }
    fft(re, im, true);
    for (let i = 0; i < N; i++) {
      out[s + i] += re[i] * w[i];
      norm[s + i] += w[i] * w[i];
    }
  }
  // Divide out the window sum — but only where the windows actually overlap.
  // At the first and last few samples one window covers the sample on its own
  // tail, so norm is w[i]^2 (~1e-12) against an out of w[i]*signal: the division
  // amplifies the two edges by 1/w and the file opens with a bang. In steady
  // state Hann at 75% sums to 1.5, so anything under a thousandth of that is an
  // edge and gets no signal rather than a huge one.
  const FLOOR = 1.5e-3;
  const res = new Float32Array(chan.length);
  for (let i = 0; i < chan.length; i++) res[i] = norm[i] > FLOOR ? out[i] / norm[i] : 0;
  return res;
}

// --------------------------------------------------------------------- run --

const IN = arg('in', '');
const OUT = resolve(arg('out', 'out/meowed.wav'));
const BANK = resolve(arg('bank', 'public/meows'));

if (!IN || !existsSync(IN)) {
  console.error('crossyn.mjs: pass --in=<song.wav>  (16-bit PCM WAV)');
  process.exit(1);
}
if (extname(IN).toLowerCase() !== '.wav') {
  console.error(`crossyn.mjs: ${IN} is not a WAV. Convert it:\n` +
    `  ffmpeg -i "${IN}" -acodec pcm_s16le "${IN.replace(/\.[^.]+$/, '.wav')}"`);
  process.exit(1);
}
if (!existsSync(join(BANK, 'manifest.json'))) {
  console.error(`crossyn.mjs: no meow bank at ${BANK}. Build it first:\n` +
    '  node tools/pick.mjs --src=<CatMeows dataset dir>');
  process.exit(1);
}

let song;
try {
  song = readWav(resolve(IN));
} catch (e) {
  console.error(`crossyn.mjs: ${e.message}\n` +
    `  ffmpeg -i "${IN}" -acodec pcm_s16le -ar 44100 fixed.wav`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(BANK, 'manifest.json'), 'utf8'));
const { sr, channels, data } = song;
const frames = Math.floor(data.length / channels);
console.log(`${IN}: ${(frames / sr).toFixed(1)}s, ${channels}ch @ ${sr} Hz`);

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

const voices = BANDS.map((b) => loadVoice(BANK, manifest, b.voice, sr));
BANDS.forEach((b, i) => {
  if (!voices[i].length) {
    console.error(`crossyn.mjs: bank has no '${b.voice}' meows for the ${b.name} band`);
    process.exit(1);
  }
});

console.log('finding onsets …');
const { plan, edges, hits } = schedule(mono, sr, voices);
console.log(`rendering ${plan.length} frames × ${channels} channels …`);
const rendered = chans.map((c) => render(c, sr, voices, plan, edges));

let peak = 0;
for (const c of rendered) for (const x of c) peak = Math.max(peak, Math.abs(x));
if (peak > 0.99) for (const c of rendered) for (let i = 0; i < c.length; i++) c[i] *= 0.99 / peak;

mkdirSync(dirname(OUT), { recursive: true });
const w = writeWav(OUT, rendered, sr);

let lo = 0;
BANDS.forEach((b, i) => {
  const top = b.hi === Infinity ? sr / 2 : b.hi;
  console.log(
    `${b.name.padEnd(5)} ${String(Math.round(lo)).padStart(5)}–${String(Math.round(top)).padEnd(6)} Hz  ` +
    `${b.voice.padEnd(9)} ${String(voices[i].length).padStart(2)} meows  ` +
    `${String(hits[i]).padStart(5)} retriggers  (${b.for})`,
  );
  lo = top;
});
console.log(`\npeak ${(20 * Math.log10(peak)).toFixed(1)} dBFS` +
  (peak > 0.99 ? ' (limited to -0.1)' : '') + `\nwrote ${w.seconds.toFixed(1)}s → ${OUT}`);
