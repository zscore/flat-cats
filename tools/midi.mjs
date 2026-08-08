/**
 * midi.mjs — read a Standard MIDI File into notes. Nothing else.
 *
 *   node tools/midi.mjs                       # -> public/song/notes.json
 *   node tools/midi.mjs --ref=431.509
 *
 * Node has no MIDI anything, so the format is here in full, the same way
 * wav.mjs carries the WAV format: chunks, variable-length delta times, running
 * status, and a tempo map to turn ticks into seconds.
 *
 * The one thing this file knows that a general parser would not: in
 * Blackwood17notes.mid a note number *is* a 17-EDO degree, not a semitone.
 * The first chord is notes 84/74/63/53, and against a grid whose degree 0 sits
 * at 431.5 Hz those are 704/468/299/199 Hz — which is, to the Hz, the first
 * chord the recording was measured to contain. Read as semitones the same
 * chord is a four-note cluster, which it audibly is not. So degree = note - 72,
 * and ORIGIN and REF below are the whole of the tuning.
 *
 * Nothing here reads the recording or the onset analysis. The MIDI is the
 * score and the clock both.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

// Degree 0 of the grid, in Hz. Fitted from the recording's own pitches by
// tools/onsets.mjs (17-EDO, 9 cents RMS) rather than assumed: a plain A=440
// leaves four fifths of the notes 30-odd cents off a degree, and a 17-EDO step
// is only 71 cents, so "30-odd" is halfway between two notes and means the grid
// is in the wrong place. Copied as a number on purpose — out/ is derived, and
// nothing is allowed to read from it as if it were input.
const REF = 431.509;

// The MIDI note number that lands on degree 0. See the header.
const ORIGIN = 72;

const EDO = 17;

// ------------------------------------------------------------------- parse --

/** Variable-length quantity: 7 bits a byte, high bit means "another follows". */
function readVarInt(buf, p) {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    const byte = buf[p++];
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) return [value, p];
  }
  throw new Error('variable-length quantity longer than 4 bytes');
}

/**
 * One MTrk chunk into events stamped with absolute ticks. Only the three kinds
 * anything downstream cares about survive: note starts, note ends, and tempo.
 */
function parseTrack(buf, start, end) {
  const events = [];
  let p = start;
  let tick = 0;
  let status = 0;
  while (p < end) {
    let delta;
    [delta, p] = readVarInt(buf, p);
    tick += delta;

    // Running status: a byte under 0x80 where a status byte belongs means the
    // event reuses the previous one's. Common enough that dropping it loses
    // most of a DAW's output.
    if (buf[p] & 0x80) status = buf[p++];
    const kind = status & 0xf0;
    const channel = status & 0x0f;

    if (status === 0xff) {
      const type = buf[p++];
      let len;
      [len, p] = readVarInt(buf, p);
      // 0x51 set_tempo: three bytes of microseconds per quarter note.
      if (type === 0x51) events.push({ tick, kind: 'tempo', usPerBeat: buf.readUIntBE(p, 3) });
      p += len;
      status = 0; // meta events do not arm running status
    } else if (status === 0xf0 || status === 0xf7) {
      let len;
      [len, p] = readVarInt(buf, p);
      p += len;
      status = 0;
    } else if (kind === 0x90 || kind === 0x80) {
      const note = buf[p++];
      const velocity = buf[p++];
      // note_on at velocity 0 is the usual way to write note_off.
      const on = kind === 0x90 && velocity > 0;
      events.push({ tick, kind: on ? 'on' : 'off', channel, note, velocity });
    } else if (kind === 0xc0 || kind === 0xd0) {
      p += 1; // program change, channel pressure
    } else {
      p += 2; // everything else with a channel is two data bytes
    }
  }
  return events;
}

/**
 * Ticks to seconds, against however many tempo changes the file carries.
 * Blackwood17notes.mid has exactly one — a flat 90 BPM — but a map that only
 * works for one tempo is a trap for the next file through.
 */
function clock(tempos, ticksPerBeat) {
  const map = [{ tick: 0, seconds: 0, usPerBeat: 500000 }];
  for (const { tick, usPerBeat } of tempos.sort((a, b) => a.tick - b.tick)) {
    const last = map[map.length - 1];
    if (tick === last.tick) {
      last.usPerBeat = usPerBeat;
      continue;
    }
    const seconds = last.seconds + ((tick - last.tick) * last.usPerBeat) / ticksPerBeat / 1e6;
    map.push({ tick, seconds, usPerBeat });
  }
  return (tick) => {
    let seg = map[0];
    for (const m of map) if (m.tick <= tick) seg = m;
    return seg.seconds + ((tick - seg.tick) * seg.usPerBeat) / ticksPerBeat / 1e6;
  };
}

/** Read an SMF into { ticksPerBeat, seconds, notes }, notes sorted by start. */
export function readMidi(path) {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'MThd') throw new Error(`not a MIDI file: ${path}`);
  const format = buf.readUInt16BE(8);
  const ticksPerBeat = buf.readUInt16BE(12);
  // The high bit means SMPTE frames per second rather than ticks per beat, and
  // the tempo map below would be meaningless. Nothing here has ever seen one.
  if (ticksPerBeat & 0x8000) throw new Error(`${path}: SMPTE time division is not supported`);

  const events = [];
  for (let p = 8 + buf.readUInt32BE(4); p + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(p + 4);
    if (buf.toString('ascii', p, p + 4) === 'MTrk') events.push(...parseTrack(buf, p + 8, p + 8 + len));
    p += 8 + len;
  }
  events.sort((a, b) => a.tick - b.tick);

  const toSeconds = clock(
    events.filter((e) => e.kind === 'tempo'),
    ticksPerBeat,
  );

  // Pair each start with the next end on the same channel and note. A queue
  // rather than a single slot, because the same note can be struck again
  // before the first one is released and the pairing has to stay first-in.
  const open = new Map();
  const notes = [];
  for (const e of events) {
    if (e.kind === 'tempo') continue;
    const key = `${e.channel}:${e.note}`;
    if (e.kind === 'on') {
      if (!open.has(key)) open.set(key, []);
      open.get(key).push(e);
    } else {
      const start = open.get(key)?.shift();
      if (start) notes.push({ ...start, endTick: e.tick });
    }
  }
  // A note left hanging at the end of the file is a real thing DAWs export.
  // Give it the last tick anything happened on rather than dropping it.
  const lastTick = events.length ? events[events.length - 1].tick : 0;
  for (const queue of open.values()) for (const start of queue) notes.push({ ...start, endTick: lastTick });

  notes.sort((a, b) => a.tick - b.tick || a.channel - b.channel || a.note - b.note);
  const out = notes.map((n) => ({
    t: +toSeconds(n.tick).toFixed(4),
    d: +(toSeconds(n.endTick) - toSeconds(n.tick)).toFixed(4),
    voice: n.channel,
    note: n.note,
    vel: n.velocity,
  }));
  return {
    format,
    ticksPerBeat,
    seconds: +Math.max(0, ...out.map((n) => n.t + n.d)).toFixed(3),
    notes: out,
  };
}

// -------------------------------------------------------------------- stage --

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};

const SRC = resolve(arg('midi', 'Blackwood17notes.mid'));
const OUT = resolve(arg('out', 'public/song'));
const ref = Number(arg('ref', REF));

const song = readMidi(SRC);
const notes = song.notes.map((n) => {
  const degree = n.note - ORIGIN;
  return { ...n, note: undefined, degree, hz: +(ref * 2 ** (degree / EDO)).toFixed(2) };
});

const voices = [...new Set(notes.map((n) => n.voice))].sort((a, b) => a - b);

// Most polyphony the page will ever have to hold at once. The synth needs to
// know it can be asked for this many voices; better measured than guessed.
const edges = notes.flatMap((n) => [[n.t, 1], [n.t + n.d, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
let held = 0;
let polyphony = 0;
for (const [, step] of edges) polyphony = Math.max(polyphony, (held += step));

mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, 'notes.json'),
  JSON.stringify({
    file: basename(SRC),
    seconds: song.seconds,
    count: notes.length,
    tuning: { ref, edo: EDO, origin: ORIGIN },
    voices,
    polyphony,
    notes,
  }),
);

// ------------------------------------------------------------------ report --

const degrees = notes.map((n) => n.degree);
const lo = Math.min(...degrees);
const hi = Math.max(...degrees);
const durations = [...notes.map((n) => n.d)].sort((a, b) => a - b);
console.log(
  `${basename(SRC)}: format ${song.format}, ${song.ticksPerBeat} ticks/beat, ${song.seconds}s\n` +
    `${notes.length} notes over ${voices.length} voices, up to ${polyphony} at once\n` +
    `degrees ${lo}..${hi} = ${(ref * 2 ** (lo / EDO)).toFixed(1)}..${(ref * 2 ** (hi / EDO)).toFixed(1)} Hz ` +
    `on a ${EDO}-EDO grid with degree 0 at ${ref} Hz\n` +
    `note length ${durations[0]}s shortest, ${durations[durations.length >> 1]}s median, ` +
    `${durations[durations.length - 1]}s longest\n` +
    `-> ${join(OUT, 'notes.json')}`,
);
