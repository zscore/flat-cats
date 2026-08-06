# flat-cats

A small corpus of freely-licensed cat photographs, segmented two ways: the cat
cut out from its background, and the cat divided into body parts.

## Licensing

40 images, **every one CC0 1.0 or public domain**, sourced from Wikimedia
Commons. No attribution required, no share-alike, commercial use fine, derivative
works fine. `download.py` restricts its search to the CC-Zero and PD-self
categories *and then re-checks each file's own licence metadata* before keeping
it, so the search filter is never the only safeguard.

Per-file provenance is in [CREDITS.md](CREDITS.md) and `images/credits.json`.

## Setup

```sh
python3.13 -m venv .venv
.venv/bin/pip install pillow numpy scipy rembg onnxruntime torch transformers
```

## Running it

```sh
python download.py                     # -> images/ + CREDITS.md
python segment.py                      # both stages, all images
python segment.py --stage fg           # foreground only
python segment.py --stage parts --only cat_04 cat_21
python sheet.py out/overlay out/20_parts.png --cols 8 --cell 200
```

Model weights (~200 MB) download on first run and cache in `~/.u2net` and the
Hugging Face cache. Full run is roughly 6 minutes on an M1 Pro, CPU only.

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

## Known limitations

These are measured, not guessed. `segment.py` writes a `suspect` block into
`out/report.json` naming the images it thinks it got wrong; 8 of 40 are flagged.

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
