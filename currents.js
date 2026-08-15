/**
 * currents.js — the courses that are not the river.
 *
 * Split out of river.js, which was at its size ceiling and where all the growth
 * was happening in one half of it. The seam is the honest one: river.js owns the
 * river — the wave, the right angles, the meander — and this owns everything
 * swimming alongside it. Between them something is always going the other way.
 *
 * The one rule the whole file is built on: **nothing here has a coordinate typed
 * into it.** Every current is placed off the river's own geometry — a lead past
 * where the meander ends, a drop from the line the meander leaves on, a start
 * level with the floor of the right angles. Move the river and they follow.
 * That is why makeCurrents takes the river and its landmarks rather than
 * importing them: the placement is a function of the shape, not a copy of it.
 *
 * What is here, in the order the frame meets them:
 *
 *   under    the early one, and the first thing on screen — it reaches further
 *            left than the river's own source. Tight and nearly straight in the
 *            shallow water under the right angles, with one stretch of double
 *            squiggle where that straightness would otherwise go on too long,
 *            then opening into long swings under the wave where there is room
 *   counter  the late one, set into the bends of the meander without touching
 *
 * Not touching is the one thing here with no bound behind it. Everything else is
 * guaranteed by construction — no self-crossing because the amplitudes stay
 * under the ~2.2 rad where a sine-generated curve folds — but two *different*
 * curves clearing each other is not something a bound gives you. The phases and
 * offsets were swept numerically, and tools/river-check.mjs measures every pair,
 * point against point. Move any constant here and that moves with it.
 */

import { makeCourse, bessel0 } from './course.js';

const TAU = Math.PI * 2;
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ramp = (x, a, b) => smooth((x - a) / (b - a));

// The counter-river: one file of cats swimming the other way, its bends set
// into the first river's bends. It is single file because three abreast will
// not fit through the channel — see river-check's "clear" row for the margin
// that is actually left. It is not a separate burst and has no start time of
// its own: it simply exists in the world alongside the meander, and the frame
// finds it when it gets there.
const B_LANES = 1;
const B_AMP = 0.9; // same bend as the river it threads, so the mesh stays regular
const B_LEN = 1.9;
const B_PHASE = 1.04; // where in its own bend it starts — swept for the widest gap
const B_DROP = 0.29; // and how far across the flow it sits from the meander's line
// How far past the mouth of the meander it starts, so it arrives from off-frame
// rather than appearing in view. It runs only the length of the meander and no
// further: upstream of that the first river is climbing its risers, and a
// counter-river carried on into them would swim straight through one.
const B_LEAD = 0.9;

// The under-river: the other counter-current, and the early one. It runs the
// whole length of the piece *before* the meander — under the right angles and
// on under the opening wave — and it is the first thing on screen, because it
// reaches a lead further left than the river's own source does.
//
// What it does with the room is the point. Under the teeth there is only about
// 0.23 of a frame-height of clear water beneath the runs, so it swims tight and
// nearly straight; under the opening wave there is 0.60, so it opens out into
// long lazy swings. Same course, same cats, and the shape reports how much space
// it is in.
const C_LANES = 1;
const C_LOW = 0.24; // how far under the square runs it starts
const C_TIGHT = 0.1; // heading amplitude in the shallow water under the teeth
const C_OPEN = 0.8; // and in the deep water under the wave
const C_LEN = 1.8; // arc length per swing
const C_PHASE = 0;
const C_AT = 6.5; // where along itself it starts opening out
const C_WIDE = 1.5; // and how much arc it takes to do it
// A slight upward lean, held only across that opening, lifts the course out of
// the shallow room into the tall room. Integrated over C_WIDE it is this much
// rise — without it the wide swings would go straight out of the bottom.
const C_RISE = 0.1;
const C_LEAD = 0.9;

// The squiggles. Under the teeth the course above is doing right angles and this
// one is nearly straight for thirty seconds of frame, which is a long time to
// watch a line. So it tightens, in windows, and this is the table of them.
//
// Each window is a raised cosine over its own arc with a whole number of bends
// inside it, and that is the property the whole arrangement rests on: every
// component of the squiggle then has an integer number of periods across the
// window, so the window *closes* — it hands the course back at the heading and
// the height it borrowed it at. The first draft windowed with smoothstep ramps
// instead and did not close. With one squiggle the drift was 0.012 and easy to
// miss; the moment a second one went in upstream, it moved the first one 0.04
// across its channel and pushed it into the river above.
//
// The bends are laid *over* the long swing rather than replacing it. Replacing
// it was the first attempt and it moved the whole course 0.038 down and put the
// cats through the bottom of the frame — a sine switched off mid-phase does not
// return to its own centre line, it stops wherever it was and stays there.
//
// Short is what makes any of this affordable. A sine-generated curve swings
// about amp·len/2π across its axis, so at half the wavelength the same excursion
// buys twice the bends, and there is very little room to spend: the channel here
// is around 0.05 of clear water up to the river and 0.04 down to the edge of the
// frame. What each column does:
//
//   at, arc   where the window starts along the under-river, and how long it is
//   bends     how many quick bends fit in it — arc/bends is the wavelength, and
//             an integer here is what closes the window
//   amp       how hard the quick bend turns
//   kink      the counter-bend riding on it, at twice the rate and the other way
//   dip       how far the window is pushed *down* its channel. The channel is
//             not centred on the course, so a squiggle hung straight off it
//             swings into the river on one side before it has used the room on
//             the other.
const SQUIGGLES = [
  { at: 4.9, arc: 2.0, bends: 4, amp: 0.42, kink: 0.33, dip: 0.002 },
];

/**
 * How far a squiggle bends the course at `u`. Zero outside its window, and zero
 * net across it, which is the point — see SQUIGGLES above.
 */
function squiggle(u, s) {
  if (u <= s.at || u >= s.at + s.arc) return 0;
  const p = (u - s.at) / s.arc;
  const len = s.arc / s.bends;
  // Down over the first half of the window and back up over the second, so the
  // course is level again at both ends. Negative because a heading above π
  // lifts: y grows downward.
  const dip = -((s.dip * Math.PI) / s.arc) * Math.sin(TAU * p);
  const w = (1 - Math.cos(TAU * p)) / 2;
  return dip + w * (s.amp * Math.sin((TAU * u) / len) - s.kink * Math.sin((TAU * u) / (len / 2)));
}

/**
 * The under-river's heading. Three things happen along it, each in its own
 * window: the swing opens from C_TIGHT to C_OPEN, a lean lifts the whole course
 * into the taller room that made the wider swing possible in the first place,
 * and earlier than either it tightens into each of the SQUIGGLES in turn.
 */
function under(u) {
  const open = ramp(u, C_AT, C_AT + C_WIDE);
  const amp = C_TIGHT + (C_OPEN - C_TIGHT) * open;
  const lean = (C_RISE / C_WIDE) * (ramp(u, C_AT, C_AT + 0.25) - ramp(u, C_AT + C_WIDE - 0.25, C_AT + C_WIDE));
  return (
    Math.PI +
    amp * Math.sin((TAU * (u + C_PHASE)) / C_LEN) +
    lean +
    SQUIGGLES.reduce((a, s) => a + squiggle(u, s), 0)
  );
}

/**
 * Build the currents that run alongside `river`.
 *
 * `marks` is where the river's own stretches begin and end, in its coordinates:
 * `snakeX`/`snakeY` the head of the meander, `teethX` the end of the right
 * angles, `base` the height of their floor. Everything below is measured off
 * those, which is what keeps this file free of typed-in coordinates.
 */
export function makeCurrents(river, marks) {
  const { snakeX, snakeY, teethX, base } = marks;

  // A lead past the mouth of the meander, across the flow from the line it
  // leaves on, and long enough to run back past where the meander began.
  const counter = makeCourse(
    (u) => Math.PI + B_AMP * Math.sin((TAU * (u + B_PHASE)) / B_LEN),
    (river.x1 - snakeX + B_LEAD) / bessel0(B_AMP),
    river.x1 + B_LEAD,
    snakeY + B_DROP,
    B_LANES,
  );

  // A lead past where the teeth end, running back to a lead before the river's
  // own source — which is why it is on screen before the river is.
  const underRiver = makeCourse(
    under,
    (teethX + C_LEAD - (river.x0 - C_LEAD)) / bessel0((C_TIGHT + C_OPEN) / 2),
    teethX + C_LEAD,
    base + C_LOW,
    C_LANES,
  );

  return [counter, underRiver];
}
