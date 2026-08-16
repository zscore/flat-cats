/**
 * meow.js — a meow built rather than recorded.
 *
 * The sampler in synth.js reaches a note by dragging the nearest of 24 real
 * cries onto it: up to ±0.6 of an octave of resampling, which hauls the cat's
 * formants along with its pitch, and for any note longer than the cry a loop
 * spliced through the middle of it. Most of what sounds wrong about the bank is
 * one of those two things. This voice has neither, because it has no recording.
 * The note is built at its own pitch, for exactly as long as it is held.
 *
 * It is source-filter synthesis, the standard model of a voice:
 *
 *   the glottis     a pulse train, one pulse per vocal fold cycle. This is the
 *                   only thing here that knows the note. Its spectrum is fixed.
 *   the tract       four parallel bandpasses. Where they sit is which vowel you
 *                   hear — and this is the part that matters: a meow is not a
 *                   vowel, it is a *movement* between three of them. Mouth shut
 *                   on the [m], swinging wide through an open [ɛa], closing
 *                   again to an [ou]. That movement is the whole word. Hold the
 *                   filters still and you get a synthesiser saying "aaah"; move
 *                   them and the same signal turns into a cat.
 *   the lips        radiation, which is a differentiator — folded into the
 *                   source wave below rather than built as its own node.
 *
 * The formant frequencies are a cat's, not a person's. A cat's vocal tract is
 * roughly half the length of ours, so everything sits about an octave above the
 * vowel chart you may half-remember.
 *
 * WHAT THIS CANNOT DO is be a particular animal. The bank's 24 cries are 17
 * individuals with 17 throats and 17 moods, and none of that is in here; what
 * is in here is one idealised cat with a knob on its size. Expect it to sound
 * cleaner than the bank and less alive. Whether that trade is worth taking is
 * exactly what MIX.source exists to let you decide by ear.
 */

/**
 * MEOW — the knobs, read at the moment a note is built, same as TONE in
 * synth.js and for the same reason: controls.js has to be able to move them
 * mid-piece. `openQuotient` is deliberately not among them — the source wave is
 * computed once and cached, so a slider on it would do nothing until reload.
 */
export const MEOW = {
  scoop: 0.87, // f0 at the very start, × the note — the cry rises into pitch
  fall: 0.84, // f0 at the very end, × the note — and drops out of it
  vibrato: 0.011, // depth of the steady wobble
  vibratoHz: 5.4,
  jitter: 1, // how much of the random cycle-to-cycle f0 wander to keep, 0..1
  rasp: 0.13, // a half-pitch subharmonic under the note: creak, not tone
  breath: 0.15, // noise alongside the voice
  size: 1, // × on every formant. Below 1 is a bigger cat, above is a kitten.
  release: 0.16, // seconds of tail past the note's own length
  // Trim, so a synth note arrives at the same loudness as a bank note. Four
  // bandpasses at unity peak gain, summed with alternating signs, come out well
  // under the source that went in; without this the A/B is not one, because the
  // quieter instrument loses on any material. Measured, not guessed: 1.65 is
  // what levelled the two halves of tools/ab.mjs over 24-40s.
  level: 1.65,
};

// One period of glottal flow, as fractions of the cycle: how much of it the
// folds are open for, and how that open time splits into swinging apart and
// slamming shut. Slamming is the faster half, which is where a voice gets its
// brightness — widen the second number and the cat sounds breathier.
const OPEN_QUOTIENT = 0.62;
const SLAM = 0.3;

/**
 * The mouth positions, as [F1, F2, F3, F4] in Hz, with how loud the cat is in
 * each. These four rows are most of the sound; if it comes out reading as a
 * synth rather than an animal, this is the table to move, not the knobs.
 */
const SHUT = { f: [340, 1150, 2450, 3350], amp: 0.3 }; // [m], through the nose
const OPEN = { f: [800, 1950, 3050, 4150], amp: 1 }; // mouth just apart
const WIDE = { f: [1080, 1620, 2900, 4000], amp: 1 }; // widest, the [a] of it
const CLOSE = { f: [560, 1020, 2700, 3850], amp: 0.5 }; // shutting again, [ou]

// Relative level of each formant, and how sharp each one is (Q = centre ÷
// bandwidth). The alternating sign is not decoration: parallel formants overlap
// in frequency, and same-signed neighbours cancel in the overlap and leave a
// notch between every pair. Flipping every other one puts the sum back.
const GAINS = [1, -0.62, 0.34, -0.16];
const QS = [6.5, 8, 9, 8];

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Deterministic hash → [0,1). synth.js has this too; importing it back here
 *  would make the two modules circular over four lines of arithmetic. growl.js
 *  imports it from here rather than keeping a third copy — that way round there
 *  is no cycle, since growl.js is downstream of this file. */
export function rand(seed) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Piecewise-linear read of [[time, value], ...] at `t`. */
function at(points, t) {
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [t0, v0] = points[i - 1];
    const [t1, v1] = points[i];
    if (t <= t1) return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return points[points.length - 1][1];
}

// ------------------------------------------------------------------ source --

const WAVES = new WeakMap();
const NOISE = new WeakMap();

/**
 * The glottal source, as a PeriodicWave: a Rosenberg pulse, differentiated.
 *
 * Not a sawtooth. A saw has every harmonic at 1/n and a corner sharp enough to
 * buzz; a real glottis opens smoothly, shuts fast, and stays shut for a third
 * of the cycle, which gives a spectrum that rolls off in a way the ear reads as
 * a throat rather than an oscillator. Differentiating is the lip radiation term
 * — sound leaving a mouth is the derivative of the flow through it — and doing
 * it here costs one loop instead of a filter node on every note.
 *
 * Built by brute-force DFT because it is 512 × 64 multiply-adds, once per page.
 */
export function glottis(ctx) {
  if (WAVES.has(ctx)) return WAVES.get(ctx);
  const N = 512;
  const H = 64; // harmonics kept — past this it is above hearing for any note here
  const rise = N * OPEN_QUOTIENT * (1 - SLAM);
  const shut = N * OPEN_QUOTIENT * SLAM;
  const flow = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (i < rise) flow[i] = 0.5 * (1 - Math.cos((Math.PI * i) / rise));
    else if (i < rise + shut) flow[i] = Math.cos((Math.PI * (i - rise)) / (2 * shut));
  }
  const re = new Float32Array(H + 1);
  const im = new Float32Array(H + 1);
  for (let k = 1; k <= H; k++) {
    let a = 0;
    let b = 0;
    for (let i = 0; i < N; i++) {
      const d = flow[(i + 1) % N] - flow[i]; // the derivative, taken in place
      const th = (-2 * Math.PI * k * i) / N;
      a += d * Math.cos(th);
      b += d * Math.sin(th);
    }
    re[k] = (2 * a) / N;
    im[k] = (2 * b) / N;
  }
  const wave = ctx.createPeriodicWave(re, im);
  WAVES.set(ctx, wave);
  return wave;
}

/** Two seconds of white noise, looped. One buffer for the whole page. */
function noise(ctx) {
  if (NOISE.has(ctx)) return NOISE.get(ctx);
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  NOISE.set(ctx, buf);
  return buf;
}

// ----------------------------------------------------------------- gesture --

/**
 * When the mouth does what, for a note of length `d`.
 *
 * Every phase is a fixed number of seconds capped by a fraction of the note, so
 * a 0.2s note is a whole meow squeezed small rather than a fragment of one, and
 * a 10s note is a meow with a long open middle rather than the same gesture
 * smeared out over ten seconds. The middle is where the extra time goes, which
 * is the right place: that is what a cat holding a note actually does.
 */
function stages(d) {
  const span = d + MEOW.release;
  const shut = Math.min(0.05, span * 0.14);
  const opening = Math.min(0.07, span * 0.16);
  const widen = Math.min(0.13, span * 0.18);
  const closing = Math.min(0.34, span * 0.3);
  const wide = shut + opening + widen;
  return { span, shut, opening, widen, closing, wide, close: Math.max(wide, span - closing) };
}

/**
 * The pitch line, sampled at control rate.
 *
 * A real meow slides a long way — up into the cry and a third or more out of it
 * — and a long way is not available here, because the note has to land in
 * 17-EDO and be heard as the degree it is. So the slide is kept where it does
 * not cost tuning: a scoop confined to the mouth opening, and a fall confined
 * to the mouth closing, with the whole held middle sitting on the note exactly.
 * `scoop` and `fall` are the two knobs that trade cat against intonation, and
 * they are the first ones to move if this sounds drunk in a chord.
 */
function pitchLine(hz, k, seed, n) {
  const line = new Float32Array(n);
  const shape = [
    [0, MEOW.scoop],
    [k.wide, 1],
    [k.close, 1],
    [k.span, MEOW.fall],
  ];
  let wander = 0;
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * k.span;
    // Cycle-to-cycle wander, smoothed. Perfectly steady pitch is the single
    // loudest tell that a voice is synthetic — cheaper than any other fix here.
    wander = wander * 0.86 + (rand(seed * 9301 + i) - 0.5) * 0.013 * MEOW.jitter;
    const vib = 1 + MEOW.vibrato * Math.sin(2 * Math.PI * MEOW.vibratoHz * t);
    line[i] = hz * at(shape, t) * vib * (1 + wander);
  }
  return line;
}

/** The loudness line: shut and quiet, open and loud, then let go. */
function levelLine(k, n) {
  const line = new Float32Array(n);
  const shape = [
    [0, 0],
    [Math.min(0.012, k.shut * 0.6), SHUT.amp],
    [k.shut, SHUT.amp],
    [k.shut + k.opening, OPEN.amp],
    [k.wide, WIDE.amp],
    [k.close, WIDE.amp * 0.92],
    [k.span - MEOW.release * 0.5, CLOSE.amp],
    [k.span, 0],
  ];
  for (let i = 0; i < n; i++) line[i] = at(shape, (i / (n - 1)) * k.span);
  return line;
}

// ------------------------------------------------------------------- voice --

/**
 * Four parallel bandpasses, each sweeping through the four mouth positions.
 *
 * `scale` moves the whole set: a smaller cat has a shorter tract and higher
 * formants, and it also cries higher, so tying scale to the note is closer to
 * right than leaving it fixed. The exponent is well under 1 because the two do
 * not track each other one for one — an octave up in pitch is nothing like an
 * octave up in throat.
 */
function tract(ctx, hz, when, k, scale) {
  const sum = ctx.createGain();
  const ins = [];
  for (let i = 0; i < 4; i++) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = QS[i];
    const g = ctx.createGain();
    g.gain.value = GAINS[i];
    const path = [
      [0, SHUT.f[i]],
      [k.shut, SHUT.f[i]],
      [k.shut + k.opening, OPEN.f[i]],
      [k.wide, WIDE.f[i]],
      [k.close, WIDE.f[i]],
      [k.span, CLOSE.f[i]],
    ];
    bp.frequency.setValueAtTime(path[0][1] * scale, when);
    for (const [t, f] of path.slice(1)) bp.frequency.linearRampToValueAtTime(f * scale, when + t);
    bp.connect(g).connect(sum);
    ins.push(bp);
  }
  return { ins, out: sum };
}

/**
 * One synthesised meow, scheduled at `when`. Same signature as the sampler's
 * meowVoice in synth.js minus the sample bank, and returns the same thing: the
 * node that carries the note, already started and stopped.
 */
export function synthMeow(ctx, note, when, level, pan, seed = 0) {
  const hz = note.hz;
  const k = stages(note.d);
  const n = clamp(Math.round(k.span * 240), 2, 6000);
  const scale = clamp((hz / 620) ** 0.45 * MEOW.size, 0.75, 2.4);

  const line = pitchLine(hz, k, seed, n);
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(glottis(ctx));
  osc.frequency.setValueCurveAtTime(line, when, k.span);

  // Subharmonic. Real cats vibrate irregularly and drop into period-doubling
  // constantly — it is most of what separates a cry from a whistle. Half the
  // pitch line rather than a fixed ratio, so it bends with the note.
  const half = ctx.createOscillator();
  half.setPeriodicWave(glottis(ctx));
  half.frequency.setValueCurveAtTime(
    line.map((f) => f * 0.5),
    when,
    k.span,
  );
  const halfGain = ctx.createGain();
  halfGain.gain.value = MEOW.rasp;

  // Breath. Runs through the same tract as the voice, because it is the same
  // mouth — noise filtered separately reads as hiss laid over a cat, not as
  // part of one.
  const air = ctx.createBufferSource();
  air.buffer = noise(ctx);
  air.loop = true;
  const airGain = ctx.createGain();
  airGain.gain.value = MEOW.breath;

  const throat = tract(ctx, hz, when, k, scale);
  for (const bp of throat.ins) {
    osc.connect(bp);
    half.connect(halfGain).connect(bp);
    air.connect(airGain).connect(bp);
  }

  // Above the first formant the tract has nothing left to pass — the harmonics
  // it would shape are not there, and a top note comes out near-silent. Let some
  // of the source past unfiltered as the note climbs. This is also roughly true:
  // a very high cry is closer to a whistle than to a vowel.
  const bare = ctx.createGain();
  bare.gain.value = clamp(hz / (OPEN.f[0] * scale) - 0.55, 0, 1) * 0.75;
  const tame = ctx.createBiquadFilter();
  tame.type = 'lowpass';
  tame.frequency.value = Math.min(hz * 5, 9000);
  osc.connect(tame).connect(bare).connect(throat.out);

  const amp = ctx.createGain();
  amp.gain.setValueCurveAtTime(
    levelLine(k, n).map((v) => v * level * MEOW.level),
    when,
    k.span,
  );
  throat.out.connect(amp).connect(pan);

  for (const src of [osc, half, air]) {
    src.start(when);
    src.stop(when + k.span + 0.02);
  }
  return osc;
}
