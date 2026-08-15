/**
 * tail.js — the tail burst: one cat, and then nine, and then rather more.
 *
 * Thirty seconds of choreography driven entirely by `since`, the seconds
 * elapsed since the burst was triggered:
 *
 *   open    the cat, and the one tail it actually has
 *   fan     eight more swing out of the same join, the way the fox has them
 *   grow    they lengthen, and nothing else changes while they do
 *   sway    the whole fan swings as one, fading in and out together
 *   weave   finer waves ride on the big ones, two octaves deep
 *   branch  every tail forks, and at the peak the forks fork
 *   play    all of it moving at once
 *   cull    half the fan leaves
 *   home    the fan closes, the forks retract, the octaves unwind, and what is
 *           left is the tail the cat came with
 *
 * The fan hangs off the cat's own tail rather than off a point picked by hand:
 * tails.py measures where each tail joins its cat and which way it leaves, and
 * the middle tail of the fan continues the one in the photograph.
 *
 * Like draw() in viz.js this is a pure function of time — no counters, no
 * rand(), nothing carried between frames. Scrub back into the burst an hour
 * later and you get the identical frame. Keep it that way.
 */

export const BURST_LENGTH = 30; // seconds, start to nothing on screen

const FAN = 9; // the fox's nine
const OCTAVES = 2; // how many times the waves subdivide
const FORK = 0.44; // radians a fork leaves its parent by
const SWAY_HZ = 0.34; // full swings per second
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
  const weave = ramp(s, 10.5, 15.5);
  const fork = ramp(s, 14.5, 19.0) * (1 - ramp(s, 23.5, 27.0));
  const home = ramp(s, 24.5, 29.0);
  return {
    alpha: ramp(s, 0, 1.2) * (1 - ramp(s, 29.0, BURST_LENGTH)),
    // How present the eight extra tails are. They fade up as they separate and
    // dissolve at the end of the close — without that, nine tails converging on
    // one line composite into something denser than the tail we opened on.
    extra: ramp(s, 1.4, 3.4) * (1 - ramp(s, 27.4, 28.8)),
    // One slow fade, shared by every tail, so they go dim and come back
    // together rather than each on its own clock.
    breath: 1 - BREATH_DEPTH * (0.5 - 0.5 * Math.cos(TAU * BREATH_HZ * s)),
    // Half-angle of the fan. Opens as the tails appear, opens further into the
    // weave, shuts to nothing on the way home.
    fan: (0.62 + 0.43 * weave) * fan * (1 - home),
    // How far the tip swings, as a fraction of the tail's own length.
    swing: (0.10 * ramp(s, 6.0, 9.0) + 0.12 * weave) * (1 - 0.6 * home),
    // Waves along one tail, and how many times they subdivide. One octave is a
    // swaying tail; two is the weave. A third octave was a wave finer than the
    // tail sections riding it, so it made no shape they could follow.
    waves: 0.8 + 1.4 * weave * (1 - home),
    octaves: 1 + (OCTAVES - 1) * weave * (1 - home),
    lag: LAG * (1 - home),
    fork,
    // The forks fork, but only at the peak — it is four times the drawing.
    depth: fork > 0.8 ? 2 : 1,
    cull: ramp(s, 21.0, 23.5),
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
 * half as deep as the last, which is what makes the weave read as weave rather
 * than as one big wobble.
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
 * leave the curve entirely, by seven times its own half-thickness in the middle
 * of the weave, so the next section starts somewhere else.
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
    // is drawn anyway, scaled down whole — that is a fork just starting, and
    // dropping it is what used to make forks pop into being at full size. Later
    // ones are at the thin end, where stopping short does not show.
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
 * A tail and everything growing out of it. The forks are the same function
 * again on a shorter, thinner tail turned off the parent — which is the whole
 * of the fractal, and the reason the pattern holds together at every scale
 * instead of looking like two unrelated effects stacked up.
 */
function limb(ctx, p, depth) {
  const pts = walk(p);
  ribbon(ctx, p, pts);
  if (depth >= p.depth || p.fork <= 0.02) return;

  const join = at(pts, pts[pts.length - 1].s * 0.55);
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.globalAlpha *= p.fork;
    ctx.translate(join.x, join.y);
    ctx.rotate(join.angle + side * FORK * p.fork);
    limb(
      ctx,
      // Same phase as the parent: a fork that swings against the tail it grows
      // out of looks detached from it.
      { ...p, len: p.len * 0.46 * p.fork, thick: p.thick * 0.66, seq: p.seq + (side > 0 ? 2 : 5), phase: p.phase },
      depth + 1,
    );
    ctx.restore();
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
  const ax = 0.32 * W + Math.cos(head) * h * 0.10;
  const ay = 0.47 * H + Math.sin(head) * h * 0.10;
  return {
    w, h, flip, ax, ay,
    x: ax - rx * w - Math.cos(head) * h * 0.10,
    y: ay - cat.root[1] * h - Math.sin(head) * h * 0.10,
    base: head,
  };
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
    fork: p.fork,
    depth: p.depth,
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
    limb(ctx, { ...shape, seq: i, phase: TAU * SWAY_HZ * since + rank * p.lag }, 0);
    ctx.restore();
  }

  // The cat goes on last, over the join every tail comes out of.
  ctx.globalAlpha = p.alpha;
  if (place.flip) {
    ctx.translate(place.x + place.w / 2, 0);
    ctx.scale(-1, 1);
    ctx.translate(-(place.x + place.w / 2), 0);
  }
  ctx.drawImage(cat.img, place.x, place.y, place.w, place.h);
  ctx.restore();
  return true;
}
