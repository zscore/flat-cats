/**
 * walk.js — the meander the per-note cats follow through the intro.
 *
 * For the first few measures the cats land where their velocity puts them: a
 * scatter about the middle, wide for the quiet notes and tight for the loud
 * ones. From four measures in they stop being a scatter and start being a
 * trail — each note placed where a cat roaming the frame happens to be at that
 * moment, so the notes draw a path across the screen rather than a cloud.
 *
 * A roaming cat is not a Lissajous figure and not a random jump. It is:
 *
 *   - a heading that wanders rather than a destination that is chosen. Each
 *     waypoint is one step on from the last, turned by a little, which is why
 *     the path doubles back and crosses itself instead of touring the frame;
 *   - stop and go. It walks for a second or three, stands somewhere for a
 *     second, then goes again — and it eases out of and into every stop, so the
 *     pauses are part of the gait and not gaps in it;
 *   - walls it turns away from, not walls it stops at.
 *
 * Everything here is a pure function of (seed, time). The path is built once and
 * asked where the cat is; nothing accumulates, so scrubbing back to 9s an hour
 * later puts the same cats in the same places.
 *
 * The units are fractions of the frame, both axes, like everything cats.js
 * places. That means a step is a wider move across a wide window than it is a
 * tall one — which is what you want: a cat in a wider room walks wider.
 */

// Tuned against tools/walk-check.mjs, and against one number in particular: how
// much of the frame the walk gets round in the twelve seconds it has. At a
// gentler turn and rate it covered a third of the width and read as tighter
// than the scatter it replaces, which is the one thing it must not be.
const STEP = 0.085; // frame fractions between waypoints
const TURN = 1.0; // radians the heading may wander, either way, per waypoint
const RATE = 2.5; // waypoints per second while actually walking
const MOVE = [1.1, 2.9]; // seconds of walking between stops
const STOP = [0.35, 1.1]; // seconds of standing still

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smooth = (s) => s * s * (3 - 2 * s); // ease out of a stop and into the next

/** Deterministic hash → [0,1), same one the rest of the modules use. */
function rand(seed) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Where the cat is, `dt` seconds into the walk.
 *
 * `box` is the region its centre stays inside, {x0, x1, y0, y1} in frame
 * fractions. The caller sets it, because how much room the walk needs depends on
 * what else the caller hangs off the path.
 */
export function createWalk({ span, box, seed = 0 }) {
  const legs = schedule(span, seed);
  const pts = waypoints(Math.ceil(legs[legs.length - 1].u1) + 3, box, seed);

  return {
    at(dt) {
      const leg = legs.find((l) => dt < l.t1) ?? legs[legs.length - 1];
      const u = leg.u0 + (leg.u1 - leg.u0) * smooth(clamp((dt - leg.t0) / (leg.t1 - leg.t0), 0, 1));
      return point(pts, u);
    },
    // For tools/walk-check.mjs to draw. Nothing in the animation reads these.
    pts,
    legs,
  };
}

/**
 * The gait: alternating walks and stops, as a map from time to distance along
 * the path. A walk covers `RATE` waypoints a second give or take a third, so the
 * cat is not metronomic about how far it gets before it stops again.
 */
function schedule(span, seed) {
  const legs = [];
  const pick = ([lo, hi], k) => lo + (hi - lo) * rand(seed + k);
  for (let i = 0, t = 0, u = 0; t < span; i++) {
    const walk = pick(MOVE, i * 31 + 5);
    const du = walk * RATE * (0.65 + 0.7 * rand(seed + i * 31 + 6));
    legs.push({ t0: t, t1: t + walk, u0: u, u1: u + du });
    t += walk;
    u += du;
    const stand = pick(STOP, i * 31 + 7);
    legs.push({ t0: t, t1: t + stand, u0: u, u1: u });
    t += stand;
  }
  return legs;
}

/**
 * The path's corners: one step on from the last, turned by a little.
 *
 * It starts in the middle of the frame because that is where the four measures
 * before it left off — the scatter is densest about the centre — so the switch
 * from one to the other is the cat wandering off from where it already was, and
 * not a cut to somewhere else. Only the heading is rolled.
 */
function waypoints(n, box, seed) {
  let x = (box.x0 + box.x1) / 2;
  let y = (box.y0 + box.y1) / 2;
  let th = rand(seed + 17) * 2 * Math.PI;
  const pts = [{ x, y }];

  for (let i = 1; i < n; i++) {
    th += (rand(seed + i * 97 + 23) - 0.5) * 2 * TURN;
    // A wall turns the cat rather than stopping it: mirror the heading in that
    // wall and take the step again. Corners mirror in both, which is why this is
    // two ifs and not an else — and the clamp is only a backstop for a step so
    // shallow it lands outside twice.
    let nx = x + STEP * Math.cos(th);
    let ny = y + STEP * Math.sin(th);
    if (nx < box.x0 || nx > box.x1) {
      th = Math.PI - th;
      nx = x + STEP * Math.cos(th);
      ny = y + STEP * Math.sin(th);
    }
    if (ny < box.y0 || ny > box.y1) {
      th = -th;
      nx = x + STEP * Math.cos(th);
      ny = y + STEP * Math.sin(th);
    }
    x = clamp(nx, box.x0, box.x1);
    y = clamp(ny, box.y0, box.y1);
    pts.push({ x, y });
  }
  return pts;
}

/**
 * Position `u` waypoints along the path. Catmull-Rom, so the path goes through
 * every waypoint and rounds every corner — a cat changing direction turns, and
 * a polyline's hard corners would read as teleporting between headings.
 */
function point(pts, u) {
  const i = clamp(Math.floor(u), 0, pts.length - 2);
  const f = clamp(u - i, 0, 1);
  const p0 = pts[Math.max(0, i - 1)];
  const p1 = pts[i];
  const p2 = pts[i + 1];
  const p3 = pts[Math.min(pts.length - 1, i + 2)];
  const spline = (a, b, c, d) =>
    0.5 * (2 * b + (c - a) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f * f * f);
  return { x: spline(p0.x, p1.x, p2.x, p3.x), y: spline(p0.y, p1.y, p2.y, p3.y) };
}
