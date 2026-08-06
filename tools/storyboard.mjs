/**
 * storyboard.mjs — a contact sheet of the whole piece.
 *
 *   node tools/storyboard.mjs                 → board/storyboard.png
 *   node tools/storyboard.mjs --cols=6 --rows=5
 *   node tools/storyboard.mjs --headed        → watch it happen
 *
 * This is the fast review artifact. It takes a few seconds and it answers "what
 * does the piece look like, all of it, right now" in one image — which is the
 * question that is genuinely hard to answer by reading code.
 *
 * It works because `scene.renderAt(t)` is a pure function of time (see
 * src/visuals/scene.js). No audio is started, nothing is recorded in real time,
 * and every frame is exact rather than "whatever was on screen when we looked".
 *
 * The sheet is assembled in the browser on a canvas — labels and all — so this
 * tool needs no ffmpeg and no fonts installed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const flag = (k) => process.argv.includes(`--${k}`);

const cols = Number(arg('cols', 5));
const rows = Number(arg('rows', 4));
const out = resolve(arg('out', 'board/storyboard.png'));
const PORT = Number(arg('port', 5199));

const server = await createServer({ root: process.cwd(), server: { port: PORT } });
await server.listen();

const browser = await chromium.launch({
  headless: !flag('headed'),
  args: ['--use-gl=angle', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://localhost:${PORT}/?still`, { waitUntil: 'load', timeout: 60_000 });
await page.waitForFunction(() => Boolean(window.tidewater?.visuals), null, { timeout: 60_000 });

const { dataUrl, total, frames } = await page.evaluate(({ cols, rows }) => {
  const { bus, visuals } = window.tidewater;
  const src = document.getElementById('scene');
  const CW = 384;                       // cell size on the sheet
  const CH = Math.round((CW * 9) / 16);
  const PAD = 6;
  const HEAD = 44;

  const sheet = document.createElement('canvas');
  sheet.width = cols * (CW + PAD) + PAD;
  sheet.height = HEAD + rows * (CH + PAD) + PAD;
  const g = sheet.getContext('2d');
  g.fillStyle = '#0d1215';
  g.fillRect(0, 0, sheet.width, sheet.height);

  g.fillStyle = '#d6e3e7';
  g.font = '600 17px ui-sans-serif, system-ui, sans-serif';
  g.fillText('tidewater — storyboard', PAD + 2, 26);
  g.fillStyle = '#7f959d';
  g.font = '400 12px ui-monospace, Menlo, monospace';
  const meta = `${bus.TOTAL_BARS} bars · ${bus.TOTAL_SECONDS.toFixed(0)}s · ${cols * rows} frames`;
  g.fillText(meta, sheet.width - g.measureText(meta).width - PAD - 2, 26);

  const n = cols * rows;
  const frames = [];
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.35) / n) * bus.TOTAL_SECONDS;
    visuals.renderAt(t);

    const cx = PAD + (i % cols) * (CW + PAD);
    const cy = HEAD + Math.floor(i / cols) * (CH + PAD);
    g.drawImage(src, cx, cy, CW, CH);

    const at = bus.sectionAt(t);
    frames.push({ t, section: at.name });

    // caption bar, so a frame is never anonymous
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(cx, cy + CH - 20, CW, 20);
    g.fillStyle = '#eaf3f5';
    g.font = '600 11px ui-monospace, Menlo, monospace';
    g.fillText(`${at.name}`, cx + 6, cy + CH - 6);
    g.fillStyle = 'rgba(234,243,245,0.7)';
    g.font = '400 11px ui-monospace, Menlo, monospace';
    const right = `${t.toFixed(0)}s · bar ${Math.floor(at.bar)} · T${bus.tensionAt(t).toFixed(2)} · B${bus.brightnessAt(t).toFixed(2)}`;
    g.fillText(right, cx + CW - g.measureText(right).width - 6, cy + CH - 6);
  }

  return { dataUrl: sheet.toDataURL('image/png'), total: bus.TOTAL_SECONDS, frames };
}, { cols, rows });

await browser.close();
await server.close();

mkdirSync(resolve(out, '..'), { recursive: true });
writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));

console.log(`storyboard → ${out}`);
console.log(`  ${frames.length} frames across ${total.toFixed(0)}s`);
const bySection = frames.reduce((a, f) => ({ ...a, [f.section]: (a[f.section] ?? 0) + 1 }), {});
console.log(`  ${Object.entries(bySection).map(([k, v]) => `${k}:${v}`).join('  ')}`);
if (errors.length) console.log(`  page errors:\n    ${errors.join('\n    ')}`);
