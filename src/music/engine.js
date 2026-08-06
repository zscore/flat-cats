/**
 * engine.js — boots Strudel + superdough, and mirrors every note onto the bus.
 *
 * There is exactly one interesting idea in this file: the `output` wrapper. Each
 * note passes through it on its way to the speakers, carrying the audio-clock
 * time it is *going* to sound at — which is a little in the future, because the
 * scheduler works ahead. We publish that on the bus, so the picture knows a kick
 * is coming before you hear it and can land its ripple exactly on the beat.
 *
 * Everything else here is boilerplate you should not have to think about.
 */
import { controls, stack, cat, silence, repl } from '@strudel/core';
import { miniAllStrings } from '@strudel/mini';
import {
  getAudioContext,
  initAudio,
  webaudioOutput,
  registerSynthSounds,
  getSuperdoughAudioController,
} from '@strudel/webaudio';
import * as bus from '../bus.js';
import { buildPiece } from './patterns.js';

let scheduler = null;

export async function initEngine() {
  miniAllStrings(); // plain strings become mini-notation inside s() / note()

  // We are called from inside the click handler, so we are already in a user
  // gesture — initialise the audio context directly rather than waiting for a
  // listener that will never see this click.
  await initAudio();
  const ctx = getAudioContext();
  await registerSynthSounds(); // sine / sawtooth / triangle / square / noise

  const output = (hap, deadline, hapDuration, cps, targetTime) => {
    const v = hap.value ?? {};
    bus.publish({
      type: 'note',
      sound: v.s ?? null,
      note: v.note ?? null,
      orbit: v.orbit ?? 0,
      gain: v.gain ?? 1,
      when: ctx.currentTime + deadline, // absolute audio-clock time it will sound
      dur: hapDuration,
    });
    return webaudioOutput(hap, deadline, hapDuration, cps, targetTime);
  };

  ({ scheduler } = repl({ defaultOutput: output, getTime: () => ctx.currentTime }));
  scheduler.setCps(bus.CPS);

  // superdough creates orbits lazily; make ours up front so their reverbs exist
  // before the first note rather than being built during it.
  const controller = getSuperdoughAudioController();
  for (const orbit of [1, 2, 3]) controller.getOrbit(orbit, [0, 1]);

  // Bar 0 of the score and cycle 0 of the scheduler are pinned to the same
  // instant. That is the whole clock story — there is no second clock.
  bus.start(() => ctx.currentTime);
  rebuild();
  scheduler.start();
  return scheduler;
}

/** Recompile the piece from the score. Cheap — call it after any score edit. */
export function rebuild() {
  if (!scheduler) return;
  scheduler.setPattern(buildPiece({ ...controls, stack, cat, silence }), false);
}

/** Jump to an absolute bar. Used by the studio's timeline clicks. */
export function seekToBar(bar) {
  if (!scheduler) return;
  const ctx = getAudioContext();
  bus.start(() => ctx.currentTime, bar * bus.BAR_SECONDS);
  scheduler.lastEnd = bar;                  // next query window starts here
  scheduler.num_ticks_since_cps_change = 0; // re-anchor wall-time ↔ cycle
  if (!scheduler.started) scheduler.start();
  bus.publish({ type: 'seek', bar, when: ctx.currentTime });
}

export function toggle() {
  if (!scheduler) return false;
  if (scheduler.started) {
    scheduler.stop();
    return false;
  }
  bus.start(() => getAudioContext().currentTime);
  rebuild();
  scheduler.start();
  return true;
}

export function isPlaying() {
  return Boolean(scheduler?.started);
}

/** The finished mix, as a node anything may passively listen to (tools/ab.mjs). */
export function getAudioTap() {
  if (!scheduler) return null;
  return {
    ctx: getAudioContext(),
    node: getSuperdoughAudioController().output.destinationGain,
  };
}
