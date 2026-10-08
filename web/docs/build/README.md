# Web Docs build (`npm run build:web`)

Builds the Docs renderer for the browser (`web/docs/index.html` -> `apps/docs` renderer + `web/docs/bridge`)
into an immutable, version-named directory the UniWork host serves as a same-origin iframe.

```
dist-web/docs/<packageVersion>-<gitSha>[-dirty]/
  index.html          entry; every URL is relative (base './'), no <meta> CSP
  assets/*.js|css     hashed bundle (initial download)
  fonts/*.woff2|ttf   hashed font faces, fetched one by one on demand (never in the initial download)
  manifest.json       what is in the build (below)
  csp.json            the Content-Security-Policy the frame needs
  headers.json        response headers per path (CSP on index.html, immutable cache on assets/fonts)
```

## manifest.json (consumed by the host sync script)

| field                                          | meaning                                                                                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                                | `1`                                                                                                                                                 |
| `version`, `packageVersion`, `gitSha`, `dirty` | `version` = `<root package.json version>-<short sha>`, `-dirty` appended when tracked files differ from HEAD (a dirty build is never a release)     |
| `builtAt`                                      | ISO timestamp                                                                                                                                       |
| `entry`                                        | document to load, `index.html`                                                                                                                      |
| `csp`, `headers`                               | file names of the policy files next to the manifest                                                                                                 |
| `files[]`                                      | every file except `manifest.json`: `{path, bytes, sha256, gzipBytes, kind, initial}` (`path` posix, relative to the version dir)                    |
| `totalBytes`, `gzipBytes`                      | sums over `files[]`                                                                                                                                 |
| `initial`, `deferred`                          | `{files, bytes, gzipBytes}`: static load path (html + script/link targets + static imports) vs everything else except metadata (fonts, lazy chunks) |

A synced copy can be checked with `verifyManifest(dir, manifest)` (`web/docs/build/manifest.ts`): size + sha256 of every
listed file, no path escapes the directory, and no file the manifest does not list (a stale or injected file would be
served same-origin with UniWork).

## Serving

- Any prefix or origin: `/office-frame/docs/<version>/index.html`, a subdomain root, ... (relative URLs; checked by
  `web/measure/measure-b3.mjs` loading the build under a sub-path).
- Send the `headers.json` rules: `Content-Security-Policy` **as a header** on `index.html` (`frame-ancestors` is ignored in a
  `<meta>`), `Cache-Control: public, max-age=31536000, immutable` for `assets/**` and `fonts/**` (hashed names, version-named
  directory), `no-cache` for `index.html`, `nosniff` + `Referrer-Policy: no-referrer` everywhere. `source` is a path relative
  to the version directory (`/index.html`, `/assets/**`, `/**`); first match wins per header name.
- Serve fonts with gzip/brotli only if the host compresses `.ttf`; the `.woff2` files are already compressed.
- `web/server/server.mjs` does all of this for local runs and tests (`MOUNT=`, `COMPRESS=gzip`, `DIST_DIR=`).

## CSP (`web/docs/build/csp.ts`)

`default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self';
connect-src 'self'; worker-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self';
frame-ancestors 'self'`. The reason for every source is in the file header; `web/e2e/csp-header.spec.ts` opens, edits, uses the
font picker and saves under this exact header and fails on any `securitypolicyviolation`.

- Clipboard data: URLs: `connect-src` has no `data:` on purpose; `bridge/browser.ts` decodes `data:` URLs by hand instead of
  `fetch(dataUrl)`.
- Another API origin: `WEB_DOCS_CSP_CONNECT_SRC="https://api.example.com"`; frame on its own origin:
  `WEB_DOCS_CSP_FRAME_ANCESTORS="https://app.example.com"` (build time).
- Document downloads: the bridge `fetch`es a `FileSource {kind:'url'}` from inside the frame, so with `connect-src 'self'`
  the host must give the frame **same-origin** URLs (its own proxy route) or the bytes themselves (`{kind:'bytes'}`). A
  presigned URL on another origin (S3/MinIO) is blocked by the CSP; a host that needs one must add that origin to
  `connect-src` in the CSP it serves (it ships `csp.json`, so the header can be widened without a rebuild).
  See `web/docs/protocol/README.md`.

## Fonts

- Loading is lazy by construction: fonts are `@font-face` `url()`s in `apps/docs/src/renderer/fonts/fonts.css`, so the browser
  fetches a face only when text in that family/range is laid out. The build keeps it that way: fonts are emitted under
  `fonts/`, never inlined as `data:` URIs, and reported as `deferred` in the manifest.
- The 20 TTF faces (Carlito GO, Caladea, Liberation) are served as WOFF2 twins from `web/docs/fonts/` (lossless; see its README);
  the desktop app still uses the TTFs.

## Other knobs

`WEB_DOCS_VERSION` (override the whole version string), `WEB_DOCS_GIT_SHA` (builds without `.git`), `WEB_DOCS_OUT_DIR`,
`WEB_DOCS_SOURCEMAP=1` (emit sourcemaps, off by default: ~12 MiB the host does not serve).

## Tests

`npm run test:web` runs the protocol, bridge and build vitest suites; `npm run typecheck:web` the protocol and bridge
tsconfigs (both run in CI, `.github/workflows/ci.yml`).
`npx vitest run --root web/docs/build` (manifest, CSP, version, font rewrite + woff2 freshness),
`npx playwright test -c web/e2e` (needs `npm run build:web` first; the specs open documents through the protocol test host at `/test-host/`, `csp-header.spec.ts` fails on any CSP violation),
`node web/measure/measure-b3.mjs --before-dist <old-pipeline build> --before-desc "..."` (writes `web/measure/measurements-b3.{md,json}`; `measurements-b3-vs-spike.*` is the earlier run against the UNI-1011 spike build).
