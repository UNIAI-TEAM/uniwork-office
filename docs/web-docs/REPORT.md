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

Unit tests at the time of writing: protocol 67/67 (`npx vitest run --root web/docs/protocol`), bridge
88/88 (`npx vitest run --root web/docs/bridge --environment jsdom`), `tsc` clean for both
(`npx tsc -p web/docs/protocol/tsconfig.json`, `npx tsc -p web/docs/bridge/tsconfig.json`).

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

_Placeholder: W1's numbers (versioned build, header CSP, lazy fonts), filled in by the lead._

| Metric                    | Spike (UNI-1011)                     | This lane | Source                           |
| ------------------------- | ------------------------------------ | --------- | -------------------------------- |
| Initial download, raw     |                                      |           |                                  |
| Initial download, gzip    |                                      |           |                                  |
| Total bundle (raw / gzip) | 17.85 MiB / 11.65 MiB (14 MiB fonts) |           | `docs/web-spike/measurements.md` |
| Time-to-editable          | 0.6–1.0 s                            |           |                                  |

## 4. Server PDF export

_Placeholder: W8's decision note (dev-uniwork) to be linked here._

Prototype figures reported by W8: headless Chromium `page.pdf` on the same renderer; page counts match
desktop on the 3 fixtures (1 / 1 / 34); simple and long pixel-identical, kitchen-sink 0.34 % pixel
difference; warm render 2.2–3.6 s per document; about 700 MB RSS. The frame side is ready: `api.export`
sends `fileId` and, for unsaved edits, the live docx bytes in `data` (a host without byte support
exports the stored version).

## 5. UniWork host side (dev-uniwork)

_Placeholder: summary from the dev-uniwork lane._ Components to cover: `OfficeDocsFrame` (iframe +
protocol host, token handoff, dirty/title/theme/language), `DocxOpenSwitch` (picks the genoffice frame
when the flag is on), the server-minted frame token (one document + workspace, short TTL), the
`/api/v1/office-frame` routes behind `api.*`, the feature flag `office_docs_web`, and the vendored
protocol copy (`packages/core/office/docs-frame-protocol.ts` + endpoint/host, fork SHA in the header).

## 6. Open items

- No autosave on the web: `autoSaveToDisk` is `false`; a server-backed autosave would flip that
  capability (or add a key), not revive the desktop toggle.
- Attachments and `projectApi` are browser-local / in-memory while AI is hidden; they need host-backed
  versions when AI ships on the web.
- Images on file documents are kept until purge (dev-uniwork storage side).
- Mixed-paper documents: the browser print dialog uses one paper size; pages are not grouped into
  separate jobs on the web (server PDF export covers this once wired).
- AI / web search / image search / image generation need ADR GO-C2 before they can be enabled.
- W1's `web/e2e/csp-header.spec.ts` and `web/measure/*` open the frame standalone (`/?open=`); since
  GO-B3 the frame only opens documents a host sends, so they need to go through `/test-host/`.

## 7. Evidence index

| What                                              | Where                                                                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Spike report, inventory, hide audit, measurements | `docs/web-spike/REPORT.md`, `bridge-inventory.json`, `hide-flags.md`, `measurements.md`                                           |
| Protocol contract + auth/origin model             | `web/docs/protocol/README.md`, `types.ts`                                                                                         |
| Protocol tests                                    | `web/docs/protocol/test/`                                                                                                         |
| Bridge (WEB-API, session) + tests                 | `web/docs/bridge/webapi.ts`, `session.ts`, `webapi.test.ts`, `testing/mock-port.ts`                                               |
| Hide / capabilities / print notes                 | `docs/web-docs/w4-hide-browser.md`, `apps/docs/tests/web-capabilities.test.ts`, `web/docs/bridge/hide.test.ts`, `browser.test.ts` |
| W4 screenshots + Playwright                       | `docs/web-docs/screenshots/w4/`, `web/e2e/w4-hide.spec.ts`                                                                        |
| Test host                                         | `web/server/test-host/`                                                                                                           |
| Bridge e2e results + screenshots                  | `docs/web-docs/bridge-e2e/results.md`, `results-*.json`, `*-saved.png`, `*-conflict.png`                                          |
| Measurements (W1)                                 | _to be added_                                                                                                                     |
| Server PDF export (W8)                            | _to be added_                                                                                                                     |
| UniWork host + e2e (dev-uniwork)                  | _to be added_                                                                                                                     |
