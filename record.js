/**
 * record.js — the save button: the whole piece, picture and sound, to a file.
 *
 * It records rather than renders, and that is the trade worth understanding
 * before changing it. The canvas is captured as it plays, in real time, off the
 * same rAF loop and the same AudioContext you are watching and hearing — so what
 * lands in the file is exactly what the page did, including any frame the page
 * dropped. A frame-by-frame render would be immune to that, but it would need
 * the audio built a second way (OfflineAudioContext) and the two clocks lined up
 * afterwards, and then the file would be a thing nobody had ever watched.
 *
 * This way the file is the performance. If it stutters, the page stuttered, and
 * that is a bug you can see rather than one you have to go looking for.
 *
 * Two consequences to keep in mind:
 *
 *   - it takes as long as the piece does, and the tab has to stay in front.
 *     Backgrounded, rAF throttles to a crawl and the video goes with it, so the
 *     button says so rather than letting you find out at the end.
 *   - the size is the canvas's own, not the window's. frame.js pins the tall
 *     view to 1080×1920, so the file is 1080×1920 wherever it was recorded —
 *     which is the whole reason that pinning exists.
 *
 * The audio is tapped off synth.out, the last node before the speakers, and not
 * off synth.master: master is the level knob and sits before the limiter, so a
 * recording taken there is the one that clips on a dense chord.
 */

// Best first. Chrome gives WebM, Safari gives MP4; both are asked for rather
// than assumed, because MediaRecorder silently substitutes a format it does
// like if you hand it one it does not.
const TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

// 1080×1920 of photographic cats moving at 60fps. Generous on purpose: this is
// a master to keep, not a stream, and the default rate turns the fur to soup.
const BITRATE = 16_000_000;
const FPS = 60;

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Record `canvas` and `source` for the length of the piece and hand back a file.
 *
 * `transport` is song.js's own — seek, play, pause and now — so the recording
 * drives the page rather than running a second copy of it beside it.
 */
export function record({ canvas, audio, source, transport, end, name, onProgress }) {
  const type = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  if (!type) throw new Error('this browser cannot record a canvas');

  const stream = canvas.captureStream(FPS);
  const tap = audio.createMediaStreamDestination();
  source.connect(tap);
  for (const track of tap.stream.getAudioTracks()) stream.addTrack(track);

  const chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: BITRATE });
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const done = new Promise((resolve) => {
    rec.onstop = () => {
      // Unhook the tap, or every later recording adds another one and the mix
      // gets that much louder each time.
      source.disconnect(tap);
      for (const track of stream.getTracks()) track.stop();
      resolve(new Blob(chunks, { type }));
    };
  });

  transport.seek(0);
  transport.play();
  rec.start(1000); // a chunk a second, so a crash still leaves most of the take

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    transport.pause();
    rec.stop();
  };

  (function watch() {
    if (stopped) return;
    const t = transport.now();
    onProgress?.(t, end);
    if (t >= end) return stop();
    requestAnimationFrame(watch);
  })();

  return {
    stop,
    file: done.then((blob) => ({ blob, name: `${name}.${type.startsWith('video/mp4') ? 'mp4' : 'webm'}` })),
  };
}

/**
 * The button, mounted into the panel. It is a button and not a keystroke
 * because it takes three minutes and commits the page to doing nothing else —
 * that deserves a thing you have to mean to press.
 */
export function mountRecorder(el, opts) {
  const button = document.createElement('button');
  const idle = `save video · ${opts.canvas.width}×${opts.canvas.height}`;
  button.textContent = idle;
  el.append(button);

  const note = document.createElement('div');
  note.style.cssText = 'color:#4e4e57;line-height:1.5;margin-top:6px';
  note.textContent = `records in real time (${mmss(opts.end)}) — keep this tab in front`;
  el.append(note);

  let session = null;
  button.onclick = async () => {
    if (session) return session.stop();

    button.disabled = true;
    try {
      session = record({
        ...opts,
        onProgress: (t, end) => {
          button.textContent = `recording ${mmss(t)} / ${mmss(end)} · click to stop`;
          button.disabled = false;
        },
      });
    } catch (e) {
      button.textContent = `can't record: ${e.message}`;
      button.disabled = false;
      return;
    }

    const { blob, name } = await session.file;
    session = null;
    button.textContent = idle;
    button.disabled = false;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    // Long enough for the download to have taken the blob, and then let it go —
    // a 400MB Blob held by a stale URL is the whole recording still in memory.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    note.textContent = `saved ${name} · ${(blob.size / 1e6).toFixed(0)} MB`;
  };

  return button;
}
