/**
 * score.mjs — guards the authored layer.
 *
 * These tests do not check that the piece is GOOD. Nothing can check that but
 * your ears, which is why the review tools exist. What they check is that the
 * score and the machinery still agree with each other — that you have not named
 * a voice nothing can play, or set a level for something that no longer exists.
 *
 * Those are exactly the mistakes that are silent at runtime: a voice with no
 * builder just doesn't sound, and you spend twenty minutes wondering why.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SECTIONS, VOICES, LEVELS, MOTIF, MODES, BPM, ROOT_MIDI } from '../score/score.js';
import { IMPLEMENTED_VOICES } from '../src/music/patterns.js';
import * as bus from '../src/bus.js';

test('every voice a section names actually exists', () => {
  for (const sec of SECTIONS) {
    for (const id of sec.voices) {
      assert.ok(VOICES[id], `section "${sec.name}" names voice "${id}", which is not in VOICES`);
    }
  }
});

test('every voice in the cast can actually be played', () => {
  for (const id of Object.keys(VOICES)) {
    assert.ok(
      IMPLEMENTED_VOICES.includes(id),
      `VOICES has "${id}" but src/music/patterns.js has no builder for it — it would be silent`,
    );
  }
});

test('every voice has a level', () => {
  for (const id of Object.keys(VOICES)) {
    assert.equal(typeof LEVELS[id], 'number', `no LEVELS entry for "${id}"`);
    assert.ok(LEVELS[id] >= 0 && LEVELS[id] <= 2, `LEVELS.${id} = ${LEVELS[id]} is out of range`);
  }
});

test('sections are well formed', () => {
  assert.ok(SECTIONS.length > 0, 'the piece has no sections');
  const names = new Set();
  for (const sec of SECTIONS) {
    assert.ok(!names.has(sec.name), `two sections are both called "${sec.name}"`);
    names.add(sec.name);

    assert.ok(Number.isInteger(sec.bars) && sec.bars > 0, `"${sec.name}" has bars = ${sec.bars}`);
    for (const key of ['tension', 'brightness']) {
      assert.ok(Array.isArray(sec[key]) && sec[key].length === 2, `"${sec.name}".${key} must be [start, end]`);
      for (const v of sec[key]) {
        assert.ok(v >= 0 && v <= 1, `"${sec.name}".${key} has ${v}, which is outside 0..1`);
      }
    }
    for (const key of ['water', 'sky']) {
      assert.match(sec[key], /^#[0-9a-f]{6}$/i, `"${sec.name}".${key} = ${sec[key]} is not a #rrggbb colour`);
    }
    assert.ok(sec.voices.length > 0, `"${sec.name}" has no voices — it would be silence`);
  }
});

test('the motif fits the modes', () => {
  const size = MODES[0].steps.length;
  for (const mode of MODES) {
    assert.equal(mode.steps.length, size, `mode "${mode.name}" has a different number of degrees`);
  }
  for (const d of MOTIF) {
    if (d === null) continue;
    assert.ok(Number.isInteger(d), `MOTIF has a non-integer degree: ${d}`);
  }
  assert.ok(MOTIF.some((d) => d !== null), 'MOTIF is all rests');
});

test('the tune stays inside hearing', () => {
  // bell plays the motif two octaves up; make sure that is still a note.
  for (const mode of MODES) {
    for (const d of MOTIF) {
      if (d === null) continue;
      const midi = bus.degreeToMidi(mode, d, 2);
      assert.ok(midi > 24 && midi < 108, `${mode.name} degree ${d} lands on MIDI ${midi}`);
    }
  }
  assert.ok(ROOT_MIDI > 12 && ROOT_MIDI < 96, `ROOT_MIDI ${ROOT_MIDI} is implausible`);
});

test('the piece is a sane length at a sane tempo', () => {
  assert.ok(BPM >= 40 && BPM <= 220, `BPM ${BPM} is implausible`);
  assert.ok(bus.TOTAL_BARS === SECTIONS.reduce((a, s) => a + s.bars, 0));
  assert.ok(bus.TOTAL_SECONDS > 20, 'the piece is under 20 seconds — is that intended?');
  assert.ok(bus.TOTAL_SECONDS < 60 * 30, 'the piece is over 30 minutes — is that intended?');
});
