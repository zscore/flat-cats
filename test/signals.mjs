/**
 * signals.mjs — guards the derived layer.
 *
 * bus.js turns the score into signals of time, and both media read those. If a
 * signal goes out of range or jumps where it should glide, the failure shows up
 * as a visual glitch or a filter screech that is hard to trace back. Cheaper to
 * catch here.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SECTIONS } from '../score/score.js';
import * as bus from '../src/bus.js';
import { timeSinceKick, contextForBar, kickPositions } from '../src/music/patterns.js';

const SAMPLES = 1200;
const times = Array.from({ length: SAMPLES }, (_, i) => (i / (SAMPLES - 1)) * bus.TOTAL_SECONDS);

test('tension and brightness stay in 0..1 for the whole piece', () => {
  for (const t of times) {
    const T = bus.tensionAt(t);
    const b = bus.brightnessAt(t);
    assert.ok(T >= 0 && T <= 1, `tension ${T} at t=${t.toFixed(2)}`);
    assert.ok(b >= 0 && b <= 1, `brightness ${b} at t=${t.toFixed(2)}`);
  }
});

test('brightness glides — it never jumps within one frame', () => {
  // brightness drives the camera height. A step here is a visible teleport.
  const dt = 1 / 30;
  for (let t = 0; t < bus.TOTAL_SECONDS - dt; t += dt) {
    const jump = Math.abs(bus.brightnessAt(t + dt) - bus.brightnessAt(t));
    assert.ok(jump < 0.06, `brightness jumps ${jump.toFixed(3)} across one frame at t=${t.toFixed(2)}`);
  }
});

test('colour glides too', () => {
  const dt = 1 / 30;
  for (let t = 0; t < bus.TOTAL_SECONDS - dt; t += dt) {
    const a = bus.colorsAt(t);
    const b = bus.colorsAt(t + dt);
    for (const key of ['water', 'sky']) {
      const jump = Math.max(...a[key].map((c, i) => Math.abs(c - b[key][i])));
      assert.ok(jump < 0.05, `${key} jumps ${jump.toFixed(3)} across one frame at t=${t.toFixed(2)}`);
    }
  }
});

test('sectionAt lands on the right section at every boundary', () => {
  SECTIONS.forEach((sec, i) => {
    const start = bus.SECTION_STARTS[i] * bus.BAR_SECONDS;
    assert.equal(bus.sectionAt(start + 0.01).name, sec.name, `just after ${sec.name} starts`);
    const end = bus.SECTION_STARTS[i + 1] * bus.BAR_SECONDS;
    assert.equal(bus.sectionAt(end - 0.01).name, sec.name, `just before ${sec.name} ends`);
  });
});

test('reading past the end holds on the last frame rather than exploding', () => {
  const past = bus.TOTAL_SECONDS + 30;
  assert.equal(bus.sectionAt(past).name, SECTIONS[SECTIONS.length - 1].name);
  assert.ok(Number.isFinite(bus.tensionAt(past)));
  assert.ok(Number.isFinite(bus.brightnessAt(past)));
});

test('the picture and the music agree about where the kicks are', () => {
  // The ring on the water is drawn from kickPositions, the same function the
  // kick pattern is built from. If these ever diverge, stills stop being exact.
  for (let bar = 0; bar < bus.TOTAL_BARS; bar++) {
    const ctx = contextForBar(bar);
    if (!ctx.voices.includes('pulse')) continue;
    const steps = kickPositions(ctx);
    assert.ok(steps.length > 0, `bar ${bar} plays pulse but has no kicks`);
    for (const s of steps) {
      assert.ok(s >= 0 && s < 16, `bar ${bar} has a kick on step ${s}`);
    }
    // a moment just after each kick should report a near-zero age
    const stepLen = bus.BAR_SECONDS / 16;
    for (const s of steps) {
      const t = bar * bus.BAR_SECONDS + s * stepLen + 0.005;
      assert.ok(timeSinceKick(t) < 0.02, `timeSinceKick missed the kick at bar ${bar} step ${s}`);
    }
  }
});

test('sections with no kick report no recent kick', () => {
  for (const [i, sec] of SECTIONS.entries()) {
    if (sec.voices.includes('pulse')) continue;
    // sample late in the section, well past any kick that preceded it
    const end = bus.SECTION_STARTS[i + 1] * bus.BAR_SECONDS;
    assert.ok(timeSinceKick(end - 0.05) > 1.5, `"${sec.name}" has no pulse but reports a fresh kick`);
  }
});

test('drift stays bounded', () => {
  for (const t of times) {
    const d = bus.drift(t);
    assert.ok(d >= -1.05 && d <= 1.05, `drift ${d} at t=${t}`);
  }
});
