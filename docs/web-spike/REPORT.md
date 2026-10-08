# UNI-1011 — Docs renderer on the web (GO-B1 spike) — REPORT (draft by W8)

Status: **DRAFT**. Numbers and evidence below are measured (raw data: `measurements.json`, tables: `measurements.md`,
scripts: `web/measure/`). Sections marked `TODO(lead)` are for the lead to merge from W2/W3 (inventory), W4–W6 (shim) and
W7 (e2e) results. Sizes are in MiB/KiB (1024-based) unless a figure says bytes.

Measured build: `web/docs/dist` as built 2026-10-08 13:32 (`index-BiIBU1io.js`, includes the W4/W5/W6 shims),
`npm run build:web` = `vite build --config web/docs/vite.config.ts`, served by `web/server/server.mjs`
(no compression, `Cache-Control: no-store`), Chromium 151 headless, 4-CPU box (numbers are for this box; use them for
ratios, not as SLAs).

## 1. Summary

- The unmodified Docs renderer (`apps/docs/src/renderer`, ~65 files importing docx-engine) builds with plain Vite as a
  static web app and boots in a browser once a ~1k-line bridge (`web/docs/bridge/*`) provides `window.desktop` /
  `window.projectApi`. No renderer source was changed.
- Cold load on this box: **editable doc in 0.59 s (simple), 0.67 s (kitchen-sink), 1.0 s (50-page long doc)**, median of 5
  cache-disabled runs each, 0 page errors, 0 failed requests.
- Payload is dominated by fonts and by one 3.6 MiB JS chunk: total dist **17.85 MiB raw / 11.65 MiB gzip / 10.72 MiB brotli**
  (JS 3.64 MiB raw → 1.11 MiB gzip / 0.87 MiB brotli). Only a subset of fonts is fetched on first load
  (5.1 MiB raw by editable, 7.5–8.1 MiB settled for CJK docs).
- 72 `DesktopApi` members + 10 `projectApi` members are reachable from the renderer: 26 need a server (WEB-API),
  20 are plain browser features (BROWSER), 26 are desktop-only and become no-ops (HIDE), +10 projectApi → 36 server-backed
  calls in total.
- **Recommendation for GO-D2: embed in a same-origin iframe and talk to the host over `postMessage`** (section 6). The renderer owns
  `html`/`body`/`:root`, writes `data-theme`/`lang`/classes on `<html>`/`<body>`, ships 144 `@font-face` rules, writes
  window globals, uses unscoped `localStorage` keys, and relies on `window.print()` — all of that is safe inside an
  iframe and hostile to a host page.
- Estimate for GO-B3 (real bridge on UniWork APIs): **~4–5 engineer-weeks**, biggest risk = server-side PDF export fidelity
  (section 7).

## 2. What works

Verified by my cold-load runs (`web/measure/load.mjs`, 15 runs, 3 docs, all 15 reached "editable"):

- `?open=/fixtures/<name>.docx` opens `simple.docx`, `kitchen-sink.docx`, `long.docx` (50 chapters × 8 paragraphs + 5 tables) and
  renders them in a visible `.ProseMirror[contenteditable=true]`.
- Zero `pageerror`, zero failed network requests in all 15 runs.
- Fonts are lazy: the 33 bundled font files (14.0 MiB) are fetched on demand; only Carlito ×3 + Noto Sans CJK SC were requested
  for the kitchen-sink doc.

TODO(lead): merge W7 results (`docs/web-spike/screenshots/results.json`): type / bold / insert table / save / reopen per
document. At the time of this draft the W7 results file was still being written, with `saved-xml` and `reopen` steps failing
in an early run and Ctrl+B needing the ribbon button — do not quote these until W7 finishes.

TODO(lead): W4–W6 shim behaviour summary (what each BROWSER / WEB-API / HIDE method does in the web build) — see headers of
`web/docs/bridge/{browser,webapi,ai,hide}.ts` and `docs/web-spike/hide-flags.md`.

## 3. What breaks on the web, and why

Taken from the inventory (`bridge-inventory.md`) and `hide-flags.md`; summarised, not re-derived:

| Area | Why it cannot work as-is in a browser | Web answer |
|---|---|---|
| File open/save by absolute path (`openDocxPath`, `saveDocx*`, `getRecentFiles`) | Renderer passes local file paths; the browser has none | Server file ids (`/api/files`), section 8 |
| PDF export / print (`exportPdf`, `printPdfBuffer`, `saveMergedPdf`) | Desktop uses `webContents.printToPDF` at custom page sizes; browser print is lossy and only prints the current document | Server-side headless render (section 8); `window.print()` as fallback (only valid in an iframe, section 6) |
| AI (`aiStream`, `webSearch`, `imageSearch`, `fetchImage`, `aiGenerateImage`, `getAiSettings`) | Provider keys and SSRF-guarded fetches live in the Electron main process | UniWork ai.Gateway endpoints |
| `convertAltChunkHtml` | html→docx runs in a hidden Electron window | server endpoint or skip altChunk |
| Attachments (`addAttachmentPaths`, `getPathForFile`, `addPastedImage`) | `File` objects have no disk path | upload the `File`, server returns attachment metadata |
| Multi-tab / shell chrome (`openNewTab`, `listDocsTabs`, `focusDocsTab`, menu, close-check, Zotero, doc passwords, recovery copy) | No Electron shell | HIDE no-ops; per `hide-flags.md` **7 members have no renderer flag, so their UI stays visible** and needs a small renderer change (`zoteroCommand`, `setDocPassword`, `openNewTab`, `listDocsTabs`, `focusDocsTab`, `getAutoSaveDefault`, `createDocument`) |
| Encrypted (CFB) docx | `openDocxDecrypt` is main-process | web falls back to a blank document (no password prompt) — product decision needed |

TODO(lead): any additional breakages W7 found (reopen, save round-trip, console warnings in
`docs/web-spike/screenshots/console-*.txt`).

## 4. Bridge classes with counts

From `docs/web-spike/bridge-inventory.json` (W2 A–L + W3 M–Z + projectApi):

| | WEB-API (needs UniWork server) | BROWSER (plain web API) | HIDE (desktop-only, no-op) | total |
|---|---|---|---|---|
| `window.desktop` (DesktopApi) | 26 | 20 | 26 | **72** |
| `window.projectApi` | 10 | 0 | 0 | **10** |

- Members never called by the renderer: `aiChat`, `fontMetrics`, `setAiSettings`.
- `window.projectApi` is used only from `ai/AiPanel.tsx` (4 call sites; chat persistence).
- The bundle reads `window.desktop` 81 times and `window.projectApi` 3 times (`css-evidence.json`).
- The bridge's catch-all `Proxy` (`install.ts`) makes every unimplemented method a safe no-op, so a missing mapping never throws.

WEB-API: `addAttachmentPaths addPastedImage aiChat aiGenerateImage aiGskStatus aiStream aiStreamCancel consumePendingOpenDocx
convertAltChunkHtml createDocument exportPdf fetchImage getAiSettings getRecentFiles imageSearch onAiStream onRenamedDocx openDocx
openDocxPath printPdfBuffer readAttachment saveDocx saveDocxAs saveDocxNew setAiSettings webSearch`.

TODO(lead): re-check these counts against the final `bridge-inventory.json` (W2/W3 were still merging when this was drafted).

## 5. Size / time numbers

Full tables: `measurements.md`. Headlines:

**Bundle** (`web/measure/bundle-size.mjs`; gzip = zlib level 9, brotli = q11, per file, sourcemaps excluded):

| | raw | gzip | brotli |
|---|---|---|---|
| total (37 files) | 17.85 MiB | 11.65 MiB | 10.72 MiB |
| fonts (33 files) | 14.01 MiB | 10.51 MiB | 9.82 MiB |
| JS (1 chunk, `index-*.js`) | 3.64 MiB | 1.11 MiB | 0.87 MiB |
| CSS (1 file) | 196 KiB | 33 KiB | 28 KiB |
| everything except fonts | 3.84 MiB | 1.14 MiB | 0.90 MiB |

- There is **one JS chunk** (no code splitting): the biggest chunk is the whole app. Biggest file overall is the JS
  (3.64 MiB); the next are `NotoSerifCJKsc` (3.33 MiB) and `NotoSansCJKsc` (2.42 MiB) woff2.
- woff2 files do not compress further (gzip ≈ raw); the TTF files (Carlito/Liberation/Caladea) do (~50%).
- Composition of the biggest JS chunk (method: **sourcemap VLQ decode**, bytes attributed to the originating source by
  segment span, grouped by package; `source-map-explorer` is not installed and was not run):
  `apps/docs/src/renderer/i18n` **35%** (1.28 MiB — all locales eagerly bundled), `packages/docx-engine` 12%, renderer
  `editor` 9%, `components` 8%, renderer root 6%, `react-dom` 5%, `ai` 4%, `jszip` 3%, `prosemirror-view` 3%,
  `@tiptap/core` 2%.
  → cheap win: lazy-load i18n shards per locale (~1.2 MiB raw JS off the critical path).

**Cold load** (`web/measure/load.mjs`, 5 runs per doc, fresh context, cache disabled; median (min–max)):

| doc | DOMContentLoaded | time-to-editable | JS heap after editable | heap after forced GC | transferred by editable / settled |
|---|---|---|---|---|---|
| simple.docx | 331 ms (322–343) | **590 ms** (574–676) | 10.6 MiB | 8.2 MiB | 5.10 / 7.51 MiB |
| kitchen-sink.docx | 316 ms (311–350) | **667 ms** (641–755) | 11.6 MiB | 9.2 MiB | 5.69 / 8.11 MiB |
| long.docx (50 pages) | 315 ms (306–338) | **1006 ms** (988–1019) | 21.1 MiB | 11.9 MiB | 5.10 / 5.10 MiB |

Notes: time-to-editable = first visible `.ProseMirror[contenteditable=true]` containing the doc's known text (same selector/text
check as `web/e2e/docs-web.spec.ts`), measured in-page from navigation start. Transfer is uncompressed because the spike
server does not compress; with gzip/brotli the non-font first-load payload would be ~1.1 / 0.9 MiB and the
kitchen-sink first-load set (8.1 MiB raw) ~4.4 / 3.9 MiB (woff2 CJK dominates and does not compress). `long.docx` was served via a Playwright route from
`web/fixtures/long.docx` because `web/server/server.mjs` only serves `fixtures/generated/` (4.6 KB; negligible).
The CJK docs download Noto Sans CJK on demand, which is why their settled transfer is larger.

## 6. Recommendation for GO-D2: same-origin iframe + `postMessage` vs. mount in the host page

**Recommend: same-origin iframe** (`<iframe src="/docs/?file=<id>">`) with a small `postMessage` protocol for host↔renderer
(open/save/title/dirty/theme). Evidence from the built output (`web/measure/css-evidence.mjs`, `css-evidence.json`):

1. **Global CSS.** The 196 KiB stylesheet has 1,740 selectors, 874 class names and 220 custom properties. It contains
   9 `:root` rules (theme tokens plus `:lang(ja|ko|zh-TW)` variants), a bare `html` rule, a bare `body` rule, `html[data-ai-font-size] …`,
   `html.genoffice-popover-open …`, `body.docs-crop-active …`, a universal `*` rule, and un-namespaced element rules (`button`, `h2`–`h5`,
   `th`, `tr:not(…)`); generic class names `.app` and `.modal` are shipped without a prefix. Theming works through
   `[data-theme=dark]` on `<html>` (`main.tsx:26`). Mounted in a host page, every one of these would restyle (or be restyled by)
   the host; there is no Shadow DOM/CSS-modules isolation. Inside an iframe they are scoped by construction.
2. **Window / document globals.** The renderer writes `window.__exportPdf`, `__openPagePreview`, `__pageDebug`, `__aidocs`, reads
   `window.desktop` (81×) and `window.projectApi`, sets `documentElement.lang`, `documentElement` classes and `data-theme`, and toggles
   `document.body` classes/styles (`docs-crop-active`, `cursor`/`userSelect` while resizing the AI panel). The bundle registers
   60 `window.addEventListener` and 8 `document.addEventListener` handlers and touches `document.body`/`documentElement` 26×.
   `window.desktop` itself would have to be a host-global in the mount model.
3. **Storage.** 23 `localStorage` reads/writes under unscoped keys (`aidocs.showAi`, `aidocs.spellcheck`, `aidocs.pasteFromOtherApps`,
   `aidocs.marginLastCustom`, `docs-ai-panel-width`, `docs-ai-rewrite-ack`, track-changes key). A same-origin iframe still shares
   `localStorage` with the host, so serve the iframe from its own origin/subdomain if isolation matters (then the `postMessage`
   channel is the *only* coupling — preferable for GO-D2).
4. **CSP.** `web/docs/index.html` carries the CSP as a `<meta>`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
   img-src 'self' data: blob:; font-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self' http://localhost:* ws://localhost:*`.
   A meta CSP governs only its own document, so it is **lost when the renderer is mounted** in a host page — the host's CSP would
   have to be loosened to `style-src 'unsafe-inline'` + `blob:`/`data:` for fonts/images, and the spike's `http://localhost:*`
   in `connect-src` must be replaced by the real API origin. In an iframe the renderer keeps its own tight CSP (deliver it as an HTTP
   header, with `sandbox="allow-same-origin allow-scripts allow-downloads allow-modals"` if the host wants more).
5. **Fonts.** 144 `@font-face` rules over 54 families. Generic names that can collide with a host page or with locally-installed
   fonts: `Caladea`, `Liberation Serif/Sans/Mono`, `Noto Sans CJK SC`, `Noto Serif CJK SC`, `Noto Naskh Arabic`, `Noto Sans Arabic`
   (the rest are suffixed — `… GO`, `GenOffice …`). `document.fonts` is used 16×; mounted, all of this lands on the host's `document.fonts`
   and bundles 14 MiB of faces into the host's font namespace.
6. **Print / PDF.** The web fallback for `exportPdf`/`saveMergedPdf` is `window.print()`; in an iframe this prints only the document
   (`iframe.contentWindow.print()`), mounted it would print the whole host page.
7. **Cost of the iframe.** Separate JS realm → the 3.64 MiB bundle and its ~9–12 MiB heap are per iframe (fine for one editor per page; budget
   it if a host page can show several). Clipboard/file-drop/focus need explicit forwarding; drag-and-drop across the boundary needs
   `postMessage` plumbing. Auto-sizing needs a `resize` message. None of these is a blocker.

When *mount in page* would be right: only if the host needs shared React/ProseMirror instances or in-page deep integration
(comments sidebar owned by the host). The evidence above says that would first require namespacing all CSS, replacing
the `<html>`/`<body>` theming hooks, scoping storage keys and moving the CSP — a refactor of `apps/docs`, not a bridge.

## 7. Estimate for GO-B3 (real bridge against UniWork APIs)

Estimate, not measurement — assumes the endpoints in section 8 exist on the UniWork side and one engineer familiar with the
renderer; roughly:

| Work item | Estimate |
|---|---|
| Replace `FakeBackend` with `/api/files` (open/save/create/recent, ETag/`If-Match`, session auth) + `?file=<id>` routing | 4–5 d |
| iframe host component + `postMessage` protocol (open, save, dirty, title, theme, language, resize, print) | 3 d |
| AI gateway wiring (`aiStream` SSE + cancel, settings/entitlement, web/image search, `fetchImage` proxy, image generation) | 4–5 d |
| Attachments upload + `projectApi` over `/api/projects`, `/api/chats` | 3–4 d |
| Server-side PDF export (headless Chromium, custom page sizes, merge) | 4–6 d — **biggest risk**: page-accurate pagination output and font parity |
| Renderer hardening: 7 members with no HIDE flag (UI stays visible), lazy-load i18n, gzip/brotli + immutable caching + font strategy, CSP as header | 3–4 d |
| Tests/e2e on real backend (reuse W7 specs), a11y/IME/paste checks | 3–4 d |

Total **~24–31 working days ≈ 4–5 engineer-weeks**. Largest uncertainties: PDF fidelity, encrypted-docx product decision, and
whether HIDE-class UI needs renderer changes (touching `apps/**`, which the spike forbade).

## 8. What a UniWork API must provide

Compiled from the header tables of `web/docs/bridge/webapi.ts` and `web/docs/bridge/ai.ts` (endpoint paths are
**proposals** — no UniWork contract exists yet).

**Files / documents** (`webapi.ts`)

| Renderer call | Endpoint + payload |
|---|---|
| `openDocx` (file picker) | `POST /api/files` multipart `{name, bytes}` → `{id,name,size,mtime}`; then `GET /api/files/:id/content` |
| `openDocxPath(id)` | `GET /api/files/:id` + `GET /api/files/:id/content` (bytes, ETag) |
| `consumePendingOpenDocx` | none — URL `/docs?file=<id>` → `GET /api/files/:id/content` |
| `saveDocx(path,data,auto)` | `PUT /api/files/:id/content` body bytes, `If-Match: etag` → `{mtime,etag}`; `412` → reason `external-modified` |
| `saveDocxAs` / `saveDocxNew` | `POST /api/files {name, folderId?}` + content → `{id}` (server picks folder + unique name for `New`) |
| `getRecentFiles` | `GET /api/files/recent` → `[{id,name,path}]` |
| `exportHtml` | optional `POST /api/files {name:.html}` (otherwise a Blob download) |
| `exportPdf` / `printPdfBuffer` | `POST /api/export/pdf {fileId | html, pageWidthTwips, pageHeightTwips, scale}` → PDF bytes (headless Chromium) |
| `saveMergedPdf` | `POST /api/export/pdf/merge {parts[]}` → PDF bytes |

**Projects / chat persistence** (`projectApi`)

`POST /api/chats/resolve {filePath|fileId, tempChatId?}`; `POST /api/projects/:pid/chats/:cid/messages {role,text,tools?,attachments?,scope?}`;
`GET …/messages?limit=N`; `POST …/chats/:tempCid/rebind`; `GET/POST /api/projects`; `PATCH/DELETE /api/projects/:id`;
`PUT /api/files/:id/project {projectId}`; `GET /api/projects/:id/timeline?limit=N`.

**AI gateway** (`ai.ts`)

| Renderer call | Endpoint (proposed) |
|---|---|
| `aiStream` (chunks `delta|reasoning|tool-call|ping|done|error`, exactly one terminal chunk per request) | `POST /api/ai/stream` (SSE, one event per chunk) |
| `aiStreamCancel` | `DELETE /api/ai/stream/:requestId` or close SSE (server must emit `done`, not `error`) |
| `aiChat` (uncalled today) | `POST /api/ai/chat` |
| `getAiSettings` / `setAiSettings` | `GET/PUT /api/ai/settings` (non-secret provider/entitlement view only) |
| `aiGskStatus` | `GET /api/ai/account` → `{loggedIn, email?}` (UniWork session → plan/quota) |
| `webSearch` / `imageSearch` | `POST /api/ai/web-search`, `POST /api/ai/image-search` |
| `fetchImage` | `GET /api/ai/fetch-image?url=` (SSRF-guarded: http(s) only, no private targets, validated redirects) |
| `aiGenerateImage` | `POST /api/ai/generate-image {prompt, aspectRatio?}` → `{url?|error?}` |
| login / billing | redirect to UniWork login / billing page (not Gateway calls) |

**Cross-cutting requirements**: same-origin or CORS+credentials session auth; `Content-Security-Policy` header for the editor
document; gzip/brotli + immutable caching for hashed assets (the spike server does neither); `Content-Type` for `.docx`/`.woff2`;
upload limits for attachments; an `ETag`/revision model for save conflicts.

## 9. Reproduce

```sh
node web/measure/bundle-size.mjs      # -> web/measure/bundle-size.json
node web/measure/css-evidence.mjs     # -> web/measure/css-evidence.json
node web/measure/load.mjs             # spawns web/server/server.mjs on PORT=4182 -> web/measure/load.json
node web/measure/make-tables.mjs      # -> docs/web-spike/measurements.{json,md}
```

Caveats: loopback network (no latency/bandwidth), headless Chromium on a shared 4-CPU box while other workers were running
(timings are upper-biased, spread shown as min–max), single-chunk bundle measured as built (no compression), heap =
CDP `JSHeapUsedSize` (JS heap only, not DOM/GPU memory), `source-map-explorer` not used (composition via own sourcemap decode).
