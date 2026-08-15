/**
 * face-check.mjs — look at the frame the face burst draws round itself.
 *
 *   node tools/face-check.mjs   # writes out/face.html
 *
 * face.js draws cats and there is no canvas here to draw them on, so this does
 * what river-check.mjs does: reads the constants back out of the source, builds
 * the same slots and the same timing, and draws where they are and when. Four
 * claims:
 *
 *   corners   the four corners are first in and last out. This is not arranged
 *             by a special case in face.js — it falls out of the second wave
 *             being indexed from the far end — so it is worth checking that it
 *             actually does
 *   whole     the frame is completely up for a while before any of it leaves.
 *             If the two waves overlap, there is no moment where you see the
 *             shape, only cats coming and going
 *   done      the frame has finished unwinding before the burst's own fade, so
 *             it is not still going when the picture is taken away
 *   inside    no cat hangs off the edge of the frame at any window shape
 *
 * The picture is the rectangle at a dozen moments through the burst, each cat
 * drawn at the opacity face.js would give it, with the head box marked so the
 * overlap between the frame and the face is visible rather than argued about.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const src = readFileSync(new URL('../face.js', import.meta.url), 'utf8');
const { BURST_LENGTH } = await import('../face.js');

// Same trick, and the same reason, as river-check.mjs: face.js keeps its
// internals private, which is right for the module and awkward for a checker.
const num = (name) => {
  const m = src.match(new RegExp(`^const ${name} = ([-\\d./ ]+);`, 'm'));
  if (!m) throw new Error(`no constant ${name} in face.js`);
  return eval(m[1]);
};
const HOLD = num('HOLD');
const HEAD_H = num('HEAD_H');
const EDGE_H = num('EDGE_H');
const EDGE_INSET = num('EDGE_INSET');
const EDGE_STEP = num('EDGE_STEP');
const EDGE_SWEEP = num('EDGE_SWEEP');
const EDGE_FADE = num('EDGE_FADE');
const EDGE_OUT = num('EDGE_OUT');
const EDGE_IN = HOLD; // face.js sets EDGE_IN = HOLD, which `num` cannot read

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ramp = (x, a, b) => smooth((x - a) / (b - a));

function edgeSlots(W, H) {
  const m = EDGE_INSET * H;
  const corner = [
    [m, m],
    [W - m, m],
    [W - m, H - m],
    [m, H - m],
  ];
  const out = [];
  for (let side = 0; side < 4; side++) {
    const [ax, ay] = corner[side];
    const [bx, by] = corner[(side + 1) % 4];
    const n = Math.max(2, Math.round((Math.abs(bx - ax) + Math.abs(by - ay)) / (EDGE_STEP * H)));
    for (let j = 0; j < n; j++) {
      const f = j / n;
      out.push({ x: ax + (bx - ax) * f, y: ay + (by - ay) * f, f, side, corner: j === 0 });
    }
  }
  return out;
}

const edgeAlpha = (s, f) => {
  const inAt = EDGE_IN + f * EDGE_SWEEP;
  const outAt = EDGE_OUT + (1 - f) * EDGE_SWEEP;
  return ramp(s, inAt, inAt + EDGE_FADE) * (1 - ramp(s, outAt, outAt + EDGE_FADE));
};

// ---- the claims -------------------------------------------------------------

const W = 1600;
const H = 900;
const slots = edgeSlots(W, H);
const checks = [];
const claim = (name, ok, detail) => checks.push({ name, ok, detail });

// When each slot crosses half-up on the way in, and half-down on the way out.
const cross = (f, up) => {
  let lo = 0;
  let hi = BURST_LENGTH;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const a = edgeAlpha(mid, f);
    if (up ? a < 0.5 : a > 0.5) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

const ins = slots.map((s) => cross(s.f, true));
const outs = slots.map((s) => cross(s.f, false));
const cornerIdx = slots.map((s, i) => (s.corner ? i : -1)).filter((i) => i >= 0);
const firstIn = Math.min(...ins);
const lastIn = Math.max(...ins);
const firstOut = Math.min(...outs);
const lastOut = Math.max(...outs);

claim(
  'corners',
  cornerIdx.every((i) => ins[i] <= firstIn + 1e-6 && outs[i] >= lastOut - 1e-6),
  `corners in at ${ins[cornerIdx[0]].toFixed(2)}s (first ${firstIn.toFixed(2)}s), ` +
    `out at ${outs[cornerIdx[0]].toFixed(2)}s (last ${lastOut.toFixed(2)}s)`,
);
claim(
  'whole',
  lastIn < firstOut,
  `fully up ${lastIn.toFixed(2)}s → ${firstOut.toFixed(2)}s, a hold of ${(firstOut - lastIn).toFixed(2)}s`,
);
claim('done', lastOut < BURST_LENGTH, `last cat gone at ${lastOut.toFixed(2)}s, burst ends at ${BURST_LENGTH.toFixed(2)}s`);

// Widest and narrowest windows anyone is likely to have, plus the square case.
const shapes = [
  [2560, 1080],
  [1600, 900],
  [1000, 1000],
];
const worst = shapes
  .map(([w, h]) => {
    const half = (EDGE_H * h) / 2;
    const m = Math.min(...edgeSlots(w, h).flatMap((s) => [s.x - half, s.y - half, w - s.x - half, h - s.y - half]));
    return { w, h, m };
  })
  .reduce((a, b) => (b.m < a.m ? b : a));
claim(
  'inside',
  worst.m >= 0,
  `tightest clearance ${worst.m.toFixed(1)}px at ${worst.w}×${worst.h} ` +
    `(cat is ${(EDGE_H * worst.h).toFixed(0)}px tall)`,
);

// ---- the picture ------------------------------------------------------------

const MOMENTS = [2.4, 2.9, 3.6, 4.6, 5.8, 7.0, 8.0, 8.8, 9.8, 11.0, 12.0, 12.6];

const panel = (s) => {
  const k = 0.22; // shrink the frame down to a thumbnail
  const hw = ((HEAD_H * H) / 2) * k; // nominal square head; the real one is the image's aspect
  const body = slots
    .map((sl) => {
      const a = edgeAlpha(s, sl.f);
      if (a <= 0.004) return '';
      return `<circle cx="${(sl.x * k).toFixed(1)}" cy="${(sl.y * k).toFixed(1)}" r="${((EDGE_H * H) / 2.6) * k}"
        fill="${sl.corner ? '#e0663a' : '#4c7fb8'}" opacity="${a.toFixed(3)}"/>`;
    })
    .join('');
  return `<figure>
  <svg viewBox="0 0 ${W * k} ${H * k}" width="${W * k}" height="${H * k}">
    <rect width="${W * k}" height="${H * k}" fill="#12151a"/>
    <rect x="${W * k * 0.5 - hw}" y="${H * k * 0.5 - hw}" width="${hw * 2}" height="${hw * 2}"
      fill="none" stroke="#5d6570" stroke-dasharray="4 4"/>
    ${body}
  </svg>
  <figcaption>${s.toFixed(1)}s</figcaption>
</figure>`;
};

const rows = checks
  .map((c) => `<tr><td>${c.ok ? '✓' : '✗'}</td><td>${c.name}</td><td>${c.detail}</td></tr>`)
  .join('\n');

const html = `<!doctype html><meta charset="utf-8"><title>face frame</title>
<style>
 body{background:#0b0d10;color:#c9d1d9;font:14px/1.5 ui-monospace,Menlo,monospace;margin:2rem}
 h1{font-size:1rem;font-weight:600} table{border-collapse:collapse;margin:1rem 0 2rem}
 td{padding:.25rem .8rem .25rem 0;vertical-align:top} tr td:first-child{color:#7ee787}
 tr.bad td:first-child{color:#ff7b72}
 .grid{display:flex;flex-wrap:wrap;gap:.9rem} figure{margin:0}
 figcaption{color:#6e7681;font-size:12px;padding-top:.2rem}
 p{color:#8b949e;max-width:60ch}
</style>
<h1>face.js — the frame, ${slots.length} cats, ${BURST_LENGTH.toFixed(1)}s burst</h1>
<table>${rows}</table>
<p>Orange is a corner, blue is everything else, opacity is what face.js would draw.
The dashed box is the head, at a nominal square aspect — the real one is whatever
the host cat's image is, so treat it as the smallest the head ever gets.</p>
<div class="grid">${MOMENTS.map(panel).join('')}</div>
`;

mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
writeFileSync(new URL('../out/face.html', import.meta.url), html);

for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name.padEnd(8)} ${c.detail}`);
console.log(`\nwrote out/face.html — ${slots.length} slots`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
