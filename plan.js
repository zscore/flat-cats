/**
 * plan.js — when each burst fires, and the beats that populate it.
 *
 * Split out of cats.js, which had reached the point where the code that draws a
 * frame and the code that decides what is in it were the same four hundred
 * lines. The seam is a clean one: nothing in here draws anything, and nothing
 * in here knows how big the window is. Every function takes the score and
 * returns times in song seconds.
 *
 * The one thing they all share is `beatOnsets` — the score's own beat rather
 * than tempo.py's grid, and one time per chord rather than one per note. Every
 * burst that populates itself off the music counts beats that way, and a burst
 * that counted notes instead would put twenty cats on one spiral slot every
 * time the piece played a chord.
 *
 * The exception to "read off the score" is the three hand-placed moments below,
 * which are the one thing on screen no note asked for and say so out loud.
 */
import { BURST_LENGTH as TAIL_LENGTH } from './tail.js';
import { BURST_LENGTH as FACE_LENGTH } from './face.js';
import { BURST_LENGTH as SPIRAL_LENGTH } from './spiral.js';
import { BURST_LENGTH as RIVER_LENGTH } from './river.js';
import { BURST_LENGTH as CHECKER_LENGTH, FADE_FOR as CHECKER_FADE } from './checkers.js';
import { BURST_LENGTH as MOON_LENGTH } from './moon.js';
import { createWalk } from './walk.js';

// Where the hand-placed bursts go, in seconds. Same convention as viz.js: they
// are the one thing on screen no note asked for, so they say so out loud. The
// tail burst runs 30s from 20s and the face burst 14.6s from 50s, so the river
// starts as soon as both are clear and runs 66s from 65s — it does not choose
// that length, it is however long the course takes to pan at a gentle rate —
// which leaves the back of the piece for the spiral. The spiral is the
// exception: it picks its own moment off the score, below, and is told about
// the other three so it lands somewhere none of them are.
export const BURSTS = [20];
export const FACE_BURSTS = [50];
export const RIVER_BURSTS = [65];
// The moon is not a burst of its own. It runs off the tail burst's clock,
// starting halfway through it, so the two are one gesture and not two that
// happen to overlap — the same arrangement checkers.js has with the spiral.
export const MOON_AT = BURSTS[0] + TAIL_LENGTH / 2;

// The stretch the per-note cats own: the intro, and the first half of the tail
// burst, which they spend keeping out of the fan's way. They stop when the moon
// comes up, because from there the beats go into the moon's rings instead — a
// note that both scatters a cat and swells one is the same note played twice.
export const VOICES_UNTIL = MOON_AT;
export const HANDOVER = 0.8; // seconds they take to fade out at the end of that

// Four measures in, the scatter becomes a walk: until the tail burst the cats
// are placed along a roaming path rather than about the middle (walk.js). It
// stops where the fan starts, because from there placement is clear.js's, and a
// trail with a burst-shaped hole in it is neither a trail nor a clearance.
const WALK_AFTER = 8; // seconds, snapped forward to the score's next beat
export const WALK_UNTIL = BURSTS[0];

// The moments the check tools need to caption their pictures. Not used in here
// or in cats.js — both read the constants directly.
export const WHEN = { tail: BURSTS[0], moon: MOON_AT, until: VOICES_UNTIL, handover: HANDOVER };

/**
 * One time per distinct score beat. A chord is one beat, not twenty — without
 * this a twenty-note chord would be twenty cats stacked on one spiral slot, or
 * twenty stars in the same corner of the sky.
 */
export function beatOnsets(notes) {
  const first = new Map();
  for (const n of notes) {
    const beat = Math.round(n.tScore * 1000);
    if (!(first.get(beat) <= n.t)) first.set(beat, n.t);
  }
  return [...first.values()].sort((a, b) => a - b);
}

/** When the last note stops sounding — the end of the piece, not of the file. */
export function scoreEnd(notes) {
  return notes.reduce((m, n) => Math.max(m, n.t + n.d), 0);
}

/**
 * When the spiral fires, and the beats that populate it — both read off the
 * MIDI rather than picked by hand like the other two.
 *
 * The beat is the score's own, `tScore`, and not tempo.py's grid: the grid is
 * a guess at a track that has no stable tempo (README, "Beat tracking"), and
 * this one is what was written. A chord counts once — twenty notes sharing an
 * onset is one beat, and would otherwise be twenty cats stacked on one slot.
 *
 * The moment is the window with the most beats in it that the tail and face
 * bursts leave alone. A wheel that populates one cat per beat wants the busiest
 * passage in the piece; anywhere sparse and it spends its first ten seconds
 * nearly empty.
 */
export function planSpiral(notes) {
  const onsets = beatOnsets(notes);

  // Everything that hangs off the spiral has to fit inside the piece as well.
  // The ground starts halfway through the spiral and outlives it, so the whole
  // sequence is this long measured from the trigger, and a window that ends
  // after the music does puts the finale on a silent screen. Without this the
  // choice is made on beat count alone, and moving an earlier burst can push
  // the whole ending off the end of the song.
  const span = SPIRAL_LENGTH / 2 + CHECKER_LENGTH;
  const end = scoreEnd(notes);

  const busy = [
    ...BURSTS.map((t) => [t, t + TAIL_LENGTH]),
    ...FACE_BURSTS.map((t) => [t, t + FACE_LENGTH]),
    ...RIVER_BURSTS.map((t) => [t, t + RIVER_LENGTH]),
  ];
  const clear = (a, b) => busy.every(([c, d]) => b <= c || a >= d);

  // Candidate starts are the onsets themselves, in order, so the end of the
  // window only ever moves forward — one pass, not a search per candidate.
  const densest = (mustClear) => {
    let at = -1;
    let best = -1;
    for (let i = 0, edge = 0; i < onsets.length; i++) {
      while (edge < onsets.length && onsets[edge] < onsets[i] + SPIRAL_LENGTH) edge++;
      if (onsets[i] + span > end) break; // and every later candidate too
      if (mustClear && !clear(onsets[i], onsets[i] + SPIRAL_LENGTH)) continue;
      if (edge - i > best) {
        best = edge - i;
        at = onsets[i];
      }
    }
    return at;
  };

  // Fitting inside the piece is the harder requirement: overlapping another
  // burst is a judgement, but finishing after the music has stopped is simply
  // broken. So if the two cannot both be had, the overlap gives way — loudly,
  // because it means the bursts before this one have grown into its room.
  let at = densest(true);
  if (at < 0) {
    at = densest(false);
    console.warn(
      `spiral: no ${SPIRAL_LENGTH}s window leaves the other bursts alone and still ends ` +
        `by ${end.toFixed(1)}s with its ${span.toFixed(1)}s of ground; overlapping instead, at ${at.toFixed(1)}s`,
    );
  }
  return { at, beats: onsets.filter((s) => s >= at && s < at + SPIRAL_LENGTH).map((s) => s - at) };
}

/**
 * When the stars run, and the beats that light them.
 *
 * The window's length and its rhythm are still the score's: it is as long as the
 * stretch from the grid's fade to the last note, and the beats inside that
 * stretch are what the stars arrive on. Neither is a number typed here. What is
 * typed here is where the window sits — it is held back TWINKLE_AFTER seconds
 * from the handover it used to open on, so the stars land as the last note dies
 * and go on flickering into the silence after it. The piece now ends on a screen
 * the music has already left.
 *
 * That hold is why `from` and `at` are two numbers rather than one. The beats
 * are read off `from`, the moment the grid begins to fade, and carried along
 * with the window; reading them off `at` would light nothing, because the
 * score's last beat is at 165.8s and by then there are none left to read. So the
 * stars keep the closing bars' rhythm without arriving on the bars themselves.
 * twinkle.js says the same thing from the drawing side.
 */
const TWINKLE_AFTER = 5; // seconds the sky waits after the grid starts to go

export function planTwinkle(notes, spiralAt) {
  const from = spiralAt + SPIRAL_LENGTH / 2 + CHECKER_LENGTH - CHECKER_FADE;
  const span = scoreEnd(notes) - from;
  return {
    at: from + TWINKLE_AFTER,
    span,
    beats: beatOnsets(notes).filter((s) => s >= from).map((s) => s - from),
  };
}

/**
 * The beats the river swells a cat on, relative to its trigger. One per beat
 * rather than one per note, or a twenty-note chord would swell twenty cats at
 * once — pulse.js picks one cat per hit and twenty hits is twenty cats.
 */
/**
 * The beats the moon's rings answer to, relative to the moon's own start. These
 * are the same beats that were scattering per-note cats until VOICES_UNTIL —
 * the scatter stops and the rings take the notes over, which is why the two
 * windows meet at MOON_AT rather than overlapping.
 */
export function planMoon(notes) {
  return beatOnsets(notes)
    .filter((s) => s >= MOON_AT && s < MOON_AT + MOON_LENGTH)
    .map((s) => s - MOON_AT);
}

export function planRiver(notes) {
  return beatOnsets(notes)
    .filter((s) => s >= RIVER_BURSTS[0] && s < RIVER_BURSTS[0] + RIVER_LENGTH)
    .map((s) => s - RIVER_BURSTS[0]);
}

/**
 * When the walk starts: the first beat at or after WALK_AFTER, because it is
 * the first thing in the piece the notes are asked to follow and starting it
 * between two of them reads as a glitch rather than as a decision.
 *
 * Its own function because two callers want the moment without wanting the
 * path: clear.js has to be told which stretch of the timeline the walk owns so
 * it can keep its hands off it, and building a whole path to read one number
 * off it would be silly.
 */
export function walkFrom(notes) {
  return beatOnsets(notes).find((s) => s >= WALK_AFTER) ?? WALK_AFTER;
}

/**
 * When the walk starts, and the path it follows.
 *
 * `box` is the room the path may roam in, and comes from the caller rather than
 * from here: how much of the frame the walk can have depends on how far the
 * pitch fans either side of it, and that is a placement question cats.js owns.
 */
export function planWalk(notes, box) {
  const from = walkFrom(notes);
  // Of the first rolls, the one that gets round the frame — 0.15 to 0.87 across
  // and the full band down — not one that settles into half of it.
  return { from, walk: createWalk({ span: WALK_UNTIL - from, box, seed: 4 }) };
}
