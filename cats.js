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
 * The per-note cats run for the intro and the tail burst, and stop there. Under
 * the bursts after it they read as noise rather than as the score — each of
 * those is a made thing with a shape, and a scatter behind it is just texture.
 * Under the fan they survive because they get out of its way: see clear.js.
 *
 * The bursts themselves are imported unchanged — they are the existing
 * animation, and this module has no opinions about them beyond when they fire
 * and, for the two the cats have to share the frame with, where they land.
 */
import { tailBurst, keepClear as tailClear } from './tail.js';
import { faceBurst } from './face.js';
import { spiralBurst, BURST_LENGTH as SPIRAL_LENGTH } from './spiral.js';
import { riverBurst } from './river.js';
import { checkerBurst } from './checkers.js';
import { twinkleBurst } from './twinkle.js';
import { moonBurst, keepClear as moonClear } from './moon.js';
import { reflow, settle, blocker } from './clear.js';
import {
  BURSTS,
  FACE_BURSTS,
  RIVER_BURSTS,
  MOON_AT,
  VOICES_UNTIL,
  HANDOVER,
  WALK_UNTIL,
  planSpiral,
  planTwinkle,
  planRiver,
  planMoon,
  planWalk,
  // aliased: arrange() has a local `walkFrom` of its own from planWalk(), and a
  // module import quietly shadowed by a local is a bad five minutes later on.
  walkFrom as walkStart,
} from './plan.js';

const MARGIN = 0.1; // fraction of height kept clear at top and bottom
export const EDGE = 0.08; // keeps a cat's centre off the left and right edges
const ATTACK = 0.06; // seconds to fade in
const FADE = 0.45; // seconds a cat lingers past the end of its note
const MAX_LIFE = 2.5; // the longest note here is 10.7s; nobody wants that on screen
const WALK_SPREAD = 0.34; // frame heights the whole pitch range fans over the path
const WALK_DRIFT = 0.09; // how far off the path a quiet note may land
const HUDDLE = 0.08; // how far a chord's own notes spread around its centre

// The room the walk's path may roam in: the frame less the pitch it fans either
// side of itself, so a chord at the top of the range lands inside the margins
// rather than clamped flat to them. plan.js decides when the walk starts; how
// much of the frame it gets is a placement question and stays here.
const WALK_BOX = { x0: EDGE, x1: 1 - EDGE, y0: MARGIN + WALK_SPREAD / 2, y1: 1 - MARGIN - WALK_SPREAD / 2 };

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

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
  const spiral = planSpiral(notes);
  const riverBeats = planRiver(notes);
  const moonBeats = planMoon(notes);
  const twinkle = planTwinkle(notes, spiral.at);
  const ctx = canvas.getContext('2d');

  // Where everything ends up depends on the shape of the frame, so it is worked
  // out here and again whenever that changes — not per frame, and not once at
  // load.
  let flow = { moved: 0, dropped: 0 };
  let crowd = { nudged: 0, crowded: 0 };
  const hold = [walkStart(notes), WALK_UNTIL];
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    ({ flow, crowd } = place(sprites, canvas.width, canvas.height, burstCat, hold));
  }
  addEventListener('resize', resize);
  resize();

  return {
    draw: (t) => draw(ctx, canvas, sprites, t, { burstCat, tails, faces, faceImages, cats, spiral, twinkle, riverBeats, moonBeats }),
    cast: cats.length,
    spiral,
    twinkle,
    flow: () => flow,
    crowd: () => crowd,
  };
}

/**
 * Settle every cat into a place at this frame size: clear of the burst, and
 * then clear of the other cats.
 *
 * The order is the burst first and the cats second, because the two are not the
 * same kind of constraint. The fan is a place a cat may not be; another cat is
 * only a place it would rather not be. settle() is handed the burst's shapes as
 * a veto so it cannot undo what reflow() just did.
 *
 * The walk is held out of the second pass. Over that stretch the cats are
 * placed along a path on purpose and being close together is the whole picture
 * — turned loose on it, settle() moved 135 of 143 cats an average of a quarter
 * of the frame width, and emptied the trail to empty the overlap count.
 */
function place(sprites, W, H, burstCat, hold) {
  const plan = {
    fan: tailClear(W, H, burstCat),
    moon: moonClear(W, H),
    moonAt: MOON_AT,
    from: BURSTS[0],
    until: VOICES_UNTIL + HANDOVER,
    edge: EDGE,
  };
  const flow = reflow(sprites, W, H, plan);
  const crowd = settle(sprites, W, H, { edge: EDGE, until: plan.until, blocked: blocker(W, H, plan), hold });
  return { flow, crowd };
}

/**
 * Where each onset sits, before its own notes spread out around it.
 *
 * Its own pass, deliberately, and not part of the scatter below: the scatter
 * answers "where in the frame does this note go", and it cannot answer "where
 * does this chord go" because it has never seen the chord. Every note used to
 * be scattered about the middle independently, so a four-note chord arrived as
 * four cats fanned across the width rather than as one thing happening.
 *
 * The rule the scatter applies per note is applied per event instead: a loud
 * event sits near the middle, a quiet one drifts out. Each of its notes then
 * huddles about *that* centre, so a chord is a cluster and a single note — one
 * member, no huddle — comes out where the scatter would have put it anyway.
 *
 * The walk needs none of this. It already places a chord around wherever the
 * walker has got to, which is the same idea arrived at from the other end.
 */
function chordCentres(notes, loVel, hiVel) {
  const chords = new Map(); // score beat → the notes struck on it
  for (const n of notes) {
    const beat = Math.round(n.tScore * 1000);
    chords.set(beat, [...(chords.get(beat) ?? []), n]);
  }

  const centres = new Map();
  let k = 0;
  for (const [beat, group] of chords) {
    // The event's velocity is its loudest note's: a chord is as present as the
    // loudest thing in it, and averaging would push every big chord to the
    // middle regardless of how it was played.
    const vel = Math.max(...group.map((n) => n.vel));
    const loud = clamp01((vel - loVel) / (hiVel - loVel || 1));
    const spread = 0.13 + 0.37 * (1 - loud);
    centres.set(beat, clamp01(0.5 + (rand(k++ + 5501) - 0.5) * 2 * spread));
  }
  return centres;
}

/** One placement per note, computed once — nothing is random at draw time. */
export function arrange(notes, cats) {
  const degrees = notes.map((n) => n.degree);
  const loDeg = Math.min(...degrees);
  const hiDeg = Math.max(...degrees);
  const vels = notes.map((n) => n.vel);
  const loVel = Math.min(...vels);
  const hiVel = Math.max(...vels);

  const { from: walkFrom, walk } = planWalk(notes, WALK_BOX);
  const centres = chordCentres(notes, loVel, hiVel);

  return notes
    .map((note, i) => {
      // Velocity does the job db and strength do in viz.js: how big, how long,
      // and how near its chord's centre. The loud note of a chord lands on that
      // centre and the quiet ones ring it, so the chord reads as one event with
      // a shape rather than as a row of unrelated cats.
      const loud = clamp01((note.vel - loVel) / (hiVel - loVel || 1));
      const pitch = clamp01((note.degree - loDeg) / (hiDeg - loDeg || 1));
      const centre = centres.get(Math.round(note.tScore * 1000));
      let x = EDGE + (1 - 2 * EDGE) * clamp01(centre + (rand(i) - 0.5) * 2 * HUDDLE * (1 - loud));
      let y = 1 - MARGIN - pitch * (1 - 2 * MARGIN);

      // Inside the walk the path says where the cat is and the note says how
      // far off it sits: pitch stops being a height in the frame and becomes a
      // height relative to the walker, so a chord still fans out high to low,
      // around wherever the cat has got to. Sideways keeps the scatter's rule in
      // miniature — the chord's loud note on the path, its quiet ones off it.
      if (note.t >= walkFrom && note.t < WALK_UNTIL) {
        const p = walk.at(note.t - walkFrom);
        x = clamp(p.x + (rand(i + 491) - 0.5) * WALK_DRIFT * (1 - loud), EDGE, 1 - EDGE);
        y = clamp(p.y + (pitch - 0.5) * WALK_SPREAD, MARGIN, 1 - MARGIN);
      }

      return {
        t: note.t,
        life: Math.min(note.d + FADE, MAX_LIFE),
        // `home` is where velocity put it and never changes; `x` is where it
        // ends up once the burst has had its say, and is the only one drawn
        // from. Keeping both means a reflow starts from the note again rather
        // than from wherever the last reflow left it.
        home: x,
        x,
        y,
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
function draw(ctx, canvas, sprites, t, { burstCat, tails, faces, faceImages, cats, spiral, twinkle, riverBeats, moonBeats }) {
  const { width: W, height: H } = canvas;
  ctx.clearRect(0, 0, W, H);

  // The moon goes down before anything else, so the fan it is drawn around
  // lands in front of it rather than behind.
  moonBurst(ctx, W, H, t - MOON_AT, cats, moonBeats);

  // The ground goes down next. It runs off the spiral's clock,
  // starting halfway through it, so the two are one gesture and not two that
  // happen to overlap.
  const groundAt = t - spiral.at - SPIRAL_LENGTH / 2;
  checkerBurst(ctx, W, H, groundAt, cats);

  // The scattered per-note cats get the intro and the fan's first half, and no
  // more than that. They stop where the moon comes up, and the beats they were
  // spending go into its rings instead — one note, one thing on screen. They
  // fade rather than cut, so the handover is not a switch.
  // Below the threshold they are not drawn at all, which keeps `shown` honest.
  const over = t - VOICES_UNTIL;
  const voices = over < 0 ? 1 : 1 - clamp01(over / HANDOVER);

  let shown = 0;
  // Oldest first, so the newest cat lands on top of the ones it is replacing.
  for (let k = firstAfter(sprites, t - MAX_LIFE); voices > 0.004 && k < sprites.length; k++) {
    const s = sprites[k];
    if (s.t > t) break;
    const age = (t - s.t) / s.life;
    if (age >= 1) continue;
    if (s.hidden) continue; // its row had no room beside the burst

    const fade = age < ATTACK / s.life ? age / (ATTACK / s.life) : (1 - age) ** 1.6;
    const h = s.size * H * (0.92 + 0.08 * (1 - age));
    const w = h * (s.img.width / s.img.height);

    ctx.save();
    ctx.globalAlpha = clamp01(fade) * voices;
    ctx.translate(s.x * W, s.y * H);
    if (s.flip) ctx.scale(-1, 1);
    ctx.drawImage(s.img, -w / 2, -h / 2, w, h);
    ctx.restore();
    shown++;
  }

  for (const at of BURSTS) tailBurst(ctx, W, H, t - at, burstCat, tails);
  for (const at of FACE_BURSTS) faceBurst(ctx, W, H, t - at, faces, faceImages, cats);
  for (const at of RIVER_BURSTS) riverBurst(ctx, W, H, t - at, cats, riverBeats);
  spiralBurst(ctx, W, H, t - spiral.at, spiral.beats, cats);
  // Last, and over everything: the stars are the top of the picture.
  twinkleBurst(ctx, W, H, t - twinkle.at, twinkle.span, twinkle.beats, cats);
  return shown;
}
