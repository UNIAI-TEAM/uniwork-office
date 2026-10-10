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
- **Pictures (CONTRACT A1, UNI-1232).** With the `images` grant pasted / dropped / inserted PNG, JPEG, GIF and WebP
  pictures go to `api.images.upload` and the document gets `assets/<name>`; a pasted SVG, a picture without the grant
  and a failed upload are embedded as data: URIs. `OpenPayload.assets` maps relative paths **as written in the
  document** to same-origin URLs: `assets.resolve` tries the exact key, then without `./`, then percent-decoded and
  without `?query` / `#fragment`; `unresolve` hands the editor back the document's own spelling. WebP and SVG display
  and read like the raster formats (`assets.read`: DOCX export, single-file HTML). A mapped URL the host answers
  401/403/404/410 to (revoked share, expired signature) counts as missing: `assets.verify()` runs one bounded HEAD
  probe per distinct URL (6 at a time, 4 s in all, same origin, no cookies) when a document opens and drops the
  refused ones, so the renderer draws its missing-picture placeholder with the localised explanation instead of a
  broken-image icon (a network error or a host without HEAD keeps the URL). Markdown: `localImage.ts` asks
  `markdownApi.resolveAssetUrl`; HTML: the preview copy (below). Mermaid diagrams render through
  `<img src="data:image/svg+xml,...">` (M0).
- **Fresh URLs and paths typed after the open (CONTRACT A1b, `api.assets.resolve`).** The open answer's URLs live an
  hour and a new `![](x.png)` has no URL, so the asset store asks the host again with paths as written (1..50 per
  request, protocol README "Fresh URLs"): (a) a relative picture/stylesheet/script path (`.png .jpg .gif .webp .svg
.css .js .mjs`, never a URL, an absolute path or a bare word) that the map does not name, once the user has edited
  the document (what the renderer asks while the document renders is the open answer's own "no"), after 600 ms of
  quiet, once per path and at most 200 per document; (b) every mapped path at about 50 minutes (retry in 5 minutes
  when the call fails); (c) when a mapped picture fails to load and a HEAD says 401/403/404/410: one fresh URL, and a
  second refusal or an answer without the path makes it missing. A host without `api.assets.resolve` answers
  `unsupported`: the frame keeps what it has and stops asking for the session. `onAssetsChanged` tells the renderer:
  Markdown points the pictures on screen at the new URLs (`refreshWebPictures`, the document text and dirty flag
  are untouched), the HTML static copy is rebuilt (the scripts preview takes its copy, pictures as data: URIs, at the
  next load).
- **HTML preview with scripts (H2, CONTRACT C15(1), like the app).** `getPreviewInfo` names the bundle's
  `preview.html`; `PreviewFrame` loads it with `sandbox="allow-scripts allow-forms allow-popups allow-modals"` (no
  `allow-same-origin`: opaque origin), `credentialless` and `referrerpolicy="no-referrer"`. The host serves it with a
  policy of its own (`web/docs/build/README.md`, "Documents with their own policy"): `sandbox` repeated in the header,
  `connect-src 'none'`, `form-action 'none'`, no `'self'`, `https:` + inline scripts / styles / pictures / fonts. The
  frame's own policy only gains `frame-src 'self'`. Handshake (`web/modules/html/preview-channel.ts`): on the first
  load of each `?v=<n>&k=<random>`, the frame posts ONE `init` (page source; what `preview-copy.ts` brings in from the
  document's own folder, because the preview policy names no `'self'`: pictures as data: URIs, a mapped
  `<link rel="stylesheet">` as an inline `<style>` and a mapped `<script src>` as an inline `<script>`, `</style` /
  `</script` escaped, a classic `defer` script moved to the end of the body, `media` and the other attributes kept; a
  file the host refuses keeps its tag as written; text files up to 2 MiB, read once per document) with a `MessagePort`; `preview.html` accepts it only from its parent, once, with exactly one port,
  acknowledges on the port and `document.write`s the page. The inspector (`inspector.js`) talks only over that port
  (`window.__gxPreviewPort`). The only window message the frame reads in this mode is the preview document's `hello`
  `{ns, type: 'hello', k}`: a page that reloads itself (`location.reload()`, `<meta refresh>`) loads `preview.html`
  again, which says hello with the `k` of its URL, and the frame (checking source = its iframe window, ns, type and
  `k` of the current src; a link navigation or an old src never matches) sends the copy and a fresh port again, so the
  preview does not go blank (e2e: `html-preview-security.spec.ts`, "reloads itself"). A page can read its own URL
  and say hello too; that only re-sends it the copy it holds and a new port, and at worst drops its own preview to
  the static fallback. Every message from the port goes
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
  credentials (opaque + credentialless) and their responses are not readable. `base-uri https:` stays in the preview
  policy on purpose: a `<base href="https://...">` in the page is honoured as in the app (relative pictures / scripts
  then resolve against it), and it can only name an `https:` origin, so it cannot point the page at the app origin
  with credentials either.
- **Intentional desktop-visible changes (RF-11).** Two Markdown behaviours changed on the desktop too, on purpose
  (same renderer code): raw HTML is kept verbatim (`apps/markdown/src/renderer/editor/rawHtml.ts`, option C: the exact
  source is saved back and shown as escaped text, never rendered, where the desktop used to degrade it through the
  schema on the first save), and Mermaid diagrams render as `<img src="data:image/svg+xml,...">` instead of injected
  markup. A desktop document that relied on rendered raw HTML or inline diagram DOM looks different there. Listed in
  `docs/upstream/UPSTREAM_SYNC.md` so an upstream sync keeps it.
- **AI follows the host grant.** The AI family (`ai`, `aiCredentials`, `webSearch`, `imageSearch`, `imageGeneration`)
  is **shown with the host's `ai` grant** (organization entitlement + the frame-token AI routes live, AI1/AI2) and
  **hidden without it**: the panel, the ribbon AI group (HTML: AI, Restyle, Theme, Summarize) and every AI tool
  disappear and the page takes the width. The panels call the document's AI routes directly (shared web AI bridge,
  `web/modules/shared/ai/`, CONTRACT C16: same origin, frame token, no cookies, SSE native). Failures are typed,
  translated state cards, never the server's JSON: the `{ "error": { code, message } }` envelope and a vendor
  adapter's own failure text (e.g. "Claude HTTP 404: {...}" for a missing key) map to missing / refused key (with an
  "AI settings" action), credits used up, not in the plan, rate limit, provider or cloud unavailable, session
  expired. Below 900 px the panel starts closed unless the user opened it before.
- **Export entries (UNI-1232 A5).** On the desktop Word and single-file HTML come from the shell File menu; the web
  frame has no menu, so the ribbon's quick-access row carries one entry each, shown when the platform is `web`:
  Markdown **Export Word** (the renderer builds the .docx, `exportDocx` downloads it) and HTML **Export HTML**
  (`exportHtml` downloads the single file with mapped pictures inlined). A reader can export (it only reads); a
  failed export is announced (Markdown toast, HTML status notice). A `.txt` / `.json` source file has no rendered
  document, so its entry is off. No host route is needed: the bridge builds a blob download.
- **Source panes follow view-only (UNI-1232 A3).** The `.txt` / `.json` source editor (CodeMirror) takes a read-only
  compartment and the Markdown source view's textarea is `readOnly`; neither marks the document dirty nor reaches a
  save, and the change handlers refuse an edit as a backstop.
- **Draft copy and visual edit (UNI-1232 A6).** A style poke from the inspector or the style panel reaches the source
  600 ms later. The text the draft writer reads (`provideText`) applies the pending `set_style` to the copy
  (`document/pending-draft.ts`) and lands an open panel field first, without committing anything in the editor, so a
  checkpoint inside that window (or a `pagehide`) keeps the user's last change.
- **Use-the-app messages (UNI-1232 B).** `desktopOpen` is granted by the host and `openInDesktopApp(feature)` sends
  the single `app.open` request (no request timeout: the host may wait on its unsaved-changes dialog; `unavailable`
  = the host already showed its own alert). HTML preview: a page that uses `fetch` / XHR or nested frames gets one
  note above the preview, in the preview chrome and never inside the document ("... Open in the UniWork Office app to
  use this feature", with **Open in app** while `desktopOpen` is on); capability `htmlPreviewNetwork` is off on the
  web, so the desktop shows nothing.
- **Hidden on both.** `autoSave` (toggle + timer), Markdown `openInDocs`, `createDocument`, `billing`.
- **Pictures the host has no copy of.** A relative picture in a single uploaded `.md` (no sibling `assets/`) shows a
  labelled placeholder with its path instead of a broken-image icon; the saved Markdown keeps `![](path)`.
- **Failed saves** read in the UI language ("UniWork could not be reached...", "Saving took too long..."), never the
  browser's raw "Failed to fetch".

## Gaps (v1)

- Markdown: the source view works on the web (the ribbon's source toggle); what stays out of reach is rendering raw
  HTML (kept byte-identically and shown as text, never executed).
- HTML preview: `fetch` / XHR data and nested frames stay blocked by the preview policy (`connect-src 'none'`,
  `frame-src 'none'`); the note above says so and offers the app. A path typed into a document after it opened and the
  one-hour URLs are covered by `api.assets.resolve` above (needs a host that offers it).
- The UniWork host (dev-uniwork `frame-headers.mjs`) must serve `preview.html` with `csp.json` `documents[0].value`;
  until it does, the web shows the static preview.
