/**
 * pulse-check.mjs — where the notes actually land, in the moon and in the river.
 *
 *   node tools/pulse-check.mjs   # writes out/pulse.html
 *
 * Both bursts spend the score the same way: one beat picks one cat somewhere in
 * the frame and swells it (pulse.js). Both claim in their own comments that the
 * cat is one you can see. That claim is the whole point of the gesture — a note
 * that swells something off the edge, or something the burst has already faded
 * to a smudge, is a note that did nothing — and it is not a claim a diff can
 * settle. So it gets measured.
 *
 * Unlike river-check and face-check this reads no constants out of any source.
 * It draws the real frame through a ctx that records every drawImage, twice —
 * once with the beats and once without — and the cats whose drawn height moved
 * between the two runs are exactly the ones a note swelled. Nothing here knows
 * how either module chooses; it only knows what came out.
 *
 * Which cat belongs to which beat comes out of the sizes rather than out of the
 * modules: every cat in both systems is drawn at one resting height, so growth
 * over that height IS pulse.js's envelope, and the envelope at a known age is a
 * known number. The cat matching swell(age) is this beat's — the neighbouring
 * beat at its own peak is not, which is the trap this avoids.
 *
 * Three claims, in the order they matter:
 *
 *   lands     every beat swells something. A burst that silently drops a third
 *             of the score still looks fine frame by frame, which is exactly
 *             why this is first
 *   inside    and that something is in the frame — for the whole second the
 *             swell lasts, not just at the hit. The cat goes on swimming and
 *             the frame goes on moving while it grows
 *   visible   and drawn about as brightly as the burst around it. Measured as a
 *             share of the burst's own opacity at that moment, so a beat under
 *             the opening fade is not counted against the choosing: the
 *             question is whether this cat is as visible as its neighbours, not
 *             whether the burst is up yet
 *
 * The picture is the frame with one dot per beat — placed where the cat was,
 * sized as it was drawn, at the opacity it was drawn at — so the spread of the
 * score over the frame and the brightness it landed at are one image. Two
 * window shapes, because "inside" is the one claim that depends on the aspect.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { moonBurst, BURST_LENGTH as MOON_LENGTH } from '../moon.js';
import { riverBurst, BURST_LENGTH as RIVER_LENGTH } from '../river.js';
import { swell, PULSE } from '../pulse.js';
import { planMoon, planRiver } from '../plan.js';

const notes = JSON.parse(readFileSync(new URL('../public/song/notes.json', import.meta.url), 'utf8')).notes;
const manifest = JSON.parse(readFileSync(new URL('../public/viz/manifest.json', import.meta.url), 'utf8'));
// Aspect is all drawImage needs, and the cutouts are all one canvas, so the
// cast can be faked without decoding 69 PNGs.
const cats = manifest.cats.map(() => ({ width: 1024, height: 700 }));

const SHAPES = [
  { name: '16:9', W: 1600, H: 900 },
  { name: '4:3', W: 1200, H: 900 },
];
const AGES = [0.06, 0.18, 0.35, 0.55, 0.8]; // through the pulse, peak included
const DIM = 0.3; // a cat under this share of the burst's own opacity is a miss
// Both modules mean to drop a note now and then rather than force one somewhere
// visible, so `lands` is not all-or-nothing. This is where "now and then" stops
// being now and then. What matters more than the pass is the count beside it.
const LOST = 0.1;

/** A 2D context that draws nothing and remembers everything. */
function recorder() {
  let m = [1, 0, 0, 1, 0, 0];
  let alpha = 1;
  const stack = [];
  const hits = [];
  const mul = (n) => {
    m = [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  };
  return {
    hits,
    get globalAlpha() { return alpha; },
    set globalAlpha(v) { alpha = v; },
    save() { stack.push([m.slice(), alpha]); },
    restore() { const s = stack.pop(); m = s[0]; alpha = s[1]; },
    translate(x, y) { mul([1, 0, 0, 1, x, y]); },
    rotate(a) { mul([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); },
    scale(x, y) { mul([x, 0, 0, y, 0, 0]); },
    clearRect() {},
    drawImage(img, dx, dy, dw, dh) {
      const cx = dx + dw / 2;
      const cy = dy + dh / 2;
      hits.push({
        x: m[0] * cx + m[2] * cy + m[4],
        y: m[1] * cx + m[3] * cy + m[5],
        h: dh * Math.hypot(m[1], m[3]),
        a: alpha,
      });
    },
  };
}

/** This beat's cat at `age`, or undefined — the one grown by swell(age). */
function pick(burst, beats, b, age) {
  const want = swell(age);
  if (want < 0.02) return undefined; // too small a difference to attribute
  const frame = (bs) => {
    const ctx = recorder();
    burst.draw(ctx, b + age, bs);
    const by = new Map();
    for (const p of ctx.hits) by.set(`${Math.round(p.x)},${Math.round(p.y)}`, p);
    return by;
  };
  const off = frame([]);
  const on = frame(beats);
  // The burst's own fade at this moment: nothing in either burst is drawn over
  // it, so the brightest cat on screen is it.
  const lit = Math.max(...[...on.values()].map((p) => p.a), 0.001);
  let best;
  let err = 0.01;
  for (const [k, p] of on) {
    const q = off.get(k);
    if (!q) continue;
    const e = Math.abs((p.h - q.h) / burst.rest - want);
    if (e < err) { err = e; best = { ...p, share: p.a / lit }; }
  }
  return best;
}

/** Every beat's cat, through one window shape. */
function trace(burst, shape) {
  const beats = burst.beats;
  const draw = (ctx, s, bs) => burst.burst(ctx, shape.W, shape.H, s, cats, bs);
  const rest = burst.restOf(shape.H);
  const b2 = { ...burst, draw, rest };
  return beats.map((b) => {
    const seen = AGES.filter((a) => b + a <= burst.length).map((a) => pick(b2, beats, b, a)).filter(Boolean);
    if (!seen.length) return { b, lost: true };
    const out = (p) => Math.max(0, -p.x, p.x - shape.W, -p.y, p.y - shape.H) / shape.H;
    return { b, at: seen[0], escaped: Math.max(...seen.map(out)), share: seen[0].share };
  });
}

const bursts = [
  {
    name: 'moon rings',
    burst: moonBurst,
    beats: planMoon(notes),
    length: MOON_LENGTH,
    restOf: (H) => 0.09 * 0.3 * H, // RING_CAT × R × H
  },
  {
    name: 'river',
    burst: riverBurst,
    beats: planRiver(notes),
    length: RIVER_LENGTH,
    restOf: (H) => 0.075 * H, // CAT_H × H
  },
];

const checks = [];
const panels = [];
for (const burst of bursts) {
  for (const shape of SHAPES) {
    const rows = trace(burst, shape);
    const lost = rows.filter((r) => r.lost);
    const escaped = rows.filter((r) => !r.lost && r.escaped > 0);
    const dim = rows.filter((r) => !r.lost && r.share < DIM);
    const n = rows.length;
    const worst = escaped.length ? Math.max(...escaped.map((r) => r.escaped)) : 0;
    checks.push(
      { ok: lost.length / n < LOST, name: 'lands', where: `${burst.name} ${shape.name}`, detail: `${n - lost.length}/${n} beats swelled a cat${lost.length ? ` — nothing to pick at ${lost.map((r) => `${r.b.toFixed(0)}s`).join(', ')}` : ''}` },
      { ok: !escaped.length, name: 'inside', where: `${burst.name} ${shape.name}`, detail: escaped.length ? `${escaped.length} left the frame, worst ${worst.toFixed(3)} frame-heights out` : `all of them stayed in frame for the whole ${PULSE}s` },
      { ok: dim.length / n < 0.05, name: 'visible', where: `${burst.name} ${shape.name}`, detail: `${dim.length}/${n} under ${DIM} of the burst's own opacity (${dim.map((r) => r.b.toFixed(0)).join(', ') || 'none'})` },
    );
    if (shape.name === '16:9') panels.push({ burst, shape, rows });
  }
}

const panel = ({ burst, shape, rows }) => {
  const k = 0.42;
  const dots = rows
    .filter((r) => !r.lost)
    .map((r) => `<circle cx="${(r.at.x * k).toFixed(1)}" cy="${(r.at.y * k).toFixed(1)}" r="${((r.at.h / 2) * k).toFixed(1)}"
       fill="${r.share < DIM ? '#ff7b72' : '#e0663a'}" opacity="${Math.max(0.05, r.at.a).toFixed(3)}"/>`)
    .join('');
  return `<figure>
  <svg viewBox="0 0 ${shape.W * k} ${shape.H * k}" width="${shape.W * k}" height="${shape.H * k}">
    <rect width="${shape.W * k}" height="${shape.H * k}" fill="#12151a"/>
    ${dots}
  </svg>
  <figcaption>${burst.name} — ${rows.filter((r) => !r.lost).length} of ${rows.length} beats, at ${shape.name}</figcaption>
</figure>`;
};

const html = `<!doctype html><meta charset="utf-8"><title>where the notes land</title>
<style>
 body{background:#0b0d10;color:#c9d1d9;font:14px/1.5 ui-monospace,Menlo,monospace;margin:2rem}
 h1{font-size:1rem;font-weight:600} table{border-collapse:collapse;margin:1rem 0 2rem}
 td{padding:.25rem .8rem .25rem 0;vertical-align:top} tr td:first-child{color:#7ee787}
 tr.bad td:first-child{color:#ff7b72} td.w{color:#6e7681}
 .grid{display:flex;flex-wrap:wrap;gap:.9rem} figure{margin:0}
 figcaption{color:#6e7681;font-size:12px;padding-top:.2rem}
 p{color:#8b949e;max-width:64ch}
</style>
<h1>pulse.js — every beat's cat, in both bursts that spend the score on one</h1>
<table>${checks.map((c) => `<tr class="${c.ok ? '' : 'bad'}"><td>${c.ok ? '✓' : '✗'}</td><td class="w">${c.where}</td><td>${c.name}</td><td>${c.detail}</td></tr>`).join('\n')}</table>
<p>One dot per beat, on the frame, where that beat's cat was when it was picked.
The dot is the size the cat was drawn and the opacity it was drawn at, so a
sparse-looking panel is a burst whose notes landed on things nobody can see.
Red is a cat under ${DIM} of the burst's own opacity at that moment.</p>
<div class="grid">${panels.map(panel).join('')}</div>
`;

mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
writeFileSync(new URL('../out/pulse.html', import.meta.url), html);

for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.where.padEnd(16)} ${c.name.padEnd(8)} ${c.detail}`);
console.log(`\nwrote out/pulse.html`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
