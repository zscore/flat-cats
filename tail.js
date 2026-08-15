/**
 * tail.js — the tail burst: one cat, and then nine.
 *
 * Thirty seconds of choreography driven entirely by `since`, the seconds
 * elapsed since the burst was triggered:
 *
 *   open    the cat, and the one tail it actually has
 *   fan     eight more swing out of the same join, the way the fox has them
 *   grow    they lengthen, and nothing else changes while they do
 *   hold    they stay at that length and sway, slowly, for as long again
 *   cull    half the fan leaves
 *   home    the fan closes and the nine fade back into the one the cat came with
 *
 * NOTHING NEW HAPPENS AFTER THE GROWING STOPS. There used to be a weave stage
 * that rode finer waves along each tail and a branch stage that forked every
 * one of them, forks included, at the peak — and past that point the piece went
 * from nine tails to sixty-three, moving fast enough that none of them read as
 * a tail any more. What is left is the shape it reaches at ten seconds, held
 * and swayed at half the old speed. If the branching is ever wanted back it is
 * in the history, at the commit that took it out.
 *
 * The fan hangs off the cat's own tail rather than off a point picked by hand:
 * tails.py measures where each tail joins its cat and which way it leaves, and
 * the middle tail of the fan continues the one in the photograph.
 *
 * Like draw() in viz.js this is a pure function of time — no counters, no
 * rand(), nothing carried between frames. Scrub back into the burst an hour
 * later and you get the identical frame. Keep it that way.
 */

import { ORIENT, TURN, upright } from './frame.js';

export const BURST_LENGTH = 30; // seconds, start to nothing on screen

const FAN = 9; // the fox's nine
const OCTAVES = 2; // how many times the waves subdivide
// Full swings per second. Half what it was: with the weave gone this is the
// only movement the fan has, and at the old rate a held shape swinging is much
// more obviously swinging than the same rate was under everything else.
const SWAY_HZ = 0.17;
const ROCK = 0.045; // radians the host cat leans, either side of upright
// Leans per second. Deliberately not a simple fraction of SWAY_HZ: on a round
// ratio the cat reaches its lean on the same beat the fan reaches its swing,
// every time, and the two read as one mechanism rather than as an animal
// sitting under something moving.
const ROCK_HZ = 0.09;
const BREATH_HZ = 0.14; // fades per second, shared by every tail
const BREATH_DEPTH = 0.45; // how far down the fade takes them
// Radians of sway each tail owes its neighbour. Zero means the fan swings as
// one thing, which is the point. Small values read as a wave travelling across
// the fan; by about 1.0 it stops looking like one animal.
const LAG = 0;
// How far past its far end a section is drawn, as a fraction of its length. The
// ends meet exactly without it; this is only so the seam is under fur.
const OVERLAP = 0.16;
const TAU = Math.PI * 2;

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
const NUDGE = {
  landscape: { x: 0, y: 0 },
  portrait: { x: 0, y: 0 },
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ramp = (x, a, b) => smooth((x - a) / (b - a));

/**
 * The whole score, as numbers, at `s` seconds in. Every stage is a ramp with
 * an explicit window, so the timing of the piece is readable in one place —
 * change a number here rather than anywhere below.
 */
function score(s) {
  const fan = ramp(s, 1.4, 5.0);
  const grow = ramp(s, 5.2, 10.0);
  // The close starts where the branching used to and takes half again as long
  // to finish. The hold before it is the piece now, so it gets the time the
  // elaboration used to spend, and the way out of it is not hurried.
  const home = ramp(s, 22.0, 29.0);
  return {
    alpha: ramp(s, 0, 1.2) * (1 - ramp(s, 29.0, BURST_LENGTH)),
    // How present the eight extra tails are. They fade up as they separate and
    // dissolve at the end of the close — without that, nine tails converging on
    // one line composite into something denser than the tail we opened on.
    extra: ramp(s, 1.4, 3.4) * (1 - ramp(s, 27.4, 28.8)),
    // One slow fade, shared by every tail, so they go dim and come back
    // together rather than each on its own clock.
    breath: 1 - BREATH_DEPTH * (0.5 - 0.5 * Math.cos(TAU * BREATH_HZ * s)),
    // Half-angle of the fan. Opens as the tails appear, holds, shuts to nothing
    // on the way home.
    fan: 0.62 * fan * (1 - home),
    // How far the tip swings, as a fraction of the tail's own length. It arrives
    // during the growing and then does not change again until the close.
    swing: 0.10 * ramp(s, 6.0, 9.0) * (1 - 0.6 * home),
    // Waves along one tail, and how many times they subdivide. Both fixed: one
    // wave, two octaves, the whole way through. Ramping either of them is what
    // the weave was, and the weave is what made the back half unreadable.
    waves: 0.8,
    octaves: OCTAVES,
    lag: LAG * (1 - home),
    cull: ramp(s, 21.0, 23.5),
    // The host shifting its weight. Starts at zero and stays small: a cat that
    // sits stone still under all this looks like a photograph the tails were
    // pasted onto, which is what it is.
    rock: ROCK * Math.sin(TAU * ROCK_HZ * s),
    // Length. The fan opens at a length that is already a tail and then the
    // tails grow past it, which is a stage of its own — nothing else changes
    // while they do it. Opening much shorter than this leaves the first few
    // seconds with a stub too short to hold even one cat tail in it.
    reach: 0.75 + 0.40 * grow,
  };
}

// ---------------------------------------------------------------- geometry --

/**
 * Local space: the join sits at the origin, the tail runs out along +x, and
 * the bend grows with u so the join stays put while the tip does the
 * travelling. The waves are summed over octaves — each one twice as fine and
 * half as deep as the last, which is what keeps a swaying tail from reading as
 * one big wobble.
 */
function centreline(u, p) {
  const rest = 0.06 * u * u; // a resting arc that owes nothing to the swing
  let bend = 0;
  let amp = p.swing;
  let freq = p.waves;
  // One phase for every octave. Give them their own and the fine waves crawl
  // against the coarse ones, which is a lot of movement that reads as noise
  // rather than as a tail swinging.
  for (let o = 0; o < OCTAVES; o++) {
    const w = clamp01(p.octaves - o);
    if (w > 0) bend += Math.sin(TAU * freq * u + p.phase) * amp * w * u;
    amp *= 0.5;
    freq *= 2.15;
  }
  return [p.len * u, p.len * (rest + bend)];
}

// Thick at the join, tapering, rounded off rather than cut square at the tip.
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

/**
 * The arc position at which the centreline is `d` pixels from the point at arc
 * `s` — as the crow flies, not along the curve. This is what a pair of compasses
 * does, and it is the whole of the fix for sections that did not touch: stepping
 * by arc length instead lays a rigid section across a bend and lets its far end
 * leave the curve entirely — by seven times its own half-thickness, measured on
 * the tails as they were — so the next section starts somewhere else.
 *
 * Scanned rather than bisected from the start: the distance from `s` is not
 * monotonic along a curve that doubles back, so only the first crossing is the
 * right one. Within the one sample that crosses, bisection is safe.
 */
function advance(pts, s, d) {
  const a = at(pts, s);
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].s <= s || Math.hypot(pts[i].x - a.x, pts[i].y - a.y) < d) continue;
    let lo = Math.max(s, pts[i - 1].s);
    let hi = pts[i].s;
    for (let k = 0; k < 12; k++) {
      const mid = (lo + hi) / 2;
      const m = at(pts, mid);
      if (Math.hypot(m.x - a.x, m.y - a.y) < d) lo = mid;
      else hi = mid;
    }
    return hi;
  }
  return pts[pts.length - 1].s; // the curve runs out before `d` does
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

// -------------------------------------------------------------------- draw --

/**
 * One tail, made of tails: real cat tails from the set, laid head to tail
 * along the centreline, each turned to face the way the big tail is going.
 *
 * Each section spans from one point on the centreline to the next, both of them
 * on the curve, so its root sits exactly where the last one's tip did and the
 * chain cannot come apart. It follows the curve at the scale a rigid tail can:
 * a wave finer than one section is stepped over rather than followed, which is
 * what a real tail of that stiffness would do.
 *
 * The step is each tail's own length, so a stubby tail takes a short bite and a
 * long one takes a long bite. Squeezing them into equal slots would flatten out
 * the thing that makes this worth doing — that they are visibly seven different
 * cats.
 */
function ribbon(ctx, p, pts) {
  const total = pts[pts.length - 1].s;

  for (let n = 0, s = 0; s < total && n < 24; n++) {
    const here = at(pts, s);
    // Deterministic, and different per tail, so no two of them are made of the
    // same cats in the same order.
    const img = p.tails[(n * 3 + p.seq * 5 + 1) % p.tails.length];
    const h = 2 * halfWidth(here.u, p);
    const w = h * (img.width / img.height);
    if (w < 1) break; // the taper has run out

    const next = advance(pts, s, w);
    const end = at(pts, next);
    const chord = Math.hypot(end.x - here.x, end.y - here.y);
    // Short of a whole tail means the curve ran out mid-section. The first one
    // is drawn anyway, scaled down whole, so a tail too short to hold even one
    // section is still a tail rather than nothing. Later ones are at the thin
    // end, where stopping short does not show.
    if (n && chord < 0.34 * w) break;
    const draw = chord * (1 + OVERLAP);
    const tall = h * Math.min(1, draw / w);

    ctx.save();
    ctx.translate(here.x, here.y);
    ctx.rotate(Math.atan2(end.y - here.y, end.x - here.x));
    if ((n + p.seq) % 2) ctx.scale(1, -1); // vary which way the fur curls
    ctx.drawImage(img, 0, -tall / 2, draw, tall);
    ctx.restore();
    s = next;
  }
}

/**
 * Where the cat goes, and where its tail leaves it. If its tail heads left the
 * whole cat is mirrored, so the fan always has the open half of the frame to
 * grow into rather than the edge.
 */
function layout(W, H, cat) {
  const h = 0.42 * H;
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
/** The hand-set nudge for this view, in canvas pixels. */
function nudge(place) {
  const n = NUDGE[ORIENT];
  return { x: n.x * place.h, y: n.y * place.h };
}

function slide(place, cat) {
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
function bodyBox(place, cat) {
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

/**
 * The frame this burst occupies, as shapes something else can be kept out of.
 *
 * It is the union over the whole burst, not the footprint at any one moment.
 * That is the useful thing to hand out: a cat placed clear of this is clear for
 * the burst's full thirty seconds, so it can be placed once and then left
 * alone. Handing out the instantaneous shape instead would mean re-placing
 * every cat every frame, and cats that slide around under a swaying fan.
 *
 * The extremes are read off score() rather than off the constants above. The
 * timing here is all ramps, and the widest the fan ever opens is whatever those
 * ramps happen to touch — so moving a ramp moves this, which is the point.
 */
export function keepClear(W, H, cat) {
  const place = layout(W, H, cat);
  let fan = 0;
  let reach = 0;
  let swing = 0;
  for (let s = 0; s <= BURST_LENGTH; s += 0.1) {
    const p = score(s);
    fan = Math.max(fan, p.fan);
    reach = Math.max(reach, p.reach);
    swing = Math.max(swing, p.swing);
  }

  // A tail does not lie along its own ray. It bends off it by the resting arc
  // plus the swing summed over the octaves, and at the tip that comes to this
  // fraction of its length sideways — an angle the wedge has to allow either
  // side of the outermost tail, on top of the fan's own half-angle.
  const stray = 0.06 + 1.5 * swing;
  return [
    // The cat, as its whole image box. Generous — the picture is mostly
    // transparent at the corners — but the alternative is a matte test per
    // frame for a rectangle that never moves.
    // Padded off its own height rather than off place.h: standing the cat up
    // swaps the two, and the lean sweeps the box's long way whichever that is.
    { kind: 'rect', ...bodyBox(place, cat), pad: ROCK * bodyBox(place, cat).h },
    {
      kind: 'wedge',
      x: place.ax,
      y: place.ay,
      base: place.base,
      half: fan + Math.atan(stray),
      r: Math.min(0.36 * W, 0.46 * H) * reach,
      pad: 0.030 * H, // the tails' own half-thickness at the join
    },
  ];
}

/**
 * Draw the burst. `since` is seconds since it was triggered — negative or past
 * the end and nothing is drawn. `cat` is {img, root, heading} — the picture and
 * the two numbers tails.py measured about its tail. Returns whether anything
 * was drawn.
 *
 *   tailBurst(ctx, canvas.width, canvas.height, t - 20, burstCat, tails)
 */
export function tailBurst(ctx, W, H, since, cat, tails) {
  if (since < 0 || since > BURST_LENGTH || !tails.length) return false;
  const p = score(since);
  if (p.alpha <= 0.001) return false;

  const place = layout(W, H, cat);
  const shape = {
    // Height is what bounds a wide fan, not width — at the full spread the
    // outermost tails are throwing themselves at the top and bottom edges.
    len: Math.min(0.36 * W, 0.46 * H) * p.reach,
    thick: 0.030 * H,
    waves: p.waves,
    swing: p.swing,
    octaves: p.octaves,
    tails,
  };

  ctx.save();
  ctx.globalAlpha = p.alpha;
  const half = (FAN - 1) / 2;
  for (let i = 0; i < FAN; i++) {
    const rank = i - half; // -4 … 4, the middle one being the cat's own
    const odd = Math.abs(rank) % 2 === 1;
    const here = (rank === 0 ? 1 : p.extra) * (odd ? 1 - p.cull : 1);
    if (here <= 0.002) continue;

    ctx.save();
    // Outer tails sit back a little, so the fan reads as depth rather than as
    // nine equally insistent tails. The breath is on the eight — the cat's own
    // tail holds steady, so the fade always has something to come back to.
    ctx.globalAlpha *= here * (0.6 + 0.4 / (1 + Math.abs(rank))) * (rank === 0 ? 1 : p.breath);
    ctx.translate(place.ax, place.ay);
    ctx.rotate(place.base + (rank / half) * p.fan);
    const tail = { ...shape, seq: i, phase: TAU * SWAY_HZ * since + rank * p.lag };
    ribbon(ctx, tail, walk(tail));
    ctx.restore();
  }

  // The cat goes on last, over the join every tail comes out of.
  ctx.globalAlpha = p.alpha;
  // It leans about that join, and about nothing else. The join is the one point
  // the fan is pinned to, so pivoting there moves the whole cat while leaving
  // every tail's root exactly where it was — the alternative is a hip that
  // slides out from under nine tails that stay put.
  ctx.translate(place.ax, place.ay);
  // Stand it up, about that same join. The fan keeps the angle the frame gave
  // it — turned, so it hangs straight down the tall picture — and the cat comes
  // back to level underneath it, facing whichever way `flip` had it facing.
  // Nothing here moves the join, so every tail's root is where it was.
  upright(ctx);
  ctx.rotate(p.rock);
  // After the lean, not before it: the cat is pinned at the join and the join is
  // now its trailing corner, so the lean is a hip and the body swings off it.
  // Sliding first would pivot the cat about a point out in front of its chest.
  ctx.translate(slide(place, cat) + nudge(place).x, nudge(place).y);
  ctx.translate(-place.ax, -place.ay);
  if (place.flip) {
    ctx.translate(place.x + place.w / 2, 0);
    ctx.scale(-1, 1);
    ctx.translate(-(place.x + place.w / 2), 0);
  }
  ctx.drawImage(cat.img, place.x, place.y, place.w, place.h);
  ctx.restore();
  return true;
}
