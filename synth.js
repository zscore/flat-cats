/**
 * synth.js — play a 17-EDO score on cats.
 *
 * Two instruments, split by register, because the material forces it.
 *
 * ABOVE ~200 Hz: a sampler. The 24 meows in public/meows/ each carry a measured
 * fundamental, so a note picks the meow whose own pitch is nearest and plays it
 * at targetHz / sampleHz. Nearest, not fixed, keeps every shift inside ±0.6 of
 * an octave — far enough from chipmunk that a meow still sounds like a cat.
 *
 * BELOW ~200 Hz: the purr, as timbre only. A purr has no note in it — it is a
 * pulse train around 25 Hz with a broadband rasp on top — so shifting one onto
 * a pitch would be inventing a pitch it does not have. Instead the pitch comes
 * from an oscillator tuned exactly, and the purr's amplitude envelope rides on
 * it as an audio-rate gain. What survives is the purr's grain and rhythm; what
 * is dropped is its spectrum. Say that out loud rather than claim the low notes
 * "are" purrs: they are a tone wearing a purr's texture.
 *
 * MELODY. A meow is a glide with a noise wash around it, which in a chord of
 * twenty reads as mush. Three filters per voice fix that: a highpass under the
 * fundamental, a peak ON the fundamental to make the pitch the loudest thing in
 * the sample, and a lowpass to take off the hiss. That peak is the single knob
 * that decides how melodic this sounds — see TONE.
 *
 * Nothing here reads a recording, an onset, or a wav of the song. The score is
 * public/song/notes.json and the clock is the AudioContext.
 */

/**
 * TONE — the melodic knob.
 *
 * `peak` dB at the fundamental with `peakQ` either side of it. At 0 dB you get
 * raw meows and the piece reads as noise with a shape; at +18 dB you get a
 * pitched instrument that has stopped sounding like a cat. Move `peak` first.
 *
 * Exported and mutable, and read at the moment a note is built rather than
 * captured at startup — that is what lets the panel in controls.js move any of
 * this mid-piece. Nothing already scheduled changes; the lookahead is 0.15s,
 * so a slider takes effect about that far ahead of what you are hearing.
 */
export const TONE = {
  peak: 11, // dB lifted at the fundamental
  peakQ: 5.5, // how narrow that lift is
  hpBelow: 0.7, // highpass at this × the fundamental
  lpAbove: 7, // lowpass at this × the fundamental, capped below
  // Hz. Was 5200 when every meow was an 8 kHz source and nothing could live
  // above 4 kHz anyway — against the 44.1/48 kHz bank that cap is no longer
  // inert, it actively throws away the top end the new samples were chosen for.
  // 8000 is where controls.js's slider already tops out. This is the first knob
  // to move by ear if the bank now sounds bright rather than clean.
  lpCap: 8000,
};

export const ENV = { attack: 0.006, release: 0.11, low: { attack: 0.035, release: 0.18 } };

export const MIX = {
  // Where the sampler hands over to the purr. Below this the nearest meow would
  // have to shift down more than an octave, which turns a 0.3s meow into a 1s
  // groan. 200 Hz is a little under the lowest meow's own pitch of 247 Hz.
  lowHz: 200,
  // How much of the low voice is the purr riding on the tone, 0..1. All the way
  // at 1 and the tone disappears between pulses; the rest is a floor that keeps
  // the pitch continuous.
  purrDepth: 0.62,
  // Which of MAPPINGS below decides what plays a note. Chosen by ear against
  // the other five: one animal per part holds a line together in a way that
  // per-note nearest-pitch does not, and it is worth the extra retuning.
  mapping: 'cat-per-voice',
};

/**
 * MAPPINGS — which meow plays a note. This is the palette.
 *
 * All six get the same 24 samples and the same note; they disagree only about
 * which one to reach for, and that disagreement is most of what the instrument
 * sounds like. `nearest` retunes least and so sounds most like cats; `scatter`
 * retunes hardest and sounds most like an instrument built out of cats. There
 * is no right answer in here, which is the whole reason it is a menu.
 *
 * `family` on a note is its part's recording context, assigned in song.js.
 * `seed` is the note's index, so every choice below is stable across a reload.
 */
export const MAPPINGS = {
  /** Nearest pitch among the part's own recording context. Least shift. */
  nearest: (s, note) => nearest(s, note.hz, note.family),

  /** Nearest pitch among all 24, ignoring which context it came from. */
  'nearest-any': (s, note) => nearest(s, note.hz, null),

  /** One animal per part, then nearest of that animal's own meows. */
  'cat-per-voice': (s, note, seed) => {
    const cats = [...new Set(s.map((x) => x.cat))].sort();
    const cat = cats[Math.floor(rand(note.voice * 2654435761) * cats.length)];
    return nearest(s.filter((x) => x.cat === cat), note.hz, null);
  },

  /**
   * The same idea, but the animals are cast rather than drawn: each part gets
   * the cat that fits its register, and no cat plays two parts. See planCats.
   * Falls back to the whole bank until planCats has run.
   */
  'cat-per-voice-fit': (s, note) => {
    const cat = CAST.get(note.voice);
    return nearest(cat ? s.filter((x) => x.cat === cat) : s, note.hz, null);
  },

  /** One fixed sample per part — the same cry all piece, only retuned. */
  'one-per-voice': (s, note) => s[Math.floor(rand(note.voice * 40503) * s.length)],

  /** Family by the note's own register rather than by its part. The thresholds
   *  are the same ones pick.mjs banded the samples with, so this asks for a cat
   *  that really was recorded in the register the note wants. */
  register: (s, note) => {
    const family = note.hz < 380 ? 'low' : note.hz < 800 ? 'mid' : 'high';
    return nearest(s, note.hz, family);
  },

  /** A different cat every note. Maximum shift, maximum chaos. */
  scatter: (s, note, seed) => s[Math.floor(rand(seed * 2246822519) * s.length)],
};

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Deterministic hash → [0,1). Same one viz.js uses, for the same reason. */
function rand(seed) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// -------------------------------------------------------------------- load --

async function decode(ctx, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return ctx.decodeAudioData(await res.arrayBuffer());
}

/**
 * The purr's amplitude envelope as a mono buffer in 0..1.
 *
 * Rectify and smooth, rather than feed the purr in raw: connected raw to a gain
 * the signal is bipolar and every zero crossing flips the carrier's phase,
 * which is ring modulation — it would put sum-and-difference tones either side
 * of the note and the tuning would stop being 17-EDO. Rectified, it is only an
 * envelope, and the note stays where it was put.
 */
function purrEnvelope(ctx, buffer, smoothHz = 55) {
  const src = buffer.getChannelData(0);
  const out = ctx.createBuffer(1, src.length, ctx.sampleRate);
  const dst = out.getChannelData(0);
  const a = Math.exp((-2 * Math.PI * smoothHz) / ctx.sampleRate);
  let y = 0;
  let peak = 0;
  for (let i = 0; i < src.length; i++) {
    y = a * y + (1 - a) * Math.abs(src[i]);
    dst[i] = y;
    if (y > peak) peak = y;
  }
  if (peak > 0) for (let i = 0; i < dst.length; i++) dst[i] /= peak;
  return out;
}

/**
 * Load the meow bank and the purrs. `purrs` are paths because they live in
 * sounds/ next to their credits, not in public/ — both are served from the
 * repo root, so the page can reach either.
 */
export async function loadVoices(ctx, { meows = 'public/meows/', purrs = [] } = {}) {
  const manifest = await (await fetch(meows + 'manifest.json')).json();
  const buffers = await Promise.all(manifest.map((m) => decode(ctx, meows + m.name)));
  const samples = manifest.map((m, i) => ({ ...m, buffer: buffers[i] }));
  const raw = await Promise.all(purrs.map((p) => decode(ctx, p)));
  return { samples, purrs: raw.map((b) => purrEnvelope(ctx, b)) };
}

// ------------------------------------------------------------------- synth --

// Which animal plays which part under 'cat-per-voice-fit'. Empty until
// planCats runs, which song.js does once the score is loaded.
const CAST = new Map();

/** Median shift, in octaves, if this one cat had to play this whole part. */
function costOf(samples, cat, hzs) {
  const pool = samples.filter((s) => s.cat === cat);
  const shifts = hzs.map((hz) => Math.abs(Math.log2(hz / nearest(pool, hz, null).f0)));
  return shifts.sort((a, b) => a - b)[shifts.length >> 1];
}

/**
 * Cast the parts: one cat each, none twice, each fitting its part's register.
 *
 * Not greedy-cheapest-first, which starves the parts with the fewest options —
 * the top line here is nine notes between 598 and 1873 Hz and only two cats in
 * the bank reach it, so cheapest-first hands both to some comfortable middle
 * voice and leaves the top stretched an octave and a half. Instead the part
 * with the most to lose picks first: at every step, whichever part has the
 * biggest gap between its best remaining cat and its second-best gets to
 * choose. A part that does not care waits.
 *
 * Depends on MIX.lowHz, since notes under the crossover are purrs and ask
 * nothing of a cat. Move that slider and this wants re-running.
 */
export function planCats(samples, notes) {
  CAST.clear();
  const cats = [...new Set(samples.map((s) => s.cat))].sort();
  const parts = new Map();
  for (const n of notes) {
    if (n.hz < MIX.lowHz) continue;
    parts.set(n.voice, [...(parts.get(n.voice) ?? []), n.hz]);
  }
  const cost = new Map();
  for (const [voice, hzs] of parts) {
    for (const cat of cats) cost.set(`${voice}:${cat}`, costOf(samples, cat, hzs));
  }

  const taken = new Set();
  const waiting = new Set(parts.keys());
  while (waiting.size && taken.size < cats.length) {
    let pick = null;
    for (const voice of waiting) {
      const open = cats.filter((c) => !taken.has(c)).sort((a, b) => cost.get(`${voice}:${a}`) - cost.get(`${voice}:${b}`));
      const regret = open.length > 1 ? cost.get(`${voice}:${open[1]}`) - cost.get(`${voice}:${open[0]}`) : Infinity;
      if (!pick || regret > pick.regret) pick = { voice, cat: open[0], regret };
    }
    CAST.set(pick.voice, pick.cat);
    taken.add(pick.cat);
    waiting.delete(pick.voice);
  }
  return CAST;
}

/** The meow whose own pitch is nearest, in log distance — never by index. */
function nearest(samples, hz, family) {
  const pool = samples.filter((s) => !family || s.voice === family);
  return (pool.length ? pool : samples).reduce((a, b) =>
    Math.abs(Math.log2(b.f0 / hz)) < Math.abs(Math.log2(a.f0 / hz)) ? b : a,
  );
}

/** Highpass → peak on the fundamental → lowpass. The melodic part. */
function shape(ctx, hz) {
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = hz * TONE.hpBelow;
  const peak = ctx.createBiquadFilter();
  peak.type = 'peaking';
  peak.frequency.value = hz;
  peak.Q.value = TONE.peakQ;
  peak.gain.value = TONE.peak;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(hz * TONE.lpAbove, TONE.lpCap);
  hp.connect(peak).connect(lp);
  return { in: hp, out: lp };
}

function envelope(ctx, at, seconds, level, { attack, release }) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + attack);
  g.gain.setValueAtTime(level, at + Math.max(attack, seconds));
  g.gain.linearRampToValueAtTime(0, at + Math.max(attack, seconds) + release);
  return g;
}

/** A note above MIX.lowHz: a real meow, retuned and filtered. */
function meowVoice(ctx, note, at, level, pan, samples, seed) {
  const sample = (MAPPINGS[MIX.mapping] ?? MAPPINGS.nearest)(samples, note, seed);
  const src = ctx.createBufferSource();
  src.buffer = sample.buffer;
  src.playbackRate.value = note.hz / sample.f0;
  // A note can outlast its meow — the longest here is 10.7s and the longest
  // meow 1.4s. Loop the middle, which is the sustained part of a cry; looping
  // the whole file would repeat the attack like a stutter.
  if (note.d * src.playbackRate.value > sample.buffer.duration * 0.9) {
    src.loop = true;
    src.loopStart = sample.buffer.duration * 0.35;
    src.loopEnd = sample.buffer.duration * 0.85;
  }
  const tone = shape(ctx, note.hz);
  const g = envelope(ctx, at, note.d, level, ENV);
  src.connect(tone.in);
  tone.out.connect(g).connect(pan);
  src.start(at);
  src.stop(at + note.d + ENV.release + 0.05);
  return src;
}

/** A note below MIX.lowHz: an exactly-tuned tone wearing a purr's envelope. */
function purrVoice(ctx, note, at, level, pan, seed, beds) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = note.hz;

  // The purr rides here. `depth` is the modulated part and the constant is
  // the floor beneath it, so the note never fully disappears between pulses.
  const ring = ctx.createGain();
  ring.gain.value = 1 - MIX.purrDepth;
  if (beds.length) {
    const depth = ctx.createGain();
    depth.gain.value = MIX.purrDepth;
    beds[Math.floor(rand(seed) * beds.length)].connect(depth).connect(ring.gain);
  }

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = clamp(note.hz * 6, 120, 900);
  lp.Q.value = 1.2;
  const g = envelope(ctx, at, note.d, level, ENV.low);
  osc.connect(ring).connect(lp).connect(g).connect(pan);
  osc.start(at);
  osc.stop(at + note.d + ENV.low.release + 0.05);
  return osc;
}

export function createSynth(ctx, voices, { gain = 0.5 } = {}) {
  const { samples, purrs } = voices;
  if (!samples.length) throw new Error('no meows loaded');

  // Twenty notes can land at once, and twenty un-limited samples clip. The
  // compressor is doing real work here, not polish.
  const master = ctx.createGain();
  master.gain.value = gain;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -14;
  limiter.knee.value = 8;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.004;
  limiter.release.value = 0.12;
  master.connect(limiter).connect(ctx.destination);

  // One purring cat under the whole low register rather than one per note: the
  // bass notes then pulse together, which is what a single animal would do.
  const beds = purrs.map((buffer) => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start();
    return src;
  });

  // One pan position per MIDI voice, fixed for the piece. Eleven parts stacked
  // dead centre is the other half of why a chord reads as mush.
  const pans = new Map();
  function panFor(voice, count) {
    if (!pans.has(voice)) {
      const p = ctx.createStereoPanner();
      p.pan.value = count > 1 ? ((voice % count) / (count - 1) - 0.5) * 1.1 : 0;
      p.connect(master);
      pans.set(voice, p);
    }
    return pans.get(voice);
  }

  return {
    /** Schedule one note at AudioContext time `at`. */
    play(note, at, voiceCount = 11, seed = 0) {
      const level = clamp(0.16 + (note.vel / 127) ** 1.6 * 0.5, 0, 0.8);
      const pan = panFor(note.voice, voiceCount);
      return note.hz < MIX.lowHz
        ? purrVoice(ctx, note, at, level * 1.25, pan, seed, beds)
        : meowVoice(ctx, note, at, level, pan, samples, seed);
    },
    master,
    // The last node before the speakers. `master` is the level knob and sits
    // *before* the limiter, so anything tapping the mix has to tap here instead
    // — a recording taken off master is the one that clips on a dense chord,
    // which is exactly the thing the limiter was added for.
    out: limiter,
    samples,
    stop() {
      for (const b of beds) b.stop();
    },
  };
}
