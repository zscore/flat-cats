/**
 * studio.js — the drawing of the score.
 *
 * This page exists because reading a piece of music out of a source file is
 * miserable, and because you should be able to point at a moment rather than
 * describe it. It draws four things, all read live from `score/score.js`:
 *
 *   1. a thumbnail strip     — what the piece LOOKS like, end to end
 *   2. the section blocks    — the form, at true relative length
 *   3. the arrangement grid  — which voice plays where (the `voices` arrays)
 *   4. the two curves        — tension and brightness
 *
 * The thumbnails are the reason `renderAt(t)` had to be pure: we spin up a
 * second, offscreen copy of the scene and ask it for sixteen exact frames. No
 * audio runs, nothing is recorded, and it takes about a second.
 */
import * as bus from '../bus.js';
import { SECTIONS, VOICES, LEVELS } from '../../score/score.js';
import { initScene } from '../visuals/scene.js';
import { initEngine, seekToBar, isPlaying } from '../music/engine.js';

const $ = (id) => document.getElementById(id);
const preview = initScene($('preview'), {});
const thumbScene = initScene($('thumbcanvas'), { size: [320, 180], manual: true });

const VOICE_IDS = Object.keys(VOICES);
const THUMBS = 16;

let audioReady = false;

// ------------------------------------------------------------- thumbnails ----
function drawThumbnails() {
  const strip = $('thumbs');
  strip.innerHTML = '';
  for (let i = 0; i < THUMBS; i++) {
    // sample just past the start of each slice, so a thumbnail is never sitting
    // exactly on a section edge where it could show either side
    const t = ((i + 0.35) / THUMBS) * bus.TOTAL_SECONDS;
    thumbScene.renderAt(t);
    const url = $('thumbcanvas').toDataURL('image/jpeg', 0.72);

    const fig = document.createElement('figure');
    const img = document.createElement('img');
    img.src = url;
    img.alt = `${bus.sectionAt(t).name} at ${t.toFixed(0)}s`;
    const cap = document.createElement('figcaption');
    cap.textContent = `${Math.floor(t)}s`;
    fig.append(img, cap);
    fig.addEventListener('click', () => goTo(t));
    strip.append(fig);
  }
}

// --------------------------------------------------------------- timeline ----
// The label gutter is subtracted from the plotting area rather than drawn over
// it, so the section blocks, the voice lanes, the curves and the playhead all
// share ONE time→x mapping. (They did not at first, and the arrangement grid
// quietly claimed the first section's voices started eight seconds late.)
const TL = {
  pad: 8,
  gutter: 54,
  header: 30,   // section blocks
  lane: 20,     // one voice row
  gap: 10,
  curves: 84,
};
TL.height = TL.pad + TL.header + TL.gap + VOICE_IDS.length * TL.lane + TL.gap + TL.curves + TL.pad;

function drawTimeline() {
  const canvas = $('timeline');
  const width = canvas.clientWidth || 1140;
  const dpr = Math.min(window.devicePixelRatio, 2);
  canvas.width = width * dpr;
  canvas.height = TL.height * dpr;
  canvas.style.height = `${TL.height}px`;

  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, width, TL.height);
  g.fillStyle = '#141c21';
  g.fillRect(0, 0, width, TL.height);

  const plotW = width - TL.gutter;
  const x = (t) => TL.gutter + (t / bus.TOTAL_SECONDS) * plotW;

  // --- section blocks
  let y = TL.pad;
  SECTIONS.forEach((sec, i) => {
    const t0 = bus.SECTION_STARTS[i] * bus.BAR_SECONDS;
    const t1 = bus.SECTION_STARTS[i + 1] * bus.BAR_SECONDS;
    const w = x(t1) - x(t0);
    g.fillStyle = sec.water;
    g.fillRect(x(t0) + 1, y, w - 2, TL.header);
    g.strokeStyle = '#0d1215';
    g.strokeRect(x(t0) + 1, y, w - 2, TL.header);

    g.fillStyle = '#eaf3f5';
    g.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    g.fillText(sec.name, x(t0) + 7, y + 13);
    g.fillStyle = 'rgba(234,243,245,0.6)';
    g.font = '400 10px ui-monospace, Menlo, monospace';
    g.fillText(`${sec.bars} bars · ${(t1 - t0).toFixed(0)}s`, x(t0) + 7, y + 25);
  });

  // --- arrangement grid: one row per voice, filled where that voice plays
  y += TL.header + TL.gap;
  VOICE_IDS.forEach((id, row) => {
    const ry = y + row * TL.lane;

    g.fillStyle = '#7f959d';
    g.font = '400 10px ui-monospace, Menlo, monospace';
    g.fillText(VOICES[id].label, 4, ry + 13);

    g.fillStyle = 'rgba(255,255,255,0.03)';
    g.fillRect(TL.gutter, ry + 2, plotW, TL.lane - 4);

    SECTIONS.forEach((sec, i) => {
      if (!sec.voices.includes(id)) return;
      const t0 = bus.SECTION_STARTS[i] * bus.BAR_SECONDS;
      const t1 = bus.SECTION_STARTS[i + 1] * bus.BAR_SECONDS;
      const bx = x(t0) + 1;
      const bw = x(t1) - x(t0) - 2;
      if (bw <= 0) return;
      g.fillStyle = VOICES[id].color;
      g.globalAlpha = 0.55 + 0.45 * LEVELS[id];
      g.fillRect(bx, ry + 3, bw, TL.lane - 6);
      g.globalAlpha = 1;
    });
  });

  // --- the two curves, sampled straight off the bus
  y += VOICE_IDS.length * TL.lane + TL.gap;
  const curve = (fn, color, dash) => {
    g.beginPath();
    g.setLineDash(dash);
    for (let px = 0; px <= plotW; px += 2) {
      const t = (px / plotW) * bus.TOTAL_SECONDS;
      const py = y + TL.curves - fn(t) * TL.curves;
      px === 0 ? g.moveTo(TL.gutter + px, py) : g.lineTo(TL.gutter + px, py);
    }
    g.strokeStyle = color;
    g.lineWidth = 1.75;
    g.stroke();
    g.setLineDash([]);
  };

  g.strokeStyle = 'rgba(255,255,255,0.07)';
  g.lineWidth = 1;
  g.fillStyle = '#7f959d';
  g.font = '400 9px ui-monospace, Menlo, monospace';
  [0, 0.5, 1].forEach((v) => {
    const gy = y + TL.curves - v * TL.curves;
    g.beginPath();
    g.moveTo(TL.gutter, gy);
    g.lineTo(width, gy);
    g.stroke();
    g.fillText(v.toFixed(1), 4, gy + 3);
  });

  curve((t) => bus.tensionAt(t), '#e0704f', []);
  curve((t) => bus.brightnessAt(t), '#5aa9c9', [4, 3]);

  TL.curveTop = y;
  TL.width = width;
}

function drawPlayhead() {
  // The playhead lives on the same canvas, so the timeline is redrawn beneath it
  // each frame. That is a few hundred line segments — cheap, and it means there
  // is only ever one drawing of the score rather than a stale one plus an overlay.
  drawTimeline();
  const g = $('timeline').getContext('2d');
  const px = TL.gutter + (bus.now() / bus.TOTAL_SECONDS) * (TL.width - TL.gutter);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(px, TL.pad);
  g.lineTo(px, TL.height - TL.pad);
  g.stroke();
}

// ------------------------------------------------------------------ state ----
function goTo(t) {
  const clamped = Math.max(0, Math.min(t, bus.TOTAL_SECONDS - 0.01));
  if (audioReady && isPlaying()) {
    bus.setScrub(null);
    seekToBar(Math.floor(clamped / bus.BAR_SECONDS));
  } else {
    bus.setScrub(clamped);
  }
}

$('timeline').addEventListener('click', (e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  const px = e.clientX - rect.left - TL.gutter;
  goTo((px / (rect.width - TL.gutter)) * bus.TOTAL_SECONDS);
});

$('play').addEventListener('click', async () => {
  const btn = $('play');
  if (!audioReady) {
    btn.disabled = true;
    btn.textContent = 'starting…';
    try {
      await initEngine();
      audioReady = true;
      const from = bus.isScrubbing() ? bus.now() : 0;
      bus.setScrub(null);
      seekToBar(Math.floor(from / bus.BAR_SECONDS));
    } catch (err) {
      console.error(err);
      btn.textContent = 'audio failed — see console';
      return;
    } finally {
      btn.disabled = false;
    }
  }
  btn.textContent = '▶ playing';
});

$('board').addEventListener('click', drawThumbnails);

// ---------------------------------------------------------------- readout ----
function drawReadout() {
  const t = bus.now();
  const at = bus.sectionAt(t);
  const b = bus.brightnessAt(t);
  const on = VOICE_IDS.filter((id) => at.section.voices.includes(id));
  $('readout').innerHTML = `
    <div class="now">${at.name}</div>
    <div><span class="k">time</span>${t.toFixed(1)}s / ${bus.TOTAL_SECONDS.toFixed(0)}s</div>
    <div><span class="k">bar</span>${Math.floor(at.bar)} / ${bus.TOTAL_BARS}
         &nbsp;(${(at.progress * 100).toFixed(0)}% through)</div>
    <div><span class="k">tension</span>${bus.tensionAt(t).toFixed(2)}</div>
    <div><span class="k">brightness</span>${b.toFixed(2)}</div>
    <div><span class="k">mode</span>${bus.modeAt(b).name}</div>
    <div><span class="k">playing</span>${on.join(', ')}</div>
    <div><span class="k">silent</span>${VOICE_IDS.filter((id) => !on.includes(id)).join(', ') || '—'}</div>
  `;
}

function drawLegend() {
  $('legend').innerHTML =
    VOICE_IDS.map((id) =>
      `<span><i style="background:${VOICES[id].color}"></i>${VOICES[id].label} — ${VOICES[id].role}</span>`,
    ).join('') +
    `<span><i style="background:#e0704f"></i>tension</span>` +
    `<span><i style="background:#5aa9c9"></i>brightness (dashed)</span>`;
}

// ------------------------------------------------------------------- boot ----
preview.resize();
drawLegend();
drawTimeline();
drawThumbnails();

function tick() {
  requestAnimationFrame(tick);
  drawPlayhead();
  drawReadout();
}
tick();

window.addEventListener('resize', () => {
  preview.resize();
  drawTimeline();
});

// Park at the top on load so the first frame is the first frame.
if (!bus.isScrubbing()) bus.setScrub(0);

window.studio = { bus, drawThumbnails, goTo };
