"""
tails.py — cut the tail out of every cat and lay it flat.

    .venv/bin/python tails.py

Reads the label maps segment.py already wrote (out/parts, label 8 is "tail")
and the mattes beside them (out/cutout), and writes out/tails/*.png: one tail
per cat, rotated so it runs left-to-right with its thick end at the left, and
out/tails.json describing what survived. This is a pipeline stage in the same
sense as segment.py's second pass, which reads out/alpha — it is not a
downstream consumer of out/, and nothing here is a source of truth.

The filter is the interesting part, and it is in two halves because one is not
enough. The numbers below cut wisps, stubs and blobs: a tail is long, thin and
big enough to see. What the numbers cannot do is tell a tail from a piece of
furniture that happens to be long and thin, so the ones that score well and are
not tails are named in REJECT, with the reason. Anything dropped is dropped
loudly. If you change a threshold, re-check REJECT by eye — it is a list of
answers to a question the numbers were asked, and the question moves.
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).parent
OUT = ROOT / "out"
TAIL = 8  # label index of "tail" in segment.py's PARTS

MIN_ELONG = 3.1  # length / width of the blob, along its own axis
MIN_AREA = 1500  # pixels, after keeping only the largest piece
MAX_WIDTH = 512  # the page loads these; full-resolution fur is wasted there

# Scores well, is not a tail. Checked by eye on the contact sheet.
REJECT = {
    "cat_09": "brown furniture with ring markings, not a cat",
    "cat_04": "a fold of blue fabric",
    "cat_40": "a real tail, but broken into disconnected chunks",
}


def largest_blob(mask):
    """The tail label speckles; keep only its biggest connected piece."""
    cc, n = ndimage.label(mask)
    if n == 0:
        return None
    sizes = ndimage.sum(mask, cc, range(1, n + 1))
    return cc == (int(np.argmax(sizes)) + 1)


def measure(mask):
    """Area, elongation and axis angle from the blob's second moments.

    Second moments rather than the bounding box: a tail lying diagonally fills
    a near-square box, and would read as a blob to anything simpler.
    """
    ys, xs = np.nonzero(mask)
    cov = np.cov(np.vstack([xs - xs.mean(), ys - ys.mean()]))
    vals, vecs = np.linalg.eigh(cov)
    long_axis = vecs[:, int(np.argmax(vals))]
    elong = math.sqrt(max(vals) / max(min(vals), 1e-6))
    return int(mask.sum()), elong, math.degrees(math.atan2(long_axis[1], long_axis[0]))


def trim(img):
    """Crop to what is actually opaque."""
    a = np.array(img)[..., 3] > 8
    if not a.any():
        return None
    ys, xs = np.nonzero(a)
    return img.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def flatten(src, angle):
    """The tail, rotated level, thick end first, trimmed and scaled down."""
    img = trim(src.rotate(angle, resample=Image.BICUBIC, expand=True))
    if img is None:
        return None

    # Root or tip first? The root is the thick end. Put it at the left so the
    # page can chain these head-to-tail without knowing which way round it is.
    cols = (np.array(img)[..., 3] > 8).sum(axis=0)
    third = max(1, len(cols) // 3)
    if cols[:third].mean() < cols[-third:].mean():
        img = img.transpose(Image.FLIP_LEFT_RIGHT)

    if img.width > MAX_WIDTH:
        img = img.resize((MAX_WIDTH, max(1, round(img.height * MAX_WIDTH / img.width))), Image.LANCZOS)
    return img


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--min-elong", type=float, default=MIN_ELONG)
    ap.add_argument("--min-area", type=int, default=MIN_AREA)
    args = ap.parse_args()

    (OUT / "tails").mkdir(parents=True, exist_ok=True)
    kept, dropped = [], []

    for path in sorted((OUT / "parts").glob("*.png")):
        stem = path.stem
        mask = largest_blob(np.array(Image.open(path)) == TAIL)
        if mask is None or mask.sum() < args.min_area:
            continue  # no tail label worth measuring; silent, it is most of them
        area, elong, angle = measure(mask)

        if elong < args.min_elong:
            dropped.append((stem, f"elongation {elong:.1f} — a blob, not a tail"))
            continue
        if stem in REJECT:
            dropped.append((stem, REJECT[stem]))
            continue

        # Mask the cutout to the tail alone, then lay it flat.
        rgba = np.array(Image.open(OUT / "cutout" / f"{stem}.png").convert("RGBA"))
        rgba[..., 3] = np.where(mask, rgba[..., 3], 0)
        img = flatten(Image.fromarray(rgba), angle)
        if img is None:
            dropped.append((stem, "nothing opaque left after masking"))
            continue

        img.save(OUT / "tails" / f"{stem}.png")
        kept.append(dict(id=stem, file=f"{stem}.png", area=area,
                         elong=round(elong, 2), w=img.width, h=img.height))

    (OUT / "tails.json").write_text(json.dumps({"tails": kept}, indent=1) + "\n")
    for stem, why in dropped:
        print(f"dropped {stem} — {why}")
    print(f"\nkept {len(kept)} tails → out/tails/  ({', '.join(t['id'] for t in kept)})")


if __name__ == "__main__":
    main()
