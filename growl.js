/**
 * growl.js — the bottom of the range, on something other than a sawtooth.
 *
 * Everything under MIX.lowHz has always been purrVoice in synth.js: an exactly
 * tuned sawtooth with a purr's amplitude envelope riding on it. That is honest
 * about what it is — synth.js calls it "a tone wearing a purr's texture" — but
 * it is a synth bass, and it sounds like one, for 17% of the sounding time.
 *
 * The obvious fix is not available. You cannot put a meow down here: 81 Hz is
 * the score's lowest note and no cat has ever made one. The bank's lowest
 * sample is 247 Hz, and meow.js at 81 Hz has all four of its formants sitting
 * two octaves above the fundamental, so the note comes out as buzz with no
 * weight under it. A cat does not have low notes.
 *
 * What a cat does have down there is a GROWL, which is a different instrument:
 * a short closed mouth, so low and heavily damped formants; a fundamental that
 * barely holds together, so strong subharmonics an octave and a twelfth below
 * it; and a lot of cycle-to-cycle wander. That is what this file is.
 *
 * A MODE IS A SOURCE AND AN ANIMAL, crossed. Everything downstream of the
 * source is shared, so switching within a column changes exactly one thing:
 *
 *                 cat (8 cm throat)   lion (30 cm throat)
 *   glottal       'growl'             'lion'
 *   sawtooth      'purr-growl'        'purr-lion'
 *
 * The glottal source is a pulse train at the note plus its own subharmonics —
 * the animal all the way down, most character, and the least help with bass,
 * since the fundamental of an 81 Hz pulse train is a thin thing to hang a bass
 * line on. The sawtooth source is purrVoice's, unchanged, poured through a
 * throat instead of through a plain lowpass: it keeps the weight a sawtooth is
 * good at and borrows a throat it has never had.
 *
 * THE LION IS THE HONEST ONE DOWN HERE, which was not the plan. The score's low
 * notes run 81 to 200 Hz. A house cat does not growl at 81 Hz — the bank's
 * lowest recorded meow is 247 — but a roaring lion's fundamental sits between
 * 40 and 200 Hz, dead across this range. The cat throat here is a fiction
 * stretched down to reach the notes; the lion throat is an animal that actually
 * lives at them.
 *
 * None of the four is obviously right. That is why they are a menu.
 */
import { glottis, rand } from './meow.js';

/**
 * GROWL — read when a note is built, same as TONE and MEOW, so controls.js can
 * move any of it mid-piece.
 */
export const GROWL = {
  // The chest path: a lowpass near the fundamental, mixed in beside the
  // formants. This is the one knob that decides whether the low end has any
  // weight. Formants alone cannot deliver it — the lowest of them sits around
  // 420 Hz and the note is at 100 — so without this both modes are buzz.
  weight: 0.62,
  chest: 2.6, // that lowpass, at this × the note
  // The subharmonics. `rasp` is an octave down and is most of what makes this
  // read as an animal rather than an oscillator; `grind` is a twelfth down and
  // is not a pitch at all at these frequencies, it is roughness. Turn both to
  // zero and you have a formant-filtered buzz.
  rasp: 0.42,
  grind: 0.16,
  jitter: 1.4, // cycle-to-cycle wander, × meow.js's amount. Growls wander more.
  size: 1, // × on the formants. Down is a bigger cat.
  purrDepth: 0.62, // 'purr-growl' only — how deep the purr rides. Matches MIX.
  attack: 0.035,
  release: 0.2,
  // Trim per mode, so switching is not a volume change and the louder one does
  // not simply win. Measured, not guessed: each is what levelled that mode
  // against purrVoice over the 22-degree low scale that tools/ab.mjs renders,
  // which is a fairer corpus than any passage of the score, since every note in
  // the register gets equal weight. The two sawtooth modes need the biggest
  // push — pouring a saw through a throat costs about 2 dB on the way.
  trim: { growl: 0.89, 'purr-growl': 1.59, lion: 0.67, 'purr-lion': 1.3 },
};

/**
 * The growl throat, as [F1..F4] in Hz, with how sharp each is and how loud.
 *
 * Lower and much wider than meow.js's, because the mouth is nearly shut and a
 * closed short tract is a heavily damped one. F1's Q is deliberately the
 * loosest thing here: a wide skirt on the lowest formant is what lets any of
 * the note's own harmonics through rather than only the region around 420.
 */
const THROATS = {
  cat: { f: [420, 1250, 2400, 3300], q: [2.4, 4, 6, 6], ref: 130, rough: 1 },
  // A lion, from the same quarter-wave model rather than from taste: a roaring
  // Panthera drops its larynx to a tract of about 30 cm against a house cat's
  // 8, and (2n-1)c/4L with L = 0.30 puts the odd resonances near 286, 858,
  // 1430, 2000. Rounded down a little for a throat that is open but not a
  // straight tube. `rough` is up because a lion's folds are flat, loose and
  // fatty — they vibrate chaotically at low tension, which is the actual
  // physiology behind a roar sounding like a roar and not like a big meow.
  lion: { f: [250, 700, 1250, 1800], q: [2, 3.2, 4.5, 5], ref: 90, rough: 1.5 },
};
const GAINS = [1, -0.5, 0.22, -0.1];

/** 'purr-lion' → { src: 'purr', throat: THROATS.lion }, and so on. */
function readMode(mode) {
  const purr = mode.startsWith('purr-');
  const animal = mode.endsWith('lion') ? 'lion' : 'cat';
  return { purr, animal, throat: THROATS[animal] };
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * Four parallel bandpasses and a chest lowpass, summed.
 *
 * The formants drift a little across the note — a growl is not a held vowel, it
 * swells and opens — but nothing like meow.js's sweep, which is a word being
 * said. Here it is only enough that the note is not a static filter.
 */
function throat(ctx, hz, when, span, scale, table) {
  const into = ctx.createGain();
  const out = ctx.createGain();

  const chest = ctx.createBiquadFilter();
  chest.type = 'lowpass';
  chest.frequency.value = clamp(hz * GROWL.chest, 90, 700);
  chest.Q.value = 0.9;
  const weight = ctx.createGain();
  weight.gain.value = GROWL.weight;
  into.connect(chest).connect(weight).connect(out);

  for (let i = 0; i < 4; i++) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = table.q[i];
    bp.frequency.setValueAtTime(table.f[i] * scale * 0.92, when);
    bp.frequency.linearRampToValueAtTime(table.f[i] * scale * 1.06, when + span);
    const g = ctx.createGain();
    g.gain.value = GAINS[i] * (1 - GROWL.weight * 0.5);
    into.connect(bp).connect(g).connect(out);
  }
  return { into, out };
}

/**
 * The pitch line: the note, plus wander. No scoop and no fall — a growl does
 * not arrive at a pitch the way a cry does, it settles onto one and grinds.
 */
function pitchLine(hz, span, seed, n) {
  const line = new Float32Array(n);
  let wander = 0;
  for (let i = 0; i < n; i++) {
    wander = wander * 0.9 + (rand(seed * 7919 + i) - 0.5) * 0.013 * GROWL.jitter;
    line[i] = hz * (1 + wander);
  }
  return line;
}

/** The glottal source and its two subharmonics, all sharing one pitch line. */
function folds(ctx, hz, when, span, seed, into, rough) {
  const n = clamp(Math.round(span * 200), 2, 6000);
  const line = pitchLine(hz, span, seed, n);
  const parts = [];
  for (const [ratio, gain] of [
    [1, 1],
    [0.5, GROWL.rasp * rough],
    [1 / 3, GROWL.grind * rough],
  ]) {
    if (gain <= 0) continue;
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(glottis(ctx));
    osc.frequency.setValueCurveAtTime(
      line.map((f) => f * ratio),
      when,
      span,
    );
    const g = ctx.createGain();
    g.gain.value = gain;
    osc.connect(g).connect(into);
    parts.push(osc);
  }
  return parts;
}

/** The sawtooth-and-purr source purrVoice has always used, lifted out whole. */
function saw(ctx, hz, seed, beds, into) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = hz;
  const ring = ctx.createGain();
  ring.gain.value = 1 - GROWL.purrDepth;
  if (beds.length) {
    const depth = ctx.createGain();
    depth.gain.value = GROWL.purrDepth;
    beds[Math.floor(rand(seed) * beds.length)].connect(depth).connect(ring.gain);
  }
  osc.connect(ring).connect(into);
  return [osc];
}

/**
 * One low note, scheduled at `when`. `mode` is 'growl' or 'purr-growl'; the
 * signature otherwise matches purrVoice in synth.js, which is what it stands
 * in for.
 */
export function growlVoice(ctx, note, when, level, pan, seed, beds, mode) {
  const span = note.d + GROWL.release;
  const { purr, throat: table } = readMode(mode);
  // Formants scale with the animal, and one growling at 90 Hz is a bigger
  // animal than one growling at 190. Shallow, and clamped tight — there is not
  // much range of animal in play within a single throat.
  const scale = clamp((note.hz / table.ref) ** 0.3 * GROWL.size, 0.8, 1.5);
  const tract = throat(ctx, note.hz, when, span, scale, table);
  const parts = purr
    ? saw(ctx, note.hz, seed, beds, tract.into)
    : folds(ctx, note.hz, when, span, seed, tract.into, table.rough);

  const amp = ctx.createGain();
  const peak = level * (GROWL.trim[mode] ?? 1);
  amp.gain.setValueAtTime(0, when);
  amp.gain.linearRampToValueAtTime(peak, when + GROWL.attack);
  amp.gain.setValueAtTime(peak, when + Math.max(GROWL.attack, note.d));
  amp.gain.linearRampToValueAtTime(0, when + span);
  tract.out.connect(amp).connect(pan);

  for (const p of parts) {
    p.start(when);
    p.stop(when + span + 0.02);
  }
  return parts[0];
}
