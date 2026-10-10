# Slides (pptx) on the web: inventory (GO-B5 / UNI-1015)

Analysis only; no code changed. Base: fork `feature/UNI-1014-web-modules` @ `5a81008`, dev-uniwork lane @ `b71936f27`
(read-only). Every count below comes from a grep or a build run listed in "How to reproduce" at the end.

## 0. Findings

1. **Slides is not "Docs plus a bridge".** The Docs renderer owns its document model (the frame hands docx bytes to `api.save`), so the web bridge is only I/O.
   In Slides the whole document engine runs in the Electron **main** process: `apps/slides/src/main/slides-main.ts`
   (4,756 lines, 140 `ipcMain.handle/on` registrations; header comment: "pptx parsing/render-tree building/edit
   application/saving all live here (Node side)") plus `session-state.ts` (sessions, snapshot undo/redo, render-tree
   rebuild). The renderer is a Konva UI that sends edit intents over **181 `window.slidesApi` methods** and gets
   `RenderSlide` plain data back. 105 of the 181 (58%) are engine operations that the web build can only serve by moving
   the session core **into the frame**. This is the critical path of B5 (work item S1/S2 in section 5).
2. **That move is feasible.** The engine closure is nearly Node-free: `pptx-engine` (23.3k lines) imports only
   `node:crypto` (sync SHA-256 in `zip.ts:10/37`, `randomUUID` in `sections.ts:22`), `node:zlib` (`deflateSync` in
   `media-insert.ts:14`) and a dynamic `node:fs`/`node:stream/promises` in the desktop-only `savePptxToFile`
   (`index.ts:681-682`); `pptx-ops` and `pptx-render` import no Node module either, but 22 files across the three packages
   (16 engine, 4 ops, 2 render; e.g. `zip.ts:57`, `executor.ts:154`, `text-layout.ts:549`) use the free `Buffer` global, so the web build needs a
   Buffer shim as well. dev-uniwork's G3 host already runs this closure in the browser through four shims (`packages/office-upstream/shims/pptx-renderer/{crypto,zlib,buffer,node-file-io}.ts`).
   Measured with esbuild (without the shims): engine + ops + render + opentype.js = **942 kB raw / 294 kB gzip** to add to the renderer bundle.
3. **No new protocol type is needed for v1.** 10 methods map to existing `file.pick` / `init.open` / `api.open` / `api.save`
   / `api.saveAs` / `api.recents` / host `open` / `save` / `saveAs` / `file.renamed`; 4 reuse the Docs host-appearance path
   verbatim; 14 are browser features (download, print, pickers, clipboard, fullscreen); 48 are hidden behind capability keys;
   the rest is in-frame. PDF/image export is already client-rasterised PNG, so it needs no server (unlike Docs W8).
4. **Docs bridge reuse is large but not verbatim for the main file.** 30 of the 187 names (181 `slidesApi` + 6 `window.desktop`)
   are keys the Docs bridge modules already implement identically (section 1.5). `window.desktop` in Slides is by
   construction the Docs attachment subset (6 methods, `browser.ts:533-590`). `webapi.ts` and `session.ts` are docx-named
   and `onCloseCheck`-based, so they are patterns to copy, not code to import.
5. **The Slides renderer has no capability/hide mechanism** (Docs has `cap()` with 21 call sites). Without one, the AI
   dock, ask popover, font download/install, presenter window and others would render and fail on the web. Section 1.6
   proposes the keys; the retrofit is a renderer change (S3).
6. **CSP: the Docs policy needs exactly one directive added for Slides, and must not gain `wasm-unsafe-eval`.** Probed in headless
   Chromium under the exact Docs CSP (section 3.7): `media-src` is missing (embedded audio/video are `data:` URLs today and are blocked;
   switch them to `blob:` and add `media-src blob:`); a `srcdoc` print-preview iframe works under `frame-src 'none'`; fullscreen works in
   the same-origin frame with no `allow=` attribute; HarfBuzz (wasm) would be blocked, so web text metrics must not use it.
7. **Plain `vite build` of the renderer works first time**: 462 modules, 3,063 kB JS (903 kB gzip) + 139 kB CSS, 6.15 MB total
   (2.2 MB gzipped), built in 7.0 s. It is the _renderer only_ (no engine, no bridge); expected web total about 4.0 MB JS / 1.2 MB gzip.
8. **Gaps to settle before coding** (section 6): read-only documents (Slides has no read-only mode; recommend host falls back to G3 for
   `writable:false`), comment author name (needs an additive `init.user`, or a generic label), macOS browser fullscreen
   (`IS_MAC` gate skips HTML fullscreen), external linked media, font fidelity (no system font files: metrics via canvas).

## 1. The preload surface

`apps/slides/src/preload/index.ts` exposes three globals: `window.slidesApi` (181 methods: 158 `invoke`, 17 push `on*`,
6 fire-and-forget `send`), `window.desktop` (6 methods) and `window.projectApi` (10 methods), plus
`installDropOpenBridge()` (OS drag-to-open as a shell tab; shell-only, nothing to do on the web). The renderer reaches them as
`window.slidesApi.*` (`env.d.ts:7`), `window.desktop.*` (AI panel only) and `window.projectApi` (AI panel only).

Classes used below (the brief's four, plus `engine`, which Docs has no equivalent of, and `reuse`):

<!-- prettier-ignore-start -->
| class | meaning |
| --- | --- |
| **engine (in-frame)** | the method is part of the document engine session that moves into the frame; no host call, no protocol traffic |
| **existing `api.*`** | maps to a protocol type that already exists (request, host request or event) |
| **browser** | implemented with a browser feature (download, print, file input, Clipboard API, Fullscreen API) |
| **hidden `<key>`** | not available on the web; a typed stub answers and a capability key hides the UI |
| **new protocol type** | none needed (section 1.7) |
| **reuse** | identical to a Docs bridge module (verbatim) |
<!-- prettier-ignore-end -->

Totals (181 `slidesApi` methods): engine 105, existing `api.*` 10, reuse 4, browser (incl. 4 that combine a picker with an
engine op) 14, hidden 48, new protocol type 0.

"Renderer call sites" are **direct** uses: member access on `window.slidesApi` (or on an alias such as `api`, `useAutoSavePref(..., window.slidesApi)`
in `packages/ui`) including continuation lines like `.name(`; local wrappers (`file-actions.ts:save`) and React state setters that happen to share a name
(`setSections`, `setAiSettings`) are excluded. Scope: `apps/slides/src/renderer`, `packages/ui/src` (shown as `ui:`), `apps/slides/src/shared`. Up to two
`file:line` are listed plus the number of further ones. **0 direct call sites**: `openPptxPath`, `getSlideSize`, `gskStatus`, `setSections`, `setAiSettings`
(they stay in the table so every preload method is accounted for); `onChromePressed` is reached only through the dynamic lookup in
`packages/ui/src/popover-dismiss.ts:33`.

### 1.2 `window.slidesApi` (181 methods)

#### A. App shell, appearance, fonts

<!-- prettier-ignore-start -->
| method | IPC channel | renderer call sites (grep) | desktop behaviour | web class | web implementation |
| --- | --- | --- | --- | --- | --- |
| `getLanguage` | `app:get-language` | `main.tsx:48` | shell pushes UI language (app:get-language / app:language-changed) | reuse (Docs bridge) | host `language` event via `bindHostAppearance` + `browser.getLanguage/onLanguageChanged` (verbatim; widen Lang type) |
| `onLanguageChanged` | `app:language-changed (push)` | `i18n/locale.tsx:81` | shell pushes UI language (app:get-language / app:language-changed) | reuse (Docs bridge) | host `language` event via `bindHostAppearance` + `browser.getLanguage/onLanguageChanged` (verbatim; widen Lang type) |
| `getTheme` | `app:get-theme` | `main.tsx:49` | shell pushes light/dark/system | reuse (Docs bridge) | host `theme` event via `bindHostAppearance` + `browser.getTheme/onThemeChanged` (verbatim) |
| `onThemeChanged` | `app:theme-changed (push)` | `main.tsx:59` | shell pushes light/dark/system | reuse (Docs bridge) | host `theme` event via `bindHostAppearance` + `browser.getTheme/onThemeChanged` (verbatim) |
| `getAutoSaveDefault` | `app:get-auto-save-default` | `ui:auto-save-pref.ts:78` | global AutoSave default from app settings | hidden `autoSaveToDisk` | `hide.ts` stubs (verbatim: `{on:false}` / no-op disposer) |
| `onAutoSaveDefaultChanged` | `app:auto-save-default-changed (push)` | `ui:auto-save-pref.ts:83` | global AutoSave default from app settings | hidden `autoSaveToDisk` | `hide.ts` stubs (verbatim: `{on:false}` / no-op disposer) |
| `getAiPanelPrefs` | `app:get-ai-panel-prefs` | `main.tsx:61` | AI panel font/spellcheck prefs from app settings | hidden `ai` | `ai.ts` `getAiPanelPrefs` (verbatim) |
| `onAiPanelPrefsChanged` | `app:ai-panel-prefs-changed (push)` | `main.tsx:64` | push of the same prefs | hidden `ai` | Proxy `on*` no-op fallback |
| `onChromePressed` | `app:chrome-pressed (push)` | `ui:popover-dismiss.ts:33` (dynamic `w[name]` lookup) | shell tab chrome pressed: closes popovers | hidden `tabs` | `hide.ts` no-op (verbatim) |
| `setShowFullScreen` | `slides:show-fullscreen` | `components/SlideShowView.tsx:181`, `components/SlideShowView.tsx:227` (+2) | macOS: simpleFullScreen + tab bleed; Win/Linux: window bleed + HTML fullscreen | browser | Fullscreen API on the frame root; same-origin frame needs no `allow=fullscreen` (probe, section 3.6); renderer must stop skipping HTML fullscreen on macOS browsers (`IS_MAC` gate) |
| `privateFontFaces` | `slides:private-font-faces` | `doc-fonts.ts:23` | lists faces main resolved to files Chromium cannot see (embedded, DFonts, Office cloud fonts) + sfnt bytes | engine (in-frame) | embedded pptx fonts (`listEmbeddedFonts`) -> `FontFace(ArrayBuffer)` (not subject to font-src); Office DFonts / cloud fonts do not exist on the web -> empty list |
| `privateFontData` | `slides:private-font-data` | `doc-fonts.ts:39` | lists faces main resolved to files Chromium cannot see (embedded, DFonts, Office cloud fonts) + sfnt bytes | engine (in-frame) | embedded pptx fonts (`listEmbeddedFonts`) -> `FontFace(ArrayBuffer)` (not subject to font-src); Office DFonts / cloud fonts do not exist on the web -> empty list |
| `fontCatalog` | `slides:font-catalog` | `font-manager.ts:31` | OFL catalog mirrored on a CDN, sha256-pinned download to userData/fonts | hidden `fontDownload` | stub `[]` / `{ok:false}`; v2: serve the curated OFL families from the bundle `fonts/` (WOFF2) instead of the GenOffice CDN |
| `fontDownload` | `slides:font-download` | `font-manager.ts:48`, `App.tsx:344` | OFL catalog mirrored on a CDN, sha256-pinned download to userData/fonts | hidden `fontDownload` | stub `[]` / `{ok:false}`; v2: serve the curated OFL families from the bundle `fonts/` (WOFF2) instead of the GenOffice CDN |
| `fontInstallLocal` | `slides:font-install-local` | `font-manager.ts:68` | native picker, copies ttf/otf/ttc into userData/fonts | hidden `fontInstallLocal` | stub `{families:[]}`; v2: `<input type=file>` + session-only `FontFace` |
| `fontMissing` | `slides:font-missing` | `App.tsx:323` | which catalog fonts the open deck references but are not installed | engine (in-frame) | `missingCatalogFonts(opened)` against the bundled families (empty when the catalog is hidden) |
| `onFontsChanged` | `slides:fonts-changed (push)` | `font-manager.ts:77`, `App.tsx:335` | main broadcasts after a download/install | engine (in-frame) | in-frame event (fired by the engine host after font registration) |
<!-- prettier-ignore-end -->

#### B. Open / save / lifecycle / headless

<!-- prettier-ignore-start -->
| method | IPC channel | renderer call sites (grep) | desktop behaviour | web class | web implementation |
| --- | --- | --- | --- | --- | --- |
| `openPptx` | `slides:open` | `App.tsx:846` | native open dialog (pptx/ppt), rejects CFB, builds the render tree | `file.pick` (existing) | host `file.pick {purpose:"open", accept:pptx}` -> OpenPayload (existing; capability `filePick`); engine parses the bytes. `rejectLegacyPpt` CFB sniff (`cfb-sniff.ts`, pure) moves with it |
| `openPptxPath` | `slides:open-path` | **0** | open a known path (unused by the renderer; kept for shell/CLI) | hidden `open` | 0 renderer call sites (grep): stub `null` |
| `consumePendingOpen` | `slides:consume-pending-open` | `App.tsx:439`, `App.tsx:1151` | boot: file queued by shell/OS, else restore the existing main-process session | `init.open` / `api.open` (existing) | `init.open` else `api.open {fileId: init.documentId}` once at boot (same as Docs `consumePendingOpenDocx`) |
| `onOpened` | `slides:opened (push)` | `App.tsx:1150` | main pushes an open result (second-instance / shell open) | host `open` (existing) | host request `open {file, source}` -> listeners -> `{opened, title}` (existing) |
| `onRenamed` | `slides:renamed (push)` | `App.tsx:1199` | main pushes a new path after a rename | host `file.renamed` (existing) | host event `file.renamed {file}` (existing) |
| `newBlank` | `slides:new-blank` | `App.tsx:1131` | creates an untitled session, returns the render tree | engine (in-frame) | `createBlankPptx` + `openPptx` in-frame; returns `OpenResult` (also the boot fallback when nothing opened) |
| `save` | `slides:save` | `file-actions.ts:84` | savePptxToFile to the session path (drafts folder when untitled), commitSaved, returns slides | `api.save` (existing) | serialize in-frame (`savePptx` + `commitSaved`) -> `api.save {fileId, data, etag}` -> SaveResult; conflict flow already in the protocol (Docs "Frame-side save conflicts"); return `{ok,path,slides}` so the renderer keeps adopting the baked render tree |
| `saveAs` | `slides:save-as` | `file-actions.ts:111` | native save dialog + write, push recent, rename attached windows | `api.saveAs` (existing) | `api.saveAs {name, data, sourceFileId}` (existing); name prompt in-frame or host save-as (Docs W-B2/B3 "host save-as") |
| `onCloseSaveRequest` | `slides:close-save-request (push)` | `App.tsx:863` | main asks the renderer to run the save flow before closing a tab | host `save` / `doc.closeCheck` (existing) | host `save {reason:"navigate"}` / `doc.closeCheck` mapped by `bridge/session.ts` (existing) |
| `reportCloseSaveResult` | `slides:close-save-result (send)` | `App.tsx:865`, `App.tsx:866` | renderer reports the close-save outcome | host `save` (existing) | answer of the host `save` request (`bridge/session.ts`) |
| `setAutoSavePref` | `slides:autosave-pref (send)` | `App.tsx:424` | renderer mirrors its AutoSave toggle so close skips the dialog | hidden `autoSaveToDisk` | no-op (host autosave is `save {reason:"autosave"}`, a host decision) |
| `isDirty` | `slides:is-dirty` | `App.tsx:885`, `App.tsx:912` (+2) | any dirty element / structure / metaDirty | engine (in-frame) | in-frame dirty check + `dirty` event (existing, de-duplicated by the client) |
| `getRecentFiles` | `slides:recent` | `App.tsx:1207` | <userData> recent list | `api.recents` (existing) | `api.recents {limit}` (existing; capability `recents`) mapped to display paths (`webapi.pathFor`) |
| `onMenuCommand` | `slides:menu (push)` | `App.tsx:2137` | native application menu commands | host `saveAs` / `save` (existing) | NOT a no-op: Docs `bridge/session.ts` already uses it to turn the host `saveAs` request into the renderer own `save-as` command (Slides MenuCommand has `save`/`save-as`/`open`/`export-*`/`print`); adapt the Docs `MenuCommand` type import |
| `onHistoryChanged` | `slides:history-changed (push)` | `App.tsx:873` | undo/redo availability push | engine (in-frame) | in-frame event |
| `onDeckChanged` | `slides:deck-changed (push)` | `App.tsx:880`, `components/AudienceView.tsx:114` | main pushes the rebuilt render tree to every attached window | engine (in-frame) | in-frame event (coalesced per task, same as `scheduleDeckBroadcast`) |
| `consumeHeadlessExport` | `slides:consume-headless-export` | `App.tsx:940` | --headless-export CLI: target path / completion signal | hidden `headlessExport` | `hide.ts` stubs; the web headless entry (Docs `headless.ts`) is only needed if the server ever renders pptx (see 3.4) |
| `headlessExportDone` | `slides:headless-export-done (send)` | `App.tsx:958` | --headless-export CLI: target path / completion signal | hidden `headlessExport` | `hide.ts` stubs; the web headless entry (Docs `headless.ts`) is only needed if the server ever renders pptx (see 3.4) |
<!-- prettier-ignore-end -->

#### C. Document edits and queries (engine)

<!-- prettier-ignore-start -->
| method | IPC channel | renderer call sites (grep) | desktop behaviour | web class | web implementation |
| --- | --- | --- | --- | --- | --- |
| `editText` | `slides:edit-text` | `clipboard-actions.ts:242`, `clipboard-actions.ts:314` (+1) | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `setElementFont` | `slides:set-element-font` | `style-actions.ts:42`, `style-actions.ts:59` (+2) | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `setElementParagraphFormat` | `slides:set-element-paragraph-format` | `style-actions.ts:85`, `style-actions.ts:209` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `findReplace` | `slides:find-replace` | `components/FindReplaceDialog.tsx:118` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `setSlideLayout` | `slides:set-slide-layout` | `App.tsx:2979`, `App.tsx:2984` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `setSlideSize` | `slides:set-slide-size` | `App.tsx:2988` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `getSlideSize` | `slides:get-slide-size` | **0** | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `editTransform` | `slides:edit-transform` | `App.tsx:2380` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `editConnectorEndpoints` | `slides:edit-connector-endpoints` | `App.tsx:2438` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `editPictureSrcRect` | `slides:edit-picture-src-rect` | `picture-edit-actions.ts:51` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `editPictureOpacity` | `slides:edit-picture-opacity` | `App.tsx:3228` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `changeShape` | `slides:change-shape` | `App.tsx:3114`, `App.tsx:4291` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `setShapeAdjust` | `slides:set-shape-adjust` | `App.tsx:2409` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `setTextAnchor` | `slides:set-text-anchor` | `App.tsx:4022` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `setTextBodyProps` | `slides:set-text-body-props` | `App.tsx:4027` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `setEffects` | `slides:set-effects` | `App.tsx:1410` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `groupElements` | `slides:group-elements` | `arrange-actions.ts:21` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `ungroupElement` | `slides:ungroup-element` | `arrange-actions.ts:41` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `batchEditTransform` | `slides:batch-edit-transform` | `arrange-actions.ts:148`, `arrange-actions.ts:260` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `getRenderSlides` | `slides:get-render-slides` | `components/AudienceView.tsx:96` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `addElement` | `slides:add-element` | `clipboard-actions.ts:156`, `insert-actions.ts:31` (+5) | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `deleteElement` | `slides:delete-element` | `arrange-actions.ts:285`, `clipboard-actions.ts:19` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `addSlide` | `slides:add-slide` | `slide-actions.ts:44` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `addBlankSlide` | `slides:add-blank-slide` | `slide-actions.ts:14` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `addSlideWithLayout` | `slides:add-slide-with-layout` | `slide-actions.ts:29` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `getLayouts` | `slides:get-layouts` | `App.tsx:802` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `deleteSlide` | `slides:delete-slide` | `slide-actions.ts:59` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `reorderElement` | `slides:reorder-element` | `arrange-actions.ts:164` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `moveSlide` | `slides:move-slide` | `slide-actions.ts:143` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `setSlideHidden` | `slides:set-hidden` | `show-actions.ts:116` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `editFill` | `slides:edit-fill` | `clipboard-actions.ts:224`, `clipboard-actions.ts:251` (+4) | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `editStroke` | `slides:edit-stroke` | `clipboard-actions.ts:232`, `clipboard-actions.ts:304` (+3) | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `flipElements` | `slides:flip-elements` | `arrange-actions.ts:198`, `insert-actions.ts:48` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
<!-- prettier-ignore-end -->

#### D. Master view, tables, charts, links, header/footer, theme

<!-- prettier-ignore-start -->
| method | IPC channel | renderer call sites (grep) | desktop behaviour | web class | web implementation |
| --- | --- | --- | --- | --- | --- |
| `masterEnter` | `slides:master-enter` | `App.tsx:1940` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `masterOpen` | `slides:master-open` | `MasterView.tsx:80` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `masterClose` | `slides:master-close` | `App.tsx:1945` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `masterEditText` | `slides:master-edit-text` | `MasterView.tsx:115` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `masterEditTransform` | `slides:master-edit-transform` | `MasterView.tsx:96` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `masterEditFill` | `slides:master-edit-fill` | `MasterView.tsx:145`, `MasterView.tsx:195` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `masterEditStroke` | `slides:master-edit-stroke` | `MasterView.tsx:146`, `MasterView.tsx:203` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `masterDeleteElement` | `slides:master-delete-element` | `MasterView.tsx:125` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `editTableCell` | `slides:edit-table-cell` | `table-actions.ts:95`, `table-actions.ts:118` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `tableStructure` | `slides:table-structure` | `table-actions.ts:18`, `table-actions.ts:137` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `tableMerge` | `slides:table-merge` | `table-actions.ts:45` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `setTableColWidth` | `slides:set-table-col-width` | `table-actions.ts:67` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `setTableRowHeight` | `slides:set-table-row-height` | `table-actions.ts:83` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `setTableCellAnchor` | `slides:set-table-cell-anchor` | `context-menu-items.ts:197`, `context-menu-items.ts:210` (+1) | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `editTableStyle` | `slides:edit-table-style` | `context-menu-items.ts:251`, `style-actions.ts:298` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `editChart` | `slides:edit-chart` | `ai/slides-skill.ts:2390`, `style-actions.ts:320` | confirms before editing an imported chart (native message box) | engine (in-frame) | in-frame; the "chart will be simplified" confirm (`dialog.showMessageBox`) becomes a renderer dialog (renderer change) |
| `getChartColorSchemes` | `slides:chart-color-schemes` | `App.tsx:2660` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `getChartData` | `slides:get-chart-data` | `App.tsx:2565`, `App.tsx:2573` (+1) | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `addTable` | `slides:add-table` | `insert-actions.ts:107` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `addChart` | `slides:add-chart` | `insert-actions.ts:169` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `addSmartArt` | `slides:add-smartart` | `insert-actions.ts:192` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `addInk` | `slides:add-ink` | `arrange-actions.ts:177` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `setLink` | `slides:set-link` | `insert-actions.ts:304`, `insert-actions.ts:346` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `getLink` | `slides:get-link` | `insert-actions.ts:291` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `getSlideLinks` | `slides:get-slide-links` | `components/SlideShowView.tsx:107` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `getRunLinks` | `slides:get-run-links` | `components/SlideShowView.tsx:113` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `applyHeaderFooter` | `slides:apply-header-footer` | `insert-actions.ts:365` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `getHeaderFooter` | `slides:get-header-footer` | `insert-actions.ts:357` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `applyTheme` | `slides:apply-theme` | `style-actions.ts:271` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
<!-- prettier-ignore-end -->

#### E. Show data, sections, notes, comments, history, scripting

<!-- prettier-ignore-start -->
| method | IPC channel | renderer call sites (grep) | desktop behaviour | web class | web implementation |
| --- | --- | --- | --- | --- | --- |
| `setTransition` | `slides:set-transition` | `animation-actions.ts:15` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `getTransition` | `slides:get-transition` | `App.tsx:1611`, `components/SlideShowView.tsx:98` (+1) | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `setAdvanceTimes` | `slides:set-advance-times` | `show-actions.ts:84` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `getAnimations` | `slides:get-animations` | `animation-actions.ts:64`, `App.tsx:1640` (+3) | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `getShapeKeys` | `slides:get-shape-keys` | `components/SlideShowView.tsx:104`, `components/AudienceView.tsx:131` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `setAnimations` | `slides:set-animations` | `animation-actions.ts:58` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `getSections` | `slides:get-sections` | `App.tsx:2004` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `setSections` | `slides:set-sections` | **0** | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `addSection` | `slides:add-section` | `slide-actions.ts:96` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `renameSection` | `slides:rename-section` | `slide-actions.ts:108` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `removeSection` | `slides:remove-section` | `slide-actions.ts:116` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `moveSection` | `slides:move-section` | `slide-actions.ts:129` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `getNotes` | `slides:get-notes` | `App.tsx:1858`, `components/PrintDialog.tsx:57` (+1) | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `setNotes` | `slides:set-notes` | `App.tsx:604` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `getComments` | `slides:get-comments` | `App.tsx:1882` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `addComment` | `slides:add-comment` | `App.tsx:1892` | author = OS username (`userInfo().username`) | engine (in-frame) | in-frame; author must come from the host: optional additive `init.user.displayName` (else "User") - owner decision, name is written into the pptx |
| `deleteComment` | `slides:delete-comment` | `App.tsx:1904` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `beginHistoryBatch` | `slides:history-batch-begin` | `ai/AiPanel.tsx:1681`, `ai/AiPanel.tsx:1717` (+1) | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `endHistoryBatch` | `slides:history-batch-end` | `ai/AiPanel.tsx:775`, `ai/AiPanel.tsx:1855` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `applyEditScript` | `slides:apply-edit-script` | `ai/slides-skill.ts:1371` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `applyTxn` | `slides:apply-txn` | `ai/slides-skill.ts:2411` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `aiSnapshotRestore` | `slides:ai-snapshot-restore` | `ai/AiPanel.tsx:782`, `ai/AiPanel.tsx:1865` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `undo` | `slides:undo` | `App.tsx:996` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `redo` | `slides:redo` | `App.tsx:1004` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
<!-- prettier-ignore-end -->

#### F. Pictures, media, clipboard (pickers and native clipboard)

<!-- prettier-ignore-start -->
| method | IPC channel | renderer call sites (grep) | desktop behaviour | web class | web implementation |
| --- | --- | --- | --- | --- | --- |
| `editBackground` | `slides:edit-background` | `style-actions.ts:256` | native image dialog + readFile inside the handler | engine + browser | in-frame op; the picker (`op.pick`) becomes a browser file input (`bridge/browser.pickFiles`, reusable) feeding bytes to the op |
| `editImageFill` | `slides:edit-image-fill` | `App.tsx:3200`, `App.tsx:4013` | native image dialog + readFile inside the handler | engine + browser | in-frame op; the picker (`op.pick`) becomes a browser file input (`bridge/browser.pickFiles`, reusable) feeding bytes to the op |
| `pickPictureFile` | `slides:pick-picture-file` | `picture-edit-actions.ts:135`, `components/RibbonHomeTab.tsx:205` | native image dialog, returns base64 + ext | browser | `browser.pickFiles(accept image/*)` -> `{base64, ext}` (existing helper) |
| `insertImage` | `slides:insert-image` | `insert-actions.ts:91` | native dialog + readFile + nativeImage size | browser + engine | browser file input + `createImageBitmap` for size (replaces `nativeImage.createFromPath`) then `addPicture` op |
| `addImageBytes` | `slides:add-image-bytes` | `clipboard-actions.ts:70`, `insert-actions.ts:142` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `replacePictureBytes` | `slides:replace-picture-bytes` | `picture-edit-actions.ts:112`, `picture-edit-actions.ts:137` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `insertMedia` | `slides:insert-media` | `insert-actions.ts:408` | native dialog, readFile, AVI/codec warning box, QuickLook poster | browser + engine | browser file input (audio/video) + the same pure `unplayableAudioCodec` sniff (inline warning instead of `showMessageBox`); poster = `<video>` frame grab on a canvas, else solid fallback (QuickLook thumbnail is macOS-only) |
| `addMediaBytes` | `slides:add-media-bytes` | `insert-actions.ts:459` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `getMediaData` | `slides:media-data` | `App.tsx:2276`, `components/SlideShowView.tsx:509` | embedded bytes -> `data:` base64 URL; external link returned as-is | engine (in-frame) | returns `data:` URL today -> must return a `blob:` URL (CSP has no media-src, see 3.3); external linked media (`media.external` http URL) hidden |
| `insertModel3d` | `slides:insert-model3d` | `insert-actions.ts:418` | native dialog (glb) + nativeImage poster | hidden `model3d` | v1 hidden; glb is a plain file input + placeholder poster, so it is a candidate to switch on (no CSP impact) |
| `copySlide` | `slides:copy-slide` | `slide-actions.ts:83`, `clipboard-actions.ts:100` | module-level `slideClipboard` shared by all tabs + Electron clipboard marker | engine (in-frame) | in-frame clipboard bundle (single document per frame; cross-tab/cross-deck slide paste is desktop-only, v2 via `navigator.clipboard` custom format); the `io.genoffice.slides.slide` marker write is dropped |
| `pasteSlide` | `slides:paste-slide` | `clipboard-actions.ts:110` | module-level `slideClipboard` shared by all tabs + Electron clipboard marker | engine (in-frame) | in-frame clipboard bundle (single document per frame; cross-tab/cross-deck slide paste is desktop-only, v2 via `navigator.clipboard` custom format); the `io.genoffice.slides.slide` marker write is dropped |
| `repasteSlide` | `slides:repaste-slide` | `clipboard-actions.ts:126` | module-level `slideClipboard` shared by all tabs + Electron clipboard marker | engine (in-frame) | in-frame clipboard bundle (single document per frame; cross-tab/cross-deck slide paste is desktop-only, v2 via `navigator.clipboard` custom format); the `io.genoffice.slides.slide` marker write is dropped |
| `hasSlideClipboard` | `slides:has-slide-clipboard` | `App.tsx:3381`, `App.tsx:3452` | module-level `slideClipboard` shared by all tabs + Electron clipboard marker | engine (in-frame) | in-frame clipboard bundle (single document per frame; cross-tab/cross-deck slide paste is desktop-only, v2 via `navigator.clipboard` custom format); the `io.genoffice.slides.slide` marker write is dropped |
| `copyElements` | `slides:copy-elements` | `clipboard-actions.ts:27`, `clipboard-actions.ts:39` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `pasteElements` | `slides:paste-elements` | `clipboard-actions.ts:172` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `duplicateElements` | `slides:duplicate-elements` | `clipboard-actions.ts:188` | `ipcMain.handle` in slides-main.ts: mutate `Session.opened`, push history, rebuild render slides | engine (in-frame) | in-frame session core: same `runTxn`/`buildRenderSlide` path as the handler (pure document model; G3 already runs the same closure in the browser) |
| `clipboardExternal` | `slides:clipboard-external` | `clipboard-actions.ts:145` | Electron `clipboard` (marker buffers, readImage, readText) | browser | `navigator.clipboard.read/readText` (frame iframe has `allow="clipboard-read; clipboard-write"` already; user-gesture + permission prompt); probe = optimistic true |
| `clipboardProbe` | `slides:clipboard-probe` | `App.tsx:448`, `App.tsx:2123` | Electron `clipboard` (marker buffers, readImage, readText) | browser | `navigator.clipboard.read/readText` (frame iframe has `allow="clipboard-read; clipboard-write"` already; user-gesture + permission prompt); probe = optimistic true |
| `nativeClipboard` | `slides:native-clipboard` | `App.tsx:2158`, `App.tsx:2162` (+1) | Electron `clipboard` (marker buffers, readImage, readText) | browser | `navigator.clipboard.read/readText` (frame iframe has `allow="clipboard-read; clipboard-write"` already; user-gesture + permission prompt); probe = optimistic true |
<!-- prettier-ignore-end -->

#### G. Export and print

<!-- prettier-ignore-start -->
| method | IPC channel | renderer call sites (grep) | desktop behaviour | web class | web implementation |
| --- | --- | --- | --- | --- | --- |
| `pickExportDir` | `slides:pick-export-dir` | `file-actions.ts:141` | native directory picker | browser | returns a sentinel token (no directory on the web); `exportImages` then zips (`jszip`, already an engine dependency) and downloads `<name>-images.zip` via `browser.downloadBytes` |
| `exportImages` | `slides:export-images` | `file-actions.ts:146` | writes `<base>-NN.png` files into the picked dir | browser | zip + download (see pickExportDir) |
| `pickExportPdfPath` | `slides:pick-export-pdf-path` | `file-actions.ts:174` | native save dialog (pdf) | browser | returns the default file name as the token (no save dialog) |
| `exportPdf` | `slides:export-pdf` | `file-actions.ts:179` | hidden BrowserWindow `printToPDF` of an HTML page of the PNGs, then opens the PDF tab / reveals in folder | browser | assemble the image-per-page PDF in-frame from the same PNGs (`exportSlidesPdf` is already image-only; no server needed) and `downloadBytes`; capability `exportPdf` = in-frame download (not `api.export`) |
| `printSlides` | `slides:print` | `components/PrintDialog.tsx:141` | hidden BrowserWindow + `webContents.print` | browser | hidden iframe `srcdoc` with `buildPrintDocumentHtml` + `iframe.contentWindow.print()` (Docs `printFrame` prints the frame document and is docx-CSS specific, so not reusable verbatim) |
<!-- prettier-ignore-end -->

#### H. AI (all hidden on the web)

<!-- prettier-ignore-start -->
| method | IPC channel | renderer call sites (grep) | desktop behaviour | web class | web implementation |
| --- | --- | --- | --- | --- | --- |
| `getAiSettings` | `ai:get-settings` | `App.tsx:1202` | provider settings, streaming, GSK login/search in main (`ai-ipc.ts`) | hidden `ai` | `ai.ts` stubs (verbatim: same names and shapes; AI unavailable error on stream) |
| `setAiSettings` | `ai:set-settings` | **0** | provider settings, streaming, GSK login/search in main (`ai-ipc.ts`) | hidden `ai` | `ai.ts` stubs (verbatim: same names and shapes; AI unavailable error on stream) |
| `aiStream` | `ai:stream` | `ai/transport.ts:9`, `ai/AiPanel.tsx:897` | provider settings, streaming, GSK login/search in main (`ai-ipc.ts`) | hidden `ai` | `ai.ts` stubs (verbatim: same names and shapes; AI unavailable error on stream) |
| `aiStreamCancel` | `ai:stream-cancel` | `ai/transport.ts:10`, `ai/AiPanel.tsx:849` | provider settings, streaming, GSK login/search in main (`ai-ipc.ts`) | hidden `ai` | `ai.ts` stubs (verbatim: same names and shapes; AI unavailable error on stream) |
| `onAiStream` | `ai:stream-chunk (push)` | `ai/transport.ts:8`, `ai/AiPanel.tsx:874` | provider settings, streaming, GSK login/search in main (`ai-ipc.ts`) | hidden `ai` | `ai.ts` stubs (verbatim: same names and shapes; AI unavailable error on stream) |
| `aiGskStatus` | `ai:gsk-status` | `ai/AiPanel.tsx:543`, `ai/AiPanel.tsx:1467` | provider settings, streaming, GSK login/search in main (`ai-ipc.ts`) | hidden `ai` | `ai.ts` stubs (verbatim: same names and shapes; AI unavailable error on stream) |
| `aiGskLogin` | `ai:gsk-login` | `ai/AiPanel.tsx:2231` | provider settings, streaming, GSK login/search in main (`ai-ipc.ts`) | hidden `ai` | `ai.ts` stubs (verbatim: same names and shapes; AI unavailable error on stream) |
| `gskStatus` | `ai:gsk-status` | **0** | AI slide-page generation (temp pptx pages), AI image tools (`fetchRemoteImage` SSRF-guarded in main), style templates on disk | hidden `ai` | NOT in Docs `ai.ts`/`hide.ts` (except consumeAiPreset/onAiPreset): need explicit typed stubs - the Proxy fallback returns `undefined` and e.g. `cloudGenStatus().enabled` throws. When AI ships on the web, insertImageUrl/replacePictureUrl/generateImage map to existing `image.fetch` / `api.images.upload` |
| `aiLogRunFailure` | `ai:log-run-failure` | `ai/AiPanel.tsx:701` | AI slide-page generation (temp pptx pages), AI image tools (`fetchRemoteImage` SSRF-guarded in main), style templates on disk | hidden `ai` | NOT in Docs `ai.ts`/`hide.ts` (except consumeAiPreset/onAiPreset): need explicit typed stubs - the Proxy fallback returns `undefined` and e.g. `cloudGenStatus().enabled` throws. When AI ships on the web, insertImageUrl/replacePictureUrl/generateImage map to existing `image.fetch` / `api.images.upload` |
| `webSearch` | `ai:web-search` | `ai/slides-skill.ts:1405` | provider settings, streaming, GSK login/search in main (`ai-ipc.ts`) | hidden `ai` | `ai.ts` stubs (verbatim: same names and shapes; AI unavailable error on stream) |
| `imageSearch` | `ai:image-search` | `ai/AiPanel.tsx:1301`, `ai/slides-skill.ts:1439` | provider settings, streaming, GSK login/search in main (`ai-ipc.ts`) | hidden `ai` | `ai.ts` stubs (verbatim: same names and shapes; AI unavailable error on stream) |
| `insertImageUrl` | `ai:insert-image-url` | `ai/slides-skill.ts:1520` | AI slide-page generation (temp pptx pages), AI image tools (`fetchRemoteImage` SSRF-guarded in main), style templates on disk | hidden `ai` | NOT in Docs `ai.ts`/`hide.ts` (except consumeAiPreset/onAiPreset): need explicit typed stubs - the Proxy fallback returns `undefined` and e.g. `cloudGenStatus().enabled` throws. When AI ships on the web, insertImageUrl/replacePictureUrl/generateImage map to existing `image.fetch` / `api.images.upload` |
| `replacePictureUrl` | `ai:replace-picture-url` | `ai/slides-skill.ts:1561` | AI slide-page generation (temp pptx pages), AI image tools (`fetchRemoteImage` SSRF-guarded in main), style templates on disk | hidden `ai` | NOT in Docs `ai.ts`/`hide.ts` (except consumeAiPreset/onAiPreset): need explicit typed stubs - the Proxy fallback returns `undefined` and e.g. `cloudGenStatus().enabled` throws. When AI ships on the web, insertImageUrl/replacePictureUrl/generateImage map to existing `image.fetch` / `api.images.upload` |
| `generateImage` | `ai:generate-image` | `ai/slides-skill.ts:1471` | AI slide-page generation (temp pptx pages), AI image tools (`fetchRemoteImage` SSRF-guarded in main), style templates on disk | hidden `ai` | NOT in Docs `ai.ts`/`hide.ts` (except consumeAiPreset/onAiPreset): need explicit typed stubs - the Proxy fallback returns `undefined` and e.g. `cloudGenStatus().enabled` throws. When AI ships on the web, insertImageUrl/replacePictureUrl/generateImage map to existing `image.fetch` / `api.images.upload` |
| `analyzeMedia` | `ai:analyze-media` | `ai/slides-skill.ts:1501` | AI slide-page generation (temp pptx pages), AI image tools (`fetchRemoteImage` SSRF-guarded in main), style templates on disk | hidden `ai` | NOT in Docs `ai.ts`/`hide.ts` (except consumeAiPreset/onAiPreset): need explicit typed stubs - the Proxy fallback returns `undefined` and e.g. `cloudGenStatus().enabled` throws. When AI ships on the web, insertImageUrl/replacePictureUrl/generateImage map to existing `image.fetch` / `api.images.upload` |
| `cloudGenStatus` | `slides:cloud-gen-status` | `ai/AiPanel.tsx:1045` | AI slide-page generation (temp pptx pages), AI image tools (`fetchRemoteImage` SSRF-guarded in main), style templates on disk | hidden `ai` | NOT in Docs `ai.ts`/`hide.ts` (except consumeAiPreset/onAiPreset): need explicit typed stubs - the Proxy fallback returns `undefined` and e.g. `cloudGenStatus().enabled` throws. When AI ships on the web, insertImageUrl/replacePictureUrl/generateImage map to existing `image.fetch` / `api.images.upload` |
| `cloudGeneratePage` | `slides:cloud-page-generate` | `ai/AiPanel.tsx:1135` | AI slide-page generation (temp pptx pages), AI image tools (`fetchRemoteImage` SSRF-guarded in main), style templates on disk | hidden `ai` | NOT in Docs `ai.ts`/`hide.ts` (except consumeAiPreset/onAiPreset): need explicit typed stubs - the Proxy fallback returns `undefined` and e.g. `cloudGenStatus().enabled` throws. When AI ships on the web, insertImageUrl/replacePictureUrl/generateImage map to existing `image.fetch` / `api.images.upload` |
| `localGeneratePage` | `slides:local-page-generate` | `ai/AiPanel.tsx:1116` | AI slide-page generation (temp pptx pages), AI image tools (`fetchRemoteImage` SSRF-guarded in main), style templates on disk | hidden `ai` | NOT in Docs `ai.ts`/`hide.ts` (except consumeAiPreset/onAiPreset): need explicit typed stubs - the Proxy fallback returns `undefined` and e.g. `cloudGenStatus().enabled` throws. When AI ships on the web, insertImageUrl/replacePictureUrl/generateImage map to existing `image.fetch` / `api.images.upload` |
| `landGeneratedPages` | `slides:land-generated-pages` | `ai/AiPanel.tsx:953`, `ai/AiPanel.tsx:1005` | AI slide-page generation (temp pptx pages), AI image tools (`fetchRemoteImage` SSRF-guarded in main), style templates on disk | hidden `ai` | NOT in Docs `ai.ts`/`hide.ts` (except consumeAiPreset/onAiPreset): need explicit typed stubs - the Proxy fallback returns `undefined` and e.g. `cloudGenStatus().enabled` throws. When AI ships on the web, insertImageUrl/replacePictureUrl/generateImage map to existing `image.fetch` / `api.images.upload` |
| `consumeAiPreset` | `slides:consume-ai-preset` | `App.tsx:1158` | AI slide-page generation (temp pptx pages), AI image tools (`fetchRemoteImage` SSRF-guarded in main), style templates on disk | hidden `ai` | NOT in Docs `ai.ts`/`hide.ts` (except consumeAiPreset/onAiPreset): need explicit typed stubs - the Proxy fallback returns `undefined` and e.g. `cloudGenStatus().enabled` throws. When AI ships on the web, insertImageUrl/replacePictureUrl/generateImage map to existing `image.fetch` / `api.images.upload` |
| `onAiPreset` | `my-ai:ai-preset (push)` | `App.tsx:1179` | AI slide-page generation (temp pptx pages), AI image tools (`fetchRemoteImage` SSRF-guarded in main), style templates on disk | hidden `ai` | NOT in Docs `ai.ts`/`hide.ts` (except consumeAiPreset/onAiPreset): need explicit typed stubs - the Proxy fallback returns `undefined` and e.g. `cloudGenStatus().enabled` throws. When AI ships on the web, insertImageUrl/replacePictureUrl/generateImage map to existing `image.fetch` / `api.images.upload` |
| `saveStyleSidecar` | `ai:save-sidecar` | `ai/AiPanel.tsx:1309` | AI slide-page generation (temp pptx pages), AI image tools (`fetchRemoteImage` SSRF-guarded in main), style templates on disk | hidden `ai` | NOT in Docs `ai.ts`/`hide.ts` (except consumeAiPreset/onAiPreset): need explicit typed stubs - the Proxy fallback returns `undefined` and e.g. `cloudGenStatus().enabled` throws. When AI ships on the web, insertImageUrl/replacePictureUrl/generateImage map to existing `image.fetch` / `api.images.upload` |
| `saveStyleTemplate` | `ai:save-style-template` | `ai/AiPanel.tsx:1316` | AI slide-page generation (temp pptx pages), AI image tools (`fetchRemoteImage` SSRF-guarded in main), style templates on disk | hidden `ai` | NOT in Docs `ai.ts`/`hide.ts` (except consumeAiPreset/onAiPreset): need explicit typed stubs - the Proxy fallback returns `undefined` and e.g. `cloudGenStatus().enabled` throws. When AI ships on the web, insertImageUrl/replacePictureUrl/generateImage map to existing `image.fetch` / `api.images.upload` |
| `listStyleTemplates` | `ai:list-style-templates` | `ai/AiPanel.tsx:1323` | AI slide-page generation (temp pptx pages), AI image tools (`fetchRemoteImage` SSRF-guarded in main), style templates on disk | hidden `ai` | NOT in Docs `ai.ts`/`hide.ts` (except consumeAiPreset/onAiPreset): need explicit typed stubs - the Proxy fallback returns `undefined` and e.g. `cloudGenStatus().enabled` throws. When AI ships on the web, insertImageUrl/replacePictureUrl/generateImage map to existing `image.fetch` / `api.images.upload` |
| `loadStyleTemplate` | `ai:load-style-template` | `ai/AiPanel.tsx:1330` | AI slide-page generation (temp pptx pages), AI image tools (`fetchRemoteImage` SSRF-guarded in main), style templates on disk | hidden `ai` | NOT in Docs `ai.ts`/`hide.ts` (except consumeAiPreset/onAiPreset): need explicit typed stubs - the Proxy fallback returns `undefined` and e.g. `cloudGenStatus().enabled` throws. When AI ships on the web, insertImageUrl/replacePictureUrl/generateImage map to existing `image.fetch` / `api.images.upload` |
<!-- prettier-ignore-end -->

#### I. Presenter / audience show

<!-- prettier-ignore-start -->
| method | IPC channel | renderer call sites (grep) | desktop behaviour | web class | web implementation |
| --- | --- | --- | --- | --- | --- |
| `presenterStart` | `slides:presenter-start` | `components/PresenterView.tsx:133` | second fullscreen BrowserWindow on the external display sharing the Session; ink/sync/nav relayed by main | hidden `presenterWindow` | v1: presenter + show render in the same frame (single screen); `presenterStart` answers `{audience:false}` (the renderer already handles it), others no-op. v2: `window.open` same-origin popup + `BroadcastChannel`, or Window Management API (Chromium-only, permission + `allow="window-management"`) |
| `presenterSync` | `slides:presenter-sync (send)` | `components/PresenterView.tsx:152` | second fullscreen BrowserWindow on the external display sharing the Session; ink/sync/nav relayed by main | hidden `presenterWindow` | v1: presenter + show render in the same frame (single screen); `presenterStart` answers `{audience:false}` (the renderer already handles it), others no-op. v2: `window.open` same-origin popup + `BroadcastChannel`, or Window Management API (Chromium-only, permission + `allow="window-management"`) |
| `presenterInk` | `slides:presenter-ink (send)` | `components/PresenterView.tsx:159`, `components/PresenterView.tsx:304` (+4) | second fullscreen BrowserWindow on the external display sharing the Session; ink/sync/nav relayed by main | hidden `presenterWindow` | v1: presenter + show render in the same frame (single screen); `presenterStart` answers `{audience:false}` (the renderer already handles it), others no-op. v2: `window.open` same-origin popup + `BroadcastChannel`, or Window Management API (Chromium-only, permission + `allow="window-management"`) |
| `presenterSwap` | `slides:presenter-swap` | `components/PresenterView.tsx:396` | second fullscreen BrowserWindow on the external display sharing the Session; ink/sync/nav relayed by main | hidden `presenterWindow` | v1: presenter + show render in the same frame (single screen); `presenterStart` answers `{audience:false}` (the renderer already handles it), others no-op. v2: `window.open` same-origin popup + `BroadcastChannel`, or Window Management API (Chromium-only, permission + `allow="window-management"`) |
| `presenterEnd` | `slides:presenter-end` | `components/PresenterView.tsx:138` | second fullscreen BrowserWindow on the external display sharing the Session; ink/sync/nav relayed by main | hidden `presenterWindow` | v1: presenter + show render in the same frame (single screen); `presenterStart` answers `{audience:false}` (the renderer already handles it), others no-op. v2: `window.open` same-origin popup + `BroadcastChannel`, or Window Management API (Chromium-only, permission + `allow="window-management"`) |
| `audienceReady` | `slides:audience-ready` | `components/AudienceView.tsx:158` | second fullscreen BrowserWindow on the external display sharing the Session; ink/sync/nav relayed by main | hidden `presenterWindow` | v1: presenter + show render in the same frame (single screen); `presenterStart` answers `{audience:false}` (the renderer already handles it), others no-op. v2: `window.open` same-origin popup + `BroadcastChannel`, or Window Management API (Chromium-only, permission + `allow="window-management"`) |
| `audienceNav` | `slides:audience-nav (send)` | `components/AudienceView.tsx:178`, `components/AudienceView.tsx:187` (+3) | second fullscreen BrowserWindow on the external display sharing the Session; ink/sync/nav relayed by main | hidden `presenterWindow` | v1: presenter + show render in the same frame (single screen); `presenterStart` answers `{audience:false}` (the renderer already handles it), others no-op. v2: `window.open` same-origin popup + `BroadcastChannel`, or Window Management API (Chromium-only, permission + `allow="window-management"`) |
| `onShowSync` | `slides:show-sync (push)` | `components/AudienceView.tsx:140` | second fullscreen BrowserWindow on the external display sharing the Session; ink/sync/nav relayed by main | hidden `presenterWindow` | v1: presenter + show render in the same frame (single screen); `presenterStart` answers `{audience:false}` (the renderer already handles it), others no-op. v2: `window.open` same-origin popup + `BroadcastChannel`, or Window Management API (Chromium-only, permission + `allow="window-management"`) |
| `onShowInk` | `slides:show-ink (push)` | `components/AudienceView.tsx:141` | second fullscreen BrowserWindow on the external display sharing the Session; ink/sync/nav relayed by main | hidden `presenterWindow` | v1: presenter + show render in the same frame (single screen); `presenterStart` answers `{audience:false}` (the renderer already handles it), others no-op. v2: `window.open` same-origin popup + `BroadcastChannel`, or Window Management API (Chromium-only, permission + `allow="window-management"`) |
| `onAudienceNav` | `slides:audience-nav (push)` | `components/PresenterView.tsx:250` | second fullscreen BrowserWindow on the external display sharing the Session; ink/sync/nav relayed by main | hidden `presenterWindow` | v1: presenter + show render in the same frame (single screen); `presenterStart` answers `{audience:false}` (the renderer already handles it), others no-op. v2: `window.open` same-origin popup + `BroadcastChannel`, or Window Management API (Chromium-only, permission + `allow="window-management"`) |
<!-- prettier-ignore-end -->

### 1.3 `window.desktop` (6 methods): the Docs attachment subset

The preload says so itself ("method names/signatures match the window.desktop attachment subset in docs, so the renderer's
files-skill is copied over wholesale"). All six are used only by the AI panel, which is hidden on the web, but they are cheap
and already written:

<!-- prettier-ignore-start -->
| method | call sites | web |
| --- | --- | --- |
| `pickAttachments` | `ai/AiPanel.tsx:1965` | reuse `web/docs/bridge/browser.ts:533` (`<input type=file multiple>`, ids `web-file://<n>/<name>`) |
| `addAttachmentPaths` | `ai/AiPanel.tsx:1974`, `:1989` | reuse `browser.ts:541` (validates registered ids) |
| `addPastedImage` | `ai/AiPanel.tsx:1987` | reuse `browser.ts:543` (wraps bytes in a registered `File`) |
| `readAttachment` | `ai/files-skill.ts:83` | reuse `browser.ts:554` (text extensions only; no docx/pdf/pptx extraction in the browser) |
| `readAttachmentImage` | `ai/AiPanel.tsx:456`, `:1566` | reuse `browser.ts:582` (5 MB cap) |
| `getPathForFile` | `ai/AiPanel.tsx:1972`, `:1981` | reuse `browser.ts:539` (registers the `File`; Docs `hide.ts:150` returns `''`, `browser` wins by module order) |
<!-- prettier-ignore-end -->

These are not behind a capability of their own: they are unreachable while `ai` is off. The server-side `api.attachments.add` protocol
type exists for when AI ships on the web; nothing in Slides needs it before that.

### 1.4 `window.projectApi` (10 methods): AI chat memory only

`resolveChat`, `appendChat`, `loadChat`, `rebindChat` are called from `ai/AiPanel.tsx:596/671/599/640`. `listProjects`, `createProject`,
`renameProject`, `deleteProject`, `moveFile`, `getTimeline` have **0** renderer call sites in Slides. All ten are the same
`ProjectApi` type from `@genoffice/project-store` that Docs implements in memory in `web/docs/bridge/project-memory.ts`
(documented there with the future UniWork endpoints): reuse verbatim, `projectApi` assigned to `window.projectApi` as in `install.ts`.

### 1.5 What can be reused from `web/docs/bridge` (answer to "does `window.desktop` overlap with Docs?": yes)

Name-level overlap, computed by matching the 187 Slides names against the object keys of `hide.ts`, `ai.ts`, `browser.ts`,
`webapi.ts`: **30 identical keys**.

<!-- prettier-ignore-start -->
| Docs module | identical keys also on a Slides global | verdict |
| --- | --- | --- |
| `browser.ts` | `getLanguage`, `onLanguageChanged`, `getTheme`, `onThemeChanged`, `pickAttachments`, `addAttachmentPaths`, `addPastedImage`, `readAttachment`, `readAttachmentImage`, `getPathForFile` | reuse; extract the generic exports per CONTRACT C2. `browser.ts` also holds docx-only keys (`print` = print the frame document with docx CSS, `pickImage`, `copyImageToClipboard`, `fontMetrics`), so Slides takes the named exports (`downloadBytes`, `downloadBlob`, `safeFileName`, `guardedOpen`, `openExternal`, `pickFiles`, the attachment helpers, `setWebTheme`, `setWebLanguage`), not the default object |
| `hide.ts` | `getAutoSaveDefault`, `onAutoSaveDefaultChanged`, `onChromePressed`, `consumeAiPreset`, `onAiPreset`, `consumeHeadlessExport`, `headlessExportDone`, `onCloseSaveRequest`, `reportCloseSaveResult`, `onMenuCommand` | the first seven verbatim; the last three are overridden by `session.ts` for the host save flow (Docs does the same) |
| `ai.ts` | `getAiPanelPrefs`, `getAiSettings`, `setAiSettings`, `aiStream`, `aiStreamCancel`, `aiGskStatus`, `aiGskLogin`, `onAiStream`, `webSearch`, `imageSearch` | reuse verbatim; **14 more AI methods have no Docs stub** (the ones in table H that are not listed here, except `consumeAiPreset`/`onAiPreset` which `hide.ts` has) and must get typed stubs: the generic Proxy fallback answers `undefined`, and e.g. `cloudGenStatus().enabled` would throw |
| `project-memory.ts` | all 10 `projectApi` keys | reuse verbatim |
| `host-appearance.ts`, `frame-port.ts` | n/a (helpers) | reuse verbatim (`bindHostAppearance`, `FramePort`); widen the `Lang` type (Slides `getLanguage` is typed to 11 languages in `preload`, the Docs bridge uses the shared `Lang`) |
| `install.ts` | n/a (pattern) | reuse the merge order and the safe-no-op `Proxy` (`on*` -> disposer, others -> async no-op); parameterise the global name (`slidesApi` + `desktop` + `projectApi`) |
| `webapi.ts` | n/a | pattern only: docx-named (`consumePendingOpenDocx`, `onOpenDocx`, `exportPdf` -> `api.export`) and docx-typed; Slides needs its own `createWebSlidesApi` with the same open/save/saveAs/recents/rename mapping |
| `session.ts` | n/a | pattern only: it drives the host `save`/`saveAs`/`doc.closeCheck` through `onCloseCheck`/`reportCloseCheck`, which Slides does not have (Slides has `isDirty()` + `onCloseSaveRequest` + `onMenuCommand`); with the engine in-frame the dirty signal is exact (history/deck events), no polling needed |
| `headless.ts` | n/a | not needed unless the server ever renders pptx (section 3.4) |
<!-- prettier-ignore-end -->

### 1.6 Proposed capability keys (frame-local, like Docs `DesktopCapabilities`; not protocol)

Slides has no `capabilities` object and no `cap()` helper. Proposal: optional `capabilities?: SlidesCapabilities` on `SlidesApi`
(absent = desktop, everything on) and a `cap(key)` helper beside the renderer, defaults identical to `hide.ts` `webCapabilities`
for the shared keys:

<!-- prettier-ignore-start -->
| key | hides | methods / UI | same key as Docs |
| --- | --- | --- | --- |
| `platform` (`'desktop' \| 'web'`) | selects web-only behaviour (no window-control/vibrancy chrome as in `?mode=tab`, macOS fullscreen path) | `Ribbon.tsx:130/1703`, `main.tsx:33`, `SlideShowView.tsx:185`, `PresenterView.tsx:179` | yes |
| `ai` (+ `webSearch`, `imageSearch`, `imageGeneration`) | AI dock `App.tsx:3243`, `stage-ai-btn` `:3622`, `AiAskPopover` `:4241`, ribbon `aiOpen` `:2936`, context-menu AI actions | 27 methods (table H plus `getAiPanelPrefs` and `onAiPanelPrefsChanged` in table A) | yes |
| `autoSaveToDisk` | AutoSave toggle, crash-recovery copy | `getAutoSaveDefault`, `onAutoSaveDefaultChanged`, `setAutoSavePref` | yes |
| `tabs` | shell chrome | `onChromePressed` | yes |
| `open`, `recents` | File > Open, recent files (granted by `filePick` / `recents`) | `openPptx`, `getRecentFiles`, `openPptxPath` | yes |
| `fontDownload` | catalog download UI and the auto-download of missing fonts (`App.tsx:344`) | `fontCatalog`, `fontDownload` | no (new) |
| `fontInstallLocal` | "install font file" | `fontInstallLocal` | no (new) |
| `presenterWindow` | second-screen audience window, swap-screens button | 10 presenter/audience methods | no (new) |
| `model3d` | Insert > 3D model | `insertModel3d` | no (new) |
| `headlessExport` | CLI export hooks | `consumeHeadlessExport`, `headlessExportDone` | no (new) |
<!-- prettier-ignore-end -->

Screen recording (`insert-actions.ts:426`, `getDisplayMedia` + `MediaRecorder`) has no preload method; it is a plain browser API and works
on the web (Electron's `setDisplayMediaRequestHandler` in `slides-main.ts` is only the desktop source picker). Left on; needs a user
gesture, so it cannot be covered by headless e2e (manual check). Local font enumeration (`system-fonts.ts`, `queryLocalFonts`) is already
feature-detected and degrades to the built-in list.

### 1.7 Protocol impact

Prefer existing types, and the table shows they suffice: no new message type and no new `Capability` enum value for v1.
Slides' export and print are in-frame downloads/printing, so the host grants `print`/`exportPdf` only as show/hide switches.
Two **optional, additive** items, both decisions for the lead:

- `InitPayload.user?: { displayName: string }`, only if comments should carry the real author. Today `slides:add-comment` uses
  `userInfo().username` (`slides-main.ts:435`); on the web the frame has no user identity (`InitPayload` has none). The name is written
  into the pptx, so the default should be a generic "User" until the owner decides.
- `module: 'slides'` on `ready`/`init` is already in CONTRACT C1 (not B5's change).

## 2. The G3 pptx host today, and what the frame must keep

G3 = dev-uniwork `apps/web/platform/office/pptx-office-host.tsx` (174 lines) + `packages/views/office/pptx` (~8k lines of views and
tests) + `apps/web/platform/office/pptx-{runtime,adapter,save-transport}.ts*`. It is **not** the genoffice Slides editor: it is a
separate React/SVG implementation on top of the vendored genoffice engine closure (`@uniwork/office-upstream/pptx-renderer`: `openPptx`,
`runTxn`, `savePptx`, `commitSaved`, `buildRenderSlide`, `HeuristicMetrics`, pinned to genoffice `09485f88...`, `pptx-office-host.tsx:30`).
The frame replaces the _UI_ (Konva canvas, ribbon, panels) with the real Slides renderer and keeps the same engine, now at the fork's version.

<!-- prettier-ignore-start -->
| capability | G3 today (evidence) | the frame must keep | gap / difference |
| --- | --- | --- | --- |
| **open** | host downloads the authorised bytes (`readDocumentBytesWithinBound`, `pptx-save-transport.ts:read`) and `createWebPptxSessionRuntime` opens them in the browser (`pptx-runtime.ts`); flag-independent, fails closed to an "unavailable" alert | open through the F3 token routes (`init.open` / `api.open`), same size bound, same fail-closed fallback to G3 when the bundle is not installed or the flag is off (CONTRACT C4) | the Slides `rejectLegacyPpt` CFB check (`cfb-sniff.ts`, pure) must surface as a typed fatal, not the desktop `dialog` |
| **save + versions** | `serialize` -> `savePptx`; `upload` then `commitDocumentVersion(uploadId, baseRevision, idempotencyKey)`; both receipts (sha256, size) are checked against the serialized bytes; shared save coordinator (`@uniwork/core/office`) | `api.save {fileId, data, etag}` -> host upload+commit; checksum receipts and idempotency stay host-side (F3, same as Docs); versions list/restore stay in the host's Documents UI | **conflict UI**: Docs raises Overwrite / Reload latest / Cancel from the bridge (`notice.ts` + `webapi.ts:resolveConflict`, strings `appWebConflict*` in the Docs renderer shards, classes `.modal*`); Slides needs the same keys in its own i18n shards (CLAUDE.md: zh defines the keys, every sibling shard) |
| **drafts / crash recovery** | `draft-store.ts`, `draft-key-provider.ts`, journal replay (`PptxJournalEntry`, `rebasePptxJournal`) | nothing: the Docs frame does not have it either (`writeRecoveryCopy` hidden, `hide.ts:114`) | **regression vs G3** while the flag is on: an unsaved Slides session is lost on reload/crash. Decide: accept (as Docs) or add an IndexedDB draft in v2 |
| **read-only documents** | same editor mounted with saves blocked (`readonly` in `pptx-office-host.tsx`) | `FileMeta.writable === false` | **Slides renderer has no read-only mode** (grep: no `readOnly` state in `apps/slides/src/renderer`; the Docs frame does not use `writable` either, no hit in `protocol/host.ts`, `client.ts` or `apps/docs` renderer). Recommend: host falls back to G3 for non-writable documents in v1 |
| **slide show** | `show/pptx-slide-show.tsx`: Fullscreen API on the show root, PowerPoint keys (`show-nav.ts`), hidden slides skipped, undo chords swallowed, Esc/exit; **no transitions** ("the canvas renders none yet") | present from current / from start, hidden skipped, Esc exits | the Slides renderer's `SlideShowView` is richer (transitions, animations, ink, media, links); on web it replaces G3's show. Needs the macOS fullscreen fix (3.2) |
| **presenter view** | `presenter.tsx` + `show/pptx-presenter-view.tsx` (notes, next slide, timer), single window, same fullscreen overlay | presenter view with notes + next slide | Slides' `PresenterView` also opens a second window on an external display (`presenter-show.ts`): hidden in v1 (3.2) |
| **print** | `print/pptx-print.ts`: one self-contained, script-free HTML page per slide (SVG data URL, raster fallback), 7.5in page height, CSP `img-src data:` only, handed to `OfficePrintPort` (web: isolated frame) | print with the same page geometry (7.5in height, width from ratio, 0.2-5 clamp) | Slides builds the print HTML itself (`shared/print-html.ts`, handouts/notes layouts, PNG pages); the Slides print dialog previews it in a `sandbox="allow-same-origin"` `srcdoc` iframe (works, 3.7). Print = in-frame iframe print |
| **PDF export** | "Export PDF" is the same print port (browser Save as PDF) | export PDF | Slides exports an image-per-page PDF (`pdf-export.ts`); web builds it in-frame and downloads (3.4) |
| **images / media** | Insert panel picture control; `media/pptx-media-insert.tsx` inserts audio/video/poster through a file input and the `addMedia` edit (extension allow-list, typed refusal) | insert picture, insert/replace media, replace poster, remove | Slides has more (screen recording, 3D, crop, cutout, SmartArt, charts); media playback needs the CSP/`blob:` change (3.3) |
| **fonts** | none in the canvas path (`HeuristicMetrics`, no font loading; grep `font` in `views/office/pptx/canvas` finds nothing); `embedded-fonts`/`render-fidelity` are command ids only | embedded-font registration, Carlito for Calibri | Slides renders with real metrics and embedded fonts: a fidelity **improvement**, with the payload and metrics questions of 3.5 |
| **find / notes / comments / masters / tables / charts / animations / sections / header-footer / links** | present as G3 panels (`find/`, `notes/`, `comments/`, `masters/`, `tables/`, `charts/`, `animations/`, `sorter/`, `headerfooter/`, `links/`) | all exist in the Slides renderer natively | parity check list for the tester_visual pass, not an implementation item |
| **undo / redo, dirty** | `use-pptx-gesture-history.ts`; adapter journal | exact `dirty` event, undo/redo | in-frame history events replace polling |
<!-- prettier-ignore-end -->

G3's 19 command ids (`command-map.ts`) are a convenient acceptance checklist: open, edit-text, edit-shape-image, save, export-pdf, print,
speaker-notes, masters-layouts, animations, charts, tables, embedded-fonts, render-fidelity, find, undo, redo, presenter, fullscreen, slideMaster.

## 3. Slides specifics

### 3.1 Where the engine lives (the architectural cost)

<!-- prettier-ignore-start -->
| | Docs | Slides |
| --- | --- | --- |
| preload channels | 81 | 181 methods + 6 + 10 |
| main process | `docs-main.ts` 4,912 lines, 73 handlers (file I/O, dialogs, Zotero, passwords) | `slides-main.ts` 4,756 lines + `session-state.ts` 492: **the document engine**, 140 handlers |
| document model | in the renderer | in main: `sessions = Map<webContentsId, Session>`; `Session{opened, undoStack, redoStack, historyBatch, masterEdit, opLog,...}` |
| renderer to model | direct calls | edit intent over IPC, `RenderSlide[]` back (images as `dataUrl`, so `img-src data:` already covers them) |
| web bridge | I/O only | I/O **plus** a session core |
<!-- prettier-ignore-end -->

Of the 140 `slides-main.ts` handlers about 30 touch Electron or Node (open/save/save-as/pick-* dialogs, `insert-image/media/model3d`,
`edit-background`/`edit-image-fill` pickers, `edit-chart` confirm box, clipboard (`copy-slide`, `clipboard-*`, `copy-elements`),
export/print windows, `show-fullscreen`, cloud-page temp files, `consume-*`); the other ~110 are `runTxn`/`buildRenderSlide` calls inside
`sessionTxn`/`journaledTxn` and port without change. **No test imports `slides-main.ts`** (grep over `apps/slides/tests`, 73 files; 13 import
other `src/main/*` modules such as `fonts`, `session-state`, `shaped-metrics`), so extraction has no characterisation net: S1 must add one
(run every handler through the new registry against fixture decks and compare `RenderSlide` output before/after).

Other main-side services the web must replace: undo/redo snapshots (move with the core), 30 s autosave to `<userData>` (hidden:
`autoSaveToDisk`), recent files (`api.recents`), per-webContents close-save handshake (host `save`), `installNavigationGuard`/`setWindowOpenHandler`
(`slides-main.ts:380`: external links open in the system browser; web uses `guardedOpen`: http(s) only, `noopener`).

### 3.2 Presenter / slideshow windows

Desktop: `presenter-show.ts` (157 lines) opens a **second `BrowserWindow`** fullscreen on an external display (`mode=audience`), registers it in
the _same_ `sessions` map so it reads the live in-memory deck, and relays `slides:presenter-sync/ink/swap/end` and `audience-nav` through main.
Also `slides:show-fullscreen` (macOS `simpleFullScreen`, tab bleed).

Web:

- **Single-screen show and presenter view in the same frame**: works with what exists. Fullscreen entered in the same-origin frame with no
  `allow=` attribute (probe 3.7), so no host change; the host iframe already has `allow="clipboard-read; clipboard-write"`.
- **Bug to fix in the renderer**: `SlideShowView.tsx:185` and `PresenterView.tsx:179` skip `requestFullscreen` when `navigator.platform` contains "mac",
  because on desktop main does the macOS snap. In a macOS browser the show would stay windowed. Gate on `capabilities.platform === 'web'`, not on the OS.
- **Second-screen audience window** = capability `presenterWindow` off in v1: `presenterStart` answers `{audience:false}` (the renderer already handles it,
  `PresenterView.tsx:133`). v2 options: `window.open` of a same-origin audience page plus `BroadcastChannel`/`postMessage` (needs a popup allowed by the
  user, and the audience page needs a channel to the opener, which Docs' `guardedOpen` (always `noopener`) forbids; it needs its own narrow exception for one same-origin URL), or the
  Window Management API (Chromium only, permission, `allow="window-management"`). Not probed; decision for the owner.

### 3.3 Media playback

- Embedded audio/video: `slides:media-data` returns `data:<mime>;base64,...` and the renderer sets `<video src>`/`<audio src>` (`App.tsx:3877`,
  `SlideShowView.tsx:540/564`). Under the Docs CSP **`media-src` falls back to `default-src 'none'`: `data:`, `blob:` and remote URLs are all blocked**
  (probe 3.7). Desktop's own `index.html` carries `media-src 'self' data: blob:` with the comment "pptx-embedded audio and video".
  Recommended: `getMediaData` returns a `blob:` URL (`URL.createObjectURL` of the zip entry bytes, revoked on close) and the web CSP adds
  **`media-src blob:`** (no `data:`; keeps `connect-src` free of `data:`/`blob:`).
- Large media: a base64 `data:` URL of a 100 MB video is ~133 MB of string; blob URLs avoid that and the IPC copy.
- External linked media (`media.external`, an `http` URL, `pptx-engine/src/index.ts:407-411`): returned as-is today; on the web it would be an arbitrary
  third-party fetch from inside a same-origin frame (tracking, SSRF-like reach to internal URLs from the viewer's network). Keep it **hidden**:
  show the poster, no playback, small notice. Pictures have no external form in the engine (only audio/video use `TargetMode="External"`).
- Codec limits: `unplayableAudioCodec` / AVI warnings (`mp4-audio-sniff.ts`, pure) port as an inline warning instead of `dialog.showMessageBox`.
- Insert: file input instead of the native dialog; poster for video from a `<video>` frame grab on a canvas (desktop uses the QuickLook thumbnail,
  macOS only), solid fallback as today. Screen recording works natively (`getDisplayMedia`).

### 3.4 Export to PDF / images, and print

<!-- prettier-ignore-start -->
| flow | desktop | web recommendation | server needed? |
| --- | --- | --- | --- |
| export images | renderer rasterises each visible slide to a 2x PNG with offscreen Konva (`export-render.tsx`), main writes `<base>-NN.png` into a picked folder | same rasterisation (already client-side); `pickExportDir` returns a sentinel, `exportImages` zips with `jszip` (an engine dependency already) and downloads one `.zip` | no |
| export PDF | same PNGs, main loads them into a hidden window and `printToPDF` (`pdf-export.ts`; page 7.5in tall, width by ratio) | build the image-per-page PDF in-frame (small PDF writer: JPEG `DCTDecode` from `canvas.toBlob('image/jpeg')`, or PNG pass-through with `CompressionStream('deflate')` + predictor, both available in Chromium) and `downloadBytes` | **no** |
| print | hidden window, `webContents.print` of an HTML page of the PNGs (`shared/print-html.ts`: full / handouts / notes layouts) | hidden `<iframe srcdoc>` with `buildPrintDocumentHtml` and `iframe.contentWindow.print()`; works under the Docs CSP (probe 3.7). `printFrame` in the Docs bridge prints the *frame document* with docx CSS and is not reusable | no |
| headless CLI export | `--headless-export` (`consumeHeadlessExport`/`headlessExportDone`, `headless-export.ts`) | not needed | no |
<!-- prettier-ignore-end -->

Why not `api.export`: its server route (`/office-frame/documents/{id}/export/pdf`, `office_frame_export.go`) feeds the docx renderer
(`renderDocxPdf`, `docs-pdf.ts`; the engine handler comment says "the only target is pdf" for docx). A pptx PDF through it would need a Slides
headless entry like Docs' `headless.ts` and a pptx lane in office-engine, which the in-frame path makes unnecessary. If the owner later wants a
server-side deck PDF (print-quality, fonts guaranteed), that is the job for a Slides headless entry; flag, not v1.

### 3.5 Fonts, font payload, text metrics

- **Layout runs in the engine**, with a `FontMetricsProvider` (`pptx-render/src/metrics.ts`). Desktop: `OpentypeMetrics` over system font files found by `fonts.ts`
  (1,332 lines, scans `/Library/Fonts`, `C:\Windows\Fonts`, Office DFonts, `.ttc` splitting) and HarfBuzz (wasm) for Arabic/Hebrew/Thai/Devanagari
  (`shaped-metrics.ts`); drawing then uses the **same family name** (`displayFamily`) so measure and draw agree. The web has no system font _files_:
  `queryLocalFonts` gives names only and needs a permission.
- **Recommendation**: a `canvas.measureText` provider (same text engine as the Konva draw, so measure == draw by construction, shaping included), `HeuristicMetrics`
  as fallback (what G3 uses). This keeps wasm out of the bundle and `wasm-unsafe-eval` out of the CSP (3.7). It drifts from PowerPoint's metrics where the
  deck's font is absent on the viewer's machine; that is the same limitation a desktop user without the font has.
- **Bundled faces**: Carlito x4 (Calibri metric twin), 8 `@font-face` rules (`Carlito` and the `Carlito GO` alias) over the 4 files in `apps/slides/src/renderer/styles.css:7-56`, loaded explicitly in `main.tsx:20-24`
  because canvas `fillText` never triggers downloads. In the plain build they are 2,749 kB of TTF (4 files, 1,158 kB gzipped); Docs already ships lossless
  WOFF2 twins in `web/docs/fonts/` (Carlito 4 faces = 798 kB). Reuse them (Docs `woff2FontsPlugin`, never inline, lazy by `@font-face`).
  Open question: Liberation (Arial/Times/Courier) and Caladea (Cambria) twins are in the Docs bundle (12 + 4 faces, ~1.7 MB WOFF2); Slides on desktop gets those names from the
  OS. Adding them gives Windows-free machines a metric-compatible fallback: recommended, measure the cost in B5.
- **Embedded pptx fonts**: `privateFontFaces`/`privateFontData` -> `new FontFace(family, ArrayBuffer)` (`doc-fonts.ts`); CSP `font-src` does not apply to
  ArrayBuffer faces (Docs relies on the same for embedded docx fonts). Office DFonts and cloud fonts do not exist on the web, so decks that rely on them fall
  back; note it in the fidelity list.
- **Font download / install**: CDN download (`font-store.ts`, `connect-src` conflict) and local install are hidden (`fontDownload`, `fontInstallLocal`); v2 can ship the
  curated OFL list as bundle assets (`font-catalog.ts` has 514 lines of families/hashes) or a session-only file input.
- CJK: Docs ships Noto Sans/Serif CJK SC subsets (2.5 MB and 3.5 MB) lazily. Slides decks with CJK text draw with the viewer's system CJK font in canvas (no
  download) but metrics come from the same canvas, so no payload is needed; revisit only if the visual pass shows drift.

### 3.6 Image fetch

The renderer never fetches remote images itself. Remote image insertion is AI-only (`ai:insert-image-url`, `ai:replace-picture-url`, `slides:cloud-page-generate`
land step: `fetchRemoteImage`, SSRF-guarded in `@genoffice/electron-utils` with `dns`/`net`), hidden with `ai`. When AI ships it maps to the existing protocol
`image.fetch` (host-side SSRF-guarded) -> bytes -> `addPicture`; no new type. Local pictures use file inputs; clipboard pictures use the Clipboard API
(`clipboardExternal`). `Ribbon.tsx:753` does `fetch(url)` on bundled texture assets: same-origin, fine under `connect-src 'self'` **as long as the build never inlines
them as `data:`** (Vite's 4 KiB default; all 8 textures are 9-41 kB today, but Docs' `assetsInlineLimit` only pins fonts; pin images too).

### 3.7 CSP and security: conflicts with the Docs policy

Docs policy (`web/docs/build/csp.ts`): `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self';
worker-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'`, header-only (no `<meta>`).

**Probe**: a throwaway page under that exact header, run in headless Chromium (Playwright, build lock held; script and results are in the lane scratchpad, not committed):

<!-- prettier-ignore-start -->
| test | result | meaning for Slides |
| --- | --- | --- |
| `<iframe srcdoc sandbox="allow-same-origin">` with a `data:` image (the print-preview pane, `PrintDialog.tsx:173`) | loads, image decodes, `contentWindow.print` exists, no violation | **no conflict**; `frame-src 'none'` does not apply to `about:srcdoc` |
| `<video src="data:video/webm;base64,...">` | `media-src` violation | **conflict**: today's embedded-media path is blocked |
| `<video src=blob:...>` | `media-src` violation | blocked too until `media-src blob:` is added |
| `<video src="http://...">` (external linked media) | `media-src` violation | stays blocked; intended (3.3) |
| `new Worker(blob:)` | `worker-src` violation (constructor does not throw; blocked asynchronously) | no Worker is created by the renderer bundle (grep of the build: 0 `new Worker`); a blob worker for the engine would **conflict**, so run the engine on the main thread or ship it as a `'self'` worker file |
| `new Worker('/w.js')` (same origin file) | created, no violation | a `'self'` worker is the compliant option if the engine is moved off the main thread |
| `fetch('data:...')` | blocked (`connect-src`) | the renderer has no `fetch(data:)` (only `Ribbon.tsx:753`, a same-origin URL); keep decoding `data:` by hand as `browser.ts` does |
| `WebAssembly.instantiate` | `script-src` `wasm-eval` violation | HarfBuzz (`shaped-metrics.ts`, `harfbuzz.wasm` 422 kB) cannot run; desktop `index.html` carries `'wasm-unsafe-eval'` for it. **Do not add it to the shared policy**; use canvas metrics |
| `new Function(...)` | `script-src` `eval` violation | the Slides build contains none (grep of the built bundle: 0 `new Function`, 0 `eval(`); `acorn` (`layout-script-interpreter.ts`) is an AST interpreter, no eval |
| `documentElement.requestFullscreen()` on a click inside the same-origin iframe, no `allow=` | `entered` | **no host iframe change** for the show |
<!-- prettier-ignore-end -->

Other findings (read, not probed):

- The desktop renderer `index.html` carries a `<meta>` CSP (`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; font-src 'self' data: blob:; media-src 'self' data: blob:;
worker-src 'self' blob:; connect-src 'self' ws://localhost:*`). The web entry must not carry any `<meta>` CSP (Docs rule: `frame-ancestors` needs the header and a `<meta>` would
  intersect with it); the per-module `csp.json` is built from the Docs policy plus the one delta below.
- **Delta for `slides` (CONTRACT C3 asks us to say why)**: add `media-src blob:`. Nothing else: no `wasm-unsafe-eval`, no `worker-src blob:`, no `font-src data:/blob:`, no `connect-src` widening.
- The renderer bundle contains AI provider metadata with default base URLs (`api.openai.com`, `api.anthropic.com`, ... from `@genoffice/ai-provider/browser`); nothing calls them from the
  browser and `connect-src 'self'` would block it, but it is dead weight and a "keys in the browser" UI that must stay hidden. Tree-shake behind a build-time `WEB` flag if it measures.
- **Same-origin `localStorage`**: the frame shares the UniWork page's origin, so its keys (`ai-slides-*`, `slides-ai-panel-width`, recent colours, thumbnail width, ribbon-collapse,
  auto-save override) live next to the host's. They are namespaced and non-sensitive, but per-document keys (`ai-slides-guides:${path}`, `ai-slides-custom-shows:${path}`,
  `App.tsx:1652/1783`) store _document-related_ data outside the pptx, keyed by the display path: acceptable v1, lost on another browser. The Docs frame also keeps theme/language out
  of `localStorage` (host-driven); Slides' `main.tsx:48-59` already reads both from the bridge.
- **External links**: slide hyperlinks call `window.open(url, '_blank', 'noreferrer')` (`App.tsx:2368`, `SlideShowView.tsx:303`); install `guardedOpen` (http(s) only, `noopener`).
  `setLink` accepts any text, so the guard is the enforcement point on the web (desktop uses `safeExternalUrl`).
- **Clipboard**: needs `navigator.clipboard` (iframe already `allow="clipboard-read; clipboard-write"`); read requires a user gesture and a permission prompt, so `clipboardProbe`
  cannot be accurate (answer `true` and let `clipboardExternal` return `{kind:'none'}`).
- **Untrusted pptx content**: parsing runs in the viewer's page (same origin as UniWork). Text and shapes are drawn on Konva canvases and pictures are `dataUrl` images; the only
  `dangerouslySetInnerHTML` sites are built-in icon/preset SVG bodies (`components/icons.tsx:50`, `RibbonInsertTab.tsx:252`), and text editing is a `contentEditable` overlay
  (`TextEditOverlay.tsx`; not audited here for HTML injection). G3 has the same trust model. Treat as in scope for the R-review pass: SVG/EMF/WMF rasterisation (`metafileToDataUrl`), zip-bomb limits in `openPptx`
  (not checked here).
- Not probed (need a real user gesture/permission, flag for the e2e/visual pass): `getDisplayMedia` inside the frame, `queryLocalFonts`, clipboard read.

## 4. Plain `vite build` of `apps/slides/vite.renderer.config.ts`

Command (under the lane build lock, from `apps/slides` because the config has `root: 'src/renderer'` relative to the cwd; running it from the repo root fails with
"Could not resolve entry module src/renderer/index.html"):

```sh
cd apps/slides
flock /home/ubuntu/.uniwork-lane-build.lock npx vite build --config vite.renderer.config.ts --outDir <scratch>/slides-dist --emptyOutDir
```

Result: **success**, vite 7.3.6, 462 modules transformed, built in 7.0 s (9.4 s user CPU; the rest of the wall clock was waiting for the lock). 16 files, no errors, one warning (chunk > 500 kB).

<!-- prettier-ignore-start -->
| file | raw | gzip |
| --- | --- | --- |
| `assets/index-*.js` (single chunk) | 3,063.04 kB | 903.01 kB |
| `assets/index-*.css` | 139.24 kB | 25.14 kB |
| `Carlito-{Regular,Bold,Italic,BoldItalic}-*.ttf` (4) | 2,749.35 kB | 1,158.0 kB (gzip -9 per file) |
| 8 texture PNGs + `send-enter-off.png` | 195.3 kB | not recompressed |
| `index.html` | 0.84 kB | 0.46 kB |
| **total, 16 files** | **6,148,764 B (5.86 MiB)** | **2,208,736 B (2.11 MiB)** as a tarball |
<!-- prettier-ignore-end -->

Compared with the Docs web build (`docs/web-docs/REPORT.md`): initial JS 3.85 MiB raw / 1.15 MiB gzip. This renderer-only Slides bundle is 2.92 MiB / 0.86 MiB.
What the plain build does **not** include and the web build will:

- the document engine: measured separately with esbuild (`pptx-engine` + `pptx-ops` + `pptx-render` + `opentype.js`, `node:*` and `?raw` externalised): **941,710 B raw / 293,505 B gzip**
  (plus `op-docs` markdown and the four Node/Buffer shims, a few kB; `bidi-js` is a real dependency in the fork so G3's bidi shim is not needed);
- the bridge, `FramePort` client and the stubs (small).

Expected web initial JS: **about 4.0 MB raw / about 1.2 MB gzip** before tree-shaking, in line with Docs. Likely savings: i18n dictionaries (Docs measured 35% of its chunk are
the 19 locales; same shard layout here), AI panel + `agent-core` + `ai-provider` behind a build-time flag, lazy PresenterView/master view/dialogs.

Blockers found: **none for the build itself.** Findings that matter to the web build:

1. The Vite config has no web concerns yet: no `base: './'`, no manifest/CSP/headers plugin, no module parameter. CONTRACT C3 (`--module slides`) provides them; the entry
   needs a `web/modules/slides/index.html` that imports the bridge before `apps/slides/src/renderer/main.tsx` (as `web/docs/index.html` does).
2. TTF faces are emitted into `assets/`; the Docs `fontBuildOptions` (`fonts/` dir, never inline) and `woff2FontsPlugin` must apply, with the WOFF2 twins.
3. `main.tsx` reads `?mode=audience` and Ribbon reads `?mode=tab` from `window.location.search`; the frame URL is `/office-frame/<module>/<version>/index.html`, so either the host
   appends the query or the bridge must set the equivalent through `capabilities.platform` (preferred; no per-host URL contract).
4. Engine imports of `node:crypto`/`node:zlib`/`node:fs` must be aliased to browser shims (Vite externalises `node:*` for the browser with a warning and the call then throws at runtime),
   and the free `Buffer` global (22 files in engine/ops/render) must be injected (G3 does it with an esbuild `inject` of `shims/pptx-renderer/buffer.ts`; Vite needs the equivalent plugin).
   `zip.ts:37` needs a **synchronous** SHA-256 (G3 wrote its own); `media-insert.ts:92` needs `deflateSync`. A small audited sync-SHA/deflate dependency or G3's shims.
   The plain build cannot show this class of problem (it compiles, then throws at first `Buffer` use): S2 must include an in-browser smoke of open -> edit -> save.

## 5. Proposed work split for B5 implementation

Order and dependencies: S0 (lane contract, owned by GF/lead) -> S1 -> S2 -> S6; S3, S4, S5, S7 run beside S1/S2 once S0 lands. Effort ratings follow the brief
(heavy = opus-5-5 medium; light = sonnet-5-5 high).

<!-- prettier-ignore-start -->
| id | item | scope | rating | depends on |
| --- | --- | --- | --- | --- |
| S0 | Consume CONTRACT C1-C5 (module param in protocol/build/manifest/pin/sync/flag) and decide the open questions of section 6 | lead/GF; B5 only reads | n/a | - |
| S1a | **Session core extraction** (critical path): move `Session`, history, `sessionTxn`/`journaledTxn`, `rebuildSlide`/`buildAllRenderSlides` and the ~110 pure handlers out of `slides-main.ts`/`session-state.ts` into an environment-neutral module (e.g. `packages/slides-session` or `apps/slides/src/session`) exposing a handler registry `(session, ...args) => result` and an event sink (`deck-changed`, `history-changed`). Electron main becomes an adapter (`ipcMain.handle(ch, (e,...a) => registry[ch](sessionFor(e), ...a))`) so desktop behaviour is byte-identical. Add the characterisation harness first (no test imports `slides-main.ts` today). | heavy | - |
| S1b | The ~30 handlers that touch Electron/Node behind a `HostIO` interface (`pickImage`, `pickMedia`, `confirm`, `clipboard.*`, `recent`, `saveTarget`, `readMediaPoster`): Electron implements it with `dialog`/`clipboard`/`nativeImage`; web implements it with file inputs, Clipboard API, canvas, in-frame dialogs. Includes `getMediaData` -> blob URL and the `edit-chart` confirm | heavy | S1a |
| S2 | **Web module** `web/modules/slides/` (CONTRACT C2): `index.html`, entry, `createWebSlidesApi` (open/save/saveAs/recents/rename/close-save/`onMenuCommand` host mapping, events, dirty), browser pieces (zip export, in-frame PDF writer, srcdoc print, file pickers), presenter-in-frame, `SlidesCapabilities` + `webCapabilities`, typed stubs for the 48 hidden methods (compile-time `satisfies Record<keyof SlidesApi, ...>` so a new preload method fails the build), node shims (crypto, zlib, fs, `Buffer`), canvas `FontMetricsProvider`, reuse of Docs bridge pieces after the C2 extraction (appearance, attachments, ai/hide stubs, project-memory, guardedOpen, FramePort) | heavy | S1a, S1b |
| S3 | **Renderer retrofit** (`apps/slides/src/renderer`): `cap()` helper + gating at the sites in 1.6; web mode instead of `?mode=tab` (no window controls/vibrancy); macOS fullscreen gate (`SlideShowView.tsx:185`, `PresenterView.tsx:179`); web-only strings (conflict dialog `appWebConflict*`, fatal-open, AI-unavailable) in zh + every sibling i18n shard; theme-token compliance for any new CSS (CLAUDE.md theming rules; `tools/check-theme-colors.mjs`); read-only stance (or host fallback) | medium-heavy (many small edits across `App.tsx` 4k+ lines) | S0 |
| S4 | **Fonts and metrics**: canvas `FontMetricsProvider` + `HeuristicMetrics` fallback and its fidelity check against desktop `RenderSlide` output on the fixture decks; WOFF2 twins for Carlito (+ Liberation/Caladea decision); `@font-face`/`fonts/` build wiring; embedded fonts via `FontFace`; measurement of drift | medium | S1a (provider seam) |
| S5 | **Build/CSP** (with GF's C3): `build:web --module slides`, `csp.json` with the single `media-src blob:` delta and its reasoning in the file header, `headers.json`, manifest `module: 'slides'`, size budget and tree-shaking of AI/i18n, never-inline for images (3.6) | light-medium | S0 |
| S6 | **Tests**: bridge contract tests (jsdom, like `web/docs/bridge/*.test.ts`: every `SlidesApi` key present, save/conflict mapping, export zip, print doc), engine session tests in the frame, **Playwright on the production build under the exact CSP header** (open fixture pptx, edit text, undo, save, conflict, export zip + PDF, present fullscreen, print, media play, no `securitypolicyviolation`), then tester_visual (vi + en, light + dark) | medium | S2, S3 |
| S7 | **dev-uniwork host** (generic after C4): `office_slides_web` flag, pptx routing in `OfficeModuleOpenSwitch`, fallback to `PptxOfficeEditorHost` when the bundle is not installed/verified, flag off, or `writable:false`; pin/sync for `slides`; iframe attributes unchanged (probe 3.7) | light | C4 |
<!-- prettier-ignore-end -->

Suggested first dispatches once the lead agrees: S1a alone (long, blocks S2); S5 + S4's provider spike in parallel (independent of S1); S3 after S1a's capability
shape is fixed.

## 6. Open questions for the lead / owner

1. **Read-only documents**: host falls back to G3 for `writable:false` (recommended, zero Slides work) or build a read-only mode into the Slides renderer?
2. **Comment author**: additive `InitPayload.user.displayName` or the generic "User" label? (the name is persisted into the pptx).
3. **Draft recovery**: accept the loss versus G3's `draft-store` (as Docs did) or schedule an IndexedDB draft?
4. **Second-screen audience window**: confirm v1 = single-screen presenter in the frame; v2 candidate (BroadcastChannel popup vs Window Management API).
5. **External linked media**: confirm hidden (poster only).
6. **Server-side deck PDF**: confirm client-side image PDF is enough (it equals the desktop output: image per page); a print-quality server render would need a Slides headless entry.
7. **Font set**: bundle only Carlito (as desktop) or also Liberation/Caladea twins for metric-compatible Arial/Times/Cambria?
8. **Engine thread**: main thread (no CSP change) or a `'self'` worker file (smoother for large decks, one extra file in the manifest). No `blob:` worker.
9. **Session core home**: new `packages/slides-session` (needs the `externalizeDepsPlugin` exclude per CLAUDE.md build gotchas) or `apps/slides/src/session` shared by both builds?

## How to reproduce

```sh
# call-site table (python, reads apps/slides/src/preload/index.ts; greps renderer + packages/ui)
python3 -I calls.py calls.json && python3 -I calls2.py calls.json       # scratch scripts, not committed
grep -cE "ipcMain\.(handle|on)\(" apps/slides/src/main/*.ts              # 140 / 17 / 7 / 5
# build (section 4)
cd apps/slides && flock /home/ubuntu/.uniwork-lane-build.lock npx vite build --config vite.renderer.config.ts --outDir <scratch>/slides-dist --emptyOutDir
# engine bundle size
NODE_PATH=$PWD/node_modules flock /home/ubuntu/.uniwork-lane-build.lock npx esbuild <entry exporting pptx-engine, pptx-ops, pptx-render, opentype.js> \
  --bundle --minify --format=esm --platform=browser --external:node:crypto --external:node:zlib --external:node:fs --external:node:stream/promises '--external:*?raw'
# CSP probe: static server sending the Docs CSP on frame.html, Playwright chromium, page script exercising srcdoc iframe, media data/blob/remote, workers, fetch(data:), wasm, eval, fullscreen
```
