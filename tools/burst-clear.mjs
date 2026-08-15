/**
 * burst-clear.mjs — look at where the per-note cats end up beside the fan.
 *
 *   node tools/burst-clear.mjs   # writes out/burst-clear.html
 *
 * cats.js now slides every cat that is on screen during the tail burst out of
 * the burst's way, along its own row, and drops the ones with no room. None of
 * that can be judged from the diff: it is a question about where several
 * hundred cats land in a frame, and the answer is a picture.
 *
 * So this draws the frame the way the browser would lay it out — the same
 * arrange() and the same reflow(), against the same keepClear() shapes — and
 * puts every cat on it as a box. Three states, three colours:
 *
 *   kept        never touched the burst, sits where its velocity put it
 *   moved       slid along its row, with a line back to where it came from
 *   dropped     its row had no room at all; drawn hollow, where it would have
 *               been, and not drawn at all in the real thing
 *
 * Two panels, because the cats are not up against the same thing throughout:
 * before the moon rises the fan is all there is to avoid, and that is the whole
 * first half of the burst.
 *
 * The last table is the one to distrust the picture with. The free space is a
 * function of the shape of the window, and a tall narrow one has much less of
 * it than the 16:9 the panels are drawn at.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { arrange, EDGE } from '../cats.js';
import { WHEN } from '../plan.js';
import { reflow } from '../clear.js';
import { keepClear as tailClear } from '../tail.js';
import { keepClear as moonClear } from '../moon.js';

const BASE = new URL('../', import.meta.url).pathname;
const read = (p) => JSON.parse(readFileSync(BASE + p, 'utf8'));

/** A PNG's size, out of its IHDR — the only thing arrange() wants of an image. */
function pngSize(path) {
  const b = readFileSync(BASE + path);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

const score = read('public/song/notes.json');
const manifest = read('public/viz/manifest.json');

const cats = manifest.cats.map((c) => pngSize('public/viz/' + c.file));
// The same burst cat cats.js picks: best matted of the ones with a tail, and
// its body rather than its cutout.
const byId = new Map(manifest.cats.map((c) => [c.id, c]));
const pick = manifest.tails
  .filter((t) => byId.has(t.id))
  .reduce((a, b) => (byId.get(b.id).coverage > byId.get(a.id).coverage ? b : a));
const burstCat = { img: pngSize('public/viz/' + pick.body), root: pick.root, heading: pick.heading };

// ------------------------------------------------------------------ layout --

/** Lay the cats out at one frame size and report where they went. */
function run(W, H) {
  const sprites = arrange(score.notes, cats);
  const tail = tailClear(W, H, burstCat);
  const moon = moonClear(W, H);
  const flow = reflow(sprites, W, H, {
    fan: tail,
    moon,
    moonAt: WHEN.moon,
    from: WHEN.tail,
    until: WHEN.until + WHEN.handover,
    edge: EDGE,
  });
  const during = sprites.filter((s) => s.t + s.life >= WHEN.tail && s.t <= WHEN.until);
  return { sprites, during, tail, moon, flow };
}

const W = 1600;
const H = 900;
const main = run(W, H);

// ------------------------------------------------------------------- audit --

/**
 * Is this point inside the shape as drawn — no pad, and written here rather
 * than imported. cats.js places its cats by asking whether a *circle* around
 * each one clears a *padded* shape, which is an approximation twice over; if
 * that approximation is wrong in the optimistic direction this is what says so,
 * and it cannot do that by calling the same function back.
 */
function inside(sh, px, py) {
  if (sh.kind === 'rect') return px > sh.x && px < sh.x + sh.w && py > sh.y && py < sh.y + sh.h;
  if (sh.kind === 'lune') {
    return Math.hypot(px - sh.x, py - sh.y) < sh.r && Math.hypot(px - sh.bx, py - sh.by) > sh.br;
  }
  const d = Math.hypot(px - sh.x, py - sh.y);
  if (d > sh.r) return false;
  const turn = Math.atan2(py - sh.y, px - sh.x) - sh.base;
  return Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) < sh.half;
}

/** Every drawn cat, sampled over its own box, against every shape it can meet. */
function audit(which, tail, moon) {
  const N = 8;
  let bad = 0;
  for (const s of which) {
    if (s.hidden) continue;
    const shapes = s.t + s.life <= WHEN.moon ? tail : [...tail, ...moon];
    const h = s.size * H;
    const w = h * (s.img.width / s.img.height);
    let hit = false;
    for (let i = 0; i <= N && !hit; i++) {
      for (let j = 0; j <= N && !hit; j++) {
        const px = s.x * W - w / 2 + (i / N) * w;
        const py = s.y * H - h / 2 + (j / N) * h;
        hit = shapes.some((sh) => inside(sh, px, py));
      }
    }
    if (hit) bad++;
  }
  return bad;
}

const overlaps = audit(main.during, main.tail, main.moon);

// -------------------------------------------------------------------- draw --

const svgShape = (sh, fill) => {
  if (sh.kind === 'rect') {
    const p = sh.pad;
    return `<rect x="${sh.x - p}" y="${sh.y - p}" width="${sh.w + 2 * p}" height="${sh.h + 2 * p}" fill="${fill}"/>`;
  }
  if (sh.kind === 'lune') {
    const r = sh.r + sh.pad;
    const br = sh.br - sh.pad;
    const circle = (cx, cy, rr) =>
      `M ${cx - rr} ${cy} a ${rr} ${rr} 0 1 0 ${2 * rr} 0 a ${rr} ${rr} 0 1 0 ${-2 * rr} 0`;
    return `<path d="${circle(sh.x, sh.y, r)} ${circle(sh.bx, sh.by, br)}" fill-rule="evenodd" fill="${fill}"/>`;
  }
  // The wedge, with the pad swung on either side of it the way hits() does.
  const r = sh.r + sh.pad;
  const half = sh.half + Math.atan2(sh.pad, r);
  const a = sh.base - half;
  const b = sh.base + half;
  const big = 2 * half > Math.PI ? 1 : 0;
  return (
    `<path d="M ${sh.x} ${sh.y} L ${sh.x + r * Math.cos(a)} ${sh.y + r * Math.sin(a)} ` +
    `A ${r} ${r} 0 ${big} 1 ${sh.x + r * Math.cos(b)} ${sh.y + r * Math.sin(b)} Z" fill="${fill}"/>`
  );
};

/** One panel: the shapes, and every cat that is up against them. */
function panel(title, shapes, which) {
  const boxes = which
    .map((s) => {
      const h = s.size * H;
      const w = h * (s.img.width / s.img.height);
      const y = s.y * H - h / 2;
      const state = s.hidden ? 'dropped' : s.x === s.home ? 'kept' : 'moved';
      const trail =
        state === 'moved'
          ? `<line x1="${s.home * W}" y1="${s.y * H}" x2="${s.x * W}" y2="${s.y * H}" class="trail"/>`
          : '';
      return `${trail}<rect class="${state}" x="${(s.hidden ? s.home : s.x) * W - w / 2}" y="${y}" width="${w}" height="${h}"/>`;
    })
    .join('');

  const counts = which.reduce(
    (a, s) => ((a[s.hidden ? 'dropped' : s.x === s.home ? 'kept' : 'moved']++, a)),
    { kept: 0, moved: 0, dropped: 0 },
  );

  return `<figure>
  <figcaption>${title} — ${which.length} cats: ${counts.kept} kept, ${counts.moved} moved, ${counts.dropped} dropped</figcaption>
  <svg viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#0b0d12"/>
    ${shapes.map((sh) => svgShape(sh, '#243049')).join('\n    ')}
    ${boxes}
  </svg>
</figure>`;
}

// Before the moon is up, a cat is only avoiding the fan — reflow() splits on
// exactly this, so the panels split on it too.
const early = main.during.filter((s) => s.t + s.life <= WHEN.moon);
const late = main.during.filter((s) => s.t + s.life > WHEN.moon);

// ------------------------------------------------------------------- table --

const SHAPES = [
  ['16:9', 1600, 900],
  ['16:10', 1600, 1000],
  ['4:3', 1200, 900],
  ['3:2 tall', 900, 1350],
];
const rows = SHAPES.map(([name, w, h]) => {
  const r = run(w, h);
  const pct = ((100 * r.flow.dropped) / r.during.length).toFixed(1);
  return `<tr><td>${name}</td><td>${w}×${h}</td><td>${r.during.length}</td><td>${r.flow.moved}</td><td>${r.flow.dropped}</td><td>${pct}%</td></tr>`;
}).join('\n');

const html = `<!doctype html><meta charset="utf-8"><title>burst clearance</title>
<style>
  body { background: #06070a; color: #c8cede; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 2rem auto; max-width: 1100px; }
  h1 { font-size: 1.1rem; font-weight: 600; }
  p { color: #8b93a7; max-width: 62ch; }
  figure { margin: 2rem 0; }
  figcaption { color: #8b93a7; margin-bottom: .5rem; }
  svg { width: 100%; border: 1px solid #1b2233; display: block; }
  .kept { fill: #6ea8fe; opacity: .85; }
  .moved { fill: #ffd479; opacity: .9; }
  .dropped { fill: none; stroke: #ff7b7b; stroke-width: 3; opacity: .8; }
  .trail { stroke: #ffd479; stroke-width: 1.5; opacity: .35; }
  table { border-collapse: collapse; margin-top: 1rem; }
  td, th { padding: .3rem .9rem .3rem 0; text-align: left; border-bottom: 1px solid #1b2233; }
</style>
<h1>Per-note cats beside the tail burst</h1>
<p>Blue kept its place, amber slid along its row (line back to where velocity put it),
hollow red had no room on its row and is not drawn in the real thing. The filled
regions are what <code>keepClear()</code> hands out: the host cat's box, the fan at its
widest and longest, and the crescent with its hollow left open. Rings are not in it.</p>
${panel(`Fan only — cats gone before the moon rises at ${WHEN.moon.toFixed(0)}s`, main.tail, early)}
${panel(`Fan and crescent — cats on screen after ${WHEN.moon.toFixed(0)}s`, [...main.tail, ...main.moon], late)}
<p><b>Overlap audit:</b> ${overlaps} of the ${main.during.filter((s) => !s.hidden).length} drawn cats
touch the fan, the host or the crescent — sampled over each cat's own box against the
shapes as drawn, with no pad and with a point test written independently of the one that
placed them.</p>
<h1>How it holds up in other windows</h1>
<table>
  <tr><th>frame</th><th>px</th><th>cats in the burst</th><th>moved</th><th>dropped</th><th>dropped</th></tr>
  ${rows}
</table>
`;

mkdirSync(BASE + 'out', { recursive: true });
writeFileSync(BASE + 'out/burst-clear.html', html);

console.log(`out/burst-clear.html — ${main.during.length} cats during the burst`);
console.log(`  kept ${main.during.length - main.flow.moved - main.flow.dropped}, moved ${main.flow.moved}, dropped ${main.flow.dropped}`);
