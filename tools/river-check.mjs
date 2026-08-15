/**
 * river-check.mjs — look at the river's path, and prove it stays untied.
 *
 *   node tools/river-check.mjs > out/river.html   # then open it
 *
 * river.js draws cats, and there is no canvas here to draw them on. What can be
 * checked without one is the curve they sit on, which is the whole design: the
 * shape at a dozen moments, the number of right angles it actually turns, and
 * whether any part of it crosses any other part.
 *
 * The crossing test is the one that matters. river.js claims non-intersection
 * from a bound on the heading amplitude rather than from a collision test, so
 * this is where that claim gets audited — every segment against every other,
 * at every sampled moment of the burst.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../river.js', import.meta.url), 'utf8');
const { BURST_LENGTH } = await import('../river.js');

// river.js keeps its internals private, which is right for the module and
// awkward for a checker. Rather than export them just for this, rebuild the
// curve from the same constants by reading them out of the source.
const num = (name) => {
  const m = src.match(new RegExp(`^const ${name} = ([-\\d.]+)`, 'm'));
  if (!m) throw new Error(`no constant ${name} in river.js`);
  return Number(m[1]);
};
const K = Object.fromEntries(
  ['SAMPLES', 'CAT_H', 'GAP', 'WAVE_AMP', 'WAVE_K', 'CRENEL_K', 'CRENEL_DUTY', 'SNAKE_AMP',
   'SNAKE_K', 'MARGIN_X', 'MARGIN_Y'].map((n) => [n, num(n)]),
);
const TAU = Math.PI * 2;
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ramp = (x, a, b) => smooth((x - a) / (b - a));

function crenel(v) {
  const w = v - Math.floor(v);
  const run = K.CRENEL_DUTY / 2;
  if (w < run) return 0;
  if (w < 0.5) return 1;
  if (w < 0.5 + run) return 0;
  return -1;
}

function score(s) {
  const stiff = ramp(s, 9, 14);
  const loose = ramp(s, 24, 29);
  const wave = 1 - stiff;
  const square = stiff - loose;
  return {
    amp: wave * K.WAVE_AMP + square * (Math.PI / 2) + loose * K.SNAKE_AMP,
    k: wave * K.WAVE_K + square * K.CRENEL_K + loose * K.SNAKE_K,
    q: square,
  };
}

const heading = (u, p) => p.amp * ((1 - p.q) * Math.sin(TAU * p.k * u) + p.q * crenel(p.k * u));

/** Same integration river.js does, fitted to a W×H box. */
function path(W, H, p) {
  const n = K.SAMPLES;
  const pts = [];
  let x = 0;
  let y = 0;
  let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
  for (let i = 0; i <= n; i++) {
    pts.push([x, y]);
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    const th = heading(i / n, p);
    x += Math.cos(th) / n;
    y += Math.sin(th) / n;
  }
  const scale = Math.min(((1 - 2 * K.MARGIN_X) * W) / Math.max(x1 - x0, 1e-6),
                         ((1 - 2 * K.MARGIN_Y) * H) / Math.max(y1 - y0, 1e-6));
  const ox = W / 2 - ((x0 + x1) / 2) * scale;
  const oy = H / 2 - ((y0 + y1) / 2) * scale;
  return {
    pts: pts.map(([px, py]) => [ox + px * scale, oy + py * scale]),
    // What the picture actually costs in cats: how many fit end to end, and how
    // tall the river stands in cat-heights — under about 2 and the corners stop
    // reading as corners.
    cats: Math.floor(scale / (K.GAP * H)),
    deep: ((y1 - y0) * scale) / (K.CAT_H * H),
  };
}

// ------------------------------------------------------------- the crossing --

const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
/** Do segments ab and cd properly cross? Touching endpoints don't count. */
function hits(a, b, c, d) {
  const d1 = cross(c, d, a), d2 = cross(c, d, b);
  const d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/**
 * Every segment against every other, skipping neighbours. Sampled coarsely —
 * SAMPLES² at 1024 is a million pairs per moment, and a fold big enough to
 * matter is thousands of samples wide, not two.
 */
function selfIntersects(pts, step = 4) {
  const s = [];
  for (let i = 0; i < pts.length - 1; i += step) s.push([pts[i], pts[Math.min(i + step, pts.length - 1)]]);
  let worst = 0;
  for (let i = 0; i < s.length; i++) {
    for (let j = i + 2; j < s.length; j++) {
      if (hits(s[i][0], s[i][1], s[j][0], s[j][1])) worst++;
    }
  }
  return worst;
}

/** How much of the curve is turning through a right angle, ±2°. */
function rightAngles(p) {
  const n = K.SAMPLES;
  let corners = 0;
  let prev = heading(0, p);
  for (let i = 1; i <= n; i++) {
    const th = heading(i / n, p);
    if (Math.abs(Math.abs(th - prev) - Math.PI / 2) < 0.035) corners++;
    prev = th;
  }
  return corners;
}

// ------------------------------------------------------------------ report --

const W = 640, H = 360;
const TIMES = [0, 3, 7, 10, 12, 14, 18, 22, 25, 27, 30, 34];

let bad = 0;
let cells = '';
for (const t of TIMES) {
  const p = score(t);
  const { pts, cats, deep } = path(W, H, p);
  const n = selfIntersects(pts);
  const c = rightAngles(p);
  if (n) bad++;
  // Drawn at the cat's real size, so the strip below each curve is the honest
  // question: is the river deep enough that a cat of that size fits in it?
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  cells += `<figure><svg viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#111114"/>` +
    `<path d="${d}" fill="none" stroke="${n ? '#e0564a' : '#8ab6ff'}" stroke-width="${K.CAT_H * H}"` +
    ` stroke-opacity="0.22" stroke-linecap="round"/>` +
    `<path d="${d}" fill="none" stroke="${n ? '#e0564a' : '#8ab6ff'}" stroke-width="1.5"/></svg>` +
    `<figcaption>${t}s · amp ${p.amp.toFixed(2)} · k ${p.k.toFixed(1)} · square ${p.q.toFixed(2)}` +
    ` · ${cats} cats · ${deep.toFixed(1)} cats deep · corners ${c}` +
    ` · ${n ? `<b>${n} crossings</b>` : 'clean'}</figcaption></figure>\n`;
}

// The square regime is meant to hold ten cycles; count the turns at its centre.
const held = rightAngles(score(19));

writeFileSync(new URL('../out/river.html', import.meta.url),
  `<!doctype html><meta charset="utf-8"><title>river of cats — the path</title>` +
  `<style>body{background:#0b0b0d;color:#b9b9c2;font:12px ui-monospace,monospace;margin:24px}` +
  `main{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}` +
  `figure{margin:0}svg{width:100%;display:block;border:1px solid #1e1e24}` +
  `figcaption{color:#6a6a72;padding-top:5px}b{color:#e0564a}h1{font-size:13px;font-weight:500}</style>` +
  `<h1>river of cats — the path, ${TIMES.length} moments of a ${BURST_LENGTH}s burst · ` +
  `${bad ? `<b>${bad} of them self-intersect</b>` : 'none self-intersect'} · ` +
  `${held} right-angle turns held at 19s</h1><main>${cells}</main>`);

console.log(`wrote out/river.html`);
console.log(`self-intersections: ${bad} of ${TIMES.length} moments`);
console.log(`right-angle turns at 19s (square regime): ${held}`);
