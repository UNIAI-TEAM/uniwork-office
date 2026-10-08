# Web bundle measurements (UNI-1013 B3)

Generated 2026-10-08T15:26:54.226Z on linux arm64, 4 CPUs, node v22.23.2, chromium 151.0.7922.34 (headless). Raw data: `measurements-b3.json`. Reproduce: `node web/measure/measure-b3.mjs --before-dist <spike build>` (before = `npm run build:web` at 4a70857, i.e. `web/docs/dist`).

- **before**: UNI-1011 spike build (single-directory output, TTF faces, meta CSP).
- **after**: `0.1.0-12b6000` (40 files; versioned dir, manifest + csp.json + headers.json, WOFF2 Latin faces, fonts under `fonts/` never inlined, no sourcemaps).
- Both are served by the same `web/server/server.mjs`; "gzip" = server compresses text/font responses level 9 (what a host sends), "raw" = no compression (the spike's original measurement setup). Cold load, HTTP cache disabled, 5 runs per document, median shown.

## 1. What the browser downloads before the app starts (initial) vs on demand

"Initial" = `index.html` + its `<script>`/`<link>` targets + their static imports. Fonts are `@font-face` `url()`s: the browser fetches a face only when text in that family/range is laid out, so they are not part of the initial set (section 3 shows what actually gets fetched).

|                                        | before                             | after                            |
| -------------------------------------- | ---------------------------------- | -------------------------------- |
| initial files                          | 3                                  | 3                                |
| **initial raw**                        | 3.83 MiB                           | 3.83 MiB (−0%)                   |
| **initial gzip**                       | 1.14 MiB                           | 1.14 MiB (+0%)                   |
| initial brotli                         | 0.90 MiB                           | 0.90 MiB (−0%)                   |
| total raw (everything the host stores) | 17.85 MiB                          | 13.28 MiB (+26%)                 |
| total gzip                             | 11.65 MiB                          | 10.56 MiB (+9%)                  |
| font files                             | 33 (14.01 MiB raw, 10.51 MiB gzip) | 34 (9.42 MiB raw, 9.42 MiB gzip) |
| fonts as share of total raw            | 78%                                | 71%                              |
| fonts in the initial download          | 0.00 MiB                           | 0.00 MiB                         |

Consistency check: manifest.json says initial = 3 files / 4021101 B / 1195846 B gzip, bundle-size.mjs measured 3 files / 4021101 B / 1195846 B gzip (identical).

## 2. Cold load: transferred bytes and time-to-editable

time-to-editable = first moment a visible `.ProseMirror[contenteditable=true]` contains the document's known text (ms since navigation start). Wire bytes = sum of CDP `encodedDataLength`: _by editable_ = finished when the doc became editable, _settled_ = after network idle + 1.5 s (late fonts included).

### Server with gzip (production-like)

| doc               | time-to-editable         | wire by editable           | wire settled              | requests |
| ----------------- | ------------------------ | -------------------------- | ------------------------- | -------- |
| simple.docx       | 1395 ms → 1892 ms (−36%) | 1.68 MiB → 1.52 MiB (+9%)  | 4.09 MiB → 3.94 MiB (+4%) | 9 → 9    |
| kitchen-sink.docx | 1703 ms → 1553 ms (+9%)  | 1.95 MiB → 1.71 MiB (+12%) | 4.36 MiB → 4.13 MiB (+5%) | 11 → 11  |
| long.docx         | 2584 ms → 3202 ms (−24%) | 1.68 MiB → 1.52 MiB (+9%)  | 1.68 MiB → 1.52 MiB (+9%) | 8 → 8    |

### Server without compression (spike setup)

| doc               | time-to-editable         | wire by editable           | wire settled               | requests |
| ----------------- | ------------------------ | -------------------------- | -------------------------- | -------- |
| simple.docx       | 903 ms → 1309 ms (−45%)  | 5.10 MiB → 4.21 MiB (+17%) | 7.51 MiB → 6.63 MiB (+12%) | 9 → 9    |
| kitchen-sink.docx | 1038 ms → 995 ms (+4%)   | 5.69 MiB → 4.41 MiB (+23%) | 8.11 MiB → 6.82 MiB (+16%) | 11 → 11  |
| long.docx         | 1764 ms → 1958 ms (−11%) | 5.10 MiB → 4.22 MiB (+17%) | 5.10 MiB → 4.22 MiB (+17%) | 8 → 8    |

### What was fetched (gzip run 1, after build)

- **simple.docx**: `` 1 KiB, `index-CGJNJzuU.css` 33 KiB, `index-BVZB0WQT.js` 1135 KiB, `simple.docx` 2 KiB, `send-enter-off-B0IfWMyy.png` 4 KiB; fonts: `Carlito-Bold-DN11iCUU.woff2` 194 KiB, `Carlito-Regular-fal-2WfU.woff2` 186 KiB, `NotoSansCJKsc-Regular-subset-BuHGXxnc.woff2` 2474 KiB (after editable)
- **kitchen-sink.docx**: `index-CGJNJzuU.css` 33 KiB, `` 1 KiB, `index-BVZB0WQT.js` 1135 KiB, `kitchen-sink.docx` 4 KiB, `send-enter-off-B0IfWMyy.png` 4 KiB; fonts: `Carlito-Bold-DN11iCUU.woff2` 194 KiB, `Carlito-Regular-fal-2WfU.woff2` 186 KiB, `Carlito-Italic-CcV9hCBk.woff2` 198 KiB, `NotoSansCJKsc-Regular-subset-BuHGXxnc.woff2` 2474 KiB (after editable)
- **long.docx**: `` 1 KiB, `index-CGJNJzuU.css` 33 KiB, `index-BVZB0WQT.js` 1135 KiB, `long.docx` 5 KiB, `send-enter-off-B0IfWMyy.png` 4 KiB; fonts: `Carlito-Regular-fal-2WfU.woff2` 186 KiB, `Carlito-Bold-DN11iCUU.woff2` 194 KiB

## 3. Fonts on demand: what each user action costs

Font bytes on the wire (gzip server). _document open_ = faces the document needed by the time the page is idle; _font picker_ = additional faces fetched when the font dropdown is opened (every family name is rendered in its own face).

| doc    |                                     | font files | font wire bytes |
| ------ | ----------------------------------- | ---------- | --------------- |
| simple | document open, before               | 3          | 2.94 MiB        |
|        | document open, **after**            | 3          | 2.79 MiB (+5%)  |
|        | + font picker first open, before    | 6          | 4.48 MiB        |
|        | + font picker first open, **after** | 6          | 4.36 MiB (+3%)  |
| long   | document open, before               | 2          | 0.53 MiB        |
|        | document open, **after**            | 2          | 0.37 MiB (+30%) |
|        | + font picker first open, before    | 7          | 6.90 MiB        |
|        | + font picker first open, **after** | 7          | 6.77 MiB (+2%)  |

Font files fetched on first picker open (after build, doc "simple"):

- `Caladea-Regular-DaybilA1.woff2` 19 KiB
- `LiberationSans-Regular-r-gFvyde.woff2` 144 KiB
- `LiberationMono-Regular-Bv_fWIHn.woff2` 123 KiB
- `GenOfficeSansKR-Regular-subset-CVxxonE8.woff2` 260 KiB
- `GenOfficeSerifKR-Regular-subset-BkQyd75u.woff2` 501 KiB
- `NotoSerifCJKsc-Regular-subset-CLPB6QGT.woff2` 3414 KiB

## 4. Served under a sub-path

Loaded the build from `/office-frame/docs/0.1.0-12b6000/` (server MOUNT, nothing is served outside that prefix except the fixture documents): all 3 documents became editable, 0 failed requests; time-to-editable simple.docx 1073 ms, kitchen-sink.docx 957 ms, long.docx 2673 ms.
