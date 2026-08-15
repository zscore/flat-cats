/**
 * frame.js — which way up the picture is.
 *
 * The composition is landscape and stays landscape. Portrait does not lay it out
 * again; it paints the same wide picture into a tall canvas turned a quarter
 * turn clockwise, and then stands the cats back up one at a time. Every burst
 * still asks for W and H and still gets a wide frame, so the river's camera, the
 * spiral's radius and the checkerboard's grain are the numbers they always were.
 * There is one composition here, not two that have to be kept in step — which is
 * the only reason a second aspect is affordable at all.
 *
 * The turn is clockwise, and that is not arbitrary. It sends the wide frame's
 * top edge to the right-hand side of the tall one, and with it the moon: the
 * crescent's lit belly faces right (moon.js), so a clockwise turn lays it
 * face-down, low in the tall frame, with the hollow it leaves opening upward and
 * the fan growing up out of it. Turn the other way and the moon is a lid.
 *
 * `upright` is the other half. A cat drawn plumb comes out lying on its side, so
 * every site that draws a cat *without* an angle of its own cancels the turn
 * just before its drawImage. The sites that do set an angle are left alone on
 * purpose — the tail's fan, the moon's chain and rings, the spiral's arms, the
 * river's swimmers. There the angle is the gesture, and standing those cats up
 * would be taking the fan apart in order to save the cats in it.
 */

// The page asks with ?orient= and ?size=; a checker or a renderer running under
// node has no location to ask with and uses the environment instead. Both land
// on the same constants, so there is one answer per process and nothing can
// change it halfway through a draw.
const ask = (k) =>
  typeof location !== 'undefined'
    ? new URLSearchParams(location.search).get(k)
    : (globalThis.process?.env?.[k.toUpperCase()] ?? null);

export const ORIENT = ask('orient') === 'portrait' ? 'portrait' : 'landscape';

// The whole orientation, as one number. Zero is the wide view, and every test
// below is `if (TURN)` rather than a string compare for that reason: landscape
// is not a special case, it is a turn of nothing.
export const TURN = ORIENT === 'portrait' ? Math.PI / 2 : 0;

/**
 * What the picture is drawn at, in pixels — and the one thing here the browser
 * window does not get a vote on.
 *
 * A canvas that takes the size of the window is a picture whose proportions are
 * decided by whoever last dragged a corner, which is fine for a thing you only
 * ever look at and useless for a thing you are going to render. So the tall view
 * is 1080×1920 and stays 1080×1920 in a small window, a big window and a
 * headless one. The window's only remaining job is how large it appears, which
 * is a zoom and not a change to the picture.
 *
 * The wide view keeps taking the window by default, deliberately: that is where
 * you resize until `dropped` climbs and find the aspect the burst clearance
 * stops working at (song.js's hud), and pinning it would take away the only tool
 * for that. `?size=1920x1080` pins it when you want to see what YouTube will get;
 * `?size=fit` sets the tall view loose the same way.
 */
const SIZES = { fit: null, portrait: [1080, 1920], landscape: [1920, 1080] };
const said = ask('size');
export const SIZE =
  said && /^\d+x\d+$/.test(said)
    ? said.split('x').map(Number)
    : said in SIZES
      ? SIZES[said]
      : TURN
        ? SIZES.portrait
        : null; // the wide view's default: whatever shape the window is

/**
 * Size the canvas and hand back the *composition's* own dimensions, which are
 * the canvas's swapped when the picture is turned.
 *
 * Two sizes, and keeping them apart is the whole point of this function: the
 * backing store is the picture, and the CSS box is the largest place of that
 * shape the window has room for. Loose, the two are the same thing and `dpr` is
 * what separates them; pinned, `dpr` drops out — the render is already at its
 * own resolution and the display is a scale of it either way.
 */
export function fit(canvas, winW, winH, dpr) {
  const [w, h] = SIZE ?? [Math.floor(winW * dpr), Math.floor(winH * dpr)];
  canvas.width = w;
  canvas.height = h;
  const shown = Math.min(winW / w, winH / h);
  canvas.style.width = `${w * shown}px`;
  canvas.style.height = `${h * shown}px`;
  return frameOf(canvas);
}

/** The composition's dimensions for a canvas of this size. */
export const frameOf = (canvas) =>
  TURN ? { W: canvas.height, H: canvas.width } : { W: canvas.width, H: canvas.height };

/**
 * Put the context into the composition's frame. Everything drawn after this is
 * drawn in wide-frame coordinates whichever way up the canvas is, so nothing
 * downstream needs to know which view it is in.
 */
export function turn(ctx, canvas) {
  if (!TURN) return frameOf(canvas);
  // (x, y) ↦ (canvas.width − y, x): the wide frame's left edge lands along the
  // top of the tall one, and its top edge runs down the right-hand side.
  ctx.translate(canvas.width, 0);
  ctx.rotate(TURN);
  return frameOf(canvas);
}

/**
 * Cancel the turn for one cat. Call it after the translate that puts the cat
 * where it goes and *before* any mirror, so the mirror happens in the frame the
 * viewer is looking at rather than in the turned one — otherwise a flipped cat
 * comes out upside down instead of facing the other way.
 */
export function upright(ctx) {
  if (TURN) ctx.rotate(-TURN);
}
