# flat-cats

A small, freely-redistributable dataset of cat photos, and the tooling that
segments each cat into figure and body parts.

Every image in `images/` is CC0 1.0 or public domain — usable, modifiable and
redistributable for any purpose, with no attribution required. Credits are
recorded anyway, in `images/credits.json` and [CREDITS.md](CREDITS.md).

## Layout

| Path | What |
|---|---|
| `download.py` | Fetches CC0/PD cat photos from Wikimedia Commons into `images/`. |
| `segment.py` | Figure/ground matte, then body parts within the figure. Writes `out/`. |
| `sheet.py` | Contact sheet of a directory of images, so a set can be judged by eye. |
| `images/` | The dataset, plus `credits.json`. |
| `out/` | Everything derived. Not committed — regenerate it. |

## Setup

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Use

```sh
.venv/bin/python download.py                    # (re)build images/ and the credits
.venv/bin/python segment.py                     # everything in images/
.venv/bin/python segment.py --only cat_00 cat_07
.venv/bin/python segment.py --stage fg          # foreground matte only
.venv/bin/python sheet.py images out/contact.png --cols 8 --glob '*.jpg'
```

## How the segmentation works

Stage 1, **foreground** — rembg / ISNet produces a soft alpha matte per image.
Writes `out/alpha` (8-bit matte) and `out/cutout` (RGBA).

Stage 2, **parts** — CLIPSeg is prompted with one phrase per body part. It runs
twice: once on a crop of the cat (head, ear, torso, leg, paw, tail) and again,
zoomed, on a crop of whatever the first pass called the head (eye, muzzle).
Zooming matters — CLIPSeg works at 352px, so an eye in a full frame is a handful
of pixels and never wins an argmax. Every part is clipped to stage 1's matte, so
nothing bleeds into the background. Writes `out/parts` (indexed label PNG),
`out/overlay` (human-readable colouring) and `out/report.json` (coverage and
per-part area fractions).

Licence checking is deliberately belt-and-braces: the Commons search is
restricted to the CC-Zero and PD-self categories, *and* each candidate's own
licence metadata is re-checked before the file is kept. The search filter is
never the only thing standing between the dataset and a share-alike image.
