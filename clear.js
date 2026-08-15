/**
 * clear.js — keeping the per-note cats out of the bursts' way, and out of each
 * other's.
 *
 * cats.js scatters one cat per note across the frame. The tail burst then puts
 * a fan of nine tails and a crescent moon through the middle of that, and the
 * two have to share. This is the sharing: given the shapes the burst occupies,
 * move each cat along its own row until it is clear of them, and drop the ones
 * whose row has no room left.
 *
 * Then the cats have to share with each other, which `settle()` at the bottom
 * does. Ten cats are on screen at once on average and eighteen at the peak, and
 * before that pass 423 of the 567 of them spent some part of their life more
 * than half-buried under another one. The two passes run in that order and not
 * the other: the burst is a shape a cat may not be inside, while another cat is
 * only a shape it would rather not be inside.
 *
 * Two rules do most of the work here, and both are worth stating out loud.
 *
 * **Height is never touched.** A cat's height is its note's degree, which is the
 * one thing on screen that means anything. A cat moves sideways or it does not
 * move, and where sideways runs out it goes rather than lands somewhere that
 * lies about its pitch.
 *
 * **Placement happens once, not per frame.** The shapes handed in are each
 * burst's footprint over its whole life, not its footprint at one moment, so a
 * cat cleared against them is cleared for as long as it is on screen. Clearing
 * against the instantaneous shape instead would be tighter, and would also have
 * every cat drifting sideways under a fan that sways — which is a worse thing
 * to look at than the overlap it would be avoiding.
 *
 * A shape is one of three kinds, and each burst says which of them it occupies:
 *
 *   rect    {x, y, w, h}                 an image box
 *   wedge   {x, y, base, half, r}        a fan of tails from a join
 *   lune    {x, y, r, bx, by, br}        a disc with a bite out of it
 *
 * all with a `pad` they want kept clear on top of their own extent.
 */

/**
 * Whether a cat of half-diagonal `m` centred at (px, py) touches `shape`.
 *
 * The cat is treated as the circle its box fits inside rather than as the box,
 * so one number inflates every shape and there is no per-kind box maths. It
 * over-clears by about a fifth of the cat's width, which is roughly the
 * transparent margin the cutouts carry anyway.
 */
export function hits(shape, px, py, m) {
  const pad = shape.pad + m;

  if (shape.kind === 'rect') {
    return px > shape.x - pad && px < shape.x + shape.w + pad && py > shape.y - pad && py < shape.y + shape.h + pad;
  }

  if (shape.kind === 'lune') {
    // Inside the disc and outside the bite. The bite shrinks by the same pad
    // the disc grows by, so the hollow stays free frame with a margin rather
    // than free frame right up to the cats standing along its edge.
    return (
      Math.hypot(px - shape.x, py - shape.y) < shape.r + pad &&
      Math.hypot(px - shape.bx, py - shape.by) > shape.br - pad
    );
  }

  const d = Math.hypot(px - shape.x, py - shape.y);
  if (d > shape.r + pad) return false; // past the tips
  if (d < pad) return true; // at the join every direction is inside the fan
  // Widening by the pad costs more angle the nearer the join you are, which is
  // what a fan of tails with thickness actually occupies. asin and not atan:
  // what has to clear the pad is the distance from the cat to the outermost
  // tail measured square to that tail, and at `d` from the join that distance
  // is d·sin(off − half). atan solves the wrong triangle and under-clears by a
  // few pixels — enough that five cats came out touching the fan.
  const turn = Math.atan2(py - shape.y, px - shape.x) - shape.base;
  const off = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))); // to ±π
  return off < shape.half + Math.asin(pad / d);
}

const SCAN = 256; // candidate positions across the frame, per cat that needs one

/** A cat's drawn half-width and half-height, in pixels. */
function half(s, H) {
  const hh = (s.size * H) / 2;
  return { hw: hh * (s.img.width / s.img.height), hh };
}

/**
 * Place every cat that shares the frame with the burst. Mutates each sprite's
 * `x` and `hidden` and returns how many of each happened.
 *
 * The plan is the burst, described:
 *
 *   fan          shapes up for the whole window
 *   moon, moonAt shapes up only from `moonAt` — a cat that has come and gone
 *                before then is placed against `fan` alone, which is the whole
 *                first half of the burst and where most of the room is
 *   from, until  the window a cat has to be clear for; outside it there is
 *                nothing on screen to be clear of
 *   edge         how near the frame's sides a cat's centre may sit
 */
export function reflow(sprites, W, H, { fan, moon, moonAt, from, until, edge }) {
  const both = [...fan, ...moon];
  let moved = 0;
  let dropped = 0;

  for (const s of sprites) {
    s.x = s.home;
    s.hidden = false;
    if (s.t > until || s.t + s.life < from) continue;

    const shapes = s.t + s.life <= moonAt ? fan : both;
    const { hw, hh } = half(s, H);
    const m = Math.hypot(hw, hh);
    const y = s.y * H;
    const free = (x) => !shapes.some((sh) => hits(sh, x * W, y, m));
    if (free(s.home)) continue;

    // Nearest free spot on the row, either side. A whole-row scan rather than a
    // walk outwards: the free space can be two separate runs — one each side of
    // the moon — and the nearer one is not always the one the cat drifted from.
    let best = -1;
    for (let i = 0; i <= SCAN; i++) {
      const x = edge + (1 - 2 * edge) * (i / SCAN);
      if (!free(x)) continue;
      if (best < 0 || Math.abs(x - s.home) < Math.abs(best - s.home)) best = x;
    }

    if (best < 0) {
      s.hidden = true;
      dropped++;
    } else {
      s.x = best;
      moved++;
    }
  }

  return { moved, dropped };
}

// ------------------------------------------------------- cats against cats --

/**
 * How much two boxes are allowed to reach into each other before they count as
 * touching. The cutouts carry a transparent margin of their own, so the drawn
 * box overstates the cat inside it; separating on the full box leaves visible
 * gutters between cats that are not actually near each other.
 */
const SNUG = 0.82;

/**
 * The overlap between a cat placed at `x` and one already placed, as a fraction
 * of the smaller cat's area. Zero when they are clear.
 *
 * Rows never move, so the vertical part of this is fixed per pair and only the
 * horizontal part depends on the candidate — which is what makes scanning a row
 * cheap enough to do for every cat.
 */
function overlap(a, ax, b, W, H) {
  const A = half(a, H);
  const B = half(b, H);
  const oy = (A.hh + B.hh) * SNUG - Math.abs(a.y - b.y) * H;
  if (oy <= 0) return 0;
  const ox = (A.hw + B.hw) * SNUG - Math.abs(ax - b.x) * W;
  if (ox <= 0) return 0;
  return (ox * oy) / Math.min(4 * A.hw * A.hh, 4 * B.hw * B.hh);
}

/**
 * Move cats off each other, along their rows. Mutates `x`; returns how many
 * moved and how many are still overlapping something once everything has been
 * placed.
 *
 * Run after `reflow()`, and it does not undo it: a candidate position that is
 * inside the burst is rejected outright, so the worst this can do to a cat the
 * fan pushed aside is leave it where the fan put it.
 *
 * **A cat is never hidden here.** `reflow()` drops a cat with nowhere to stand
 * because a cat inside the fan is a mistake on screen; two cats touching is
 * only untidy, and a note losing its cat entirely is worse than untidy. So
 * where a row cannot be untangled the least-bad position wins and the overlap
 * stays — counted, in `crowded`, rather than swept up.
 *
 * Greedy, in time order: a cat avoids the ones already on screen rather than
 * every cat it will ever meet. Placement is still settled once and for all, so
 * nothing slides around at draw time; the order only decides who yields to whom,
 * and the older cat keeping its place is the one that reads as stable.
 *
 * `hold` is a window this keeps its hands off: [from, to) in song seconds. The
 * walk through the intro is one — there the cats are placed along a path on
 * purpose, being close together is the whole picture, and measured over that
 * stretch this pass moved 135 of 143 cats an average of a quarter of the frame
 * width. It emptied the trail to empty the overlap count. A cat inside the
 * window is still an obstacle to the cats outside it, because it is still on
 * screen; it is immovable, not invisible.
 */
export function settle(sprites, W, H, { edge, until, blocked, hold = [0, 0] }) {
  let nudged = 0;
  let crowded = 0;
  let live = [];

  for (const s of sprites) {
    if (s.t > until) break; // sorted by t, so nothing later is on screen either
    if (s.hidden) continue; // reflow dropped it; it is neither moved nor in the way

    if (s.t >= hold[0] && s.t < hold[1]) {
      live.push(s); // in the way of others, but not to be moved itself
      continue;
    }

    // Everything that has left the screen before this cat arrives is not a
    // neighbour. Lives vary from a third of a second to two and a half, so this
    // is a filter and not a queue.
    live = live.filter((b) => b.t + b.life > s.t);
    // Only the ones whose rows are near enough to reach this one can ever score.
    const { hh } = half(s, H);
    const near = live.filter((b) => Math.abs(b.y - s.y) * H < (hh + half(b, H).hh) * SNUG);
    if (!near.length) {
      live.push(s);
      continue;
    }

    const cost = (x) => near.reduce((a, b) => a + overlap(s, x, b, W, H), 0);
    const here = cost(s.x);
    if (here > 0) {
      // Nearest position that costs less than standing still. Ties go to the
      // place the note and the burst between them already chose, so a cat that
      // has nothing to gain does not wander.
      let best = s.x;
      let bestCost = here;
      for (let i = 0; i <= SCAN; i++) {
        const x = edge + (1 - 2 * edge) * (i / SCAN);
        if (blocked(s, x)) continue;
        const c = cost(x);
        if (c < bestCost - 1e-6 || (c < bestCost + 1e-6 && Math.abs(x - s.x) < Math.abs(best - s.x))) {
          best = x;
          bestCost = c;
        }
      }
      if (best !== s.x) {
        s.x = best;
        nudged++;
      }
      if (bestCost > 0) crowded++;
    }

    live.push(s);
  }

  return { nudged, crowded };
}

/**
 * The test `settle()` needs to keep its hands off the burst: is a cat at `x`
 * inside the shapes `reflow()` just cleared it of? Built from the same plan, so
 * the two passes cannot disagree about where the burst is.
 */
export function blocker(W, H, { fan, moon, moonAt, from, until }) {
  const both = [...fan, ...moon];
  return (s, x) => {
    if (s.t > until || s.t + s.life < from) return false; // burst not on screen with it
    const shapes = s.t + s.life <= moonAt ? fan : both;
    const { hw, hh } = half(s, H);
    return shapes.some((sh) => hits(sh, x * W, s.y * H, Math.hypot(hw, hh)));
  };
}
