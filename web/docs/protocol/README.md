# Docs frame protocol (UNI-1013)

The postMessage contract between the UniWork page (**host**) and the genoffice Docs editor running in a
same-origin `<iframe>` (**frame**).

| File          | Side                                                                 | Vendored by the host?                 |
| ------------- | -------------------------------------------------------------------- | ------------------------------------- |
| `types.ts`    | both: envelope, message maps, `DocsProtocolError`, runtime validator | yes (no imports)                      |
| `endpoint.ts` | both: origin/source checks, correlation, timeouts, cancellation      | yes (imports `./types`)               |
| `host.ts`     | UniWork page: `createDocsFrameHost()`                                | yes (imports `./types`, `./endpoint`) |
| `client.ts`   | iframe: `createDocsFrameClient()`                                    | no                                    |

dev-uniwork vendors `types.ts` + `endpoint.ts` + `host.ts` into `packages/core/office/` with the fork SHA in a
header comment. None of them import anything outside this directory.

## Wire format

Every message is one envelope:

```ts
{ ns: 'uniwork.office.docs', v: PROTOCOL_VERSION, id, kind: 'request' | 'response' | 'event', type, payload?, error? }
```

- `ns` tags our traffic; anything else on `message` is ignored silently.
- `v` is on **every** message. Peers must match exactly (`PROTOCOL_VERSION = 1`).
- A `response` echoes the request's `id` + `type` and carries `payload` (success) or `error` (`ProtocolErrorShape`).
- `parseEnvelope()` validates the envelope and, for every known `kind:type`, the payload shape (hand-written, no
  deps). Unknown types pass validation so the receiver can answer `unknown_type`.

## Messages

Handshake: frame boots → emits `ready` (re-sent every 500 ms until answered) → host checks the version, calls
`getInit()` (mints a token) → sends `init` → frame answers with `InitAck`. A later `ready` (frame reload) runs the
handshake again. `ready.instanceId` (random per page load) lets the host tell a retry from a reload: while a
handshake is in flight, `ready` with the same id is ignored and a new id aborts the pending `init` and restarts
(frames that send no `instanceId` keep the old behaviour: retries during a handshake are ignored). When the frame
gets no `init` within its retry budget (40 × 500 ms), or is opened top-level (`window.parent === window`),
`whenInitialized()` rejects (`timeout` / `not_ready`) and the editor shows an error instead of "Opening…".

### Host → frame

| type             | kind    | payload → result                                                                                                                                                                                                                        |
| ---------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`           | request | `InitPayload` {protocolVersion, token, tokenExpiresAt, documentId, workspaceId, apiBase, apiMode, locale, theme, capabilities, open?, module?, user?, recovery?} → `InitAck` {protocolVersion, frameVersion?, capabilities (effective)} |
| `open`           | request | `OpenPayload` {file: FileMeta, source: {kind:'url', url} \| {kind:'bytes', data}, assets?} → {opened, title?}                                                                                                                           |
| `save`           | request | {reason: 'user' \| 'navigate' \| 'autosave'} → `SaveResult`                                                                                                                                                                             |
| `saveAs`         | request | {name?} → `SaveResult`                                                                                                                                                                                                                  |
| `print`          | request | {mode?: 'dialog' \| 'pdf'} → {printed}                                                                                                                                                                                                  |
| `doc.closeCheck` | request | {} → {dirty, autoSave}                                                                                                                                                                                                                  |
| `token.update`   | event   | {token, tokenExpiresAt} — proactive rotation                                                                                                                                                                                            |
| `theme`          | event   | {theme: 'light' \| 'dark'} (host resolves "system")                                                                                                                                                                                     |
| `language`       | event   | {locale}                                                                                                                                                                                                                                |
| `file.renamed`   | event   | {file: FileMeta}                                                                                                                                                                                                                        |
| `cancel`         | event   | {id} — abort a host→frame request                                                                                                                                                                                                       |

### Frame → host

| type                   | kind    | payload → result                                                                      |
| ---------------------- | ------- | ------------------------------------------------------------------------------------- |
| `ready`                | event   | {protocolVersion, frameVersion?, capabilities, instanceId?, module?}                  |
| `token.refresh`        | request | {reason: 'expiring' \| 'unauthorized'} → {token, tokenExpiresAt}                      |
| `api.open`             | request | {fileId} → `OpenPayload`                                                              |
| `api.save`             | request | {fileId, data, etag?, auto?} → `SaveResult` (etag mismatch → `conflict`)              |
| `api.saveAs`           | request | {name, data, sourceFileId?, folderId?, silent?} → `SaveResult`                        |
| `api.recents`          | request | {limit?} → {files: FileMeta[]}                                                        |
| `api.export`           | request | {format: 'pdf' \| 'html', fileId?, data?, html?, geometry?} → {data, mimeType, name?} |
| `api.attachments.add`  | request | {files: UploadItem[]} → {accepted, rejected}                                          |
| `api.images.upload`    | request | UploadItem + {fileId?} → {imageId, url}                                               |
| `file.pick`            | request | {purpose: 'open' \| 'insert', accept?} → {file: OpenPayload \| null}                  |
| `image.fetch`          | request | {url (http/s)} → {image: {base64, mime} \| null}                                      |
| `convert.altChunkHtml` | request | {html} → {data: ArrayBuffer \| null}                                                  |
| `dirty`                | event   | {dirty} (client de-duplicates)                                                        |
| `title`                | event   | {title}                                                                               |
| `modal`                | event   | {open} — a frame dialog is open; the host may dim its own chrome (advisory, additive) |
| `resize`               | event   | {height} (CSS px, content height)                                                     |
| `saved`                | event   | {file, versionId?, initiatedByFrame}                                                  |
| `error`                | event   | {error: ProtocolErrorShape, fatal}                                                    |
| `cancel`               | event   | {id} — abort a frame→host request                                                     |

`api.*`, `file.pick`, `image.fetch` and `convert.altChunkHtml` are proxied by the host's `api` handlers; a type
without a handler answers `unsupported` (e.g. AI-adjacent calls stay unavailable on the web).

Capabilities: `save`, `saveAs`, `recents`, `filePick`, `print`, `exportPdf`, `exportHtml`, `attachments`, `images`,
`ai`, and (additive, CONTRACT C16) `webSearch`, `imageSearch`, `imageGeneration`. The effective set is the frame's ∩
the host's grant. The three cloud-tool keys only count together with `ai`; see "AI (web)" below. The frame hides File > Open / Ctrl+O unless `filePick`
is granted (grant it only with an `api` handler for `file.pick`) and stops asking for recents without `recents`.

`FileSource {kind:'url'}` (in `init.open`, `open`, `api.open`, `file.pick`) must be **same-origin** with the frame,
or the host must send `{kind:'bytes'}`: the frame bundle's CSP is `connect-src 'self'` (baked in at build time,
`web/docs/build/csp.ts`), so a presigned URL on another origin (S3/MinIO) is blocked. A host that needs a foreign
URL must widen `connect-src` in the CSP it serves (`csp.json`) for that origin.

### Errors

`ProtocolErrorShape = {code, message, retryable?, status?, details?}`; host/client reject with
`DocsProtocolError` (same fields, `instanceof`-checkable). Codes: `timeout`, `cancelled`, `version_mismatch`,
`malformed`, `unknown_type`, `not_ready`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `too_large`,
`rate_limited`, `network`, `unsupported`, `busy`, `internal`. `conflict` only means "the document changed on the
server"; `busy` means the same operation is already running (e.g. a host `save` while a save is in flight) and the
host should retry later rather than open its conflict UI. `errorFromHttpStatus()` maps UniWork API statuses
(401/403/404/409+412/413/429/5xx); anything else thrown by a handler becomes `internal` (or `network` /
`cancelled` for fetch failures / aborts). UIs translate `code`, never `message`.

## Modules

One protocol serves every genoffice editor on the web (lane GO-B4/B5/B6, UNI-1014/1015/1016): `ns` stays
`uniwork.office.docs` and `PROTOCOL_VERSION` stays `1`. The additions are optional fields:

- `type OfficeModule = 'docs' | 'pdf' | 'markdown' | 'html' | 'slides' | 'sheets'` (`OFFICE_MODULES`,
  `isOfficeModule()`).
- `ready.module`: the editor the frame bundle runs. `init.module`: the module of the document the host opens.
  **Absent = `'docs'`** on both (`moduleOf()`), so a pre-module Docs frame and a pre-module host keep working
  unchanged. The Docs bridge still sends no `module`.
- Validation: an unknown module value is `malformed` on the wire (`parseEnvelope`).
- Host check (`checkFrameModule(ready, expected)` in `types.ts`, so it is vendored with the rest): returns
  `null` on a match, otherwise a `DocsProtocolError` `malformed` with `details: {frameModule, expectedModule}`.
  `createDocsFrameHost({ module })` runs it on every `ready` **before** `getInit()` (no token is minted for the
  wrong editor), fails the handshake through `onHandshakeError`, and puts `module` into `init`. Without the
  option, a `module` returned by `getInit()` is checked the same way after the call.
- Frame check: `createDocsFrameClient({ module })` sends `module` in `ready` and refuses an `init` for another
  module (`malformed`, `whenInitialized()` rejects); `FrameSession.module` reports the module.
- `init.user?: {displayName}`: who is signed in, as editors display it (PDF note author, comment author). Display
  data only; the frame never authorises anything with it. `FrameSession.user` carries a copy.
- `OpenPayload.assets?: Record<path, url>` (in `init.open`, `open`, `api.open`, `file.pick`): relative resources of a
  text document (Markdown/HTML `assets/x.png`) mapped to URLs the frame loads them from. Same rules as
  `FileSource {kind:'url'}`: same-origin (frame CSP), fetched with `credentials: 'omit'`. Empty keys/values are
  `malformed`.
- New capability keys for a module are optional `Capabilities` fields (absent = false on the host grant side);
  receivers already ignore unknown keys. New message types are added only when a module truly needs one, as
  optional/additive entries documented here.

## Read-only documents and saving

- **View-only** is the host withholding the `save` grant: when the effective capabilities (`InitAck` /
  `FrameSession.capabilities`) have `save !== true`, the frame is a viewer. A frame then hides or disables its save
  entries (Ctrl+S, File > Save, close-guard "Save"), never sends `api.save`, and answers a host `save` with
  `ok:false` / `unsupported`. `FileMeta.writable === false` means the same for that file. No extra field is needed.
  `saveAs` is a separate grant (a host may allow "save a copy" of a document the user cannot overwrite).
  The module bridges (`web/modules/<module>/`) implement this; the Docs bridge does not wire it yet (open item
  from GO-B4: the Docs host always grants `save` today).
- **No autosave on the web** (lane decision C10, 2026-10-09): Docs and every module save only on an explicit user
  save. Hosts never send `save {reason: 'autosave'}`; web bridges never set `api.save.auto`; every module's
  autosave capability is false on the web and its UI hidden. The `autosave` / `auto` values stay in the types for
  wire compatibility only.

### Draft recovery (`init.recovery`, CONTRACT C18)

- `init.recovery?: {key: CryptoKey, scope: string}` (`InitRecovery`, `isInitRecovery()`): the host's grant for
  local draft copies. `key` is an AES-GCM 256 key the host generates with `extractable: false` and **persists per
  user** (structured clone, never exported) in IndexedDB database `uniwork-office-frame-drafts`, store `keys`, so it
  survives page reloads and is shared by the user's tabs (C18a); it reaches the frame by structured clone (again in a
  later `init` after a frame reload). `scope` is `"<userId>:<documentId>"`, opaque to the frame (the per-user stores
  use the part before the last `:`). Absent = recovery off: the frame writes nothing and shows nothing.
  `FrameSession.recovery` carries a copy.
- Frame side (`web/docs/bridge/draft-recovery.ts`, used by Docs and every module bridge): while the document is
  dirty, every 30 s and on `pagehide`, the frame writes `{iv, ciphertext, baseEtag, savedAt, module, name}`
  (ciphertext = AES-GCM of the document's current bytes) into the same database, store `drafts`, key
  `scope + ":" + baseEtag + ":" + tabId` (`tabId` random per frame load). A successful save deletes this load's
  records; Discard deletes the record it offered. On open, the newest decryptable record of the scope (labelled as
  based on an older version when its etag differs) is offered as Restore / Discard; Restore loads the bytes as a
  dirty document (the user must save) and deletes the restored record. **A record that does not decrypt is skipped,
  never deleted** (it may belong to a live tab or a later sign-in).
- The database is shared by host and frame: stores `keys` (host) and `drafts` (frame; also the PDF saved-signature
  list under `~signatures:<user>`), both created at version 1 by whichever side opens first, the version never bumped;
  see `docs/web-modules/draft-recovery.md`.
- Drafts never leave the browser: no `api.save` (and never `auto`), no version, no host message (C10 holds).
  The host deletes the whole database on sign-out / session switch (keys, drafts and saved PDF signatures with it).

## AI (web, CONTRACT C16)

The frame calls the GO-A7 web AI routes itself; there is **no postMessage relay** for AI. The host only decides
whether AI exists for this document (grants) and keeps answering `token.refresh`.

- **Grants.** `ai` (the AI panels and every AI entry) and, each only together with `ai`, `webSearch`, `imageSearch`,
  `imageGeneration` (UniWork cloud tools; image generation also covers media analysis). Grant `ai` only when the
  organization has the entitlement **and** the frame-token AI mount below is live; without it every AI entry stays
  hidden exactly as before. Every frame (Docs and all modules) declares the four keys in `ready`.
- **Routes** (same origin as the frame: the bundle CSP is `connect-src 'self'`): the path of `init.apiBase`
  (`/api` or `/api/v1`) on the frame's origin + `/v1/office-frame/documents/{documentId}/ai/...`:
  `credentials` GET, `credentials/{provider}` PUT / DELETE (masked `key_hint` only, the key is write-only),
  `byok/{provider}/chat/completions` | `/messages` | `/generate` POST and `/models` GET (the vendor's own wire
  format; SSE stays SSE; no key from the frame), `cloud` GET, `cloud/search` | `/images` | `/media/analyze` |
  `/transcribe` POST.
- **Auth.** `Authorization: Bearer <frame token>`, `credentials: 'omit'`, `mode: 'same-origin'`; one retry with a
  refreshed token after a 401 (a second 401 is the "session expired" state).
- **Errors** (`{error: {code, message}}`, the UniWork envelope; the flat `{code, message}` is read too; the UI picks a typed state from the status, never the message): 400
  `provider_not_supported` / `base_url_refused`, 402 `credits_exhausted`, 403 `entitlement_required`, 404
  `credential_missing`, 424 `provider_auth_failed`, 429 (+ `retry-after`), 502 `provider_unreachable`, 503
  `cloud_unavailable`. A provider's own 400/404 passes through to the genoffice ai-provider unchanged.
- Frame side: `web/modules/shared/ai/` (client, ai-provider proxy transport, streams, in-frame AI settings + state
  card). Test host: `?ai=1` grants all four; `web/server/fake-ai.mjs` fakes the routes (`/__fake-ai/*` drives it).

## Origin model

- Both sides take an **exact** `allowedOrigins` list (`scheme://host[:port]`); `*`, `null`, paths are refused at
  construction. Same-origin deployment: `[location.origin]`. Moving the frame to its own subdomain later only
  changes these lists and the iframe `src`.
- Incoming messages are accepted only if `event.origin` is in the list **and** `event.source` is the peer window
  (`iframe.contentWindow` on the host, `window.parent` in the frame). Sibling frames, popups and the page posting to
  itself are dropped; tagged drops are reported via `onReject` (`origin` / `source` / `malformed` /
  `version_mismatch` / `unknown_type` / `unexpected_response`).
- Outgoing messages always use the first allowed origin as `targetOrigin`, never `*`.

## Auth model (cookie-free)

- The server mints a short-lived token scoped to one document + workspace; the host passes it **only** in `init`
  (and later `token.update`). The frame keeps it in a closure: not in `session`, not in storage, never cookies.
- `client.getToken()` refreshes through a single-flight `token.refresh` request when the token expires within
  `refreshLeadMs` (60 s); concurrent callers share one refresh. A failed refresh rejects with `unauthorized`.
- `apiMode: 'host-proxy'` (v1 default): the frame calls `client.request('api.*', ...)` and the host performs the
  token-authorised fetches. `apiMode: 'direct'`: `client.fetchApi(path)` calls `apiBase` with
  `Authorization: Bearer`, `credentials: 'omit'`, retries once after a 401 with a refreshed token, and refuses any
  URL outside `apiBase`.

### Exporting unsaved edits (`api.export.data`)

`fileId` alone means "export the last saved version". When the editor has unsaved edits (or the
document was never saved) the frame also sends the current docx bytes as `data` (an `ArrayBuffer`,
transferred, not copied), and `fileId` then only identifies the document. A host that can render
bytes must prefer `data` over the stored version. A host without byte support ignores `data` and
exports `fileId`'s stored version (unsaved edits are then missing, as before); a host that can do
neither answers `unsupported`, and the frame falls back to its in-frame print dialog.

## Correlation, timeouts, cancellation

Ids are `<h|f><seq>-<random>` per sender. Every request has a timeout (default 30 s, per call `timeoutMs`;
`timeoutMs: 0` = no timeout, for requests that wait on a user dialog such as `file.pick` / `api.saveAs`) and an
optional `AbortSignal`; aborting rejects with `cancelled` and a timeout rejects with `timeout`, and both send a
`cancel` event so the peer handler's `ctx.signal` aborts (a host should abort its upload/fetch on it; a save that
committed anyway is reconciled by the frame, which re-reads the file metadata after a timed-out save). Host calls made before the handshake wait for it (bounded by the same timeout); frame `api.*`
calls wait for `init`. `dispose()` rejects everything in flight with `cancelled` and removes the listener.

## Usage

```ts
// host (UniWork page)
const host = createDocsFrameHost({
  frame: () => iframe.contentWindow,
  allowedOrigins: [location.origin],
  getInit: async () => ({
    ...(await mintFrameToken(docId)),
    documentId,
    workspaceId,
    apiBase,
    apiMode: 'host-proxy',
    locale,
    theme,
    capabilities,
  }),
  refreshToken: async () => mintFrameToken(docId),
  api: { 'api.save': async ({ fileId, data, etag }) => saveVersion(fileId, data, etag) },
})
host.on('dirty', ({ dirty }) => setLeaveGuard(dirty))

// frame (genoffice Docs)
const client = createDocsFrameClient({
  allowedOrigins: [location.origin],
  capabilities: { save: true },
})
const session = await client.whenInitialized()
const saved = await client.request('api.save', { fileId, data: bytes, etag })
```

## Frame-side save conflicts

A frame-initiated save (Ctrl+S / File > Save) that the host answers with `conflict` is reported to the host as an
`error` event `{error: {code: 'conflict'}, fatal: false}` and the frame asks the user: **Overwrite** (the frame
re-reads the file metadata with `api.open` and saves again with the current etag), **Reload latest** (`api.open`
replaces the document, discarding the local edits) or **Cancel** (stays dirty; the next save asks again). A
host-initiated `save` request gets the conflict in its `SaveResult` instead and owns the UI.

## Headless entry (server-side PDF export)

Not part of the postMessage protocol (no message types, `PROTOCOL_VERSION` stays 1): a second way to load the
bundle, for dev-uniwork's office-engine (`apps/office-engine/src/worker/docs-pdf.ts`), which renders a document
in headless Chromium and prints the **top-level** page with `Page.printToPDF`. Implementation:
`web/docs/bridge/headless.ts`; proof: `web/e2e/headless.spec.ts`.

**URL**

```
<bundle>/index.html?headless=1&open=<same-origin URL of the .docx>
e.g. http://127.0.0.1:<port>/index.html?headless=1&open=/__input.docx
```

The entry is active only when **all** of these hold; otherwise the page is the normal framed editor and `open` is
ignored:

- the page is top-level (`window.parent === window`); in an iframe (normal UniWork use) it is inert, whatever the URL;
- `headless=1` exactly (explicit opt-in; `?open=` alone does nothing);
- `open` (absolute, or relative to the page) resolves to `http(s)` on the page's own origin. Rejected: other
  origins/ports/schemes, protocol-relative (`//host`, `/\host`), `data:`, `blob:`, `javascript:`, URLs with
  credentials.

**Behaviour.** No handshake and no `ready` messages: `init` is synthesized at once (the 3 s host-appearance wait
does not apply). The document is fetched with `credentials: 'omit'` (CSP `connect-src 'self'` covers it; the CSP
is unchanged) and opened as `uniwork://files/headless/<name>`. Theme is forced light; capabilities are print /
PDF export only. The page is read-only: every `api.*` request answers `unsupported`, saves are refused, no
recents / picker / AI.

**Driving the export (what the engine does).** The renderer runs its desktop headless-export path
(`App.tsx` → `consumeHeadlessExport` → `runHeadlessDocumentExport`): it waits until the opened document is mounted,
fonts settled and pagination stable, then calls the same PDF export as File > Export, then `headlessExportDone`.
An init script that defines a `window.desktop` setter (docs-pdf.ts `PAGE_SHIM`) sees the bridge object assigned
once, before the renderer boots, and may replace these methods on it:

| method                                             | when the renderer calls it                                                   | engine answers                                                                                            |
| -------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `consumeHeadlessExport()`                          | once at boot                                                                 | `{outPath, format: 'pdf'}` (the bridge's default returns the same, so the shim is optional)               |
| `exportPdf(name, wTwips, hTwips, outPath, scale?)` | document ready, uniform paper: print **now**                                 | `printToPDF` (paper w/h in inches = twips/1440, zero margins, printBackground, scale) → `{ok:true, path}` |
| `printPdfBuffer(wTwips, hTwips, scale?)`           | ready, mixed paper or > 10 pages: one call per chunk, the other pages hidden | `printToPDF` → `{ok:true, base64:<marker>}`                                                               |
| `saveMergedPdf(name, parts, outPath)`              | after the chunks                                                             | merge the parts in order → `{ok:true, path}`                                                              |
| `headlessExportDone({ok, error?})`                 | last                                                                         | **the completion signal**: `ok:false` = not opened / no pages / print failed                              |

**Readiness signal (bridge side, with or without a shim).** `window.__docsWebHeadless = {state, error?, prints}`,
mirrored to `<html data-docs-headless="<state>">` and a `docs-web:headless` window event (detail = same object):
`opening` → `opened` (bytes handed to the renderer) → `done` (`headlessExportDone` ok) or `failed` (+ `error`: the
fetch failed, e.g. HTTP 404, or the renderer's report). When a shim replaces `headlessExportDone`, the shim's own
callback is the completion signal and the state stays `opened`. Without a shim the print calls print nothing (they
are recorded in `prints`) and report ok.

**Limits.** One document per page load; no editing, saving or host events; the input must be served from the
bundle's origin (the engine's job-local loopback server does this); a document that fails to open lands on the
renderer's blank fallback and is reported as `failed`, never exported as a blank PDF.

## Tests

```sh
npm run test:web        # protocol + bridge (jsdom) + build vitest suites
npm run typecheck:web   # tsc for web/docs/protocol and web/docs/bridge
npx vitest run --root web/docs/protocol      # unit + host<->client tests over fake windows
npx tsc -p web/docs/protocol/tsconfig.json   # typecheck incl. tests
npx playwright test -c web/e2e headless.spec   # headless entry (after npm run build:web)
```
