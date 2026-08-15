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
 * Which beats those are is the caller's problem — cats.js reads them off the
 * MIDI and hands them over relative to the trigger. This module never sees the
 * song.
 *
 * Like draw() in viz.js, tailBurst() in tail.js and faceBurst() in face.js this
 * is a pure function of time — no counters, no rand(), nothing carried between
 * frames. Scrub back into the burst an hour later and you get the identical
 * frame. Keep it that way: `spin` in particular is the *angle*, in closed form,
 * and not a rate anybody integrates.
 */

export const BURST_LENGTH = 35; // seconds, start to nothing on screen

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
function score(s) {
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
 * Draw the burst. `since` is seconds since it was triggered — negative or past
 * the end and nothing is drawn. `beats` is the beat times that populate it, in
 * seconds from the trigger, ascending. `cats` is the image cast. Returns
 * whether anything was drawn.
 *
 *   spiralBurst(ctx, canvas.width, canvas.height, t - 127, beats, cats)
 */
export function spiralBurst(ctx, W, H, since, beats, cats) {
  if (since < 0 || since > BURST_LENGTH || !beats.length || !cats.length) return false;
  const p = score(since);
  if (p.alpha <= 0.001) return false;

  const R = Math.min(W, H);
  const cx = W / 2;
  const cy = H / 2;
  const edge = 0.5 * Math.hypot(W, H); // corner distance: past this is off-frame

  ctx.save();
  ctx.globalAlpha = p.alpha;

  // Outermost first, so the cats nearest the middle land on top of the swarm
  // behind them. Radius grows with k, so counting k down is that order.
  for (let k = arrived(beats, since) - 1; k >= 0; k--) {
    const j = Math.floor(k / ARMS); // how far along its arm this slot sits
    const r = p.pitch * R * (j + 1) ** SPREAD;
    const h = p.size * R * (j + 1) ** -DEPTH;
    if (r - h > edge) continue; // off-frame, and there is a lot of off-frame

    const img = cats[(k * 7 + 3) % cats.length];
    const w = h * (img.width / img.height);
    const theta = (k % ARMS) * (TAU / ARMS) + WIND * Math.log1p(j) + p.spin;

    ctx.save();
    ctx.globalAlpha = p.alpha * clamp01((since - beats[k]) / ATTACK);
    ctx.translate(cx + Math.cos(theta) * r, cy + Math.sin(theta) * r);
    ctx.rotate(LEAN * theta);
    if (k % 2) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  ctx.restore();
  return true;
}
