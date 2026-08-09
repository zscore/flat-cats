/**
 * align.mjs — bend the score onto the performance.
 *
 *   node tools/midi.mjs
 *   node tools/align.mjs --wav=blackwood_17_notes_trimmed.wav --beats=out/tempo_beats.txt
 *   node tools/align.mjs ... --map=linear --click=out/align_click_linear.wav
 *
 * The MIDI is a flat 90 BPM and the recording is not. Over 165 seconds the two
 * drift by up to six seconds, which is far past the point where a cat singing
 * the score has anything to do with the cat on the record.
 *
 * TWO SIGNALS, DOING DIFFERENT JOBS. Neither is enough alone:
 *
 *   ANCHORS — where in the score we are. Every onset carries up to four measured
 *   17-EDO degrees and every MIDI attack is a set of degrees on the same grid,
 *   so the two can be matched on pitch content by DTW. This is the only signal
 *   that knows *which* chord is which; a beat grid cannot tell you that. But it
 *   is sparse — 87 near-perfect matches, with holes up to 18 seconds.
 *
 *   BEATS — how fast we are going between anchors. A beat index is a musical
 *   clock read off the performance: evenly spaced in music, unevenly in seconds.
 *   So the map runs score seconds → beat index (straight line between anchors) →
 *   recording seconds (through the grid), and the performance's rubato is
 *   carried across every hole for free. Measured against held-out anchors with
 *   the neighbours deleted to force a hole, this halves the error of a straight
 *   line at 6 s (72 → 24 ms) and 12 s (176 → 131 ms), and is about a coin flip
 *   at 20 s. Supporting number: the grid runs 1.002 beats per score-eighth, so
 *   madmom and the score agree on musical duration to 0.2%.
 *
 * WHICH MAP — AN OPEN QUESTION. `--map=linear` joins the anchors with straight
 * lines in seconds and ignores the grid. The two disagree and I could not settle
 * it from numbers: the held-out test above prefers the beats, but "how many
 * beats land within 50 ms of a warped attack" prefers linear, 75.1% to 68.2%.
 * Both maps are built from onset data, so neither metric is fully independent.
 * Render both click tracks and listen; that is what decides it.
 *
 * WHAT THIS IS NOT. The beat grid is a best guess — madmom's own confidence
 * never exceeds 0.5 anywhere in this track. Nothing here should be described as
 * beat-locked. It is a score dragged onto a performance by its pitches, with a
 * plausible pulse filling the gaps.
 *
 * The beat file has to be named explicitly. It comes from tempo.py, which is
 * Python in another venv and cannot be called from here, so it arrives as a file
 * — and out/ is derived and disposable, so this stage will not go looking in
 * there on its own. Hand it a path.
 *
 * Output is public/song/notes.json rewritten in place, with each note's original
 * time kept as `tScore`. Don't run this and you get the flat 90 BPM version
 * back; song.js reads `t` either way and needs no changes.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { writeWav } from './wav.mjs';
import { readMono, onsetReport } from './onset-core.mjs';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};

const EDO = 17;

// DTW step costs. Skipping a score attack is cheap — the detector only fires on
// about half of them, so most of the score legitimately has no onset. Skipping a
// *detected* onset is expensive, because a real attack in the audio with no
// score event under it usually means the path has gone wrong.
const SKIP_SCORE = 0.3;
const SKIP_ONSET = 1.2;

// A fundamental one octave from a score degree is most likely the harmonic
// picker having taken the wrong member of the series, so it counts, but not
// fully. See the octave guard in onset-core.mjs.
const OCTAVE_CREDIT = 0.6;

// How well an onset's pitches must match a chord for that match to steer the
// map. 0 is every measured pitch present in the chord. This is deliberately
// strict: a wrong anchor bends time, and there are plenty of them.
const ANCHOR_COST = 0.05;

// An anchor whose own neighbours predict it this badly is not an anchor.
const MAX_RESIDUAL = 0.5; // seconds

const MIN_STEP = 1e-6;    // strict monotonicity in both coordinates
const MIN_DUR = 0.02;     // no note warps to nothing

// ------------------------------------------------------------------ inputs --

/** Beat times from tempo.py — either tempo_beats.txt or tempo_beats.csv. */
function readBeats(path) {
  const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/);
  const head = lines[0].toLowerCase();
  const col = head.startsWith('beat,') ? head.split(',').indexOf('time_s') : -1;
  const rows = col >= 0 ? lines.slice(1) : lines;
  const beats = rows
    .map((l) => Number(col >= 0 ? l.split(',')[col] : l.trim()))
    .filter((x) => Number.isFinite(x));
  for (let i = 1; i < beats.length; i++) {
    if (beats[i] <= beats[i - 1]) throw new Error(`${path}: beat times are not increasing at line ${i}`);
  }
  if (beats.length < 2) throw new Error(`${path}: need at least two beat times`);
  return beats;
}

/** The score's notes collapsed to one event per attack time. */
function attacks(notes) {
  const byTime = new Map();
  for (const n of notes) {
    const t = +n.t.toFixed(4);
    if (!byTime.has(t)) byTime.set(t, new Set());
    byTime.get(t).add(n.degree);
  }
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, degrees]) => ({ t, degrees }));
}

// ------------------------------------------------------------------- match --

/** 0 = every pitch measured in this onset is in that chord, 1 = none of them. */
function chordCost(onset, degrees) {
  let total = 0;
  let hit = 0;
  for (const n of onset.notes) {
    const w = 10 ** (n.db / 20); // db is relative to the loudest partial
    total += w;
    if (degrees.has(n.degree)) hit += w;
    else if (degrees.has(n.degree + EDO) || degrees.has(n.degree - EDO)) hit += OCTAVE_CREDIT * w;
  }
  return total > 0 ? 1 - hit / total : 1;
}

/**
 * Monotone alignment of onsets to score attacks, on pitch content alone.
 *
 * No time prior of any kind: the map that comes out is inferred from what the
 * chords are, not from where anyone expected them. That is what makes the
 * result evidence rather than an assumption restated.
 */
function matchChords(onsets, events) {
  const N = onsets.length;
  const M = events.length;
  const back = new Uint8Array((N + 1) * (M + 1));
  let prev = new Float64Array(M + 1);
  let cur = new Float64Array(M + 1);

  for (let j = 1; j <= M; j++) {
    prev[j] = prev[j - 1] + SKIP_SCORE;
    back[j] = 2;
  }
  for (let i = 1; i <= N; i++) {
    const row = i * (M + 1);
    cur[0] = prev[0] + SKIP_ONSET;
    back[row] = 3;
    for (let j = 1; j <= M; j++) {
      let best = prev[j - 1] + chordCost(onsets[i - 1], events[j - 1].degrees);
      let step = 1;
      const skipScore = cur[j - 1] + SKIP_SCORE;
      if (skipScore < best) { best = skipScore; step = 2; }
      const skipOnset = prev[j] + SKIP_ONSET;
      if (skipOnset < best) { best = skipOnset; step = 3; }
      cur[j] = best;
      back[row + j] = step;
    }
    [prev, cur] = [cur, prev];
  }

  const pairs = [];
  for (let i = N, j = M; i > 0 || j > 0; ) {
    const step = back[i * (M + 1) + j];
    if (step === 1) pairs.push([--i, --j]);
    else if (step === 2) j--;
    else i--;
  }
  return pairs.reverse();
}

// -------------------------------------------------------------------- warp --

/** Piecewise linear through (xs, ys), extrapolating off either end. */
function interp(x, xs, ys) {
  let k = 0;
  let hi = xs.length - 1;
  while (k < hi) {
    const mid = (k + hi) >> 1;
    if (xs[mid] < x) k = mid + 1;
    else hi = mid;
  }
  k = Math.max(1, Math.min(k, xs.length - 1));
  const x0 = xs[k - 1], x1 = xs[k], y0 = ys[k - 1], y1 = ys[k];
  return x1 === x0 ? y0 : y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
}

/**
 * Score seconds → recording seconds, routed through the beat grid.
 *
 * Anchors are first put into beat index rather than seconds, which is the whole
 * trick: interpolating linearly in beat index means "constant tempo ratio",
 * and converting back through the grid re-applies the performance's own rubato.
 */
function buildWarp(anchors, beats, useBeats = true) {
  const index = beats.map((_, i) => i);
  const toBeat = (rec) => interp(rec, beats, index);
  const toRec = (pos) => interp(pos, index, beats);

  // Strictly increasing in both coordinates, or the map is not a function.
  const rising = [];
  for (const a of anchors) {
    const pos = toBeat(a.rec);
    const last = rising[rising.length - 1];
    if (last && (a.score <= last.score + MIN_STEP || pos <= last.pos + MIN_STEP)) continue;
    rising.push({ ...a, pos });
  }

  // Then drop any anchor its own immediate neighbours cannot predict. An anchor
  // that disagrees with both sides is a chord matched in the wrong place, and
  // one of those drags every note between it and its neighbours with it.
  const kept = rising.filter((a, i) => {
    if (i === 0 || i === rising.length - 1) return true;
    const l = rising[i - 1], r = rising[i + 1];
    const guess = toRec(interp(a.score, [l.score, r.score], [l.pos, r.pos]));
    return Math.abs(guess - a.rec) <= MAX_RESIDUAL;
  });
  if (kept.length < 2) throw new Error(`only ${kept.length} anchors survived — cannot build a map`);

  // `linear` is the same map with the beat grid taken out — anchors joined by
  // straight lines in seconds. Kept as a switch rather than deleted because the
  // two disagree and only a listener can settle it. See --map in the header.
  const xs = kept.map((a) => a.score);
  const ys = kept.map((a) => (useBeats ? a.pos : a.rec));
  const toSeconds = useBeats ? toRec : (y) => y;
  return {
    kept,
    dropped: anchors.length - kept.length,
    warp: (t) => toSeconds(interp(t, xs, ys)),
  };
}

// ------------------------------------------------------ something to hear --

/**
 * The recording with a tick on every warped score attack — the review artifact.
 * A table of timestamps cannot be checked by a human; a tick that flams against
 * the note it claims to be on can be heard by anyone in one pass.
 *
 * Two pitches, because the two halves of this deserve to be judged separately:
 * the high tick is an attack the pitch match measured, the low tick is one the
 * beat grid guessed at between anchors.
 */
function clickTrack(chans, sr, marks) {
  const dur = Math.round(0.03 * sr);
  const tone = (hz) => Float64Array.from({ length: dur }, (_, i) =>
    Math.sin((2 * Math.PI * hz * i) / sr) * Math.exp((-160 * i) / sr));
  const clicks = { anchor: tone(2400), guess: tone(1200) };

  const out = chans.map((c) => Float32Array.from(c, (x) => x * 0.7));
  for (const m of marks) {
    const click = clicks[m.kind];
    const s = Math.round(m.t * sr);
    if (s < 0) continue;
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

const WAV = arg('wav', '');
const BEATS = arg('beats', '');
const SCORE = resolve(arg('score', 'public/song/notes.json'));
const OUT = resolve(arg('out', SCORE));
const CLICK = resolve(arg('click', 'out/align_click.wav'));
const MAP = arg('map', 'beat'); // 'beat' routes through the grid, 'linear' does not

if (!WAV || !BEATS) {
  console.error('align.mjs: pass --wav=<recording.wav> and --beats=<tempo_beats.txt>\n' +
    '  the beat grid comes from tempo.py and has to be named — out/ is derived,\n' +
    '  and this stage does not read from it uninvited.');
  process.exit(1);
}

const score = JSON.parse(readFileSync(SCORE, 'utf8'));

// Running this twice must not warp an already-warped score. `tScore` is the
// score's own time and survives every pass, so rewind to it before starting.
if (score.align) {
  for (const n of score.notes) {
    n.t = n.tScore ?? n.t;
    n.d = n.dScore ?? n.d;
  }
  console.log(`${SCORE} was already aligned to ${score.align.wav} — rewinding to the score's own times`);
}

const events = attacks(score.notes);
const beats = readBeats(resolve(BEATS));

const { sr, chans, frames, mono } = readMono(WAV);
console.log(`${WAV}: ${(frames / sr).toFixed(1)}s   ${SCORE}: ${score.count} notes, ${events.length} attacks, ${score.seconds}s`);
console.log(`${beats.length} beats from ${BEATS}  (${beats[0].toFixed(2)}s .. ${beats[beats.length - 1].toFixed(2)}s)`);

// The score's own reference, not a fresh fit: both sides have to be on one grid
// for a degree to mean the same thing in each.
const { onsets } = onsetReport(mono, sr, { ref: score.tuning.ref });
const pairs = matchChords(onsets, events);
const matched = pairs.map(([i, j]) => ({
  rec: onsets[i].t,
  score: events[j].t,
  cost: chordCost(onsets[i], events[j].degrees),
}));

const anchors = matched.filter((m) => m.cost < ANCHOR_COST);
if (MAP !== 'beat' && MAP !== 'linear') throw new Error(`--map must be 'beat' or 'linear', got '${MAP}'`);
const { kept, dropped, warp } = buildWarp(anchors, beats, MAP === 'beat');

const scoreSeconds = +Math.max(0, ...score.notes.map((n) => n.t + n.d)).toFixed(3);

const notes = score.notes
  .map((n) => {
    const t = warp(n.t);
    return {
      ...n,
      t: +t.toFixed(4),
      d: +Math.max(MIN_DUR, warp(n.t + n.d) - t).toFixed(4),
      tScore: n.t,
      dScore: n.d,
    };
  })
  .sort((a, b) => a.t - b.t);

const seconds = +Math.max(0, ...notes.map((n) => n.t + n.d)).toFixed(3);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  ...score,
  seconds,
  align: {
    wav: WAV, beats: BEATS, map: MAP,
    onsets: onsets.length, matched: matched.length,
    anchors: kept.length, droppedAnchors: dropped,
    anchorCost: ANCHOR_COST,
    // Every point the map is pinned to, so the warp can be audited without
    // re-running the match. Between these it is the beat grid's guess.
    pins: kept.map((a) => ({ score: a.score, rec: +a.rec.toFixed(3), cost: +a.cost.toFixed(3) })),
  },
  notes,
}));

// ------------------------------------------------------------------ report --

const anchorAt = new Set(kept.map((a) => +a.score.toFixed(4)));
const marks = events.map((e) => ({ t: warp(e.t), kind: anchorAt.has(+e.t.toFixed(4)) ? 'anchor' : 'guess' }));
mkdirSync(dirname(CLICK), { recursive: true });
const w = writeWav(CLICK, clickTrack(chans, sr, marks), sr);

const gaps = kept.slice(1).map((a, i) => [a.rec - kept[i].rec, kept[i].rec, a.rec]).sort((a, b) => b[0] - a[0]);
const shifts = notes.map((n) => n.t - n.tScore).sort((a, b) => a - b);
const nearest = (t, xs) => xs.reduce((best, x) => Math.min(best, Math.abs(x - t)), Infinity);
const warped = marks.map((m) => m.t);
const onBeat = beats.filter((b) => nearest(b, warped) <= 0.05).length;

console.log(`\n${matched.length} onsets matched to attacks, ${anchors.length} under cost ${ANCHOR_COST}` +
  `, ${dropped} dropped as outliers -> ${kept.length} anchors`);
console.log(`anchor spacing: median ${gaps[gaps.length >> 1][0].toFixed(2)}s, ` +
  `widest ${gaps.slice(0, 3).map(([g, a, b]) => `${g.toFixed(1)}s at ${a.toFixed(0)}-${b.toFixed(0)}s`).join(', ')}`);
console.log(`map '${MAP}': score ${scoreSeconds}s -> ${seconds}s   note shift: ` +
  `median ${shifts[shifts.length >> 1].toFixed(2)}s, range ${shifts[0].toFixed(2)}..${shifts[shifts.length - 1].toFixed(2)}s`);
console.log(`beats landing within 50 ms of a warped attack: ${((onBeat / beats.length) * 100).toFixed(1)}%`);
console.log(`\nwrote ${OUT}`);
console.log(`wrote ${w.seconds.toFixed(1)}s -> ${CLICK}  <- listen to this: high tick = measured, low tick = guessed`);
