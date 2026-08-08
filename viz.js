/**
 * viz.js — the cats, drawn at the notes the song is already playing.
 *
 *   node tools/stage-viz.mjs && python -m http.server 8000   # then /viz.html
 *
 * Every onset in out/onsets.json carries four notes and a strength, and each
 * note carries a degree of 17-EDO. That is enough to place a cat: degree sets
 * height, strength sets size, loudness sets how long it stays. The song plays
 * underneath and its currentTime is the only clock.
 *
 * draw(t) is a pure function of (onsets, t). Nothing accumulates between
 * frames and nothing is random at draw time — every cat's position and flip is
 * hashed from its onset index once, at load. Scrub back to 41.2s an hour later
 * and you get the identical frame. Keep it that way; a feedback buffer or a
 * per-frame rand() would make the scrubber quietly lie.
 */

import { tailBurst } from './tail.js';

const LIFE = 1.25; // seconds a cat stays on screen
const ATTACK = 0.06; // seconds to fade in
const MARGIN = 0.1; // fraction of height kept clear at top and bottom
const EDGE = 0.08; // keeps a cat's centre off the left and right edges

const clamp01 = (x) => Math.max(0, Math.min(1, x));

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');

/** Deterministic hash → [0,1). The scatter has to survive a reload. */
function rand(seed) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// -------------------------------------------------------------------- load --

const base = 'public/viz/';
const manifest = await (await fetch(base + 'manifest.json')).json();
const analysis = await (await fetch(base + manifest.onsets)).json();

const load = (files) =>
  Promise.all(
    files.map(
      (f) =>
        new Promise((ok, fail) => {
          const img = new Image();
          img.onload = () => ok(img);
          img.onerror = () => fail(new Error(f));
          img.src = base + f;
        }),
    ),
  );

const cats = await load(manifest.cats.map((c) => c.file));
const tails = await load(manifest.tails.map((t) => t.file));

// ----------------------------------------------------------------- arrange --

// One placement per note per onset, computed once. Degrees span about five
// octaves of 17-EDO, so the full range maps to the full height; anything
// narrower and the low notes pile up on the floor.
const degrees = analysis.onsets.flatMap((o) => o.notes.map((n) => n.degree));
const loDeg = Math.min(...degrees);
const hiDeg = Math.max(...degrees);

const strengths = analysis.onsets.map((o) => o.strength);
const loStr = Math.min(...strengths);
const hiStr = Math.max(...strengths);

const sprites = analysis.onsets.flatMap((onset, i) =>
  onset.notes.map((note, j) => {
    const seed = i * 8 + j;
    // Loudest note of the onset sits nearest the middle; the quiet ones drift
    // out. Keeps a chord reading as one event rather than four scattered cats.
    // Clamp both ends: notes run past -12 dB, and an unclamped loudness gives a
    // negative lifetime, which never trips the age cull and fades inside out.
    const loud = clamp01(1 + note.db / 12);
    const spread = 0.13 + 0.37 * clamp01(-note.db / 8);
    const punch = clamp01((onset.strength - loStr) / (hiStr - loStr || 1));
    return {
      t: onset.t,
      life: LIFE * (0.55 + 0.45 * loud),
      x: EDGE + (1 - 2 * EDGE) * clamp01(0.5 + (rand(seed) - 0.5) * 2 * spread),
      y: 1 - MARGIN - ((note.degree - loDeg) / (hiDeg - loDeg || 1)) * (1 - 2 * MARGIN),
      size: 0.1 + 0.14 * punch + 0.05 * rand(seed + 1013),
      flip: rand(seed + 7717) < 0.5,
      img: cats[Math.floor(rand(seed + 331) * cats.length)],
    };
  }),
);
sprites.sort((a, b) => a.t - b.t);

// The tail burst is the one thing on screen that no note asked for, so it says
// where it goes out loud: seconds into the song, and nothing else. Add a time
// here to fire it again. Its tail is made of the seven real tails tails.py cut
// out of the set.
const BURSTS = [20];

// The cat it happens to has to be one we got a tail out of — the fan hangs off
// that cat's own tail, so it needs the root and heading tails.py measured — and
// of those, the best matted. Coverage alone would pick a head-and-shoulders
// portrait, since the highest-coverage cat in the cast fills its frame because
// it is a close-up, and a floating head growing nine tails is not the idea.
const byId = new Map(manifest.cats.map((c) => [c.id, c]));
const burstTail = manifest.tails
  .filter((t) => byId.has(t.id))
  .reduce((a, b) => (byId.get(b.id).coverage > byId.get(a.id).coverage ? b : a));
const burstCat = {
  img: cats[manifest.cats.indexOf(byId.get(burstTail.id))],
  root: burstTail.root,
  heading: burstTail.heading,
};

// A cat can only be on screen for LIFE seconds, so the frame at time t needs
// only the slice starting a little before t. Walk a cursor instead of scanning
// all 1420 sprites every frame.
function firstAfter(t) {
  let lo = 0;
  let hi = sprites.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sprites[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// -------------------------------------------------------------------- draw --

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
}
addEventListener('resize', resize);
resize();

function draw(t) {
  const { width: W, height: H } = canvas;
  ctx.clearRect(0, 0, W, H);

  let shown = 0;
  // Oldest first, so the newest cat lands on top of the ones it is replacing.
  for (let k = firstAfter(t - LIFE); k < sprites.length; k++) {
    const s = sprites[k];
    if (s.t > t) break;
    const age = (t - s.t) / s.life;
    if (age >= 1) continue;

    const fade = age < ATTACK / s.life ? age / (ATTACK / s.life) : (1 - age) ** 1.6;
    const h = s.size * H * (0.92 + 0.08 * (1 - age));
    const w = h * (s.img.width / s.img.height);

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, fade));
    ctx.translate(s.x * W, s.y * H);
    if (s.flip) ctx.scale(-1, 1);
    ctx.drawImage(s.img, -w / 2, -h / 2, w, h);
    ctx.restore();
    shown++;
  }

  for (const at of BURSTS) tailBurst(ctx, W, H, t - at, burstCat, tails);
  return shown;
}

// ------------------------------------------------------------------- clock --

const audio = new Audio(base + manifest.song);
audio.preload = 'auto';

function frame() {
  const t = audio.currentTime;
  const shown = draw(t);
  hud.innerHTML = `<b>${t.toFixed(2)}s</b> / ${analysis.seconds}s · ${shown} cats · ${cats.length} in the cast · ${audio.paused ? 'paused — click to play' : 'space to pause, ←/→ to scrub'}`;
  requestAnimationFrame(frame);
}
frame();

addEventListener('click', () => (audio.paused ? audio.play() : audio.pause()));
addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); audio.paused ? audio.play() : audio.pause(); }
  if (e.code === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 5);
  if (e.code === 'ArrowRight') audio.currentTime += 5;
});
