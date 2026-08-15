/**
 * walk-check.mjs — look at the path the intro cats walk.
 *
 *   node tools/walk-check.mjs   # writes out/walk-check.html
 *
 * From four measures in the per-note cats stop being a scatter and start being
 * a trail (walk.js). None of that can be judged from the diff or from a paused
 * frame: it is a question about where a hundred and thirty cats land over
 * twelve seconds, and the answer is the whole path at once.
 *
 * So this draws the placements arrange() actually produces, as boxes at the
 * aspect the cutouts have, over the path they were placed on. Time is the
 * colour — cold where the walk starts, warm where it ends — because a still
 * picture of a walk has no other way to say which way round it went.
 *
 * Two panels, since the change is a switch and not a look: the eight seconds
 * before it, which are untouched, and the twelve after.
 *
 * Then the seeds. The walk that ships is seed 0; the rest are what the same
 * rules give with a different roll, drawn small and path-only. If seed 0 spends
 * the intro in one corner, picking another is a one-line change.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { arrange } from '../cats.js';
import { createWalk } from '../walk.js';

const BASE = new URL('../', import.meta.url).pathname;
const read = (p) => JSON.parse(readFileSync(BASE + p, 'utf8'));

/** A PNG's size, out of its IHDR — the only thing arrange() wants of an image. */
function pngSize(path) {
  const b = readFileSync(BASE + path);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

// The same numbers cats.js places against. Repeated rather than exported: this
// is a tool, and cats.js is four lines off its size ceiling.
const AFTER = 8;
const UNTIL = 20;
const EDGE = 0.08;
const MARGIN = 0.1;
const SPREAD = 0.34;
const BOX = { x0: EDGE, x1: 1 - EDGE, y0: MARGIN + SPREAD / 2, y1: 1 - MARGIN - SPREAD / 2 };

const W = 960;
const H = 540; // 16:9, the aspect everything else in the repo is judged at

const score = read('public/song/notes.json');
const manifest = read('public/viz/manifest.json');
const cats = manifest.cats.map((c) => pngSize('public/viz/' + c.file));
const sprites = arrange(score.notes, cats);

// cats.js snaps the start to the score's next beat, and a chord is one beat.
const onsets = [...new Set(score.notes.map((n) => n.t))].sort((a, b) => a - b);
const from = onsets.find((t) => t >= AFTER) ?? AFTER;

const lerp = (a, b, s) => a + (b - a) * s;
const heat = (s) => `hsl(${lerp(205, 25, s)} 75% ${lerp(62, 55, s)}%)`;

/** The walk's own line, sampled fine enough that the corners read as curves. */
function pathOf(walk, span) {
  const d = [];
  for (let t = 0; t <= span; t += span / 400) {
    const p = walk.at(t);
    d.push(`${d.length ? 'L' : 'M'}${(p.x * W).toFixed(1)} ${(p.y * H).toFixed(1)}`);
  }
  return d.join(' ');
}

/** Where the walk stands still — the gait, which the line alone does not show. */
function stops(walk, span) {
  return walk.legs
    .filter((l) => l.u0 === l.u1 && l.t0 < span)
    .map((l) => ({ ...walk.at(l.t0), held: Math.min(l.t1, span) - l.t0 }));
}

/** One cat, as the box it occupies, coloured by when in the window it lands. */
function box(s, s01) {
  const h = s.size * H;
  const w = h * 0.85; // the cutouts run a little taller than wide
  return (
    `<rect x="${(s.x * W - w / 2).toFixed(1)}" y="${(s.y * H - h / 2).toFixed(1)}" ` +
    `width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3" ` +
    `fill="${heat(s01)}" fill-opacity="0.16" stroke="${heat(s01)}" stroke-opacity="0.8"/>`
  );
}

function panel(title, note, from_, to, walk) {
  const inWindow = sprites.filter((s) => s.t >= from_ && s.t < to);
  const span = to - from_;
  // Over the cats, not under them: a hundred and thirty half-lit boxes bury a
  // thin line completely, and the line is the thing being judged.
  const line = walk
    ? `<path d="${pathOf(walk, span)}" fill="none" stroke="#fff" stroke-opacity="0.75" stroke-width="2.5"/>` +
      stops(walk, span)
        .map(
          (p) =>
            `<circle cx="${(p.x * W).toFixed(1)}" cy="${(p.y * H).toFixed(1)}" r="${(3 + p.held * 3).toFixed(1)}" ` +
            `fill="none" stroke="#fff" stroke-opacity="0.5"/>`,
        )
        .join('')
    : '';
  return `<section><h2>${title}</h2><p>${note}</p>
<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#11131a"/>
  ${inWindow.map((s) => box(s, (s.t - from_) / span)).join('\n  ')}
  ${line}
</svg>
<p class="n">${inWindow.length} cats · ${new Set(inWindow.map((s) => s.t)).size} onsets</p></section>`;
}

const SHIPS = 4; // the seed cats.js passes
const walk = createWalk({ span: UNTIL - from, box: BOX, seed: SHIPS });

const seeds = [0, 1, 2, 3, 4, 5]
  .map((seed) => {
    const w = createWalk({ span: UNTIL - from, box: BOX, seed });
    return `<figure><svg viewBox="0 0 ${W} ${H}" width="320" height="180">
    <rect width="${W}" height="${H}" fill="#11131a"/>
    <path d="${pathOf(w, UNTIL - from)}" fill="none" stroke="${heat(seed / 5)}" stroke-width="4"/>
  </svg><figcaption>seed ${seed}${seed === SHIPS ? ' — ships' : ''}</figcaption></figure>`;
  })
  .join('');

const html = `<!doctype html><meta charset="utf-8"><title>walk-check</title>
<style>
  body { background:#0b0c10; color:#c9cbd4; font:14px/1.5 system-ui, sans-serif; margin:24px 32px; max-width:1040px }
  h1 { font-size:18px } h2 { font-size:15px; margin-bottom:2px } p { margin:2px 0 10px; color:#8b8f9c }
  svg { border-radius:4px; max-width:100% } .n { margin-top:4px }
  figure { display:inline-block; margin:0 12px 12px 0 } figcaption { color:#8b8f9c; font-size:12px }
</style>
<h1>walk-check — the intro cats' path</h1>
<p>Walk runs ${from.toFixed(2)}s → ${UNTIL}s, snapped to the score's next beat after ${AFTER}s.
Colour is time: <span style="color:${heat(0)}">start</span> → <span style="color:${heat(1)}">end</span>.
Rings are where the cat stands still, sized by how long.</p>
${panel('Before — 0s to ' + from.toFixed(2) + 's', 'The scatter, unchanged: sideways from velocity, height from degree.', 0, from, null)}
${panel('Walk — ' + from.toFixed(2) + 's to ' + UNTIL + 's', 'Placed on the path; degree fans each chord ±' + (SPREAD / 2).toFixed(2) + ' of frame height around it.', from, UNTIL, walk)}
<section><h2>Other rolls</h2><p>Same rules, different seed. Paths only.</p>${seeds}</section>`;

mkdirSync(BASE + 'out', { recursive: true });
writeFileSync(BASE + 'out/walk-check.html', html);
console.log(`out/walk-check.html · walk ${from.toFixed(2)}s–${UNTIL}s · ${sprites.filter((s) => s.t >= from && s.t < UNTIL).length} cats on the path`);
