/**
 * main.js — wiring, and nothing else.
 *
 * The picture starts immediately (drawing needs no permission). The audio waits
 * for a click, because browsers require a gesture before they will make sound.
 *
 * Two URL flags, both used by the tools rather than by you:
 *   ?t=48.5   park the playhead at 48.5 seconds and hold it there
 *   ?still    hide the overlay and the readout — just the frame
 */
import * as bus from './bus.js';
import { initEngine, rebuild, toggle, seekToBar, isPlaying, getAudioTap } from './music/engine.js';
import { initScene } from './visuals/scene.js';

const qp = new URLSearchParams(location.search);
const canvas = document.getElementById('scene');
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');

const still = qp.has('still');
const parkAt = qp.has('t') ? Number(qp.get('t')) : null;
if (still) document.body.classList.add('still');

const visuals = initScene(canvas, still ? { size: [1280, 720] } : {});
if (parkAt !== null) bus.setScrub(parkAt);

// The handle every tool reaches through. Keep this small and stable — tools
// break when it changes, and a broken tool is a review you skip.
window.tidewater = {
  bus,
  visuals,
  getAudioTap,
  seekToBar,
  rebuild,
  isPlaying,
  /** Draw one exact frame. tools/storyboard.mjs calls this. */
  renderAt(t) {
    bus.setScrub(t);
    visuals.renderAt(t);
  },
};

// ------------------------------------------------------------------- audio ---
overlay.addEventListener('click', async () => {
  overlay.style.display = 'none';
  try {
    await initEngine();
    if (parkAt !== null) bus.setScrub(null); // hand the clock back
  } catch (err) {
    console.error('[engine]', err);
    overlay.style.display = 'flex';
    overlay.querySelector('p').textContent = `audio failed: ${err.message}`;
  }
});

// --------------------------------------------------------------------- hud ---
// Always say where we are. Half of feeling out of control is not knowing what
// bar you are looking at.
if (!still) {
  setInterval(() => {
    const t = bus.now();
    const at = bus.sectionAt(t);
    const on = at.section.voices.join(' ');
    hud.innerHTML =
      `<b>${at.name}</b> &nbsp; bar ${Math.floor(at.bar)}/${bus.TOTAL_BARS} &nbsp; ` +
      `${t.toFixed(0)}s / ${bus.TOTAL_SECONDS.toFixed(0)}s<br>` +
      `tension ${bus.tensionAt(t).toFixed(2)} &nbsp; ` +
      `bright ${bus.brightnessAt(t).toFixed(2)} &nbsp; ` +
      `${bus.modeAt(bus.brightnessAt(t)).name}<br>${on}`;
  }, 100);
}

// space toggles, so you can stop it without hunting for a button
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
});
