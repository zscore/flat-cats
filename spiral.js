/**
 * spiral.js — the spiral burst: a pinwheel that the score populates itself.
 *
 * Thirty-five seconds driven entirely by `since`, the seconds elapsed since the
 * burst was triggered:
 *
 *   arrive   one cat lands per beat, on three arms winding out of the centre
 *   turn     the whole wheel starts around, slowly, then not slowly
 *   pack     the arms draw in and every cat shrinks, so the slots that were
 *            off-frame come back into it and the wheel fills up from the edges
 *   bloom    the arms throw open, everything scales up, and all but the few
 *            cats nearest the middle leave the frame
 *   go
 *
 * The populating is the part worth explaining. Every beat in the window owns a
 * slot on an arm for the whole burst — slot k sits at radius pitch·(k/3+1)^0.62
 * — and `pitch` is the only thing that moves it. So the same two numbers do all
 * the work: shrink the pitch and cats crowd toward the middle while distant
 * slots that were never on screen sail in from outside; blow the pitch back up
 * and they all leave together. Nothing is spawned, nothing is destroyed, and
 * "more cats come in from the edges" is a consequence of the arm contracting
 * rather than a thing that had to be arranged.
 *
 * Eight seconds in, a second wheel starts populating inside the first: the same
 * wheel again at a little over half the size, on the same centre, off the same
 * clock, and turning the same way. Two things make it read as threaded through
 * the first rather than laid on top of it — its arms are wound the *other* way,
 * so the two sets of arms cross, and it starts half an arm-gap round, so its
 * arms leave the centre in the gaps the first one's leave. Turning the same way
 * is what keeps the pair one object; counter-turning reads as two things
 * fighting over the same middle. It shares every number in score() below, so it
 * packs and blooms and leaves with the first — one gesture, not two.
 *
 * Which beats populate either wheel is the caller's problem — cats.js reads them
 * off the MIDI and hands them over relative to the trigger. This module never
 * sees the song.
 *
 * Like draw() in viz.js, tailBurst() in tail.js and faceBurst() in face.js this
 * is a pure function of time — no counters, no rand(), nothing carried between
 * frames. Scrub back into the burst an hour later and you get the identical
 * frame. Keep it that way: `spin` in particular is the *angle*, in closed form,
 * and not a rate anybody integrates.
 */

export const BURST_LENGTH = 35; // seconds, start to nothing on screen
// Seconds into the burst that the inner wheel starts filling. Held here rather
// than as a moment in the song because the two wheels share a clock: move the
// spiral and this moves with it. With the spiral at 127.0s it lands at ~135s.
export const INNER_AT = 8;

const ARMS = 3; // fewer reads as a whirlpool, more as a disc with no arms
const WIND = 1.25; // radians an arm turns per e-fold of distance along it
const SPREAD = 0.62; // how fast radius grows with position along an arm
const TURNS = 2.6; // full turns the wheel makes, start to end
const DEPTH = 0.16; // how much smaller a cat gets for being further out
const ATTACK = 0.45; // seconds a cat takes to fade in when its beat lands
// How much of the arm's own angle a cat leans by. At 1 they lie tangent to the
// spiral, which is a true pinwheel and also puts a third of the cast upside
// down; this is the fraction that still reads as swirl.
const LEAN = 0.35;
const TAU = Math.PI * 2;

/**
 * The two wheels, as the only four numbers that differ between them. Everything
 * else — the score, the arm count, the winding rate, the lean — they share, so
 * the second wheel is not a second design to keep in step with the first.
 *
 *   wind    which way the arms curl. Opposite signs is what makes them cross.
 *   offset  where arm 0 leaves the centre. Half an arm-gap puts the inner
 *           wheel's arms in the outer's gaps.
 *   scale   applied to pitch and size together, so the inner wheel is the outer
 *           one photographed smaller rather than a denser wheel of small cats.
 *   seed    which cat lands on which slot; different, or the same cat shows up
 *           twice on the same spoke.
 */
export const WHEELS = {
  outer: { wind: 1, offset: 0, scale: 1, seed: 7 },
  inner: { wind: -1, offset: Math.PI / ARMS, scale: 0.55, seed: 11 },
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ramp = (x, a, b) => smooth((x - a) / (b - a));
// Zero rate at both ends, not just zero value — the wheel has to start from
// rest and come to rest, and smooth() alone leaves a visible jolt at each end.
const smoother = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (x * 6 - 15) + 10));

/**
 * The whole score, as numbers, at `s` seconds in. Every stage is a ramp with an
 * explicit window, so the timing of the piece is readable in one place — change
 * a number here rather than anywhere below.
 */
export function score(s) {
  const pack = ramp(s, 5.5, 24.0);
  const bloom = ramp(s, 25.5, 33.0);
  return {
    alpha: ramp(s, 0, 1.0) * (1 - ramp(s, 33.5, BURST_LENGTH)),
    // The turn, as an angle. Slow to start, quickest through the packing, and
    // braked to a stop under the bloom so the last few cats hold still to grow.
    spin: TAU * TURNS * smoother(clamp01(s / BURST_LENGTH)),
    // Radius of the first slot, as a fraction of the short side. At 0.30 only
    // about eight slots per arm are on screen and the rest of the beats land
    // outside it; at 0.078 the whole window fits, which is the packed picture.
    // The bloom opens it again — but only by 3.2, not by the 7 that reads
    // properly on paper: at 7 the arms clear the frame faster than the cats
    // can grow and the piece ends on three strays in the corners.
    pitch: (0.2 - 0.122 * pack) * (1 + 2.2 * bloom),
    // Height of a cat in the same units, on the same two-stage shape, so cats
    // and spacing shrink together and the wheel keeps its density. The bloom
    // outruns the pitch, which is what makes the last stage read as growth
    // rather than as the wheel simply leaving.
    size: (0.2 - 0.145 * pack) * (1 + 3.5 * bloom),
  };
}

/**
 * Where slot `k` of `wheel` sits under the score `p`, in fractions of the short
 * side — radius from the centre, height of the cat, and the angle it stands at.
 *
 * Exported because it is the whole geometry of the piece in six lines, and a
 * checker that re-implemented it would be checking its own arithmetic rather
 * than what gets drawn. tools/spiral-check.mjs calls this one.
 */
export function slot(k, p, wheel) {
  const j = Math.floor(k / ARMS); // how far along its arm this slot sits
  return {
    r: wheel.scale * p.pitch * (j + 1) ** SPREAD,
    h: wheel.scale * p.size * (j + 1) ** -DEPTH,
    theta: (k % ARMS) * (TAU / ARMS) + wheel.offset + wheel.wind * WIND * Math.log1p(j) + p.spin,
  };
}

/** How many beats have landed by `since`. Beats are ascending; binary search. */
function arrived(beats, since) {
  let lo = 0;
  let hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= since) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * One wheel's cats, at the frame `p` describes. `beats` populate it, on the
 * burst's clock; `view` is the frame it is being drawn into.
 */
function turn(ctx, view, p, since, beats, cats, wheel) {
  const { R, cx, cy, edge } = view;

  // Outermost first, so the cats nearest the middle land on top of the swarm
  // behind them. Radius grows with k, so counting k down is that order.
  for (let k = arrived(beats, since) - 1; k >= 0; k--) {
    // slot() works in fractions of the short side, so that one function serves
    // both the drawing and the checker; pixels happen here and nowhere else.
    const s = slot(k, p, wheel);
    const r = s.r * R;
    const h = s.h * R;
    if (r - h > edge) continue; // off-frame, and there is a lot of off-frame

    const img = cats[(k * wheel.seed + 3) % cats.length];
    const w = h * (img.width / img.height);

    ctx.save();
    ctx.globalAlpha = p.alpha * clamp01((since - beats[k]) / ATTACK);
    ctx.translate(cx + Math.cos(s.theta) * r, cy + Math.sin(s.theta) * r);
    ctx.rotate(LEAN * s.theta);
    if (k % 2) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

/**
 * Draw the burst. `since` is seconds since it was triggered — negative or past
 * the end and nothing is drawn. `beats` is the beat times that populate the
 * outer wheel, in seconds from the trigger, ascending, and `inner` the ones
 * that populate the inner one, on the same clock and so starting part-way up.
 * `cats` is the image cast. Returns whether anything was drawn.
 *
 *   spiralBurst(ctx, canvas.width, canvas.height, t - 127, beats, cats, inner)
 */
export function spiralBurst(ctx, W, H, since, beats, cats, inner = []) {
  if (since < 0 || since > BURST_LENGTH || !beats.length || !cats.length) return false;
  const p = score(since);
  if (p.alpha <= 0.001) return false;

  const view = {
    R: Math.min(W, H),
    cx: W / 2,
    cy: H / 2,
    edge: 0.5 * Math.hypot(W, H), // corner distance: past this is off-frame
  };

  ctx.save();
  ctx.globalAlpha = p.alpha;
  turn(ctx, view, p, since, beats, cats, WHEELS.outer);
  // Second, and so on top: the inner wheel lives entirely in the crowded middle,
  // and drawn first it would spend the packed stretch buried under the outer
  // wheel's own centre.
  turn(ctx, view, p, since, inner, cats, WHEELS.inner);
  ctx.restore();
  return true;
}
