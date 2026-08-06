/**
 * patterns.js — the six voices, as Strudel patterns.
 *
 * HOW THE PIECE IS COMPILED, in one sentence: we build one pattern per bar of
 * `score.js` and hand the whole list to Strudel's `cat`, which plays exactly one
 * of them per cycle. So `bars[17]` IS bar 17 of the piece — you can read it,
 * print it, or replace it, and nothing else has to agree with you.
 *
 * That is deliberately the dumbest structure that works. The alternative (one
 * clever pattern that computes what bar it is on) is shorter and much harder to
 * see into, and seeing into it is the point.
 *
 * Every sound here is SYNTHESISED — sine, sawtooth, triangle, and noise. There
 * are no sample files, so this repo works offline and every timbre is a line of
 * code you can change rather than a .wav you can't.
 *
 * The Strudel calls used in this file, and what they do, are all explained in
 * docs/LEARNING-STRUDEL.md. If a method here is a mystery, that's the file.
 */
import * as bus from '../bus.js';
import { LEVELS, MOTIF } from '../../score/score.js';

const STEPS = 16; // sixteenth notes per bar — the grid everything is written on

// --------------------------------------------------------------- helpers ----
const lerp = (a, b, x) => a + (b - a) * x;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Turn a list of step indices into mini-notation: [0,8] → "x ~ ~ ~ ... x ..." */
function grid(positions, token) {
  const set = new Set(positions);
  return Array.from({ length: STEPS }, (_, i) => (set.has(i) ? token : '~')).join(' ');
}

/** Same, but each position carries its own token (used for pitched voices). */
function pitchGrid(entries) {
  const map = new Map(entries);
  return Array.from({ length: STEPS }, (_, i) => (map.has(i) ? map.get(i) : '~')).join(' ');
}

/** Fractional MIDI as a string — superdough reads cents as decimals. */
const fmt = (n) => n.toFixed(3);

/** A deterministic 0..1 from a bar number, so "random" choices are repeatable. */
function jitter(bar, salt = 0) {
  const x = Math.sin(bar * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// ============================================================== the voices ==
// Each takes the musical context of one bar and returns a pattern (or null if
// this voice has nothing to say in this bar).

/**
 * Which sixteenths the kick lands on in a given bar. A step ladder off tension,
 * written out so you can see every rung.
 *
 * This is exported because THE PICTURE READS IT TOO — every kick puts a ring on
 * the water, and the visuals compute ring age from this function rather than
 * from a live event. That is what lets a still frame at any time be exact:
 * `tools/storyboard.mjs` renders frames with no audio running at all.
 */
export function kickPositions({ T, bar }) {
  const positions =
    T < 0.22 ? [0] :
    T < 0.45 ? [0, 8] :
    T < 0.70 ? [0, 8, 14] :
               [0, 4, 8, 12];

  // At full tension, a 16th pickup before the downbeat every other bar.
  if (T > 0.85 && bar % 2 === 1) positions.push(15);
  return positions;
}

/**
 * Seconds since the most recent kick at time `t`, looking back across the bar
 * line so the answer is right on a downbeat too. Returns a large number if the
 * kick voice is not in this section at all.
 */
export function timeSinceKick(t) {
  const barLen = bus.BAR_SECONDS;
  const stepLen = barLen / STEPS;
  for (let back = 0; back <= 1; back++) {
    const bar = Math.floor(t / barLen) - back;
    if (bar < 0) break;
    const ctx = contextForBar(bar);
    if (!ctx.voices.includes('pulse')) continue;
    const hits = kickPositions(ctx)
      .map((step) => bar * barLen + step * stepLen)
      .filter((time) => time <= t);
    if (hits.length) return t - Math.max(...hits);
  }
  return 999;
}

/**
 * surf — the wash. One long noise swell per bar, filter opening with tension.
 * It is the only voice that plays in every section, which is what makes the
 * sparse sections feel like part of the same piece rather than a stop.
 */
function surf({ s }, { T, brightness, t }) {
  const wander = bus.drift(t, 1.3);
  return s('brown')
    .attack(0.9)
    .decay(0.4)
    .sustain(0.7)
    .release(1.4)
    .lpf(Math.round(lerp(320, 2400, T) * (1 + wander * 0.15)))
    .hpf(90)
    .pan(0.5 + wander * 0.2)
    .gain(LEVELS.surf * lerp(0.7, 1.0, brightness))
    .room(0.5)
    .roomsize(6)
    .orbit(3);
}

/**
 * pulse — the kick. A low sine thump with a noise transient glued to the front,
 * because a sine alone has no click and reads as a bump rather than a hit.
 * Density is a step ladder off tension, written out so you can see every rung.
 */
function pulse({ note, s, stack }, ctx) {
  const positions = kickPositions(ctx);

  const body = note(grid(positions, fmt(31))) // ~B0
    .s('sine')
    .attack(0.001)
    .decay(0.20)
    .sustain(0)
    .release(0.03)
    .lpf(150)
    .gain(LEVELS.pulse)
    .orbit(1);

  const click = s(grid(positions, 'white'))
    .attack(0.001)
    .decay(0.012)
    .sustain(0)
    .hpf(1800)
    .gain(LEVELS.pulse * 0.22)
    .orbit(1);

  return stack(body, click);
}

/**
 * tick — the hats. The grid you feel. Spacing halves as tension rises: every
 * 4th sixteenth, then every 2nd, then all of them.
 */
function tick({ s }, { T, bar }) {
  const every = T < 0.45 ? 4 : T < 0.78 ? 2 : 1;
  const positions = [];
  for (let i = 0; i < STEPS; i += every) {
    // Thin the busiest setting slightly so it breathes instead of buzzing.
    if (every === 1 && i % 4 !== 0 && jitter(bar, i) < 0.25) continue;
    positions.push(i);
  }

  return s(grid(positions, 'white'))
    .attack(0.001)
    .decay(0.022)
    .sustain(0)
    .hpf(6800)
    .gain(LEVELS.tick * lerp(0.6, 1.0, T))
    .pan(0.55)
    .room(0.18)
    .orbit(1);
}

/**
 * bass — root on the downbeat, one passing tone late in the bar. The passing
 * tone is chosen from the current mode, so the bass gets brighter exactly when
 * the harmony does without anyone coordinating it.
 */
function bass({ note }, { mode, T, bar, t }) {
  const passing = [4, 3, 5][Math.floor(jitter(bar, 2) * 3)];
  const entries = [
    [0, fmt(bus.degreeToMidi(mode, 0, -1))],
    [10, fmt(bus.degreeToMidi(mode, passing, -1))],
  ];
  if (T > 0.7) entries.push([6, fmt(bus.degreeToMidi(mode, 0, -1))]);

  return note(pitchGrid(entries))
    .s('sawtooth')
    .attack(0.006)
    .decay(0.28)
    .sustain(0.35)
    .release(0.18)
    .lpf(Math.round(lerp(260, 1100, T) + bus.drift(t, 2.1) * 80))
    .resonance(7)
    .gain(LEVELS.bass)
    .orbit(2);
}

/**
 * air — the held chord. Three notes of the mode, a fourth voice added when the
 * piece is pushing. Long attack and release so it never has an onset you can
 * point at; this is the voice that makes a section feel like weather.
 */
function air({ note }, { mode, T, brightness, t }) {
  const degrees = T > 0.7 ? [0, 2, 4, 6] : [0, 2, 4];
  const chord = degrees.map((d) => fmt(bus.degreeToMidi(mode, d, 1))).join(',');

  return note(pitchGrid([[0, `[${chord}]`]]))
    .s('sawtooth')
    .attack(1.2)
    .decay(0.6)
    .sustain(0.75)
    .release(2.2)
    .lpf(Math.round(lerp(700, 3600, brightness) + bus.drift(t, 3.7) * 200))
    .gain(LEVELS.air * lerp(0.8, 1.0, brightness))
    .room(0.6)
    .roomsize(8)
    .pan(0.45)
    .orbit(3);
}

/**
 * bell — the tune. States MOTIF from score.js, one degree per bar, so the motif
 * takes eight bars to say. It is the last voice to arrive and the one left
 * holding the melody when the drums drop out.
 */
function bell({ note }, { mode, barInSection, brightness }) {
  const degree = MOTIF[barInSection % MOTIF.length];
  if (degree === null) return null; // a rest in the motif is a real rest

  return note(pitchGrid([[0, fmt(bus.degreeToMidi(mode, degree, 2))]]))
    .s('triangle')
    .attack(0.004)
    .decay(0.9)
    .sustain(0.08)
    .release(1.6)
    .lpf(Math.round(lerp(2200, 6000, brightness)))
    .gain(LEVELS.bell)
    .room(0.75)
    .roomsize(11)
    .pan(0.6)
    .orbit(3);
}

const BUILDERS = { surf, pulse, tick, bass, air, bell };

// ============================================================== the compiler ==

/** The musical context of one bar, read off the bus. Pure — no Strudel here. */
export function contextForBar(bar) {
  const t = (bar + 0.5) * bus.BAR_SECONDS; // sample mid-bar
  const at = bus.sectionAt(t);
  const brightness = bus.brightnessAt(t);
  return {
    bar,
    t,
    T: bus.tensionAt(t),
    brightness,
    mode: bus.modeAt(brightness),
    section: at.section,
    barInSection: bar - at.startBar,
    voices: at.section.voices,
  };
}

/**
 * Compile the whole piece: one pattern per bar, played in order by `cat`.
 * `strudel` is the handful of Strudel functions we use, passed in rather than
 * imported so this file stays testable in plain node (see test/score.mjs).
 */
export function buildPiece(strudel) {
  const { stack, cat, silence } = strudel;
  const bars = [];

  for (let bar = 0; bar < bus.TOTAL_BARS; bar++) {
    const ctx = contextForBar(bar);
    const layers = [];

    for (const id of ctx.voices) {
      if (bus.params.mute[id]) continue;
      const build = BUILDERS[id];
      if (!build) {
        console.warn(`[patterns] score names a voice with no builder: ${id}`);
        continue;
      }
      const pattern = build(strudel, ctx);
      if (pattern) layers.push(pattern);
    }

    bars.push(layers.length ? stack(...layers) : silence);
  }

  return cat(...bars);
}

/** Names of every voice the score can use — kept honest by test/score.mjs. */
export const IMPLEMENTED_VOICES = Object.keys(BUILDERS);
