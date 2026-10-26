# GO-1 license audit

Classifications are taken from files in this tree. Unknowns are marked `UNKNOWN` or `REVIEW_REQUIRED`. LICENSE and NOTICE files were not removed.

## Core

| Component                                                         | Class                                       | Notes                                                     |
| ----------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------- |
| Open-source core (`apps/*`, `packages/*` except vendored + `ee/`) | `APACHE_2_ALLOWED` + `ATTRIBUTION_REQUIRED` | `LICENSE`; copyright Mainfunc, Inc. 2026                  |
| Workspace `package.json` licenses                                 | `APACHE_2_ALLOWED`                          | Apache-2.0                                                |
| `NOTICE`                                                          | `ATTRIBUTION_REQUIRED`                      | Must retain Mainfunc notice; UniWork fork paragraph added |
| GenOffice / Genspark names and logos                              | `NOT_FOR_REUSE`                             | Apache §6; README trademark paragraph                     |
| File-type tile SVGs                                               | `UNKNOWN`                                   | First-party chrome, no adjacent license                   |

## `ee/`

| Component         | Class           |
| ----------------- | --------------- |
| Entire `ee/` tree | `NOT_FOR_REUSE` |

`ee/` contains only `README.md` and `LICENSE` (GenOffice Enterprise License, Mainfunc, Inc.). Not Apache-2.0. Empty of product code. Do not copy, ship, or implement UniWork features inside it.

**RESTRICTED_CODE_EXCLUDED:** `ee/` is unused by GO-1 builds. Classification of the directory itself remains `NOT_FOR_REUSE`.

## npm allowlist (`tools/check-licenses.mjs`)

MIT, MIT-0, Apache-2.0, ISC, BSD-2/3-Clause, 0BSD, BlueOak-1.0.0, CC0-1.0, CC-BY-4.0, Zlib, Unlicense, Python-2.0, Unicode-3.0, OFL-1.1.

Exceptions: `@univerjs/telemetry` (Apache-2.0), `khroma` (MIT).

## Fonts

Documented in `apps/docs/src/renderer/fonts/README.md` and `LICENSE-OFL.txt`.

| Family                                                                               | Class                                                                        |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Carlito GO, Liberation, Noto CJK subsets, Nanum-derived KR, Poppins OFL, Arabic Noto | `OTHER_PERMISSIVE` + `ATTRIBUTION_REQUIRED` (OFL; reserved font names apply) |
| Caladea                                                                              | `APACHE_2_ALLOWED`                                                           |
| “Aptos GO” aliases                                                                   | `REVIEW_REQUIRED` (Carlito metric aliases; “Aptos” is a Microsoft face name) |
| Optional CDN catalog                                                                 | `OTHER_PERMISSIVE` when downloaded; URL not in source                        |

## Vendored / engines

| Component                                                                                                              | Class                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| EMF converter                                                                                                          | `APACHE_2_ALLOWED`                                                                      |
| MTX / libeot (`packages/pptx-engine/src/vendor/mtx`)                                                                   | `REVIEW_REQUIRED` (MPL-2.0 file-level copyleft; outside npm allowlist)                  |
| Unicode radicals map                                                                                                   | `OTHER_PERMISSIVE` + `ATTRIBUTION_REQUIRED`                                             |
| OOXML XSDs in `tools/ooxml-validate`                                                                                   | `REVIEW_REQUIRED` (test/tooling only, not shipped)                                      |
| pdf.js                                                                                                                 | `APACHE_2_ALLOWED`                                                                      |
| pdf-lib                                                                                                                | `MIT_ALLOWED`                                                                           |
| `@embedpdf/pdfium` wrapper                                                                                             | `MIT_ALLOWED`; PDFium engine `BSD_ALLOWED` (README)                                     |
| harfbuzzjs                                                                                                             | `MIT_ALLOWED`                                                                           |
| Univer / `@univerjs/*`                                                                                                 | `APACHE_2_ALLOWED`                                                                      |
| `@genspark/cli`                                                                                                        | `MIT_ALLOWED`                                                                           |
| Electron / Chromium                                                                                                    | `ATTRIBUTION_REQUIRED`                                                                  |
| Fluent UI System Icons                                                                                                 | `MIT_ALLOWED`                                                                           |
| xlsx-sidecar Rust crate                                                                                                | `APACHE_2_ALLOWED`; crate SPDX enforced by `deny.toml`, not re-read from crates.io here |
| OCR helpers (Swift / C#)                                                                                               | inherit Apache-2.0; compiled at pack time                                               |
| tesseract.js 7.0.0 (bundled OCR, runs as a script on the app binary)                                                   | `APACHE_2_ALLOWED`                                                                      |
| tesseract.js-core 7.0.0 (Tesseract 5 + Leptonica as WebAssembly)                                                       | `APACHE_2_ALLOWED`; Leptonica `ATTRIBUTION_REQUIRED` (BSD-2-Clause, quoted in `NOTICE`) |
| tesseract.js-core codec submodules: libpng, zlib, libtiff, giflib, libwebp, openlibm, libjpeg                          | `OTHER_PERMISSIVE` + `ATTRIBUTION_REQUIRED` + `REVIEW_REQUIRED` (open question 7)       |
| tessdata_fast `vie.traineddata` (commit `923915d`, sha256 `79df64ca…5bfa1`)                                            | `APACHE_2_ALLOWED` (unmodified; license text next to the file)                          |
| tesseract.js dependencies: bmp-js, is-url, node-fetch (+ whatwg-url 5, tr46 0.0.3), pngjs, regenerator-runtime, zlibjs | `MIT_ALLOWED`                                                                           |
| tesseract.js dependencies: webidl-conversions 3                                                                        | `BSD_ALLOWED` (BSD-2-Clause)                                                            |
| tesseract.js dependencies: idb-keyval, wasm-feature-detect                                                             | `APACHE_2_ALLOWED`                                                                      |
| opencollective-postinstall (tesseract.js dependency, MIT)                                                              | not shipped (postinstall script only)                                                   |

## Open legal questions

1. MPL-2.0 MTX decoder distribution obligations if UniWork ships Slides.
2. Reserved font names on OFL families if files are modified further.
3. “Aptos GO” naming vs Microsoft trademarks.
4. `ee/` must remain unused; any future enterprise module needs a UniWork license, not the Mainfunc enterprise license.
5. Trademark: do not ship GenOffice/Genspark logos. Attribution of the original project is required.
6. Poppins and Arabic Noto copyright lines are documented in `apps/docs/src/renderer/fonts/README.md` but are not in the `LICENSE-OFL.txt` header.
7. Bundled OCR (UNI-2165): `tesseract.js-core` compiles in the libraries its repository lists as git submodules (`.gitmodules`: leptonica, libjpeg, giflib, libpng, libtiff, libwebp, zlib, tesseract, openlibm). The npm package carries no build manifest, so the exact linked subset is not verified here (the WASM contains libpng, libtiff and GIF code strings). The Leptonica license text and the IJG acknowledgment sentence are shipped in `THIRD-PARTY-NOTICES.txt`; the full libtiff / libpng / giflib / libwebp / openlibm texts are not. Decide whether to reproduce them. Also: `tr46`, `webidl-conversions` and `whatwg-url` are listed in the generated notices under the hoisted copy's version, while the OCR runtime ships node-fetch's nested older copies (same licenses); the generator keys packages by name.
