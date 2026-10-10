# Web build (`npm run build:web [-- --module <module>]`)

Builds a genoffice renderer for the browser into an immutable, version-named directory the UniWork host serves as a
same-origin iframe. Default module `docs` (`web/docs/index.html` -> `apps/docs` renderer + `web/docs/bridge`), exactly
the pre-module build; the other modules (GO-B4/B5/B6) are `pdf`, `markdown`, `html`, `slides`, `sheets`
(`web/modules/<module>/index.html` -> `apps/<app>` renderer + `web/docs/bridge/module-bridge.ts`).

```sh
npm run build:web                       # docs -> dist-web/docs/<version>/
npm run build:web -- --module slides    # (or WEB_MODULE=slides npm run build:web) -> dist-web/slides/<version>/
npm run build:web:all                   # every module, one after the other
```

`web/scripts/build-web.mjs` turns `--module` / `--all` into `WEB_MODULE` and runs
`vite build --config web/docs/vite.config.ts` once per module (Vite's CLI has no `--module`); other arguments pass
through to Vite.

## Module registry (`web/docs/build/modules.ts`)

One entry per module; adding a module is one entry plus its `web/modules/<module>/` directory:

| field            | meaning                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `root`           | directory holding `index.html` (the Vite root): `web/docs` for docs, `web/modules/<module>` for the others                                                                            |
| `installer`      | the bridge entry `index.html` loads first (installs the preload globals)                                                                                                              |
| `renderer`       | the app's `main.tsx`, loaded second                                                                                                                                                   |
| `rendererConfig` | the app's `vite.renderer.config.ts`; its `plugins` (incl. React, the pdf.js asset copy) and `resolve` (the markdown tiptap dedupe) are reused. Docs has none (its build is unchanged) |
| `globals`        | window globals the installer sets (`pdfApi`, `markdownApi`, `htmlApi`, `slidesApi` + `desktop`, `desktopApi`; `projectApi` everywhere)                                                |
| `csp`            | sources added to the shared policy, each with its reason (copied into `csp.json` `notes`)                                                                                             |

Every module uses the same fonts/WOFF2/never-inline rules and the same header-only CSP; additions so far:

| module   | addition                        | why                                                                                         |
| -------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| `pdf`    | `script-src 'wasm-unsafe-eval'` | pdf.js image decoders (openjpeg / jbig2 / qcms) are same-origin WebAssembly (`pdfjs/wasm/`) |
| `slides` | `media-src 'self' data: blob:`  | pptx-embedded audio/video are played from `blob:` / `data:` URLs                            |
| `html`   | `frame-src 'self'`              | embeds the bundle's `preview.html` (the page preview with scripts, sandboxed opaque)        |

**Documents with their own policy** (`csp.documents`, html only): `preview.html` runs the user's page with its scripts
(CONTRACT C15(1)), so it must never get the frame's policy, and the frame's policy must not be loosened for it. It is
served with a complete policy of its own (`csp.json` `documents[]`, first rule of `headers.json`): `sandbox
allow-scripts allow-forms allow-popups allow-modals` (opaque origin even when the file is opened directly),
`connect-src 'none'`, `form-action 'none'`, no `'self'` anywhere, scripts / styles / pictures / fonts from `https:` and
inline (the app's behaviour). `csp.ts` refuses a document policy without `sandbox`, with `allow-same-origin` / top
navigation / escaping popups, naming `'self'`, or opening `connect-src` / `form-action`. **A host must serve
`<version>/preview.html` with `documents[].value`, not with `value`**; served with the frame policy the preview's boot
script is blocked and the frame falls back to the static preview (`web/e2e/html-web.spec.ts`).

A module may not widen `frame-ancestors`, `connect-src`, `default-src`, `base-uri` or `form-action` (deployment decisions,
`WEB_DOCS_CSP_*` knobs), and `'unsafe-eval'` is refused (`csp.ts`, `modules.test.ts`).

```
dist-web/<module>/<packageVersion>-<gitSha>[-dirty]/
  index.html          entry; every URL is relative (base './'), no <meta> CSP
  assets/*.js|css     hashed bundle (initial download)
  fonts/*.woff2|ttf   hashed font faces, fetched one by one on demand (never in the initial download)
  manifest.json       what is in the build (below)
  preview.html        html only: the sandboxed page preview (Vite public dir), served with its own policy
  csp.json            the Content-Security-Policy the frame needs (+ `documents`: per-file policies)
  headers.json        response headers per path (CSP on index.html, immutable cache on assets/fonts)
```

## manifest.json (consumed by the host sync script)

| field                                          | meaning                                                                                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                                | `1`                                                                                                                                                 |
| `module`                                       | the editor the bundle runs: `docs`, `pdf`, `markdown`, `html`, `slides`, `sheets` (additive; readers that predate it ignore it)                     |
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

- Any prefix or origin: `/office-frame/<module>/<version>/index.html`, a subdomain root, ... (relative URLs; checked by
  `web/measure/measure-b3.mjs` loading the build under a sub-path).
- Send the `headers.json` rules: `Content-Security-Policy` **as a header** on `index.html` (`frame-ancestors` is ignored in a
  `<meta>`), `Cache-Control: public, max-age=31536000, immutable` for `assets/**` and `fonts/**` (hashed names, version-named
  directory), `no-cache` for `index.html`, `nosniff` + `Referrer-Policy: no-referrer` everywhere. `source` is a path relative
  to the version directory (`/index.html`, `/assets/**`, `/**`); first match wins per header name.
- Serve fonts with gzip/brotli only if the host compresses `.ttf`; the `.woff2` files are already compressed.
- `web/server/server.mjs` does all of this for local runs and tests (`MOUNT=`, `COMPRESS=gzip`, `DIST_DIR=`), and serves
  every module build at `/office-frame/<module>/<version|latest>/` with that build's own `headers.json`.
- dev-uniwork's `office-frame-sync.mjs` reads a version directory (or a directory whose only child is one): for docs
  `OFFICE_FRAME_SOURCE=dist-web/docs` keeps working unchanged; per module it is `dist-web/<module>`.

## CSP (`web/docs/build/csp.ts`)

`default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self';
connect-src 'self'; worker-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self';
frame-ancestors 'self'`. The reason for every source is in the file header; `web/e2e/csp-header.spec.ts` opens, edits, uses the
font picker and saves under this exact header and fails on any `securitypolicyviolation`.

- Clipboard data: URLs: `connect-src` has no `data:` on purpose; `bridge/browser.ts` decodes `data:` URLs by hand instead of
  `fetch(dataUrl)`.
- Opened document bytes: the renderer reads `OpenFileResult.dataUrl` with `fetchDocBytes()`
  (`apps/docs/src/renderer/doc-bytes.ts`). On desktop that is a fetch of the main process's one-shot handoff URL; a
  `blob:` object URL would need `blob:` in `connect-src`. Instead `bridge/doc-handoff.ts` mints an in-page
  `uniwork-handoff:` handle and registers a resolver that `fetchDocBytes()` consults before `fetch()`, so the bytes
  never cross a fetch and `connect-src` stays `'self'` (no `blob:`, no `data:`). Desktop registers no resolver and is
  unchanged.
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
- An `@font-face` `src` list that offers a WOFF2 keeps only that entry (`keepWoff2Only`): KaTeX (markdown) ships each
  face as woff2 + woff + ttf and only the WOFF2 files are emitted. No-op for the Docs CSS.

## Other knobs

`WEB_MODULE` (the module, as `--module`), `WEB_DOCS_VERSION` (override the whole version string), `WEB_DOCS_GIT_SHA`
(builds without `.git`), `WEB_DOCS_OUT_DIR` (one module only, refused with `--all`),
`WEB_DOCS_SOURCEMAP=1` (emit sourcemaps, off by default: ~12 MiB the host does not serve).

## Tests

`npm run test:web` runs the protocol, bridge and build vitest suites; `npm run typecheck:web` the protocol, bridge, build
and `web/modules` tsconfigs (both run in CI, `.github/workflows/ci.yml`).
`npx playwright test -c web/e2e modules-smoke` boots every built module in the test host (`/test-host/?module=<m>`):
handshake with the right module, renderer mounted, no console error / page error / CSP violation (`E2E_MODULES=pdf,...`
for a subset).
`npx vitest run --root web/docs/build` (manifest, CSP, version, font rewrite + woff2 freshness),
`npx playwright test -c web/e2e` (needs `npm run build:web` first; the specs open documents through the protocol test host at `/test-host/`, `csp-header.spec.ts` fails on any CSP violation),
`node web/measure/measure-b3.mjs --before-dist <old-pipeline build> --before-desc "..."` (writes `web/measure/measurements-b3.{md,json}`; `measurements-b3-vs-spike.*` is the earlier run against the UNI-1011 spike build).
