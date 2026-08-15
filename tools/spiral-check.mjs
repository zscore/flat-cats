/**
 * spiral-check.mjs — look at the two wheels without a canvas.
 *
 *   node tools/spiral-check.mjs   # writes out/spiral.html
 *
 * spiral.js draws cats and there is nothing here to draw them on, but the whole
 * design is where the slots are, and that is arithmetic. This calls spiral.js's
 * own score() and slot() rather than re-deriving them — a checker that
 * reimplemented the geometry would be checking its own arithmetic — and reads
 * the cast's real proportions out of the PNG headers, so a cat here is the shape
 * of the cat there.
 *
 * Six claims, in the order they matter:
 *
 *   threaded   the inner wheel's arms leave the centre in the gaps the outer
 *              wheel's leave — half an arm-gap, not some fraction of one
 *   crossed    the two sets of arms actually cross on screen. This is the whole
 *              reason the winding is reversed; parallel arms would just be a
 *              second wheel sitting there
 *   together   one clock. Both wheels turn through the same angle every second
 *              and neither outlives the other
 *   leaves     the bloom empties the frame. BURST_LENGTH is documented as
 *              "start to nothing on screen", and the inner wheel is the first
 *              thing here that can break that: at 0.55 scale its arms open at
 *              0.55 the rate, so it clears the frame later than the outer one
 *   heard      every beat swells a cat that is on frame and lit. The failure is
 *              silent by design — a beat with nothing to choose from passes
 *              without a swell — so the only way to know is to count, which is
 *              the lesson pulse.js learned the hard way against the river
 *   room       the honest one, with no pass mark: how crowded the middle gets.
 *              The outer wheel already overlaps itself heavily when it packs, so
 *              the number that matters is not the inner wheel's crowding but how
 *              much it adds to what was there anyway
 *
 * The picture is the frame at six moments across the burst, drawn from the same
 * slots, with everything off-frame clipped away — so what is on screen at 135s
 * is what you see in the panel marked 8s.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { score, slot, pool, swelling, WHEELS, BURST_LENGTH, INNER_AT } from '../spiral.js';
import { planSpiral } from '../plan.js';

const url = (p) => new URL(p, import.meta.url);
const notes = JSON.parse(readFileSync(url('../public/song/notes.json'))).notes;
const spiral = planSpiral(notes);

// The cast's aspects, straight out of the PNG headers — IHDR is the first
// chunk, width and height big-endian at byte 16. cats.js divides width by
// height for every slot and so does this.
const manifest = JSON.parse(readFileSync(url('../public/viz/manifest.json')));
const ASPECTS = manifest.cats.map((c) => {
  const b = readFileSync(url('../public/viz/' + c.file));
  return b.readUInt32BE(16) / b.readUInt32BE(20);
});

const TAU = Math.PI * 2;
const ARMS = 3; // spiral.js's, and the only number here not imported from it
const VIEW = 16 / 9; // frame widths per frame height; the short side is 1
const EDGE = 0.5 * Math.hypot(VIEW, 1);
const LEAN = 0.35;

/** Every slot of `wheel` that has arrived by `s` and is on frame, as drawn. */
function onFrame(s, beats, wheel) {
  const p = score(s);
  const grown = swelling(s, beats, wheel, EDGE);
  const out = [];
  for (let k = 0; k < beats.length && beats[k] <= s; k++) {
    const { r, theta } = slot(k, p, wheel);
    const swollen = grown.get(k) ?? 0;
    const h = slot(k, p, wheel).h * (1 + swollen);
    if (r - h > EDGE) continue;
    const aspect = ASPECTS[(k * wheel.seed + 3) % ASPECTS.length];
    out.push({ k, r, h, theta, swollen, w: h * aspect, x: Math.cos(theta) * r, y: Math.sin(theta) * r });
  }
  return out;
}

// ---------------------------------------------------------------- threaded --

const gap = TAU / ARMS;
const threaded = WHEELS.inner.offset / gap; // want exactly a half

// ----------------------------------------------------------------- crossed --

/**
 * An arm as a polyline out to the frame's corner, at the score `s` — the same
 * curve slot() puts cats on, sampled continuously in j rather than at integers.
 */
function arm(s, wheel, a) {
  const p = score(s);
  const pts = [];
  for (let j = 0; j < 400; j += 0.5) {
    const r = wheel.scale * p.pitch * (j + 1) ** 0.62;
    if (r > EDGE) break;
    const th = a * gap + wheel.offset + wheel.wind * 1.25 * Math.log1p(j) + p.spin;
    pts.push([Math.cos(th) * r, Math.sin(th) * r]);
  }
  return pts;
}
const side = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const hits = (a, b, c, d) =>
  (side(c, d, a) > 0) !== (side(c, d, b) > 0) && (side(a, b, c) > 0) !== (side(a, b, d) > 0);
function crossings(s) {
  let n = 0;
  for (let a = 0; a < ARMS; a++)
    for (let b = 0; b < ARMS; b++) {
      const [P, Q] = [arm(s, WHEELS.outer, a), arm(s, WHEELS.inner, b)];
      for (let i = 1; i < P.length; i++)
        for (let j = 1; j < Q.length; j++) if (hits(P[i - 1], P[i], Q[j - 1], Q[j])) n++;
    }
  return n;
}

// --------------------------------------------------------------- together --

// The claim is same direction at the same rate, so measure the rate and not the
// angle: how far each wheel's arm 0 turns over a second, every second of the
// burst. Both take p.spin unmodified, so this is really asking whether the
// wiring says what the design says.
let drift = 0;
let slowest = Infinity; // and the turn is one-way if this never goes negative
for (let s = 0; s < BURST_LENGTH; s++) {
  const rate = (w) => slot(0, score(s + 1), w).theta - slot(0, score(s), w).theta;
  drift = Math.max(drift, Math.abs(rate(WHEELS.outer) - rate(WHEELS.inner)));
  slowest = Math.min(slowest, rate(WHEELS.outer), rate(WHEELS.inner));
}

// ------------------------------------------------------------------- room --

/**
 * Pairs of cats sitting on top of each other — centres closer than half the sum
 * of their heights — split three ways, because the three mean different things.
 *
 * `oo` is what the outer wheel already did to itself before any of this and is
 * the baseline to read the others against. `ii` is the inner wheel doing the
 * same thing to itself, which it must, being the same wheel: the two differ only
 * in how much of each arm is on frame at 0.55 scale. `oi` is the only count that
 * is new — one wheel's cats over the other's — and the one that decides whether
 * the middle reads as threaded or as filled in.
 */
function crowding(s) {
  const outer = onFrame(s, spiral.beats, WHEELS.outer);
  const inner = onFrame(s, spiral.inner, WHEELS.inner);
  const over = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < (a.h + b.h) / 2;
  const self = (xs) => {
    let n = 0;
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) if (over(xs[i], xs[j])) n++;
    return n;
  };
  let oi = 0;
  for (const a of outer) for (const b of inner) if (over(a, b)) oi++;
  return { on: outer.length, in: inner.length, oo: self(outer), ii: self(inner), oi };
}
const each = Array.from({ length: BURST_LENGTH + 1 }, (_, s) => ({ s, ...crowding(s) }));
const worst = each.reduce((a, b) => (b.oi > a.oi ? b : a));

// ------------------------------------------------------------------ heard --

// A beat with an empty pool passes silently, so count them. Both wheels run out
// of pool at the same place — the first ATTACK-worth of beats, before there is
// any cat old enough to swell — and the inner wheel's own count starts there
// again 8s in, which is why it is measured per wheel rather than in total.
const heard = [
  ['outer', spiral.beats, WHEELS.outer],
  ['inner', spiral.inner, WHEELS.inner],
].map(([name, beats, wheel]) => {
  const pools = beats.map((_, i) => pool(i, beats, wheel, EDGE));
  const lost = pools.filter((n) => n === 0).length;
  return { name, of: beats.length, lost, widest: Math.max(...pools), median: pools.sort((a, b) => a - b)[pools.length >> 1] };
});

// ----------------------------------------------------------------- leaves --

// The bloom's job is to clear the frame. Measured at the moment the fade-out
// starts, so this is what is still there to be faded rather than what the fade
// has already hidden — a wheel that only leaves because it went transparent has
// not left.
const FADE_AT = 33.5;
const left = crowding(FADE_AT);

// ----------------------------------------------------------------- picture --

const MOMENTS = [2, INNER_AT, 12, 18, 24, 30];
const S = 190; // px per frame height
const w = Math.round(VIEW * S);
const panels = MOMENTS.map((s, i) => {
  const px = (x) => (w / 2 + x * S).toFixed(1);
  const py = (y) => (S / 2 + y * S).toFixed(1);
  // A swelling cat is drawn at its swollen size and outlined in white, because
  // at a typical 20% over its neighbours the size alone is not something you can
  // pick out of a hundred and forty cats on a page — which is itself worth
  // knowing, and is the question this panel is here to answer.
  const draw = (cs, fill) =>
    cs
      .map(
        (c) =>
          `<rect x="${(-c.w * S) / 2}" y="${(-c.h * S) / 2}" width="${(c.w * S).toFixed(1)}"` +
          ` height="${(c.h * S).toFixed(1)}" rx="2" fill="${fill}"` +
          ` fill-opacity="${c.swollen ? 0.85 : 0.42}"` +
          ` stroke="${c.swollen ? '#fff' : fill}" stroke-width="${c.swollen ? 1.6 : 0.7}" stroke-opacity="0.9"` +
          ` transform="translate(${px(c.x)} ${py(c.y)}) rotate(${((LEAN * c.theta * 180) / Math.PI).toFixed(1)})"/>`,
      )
      .join('');
  const o = onFrame(s, spiral.beats, WHEELS.outer);
  const n = onFrame(s, spiral.inner, WHEELS.inner);
  return (
    `<figure><svg width="${w}" height="${S}" viewBox="0 0 ${w} ${S}">` +
    `<clipPath id="f${i}"><rect x="0" y="0" width="${w}" height="${S}"/></clipPath>` +
    `<g clip-path="url(#f${i})">${draw(o, '#8ab6ff')}${draw(n, '#e0864a')}</g></svg>` +
    `<figcaption>${(spiral.at + s).toFixed(1)}s &middot; ${s}s in &middot; ` +
    `${o.length} outer, ${n.length} inner on frame</figcaption></figure>`
  );
}).join('');

// ------------------------------------------------------------------ report --

const cross = crossings(18);
const rows = [
  ['threaded', `inner arms sit ${threaded.toFixed(3)} of an arm-gap round from the outer's (${(gap * 180 / Math.PI).toFixed(0)}° apart)`, Math.abs(threaded - 0.5) < 1e-9],
  ['crossed', cross ? `${cross} crossings of an outer arm by an inner one on frame at 18s` : 'the arms never cross — the wheels are parallel', cross > 0],
  ['together', `same direction, same rate: worst difference in turn over any second of the burst ` +
    `${drift.toExponential(1)} rad, and the slowest second either wheel turns is ` +
    `${slowest.toFixed(3)} rad — never backwards`, drift < 1e-12 && slowest >= 0],
  ['heard', heard.map((h) => `${h.name} ${h.of - h.lost}/${h.of} beats swell a cat ` +
    `(pool of ${h.median} typical, ${h.widest} at its widest)`).join(' &middot; '),
    heard.every((h) => h.lost / h.of < 0.05)],
  ['leaves', `at ${FADE_AT}s, where the fade-out starts, ${left.on} outer cats are still on frame ` +
    `(of ${each[27].on} at the peak) and ${left.in} inner ones (of ${each[27].in}) — ` +
    `the inner wheel's arms open at ${WHEELS.inner.scale} the rate, so it does not clear`, left.in <= left.on],
  ['room', `worst crossing-crowd at ${worst.s}s: ${worst.on} outer + ${worst.in} inner on frame, ` +
    `${worst.oo} overlapping pairs inside the outer wheel, ${worst.ii} inside the inner, ` +
    `${worst.oi} between the two — only that last number is new`, null],
]
  .map(([k, v, ok]) => `<tr><td>${k}</td><td class="${ok === null ? '' : ok ? 'ok' : 'no'}">${v}</td></tr>`)
  .join('');

writeFileSync(
  url('../out/spiral.html'),
  `<!doctype html><meta charset="utf-8"><title>spiral — two wheels</title>` +
    `<style>body{background:#0b0b0d;color:#b9b9c2;font:12px ui-monospace,monospace;margin:24px}` +
    `h1{font-size:13px;font-weight:500}table{border-collapse:collapse;margin-bottom:18px}` +
    `td{padding:3px 14px 3px 0;vertical-align:top}td:first-child{color:#6a6a72}` +
    `.ok{color:#8ab6ff}.no{color:#e0564a}` +
    `.grid{display:flex;flex-wrap:wrap;gap:14px}figure{margin:0}` +
    `svg{display:block;border:1px solid #1e1e24;background:#111114}` +
    `figcaption{color:#6a6a72;padding-top:5px}</style>` +
    `<h1>spiral at ${spiral.at.toFixed(1)}s — ${spiral.beats.length} beats on the outer wheel, ` +
    `${spiral.inner.length} on the inner from ${(spiral.at + INNER_AT).toFixed(1)}s</h1>` +
    `<table>${rows}</table><div class="grid">${panels}</div>` +
    `<p>blue is the outer wheel, orange the inner one at ${WHEELS.inner.scale} of its size. each cat is ` +
    `drawn at the real proportions of the image that slot lands on, leaning the ${LEAN} of the arm ` +
    `angle spiral.js leans them. the frame is 16:9 and everything outside it is clipped, so these are ` +
    `what is on screen.</p>`,
);

console.log(`wrote out/spiral.html — spiral at ${spiral.at.toFixed(1)}s, inner wheel from ${(spiral.at + INNER_AT).toFixed(1)}s`);
console.log(`threaded : ${threaded.toFixed(3)} of an arm-gap`);
console.log(`crossed  : ${cross} arm crossings on frame at 18s`);
console.log(`together : worst turn difference ${drift.toExponential(1)} rad/s, slowest second ${slowest.toFixed(3)} rad`);
for (const h of heard)
  console.log(`heard    : ${h.name} — ${h.of - h.lost}/${h.of} beats swell a cat, pool ${h.median} typical / ${h.widest} widest`);
console.log(`leaves   : at ${FADE_AT}s — ${left.on} outer still on frame, ${left.in} inner`);
console.log(`room     : s  outer inner   o/o   i/i   o/i`);
for (const r of each.filter((r) => r.s % 3 === 0))
  console.log(
    `           ${String(r.s).padStart(2)} ${String(r.on).padStart(5)} ${String(r.in).padStart(5)}` +
      ` ${String(r.oo).padStart(5)} ${String(r.ii).padStart(5)} ${String(r.oi).padStart(5)}`,
  );
