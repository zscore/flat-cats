/**
 * pick.mjs — turn a pile of cat recordings into a tuned instrument.
 *
 *   node tools/pick.mjs --src=raw/cuts
 *
 * The source is raw/cuts: the voiced events cut-meows.mjs found inside the CC0
 * Freesound pool. Filenames are `fs<id>_<uploader>_<n>.wav`, so everything
 * before the last underscore identifies the recording — which is as close as
 * this source gets to naming an individual cat.
 *
 * A meow is not a note. It has no fixed pitch, it starts and ends whenever it
 * likes, and half of these are a cat complaining over a hairbrush. To play one
 * ON a pitch you have to know what pitch it already IS, so this measures each
 * file's fundamental and writes it into the manifest as that sample's root. The
 * renderer then asks for "degree 7 of 17" and gets a playback rate, per sample.
 *
 * WHY THERE ARE CLEANLINESS GATES. This used to select on pitch steadiness
 * alone, which says nothing about the axis you actually hear. Retuned up eight
 * semitones by the sampler, a recording's noise floor rises with it — a hiss at
 * 4 kHz lands at 6.4 kHz, right where it is most audible, and that is the
 * "scratch". So every candidate is also measured for how far it sits above its
 * own floor and how much real bandwidth it has, and most of the pool fails.
 *
 * The third gate is the surprising one. A cut with almost all its energy above
 * 4 kHz is not a bright meow, it is a hiss or a spit that held enough pitch to
 * fool cut-meows.mjs's voicing test. Measured over the pool, that population is
 * cleanly separated: the 90th percentile of high-band energy is 50%, and the
 * five cuts above it are all hisses. Hence MAX_HISS.
 *
 * What comes out: public/meows/*.wav (trimmed, normalised) + manifest.json.
 * Re-run it to re-pick; nothing downstream is hand-edited.
 */
import { readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { readWav, writeWav } from './wav.mjs';
import { hann, frameFFT, magnitudes } from './spectral.mjs';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const SRC_ARG = arg('src', '');
// Resolve only after checking — resolve('') is the cwd, which always exists,
// so a missing --src would otherwise sail past the guard and survey this repo.
const SRC = SRC_ARG ? resolve(SRC_ARG) : '';
const OUT = resolve('public/meows');
const PER_BAND = Number(arg('per', 8));

const MIN_SNR = Number(arg('snr', 18));      // dB above the file's own floor
const MIN_ROLL = Number(arg('roll', 3500));  // Hz that 95% of the energy fits under
const MAX_HISS = Number(arg('hiss', 0.5));   // energy above 4 kHz; more than this is a spit

/**
 * Three bands by the sample's own fundamental.
 *
 * These replace the CatMeows situations (brushed / waiting for food / isolated),
 * which this source cannot know — a Freesound upload does not say why the cat
 * was talking. The names are honest about what now separates them, and the
 * thresholds are the ones synth.js's `register` mapping already used, so a part
 * cast by register gets samples that really are in that register.
 */
const BANDS = [['low', 0, 380], ['mid', 380, 800], ['high', 800, Infinity]];
const bandOf = (f0) => BANDS.find(([, lo, hi]) => f0 >= lo && f0 < hi)[0];

// ------------------------------------------------------------- measurement --

/** Trim leading/trailing near-silence at a fraction of the file's own peak. */
function trim(data, floor = 0.06) {
  const peak = data.reduce((m, x) => Math.max(m, Math.abs(x)), 0) || 1;
  const t = peak * floor;
  let a = 0, b = data.length - 1;
  while (a < b && Math.abs(data[a]) < t) a++;
  while (b > a && Math.abs(data[b]) < t) b--;
  return { slice: data.subarray(a, b + 1), peak };
}

/**
 * Fundamental of one frame by normalised autocorrelation.
 *
 * Returns the SMALLEST lag that gets within 12% of the best correlation, not
 * the best lag itself. A periodic signal correlates just as well at twice its
 * period, and taking the maximum picks that multiple about a third of the time
 * — which reads as a meow an octave below the one you can plainly hear. My
 * first pass at this had exactly that bug: the "glide" it reported clustered on
 * 12.5 semitones, which is not a cat, it is an octave error with a limp.
 */
function frameF0(seg, sr, minHz, maxHz) {
  const lo = Math.max(2, Math.floor(sr / maxHz)), hi = Math.ceil(sr / minHz);
  const n = seg.length;
  const e0 = seg.reduce((s, x) => s + x * x, 0);
  if (e0 < 1e-9) return 0;
  const v = new Float64Array(hi + 2);
  let best = 0;
  for (let lag = lo; lag <= hi && lag < n; lag++) {
    let c = 0, e = 0;
    for (let i = 0; i + lag < n; i++) { c += seg[i] * seg[i + lag]; e += seg[i + lag] ** 2; }
    v[lag] = c / (Math.sqrt(e0 * e) + 1e-12);
    if (v[lag] > best) best = v[lag];
  }
  if (best < 0.5) return 0;
  let lag = 0;
  for (let l = lo; l <= hi; l++) if (v[l] >= best * 0.88) { lag = l; break; }
  if (!lag) return 0;
  // These files are 8 kHz, so one whole lag step near 1 kHz is about two
  // semitones — integer lags cannot express a pitch to anything like the
  // precision 17-EDO needs (a step is 0.71 semitones). Fit a parabola through
  // the correlation peak and its two neighbours and take its vertex, which
  // recovers a fractional period.
  const a = v[lag - 1] ?? 0, b = v[lag], c = v[lag + 1] ?? 0;
  const denom = a - 2 * b + c;
  const shift = denom ? (0.5 * (a - c)) / denom : 0;
  return sr / (lag + Math.max(-0.5, Math.min(0.5, shift)));
}

/** Per-file pitch track. Returns median f0 and how far it wanders, in semitones. */
function pitchTrack(data, sr) {
  const frame = Math.round(sr * 0.048), hop = Math.round(sr * 0.016);
  const peak = data.reduce((m, x) => Math.max(m, Math.abs(x)), 0) || 1;
  const fs = [];
  for (let s = 0; s + frame < data.length; s += hop) {
    const seg = data.subarray(s, s + frame);
    const rms = Math.sqrt(seg.reduce((a, x) => a + x * x, 0) / frame);
    if (rms < 0.18 * peak) continue;           // only measure where there is a cat
    const f = frameF0(seg, sr, 200, 1300);
    if (f) fs.push(f);
  }
  if (fs.length < 3) return null;
  const st = [...fs].sort((a, b) => a - b);
  const q = (p) => st[Math.min(st.length - 1, Math.floor(p * st.length))];
  const median = q(0.5);
  // Interquartile spread, in semitones — robust to the odd stray frame in a way
  // that max-minus-min is not.
  const spread = 12 * Math.log2(q(0.75) / q(0.25));
  return { median, spread, voiced: fs.length };
}

/**
 * How far the cat sits above the hiss, and how much band it really occupies.
 *
 * The floor is the 10th percentile of short-time RMS rather than the minimum,
 * so one truly silent frame cannot report an infinite signal-to-noise. The
 * spectrum is averaged over the loudest 15% of frames only — measured across
 * the whole cut, a short meow in a long quiet one describes the room instead.
 */
function cleanliness(data, sr) {
  const N = 1024, HOP = 512, w = hann(N);
  const frames = [];
  for (let s = 0; s + N <= data.length; s += HOP) {
    let e = 0;
    for (let i = s; i < s + N; i++) e += data[i] * data[i];
    frames.push({ at: s, rms: Math.sqrt(e / N) });
  }
  if (frames.length < 4) return null;
  const sorted = frames.map((f) => f.rms).sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const snr = 20 * Math.log10(sorted[sorted.length - 1] / (q(0.1) + 1e-12));

  const half = N >> 1, loudAt = q(0.85);
  const power = new Float64Array(half + 1);
  for (const f of frames) {
    if (f.rms < loudAt) continue;
    const { re, im } = frameFFT(data, f.at, w);
    const mag = magnitudes(re, im);
    for (let k = 0; k <= half; k++) power[k] += mag[k] * mag[k];
  }
  const total = power.reduce((a, x) => a + x, 0);
  if (!(total > 0)) return null;

  const binHz = sr / N;
  let cum = 0, roll = sr / 2;
  for (let k = 0; k <= half; k++) {
    cum += power[k];
    if (cum >= 0.95 * total) { roll = k * binHz; break; }
  }
  let high = 0;
  for (let k = Math.ceil(4000 / binHz); k <= half; k++) high += power[k];
  return { snr, roll, hiss: high / total };
}

// ------------------------------------------------------------------ picking --

function survey() {
  const files = readdirSync(SRC).filter((f) => f.endsWith('.wav'));
  const out = [];
  for (const f of files) {
    const { sr, data } = readWav(join(SRC, f));
    const { slice, peak } = trim(data);
    const secs = slice.length / sr;
    if (secs < 0.22 || secs > 1.4) continue;   // want a note, not a speech
    if (peak < 0.08) continue;                 // too quiet to survive a mix
    const p = pitchTrack(slice, sr);
    if (!p) continue;
    // Deliberately the untrimmed cut. trim() throws away exactly the near-silence
    // that the noise floor is measured FROM — run cleanliness() on the slice and
    // the 10th-percentile frame is a quiet part of the meow rather than the room,
    // which understates the floor and fails clean recordings. cut-meows.mjs pads
    // every event, so the room tone is there to be measured.
    const c = cleanliness(data, sr);
    if (!c) continue;
    // Everything before the event index names the recording: fs146961_Zabuhailo
    out.push({
      file: f, cat: f.replace(/\.wav$/, '').replace(/_\d+$/, ''),
      sr, secs, peak, f0: p.median, spread: p.spread, voiced: p.voiced, ...c,
    });
  }
  return out;
}

/** Everything the gates let through, tagged with its band. */
function clean(rows) {
  return rows
    .filter((r) => r.snr >= MIN_SNR && r.roll >= MIN_ROLL && r.hiss <= MAX_HISS)
    .map((r) => ({ ...r, band: bandOf(r.f0) }));
}

/**
 * PER_BAND meows per register: steadiest pitch first, one per recording.
 *
 * The one-per-recording rule is what stops a single chatty upload with twelve
 * good cuts in it from becoming the whole band. It is a preference and not a
 * law, though — with the pool this size some bands cannot fill on distinct
 * recordings alone, so a second pass tops up from what is left rather than
 * shipping a band of three.
 */
function choose(rows) {
  const picked = [];
  for (const [band] of BANDS) {
    const pool = rows.filter((r) => r.band === band).sort((a, b) => a.spread - b.spread);
    const seen = new Set();
    const take = (r) => { picked.push(r); seen.add(r.cat); };
    for (const r of pool) {
      if (seen.size >= PER_BAND) break;
      if (!seen.has(r.cat)) take(r);
    }
    let n = picked.filter((p) => p.band === band).length;
    for (const r of pool) {
      if (n >= PER_BAND) break;
      if (!picked.includes(r)) { picked.push(r); n++; }
    }
  }
  return picked;
}

// --------------------------------------------------------------------- run --

if (!SRC || !existsSync(SRC)) {
  console.error('pick.mjs: pass --src=<dir of cut meows>  (try raw/cuts)');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
console.log(`surveying ${SRC} …`);
const rows = survey();
const kept = clean(rows);
console.log(`${rows.length} usable (right length, loud enough, has a pitch)`);
console.log(`${kept.length} also clean (>=${MIN_SNR} dB over floor, ` +
  `>=${MIN_ROLL} Hz of band, <=${MAX_HISS * 100}% above 4 kHz), ` +
  `from ${new Set(kept.map((r) => r.cat)).size} recordings`);

const picked = choose(kept);
const manifest = [];
for (const r of picked) {
  const { sr, data } = readWav(join(SRC, r.file));
  const { slice } = trim(data);
  const peak = slice.reduce((m, x) => Math.max(m, Math.abs(x)), 0) || 1;
  const norm = Float32Array.from(slice, (x) => (x / peak) * 0.9);
  const name = `${r.band}_${manifest.filter((m) => m.voice === r.band).length}.wav`;
  writeWav(join(OUT, name), [norm], sr);
  manifest.push({
    name, voice: r.band, cat: r.cat, sr,
    seconds: +(norm.length / sr).toFixed(3),
    f0: +r.f0.toFixed(1),                      // the note this meow already is
    spread: +r.spread.toFixed(2),              // semitones of wander; lower is steadier
    snr: +r.snr.toFixed(1),                    // dB over its own noise floor
    roll: Math.round(r.roll),                  // Hz under which 95% of it sits
    source: r.file,
  });
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

for (const [v] of BANDS) {
  const g = manifest.filter((m) => m.voice === v);
  if (!g.length) { console.log(`${v.padEnd(9)}  0 meows  — nothing clean in this band`); continue; }
  const f0s = g.map((m) => m.f0).sort((a, b) => a - b);
  console.log(
    `${v.padEnd(9)} ${String(g.length).padStart(2)} meows  ` +
    `f0 ${Math.round(f0s[0])}–${Math.round(f0s[f0s.length - 1])} Hz  ` +
    `wander ${Math.min(...g.map((m) => m.spread)).toFixed(1)}–${Math.max(...g.map((m) => m.spread)).toFixed(1)} st  ` +
    `snr ${Math.min(...g.map((m) => m.snr)).toFixed(0)}–${Math.max(...g.map((m) => m.snr)).toFixed(0)} dB`,
  );
}
console.log(`\nwrote ${manifest.length} files + manifest.json → public/meows/`);
