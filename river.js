/**
 * river.js — the river of cats: a ribbon three cats wide, a frame that travels
 * down it, and three counter-currents running back the other way.
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
 * The last of them is the top river, which runs along the very top of the frame
 * and mostly above it — the frame meets it 52 seconds in, and what you see of it
 * is a file of small cats dipping into shot and out again. currents.js says why
 * it can be no lower, and why its cats are the size they are.
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
 * point: counter/under is the tightest at 0.027, then river/counter at 0.035,
 * river/under at 0.034 and river/top at 0.056. Move any constant and those move
 * with it — check them rather than assuming they survived. It is also what cost
 * the meander its depth, as SNAKE_AMP explains below.
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

// The waver. Nine right angles take about twenty-five seconds of frame to pass
// and nothing in them moves except past the edge of it: the comb is rigid and
// the camera does all the work. So the risers waver — a squiggle laid over the
// crenel, in a closing window on each riser and nowhere else.
//
// **On the risers and nowhere else** is the whole of it, and it is not a taste.
// A heading wobble displaces a curve across itself, and a riser's across is
// horizontal, so this is where a squiggle buys sideways movement. But the reason
// it is confined here is closure, and closure here is not the property
// currents.js relies on. There a window that is zero-mean in the heading hands
// the course back where it borrowed it, because the course runs one way
// throughout. A tooth does not: its two risers point opposite ways, so the same
// wobble pushes one +x and the other −x, and a window that is zero-mean across
// the whole tooth has the two halves *adding* rather than cancelling. Laid over
// a tooth at a plausible amplitude that came to +0.098 in x and −0.075 in y by
// the end of the teeth, and every one of those carried into the meander, which
// put its crest through the top river. Measured, not feared.
//
// One window per riser, and the *same* profile in both, makes it exact instead.
// Up the riser the heading is −π/2 and dx = sin δ; down it the heading is +π/2
// and dx = −sin δ. Identical δ, opposite sign, and the x closes. dy is −cos δ
// and +cos δ, so the y closes too — whatever shape the window is, and to all
// orders rather than to first. The runs and the corners are left alone, which
// costs the movement its vertical half and buys three things: the bottom runs
// have only ~0.03 of clear water down to the under-river and do not move, the
// corners are already the tightest turn in the river and get nothing added, and
// the risers still climb and still leave the top of the frame.
//
// What is budgeted is the swing rather than the amplitude, because what this has
// to fit inside is the 0.3 of run between a tooth's two risers, and both swing
// toward each other. At 0.028 that leaves about 0.06 of daylight between the
// ribbons. Holding the swing and *adding* bends is then exactly what tightening
// a loop is: half the wavelength at the same excursion is a quarter of the
// radius. river-check's `wide` row is where that lands.
const WAVER_SWING = 0.028; // how far across itself a riser swings, frame-heights
const WAVER_BENDS = 2; // quick bends per riser
const WAVER_AT = 1.5; // teeth in before it starts, and how many teeth it takes to
const WAVER_IN = 2; // come up to full. Read once per tooth, so each window still closes
// The last tooth winds up: same swing, more bends in it, so a tighter turn. It
// is the tooth on screen as the meander arrives.
const WAVER_LAST = 3;

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

// The straight part of a riser: from the end of one corner to the start of the
// next, in tooth-local arc. Both risers are this long, which is what lets one
// profile serve both — see the waver's note above.
const CLIMB = RISER - ROUND;
const UP_AT = RUN / 2 + ROUND; // where the climbing riser's straight begins
const DOWN_AT = 1.5 * RUN + RISER + ROUND; // and the descending one's

/**
 * How far the waver bends the river at `u`. Zero everywhere but the straight of
 * a riser, and the same profile on both risers of a tooth, which is what closes
 * it — see WAVER_SWING above.
 */
function waver(u) {
  const v = (u - SQ_AT) / TOOTH;
  if (v <= 0 || v >= TEETH) return 0;
  const k = Math.floor(v); // which tooth
  // Strength is read once per tooth rather than continuously along the river, so
  // it is one constant across both of a tooth's windows and they still cancel.
  const grow = ramp(k, WAVER_AT, WAVER_AT + WAVER_IN);
  if (grow <= 0) return 0;
  const a = (v - k) * TOOTH; // how far into the tooth, in arc
  const q =
    a >= DOWN_AT && a < DOWN_AT + CLIMB
      ? (a - DOWN_AT) / CLIMB
      : a >= UP_AT && a < UP_AT + CLIMB
        ? (a - UP_AT) / CLIMB
        : -1; // a run or a corner: the waver does not go there
  if (q < 0) return 0;
  const bends = k === TEETH - 1 ? WAVER_LAST : WAVER_BENDS;
  // The swing budget, as an amplitude: a sine-generated curve swings amp·len/2π
  // across its own axis, and len is CLIMB/bends.
  const amp = (TAU * WAVER_SWING * bends) / CLIMB;
  return grow * amp * ((1 - Math.cos(TAU * q)) / 2) * Math.sin(TAU * bends * q);
}

/**
 * Where the river points at distance `u` along itself. The three stretches
 * overlap for BLEND either side and their weights sum to 1 throughout, so the
 * river stiffens into its corners and relaxes out of them rather than cutting
 * between two shapes.
 *
 * The waver is added rather than blended in, because it closes on its own: it
 * has no weight to sum to one with, and it is zero everywhere the other two
 * stretches are anything.
 */
function heading(u) {
  const stiff = ramp(u, SQ_IN, SQ_AT);
  const loose = ramp(u, SQ_OUT, SN_AT);
  return (
    (1 - stiff) * WAVE_AMP * Math.sin((TAU * u) / WAVE_LEN) +
    (stiff - loose) * (Math.PI / 2) * crenel((u - SQ_AT) / TOOTH) +
    loose * SNAKE_AMP * Math.sin((TAU * (u - SN_AT)) / SNAKE_LEN) +
    waver(u)
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
  // The frame's top edge: a current that runs along the top of the frame needs
  // to know where that edge is. The meander's wavelength used to be handed over
  // beside it, for the top river to stay out of step with; that course is in
  // step now, and reads the bends off the river's own points instead — the arc
  // wavelength was never the one that shows.
  top: BASE - DROP - 0.5,
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
  // A course may draw its cats smaller than everyone else's — the whole ribbon
  // scales, lane spacing with it, so a skinny course is skinny in every way.
  const scale = course.scale ?? 1;
  const cull = (CAT_H + LANE * (course.lanes - 1)) * scale;
  const h = CAT_H * scale * H;

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
      const off = (lane - mid) * LANE * scale * H;
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
