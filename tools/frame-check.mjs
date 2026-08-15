/**
 * frame-check.mjs — look at the tall view without a canvas.
 *
 *   ORIENT=portrait node tools/frame-check.mjs   # writes out/frame.html
 *
 * frame.js is four lines of matrix and every one of them is a chance to turn the
 * cats the wrong way, mirror them into upside-down, or crop the picture at the
 * edge where nobody is looking. None of that needs a browser to find: a canvas
 * transform is a 3×2 matrix, so this feeds frame.js's own turn() and upright()
 * into a context that records the matrix and does nothing else. What is checked
 * is the shipped code, not a second copy of the arithmetic written to agree with
 * it.
 *
 * Five claims:
 *
 *   fits      the wide frame's four corners land on the tall canvas's four
 *             corners. Not approximately — a quarter turn is exact, and any
 *             slop here is a picture being cropped or letterboxed twice
 *   stands    a cat drawn plumb comes out plumb. This is what upright() is for
 *             and it is the whole visible point of the change
 *   mirrors   a flipped cat comes out mirrored left-to-right on the canvas, and
 *             not upside down. The two differ only in whether upright() is
 *             applied before or after the scale(-1, 1), which is exactly the
 *             kind of thing that reads fine in a diff and is wrong on screen
 *   turned    a cat that set its own angle keeps it, turned. The moon's chain,
 *             the fan, the spiral and the river are supposed to lie over — this
 *             confirms they were left alone rather than missed
 *   crescent  where the moon actually ends up, in numbers: how far down the tall
 *             frame its centre sits, and which way the hollow opens
 *
 * The picture is the tall frame with the moon's own lune in it — read out of
 * moon.js's keepClear(), not redrawn here — and a row of cats at each of the
 * call sites, each one carrying the matrix that site would give it. A cat that
 * comes out on its ear in the SVG comes out on its ear on the canvas.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { ORIENT, TURN, SIZE, turn, upright, frameOf } from '../frame.js';
import { keepClear as moonClear } from '../moon.js';

// frame.js's own answer, not a size typed here — the checker is worth nothing if
// it can pass at a resolution the page never uses. The wide view has no pinned
// size unless one is asked for, so it gets 1920×1080 to be measured at.
const [w, h] = SIZE ?? [1920, 1080];
const CANVAS = { width: w, height: h };

/**
 * The recording context: enough of CanvasRenderingContext2D to run frame.js and
 * nothing else. Matrices multiply the way the spec says — a transform call is
 * applied to the *current* matrix on the right, so calls compose in the order
 * they are written.
 */
function recorder() {
  let m = [1, 0, 0, 1, 0, 0]; // a b c d e f
  const stack = [];
  const mul = (n) => {
    m = [
      m[0] * n[0] + m[2] * n[1],
      m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4],
      m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  };
  return {
    save: () => stack.push([...m]),
    restore: () => (m = stack.pop()),
    translate: (x, y) => mul([1, 0, 0, 1, x, y]),
    rotate: (a) => mul([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]),
    scale: (x, y) => mul([x, 0, 0, y, 0, 0]),
    get m() {
      return m;
    },
  };
}

/** A point through a matrix, and a direction through it (no translation). */
const pt = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const dir = (m, x, y) => [m[0] * x + m[2] * y, m[1] * x + m[3] * y];

/** The matrix a given call site hands its cat, at composition point (x, y). */
function site(W, H, x, y, { stand = false, flip = false, angle = 0 } = {}) {
  const ctx = recorder();
  turn(ctx, CANVAS);
  ctx.translate(x, y);
  if (stand) upright(ctx);
  if (angle) ctx.rotate(angle);
  if (flip) ctx.scale(-1, 1);
  return ctx.m;
}

const { W, H } = frameOf(CANVAS);
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const rows = [];
const claim = (name, ok, note) => rows.push({ name, ok, note });

// -- fits ---------------------------------------------------------------------
{
  const ctx = recorder();
  turn(ctx, CANVAS);
  const corners = [
    [0, 0],
    [W, 0],
    [W, H],
    [0, H],
  ].map(([x, y]) => pt(ctx.m, x, y));
  const inside = corners.every(([x, y]) => near(Math.min(Math.max(x, 0), CANVAS.width), x) && near(Math.min(Math.max(y, 0), CANVAS.height), y));
  const hit = new Set(corners.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`));
  const want = new Set([`0,0`, `${CANVAS.width},0`, `${CANVAS.width},${CANVAS.height}`, `0,${CANVAS.height}`]);
  claim(
    'fits',
    inside && hit.size === 4 && [...want].every((k) => hit.has(k)),
    `${W}×${H} composition → ${CANVAS.width}×${CANVAS.height} canvas, corners ${[...hit].join('  ')}`,
  );
}

// -- stands -------------------------------------------------------------------
{
  const m = site(W, H, 0.5 * W, 0.5 * H, { stand: true });
  const [ux, uy] = dir(m, 0, -1); // the cat's own "up"
  claim('stands', near(ux, 0) && near(uy, -1), `a plumb cat's up-vector on canvas is (${ux.toFixed(3)}, ${uy.toFixed(3)}) — want (0, -1)`);
}

// -- mirrors ------------------------------------------------------------------
{
  const m = site(W, H, 0.5 * W, 0.5 * H, { stand: true, flip: true });
  const [ux, uy] = dir(m, 0, -1);
  const [rx, ry] = dir(m, 1, 0); // the cat's own "right"
  claim(
    'mirrors',
    near(ux, 0) && near(uy, -1) && near(rx, -1) && near(ry, 0),
    `flipped: up (${ux.toFixed(3)}, ${uy.toFixed(3)}) still up, right (${rx.toFixed(3)}, ${ry.toFixed(3)}) reversed`,
  );
}

// -- turned -------------------------------------------------------------------
{
  // The moon's chain sets rotate(th + π/2) per cat; take one at th = 0, the
  // belly of the crescent, where the cat should lie across the lit edge.
  const own = Math.PI / 2;
  const m = site(W, H, 0.5 * W, 0.5 * H, { angle: own });
  const [ux, uy] = dir(m, 0, -1);
  const got = Math.atan2(ux, -uy); // 0 when up is up, positive clockwise
  claim('turned', near(got, own + TURN, 1e-6), `a cat with its own ${own.toFixed(3)} rad comes out at ${got.toFixed(3)} — its angle plus the frame's ${TURN.toFixed(3)}`);
}

// -- crescent -----------------------------------------------------------------
{
  const [lune] = moonClear(W, H);
  const ctx = recorder();
  turn(ctx, CANVAS);
  const [cx, cy] = pt(ctx.m, lune.x, lune.y);
  // The lit side of the crescent is the side away from the bite. In the wide
  // frame the bite sits to the left of centre, so "lit" points along +x.
  const [lx, ly] = dir(ctx.m, 1, 0);
  const down = ly > 0.5;
  claim(
    'crescent',
    TURN ? down : !down,
    `centre ${(100 * cx / CANVAS.width).toFixed(0)}% across, ${(100 * cy / CANVAS.height).toFixed(0)}% down · ` +
      `lit side points (${lx.toFixed(2)}, ${ly.toFixed(2)}) — ${down ? 'down: it is on its back, hollow opening up' : 'right: upright crescent'}`,
  );
}

// -- the picture --------------------------------------------------------------

const CAT = 46; // one demo cat, canvas px tall
const CATS = [
  { at: [0.5, 0.18], stand: true, label: 'scattered voices' },
  { at: [0.5, 0.34], stand: true, flip: true, label: 'flipped' },
  { at: [0.5, 0.5], stand: true, label: 'lozenge ground' },
  { at: [0.5, 0.66], stand: true, label: 'face frame' },
  { at: [0.5, 0.82], angle: Math.PI / 2, label: "moon chain (keeps its own angle)" },
];

const mat = (m) => `matrix(${m.map((v) => v.toFixed(4)).join(' ')})`;

const demo = CATS.map((c) => {
  const m = site(W, H, c.at[0] * W, c.at[1] * H, c);
  // A cat-shaped box with a head on top, so which way is up is unmissable.
  return `<g transform="${mat(m)}">
      <rect x="${-CAT * 0.35}" y="${-CAT * 0.5}" width="${CAT * 0.7}" height="${CAT}" rx="5" fill="#2c2c38" stroke="#6f6f86"/>
      <circle cx="0" cy="${-CAT * 0.34}" r="${CAT * 0.2}" fill="#8a8a99"/>
      <path d="M${-CAT * 0.19} ${-CAT * 0.47} l${CAT * 0.07} ${-CAT * 0.15} l${CAT * 0.09} ${CAT * 0.1} z
               M${CAT * 0.19} ${-CAT * 0.47} l${-CAT * 0.07} ${-CAT * 0.15} l${-CAT * 0.09} ${CAT * 0.1} z" fill="#8a8a99"/>
    </g>`;
}).join('\n');

const labels = CATS.map((c) => {
  const [x, y] = pt(site(W, H, c.at[0] * W, c.at[1] * H, {}), 0, 0);
  return `<text x="${x + CAT * 0.6}" y="${y + 4}" fill="#7d7d88" font-size="15">${c.label}</text>`;
}).join('\n');

const [lune] = moonClear(W, H);
const ctx = recorder();
turn(ctx, CANVAS);

const svg = `<svg viewBox="0 0 ${CANVAS.width} ${CANVAS.height}" width="${CANVAS.width / 2.4}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${CANVAS.width}" height="${CANVAS.height}" fill="#0b0b0d"/>
  <g transform="${mat(ctx.m)}">
    <rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#23232c" stroke-width="3"/>
    <mask id="bite">
      <rect x="0" y="0" width="${W}" height="${H}" fill="white"/>
      <circle cx="${lune.bx}" cy="${lune.by}" r="${lune.br}" fill="black"/>
    </mask>
    <circle cx="${lune.x}" cy="${lune.y}" r="${lune.r}" fill="#1b1b26" mask="url(#bite)"/>
  </g>
  ${demo}
  ${labels}
</svg>`;

const html = `<!doctype html><meta charset="utf-8"><title>frame — ${ORIENT}</title>
<style>
  body { margin:0; background:#0b0b0d; color:#8a8a99; font:13px ui-monospace,monospace; padding:26px 30px; }
  h1 { font-size:14px; font-weight:500; color:#cfcfd8; margin:0 0 4px; letter-spacing:.06em; }
  p { color:#5c5c66; margin:0 0 20px; }
  table { border-collapse:collapse; margin-bottom:22px; }
  td { padding:4px 16px 4px 0; vertical-align:top; }
  .ok { color:#7fbf7f; } .no { color:#d07070; }
  .name { color:#cfcfd8; }
  .note { color:#6a6a72; }
</style>
<h1>frame.js — ${ORIENT}, ${CANVAS.width}×${CANVAS.height} canvas, ${W}×${H} composition</h1>
<p>the shape on the left is the moon's own keepClear() lune, carried through the same matrix the canvas uses</p>
<table>${rows
  .map(
    (r) =>
      `<tr><td class="${r.ok ? 'ok' : 'no'}">${r.ok ? 'ok' : 'FAIL'}</td><td class="name">${r.name}</td><td class="note">${r.note}</td></tr>`,
  )
  .join('')}</table>
${svg}
`;

mkdirSync('out', { recursive: true });
writeFileSync('out/frame.html', html);

const bad = rows.filter((r) => !r.ok);
for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name.padEnd(9)} ${r.note}`);
console.log(`\nout/frame.html — ${ORIENT}`);
process.exitCode = bad.length ? 1 : 0;
