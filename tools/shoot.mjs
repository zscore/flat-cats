/**
 * shoot.mjs — one frame of the picture, as a PNG, without a browser window.
 *
 *   node tools/shoot.mjs 25.56                 # wide,  -> out/shot_25.56_landscape.png
 *   node tools/shoot.mjs 25.56 portrait        # tall
 *   node tools/shoot.mjs 25.56 portrait 567    # and a line down the frame at x=567
 *
 * This exists because the thing being changed is a picture and a diff is not a
 * review artifact for a picture. draw() is a pure function of time, so one frame
 * needs no transport and no audio — shot.html builds the stage, draws at `t` and
 * nothing else, which is also why this cannot go through song.html: creating an
 * AudioContext in headless Chrome hangs, and the frame never arrives.
 *
 * Everything is thrown away afterwards: its own server on a free port, Chrome's
 * own throwaway profile. Nothing is left listening and nothing is cached between
 * runs, so two shoots of the same frame are the same PNG — checked, not assumed.
 *
 * The retry is not superstition. `--screenshot` grabs the canvas at a moment
 * this script does not control, and a page that has not finished loading its
 * eighty cats hands back a black frame; shot.html redraws every frame so any
 * late grab is a good one, and this counts lit pixels to know a grab landed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SIZES = { landscape: [1920, 1080], portrait: [1080, 1920] };
const TRIES = 5;

const [t = '0', orient = 'landscape', mark] = process.argv.slice(2);
if (!SIZES[orient]) {
  console.error(`shoot.mjs: orient must be landscape or portrait, not ${orient}`);
  process.exit(2);
}
const [w, h] = SIZES[orient];

// --------------------------------------------------------------- the server --

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.wav': 'audio/wav' };

const server = createServer((req, res) => {
  const path = join(process.cwd(), decodeURIComponent(req.url.split('?')[0]));
  // Not a security boundary — it serves the repo to localhost for a few seconds
  // — but a stray ../ should still 404 rather than read someone's home directory.
  if (!path.startsWith(process.cwd())) return res.writeHead(403).end();
  try {
    if (statSync(path).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(readFileSync(path));
  } catch {
    res.writeHead(404).end();
  }
});

await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;

// ----------------------------------------------------------------- the shot --

mkdirSync('out', { recursive: true });
const out = `out/shot_${t}_${orient}.png`;
const query = `t=${t}&orient=${orient}` + (mark ? `&mark=${mark},0` : '');

/** Lit pixels in a PNG, near enough — a black frame is a grab that came early. */
function lit(file) {
  const r = spawnSync('.venv/bin/python', ['-c', `
import numpy as np
from PIL import Image
print(int((np.array(Image.open(${JSON.stringify(file)}).convert('L')) > 20).sum()))
`]);
  return Number(r.stdout?.toString().trim()) || 0;
}

let ok = false;
for (let k = 1; k <= TRIES && !ok; k++) {
  const chrome = spawn(CHROME, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${w},${h}`,
    // Virtual time lets the page's whole load run before the grab, and gets a
    // little longer each try rather than being one guess repeated.
    `--virtual-time-budget=${6000 + k * 4000}`,
    `--screenshot=${out}`,
    `http://127.0.0.1:${port}/shot.html?${query}`,
  ]);
  await new Promise((done) => chrome.on('exit', done));
  const n = lit(out);
  if (n > 5000) {
    console.log(`${out}  ${w}×${h}  t=${t}s  ${n} lit px  (try ${k})`);
    ok = true;
  }
}
if (!ok) console.error(`shoot.mjs: ${out} came back empty after ${TRIES} tries — is the page erroring?`);

server.close();
process.exit(ok ? 0 : 1);
