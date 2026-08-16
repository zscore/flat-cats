# flat-cats

A small corpus of freely-licensed cat photographs, segmented two ways: the cat
cut out from its background, and the cat divided into body parts.

## Licensing

80 images, **every one CC0 1.0 or public domain**, sourced from Wikimedia
Commons. No attribution required, no share-alike, commercial use fine, derivative
works fine. `download.py` restricts its search to the CC-Zero and PD-self
categories *and then re-checks each file's own licence metadata* before keeping
it, so the search filter is never the only safeguard.

Per-file provenance is in [CREDITS.md](CREDITS.md) and `images/credits.json`.

The 6 files in `sounds/` are CC0 or public domain on the same terms, listed in
[SOUNDS.md](SOUNDS.md). The meow pool `fetch-meows.mjs` builds is CC0-only and
licence-checked twice, but it is 100 MB and stays out of the repo — rebuild it
rather than looking for it here.

### The score, and the audio

**Neither the MIDI nor any rendered audio is in this repo, and that is
deliberate** — `.gitignore` excludes `/*.mid`, `/*.wav`, `/*.mp3` and
`public/song/`. Unlike `images/` and `sounds/`, nothing here has established
what may be done with them, so they are local inputs only.

The piece is built on Easley Blackwood's Etude in 17 notes, from *Twelve
Microtonal Etudes for Electronic Music Media*, Op. 28 (1979–80). To run the
audio side you supply the score yourself, as `Blackwood17notes.mid` at the
root:

<https://www.musanim.com/BlackwoodMicrotonalEtudes/>

That page is Stephen Malinowski's Music Animation Machine visualisation of the
etudes; the MIDI files on it were made by Matthew Sheeran. **The page states no
licence or terms of use**, and says nothing about permission from Blackwood or
his publisher. The composition itself is in copyright. Two separate rights
therefore sit on that file — Blackwood's in the work, Sheeran's in the
transcription — and neither has been cleared here. Anything you render from it
is a derivative of both; publishing such a render is a decision you are making
for yourself.

In `Blackwood17notes.mid` a note number is a 17-EDO degree, not a semitone;
`tools/midi.mjs` reads it on that basis.

## Setup

```sh
python3.13 -m venv .venv
.venv/bin/pip install pillow numpy scipy rembg onnxruntime torch transformers
```

`tempo.py` needs a second, older environment of its own — see
[Beat tracking](#beat-tracking).

## Running it

```sh
python download.py                     # -> images/ + CREDITS.md
python segment.py                      # both stages, all images
python segment.py --stage fg           # foreground only
python segment.py --stage parts --only cat_04 cat_21
python sheet.py out/overlay out/20_parts.png --cols 8 --cell 200

.venv-tempo/bin/python tempo.py blackwood_17_notes_trimmed.wav   # -> beat grid
```

Model weights (~200 MB) download on first run and cache in `~/.u2net` and the
Hugging Face cache. Full run is roughly 6 minutes on an M1 Pro, CPU only.

## Two views, and getting a file out

`song.html` plays the piece. It has one composition, 16:9, and portrait does not
lay it out again — it paints that same picture into a 9:16 canvas turned a
quarter turn clockwise and stands the cats back up one at a time. Every burst
still receives a wide `W, H`, so the river's camera and the spiral's radius are
the numbers they always were.

The cats that get stood back up are the ones drawn plumb. The five that set their
own angle — the tail's fan, the moon's chain and rings, the spiral, the river —
keep it, because there the angle *is* the gesture. The moon therefore ends up low
in the tall frame and on its back, with the hollow opening upward and the fan
growing out of it, which is what the clockwise turn is chosen for.

| URL | What |
|---|---|
| `song.html` | the wide view, taking the shape of the window |
| `song.html?orient=portrait` | the tall view, 1080×1920 whatever the window is |
| `?size=1920x1080` | pins the wide view too |
| `?size=fit` | lets either one take the window again |
| `?t=25.56` | opens paused on that second |

The tall view is pinned because a canvas that takes the size of the window is a
picture whose proportions are decided by whoever last dragged a corner. The wide
view is *not* pinned by default, because that is where you resize until `dropped`
climbs in the hud and find the aspect the burst clearance stops working at.

**save video** in the panel records the whole piece — picture and sound — in real
time, off the same rAF loop and AudioContext you are watching and hearing. Chrome
hands back H.264/AAC MP4 at the canvas's own size, so a tall recording is
1080×1920 wherever it was made. It takes as long as the piece does and the tab has
to stay in front; backgrounded, rAF throttles and the video goes with it. What
lands in the file is what the page actually did, dropped frames included — which
is the point, and the reason this records rather than renders offline.

For one frame rather than the whole thing:

```sh
node tools/shoot.mjs 25.56                 # -> out/shot_25.56_landscape.png
node tools/shoot.mjs 25.56 portrait        # 1080×1920
node tools/shoot.mjs 25.56 portrait 567    # with a line down the frame at x=567
node tools/frame-check.mjs                 # the turn's arithmetic -> out/frame.html
```

25.56s is the instant the burst cat's lean is exactly zero, which is the honest
moment to judge its alignment at — anywhere else the hip pivot has swung the top
of the cat sideways and it reads as a placement error that is not there.

## How it works

**Stage 1 — foreground.** `rembg` with the `isnet-general-use` model produces a
soft alpha matte per image. Islands smaller than 10% of the largest are dropped,
which clears matting speckle while leaving genuinely separate cats intact.

**Stage 2 — parts.** CLIPSeg (`CIDAS/clipseg-rd64-refined`) is prompted with one
phrase per body part and the resulting heatmaps are argmax'd into a label map.
It runs *twice*:

1. on a crop of the cat — head, ear, torso, leg, paw, tail;
2. zoomed on whatever pass 1 called the head — eye, muzzle, ear.

The second pass is the reason eyes and noses appear at all. CLIPSeg works at
352×352, so an eye in a full frame is a handful of pixels and never wins an
argmax; cropping to the head gives it something to see. Everything is clipped to
stage 1's matte, so no part can bleed into the background, and "ear" is
geometrically restricted to near the head — otherwise any small bright triangle
in frame (a leaf, a toy) wins it.

The `bias` column in `COARSE`/`FINE` scales each heatmap before the argmax.
CLIPSeg's confidence tracks how much of the frame a concept fills, so small parts
need a nudge and large ones need holding back. Those numbers were tuned by
looking at contact sheets, not by optimising against ground truth — there isn't
any.

## Outputs

| Path | What |
|---|---|
| `out/alpha/*.png` | 8-bit foreground matte, white = cat |
| `out/cutout/*.png` | RGBA cat on transparency |
| `out/parts/*.png` | indexed PNG, one palette index per part |
| `out/overlay/*.png` | parts tinted over the photo, for reading by eye |
| `out/report.json` | coverage, per-part pixel shares, QA flags |
| `out/10_cutouts.png`, `out/20_parts.png` | contact sheets |
| `out/tempo_beats.csv` | beat, time, interval, instantaneous BPM |
| `out/tempo_beats.txt` | bare beat times in seconds, one per line |
| `out/tempo_click.wav` | the grid ticked over the music, for judging by ear |

Part label indices in `out/parts/*.png`:

| 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| background | head | ear | eye | muzzle | torso | leg | paw | tail |

```python
import numpy as np; from PIL import Image
lab = np.array(Image.open("out/parts/cat_21.png"))   # H×W uint8 of indices
head = lab == 1
```

`out/` is derived and gitignored — regenerate it, don't commit it.

## Beat tracking

`tempo.py` turns a track into a list of beat timestamps. It uses
[madmom](https://github.com/CPJKU/madmom): a small recurrent net scores every
10 ms frame for how beat-like it is, and a dynamic Bayesian network walks that
activation to pick the grid, which lets tempo drift instead of forcing one BPM
on the whole track.

madmom is old. It pins `numpy<2` and will not import on Python 3.12+, so it
cannot share `.venv` with torch and gets its own:

```sh
python3.10 -m venv .venv-tempo
.venv-tempo/bin/pip install -r requirements-tempo.txt
.venv-tempo/bin/pip install --no-build-isolation \
    'madmom @ git+https://github.com/CPJKU/madmom.git@27f032e'
```

Two steps because madmom has no wheel here and compiles against numpy and
Cython, which therefore have to exist first. The PyPI release predates 3.10 and
does not build at all.

**`blackwood_17_notes_trimmed.wav` has no steady tempo, and this is measured
rather than felt.** Every fixed tempo from 40 to 320 BPM was scored against the
onsets in `out/onsets.json`, taking the best phase for each; the best of them
lands about 1.4× chance, which is to say a metronome cannot track this piece for
more than about thirty seconds. Accumulated slip against a perfect 172.5 BPM
click is −10.3 beats: ahead by one around 70 s, ten behind by the end.

The grid madmom returns averages ~179 BPM, and 46.3% of its beats fall within
50 ms of a detected onset (chance is ~30%). A hand-rolled autocorrelation and
dynamic-programming tracker was built first and reached 43.2% — close enough
that the deciding factor was madmom needing no tuning, not accuracy.

So do not build anything downstream that assumes the beats are right. The
honest signal is in the script's own output: **madmom's activation never once
exceeds 0.5 across the whole track**, meaning a model trained on a large music
corpus never finds a beat it is confident about. `tempo.py` prints a warning
when that happens. Onsets from `tools/onsets.mjs` are the more trustworthy
timing source, and every timestamp in both tools is the centre of its analysis
window — mixing that convention up biases a whole grid early by half a window.

## Known limitations

These are measured, not guessed. `segment.py` writes a `suspect` block into
`out/report.json` naming the images it thinks it got wrong; 13 of 80 are flagged.

- **Matting failures (4):** `cat_00` and `cat_12` are near-empty — a pile of
  sleeping kittens and a close-up of paws, neither of which reads as a subject.
  `cat_02` keeps the background wall. `cat_35` keeps the motorcycle the cat sits on.
- **One cat assumed.** The head crop is a single bounding box, so in two-cat
  frames (`cat_31`) only one cat gets facial parts; the other stays torso.
- **Part boundaries are soft.** CLIPSeg is a zero-shot text-prompted model, not a
  part-segmentation model trained on cat anatomy. Head/torso/leg/tail are
  reliable on clear side-on and front-on shots; the leg/paw boundary is
  arbitrary, and eye/muzzle need a head large enough to crop.
- **Dark cats are hardest.** `cat_23` and `cat_29` are black cats where the
  face has almost no internal contrast, and the head region collapses.

If accurate parts matter more than zero-shot convenience, the upgrade path is
SAM for boundaries plus these prompts only for naming the regions, or fine-tuning
on PASCAL-Part's cat annotations.
