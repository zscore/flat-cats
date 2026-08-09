/**
 * cut-meows.mjs — cut a pile of cat recordings into things shaped like meows.
 *
 *   node tools/cut-meows.mjs [--src=raw/meows] [--out=raw/cuts]
 *
 * What arrives from fetch-meows.mjs is not a sample bank. It is 110 field
 * recordings: a cat-flap clattering for four minutes, twelve seconds with four
 * meows and a fridge in it, someone's kitchen. This finds the events inside
 * them and writes one file per event.
 *
 * TWO GATES, and the second is the one that matters.
 *
 * Loud enough is easy — a hysteresis gate on short-time energy, opening well
 * above the file's own noise floor and closing lower so a meow that dips in the
 * middle stays one event rather than two.
 *
 * Shaped like a meow is the real question, and energy cannot answer it. A
 * cat-flap is loud. A purr is loud. Footsteps are loud. What separates a meow
 * from all of them is that it is VOICED: it has a fundamental, in roughly the
 * range a cat's throat produces, and it holds it long enough to measure. So
 * every candidate is pitch-tracked and thrown away unless most of it is voiced
 * inside 180-1400 Hz. That single test is what makes the output auditionable
 * instead of a folder of clatter.
 *
 * DELIBERATELY NOT NORMALISED. pick.mjs rejects anything under 0.08 peak, which
 * is how quiet junk gets dropped downstream; normalising here would blind it.
 * The audition file that this prints instructions for is normalised, the
 * samples are not.
 *
 * Output: raw/cuts/*.wav + index.json. Feed it to pick.mjs.
 */
import { readdirSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { readWav, writeWav } from './wav.mjs';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const SRC = resolve(arg('src', 'raw/meows'));
const OUT = resolve(arg('out', 'raw/cuts'));

const MIN_SEC = Number(arg('min', 0.15));   // shorter than this is a click, not a cry
const MAX_SEC = Number(arg('max', 2.2));    // longer is a yowl or two meows run together
const JOIN_SEC = 0.06;                      // gaps under this are inside one meow
const PAD_SEC = 0.025;                      // breathing room either side
const FADE_SEC = 0.008;                     // enough to kill the edge click
const VOICED_MIN = 0.45;                    // fraction of frames that must have a pitch
const [F_LO, F_HI] = [180, 1400];           // a domestic cat's range, generously

// ------------------------------------------------------------------ measure --

/** Short-time RMS, one value per hop. */
function envelope(x, frame, hop) {
  const out = [];
  for (let s = 0; s + frame <= x.length; s += hop) {
    let e = 0;
    for (let i = s; i < s + frame; i++) e += x[i] * x[i];
    out.push(Math.sqrt(e / frame));
  }
  return out;
}

/**
 * Fundamental of one frame by normalised autocorrelation, smallest-lag-wins.
 *
 * Same shape as the estimator in pick.mjs and for the same reason: taking the
 * best lag rather than the first good one reports an octave too low about a
 * third of the time. Here it only has to say voiced-or-not, so it returns 0
 * rather than guessing when the correlation is poor.
 *
 * The candidate must be a LOCAL MAXIMUM, which pick.mjs does not require and
 * gets away with because its sources are 8 kHz: there, the highest allowed
 * pitch is only six samples of lag away and there is no room for a false
 * short-lag hit. At 48 kHz that same window is thirty-four samples wide, any
 * lowpassed signal correlates well across it, and "first lag over 0.88 × best"
 * fires immediately — 27% of a first run came back at exactly sr/34 = 1412 Hz,
 * the search bound itself, against 150-450 Hz from an independent estimator.
 */
function frameF0(seg, sr) {
  const lo = Math.max(2, Math.floor(sr / F_HI)), hi = Math.ceil(sr / F_LO);
  const e0 = seg.reduce((s, v) => s + v * v, 0);
  if (e0 < 1e-9) return 0;
  const v = new Float64Array(hi + 2);
  let best = 0;
  for (let lag = lo; lag <= hi && lag < seg.length; lag++) {
    let c = 0, e = 0;
    for (let i = 0; i + lag < seg.length; i++) { c += seg[i] * seg[i + lag]; e += seg[i + lag] ** 2; }
    v[lag] = c / (Math.sqrt(e0 * e) + 1e-12);
    if (v[lag] > best) best = v[lag];
  }
  if (best < 0.55) return 0;
  for (let l = lo + 1; l < hi; l++) {
    if (v[l] >= best * 0.88 && v[l] > v[l - 1] && v[l] >= v[l + 1]) return sr / l;
  }
  return 0;
}

/** What fraction of a candidate is voiced, and at what median pitch. */
function voicing(seg, sr) {
  const frame = Math.round(sr * 0.045), hop = Math.round(sr * 0.015);
  const peak = seg.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  let looked = 0;
  const fs = [];
  for (let s = 0; s + frame <= seg.length; s += hop) {
    const win = seg.subarray(s, s + frame);
    let e = 0;
    for (let i = 0; i < frame; i++) e += win[i] * win[i];
    if (Math.sqrt(e / frame) < 0.15 * peak) continue;    // only judge where there is signal
    looked++;
    const f = frameF0(win, sr);
    if (f) fs.push(f);
  }
  if (!looked || fs.length < 2) return { ratio: 0, f0: 0 };
  const st = [...fs].sort((a, b) => a - b);
  return { ratio: fs.length / looked, f0: st[Math.floor(st.length / 2)] };
}

// -------------------------------------------------------------------- carve --

/** Hysteresis gate over the energy envelope. Returns [start, end] sample pairs. */
function events(x, sr) {
  const frame = Math.round(sr * 0.02), hop = Math.round(sr * 0.01);
  const env = envelope(x, frame, hop);
  if (env.length < 4) return [];
  const sorted = [...env].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.2)] || 1e-6;
  const peak = sorted[sorted.length - 1] || 1e-6;
  // Open well clear of the room, but never demand more than 22 dB under the
  // loudest thing in the file — otherwise a recording with one shout in it
  // rejects every ordinary meow around it.
  const open = Math.max(floor * 4, peak * 0.079);
  const close = open * 0.5;
  const spans = [];
  let on = -1;
  for (let i = 0; i < env.length; i++) {
    if (on < 0 && env[i] > open) on = i;
    else if (on >= 0 && env[i] < close) { spans.push([on, i]); on = -1; }
  }
  if (on >= 0) spans.push([on, env.length - 1]);

  const join = JOIN_SEC * sr / hop;
  const merged = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] - last[1] < join) last[1] = s[1];
    else merged.push([...s]);
  }
  return merged.map(([a, b]) => [
    Math.max(0, Math.round(a * hop - PAD_SEC * sr)),
    Math.min(x.length, Math.round(b * hop + frame + PAD_SEC * sr)),
  ]);
}

/** Copy out a span with short cosine fades, so nothing clicks on either edge. */
function carve(x, a, b, sr) {
  const out = Float32Array.prototype.slice.call(x, a, b);
  const f = Math.min(Math.round(FADE_SEC * sr), Math.floor(out.length / 2));
  for (let i = 0; i < f; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / f);
    out[i] *= g;
    out[out.length - 1 - i] *= g;
  }
  return out;
}

// --------------------------------------------------------------------- run --

if (!existsSync(SRC)) {
  console.error(`cut-meows.mjs: no ${SRC} — run tools/fetch-meows.mjs first`);
  process.exit(1);
}
rmSync(OUT, { recursive: true, force: true });      // derived; never merge two runs
mkdirSync(OUT, { recursive: true });

const files = readdirSync(SRC).filter((f) => f.endsWith('.wav')).sort();
const index = [];
const reasons = { short: 0, long: 0, unvoiced: 0, quiet: 0 };

for (const f of files) {
  const { sr, data } = readWav(join(SRC, f));
  let n = 0;
  for (const [a, b] of events(data, sr)) {
    const secs = (b - a) / sr;
    if (secs < MIN_SEC) { reasons.short++; continue; }
    if (secs > MAX_SEC) { reasons.long++; continue; }
    const seg = carve(data, a, b, sr);
    const peak = seg.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    if (peak < 0.02) { reasons.quiet++; continue; }
    const { ratio, f0 } = voicing(seg, sr);
    if (ratio < VOICED_MIN) { reasons.unvoiced++; continue; }
    const name = `${f.replace(/\.wav$/, '')}_${n++}.wav`;
    writeWav(join(OUT, name), [seg], sr);
    index.push({
      file: name, from: f, sr,
      at: +(a / sr).toFixed(3), seconds: +secs.toFixed(3),
      peak: +peak.toFixed(3), f0: +f0.toFixed(1), voiced: +ratio.toFixed(2),
    });
  }
}

writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n');

const f0s = index.map((r) => r.f0).sort((a, b) => a - b);
const secs = index.reduce((a, r) => a + r.seconds, 0);
console.log(`${files.length} recordings in, ${index.length} cuts out (${secs.toFixed(0)}s)`);
console.log(`  dropped: ${reasons.unvoiced} not voiced, ${reasons.short} too short, ` +
  `${reasons.long} too long, ${reasons.quiet} too quiet`);
if (f0s.length) {
  console.log(`  f0 ${Math.round(f0s[0])}-${Math.round(f0s[f0s.length - 1])} Hz, ` +
    `median ${Math.round(f0s[Math.floor(f0s.length / 2)])} Hz`);
}
console.log(`  -> ${OUT}`);
