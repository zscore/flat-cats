/**
 * crowd-check.mjs — look at how much the per-note cats sit on top of each other.
 *
 *   node tools/crowd-check.mjs   # writes out/crowd-check.html
 *
 * burst-clear.mjs asks whether a cat is clear of the *burst*. This asks the
 * other question: whether it is clear of the other *cats*. clear.js now has a
 * pass for that — settle() — and like the burst clearance it is not a thing a
 * diff can be read for. It is a question about where several hundred cats land
 * in a frame over fifty seconds, and the answer is a picture and a count.
 *
 * The stretch splits into three, because the cats are not doing the same thing
 * throughout and a number averaged over all of it would hide that:
 *
 *   scatter   0s to the walk — placed about the middle of the frame by velocity
 *   walk      the trail through the intro; cats are *meant* to be close here,
 *             so this is the panel to check settle() has not flattened
 *   burst     20s on, sharing the frame with the fan and the crescent
 *
 * Overlap is measured on the drawn boxes, shrunk by SNUG the way settle()
 * counts it, and reported two ways: pairs that touch at all, and pairs more
 * than half-buried. The second is the one that matters — cats grazing each
 * other looks like a crowd, and one cat behind another looks like a bug.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { arrange, EDGE } from '../cats.js';
import { WHEN } from '../plan.js';
import { reflow, settle, blocker } from '../clear.js';
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

const byId = new Map(manifest.cats.map((c) => [c.id, c]));
const pick = manifest.tails
  .filter((t) => byId.has(t.id))
  .reduce((a, b) => (byId.get(b.id).coverage > byId.get(a.id).coverage ? b : a));
const burstCat = { img: pngSize('public/viz/' + pick.body), root: pick.root, heading: pick.heading };

const UNTIL = WHEN.until + WHEN.handover;

// Where the walk takes over from the scatter. cats.js works this out from its
// own WALK_AFTER and does not export it, so this mirrors the two lines rather
// than reaching in — and if they ever disagree, the middle panel is mislabelled
// and nothing else. Worth turning into an export next time cats.js is open.
const WALK_AFTER = 8;
const WALK_FROM = (() => {
  const first = new Map();
  for (const n of score.notes) {
    const beat = Math.round(n.tScore * 1000);
    if (!(first.get(beat) <= n.t)) first.set(beat, n.t);
  }
  return [...first.values()].sort((a, b) => a - b).find((s) => s >= WALK_AFTER) ?? WALK_AFTER;
})();

// ------------------------------------------------------------------- audit --

/**
 * Count overlapping pairs among cats that are on screen together.
 *
 * Written here rather than imported from clear.js on purpose, the way
 * burst-clear.mjs writes its own point test: settle() decides where cats go by
 * asking a question about boxes, and if that question is wrong in the
 * optimistic direction it cannot be the thing that reports so. This one uses
 * the full drawn box with no shrink — what is actually on screen.
 */
function audit(sprites) {
  let touching = 0;
  let buried = 0;
  const worst = new Set();
  for (let i = 0; i < sprites.length; i++) {
    const a = sprites[i];
    if (a.hidden) continue;
    const ah = a.size, aw = a.size * (a.img.width / a.img.height);
    for (let j = i + 1; j < sprites.length; j++) {
      const b = sprites[j];
      if (b.t >= a.t + a.life) break; // sorted by t; nothing later shares the screen
      if (b.hidden) continue;
      const bh = b.size, bw = b.size * (b.img.width / b.img.height);
      // Fractions of the frame throughout, so this is one aspect ratio's answer
      // — which is why the table at the bottom runs it at four of them.
      const ox = (aw + bw) / 2 - Math.abs(a.x - b.x) * ASPECT;
      const oy = (ah + bh) / 2 - Math.abs(a.y - b.y);
      if (ox <= 0 || oy <= 0) continue;
      touching++;
      if ((ox * oy) / Math.min(aw * ah, bw * bh) > 0.5) {
        buried++;
        worst.add(i);
        worst.add(j);
      }
    }
  }
  return { touching, buried, cats: worst.size };
}

let ASPECT = 1;

/** Lay the cats out at one frame size, with and without the settle pass. */
function run(W, H) {
  ASPECT = W / H;
  const shapes = {
    fan: tailClear(W, H, burstCat),
    moon: moonClear(W, H),
    moonAt: WHEN.moon,
    from: WHEN.tail,
    until: UNTIL,
    edge: EDGE,
  };

  // Before: arrange, then the burst clearance alone — what shipped until now.
  const before = arrange(score.notes, cats);
  const flow = reflow(before, W, H, shapes);

  // After: the same, plus the new pass.
  const after = arrange(score.notes, cats);
  reflow(after, W, H, shapes);
  const crowd = settle(after, W, H, {
    edge: EDGE,
    until: UNTIL,
    blocked: blocker(W, H, shapes),
    hold: [WALK_FROM, WHEN.tail], // the trail places its own cats; leave it be
  });

  const live = (ss) => ss.filter((s) => s.t <= UNTIL);
  return {
    before: live(before),
    after: live(after),
    flow,
    crowd,
    fan: shapes.fan,
    moon: shapes.moon,
    was: audit(live(before)),
    now: audit(live(after)),
  };
}

const W = 1600;
const H = 900;
const main = run(W, H);

// -------------------------------------------------------------------- draw --

/**
 * One panel over a slice of the timeline: every cat that is on screen during it,
 * where settle() left it, with a line back to where it was before.
 */
function panel(title, note, from, to) {
  const inSlice = (s) => s.t + s.life >= from && s.t < to;
  const shown = main.after.filter(inSlice);
  const was = new Map(main.before.filter(inSlice).map((s, i) => [s.t + ':' + s.y, s.x]));

  const boxes = shown
    .map((s) => {
      const h = s.size * H;
      const w = h * (s.img.width / s.img.height);
      const x0 = was.get(s.t + ':' + s.y);
      const trail =
        x0 !== undefined && Math.abs(x0 - s.x) > 1e-6
          ? `<line x1="${x0 * W}" y1="${s.y * H}" x2="${s.x * W}" y2="${s.y * H}" class="trail"/>`
          : '';
      const cls = s.hidden ? 'dropped' : trail ? 'nudged' : 'kept';
      return `${trail}<rect class="${cls}" x="${s.x * W - w / 2}" y="${s.y * H - h / 2}" width="${w}" height="${h}"/>`;
    })
    .join('');

  const a = audit(main.before.filter(inSlice));
  const b = audit(main.after.filter(inSlice));
  return `<figure>
  <figcaption><b>${title}</b> — ${shown.length} cats · half-buried pairs ${a.buried} → <b>${b.buried}</b> · touching ${a.touching} → ${b.touching}</figcaption>
  <svg viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#0b0d12"/>${boxes}</svg>
  <p>${note}</p>
</figure>`;
}

// ------------------------------------------------------------------- table --

const SHAPES = [
  ['16:9', 1600, 900],
  ['16:10', 1600, 1000],
  ['4:3', 1200, 900],
  ['3:2 tall', 900, 1350],
];
const rows = SHAPES.map(([name, w, h]) => {
  const r = run(w, h);
  return (
    `<tr><td>${name}</td><td>${w}×${h}</td><td>${r.was.buried}</td><td>${r.now.buried}</td>` +
    `<td>${r.was.cats}</td><td>${r.now.cats}</td><td>${r.crowd.nudged}</td><td>${r.crowd.crowded}</td></tr>`
  );
}).join('\n');

ASPECT = W / H; // the table left it on whatever ran last

const html = `<!doctype html><meta charset="utf-8"><title>crowding</title>
<style>
  body { background: #06070a; color: #c8cede; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 2rem auto; max-width: 1100px; }
  h1 { font-size: 1.1rem; font-weight: 600; margin-top: 2.5rem; }
  p { color: #8b93a7; max-width: 68ch; }
  figure { margin: 2rem 0; }
  figcaption { color: #c8cede; margin-bottom: .5rem; }
  svg { width: 100%; border: 1px solid #1b2233; display: block; }
  .kept { fill: #6ea8fe; opacity: .8; }
  .nudged { fill: #7ee0a0; opacity: .85; }
  .dropped { fill: none; stroke: #ff7b7b; stroke-width: 3; opacity: .8; }
  .trail { stroke: #7ee0a0; stroke-width: 1.5; opacity: .4; }
  table { border-collapse: collapse; margin-top: 1rem; }
  td, th { padding: .3rem .9rem .3rem 0; text-align: left; border-bottom: 1px solid #1b2233; }
  b { color: #fff; }
</style>
<h1>Per-note cats against each other</h1>
<p>Blue stayed where the note and the burst put it; green was moved sideways by
<code>settle()</code>, with a line back to where it came from. Counts are pairs of cats
that are on screen at the same moment and overlapping — measured on the full drawn box
with no shrink, by a test written independently of the one that placed them.</p>
${panel(
  `Scatter — 0s to the walk`,
  `Placed about the middle of the frame by velocity. This is where a chord fans across the
   whole width rather than arriving as one cluster, and where settle() has the most room to work.`,
  0,
  WALK_FROM,
)}
${panel(
  `Walk — the trail through the intro`,
  `The cats are <em>meant</em> to be close here: the path is the picture, so settle() is held off
   this stretch entirely and every box should be blue. Letting it run here instead moved 135 of the
   143 cats a quarter of the frame width — it emptied the trail to empty the overlap count.`,
  WALK_FROM,
  WHEN.tail,
)}
${panel(
  `Burst — ${WHEN.tail}s on, sharing with the fan and the crescent`,
  `Two constraints at once. A cat may not move into the burst, so a crowded row here can only be
   untangled with what the fan leaves over.`,
  WHEN.tail,
  UNTIL,
)}
<h1>Whole stretch, and how it holds up in other windows</h1>
<p><code>nudged</code> is how many cats settle() moved; <code>crowded</code> is how many
still overlap something afterwards and had nowhere better to go. Nothing is ever hidden by
this pass — a note keeps its cat.</p>
<table>
  <tr><th>frame</th><th>px</th><th>buried pairs before</th><th>after</th><th>cats in one before</th><th>after</th><th>nudged</th><th>crowded</th></tr>
  ${rows}
</table>
`;

mkdirSync(BASE + 'out', { recursive: true });
writeFileSync(BASE + 'out/crowd-check.html', html);

console.log(`out/crowd-check.html`);
console.log(`  half-buried pairs: ${main.was.buried} → ${main.now.buried}`);
console.log(`  cats in one:       ${main.was.cats} → ${main.now.cats}`);
console.log(`  touching pairs:    ${main.was.touching} → ${main.now.touching}`);
console.log(`  settle moved ${main.crowd.nudged}, left ${main.crowd.crowded} overlapping`);

// Per section, because the three are doing different things and the total hides
// it — the walk especially, where being close together is the point.
for (const [name, from, to] of [
  ['scatter', 0, WALK_FROM],
  ['walk   ', WALK_FROM, WHEN.tail],
  ['burst  ', WHEN.tail, UNTIL],
]) {
  const slice = (ss) => ss.filter((s) => s.t + s.life >= from && s.t < to);
  const a = audit(slice(main.before));
  const b = audit(slice(main.after));
  const movedHere = slice(main.after).filter((s, i) => {
    const was = slice(main.before)[i];
    return was && Math.abs(was.x - s.x) > 1e-6;
  }).length;
  const shift = slice(main.after)
    .map((s, i) => {
      const was = slice(main.before)[i];
      return was ? Math.abs(was.x - s.x) : 0;
    })
    .reduce((x, y) => x + y, 0);
  console.log(
    `  ${name}  ${String(slice(main.after).length).padStart(3)} cats · ` +
      `buried ${String(a.buried).padStart(4)} → ${String(b.buried).padStart(4)} · ` +
      `moved ${String(movedHere).padStart(3)} · mean shift ${(shift / Math.max(1, movedHere)).toFixed(3)} of the width`,
  );
}
