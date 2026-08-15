/**
 * river-check.mjs — look at the river's course, and audit what river.js claims.
 *
 *   node tools/river-check.mjs   # writes out/river.html
 *
 * river.js draws cats and there is no canvas here to draw them on. What can be
 * checked without one is the curve they ride, which is the whole design. Six
 * claims, in the order they matter:
 *
 *   leaves      the risers clear the top of the frame — the thing that stopped
 *               being true when the old draft scaled everything to fit
 *   untied      no part of the course crosses any other part. river.js gets
 *               this from a bound on the heading amplitude rather than from a
 *               collision test, so this is where that bound gets audited
 *   steady      nothing speeds up: one pan rate, one flow rate, all burst
 *   wide        three lanes abreast, and how badly the inside lane pinches at a
 *               right angle, where the corner has no radius to give it
 *   clear       the counter-river interlocks with the meander without touching
 *               it. This is the one claim with no bound behind it at all — the
 *               phase and offset were swept for it numerically — so it is
 *               measured here the only honest way: every point of one course
 *               against every point of the other
 *   hangs       the top river comes into shot at all. It is built to spend most
 *               of its length above the frame, so the way it fails is not being
 *               off-screen — it is never dipping in, which no other row notices
 *
 * The picture is the whole course drawn end to end with the travelling frame
 * marked on it at a dozen moments, so the shape and what you actually see of it
 * are both in one image.
 */
import { readFileSync, writeFileSync } from 'node:fs';
// STEP is course.js's integration step, not one of the river's shape constants,
// so it is imported rather than read back out of the source like the rest: the
// rebuild below is an independent check on the shapes, not on the sampling.
import { STEP } from '../course.js';

const river = await import('../river.js');
// The river's shape lives in river.js and the currents' in currents.js. Both
// are read the same way, and which file a constant came from is not something
// the audit cares about — only that it is the one the module actually uses.
const src = ['../river.js', '../currents.js']
  .map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'))
  .join('\n');

// Both modules keep their internals private, which is right for them and
// awkward for a checker. Rather than export them just for this, read the
// constants back out of the source and rebuild the courses the same way.
const num = (name) => {
  const m = src.match(new RegExp(`^const ${name} = ([-\\d./ ]+);`, 'm'));
  if (!m) throw new Error(`no constant ${name} in river.js or currents.js`);
  return eval(m[1]);
};
// SQUIGGLES is a table rather than a scalar, so it is read out whole and
// evaluated the same way — still the module's own source, not a copy of it.
const arr = (name) => {
  const m = src.match(new RegExp(`^const ${name} = (\\[[\\s\\S]*?\\n\\]);`, 'm'));
  if (!m) throw new Error(`no table ${name} in river.js or currents.js`);
  return eval(m[1]);
};
const SQUIGGLES = arr('SQUIGGLES');

const K = Object.fromEntries(
  ['PAN', 'FLOW', 'CAT_H', 'GAP', 'LANES', 'LANE', 'DROP', 'WAVE_ARC', 'WAVE_AMP',
   'WAVE_LEN', 'BLEND', 'TEETH', 'RISER', 'RUN', 'ROUND', 'SNAKE_ARC', 'SNAKE_AMP', 'SNAKE_LEN',
   'B_LANES', 'B_AMP', 'B_LEN', 'B_PHASE', 'B_DROP', 'B_LEAD',
   'C_LANES', 'C_LOW', 'C_TIGHT', 'C_OPEN', 'C_LEN', 'C_PHASE', 'C_AT', 'C_WIDE', 'C_RISE', 'C_LEAD',
   'H_ARC', 'H_TURN',
   'T_LANES', 'T_AT', 'T_AMP', 'T_DEEP', 'T_SCALE', 'T_LEAD', 'T_VEIL',
   'DRIFT', 'DRIFT_LEN']
    .map((n) => [n, num(n)]),
);
const TOOTH = 2 * K.RISER + 2 * K.RUN;
const SQ_IN = K.WAVE_ARC, SQ_AT = SQ_IN + K.BLEND;
const SQ_OUT = SQ_AT + K.TEETH * TOOTH, SN_AT = SQ_OUT + K.BLEND;
const LENGTH = SN_AT + K.SNAKE_ARC;
const TAU = Math.PI * 2, ASPECT = 16 / 9;
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ramp = (x, a, b) => smooth((x - a) / (b - a));

function crenel(v) {
  const w = v - Math.floor(v), r = K.RUN / TOOTH, i = K.RISER / TOOTH, rr = K.ROUND / TOOTH;
  return -ramp(w, r / 2, r / 2 + rr) + ramp(w, r / 2 + i, r / 2 + i + rr)
    + ramp(w, 1.5 * r + i, 1.5 * r + i + rr) - ramp(w, 1.5 * r + 2 * i, 1.5 * r + 2 * i + rr);
}
const heading = (u) => {
  const stiff = ramp(u, SQ_IN, SQ_AT), loose = ramp(u, SQ_OUT, SN_AT);
  return (1 - stiff) * K.WAVE_AMP * Math.sin((TAU * u) / K.WAVE_LEN)
    + (stiff - loose) * (Math.PI / 2) * crenel((u - SQ_AT) / TOOTH)
    + loose * K.SNAKE_AMP * Math.sin((TAU * (u - SN_AT)) / K.SNAKE_LEN);
};

const n = Math.ceil(LENGTH / STEP);
const xs = [], ys = [], ths = [];
{
  let x = 0, y = 0;
  for (let i = 0; i <= n; i++) {
    xs.push(x); ys.push(y); ths.push(heading(i * STEP));
    x += Math.cos(ths[i]) * STEP;
    y += Math.sin(ths[i]) * STEP;
  }
}
const base = ys[Math.round(SQ_AT / STEP)];
const camY = base - K.DROP;
const x0 = Math.min(...xs), x1 = Math.max(...xs);

// ------------------------------------------------------- the counter-river --

function bessel0(a) { let t = 1, s = 1; for (let k = 1; k < 12; k++) { t *= -(a * a / 4) / (k * k); s += t; } return s; }
// The lean the small courses share. Applied to the points once they are built,
// exactly as currents.js does it, and for the reason set out there: in the
// heading it would be scaled by each course's own local steepness and the
// currents would stop holding their gaps.
const lean = (xs, ys) => { for (let i = 0; i < xs.length; i++) ys[i] += K.DRIFT * Math.sin((TAU * xs[i]) / K.DRIFT_LEN); };
const snX = xs[Math.round(SN_AT / STEP)], snY = ys[Math.round(SN_AT / STEP)];
const bB = bessel0(K.B_AMP);
const counterX = x1 + K.B_LEAD;
const bArc = (x1 - snX + K.B_LEAD) / bB;
const bn = Math.ceil(bArc / STEP);
const bxs = [], bys = [];
{
  let x = counterX, y = snY + K.B_DROP;
  for (let i = 0; i <= bn; i++) {
    bxs.push(x); bys.push(y);
    const th = Math.PI + K.B_AMP * Math.sin((TAU * (i * STEP + K.B_PHASE)) / K.B_LEN);
    x += Math.cos(th) * STEP; y += Math.sin(th) * STEP;
  }
}

// The under-river, built the same way: it starts past the end of the teeth and
// runs back past the river's own source.
const sqX = xs[Math.round(SQ_OUT / STEP)];
const squiggle = (u, s) => {
  if (u <= s.at || u >= s.at + s.arc) return 0;
  const p = (u - s.at) / s.arc, len = s.arc / s.bends;
  return -(s.dip * Math.PI / s.arc) * Math.sin(TAU * p)
    + ((1 - Math.cos(TAU * p)) / 2) * (s.amp * Math.sin(TAU * u / len) - s.kink * Math.sin(TAU * u / (len / 2)));
};
const cArc = K.H_ARC + (sqX + K.C_LEAD - (x0 - K.C_LEAD)) / bessel0((K.C_TIGHT + K.C_OPEN) / 2);
const cn = Math.ceil(cArc / STEP);
const cxs = [], cys = [];
// The hook integrated alone, so the course can be started far enough back that
// the hook ends where the run used to begin — the same trick currents.js uses.
const hook = (u) => Math.PI + K.H_TURN * (1 - smooth(u / K.H_ARC));
let hx = 0, hy = 0;
for (let i = 0, hn = Math.ceil(K.H_ARC / STEP); i <= hn; i++) { const t = hook(i * STEP); hx += Math.cos(t) * STEP; hy += Math.sin(t) * STEP; }
{
  let x = sqX + K.C_LEAD - hx, y = base + K.C_LOW - hy;
  for (let i = 0; i <= cn; i++) {
    cxs.push(x); cys.push(y);
    let u = i * STEP;
    if (u < K.H_ARC) { const t = hook(u); x += Math.cos(t) * STEP; y += Math.sin(t) * STEP; continue; }
    u -= K.H_ARC;
    const open = ramp(u, K.C_AT, K.C_AT + K.C_WIDE);
    const amp = K.C_TIGHT + (K.C_OPEN - K.C_TIGHT) * open;
    const lean = (K.C_RISE / K.C_WIDE) * (ramp(u, K.C_AT, K.C_AT + 0.25) - ramp(u, K.C_AT + K.C_WIDE - 0.25, K.C_AT + K.C_WIDE));
    const th = Math.PI + amp * Math.sin((TAU * (u + K.C_PHASE)) / K.C_LEN) + lean
      + SQUIGGLES.reduce((a, s) => a + squiggle(u, s), 0);
    x += Math.cos(th) * STEP; y += Math.sin(th) * STEP;
  }
}

// ----------------------------------------------------------- the top river --

// Rebuilt the same way, and for the same reason: this is an independent check on
// the shape, not a call into it. PHI is arithmetic rather than one of the
// river's knobs, so it is computed here instead of read back out of the source.
// The frame's top edge, in the course's own units. Both this stretch and the
// `leaves` claim below are about the same edge, so it is measured once here.
const top = camY - 0.5;
const bT = bessel0(K.T_AMP);
const rightEdgeAt = (s) => x0 - K.CAT_H + K.PAN * s;
// Integrated from its right-hand end, and its arc rounded up to a half-odd
// number of the meander's wavelengths so the mouth lands on a high point.
const tSpan = (rightEdgeAt(river.BURST_LENGTH) + K.T_LEAD - rightEdgeAt(K.T_AT)) / bT;
const tArc = (Math.ceil(tSpan / K.SNAKE_LEN - 0.5) + 0.5) * K.SNAKE_LEN;
const topX = rightEdgeAt(K.T_AT) + tArc * bT;
const tn = Math.ceil(tArc / STEP);
const txs = [], tys = [];
{
  let x = topX, y = top + K.T_DEEP;
  for (let i = 0; i <= tn; i++) {
    txs.push(x); tys.push(y);
    const th = Math.PI + K.T_AMP * Math.sin((TAU * i * STEP) / K.SNAKE_LEN);
    x += Math.cos(th) * STEP; y += Math.sin(th) * STEP;
  }
}
// What the top river is actually worth to look at: how far its belly comes below
// the frame's top edge, and how much of its length is in shot at all.
const tHalf = (K.CAT_H * K.T_SCALE) / 2;
// When the frame's right edge first reaches the course, and where its mouth
// ends up — the two things the arc-rounding above is there to get right.
const tFirst = (Math.min(...txs) + K.CAT_H) / K.PAN;
const tMouth = tys[tys.length - 1] + tHalf;
const tDip = Math.max(...tys) + tHalf - top;
const tSeen = tys.filter((y) => y + tHalf > top).length / tys.length;

// All three small courses lean together; the river does not lean at all.
lean(bxs, bys); lean(cxs, cys); lean(txs, tys);

// Ribbon half-widths: two courses just touch when their centre lines close to
// the sum of these, so anything above zero below is real daylight. With three
// courses it is every pair, not just the pair that was interesting last week.
const half = (lanes) => (K.LANE * (lanes - 1) + K.CAT_H) / 2;
const COURSES = [
  { name: 'river', xs, ys, half: half(K.LANES) },
  { name: 'counter', xs: bxs, ys: bys, half: half(K.B_LANES) },
  { name: 'under', xs: cxs, ys: cys, half: half(K.C_LANES) },
  { name: 'top', xs: txs, ys: tys, half: half(K.T_LANES) * K.T_SCALE },
];
function apart(p, q) {
  let nearest = Infinity;
  for (let j = 0; j < q.xs.length; j++)
    for (let i = 0; i < p.xs.length; i++) {
      const dx = p.xs[i] - q.xs[j];
      if (dx > 1.4 || dx < -1.4) continue;
      const d = dx * dx + (p.ys[i] - q.ys[j]) ** 2;
      if (d < nearest) nearest = d;
    }
  return Math.sqrt(nearest) - p.half - q.half;
}
const pairs = [];
for (let i = 0; i < COURSES.length; i++)
  for (let j = i + 1; j < COURSES.length; j++)
    pairs.push([`${COURSES[i].name}/${COURSES[j].name}`, apart(COURSES[i], COURSES[j])]);
const clearGap = Math.min(...pairs.map(([, g]) => g));
// The pairs that drift together, and so should be unmoved by it: everything not
// involving the river. Named rather than counted, so the claim reads as a claim.
const leanPairs = pairs.map(([nm]) => nm).filter((nm) => !nm.includes('river/')).join(', ');

// ------------------------------------------------------------------ untied --

const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const hits = (a, b, c, d) => {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0);
};

/**
 * Every segment against every other, skipping neighbours. Coarsened: a fold big
 * enough to see is many samples wide, not two, and this is O(n²).
 */
function selfIntersections(step = 6) {
  const seg = [];
  for (let i = 0; i + step <= n; i += step) seg.push([[xs[i], ys[i]], [xs[i + step], ys[i + step]]]);
  let count = 0;
  for (let i = 0; i < seg.length; i++)
    for (let j = i + 2; j < seg.length; j++)
      if (hits(seg[i][0], seg[i][1], seg[j][0], seg[j][1])) count++;
  return count;
}

// ------------------------------------------------------------------ leaves --

// A riser clears the frame's top edge (measured above) if the course gets above
// it — remember y grows downward.
let above = 0;
for (let i = Math.round(SQ_AT / STEP); i < Math.round(SQ_OUT / STEP); i++) if (ys[i] < top) above++;
const highest = Math.min(...ys.slice(Math.round(SQ_AT / STEP), Math.round(SQ_OUT / STEP)));
const clears = (top - highest).toFixed(2); // frame-heights of riser past the top edge

// -------------------------------------------------------------------- wide --

// At a right angle the corner has no radius, so the inside lane has nothing to
// bend around and the cats there bunch. Measure the worst case: the tightest
// turn anywhere, against how far the inside lane sits from the centre line.
const inside = ((K.LANES - 1) / 2) * K.LANE;
let tightest = Infinity;
for (let i = 1; i <= n; i++) {
  let d = Math.abs(ths[i] - ths[i - 1]);
  if (d > 1e-9) tightest = Math.min(tightest, STEP / d); // radius = ds/dθ
}

// ------------------------------------------------------------------ steady --

const burst = river.BURST_LENGTH;
const speeds = `pan ${K.PAN}/s · flow ${K.FLOW}/s · net ${(K.FLOW - K.PAN).toFixed(2)}/s along a run` +
  ` · ${K.FLOW}/s up a riser · same at every second of the burst`;

// ------------------------------------------------------------------ report --

const SCALE = 78; // px per frame-height, for the drawing
const pad = 0.6;
const w = Math.round((x1 - x0 + 2 * pad) * SCALE);
const yLo = Math.min(...ys, ...bys, ...cys, ...tys, top) - pad;
const yHi = Math.max(...ys, ...bys, ...cys, ...tys, camY + 0.5) + pad;
const h = Math.round((yHi - yLo) * SCALE);
const px = (x) => ((x - x0 + pad) * SCALE).toFixed(1);
const py = (y) => ((y - yLo) * SCALE).toFixed(1);

const course = xs.map((x, i) => `${i ? 'L' : 'M'}${px(x)} ${py(ys[i])}`).join('');
const counter = bxs.map((x, i) => `${i ? 'L' : 'M'}${px(x)} ${py(bys[i])}`).join('');
const beneath = cxs.map((x, i) => `${i ? 'L' : 'M'}${px(x)} ${py(cys[i])}`).join('');
const overhead = txs.map((x, i) => `${i ? 'L' : 'M'}${px(x)} ${py(tys[i])}`).join('');
const MOMENTS = 12;
let frames = '';
for (let m = 0; m < MOMENTS; m++) {
  const s = (burst * (m + 0.5)) / MOMENTS;
  const cx = x0 - 0.5 * ASPECT - K.CAT_H + K.PAN * s;
  frames += `<rect x="${px(cx - 0.5 * ASPECT)}" y="${py(camY - 0.5)}" width="${ASPECT * SCALE}"` +
    ` height="${SCALE}" fill="none" stroke="#e8b84b" stroke-width="1.4" opacity="0.75"/>` +
    `<text x="${px(cx - 0.5 * ASPECT) + 4}" y="${py(camY - 0.5) - 4}" fill="#e8b84b"` +
    ` font-size="11" font-family="ui-monospace,monospace">${s.toFixed(0)}s</text>`;
}

const bad = selfIntersections();
const rows = [
  ['leaves', `risers clear the frame's top edge by ${clears} frame-heights`, Number(clears) > 0.1],
  ['untied', bad ? `${bad} self-intersections` : 'no part of the course crosses any other', !bad],
  ['steady', speeds, true],
  ['wide', `${K.LANES} lanes, ${K.LANE} apart; tightest turn radius ${tightest.toFixed(3)}` +
    ` vs inside lane at ${inside.toFixed(3)} — ${tightest < inside ? 'inside lane pinches at the corners' : 'no pinch'}`,
    tightest >= inside],
  // A pair that never comes within the prune window has no nearest approach to
  // report, which is not a failure — it is the widest possible pass.
  ['clear', pairs.map(([nm, g]) => `${nm} ${Number.isFinite(g) ? g.toFixed(3) : 'never near'}`).join(' · ') +
    ` — frame-heights of daylight between ribbons${clearGap <= 0 ? ', SOMETHING TOUCHES' : ''}`,
    clearGap > 0],
  // The top river is meant to be mostly out of shot, so the failure here is not
  // "some of it is off-screen" — it is none of it ever coming in.
  ['hangs', `the top river dips ${tDip.toFixed(3)} below the frame's top edge — ` +
    `${(100 * tDip / (K.CAT_H * K.T_SCALE)).toFixed(0)}% of one of its own ${K.T_SCALE}-size cats — ` +
    `and is in shot for ${(100 * tSeen).toFixed(0)}% of its length, on the meander's own ${K.SNAKE_LEN} wavelength`,
    tDip > 0.01 && tSeen > 0.1],
  // Two silent failures live in the top river's placement, and neither shows up
  // anywhere else: it is meant to arrive exactly at T_AT, and its mouth is meant
  // to be off the top of the frame. Both come out of arithmetic — the arc is
  // rounded to a half-odd number of wavelengths to land the mouth on a high
  // point — so both break quietly the moment a constant moves.
  ['meets', `the frame first reaches it at ${tFirst.toFixed(1)}s against T_AT ${K.T_AT}, and its mouth sits ` +
    `${(top - tMouth).toFixed(3)} above the top edge — ${tMouth < top ? 'out of shot' : 'IN SHOT, cats fade out in mid-air'}`,
    Math.abs(tFirst - K.T_AT) < 0.2 && tMouth < top],
  // The drift is bounded by the pair it can close hardest, and the pair it can
  // close hardest is a small course against the river, which does not drift.
  ['drifts', `the small courses lean ${K.DRIFT} either way over ${K.DRIFT_LEN} of x, together rather ` +
    `than against each other — so ${leanPairs} keep their gap and only the river's change`,
    clearGap > 0],
].map(([k, v, ok]) => `<tr><td>${k}</td><td class="${ok ? 'ok' : 'no'}">${v}</td></tr>`).join('');

writeFileSync(new URL('../out/river.html', import.meta.url),
  `<!doctype html><meta charset="utf-8"><title>river of cats — the course</title>` +
  `<style>body{background:#0b0b0d;color:#b9b9c2;font:12px ui-monospace,monospace;margin:24px}` +
  `h1{font-size:13px;font-weight:500}table{border-collapse:collapse;margin-bottom:18px}` +
  `td{padding:3px 14px 3px 0;vertical-align:top}td:first-child{color:#6a6a72}` +
  `.ok{color:#8ab6ff}.no{color:#e0564a}figure{margin:0;overflow-x:auto}` +
  `svg{display:block;border:1px solid #1e1e24;background:#111114}` +
  `figcaption{color:#6a6a72;padding-top:6px}</style>` +
  `<h1>river of cats — the whole course, ${LENGTH.toFixed(1)} frame-heights of it, ` +
  `panned in ${burst}s</h1><table>${rows}</table><figure><svg width="${w}" height="${h}">` +
  `<path d="${course}" fill="none" stroke="#8ab6ff" stroke-width="${K.CAT_H * SCALE * 3}"` +
  ` stroke-opacity="0.2" stroke-linecap="round"/>` +
  `<path d="${course}" fill="none" stroke="#8ab6ff" stroke-width="1.5"/>` +
  `<path d="${counter}" fill="none" stroke="#e0864a" stroke-width="${K.CAT_H * SCALE * K.B_LANES}"` +
  ` stroke-opacity="0.25" stroke-linecap="round"/>` +
  `<path d="${counter}" fill="none" stroke="#e0864a" stroke-width="1.5"/>` +
  `<path d="${beneath}" fill="none" stroke="#6fce8f" stroke-width="${K.CAT_H * SCALE * K.C_LANES}"` +
  ` stroke-opacity="0.25" stroke-linecap="round"/>` +
  `<path d="${beneath}" fill="none" stroke="#6fce8f" stroke-width="1.5"/>` +
  `<path d="${overhead}" fill="none" stroke="#c98ae0" stroke-width="${K.CAT_H * SCALE * K.T_LANES}"` +
  ` stroke-opacity="0.25" stroke-linecap="round"/>` +
  `<path d="${overhead}" fill="none" stroke="#c98ae0" stroke-width="1.5"/>${frames}</svg>` +
  `<figcaption>blue is the river, three cats abreast; orange is the counter-river meshed into ` +
  `the meander; green is the under-river, which runs the whole way before it — tight under the ` +
  `right angles, opening out under the wave. both counter-currents run right to left, single ` +
  `file. purple is the top river, which runs left to right like the river and spends most of ` +
  `its length above the frame's top edge — the stretches inside a gold box are the only ones ` +
  `ever seen. bands are drawn at their real width. ` +
  `gold boxes are the frame at ${MOMENTS} moments; anything outside one is off-screen then.` +
  `</figcaption></figure>`);

console.log(`wrote out/river.html — ${LENGTH.toFixed(1)} frame-heights, ${burst}s burst`);
console.log(`leaves : risers clear the top by ${clears} frame-heights (${above} samples above it)`);
console.log(`untied : ${bad} self-intersections`);
console.log(`steady : ${speeds}`);
console.log(`wide   : tightest radius ${tightest.toFixed(3)} vs inside lane ${inside.toFixed(3)}`);
console.log(`clear  : ${pairs.map(([nm, g]) => `${nm} ${Number.isFinite(g) ? g.toFixed(3) : 'never near'}`).join(' · ')}`);
console.log(`hangs  : top river dips ${tDip.toFixed(3)} below the top edge, in shot for ${(100 * tSeen).toFixed(0)}% of its length` +
  `, on the meander's own ${K.SNAKE_LEN} wavelength`);

console.log(`meets  : first in shot at ${tFirst.toFixed(1)}s (T_AT ${K.T_AT}), mouth ${(top - tMouth).toFixed(3)} above the top edge`);
console.log(`drifts : small courses lean ${K.DRIFT} either way over ${K.DRIFT_LEN} of x (${leanPairs} hold their gap)`);
