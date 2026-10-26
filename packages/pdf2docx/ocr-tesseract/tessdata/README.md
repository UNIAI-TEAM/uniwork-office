# Tesseract language model: Vietnamese (`vie`)

`vie.traineddata` is the **tessdata_fast** Vietnamese LSTM model, unmodified.

|         |                                                                    |
| ------- | ------------------------------------------------------------------ |
| Source  | https://github.com/tesseract-ocr/tessdata_fast                     |
| Commit  | `923915d4ced2a7235221788285785a29c4a42d4a`                         |
| File    | `vie.traineddata` (531,275 bytes)                                  |
| SHA-256 | `79df64caf7bcfb2a27df5042ecb6121e196eada34da774956995747636d5bfa1` |
| License | Apache-2.0 (the upstream `LICENSE` is next to this file)           |

It is read by `../tess-ocr.cjs` through tesseract.js (Tesseract 5, LSTM engine
only) from this local directory: the helper never downloads a model and never
writes a cache. Only `vie` ships: English pages measured 0.7-0.9% CER with it
alone, and adding `eng` made Vietnamese slightly worse for +4.1 MB.

To update: fetch the file from a new tessdata_fast commit, replace it, and update
the commit and checksum above and the rows in `docs/go1/LICENSE_AUDIT.md`.
