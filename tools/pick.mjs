/**
 * pick.mjs — turn 440 field recordings of cats into a tuned instrument.
 *
 *   node tools/pick.mjs --src=/path/to/CatMeows/dataset
 *
 * The source is the CatMeows dataset (Zenodo 4008297, CC BY 4.0): 440 meows
 * from 21 cats in three situations, encoded in the filename's first letter —
 * B = being brushed, F = waiting for food, I = isolated in a strange room.
 *
 * A meow is not a note. It has no fixed pitch, it starts and ends whenever it
 * likes, and half of these are a cat complaining over a hairbrush. To play one
 * ON a pitch you have to know what pitch it already IS, so this measures each
 * file's fundamental and writes it into the manifest as that sample's root. The
 * renderer then asks for "degree 7 of 17" and gets a playback rate, per sample.
 *
 * What comes out: public/meows/*.wav (trimmed, normalised) + manifest.json.
 * Re-run it to re-pick; nothing downstream is hand-edited.
 */
import { readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { readWav, writeWav } from './wav.mjs';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const SRC_ARG = arg('src', '');
// Resolve only after checking — resolve('') is the cwd, which always exists,
// so a missing --src would otherwise sail past the guard and survey this repo.
const SRC = SRC_ARG ? resolve(SRC_ARG) : '';
const OUT = resolve('public/meows');
const PER_CONTEXT = Number(arg('per', 8));

const CONTEXTS = { B: 'brush', F: 'food', I: 'isolation' };

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
    // `cat` is the 2nd filename field: B_ANI01_MC_FN_SIM01_101.wav → ANI01
    const [ctx, cat] = f.split('_');
    out.push({ file: f, ctx, cat, sr, secs, peak, f0: p.median, spread: p.spread, voiced: p.voiced });
  }
  return out;
}

/** Choose PER_CONTEXT meows per situation: steadiest pitch first, one per cat. */
function choose(rows) {
  const picked = [];
  for (const ctx of Object.keys(CONTEXTS)) {
    const pool = rows.filter((r) => r.ctx === ctx).sort((a, b) => a.spread - b.spread);
    const seen = new Set();
    for (const r of pool) {
      if (picked.filter((p) => p.ctx === ctx).length >= PER_CONTEXT) break;
      if (seen.has(r.cat)) continue;           // spread across cats, not one loud cat
      seen.add(r.cat);
      picked.push(r);
    }
  }
  return picked;
}

// --------------------------------------------------------------------- run --

if (!SRC || !existsSync(SRC)) {
  console.error('pick.mjs: pass --src=<CatMeows dataset dir> (440 .wav files)');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
console.log(`surveying ${SRC} …`);
const rows = survey();
console.log(`${rows.length} of 440 usable (right length, loud enough, has a pitch)`);

const picked = choose(rows);
const manifest = [];
for (const r of picked) {
  const { sr, data } = readWav(join(SRC, r.file));
  const { slice } = trim(data);
  const peak = slice.reduce((m, x) => Math.max(m, Math.abs(x)), 0) || 1;
  const norm = Float32Array.from(slice, (x) => (x / peak) * 0.9);
  const name = `${CONTEXTS[r.ctx]}_${manifest.filter((m) => m.voice === CONTEXTS[r.ctx]).length}.wav`;
  writeWav(join(OUT, name), [norm], sr);
  manifest.push({
    name, voice: CONTEXTS[r.ctx], cat: r.cat, sr,
    seconds: +(norm.length / sr).toFixed(3),
    f0: +r.f0.toFixed(1),                      // the note this meow already is
    spread: +r.spread.toFixed(2),              // semitones of wander; lower is steadier
    source: r.file,
  });
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

for (const v of Object.values(CONTEXTS)) {
  const g = manifest.filter((m) => m.voice === v);
  const f0s = g.map((m) => m.f0).sort((a, b) => a - b);
  console.log(
    `${v.padEnd(9)} ${String(g.length).padStart(2)} meows  ` +
    `f0 ${Math.round(f0s[0])}–${Math.round(f0s[f0s.length - 1])} Hz  ` +
    `wander ${Math.min(...g.map((m) => m.spread)).toFixed(1)}–${Math.max(...g.map((m) => m.spread)).toFixed(1)} st`,
  );
}
console.log(`\nwrote ${manifest.length} files + manifest.json → public/meows/`);
