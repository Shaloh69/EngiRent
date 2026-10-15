"""
Fetch openly licensed face photos from Wikimedia Commons categories for tuning the face
liveness thresholds (app/config.py `face_*`), grouped by what each one is
expected to show.

    python eval/fetch_wild_faces.py

Writes to tests/fixtures/faces/_wild/<group>/ (GITIGNORED: real people's faces
in a public repo) plus an ATTRIBUTION.json per group (title, author, licence,
source page) so every photo can be credited and removed. Only CC0, public
domain, CC BY and CC BY-SA files are kept. These are tuning aids for single
components (hat rule, eye openness, head yaw, face parsing), not a stand-in
for real blink/turn sequences from the students themselves.
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "fixtures", "faces", "_wild")
UA = {"User-Agent": "EngiRentThesisTuning/1.0 (student thesis; openly licensed images only)"}
OK_LICENCE = re.compile(r"^(CC0|Public domain|PD|CC BY(-SA)? [0-9.]+)", re.I)

# group -> (Commons categories, max files). Categories, not free-text search:
# search returned mostly museum paintings.
GROUPS = {
    "bare": (["Portrait photographs of men", "Portrait photographs of women"], 50, ["M", "S"]),
    "glasses": (["People with glasses", "Men with glasses"], 40, [""]),
    "cap": (["Men wearing baseball caps", "Women wearing baseball caps"], 50, ["M", "S"]),
    "hood": (["Men wearing hoodies", "Women wearing hoodies"], 40, ["M", "S"]),
    "hijab": (["Women wearing hijabs"], 60, ["", "M"]),
    "closed_eyes": (["Women with closed eyes", "Men with closed eyes"], 40, ["M", "S"]),
}


def api(params):
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({**params, "format": "json"})
    for attempt in range(6):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40))
        except Exception:
            time.sleep(15 * (attempt + 1))  # Commons answers 429 when asked too fast
    return {}


def members(category, start, limit=60):
    d = api({
        "action": "query", "generator": "categorymembers", "gcmtitle": "Category:" + category, "gcmtype": "file",
        "gcmlimit": str(limit), "gcmstartsortkeyprefix": start, "prop": "imageinfo",
        "iiprop": "url|size|mime|extmetadata", "iiurlwidth": "960",
    })
    for pg in (d.get("query", {}).get("pages", {}) or {}).values():
        ii = (pg.get("imageinfo") or [None])[0]
        if not ii or ii.get("mime") not in ("image/jpeg", "image/png"):
            continue
        meta = ii.get("extmetadata", {})
        lic = meta.get("LicenseShortName", {}).get("value", "")
        if not OK_LICENCE.match(lic) or max(ii["width"], ii["height"]) < 1100 or min(ii["width"], ii["height"]) < 600:
            continue
        author = re.sub(r"<[^>]+>", "", meta.get("Artist", {}).get("value", "unknown"))[:120]
        yield {
            "title": pg["title"], "licence": lic, "author": author,
            "page": ii.get("descriptionurl"), "url": ii.get("thumburl") or ii["url"], "category": category,
        }


def download(url, path):
    for attempt in range(3):
        try:
            data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
            with open(path, "wb") as f:
                f.write(data)
            return True
        except Exception:
            time.sleep(4 * (attempt + 1))
    return False


def main():
    total = 0
    for group, (cats, cap, starts) in GROUPS.items():
        gdir = os.path.join(OUT, group)
        os.makedirs(gdir, exist_ok=True)
        for old in os.listdir(gdir):  # a re-run replaces the group
            os.remove(os.path.join(gdir, old))
        credits, seen = [], set()
        for cat in cats:
            for start in starts:
                for item in members(cat, start):
                    if len(credits) >= cap:
                        break
                    if item["title"] in seen:
                        continue
                    seen.add(item["title"])
                    name = re.sub(r"[^A-Za-z0-9._-]+", "_", item["title"].replace("File:", ""))[:90]
                    if not name.lower().endswith((".jpg", ".jpeg", ".png")):
                        name += ".jpg"
                    if download(item["url"], os.path.join(gdir, name)):
                        item["file"] = name
                        credits.append(item)
                    time.sleep(0.6)
                time.sleep(2)
        with open(os.path.join(gdir, "ATTRIBUTION.json"), "w", encoding="utf-8") as f:
            json.dump(credits, f, indent=1, ensure_ascii=False)
        print(f"{group}: {len(credits)} files", flush=True)
        total += len(credits)
    print("total", total, "->", OUT)


if __name__ == "__main__":
    sys.exit(main())
