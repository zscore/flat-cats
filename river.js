/**
 * river.js — the river of cats: one curve that changes its mind twice.
 *
 * Thirty-eight seconds of a single line of cats flowing left to right, driven
 * entirely by `since`, the seconds elapsed since the burst was triggered:
 *
 *   wave     a gentle sine, two and a half crests across the frame
 *   square   the wave stiffens into right angles — runs and risers, ten of them
 *   snake    the corners relax into a meander that never crosses itself
 *
 * The thing worth explaining is that these are not three shapes. They are one
 * shape with a different *heading*.
 *
 * The river is defined by θ(u): the direction it points at each fraction u of
 * the way along itself. Points come from integrating that — step du in the
 * direction θ, over and over. Because every step is the same length, u is arc
 * length, which is what makes the cats easy: evenly spaced in u is evenly
 * spaced along the river, whatever shape it is currently in, and the river's
 * whole on-screen length is one number.
 *
 * In the heading domain all three regimes are the same expression:
 *
 *   θ(u) = amp · [ (1-q)·sin(2πk u)  +  q·crenel(k u) ]
 *
 *   wave     amp 0.9,  k 2.5,  q 0    a sine-generated curve, shallow
 *   square   amp π/2,  k 10,   q 1    θ steps between 0 and ±π/2 — exact right
 *                                     angles, because a heading of ±π/2 *is* a
 *                                     right angle, not an approximation of one
 *   snake    amp 1.9,  k 4,    q 0    the same sine, deep enough to read as a
 *                                     meander
 *
 * So `square` costs one extra term, and morphing between the regimes is three
 * weights that sum to 1 — the river visibly stiffens and relaxes instead of
 * cross-dissolving between two pictures. Nothing is spawned or destroyed; the
 * cats stay on the curve while the curve changes underneath them.
 *
 * Why it doesn't cross itself: the sine regimes are sine-generated curves,
 * which are simple (non-self-intersecting) as long as the heading amplitude
 * stays under about 2.2 rad — past that the curve folds back through itself.
 * SNAKE_AMP is 1.9, which is inside that bound with room to spare, and the
 * wave is far below it. The crenel regime is monotone in x — it only ever moves
 * right or straight up and down, and the risers alternate — so it cannot cross
 * itself either. This is a bound that is kept, not a collision test that is run;
 * if you raise SNAKE_AMP past ~2.1 the guarantee is gone and the river will tie
 * a knot. tools/river-check.mjs measures it.
 *
 * Like draw() in viz.js, tailBurst() in tail.js, faceBurst() in face.js and
 * spiralBurst() in spiral.js this is a pure function of time — no counters, no
 * rand(), nothing carried between frames. Scrub back into the burst an hour
 * later and you get the identical frame. Keep it that way: `flow` in particular
 * is the *distance travelled*, in closed form, and not a speed anybody
 * integrates.
 */

export const BURST_LENGTH = 38; // seconds, start to nothing on screen

const SAMPLES = 1024; // points the curve is integrated at; sets how sharp a corner is
const FLOW = 0.055; // river lengths a cat travels per second — about 18s end to end
// Cats are a fixed size and the *count* follows the river's length, rather than
// a fixed count sized to fit. It has to be this way round: the square regime is
// nearly three times longer, end to end, than the wave, so a fixed count would
// grow the cats to fill it — exactly when the risers get short — and the right
// angles would blur into a thick band instead of reading as corners.
const CAT_H = 0.075; // cat height, as a fraction of frame height
const GAP = 0.055; // and the distance between them along the river, same units
const MAX_BEADS = 200; // backstop; the river asks for about 100 at its longest
const MARGIN_X = 0.07; // fraction of the frame kept clear on each side
const MARGIN_Y = 0.14; // and on top and bottom
const EDGE_FADE = 0.06; // fraction of the river over which a cat fades in and out

const WAVE_AMP = 0.9; // heading amplitude, radians
const WAVE_K = 2.5; // crests across the whole river
const CRENEL_K = 10; // right-angle cycles — ten of them, so twenty corners
// Fraction of a cycle spent running flat; the rest is risers. Low, because ten
// cycles across a frame gives each one a tenth of the width to spend, and a
// tooth has to be taller than it is wide to read as a tooth. At 0.28 the risers
// come out about two and a half cats tall and the runs about one cat wide.
const CRENEL_DUTY = 0.28;
const SNAKE_AMP = 1.9; // radians; stays under the ~2.2 that would fold the curve
const SNAKE_K = 4;
const TAU = Math.PI * 2;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ramp = (x, a, b) => smooth((x - a) / (b - a));

/**
 * A square wave in the heading: flat run, quarter turn up, flat run, quarter
 * turn down. Returns -1, 0 or +1 — the caller scales it, and at amp π/2 those
 * are exactly the right angles the shape is named for.
 */
function crenel(v) {
  const w = v - Math.floor(v);
  const run = CRENEL_DUTY / 2;
  if (w < run) return 0;
  if (w < 0.5) return 1;
  if (w < 0.5 + run) return 0;
  return -1;
}

/**
 * The whole score, as numbers, at `s` seconds in. The three regime weights sum
 * to 1 at every instant, so the river is always exactly one river; change the
 * timing here rather than anywhere below.
 */
function score(s) {
  const stiff = ramp(s, 9, 14); // wave → square
  const loose = ramp(s, 24, 29); // square → snake
  const wave = 1 - stiff;
  const square = stiff - loose;
  return {
    alpha: ramp(s, 0, 1.6) * (1 - ramp(s, 35, BURST_LENGTH)),
    amp: wave * WAVE_AMP + square * (Math.PI / 2) + loose * SNAKE_AMP,
    k: wave * WAVE_K + square * CRENEL_K + loose * SNAKE_K,
    q: square,
    // Distance travelled, not a speed: this is what keeps the burst scrubbable.
    flow: FLOW * s,
  };
}

/** Where the river points at fraction `u` along itself. */
function heading(u, p) {
  const v = p.k * u;
  return p.amp * ((1 - p.q) * Math.sin(TAU * v) + p.q * crenel(v));
}

/**
 * Integrate the heading into points, then fit the result to the frame. The fit
 * has to happen every frame because the shape's own proportions change a lot —
 * the folded-up square regime is nearly three times longer, end to end, than
 * the wave that precedes it, and without refitting it would walk off the side.
 */
function buildPath(W, H, p) {
  const xs = new Float64Array(SAMPLES + 1);
  const ys = new Float64Array(SAMPLES + 1);
  const ths = new Float64Array(SAMPLES + 1);
  const du = 1 / SAMPLES;

  let x = 0;
  let y = 0;
  let x0 = 0;
  let x1 = 0;
  let y0 = 0;
  let y1 = 0;
  for (let i = 0; i <= SAMPLES; i++) {
    xs[i] = x;
    ys[i] = y;
    ths[i] = heading(i * du, p);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    x += Math.cos(ths[i]) * du;
    y += Math.sin(ths[i]) * du;
  }

  const scale = Math.min(
    ((1 - 2 * MARGIN_X) * W) / Math.max(x1 - x0, 1e-6),
    ((1 - 2 * MARGIN_Y) * H) / Math.max(y1 - y0, 1e-6),
  );
  return {
    xs,
    ys,
    ths,
    scale,
    ox: W / 2 - ((x0 + x1) / 2) * scale,
    oy: H / 2 - ((y0 + y1) / 2) * scale,
  };
}

/**
 * Draw the river. `since` is seconds since it was triggered — negative or past
 * the end and nothing is drawn. `cats` is the image cast. Returns whether
 * anything was drawn.
 *
 *   riverBurst(ctx, canvas.width, canvas.height, t - 82, cats)
 */
export function riverBurst(ctx, W, H, since, cats) {
  if (since < 0 || since > BURST_LENGTH || !cats.length) return false;
  const p = score(since);
  if (p.alpha <= 0.001) return false;

  const path = buildPath(W, H, p);
  // Arc length is 1 in path units, so the river's whole on-screen length is
  // just `scale` — and how many cats fit on it at a fixed spacing is that over
  // the gap. The river gets longer as it folds, so it asks for more cats; the
  // extra ones arrive at the mouth, inside the fade, rather than popping in.
  const h = CAT_H * H;
  const step = (GAP * H) / path.scale;
  const beads = Math.min(MAX_BEADS, Math.floor(1 / step));

  ctx.save();
  ctx.globalAlpha = p.alpha;

  for (let i = 0; i < beads; i++) {
    const u = (i * step + p.flow) % 1;
    const f = u * SAMPLES;
    const j = Math.floor(f);
    const frac = f - j;
    const x = path.ox + (path.xs[j] + (path.xs[j + 1] - path.xs[j]) * frac) * path.scale;
    const y = path.oy + (path.ys[j] + (path.ys[j + 1] - path.ys[j]) * frac) * path.scale;
    const th = path.ths[j];

    const img = cats[(i * 7 + 3) % cats.length];
    const w = h * (img.width / img.height);

    ctx.save();
    // Fade at both ends, so a cat that reaches the mouth of the river leaves
    // rather than teleporting back to the source.
    ctx.globalAlpha = p.alpha * clamp01(u / EDGE_FADE) * clamp01((1 - u) / EDGE_FADE);
    ctx.translate(x, y);
    ctx.rotate(th);
    // Past a quarter turn the cat is heading backwards and lying on its back.
    // Mirroring across its own long axis puts its feet down again without
    // taking it off the line it is following.
    if (Math.cos(th) < 0) ctx.scale(1, -1);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  ctx.restore();
  return true;
}
