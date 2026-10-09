# Web font encodings

`*.woff2` here are lossless WOFF2 re-encodings of the TTF faces bundled for the desktop app
(Carlito GO, Caladea, Liberation Sans/Serif/Mono; sources and licenses: SIL OFL 1.1 / Apache-2.0, see
`apps/docs/src/renderer/fonts/README.md` and `LICENSE-OFL.txt` there). Only the container changed:
cmap, glyph order and advance widths are asserted equal by `make-woff2.py`.

The web build (`web/docs/build/fonts-woff2.ts`) points `fonts.css` at these files instead of the TTFs,
saving ~30% of the bytes on the wire and ~5.5 MiB in the build. The desktop build is untouched.
`woff2-sources.json` pins the sha256 of each source TTF; `fonts-woff2.test.ts` fails when a TTF changes
without regenerating (`python3 web/docs/fonts/make-woff2.py`, needs `pip install fonttools brotli`).
