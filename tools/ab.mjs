/**
 * ab.mjs — record the piece, and optionally record what it USED to be next to it.
 *
 *   node tools/ab.mjs --at=slack --secs=12
 *   node tools/ab.mjs --at=hightide --against=HEAD      → clips/ab.mp4, side by side
 *   node tools/ab.mjs --t=95 --secs=20 --against=main
 *
 * This is the review artifact for anything you have to JUDGE rather than check:
 * does the drop land, is the bell too bright, did that change actually help.
 * Reading a diff cannot answer those questions and neither can a screenshot.
 *
 * `--against=<git ref>` is the whole point. It checks that ref out into a
 * throwaway worktree, serves it on a second port, records the same seconds of
 * it, and stacks the two clips into one file — before on the left, after on the
 * right, one shared timeline. If a change is not visibly or audibly better
 * side by side, it is not better.
 *
 * Recording happens inside the page (canvas capture + a passive tap on the audio
 * bus) rather than off the screen, so the take has no window chrome in it, no
 * other application's sound, and no A/V drift.
 *
 * It runs headed and in real time — 12 seconds of clip costs 12 seconds, twice
 * if you asked for a comparison. Leave the window visible while it runs.
 */
import { existsSync, mkdirSync, writeFileSync, appendFileSync, statSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// bus.js is pure ESM with no browser dependencies, so node can import it and
// ask the same questions the page does. That is not an accident — see CLAUDE.md.
import { SECTIONS } from '../score/score.js';
import { BAR_SECONDS, SECTION_STARTS } from '../src/bus.js';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};

const secs = Number(arg('secs', 12));
const fps = Number(arg('fps', 30));
const against = arg('against', null);
const outDir = resolve(arg('outdir', 'clips'));
const WORKTREE = resolve('.ab-worktree');

// --at=<section name> is the friendly form; --t=<seconds> is the precise one.
const sectionName = arg('at', null);
let startAt = Number(arg('t', 0));
if (sectionName) {
  const idx = SECTIONS.findIndex((s) => s.name === sectionName);
  if (idx < 0) {
    console.error(`no section called "${sectionName}". Try: ${SECTIONS.map((s) => s.name).join(', ')}`);
    process.exit(1);
  }
  startAt = SECTION_STARTS[idx] * BAR_SECONDS;
}

mkdirSync(outDir, { recursive: true });

// -------------------------------------------------------------- recording ----
async function record({ root, port, label, out }) {
  const server = await createServer({ root, server: { port } });
  await server.listen();
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  console.log(`[${label}] loading…`);
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForFunction(() => Boolean(window.tidewater?.visuals), null, { timeout: 60_000 });
  await page.evaluate(() => document.getElementById('overlay').click());

  // wait for actual notes before rolling, or the clip opens on silence
  await page.evaluate(() => {
    window.__heard = 0;
    window.tidewater.bus.subscribe((e) => { if (e.type === 'note') window.__heard++; });
  });
  await page.waitForFunction(() => window.__heard > 8, null, { timeout: 60_000 });

  const webm = resolve(outDir, `.${label}.webm`);
  writeFileSync(webm, Buffer.alloc(0));
  await page.exposeFunction('__chunk', (b64) => appendFileSync(webm, Buffer.from(b64, 'base64')));

  console.log(`[${label}] recording ${secs}s from ${startAt.toFixed(1)}s…`);
  const peak = await page.evaluate(async ({ secs, fps, startAt }) => {
    const { bus, getAudioTap, seekToBar } = window.tidewater;
    const canvas = document.getElementById('scene');
    const { ctx, node } = getAudioTap();

    const dest = ctx.createMediaStreamDestination();
    node.connect(dest); // passive — node keeps every other connection it has

    // measure while we record, so the run can tell you if it clipped or was silent
    const meter = ctx.createAnalyser();
    meter.fftSize = 2048;
    node.connect(meter);
    const buf = new Float32Array(meter.fftSize);
    let loudest = 0;

    seekToBar(Math.floor(startAt / bus.BAR_SECONDS));
    await new Promise((r) => setTimeout(r, 900)); // let the seek settle

    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      .find((m) => MediaRecorder.isTypeSupported(m));
    const stream = new MediaStream([
      ...canvas.captureStream(fps).getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 });

    let chain = Promise.resolve();
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      chain = chain.then(async () => {
        const b = new Uint8Array(await e.data.arrayBuffer());
        let s = '';
        for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
        await window.__chunk(btoa(s));
      });
    };

    const poll = setInterval(() => {
      meter.getFloatTimeDomainData(buf);
      for (const v of buf) loudest = Math.max(loudest, Math.abs(v));
    }, 50);

    rec.start(500);
    await new Promise((r) => setTimeout(r, secs * 1000));
    await new Promise((r) => { rec.onstop = r; rec.stop(); });
    clearInterval(poll);
    node.disconnect(dest);
    node.disconnect(meter);
    await chain;
    return loudest;
  }, { secs, fps, startAt });

  await browser.close();
  await server.close();

  execFileSync('ffmpeg', [
    '-y', '-v', 'error', '-i', webm,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out,
  ]);
  rmSync(webm, { force: true });

  const peakDb = peak > 0 ? (20 * Math.log10(peak)).toFixed(1) : '-inf';
  console.log(`[${label}] → ${out}  (${(statSync(out).size / 1e6).toFixed(1)} MB, peak ${peakDb} dBFS)`);
  if (peak < 0.001) console.log(`[${label}] WARNING: that clip is silent.`);
  if (peak >= 0.999) console.log(`[${label}] WARNING: that clip is clipping — pull LEVELS down in score.js.`);
  if (errors.length) console.log(`[${label}] page errors: ${errors.join(' | ')}`);
  return out;
}

// ------------------------------------------------------------------- run -----
const afterPath = resolve(outDir, 'after.mp4');
await record({ root: process.cwd(), port: 5191, label: 'after', out: afterPath });

if (!against) {
  console.log(`\nOne clip: ${afterPath}`);
  console.log(`For a comparison, re-run with --against=HEAD`);
  process.exit(0);
}

// --- the "before" side: a throwaway worktree at the requested ref
rmSync(WORKTREE, { recursive: true, force: true });
execFileSync('git', ['worktree', 'prune']);
execFileSync('git', ['worktree', 'add', '--detach', WORKTREE, against], { stdio: 'inherit' });
// worktrees have no node_modules of their own; share ours
if (!existsSync(resolve(WORKTREE, 'node_modules'))) {
  execFileSync('ln', ['-s', resolve('node_modules'), resolve(WORKTREE, 'node_modules')]);
}

const beforePath = resolve(outDir, 'before.mp4');
try {
  await record({ root: WORKTREE, port: 5192, label: 'before', out: beforePath });
} finally {
  rmSync(resolve(WORKTREE, 'node_modules'), { force: true });
  execFileSync('git', ['worktree', 'remove', '--force', WORKTREE]);
}

// --- stack them. Left is before, right is after; audio comes from the after side.
const abPath = resolve(outDir, 'ab.mp4');
execFileSync('ffmpeg', [
  '-y', '-v', 'error', '-i', beforePath, '-i', afterPath,
  '-filter_complex', '[0:v][1:v]hstack=inputs=2[v]',
  '-map', '[v]', '-map', '1:a',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', abPath,
]);

console.log(`\n${abPath}`);
console.log(`  LEFT  = ${against} (before)`);
console.log(`  RIGHT = working tree (after)`);
console.log(`  audio = the after side`);
