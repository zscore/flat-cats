/**
 * controls.js — the panel that lets the palette be judged by ear.
 *
 * Every row here moves a field on TONE, ENV or MIX in synth.js. Nothing is
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

  const mapping = row(el, 'sample mapping');
  const select = document.createElement('select');
  for (const name of Object.keys(MAPPINGS)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.append(opt);
  }
  select.value = MIX.mapping;
  select.onchange = () => (MIX.mapping = select.value);
  mapping.append(select);

  for (const [label, obj, key, min, max, step, fmt] of ROWS) {
    slider(el, label, obj[key], { min, max, step, fmt }, (v) => (obj[key] = v));
  }
  if (master) slider(el, 'master', gain, { min: 0, max: 1, step: 0.01, fmt: pct }, onGain);

  const reset = document.createElement('button');
  reset.textContent = 'reset to defaults';
  reset.onclick = () => location.reload();
  el.append(reset);
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
