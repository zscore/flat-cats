/**
 * branches.js — what leaves the under-river.
 *
 * Split out of currents.js for the same reason currents.js was split out of
 * river.js: that file owns the courses that run *alongside* the river, this one
 * owns the short courses that peel *off* one of them. Both were going to grow,
 * and neither was going to stay readable sharing a file with the other.
 *
 * A branch is a file of cats that leaves the under-river and goes one of two
 * ways. Which two is decided by the picture in portrait, where frame.js turns
 * the whole composition a quarter turn clockwise and the wide frame's top edge
 * becomes the tall one's right-hand side:
 *
 *   climb   up off the green river and out of the top of the frame, which in
 *           portrait is a file running away to the right
 *   dive    down off it and out of the bottom, which in portrait is the same
 *           gesture pointing left
 *
 * **A climb can only happen in half the gaps, and that is geometry rather than
 * taste.** The right angles alternate between two levels, so the space between
 * one riser and the next is roofed at one end and floored at the other, turn and
 * turn about. Between a tooth's *own* two risers the roof is the top run, which
 * sits a whole frame-height above the floor and well off the top of the picture,
 * and the bottom is open all the way down to the green river — a branch can
 * enter from below and climb the entire height of the frame without meeting
 * anything. Between one tooth and the next it is the other way up: a bottom run
 * lies across it at the level of the river's floor, and a branch coming up from
 * the green river would swim straight into the underside of it. So climbs go in
 * the roofed gaps only, one per tooth, and there is no arguing with it.
 *
 * Those gaps are found from the river's own points and not from its constants.
 * A top run is a flat stretch within a hair of the river's lowest y — the risers
 * reach that level too but are nowhere near flat when they do, and no other part
 * of the river comes within 0.24 of it. Nine teeth, nine stretches, and the
 * middle of each is a gap. river.js therefore hands this file nothing it did not
 * already hand currents.js, which is why it is still exactly at its ceiling.
 *
 * The climbs have about 0.126 of clear water across a gap to fit in, and that is
 * before the waver starts swinging the risers into it. So they are single file
 * and drawn small, for the reason the top river is: skinny is not a look here,
 * it is what fits.
 *
 * A dive has the opposite problem. There is only about 0.1 of frame below the
 * green river, so a dive is over almost as soon as it starts — three or four
 * cats, the same handful the under-river's own hook shows. It is given far more
 * arc than that, nearly all of it below the bottom edge, so that its cats are
 * still climbing out of EDGE_FADE while they are in shot rather than sitting at
 * the dim end of it. They peel off soft and firm up as they go, which is the
 * right way round for something splitting away from a river.
 *
 * Nothing here has a coordinate typed into it either. A climb is placed by which
 * tooth's gap it rises in; a dive by the second the frame's right edge reaches
 * it, which is the trick the top river already uses to get a moment without
 * getting a trigger. Both are read back off the geometry, so moving the river
 * moves every branch with it.
 *
 * tools/river-check.mjs measures each branch against every other course, from
 * the point it has left the under-river — the root is *meant* to be touching,
 * and is the one place in the whole picture where two courses may.
 */

import { makeCourse } from './course.js';

const TAU = Math.PI * 2;
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// Drawn small, and veiled at the frame's edge, for the same two reasons the top
// river is: a gap is 0.126 wide and a full-size cat's ribbon is 0.075 of that,
// and a course whose whole point is leaving the picture should not be cut off by
// the edge it leaves through.
const BR_SCALE = 0.62; // cat size, against the full-size cats on the river
const BR_VEIL = 0.03; // how far in a cat comes before it is fully faded up

// A climb. TURN is the arc it takes to come out of the under-river and stand up
// vertical, and it is bounded at both ends. Too long and the branch is still
// leaning when it reaches the level of the river's floor, where the risers start
// and the clear width drops from a whole tooth to 0.126. Too short and it is a
// corner rather than a turn, with the cats swinging through a right angle in
// under their own length.
const CLIMB_TURN = 0.42;
// How far past the frame's top edge a climb carries on before its course ends,
// and the one number here with a hard ceiling over it. The gap is roofed: the
// top run lies across it at the river's lowest y, and between the top edge of
// the frame and the underside of that ribbon there is 0.256 of room. A climb
// given a round 1.8 of arc — which was the first draft — does not stop in it. It
// climbs to y −0.7 and straight through the roof, at −0.110 of daylight on every
// one of the three, which is what the checker is for. This spends 0.17 of the
// 0.256 and leaves the rest, so the arc is *derived* from where the branch has
// to stop rather than chosen and hoped over.
const CLIMB_OVER = 0.17;
// Which tooth's gap each climb rises in. Every other one, so the picture has a
// branch about every six seconds through the middle of the burst rather than a
// row of them.
const CLIMBS = [3, 5, 7];

// A dive. It turns less than a right angle — a fully vertical drop would be out
// of the frame in three cats and read as a glitch rather than a gesture, where a
// slant crosses the bottom edge at an angle and shows a few more of them.
const DIVE_TURN = 0.5;
const DIVE_LEAN = 0.62; // fraction of a right angle it turns through
const DIVE_ARC = 1.3; // nearly all of it below the bottom edge — see the head
// The second of the burst the frame's right edge reaches each dive. They sit
// between the climbs rather than under them, so the two gestures alternate.
//
// The last of them is bounded by the under-river rather than by taste. That
// course has a source, at about 43.4s by this clock, and a hook before that
// which curls out of the bottom of the frame — there is nothing to branch off
// after 42.8s. A fourth dive at 45 was simply not built, and nothing said so,
// which is why river-check now counts what it was asked for against what it got.
const DIVES = [27, 33, 39, 42];

/**
 * The x at the middle of each tooth's roofed gap, found from the river's points.
 *
 * A top run is flat and within a hair of the river's lowest y. Nothing else in
 * the river is both: the risers reach that level but are vertical when they do,
 * and the wave and the meander never come within 0.24 of it.
 */
function gaps(river) {
  const low = Math.min(...river.ys);
  const found = [];
  let run = null;
  for (let i = 0; i <= river.n; i++) {
    const flat = Math.abs(Math.atan2(Math.sin(river.ths[i]), Math.cos(river.ths[i]))) < 0.1;
    if (river.ys[i] < low + 0.05 && flat) run = run ?? { a: i, b: i };
    else if (run) {
      found.push((river.xs[run.a] + river.xs[run.b]) / 2);
      run = null;
    }
    if (run) run.b = i;
  }
  if (run) found.push((river.xs[run.a] + river.xs[run.b]) / 2);
  return found;
}

/** Where a course crosses `x`, as an index into it. -1 if it never does. */
function crossing(course, x) {
  for (let i = 1; i <= course.n; i++) if ((course.xs[i] - x) * (course.xs[i - 1] - x) <= 0) return i;
  return -1;
}

/**
 * One branch off `under`, turning from wherever that course happens to be
 * pointing at the root round to `held` — the heading it then keeps — over `span`
 * of arc, and running `arc` in total.
 *
 * The heading it settles on is **absolute, not a turn through a right angle**,
 * and the difference is the whole of whether a climb works. The under-river is
 * squiggling where these leave it: its own heading wanders up to half a radian
 * either side of due left. Turned by a fixed right angle from that, a branch
 * climbs half a radian off vertical, and over the frame-height it has to rise
 * that is two thirds of a frame sideways — through the riser either side of the
 * gap, which is exactly what the checker caught. Turned *to* vertical, it stands
 * up straight out of whatever the green river was doing underneath it.
 *
 * `aim` is the x the branch is wanted at once it has finished turning, or null
 * for a dive, which goes wherever it goes. Getting a climb to stand up over the
 * middle of a gap means knowing how far its own turn carries it sideways, which
 * is not known until the turn is built, so it is built once at the origin to
 * find out and the root is then set back by that much. currents.js does the same
 * thing with the hook, for the same reason.
 */
function branch(under, root, held, span, arc, aim, stopAt) {
  const shape = (th0) => (s) => th0 + (held - th0) * smooth(s / span);
  let i = crossing(under, root);
  if (i < 0) return null;
  if (aim !== null) {
    // How far the turn carries the branch sideways depends on the heading it
    // starts from, and which heading that is depends on where the root ended up,
    // which depends on the reach. So it is solved rather than guessed at: put
    // the root where the current reach says, read the heading there, measure the
    // reach again, repeat. Two passes is not enough — the under-river is
    // squiggling here and its heading swings half a radian, which moved one
    // climb 0.05 off the line it was aimed at and into the riser beside it. This
    // settles in three or four; the extra passes are free and cost nothing but
    // certainty.
    for (let pass = 0; pass < 8; pass++) {
      const probe = makeCourse(shape(under.ths[i]), span);
      const at = crossing(under, aim - probe.xs[probe.n]);
      if (at < 0) return null;
      if (at === i) break;
      i = at;
    }
  }
  // A climb is given the arc that lands its mouth on `stopAt` rather than an arc
  // of its own: the turn eats some of the rise and the rest is straight, so what
  // is left to climb is only known once the turn has been built.
  if (stopAt !== null) {
    const probe = makeCourse(shape(under.ths[i]), span);
    arc = span + (under.ys[i] + probe.ys[probe.n] - stopAt);
  }
  const course = makeCourse(shape(under.ths[i]), arc, under.xs[i], under.ys[i], 1);
  course.scale = BR_SCALE;
  course.veil = BR_VEIL;
  // Where it has left the under-river, for the checker: everything before this
  // is the root, which is touching on purpose.
  course.from = Math.round(span / (arc / course.n));
  return course;
}

/**
 * Build the branches that leave `under`. `river` is only read for where its
 * roofed gaps are, and `rightEdgeAt` is the marks' clock — the x the frame's
 * right edge has reached at a given second of the burst.
 */
export function makeBranches(river, under, { top, rightEdgeAt }) {
  const gapX = gaps(river);
  // Straight up for a climb; for a dive, that much less than due left, so it
  // slants out through the bottom edge rather than dropping through it.
  const UP = Math.PI + Math.PI / 2;
  const DOWN = Math.PI - DIVE_LEAN * (Math.PI / 2);
  // The middle of the gap's roof is where a climb goes, and it is enough. An
  // earlier draft searched the gap for the vertical line with the widest nearest
  // approach, on the theory that the waver bows the risers into the channel and
  // moves the best line off centre. It does bow them — but by the time the root
  // below converges, that search was worth 0.006 to one of the three climbs and
  // nothing at all to the other two, which is not what thirty lines are for.
  const stop = top - CLIMB_OVER;
  return [
    ...CLIMBS.map((t) => branch(under, gapX[t], UP, CLIMB_TURN, 0, gapX[t], stop)),
    ...DIVES.map((s) => branch(under, rightEdgeAt(s), DOWN, DIVE_TURN, DIVE_ARC, null, null)),
  ].filter(Boolean);
}
