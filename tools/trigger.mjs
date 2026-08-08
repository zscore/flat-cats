/**
 * trigger.mjs — fire real meows at the notes a track is already playing.
 *
 *   node tools/trigger.mjs --in=song.wav --out=out/triggered.wav --mix=0.7
 *
 * The other renderer in this folder, crossyn.mjs, puts a cat's spectral
 * envelope onto your synth and keeps everything else. That preserves the tuning
 * perfectly and does not sound like a cat, because only one of the four things
 * that make a meow a meow is the envelope. The other three -- the pitch glide,
 * the attack, the fact that it stops after half a second -- all still come from
 * the synth.
 *
 * So this does the opposite trade. It listens to the track, and every time a
 * band starts a note it plays an actual recording of a cat at that pitch. What
 * you hear IS a cat, because it is a cat. What it costs is the thing crossyn
 * was protecting: the pitch has to be ESTIMATED, and an estimate can be wrong.
 * In 17-EDO a step is 70.6 cents, so being out by 36 lands on the wrong note.
 * The run prints how close the estimates fall to a consistent grid so you can
 * see whether they are trustworthy on your material rather than take it on
 * faith.
 */
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { readWav, writeWav } from './wav.mjs';
import { hann, frameFFT, magnitudes } from './spectral.mjs';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};

/** Which cat answers which register. Same idea as crossyn's BANDS. */
const BANDS = [
  { name: 'low',  hi:  260,     voice: 'isolation', for: 'bass, sub' },
  { name: 'mid',  hi: 1400,     voice: 'brush',     for: 'pads, chords' },
  { name: 'high', hi: Infinity, voice: 'food',      for: 'leads, plucks' },
];

const N = 2048;            // onset resolution: ~43 ms at 48 k
const HOP = N / 4;
const N_PITCH = 8192;      // pitch needs the frequency resolution, not the time
const ONSET_RATIO = 1.7;
const ONSET_FLOOR_DB = -48;
const MIN_GAP_S = 0.12;    // one cat per band per this long, or it machine-guns
const MAX_STRETCH = 7;     // semitones; past this, fold by octaves instead
const FADE_S = 0.006;

// ------------------------------------------------------------------- pitch --

/** Strongest partial inside [lo,hi] Hz, refined below the bin grid. */
function pitchAt(mono, sr, start, lo, hi) {
  const w = hann(N_PITCH);
  const s = Math.max(0, Math.min(mono.length - N_PITCH, start));
  const { re, im } = frameFFT(mono, s, w);
  const mag = magnitudes(re, im);
  const klo = Math.max(1, Math.floor((lo * N_PITCH) / sr));
  const khi = Math.min(N_PITCH / 2 - 1, Math.ceil((hi * N_PITCH) / sr));
  let bk = 0, bv = -1;
  for (let k = klo; k <= khi; k++) if (mag[k] > bv) { bv = mag[k]; bk = k; }
  if (bk < 1 || bv <= 0) return 0;
  const a = Math.log(mag[bk - 1] + 1e-12), b = Math.log(mag[bk] + 1e-12), c = Math.log(mag[bk + 1] + 1e-12);
  const d = a - 2 * b + c;
  const shift = d ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : 0;
  return ((bk + shift) * sr) / N_PITCH;
}

// ------------------------------------------------------------------ onsets --

/** Every note-start this track offers, with the pitch it starts on. */
function events(mono, sr) {
  const w = hann(N);
  const nyq = sr / 2;
  const edges = BANDS.map((b) => Math.min(N / 2, Math.round((Math.min(b.hi, nyq) / nyq) * (N / 2))));
  const state = BANDS.map(() => ({ mean: 0, last: -1e9 }));
  const out = [];
  for (let s = 0; s + N <= mono.length; s += HOP) {
    const { re, im } = frameFFT(mono, s, w);
    const mag = magnitudes(re, im);
    let lo = 0;
    for (let b = 0; b < BANDS.length; b++) {
      let e = 0;
      for (let k = lo; k < edges[b]; k++) e += mag[k] * mag[k];
      const st = state[b];
      const t = s / sr;
      const db = 10 * Math.log10(e + 1e-12);
      if (e > st.mean * ONSET_RATIO && db > ONSET_FLOOR_DB && t - st.last > MIN_GAP_S) {
        const loHz = b === 0 ? 40 : BANDS[b - 1].hi;
        const hiHz = Math.min(BANDS[b].hi, nyq);
        const hz = pitchAt(mono, sr, s, loHz, hiHz);
        if (hz > 0) { out.push({ t, band: b, hz, rms: Math.sqrt(e) }); st.last = t; }
      }
      st.mean = e > st.mean ? st.mean * 0.4 + e * 0.6 : st.mean * 0.92 + e * 0.08;
      lo = edges[b];
    }
  }
  return out;
}

// ----------------------------------------------------------------- playing --

/**
 * Pick a meow and a playback rate for one target pitch.
 *
 * A bass note is far below anything a cat produces -- the lowest meow here is
 * 291 Hz against a 65 Hz bass -- so asking for it directly means playing a
 * sample at a fifth of its speed, which is mud. Folding by whole octaves puts
 * the cat in a register it can actually reach while still tracking the line,
 * which is what a sampler has always done with a range it does not have.
 */
function pick(bank, targetHz) {
  let best = null;
  for (const m of bank) {
    let rate = targetHz / m.f0;
    let folds = 0;
    while (Math.abs(12 * Math.log2(rate)) > MAX_STRETCH && folds < 5) {
      rate *= 12 * Math.log2(rate) < 0 ? 2 : 0.5;
      folds++;
    }
    const cost = Math.abs(12 * Math.log2(rate));
    if (!best || cost < best.cost) best = { m, rate, cost, folds };
  }
  return best;
}

/** Mix one meow into L/R at `t`, resampled by `rate`. */
function place(L, R, sample, at, rate, gain, sr) {
  const { data, sr: msr } = sample.wav;
  const step = (rate * msr) / sr;
  const n = Math.floor(data.length / step) - 1;
  const fade = Math.max(1, Math.round(FADE_S * sr));
  for (let i = 0; i < n; i++) {
    const p = i * step;
    const j = Math.floor(p), f = p - j;
    if (j + 1 >= data.length) break;
    const v = (data[j] * (1 - f) + data[j + 1] * f) * gain
      * Math.min(1, i / fade) * Math.min(1, (n - i) / fade);
    const k = at + i;
    if (k >= 0 && k < L.length) { L[k] += v; R[k] += v; }
  }
}

// --------------------------------------------------------------------- run --

const IN = arg('in', '');
const OUT = resolve(arg('out', 'out/triggered.wav'));
const BANK = resolve(arg('bank', 'public/meows'));
const MIX = Math.max(0, Math.min(1, Number(arg('mix', 0.7))));

if (!IN || !existsSync(IN) || extname(IN).toLowerCase() !== '.wav') {
  console.error('trigger.mjs: pass --in=<song.wav> (16-bit PCM WAV)');
  process.exit(1);
}
if (!existsSync(join(BANK, 'manifest.json'))) {
  console.error('trigger.mjs: no meow bank. node tools/pick.mjs --src=<CatMeows dir>');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(BANK, 'manifest.json'), 'utf8'));
const song = readWav(resolve(IN));
const { sr, channels, data } = song;
const frames = Math.floor(data.length / channels);
const mono = new Float32Array(frames);
for (let i = 0; i < frames; i++) {
  let s = 0;
  for (let c = 0; c < channels; c++) s += data[i * channels + c];
  mono[i] = s / channels;
}
console.log(`${IN}: ${(frames / sr).toFixed(1)}s, ${channels}ch @ ${sr} Hz  mix ${MIX}`);

// load each band's voice, wav and all
const banks = BANDS.map((b) => manifest.filter((m) => m.voice === b.voice).map((m) => ({
  ...m, wav: readWav(join(BANK, m.name)),
})));

console.log('finding onsets and pitches …');
const evs = events(mono, sr);

const L = new Float32Array(frames), R = new Float32Array(frames);
const stretches = [], detected = [];
for (const ev of evs) {
  const chosen = pick(banks[ev.band], ev.hz);
  if (!chosen) continue;
  stretches.push({ band: ev.band, cents: chosen.cost * 100, folds: chosen.folds });
  detected.push(ev.hz);
  place(L, R, chosen.m, Math.round(ev.t * sr), chosen.rate, Math.min(1, ev.rms * 0.02), sr);
}

// blend against the dry track
const outL = new Float32Array(frames), outR = new Float32Array(frames);
for (let i = 0; i < frames; i++) {
  const dl = data[i * channels], dr = channels > 1 ? data[i * channels + 1] : dl;
  outL[i] = dl * (1 - MIX) + L[i] * MIX;
  outR[i] = dr * (1 - MIX) + R[i] * MIX;
}
let peak = 0;
for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
if (peak > 0.99) for (let i = 0; i < frames; i++) { outL[i] *= 0.99 / peak; outR[i] *= 0.99 / peak; }

mkdirSync(dirname(OUT), { recursive: true });
const w = writeWav(OUT, [outL, outR], sr);

BANDS.forEach((b, i) => {
  const g = stretches.filter((s) => s.band === i);
  if (!g.length) return console.log(`${b.name.padEnd(5)} no events`);
  const med = g.map((s) => s.cents).sort((a, x) => a - x)[Math.floor(g.length / 2)];
  console.log(`${b.name.padEnd(5)} ${b.voice.padEnd(9)} ${String(g.length).padStart(5)} meows  ` +
    `median stretch ${(med / 100).toFixed(1)} st  ` +
    `octave-folded ${Math.round((100 * g.filter((s) => s.folds).length) / g.length)}%`);
});
console.log(`\npeak ${(20 * Math.log10(peak)).toFixed(1)} dBFS` +
  `\nwrote ${w.seconds.toFixed(1)}s → ${OUT}`);

/**
 * How trustworthy were the pitch estimates?
 *
 * If the piece sits in a fixed equal tuning, every detected pitch should land
 * near a step of it -- so the tightness of that clustering is an error bar on
 * the whole file, measured from the material itself with no ground truth.
 *
 * The grid's OFFSET has to be fitted, not assumed. A tuning says how far apart
 * the notes are, not where they start; anchoring 17-EDO at A0 the way you would
 * anchor 12 is picking one of 17 possible grids at random, and getting a bad
 * score from it says nothing about the pitches. So this scans the offset and
 * reports the best fit. `chance` is what a uniformly random set of pitches
 * would score against the same grid -- the number to beat before believing any
 * of it.
 */
console.log('\npitch estimates vs an equal-tempered grid (offset fitted):');
for (const edo of [12, 17]) {
  const step = 1200 / edo;
  let best = Infinity, bestOff = 0;
  for (let o = 0; o < 100; o++) {
    const off = o / 100;
    const errs = detected
      .map((f) => { const st = edo * Math.log2(f / 27.5) + off; return Math.abs(st - Math.round(st)) * step; })
      .sort((a, b) => a - b);
    const med = errs[Math.floor(errs.length / 2)];
    if (med < best) { best = med; bestOff = off; }
  }
  const verdict = best < step / 6 ? 'tight' : best < step / 4 ? 'loose' : 'no better than chance';
  console.log(`  ${String(edo).padStart(2)}-EDO  step ${step.toFixed(1).padStart(5)}c  ` +
    `median |error| ${best.toFixed(1).padStart(5)}c  (chance ${(step / 4).toFixed(1)}c)  ` +
    `offset ${bestOff.toFixed(2)}  — ${verdict}`);
}
