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
handshake again.

### Host → frame

| type             | kind    | payload → result                                                                                                                                                                                             |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `init`           | request | `InitPayload` {protocolVersion, token, tokenExpiresAt, documentId, workspaceId, apiBase, apiMode, locale, theme, capabilities, open?} → `InitAck` {protocolVersion, frameVersion?, capabilities (effective)} |
| `open`           | request | `OpenPayload` {file: FileMeta, source: {kind:'url', url} \| {kind:'bytes', data}} → {opened, title?}                                                                                                         |
| `save`           | request | {reason: 'user' \| 'navigate' \| 'autosave'} → `SaveResult`                                                                                                                                                  |
| `saveAs`         | request | {name?} → `SaveResult`                                                                                                                                                                                       |
| `print`          | request | {mode?: 'dialog' \| 'pdf'} → {printed}                                                                                                                                                                       |
| `doc.closeCheck` | request | {} → {dirty, autoSave}                                                                                                                                                                                       |
| `token.update`   | event   | {token, tokenExpiresAt} — proactive rotation                                                                                                                                                                 |
| `theme`          | event   | {theme: 'light' \| 'dark'} (host resolves "system")                                                                                                                                                          |
| `language`       | event   | {locale}                                                                                                                                                                                                     |
| `file.renamed`   | event   | {file: FileMeta}                                                                                                                                                                                             |
| `cancel`         | event   | {id} — abort a host→frame request                                                                                                                                                                            |

### Frame → host

| type                   | kind    | payload → result                                                                      |
| ---------------------- | ------- | ------------------------------------------------------------------------------------- |
| `ready`                | event   | {protocolVersion, frameVersion?, capabilities}                                        |
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
| `resize`               | event   | {height} (CSS px, content height)                                                     |
| `saved`                | event   | {file, versionId?, initiatedByFrame}                                                  |
| `error`                | event   | {error: ProtocolErrorShape, fatal}                                                    |
| `cancel`               | event   | {id} — abort a frame→host request                                                     |

`api.*`, `file.pick`, `image.fetch` and `convert.altChunkHtml` are proxied by the host's `api` handlers; a type
without a handler answers `unsupported` (e.g. AI-adjacent calls stay unavailable on the web).

### Errors

`ProtocolErrorShape = {code, message, retryable?, status?, details?}`; host/client reject with
`DocsProtocolError` (same fields, `instanceof`-checkable). Codes: `timeout`, `cancelled`, `version_mismatch`,
`malformed`, `unknown_type`, `not_ready`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `too_large`,
`rate_limited`, `network`, `unsupported`, `internal`. `errorFromHttpStatus()` maps UniWork API statuses
(401/403/404/409+412/413/429/5xx); anything else thrown by a handler becomes `internal` (or `network` /
`cancelled` for fetch failures / aborts). UIs translate `code`, never `message`.

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
optional `AbortSignal`; aborting rejects with `cancelled` and sends a `cancel` event so the peer handler's
`ctx.signal` aborts. Host calls made before the handshake wait for it (bounded by the same timeout); frame `api.*`
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

## Tests

```sh
npx vitest run --root web/docs/protocol      # unit + host<->client tests over fake windows
npx tsc -p web/docs/protocol/tsconfig.json   # typecheck incl. tests
```
