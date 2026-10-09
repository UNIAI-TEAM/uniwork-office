# Markdown and HTML on the web (GO-B4 M-1/M-2, H-1/H-2, UNI-1014)

Both editors run as module frames (`/office-frame/markdown/<v>/`, `/office-frame/html/<v>/`) on one shared
text-module bridge. Contract: lane CONTRACT C1-C13, protocol `web/docs/protocol` (no new message type).

## Files

| Path                                                                                   | What                                                                                                                                                       |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/modules/shared/text-webapi.ts`                                                    | open / save / Save As / conflict / view-only / host `save` `saveAs` `print` `doc.closeCheck` `file.renamed` / exports / pictures for any UTF-8 text editor |
| `web/modules/shared/text-codec.ts`                                                     | bytes <-> string keeping the BOM (U+FEFF) and line endings; non-UTF-8 input is flagged                                                                     |
| `web/modules/shared/static-html.ts`                                                    | static copy of an HTML document (preview, print): no script, handler, refresh, `<base>`, embeds or remote loads                                            |
| `web/modules/shared/print.ts`                                                          | print an HTML string in a hidden `srcdoc` frame with `sandbox="allow-same-origin allow-modals"` (no scripts)                                               |
| `web/modules/shared/assets.ts`                                                         | `OpenPayload.assets` map, `api.images.upload`, data: URI fallback, picture bytes for exports                                                               |
| `web/modules/shared/notice.ts`, `i18n/`                                                | conflict and fatal dialogs (`.gs-imgdlg-*` chrome of `@genoffice/ui`), web strings as shards (zh defines the keys)                                         |
| `web/modules/shared/capabilities.ts`                                                   | web defaults + host grants of the text modules                                                                                                             |
| `web/modules/markdown/webapi.ts`, `html/webapi.ts`                                     | the `markdownApi` / `htmlApi` members (typed with `satisfies` against the preload contracts)                                                               |
| `apps/markdown/src/renderer/capabilities.ts`, `apps/html/src/renderer/capabilities.ts` | `cap(key)` of each renderer (`createCapabilityReader`)                                                                                                     |
| `web/e2e/markdown-web.spec.ts`, `html-web.spec.ts`, `text-modules.ts`                  | Playwright on the production builds in the test host                                                                                                       |

## Behaviour

- **Bytes.** Open decodes UTF-8 without dropping the BOM; the renderers' envelopes (`docText.ts`, `envelope.ts`) keep
  BOM, EOL and the final newline; save encodes UTF-8. Open -> save without edits returns the input bytes (unit + e2e,
  BOM + CRLF + raw HTML fixture). A file that is not valid UTF-8 opens **view only**: saving its decoded text would
  rewrite it.
- **Save.** `api.save {fileId, data, etag}`, never `auto` (C10). Save As / an untitled document: `api.saveAs`
  (host dialog; cancelled = quiet). Conflict on a frame-initiated save: dialog Cancel / Reload latest / Overwrite
  (Overwrite re-reads the head etag; Reload latest reloads the frame, the host re-runs the handshake). A host `save`
  gets the conflict in its result and shows its own UI.
- **Host requests.** `save` (`reason: 'navigate'` uses the renderer's close-save flow; a clean document answers ok at
  once), `saveAs {name}`, `print` (both modes: the renderer's PDF export -> print dialog, no server route, lane
  decision 5), `doc.closeCheck` (`autoSave: false`), `file.renamed`. A host `open` after boot answers `unsupported`
  (these renderers load one document per frame load).
- **View only.** Without the host's `save` grant: `cap('save')` is false, the editor / source pane is read-only, the
  ribbon is disabled, the status bar shows "View only", every write is refused in the bridge too.
- **Pictures.** With the `images` grant pasted / inserted pictures go to `api.images.upload` and the document gets
  `assets/<name>`; without it (or when the upload fails) they are embedded as data: URIs. `OpenPayload.assets` maps
  relative paths to same-origin URLs (Markdown: `localImage.ts` asks `markdownApi.resolveAssetUrl`; HTML: the static
  preview copy). Mermaid diagrams render through `<img src="data:image/svg+xml,...">` (M0).
- **HTML preview with scripts (H2, CONTRACT C15(1), like the app).** `getPreviewInfo` names the bundle's
  `preview.html`; `PreviewFrame` loads it with `sandbox="allow-scripts allow-forms allow-popups allow-modals"` (no
  `allow-same-origin`: opaque origin), `credentialless` and `referrerpolicy="no-referrer"`. The host serves it with a
  policy of its own (`web/docs/build/README.md`, "Documents with their own policy"): `sandbox` repeated in the header,
  `connect-src 'none'`, `form-action 'none'`, no `'self'`, `https:` + inline scripts / styles / pictures / fonts. The
  frame's own policy only gains `frame-src 'self'`. Handshake (`web/modules/html/preview-channel.ts`): on the first
  load of each `?v=<n>`, the frame posts ONE `init` (page source, document pictures inlined as data: URIs by
  `preview-copy.ts`) with a `MessagePort`; `preview.html` accepts it only from its parent, once, with exactly one port,
  acknowledges on the port and `document.write`s the page. The inspector (`inspector.js`) talks only over that port
  (`window.__gxPreviewPort`); the frame never reads window messages in this mode, and every message from the port goes
  through the strict typed parser `apps/html/src/renderer/preview/inspector-validate.ts` (fresh objects, sizes, enums;
  the desktop listener uses it too). Nothing coming back is evaluated: edits become the renderer's own source ops.
- **Visual edit** (`htmlVisualEdit`: inspector click-to-select, float toolbar, style panel, inline text edit,
  resize / reorder) is on with the host's `save` grant (`htmlModuleGrants`), off in view-only.
- **Static fallback.** When `preview.html` does not acknowledge within 8 s (a host serving it with the frame policy
  blocks its inline boot script) the frame shows the static copy as before: `srcdoc`, `sandbox=""`, `credentialless`,
  no scripts / handlers / remote loads, links become `#` (http(s) targets stay in the hover title). Print always uses
  the static copy. Hidden: `presentNewTab`, `exportDocx`.
- **What a page can and cannot do** (`web/e2e/html-preview-security.spec.ts`): its scripts run (timers, handlers,
  inline + `https:` scripts, `eval`), it can load `https:` pictures / styles / fonts / scripts. It cannot read or
  navigate the frame or the host (`SecurityError`), read cookies / localStorage / sessionStorage / IndexedDB, reach any
  server with fetch / XHR / WebSocket / EventSource / sendBeacon (`connect-src 'none'`), post forms (`form-action
'none'`), load anything from the app origin by URL (no `'self'`; `http:` is not `https:`), embed frames, or open a
  popup with an opener (credentialless frames force `noopener`). Forged protocol envelopes reach no listener (host and
  frame check origin + source; the port is the only inspector channel). Residual, as on the desktop: the page's own
  scripts share the inspector's realm and may send well-formed inspector messages over the port, i.e. drive visual
  edits of their own document (the user sees them as unsaved changes; nothing is saved without the user). On a host
  served over `https:`, `https:` subresource GETs to the app origin (pictures, scripts) are possible but carry no
  credentials (opaque + credentialless) and their responses are not readable.
- **Hidden on both.** The AI family (`ai`, `webSearch`, `imageSearch`, `imageGeneration`), `autoSave`
  (toggle + timer), Markdown `openInDocs`.

## Gaps (v1)

- No Source mode in the Markdown frame (lane decision 3): raw HTML / comments are preserved byte-identically (M0) and
  shown as text, but cannot be edited as source.
- Export entries: on the desktop Markdown "Export Word" and HTML "Export HTML" come from the shell menu; the
  protocol has no host request for them, so on the web only print / PDF (host `print`) is reachable. The bridge
  implements `exportDocx` (download) and `exportHtml` (single file, mapped pictures inlined) for when a ribbon entry
  or a host request is added.
- HTML preview: pages that `fetch` / XHR data cannot get it (`connect-src 'none'`); nested frames (e.g. video embeds)
  are blocked (`frame-src 'none'`); document pictures other than PNG / JPEG / GIF (`assets.read`) and sibling files
  (`style.css` next to the page) are not served to the preview. The UniWork host (dev-uniwork `frame-headers.mjs`)
  must serve `preview.html` with `csp.json` `documents[0].value`; until it does, the web shows the static preview.
