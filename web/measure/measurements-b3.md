# Web bundle measurements (UNI-1013 B3)

Generated 2026-10-08T15:41:01.708Z on linux arm64, 4 CPUs, node v22.23.2, chromium 151.0.7922.34 (headless), 1-min load average 7.9 → 1.7 (the host is shared with other workers: before/after runs are interleaved, absolute times still carry noise). Raw data: `measurements-b3.json`. Reproduce: `node web/measure/measure-b3.mjs --before-dist <spike build>` (before = `npm run build:web` at 4a70857, i.e. `web/docs/dist`).

- **before**: UNI-1011 spike build (single-directory output, TTF faces, meta CSP).
- **after**: `0.1.0-12b6000` (40 files; versioned dir, manifest + csp.json + headers.json, WOFF2 Latin faces, fonts under `fonts/` never inlined, no sourcemaps).
- Both are served by the same `web/server/server.mjs`; "gzip" = server compresses text/font responses level 9 (what a host sends), "raw" = no compression (the spike's original measurement setup). Cold load, HTTP cache disabled, 5 rounds of (before, after) per document, median shown.

## 1. What the browser downloads before the app starts (initial) vs on demand

"Initial" = `index.html` + its `<script>`/`<link>` targets + their static imports. Fonts are `@font-face` `url()`s: the browser fetches a face only when text in that family/range is laid out, so they are not part of the initial set (section 3 shows what actually gets fetched).

|                                        | before                             | after                            |
| -------------------------------------- | ---------------------------------- | -------------------------------- |
| initial files                          | 3                                  | 3                                |
| **initial raw**                        | 3.83 MiB                           | 3.83 MiB (same)                  |
| **initial gzip**                       | 1.14 MiB                           | 1.14 MiB (same)                  |
| initial brotli                         | 0.90 MiB                           | 0.90 MiB (same)                  |
| total raw (everything the host stores) | 17.85 MiB                          | 13.28 MiB (−26%)                 |
| total gzip                             | 11.65 MiB                          | 10.56 MiB (−9%)                  |
| font files                             | 33 (14.01 MiB raw, 10.51 MiB gzip) | 34 (9.42 MiB raw, 9.42 MiB gzip) |
| fonts as share of total raw            | 78%                                | 71%                              |
| fonts in the initial download          | 0.00 MiB                           | 0.00 MiB                         |

Consistency check: manifest.json says initial = 3 files / 4021101 B / 1195846 B gzip, bundle-size.mjs measured 3 files / 4021101 B / 1195846 B gzip (identical).

## 2. Cold load: transferred bytes and time-to-editable

time-to-editable = first moment a visible `.ProseMirror[contenteditable=true]` contains the document's known text (ms since navigation start). Wire bytes = sum of CDP `encodedDataLength`: _by editable_ = finished when the doc became editable, _settled_ = after network idle + 1.5 s (late fonts included).

### Server with gzip (production-like)

| doc               | time-to-editable         | wire by editable           | wire settled              | requests |
| ----------------- | ------------------------ | -------------------------- | ------------------------- | -------- |
| simple.docx       | 1213 ms → 1280 ms (+6%)  | 1.41 MiB → 1.52 MiB (+8%)  | 4.09 MiB → 3.94 MiB (−4%) | 9 → 9    |
| kitchen-sink.docx | 1100 ms → 1088 ms (−1%)  | 1.95 MiB → 1.71 MiB (−12%) | 4.36 MiB → 4.13 MiB (−5%) | 11 → 11  |
| long.docx         | 1748 ms → 1742 ms (same) | 1.68 MiB → 1.52 MiB (−9%)  | 1.68 MiB → 1.52 MiB (−9%) | 8 → 8    |

### Server without compression (spike setup)

| doc               | time-to-editable         | wire by editable           | wire settled               | requests |
| ----------------- | ------------------------ | -------------------------- | -------------------------- | -------- |
| simple.docx       | 685 ms → 620 ms (−10%)   | 5.10 MiB → 4.21 MiB (−17%) | 7.51 MiB → 6.63 MiB (−12%) | 9 → 9    |
| kitchen-sink.docx | 774 ms → 739 ms (−4%)    | 5.69 MiB → 4.41 MiB (−23%) | 8.11 MiB → 6.82 MiB (−16%) | 11 → 11  |
| long.docx         | 1211 ms → 1012 ms (−16%) | 5.10 MiB → 4.22 MiB (−17%) | 5.10 MiB → 4.22 MiB (−17%) | 8 → 8    |

### What was fetched (gzip run 1, after build)

- **simple.docx**: `index.html` 1 KiB, `index-CGJNJzuU.css` 33 KiB, `index-BVZB0WQT.js` 1135 KiB, `simple.docx` 2 KiB, `send-enter-off-B0IfWMyy.png` 4 KiB; fonts: `Carlito-Bold-DN11iCUU.woff2` 194 KiB, `Carlito-Regular-fal-2WfU.woff2` 186 KiB, `NotoSansCJKsc-Regular-subset-BuHGXxnc.woff2` 2474 KiB (after editable)
- **kitchen-sink.docx**: `index.html` 1 KiB, `index-CGJNJzuU.css` 33 KiB, `index-BVZB0WQT.js` 1135 KiB, `kitchen-sink.docx` 4 KiB, `send-enter-off-B0IfWMyy.png` 4 KiB; fonts: `Carlito-Bold-DN11iCUU.woff2` 194 KiB, `Carlito-Regular-fal-2WfU.woff2` 186 KiB, `Carlito-Italic-CcV9hCBk.woff2` 198 KiB, `NotoSansCJKsc-Regular-subset-BuHGXxnc.woff2` 2474 KiB (after editable)
- **long.docx**: `index.html` 1 KiB, `index-CGJNJzuU.css` 33 KiB, `index-BVZB0WQT.js` 1135 KiB, `long.docx` 5 KiB, `send-enter-off-B0IfWMyy.png` 4 KiB; fonts: `Carlito-Bold-DN11iCUU.woff2` 194 KiB, `Carlito-Regular-fal-2WfU.woff2` 186 KiB

## 3. Fonts on demand: what each user action costs

Font bytes on the wire (gzip server). _document open_ = faces the document needed by the time the page is idle; _font picker_ = additional faces fetched when the font dropdown is opened (every family name is rendered in its own face).

| doc    |                                     | font files | font wire bytes |
| ------ | ----------------------------------- | ---------- | --------------- |
| simple | document open, before               | 3          | 2.94 MiB        |
|        | document open, **after**            | 3          | 2.79 MiB (−5%)  |
|        | + font picker first open, before    | 6          | 4.48 MiB        |
|        | + font picker first open, **after** | 6          | 4.36 MiB (−3%)  |
| long   | document open, before               | 2          | 0.53 MiB        |
|        | document open, **after**            | 2          | 0.37 MiB (−30%) |
|        | + font picker first open, before    | 7          | 6.90 MiB        |
|        | + font picker first open, **after** | 7          | 6.77 MiB (−2%)  |

Font files fetched on first picker open (after build, doc "simple"):

- `Caladea-Regular-DaybilA1.woff2` 19 KiB
- `LiberationSans-Regular-r-gFvyde.woff2` 144 KiB
- `LiberationMono-Regular-Bv_fWIHn.woff2` 123 KiB
- `GenOfficeSansKR-Regular-subset-CVxxonE8.woff2` 260 KiB
- `GenOfficeSerifKR-Regular-subset-BkQyd75u.woff2` 501 KiB
- `NotoSerifCJKsc-Regular-subset-CLPB6QGT.woff2` 3414 KiB

## 4. Served under a sub-path

Loaded the build from `/office-frame/docs/0.1.0-12b6000/` (server MOUNT, nothing is served outside that prefix except the fixture documents): all 3 documents became editable, 0 failed requests; time-to-editable simple.docx 738 ms, kitchen-sink.docx 794 ms, long.docx 1169 ms.

## 5. Reading the numbers

- **The 14 MiB of fonts was never downloaded up front**: every face is an `@font-face` `url()` and a browser fetches it only when text in that family/range is laid out, so the spike already transferred only the faces a document used (section 2). What this lane changes is that this is now guaranteed and visible: fonts live under `fonts/`, are never inlined into the CSS as `data:` URIs (so they cannot silently join the initial download and `font-src` needs no `data:`), and `manifest.json` reports `initial` vs `deferred` bytes for the host.
- **Initial download is the JS bundle** (3.83 MiB raw / 1.14 MiB gzip, unchanged here). 35% of that chunk is the 19-language i18n dictionaries (spike report, composition table); lazy-loading locales is the next lever and is renderer work outside this lane.
- **WOFF2** for the 20 Latin faces (Carlito GO, Caladea, Liberation) cuts a Latin document's font transfer by ~30% (section 3, doc "long") and the build by ~4.6 MiB.
- **CJK/Korean fallback faces dominate what remains.** A document with Chinese text pulls Noto Sans CJK SC (2.4 MiB) after first paint; opening the font picker renders every family name in its own face and pulls the bundled CJK/KR fallbacks (Noto Serif CJK SC 3.4 MiB, Noto Sans CJK SC 2.4 MiB, KR serif/sans 0.8 MiB) on machines that have no local CJK/KR fonts (this headless Linux host is that worst case; Windows/macOS resolve most picker names to system fonts and fetch nothing). Fixing this needs a renderer change (lazy/hover previews in `Ribbon.tsx`, or `unicode-range` slices of the CJK faces), not a build change.
- "wire by editable" depends on which late fonts happen to have finished when the editor became editable, so it can move by a few hundred KiB between runs; "settled" is the stable number.
