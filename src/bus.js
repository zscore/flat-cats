/**
 * bus.js — the score, turned into signals of time.
 *
 * This is the only place that knows how `score/score.js` becomes numbers. Both
 * renderers read from here and NEVER from each other:
 *
 *     music   = M(bus, t)
 *     picture = P(bus, t)          never P(audio)
 *
 * Why that matters: the picture is a pure function of time, so it can be
 * rendered at any t without playing a note. That is what makes the storyboard
 * and the studio scrubber possible — see tools/storyboard.mjs.
 *
 * Everything here is derived. If a number looks wrong, the fix is almost always
 * in score/score.js, not in this file.
 */
import { BPM, BEATS_PER_BAR, SECTIONS, MODES, ROOT_MIDI } from '../score/score.js';

// ------------------------------------------------------------------ clock ----
export const CPS = BPM / 60 / BEATS_PER_BAR; // cycles (= bars) per second
export const BAR_SECONDS = 1 / CPS;

// Where each section starts, precomputed once. Index i of `SECTION_STARTS` is
// the bar section i begins on; the last entry is the total length.
export const SECTION_STARTS = SECTIONS.reduce(
  (acc, s) => [...acc, acc[acc.length - 1] + s.bars],
  [0],
);
export const TOTAL_BARS = SECTION_STARTS[SECTION_STARTS.length - 1];
export const TOTAL_SECONDS = TOTAL_BARS * BAR_SECONDS;

// A section change snaps tension (a drop should be sharp — that is the point of
// a drop) but EASES brightness and colour across this many bars, because the
// camera height and the water colour both come off brightness and a hard cut
// there reads as a glitch rather than as a gesture. See docs/decisions.md D2.
export const BLEND_BARS = 2;

// ------------------------------------------------------------------- time ----
// `now()` has three modes, in priority order:
//   1. scrubbed  — the studio is holding the playhead at a fixed t
//   2. running   — an audio clock was handed to start()
//   3. stopped   — 0
let clock = null;
let anchor = 0;   // clock reading that corresponds to t = offset
let offset = 0;   // piece-time at that anchor
let scrub = null;

/** Pin t=`atSeconds` to right now, using `clockFn` (usually the audio clock). */
export function start(clockFn, atSeconds = 0) {
  clock = clockFn;
  anchor = clockFn();
  offset = atSeconds;
  scrub = null;
}

/** Freeze the playhead at an absolute time — how the studio and storyboard look
 *  at a moment without playing it. Pass `null` to release back to the clock. */
export function setScrub(t) {
  scrub = t;
}

export function isScrubbing() {
  return scrub !== null;
}

export function now() {
  if (scrub !== null) return scrub;
  if (!clock) return 0;
  return clock() - anchor + offset;
}

// --------------------------------------------------------------- sections ----
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, x) => a + (b - a) * x;
const smoothstep = (x) => x * x * (3 - 2 * x);

/**
 * Which section is sounding at time `t`, and how far into it we are.
 * Past the end of the piece it holds on the last section (so a still frame
 * taken at t = TOTAL_SECONDS is the final image, not a crash).
 */
export function sectionAt(t) {
  const bar = clamp(t / BAR_SECONDS, 0, TOTAL_BARS - 1e-6);
  let i = 0;
  while (i < SECTIONS.length - 1 && bar >= SECTION_STARTS[i + 1]) i++;
  const startBar = SECTION_STARTS[i];
  const progress = (bar - startBar) / SECTIONS[i].bars;
  return {
    index: i,
    section: SECTIONS[i],
    name: SECTIONS[i].name,
    progress: clamp(progress, 0, 1),
    startBar,
    startTime: startBar * BAR_SECONDS,
    bar,
  };
}

/**
 * Read a per-section [start, end] pair as a signal.
 * `blend` eases the jump at the section edge over BLEND_BARS; without it the
 * value steps. Tension does not blend, brightness does.
 */
function walk(t, key, blend) {
  const { index, section, progress, startBar } = sectionAt(t);
  const value = lerp(section[key][0], section[key][1], progress);
  if (!blend || index === 0) return value;

  const barsIn = t / BAR_SECONDS - startBar;
  if (barsIn >= BLEND_BARS) return value;

  // Inside the blend window: mix from where the previous section left off.
  const prev = SECTIONS[index - 1];
  return lerp(prev[key][1], value, smoothstep(clamp(barsIn / BLEND_BARS, 0, 1)));
}

/** 0..1 — how hard the piece is pushing. Steps at section edges, deliberately. */
export function tensionAt(t) {
  return clamp(walk(t, 'tension', false), 0, 1);
}

/** 0..1 — how glad the harmony is AND how high the camera sits. Eased. */
export function brightnessAt(t) {
  return clamp(walk(t, 'brightness', true), 0, 1);
}

/** The mode sounding at brightness `b`, off the ladder in score.js. */
export function modeAt(b) {
  const i = clamp(Math.floor(b * MODES.length), 0, MODES.length - 1);
  return MODES[i];
}

/** Scale degree → MIDI note. Degrees past 6 wrap into the next octave. */
export function degreeToMidi(mode, degree, octave = 0) {
  const n = mode.steps.length;
  const wrapped = ((degree % n) + n) % n;
  const oct = Math.floor(degree / n) + octave;
  return ROOT_MIDI + mode.steps[wrapped] + 12 * oct;
}

/** Which voices are playing at `t`, as a Set of voice ids. */
export function voicesAt(t) {
  return new Set(sectionAt(t).section.voices);
}

export function isVoiceOn(t, id) {
  return sectionAt(t).section.voices.includes(id);
}

// ----------------------------------------------------------------- colour ----
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/** Water and sky at `t`, eased across section edges the same way brightness is. */
export function colorsAt(t) {
  const { index, startBar, section } = sectionAt(t);
  const water = hexToRgb(section.water);
  const sky = hexToRgb(section.sky);
  if (index === 0) return { water, sky };

  const barsIn = t / BAR_SECONDS - startBar;
  if (barsIn >= BLEND_BARS) return { water, sky };

  const k = smoothstep(clamp(barsIn / BLEND_BARS, 0, 1));
  const prev = SECTIONS[index - 1];
  const pw = hexToRgb(prev.water);
  const ps = hexToRgb(prev.sky);
  return {
    water: water.map((c, i) => lerp(pw[i], c, k)),
    sky: sky.map((c, i) => lerp(ps[i], c, k)),
  };
}

// ------------------------------------------------------------------ drift ----
// One slow unrepeating wander, so held values are never quite a constant. Sum of
// a few sines with irrational-ish period ratios — cheap, deterministic, and it
// needs no seed bookkeeping. Roughly -1..1.
export function drift(t, phase = 0) {
  return (
    Math.sin(t * 0.0731 + phase) * 0.55 +
    Math.sin(t * 0.1913 + phase * 1.7) * 0.30 +
    Math.sin(t * 0.4370 + phase * 2.3) * 0.15
  );
}

// ------------------------------------------------------------------ events ----
// The music publishes every note here BEFORE it sounds, stamped with the audio
// clock time it will land on. The picture queues them and fires on that stamp,
// so a ripple is exactly on the kick rather than a frame behind it.
const subscribers = new Set();

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function publish(evt) {
  for (const fn of subscribers) {
    try {
      fn(evt);
    } catch (err) {
      console.error('[bus] subscriber threw', err);
    }
  }
}

// ------------------------------------------------------------------ params ----
// Live knobs. Not part of the score — these are for poking while it plays, and
// nothing here is remembered. Anything you want to KEEP goes in score.js.
export const params = {
  master: 0.9,
  mute: {},       // { bell: true } to drop a voice live
};
