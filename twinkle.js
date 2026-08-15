/**
 * twinkle.js — the stars: the last cats on screen, and much the smallest.
 *
 * Eight seconds, and the only burst anchored to the end of the score rather
 * than to a moment in it. A star lands on every beat the closing bars have,
 * flares, settles, and then flickers on its own clock until the piece stops.
 *
 * They are cats, because everything here is cats. A cat two hundredths of the
 * frame high does not read as a cat and was never going to — what does the
 * work is the behaviour: the flare on the attack, the slow flicker after it,
 * and the fact that they arrive on the beat. Three things make a small bright
 * thing read as a star, and none of them is its outline.
 *
 * The one trick is compositing. These are drawn with `lighter`, so a star adds
 * its light to the black behind it instead of covering it, and two overlapping
 * stars are brighter than one. That is what turns a small photograph of a cat
 * into a point of light. It is also the one line to delete if it ever looks
 * like a mistake.
 *
 * Like the rest of them this is a pure function of time — no counters, no
 * rand(), nothing carried between frames. Keep it that way.
 */

export const BURST_LENGTH = 8.0; // seconds, and the last eight of the piece

const PER_BEAT = 3; // stars per beat; one is a sparse sky, five is a snowstorm
// A star lasts the whole window. The closing bars only have beats up to about
// six seconds in, so anything shorter empties the frame before the music
// stops — they accumulate into a sky and the sky goes out all at once.
const LIFE = BURST_LENGTH;
const ATTACK = 0.09; // seconds to arrive, in seconds and not in lifetimes
const FLARE = 0.5; // how much bigger a star is at the instant it lands …
const FLARE_FOR = 0.3; // … and how long it takes to fall back
const FLOOR = 0.42; // how far down the flicker takes a star, never to nothing
const TAU = Math.PI * 2;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ramp = (x, a, b) => smooth((x - a) / (b - a));

/** Deterministic hash → [0,1). The sky has to survive a reload. */
function rand(seed) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** How present the sky is, 0…1 — its own fade, in and then out with the song. */
function sky(since) {
  if (since < 0 || since > BURST_LENGTH) return 0;
  return ramp(since, 0, 1.2) * (1 - ramp(since, BURST_LENGTH - 1.0, BURST_LENGTH));
}

/**
 * Draw the stars. `since` is seconds since the window opened; `beats` is the
 * beat times inside it, in seconds from that point, ascending. Returns whether
 * anything was drawn.
 *
 *   twinkleBurst(ctx, W, H, t - twinkle.at, twinkle.beats, cats)
 */
export function twinkleBurst(ctx, W, H, since, beats, cats) {
  if (!beats.length || !cats.length) return false;
  const layer = sky(since);
  if (layer <= 0.004) return false;

  ctx.save();
  // Additive: a star lightens the black rather than sitting on top of it.
  ctx.globalCompositeOperation = 'lighter';

  for (let i = 0; i < beats.length; i++) {
    const s = since - beats[i]; // seconds this star has been up
    if (s < 0 || s >= LIFE) continue;

    for (let j = 0; j < PER_BEAT; j++) {
      const k = i * PER_BEAT + j;
      // Its own flicker, and its own place in the frame. Both from the index,
      // so a star is in the same spot at the same brightness every play.
      const flicker = 0.5 + 0.5 * Math.sin(TAU * (1.4 + 2.4 * rand(k + 5407)) * since + rand(k + 91) * TAU);
      const hold = 1 - ramp(s, LIFE * 0.85, LIFE);
      const alpha = layer * ramp(s, 0, ATTACK) * hold * (FLOOR + (1 - FLOOR) * flicker);
      if (alpha <= 0.004) continue;

      const img = cats[Math.floor(rand(k + 617) * cats.length)];
      // A hard flare on the attack that falls away over the next third of a
      // second — the pop is most of what makes a star read as arriving.
      const h = (0.018 + 0.03 * rand(k + 1279)) * H * (1 + FLARE * (1 - smooth(clamp01(s / FLARE_FOR))));
      const w = h * (img.width / img.height);

      ctx.globalAlpha = clamp01(alpha);
      ctx.drawImage(img, rand(k) * W - w / 2, rand(k + 3313) * H - h / 2, w, h);
    }
  }

  ctx.restore();
  return true;
}
