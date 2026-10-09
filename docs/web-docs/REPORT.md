# genoffice Docs inside UniWork web — lane report (GO-B2 + GO-B3)

Tickets UNI-1012 / UNI-1013 (parent UNI-1001). Fork lane branch `feature/UNI-1013-docs-web-bridge`;
UniWork lane branch `feature/UNI-1013-office-docs-web` (dev-uniwork). Starting point: the GO-B1 spike,
`docs/web-spike/REPORT.md`.

Decisions not reopened in this lane: same-origin iframe + postMessage (no in-page mount, no Shadow DOM);
the protocol does not use cookies (the host passes a short-lived token in `init`); AI / web search /
image search / image generation stay stubbed and hidden on the web (needs ADR GO-C2).

## Verification summary

Final state: fork lane head `8687750` (fork-main `092e1c13` merged), dev lane head `8ac1108b6`, dev pin
`0.1.0-8687750` (final SHAs at the end).

| Check                                              | Target                       | Result                                                                                                                                                                                                                                                   |
| -------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fork local (lead + F11)                            | `8f34ddf` (+ CSS-only F12)   | **PASS**: `test:web` 75 + 139 + 26, `typecheck:web`, docs typecheck, lint, prettier, English-only, theme colors; `build:web`; web Playwright 25/25, 0 CSP / console errors. Before F11 it was 23 of 25 failed (documents never opened, section 1)         |
| Fork cloud replica r3 (`--repo uniwork-office`)    | `8687750`, first replica     | Test job: only `font-covering` (VM fonts). Electron 171 passed / 7 failed: spell-suggestions (flaky on main), docs-visual x5 (VM fonts), table-float-click (VM only). Not lane-caused; style-gallery and word-interaction-smoke fixed by F12                |
| Fork cloud replica r4 (final replica specs)        | `8687750`                    | **PASS**: test job all steps; Electron 176 passed, 0 failed. Excluded by spec (VM only): docs-visual kitchen-sink, docs-table-float-click (the latter passes 3/3 locally on the lane). r5 on fresh VMs is the reference: not available when written       |
| Dev cloud r3 (`tester_cloud`)                      | `8e017c68c`                  | **ACCEPTED**: pass contract tests, check-boundaries, wide typecheck, knip, lint, Go handler (isolation matrix) + service (`TestDocumentOfficeCommit` fixed), next build + "not installed -> G3". Remaining reds are not lane-caused (section 6)           |
| Dev local frame e2e (prod build, org-scoped flag)  | `d6db9dd3e`, pin `8687750`   | **PASS**: bundle installed 10 passed / 1 skipped; not installed 1 passed / 10 skipped. Run locally because the cloud VM has no bundle source                                                                                                              |
| Dev affected tests + static (lead, F3a/F3b/RP2)    | `b71936f27` ... `8ac1108b6`  | **PASS**: core 242 (1 skip), views office 5304, apps/web office 610, office-engine 100 (+17 env-gated real-renderer), tsc, knip, go vet, Go router/office/middleware/featureflags/handler tests, check-boundaries; RP2: office-frame 52, core host/api 29 |
| Visual (`tester_visual`, 9 criteria + A1/A2)       | r1 `b71936f27`, r2 `d9687d38b` | r1 NOT PASS (4 major, 8 minor). r2 **PASS**: 0 blocking, 0 major; 1 minor + 4 nits open (section 6). Visual r3: PENDING                                                                                                                              |
| Code review R1 (fork) / R2 (dev)                   | `2953d27` / `e2f4d6489`      | Both "ship after fixes"; R1 fixes in F1 (`a0f5fd4` ... `5bce54c`), all five R2 majors fixed (section 6)                                                                                                                                                                  |

## 1. What works

**Protocol** (`web/docs/protocol/`, README.md there). Dependency-free `types.ts` (vendored by
dev-uniwork as `packages/core/office/docs-frame-protocol.ts`), `endpoint.ts` (shared engine),
`client.ts` (frame), `host.ts` (page).

- Envelope `{ns: 'uniwork.office.docs', v, id, kind, type, payload, error?}`, `PROTOCOL_VERSION = 1`;
  all changes after the contract commit were additive.
- Handshake: frame emits `ready` (re-sent until answered) → host `init` request (token,
  `tokenExpiresAt`, documentId, workspaceId, apiBase, `apiMode`, locale, theme, capabilities,
  optional `open`) → frame `InitAck` with the intersected capabilities.
- Exact allowed-origin list (no `*`), messages from other windows or origins are dropped; version
  mismatch answers a typed `version_mismatch` error.
- Token lives only in the client closure; single-flight `token.refresh` before expiry or after a 401.
  `apiMode: 'host-proxy'` (used now): the frame sends `api.*` requests and the host performs the
  token-authorised fetches. `apiMode: 'direct'`: `fetchApi` with `Authorization: Bearer`,
  `credentials: 'omit'`.
- Request/response correlation, per-request timeout (`timeoutMs: 0` = no timeout, used for host
  dialogs), `AbortSignal` cancellation with a `cancel` event, typed error codes mapped from HTTP status
  (409/412 → `conflict`, 401 → `unauthorized`, …).
- `tsconfig.json` enables `noUncheckedIndexedAccess` (upstreamed from the dev-uniwork vendored copy).

**Bridge** (`web/docs/bridge/`). `install.ts` builds `window.desktop` from
`hide` → `ai` → `webapi` → `browser` (later wins) behind a Proxy that fills any missing method with a
safe no-op.

- `webapi.ts` (WEB-API class) maps the renderer's file API onto the protocol: boot open from
  `init.open` / `api.open {documentId}`, host `open` request → `onOpenDocx`, `openDocx` → `file.pick`,
  `saveDocx` → `api.save {fileId, data, etag}` (stale etag → `conflict` → the editor's
  `external-modified` path, document stays dirty), `saveDocxAs` → `api.saveAs`, first save of an
  untitled document → `api.saveAs {silent: true}`, recents → `api.recents`, `fetchImage` →
  `image.fetch`, `convertAltChunkHtml` → `convert.altChunkHtml`, `file.renamed` → `onRenamedDocx`.
- PDF export → `api.export {format: 'pdf', fileId}`; when the document has unsaved edits (or was never
  saved) the live docx bytes go along as `data` (transferred). Any failure falls back to the in-frame
  print dialog. `exportHtml` stays a local download.
- `session.ts` drives the editor for the host: `doc.closeCheck` → `{dirty, autoSave}`, host `save`
  → the editor's full save flow, host `saveAs` → the editor's Save As with the host's name, host
  `print` (`mode: 'pdf'` = server export, else print dialog); `dirty`, `title`, `saved`, `error`
  events to the host.
- The spike's in-memory fake backend is gone; `projectApi` (AI-panel chat history) is in-memory.

**Hide / capabilities** (W4, `docs/web-docs/w4-hide-browser.md`). One capability object,
`webCapabilities` in `hide.ts`, exposed as `window.desktop.capabilities` and read by the renderer
through `apps/docs/src/renderer/capabilities.ts` (`cap(key)`, always `true` on desktop). No `isWeb`
checks. AI bridge methods answer typed `ai-unavailable` results, no network calls.

**Print / downloads** (W4, `browser.ts`). `print()` = `window.print()` of the frame with a temporary
print sheet (zero page margin, exact colours, light theme pinned for the job, so output is identical in
both UI themes). Downloads through Blob + `<a download>` with sanitised names. `window.open` is guarded:
http(s) only, `_blank`, `noopener,noreferrer`.

**Test host + e2e.** `web/server/test-host/` is a dependency-free host page (served by
`web/server/server.mjs` at `/test-host/?open=<docx url>[&frame=<frame index path>]`) that embeds the
frame and answers the protocol from an in-memory store with etag versions. `web/e2e/docs-web.spec.ts`
runs, per fixture (simple, kitchen-sink, long): open → editable → type marker → bold → insert table →
save (bytes reach the host via `api.save`) → saved XML checks → reopen → host events
(ready/title/dirty/saved) → stale-etag save conflict (refused, stays dirty) → export of an unsaved edit
(the `api.export` bytes contain the edit, the stored version does not). Last run: 3/3, all 33 steps
pass, no console errors (`docs/web-docs/bridge-e2e/results.md`).

**Save conflict, save-as, theme/language, print** (review fixes F1 + W4c, visual fixes F4 + F5):

- A frame-initiated save with a stale etag emits a host `error {code: 'conflict'}` event and opens an in-frame
  Cancel / Reload / Overwrite dialog (i18n in zh + 20 shards): focus starts on Cancel, Esc = Cancel, focus is trapped,
  Overwrite is the red danger button (F4 #5). The stale etag is re-synced after a timed-out save; "a save is already
  running" answers `busy`, not `conflict`.
- Host save-as: host `saveAs {name}` runs the editor's Save As with the host's name; the first save of an untitled
  document is a silent `api.saveAs`. The copy is named "(bản sao)" / "(copy)" and a toast says so (F5 #12), instead of
  reusing the original name.
- `init.theme` / `init.locale` and the later `theme` / `language` events are applied live in the frame
  (`host-appearance.ts`), host wins over `localStorage`, never written to it (screenshots 09, 10).
- Host `print` goes through the browser print path and is answered after `afterprint`.

**Save state, typed errors, modal dimming** (visual r1 fixes, before/after in `docs/web-docs/screenshots/f4/`):

- Save state is visible in two places: the frame status bar shows "Unsaved changes" / "All changes saved" (zh + 20
  shards; `dirty` is pushed ~150 ms after an edit; stale "Opened ..." text is cleared) and the host header shows the
  same state (vi + en, F5 #4). Opening / Saving / Saving as show progress text (F4 #8).
- Typed error notices in the host (own icon, title, text): editor unavailable (offers the G3 editor), network, denied,
  failed (F5 #9/#10). The export fallback says the print dialog was used (F4 #6).
- Modal dimming: additive protocol event `modal {open}`; the host dims and inerts its chrome while a frame dialog is
  open, and the frame scrim matches (F4 #11, F5 #11).
- Contrast and layout: `--docs-accent-fill` token, File button text 4.90:1 in dark (was 2.75:1, F4 #2); Discard
  5.58-6.25:1 (F5 #3); the Styles group collapses at 1024 px, and F12 made a whole Styles card stay clickable there
  (`min-width: min-content` at <= 1100 px; wide windows keep main's 259 px, so desktop is unchanged).

**Headless entry and server PDF export** (F2, F3b). `index.html?headless=1&open=<same-origin URL>` loads one document
for printing only: top level only, no handshake, light theme, `print` / `exportPdf` only; framed pages ignore it;
contract in `web/docs/protocol/README.md`. The engine job (`docs-pdf.ts`) renders the **pinned** bundle through it: a
CDP Fetch interceptor limits requests to the job's loopback origin, the loopback server sends the CSP from `csp.json`,
and `--no-sandbox` is used only under the per-slot uid. Real-renderer test on the pinned `5a81008` bundle: 1 / 1 / 34
pages (= desktop), 1.6 / 1.6 / 2.3 s; Playwright `headless.spec` with the verbatim engine shim gives the same pages.

**F11 open handoff.** After the fork-main merge the web open path broke: main's `OpenFileResult` carries `dataUrl`,
and the bridge handed the renderer a `blob:` URL that it `fetch()`ed, which the frame CSP (`connect-src 'self'`)
blocks, so documents never opened (23 of 25 Playwright specs failed; jsdom tests have no CSP and passed). Fix: the
renderer's `fetchDocBytes()` asks an optional in-page resolver first; `doc-handoff.ts` mints one-shot
`uniwork-handoff:` handles (60 s TTL); desktop registers no resolver; the CSP is unchanged. Playwright 25/25, 0 errors.

**Tests** (`npm run test:web`, `npm run typecheck:web`, both in CI since 5bce54c): protocol 75, bridge 139, build 26
(F11 at `8f34ddf`, re-run by the lead; `apps/docs/tests/web-capabilities.test.ts` 14/14; 279 `apps/docs` tests after
F4). E2E through the test host (W4b/W4c): 17/17, plus Playwright 25/25 on the web build (F11) incl.
`csp-header.spec.ts` x3 with zero `securitypolicyviolation`. The e2e figures above (3 fixtures x 11 steps) are from
`docs/web-docs/bridge-e2e/results.md`; the conflict step there predates the F1 dialog.

**Host side, end to end** (dev-uniwork `reports/uni-1013-w7-evidence/RESULTS.md`, re-run for pin `0.1.0-8687750` at
`d6db9dd3e`): on a production build with an organization-scoped flag, bundle installed = 10 passed / 1 skipped, bundle
absent = 1 passed / 10 skipped. Cases: serving headers + CSP, assets, unpinned 404, boot with zero CSP violations; sign
in -> docx opens in the iframe -> edit -> Ctrl+S -> a new Documents version whose `word/document.xml` holds the edit
-> fresh navigation shows it; File > Save as creates a copy that holds the edit, the page URL follows the copy, the
original gains no version; inserted image (no CSP violation, `word/media/*` after save); PDF export (no engine locally,
so the print fallback is the accepted outcome); `feature_disabled` mint and org override off -> G3. Screenshots 01-06.

**PDF export path.** Frame `api.export` -> host proxy -> `POST /api/v1/office-frame/documents/{id}/export/pdf`
(section 4). A 501 / 503 (no renderer) makes the frame fall back to the print dialog; a 504 / 413 / non-`%PDF-` body
are typed errors (W5d). Unit-tested on both sides; the engine renders the pinned bundle for real (above). A real PDF
through the dev-uniwork browser e2e is not covered: the local stack has no engine.

## 2. What is hidden on the web

From `docs/web-docs/w4-hide-browser.md` (gating per entry) and `docs/web-spike/hide-flags.md` (spike
audit: 7 desktop-only entries still showed UI on the web; all 7 are now gated).

| Capability (`false` on the web)               | Hidden entries                                                                                                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zotero`                                      | References > Zotero group (Citation, Bibliography, Refresh, Document settings)                                                                                                      |
| `docPassword`                                 | Protect dialog "Password to open" + confirm (modify password / restrict editing stay)                                                                                               |
| `tabs`                                        | View > Window > New Tab, Switch Tabs                                                                                                                                                |
| `autoSaveToDisk`                              | Quick-access AutoSave toggle; 30 s crash-recovery copy timer                                                                                                                        |
| `createDocument`                              | AI tool `create_document`                                                                                                                                                           |
| `ai`                                          | Home > AI group; Review > Editor, Translate, AI Resolve Comments, AI Revision Summary; View > AI Panel; AI dock and ask-AI popover; context menu Synonyms / Translate; F7 proofread |
| `webSearch`, `imageSearch`, `imageGeneration` | AI tools `web_search`, `image_search`, `generate_image`                                                                                                                             |
| `billing`                                     | AI panel "Buy plan" button                                                                                                                                                          |

Desktop-only bridge methods without UI (window chrome, menu, Zotero channel, recovery copy, tabs) stay
no-ops in `hide.ts`. The Protect dialog description still mentions "open" passwords on the web (needs a
string variant in every i18n shard).

## 3. Measurements

Spike = UNI-1011 build (`docs/web-spike/REPORT.md`, `measurements.md`; no compression, `no-store`). This lane =
`0.1.0-97ea1ea` (40 files) vs lane tip 425edd9 built with the previous pipeline, same server, 5 interleaved rounds,
median, cold cache, headless Chromium 151 on a shared 4-CPU arm64 box (ratios, not SLAs). Source:
`web/measure/measurements-b3.md` (+ `.json`), runner `web/measure/measure-b3.mjs`.

| Metric                                 | Spike (UNI-1011)                      | Before (425edd9)    | After (B3)                                              | Source    |
| -------------------------------------- | ------------------------------------- | ------------------- | ------------------------------------------------------- | --------- |
| Initial download, raw                  | ~3.6 MiB JS chunk                     | 3.85 MiB            | 3.85 MiB (same)                                         | b3 §1     |
| Initial download, gzip                 | 1.11 MiB JS                           | 1.15 MiB            | 1.15 MiB (same; brotli 0.90)                            | b3 §1     |
| Fonts in the initial download          | not guaranteed (lazy by `@font-face`) | 0                   | 0, enforced: under `fonts/`, never inlined              | b3 §1, §5 |
| Total build, raw / gzip                | 17.85 / 11.65 MiB                     | 17.87 / 11.66 MiB   | 13.29 / 10.57 MiB (-26% / -9%)                          | b3 §1     |
| Font files                             | 14 MiB                                | 33 files, 14.01 MiB | 34 files, 9.42 MiB (20 Latin faces as lossless WOFF2)   | b3 §1     |
| Latin doc font bytes (`long.docx`)     | -                                     | 0.53 MiB            | 0.37 MiB (-30%)                                         | b3 §3     |
| Wire by editable, gzip                 | -                                     | 1.68-1.95 MiB       | 1.53-1.72 MiB (-9 to -12%; simple +7%, late-font noise) | b3 §2     |
| Time-to-editable, gzip server          | 0.57-0.99 s (raw server)              | 1.00-1.51 s         | 0.98-1.55 s (+/-9%, within noise)                       | b3 §2     |
| Time-to-editable, no compression       | 0.57 / 0.64 / 0.99 s                  | 0.83-1.25 s         | 0.78-1.19 s                                             | b3 §2     |
| Served under `/office-frame/docs/<v>/` | -                                     | -                   | 3/3 editable, 0 failed requests (0.85-1.14 s)           | b3 §4     |

B3 times include the test-host boot, docx fetch and init handshake, so they are not comparable one to one with the
spike's standalone `?open=` load; the before/after columns are the like-for-like pair.

**After the fork-main merge** (lead build of `0.1.0-8687750` in the fork lane worktree, `build:web`; the same figures
were seen for `0.1.0-8f34ddf`): initial download **1.44 MiB gzip / 4.77 MiB raw** (W1's row above: 1.15 / 3.85, so
the merge of fork `main`, ~91 commits, grew it by ~0.29 MiB gzip), total build **16.58 MiB raw / 11.63 MiB gzip**
(W1: 13.29 / 10.57). Font split, time-to-editable and wire figures above were not re-measured after the merge, so they
are the pre-merge values.

**Remaining costs (renderer work, outside this lane):**

- A document with Chinese text pulls Noto Sans CJK SC (2.4 MiB) after first paint.
- The first font-picker open fetches the CJK/KR fallbacks (+4.4-6.8 MiB) on machines without local CJK/KR fonts
  (this headless host is the worst case).
- i18n dictionaries are 35 % of the 3.83 MiB JS chunk (19 languages); lazy locales is the next lever.

## 4. Server PDF export

Full note: dev-uniwork `docs/office/pdf-export-decision.md` (W8, 2026-10-08). Needs only the pinned bundle and a
headless Chromium; no new service.

**Decision (chosen, implemented): (b) headless Chromium rendering the same Docs web bundle**, the PINNED build the
frame serves, loaded through the fork's headless entry (`index.html?headless=1&open=<loopback URL>`, section 1) and run
as an office-engine job (`export`, docx -> pdf, raw CDP over `--remote-debugging-pipe`, `docs-pdf.ts`). Option (a) = LibreOffice 7.4.7.
Baseline = desktop `--headless-export` (Electron 43.3.0 / Chromium 150 `printToPDF`). Pixel diff at 96 dpi grey,
threshold 32/255.

| Fixture       | Desktop pages | (b) pages | (b) pixels differing      | (a) pages | (a) pixels differing |
| ------------- | ------------- | --------- | ------------------------- | --------- | -------------------- |
| simple        | 1             | 1         | 0.000 %                   | 1         | 0.17 %               |
| kitchen-sink  | 1             | 1         | 0.341 % (CJK punctuation) | 1         | 3.23 %               |
| long (tables) | 34            | 34        | 0.000 % (all pages)       | **46**    | 18.3 % mean          |

| Arm (arm64, load ~10)                      | Per document                              | Peak RSS              |
| ------------------------------------------ | ----------------------------------------- | --------------------- |
| **(b) engine prototype**, Chromium per job | 1.6 / 1.7 / 2.5 s render (2.0-2.8 s wall) | 687-711 MB            |
| (b) Playwright, warm / cold                | 2.2-3.6 s / 4.6-6.1 s                     | ~708 / 652-688 MB     |
| Desktop baseline (incl. app boot)          | 5.1-11.7 s                                | 843-929 MB            |
| (a) LibreOffice (container per doc)        | 1.6-3.0 s                                 | ~160 MB, image 888 MB |

**Why LibreOffice was rejected:** `long.docx` re-paginates 34 -> 46 pages; fonts are substituted (Carlito -> Noto
Sans, CJK -> serif JP, FreeSans/Liberation Serif dropped); on kitchen-sink the bullets render as tofu, the equation
`E = mc^2` is missing, the two-column table is stretched and headings change face. It cannot produce "the PDF of
what I see". It is lighter (160 MB), which does not outweigh that.

The table above was measured on the spike build; the engine test on the pinned bundle (`5a81008`) reproduces the page
counts 1 / 1 / 34 at 1.6 / 1.6 / 2.3 s. The kitchen-sink (b) difference is full-width CJK punctuation set proportionally; it is identical on Chromium
149 / 151 / full 151, so it is not a version effect. Likely cause: `fontMetrics` is `null` on the web bridge
(`web/docs/bridge/browser.ts`). Follow-up, not a renderer choice.

**Deploy prerequisites (open, none done):**

1. Stage headless Chromium (arm64 + amd64) and the Docs web bundle, the pinned build (same fork SHA the frame
   serves; the engine page needs the headless entry, present since `5a81008`), into the engine image under `UNIWORK_DOCS_PDF_ASSETS` (`bundle/` + `chromium`). Needs a Dockerfile
   change and a CJK-font check in the slim image. Without it the job fails `engine_incompatible` (route: 501).
2. `OFFICE_ENGINE_MEMORY_MB` >= 1024 (the 512 default kills a render as `memory_limit`).
3. Sandbox review: Chromium runs `--no-sandbox` only under the per-slot job uid, with a CDP Fetch interceptor that
   limits requests to the job's own loopback origin (R2 m4) and a loopback CSP from `csp.json`; consider seccomp /
   landlock.

Route and audit are in section 5. Frame side: `api.export` sends `fileId`, plus the live docx bytes in `data` when
the document is dirty; a host without byte support exports the stored version.

## 5. UniWork host side (dev-uniwork)

Lane branch `feature/UNI-1013-office-docs-web` (base 5b5882b22, head `8ac1108b6`, pushed; pin `0.1.0-8687750`).
Serving note: `docs/office/docs-web-frame.md`.

**Components** (`packages/views/office/frame`, `packages/core/office`, `apps/web/platform/office-frame`):

| Piece                                                                    | Role                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DocxOpenSwitch`                                                         | Reads `office_docs_web` for the document's organization (`useOfficeDocsWebEnabled`, org-scoped `GET /api/v1/config`); mounts `OfficeDocsFrame` only on a settled "on" **and** an installed, verified pinned bundle; the G3 host on anything else (no pin, no bundle, flag off, `feature_disabled` mint). Host config (frame version, document href) comes from the app-layer `apps/web/platform/office-frame/document-host.tsx`, so the checked surface has no `process.env` / `core/paths` / `views/layout` and `check-boundaries` is clean (F7)                                                       |
| `OfficeDocsFrame`                                                        | Iframe + protocol host: mints the token, answers `init` (theme from the app theme, `locale` from i18n), relays `dirty` / `title` / `saved` / `error`, leave-dialog on dirty, save-as (session `createDocumentFile`, mint a token for the copy, rebind the frame, `onSavedAs` navigates) |
| `docs-frame-protocol.ts`, `docs-frame-endpoint.ts`, `docs-frame-host.ts` | Vendored fork copy, header names the fork SHA; byte-identical to fork `8687750` since the RP2 re-pin (protocol files unchanged since `4cd31f8`)                                                                                                                                                       |
| `createDocsFrameApi` (`packages/core`, `docs-frame-api.ts`)              | `api.*` over `createOfficeFrameClient`: open, save (409 -> `conflict`), recents, images, `exportPdf` (live bytes win; 501 -> `unsupported`; 504 timeout; 413 `too_large`; `%PDF-` check)                                                                                                |

**Frame token** (`server/internal/service/office_frame.go`): HMAC-signed, minted by
`POST /api/v1/documents/{id}/office/frame-token` (session auth). Claims `{v, d documentId, w workspaceId,
o organizationId, u userId, e expiresAt, n nonce}`; TTL `OfficeFrameTokenTTL` = 10 minutes. There is no Bearer refresh route (removed after R2 M2: a copied token could be
renewed forever, and nothing used it): the host re-mints through the session route for the frame's `token.refresh`
(60 s before expiry or after a 401). A token minted while the flag is on stops working when the override is
switched off. Any
invalid, expired or foreign token is one 401. The token travels only in the `init` message (never cookies, URL or
storage); the frame sends it as `Authorization: Bearer` only on `/api/v1/office-frame/*`.

**Routes** (`server/internal/handler/router/office_frame.go`, `office_frame_export.go`):

| Method + path (`/api/v1/office-frame/...`)          | Purpose                                                                                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /documents/{id}`                               | Open (metadata, content URL, etag)                                                                                                                                              |
| `GET                                                | HEAD /documents/{id}/content`                                                                                                                                                   | Document bytes                                |
| `POST /documents/{id}/uploads`                      | Save intent                                                                                                                                                                     |
| `POST /documents/{id}/versions/commit`              | Save; stale etag -> 409 `conflict`                                                                                                                                              |
| `GET /documents/{id}/recents`                       | Recents                                                                                                                                                                         |
| `POST /documents/{id}/assets`, `/assets/sign`, `GET | HEAD /assets/{assetId}`                                                                                                                                                         | Images (Bearer or `?sig=` bound to the asset) |
| `POST /documents/{id}/export/pdf`                   | Server PDF: view access suffices, one 20 req/min budget per frame user across all documents (R2 M5), optional multipart `file` xor `version`, `Idempotency-Key`; 200 `application/pdf`, 501 / 503 / 504 as in section 4 |

All routes are Bearer-only, behind `documents` + `office_docs_web`, recheck access per request, and reuse
Documents/FileService so audit and outbox stay in the existing transaction (no migration). Export is an office
job (`export:docx`) with the per-job signed grant and uid sandbox; audit = `office_jobs` row +
`document_access_logs` action `export`; an export output is never committed as a version
(`office_job_export_not_a_version`).

**Flag.** `office_docs_web` (`server/internal/featureflags/keys.go`): **default on** (user decision 2026-10-09:
every Office web module flag defaults on), Public, Owner `office`, **ReviewAt 2026-12-05**. Evaluated per
organization at token mint (fix `2a01d6c03`; `TestOfficeFrameFlagIsEvaluatedPerOrganization`). An org or user
override can still turn it off (mint answers 403 `feature_disabled` and the page shows the G3 editor), and the
frame falls back to G3 whenever the pinned bundle is not installed or does not verify (F3b; the mint failure is
a distinct `feature_disabled`, never "document gone"). The flag-off case in the tests uses an explicit org override.

**Bundle sync / pin / CSP** (`apps/web`): the ~18 MiB fork build is not committed. `platform/office-frame/docs.pin.json`
pins `version` (`0.1.0-8687750`, 46 files), `gitSha`, `entry`, `manifestSha256` and the CSP header; `office-frame-sync.mjs`
(`office-frame:sync` / `:check`, `--ensure` in `pnpm build|dev`) refuses any manifest/file digest mismatch, path
escape, differing `csp.json` and dirty builds (it verifies the archive before extracting, with caps of 2000 entries,
160 MiB unpacked, 64 MiB archive and a 120 s deadline), then installs into git-ignored `public/office-frame/docs/<v>/`.
Headers on every `/office-frame/` path (`next.config.mjs` -> `frame-headers.mjs`): pinned
`Content-Security-Policy` (`default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'
data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; frame-src 'none'; object-src 'none';
base-uri 'self'; form-action 'self'; frame-ancestors 'self'`), `X-Frame-Options: SAMEORIGIN`, `nosniff`,
`Referrer-Policy: no-referrer`; `assets/**` + `fonts/**` immutable 1 year, `index.html` / `manifest.json` /
`csp.json` `max-age=0, must-revalidate`; unpinned paths get `default-src 'none'`. `office-frame` is a reserved slug.

**Security notes.**

- Protocol: exact allowed-origin list (no `*`, `null`), `ev.source` check both directions, token only in the client
  closure, `credentials: 'omit'`; verified by the fork reviewer R1 as sound.
- The frame is **same-origin** with UniWork (GO-D2, not reopened): `connect-src 'self'` and `omit` are conventions,
  not enforcement. Script running in the frame (e.g. XSS via document content) could call the UniWork API with
  ambient cookies. Keep document-rendering paths free of raw HTML injection until the frame moves to its own
  origin; the cookie-free token and `WEB_DOCS_CSP_FRAME_ANCESTORS` are the prepared path.
- `FileSource {kind: 'url'}` must be same-origin (or `bytes`): a presigned URL on another origin is blocked by
  `connect-src` unless the host widens it in the `csp.json` it serves (documented in `web/docs/build/README.md`).
- Export runs Chromium with `--no-sandbox` only under the per-slot uid (section 4, prerequisite 3).
- `docs/office/docs-web-frame.md` is current: save-as and export are wired; attachments, HTML export and `file.pick`
  still answer `unsupported`.

## 6. Open items

**Decided (user, 2026-10-09):**

- **No autosave on the web**, for Docs and every other module: explicit user save only; `autoSaveToDisk` stays `false`,
  so the AutoSave toggle stays hidden.
- **Dark page as on desktop** (visual #1, closed by design): on in the dark theme, a View toggle, a document's own page
  colour untouched; print / PDF / export / clipboard keep authored colours.
- **Office web flags default on** (`office_docs_web` here); an override can turn a module off. HTML scripts + visual
  edit, Slides presenter view, web draft recovery (Docs too) and web AI belong to lanes GO-B4/5/6 and GO-A7.

**Reviews.** R2 (dev, `e2f4d6489`): all five majors fixed (M1 headless entry + engine on the pinned bundle, M2 refresh
route removed, M3 knip ignore, M4 frame only with an installed, verified bundle, M5 one export budget per user); minors
m1-m9 and m11 fixed (m10, a stale doc pointer, not re-checked). R1 (fork) residuals, not blocking: capabilities from
`init` do not reach the UI (F1 added open/recents grants and a dirty guard); nits n1-n8 in
`.uniwork-lane/review-fork.md` (duplicated `downloadBlob`, stale header comments, Ribbon formatting churn,
`web/measure/measurements-b3*.json` committed).

**Visual (V1 r2 PASS, `reports/uni-1013-visual/REPORT-r2.md`; r3 recheck: PENDING).** Open: minor **N1** (frame chrome
flips to light while exporting in the dark UI: the print path's light pin is visible on screen; owner fork renderer)
and nits N2 (denied state offers a retry that cannot succeed; dev host), N3 (error toast covers ribbon commands after a
failed save), N4 (leftover "Opened ..." status text), plus one status-text nit listed in STATUS but not itemised in the
r2 report.

**Test failures that are not lane-caused** (checked lane vs base, T1 / F12 / F13):

- dev: `core realtime/use-realtime-sync.test.tsx:544` and `views layout/dashboard-layout.test.tsx` x2 fail identically
  on develop `5b5882b22`; Go `TestRelay*` x6 pass locally and fail only on the cloud VM (Redis 7.0.15).
- fork: `docs-spell-suggestions:71` is flaky on main too (native spellchecker). `docs-visual` x5 and `font-covering`
  come from the replica VM's fonts (identical diffs, byte-identical actual PNGs lane vs main; goldens untouched).
  `docs-table-float-click:78` fails only on the cloud VM and passes 3/3 locally on the lane; the final replica specs
  exclude it and the `docs-visual` kitchen-sink case, so those two are not proven green by the replica. F13 (docs-table-float-click): PENDING.

**Still open**

- **Frame e2e cases cannot run in the cloud VM** (no https bundle source for `OFFICE_FRAME_SOURCE`): the cloud shards
  run only "not installed -> G3"; the frame cases run locally on a production build.
- **~940 px frame ribbon:** the Home row is ~1058 px, so the ribbon scrolls slightly sideways (F12 fixed the Styles
  card click, not the width).
- **Engine image** needs Chromium + the pinned bundle (`UNIWORK_DOCS_PDF_ASSETS`) and `OFFICE_ENGINE_MEMORY_MB`
  >= 1024; until then the export route answers 501 / 503 and the frame falls back to print.
- **Attachments and `projectApi`** are browser-local / in-memory while AI is hidden; they need host-backed versions
  (`api.attachments.add` exists in the protocol, unused) when AI ships on the web.
- **Images on file documents are kept until purge** (dev-uniwork storage). **Mixed-paper print:** the browser dialog uses
  one paper size; the server PDF merges mixed-paper parts once the engine image is deployed. **CJK font cost / i18n
  share of JS** (section 3) are renderer work; **`fontMetrics`** (null on the web) likely causes the 0.34 % PDF diff.
- Protect dialog keeps a web string variant (`appProtectDescWeb`). Docs web e2e specs open documents only through
  `/test-host/` (the frame no longer opens `/?open=`).
- Fork cloud replica **r5** on fresh VMs (the reference round) had not reported when this was written.

## 7. Evidence index

Fork (`uniwork-office`, branch `feature/UNI-1013-docs-web-bridge`):

| What                                                       | Where                                                                                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Spike report, inventory, hide audit, baseline measurements | `docs/web-spike/REPORT.md`, `bridge-inventory.json`, `hide-flags.md`, `measurements.md`                                           |
| Protocol contract + auth/origin model                      | `web/docs/protocol/README.md`, `types.ts`; tests `web/docs/protocol/test/`                                                        |
| Bridge (WEB-API, session) + tests                          | `web/docs/bridge/webapi.ts`, `session.ts`, `webapi.test.ts`, `testing/mock-port.ts`                                               |
| Hide / capabilities / print                                | `docs/web-docs/w4-hide-browser.md`, `apps/docs/tests/web-capabilities.test.ts`, `web/docs/bridge/hide.test.ts`, `browser.test.ts` |
| W4 screenshots + Playwright                                | `docs/web-docs/screenshots/w4/` (01-10), `web/e2e/w4-hide.spec.ts`                                                                |
| Test host                                                  | `web/server/test-host/`                                                                                                           |
| Bridge e2e results + screenshots                           | `docs/web-docs/bridge-e2e/results.md`, `results-*.json`, `*-saved.png`, `*-conflict.png`, `console-*.txt`                         |
| Build pipeline, manifest, CSP                              | `web/docs/build/README.md`, `web/e2e/csp-header.spec.ts`                                                                          |
| Measurements                                               | `web/measure/measurements-b3.md`, `measurements-b3.json`, `measure-b3.mjs`                                                        |
| Fork code review (R1) + fixes                              | lane file `.uniwork-lane/review-fork.md`; fix commits `a0f5fd4`, `db550c0`, `5b5008e`, `5bce54c`                                  |
| Headless entry, F11 handoff                                | `web/docs/bridge/headless.ts`, `doc-handoff.ts` (+ tests), `apps/docs/src/renderer/doc-bytes.ts`, `web/e2e/headless.spec.ts` |
| F4 visual fixes, before / after                            | `docs/web-docs/screenshots/f4/` (01-06 `*-before` / `*-after` PNGs, `facts-*.json`, `capture.mjs`, README) |
| Cloud replica reports (fork)                               | dev lane worktree `reports/uni-1013-cloud/fork-r1.md` ... `fork-r4.md` (r5 pending), untracked by design |

dev-uniwork (branch `feature/UNI-1013-office-docs-web`):

| What                                | Where                                                                                                                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serving, pin, headers               | `docs/office/docs-web-frame.md`, `apps/web/platform/office-frame/` (`docs.pin.json`, `frame-headers.mjs`), `apps/web/scripts/office-frame-sync.mjs`                                            |
| PDF export decision + repro scripts | `docs/office/pdf-export-decision.md`, `docs/office/pdf-export/`                                                                                                                                |
| Host e2e results + screenshots      | `reports/uni-1013-w7-evidence/RESULTS.md`, `screenshots/01-06`; spec `e2e/office-docs-web.spec.ts`                                                                                             |
| Frame, token, routes                | `packages/views/office/frame/`, `packages/core/office/docs-frame-*.ts`, `server/internal/service/office_frame.go`, `office_frame_export.go`, `server/internal/handler/router/office_frame*.go` |
| Flag                                | `server/internal/featureflags/keys.go` (`office_docs_web`)                                                                                                                                     |
| Visual reports (V1)                 | `reports/uni-1013-visual/REPORT.md` (r1, NOT PASS), `REPORT-r2.md` (r2, PASS), `crops*/`, `screenshots-r2/`, `screenshots-r3/` (r3 PENDING), `capture.spec.ts`; branch `zone17th/uni-1013-v1-visual`; lane copies `.uniwork-lane/visual-v1.md`, `visual-v1-r2.md` |
| Cloud runner reports (dev)          | `reports/uni-1013-cloud/r1.md`, `r2.md`, `r3.md` (+ `r1b/`, `r2/`, `r3/` logs), untracked by design; the lead commits them at DONE |
| Code review R2                      | lane file `.uniwork-lane/review-dev.md`; fixes F3a `9cf174343`, F3b `578aff206`, F7 `5e44ffcc2`, F8 `4a59e4d9b` |

**Final SHAs:** fork FORK_SHA, dev-uniwork DEV_SHA (filled by the lead).
