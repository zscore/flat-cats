#!/usr/bin/env python3
"""Fetch public-domain / CC0 cat *sounds* from Wikimedia Commons.

The photo side of this repo has forty images to choose from. The audio side has
almost nothing: Commons' cat-sound categories for growling, hissing and meowing
contain zero audio files between them, and there is exactly one big cat on the
whole site. What it does have is sixteen purr recordings, and a purr is the one
cat noise with real energy below 100 Hz -- which is precisely the register both
the etude's drone and a track's bass need and cannot get from CatMeows, whose
lowest sample sits at 291 Hz.

Licensing works the same way as download.py and reuses its ALLOWED pattern, so
there is one definition of what this repo will accept: the search is aimed at
CC0/PD material and then every file's own metadata is re-checked before it is
kept. Anything else is dropped, loudly.

Output: sounds/*.wav (16-bit mono), sounds/credits.json, SOUNDS.md.
"""

import json
import pathlib
import re
import shutil
import subprocess
import sys
import urllib.parse

from download import ALLOWED, UA, api, fetch, plain

ROOT = pathlib.Path(__file__).parent
SND_DIR = ROOT / "sounds"
RATE = 22050          # 11 kHz of bandwidth, well past anything a cat puts out

# Where to look, and what to call what comes back. A category pulls all its
# files; a File: title pulls just that one. Commons has so little here that the
# one-off entries are worth naming individually.
SOURCES = [
    ("Category:Audio files of cats purring", "purr"),
    ("File:439280 schots angry-tiger.wav", "roar"),
    ("File:Siamese Cat 01.flac", "meow"),
]

AUDIO = re.compile(r"\.(ogg|oga|wav|flac|mp3|opus)$", re.I)


def members(spec):
    """Every audio file title under `spec`, whether it names a category or a file."""
    if spec.startswith("File:"):
        return [spec]
    out, cont = [], {}
    while True:
        d = api(list="categorymembers", cmtitle=spec, cmlimit=100,
                cmtype="file", **cont)
        out += [m["title"] for m in d.get("query", {}).get("categorymembers", [])]
        if "continue" not in d:
            break
        cont = d["continue"]
    return [t for t in out if AUDIO.search(t)]


def licence_of(title):
    """(ok, short_name, record) for one file, from its own metadata."""
    d = api(titles=title, prop="imageinfo",
            iiprop="url|size|mime|extmetadata")
    pages = d.get("query", {}).get("pages", {})
    if not pages:
        return False, "no metadata", None
    page = next(iter(pages.values()))
    ii = (page.get("imageinfo") or [None])[0]
    if not ii:
        return False, "no imageinfo", None
    em = ii.get("extmetadata", {})
    lic = plain(em.get("LicenseShortName", {}).get("value", "")) or "?"
    rec = {
        "title": title[5:],
        "license": lic,
        "creator": plain(em.get("Artist", {}).get("value", "")) or "unknown",
        "credit": plain(em.get("Credit", {}).get("value", "")),
        "source_page": f"https://commons.wikimedia.org/wiki/{urllib.parse.quote(title)}",
        "url": ii["url"],
        "bytes": ii.get("size"),
    }
    return bool(ALLOWED.match(lic)), lic, rec


def convert(raw, dest):
    """Anything Commons holds -> 16-bit mono WAV, via ffmpeg on stdin."""
    p = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", "pipe:0",
         "-ac", "1", "-ar", str(RATE), "-acodec", "pcm_s16le", str(dest)],
        input=raw, capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode()[:200])
    return dest.stat().st_size


def slug(title, voice, n):
    stem = re.sub(r"\W+", "_", pathlib.Path(title[5:]).stem).strip("_").lower()
    return f"{voice}_{n:02d}_{stem[:40]}.wav"


def collect():
    """Walk every source, keep what passes its own licence check."""
    kept, dropped = [], []
    for spec, voice in SOURCES:
        titles = members(spec)
        print(f"\n{spec}  ({len(titles)} audio files)")
        for title in titles:
            ok, lic, rec = licence_of(title)
            if not ok:
                dropped.append((title[5:], lic))
                print(f"  DROP  {lic:<22} {title[5:60]}")
                continue
            rec["voice"] = voice
            rec["file"] = slug(title, voice, sum(k["voice"] == voice for k in kept))
            kept.append(rec)
            print(f"  keep  {lic:<22} {title[5:60]}")
    return kept, dropped


def retrieve(kept):
    """Download and transcode. Returns the records that actually landed."""
    SND_DIR.mkdir(exist_ok=True)
    done = []
    for rec in kept:
        dest = SND_DIR / rec["file"]
        if not dest.exists():
            try:
                size = convert(fetch(rec["url"]), dest)
            except Exception as e:                      # noqa: BLE001
                print(f"  FAIL  {rec['file']}: {e}")
                continue
        else:
            size = dest.stat().st_size
        rec["wav_bytes"] = size
        rec["seconds"] = round((size - 44) / 2 / RATE, 2)
        done.append(rec)
        print(f"  [{len(done):2d}] {rec['file']:<46} {rec['seconds']:>6.2f}s")
    return done


def write_credits(recs, dropped):
    """Generated, never hand-edited: these must stay in step with sounds/."""
    (SND_DIR / "credits.json").write_text(json.dumps(recs, indent=2) + "\n")
    lines = ["# Sound credits", "",
             "Every file below is CC0 1.0 or public domain: free to use, modify",
             "and redistribute for any purpose, no attribution required. Credited",
             "here anyway. Generated by `sounds.py` -- do not hand-edit.", "",
             "| file | voice | title | creator | licence | source |",
             "|---|---|---|---|---|---|"]
    for r in recs:
        lines.append(f"| `{r['file']}` | {r['voice']} | {r['title'][:44]} | "
                     f"{r['creator'][:34]} | {r['license']} | "
                     f"[Commons]({r['source_page']}) |")
    if dropped:
        lines += ["", f"## Dropped ({len(dropped)})", "",
                  "Failed the licence re-check against `ALLOWED` in `download.py`.", "",
                  "| title | licence |", "|---|---|"]
        lines += [f"| {t[:60]} | {l} |" for t, l in dropped]
    (ROOT / "SOUNDS.md").write_text("\n".join(lines) + "\n")


def main():
    if not shutil.which("ffmpeg"):
        sys.exit("sounds.py: needs ffmpeg on PATH")
    kept, dropped = collect()
    print(f"\n{len(kept)} passed the licence re-check, {len(dropped)} dropped\n")
    recs = retrieve(kept)
    write_credits(recs, dropped)
    for voice in dict.fromkeys(v for _, v in SOURCES):
        g = [r for r in recs if r["voice"] == voice]
        if g:
            print(f"  {voice:<6} {len(g):>2} files  "
                  f"{sum(r['seconds'] for r in g):>7.1f}s total")
    print(f"\nwrote {len(recs)} files -> {SND_DIR}")


if __name__ == "__main__":
    main()
