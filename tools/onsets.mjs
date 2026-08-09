/**
 * onsets.mjs — run onset-core.mjs over a wav and write down what it found.
 *
 *   node tools/onsets.mjs --in=song.wav --click=out/onsets_click.wav
 *
 * The measurement itself — flux, fundamentals, formants, the 17-EDO fit — lives
 * in onset-core.mjs, so that another stage can call for the same numbers instead
 * of reading the report back out of out/. What is left here is the parts that
 * only a person at a terminal wants: the JSON, the click track, and the table.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { writeWav } from './wav.mjs';
import { readMono, onsetReport } from './onset-core.mjs';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};

// ------------------------------------------------------- something to hear --

/**
 * The source with a tick on every onset. This is the review artifact: a table of
 * timestamps cannot be checked by a human, and a click that flams against the
 * music can be heard by anyone in one pass.
 */
function clickTrack(chans, sr, onsets) {
  const dur = Math.round(0.03 * sr);
  const click = new Float64Array(dur);
  for (let i = 0; i < dur; i++) {
    // 1.6 kHz, decayed to nothing across the 30 ms — short enough that a click
    // landing 10 ms late reads as a flam rather than as part of the note.
    click[i] = Math.sin((2 * Math.PI * 1600 * i) / sr) * Math.exp((-160 * i) / sr);
  }
  const out = chans.map((c) => Float32Array.from(c, (x) => x * 0.7));
  for (const o of onsets) {
    const s = Math.round(o.t * sr);
    for (let i = 0; i < dur && s + i < out[0].length; i++) {
      for (const c of out) c[s + i] += click[i] * 0.35;
    }
  }
  let peak = 0;
  for (const c of out) for (const x of c) peak = Math.max(peak, Math.abs(x));
  if (peak > 0.99) for (const c of out) for (let i = 0; i < c.length; i++) c[i] *= 0.99 / peak;
  return out;
}

// --------------------------------------------------------------------- run --

const IN = arg('in', '');
const OUT = resolve(arg('out', 'out/onsets.json'));
const CLICK = resolve(arg('click', 'out/onsets_click.wav'));
const REF = arg('ref', 'auto');   // 'auto' fits the grid to the music; or give a Hz
const DELTA = Number(arg('delta', 1.8));
const K = Number(arg('k', 4));
const SECS = Number(arg('secs', 0));

if (!IN || !existsSync(IN)) {
  console.error('onsets.mjs: pass --in=<song.wav>  (16- or 24-bit PCM WAV)');
  process.exit(1);
}

const { sr, channels, frames, chans, mono } = readMono(IN, SECS);
console.log(`${IN}: ${(frames / sr).toFixed(1)}s, ${channels}ch @ ${sr} Hz`);

const report = onsetReport(mono, sr, { delta: DELTA, k: K, ref: REF });
const { picked, fit, onsets: events, params } = report;
console.log(`${picked.length} onsets from ${report.frames} frames ` +
  `(delta ${DELTA}, ${((params.HOP / sr) * 1000).toFixed(1)} ms resolution)`);

console.log(REF === 'auto'
  ? `17-EDO grid fitted to ${events.flatMap((e) => e.notes).length} pitches: degree 0 = ${fit.ref.toFixed(2)} Hz  ` +
    `(fit ${fit.R.toFixed(3)}, ±${fit.cents.toFixed(0)} cents rms — 1.000 would be a perfect grid)`
  : `17-EDO grid as given: degree 0 = ${fit.ref.toFixed(2)} Hz`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  file: IN, sr, seconds: +(frames / sr).toFixed(2),
  params,
  tuning: { ref: +fit.ref.toFixed(3), edo: 17, fit: fit.R, centsRms: fit.cents },
  count: events.length, onsets: events,
}, null, 1));

mkdirSync(dirname(CLICK), { recursive: true });
const w = writeWav(CLICK, clickTrack(chans, sr, picked), sr);

const SHOW = Number(arg('show', 24));
console.log(`\n    time     IOI  n  fundamentals (Hz / 17-EDO deg ±cents)        formants (Hz)`);
let prev = null;
for (const e of events.slice(0, SHOW)) {
  const ioi = prev === null ? '   — ' : (e.t - prev).toFixed(2).padStart(5);
  prev = e.t;
  const notes = e.notes.map((n) => `${n.hz.toFixed(0)}/${n.degree}${n.cents >= 0 ? '+' : ''}${n.cents}`).join(' ');
  console.log(`${e.t.toFixed(2).padStart(8)}  ${ioi}  ${e.notes.length}  ${notes.padEnd(42)} ${e.formants.map((f) => f.hz).join(' ')}`);
}
if (events.length > SHOW) console.log(`… ${events.length - SHOW} more in ${OUT}`);

const iois = events.slice(1).map((e, i) => e.t - events[i].t).sort((a, b) => a - b);
const polys = events.map((e) => e.notes.length).sort((a, b) => a - b);
console.log(`\nmedian IOI ${iois.length ? iois[iois.length >> 1].toFixed(3) : '—'}s   ` +
  `median notes/onset ${polys.length ? polys[polys.length >> 1] : '—'}   ` +
  `onsets with none ${events.filter((e) => !e.notes.length).length}`);
console.log(`wrote ${OUT}\nwrote ${w.seconds.toFixed(1)}s → ${CLICK}  ← listen to this`);
