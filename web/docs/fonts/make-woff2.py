#!/usr/bin/env python3
"""Re-encode the bundled TTF faces referenced by apps/docs/src/renderer/fonts/fonts.css as WOFF2.

The web build serves these instead of the TTFs (web/docs/build/fonts-woff2.ts rewrites the url()s while
bundling): same glyphs and metrics, ~30% fewer bytes on the wire than gzip'd TTF. The desktop app keeps
the TTFs untouched.

  python3 -m venv /tmp/fv && /tmp/fv/bin/pip install fonttools brotli
  /tmp/fv/bin/python web/docs/fonts/make-woff2.py

Writes web/docs/fonts/*.woff2 and web/docs/fonts/woff2-sources.json (source path + sha256 of every TTF it
was made from; web/docs/build/fonts-woff2.test.ts fails when a TTF changes without re-running this).
Lossless check: cmap, glyph order and advance widths of every output equal the TTF's.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
CSS = ROOT / "apps/docs/src/renderer/fonts/fonts.css"
UI_FONTS = ROOT / "packages/ui/src/fonts"
DOCS_FONTS = ROOT / "apps/docs/src/renderer/fonts"

urls = sorted(set(re.findall(r"url\('(?:@genoffice/ui/fonts/|\./)([A-Za-z0-9-]+\.ttf)'\)", CSS.read_text())))
manifest = {}
for name in urls:
    src = UI_FONTS / name if (UI_FONTS / name).exists() else DOCS_FONTS / name
    if not src.exists():
        sys.exit(f"{name}: not found in {UI_FONTS} or {DOCS_FONTS}")
    font = TTFont(src)
    font.flavor = "woff2"
    dst = OUT / (src.stem + ".woff2")
    font.save(dst)

    a, b = TTFont(src), TTFont(dst)
    assert a.getBestCmap() == b.getBestCmap(), f"{name}: cmap differs"
    assert a.getGlyphOrder() == b.getGlyphOrder(), f"{name}: glyph order differs"
    assert a["hmtx"].metrics == b["hmtx"].metrics, f"{name}: advances differ"
    assert a["head"].unitsPerEm == b["head"].unitsPerEm

    manifest[dst.name] = {
        "source": str(src.relative_to(ROOT)),
        "sourceSha256": hashlib.sha256(src.read_bytes()).hexdigest(),
        "ttfBytes": src.stat().st_size,
        "woff2Bytes": dst.stat().st_size,
    }
    print(f"{name}: {src.stat().st_size} -> {dst.stat().st_size}")

(OUT / "woff2-sources.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(f"{len(manifest)} fonts")
