/**
 * pulse.js — one cat swells on every hit in the score.
 *
 * The river is a steady thing: one pan rate, one flow rate, nothing anywhere in
 * it that speeds up. This is the part that is not steady. Every hit in the MIDI
 * picks a single cat somewhere in the current frame and swells it — fast up,
 * slower down, gone inside a second — and the rest of the river carries on
 * exactly as it was.
 *
 * Three things this has to get right.
 *
 * VISIBLE. A hit that swells a cat which is off the top of a riser, or two
 * frames downstream, is a hit that does nothing. So the choosing is done
 * against the frame at the moment of the hit: the arc of each course that is
 * actually on screen is found by binary search — every course's x is monotonic,
 * the river's rising and the counter-currents' falling, so the visible part is
 * always one contiguous run — and a few hashed candidates inside it are tried
 * until one is in frame vertically too. If none is, the hit passes without a
 * swell rather than swelling something nobody can see.
 *
 * CONTINUOUS. The envelope is smoothstep either side of the peak, so it leaves
 * zero, arrives at the peak, and returns to zero with no corner at any of the
 * three — a cat starts growing from exactly the size it was and ends at exactly
 * the size it started. Nothing pops.
 *
 * PURE. Like everything else here this is a function of time and nothing else.
 * The cat a hit picks is hashed from the hit's index, and which bead that is
 * comes out of the same closed form the drawing uses — bead k sits at
 * (k·gap + flow·t) mod length — inverted for k. Scrub back an hour later and
 * the same cat swells on the same note. No counters, no rand() at draw time.
 */

export const PULSE = 1.0; // seconds, the whole swell — up, over, and back
const ATTACK = 0.18; // of which this much is the way up
export const MAX_SWELL = 0.6; // how much bigger at the peak: 1.6× its own size
const TRIES = 8; // hashed candidates per hit before giving the hit up
const INSET = 0.06; // keep the choice this far inside the frame, so a swelling
// cat grows into the picture rather than half off the edge of it

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Deterministic hash → [0,1). The same cat has to swell on the same note. */
function rand(seed) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * How much bigger a cat is, `age` seconds after the hit that picked it. Zero
 * outside the pulse, so this doubles as the test for whether a hit is still
 * live. Smoothstep both sides: no corner at the start, the peak or the end.
 */
export function swell(age) {
  if (age <= 0 || age >= PULSE) return 0;
  const x = age < ATTACK ? age / ATTACK : 1 - (age - ATTACK) / (PULSE - ATTACK);
  return MAX_SWELL * smooth(x);
}

/** First index at or past `target` along a monotonic run of x. */
function seek(xs, n, rising, target) {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rising ? xs[mid] < target : xs[mid] > target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * A place on `course` that is on screen, or null if this course has nothing in
 * frame worth picking. Returns the distance along the course, not an index.
 */
function somewhereVisible(course, camX, camY, halfW, seed) {
  const { xs, ys, n } = course;
  const rising = xs[n] > xs[0];
  const a = seek(xs, n, rising, camX - halfW + INSET);
  const b = seek(xs, n, rising, camX + halfW - INSET);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (hi <= lo) return null;

  for (let t = 0; t < TRIES; t++) {
    const i = lo + Math.floor(rand(seed + t * 7919) * (hi - lo));
    if (Math.abs(ys[i] - camY) > 0.5 - INSET) continue; // off the top or bottom
    return (i / n) * course.length;
  }
  return null;
}

/**
 * Which cats are mid-swell at `since`, and how much bigger each one is.
 *
 * `beats` are hit times relative to the burst, ascending. `frame` carries the
 * camera the caller drew with. The result is one map per course, bead index to
 * scale, empty where a course has nothing swelling — which is most of them most
 * of the time, since a hit picks exactly one cat.
 */
export function swells(since, beats, courses, frame, flow, gap) {
  const out = courses.map(() => null);
  if (!beats.length) return out;

  // Only hits inside the last PULSE seconds are still live. Beats ascend, so
  // walk back from the first one past `since` rather than scanning all of them.
  let i = firstAfter(beats, since);
  for (i--; i >= 0 && since - beats[i] < PULSE; i--) {
    const age = since - beats[i];
    const scale = swell(age);
    if (scale <= 0) continue;

    const c = Math.floor(rand(i * 31 + 11) * courses.length);
    const course = courses[c];
    // Chosen against the frame as it was at the hit, not as it is now: the cat
    // that swells is the one that was in shot when the note was struck.
    const u = somewhereVisible(course, frame.camX - frame.pan * age, frame.camY, frame.halfW, i * 131 + 3);
    if (u === null) continue;

    // Invert the bead's own closed form for k: bead k sits at
    // (k·gap + flow·t) mod length, so the bead that was at u when the hit
    // landed is this one, and it keeps swelling as it swims.
    const back = (((u - flow * beats[i]) % course.length) + course.length) % course.length;
    const k = Math.round(back / gap);

    if (!out[c]) out[c] = new Map();
    // Two hits can land on one cat; the bigger swell wins rather than stacking,
    // which would put a cat through the roof on a dense chord.
    out[c].set(k, Math.max(out[c].get(k) ?? 0, scale));
  }
  return out;
}

/** First beat strictly after `t`. */
function firstAfter(beats, t) {
  let lo = 0;
  let hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
