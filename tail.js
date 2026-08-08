/**
 * tail.js — the tail burst: one cat, one tail, and then a great deal of tail.
 *
 * Thirteen seconds of choreography driven entirely by `since`, the seconds
 * elapsed since the burst was triggered:
 *
 *   enter   a cat and its single tail
 *   split   the tail copies itself up and down the frame
 *   sway    every copy swings, each one lagging the one before it
 *   weave   the stack spreads and the copies cross through each other
 *   cull    every other copy drops out
 *   merge   what is left slides home and dissolves into the one tail
 *
 * Like draw() in viz.js this is a pure function of time — no counters, no
 * rand(), nothing carried between frames. Scrub back into the burst an hour
 * later and you get the identical frame. Keep it that way.
 */

export const BURST_LENGTH = 13.6; // seconds, start to nothing on screen

const COPIES = 9; // odd, so there is a middle tail to come home to
const SWAY_HZ = 0.42; // full swings per second
const TAU = Math.PI * 2;

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ramp = (x, a, b) => smooth((x - a) / (b - a));

/**
 * The whole score, as numbers, at `s` seconds in. Every stage is a ramp with
 * an explicit window, so the timing of the piece is readable in one place —
 * change a number here rather than anywhere below.
 */
function score(s) {
  const split = ramp(s, 0.9, 3.0);
  const weave = ramp(s, 5.0, 8.2);
  const merge = ramp(s, 10.3, 12.6);
  return {
    alpha: ramp(s, 0, 0.9) * (1 - ramp(s, 12.7, BURST_LENGTH)),
    // How present the copies are at all. They fade up as they separate and
    // dissolve at the end of the merge — without that, nine tails converging
    // on one spot composite into something denser than the tail we opened on.
    extra: ramp(s, 0.9, 2.2) * (1 - ramp(s, 11.5, 12.6)),
    // Vertical gap between neighbours, as a fraction of frame height: opens at
    // split, opens further at weave, closes to nothing at merge. The outermost
    // copy sits four gaps out and swings on top of that, so this has to stay
    // under about 0.075 or the ends of the stack leave the frame.
    spread: (0.038 + 0.037 * weave) * split * (1 - merge),
    // How far the tip swings, as a fraction of the tail's own length.
    swing: (0.11 * ramp(s, 2.4, 4.0) + 0.14 * weave) * (1 - 0.55 * merge),
    // Waves along a single tail. One is a swaying tail; three is a braid. The
    // merge unwinds this too — otherwise the tail we come home to is a zigzag,
    // not the tail we opened on.
    waves: 0.8 + 2.2 * weave * (1 - merge),
    // Phase owed by each copy to its neighbour. At zero the stack moves as one
    // slab; opened up, the copies cross each other and the weave appears.
    lag: (0.30 * split + 1.35 * weave) * (1 - merge),
    // Every other copy leaves.
    cull: ramp(s, 8.7, 10.0),
  };
}

// ---------------------------------------------------------------- geometry --

// Local space: the root sits at the origin, the tail runs out along +x, and the
// bend grows with u so the root stays put while the tip does the travelling.
function centreline(u, p) {
  // A resting arc that owes nothing to the swing, so the tail at 0.6s is a
  // tail hanging there rather than a rod sticking out of a cat.
  const rest = 0.07 * u * u;
  const bend = Math.sin(TAU * p.waves * u + p.phase) * p.swing * u;
  return [p.len * u, p.len * (rest + bend)];
}

// Thick at the root, tapering, rounded off rather than cut square at the tip.
function halfWidth(u, p) {
  return p.thick * (0.38 + 0.62 * (1 - u ** 1.6)) * Math.sqrt(Math.max(0, 1 - u ** 8));
}

/** Walk the centreline once, so a position along it can be found by distance. */
function walk(p) {
  const N = 48;
  const pts = [];
  let run = 0;
  for (let i = 0; i <= N; i++) {
    const [x, y] = centreline(i / N, p);
    if (i) run += Math.hypot(x - pts[i - 1].x, y - pts[i - 1].y);
    pts.push({ x, y, s: run, u: i / N });
  }
  return pts;
}

/** Where the centreline is, and which way it points, `s` pixels along it. */
function at(pts, s) {
  let i = 1;
  while (i < pts.length - 1 && pts[i].s < s) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const f = (s - a.s) / (b.s - a.s || 1);
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    u: a.u + (b.u - a.u) * f,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

/**
 * One tail, made of tails: real cat tails from the set, laid head to tail
 * along the centreline, each turned to face the way the big tail is going.
 *
 * They are placed by distance rather than by parameter, and each keeps its own
 * aspect ratio, so a stubby tail takes a short bite of the curve and a long one
 * takes a long bite. Squeezing them all into equal slots would flatten out the
 * thing that makes this worth doing — that they are visibly seven different
 * cats. They overlap by a quarter to hide the joins.
 */
function ribbon(ctx, p) {
  const pts = walk(p);
  const total = pts[pts.length - 1].s;

  for (let n = 0, s = 0; s < total && n < 24; n++) {
    const here = at(pts, s);
    // Deterministic, and different per copy, so no two of the stacked tails
    // are made of the same cats in the same order.
    const img = p.tails[(n * 3 + p.seq * 5 + 1) % p.tails.length];
    const h = 2 * halfWidth(here.u, p);
    const w = h * (img.width / img.height);
    const step = w * 0.75;
    // Each piece is drawn centred half a step ahead, so without this the chain
    // finishes a whole tail's length past the end of the curve it is following.
    if (s + w > total) break;

    ctx.save();
    ctx.translate(here.x + Math.cos(here.angle) * (step / 2), here.y + Math.sin(here.angle) * (step / 2));
    ctx.rotate(here.angle);
    if ((n + p.seq) % 2) ctx.scale(1, -1); // vary which way the fur curls
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
    s += step;
  }
}

// -------------------------------------------------------------------- draw --

/**
 * Draw the burst. `since` is seconds since it was triggered — negative or past
 * the end and nothing is drawn. Returns whether anything was.
 *
 *   tailBurst(ctx, canvas.width, canvas.height, t - 20, cat)
 */
export function tailBurst(ctx, W, H, since, cat, tails) {
  if (since < 0 || since > BURST_LENGTH || !tails.length) return false;
  const p = score(since);
  if (p.alpha <= 0.001) return false;

  const rootX = 0.32 * W;
  const rootY = 0.5 * H;
  // About twelve times as long as it is thick. Thinner than this and it reads
  // as a whisker; the cat beside it is the scale you are judging it against.
  const shape = { len: 0.44 * W, thick: 0.034 * H, waves: p.waves, swing: p.swing };

  ctx.save();
  for (let i = 0; i < COPIES; i++) {
    const rank = i - (COPIES - 1) / 2; // -4 … 4, the middle one being the original
    const odd = Math.abs(rank) % 2 === 1;
    const here = (rank === 0 ? 1 : p.extra) * (odd ? 1 - p.cull : 1);
    if (here <= 0.002) continue;

    ctx.save();
    // Outer copies sit back a little, so the stack reads as depth rather than
    // as nine equally insistent tails.
    ctx.globalAlpha = p.alpha * here * (0.55 + 0.45 / (1 + Math.abs(rank)));
    ctx.translate(rootX, rootY + rank * p.spread * H);
    ribbon(ctx, { ...shape, tails, seq: i, phase: TAU * SWAY_HZ * since + rank * p.lag });
    ctx.restore();
  }

  // The cat goes on last, over the roots of the middle copies.
  const h = 0.34 * H;
  const w = h * (cat.width / cat.height);
  ctx.globalAlpha = p.alpha;
  ctx.drawImage(cat, rootX - w * 0.62, rootY - h / 2, w, h);
  ctx.restore();
  return true;
}
