"""
faces.py — take every cat's face apart: head, eyes, ears, muzzle.

    .venv/bin/python faces.py

Reads the label maps segment.py already wrote (out/parts: 1 head, 2 ear, 3 eye,
4 muzzle) and the mattes beside them (out/cutout), and writes out/faces/*.png —
one image per part — plus out/faces.json describing where each part sat. Same
kind of stage as tails.py: it reads out/ the way segment.py's second pass reads
out/alpha, and nothing here is a source of truth.

The difference from tails.py is the geometry. A tail is ribbon material and can
go anywhere, so tails.py throws its position away and lays the tail flat. A face
cannot: putting one cat's eyes on another cat's head only works if we know where
the eyes *were*. So every part keeps its original orientation and records its
centre and size as a fraction of the head box. Nothing is rotated to canonical.

Two things here were learned by looking rather than reasoned out, and both are
about not trusting the head label:

  - The head box is framed from the *eyes*, not from the head label. On cat_23
    and cat_24 most of the face is labelled torso, and a box grown from the head
    label cuts the face into fragments. The distance between the eyes is the one
    measurement on a cat's face that is always present and always means the same
    thing, so the frame is built from that and then widened to hold whatever
    else was found.
  - The head is cut against the *matte*, not against the labels. Masking to
    head+ear+eye+muzzle punches holes wherever the labels disagree — cat_24's
    forehead is labelled torso and came out missing. The matte has no such
    holes, and inside the head box it is the head.

The geometry is also the filter. Blob size alone cannot tell an eye from a
bright speck of fur, but an eye has neighbours: two eyes sit side by side and
level, ears sit above them, the muzzle below. A cat whose parts do not make that
arrangement did not have its face found, whatever the pixel counts say. Those
are dropped loudly, with the check that failed. REJECT is for the ones that pass
every check and are still wrong — checked by eye on the contact sheet.
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

HEAD, EAR, EYE, MUZZLE = 1, 2, 3, 4

MIN_HEAD = 8000     # px of head label; below this the face is a few pixels wide
MIN_PART = 0.002    # a part must be this fraction of the head to be believed
MIN_PART_PX = 120   # ...and this many pixels, for the small heads

# The head frame, in multiples of the distance between the eyes. More room below
# the eyes than above: that is where the muzzle and chin are.
FRAME = dict(w=1.30, up=1.35, down=1.65)
PAD = 0.05          # head box padding, as a fraction of the box
FEATHER = 0.03      # part edge softening, as a fraction of the part's size
MAX_HEAD_W = 700    # the page loads these; full-resolution fur is wasted there
MAX_PART_W = 400

# Passes every check, still wrong. Checked by eye on the contact sheet. Empty so
# far: the two faces that looked wrong on the first sheet, cat_23 and cat_24,
# turned out to be the head box's fault rather than the cat's.
REJECT = {}


def blobs(mask, min_px):
    """Connected pieces of `mask` at least `min_px` in size, biggest first."""
    cc, n = ndimage.label(mask)
    if n == 0:
        return []
    sizes = ndimage.sum(mask, cc, range(1, n + 1))
    keep = [(int(s), cc == i + 1) for i, s in enumerate(sizes) if s >= min_px]
    return [m for _, m in sorted(keep, key=lambda kv: -kv[0])]


def box_of(mask):
    """(x0, y0, x1, y1) of the mask, exclusive at the far edge."""
    ys, xs = np.nonzero(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def union(boxes):
    return (min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes))


def measure(mask):
    """A part in pixel coordinates: where it is, how big, which way it leans."""
    ys, xs = np.nonzero(mask)
    cov = np.cov(np.vstack([xs - xs.mean(), ys - ys.mean()]))
    vals, vecs = np.linalg.eigh(cov)
    axis = vecs[:, int(np.argmax(vals))]
    return dict(mask=mask, box=box_of(mask), area=int(mask.sum()),
                cx=float(xs.mean()), cy=float(ys.mean()),
                angle=math.degrees(math.atan2(axis[1], axis[0])))


def arrangement(eyes, ears, muzzle):
    """Do these parts make a face? Returns the failed check, or None.

    Every threshold is scaled by the distance between the eyes, so the same
    numbers hold for a head filling the frame and a head fifty pixels wide.
    Loose on purpose: this is not measuring how good a face is, only refusing
    arrangements that are not faces at all.
    """
    if len(eyes) != 2:
        return f"{len(eyes)} eyes, not 2"
    a, b = eyes
    dx, dy = abs(a["cx"] - b["cx"]), abs(a["cy"] - b["cy"])
    d = math.hypot(dx, dy)
    if d < 1:
        return "eyes on top of each other"
    if dx < 0.6 * d:
        return f"eyes lean {math.degrees(math.atan2(dy, dx)):.0f}° — stacked, not level"
    big, small = max(a["area"], b["area"]), min(a["area"], b["area"])
    if big > 6 * small:
        return f"eyes differ {big / small:.0f}x in area — the smaller is not an eye"

    eye_y = (a["cy"] + b["cy"]) / 2
    if ears and sum(e["cy"] for e in ears) / len(ears) > eye_y + 0.3 * d:
        return "ears below the eyes"
    if muzzle and muzzle["cy"] < eye_y - 0.3 * d:
        return "muzzle above the eyes"
    return None


def head_box(eyes, others, shape, alpha):
    """The head frame: built from the eyes, widened to hold the other parts."""
    a, b = eyes
    d = math.hypot(a["cx"] - b["cx"], a["cy"] - b["cy"])
    mx, my = (a["cx"] + b["cx"]) / 2, (a["cy"] + b["cy"]) / 2
    frame = (mx - FRAME["w"] * d, my - FRAME["up"] * d,
             mx + FRAME["w"] * d, my + FRAME["down"] * d)

    px, py = (frame[2] - frame[0]) * PAD, (frame[3] - frame[1]) * PAD
    # Trim the frame to the cat before the parts go in, not after. The other way
    # round the trim eats whatever the parts had just added, and an ear tip ends
    # up outside the box its own coordinates are measured against.
    cx0, cy0, cx1, cy1 = box_of(alpha > 8)
    h, w = shape
    box = union([(max(cx0, frame[0] - px), max(cy0, frame[1] - py),
                  min(cx1, frame[2] + px), min(cy1, frame[3] + py))]
                + [p["box"] for p in others])
    return (max(0, int(box[0])), max(0, int(box[1])),
            min(w, int(math.ceil(box[2]))), min(h, int(math.ceil(box[3]))))


def cut(rgba, mask, box, limit, feather):
    """The photo where `mask` is, softened at the edge, cropped to `box`."""
    x0, y0, x1, y1 = box
    patch = rgba[y0:y1, x0:x1].copy()
    a = mask[y0:y1, x0:x1].astype(np.float32)
    if feather:
        # Feathered rather than hard-cut: parts get composited onto a different
        # cat's head, and a hard edge reads as a sticker rather than an eye.
        sigma = max(0.6, feather * math.hypot(x1 - x0, y1 - y0))
        a = np.clip(ndimage.gaussian_filter(a, sigma) * 1.25, 0, 1)
    patch[..., 3] = (patch[..., 3] * a).astype(np.uint8)

    img = Image.fromarray(patch)
    if img.width > limit:
        img = img.resize((limit, max(1, round(img.height * limit / img.width))), Image.LANCZOS)
    return img


def place(p, head):
    """Where a part sits, as fractions of the head box.

    Two centres, because they answer different questions. (x, y) is the centre
    of the part's image, so `drawImage` at x±w/2, y±h/2 puts it back exactly
    where it came from. (cx, cy) is its centre of mass, which is where it should
    be pivoted about — an ear is a triangle, and swinging one around the middle
    of its bounding box looks like a slab tipping over rather than an ear
    twitching. They can be a good way apart, so recording only one of them
    leaves the other uncomputable.
    """
    hx0, hy0, hx1, hy1 = head
    hw, hh = hx1 - hx0, hy1 - hy0
    x0, y0, x1, y1 = p["box"]
    return dict(
        x=round(((x0 + x1) / 2 - hx0) / hw, 4),
        y=round(((y0 + y1) / 2 - hy0) / hh, 4),
        w=round((x1 - x0) / hw, 4),
        h=round((y1 - y0) / hh, 4),
        cx=round((p["cx"] - hx0) / hw, 4),
        cy=round((p["cy"] - hy0) / hh, 4),
        angle=round(p["angle"], 1),
        area=p["area"],
    )


def face(stem, lab, rgba, min_head=MIN_HEAD):
    """One cat's face, taken apart. Returns (record, files) or (None, why)."""
    head_px = int((lab == HEAD).sum())
    if head_px < min_head:
        return None, f"head is {head_px}px — too small to take apart"

    floor = max(MIN_PART_PX, head_px * MIN_PART)
    # Two of each at most: a cat has two eyes and two ears, and the third blob
    # the label finds is always speckle.
    eyes = [measure(m) for m in blobs(lab == EYE, floor)[:2]]
    ears = [measure(m) for m in blobs(lab == EAR, floor)[:2]]
    muz = [measure(m) for m in blobs(lab == MUZZLE, floor)[:1]]
    eyes.sort(key=lambda p: p["cx"])  # [0] is the left one, in image space
    ears.sort(key=lambda p: p["cx"])

    why = arrangement(eyes, ears, muz[0] if muz else None)
    if why:
        return None, why
    if stem in REJECT:
        return None, REJECT[stem]

    alpha = rgba[..., 3]
    box = head_box(eyes, ears + muz, lab.shape, alpha)
    files = {f"{stem}_head.png": cut(rgba, alpha > 8, box, MAX_HEAD_W, 0)}
    rec = dict(id=stem, head=dict(file=f"{stem}_head.png",
                                  w=box[2] - box[0], h=box[3] - box[1]))

    for name, group in (("eyes", eyes), ("ears", ears), ("muzzle", muz)):
        out = []
        for i, p in enumerate(group):
            fn = f"{stem}_{name.rstrip('s')}{i}.png"
            files[fn] = cut(rgba, p["mask"], p["box"], MAX_PART_W, FEATHER)
            out.append(dict(file=fn, **place(p, box)))
        rec[name] = out
    return (rec, files), None


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--min-head", type=int, default=MIN_HEAD)
    ap.add_argument("--only", nargs="*", help="stems to process, default all")
    args = ap.parse_args()

    (OUT / "faces").mkdir(parents=True, exist_ok=True)
    kept, dropped = [], []

    for path in sorted((OUT / "parts").glob("*.png")):
        stem = path.stem
        if args.only and stem not in args.only:
            continue
        cut_path = OUT / "cutout" / f"{stem}.png"
        if not cut_path.exists():
            dropped.append((stem, "no cutout beside the label map"))
            continue

        got, why = face(stem, np.array(Image.open(path)),
                        np.array(Image.open(cut_path).convert("RGBA")), args.min_head)
        if got is None:
            dropped.append((stem, why))
            continue
        rec, files = got
        for fn, img in files.items():
            img.save(OUT / "faces" / fn)
        kept.append(rec)

    (OUT / "faces.json").write_text(json.dumps({"faces": kept}, indent=1) + "\n")
    for stem, why in dropped:
        print(f"dropped {stem} — {why}")
    whole = [f["id"] for f in kept if len(f["ears"]) == 2 and f["muzzle"]]
    print(f"\nkept {len(kept)} faces → out/faces/  ({', '.join(f['id'] for f in kept)})")
    print(f"of those, {len(whole)} have two eyes, two ears and a muzzle: {', '.join(whole)}")


if __name__ == "__main__":
    main()
