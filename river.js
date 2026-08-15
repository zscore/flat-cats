/**
 * river.js — the river of cats: a ribbon three cats wide, a frame that travels
 * down it, and two counter-currents running back the other way.
 *
 * The river is one fixed curve, laid out once, in three stretches:
 *
 *   wave     a gentle sine, a couple of crests wide
 *   square   nine right-angle turns — the river goes left, then straight up and
 *            off the top of the frame, then comes back down and carries on
 *   snake    the corners relax into a meander that never crosses itself
 *
 * Running the other way, right to left, single file, are the currents —
 * currents.js, built off this river's own landmarks rather than off coordinates
 * of their own. Between them something is always swimming against the river.
 * The last of them is not a counter-current at all: the top river runs the same
 * way this one does, along the very top of the frame and mostly above it, and
 * the frame meets it 52 seconds in. currents.js says why it can be no lower.
 *
 * Three things worth writing down, because they are what the module is.
 *
 * FIRST: the river is defined by its *heading*, not its position — θ(u), the
 * direction it points at each distance u along itself, integrated into points
 * by course.js, which is where that machinery and why it gives arc length live.
 * What is left here is the shapes, and in the heading domain the three stretches
 * are one expression differing only in what they put in it:
 *
 *   wave     θ = 0.85·sin(2πu/1.6)      a sine-generated curve, shallow
 *   square   θ steps between 0 and ∓π/2  exact right angles, because a heading
 *                                        of π/2 *is* a right angle rather than
 *                                        an approximation of one
 *   snake    θ = 0.9·sin(2πu/1.9)        the same sine, wandering
 *
 * SECOND: nothing is ever scaled to fit. An earlier draft fitted the whole
 * curve into the frame every frame, which is a tidy picture and the wrong one —
 * a curve that always fits can never leave, so the right angles could only ever
 * be a small comb in the middle of the screen, and folding it up compressed the
 * cats and sped them up exactly when it folded. Here the river is built at a
 * fixed size in frame-heights and the frame *travels*, so a riser taller than
 * the frame simply runs off the top, and the cats keep one pace throughout.
 *
 * That pace is two constants and no more. PAN is how fast the frame slides
 * along, FLOW is how fast the cats swim; both are held for the whole burst, so
 * there is no moment anywhere in it where anything speeds up. The burst is as
 * long as the river takes at that pace — BURST_LENGTH is derived, not chosen.
 *
 * THIRD: the other courses are more courses in the same world, not more bursts.
 * None has a start time of its own — they simply exist alongside the river, and
 * the frame finds them when it gets there. A course that wants a *moment* gets
 * one by being placed where the frame will be at that second, which is all the
 * top river's "from 52s" is. Which is why the drawing code takes a course rather
 * than knowing about the river: there are four now, and one loop draws any of
 * them.
 *
 * Where they can go is decided by where this river is *not* — currents.js is
 * shaped to the clear water this one leaves, and says so in its own head.
 *
 * Not touching is the one thing with no bound behind it. Everything else is
 * guaranteed by construction — right angles because a heading of π/2 is one, no
 * self-crossing because the amplitude stays under the ~2.2 rad where a
 * sine-generated curve folds. Two *different* curves clearing each other is not
 * something a bound gives you, so river-check measures every pair, point against
 * point: counter/under is the tightest at 0.027, then river/counter at 0.038 and
 * river/top at 0.044. Move any constant and those move with it — check them
 * rather than assuming they survived. It is also what cost the meander its
 * depth, as SNAKE_AMP explains below.
 *
 * Like draw() in viz.js, tailBurst() in tail.js, faceBurst() in face.js and
 * spiralBurst() in spiral.js this is a pure function of time — no counters, no
 * rand(), nothing carried between frames. Scrub back into the burst an hour
 * later and you get the identical frame. Keep it that way: both PAN and FLOW
 * are multiplied by `since` in closed form, and are not rates anybody
 * integrates.
 *
 * One thing here is not a function of the river at all: pulse.js swells a
 * single visible cat on every hit in the score, which is why riverBurst takes
 * beats. It stays pure the same way everything else does — the cat a hit picks
 * is hashed from the hit's index, not remembered.
 *
 * tools/river-check.mjs draws every course and audits the claims below.
 */

import { swells } from './pulse.js';
import { STEP, makeCourse, at } from './course.js';
import { makeCurrents } from './currents.js';

// Everything here is in frame-heights: 1.0 is the height of the window. Widths
// come from the aspect at draw time, so the river is the same river on any
// shape of screen and only the amount of it you can see changes.
const PAN = 0.22; // frame-heights per second the frame slides down the river
const FLOW = 0.32; // and per second that the cats swim along it
const CAT_H = 0.075; // cat height
const GAP = 0.065; // distance between cats along the river
const LANES = 3; // cats abreast — the river is three cats wide
const LANE = 0.055; // and this is the gap between those three, across the flow
const DROP = 0.18; // how far below the river's runs the frame centres itself
const EDGE_FADE = 0.6; // arc length over which cats fade in at the source and out at the mouth
const NOMINAL_ASPECT = 16 / 9; // only used to derive BURST_LENGTH, which needs a width

const WAVE_ARC = 2.2; // how much river the opening wave gets
const WAVE_AMP = 0.85; // heading amplitude, radians
const WAVE_LEN = 1.6; // arc length per crest
const BLEND = 0.9; // arc length each stretch takes to become the next

const TEETH = 9; // right-angle turns — nine of them, so thirty-six corners
const RISER = 1.0; // how far a riser climbs: a whole frame-height, so it leaves
const RUN = 0.3; // and how far the flat runs between them go
// The corners get a radius, which a right angle does not want but three lanes
// of cats do: at a true corner the inside lane has nothing to bend around and
// folds through itself. This is the smallest rounding whose tightest radius
// still clears the inside lane — ROUND/(1.5·π/2), which river-check reports
// against LANE. Against a 0.35 run it is still plainly a right-angle turn.
const ROUND = 0.14;
const TOOTH = 2 * RISER + 2 * RUN;

// The closing meander. SNAKE_AMP was 1.9 — deep and serpentine — until the
// counter-river below had to interlock with it, and could not: at 1.9 the
// meander's own arms sit about 0.27 apart across the flow, and two ribbons need
// LANE·(LANES-1)+CAT_H between their centre lines just to avoid touching. There
// is no channel to thread. At 0.9 there is. This is the cost of the mesh, and
// it is paid here rather than anywhere else.
const SNAKE_ARC = 4.5; // how much river the closing meander gets
const SNAKE_AMP = 0.9; // radians; stays under the ~2.2 that would fold the curve
const SNAKE_LEN = 1.9; // arc length per bend

const TAU = Math.PI * 2;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ramp = (x, a, b) => smooth((x - a) / (b - a));

// Where each stretch starts and ends along the river.
const SQ_IN = WAVE_ARC;
const SQ_AT = SQ_IN + BLEND;
const SQ_OUT = SQ_AT + TEETH * TOOTH;
const SN_AT = SQ_OUT + BLEND;
const LENGTH = SN_AT + SNAKE_ARC;

/**
 * A square wave in the heading: flat run, quarter turn *up*, flat run, quarter
 * turn back down. Returns -1, 0 or +1 — the caller scales it, and at π/2 those
 * are the right angles the stretch is named for. Up is negative because canvas
 * y grows downward, and the first turn has to be the one that leaves the frame.
 *
 * Built from four ramps rather than four steps, so each corner turns over ROUND
 * of arc instead of instantly. The tooth is measured from the middle of a run,
 * which is the one arrangement where no turn straddles the wrap and the level
 * is 0 at both ends of the cycle — otherwise every ninth corner is a tear.
 */
function crenel(v) {
  const w = v - Math.floor(v);
  const r = RUN / TOOTH;
  const i = RISER / TOOTH;
  const rr = ROUND / TOOTH;
  return (
    -ramp(w, r / 2, r / 2 + rr) +
    ramp(w, r / 2 + i, r / 2 + i + rr) +
    ramp(w, 1.5 * r + i, 1.5 * r + i + rr) -
    ramp(w, 1.5 * r + 2 * i, 1.5 * r + 2 * i + rr)
  );
}

/**
 * Where the river points at distance `u` along itself. The three stretches
 * overlap for BLEND either side and their weights sum to 1 throughout, so the
 * river stiffens into its corners and relaxes out of them rather than cutting
 * between two shapes.
 */
function heading(u) {
  const stiff = ramp(u, SQ_IN, SQ_AT);
  const loose = ramp(u, SQ_OUT, SN_AT);
  return (
    (1 - stiff) * WAVE_AMP * Math.sin((TAU * u) / WAVE_LEN) +
    (stiff - loose) * (Math.PI / 2) * crenel((u - SQ_AT) / TOOTH) +
    loose * SNAKE_AMP * Math.sin((TAU * (u - SN_AT)) / SNAKE_LEN)
  );
}

// The three courses, integrated once, at load. course.js does the integrating;
// what is here is only which headings, how much of each, and where each starts.
const RIVER = makeCourse(heading, LENGTH, 0, 0, LANES);
// The runs of the square stretch are the river's floor, and the frame hangs its
// centre a little under them so the risers have somewhere to leave to.
const BASE = RIVER.ys[Math.round(SQ_AT / STEP)];

// As long as it takes to pan the whole course, plus a frame's width at each end
// so the river arrives from off-screen and leaves the same way.
export const BURST_LENGTH = Math.round((RIVER.x1 - RIVER.x0 + NOMINAL_ASPECT) / PAN);

// Where the river's own stretches begin and end. The currents are placed off
// these rather than off typed-in coordinates, so moving a stretch moves them.
const MARKS = {
  snakeX: RIVER.xs[Math.round(SN_AT / STEP)],
  snakeY: RIVER.ys[Math.round(SN_AT / STEP)],
  teethX: RIVER.xs[Math.round(SQ_OUT / STEP)],
  base: BASE,
  // The frame's top edge, and its wavelength: a current that runs along the top
  // of the frame needs to know where that edge is, and one that means to stay
  // out of step with the meander needs to know what it is staying out of step
  // with. Both are the river's, so both are handed over rather than copied.
  top: BASE - DROP - 0.5,
  snakeLen: SNAKE_LEN,
  // Where the frame's right-hand edge has got to, `s` seconds into the burst.
  // A current placed at this x is one the frame first meets at second s — which
  // is how a current gets a moment without getting a trigger of its own. The
  // nominal aspect is the same approximation BURST_LENGTH is built on: on a
  // wider screen the edge is further out and the meeting is a little earlier.
  rightEdgeAt: (s) => RIVER.x0 - CAT_H + PAN * s,
  burst: BURST_LENGTH,
};

const COURSES = [RIVER, ...makeCurrents(RIVER, MARKS)];

// Which courses a hit may swell a cat on, and where each one's swells came back.
//
// Not every course can hold a pulse. pulse.js keeps its choice INSET inside the
// frame so a swelling cat grows into the picture, and a course that never comes
// more than a hair below the top edge has nothing that far in — the top river
// cannot be picked, by construction, whether or not it is offered. Offering it
// anyway is not harmless: the starting course of every hit is hashed against the
// size of this pool, so a fourth entry that can never win still moves which cat
// each of the other beats swells. Left out, the score lands exactly where it did
// before the top river existed, which pulse-check confirms.
//
// POOL_OF maps a course's index in COURSES to its index in the pool, or -1 for
// one that is not in it — read by position rather than by identity so the order
// of COURSES is free to change.
const POOL = COURSES.filter((c) => !c.veil);
const POOL_OF = COURSES.map((c) => POOL.indexOf(c));

/**
 * Draw the river. `since` is seconds since it was triggered — negative or past
 * the end and nothing is drawn. `cats` is the image cast. Returns whether
 * anything was drawn.
 *
 *   riverBurst(ctx, canvas.width, canvas.height, t - 66, cats)
 */
export function riverBurst(ctx, W, H, since, cats, beats = []) {
  if (since < 0 || since > BURST_LENGTH || !cats.length) return false;
  const alpha = ramp(since, 0, 1.6) * (1 - ramp(since, BURST_LENGTH - 2.5, BURST_LENGTH));
  if (alpha <= 0.001) return false;

  // The frame slides down the river at PAN, starting a half-width before the
  // source. Its height never moves: that is what lets the risers leave.
  const camX = RIVER.x0 - 0.5 * (W / H) - CAT_H + PAN * since;
  const camY = BASE - DROP;
  const frame = { camX, camY, halfW: 0.5 * (W / H), pan: PAN };
  const swollen = swells(since, beats, POOL, frame, FLOW, GAP, EDGE_FADE);

  ctx.save();
  ctx.globalAlpha = alpha;
  // The counter-river second, so where the two mesh its file of cats reads as
  // passing in front rather than being half-buried in the wider ribbon.
  COURSES.forEach((course, c) => swim(ctx, W, H, course, cats, since, alpha, camX, camY, swollen[POOL_OF[c]]));
  ctx.restore();
  return true;
}

/** One course's worth of cats, at `since` seconds, through a frame at (camX, camY). */
function swim(ctx, W, H, course, cats, since, alpha, camX, camY, swollen) {
  const cull = CAT_H + LANE * (course.lanes - 1);
  const h = CAT_H * H;

  // Every place on the course, culled to the ones the frame can see. A course
  // is only a few hundred of these, so the test is cheaper than being clever
  // about which stretch is on screen.
  for (let k = 0; k * GAP < course.length; k++) {
    // Wrapped, so the course stays populated end to end: a cat reaching the
    // mouth comes back in at the source. Without the wrap the whole train
    // swims off downstream and leaves the frame — which pans slower than the
    // cats swim — looking at empty river for the first third of the burst.
    // The two ends are never on screen together, so the wrap is never seen.
    const u = (k * GAP + FLOW * since) % course.length;
    // One hit swells one cat, so the whole file at k is not what grows — the
    // middle lane is, and the outer ones carry on. On a single-file course that
    // is the only lane there is. Looked up before the cull because a swelling
    // cat reaches further, and only that one needs the wider margin.
    const grow = swollen?.get(k) ?? 0;
    const edge = cull * (1 + grow);

    const p = at(course, u);
    const x = (p.x - camX) * H + W / 2;
    const y = (p.y - camY) * H + H / 2;
    if (x < -edge * H || x > W + edge * H || y < -edge * H || y > H + edge * H) continue;

    const fade = clamp01(u / EDGE_FADE) * clamp01((course.length - u) / EDGE_FADE);
    // A course that lives off the edge of the frame says so with a veil, and the
    // cats on it fade up as they come into shot instead of being cut off by the
    // edge. Measured from the bottom of the cat, so a cat is at nothing exactly
    // as its feet reach the edge; `veil` is how much further in it has to come
    // to be fully there. Position only, so it stays as pure as everything else.
    const veil = course.veil ? clamp01((y + h / 2) / (course.veil * H)) : 1;
    const nx = -Math.sin(p.th); // across the flow, for the lanes
    const ny = Math.cos(p.th);
    const mid = (course.lanes - 1) / 2;

    for (let lane = 0; lane < course.lanes; lane++) {
      const off = (lane - mid) * LANE * H;
      const img = cats[(k * 7 + lane * 23 + 3) % cats.length];
      const size = h * (lane === Math.round(mid) ? 1 + grow : 1);
      const w = size * (img.width / img.height);

      ctx.save();
      ctx.globalAlpha = alpha * fade * veil;
      ctx.translate(x + nx * off, y + ny * off);
      ctx.rotate(p.th);
      // Past a quarter turn the cat is heading backwards and lying on its back.
      // Mirroring across its own long axis puts its feet down again without
      // taking it off the line it is following. The counter-river is entirely
      // past a quarter turn, which is exactly why it faces the other way.
      if (Math.cos(p.th) < 0) ctx.scale(1, -1);
      ctx.drawImage(img, -w / 2, -size / 2, w, size);
      ctx.restore();
    }
  }
}
