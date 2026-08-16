/**
 * ab.mjs — the same passage of the score, twice, on two instruments.
 *
 *   node tools/ab.mjs --from=24 --to=40        # -> out/ab_24-40.wav
 *
 * A diff is not a review artifact for an instrument. This renders a window of
 * public/song/notes.json through the sample bank, then the same window through
 * the built meows in meow.js, and lays them end to end with a gap. Same notes,
 * same score, same graph, same limiter — the only difference between the halves
 * is MIX.source, which is the only thing being judged.
 *
 * It renders through the real synth.js in a real browser rather than a copy of
 * the DSP written for node, because a copy would be the thing that is not being
 * shipped. Headless Chrome, an OfflineAudioContext, and the wav posted back
 * here. shoot.mjs warns that an AudioContext hangs in headless — an *Offline*
 * one does not, since it needs no sound card and no clock, only arithmetic.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TIMEOUT = 180_000;

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const FROM = Number(arg('from', 24));
const TO = Number(arg('to', 40));
const GAP = Number(arg('gap', 1));
const SCALE = process.argv.includes('--scale');
// Where the purr takes over, for both halves. Default is synth.js's own. Worth
// moving because the 200 Hz default is a limit of the sampler and not of the
// music: drop it and the bank half shows you why the line is there, while the
// synth half shows you whether it still needs to be.
const LOW = arg('low', '');
// One pass per lower-register voice instead of the bank/synth pair, e.g.
// --modes=purr,growl,purr-growl. --source picks what the upper register does
// while they are compared, and is held the same across all of them.
const MODES = arg('modes', '');
const SOURCE = arg('source', 'bank');
const OUT = arg('out', SCALE ? 'out/ab_scale.wav' : `out/ab_${FROM}-${TO}.wav`);

// --------------------------------------------------------------- the server --

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wav': 'audio/wav' };

let land;
const done = new Promise((ok) => (land = ok));

const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.writeHead(204).end();
      land({ kind: url, body: Buffer.concat(chunks) });
    });
    return;
  }
  // The page is served from memory rather than written into the repo: it is a
  // harness, not a page anyone opens, and one less untracked file at the root.
  if (url === '/__ab.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(PAGE);
  }
  const path = join(process.cwd(), decodeURIComponent(url));
  if (!path.startsWith(process.cwd())) return res.writeHead(403).end();
  try {
    if (statSync(path).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(readFileSync(path));
  } catch {
    res.writeHead(404).end();
  }
});

// ----------------------------------------------------------------- the page --

const PAGE = `<!doctype html><meta charset="utf-8"><body><script type="module">
const say = (kind, text) => navigator.sendBeacon(kind, text);
addEventListener('error', (e) => say('/err', 'error: ' + e.message));
addEventListener('unhandledrejection', (e) => say('/err', 'rejected: ' + (e.reason?.stack ?? e.reason)));
try {
  const { loadVoices, createSynth, planCats, MIX } = await import('/synth.js');
  const q = new URLSearchParams(location.search);
  let from = Number(q.get('from')), to = Number(q.get('to'));
  const gap = Number(q.get('gap'));
  const SR = 48000;
  const PURRS = ['sounds/purr_01_purring_cat.wav', 'sounds/purr_02_schnurren_einer_hauskatze_schnell.wav',
                 'sounds/purr_04_whiskers_purr.wav'];

  const score = await (await fetch('/public/song/notes.json')).json();
  // The same family and casting pass song.js does, so the bank half is the bank
  // as it actually plays and not a fairer or unfairer version of it.
  const FAMILIES = ['low', 'mid', 'high'];
  const median = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1];
  const byVoice = new Map();
  for (const n of score.notes) byVoice.set(n.voice, [...(byVoice.get(n.voice) ?? []), n.degree]);
  const ranked = [...byVoice.entries()].map(([v, ds]) => [v, median(ds)]).sort((a, b) => a[1] - b[1]);
  const family = new Map(ranked.map(([v], i) => [v, FAMILIES[Math.floor((i / ranked.length) * 3)]]));
  for (const n of score.notes) n.family = family.get(n.voice);

  // --scale replaces the score with one note per 17-EDO degree, alone, up the
  // range. Nowhere in the actual score does a single note in the meow register
  // ever sound by itself, so this is the only place either instrument's tuning
  // can be heard rather than inferred — and it is where the bank is worst, since
  // a lone retuned cry has nothing to hide the shift behind.
  const scale = q.get('scale') === '1';
  // Declared up here because the scale block below needs to know whether the
  // lower voices are the ones on trial.
  const modes = (q.get('modes') || '').split(',').filter(Boolean);
  const step = 0.75;
  let window;
  if (scale) {
    // The range is the score's own, not a round number: the point is to hear
    // the instrument where the piece actually asks it to play, including the
    // top line, where the bank stretches hardest and the built meow runs out of
    // formants to shape. The last note is long, to exercise the other thing the
    // bank cannot do — hold on past the end of the recording.
    // Which register the scale walks follows what is being compared: a scale
    // of meows says nothing about a growl and vice versa. ?modes= means the
    // lower voices are on trial, so the scale stays under the crossover.
    const edge = Number(q.get('low') || 200);
    const sung = score.notes.filter((n) => (modes.length ? n.hz < edge : n.hz >= edge)).map((n) => n.hz);
    const lo = Math.min(...sung), hi = Math.max(...sung);
    const steps = Math.round(17 * Math.log2(hi / lo));
    window = Array.from({ length: steps + 1 }, (_, i) => ({
      t: i * step, d: step * 0.8, hz: lo * 2 ** (i / 17),
      vel: 100, voice: 0, degree: i, family: 'mid',
    }));
    // One long note to end on, kept inside the register on trial — at lo × 4 a
    // low scale would hand its last note to the upper voice and audition the
    // wrong instrument.
    const held = Math.min(lo * 4, hi * 0.95);
    window.push({ t: (steps + 1) * step, d: 6, hz: held, vel: 100, voice: 0, degree: 0, family: 'mid' });
    from = 0;
    to = (steps + 1) * step + 6;
  } else {
    window = score.notes.filter((n) => n.t >= from && n.t < to);
    // Solo. Eleven parts playing over a change to one of them is not a way to
    // hear that change; --voices=10,11 leaves the parts that live in the
    // register being judged and drops the rest. Panning is untouched, so a
    // soloed part still sits where it sits in the full mix.
    const only = (q.get('voices') || '').split(',').filter(Boolean).map(Number);
    if (only.length) window = window.filter((n) => only.includes(n.voice));
  }
  const tail = 3;

  async function render(settings) {
    const ctx = new OfflineAudioContext(2, Math.ceil((to - from + tail) * SR), SR);
    const synth = createSynth(ctx, await loadVoices(ctx, { purrs: PURRS }), { gain: 0.5 });
    planCats(synth.samples, score.notes);
    Object.assign(MIX, settings);
    if (q.get('low')) MIX.lowHz = Number(q.get('low'));
    for (let i = 0; i < window.length; i++) {
      synth.play(window[i], window[i].t - from, ranked.length, score.notes.indexOf(window[i]));
    }
    const buf = await ctx.startRendering();
    return [buf.getChannelData(0), buf.getChannelData(1)];
  }

  // Either half is a source, or — with ?modes= — one pass per lower-register
  // voice with the upper one held still, so the only thing moving is the thing
  // being judged. Rendered in series, not in parallel: MIX is module state and
  // two contexts building notes off it at once would read each other's settings.
  const plan = modes.length
    ? modes.map((low) => ({ source: q.get('source') || 'bank', low }))
    : [{ source: 'bank' }, { source: 'synth' }];
  const passes = [];
  for (const s of plan) passes.push(await render(s));
  const hush = Math.round(gap * SR);
  const n = passes.reduce((a, p) => a + p[0].length, 0) + hush * (passes.length - 1);
  const mix = [new Float32Array(n), new Float32Array(n)];
  let at = 0;
  for (const p of passes) {
    mix[0].set(p[0], at); mix[1].set(p[1], at);
    at += p[0].length + hush;
  }

  // 16-bit interleaved PCM with a 44-byte header. wav.mjs would do this, but it
  // is node-only and this is the wrong side of the wire.
  const bytes = new ArrayBuffer(44 + n * 4);
  const view = new DataView(bytes);
  const ascii = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, 36 + n * 4, true); ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, SR, true); view.setUint32(28, SR * 4, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 2; c++) {
      const v = Math.max(-1, Math.min(1, mix[c][i]));
      view.setInt16(44 + i * 4 + c * 2, v * 32767, true);
    }
  }
  await fetch('/wav', { method: 'POST', body: bytes });
} catch (e) { say('/err', 'threw: ' + (e?.stack ?? e)); }
</script>`;

// ------------------------------------------------------------------- render --

await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  `http://127.0.0.1:${port}/__ab.html?from=${FROM}&to=${TO}&gap=${GAP}&scale=${SCALE ? 1 : 0}&low=${LOW}&modes=${MODES}&source=${SOURCE}&voices=${arg('voices', '')}`,
]);
let stderr = '';
chrome.stderr.on('data', (d) => (stderr += d));

const timer = setTimeout(() => land({ kind: '/timeout', body: Buffer.alloc(0) }), TIMEOUT);
const got = await done;
clearTimeout(timer);
chrome.kill();
server.close();

if (got.kind !== '/wav') {
  const why = got.kind === '/timeout' ? `nothing came back in ${TIMEOUT / 1000}s` : got.body.toString();
  console.error(`ab.mjs: ${why}`);
  if (stderr.trim()) console.error(stderr.trim().split('\n').slice(-6).join('\n'));
  process.exit(1);
}

mkdirSync('out', { recursive: true });
writeFileSync(OUT, got.body);
const seconds = (got.body.length - 44) / 4 / 48000;
const what = SCALE ? "17-EDO up the score's own range, then one long note" : `the score, ${FROM}-${TO}s`;
const order = MODES ? `${SOURCE} up top; below: ${MODES.split(',').join(', then ')}` : 'bank, then the same on synth';
console.log(`${OUT}  ${seconds.toFixed(1)}s  ${what} — ${order}`);
