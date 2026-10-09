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
- **HTML preview (P1).** `updatePreview` builds the static copy; `PreviewFrame` shows it with `srcdoc`, `sandbox=""`
  and `credentialless`. Links become `#` (http(s) targets stay in the hover title). Hidden: `htmlPreviewScripts`,
  `htmlVisualEdit` (inspector, float toolbar, style panel), `presentNewTab`, `exportDocx`.
- **Hidden on both.** The AI family (`ai`, `webSearch`, `imageSearch`, `imageGeneration`), `autoSave`
  (toggle + timer), Markdown `openInDocs`.

## Gaps (v1)

- No Source mode in the Markdown frame (lane decision 3): raw HTML / comments are preserved byte-identically (M0) and
  shown as text, but cannot be edited as source.
- Export entries: on the desktop Markdown "Export Word" and HTML "Export HTML" come from the shell menu; the
  protocol has no host request for them, so on the web only print / PDF (host `print`) is reachable. The bridge
  implements `exportDocx` (download) and `exportHtml` (single file, mapped pictures inlined) for when a ribbon entry
  or a host request is added.
- HTML pages that need scripts or CDN resources render statically (no scripts, no remote images / styles / fonts)
  until option P2 (separate preview origin).
