# genoffice Docs inside UniWork web — lane report (GO-B2 + GO-B3)

Tickets UNI-1012 / UNI-1013 (parent UNI-1001). Fork lane branch `feature/UNI-1013-docs-web-bridge`;
UniWork lane branch `feature/UNI-1013-office-docs-web` (dev-uniwork). Starting point: the GO-B1 spike,
`docs/web-spike/REPORT.md`.

Decisions not reopened in this lane: same-origin iframe + postMessage (no in-page mount, no Shadow DOM);
the protocol does not use cookies (the host passes a short-lived token in `init`); AI / web search /
image search / image generation stay stubbed and hidden on the web (needs ADR GO-C2).

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

**Save conflict, save-as, theme/language, print** (review fixes F1 + W4c):

- A frame-initiated save with a stale etag now emits a host `error {code: 'conflict'}` event and opens an
  in-frame Cancel / Reload / Overwrite dialog (i18n in zh + 20 shards); the stale etag is re-synced after a
  timed-out save. "A save is already running" answers `busy`, not `conflict`.
- Host save-as: host `saveAs {name}` runs the editor's Save As with the host's name; the first save of an
  untitled document is a silent `api.saveAs`.
- `init.theme` / `init.locale` and the later `theme` / `language` events are applied live in the frame
  (`host-appearance.ts`), host wins over `localStorage`, never written to it (screenshots 09, 10).
- Host `print` goes through the browser print path and is answered after `afterprint`.

**Tests** (`npm run test:web`, `npm run typecheck:web`, both in CI since 5bce54c): protocol 74, bridge 106,
build 26 (counts as re-verified by the lead at 5bce54c; `apps/docs/tests/web-capabilities.test.ts` 14/14).
E2E through the test host (W4b/W4c): 17/17, plus Playwright 20 passed incl. `csp-header.spec.ts` x3 with zero
`securitypolicyviolation` (W1, at 2953d27). The e2e figures above (3 fixtures x 11 steps) are from
`docs/web-docs/bridge-e2e/results.md`; the conflict step there predates the F1 dialog.

**Host side, end to end** (dev-uniwork W7/W7b, `reports/uni-1013-w7-evidence/RESULTS.md`, 7/7 on a production
build with an organization-scoped flag): sign in -> docx opens in the iframe -> edit -> Ctrl+S -> a new
Documents version whose `word/document.xml` holds the edit -> fresh navigation shows it; File > Save as creates
a copy that holds the edit, the page URL follows the copy, the original gains no version. Flag off keeps the G3
editor. Screenshots `01-opened-in-frame.png`, `02-saved.png`, `03-reopened.png`, `04-save-as-copy.png`.

**PDF export path.** Frame `api.export` -> host proxy -> `POST /api/v1/office-frame/documents/{id}/export/pdf`
(section 4). A 501 (no renderer) makes the frame fall back to the print dialog; a 504 / 413 / non-`%PDF-` body
are typed errors (W5d). Unit-tested on both sides; the export step through the real frame is covered by the fork
test-host e2e (host answers `api.export`), not yet by the dev-uniwork browser e2e (see section 6).

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

| Metric | Spike (UNI-1011) | Before (425edd9) | After (B3) | Source |
| --- | --- | --- | --- | --- |
| Initial download, raw | ~3.6 MiB JS chunk | 3.85 MiB | 3.85 MiB (same) | b3 §1 |
| Initial download, gzip | 1.11 MiB JS | 1.15 MiB | 1.15 MiB (same; brotli 0.90) | b3 §1 |
| Fonts in the initial download | not guaranteed (lazy by `@font-face`) | 0 | 0, enforced: under `fonts/`, never inlined | b3 §1, §5 |
| Total build, raw / gzip | 17.85 / 11.65 MiB | 17.87 / 11.66 MiB | 13.29 / 10.57 MiB (-26% / -9%) | b3 §1 |
| Font files | 14 MiB | 33 files, 14.01 MiB | 34 files, 9.42 MiB (20 Latin faces as lossless WOFF2) | b3 §1 |
| Latin doc font bytes (`long.docx`) | - | 0.53 MiB | 0.37 MiB (-30%) | b3 §3 |
| Wire by editable, gzip | - | 1.68-1.95 MiB | 1.53-1.72 MiB (-9 to -12%; simple +7%, late-font noise) | b3 §2 |
| Time-to-editable, gzip server | 0.57-0.99 s (raw server) | 1.00-1.51 s | 0.98-1.55 s (+/-9%, within noise) | b3 §2 |
| Time-to-editable, no compression | 0.57 / 0.64 / 0.99 s | 0.83-1.25 s | 0.78-1.19 s | b3 §2 |
| Served under `/office-frame/docs/<v>/` | - | - | 3/3 editable, 0 failed requests (0.85-1.14 s) | b3 §4 |

B3 times include the test-host boot, docx fetch and init handshake, so they are not comparable one to one with the
spike's standalone `?open=` load; the before/after columns are the like-for-like pair.

**Remaining costs (renderer work, outside this lane):**

- A document with Chinese text pulls Noto Sans CJK SC (2.4 MiB) after first paint.
- The first font-picker open fetches the CJK/KR fallbacks (+4.4-6.8 MiB) on machines without local CJK/KR fonts
  (this headless host is the worst case).
- i18n dictionaries are 35 % of the 3.83 MiB JS chunk (19 languages); lazy locales is the next lever.

## 4. Server PDF export

Full note: dev-uniwork `docs/office/pdf-export-decision.md` (W8, 2026-10-08). Needs only the pinned bundle and a
headless Chromium; no new service.

**Decision: (b) headless Chromium rendering the same Docs web bundle**, run as an office-engine job
(`export`, docx -> pdf, raw CDP over `--remote-debugging-pipe`, `docs-pdf.ts`). Option (a) = LibreOffice 7.4.7.
Baseline = desktop `--headless-export` (Electron 43.3.0 / Chromium 150 `printToPDF`). Pixel diff at 96 dpi grey,
threshold 32/255.

| Fixture | Desktop pages | (b) pages | (b) pixels differing | (a) pages | (a) pixels differing |
| --- | --- | --- | --- | --- | --- |
| simple | 1 | 1 | 0.000 % | 1 | 0.17 % |
| kitchen-sink | 1 | 1 | 0.341 % (CJK punctuation) | 1 | 3.23 % |
| long (tables) | 34 | 34 | 0.000 % (all pages) | **46** | 18.3 % mean |

| Arm (arm64, load ~10) | Per document | Peak RSS |
| --- | --- | --- |
| **(b) engine prototype**, Chromium per job | 1.6 / 1.7 / 2.5 s render (2.0-2.8 s wall) | 687-711 MB |
| (b) Playwright, warm / cold | 2.2-3.6 s / 4.6-6.1 s | ~708 / 652-688 MB |
| Desktop baseline (incl. app boot) | 5.1-11.7 s | 843-929 MB |
| (a) LibreOffice (container per doc) | 1.6-3.0 s | ~160 MB, image 888 MB |

**Why LibreOffice was rejected:** `long.docx` re-paginates 34 -> 46 pages; fonts are substituted (Carlito -> Noto
Sans, CJK -> serif JP, FreeSans/Liberation Serif dropped); on kitchen-sink the bullets render as tofu, the equation
`E = mc^2` is missing, the two-column table is stretched and headings change face. It cannot produce "the PDF of
what I see". It is lighter (160 MB), which does not outweigh that.

The kitchen-sink (b) difference is full-width CJK punctuation set proportionally; it is identical on Chromium
149 / 151 / full 151, so it is not a version effect. Likely cause: `fontMetrics` is `null` on the web bridge
(`web/docs/bridge/browser.ts`). Follow-up, not a renderer choice.

**Deploy prerequisites (open, none done):**

1. Stage headless Chromium (arm64 + amd64) and the Docs web bundle, built from the same fork SHA the frame
   serves, into the engine image under `UNIWORK_DOCS_PDF_ASSETS` (`bundle/` + `chromium`). Needs a Dockerfile
   change and a CJK-font check in the slim image. Without it the job fails `engine_incompatible` (route: 501).
2. `OFFICE_ENGINE_MEMORY_MB` >= 1024 (the 512 default kills a render as `memory_limit`).
3. Sandbox review: Chromium runs `--no-sandbox` inside the job uid slot with loopback-only network; consider
   seccomp / landlock.

Route and audit are in section 5. Frame side: `api.export` sends `fileId`, plus the live docx bytes in `data` when
the document is dirty; a host without byte support exports the stored version.

## 5. UniWork host side (dev-uniwork)

Lane branch `feature/UNI-1013-office-docs-web` (base 5b5882b22, head e2f4d6489 at the time of writing).
Serving note: `docs/office/docs-web-frame.md`.

**Components** (`packages/views/office/frame`, `packages/core/office`, `apps/web/platform/office-frame`):

| Piece | Role |
| --- | --- |
| `DocxOpenSwitch` | Reads `office_docs_web` for the document's organization (`useOfficeDocsWebEnabled`, org-scoped `GET /api/v1/config`); mounts `OfficeDocsFrame` only on a settled "on", the G3 host on anything else; no pinned version = G3 alone |
| `OfficeDocsFrame` | Iframe + protocol host: mints the token, answers `init` (theme from the app theme, `locale` from i18n), relays `dirty` / `title` / `saved` / `error`, leave-dialog on dirty, save-as (session `createDocumentFile`, mint a token for the copy, rebind the frame, `onSavedAs` navigates) |
| `docs-frame-protocol.ts`, `docs-frame-endpoint.ts`, `docs-frame-host.ts` | Vendored fork copy, header names the fork SHA; currently `b6f773f` (the W7c re-vendor to `5bce54c` is in progress, see section 6) |
| `createDocsFrameApi` (`packages/core`, `docs-frame-api.ts`) | `api.*` over `createOfficeFrameClient`: open, save (409 -> `conflict`), recents, images, `exportPdf` (live bytes win; 501 -> `unsupported`; 504 timeout; 413 `too_large`; `%PDF-` check) |

**Frame token** (`server/internal/service/office_frame.go`): HMAC-signed, minted by
`POST /api/v1/documents/{id}/office/frame-token` (session auth). Claims `{v, d documentId, w workspaceId,
o organizationId, u userId, e expiresAt, n nonce}`; TTL `OfficeFrameTokenTTL` = 10 minutes. `POST
/office-frame/token` re-mints for the same document/workspace/org (the frame's `token.refresh`, 60 s before
expiry or after a 401); a token minted while the flag is on stops working when the override is switched off. Any
invalid, expired or foreign token is one 401. The token travels only in the `init` message (never cookies, URL or
storage); the frame sends it as `Authorization: Bearer` only on `/api/v1/office-frame/*`.

**Routes** (`server/internal/handler/router/office_frame.go`, `office_frame_export.go`):

| Method + path (`/api/v1/office-frame/...`) | Purpose |
| --- | --- |
| `POST /token` | Refresh |
| `GET /documents/{id}` | Open (metadata, content URL, etag) |
| `GET|HEAD /documents/{id}/content` | Document bytes |
| `POST /documents/{id}/uploads` | Save intent |
| `POST /documents/{id}/versions/commit` | Save; stale etag -> 409 `conflict` |
| `GET /documents/{id}/recents` | Recents |
| `POST /documents/{id}/assets`, `/assets/sign`, `GET|HEAD /assets/{assetId}` | Images (Bearer or `?sig=` bound to the asset) |
| `POST /documents/{id}/export/pdf` | Server PDF: view access suffices, 20 req/min per frame user, optional multipart `file` xor `version`, `Idempotency-Key`; 200 `application/pdf`, 501 / 503 / 504 as in section 4 |

All routes are Bearer-only, behind `documents` + `office_docs_web`, recheck access per request, and reuse
Documents/FileService so audit and outbox stay in the existing transaction (no migration). Export is an office
job (`export:docx`) with the per-job signed grant and uid sandbox; audit = `office_jobs` row +
`document_access_logs` action `export`; an export output is never committed as a version
(`office_job_export_not_a_version`).

**Flag.** `office_docs_web` (`server/internal/featureflags/keys.go`): default off, Public, Owner `office`,
**ReviewAt 2026-12-05**. Evaluated per organization at token mint (fix `2a01d6c03`;
`TestOfficeFrameFlagIsEvaluatedPerOrganization`: an org override opens mint/open/save/refresh, another org stays
closed). G3 stays the default editor until acceptance.

**Bundle sync / pin / CSP** (`apps/web`): the ~18 MiB fork build is not committed. `platform/office-frame/docs.pin.json`
pins `version` (`0.1.0-2953d27`), `gitSha`, `entry`, `manifestSha256` and the CSP header; `office-frame-sync.mjs`
(`office-frame:sync` / `:check`, `--ensure` in `pnpm build|dev`) refuses any manifest/file digest mismatch, path
escape, differing `csp.json` and dirty builds, then installs into git-ignored `public/office-frame/docs/<v>/`.
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
- Export runs Chromium with `--no-sandbox` (section 4, prerequisite 3).
- `docs/office/docs-web-frame.md` still says save-as, export and attachments answer `unsupported`; that predates
  W5c / W5d: save-as and export are wired, attachments remain `unsupported`.

## 6. Open items

- **No autosave on the web** (product decision): `autoSaveToDisk` is `false`, since each autosave would create a new
  Documents version. A server-backed autosave would flip that capability (or add a key).
- **Attachments and `projectApi`** are browser-local / in-memory while AI is hidden; they need host-backed versions
  (`api.attachments.add`, `api.images.upload` exist in the protocol, unused) when AI ships on the web.
- **Images on file documents are kept until purge** (dev-uniwork storage side).
- **Mixed-paper print**: the browser print dialog uses one paper size; server PDF export merges mixed-paper parts in
  page order once the engine image is deployed.
- **CJK fallback font cost and i18n share of JS** (section 3): lazy font previews / `unicode-range` slices and lazy
  locales are renderer work.
- **Engine image** needs Chromium + the pinned bundle (`UNIWORK_DOCS_PDF_ASSETS`) and `OFFICE_ENGINE_MEMORY_MB`
  >= 1024; until then the export route answers 501 and the frame falls back to print.
- **`fontMetrics`** (null on the web) is the likely cause of the 0.34 % kitchen-sink PDF difference; implement in the
  web bridge or the engine page shim, then re-measure.
- **Protect dialog** keeps a web string variant (`appProtectDescWeb`); the "modify password / restrict editing"
  entries stay.
- **Dev-uniwork follow-up W7c**: re-vendor and re-pin the fork `5bce54c` (the dev pin is `2953d27` / vendored
  `b6f773f`, so host-side `busy`, handshake restart and cancel are not exercised yet) and add export + image e2e.
- **R1 residuals (fork, not blocking):** capabilities from `init` do not reach the UI (File > Open / recents stay
  visible; `file.pick` is not granted by the host, so Open is a no-op there; F1 added open/recents grants and a dirty
  guard); minor nits n1-n8 in `.uniwork-lane/review-fork.md` (duplicated `downloadBlob`, stale header comments,
  formatting churn in Ribbon, `web/measure/measurements-b3*.json` committed).
- **R2 dev review findings:** R2: pending
- The Docs web e2e specs open documents only through `/test-host/` (the frame no longer opens `/?open=`).

## 7. Evidence index

Fork (`uniwork-office`, branch `feature/UNI-1013-docs-web-bridge`):

| What | Where |
| --- | --- |
| Spike report, inventory, hide audit, baseline measurements | `docs/web-spike/REPORT.md`, `bridge-inventory.json`, `hide-flags.md`, `measurements.md` |
| Protocol contract + auth/origin model | `web/docs/protocol/README.md`, `types.ts`; tests `web/docs/protocol/test/` |
| Bridge (WEB-API, session) + tests | `web/docs/bridge/webapi.ts`, `session.ts`, `webapi.test.ts`, `testing/mock-port.ts` |
| Hide / capabilities / print | `docs/web-docs/w4-hide-browser.md`, `apps/docs/tests/web-capabilities.test.ts`, `web/docs/bridge/hide.test.ts`, `browser.test.ts` |
| W4 screenshots + Playwright | `docs/web-docs/screenshots/w4/` (01-10), `web/e2e/w4-hide.spec.ts` |
| Test host | `web/server/test-host/` |
| Bridge e2e results + screenshots | `docs/web-docs/bridge-e2e/results.md`, `results-*.json`, `*-saved.png`, `*-conflict.png`, `console-*.txt` |
| Build pipeline, manifest, CSP | `web/docs/build/README.md`, `web/e2e/csp-header.spec.ts` |
| Measurements | `web/measure/measurements-b3.md`, `measurements-b3.json`, `measure-b3.mjs` |
| Fork code review (R1) + fixes | lane file `.uniwork-lane/review-fork.md`; fix commits `a0f5fd4`, `db550c0`, `5b5008e`, `5bce54c` |

dev-uniwork (branch `feature/UNI-1013-office-docs-web`):

| What | Where |
| --- | --- |
| Serving, pin, headers | `docs/office/docs-web-frame.md`, `apps/web/platform/office-frame/` (`docs.pin.json`, `frame-headers.mjs`), `apps/web/scripts/office-frame-sync.mjs` |
| PDF export decision + repro scripts | `docs/office/pdf-export-decision.md`, `docs/office/pdf-export/` |
| Host e2e results + screenshots | `reports/uni-1013-w7-evidence/RESULTS.md`, `screenshots/01-04`; spec `e2e/office-docs-web.spec.ts` |
| Frame, token, routes | `packages/views/office/frame/`, `packages/core/office/docs-frame-*.ts`, `server/internal/service/office_frame.go`, `office_frame_export.go`, `server/internal/handler/router/office_frame*.go` |
| Flag | `server/internal/featureflags/keys.go` (`office_docs_web`) |

**Final SHAs:** fork FORK_SHA, dev-uniwork DEV_SHA (filled by the lead).
