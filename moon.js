/**
 * moon.js — a crescent of cats around the back half of the tail burst.
 *
 * It rides the tail's clock rather than the song's, the way checkers.js rides
 * the spiral's: it comes up when the fan has finished growing, holds while the
 * fan holds, and fades once the tails have gone. Fifteen seconds of the burst,
 * and three more after it to leave on.
 *
 * The crescent is a lune — one circle with a second, slightly smaller circle
 * taken out of it and pushed to the left. Its cusps come out about a hundred
 * degrees either side of the belly, so they aim at the top left and the bottom
 * left, the lit side faces right, and the hollow it leaves opens back towards
 * the cat. That hollow is the point: the fan grows into it.
 *
 * WHAT THIS IS NOT is a moon-shaped hole with cats behind it. There is no clip
 * and no wash. The cats are laid along the crescent's spine one after another,
 * each sized to how thick the crescent is where it stands, and where they do
 * not quite meet you can see between them. It is a moon the way a line of
 * people holding hands is a circle — you read the shape and the individuals at
 * the same time, and losing either one would be losing the joke.
 *
 * A wave travels around it, and it is a wave in size and nothing else. No cat
 * ever moves: each one sits at a fixed angle and a fixed depth for the whole
 * burst and only swells and shrinks in place as the wave goes by. The crescent
 * is a still object with something passing through it, which is a different
 * thing from a crescent that undulates, and the difference is the whole look.
 *
 * The walk works its spacing out from the resting size, never the swollen one,
 * for the same reason: a chain that re-spaces itself every frame is a chain
 * whose cats change places every frame.
 *
 * Rings leave it every few seconds and expand away. They are made of distinct
 * cats — a fixed count per ring, so the ring thins as it grows rather than
 * recruiting more, and at every radius you can count the animals in it.
 *
 * The rings are also where the score goes while the moon is up. The per-note
 * cats stop scattering at exactly the moment it rises (plan.js, VOICES_UNTIL),
 * and from then until it goes every beat picks one cat in one ring and swells
 * it — pulse.js's envelope, the same one the river swells its cats with, so the
 * two read as the same gesture in different places. A beat that can only find a
 * cat off the edge of the frame passes without swelling anything.
 *
 * Like the bursts it is a pure function of time — no counters, no rand() at
 * draw time, nothing carried between frames. Scrub back into it an hour later
 * and you get the identical frame. Keep it that way.
 */

import { swell, PULSE } from './pulse.js';

// Fifteen seconds of the tail burst's second half, and three to fade out in —
// so the moon is still there as the last tails close, and goes after them.
export const BURST_LENGTH = 18;

const AT = [0.63, 0.47]; // centre of the moon, in fractions of the frame
const R = 0.3; // its radius, as a fraction of frame height
// The bite: a circle of BITE × R, pushed OFF × R to the left. Together these
// are the whole shape. Thickness at the belly is (1 - BITE + OFF) × R, so the
// two move against each other — raising OFF fattens the crescent, raising BITE
// thins it, and the cusps swing forward or back as either changes.
const BITE = 0.96;
const OFF = 0.3;

// One cat's resting height, as a fraction of R, and the same all the way round
// rather than scaled to the crescent. Sizing each cat to the thickness where it
// stands gives a moon of six huge cats at the belly and specks at the horns; a
// constant size instead means the belly is three cats deep and the horns are
// one, which is what makes the shape legible while the cats stay separate.
const CAT = 0.1;
const MIN_CAT = 0.04; // and the smallest one, at the horns, likewise
// Step along the arc, as a multiple of the cat's own width. Over 1, so at rest
// they stand apart and the moon is visibly a row of animals. The swell closes
// the gaps as the wave goes by and opens them again behind it.
const GAP = 1.15;
const WAVES = 2.5; // swells around the crescent at once
const WAVE_HZ = 0.16; // times per second the wave goes round
const SWELL = 0.5; // how much bigger a cat gets at the top of the wave
const FADE_IN = 2.5; // seconds to come up
const FADE_OUT = 3.0; // and to go, which happens after the tails have

const RING_EVERY = 4.0; // seconds between one ring leaving and the next
const RING_LIFE = 10.0; // seconds it takes to cross its reach and go
const RING_REACH = 2.0; // how far it gets, as a multiple of R
// Cats per ring, and fixed rather than worked out from the radius. Spacing them
// at a constant gap instead would have each ring recruit new cats as it grew,
// which reads as the ring filling in; a fixed count spreads the same animals
// further apart, which is what expanding actually looks like.
const RING_CATS = 22;
const RING_CAT = 0.09; // one of them, as a fraction of R
const TRIES = 8; // hashed candidates per hit before the hit is given up
// Keep the choice this far inside the frame, so a cat that has been picked
// swells into the picture rather than half off the edge of it.
const INSET = 0.04;

const TAU = Math.PI * 2;
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ramp = (x, a, b) => smooth((x - a) / (b - a));

/** Deterministic hash → [0,1). The chain has to survive a reload. */
function rand(seed) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The angle of a cusp, on the moon's own rim. Found rather than chosen:
 * subtracting the two circle equations leaves their crossing at a single x, and
 * the crescent is everything between -this and +this.
 */
function cusp(r) {
  const d = OFF * r;
  const b = BITE * r;
  const x = (b * b - r * r - d * d) / (2 * d);
  return Math.atan2(Math.sqrt(Math.max(0, r * r - x * x)), x);
}

/**
 * How far out the bite reaches along the ray at angle `th` — the inner edge of
 * the crescent there, so `r` minus this is its thickness. A quadratic in the
 * distance along the ray, which is the ray-circle intersection written out.
 */
function inner(th, r) {
  const d = OFF * r;
  const b = BITE * r;
  const s = d * Math.sin(th);
  return -d * Math.cos(th) + Math.sqrt(Math.max(0, b * b - s * s));
}

/**
 * Lay the cats around the crescent — a column of them at each step along the
 * arc, as many as the crescent is thick there. Walking by angle and stepping by
 * the cat's own width is the same walk ribbon() does along a tail in tail.js,
 * and for the same reason: the cats are different shapes, and giving each an
 * equal slot throws away the one thing worth having, which is that they are
 * visibly different animals.
 *
 * Everything the walk uses is the resting size, never the swollen one, so the
 * spacing, the depth and which cat stands where are the same at every moment of
 * the wave. Work the step out from the drawn size instead and the whole chain
 * re-spaces itself sixty times a second, and the cats change places as it does.
 */
function chain(ctx, r, s, cats) {
  const rim = cusp(r);

  let th = -rim;
  for (let col = 0, n = 0; th < rim && col < 90; col++) {
    const base = inner(th, r);
    const thick = r - base;
    // Where the crescent is thinner than a cat, the cat is what shrinks — that
    // is what brings the horns to a point instead of ending them square. The
    // floor matters as much as the taper: the walk starts at a cusp, where the
    // thickness is exactly zero, so without it the first cat has no size, the
    // step it would advance by is zero, and the moon never gets drawn at all.
    const size = Math.max(Math.min(CAT * r, thick), MIN_CAT * r);
    const rows = Math.max(1, Math.round(thick / size));
    const wave = Math.sin(TAU * (WAVES * ((th + rim) / (2 * rim)) - WAVE_HZ * s));

    let step = 0;
    for (let row = 0; row < rows; row++) {
      const img = cats[Math.floor(rand(n * 7 + 17) * cats.length)];
      const aspect = img.width / img.height;
      const h = size * (1 + SWELL * wave);
      const w = h * aspect;
      // Fixed: across the thickness, and nowhere else for the whole burst. The
      // wave is in `h` above and only there — this line does not know about it.
      const out = base + ((row + 0.5) / rows) * thick;

      ctx.save();
      ctx.translate(Math.cos(th) * out, Math.sin(th) * out);
      // A quarter turn past its own angle, so the cat's height lies across the
      // crescent and its width lies along it.
      ctx.rotate(th + Math.PI / 2);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();

      step = Math.max(step, size * aspect * GAP);
      n++;
    }
    th += step / ((base + r) / 2);
  }
}

/**
 * The rings, leaving the moon one every RING_EVERY seconds.
 *
 * Which ones are alive is worked out from `s` rather than remembered, which is
 * what keeps this a pure function of time: the window of ring numbers that can
 * still be on screen is bounded at both ends, so it is a short loop over the
 * few of them rather than a list that has to be kept between frames.
 *
 * Each is a ring of separate cats, drawn at their own size with nothing done to
 * them — no squashing along the ring, no additive blending, nothing that would
 * melt them into a band of light. A ring here is twenty-two cats you could name.
 */
/**
 * Where a ring cat sits, relative to the moon's centre — the one place this is
 * worked out, so the drawing and the choosing below cannot drift apart.
 */
function bead(n, i, age, r) {
  const rad = r * (1 + (RING_REACH - 1) * age);
  const a = (i / RING_CATS) * TAU + n * 0.9; // each ring turned off the last
  return { x: Math.cos(a) * rad, y: Math.sin(a) * rad, a };
}

/**
 * The ring cat a hit picks, or null if it could not find one worth picking.
 *
 * Chosen against the frame as it was at the moment of the hit, and required to
 * be on screen then: a hit that swells a cat which is already past the edge is
 * a hit that does nothing. Rings run well past the frame at full reach, so most
 * of the outer ones are off it, and without this test most notes would land on
 * something nobody can see. Candidates are hashed and tried in turn, and after
 * TRIES the hit is given up rather than forced somewhere visible — a note that
 * does nothing now and then is cheaper than one that always finds the middle.
 */
function pick(t, r, W, H, seed) {
  const cx = AT[0] * W;
  const cy = AT[1] * H;
  const first = Math.ceil((t - RING_LIFE) / RING_EVERY);
  const last = Math.floor(t / RING_EVERY);
  if (last < first) return null;

  for (let k = 0; k < TRIES; k++) {
    const n = first + Math.floor(rand(seed * 977 + k * 7919) * (last - first + 1));
    const age = (t - n * RING_EVERY) / RING_LIFE;
    if (age < 0 || age >= 1) continue;

    const i = Math.floor(rand(seed * 131 + k * 31 + 5) * RING_CATS);
    const at = bead(n, i, age, r);
    const x = cx + at.x;
    const y = cy + at.y;
    if (x < INSET * W || x > (1 - INSET) * W) continue;
    if (y < INSET * H || y > (1 - INSET) * H) continue;
    return n * 1000 + i;
  }
  return null;
}

/**
 * Which ring cats are mid-swell at `s`, and how much bigger each one is —
 * keyed the same way `pick` returns them, so the draw is a lookup.
 *
 * The envelope is pulse.js's, the one the river swells its cats with, rather
 * than another one that would be nearly the same: this is the same gesture
 * happening in a different place, and it should be the same shape.
 */
function swollen(s, beats, r, W, H) {
  const out = new Map();
  // Beats ascend, so walk back from the end: skip the ones still to come, take
  // the ones inside the pulse, and stop at the first that is already over.
  for (let i = beats.length - 1; i >= 0; i--) {
    const age = s - beats[i];
    if (age <= 0) continue;
    if (age >= PULSE) break;

    const scale = swell(age);
    const key = scale > 0 ? pick(beats[i], r, W, H, i + 1) : null;
    if (key === null) continue;
    // Two hits can land on one cat; the bigger swell wins rather than stacking,
    // which would put a cat through the roof on a dense chord.
    out.set(key, Math.max(out.get(key) ?? 0, scale));
  }
  return out;
}

function rings(ctx, r, s, cats, puffed) {
  for (let n = Math.ceil((s - RING_LIFE) / RING_EVERY); n * RING_EVERY <= s; n++) {
    const age = (s - n * RING_EVERY) / RING_LIFE;
    if (age < 0 || age >= 1) continue;
    // Out at a steady rate; up quickly as it leaves the moon, then away for the
    // rest of the crossing, so it arrives at its reach as nothing rather than
    // as a hoop that switches off.
    const rad = r * (1 + (RING_REACH - 1) * age);
    const lit = ramp(age, 0, 0.14) * (1 - age) ** 1.7;
    if (lit < 0.004) continue;

    for (let i = 0; i < RING_CATS; i++) {
      const at = bead(n, i, age, r);
      const img = cats[Math.floor(rand(n * 313 + i * 7 + 5) * cats.length)];
      // The hit, if this is the cat one picked. It goes on the drawn size and
      // nowhere else, so a swelling cat stays exactly where it was in the ring
      // and keeps travelling outward at the same rate as its neighbours.
      const h = RING_CAT * r * (1 + (puffed.get(n * 1000 + i) ?? 0));
      const w = h * (img.width / img.height);

      ctx.save();
      ctx.globalAlpha *= lit;
      ctx.translate(at.x, at.y);
      ctx.rotate(at.a + Math.PI / 2);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }
}

/**
 * The crescent, as a shape something else can be kept out of: the disc with the
 * bite still taken out of it, so the hollow reads as free frame rather than as
 * moon. The hollow is most of what this shape is for — it is where the fan
 * lives, and calling the whole disc occupied would hand back a moon twice the
 * size of the one on screen.
 *
 * The rings are deliberately not in here. They cross out to RING_REACH × R,
 * which is most of the frame, and they are a thin scatter of separate cats
 * rather than a surface — something passing behind them is not an overlap in
 * the way something behind the crescent is.
 */
export function keepClear(W, H) {
  const r = R * H;
  return [
    {
      kind: 'lune',
      x: AT[0] * W,
      y: AT[1] * H,
      r,
      bx: AT[0] * W - OFF * r,
      by: AT[1] * H,
      br: BITE * r,
      // Half a swollen cat. They stand on the crescent rather than inside it,
      // so at the top of the wave the moon reaches this far past its own rim —
      // and this far into its own hollow.
      pad: 0.5 * CAT * r * (1 + SWELL),
    },
  ];
}

/**
 * Draw the moon. `since` is seconds since it rose — negative or past the end
 * and nothing is drawn. Returns whether anything was drawn.
 *
 *   moonBurst(ctx, canvas.width, canvas.height, t - 20 - 15, cats)
 */
export function moonBurst(ctx, W, H, since, cats, beats = []) {
  if (since < 0 || since > BURST_LENGTH || !cats.length) return false;
  const alpha = ramp(since, 0, FADE_IN) * (1 - ramp(since, BURST_LENGTH - FADE_OUT, BURST_LENGTH));
  if (alpha <= 0.001) return false;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(AT[0] * W, AT[1] * H);
  // Behind, so they leave from under the moon.
  rings(ctx, R * H, since, cats, swollen(since, beats, R * H, W, H));
  chain(ctx, R * H, since, cats);
  ctx.restore();
  return true;
}
