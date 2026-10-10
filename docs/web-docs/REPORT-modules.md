# genoffice PDF, Markdown, HTML, Slides and Sheets inside UniWork web — lane report (GO-B4 + GO-B5 + GO-B6)

Tickets UNI-1014 (PDF, Markdown, HTML), UNI-1015 (Slides), UNI-1016 (Sheets), parent UNI-1001. Fork lane branch
`feature/UNI-1014-web-modules` (uniwork-office); UniWork lane branch `feature/UNI-1014-office-web-modules`
(dev-uniwork). The lane generalises the Docs frame built by GO-B2/GO-B3 (`docs/web-docs/REPORT.md`) to five more
modules and runs Docs itself through the same generic host.

Decisions not reopened here (from the B2B3 lane): same-origin iframe + postMessage (no in-page mount, no Shadow DOM);
the protocol does not use cookies (the host passes a short-lived token in `init`).

User decisions applied in this lane (lane CONTRACT numbers in brackets; all given via the Advisor on 2026-10-09):

- **No autosave on the web** [C10]: Docs and every module save only on an explicit user save.
- **GO-D3 = C** [C11]: the Sheets engine is the xlsx engine compiled to WASM in a Web Worker of the Sheets frame; a size
  cap sends bigger workbooks to the G3 xlsx editor; nothing runs server-side.
- **Flags default ON** [C14]: all six `office_*_web` flags default to true; an organization or user override turns a
  module off.
- **"Like the desktop app"** [C15]: HTML preview runs scripts and HTML visual edit is on; Slides presenter view plus an
  audience window; encrypted draft recovery for every module (Docs too). Web AI [C15(4), C16]: built on the GO-A7
  contract, shown only when the host grants it.

## Verification summary

Final state: fork code `9b5e409` (lane head, pushed), dev lane head `c66158951` (pushed), all six dev pins
`0.1.0-9b5e409`. Final SHAs are in section 9.

| Check                                             | Target                  | Result                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fork cloud CI replica, final (fresh VMs)          | `9b5e409`               | **PASS**, 3 shards, ~33 cents: `office-ci-test` pass; `office-ci-e2e` pass (Electron Playwright 176 passed, 10 skipped, 1 retry-flake `docs-spell-suggestions.spec.ts:71` in untouched Docs code; markdown config 46 passed); `web-ci` pass (typecheck:web, test:web, build:web --all, web e2e 56 passed) |
| Fork `test:web` roots (cloud)                     | `9b5e409`               | protocol 90, bridge 175, build 53, modules 156 passed + 10 env-gated skips, slides 68, pdf 44 (all passed)                                                                                                                                                                                                |
| Dev cloud r4b (`tester_cloud`)                    | `d68df2f5e`             | **PASS**: ts 9/9 (core/views/web vitest, 551 repo script tests, check-boundaries, typecheck, lint, knip, web build), go 4/4 (incl. real `TestRelay*` on Redis 7.4.2, isolation matrix, service AI/OfficeFrame), e2e 14 passed / 18 skipped / 0 failed. ~33 cents                                          |
| Dev local prod e2e with all six bundles           | `c66158951` (DP3)       | **PASS**: `office-docs-web` + `office-markdown-web` + `office-modules-web` = 29 passed / 2 expected skips (the bundle-not-installed cases)                                                                                                                                                                |
| Dev affected tests (DP3)                          | `c66158951`             | core 8, views 40, web 84, scripts 3 (exact files)                                                                                                                                                                                                                                                         |
| Code review RD (dev) / RF (fork)                  | `0b0039d37` / `11a5eba` | Both "ship after fixes": RD 0 blocker / 1 major / 5 minor / 4 nit, all fixed by FD1; RF 0 / 5 major / 7 minor / 4 nit, all majors + minors/nits fixed by FF1 (+ SH3, FD3). Section 6                                                                                                                      |
| Visual (`tester_visual`, 9 criteria, six modules) | final pins              | **pending tester_visual** (section 8)                                                                                                                                                                                                                                                                     |

Cloud rounds on the way (verdicts and costs in section 6): dev r1 PASS, r2 FAIL (one lane regression, fixed), r3 PASS,
r4 never ran (Haiku session thrashed its context), r4b PASS; fork replica rounds in MM1, MM2, MM3, final PASS.

## 1. What works, per module

Common to every module (Docs included, through the generic host):

- **One frame per module**, mounted by `OfficeModuleFrame` at `/office-frame/<module>/<version>/index.html`; the module is
  derived by the server from the stored file, never from the client. A module opens in the frame only when its bundle is
  installed and verified and its flag is on, otherwise the existing G3 host serves the file exactly as before.
- **Explicit save only** [C10]: `api.save {fileId, data, etag}`, never `auto`; every autosave key is `false` and its UI
  hidden. Save conflict dialog in every frame: Cancel / Reload latest / Overwrite (Overwrite re-reads the head etag). A
  host-initiated `save` gets the conflict in its result and owns the UI. A save whose outcome is unknown (timeout,
  network) adopts the head if its size equals what was sent (Docs rule).
- **Draft recovery** [C15(3), C18, C18a]: while a document is dirty, every 30 s (and on `pagehide`) the frame writes an
  AES-GCM encrypted copy of the current bytes to IndexedDB (`uniwork-office-frame-drafts`, store `drafts`). On reopen the
  frame offers Restore / Discard (newest decryptable record, labelled "based on an older version" if the etag differs).
  The copy never leaves the browser, is never `api.save`, never a version. It recovers after a crash, a closed tab or a
  reload, until the user signs out. Wired into Docs, Markdown, HTML, PDF, Slides and Sheets; e2e for Docs, Markdown, Sheets.
- **Open in desktop app** (GD3): every module frame header carries the G3 "Open in desktop app" split button with the
  installer menu; shown when the frame is ready and the user may edit.
- **View-only**: a user who may view but not edit (page `readonly`, or the minted token's `can_edit: false` outside Docs)
  gets the frame without save / save-as grants. The server enforces view-only on commit and uploads by ACL, so withholding
  grants is a UI matter only. Slides is the exception: a view-only user opens the G3 pptx host.
- **AI** [C16]: AI panels are hidden unless the host grants `ai` (organization entitlement + the frame-token AI mount
  live). Then every module calls the AI routes directly from the frame (section 2).
- `init.user.displayName` reaches every module (comment and note authors).

### Docs (generic host)

Behaviour is the UNI-1013 behaviour (`docs/web-docs/REPORT.md` section 1). `OfficeDocsFrame` and `DocxOpenSwitch` are thin
wrappers over the generic host, Docs files in the fork were not moved, `docs.pin.json` and the Docs URL are unchanged.
What the lane adds to Docs: draft recovery, Open in desktop app, `init.user`, AI through the frame-token mount when
granted.

### PDF (`web/modules/pdf`)

- Viewer and editor from `apps/pdf` in the frame over an in-frame **working copy** (no disk). The save pipeline is bytes
  in / bytes out behind platform seams (`apps/pdf/src/main/core-env.ts`): the desktop installs its Node/Electron seams
  unchanged, the web installs fetched `pdfium.wasm` / `hb-subset.wasm`, bundled Liberation fonts and a canvas image codec.
  A golden test (`save-core.golden.test.ts`) proves identical bytes for the desktop seams and the web seams on one
  request covering annotation delete and image transform, markups, ink/shapes/notes, form values, stamps, rotation,
  deletion, reorder and metadata. Not in the golden request: text edit/insert (fonts differ by design) and image
  insert/replace (decoders differ).
- Annotate, fill forms, page operations (insert blank, page size, crop, rotate, delete, reorder), import/replace pages
  and merge (repeated host file picks), extract/split/export images (downloads; several files as one `.zip`), Save, Save
  As, print, password prompt for encrypted files. An empty document opens as a blank A4 page.
- `verifyContentEdits` runs before the upload: a content edit that did not land fails the save and nothing is uploaded.
- Saved signatures are encrypted per user (section 5).
- Playwright `pdf-web.spec.ts` on the production build: 10/10 (annotate + form → save → conflict → overwrite → reopen →
  rotate/delete → import → Save As → print; view-only), 0 CSP / console errors on text, scanned (JPEG), embedded-font,
  AcroForm and encrypted fixtures.

### Markdown and HTML (`web/modules/markdown`, `html`, `shared`)

Both run on one shared text-module bridge (UTF-8 codec that keeps BOM, line endings and the final newline; open → save
without edits returns the input bytes, proven for a BOM + CRLF + raw-HTML fixture).

- **Markdown**: raw HTML blocks and comments are kept byte-identically on save and shown as escaped text, never rendered
  (lane M0, "option C": main's inline mark mapping for schema tags, opaque nodes for the rest). Mermaid diagrams render
  through `<img src="data:image/svg+xml,...">`. Pasted pictures go to the document's assets through `api.images.upload`
  when the host grants `images`, else are embedded as data: URIs; relative images resolve through `OpenPayload.assets`.
  A file that is not valid UTF-8 opens view-only (saving the decoded text would rewrite it). Two Markdown behaviours
  changed on the desktop too, on purpose (RF-11): raw HTML kept verbatim and Mermaid as `<img>`; listed in
  `docs/upstream/UPSTREAM_SYNC.md`.
- **HTML, like the desktop app** [C15(1)]: the preview runs the page's scripts in the bundle's `preview.html`
  (`sandbox="allow-scripts allow-forms allow-popups allow-modals"`, no `allow-same-origin`, `credentialless`) under a
  header policy of its own; **visual edit** (inspector click-to-select, float toolbar, style panel, inline text edit,
  resize/reorder) is on with the host's `save` grant. If `preview.html` does not acknowledge within 8 s the frame falls
  back to a static `sandbox=""` copy (no scripts, handlers, refresh, `<base>`, remote loads). Print always uses the static
  copy. A page that reloads itself (`location.reload()`, `<meta refresh>`) is re-sent its copy and does not go blank.
- Print (host `print`) is the PDF path for both; no server route.
- Playwright on production builds: markdown-web 6/6, html-web 7/7 at first and 9/9 with the preview scripts,
  html-preview-security (hostile document; section 5), 0 console / CSP errors, 0 off-origin requests.

### Slides (`web/modules/slides`)

- The Slides engine used to live in Electron main (`slides-main.ts`, 4,756 lines, 140 handlers). Lane S1 moved the
  session core into `apps/slides/src/session` behind a typed HostIO seam (`slides-main.ts` 4,756 → 1,897 lines) with a
  180-step characterisation harness pinned byte-identical before and after. The frame runs that core on its main thread
  behind a complete `window.slidesApi` (181 methods + 6 desktop + 10 projectApi, a new preload method is a build error).
- Open / edit / save with etag and conflict dialog, Save As, undo/redo, clipboard, media as `blob:` URLs. PNG-zip and
  image-per-page PDF export run in the frame, print through the desktop print document in a hidden `srcdoc` frame.
  Legacy `.ppt` and encrypted `.pptx` get a fatal notice and every save is refused; a 0-byte file opens as a blank deck;
  external linked media show their poster only. Parity test: the same editing scenario saved by the desktop core and by
  the frame gives identical package entries (the zip container differs by design).
- **Presenter view and audience window, like the desktop app** [C15(2)]: the presenter view (current + next slide, notes,
  timer, pen/laser, black/white screen, film strip) opens an **Audience Window** (`window.open` of the frame's own
  `index.html?mode=audience`) over a private `MessagePort` after a validated handshake. The audience mirrors slide index,
  builds, media state, black/white, end of show and ink, and sends navigation back. The Window Management API places
  and swaps the window across screens when the user grants it; otherwise a 960×540 window to drag. The first audience
  click enters fullscreen (browser rule). Closing the audience keeps the presenter running.
- Fonts: Carlito (the Calibri twin) as WOFF2, canvas `measureText` metrics. Fidelity against the engine's own metrics on
  two decks: same line breaks on the Calibri deck, mean run width drift 1.01 % (max 3.02 %); CJK/emoji deck mean 4.73 %
  (the reference has no font file for those runs).
- Size at the final lane (S3 + later): initial 3.73 MiB / 1.09 gzip after the lazy AI split; final pin 19 files, 5.47 MiB
  unpacked, 4.15 MiB initial download.

### Sheets (`web/modules/sheets`)

- The xlsx engine (`apps/sheets/native/xlsx-engine`) runs as a `wasm32-wasip1` reactor in a same-origin module Worker
  (`worker-src 'self'`, no `blob:`), on `@bjorn3/browser_wasi_shim` 0.4.2 (pinned, two fixes) with an in-memory `/tmp`.
  Open, scroll streaming (256-row chunks), formulas, pictures, pivot definitions, `.xls` conversion, save (gateway planner
  - `save_archive`, manifest checks) and CSV export run in the frame. A 0-byte document opens a blank workbook.
- **Cached formula values at save**: the cells the user typed are recalculated through the engine's `recalc_cells` and
  written as `<v>` next to the untouched `<f>`; a formula typed at W15000 of a 20k-row workbook is saved, reopened by the
  host and shown (e2e).
- **View-only locks the grid** (a `BeforeCommandExecute` guard; `setEditable(false)` was rejected because it blocks the
  loader's own streamed writes). **Wasm panic recovery**: the Worker is rebuilt and sessions reopen from their last
  opened/saved bytes under the same renderer session id, with a toast; the renderer's unsaved edits are kept.
- **Sheets AI** is on (SH4): the shared web AI bridge, host grant mapping, AI settings gear; four desktop-only members of
  the desktop Sheets AI stay hidden (`createDocument`, `readLocalImage`, `openWorkbooksForMerge`, `autoRenameWorkbook`).
- Size: initial 2.46/0.66 MiB raw/gzip after an `App` split (scaffold: 10.44/2.91); final pin 219 files, 26.78 MiB
  unpacked, 3.28 MiB initial download; wasm 5.07 MB (1.70 MB gzip); Carlito WOFF2 389 KB (TTF 1,318 KB).
- Workbooks above the cap open in G3 (section 3).

## 2. Architecture

**One protocol, additive fields** [C1]. `web/docs/protocol` stays the single protocol: `ns` `uniwork.office.docs` and
`PROTOCOL_VERSION = 1` unchanged. Optional additions, all documented in `web/docs/protocol/README.md`:

- `OfficeModule = 'docs' | 'pdf' | 'markdown' | 'html' | 'slides' | 'sheets'`; `ready.module` and `init.module` (absent =
  docs, so a pre-module Docs frame and host keep working). `checkFrameModule` runs on every `ready` before `getInit()`, so
  no token is minted for the wrong editor; a mismatch is a typed `malformed`.
- `init.user {displayName}`; `OpenPayload.assets` (relative resources of a text document → same-origin URLs);
  `init.recovery {key, scope}` (draft recovery); new optional capability keys (absent = false on the host grant side),
  including the AI keys `ai`, `aiCredentials`, `webSearch`, `imageSearch`, `imageGeneration`.

**One bridge** [C2]. The generic pieces of `web/docs/bridge` (protocol client wiring, host theme/locale, browser
print/download/`window.open` guard, capability object, safe-no-op Proxy, `installModuleBridge`, draft-recovery store and
prompt) are shared; per-module code lives in `web/modules/<module>/`. Every preload global is typed with `satisfies` against
the desktop contract, so an upstream preload method is a compile error in the web build until it is implemented or hidden.

**One build, per module** [C3]. `npm run build:web -- --module <m>` (or `WEB_MODULE=<m>`; default docs, Docs output
byte-equal to B2B3) writes `dist-web/<module>/<pkgver>-<sha>/` with `manifest.json` (gains `module`) and a per-module
`csp.json`; `build:web:all` builds every module. Same font/WOFF2/never-inline rules. The Sheets wasm is built by
`build:web` (pinned toolchain, vendored zip without C features, checksum-verified cache, no binary in git).

**Per-module CSP** (`web/docs/build/csp.ts`, `modules.ts`). Every module keeps `default-src 'none'`, `connect-src 'self'`,
`base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'self'`; modules cannot widen those, and `'unsafe-eval'` is
refused for modules. Additions: `script-src 'wasm-unsafe-eval'` in **pdf** (pdfium + pdf.js codecs) and **sheets** (xlsx
engine) only, also sent on `/assets/**` for the worker scripts, and pinned by a test (FF1); **slides** `media-src blob:`;
**html** `frame-src 'self'` plus a **per-document policy** for `preview.html` (below). The slides e2e asserts that
`wasm-unsafe-eval` is absent.

The HTML preview's per-document policy (`csp.json` `documents[{path, value, directives}]`): `sandbox` repeated in the
header (scripts, forms, popups, modals; no same-origin, no top navigation), `connect-src 'none'`, `form-action 'none'`,
no `'self'`, `https:` + inline scripts/styles/pictures/fonts. The registry refuses a document policy that is not that
sandboxed kind; the host pin verifier does the same.

**Dev-uniwork host: pins, sync, headers** [C4].

- One pin per module, `apps/web/platform/office-frame/<module>.pin.json` (all six checked in; the `html` pin also carries
  `documents`). `office-frame-sync.mjs --module <m>` / `--all`; `OFFICE_FRAME_SOURCE` is a `dist-web` root holding
  `<module>/<version>/`, or a tarball of it (the docs-only layout keeps working). Installs go to
  `public/office-frame/<module>/<version>/`, verified file by file.
- Headers: every `/office-frame/**` path first gets the locked-down policy (`default-src 'none'; frame-ancestors 'self'`),
  then each module's rule gives `/office-frame/<module>/**` its pinned CSP and headers; one module's pin never reaches
  another's paths. `preview.html` gets its own rule with the document policy.
- Installed versions are exposed as one map, `NEXT_PUBLIC_OFFICE_FRAME_VERSIONS` (the Docs variable still works).
- Archive limits (64 MiB archive, 160 MiB unpacked, 2,000 entries) hold with ~2x headroom for six builds: 31.8 MiB as a
  tarball, 72.4 MiB unpacked, 644 entries.

Final pins (all `0.1.0-9b5e409`):

| module     | files | unpacked  | gzip      | initial download | CSP beyond the shared policy                    |
| ---------- | ----- | --------- | --------- | ---------------- | ----------------------------------------------- |
| `docs`     | 46    | 16.73 MiB | 11.68 MiB | 4.92 MiB         | none                                            |
| `pdf`      | 229   | 13.70 MiB | 7.02 MiB  | 1.76 MiB         | `script-src 'wasm-unsafe-eval'`                 |
| `markdown` | 90    | 7.90 MiB  | 2.55 MiB  | 2.80 MiB         | none                                            |
| `html`     | 7     | 1.73 MiB  | 0.57 MiB  | 1.72 MiB         | `frame-src 'self'` + `documents[/preview.html]` |
| `slides`   | 19    | 5.47 MiB  | 2.25 MiB  | 4.15 MiB         | `media-src blob:`                               |
| `sheets`   | 219   | 26.78 MiB | 7.64 MiB  | 3.28 MiB         | `script-src 'wasm-unsafe-eval'`                 |

**Flags and the token module claim** [C5, C14]. One flag per module, following the per-format precedent: `office_docs_web`
(unchanged), `office_pdf_web`, `office_markdown_web`, `office_html_web`, `office_slides_web` (pptx), `office_sheets_web`
(xlsx). All default **true** (ReviewAt 2026-12-05 kept), evaluated per organization. `POST /documents/{id}/office/frame-token`
derives the module from the stored file (extension first, then the verified content type) and puts it in the token claim
`m` (absent = docs, so pre-module tokens stay valid; an explicit `"m":"docs"` or an unknown module is refused). Every
`/api/v1/office-frame/*` route evaluates the flag of the **token's** module for the token's organization inside the
frame-auth middleware (off → 404 `feature_disabled`; at mint → 403). A signed asset URL (`?sig=`) carries `m` too (RD
finding, fixed). Open, mint and commit answers carry `module`, and the host refuses a minted module that differs from the
frame it mounts. `Authorize` rejects a token whose document's current version is no longer of the token's module. Routes
stay generic; `export/pdf` is the Docs renderer and answers 501 `unsupported_operation` to any other module's token (the
frame prints in place).

**`OfficeModuleFrame` / `OfficeModuleOpenSwitch`** (`packages/views/office/frame`) are the generic host pieces over one
module table (`officeModuleSpec(module)` in `packages/core/office/office-modules.ts`, cross-checked against the Go table
by `scripts/office-modules.test.mjs`). Capability grants come from that table: Docs keeps its UNI-1013 grant; pdf, slides,
sheets get save, save-as, print; markdown and html also `exportHtml`; recents, file pick and attachments stay off outside
Docs; only Docs has the server PDF export.

**G3 fallback rules.** The G3 host serves the file, unchanged, whenever:

1. the module's pinned bundle is not installed and verified (`pinnedFrameVersion` empty; nothing is asked of the server);
2. the module's flag is off (switch) or the mint answers `feature_disabled` (refusal path);
3. the xlsx file is larger than **10 MiB stored** (host gate from `file.size_bytes`, enforced again at mint: 413
   `too_large` after the ACL check) or the Sheets frame refuses an open above **80 MB of uncompressed worksheet XML**
   (`MAX_WORKSHEET_XML_BYTES`, fatal `too_large` → G3);
4. a view-only user opens a pptx (`viewOnlyInG3`);
5. the minted module differs from the frame (`malformed`).

Formats with no web module (xls, odt, ...) always use G3.

**Frame-token AI mount** [C16, built by AI2 on GO-A7's handlers]. The frame calls the AI routes itself, same origin, with
`Authorization: Bearer <frame token>` and `credentials: 'omit'` (no postMessage relay): `/api/v1/office-frame/documents/{documentID}/ai/…`
(credentials GET/PUT/DELETE with masked `key_hint`; `byok/{provider}/chat/completions|messages|generate` and `models`;
`cloud` GET and `search|images|media/analyze|transcribe`). Each request passes frame auth (frame token only; the token's
document must be `{documentID}`; the token module's flag on), the same per-person rate buckets as the session routes
(keyed by the token's user), a per-request recheck that the user may still view the document, and GO-A7's services
(membership, `office.ai_byok` / `office.ai_cloud`, credits, audit). The BYOK stream is passed through byte for byte. Errors
map to typed UI states: 402 `credits_exhausted`, 403 `entitlement_required`, 404 `credential_missing`, 424
`provider_auth_failed`, 429, 502, 503 `cloud_unavailable`. The frame-token answer carries the grant
(`ai`, `web_search`, `image_search`, `image_generation`); the host maps it to capability keys for all six modules
(`officeModuleSpec(m).ai`). Without the grant every AI entry stays hidden.

**GO-A6 (UniWork documents in the desktop modules).** Fork main moved to `1d78e047` after the lane's final code (`9b5e409`);
its UniWork-document UI is desktop-only and is gated off in the web frames by the follow-up merge (MM4). The details and
the resulting capability keys are confirmed by the coordinator after that merge; this report describes the lane at `9b5e409`.

## 3. GO-D3: measurements and decision (Sheets and the native xlsx-sidecar)

Full report: `docs/web-modules/sheets-sidecar.md` (worker S6, extended by SH1/SH2). Machine: VPS "bro", ARM Neoverse-N1,
4 vCPU, 23 GiB, Node 22, rustc 1.90.0; single runs under the lane lock, read as order of magnitude.

**Finding S6.** The sidecar is Sheets' whole document I/O, not a feature: 12 commands behind 14 of the 47 IPC channels.
The renderer holds a session id and streams 256-row chunks from a resident, indexed session. "Disabled on the web" was
possible only for 5 peripheral operations (recalc fallback, `.xls` convert, merge workbooks, recovery copy, pivot refresh).

**Native sidecar** (11-file G0 corpus: open 0.7–2.5 ms warm, save of 10 edits 11.9–42 ms, RSS ≤ 8.7 MiB; large synthetic
workbooks, one sheet, 22 columns):

| Cells (rows × 22) | 0.44M (20k)   | 1.98M (90k)   | 2.2M (100k)    | 6.6M (300k)   |
| ----------------- | ------------- | ------------- | -------------- | ------------- |
| file / sheet XML  | 2.0 / 13.9 MB | 9.3 / 63.7 MB | 10.3 / 70.8 MB | 30.7 / 218 MB |
| open (warm)       | 190 ms        | 708 ms        | 791 ms         | 2,589 ms      |
| first viewport    | 26 ms         | 16 ms         | 15 ms          | 16 ms         |
| save, 1000 edits  | 0.55 s        | 1.84 s        | 2.18 s         | 7.53 s        |
| sidecar peak RSS  | 213 MiB       | 846 MiB       | 939 MiB        | 2,950 MiB     |

Server-side (option A/B) would need a new stateful session service in office-engine (office-engine is a stateless job
runner: one grant and one sandboxed worker per job) with affinity, idle eviction and memory budgeting (7 MiB to 3 GiB per
session measured), plus a network round trip per read (114 KB per viewport, 4.8 MB per 90k-cell batch). Pure JS (option
b2) was too slow for open: `readBasicWorkbook` 2.4 s / 11.0 s / 46.7 s at 0.44M / 2.2M / 6.6M cells against 0.2 / 0.8 /
2.4 s native.

**WASM build of the same engine.** `wasm32-wasip1`, 4 mechanical changes (zip 0.6 without its C libraries, three thread
spawns inline, `canonicalize()` and `temp_dir()` fallbacks): 6.8 MB module (1.97 MB gzip) in the S6 probe; every command
correct on all 11 G0 fixtures (2–6× native). Under Node's `node:wasi` it segfaulted on a worksheet ≥ ~8 MB (open item O1).

**Condition 1, browser measurement (SH1, headless Chromium 151, module Worker, Sheets CSP + `wasm-unsafe-eval`).** O1 does
**not** reproduce: 0 traps, 0 crashes, 0 CSP violations over 15 workbooks up to 200k × 22 (4.4M cells, 144.6 MB sheet XML).
The ≥ 8 MB crash was Node's experimental `node:wasi` (uvwasi), not the engine; Node with the browser WASI shim does not
crash either. First viewport, Chromium (native) before the incremental index: 0.22M cells 0.8 s (0.10), 1.1M 3.9 s (0.49),
2.2M 6.7 s (0.92), 4.4M 15.6 s (2.54); renderer peak RSS 358 MB → 1.3 GB (777 MB at 2.2M); wasm heap 73 MB at 0.22M, 271 MB at
2.2M, 540 MB at 4.4M. The first-viewport cost came from a single-threaded full index run inline.

**SH2 (production build).** The index is now incremental (resumable passes, `cfg(target_os = "wasi")`): first viewport
120 / 49 / 29 / 31 ms at 0.22M / 0.44M / 1.1M / 2.2M cells (was 559 / 1,219 / 2,864 / 4,924 ms); open + first viewport at
2.2M cells 2.33 s (was 6.7 s). Chromium on the production `build:web --module sheets` bundle, from page load to usable:
20k rows 4.1 s, 50k rows 4.3 s, 100k rows (2.2M cells, 10.3 MB file, 70.8 MB XML) 5.1 s. Wasm 5.07 MB (1.70 MB gzip);
bundle 26.55 / 7.76 MiB raw/gzip at SH2, initial 2.68 / 0.73 MiB.

**Decision (user, 2026-10-09): C.** "WASM in the browser for open/read/formulas/media/pivot/save/`.xls` convert; disabled on
the web for recalc fallback, merge workbooks and the recovery copy; G3 above the WASM cap; nothing server-side."

**Cap.** The lead first set host gate 5 MB stored (about 1M dense cells, ≤ 4 s to first viewport, < 0.5 GB) and frame gate
40 MB of worksheet XML, from the browser numbers above, and **raised both after SH2's incremental index: host 10 MiB of
stored file (client and server, GD4), frame 80 MB of uncompressed worksheet XML** (about 2.2M dense cells, ~0.8 GB
renderer peak). Above either, the file opens in the G3 xlsx editor.

**The four conditions of C, status.**

1. Browser run, O1 diagnosed, cap from browser numbers: done (above).
2. The wasm patches are a reviewed, upstream-sync-friendly change: every web change is behind `cfg(target_os = "wasi")` (or
   a `cfg!` guard) in `src/lib.rs`, `src/main.rs`, `src/worksheet.rs`, `src/archive.rs`; the desktop `cargo test` stays
   186 + 6 passed; the wasm crate and build live under `apps/sheets/native/xlsx-engine/wasm/` (UniWork-owned). Notes:
   `docs/upstream/SHEETS_WASM_ENGINE.md` and `docs/upstream/UPSTREAM_SYNC.md`.
3. The G3 xlsx editor stays for above-cap files: **GO-B7 must not remove it** (section 7).
4. `script-src 'wasm-unsafe-eval'` only in the sheets and pdf `csp.json` (verified in section 5).

## 4. Hidden, or not, on the web per module (capability keys)

Renderers read `cap(key)` from the object the bridge installs on the module global (`window.pdfApi.capabilities`, ...);
Electron installs none, so the desktop keeps everything. An entry is on unless its key is explicitly `false`. Keys that
follow a host grant are on only when the host grants them.

| Key                                                                     | Web value                                                    | Modules             | What it hides / enables                                                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `autoSave`, `autoSaveToDisk`                                            | **false** [C10]                                              | all                 | AutoSave toggle and its 30 s / blur timers; autosave preference pinned off                                           |
| `recoveryCopy`                                                          | false (on in Sheets only as the draft-recovery tick trigger) | sheets              | disk crash-recovery copy; the 30 s tick feeds web draft recovery only                                                |
| `ai`, `aiCredentials`, `webSearch`, `imageSearch`, `imageGeneration`    | from the host grant (default false)                          | all                 | AI panels, AI settings, web/image search, image generation; hidden unless org entitlement + AI mount live            |
| `createDocument`, `billing`                                             | false                                                        | all                 | AI tool `create_document`; AI panel "Buy plan"                                                                       |
| `open`, `recents`                                                       | from host `filePick`, `recents` grants                       | all                 | File > Open (picker), recent files                                                                                   |
| `save`, `saveAs` (`edit` in PDF)                                        | from host `save`, `saveAs`                                   | all                 | no `save` grant = **view-only** (edit entries disabled, "View only" badge; bridge refuses writes too)                |
| `images`                                                                | from host `images` grant                                     | markdown, html      | picture upload to assets; else data: URIs                                                                            |
| `zotero`, `docPassword`, `tabs`                                         | false                                                        | docs                | References > Zotero group; "Password to open" in Protect; View > Window > New Tab / Switch Tabs                      |
| `tabs`, `fontDownload`, `fontInstallLocal`, `model3d`, `headlessExport` | false                                                        | slides              | tabs; font catalog / local font install; Insert > 3D Models; headless export                                         |
| `presenterWindow`                                                       | **true**                                                     | slides              | Audience Window and swap-screens buttons (works in the browser since SP1)                                            |
| `insertPages`                                                           | from host `filePick`                                         | pdf                 | Import pages, Replace pages, Merge PDF                                                                               |
| `pdfTextEdit`, `pdfImageEdit`, `pdfAnnotDelete`                         | true; off if pdfium cannot compile in the frame              | pdf                 | text/image edit and annotation delete through pdfium                                                                 |
| `savedSignatures`                                                       | true (encrypted per user)                                    | pdf                 | saved signature library                                                                                              |
| `autoRename`, `convertOffice`, `ocr`, `redaction`                       | false                                                        | pdf                 | AI rename, Convert to Office (desktop engine), OCR ("no engine"), redaction (writes a working copy next to the file) |
| `openInDocs`, `imageHost`                                               | false                                                        | markdown            | open the exported docx in Docs (desktop shell); third-party image host upload                                        |
| `htmlPreviewScripts`                                                    | **true**                                                     | html                | preview runs the page's scripts in the sandboxed `preview.html`                                                      |
| `htmlVisualEdit`                                                        | from host `save` grant                                       | html                | inspector, float toolbar, style panel, inline text edit                                                              |
| `presentNewTab`, `exportDocx`                                           | false                                                        | html                | chrome-free shell tab; html2docx (hidden browser window)                                                             |
| `xlsxEngine`                                                            | on when the engine transport is available                    | sheets              | the whole workbook surface (off: engine-unavailable screen)                                                          |
| `xlsImport`, `pivotRefresh`                                             | on (from the transport's features)                           | sheets              | `.xls` in the picker; PivotTable Refresh / Refresh All                                                               |
| `recalcFallback`, `mergeWorkbooks`                                      | **false** [C11]                                              | sheets              | IronCalc recalc fallback; Data > Merge workbooks and the AI attachment merge                                         |
| `screenshot`, `exportCsv`                                               | false / true                                                 | sheets              | Insert > Screenshot hidden; CSV is a browser download                                                                |
| `platform: 'web'`                                                       | web                                                          | slides (and others) | no native window chrome; File tab on every OS; HTML fullscreen for show and presenter                                |

Every hidden member of a preload global still exists with a typed safe answer (never throws); `PdfWebApi` and the other
web APIs are mapped types over the desktop contracts. The module docs written before AI1 (`pdf.md`, `markdown-html.md`)
still say "AI is hidden": that is true only without the host grant.

## 5. Security notes

**Frame isolation.** Exact allowed-origin lists (no `*`, no `null`), `event.source` checked both directions, outgoing
messages use the first allowed origin as `targetOrigin`; the token lives in the client closure (not in `session`, storage
or cookies). RF re-verified origin/source/port checks, the CSP registry, and that the new product code has no raw-HTML
sink (`innerHTML`, `dangerouslySetInnerHTML`, `document.write` appear only in `preview.html`'s deliberate boot inside the
opaque origin and the script-less print frame). **Same-origin caveat from B2B3 still stands**: the frame is same-origin
with UniWork, so `connect-src 'self'` and `credentials: 'omit'` are conventions, not enforcement; script running in the
frame (for example through document content) could call the UniWork API with ambient cookies. Keep document-rendering
paths free of raw-HTML injection until the frame moves to its own origin (`WEB_DOCS_CSP_FRAME_ANCESTORS` and the cookie-free
token are the prepared path). The lane's mitigations: Markdown raw HTML is text, never markup; the HTML preview is the
only place a document's scripts run and it is an opaque, credentialless, network-less origin.

**Server side.** The module claim `m` is HMAC-signed and read from the stored file at mint, never from the client; every
frame route checks the token module's per-organization flag; the size gate runs after the ACL (a non-member still gets
404); `Authorize` rechecks workspace, organization and module on every route; view-only is enforced by ACL on commit and
uploads (`can_edit` is a UI hint); no cookie is used by any frame route. RD verified these, and the findings it raised
(signed asset URLs dropping the module, commit answer without `module`, host not comparing minted vs mounted module,
half-wired client view-only, mocks above the transport, duplicated Go/TS module table) were fixed in FD1.

**HTML preview sandbox, and the isolation e2e.** Sandbox `allow-scripts allow-forms allow-popups allow-modals`, no
`allow-same-origin`, `credentialless`, `referrerpolicy="no-referrer"`, its own header CSP (`connect-src 'none'`,
`form-action 'none'`, no `'self'`). The frame sends ONE `init` (page source, pictures inlined) with a `MessagePort` per
load; `preview.html` accepts it only from its parent, once, with exactly one port; inspector traffic goes only over the port
through a strict typed parser (fresh objects, size and enum limits). `web/e2e/html-preview-security.spec.ts` runs a hostile
document and asserts that it cannot reach the frame or host (`SecurityError`), read cookies/localStorage/sessionStorage/
IndexedDB, use fetch/XHR/WebSocket/EventSource/sendBeacon, post forms, load anything from the app origin, embed frames or
open a popup with an opener, and that forged protocol envelopes reach no listener; the test host's request log shows zero
probe requests and the host state does not move. Residuals, as on the desktop: the page's own scripts may send well-formed
inspector messages over the port (they drive visual edits of their own document; the user sees unsaved changes and nothing is
saved without the user); the policy allows `https:` images, scripts, styles, fonts and media, so a hostile document can
send its own content to any https host by GET (the C15 "like the app" decision).

**Slides audience handshake.** `window.postMessage` on the frame's own origin with namespace and version, `source` and
`origin` checked on both sides, and a 128-bit random show id; the presenter then transfers a `MessagePort` and the
audience sets `window.opener = null`. Only eight read-only methods are served (`AUDIENCE_METHODS`); edits, saves and the
host protocol stay in the frame. Every message is validated on receipt, with argument validation added in FF1. The CSP
is unchanged.

**Draft recovery crypto** [C18, C18a]. AES-GCM 256, key `extractable: false`, random 96-bit IV per write; the record key
(scope + etag + tab id) is the additional data, so a record cannot be replayed under another key. **The host persists the
per-user key** as a structured-clone `CryptoKey` in the same IndexedDB database (`uniwork-office-frame-drafts`, store `keys`)
so a reload or a second tab can still decrypt (RF finding 1: the first design held the key in memory only and lost the
draft on a host reload); the frame never deletes a record it cannot decrypt (it may belong to a live tab or a later
sign-in); sign-out and user switch delete the whole database, key included. The G3 `uniwork-office-drafts` database is never
touched. Without IndexedDB the key lives in host memory (recovery then survives a frame reload, not a page reload).
Nothing is sent to the server. Known gaps: a record nobody restores stays until sign-out; the `pagehide` write is async.

**AI token use.** `Authorization: Bearer <frame token>`, `credentials: 'omit'`, `mode: 'same-origin'`, one refresh after a
401; vendor key headers dropped; the provider is `encodeURIComponent`-ed and must be in the server's provider table; keys are
write-only (`key_hint`); the mount origin is derived from the frame's own origin, not `apiBase` (FF1 hardened the
containment check). Server side, every request re-checks view access, entitlement and the per-person rate limit.

**PDF saved signatures** (RF finding 3, fixed in FF1): were plaintext, user-agnostic `localStorage`; now one encrypted
record per user in the frame database, deleted at sign-out; the legacy key is deleted and migrated once.

## 6. Tests and evidence

**Local, exact affected files only** (cloud runner for everything else, user order 2026-10-09). The lead re-verified every
merge: for example final fork `test:web` roots (protocol / bridge / build / modules / slides / pdf) 90 / 175 / 53 / 156 + 10 skipped / 68 / 44 and `typecheck:web`; Sheets
`web/modules` 55 + 10 skipped; `cargo test` (desktop xlsx-engine) 186 + 6 passed, 234 + 7 at MM2; slides parity/
characterisation/core/guard 14/14; markdown fidelity 19/19.

**Cloud rounds** (Cursor cloud runner; verdicts and costs):

| Round                          | Repo, target          | Verdict                       | Cost      | Notes                                                                                                         |
| ------------------------------ | --------------------- | ----------------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| dev r1                         | `5cd897574`           | PASS                          | ~20 cents | ts, go, e2e (9 passed / 18 skipped: no bundle source in the VM)                                               |
| dev r2                         | `dc19db30b`           | go PASS, ts FAIL, e2e blocked | ~45 cents | one lane regression, TS2769 in `module-frame-host.test.tsx` (breaks web typecheck + next build); fixed by FD2 |
| dev r3                         | `5900e1111`           | PASS                          | ~26 cents | ts 11/11, e2e 14 passed / 18 skipped / 0 failed incl. `documents.spec.ts` on default-ON flags                 |
| dev r4                         | `0b264deed`           | did not run                   | n/a       | Haiku session thrashed its context three times and sent no `worker_done`                                      |
| dev r4b                        | `d68df2f5e`           | PASS                          | ~33 cents | ts 9/9, go 4/4, e2e 14 / 18 / 0                                                                               |
| fork baseline + MM1/MM2 rounds | `092e1c1`, `07482d9`  | green after classification    | n/a       | remaining reds classified main-also, B2B3-owned, VM-environment or one flake                                  |
| fork MM3                       | `11a5eba` / `b41eddd` | PASS                          | ~39 cents | CI replica test + e2e                                                                                         |
| **fork final**                 | `9b5e409`             | **PASS**                      | ~33 cents | office-ci-test 8.79c, office-ci-e2e 12.22c, web-ci 12.22c; reports `.uniwork-lane/cloud/final-9b5e409/`       |

Dev e2e cases that need an installed bundle (18) skip in the cloud (no bundle source on the VM); they ran locally on a
production build with all six bundles (29 passed / 2 expected skips).

**e2e specs** (fork, `web/e2e/`, production builds in the test host): `docs-web`, `pdf-web`, `markdown-web`, `html-web`,
`html-preview-security`, `slides-web`, `slides-presenter`, `slides-fidelity`, `sheets`, `sheets-ai`, `draft-recovery`
(Docs, Markdown, Sheets), `ai-web` (Docs, Markdown), `modules-smoke`, `csp-header`, `w4-hide`, `headless`. The `web-e2e` CI
job runs the security-critical set with `WEB_E2E_REQUIRE_BUILD=1` (a missing bundle fails, no silent skip). Dev:
`e2e/office-docs-web.spec.ts`, `office-markdown-web.spec.ts`, `office-modules-web.spec.ts` (table-driven over pdf, html,
pptx, xlsx; html and sheets also save one edit and read the version back), run with `OFFICE_MODULES_WEB_E2E=1`.

**Reviews.** RD (dev, `b71936f27..0b0039d37`): SHIP AFTER FIXES, 0 blocker / 1 major / 5 minor / 4 nit; FD1 fixed all
(`dc19db30b`). RF (fork, `57665e8..11a5eba`): SHIP AFTER FIXES, 0 / 5 / 7 / 4. Majors and their fixes: (1) recovery key
memory-only and decrypt-failure deletes → C18a, FF1 (frame) + FD3 (host key persistence); (2) Sheets wasm crash strands the
workbook → already solved by SH3 panic recovery, FF1 added a bridge test; (3) PDF signatures plaintext → FF1; (4) security
e2e not in CI and skippable → FF1 `web-e2e` job with `WEB_E2E_REQUIRE_BUILD`; (5) UPSTREAM_SYNC.md covered only Sheets →
FF1 refactor map. Minors and nits fixed in FF1 (preview reload hello, head adoption by bytes, AI mount containment, audience
arguments, CSP test pin, `rawHtml` regex bound, random asset names).

**Screenshots and evidence folders.** Fork `docs/web-modules/screenshots/{ai,draft-recovery,html,markdown,pdf,sheets,slides}/`
(en/vi × light/dark where the spec captured them); dev `reports/uni-1014-evidence/desktop-open/` (12 screenshots, vi + en,
light + dark); dev cloud reports `reports/uni-1014-cloud/r1..r4` (untracked by design); fork cloud reports
`.uniwork-lane/cloud/final-9b5e409/`. Module docs: `docs/web-modules/{pdf,markdown-html,slides-web,slides-fidelity,
sheets-module,sheets-sidecar,draft-recovery}.md`, inventories `inventory-b4.md`, `inventory-b5.md`, GO-D3 probes in
`sheets-probes/`; dev `docs/office/office-web-modules.md`; fork `docs/upstream/UPSTREAM_SYNC.md` and `SHEETS_WASM_ENGINE.md`.

## 7. Open items and follow-ups

**For GO-B7: do not remove the G3 xlsx editor.** Under GO-D3 = C (condition 3), workbooks above the cap (host gate 10 MiB
stored, frame gate 80 MB of worksheet XML, and any workbook the Sheets frame cannot open) open in the G3 xlsx editor
through the existing fallback. Removing the xlsx part of G3 would leave those files with no editor. The same fallback
also serves a Sheets bundle that is not installed or whose flag is off.

Product / behaviour:

- **Sheets: dependents keep stale cached values.** Cached formula values are computed for the cells the user typed; a
  formula elsewhere that depends on an edited value keeps its old `<v>` until the next engine evaluation. The save also
  skips cached values when a structural or sheet-tab change is pending, a sheet added this session is referenced, the file is
  above 64 MB, more than 10,000 edits are pending, or IronCalc cannot import the workbook (strict importer).
- **Sheets: Name Box streamed edit.** The first edit after a Name Box jump in a streamed workbook (MM2 open item; the e2e
  helper goes through another cell first).
- **PlainTextEditor read-only gap** (MM2 open item, Markdown/HTML source pane in view-only).
- **Model chip label**: the shared web AI model chip shows `openrouter/auto`; not module- or Sheets-specific (SH4).
- **Late credentials**: credentials seeded after boot are picked up only after a dialog save (the shared bridge caches the
  first load; SH4).
- **PDF**: JPX and JBIG2 images not exercised (no encoder in the toolchain; pdf.js decodes both, the CSP allows them);
  text insert/edit uses Liberation only, so CJK, emoji and most symbols are rejected with the existing "no installed font"
  message; the save core runs on the frame's main thread (large files freeze the UI while saving); OCR and Convert to
  Office hidden.
- **Markdown / HTML export entries.** "Export Word" (Markdown) and "Export HTML" are shell-menu entries on the desktop;
  the protocol has no host request for them, so only print/PDF is reachable on the web. The bridge implements
  `exportDocx` and `exportHtml` for when a ribbon entry or host request is added (planned as MH2, not run). No Source mode
  in the Markdown frame (raw HTML is preserved and shown as text, not editable as source).
- **HTML preview limits**: `fetch`/XHR data is unavailable (`connect-src 'none'`), nested frames blocked, document
  pictures other than PNG/JPEG/GIF and sibling files (a `style.css` next to the page) are not served to the preview.
- **Slides**: external linked media and server-side print-quality PDF not done; initial chunk still carries all 21 locales
  (~17 % of sources; on-demand i18n needs an async locale switch); audience fullscreen needs one click (browser rule);
  clipboard read needs a gesture and permission.
- **Draft recovery**: a record nobody restores or discards stays until sign-out; the `pagehide` write is asynchronous;
  uncommitted HTML style edits and open PDF editor boxes are not in the copy until committed; Sheets does not re-draft edits
  made after a Restore until the next save; Slides and PDF wiring is unit-tested only (e2e covers Docs, Markdown, Sheets).
- **Docs view-only** still ignores the token's `can_edit` (UNI-1013 behaviour; modules other than Docs honour it).
- **Open in desktop app**: launch target (GO-A6) and installer URLs (GO-A8) are not wired here; the prompt says the link is
  unavailable until they land.
- **Images in Markdown/HTML on the UniWork host**: the dev host does not grant `images` and leaves `open.assets` unfilled
  (the G3 web host cannot resolve relative images or upload pasted ones either), so relative images of an existing document
  do not resolve in the frame and pasted pictures are embedded as data: URIs. Fill `open.assets` with same-origin URLs and
  grant `images` over the asset routes when G3 gains them.
- **Desktop-visible Markdown changes** (raw HTML verbatim, Mermaid as `<img>`) are intentional; a desktop document that
  relied on rendered raw HTML or inline diagram DOM looks different. Recorded in `UPSTREAM_SYNC.md`.

Build, CI and release:

- **CI secret republish.** `OFFICE_FRAME_SOURCE` must become a tarball of the fork's whole `dist-web` root (all six
  modules). The final tarball is the linux-arm64 build made on bro,
  `/home/ubuntu/orca/workspaces/uniwork-office/dist-web-0.1.0-9b5e409.tar.gz` (33,350,229 bytes, 644 entries, sha256
  `0579fc3372c200f3fcbcae31ac32e8a872caee154420840aaa34c2eb240bc7b5`). Whoever holds the secret must re-publish it; until
  then the dev `e2e` job runs only the Docs frame cases and the other modules' cases skip themselves. The fork CI does
  not publish a `dist-web` tarball.
- **Per-platform wasm checksum.** The Sheets `xlsx-sidecar.wasm` is byte-different on linux-arm64 and linux-x64 from the same
  inputs, so `xlsx-sidecar.wasm.sha256` has one line per platform and `sheets.pin.json` `manifestSha256` covers the wasm
  bytes: the pin is the arm64 build. A tarball built on x64 is refused against this pin; publish from the bro tarball or
  re-pin from x64, never mix. Any edit under `apps/sheets/native/xlsx-engine/wasm/` (even a comment) changes the staging
  hash and the module, and needs `--update-checksum` for **both** platform lines in the same commit.
- Stale number in dev docs: `docs/office/office-web-modules.md` "Sheets size cap" says the frame gate is 40 MB of worksheet
  XML; the fork constant `MAX_WORKSHEET_XML_BYTES` is 80 MB (final gates 10 MiB / 80 MB).
- The `wasm` toolchain is pinned (`rust-toolchain.toml`: 1.90.0 + `wasm32-wasip1`); `web-e2e` CI installs it before
  `build:web -- --all`.
- Known non-lane reds on the base: `docs-spell-suggestions.spec.ts:71` (flaky on main, native spellchecker; one retry-flake in
  the final round), Electron `docs-visual` and `font-covering` on the replica VM's fonts; `markdown-tab.spec.ts:101` was a
  3/10 flake on `afd42b8` and passed in the final round.
- Dev-side lane notes: AI2's frame-token routes return 404 `feature_disabled` when the module flag is off (consistent with
  the other frame routes); credential PUT/DELETE need view access (personal org + user rows, the same key the session routes
  list).

## 8. Visual test results

**pending tester_visual** — the coordinator fills this section from the six `tester_visual` reports (9 criteria: hierarchy
and typography, spacing and alignment, consistency with UniWork primitives and the genoffice look, tokens and light/dark
legibility, states, responsiveness, vi/en copy, visible accessibility, polish; severity blocking / major / minor / nit per
finding with screenshot crops; an unstyled, raw-DOM or placeholder screen is blocking). Run against the final pins on the
shared visual host (lane VH).

| Module              | Round | Verdict | Blocking / major / minor / nit | Report |
| ------------------- | ----- | ------- | ------------------------------ | ------ |
| Docs (generic host) |       | pending |                                |        |
| PDF                 |       | pending |                                |        |
| Markdown            |       | pending |                                |        |
| HTML                |       | pending |                                |        |
| Slides              |       | pending |                                |        |
| Sheets              |       | pending |                                |        |

## 9. Final SHAs

- Fork `feature/UNI-1014-web-modules`: `FORK_SHA` (the commit that adds the final lines of this report; the code under test
  is `9b5e409`, verified by the final cloud round, plus any visual-fix commits recorded in section 8).
- dev-uniwork `feature/UNI-1014-office-web-modules`: `DEV_SHA` (head at the time of writing `c66158951`; pins
  `0.1.0-9b5e409`).

Both branches are pushed to origin; no pull requests.
