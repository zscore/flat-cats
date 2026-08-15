/**
 * course.js — turning a heading into a curve you can walk along at a steady pace.
 *
 * Lifted out of river.js, which had grown past the point where the shape of the
 * river and the machinery for building any shape at all were readable in one
 * sitting. Nothing here knows what a river is, how wide it is, or what swims
 * along it: it takes a function θ(u) and gives back a polyline you can sample.
 *
 * The idea is the one river.js is built on. A curve defined by its *heading*
 * rather than its position — θ(u) is the direction it points at each distance u
 * along itself — is integrated by stepping du in the direction θ, over and over.
 * Because every step is the same length, u comes out as arc length, and that is
 * the property everything downstream leans on: evenly spaced in u is evenly
 * spaced along the curve, through corners and all. Anything placed by u keeps
 * one pace whatever the curve is doing.
 *
 * STEP lives here rather than with the shapes because it is a property of the
 * integration and not of any curve — though it does set the finest corner a
 * curve can hold, so a shape with corners tighter than this will not get them.
 *
 * Pure, like everything it serves: same θ in, same samples out, no state.
 */

// The integration step, in whatever units θ's argument is measured in.
export const STEP = 1 / 96;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Integrate a heading into a course. `θ` is the direction at distance u along
 * the curve, `length` is how much of it to build, (`ox`, `oy`) is where it
 * starts, and `lanes` is carried along untouched for whoever draws it.
 *
 * Depends on nothing but its arguments — no canvas, no aspect — so a course is
 * a fixed thing in a fixed world and every frame is a window onto it.
 */
export function makeCourse(θ, length, ox = 0, oy = 0, lanes = 1) {
  const n = Math.ceil(length / STEP);
  const xs = new Float64Array(n + 1);
  const ys = new Float64Array(n + 1);
  const ths = new Float64Array(n + 1);
  let x = ox;
  let y = oy;
  let x0 = Infinity;
  let x1 = -Infinity;
  for (let i = 0; i <= n; i++) {
    xs[i] = x;
    ys[i] = y;
    ths[i] = θ(i * STEP);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    x += Math.cos(ths[i]) * STEP;
    y += Math.sin(ths[i]) * STEP;
  }
  return { xs, ys, ths, n, x0, x1, length, lanes };
}

/** A course's point and heading at distance `u`, interpolated between samples. */
export function at(course, u) {
  const f = clamp01(u / course.length) * course.n;
  const i = Math.min(course.n - 1, Math.floor(f));
  const t = f - i;
  return {
    x: course.xs[i] + (course.xs[i + 1] - course.xs[i]) * t,
    y: course.ys[i] + (course.ys[i + 1] - course.ys[i]) * t,
    th: course.ths[i],
  };
}

/**
 * How far a sine-generated curve advances along its own axis per unit of arc —
 * the Bessel function J₀ of the heading amplitude, which is the mean of
 * cos(a·sin θ). Callers need it to work out how much arc a course must be given
 * to cover a wanted width, so a short series is plenty.
 */
export function bessel0(a) {
  let term = 1;
  let sum = 1;
  for (let k = 1; k < 12; k++) {
    term *= -((a * a) / 4) / (k * k);
    sum += term;
  }
  return sum;
}
