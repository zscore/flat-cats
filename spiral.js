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
 * packs and blooms with the first — one gesture, not two.
 *
 * It is only smaller until the bloom. Across the bloom it goes on growing past
 * where the first wheel's own growth would take it, out to the same size, so it
 * reaches the edges of the frame and leaves rather than sitting in the middle
 * while the first one goes. See scaleAt(): the pair open into one wheel on the
 * way out, and that — not the size difference — is the ending.
 *
 * The same beats that populate the wheels also swell them. Every beat picks one
 * cat already standing in each wheel and grows it to 1.6× and back inside a
 * second — pulse.js's envelope, the one the river and the moon's rings swell
 * their cats with, so the three read as the same gesture in different places.
 * The beat that lands a cat and the beat that swells one are the same beat, but
 * never on the same cat: the pool a beat chooses from is the slots that are on
 * frame and have finished fading in, which its own is not.
 *
 * Which beats populate either wheel is the caller's problem — cats.js reads them
 * off the MIDI and hands them over relative to the trigger. This module never
 * sees the song.
 *
 * Like draw() in viz.js, tailBurst() in tail.js and faceBurst() in face.js this
 * is a pure function of time — no counters, nothing carried between frames, and
 * the one rand() is a hash of a beat's index rather than a number drawn at draw
 * time. Scrub back into the burst an hour later and you get the identical frame,
 * with the same cat swelling on the same note. Keep it that way: `spin` in
 * particular is the *angle*, in closed form, and not a rate anybody integrates.
 */
import { swell, PULSE } from './pulse.js';

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
 *   opens   what that scale becomes by the end of the bloom. The inner wheel
 *           grows all the way out to the outer one's size and off the edges
 *           with it; the outer wheel opens to what it already was.
 *   seed    which cat lands on which slot; different, or the same cat shows up
 *           twice on the same spoke.
 */
export const WHEELS = {
  outer: { wind: 1, offset: 0, scale: 1, opens: 1, seed: 7 },
  inner: { wind: -1, offset: Math.PI / ARMS, scale: 0.55, opens: 1, seed: 11 },
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
    bloom, // the wheels open out on this as well as grow on it — see scaleAt()
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
 * How big `wheel` is drawn at `p`: its own size for most of the burst, opened
 * out to `opens` across the bloom.
 *
 * This is what makes the inner wheel leave. `pitch` already blows up under the
 * bloom, but it blows up by the same factor for both wheels, so a wheel held at
 * 0.55 opens at 0.55 the rate and is still sitting in the middle when the outer
 * one has gone — 84 cats against 36 at the moment the fade starts, measured. It
 * has to gain on the outer wheel rather than merely keep pace with it, and that
 * is one number rather than a second bloom of its own: by the end of the bloom
 * the two are the same size and clear the frame together, which is also the
 * ending that reads, the pair opening into one wheel on the way out.
 */
export const scaleAt = (p, wheel) => wheel.scale + (wheel.opens - wheel.scale) * p.bloom;

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
  const scale = scaleAt(p, wheel);
  return {
    r: scale * p.pitch * (j + 1) ** SPREAD,
    h: scale * p.size * (j + 1) ** -DEPTH,
    theta: (k % ARMS) * (TAU / ARMS) + wheel.offset + wheel.wind * WIND * Math.log1p(j) + p.spin,
  };
}

/** Deterministic hash → [0,1). The same cat has to swell on the same note. */
function rand(seed) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
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
 * The slots beat `i` may swell: the ones that are on frame *and* have finished
 * fading in, judged against the wheel as it stood when the note was struck
 * rather than as it stands now. They are always a run from the middle out —
 * radius grows with the slot — so this is a count and not a set.
 *
 * Both halves of that matter. Frame, because the arms run a long way past the
 * corner and most slots in the wheel are nowhere anybody can see. Faded in,
 * because the cat a beat lands is the cat that beat would otherwise be most
 * likely to pick, and it is drawn at nothing for the first ATTACK — a note
 * swelling an invisible cat is a note that did nothing.
 *
 * `edge` is in the units slot() works in, not pixels. Exported for the checker,
 * which counts the beats this leaves with nothing to choose from.
 */
export function pool(i, beats, wheel, edge) {
  const p = score(beats[i]);
  let n = 0;
  while (n <= i && beats[n] <= beats[i] - ATTACK) {
    const { r, h } = slot(n, p, wheel);
    if (r - h > edge) break; // off-frame, and so is every slot past it
    n++;
  }
  return n;
}

/**
 * How much bigger each slot of `wheel` is at `since`, keyed by slot. Empty most
 * of the time: a beat swells exactly one cat, and a swell is over in a second.
 * Exported alongside slot() so the checker draws the frame that gets drawn.
 */
export function swelling(since, beats, wheel, edge) {
  const grown = new Map();
  for (let i = arrived(beats, since) - 1; i >= 0 && since - beats[i] < PULSE; i--) {
    const extra = swell(since - beats[i]);
    if (extra <= 0) continue;
    const n = pool(i, beats, wheel, edge);
    if (!n) continue;

    // Two beats a third of a second apart can land on one slot; the bigger
    // swell wins rather than the two stacking, which would put one cat through
    // the roof every time the piece plays something dense.
    const k = Math.floor(rand(i * 131 + 3 + wheel.seed) * n);
    grown.set(k, Math.max(grown.get(k) ?? 0, extra));
  }
  return grown;
}

/**
 * One wheel's cats, at the frame `p` describes. `beats` populate it, on the
 * burst's clock; `view` is the frame it is being drawn into.
 */
function turn(ctx, view, p, since, beats, cats, wheel) {
  const { R, cx, cy, edge } = view;
  const grown = swelling(since, beats, wheel, edge / R);

  // Outermost first, so the cats nearest the middle land on top of the swarm
  // behind them. Radius grows with k, so counting k down is that order.
  for (let k = arrived(beats, since) - 1; k >= 0; k--) {
    // slot() works in fractions of the short side, so that one function serves
    // both the drawing and the checker; pixels happen here and nowhere else.
    const s = slot(k, p, wheel);
    const r = s.r * R;
    // The swell is on the cat and not on its slot: it grows where it stands,
    // so nothing around it moves and the wheel keeps its shape.
    const h = s.h * R * (1 + (grown.get(k) ?? 0));
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
