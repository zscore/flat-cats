/**
 * checkers.js — the lozenge ground: a Bavarian checkerboard, made of cats,
 * assembling itself under the back half of the spiral.
 *
 * Seventeen and a half seconds, three sweeps, driven entirely by `since`:
 *
 *   TL→BR   a 45° lattice fills in from the top-left corner and clears behind
 *   TR→BL   again, finer, from the other corner
 *   L→R     again, coarser, straight across
 *   out     and last, from the middle outward, after the spiral has gone —
 *           the only sweep with no corner to start from, and the end of the
 *           whole sequence
 *
 * The pattern is the flag's: a checkerboard rotated 45°, so the cells are
 * diamonds. Worth writing down why the code has no rotation in it — take a
 * square grid of side C, turn it 45°, and keep the cells where (i+j) is even,
 * and those centres land on a plain axis-aligned lattice of spacing C√2. So the
 * lozenges are placed on a straight grid and it is the *cell*, not the grid,
 * that is turned: each one is a diamond clip with a cat drawn through it. The
 * odd cells are not drawn at all — the ground behind is the page, and the page
 * is black.
 *
 * A cat is scaled to cover its diamond rather than to fit inside it, the same
 * choice face.js makes about donor eyes and for the same reason: one that
 * merely fits leaves a rim of empty cell around it and the lattice stops
 * reading as a tiling.
 *
 * This is the only thing here that is deliberately hard to see. It is a ground
 * under a pinwheel, and at any alpha where it competes it is just noise.
 *
 * Like the other bursts it is a pure function of time — no counters, no rand(),
 * nothing carried between frames. Keep it that way.
 */

// It is handed the spiral's clock offset by half of spiral.js's 35, so the
// three directional sweeps run under the spiral's back half. The radial one
// then runs on past the spiral's end, which is why this is not 17.5: the
// lozenges are what the sequence finishes on, alone.
import { upright } from './frame.js';

export const BURST_LENGTH = 22.6;

// Each sweep gets its own grain as well as its own heading, so the four read as
// four patterns rather than as one pattern shoved about.
const SWEEPS = [
  { at: 0.0, dur: 6.4, dir: [1, 1], cell: 0.22 }, // top-left → bottom-right
  { at: 5.9, dur: 6.4, dir: [-1, 1], cell: 0.16 }, // top-right → bottom-left
  { at: 11.6, dur: 5.9, dir: [1, 0], cell: 0.29 }, // left → right
  // The last one is not a ground — by the time it runs there is nothing left
  // to be a ground under, so it is brighter, and it holds what it has arrived
  // at instead of clearing behind itself. It fills from the middle and then
  // the whole field fades at once, which is the end of the piece.
  { at: 17.0, dur: 5.6, dir: [1, 0], cell: 0.2, radial: true, gain: 2.6, hold: 3.2 },
];

const PEAK = 0.22; // the whole point is that this number is small
const IN = 0.1; // how much of a sweep a cell spends arriving …
const HOLD = 0.3; // … staying …
const OUT = 0.14; // … and leaving, all as fractions of the sweep

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ramp = (x, a, b) => smooth((x - a) / (b - a));

/** Deterministic hash → [0,1). Same shape as cats.js's; the grid must not flicker. */
function rand(seed) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** One lozenge: clip to the diamond, then cover it with a cat. */
function lozenge(ctx, x, y, half, img) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y - half);
  ctx.lineTo(x + half, y);
  ctx.lineTo(x, y + half);
  ctx.lineTo(x - half, y);
  ctx.closePath();
  ctx.clip();

  const box = 2 * half;
  const scale = Math.max(box / img.width, box / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  // A diamond is its own shape at any quarter turn, and the box is square, so
  // standing the cat up inside its cell changes the cat and leaves both the
  // lattice and the cover-scale above exactly as they were.
  ctx.translate(x, y);
  upright(ctx);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/**
 * One sweep. `s` is seconds into it. The front is a line travelling along
 * `dir`, and a cell's place in the queue is its distance along that direction,
 * normalised across the frame — which is all "from the top left" means.
 */
function sweep(ctx, W, H, s, cats, { dur, dir, cell, radial, gain = 1, hold = HOLD }, seq, layer) {
  const u = s / dur;
  if (u <= 0 || u >= 1) return;
  const span = IN + hold + OUT;
  const front = u * (1 + span);

  const [dx, dy] = dir;
  const ends = [
    [0, 0],
    [W, 0],
    [0, H],
    [W, H],
  ].map(([x, y]) => x * dx + y * dy);
  const lo = Math.min(...ends);
  const hi = Math.max(...ends);
  const reach = 0.5 * Math.hypot(W, H); // centre to corner, for the radial sweep

  const G = cell * Math.min(W, H);
  const half = (G / 2) * 0.97; // a hairline of black where the corners meet
  const cols = Math.ceil(W / G / 2) + 1;
  const rows = Math.ceil(H / G / 2) + 1;

  for (let m = -cols; m <= cols; m++) {
    for (let n = -rows; n <= rows; n++) {
      const x = W / 2 + m * G;
      const y = H / 2 + n * G;
      // A cell's place in the queue: how far along the heading it sits, or —
      // for the last sweep — how far out from the middle.
      const p = radial
        ? Math.hypot(x - W / 2, y - H / 2) / reach
        : (x * dx + y * dy - lo) / (hi - lo || 1);
      const c = front - p;
      const a = ramp(c, 0, IN) * (1 - ramp(c, IN + hold, span));
      if (a <= 0.004) continue;

      ctx.globalAlpha = layer * PEAK * gain * a;
      lozenge(ctx, x, y, half, cats[Math.floor(rand(m * 73856093 + n * 19349663 + seq * 83492791) * cats.length)]);
    }
  }
}

// How long the ground takes to go at the end, and with it the whole handover to
// the stars: cats.js opens them at exactly this far before the ground ends, so
// the grid starts fading on the frame the first star lands and the two cross
// over rather than following one another. Lengthening this lengthens the
// overlap. It is long for a fade because it is not really a fade, it is the
// last thing the piece does with two elements at once.
export const FADE_FOR = 3.2;

/** How present the ground is, 0…1 — its own fade, in and then out. */
function ground(since) {
  if (since < 0 || since > BURST_LENGTH) return 0;
  return ramp(since, 0, 0.8) * (1 - ramp(since, BURST_LENGTH - FADE_FOR, BURST_LENGTH));
}

/**
 * Draw the ground. `since` is seconds since it was triggered — cats.js hands it
 * the spiral's own clock, offset by half the spiral, so the two cannot drift.
 * Returns whether anything was drawn.
 *
 *   checkerBurst(ctx, W, H, t - spiral.at - 17.5, cats)
 */
export function checkerBurst(ctx, W, H, since, cats) {
  if (!cats.length) return false;
  const alpha = ground(since);
  if (alpha <= 0.004) return false;

  ctx.save();
  SWEEPS.forEach((s, i) => sweep(ctx, W, H, since - s.at, cats, s, i, alpha));
  ctx.restore();
  return true;
}
