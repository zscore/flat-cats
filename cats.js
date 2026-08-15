/**
 * cats.js — viz.js's animation, driven by the score instead of the recording.
 *
 * Same picture, different source. viz.js places a cat per note per *onset*,
 * which means a pitch detector's guess at what the recording contained; this
 * places a cat per note in the MIDI, which is what was actually played. Three
 * things get better for free:
 *
 *   - the degree is exact, not fitted, so nothing lands between two heights;
 *   - a note nobody detected still gets its cat;
 *   - a cat can stay for the length of its own note, because the score knows
 *     how long that is and an onset does not.
 *
 * That last one is the visible difference. viz.js gives every cat the same
 * 1.25s because it has nothing better; here a held note holds its cat.
 *
 * The two bursts are imported from tail.js and face.js unchanged — they are the
 * existing animation, and this module has no opinions about them beyond when
 * they fire.
 */
import { tailBurst } from './tail.js';
import { faceBurst } from './face.js';

const MARGIN = 0.1; // fraction of height kept clear at top and bottom
const EDGE = 0.08; // keeps a cat's centre off the left and right edges
const ATTACK = 0.06; // seconds to fade in
const FADE = 0.45; // seconds a cat lingers past the end of its note
const MAX_LIFE = 2.5; // the longest note here is 10.7s; nobody wants that on screen

// Where the two bursts go, in seconds. Same convention as viz.js: they are the
// one thing on screen no note asked for, so they say so out loud. The tail
// burst runs 26s from 20s, so the face burst waits until it is clear.
const BURSTS = [20];
const FACE_BURSTS = [50];

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Deterministic hash → [0,1). The scatter has to survive a reload. */
function rand(seed) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const load = (base, files) =>
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

/**
 * Build the cast and the placements. `notes` is score.notes from
 * public/song/notes.json; the manifest is the one stage-viz.mjs writes, read
 * for its images only — its onsets and its song are not touched.
 */
export async function createStage(canvas, notes, base = 'public/viz/') {
  const manifest = await (await fetch(base + 'manifest.json')).json();
  const cats = await load(base, manifest.cats.map((c) => c.file));
  const tails = await load(base, manifest.tails.map((t) => t.file));

  const faces = manifest.faces ?? [];
  const faceFiles = faces.flatMap((f) => [f.head.file, ...f.eyes.map((p) => p.file), ...f.ears.map((p) => p.file)]);
  const faceImages = Object.fromEntries((await load(base, faceFiles)).map((img, i) => [faceFiles[i], img]));

  // The burst cat has to be one tails.py got a tail out of — the fan hangs off
  // that cat's own root and heading — and of those, the best matted. Same
  // choice viz.js makes, for the same reason.
  const byId = new Map(manifest.cats.map((c) => [c.id, c]));
  const burstTail = manifest.tails
    .filter((t) => byId.has(t.id))
    .reduce((a, b) => (byId.get(b.id).coverage > byId.get(a.id).coverage ? b : a));
  // Its body, not its cutout: tails.py cut the tail off this one, so the fan is
  // the only tail it has. Same canvas as the cutout, so root still points at
  // the place the tail used to leave from.
  const [burstBody] = await load(base, [burstTail.body]);
  const burstCat = { img: burstBody, root: burstTail.root, heading: burstTail.heading };

  const sprites = arrange(notes, cats);
  const ctx = canvas.getContext('2d');

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
  }
  addEventListener('resize', resize);
  resize();

  return { draw: (t) => draw(ctx, canvas, sprites, t, { burstCat, tails, faces, faceImages }), cast: cats.length };
}

/** One placement per note, computed once — nothing is random at draw time. */
function arrange(notes, cats) {
  const degrees = notes.map((n) => n.degree);
  const loDeg = Math.min(...degrees);
  const hiDeg = Math.max(...degrees);
  const vels = notes.map((n) => n.vel);
  const loVel = Math.min(...vels);
  const hiVel = Math.max(...vels);

  return notes
    .map((note, i) => {
      // Velocity does the job db and strength do in viz.js: how big, how long,
      // and how near the middle. A chord's loud note sits centre and its quiet
      // ones drift out, so the chord still reads as one event.
      const loud = clamp01((note.vel - loVel) / (hiVel - loVel || 1));
      const spread = 0.13 + 0.37 * (1 - loud);
      return {
        t: note.t,
        life: Math.min(note.d + FADE, MAX_LIFE),
        x: EDGE + (1 - 2 * EDGE) * clamp01(0.5 + (rand(i) - 0.5) * 2 * spread),
        y: 1 - MARGIN - ((note.degree - loDeg) / (hiDeg - loDeg || 1)) * (1 - 2 * MARGIN),
        size: 0.09 + 0.13 * loud + 0.05 * rand(i + 1013),
        flip: rand(i + 7717) < 0.5,
        img: cats[Math.floor(rand(i + 331) * cats.length)],
      };
    })
    .sort((a, b) => a.t - b.t);
}

/** First sprite starting at or after t. Walk a cursor, not all 1912 sprites. */
function firstAfter(sprites, t) {
  let lo = 0;
  let hi = sprites.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sprites[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Pure in (sprites, t): scrub back an hour later and the frame is identical. */
function draw(ctx, canvas, sprites, t, { burstCat, tails, faces, faceImages }) {
  const { width: W, height: H } = canvas;
  ctx.clearRect(0, 0, W, H);

  let shown = 0;
  // Oldest first, so the newest cat lands on top of the ones it is replacing.
  for (let k = firstAfter(sprites, t - MAX_LIFE); k < sprites.length; k++) {
    const s = sprites[k];
    if (s.t > t) break;
    const age = (t - s.t) / s.life;
    if (age >= 1) continue;

    const fade = age < ATTACK / s.life ? age / (ATTACK / s.life) : (1 - age) ** 1.6;
    const h = s.size * H * (0.92 + 0.08 * (1 - age));
    const w = h * (s.img.width / s.img.height);

    ctx.save();
    ctx.globalAlpha = clamp01(fade);
    ctx.translate(s.x * W, s.y * H);
    if (s.flip) ctx.scale(-1, 1);
    ctx.drawImage(s.img, -w / 2, -h / 2, w, h);
    ctx.restore();
    shown++;
  }

  for (const at of BURSTS) tailBurst(ctx, W, H, t - at, burstCat, tails);
  for (const at of FACE_BURSTS) faceBurst(ctx, W, H, t - at, faces, faceImages);
  return shown;
}
