#!/usr/bin/env python3
"""Fetch public-domain / CC0 cat photos from Wikimedia Commons.

Search is restricted to the CC-Zero and PD-self categories, and then every
candidate's own licence metadata is re-checked against ALLOWED before it is
kept -- so the search filter is never the only thing standing between us and a
share-alike image. Everything that lands in images/ can be used, modified and
redistributed for any purpose without attribution.

Credits are recorded anyway in images/credits.json and CREDITS.md.
"""

import json
import pathlib
import re
import ssl
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).parent
IMG_DIR = ROOT / "images"
CACHE = ROOT / ".cache"
API = "https://commons.wikimedia.org/w/api.php"
UA = "flat-cats/0.1 (dataset builder; zeblanton@gmail.com)"

# Licence short-names we accept. Anything else is dropped, loudly.
ALLOWED = re.compile(
    r"^(cc0|cc[ -]?zero|public domain|pd|pdm|no restrictions|"
    r"public domain mark)", re.I)

QUERIES = [
    "cat incategory:CC-Zero",
    "kitten incategory:CC-Zero",
    "tabby cat incategory:CC-Zero",
    "black cat incategory:CC-Zero",
    "cat sitting incategory:CC-Zero",
    "cat lying incategory:CC-Zero",
    "domestic cat incategory:PD-self",
    "cat portrait incategory:PD-self",
    "ginger cat incategory:CC-Zero",
    "white cat incategory:CC-Zero",
    "cat standing incategory:CC-Zero",
    "cat grass incategory:CC-Zero",
]

WANT = 40          # over-fetch; the contact sheet decides what actually stays
MIN_SIDE = 600
THUMB_W = 1280
PER_QUERY = 12

# Commons search happily returns caterpillars and catamarans for "cat".
REJECT = re.compile(
    r"caterpillar|catamaran|catfish|cathedral|catwalk|category|logo|map|"
    r"coat of arms|diagram|chart|scan|document|cattle|bobcat|wildcat|lynx|"
    r"tiger|lion|leopard|cheetah|jaguar|cougar|panther", re.I)


def api(**params):
    params.update(action="query", format="json")
    url = f"{API}?{urllib.parse.urlencode(params)}"
    key = CACHE / (re.sub(r"\W+", "_", urllib.parse.urlencode(params))[:120] + ".json")
    if key.exists():
        return json.loads(key.read_text())
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=45,
                                context=ssl.create_default_context()) as r:
        data = json.loads(r.read())
    CACHE.mkdir(exist_ok=True)
    key.write_text(json.dumps(data))
    time.sleep(0.4)
    return data


def fetch(url, tries=5):
    """Commons throttles bots hard; back off rather than giving up."""
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60,
                                        context=ssl.create_default_context()) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 429 or n == tries - 1:
                raise
            time.sleep(4 * (n + 1))
    raise RuntimeError("unreachable")


def plain(html):
    return re.sub(r"<[^>]+>", "", html or "").strip()


def candidates():
    """Yield (title, imageinfo) for every distinct search hit."""
    seen = set()
    for q in QUERIES:
        try:
            res = api(generator="search", gsrsearch=f"{q} filemime:image/jpeg",
                      gsrnamespace=6, gsrlimit=PER_QUERY,
                      prop="imageinfo", iiprop="url|size|extmetadata",
                      iiurlwidth=THUMB_W)
        except Exception as e:
            print(f"  search {q!r} failed: {e}")
            continue
        for page in (res.get("query", {}).get("pages") or {}).values():
            title = page.get("title", "")
            if title in seen or not page.get("imageinfo"):
                continue
            seen.add(title)
            yield title, page["imageinfo"][0]


def stem(title):
    """First few words of the filename -- photo series share one."""
    words = re.findall(r"[A-Za-z]+", title.removeprefix("File:").lower())
    return " ".join(words[:3])


def main():
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    picked, rejected = [], {}
    per_stem, per_creator = {}, {}

    for title, ii in candidates():
        if len(picked) >= WANT:
            break
        meta = ii.get("extmetadata", {})
        lic = plain(meta.get("LicenseShortName", {}).get("value", ""))
        if not ALLOWED.match(lic):
            rejected[f"licence:{lic}"] = rejected.get(f"licence:{lic}", 0) + 1
            continue
        if REJECT.search(title):
            rejected["not-a-house-cat"] = rejected.get("not-a-house-cat", 0) + 1
            continue
        w, h = ii.get("width", 0), ii.get("height", 0)
        if min(w, h) < MIN_SIDE or max(w, h) / max(1, min(w, h)) > 2.0:
            rejected["size/aspect"] = rejected.get("size/aspect", 0) + 1
            continue
        # Keep the set varied: no photo series or single photographer dominating.
        s, c = stem(title), plain(meta.get("Artist", {}).get("value", "")) or "?"
        if per_stem.get(s, 0) >= 1 or per_creator.get(c, 0) >= 3:
            rejected["near-duplicate"] = rejected.get("near-duplicate", 0) + 1
            continue
        per_stem[s] = per_stem.get(s, 0) + 1
        per_creator[c] = per_creator.get(c, 0) + 1
        picked.append((title, ii, lic, meta))

    print(f"selected {len(picked)} candidates; dropped: {rejected}")

    credits, ok = [], 0
    for title, ii, lic, meta in picked:
        name = f"cat_{ok:02d}.jpg"
        dest = IMG_DIR / name
        if not dest.exists():
            try:
                blob = fetch(ii.get("thumburl") or ii["url"])
            except Exception as e:
                print(f"  [skip] {title[:40]}: {e}")
                continue
            if len(blob) < 20_000:
                print(f"  [skip] {title[:40]}: too small ({len(blob)}B)")
                continue
            dest.write_bytes(blob)
            time.sleep(1.5)
        credits.append({
            "file": name,
            "title": title.removeprefix("File:"),
            "creator": plain(meta.get("Artist", {}).get("value", "")) or "unknown",
            "license": lic,
            "license_url": plain(meta.get("LicenseUrl", {}).get("value", "")),
            "source_page": ii.get("descriptionurl"),
            "source_file": ii.get("url"),
            "orig_width": ii.get("width"),
            "orig_height": ii.get("height"),
        })
        ok += 1
        print(f"  [{ok:2d}] {name}  {lic:<14} {ii['width']}x{ii['height']}  {title[5:55]}")

    (IMG_DIR / "credits.json").write_text(json.dumps(credits, indent=2))
    lines = ["# Image credits", "",
             "Every file below is CC0 1.0 or public domain: free to use, modify and",
             "redistribute for any purpose, no attribution required. Credited anyway.",
             "", "| file | title | creator | licence | source |", "|---|---|---|---|---|"]
    for c in credits:
        lines.append(f"| `{c['file']}` | {c['title']} | {c['creator'][:40]} | "
                     f"{c['license']} | [Commons]({c['source_page']}) |")
    (ROOT / "CREDITS.md").write_text("\n".join(lines) + "\n")
    print(f"\ndownloaded {ok} images -> {IMG_DIR}")


if __name__ == "__main__":
    main()
