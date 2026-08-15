/**
 * song.js — the transport. Plays public/song/notes.json through synth.js.
 *
 *   node tools/midi.mjs && python -m http.server 8000   # then /song.html
 *
 * No recording, no onsets. The score is the MIDI and the clock is the
 * AudioContext, so `now()` here is the only time anything on this page knows.
 *
 * Notes are scheduled a fraction of a second ahead rather than all 1912 at
 * once: a run of setTimeout is allowed to be late, but a note handed to Web
 * Audio with a timestamp is not, so the lookahead is what keeps the timing off
 * the main thread. Anything drawing against this should ask now(), never count
 * frames.
 */
import { loadVoices, createSynth, planCats, MIX } from './synth.js';
import { mountControls } from './controls.js';
import { createStage } from './cats.js';

const LOOKAHEAD = 0.15; // seconds of notes handed to Web Audio in advance
const TICK = 25; // ms between scheduler wakeups

// The purrs live in sounds/ with their credits. Three of the five is enough
// texture; all five is 2 MB for a difference nobody can hear.
const PURRS = [
  'sounds/purr_01_purring_cat.wav',
  'sounds/purr_02_schnurren_einer_hauskatze_schnell.wav',
  'sounds/purr_04_whiskers_purr.wav',
];

const hud = document.getElementById('hud');

const score = await (await fetch('public/song/notes.json')).json();

const ctx = new AudioContext();
const GAIN = 0.5;
const synth = createSynth(ctx, await loadVoices(ctx, { purrs: PURRS }), { gain: GAIN });

const panel = document.getElementById('panel');
mountControls(document.getElementById('knobs'), {
  gain: GAIN,
  onGain: (v) => synth.master.gain.setTargetAtTime(v, ctx.currentTime, 0.02),
});

// Each MIDI part keeps one family of meows for the whole piece, picked by where
// the part sits. The families used to be how the meows were recorded — brushed,
// waiting for food, alone in a strange room — which the CC0 pool cannot know, so
// they are now the register the cat actually cried in. Low parts get low cats.
// That a part does not change halfway through is still the bit that matters.
const FAMILIES = ['low', 'mid', 'high'];
const median = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1];
const byVoice = new Map();
for (const n of score.notes) byVoice.set(n.voice, [...(byVoice.get(n.voice) ?? []), n.degree]);
const ranked = [...byVoice.entries()].map(([v, ds]) => [v, median(ds)]).sort((a, b) => a[1] - b[1]);
const family = new Map(ranked.map(([v], i) => [v, FAMILIES[Math.floor((i / ranked.length) * 3)]]));
for (const n of score.notes) n.family = family.get(n.voice);

// Casting for 'cat-per-voice-fit'. Done once, here, because it needs the whole
// score at once — which cat suits a part is a question about that part's range,
// not about any one note.
planCats(synth.samples, score.notes);

// The cats. Same animation viz.js draws, placed off these notes rather than
// off a detector's guess at them — see cats.js. now() is its only clock, so it
// scrubs and pauses with the audio and never accumulates between frames.
const stage = await createStage(document.getElementById('c'), score.notes);

// -------------------------------------------------------------------- clock --

let origin = 0; // ctx.currentTime that song time 0 sits on
let offset = 0; // song time to resume from
let cursor = 0; // next note to schedule
let playing = false;

export const now = () => (playing ? ctx.currentTime - origin : offset);

function seek(t) {
  offset = Math.max(0, Math.min(t, score.seconds));
  origin = ctx.currentTime - offset;
  cursor = score.notes.findIndex((n) => n.t >= offset);
  if (cursor < 0) cursor = score.notes.length;
}

function schedule() {
  if (!playing) return;
  const until = now() + LOOKAHEAD;
  while (cursor < score.notes.length && score.notes[cursor].t < until) {
    const note = score.notes[cursor];
    // A note whose time has already passed — the first tick after a seek —
    // would be scheduled in the past and play instantly. Start it now instead.
    synth.play(note, Math.max(ctx.currentTime, origin + note.t), ranked.length, cursor);
    cursor++;
  }
}
setInterval(schedule, TICK);

async function play() {
  await ctx.resume();
  origin = ctx.currentTime - offset;
  playing = true;
  schedule();
}

function pause() {
  offset = now();
  playing = false;
}

// --------------------------------------------------------------------- hud --

function frame() {
  const t = now();
  if (playing && t >= score.seconds) pause();
  const shown = stage.draw(t);
  const sounding = score.notes[Math.max(0, cursor - 1)];
  hud.innerHTML =
    `<b>${t.toFixed(2)}s</b> / ${score.seconds}s · ${cursor}/${score.count} notes · ` +
    `${shown} cats · ${stage.cast} in the cast · ` +
    `spiral @${stage.spiral.at.toFixed(1)}s · ` +
    `${sounding ? `${sounding.hz.toFixed(0)}Hz deg ${sounding.degree}` : '—'} · ` +
    `${MIX.mapping} · ` +
    (playing ? 'playing' : 'click to play');
  requestAnimationFrame(frame);
}
frame();

// A click on a slider is a click on the page, and without this the panel
// pauses the music every time you touch it — which makes the one thing the
// panel exists for, hearing a knob move, impossible.
addEventListener('click', (e) => {
  if (panel.contains(e.target)) return;
  playing ? pause() : play();
});

addEventListener('keydown', (e) => {
  // Arrow keys belong to whichever slider has focus, and space would toggle a
  // focused button rather than the transport.
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.code === 'Space') {
    e.preventDefault();
    playing ? pause() : play();
  }
  if (e.code === 'ArrowLeft') seek(now() - 5);
  if (e.code === 'ArrowRight') seek(now() + 5);
  if (e.code === 'KeyH') panel.classList.toggle('hidden');
});
