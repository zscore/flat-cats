/**
 * stand.js — where the burst cat stands, and which way up.
 *
 * All of tail.js's placement, and none of its choreography. It was extracted
 * because the tall view roughly doubled it: the wide view needs one function
 * that puts a cat next to its fan, and the tall view needs that plus a quarter
 * turn about the join, plus an alignment along the canvas, plus the same
 * arithmetic again for the rectangle the scattered cats are kept out of. That is
 * a subject of its own, and tail.js was over its size ceiling carrying it.
 *
 * The split is by question, not by line count. Everything here answers "where is
 * the cat"; everything left in tail.js answers "what are the tails doing". The
 * fan is not in here at all — it hangs off `place.ax, ay` and `place.base`,
 * which is the whole interface between the two.
 *
 * One rule holds the tall view together: the join is the only fixed point. It is
 * where every tail leaves from, so it is what the cat turns about and what the
 * cat is aligned against, and nothing here is allowed to move it.
 */
import { ORIENT, TURN } from './frame.js';

// Where the cat sits, per view — a nudge along the *canvas*, in fractions of the
// cat's own height, x across the picture and y down it.
//
// Two views, two answers, and no formula that gives both. Wide, the cat sits
// beside its fan where it always has and zero means layout()'s original
// placement, untouched. Turned, it stands over the fan and zero means its
// trailing edge on the fan's centreline, which is what slide() works out. Both
// are meant to be moved by hand from there: change a number, render, look.
//
//   node tools/shoot.mjs 25.56          # wide
//   node tools/shoot.mjs 25.56 portrait # tall
//
// 25.56s is the instant the cat's lean is exactly zero, which is the honest
// moment to judge an alignment at — anywhere else the hip pivot has swung the
// top of the cat sideways and it reads as a placement error that is not there.
export const NUDGE = {
  landscape: { x: 0, y: 0 },
  portrait: { x: 0, y: 0 },
};

// The cat's height, as a fraction of the composition's. Note that the tall view
// measures this against the same wide frame, so the cat is the same size in the
// picture either way and simply has more room above and below it.
const CAT_H = 0.42;

/**
 * Where the cat goes, and where its tail leaves it. If its tail heads left the
 * whole cat is mirrored, so the fan always has the open half of the frame to
 * grow into rather than the edge.
 */
export function layout(W, H, cat) {
  const h = CAT_H * H;
  const w = h * (cat.img.width / cat.img.height);
  const flip = Math.cos((cat.heading * Math.PI) / 180) < 0;
  const rx = flip ? 1 - cat.root[0] : cat.root[0];
  const head = ((flip ? 180 - cat.heading : cat.heading) * Math.PI) / 180;

  // Position the join, not the cat: the join is what the fan is drawn around,
  // and where it lands in the frame is the only placement that matters. Doing
  // it the other way puts a cat whose tail leaves from low on its body — which
  // is most of them — in the corner with nowhere to fan into.
  // Well left of centre, which is further left than the fan alone would want:
  // the moon comes up around the back half of this burst and the fan has to sit
  // inside its hollow, so the whole thing is shifted to leave that room.
  const ax = 0.22 * W + Math.cos(head) * h * 0.10;
  const ay = 0.47 * H + Math.sin(head) * h * 0.10;
  return {
    w, h, flip, ax, ay,
    x: ax - rx * w - Math.cos(head) * h * 0.10,
    y: ay - cat.root[1] * h - Math.sin(head) * h * 0.10,
    base: head,
  };
}

/** The hand-set nudge for this view, in canvas pixels. */
export function nudge(place) {
  const n = NUDGE[ORIENT];
  return { x: n.x * place.h, y: n.y * place.h };
}

/**
 * How far the standing cat slides along the picture, and zero in the wide view.
 *
 * Standing the cat up left the join — the point every tail leaves from — sitting
 * out in the middle of its body, so the fan came out of the cat's flank. This
 * slides the body along until its trailing edge is on the fan's own centreline,
 * which puts the join at the corner of the cat and the tails under the end of
 * it. Nothing vertical moves: after upright() the local frame is square with the
 * canvas, so this is a move along the canvas's horizontal and only that.
 *
 * The edge is the cat's, not the picture's. `cat.box` is the opaque part of the
 * cutout, and on the burst cat a quarter of the width down the right-hand side
 * is empty — line the *image* up with the fan instead and the cat lands a
 * quarter of itself too far over, which is a large and completely invisible
 * error, because the thing you are aligning to has nothing drawn in it.
 */
export function slide(place, cat) {
  if (!TURN) return 0;
  // Mirrored, the far edge of the cutout is the near edge of the cat.
  const far = place.flip ? 1 - cat.box.x0 : cat.box.x1;
  return place.ax - (place.x + far * place.w);
}

/**
 * The box the cat's body actually occupies.
 *
 * In the tall view the cat stands up about its own join — it is the one thing in
 * the burst that does, and the reason is that a fan is a gesture and a cat is an
 * animal: the tails read fine lying over, and the animal underneath them does
 * not. Turning it about the join rather than about its middle is what keeps the
 * fan attached, because the join is the single point every tail leaves from.
 *
 * A quarter turn about a corner-of-nothing sends an upright box to another
 * upright box, so this stays a plain rect — width and height swap and the corner
 * moves. keepClear() and the drawing both come through here so they cannot drift
 * apart: clear the scattered cats out of a rectangle the cat is no longer in and
 * the burst opens a hole beside itself and sits somewhere else.
 */
export function bodyBox(place, cat) {
  const n = nudge(place);
  // Wide, the canvas and the composition are the same thing.
  if (!TURN) return { x: place.x + n.x, y: place.y + n.y, w: place.w, h: place.h };
  // Turned, a move across the canvas is a move along the composition, and a move
  // down the canvas is a move back across it — so the two swap and one flips.
  return {
    // Across the picture: untouched by the slide, which is the whole point of
    // doing it along the canvas rather than along the composition.
    x: place.ax + (place.y - place.ay) + n.y,
    // Along it: where the quarter turn put the picture's trailing edge, less
    // the slide. This stays the whole image box and not the cat inside it —
    // clearance wants the generous answer, and only the alignment above wants
    // the exact one.
    y: place.ay - (place.x + place.w - place.ax) - slide(place, cat) - n.x,
    w: place.h,
    h: place.w,
  };
}
