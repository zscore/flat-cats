#!/usr/bin/env python3
"""Contact sheet builder -- a grid of thumbnails so a set can be judged by eye.

    python sheet.py images out/contact.png --cols 8 --cell 220
"""

import argparse
import pathlib

from PIL import Image, ImageDraw

CHECKER = (200, 200, 200), (235, 235, 235)


def checkerboard(size, step=12):
    """Transparency backdrop, so cutouts read as cutouts."""
    img = Image.new("RGB", size, CHECKER[1])
    d = ImageDraw.Draw(img)
    for y in range(0, size[1], step):
        for x in range(0, size[0], step):
            if (x // step + y // step) % 2:
                d.rectangle([x, y, x + step, y + step], fill=CHECKER[0])
    return img


def build(paths, out, cols=8, cell=220, label=True, bg=(24, 24, 27)):
    rows = (len(paths) + cols - 1) // cols
    pad, foot = 6, (16 if label else 0)
    sheet = Image.new("RGB", (cols * (cell + pad) + pad,
                              rows * (cell + pad + foot) + pad), bg)
    draw = ImageDraw.Draw(sheet)

    for i, p in enumerate(paths):
        im = Image.open(p)
        has_alpha = im.mode in ("RGBA", "LA")
        im = im.convert("RGBA")
        im.thumbnail((cell, cell), Image.LANCZOS)
        tile = checkerboard((cell, cell)) if has_alpha else Image.new("RGB", (cell, cell), bg)
        tile.paste(im, ((cell - im.width) // 2, (cell - im.height) // 2), im)
        x = pad + (i % cols) * (cell + pad)
        y = pad + (i // cols) * (cell + pad + foot)
        sheet.paste(tile, (x, y))
        if label:
            draw.text((x + 2, y + cell + 2), pathlib.Path(p).stem[:30],
                      fill=(190, 190, 195))

    pathlib.Path(out).parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print(f"{out}  ({len(paths)} tiles, {sheet.width}x{sheet.height})")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--cols", type=int, default=8)
    ap.add_argument("--cell", type=int, default=220)
    ap.add_argument("--glob", default="*.png")
    a = ap.parse_args()

    src = pathlib.Path(a.src)
    paths = sorted(src.glob(a.glob)) if src.is_dir() else [src]
    if not paths:
        paths = sorted(p for p in src.iterdir()
                       if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    build(paths, a.out, a.cols, a.cell)


if __name__ == "__main__":
    main()
