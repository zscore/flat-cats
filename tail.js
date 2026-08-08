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
    // split, opens further at weave, closes to nothing at merge.
    spread: (0.050 + 0.055 * weave) * split * (1 - merge),
    // How far the tip swings, as a fraction of the tail's own length.
    swing: 0.11 * ramp(s, 2.4, 4.0) + 0.14 * weave,
    // Waves along a single tail. One is a swaying tail; three is a braid.
    waves: 0.8 + 2.2 * weave,
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
  const bend = Math.sin(TAU * p.waves * u + p.phase) * p.swing * u;
  return [p.len * u, p.len * bend];
}

// Thick at the root, tapering, rounded off rather than cut square at the tip.
function halfWidth(u, p) {
  return p.thick * (0.38 + 0.62 * (1 - u ** 1.6)) * Math.sqrt(Math.max(0, 1 - u ** 8));
}

/** One tail, as a filled polygon: out along one edge, back along the other. */
function ribbon(ctx, p) {
  const N = 32;
  const pts = [];
  for (let i = 0; i <= N; i++) pts.push(centreline(i / N, p));

  ctx.beginPath();
  for (let side = 0; side < 2; side++) {
    for (let k = 0; k <= N; k++) {
      const i = side ? N - k : k;
      const [ax, ay] = pts[Math.max(0, i - 1)];
      const [bx, by] = pts[Math.min(N, i + 1)];
      const dx = bx - ax;
      const dy = by - ay;
      const m = Math.hypot(dx, dy) || 1;
      const w = halfWidth(i / N, p) * (side ? -1 : 1);
      const x = pts[i][0] - (dy / m) * w;
      const y = pts[i][1] + (dx / m) * w;
      if (side === 0 && k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.fill();
}

// -------------------------------------------------------------------- draw --

/**
 * Draw the burst. `since` is seconds since it was triggered — negative or past
 * the end and nothing is drawn. Returns whether anything was.
 *
 *   tailBurst(ctx, canvas.width, canvas.height, t - 20, cat)
 */
export function tailBurst(ctx, W, H, since, cat) {
  if (since < 0 || since > BURST_LENGTH) return false;
  const p = score(since);
  if (p.alpha <= 0.001) return false;

  const rootX = 0.32 * W;
  const rootY = 0.5 * H;
  const shape = { len: 0.52 * W, thick: 0.021 * H, waves: p.waves, swing: p.swing };

  ctx.save();
  ctx.fillStyle = '#c7bfb4';
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
    ribbon(ctx, { ...shape, phase: TAU * SWAY_HZ * since + rank * p.lag });
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
