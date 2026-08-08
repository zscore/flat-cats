#!/usr/bin/env python3
"""Beat grid for a track -- timestamps, not a single BPM.

    .venv-tempo/bin/python tempo.py blackwood_17_notes_trimmed.wav

Needs its own venv; see "Beat tracking" in the README. madmom is pinned to an
old numpy and an old Python, so it cannot live in .venv beside torch.

Writes out/tempo_beats.csv (beat, time, interval, instantaneous BPM),
out/tempo_beats.txt (bare seconds, one per line) and out/tempo_click.wav -- the
grid ticked over the music, which is the only honest way to judge it. A diff of
numbers will not tell you whether the beats are on the beat.

Why madmom rather than autocorrelation plus a dynamic-programming tracker: a
hand-rolled one was built first and measured against tools/onsets.mjs, and it
put 43.2% of its beats within 50 ms of a detected onset against madmom's 46.3%.
Close, but madmom wins and needs no tuning. Both are near the ceiling for this
material -- see the notes at the bottom of the README section.

Time convention matches tools/onsets.mjs: every timestamp is the centre of its
analysis window. Getting this wrong biases the whole grid early by N_FFT/2.
"""

import argparse
import pathlib

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly

MADMOM_SR = 44100      # what the trained model expects
FPS = 100              # madmom activation frame rate
MIN_BPM, MAX_BPM = 120, 280
CLICK_HZ, CLICK_MS, CLICK_DECAY = 1600.0, 25.0, 220.0
MUSIC_GAIN, CLICK_GAIN = 0.45, 0.4


def read_mono(path):
    """Wav to float mono, via scipy rather than the stdlib `wave` module --
    these files are WAVE_FORMAT_EXTENSIBLE, which wave cannot read before 3.12,
    and this runs on 3.10. scipy hands 24-bit back as int32, left-justified."""
    sr, d = wavfile.read(path)
    if d.dtype.kind == "i":
        d = d.astype(np.float64) / float(1 << (8 * d.dtype.itemsize - 1))
    elif d.dtype == np.uint8:
        d = (d.astype(np.float64) - 128.0) / 128.0
    else:
        d = d.astype(np.float64)
    return (d.mean(axis=1) if d.ndim > 1 else d), sr


def track(x, sr):
    """RNN beat activations -> DBN grid. Imported late so --help stays instant."""
    from madmom.features.beats import (DBNBeatTrackingProcessor,
                                       RNNBeatProcessor)

    y = resample_poly(x, MADMOM_SR, sr) if sr != MADMOM_SR else x
    peak = np.abs(y).max()
    y = (y / peak * 0.95) if peak > 0 else y

    act = RNNBeatProcessor()(y.astype(np.float32))
    beats = DBNBeatTrackingProcessor(min_bpm=MIN_BPM, max_bpm=MAX_BPM, fps=FPS)(act)
    return np.asarray(beats), np.asarray(act)


def write_click(x, sr, beats, path):
    t = np.arange(int(sr * CLICK_MS / 1000)) / sr
    click = np.sin(2 * np.pi * CLICK_HZ * t) * np.exp(-t * CLICK_DECAY)
    mix = x * MUSIC_GAIN
    for b in beats:
        s = int(b * sr)
        n = min(len(click), len(mix) - s)
        if s >= 0 and n > 0:
            mix[s:s + n] += click[:n] * CLICK_GAIN
    wavfile.write(path, sr, (np.clip(mix, -1, 1) * 32767).astype(np.int16))


def write_times(beats, csv_path, txt_path):
    ibi = np.diff(beats)
    with open(csv_path, "w") as f:
        f.write("beat,time_s,ibi_s,inst_bpm\n")
        for i, b in enumerate(beats):
            tail = f"{ibi[i]:.4f},{60 / ibi[i]:.2f}" if i < len(ibi) else ","
            f.write(f"{i},{b:.4f},{tail}\n")
    txt_path.write_text("\n".join(f"{b:.3f}" for b in beats) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("wav")
    ap.add_argument("--out", default="out")
    a = ap.parse_args()

    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    x, sr = read_mono(a.wav)
    print(f"{a.wav}: {len(x) / sr:.1f}s @ {sr} Hz")

    beats, act = track(x, sr)
    if len(beats) < 2:
        raise SystemExit("no beats found")
    ibi = np.diff(beats)
    inst = 60 / ibi

    write_times(beats, out / "tempo_beats.csv", out / "tempo_beats.txt")
    write_click(x, sr, beats, out / "tempo_click.wav")

    print(f"{len(beats)} beats, {beats[0]:.3f}s .. {beats[-1]:.3f}s")
    print(f"mean {60 / ibi.mean():.2f} BPM, median {60 / np.median(ibi):.2f}, "
          f"sd {inst.std():.2f}, range {inst.min():.1f}..{inst.max():.1f}")
    print(f"beat confidence: mean activation {act.mean():.3f}, "
          f"{(act > 0.5).mean() * 100:.1f}% of frames above 0.5")
    if (act > 0.5).mean() < 0.001:
        print("  ^ the model never gets confident here; treat the grid as a "
              "best guess, not a beat")
    for p in ("tempo_beats.csv", "tempo_beats.txt", "tempo_click.wav"):
        print(f"  {out / p}")


if __name__ == "__main__":
    main()
