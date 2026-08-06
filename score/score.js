/**
 * score.js — THE PIECE, AS DATA.  This file is Zane's.
 * =====================================================
 *
 * Everything you can hear or see is downstream of this file. Nothing in here is
 * machinery: no functions, no cleverness, no generated anything. Just numbers
 * and names you can read in one sitting and change with your hands.
 *
 * The rule this repo runs on:
 *
 *     score/  is authored — you own it.        (what happens, and when)
 *     src/    is machinery — Claude owns it.   (how it gets rendered)
 *
 * Claude does not edit this file without asking you first (see CLAUDE.md).
 * If you want a section longer, a voice out of the mix, a different colour of
 * water — this is the file, and you can do it yourself in ten seconds.
 *
 * Because it is data and not code, the studio page can DRAW it. Open
 * `npm run studio` and you are looking at exactly this file: the section blocks,
 * the arrangement grid, the tension and brightness curves. Edit a number here,
 * save, and the drawing changes. That is the whole idea.
 */

// ---------------------------------------------------------------- the clock --
// One cycle in Strudel = one bar of 4/4 here. Everything structural is counted
// in whole bars so that section edges land exactly on the pattern engine's bar
// lines — no "close enough" seams.
export const BPM = 96;
export const BEATS_PER_BAR = 4;

// ----------------------------------------------------------------- the cast --
// Every voice the piece can use, declared once. `color` is not decoration: the
// studio arrangement grid draws each voice in its own colour, so this is how you
// recognise a lane at a glance.
//
// `label` is the name YOU use for it out loud. If you find yourself calling
// `air` "the organ", change the label here rather than remembering a mapping —
// and add the alias to docs/GLOSSARY.md so Claude knows what you mean too.
export const VOICES = {
  surf:  { label: 'surf',  color: '#4d6b78', role: 'the wash underneath everything' },
  pulse: { label: 'pulse', color: '#e0704f', role: 'the kick' },
  tick:  { label: 'tick',  color: '#e8b04b', role: 'the hats — the grid you feel' },
  bass:  { label: 'bass',  color: '#7b5ea7', role: 'low sine + saw, one note per bar or two' },
  air:   { label: 'air',   color: '#5aa9c9', role: 'the held chord — pads' },
  bell:  { label: 'bell',  color: '#e5e0d5', role: 'the melody, sparse, on top' },
};

// -------------------------------------------------------------- the harmony --
// Brightness (0..1) picks a mode off this ladder — dark at the bottom, bright at
// the top. This is the piece's one harmonic axis: raise brightness and the
// music gets glad and the camera rises. One number, two media.
//
// Intervals are semitones from the root. The root never moves — all the harmonic
// story is on this ladder (it is much easier to hear one thing changing).
export const ROOT_MIDI = 50; // D3
export const MODES = [
  { name: 'aeolian',    steps: [0, 2, 3, 5, 7, 8, 10] },
  { name: 'dorian',     steps: [0, 2, 3, 5, 7, 9, 10] },
  { name: 'mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  { name: 'ionian',     steps: [0, 2, 4, 5, 7, 9, 11] },
  { name: 'lydian',     steps: [0, 2, 4, 6, 7, 9, 11] },
];

// ----------------------------------------------------------------- the tune --
// One motif for the whole piece, in scale degrees (0 = root, 7 = the octave).
// `null` is a rest. The bell voice states this, and later sections state it
// slower, higher, or in fragments — but it is always this. Change these seven
// numbers and the piece's tune changes everywhere at once.
export const MOTIF = [0, 2, 4, null, 2, 6, 4, null];

// -------------------------------------------------------------- the sections --
// The whole form, top to bottom. Each entry:
//
//   name        what you call this stretch out loud
//   bars        how long, in whole bars
//   tension     [start, end] — 0..1, linearly walked across the section.
//               Drives: drum density, filter opening, wave height, particle count.
//   brightness  [start, end] — 0..1, linearly walked. Picks the mode (above)
//               AND the camera's height over the water. Dark = low and close.
//   voices      who is playing. Deleting a name here removes it from the mix
//               and from the picture — this is your arrangement.
//   water/sky   the two colours of this stretch.
//
// Nothing is generated: if a section feels long, change `bars`. If the drop
// doesn't land, change `tension`. There is no other layer to go argue with.
export const SECTIONS = [
  {
    name: 'lowtide',
    bars: 8,
    tension:    [0.05, 0.15],
    brightness: [0.10, 0.15],
    voices: ['surf', 'air'],
    water: '#0e2430', sky: '#1b3540',
  },
  {
    name: 'shore',
    bars: 12,
    tension:    [0.15, 0.35],
    brightness: [0.15, 0.30],
    voices: ['surf', 'pulse', 'bass', 'air'],
    water: '#123543', sky: '#28505c',
  },
  {
    name: 'swell',
    bars: 16,
    tension:    [0.35, 0.62],
    brightness: [0.30, 0.55],
    voices: ['surf', 'pulse', 'tick', 'bass', 'air'],
    water: '#174a55', sky: '#3d6f78',
  },
  {
    // The climax. It sits at ~0.55 of the way through, which is roughly where
    // the ear expects one. It is also the only section that uses every voice.
    name: 'hightide',
    bars: 16,
    tension:    [0.75, 1.00],
    brightness: [0.60, 0.95],
    voices: ['surf', 'pulse', 'tick', 'bass', 'air', 'bell'],
    water: '#2a7f8a', sky: '#8fc4c2',
  },
  {
    // The drop out. Tension falls off a cliff on purpose — the drums go and the
    // bell is left holding the tune alone. This is the loudest silence.
    name: 'undertow',
    bars: 12,
    tension:    [0.30, 0.20],
    brightness: [0.70, 0.40],
    voices: ['surf', 'bass', 'air', 'bell'],
    water: '#1c4f5c', sky: '#4a7a80',
  },
  {
    name: 'slack',
    bars: 8,
    tension:    [0.15, 0.02],
    brightness: [0.35, 0.12],
    voices: ['surf', 'air'],
    water: '#0e2430', sky: '#1b3540',
  },
];

// ------------------------------------------------------------------- levels --
// Per-voice output gain. The one place to fix "the bells are hurting my ears"
// without going anywhere near the synthesis code.
export const LEVELS = {
  surf: 0.30,
  pulse: 0.85,
  tick: 0.28,
  bass: 0.60,
  air: 0.34,
  bell: 0.30,
};
