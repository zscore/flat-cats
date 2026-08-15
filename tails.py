"""
tails.py — cut the tail out of every cat and lay it flat.

    .venv/bin/python tails.py

Reads the label maps segment.py already wrote (out/parts, label 8 is "tail")
and the mattes beside them (out/cutout), and writes two things per cat plus
out/tails.json describing what survived:

    out/tails/*.png     the tail alone, rotated so it runs left-to-right with
                        its thick end at the left
    out/bodies/*.png    the same cat with that tail taken off

The body is the half the tail burst needs. It hosts the fan, and until it had
one it hosted the fan while still wearing the tail it was photographed with —
a real tail lying under nine drawn ones, at a fixed angle, arguing with them.
It keeps the cutout's canvas rather than being cropped to what is left, because
`root` below is in fractions of that canvas and the page hangs the fan off it.

This is a pipeline stage in the same sense as segment.py's second pass, which
reads out/alpha — it is not a downstream consumer of out/, and nothing here is
a source of truth.

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
# Pixels of tail erased past the label when cutting the body. The label stops
# on the tail's own edge, and stopping there leaves a rim of tail fur behind on
# the body — a thin outline of the thing that was supposed to be gone.
BLEED = 2

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


def measure(mask, body):
    """Area, elongation, axis angle, and where the tail joins the cat.

    Second moments rather than the bounding box: a tail lying diagonally fills
    a near-square box, and would read as a blob to anything simpler.

    `root` is the join, in fractions of the image, and `heading` is the
    direction it leaves in, in degrees with y pointing down. Those two are what
    let the page hang something off the cat's own tail instead of off a point
    picked by hand that is only right for one cat. `body` is the centroid of
    the cat minus its tail, which is how the join is told from the tip.
    """
    ys, xs = np.nonzero(mask)
    cx, cy = xs.mean(), ys.mean()
    cov = np.cov(np.vstack([xs - cx, ys - cy]))
    vals, vecs = np.linalg.eigh(cov)
    long_axis = vecs[:, int(np.argmax(vals))]
    elong = math.sqrt(max(vals) / max(min(vals), 1e-6))

    # Where the tail leaves the cat, and which way it goes. Project onto the
    # long axis and ask which end is nearer the rest of the cat — that end is
    # the join, by definition. Thickness is the tempting test and it is wrong
    # about one tail in seven: a bushy tip measures fatter than the root.
    along = (xs - cx) * long_axis[0] + (ys - cy) * long_axis[1]
    band = 0.25 * (along.max() - along.min())
    low, high = along < along.min() + band, along > along.max() - band
    bx, by = body
    root_is_low = (
        math.dist((xs[low].mean(), ys[low].mean()), (bx, by))
        <= math.dist((xs[high].mean(), ys[high].mean()), (bx, by))
    )

    end = low if root_is_low else high
    root = (float(xs[end].mean()), float(ys[end].mean()))
    heading = long_axis if root_is_low else -long_axis
    h, w = mask.shape
    return dict(
        area=int(mask.sum()),
        elong=elong,
        angle=math.degrees(math.atan2(long_axis[1], long_axis[0])),
        root=[round(root[0] / w, 4), round(root[1] / h, 4)],
        heading=round(math.degrees(math.atan2(heading[1], heading[0])), 1),
    )


def debone(rgba, mask):
    """The cat, less its tail, on the cutout's own canvas.

    Two things beyond erasing the label. BLEED, because the label stops on the
    tail's own edge and stopping there leaves a rim of tail fur behind — a thin
    outline of the thing that was supposed to be gone. And the largest piece,
    because taking the tail out can strand crumbs of matte that were only
    attached to the cat through it, and they read as dirt floating beside it.
    """
    out = rgba.copy()
    out[..., 3] = np.where(ndimage.binary_dilation(mask, iterations=BLEED), 0, out[..., 3])
    body = largest_blob(out[..., 3] > 8)
    if body is None:
        return None
    out[..., 3] = np.where(body, out[..., 3], 0)
    return Image.fromarray(out)


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
    (OUT / "bodies").mkdir(parents=True, exist_ok=True)
    kept, dropped = [], []

    for path in sorted((OUT / "parts").glob("*.png")):
        stem = path.stem
        labels = np.array(Image.open(path))
        mask = largest_blob(labels == TAIL)
        if mask is None or mask.sum() < args.min_area:
            continue  # no tail label worth measuring; silent, it is most of them

        rest = (labels > 0) & ~mask  # the cat minus its tail
        if not rest.any():
            dropped.append((stem, "labelled all tail and no cat"))
            continue
        ry, rx = np.nonzero(rest)
        m = measure(mask, (rx.mean(), ry.mean()))

        if m["elong"] < args.min_elong:
            dropped.append((stem, f"elongation {m['elong']:.1f} — a blob, not a tail"))
            continue
        if stem in REJECT:
            dropped.append((stem, REJECT[stem]))
            continue

        # Mask the cutout to the tail alone, then lay it flat.
        rgba = np.array(Image.open(OUT / "cutout" / f"{stem}.png").convert("RGBA"))
        img = flatten(Image.fromarray(np.dstack([rgba[..., :3], np.where(mask, rgba[..., 3], 0)])),
                      m["angle"])
        if img is None:
            dropped.append((stem, "nothing opaque left after masking"))
            continue

        # And the same cut the other way round.
        body = debone(rgba, mask)
        if body is None:
            dropped.append((stem, "nothing left of the cat once its tail came off"))
            continue
        body.save(OUT / "bodies" / f"{stem}.png")

        img.save(OUT / "tails" / f"{stem}.png")
        kept.append(dict(id=stem, file=f"{stem}.png", body=f"{stem}.png", area=m["area"],
                         elong=round(m["elong"], 2), root=m["root"], heading=m["heading"],
                         w=img.width, h=img.height))

    (OUT / "tails.json").write_text(json.dumps({"tails": kept}, indent=1) + "\n")
    for stem, why in dropped:
        print(f"dropped {stem} — {why}")
    print(f"\nkept {len(kept)} tails → out/tails/, {len(kept)} bodies → out/bodies/"
          f"  ({', '.join(t['id'] for t in kept)})")


if __name__ == "__main__":
    main()
