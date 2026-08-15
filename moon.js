/**
 * moon.js — a crescent moon, made of cats, over the back half of the piece.
 *
 * Unlike the other four this is not a burst. It has no choreography and nothing
 * grows out of it: it comes up once, near the middle of the piece, and is still
 * there at the end. The river runs under it, the spiral turns under it and the
 * lozenges assemble under it, and none of the three know it is there. That is
 * the job — a fixed thing to measure the moving ones against.
 *
 * The crescent is a lune: one circle with a second, slightly smaller circle
 * taken out of it and pushed to the left. Its two cusps come out at about a
 * hundred degrees either side of the rightmost point, so they aim at the top
 * left and the bottom left of the frame and the lit belly faces right.
 *
 * It is made of cats because everything here is made of cats. They are packed
 * on a jittered grid, each scaled to cover its cell rather than fit inside it —
 * the same choice checkers.js makes about lozenges and face.js about donor
 * eyes, and for the same reason: a cat that merely fits leaves a rim of gap
 * around itself and the thing stops reading as a surface. The clip does the
 * shaping; the wash over the top is what turns forty tabbies into moonlight.
 *
 * Two things move around it. Sparkles blink on their own clocks, and ripples
 * leave the rim every few seconds and cross three moons' worth of sky before
 * they go. Both are cats too, drawn with `lighter` the way twinkle.js draws its
 * stars, so they add light to the black rather than sitting on top of it.
 *
 * Like the bursts it is a pure function of time — no counters, no rand(),
 * nothing carried between frames. Scrub back into it an hour later and you get
 * the identical frame. Keep it that way.
 */

// 85s to the end of the 170.5s piece. Not a burst length so much as the length
// of the second half, which is what it was asked to cover.
export const BURST_LENGTH = 86;

const AT = [0.78, 0.25]; // centre of the moon, in fractions of the frame
const R = 0.15; // its radius, as a fraction of frame height
// The bite: a circle of BITE × R, pushed OFF × R to the left. Together these
// are the whole shape. Thickness at the belly is (1 - BITE + OFF) × R, so the
// two move against each other — raising OFF fattens the crescent, raising BITE
// thins it, and the cusps swing forward or back as either changes.
const BITE = 0.96;
const OFF = 0.3;
const CELL = 0.24; // cat grid spacing inside the crescent, as a fraction of R
const JITTER = 0.6; // how far off its cell a cat may sit, as a fraction of one
// Cat height as a multiple of the cell. Well over 1, and not because of the
// grid: a cat cutout is mostly transparent inside its own box, so cats sized to
// their cells leave the crescent half empty and the wash over the gaps reads as
// flat grey. They have to overlap heavily before the surface looks packed.
const COVER = 2.4;
const WASH = 'rgba(238, 241, 252, 0.5)'; // moonlight, laid over the fur
const GLOW = 0.5; // how far the halo carries past the rim, as a fraction of R
const FADE = 5.0; // seconds to come up at the start and go down at the end

const SPARKS = 26; // how many twinkles are scattered around the moon
const FIELD = 2.7; // how far out they scatter, as a multiple of R
const BLINK = [3.2, 7.4]; // seconds per twinkle, shortest and longest
// The power the twinkle is raised to. A plain sine spends half its cycle lit
// and reads as a lamp being dimmed; at this exponent it is dark nearly all the
// time and the lit part is a blink.
const SPIKE = 7;
const GLINT = 0.1; // a twinkle's size, as a fraction of R

const RING_EVERY = 4.5; // seconds between one ripple and the next
const RING_LIFE = 13.0; // seconds a ripple takes to cross its reach and go
const RING_REACH = 3.0; // how far it gets, as a multiple of R
const BEAD = 0.11; // one bead of a ripple, as a fraction of R
// Spacing, likewise — well under one bead's length, so consecutive beads
// overlap by about half. Anything wider and the ring reads as a row of ticks
// on a dial rather than as a band of light.
const BEAD_GAP = 0.13;
const BEAD_LONG = 1.8; // stretched this much along the ring
const BEAD_FLAT = 0.5; // and squashed this much across it
const TAU = Math.PI * 2;

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ramp = (x, a, b) => smooth((x - a) / (b - a));

/** Deterministic hash → [0,1). The packing has to survive a reload. */
function rand(seed) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The crescent, as a path at the origin, for a moon of radius `r`.
 *
 * Both cusps are where the two circles cross, so they are found rather than
 * chosen: subtracting the circle equations leaves the crossing at a single x,
 * and the rest is which way round to walk the two arcs. Out along the moon's
 * own rim through its rightmost point, then back along the bite through the
 * bite's rightmost point — the second one anticlockwise, because that arc is
 * travelled in the opposite direction to the first.
 */
function crescent(ctx, r) {
  const d = OFF * r;
  const b = BITE * r;
  const x = (b * b - r * r - d * d) / (2 * d);
  const y = Math.sqrt(Math.max(0, r * r - x * x));
  const rim = Math.atan2(y, x); // cusp, as an angle on the moon's own rim
  const cut = Math.atan2(y, x + d); // the same cusp, as an angle on the bite

  ctx.beginPath();
  ctx.arc(0, 0, r, -rim, rim, false);
  ctx.arc(-d, 0, b, cut, -cut, true);
  ctx.closePath();
}

/** Is a cat at (x, y) close enough to the crescent to be worth drawing? */
function near(x, y, r, slack) {
  return Math.hypot(x, y) < r + slack && Math.hypot(x + OFF * r, y) > BITE * r - slack;
}

/**
 * Pack the crescent with cats. The grid is walked by index rather than by
 * position so every cell's jitter, cat and size come off its own seed and stay
 * put between frames. Cells the crescent cannot reach are skipped before the
 * draw — the clip would throw them away anyway, and there are four of those for
 * every one that lands.
 */
function fill(ctx, r, cats) {
  const cell = CELL * r;
  const n = Math.ceil((2 * r) / cell);

  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const k = j * (n + 1) + i;
      const x = -r + i * cell + (rand(k) - 0.5) * cell * JITTER;
      const y = -r + j * cell + (rand(k + 977) - 0.5) * cell * JITTER;
      if (!near(x, y, r, cell)) continue;

      const img = cats[Math.floor(rand(k + 5081) * cats.length)];
      const h = cell * COVER * (0.85 + 0.3 * rand(k + 313));
      const w = h * (img.width / img.height);

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rand(k + 1741) * Math.PI * 2); // no shared up, so no grain
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }
}

/**
 * The ripples: rings of light leaving the moon, one every RING_EVERY seconds.
 *
 * Which rings are alive is worked out from `s` rather than remembered, which is
 * what keeps this a pure function of time — the window of ring numbers that can
 * still be on screen is bounded at both ends, so it is a short loop over the
 * few of them rather than a list that has to be kept.
 *
 * They are made of cats for the same reason the moon is, and drawn the way
 * twinkle.js draws its stars: `lighter`, so each one adds its light to the black
 * instead of covering it, and the ones that overlap on the ring make it brighter
 * where it is denser. Small enough and packed enough and they stop being cats
 * and become a line of light.
 */
function ripples(ctx, r, s, cats) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  for (let n = Math.ceil((s - RING_LIFE) / RING_EVERY); n * RING_EVERY <= s; n++) {
    const age = (s - n * RING_EVERY) / RING_LIFE;
    if (age < 0 || age >= 1) continue;
    // Out at a steady rate, but lit only briefly: up quickly as it leaves the
    // rim, then away for the rest of the crossing. A ring that held its
    // brightness to the end would arrive at the edge of the frame as a hoop.
    const rad = r * (1 + (RING_REACH - 1) * age);
    const lit = ramp(age, 0, 0.12) * (1 - age) ** 1.8;
    if (lit < 0.004) continue;

    const beads = Math.round((TAU * rad) / (r * BEAD_GAP));
    for (let i = 0; i < beads; i++) {
      const a = (i / beads) * TAU + n * 0.7; // each ring turned off the last
      const img = cats[Math.floor(rand(n * 131 + i + 47) * cats.length)];
      // Laid along the ring and flattened across it. A round bead at this size
      // is a speck and a chain of specks is a dotted circle; a flattened one is
      // a dash, and dashes this close together are a line.
      const h = r * BEAD * (0.7 + 0.6 * rand(n * 977 + i));
      const w = h * (img.width / img.height) * BEAD_LONG;

      ctx.save();
      ctx.globalAlpha *= lit;
      ctx.translate(Math.cos(a) * rad, Math.sin(a) * rad);
      // A quarter turn past the bead's own angle. Rotating by the angle alone
      // leaves the bead's long axis pointing straight out from the moon, and a
      // ring of those is a set of bristles rather than a band.
      ctx.rotate(a + Math.PI / 2);
      ctx.drawImage(img, -w / 2, (-h * BEAD_FLAT) / 2, w, h * BEAD_FLAT);
      ctx.restore();
    }
  }
  ctx.restore();
}

/**
 * The sparkles: cats scattered around the moon, each blinking on its own clock.
 *
 * Every one is a fixed point with a fixed period and a fixed phase, all three
 * off its own seed, so the field never repeats and never drifts. Nothing here
 * accumulates — at any `s` the whole sky is recomputed, which is the only way
 * scrubbing backwards lands on the frame it landed on the first time.
 */
function sparkles(ctx, r, s, cats) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  for (let i = 0; i < SPARKS; i++) {
    const period = BLINK[0] + (BLINK[1] - BLINK[0]) * rand(i + 233);
    const beat = Math.sin(TAU * (s / period + rand(i + 887)));
    if (beat <= 0) continue;
    const lit = beat ** SPIKE;
    if (lit < 0.01) continue;

    // sqrt on the radius, so the scatter is even over the area it covers rather
    // than crowded against the moon the way a flat pick would leave it.
    const a = rand(i + 11) * TAU;
    const rad = r * (0.95 + (FIELD - 0.95) * Math.sqrt(rand(i + 601)));
    const img = cats[Math.floor(rand(i + 5417) * cats.length)];
    const h = r * GLINT * (0.6 + 0.8 * rand(i + 1459)) * (0.45 + 0.55 * lit);
    const w = h * (img.width / img.height);

    ctx.save();
    ctx.globalAlpha *= lit;
    ctx.translate(Math.cos(a) * rad, Math.sin(a) * rad);
    ctx.rotate(rand(i + 2731) * TAU);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Draw the moon. `since` is seconds since it rose — negative or past the end
 * and nothing is drawn. Returns whether anything was drawn.
 *
 *   moonBurst(ctx, canvas.width, canvas.height, t - 85, cats)
 */
export function moonBurst(ctx, W, H, since, cats) {
  if (since < 0 || since > BURST_LENGTH || !cats.length) return false;
  const alpha = ramp(since, 0, FADE) * (1 - ramp(since, BURST_LENGTH - FADE, BURST_LENGTH));
  if (alpha <= 0.001) return false;

  const r = R * H;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(AT[0] * W, AT[1] * H);

  // Rings first, so they pass behind the moon rather than over it.
  ripples(ctx, r, since, cats);

  // A halo next, so the moon sits in its own light rather than being pasted
  // onto the black. Shaped by casting the crescent's own shadow rather than by
  // a radial gradient: a gradient is a disc, and a disc behind a crescent fills
  // the dark side back in and reads as a full moon with a bite out of it.
  ctx.save();
  crescent(ctx, r);
  ctx.shadowColor = 'rgba(226, 232, 246, 0.5)';
  ctx.shadowBlur = r * GLOW;
  ctx.fillStyle = 'rgba(226, 232, 246, 0.28)';
  ctx.fill();
  ctx.fill(); // twice: one pass of shadow is thinner than the moon deserves
  ctx.restore();

  ctx.save();
  crescent(ctx, r);
  ctx.clip();
  fill(ctx, r, cats);
  // The cats are a texture, not a subject. Without this they stay forty
  // separate animals in the shape of a moon instead of becoming its surface.
  ctx.fillStyle = WASH;
  ctx.fillRect(-r, -r, 2 * r, 2 * r);
  ctx.restore();

  // And the sparkles last, over everything including the moon itself — some of
  // them land on it, which is what stops the crescent reading as a cut-out.
  sparkles(ctx, r, since, cats);

  ctx.restore();
  return true;
}
