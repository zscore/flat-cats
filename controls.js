/**
 * controls.js — the panel that lets the palette be judged by ear.
 *
 * Every row here moves a field on TONE, ENV or MIX in synth.js, or on MEOW in
 * meow.js. The two instruments' rows are both always shown rather than swapped
 * by `source`: half of them do nothing at any given moment, which is worth it
 * to keep A/B a single click with nothing else moving. Nothing is
 * copied: the synth reads those objects when it builds each note, so a slider
 * takes effect on the next note scheduled, which is about 0.15s ahead of what
 * you are hearing. That is why this is a panel and not a config file — the
 * whole question is which of these sounds better, and that is not answerable
 * by reading numbers.
 *
 * The panel does not persist. Reload and you are back at the defaults in
 * synth.js, which is deliberate: if a setting is worth keeping, it is worth
 * being the default, and moving it there is a one-line commit.
 */
import { TONE, ENV, MIX, MAPPINGS } from './synth.js';
import { MEOW } from './meow.js';
import { GROWL } from './growl.js';

const hz = (v) => `${v.toFixed(0)} Hz`;
const ms = (v) => `${(v * 1000).toFixed(0)} ms`;
const x = (v) => `${v.toFixed(2)}×`;
const db = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
const pct = (v) => `${(v * 100).toFixed(0)}%`;

/**
 * What each row does, in the order it reads best: the melodic knob first,
 * because it is the one worth moving first.
 */
const ROWS = [
  ['peak at fundamental', TONE, 'peak', 0, 20, 0.5, db],
  ['peak width (Q)', TONE, 'peakQ', 0.5, 14, 0.1, (v) => v.toFixed(1)],
  ['highpass', TONE, 'hpBelow', 0, 1.5, 0.05, x],
  ['lowpass', TONE, 'lpAbove', 2, 16, 0.5, x],
  ['lowpass cap', TONE, 'lpCap', 1500, 8000, 100, hz],
  ['attack', ENV, 'attack', 0.001, 0.15, 0.001, ms],
  ['release', ENV, 'release', 0.02, 0.8, 0.01, ms],
  ['purr crossover', MIX, 'lowHz', 60, 500, 5, hz],
  ['purr depth', MIX, 'purrDepth', 0, 1, 0.02, pct],
  // meow.js. Dead unless source is 'synth'. `scoop` and `fall` are the pair to
  // move first: they are how much of a real cry's slide the tuning can stand.
  ['meow · scoop into pitch', MEOW, 'scoop', 0.6, 1, 0.01, x],
  ['meow · fall out of it', MEOW, 'fall', 0.5, 1, 0.01, x],
  ['meow · throat size', MEOW, 'size', 0.6, 1.6, 0.02, x],
  ['meow · rasp', MEOW, 'rasp', 0, 0.5, 0.01, pct],
  ['meow · breath', MEOW, 'breath', 0, 0.6, 0.01, pct],
  ['meow · vibrato', MEOW, 'vibrato', 0, 0.05, 0.002, pct],
  ['meow · jitter', MEOW, 'jitter', 0, 2, 0.05, x],
  ['meow · release', MEOW, 'release', 0.02, 0.6, 0.01, ms],
  ['meow · trim', MEOW, 'level', 0.5, 3, 0.05, x],
  // growl.js. Dead unless the lower register is one of the growls. `weight` is
  // the one to move first — it is the whole difference between a bass note and
  // a buzz, in either mode.
  ['growl · chest weight', GROWL, 'weight', 0, 1, 0.02, pct],
  ['growl · chest cutoff', GROWL, 'chest', 1, 6, 0.1, x],
  ['growl · rasp (octave down)', GROWL, 'rasp', 0, 1, 0.02, pct],
  ['growl · grind (twelfth down)', GROWL, 'grind', 0, 0.6, 0.01, pct],
  ['growl · jitter', GROWL, 'jitter', 0, 4, 0.1, x],
  ['growl · throat size', GROWL, 'size', 0.6, 1.6, 0.02, x],
];

/**
 * Mount the panel into `el`. `onGain` gets the master level, which is the one
 * control that is not a synth setting — it belongs to the graph, not the tone.
 *
 * `master: false` leaves that last row out, for a page that has more than one
 * level to set and wants them in one place rather than one here and one
 * elsewhere. duet.html does; song.html does not.
 */
export function mountControls(el, { onGain, gain = 0.5, master = true } = {}) {
  el.innerHTML = '';

  menu(el, 'upper register', MIX, 'source', {
    bank: 'bank — recorded cats',
    synth: 'synth — built meows',
  });
  menu(el, 'sample mapping', MIX, 'mapping', Object.fromEntries(Object.keys(MAPPINGS).map((k) => [k, k])));
  menu(el, 'lower register', MIX, 'low', {
    purr: 'purr — sawtooth + purr envelope',
    growl: 'growl — cat throat, glottal',
    'purr-growl': 'purr through the cat throat',
    lion: 'lion — lion throat, glottal',
    'purr-lion': 'purr through the lion throat',
  });

  for (const [label, obj, key, min, max, step, fmt] of ROWS) {
    slider(el, label, obj[key], { min, max, step, fmt }, (v) => (obj[key] = v));
  }
  // One trim row for four modes, writing to whichever is selected. Four rows
  // would be three rows of clutter — only one of them is ever live, and the
  // whole reason trim exists is that the louder mode must not simply win.
  slider(el, 'lower register · trim', GROWL.trim[MIX.low] ?? 1, { min: 0.5, max: 3, step: 0.05, fmt: x }, (v) => {
    if (MIX.low in GROWL.trim) GROWL.trim[MIX.low] = v;
  });

  if (master) slider(el, 'master', gain, { min: 0, max: 1, step: 0.01, fmt: pct }, onGain);

  const reset = document.createElement('button');
  reset.textContent = 'reset to defaults';
  reset.onclick = () => location.reload();
  el.append(reset);
}

/** One labelled dropdown, writing straight back to `obj[key]`. */
function menu(el, label, obj, key, options) {
  const select = document.createElement('select');
  for (const [value, text] of Object.entries(options)) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    select.append(opt);
  }
  select.value = obj[key];
  select.onchange = () => (obj[key] = select.value);
  row(el, label).append(select);
  return select;
}

function row(el, label) {
  const div = document.createElement('div');
  div.className = 'row';
  const name = document.createElement('label');
  name.textContent = label;
  div.append(name);
  el.append(div);
  return div;
}

/** One labelled range row. Exported so a page can add rows of its own. */
export function slider(el, label, value, { min, max, step, fmt }, apply) {
  const div = row(el, label);
  const input = document.createElement('input');
  input.type = 'range';
  Object.assign(input, { min, max, step, value });
  const read = document.createElement('span');
  read.className = 'read';
  read.textContent = fmt(value);
  input.oninput = () => {
    const v = Number(input.value);
    read.textContent = fmt(v);
    apply(v);
  };
  div.append(input, read);
  return input;
}
