#!/usr/bin/env python3
"""Segment the cats: figure from ground, then body parts within the figure.

Stage 1  foreground  -- rembg / ISNet produces a soft alpha matte per image.
                        Writes out/alpha (8-bit matte) and out/cutout (RGBA).
Stage 2  parts       -- CLIPSeg is prompted with one phrase per body part. It
                        runs twice: once on a crop of the cat (head/ear/torso/
                        leg/paw/tail) and again, zoomed, on a crop of whatever
                        the first pass called the head (eye/muzzle). Zooming
                        matters -- CLIPSeg works at 352px, so an eye in a full
                        frame is a handful of pixels and never wins an argmax.
                        Everything is clipped to stage 1's matte so no part can
                        bleed into the background. Writes out/parts (indexed
                        label PNG) and out/overlay (human-readable colouring).

    python segment.py                 # everything in images/
    python segment.py --only cat_00 cat_07
    python segment.py --stage fg      # foreground only
"""

import argparse
import json
import pathlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).parent
IMG_DIR = ROOT / "images"
OUT = ROOT / "out"
WORK = 1024          # long side we segment at

# Label 0 is background; the rest are the classes in out/parts/*.png.
# Colours are for the overlay only.
PARTS = [
    ("background", (0, 0, 0)),
    ("head",       (233, 82, 92)),
    ("ear",        (247, 168, 61)),
    ("eye",        (255, 232, 92)),
    ("muzzle",     (163, 232, 128)),
    ("torso",      (74, 168, 232)),
    ("leg",        (168, 126, 232)),
    ("paw",        (240, 130, 214)),
    ("tail",       (110, 224, 214)),
]
NAMES = [p[0] for p in PARTS]
COLORS = np.array([p[1] for p in PARTS], dtype=np.uint8)
IDX = {n: i for i, n in enumerate(NAMES)}

# Pass 1, on a crop of the whole cat. `bias` scales the heatmap before the
# argmax: CLIPSeg's confidence tracks how much of the frame a concept fills, so
# small parts need a nudge and big ones need holding back.
COARSE = [
    ("head",  "the head and face of the cat",                        1.00),
    ("ear",   "the pointed triangular ears on top of the cat's head", 1.20),
    ("torso", "the torso of the cat, its back, chest and belly",      0.95),
    ("leg",   "the four legs of the cat",                             1.15),
    ("paw",   "the paws and toes at the very ends of the cat's legs", 1.05),
    ("tail",  "the long thin tail of the cat",                        1.10),
]

# Pass 2, on a crop of the head found by pass 1. "head" here is the null class:
# cheek and forehead fur that should stay labelled head.
FINE = [
    ("eye",    "the eyes of the cat, the eyeballs and pupils",  1.10),
    ("muzzle", "the nose, snout and mouth of the cat",          1.25),
    ("ear",    "the pointed ears of the cat",                   1.00),
    ("head",   "the furry cheeks, forehead and skull of the cat", 1.00),
]


def load(path):
    im = Image.open(path).convert("RGB")
    if max(im.size) > WORK:
        s = WORK / max(im.size)
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    return im


# ---------------------------------------------------------------- stage 1

def despeckle(alpha, keep=0.10):
    """Drop islands smaller than `keep` of the biggest one -- matting noise and
    stray bits of scenery. Genuinely separate cats survive; dust doesn't."""
    from scipy import ndimage
    lab, n = ndimage.label(alpha > 128)
    if n <= 1:
        return alpha
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    good = {i + 1 for i, s in enumerate(sizes) if s >= sizes.max() * keep}
    return np.where(np.isin(lab, list(good)), alpha, 0).astype(np.uint8)


def foreground(images, session=None):
    from rembg import new_session, remove
    session = session or new_session("isnet-general-use")
    (OUT / "alpha").mkdir(parents=True, exist_ok=True)
    (OUT / "cutout").mkdir(parents=True, exist_ok=True)

    stats = {}
    for path in images:
        im = load(path)
        cut = remove(im, session=session, post_process_mask=True)
        alpha = despeckle(np.asarray(cut.getchannel("A")))
        Image.fromarray(alpha).save(OUT / "alpha" / f"{path.stem}.png")
        rgba = np.dstack([np.asarray(im), alpha])
        Image.fromarray(rgba, "RGBA").save(OUT / "cutout" / f"{path.stem}.png")
        cov = float(alpha.mean() / 255)
        stats[path.stem] = round(cov, 4)
        print(f"  fg  {path.stem}  cat covers {cov * 100:5.1f}% of frame")
    return stats


# ---------------------------------------------------------------- stage 2

def bbox(mask, pad=0.06):
    """Tight box round a boolean mask, padded, clipped to the image."""
    ys, xs = np.where(mask)
    if not len(ys):
        return None
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    py, px = int((y1 - y0) * pad) + 2, int((x1 - x0) * pad) + 2
    return (max(0, x0 - px), max(0, y0 - py),
            min(mask.shape[1], x1 + px + 1), min(mask.shape[0], y1 + py + 1))


def heatmaps(model, proc, crop, spec):
    """Run CLIPSeg once per prompt and return biased maps at crop resolution."""
    import torch
    with torch.no_grad():
        enc = proc(text=[s[1] for s in spec], images=[crop] * len(spec),
                   padding=True, return_tensors="pt")
        logits = model(**enc).logits                        # (n, 352, 352)
        if logits.ndim == 2:                                # single prompt
            logits = logits[None]
        heat = torch.nn.functional.interpolate(
            torch.sigmoid(logits)[None], size=(crop.height, crop.width),
            mode="bilinear", align_corners=False)[0]
    return heat.numpy() * np.array([s[2] for s in spec])[:, None, None]


def parts(images, thresh=0.5):
    from transformers import CLIPSegForImageSegmentation, CLIPSegProcessor

    proc = CLIPSegProcessor.from_pretrained("CIDAS/clipseg-rd64-refined")
    model = CLIPSegForImageSegmentation.from_pretrained(
        "CIDAS/clipseg-rd64-refined").eval()

    (OUT / "parts").mkdir(parents=True, exist_ok=True)
    (OUT / "overlay").mkdir(parents=True, exist_ok=True)

    stats = {}
    for path in images:
        im = load(path)
        alpha_p = OUT / "alpha" / f"{path.stem}.png"
        if not alpha_p.exists():
            print(f"  seg {path.stem}: no matte yet, run --stage fg first")
            continue
        alpha = np.asarray(Image.open(alpha_p).resize(im.size), np.uint8)
        inside = alpha > thresh * 255
        label = np.zeros(inside.shape, np.uint8)

        box = bbox(inside)
        if box is None:
            print(f"  seg {path.stem}: empty matte, skipped")
            continue

        # --- pass 1: whole cat, cropped so the cat fills CLIPSeg's field
        crop = im.crop(box)
        heat = heatmaps(model, proc, crop, COARSE)
        coarse = np.array([IDX[s[0]] for s in COARSE])[heat.argmax(0)]
        x0, y0, x1, y1 = box
        label[y0:y1, x0:x1] = coarse
        label[~inside] = 0

        # Ears are only ears near the head. Without this, any small bright thing
        # in frame (a leaf, a toy) reads as a pointed triangle and wins "ear".
        head = label == IDX["head"]
        hb = bbox(head, pad=0.45)
        if hb is not None:
            far = np.ones_like(head)
            far[hb[1]:hb[3], hb[0]:hb[2]] = False
            label[far & (label == IDX["ear"])] = IDX["torso"]

        # --- pass 2: zoom on the head for the features pass 1 can't resolve
        hbox = bbox(head, pad=0.12) if head.sum() > 0.01 * inside.sum() else None
        if hbox:
            hx0, hy0, hx1, hy1 = hbox
            hcrop = im.crop(hbox)
            if min(hcrop.size) < 160:                       # upsample tiny heads
                s = 160 / min(hcrop.size)
                hcrop = hcrop.resize((round(hcrop.width * s),
                                      round(hcrop.height * s)), Image.LANCZOS)
            fine = np.array([IDX[s[0]] for s in FINE])[
                heatmaps(model, proc, hcrop, FINE).argmax(0)]
            fine = np.asarray(Image.fromarray(fine.astype(np.uint8)).resize(
                (hx1 - hx0, hy1 - hy0), Image.NEAREST))
            # only overwrite pixels pass 1 already called head
            win = label[hy0:hy1, hx0:hx1]
            label[hy0:hy1, hx0:hx1] = np.where(win == IDX["head"], fine, win)

        out = Image.fromarray(label, mode="P")
        out.putpalette(list(COLORS.flatten()) + [0] * (768 - COLORS.size))
        out.save(OUT / "parts" / f"{path.stem}.png")

        base = np.asarray(im, np.float32)
        tint = COLORS[label].astype(np.float32)
        blend = np.where(inside[..., None], base * 0.45 + tint * 0.55, base * 0.28)
        Image.fromarray(blend.astype(np.uint8)).save(OUT / "overlay" / f"{path.stem}.png")

        px = label[inside]
        share = {NAMES[i]: round(float((px == i).mean()), 3)
                 for i in range(1, len(NAMES)) if (px == i).any()}
        stats[path.stem] = share
        top = sorted(share.items(), key=lambda kv: -kv[1])[:5]
        print(f"  seg {path.stem}  " + "  ".join(f"{k} {v:.0%}" for k, v in top))
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", choices=["fg", "parts", "all"], default="all")
    ap.add_argument("--only", nargs="*")
    a = ap.parse_args()

    images = sorted(IMG_DIR.glob("*.jpg"))
    if a.only:
        images = [p for p in images if p.stem in set(a.only)]
    print(f"{len(images)} images")

    report = {}
    if a.stage in ("fg", "all"):
        report["coverage"] = foreground(images)
    if a.stage in ("parts", "all"):
        report["parts"] = parts(images)

    p = OUT / "report.json"
    old = json.loads(p.read_text()) if p.exists() else {}
    old.update(report)
    p.write_text(json.dumps(old, indent=2))
    print(f"\nwrote {p}")


if __name__ == "__main__":
    main()
