/**
 * audition.mjs — lay a whole meow bank end to end so it can be judged by ear.
 *
 *   node tools/audition.mjs --src=public/meows --out=out/audition_new.wav
 *
 * A manifest of noise-floor figures is not a review artifact for an instrument.
 * This is the thing you actually listen to.
 *
 * IT PLAYS EVERY SAMPLE TWICE. Once dry, then the whole bank again shifted up
 * eight semitones, because dry is not where the problem lives. The sampler
 * retunes to reach the score, and retuning up drags the recording's noise floor
 * up with it — a hiss sitting at 4 kHz arrives at 6.4 kHz, which is both louder
 * to the ear and squarely in the range that reads as "scratchy". A bank can
 * sound perfectly clean dry and fall apart at +8. Judge the second half.
 *
 * The shift is plain linear resampling, the same thing the Web Audio sampler
 * does with playbackRate — not a formant-preserving stretch. That is the point:
 * this should have exactly the artefacts the real playback path has.
 */
import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { readWav, writeWav } from './wav.mjs';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const SRC = resolve(arg('src', 'public/meows'));
const OUT = resolve(arg('out', 'out/audition.wav'));
const SR = Number(arg('sr', 48000));
const GAP = Number(arg('gap', 0.18));      // silence between samples, seconds
const SHIFT = Number(arg('shift', 8));     // semitones for the second pass

/** Read a wav at any rate and return it resampled to SR, linearly. */
function atRate(path, ratio = 1) {
  const { sr, data } = readWav(path);
  const step = (sr / SR) * ratio;
  const n = Math.floor(data.length / step);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * step, j = Math.floor(x), f = x - j;
    out[i] = (data[j] ?? 0) * (1 - f) + (data[j + 1] ?? 0) * f;
  }
  return out;
}

if (!existsSync(SRC)) {
  console.error(`audition.mjs: no such dir ${SRC}`);
  process.exit(1);
}
const files = readdirSync(SRC).filter((f) => f.endsWith('.wav')).sort();
if (!files.length) {
  console.error(`audition.mjs: no .wav in ${SRC}`);
  process.exit(1);
}

const gap = new Float32Array(Math.round(GAP * SR));
const passes = [{ label: 'dry', ratio: 1 }, { label: `+${SHIFT} st`, ratio: 2 ** (SHIFT / 12) }];
const chunks = [];
for (const p of passes) {
  // A longer rest between the two passes, so the seam is audible.
  chunks.push(new Float32Array(Math.round(0.6 * SR)));
  for (const f of files) chunks.push(atRate(join(SRC, f), p.ratio), gap);
}

const total = chunks.reduce((a, c) => a + c.length, 0);
const mix = new Float32Array(total);
let at = 0;
for (const c of chunks) { mix.set(c, at); at += c.length; }

mkdirSync(dirname(OUT), { recursive: true });
writeWav(OUT, [mix], SR);
console.log(`${files.length} samples x ${passes.length} passes ` +
  `(${passes.map((p) => p.label).join(', ')}) = ${(total / SR).toFixed(1)}s -> ${OUT}`);
