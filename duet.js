/**
 * duet.js — the meows and the piano at once, over the same cats.
 *
 *   node tools/midi.mjs
 *   node tools/align.mjs --wav=blackwood_17_notes_trimmed.wav --beats=out/tempo_beats.txt
 *   node tools/stage-viz.mjs && python -m http.server 8000   # then /duet.html
 *
 * song.js plays the score alone and viz.html plays the recording alone. This
 * plays both, which is the only way to hear whether align.mjs actually landed:
 * a meow that flams against the piano note it claims to be is obvious in one
 * pass and invisible in a table of timestamps.
 *
 * ONE CLOCK, NOT TWO. The recording is decoded into an AudioBuffer and started
 * on the same AudioContext the notes are scheduled against, so both sides read
 * ctx.currentTime and there is nothing to keep in sync. An <audio> element
 * would have been a tenth of the memory and its own clock, which drifts from
 * the AudioContext's by tens of milliseconds — the same order as the thing this
 * page exists to measure. That is why 49 MB gets decoded up front.
 *
 * NO OFFSET KNOB, ON PURPOSE. align.mjs writes note times in the recording's
 * own seconds, so song time *is* recording time and the two start together at
 * zero. If they need nudging apart to line up, the map is wrong and the fix
 * belongs in align.mjs, not in a slider here.
 *
 * HOW MANY MEOWS. The score is 1912 notes and all of them singing at once is a
 * wall against the piano, so the panel can drop a fraction of them. Which ones
 * go is a hash of the note's index — uniformly across the piece, no preference
 * for loud or quiet, and identical every time you scrub back over the same bar.
 * The cats are untouched by it: every note still gets its cat, so a thinned
 * page shows you the notes the meows are no longer covering.
 *
 * The transport below is song.js's, duplicated rather than shared. Lifting it
 * into a transport.js is a fair change but it is a different one.
 */
import { loadVoices, createSynth, planCats, MIX } from './synth.js';
import { mountControls, slider } from './controls.js';
import { createStage } from './cats.js';

const LOOKAHEAD = 0.15; // seconds of notes handed to Web Audio in advance
const TICK = 25; // ms between scheduler wakeups

const PURRS = [
  'sounds/purr_01_purring_cat.wav',
  'sounds/purr_02_schnurren_einer_hauskatze_schnell.wav',
  'sounds/purr_04_whiskers_purr.wav',
];

const RECORDING = 0.75; // the piano's level to start at, against the meows' 0.5

/**
 * Deterministic hash → [0,1), the same one cats.js scatters with. Which meows
 * get dropped has to survive a scrub: rolling a real die per note would mean
 * the same bar thins differently every time you played it, and then you would
 * be judging the dice rather than the setting.
 */
function rand(seed) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const hud = document.getElementById('hud');
const panel = document.getElementById('panel');

const score = await (await fetch('public/song/notes.json')).json();
if (!score.align) {
  hud.innerHTML =
    'public/song/notes.json has not been aligned — the meows would run up to six ' +
    'seconds off the recording. Run tools/align.mjs first.';
  throw new Error('notes.json is not aligned; run tools/align.mjs');
}

const ctx = new AudioContext();
const GAIN = 0.5;
const synth = createSynth(ctx, await loadVoices(ctx, { purrs: PURRS }), { gain: GAIN });

// The recording gets its own path to the speakers. Sending it through the
// synth's limiter instead would make every meow duck the piano underneath it,
// which is a compressor artefact that looks exactly like bad alignment.
const recGain = ctx.createGain();
recGain.gain.value = RECORDING;
recGain.connect(ctx.destination);

// Same file align.mjs measured against — stage-viz.mjs copies it verbatim, so
// the seconds in notes.json and the seconds in this buffer are the same
// seconds. Swapping this for a different cut of the track silently invalidates
// every note time on the page.
const manifest = await (await fetch('public/viz/manifest.json')).json();
hud.innerHTML = `decoding ${manifest.song}…`;
const recording = await ctx.decodeAudioData(await (await fetch('public/viz/' + manifest.song)).arrayBuffer());
if (manifest.source !== score.align.wav) {
  console.warn(
    `the score is aligned to ${score.align.wav} but public/viz/ holds ${manifest.source} — ` +
    'the meows will not sit on the piano',
  );
}

// What fraction of the score gets a meow. Read by the scheduler, so moving it
// takes effect on the next note handed to Web Audio — about LOOKAHEAD ahead of
// what you are hearing, same as every knob in the panel.
let density = 1;

// The tone knobs, without their master row — this page has three levels to set
// and they belong together at the top, not one here and two elsewhere.
mountControls(document.getElementById('knobs'), { master: false });
mountLevels(document.getElementById('rec'));

// Families and casting, exactly as song.js does them — the meows have to be the
// same meows, or this page compares two things at once.
const FAMILIES = ['low', 'mid', 'high'];
const median = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1];
const byVoice = new Map();
for (const n of score.notes) byVoice.set(n.voice, [...(byVoice.get(n.voice) ?? []), n.degree]);
const ranked = [...byVoice.entries()].map(([v, ds]) => [v, median(ds)]).sort((a, b) => a[1] - b[1]);
const family = new Map(ranked.map(([v], i) => [v, FAMILIES[Math.floor((i / ranked.length) * 3)]]));
for (const n of score.notes) n.family = family.get(n.voice);

planCats(synth.samples, score.notes);

const stage = await createStage(document.getElementById('c'), score.notes);

// The recording outlasts the last note by a couple of seconds, and the stars
// outlast the recording (plan.js, TWINKLE_AFTER). Stopping at the score's end
// would cut the performance's own ending off; stopping at the recording's would
// cut the sky off mid-flicker. So the page runs to whichever of the three is
// last, and the final seconds of it are silent on purpose.
const END = Math.max(score.seconds, recording.duration, stage.twinkle.at + stage.twinkle.span);

// -------------------------------------------------------------------- clock --

let origin = 0; // ctx.currentTime that song time 0 sits on
let offset = 0; // song time to resume from
let cursor = 0; // next note to schedule
let playing = false;
let source = null; // the recording, while it is running

export const now = () => (playing ? ctx.currentTime - origin : offset);

/**
 * Start the recording at song time `from`. A buffer source is single-use, so
 * every play and every scrub builds a new one; `start(when, offset)` is what
 * puts it on the shared clock rather than at wherever it happens to be.
 */
function startRecording(from) {
  stopRecording();
  if (from >= recording.duration) return;
  source = ctx.createBufferSource();
  source.buffer = recording;
  source.connect(recGain);
  source.start(ctx.currentTime, Math.max(0, from));
}

function stopRecording() {
  if (!source) return;
  source.stop();
  source.disconnect();
  source = null;
}

function seek(t) {
  offset = Math.max(0, Math.min(t, END));
  origin = ctx.currentTime - offset;
  cursor = score.notes.findIndex((n) => n.t >= offset);
  if (cursor < 0) cursor = score.notes.length;
  if (playing) startRecording(offset);
}

function schedule() {
  if (!playing) return;
  const until = now() + LOOKAHEAD;
  while (cursor < score.notes.length && score.notes[cursor].t < until) {
    const note = score.notes[cursor];
    // Dropped notes are stepped over, not skipped ahead of: the cursor is the
    // page's position in the score and the cats still draw every one of them.
    if (rand(cursor) < density) {
      synth.play(note, Math.max(ctx.currentTime, origin + note.t), ranked.length, cursor);
    }
    cursor++;
  }
}
setInterval(schedule, TICK);

async function play() {
  await ctx.resume();
  origin = ctx.currentTime - offset;
  playing = true;
  startRecording(offset);
  schedule();
}

function pause() {
  offset = now();
  playing = false;
  stopRecording();
  // The meows already handed to Web Audio still sound — up to LOOKAHEAD of them
  // trailing after the piano has cut. Cancelling them means tracking every node
  // this page has scheduled, and a fifth of a second of tail on pause is not
  // worth that.
}

// --------------------------------------------------------------------- ui --

/**
 * The three rows this page adds: how loud the piano is, how loud the meows are,
 * and how many of them there are. The last is the only one that is not a level
 * — turning the meows down leaves 1912 of them quietly there, and what thins
 * the texture is dropping notes, not attenuating them.
 */
function mountLevels(el) {
  const pct = (v) => `${(v * 100).toFixed(0)}%`;
  const level = { min: 0, max: 1, step: 0.01, fmt: pct };
  const set = (param) => (v) => param.setTargetAtTime(v, ctx.currentTime, 0.02);

  slider(el, 'recording', RECORDING, level, set(recGain.gain));
  slider(el, 'amount of meow', GAIN, level, set(synth.master.gain));

  // The readout counts the survivors rather than showing a bare percentage:
  // the useful question at 55% is how many cats are still singing, and the
  // count is exact because which notes drop is decided by the hash, not a die.
  const kept = (v) => score.notes.reduce((n, _, i) => n + (rand(i) < v ? 1 : 0), 0);
  slider(el, 'how many meows', 1, {
    min: 0, max: 1, step: 0.01,
    fmt: (v) => `${pct(v)} · ${kept(v)}`,
  }, (v) => (density = v));
}

function frame() {
  const t = now();
  if (playing && t >= END) pause();
  const shown = stage.draw(t);
  const sounding = score.notes[Math.max(0, cursor - 1)];
  hud.innerHTML =
    `<b>${t.toFixed(2)}s</b> / ${END.toFixed(2)}s · ${cursor}/${score.count} notes · ` +
    `${shown} cats · piano + meows on one clock · ` +
    `${sounding ? `${sounding.hz.toFixed(0)}Hz deg ${sounding.degree}` : '—'} · ` +
    `align '${score.align.map}', ${score.align.anchors} anchors · ` +
    `${MIX.mapping} · ` +
    (playing ? 'playing' : 'click to play');
  requestAnimationFrame(frame);
}
frame();

addEventListener('click', (e) => {
  if (panel.contains(e.target)) return;
  playing ? pause() : play();
});

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.code === 'Space') {
    e.preventDefault();
    playing ? pause() : play();
  }
  if (e.code === 'ArrowLeft') seek(now() - 5);
  if (e.code === 'ArrowRight') seek(now() + 5);
  if (e.code === 'KeyH') panel.classList.toggle('hidden');
});
