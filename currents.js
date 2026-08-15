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
 *   top      the skinny one, along the top edge and mostly above it, which the
 *            frame does not meet until 52 seconds into the burst
 *
 * All three lean slightly nearer the river and away again as they run — the
 * drift, below. They lean *together*, which is the only reason it is affordable:
 * the gaps between the currents are the tight ones, and those never move.
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

// The top river — the third current, and the skinny one. It runs against the
// river like the other two, right to left along the very top of the frame, and
// like them it has no trigger of its own: it is placed at the x the frame's
// right edge reaches T_AT seconds into the burst, and "from 52s" is that
// placement rather than a start time. Nothing in plan.js knows it exists.
//
// Almost all of it is above the top edge, and that is not a compromise — it is
// the only room there is. Where the meander crests, the top of its three-lane
// ribbon comes to within 0.074 of the frame's top edge, and a full-size cat is
// 0.075 tall. There is one cat-height of clear water up there and the edge of
// the screen runs through the middle of it.
//
// Which is what T_SCALE is for. Skinny is not only how it looks — it is what
// makes it visible at all. The gap between the top edge and the crest is fixed,
// so the strip of cat below the edge is the same 0.036 whatever size the cats
// are; shrinking them to T_SCALE turns that strip from two thirds of a cat into
// very nearly all of one. A smaller cat also has a narrower ribbon, which is
// where the room for T_DEEP and for the drift below comes from.
//
// T_DEEP is the dip: from the top edge down to the deepest the centre line goes,
// and it is the constant the crest actually constrains. river-check measures
// what is left over.
const T_LANES = 1;
const T_AT = 52; // seconds into the burst that the frame first meets it
const T_AMP = 0.28; // heading amplitude — how hard it dives in and out of shot
const T_DEEP = 0.014; // how far below the frame's top edge the deepest dip goes
const T_SCALE = 0.6; // cat size, against the full-size cats on every other course
const T_LEAD = 0.3; // x past the last frame, so the source is never in shot
const T_VEIL = 0.03; // how far in a cat comes before it is fully faded up

// The drift — the small courses leaning slightly nearer the river and away from
// it again, so the channels they run in breathe instead of holding one width for
// a minute and a half.
//
// It is a function of where a course *is*, not of how far along it the cats have
// swum, and that is the whole reason it is affordable. Two currents crossing the
// same stretch of river lean the same way by the same amount, so the gap between
// *them* never changes and only their gap to the river does. Give each its own
// phase instead and they lean opposite ways at the same place, closing on each
// other by twice DRIFT — and counter/under has 0.027 of daylight to its name,
// which will not pay for that.
//
// It goes onto the integrated points and not into the heading, which is the
// thing that makes that exact. A heading offset is turned into sideways movement
// by however steeply the course is running at the time — sec² of the local
// angle, which is 1 where a course is flat and 2.6 where the meander's partner
// is at full swing — so two courses passing one x would lean by different
// amounts and the gap between them would open and close after all. That was
// measured, not guessed: in the heading, counter/under went from 0.027 to 0.015.
//
// DRIFT is then bounded by the tightest pair it can still move, which is a small
// course against the river, since the river does not drift. river-check reports
// what survives.
const DRIFT = 0.01; // how far across the flow a small course leans, each way
const DRIFT_LEN = 7.4; // and the x it takes to lean one way and back

/**
 * Lean a course towards the river and away from it again, in place.
 *
 * Only y moves. These courses all run within a few degrees of horizontal, so
 * across the flow *is* up and down for them, and moving in y alone keeps every
 * course's x — and so its place in the drift — exactly where it was.
 *
 * The headings are left alone on purpose. The steepest this adds is
 * DRIFT·2π/DRIFT_LEN, half a degree, which is not worth rebuilding a course over
 * and is well inside what the cats' own rotation would show.
 */
function lean(course) {
  for (let i = 0; i <= course.n; i++) course.ys[i] += DRIFT * Math.sin((TAU * course.xs[i]) / DRIFT_LEN);
  return course;
}

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
//
// They are listed the way the frame meets them, which is *backwards* along the
// under-river: it runs right to left, so the later window is the lower `at`.
// Two of them were once four windows apart: the course was squiggling for about
// fourteen of the twenty-five seconds it spends under the right angles and lying
// flat for the rest, and the flat stretches read as the course having given up
// rather than as a rest between two squiggles. The two added here close those
// gaps, so that from the moment the river above starts to waver to the moment
// the meander takes over, this one is never doing nothing.
//
// No window shares a bend count with the one it runs into — 4, 3, 5, 4 down the
// table — which is what keeps four squiggles in a row from settling into a
// rhythm of their own. The two originals are unchanged, and the one at 1.5 is
// still the tightest of them: the new pair are held to 0.060 and 0.070 of radius
// against its 0.053, because the channel did not get any wider.
const SQUIGGLES = [
  // the last thing it does before the hook takes it out of shot, and the one
  // that answers the river's own tightest tooth overhead
  { at: 0.25, arc: 1.2, bends: 4, amp: 0.46, kink: 0.2, dip: 0.008 },
  // the tightest of them, under the last of the right angles — a 0.054 radius
  // against the 0.080 of the one below, in the same width of channel
  { at: 1.5, arc: 1.32, bends: 3, amp: 0.7, kink: 0.45, dip: 0.012 },
  // filling what used to be nine seconds of flat between the two originals
  { at: 2.95, arc: 1.95, bends: 5, amp: 0.4, kink: 0.28, dip: 0.006 },
  // and the first you see, under the middle of the teeth
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

// The hook. Left to itself the under-river simply *begins*, in clear air in the
// middle of the frame, at about 110s — a file of cats fading up out of nothing
// where the meander takes over. So it does not begin: it comes up out of the
// bottom-right corner of the frame, swinging over onto the leftward run.
//
// Where it can go is decided by the counter-river, which is coming down through
// exactly this corner — it reaches y 1.044 around x 9.7, and the frame's floor
// is 1.101. There is no room to pass above it and none to loop inside it, so
// the hook goes under: down past the frame's bottom edge, and out of shot.
// H_TURN is how far its heading has swung by the tip. Swept against the
// counter-river the way everything else here is: 0.6 and 2.4 clear it by 0.032,
// where 0.8 and 1.6 ran straight through it at -0.007. Most of the curl is
// below the frame — only the last 0.2 of it, three cats or so, is ever in shot.
const H_ARC = 0.6;
const H_TURN = 2.4;

// The hook integrated on its own, only to find out how far it travels. The
// under-river is then started that much back, so the hook *ends* exactly where
// the course used to begin and nothing downstream of it moves.
const HOOK = makeCourse((u) => Math.PI + H_TURN * (1 - smooth(u / H_ARC)), H_ARC);

/**
 * The under-river's heading. Three things happen along it, each in its own
 * window: the swing opens from C_TIGHT to C_OPEN, a lean lifts the whole course
 * into the taller room that made the wider swing possible in the first place,
 * and earlier than either it tightens into each of the SQUIGGLES in turn.
 */
function under(u) {
  // The hook comes first, and hands over pointing exactly along the run: smooth
  // is flat at both ends, so there is no corner where the two meet.
  if (u < H_ARC) return Math.PI + H_TURN * (1 - smooth(u / H_ARC));
  u -= H_ARC;
  const open = ramp(u, C_AT, C_AT + C_WIDE);
  const amp = C_TIGHT + (C_OPEN - C_TIGHT) * open;
  const rise = (C_RISE / C_WIDE) * (ramp(u, C_AT, C_AT + 0.25) - ramp(u, C_AT + C_WIDE - 0.25, C_AT + C_WIDE));
  return (
    Math.PI +
    amp * Math.sin((TAU * (u + C_PHASE)) / C_LEN) +
    rise +
    SQUIGGLES.reduce((a, s) => a + squiggle(u, s), 0)
  );
}

/**
 * Build the currents that run alongside `river`.
 *
 * `marks` is where the river's own stretches begin and end, in its coordinates:
 * `snakeX`/`snakeY` the head of the meander, `teethX` the end of the right
 * angles, `base` the height of their floor, `top` the frame's top edge,
 * `snakeLen` the meander's wavelength, `rightEdgeAt(s)` where the frame's
 * right-hand edge has got to s seconds in, and `burst` how long that pan lasts.
 * Everything below is measured off those, which is what keeps this file free of
 * typed-in coordinates.
 */
export function makeCurrents(river, marks) {
  const { snakeX, snakeY, teethX, base, top, snakeLen, rightEdgeAt, burst } = marks;

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
    H_ARC + (teethX + C_LEAD - (river.x0 - C_LEAD)) / bessel0((C_TIGHT + C_OPEN) / 2),
    teethX + C_LEAD - HOOK.xs[HOOK.n],
    base + C_LOW - HOOK.ys[HOOK.n],
    C_LANES,
  );

  // The top river. Running against the river means integrating from its *right*
  // hand end, so the mouth — the end the cats fade out at — is the one that
  // lands at the x the frame reaches at T_AT, and the source is away off to the
  // right where the frame never gets to at all.
  //
  // Two things fall out of the base heading being π. The deepest point of the
  // whole course is now u = 0, which is that unreachable right-hand end, so the
  // origin is simply the depth the dips are wanted at. And the mouth would
  // otherwise land wherever the arithmetic left it — in mid-air, in shot,
  // visibly fading cats out of nothing from 52s to 60s. So the arc is rounded up
  // to a half-odd number of wavelengths, which is exactly where the curve is at
  // its highest, and the mouth goes off the top of the frame instead. Rounded
  // *up*, so the course only ever reaches further right, where nothing sees it —
  // rounding down would pull the mouth in and start it late.
  const bT = bessel0(T_AMP);
  const span = (rightEdgeAt(burst) + T_LEAD - rightEdgeAt(T_AT)) / bT;
  const arc = (Math.ceil(span / snakeLen - 0.5) + 0.5) * snakeLen;
  const topX = rightEdgeAt(T_AT) + arc * bT;
  const topRiver = makeCourse(
    (u) => Math.PI + T_AMP * Math.sin((TAU * u) / snakeLen),
    arc,
    topX,
    top + T_DEEP,
    T_LANES,
  );
  // The two things that make it the skinny one. `veil` fades its cats up as they
  // come into shot rather than letting the top edge cut them off, and `scale`
  // draws them smaller than the cats on every other course. No other course
  // carries either.
  topRiver.veil = T_VEIL;
  topRiver.scale = T_SCALE;

  // All three lean together, which is the one thing that keeps their own gaps
  // where they were. The river is not in this list and does not move.
  return [counter, underRiver, topRiver].map(lean);
}
