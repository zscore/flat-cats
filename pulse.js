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
 * always one contiguous run — and a few hashed candidates inside it are tried.
 * If none of them is in frame vertically too, the next course is asked, and only
 * when all three have nothing does the hit pass without a swell.
 *
 * Visible for the whole swell, not just at the hit: the cat swims on and the
 * frame pans on while it grows, so a candidate has to be in shot at both ends
 * of the pulse. Both halves of that were measured, and both were losing notes —
 * asking one course only dropped 32% of the score, and testing the hit alone
 * left another 6% growing off the edge of the frame.
 *
 * And visible is a distance, not a yes or a no. That was the third thing losing
 * notes, and the least obvious, because every one of them passed: a cat one
 * pixel inside the frame satisfies any test that only asks whether it is inside,
 * and the courses are not equally well placed to offer better. So the choosing
 * asks how far in, twice over — INSET is the width of the strip along each edge
 * that no cat is picked from at all, and of what is left, the roomiest of the
 * tries wins. Between them the score moved off the bottom edge and back into
 * the ribbon; both constants carry the counts they were set from.
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
// Hashed candidates per hit before giving the hit up. Swept: 8 drops six beats
// of the score that 16 keeps, and 32 keeps no more than 16 does — past here the
// misses are hits with nothing to choose from rather than hits that were
// unlucky, and more tries cannot help those.
const TRIES = 16;
// Keep the choice this far inside the frame. It was 0.06 — a swollen cat's own
// half-height, which is the bare minimum not to be clipped — and at that width
// the test was passing cats that scrape an edge as readily as cats in the middle
// of the picture. What that cost is not obvious until it is counted: the
// under-river runs from 0.03 to 0.81 below the frame's centre, so most of it is
// under the floor and the only part that qualified was the strip along the
// bottom edge. Half the score was being spent down there — river 88 of 255 beats
// against the under-river's 127, with 62 of the chosen cats inside 0.10 of an
// edge. Widening it takes that strip out of the running and those hits fall
// through to the river: at 0.10 it goes 88 → 106 at 16:9 and 82 → 113 at 4:3,
// with nothing chosen within 0.10 of an edge at either.
//
// What stops it here is the narrow window rather than the wide one, and it is a
// cliff and not a slope. The beats this costs are ones where nothing anywhere is
// far enough in, so they pass without a swell, and at 4:3 they arrive all at
// once: 9.8% of the score at 0.10 and 11.0% at 0.11, against pulse-check's 10%.
// Between those two the loss stops being the odd beat under the closing fade and
// becomes a hole from 60s to 63s with the burst still at full brightness. 0.12
// buys a further 106 → 134 at 16:9 and would be the better picture on a wide
// screen; it is not worth a three-second hole on a square one.
const INSET = 0.1;

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
 * How far inside the frame sample `i` of `course` sits — the distance to
 * whichever edge is nearest, in frame-heights, and negative if it is outside.
 *
 * A number rather than the yes/no this used to be, because the choosing wants to
 * tell two cats that both fit apart. One at 0.30 is in the middle of the picture
 * and one at 0.001 is a cat with the edge of the screen through its whiskers.
 */
function margin(course, i, camX, camY, halfW) {
  return Math.min(halfW - INSET - Math.abs(course.xs[i] - camX), 0.5 - INSET - Math.abs(course.ys[i] - camY));
}

/**
 * A place on `course` that is on screen, or null if this course has nothing in
 * frame worth picking. Returns the distance along the course, not an index.
 *
 * On screen for the whole pulse, not just at the hit. The cat goes on swimming
 * at `swim` per second while the frame goes on panning at `pan`, and on a
 * counter-current those add rather than cancel — better than half a frame-
 * height of travel in the second a swell lasts. Testing the hit alone put 6% of
 * the score on a cat that had left the frame by the time it finished growing.
 */
function somewhereVisible(course, camX, camY, halfW, seed, swim, pan, fade) {
  const { xs, n } = course;
  const rising = xs[n] > xs[0];
  const a = seek(xs, n, rising, camX - halfW + INSET);
  const b = seek(xs, n, rising, camX + halfW - INSET);
  const step = course.length / n; // arc length one sample covers
  // How far along its own samples the cat gets before the swell is over.
  const ahead = Math.round((swim * PULSE) / step);
  // Clear of the source and the mouth, where the course fades its cats in and
  // out, and still clear at the end of the pulse — the cat swims towards the
  // mouth while it grows. A cat inside that fade is drawn at a fraction of the
  // opacity its neighbours have, so swelling it is invisible beside them: at
  // one beat 42s into the burst the choosing took a cat at 2% opacity with 185
  // fully lit ones on screen. Being in the frame was never the whole of it.
  const lo = Math.max(Math.min(a, b), Math.ceil(fade / step));
  const hi = Math.min(Math.max(a, b), Math.floor((course.length - fade) / step) - ahead);
  if (hi <= lo) return null;

  // The best of the tries rather than the first that fits. Both are one pass and
  // the same TRIES hashes; the difference is only which of them is kept, and it
  // is the whole of how far from an edge the swelling cats end up — taking the
  // first acceptable one left 62 of 248 chosen cats inside 0.10 of an edge and a
  // median clearance of 0.144, and keeping the roomiest leaves none and 0.320.
  // Half of that is INSET's doing and half is this. It plateaus almost at once:
  // best-of-8 already reaches the clearance best-of-64 does, so TRIES above is
  // still set by the hit rate rather than by this.
  let best = null;
  let clearest = -1;
  for (let t = 0; t < TRIES; t++) {
    const i = lo + Math.floor(rand(seed + t * 7919) * (hi - lo));
    const here = margin(course, i, camX, camY, halfW);
    if (here < 0) continue;
    // And still in shot at the end of the pulse, which is the other half of it.
    const later = margin(course, Math.min(n, i + ahead), camX + pan * PULSE, camY, halfW);
    if (later < 0) continue;
    // The tighter of the two ends: a cat that starts in the middle and finishes
    // against the edge is not a roomy choice, whatever its first frame says.
    const clear = Math.min(here, later);
    if (clear > clearest) {
      clearest = clear;
      best = i;
    }
  }
  return best === null ? null : (best / n) * course.length;
}

/**
 * Which cats are mid-swell at `since`, and how much bigger each one is.
 *
 * `beats` are hit times relative to the burst, ascending. `frame` carries the
 * camera the caller drew with. The result is one map per course, bead index to
 * scale, empty where a course has nothing swelling — which is most of them most
 * of the time, since a hit picks exactly one cat.
 */
export function swells(since, beats, courses, frame, flow, gap, fade) {
  const out = courses.map(() => null);
  if (!beats.length) return out;

  // Only hits inside the last PULSE seconds are still live. Beats ascend, so
  // walk back from the first one past `since` rather than scanning all of them.
  let i = firstAfter(beats, since);
  for (i--; i >= 0 && since - beats[i] < PULSE; i--) {
    const age = since - beats[i];
    const scale = swell(age);
    if (scale <= 0) continue;

    // The hashed course is where the search starts, not where it stops. At most
    // moments in the burst one or two of the three are entirely out of shot —
    // the river arrives late, the under-river has long gone by then — so a hit
    // that asked its own course and gave up threw away a third of the score
    // against a frame with two hundred cats in it. Starting hashed keeps the
    // choice unbiased when they are all in view.
    const first = Math.floor(rand(i * 31 + 11) * courses.length);
    // Chosen against the frame as it was at the hit, not as it is now: the cat
    // that swells is the one that was in shot when the note was struck.
    const camX = frame.camX - frame.pan * age;
    let c = 0;
    let u = null;
    for (let j = 0; j < courses.length && u === null; j++) {
      c = (first + j) % courses.length;
      u = somewhereVisible(courses[c], camX, frame.camY, frame.halfW, i * 131 + 3, flow, frame.pan, fade);
    }
    if (u === null) continue;
    const course = courses[c];

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
