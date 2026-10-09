# Sheets web module (UNI-1016, GO-B6, worker SH1)

The Sheets frame without its engine. GO-D3 = **C** (CONTRACT C11): the xlsx engine runs as WASM in a Web Worker of
this frame. Building that backend is the follow-up **SH2**. Everything that does not depend on it is here, so SH2 only
has to implement one interface. The measurements and the decision are in `sheets-sidecar.md` (browser numbers and the
proposed size cap in section 4.5).

## What ships

| Piece                    | Where                                                  | What it does                                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine seam              | `web/modules/sheets/engine/transport.ts`               | `SheetsEngineTransport`, the renderer-facing session API: `open` (bytes), `readRange`, `readFormulaCells`, `readMedia`, `readPivotDefinition`, `recalc`, `serialize` (save → bytes), `replaceSession` (post-save session swap), `close`, optional `findCells` / `readRowOutline`, `features` |
| Engine stub              | `web/modules/sheets/engine/unavailable.ts`             | every call rejects `EngineUnavailableError` (code `engine-unavailable`); `close` is a no-op                                                                                                                                                                                                  |
| Bridge                   | `web/modules/sheets/bridge.ts`                         | `window.desktopApi` over the protocol and the seam (table below)                                                                                                                                                                                                                             |
| Capabilities             | `web/modules/sheets/capabilities.ts`                   | web defaults + host grants → the renderer's keys                                                                                                                                                                                                                                             |
| Dialogs                  | `web/modules/sheets/notice.ts`                         | save conflict and "discard unsaved changes?", built from the Sheets dialog classes, Sheets i18n                                                                                                                                                                                              |
| Installer                | `web/modules/sheets/install.ts`                        | `installModuleBridge` with the stub engine                                                                                                                                                                                                                                                   |
| Renderer gating          | `apps/sheets/src/renderer/capabilities.ts` (`cap()`)   | read through `@genoffice/ui/capabilities`; the desktop sets nothing, so everything stays on there                                                                                                                                                                                            |
| Engine-unavailable state | `apps/sheets/src/renderer/EngineUnavailableScreen.tsx` | full-window card, tokens only, 21 locales (`appWeb*` keys). Shown by `main.tsx` when `cap('xlsxEngine')` is false (the grid chunk is never loaded) and by `App` when an open fails with `engine-unavailable`                                                                                 |

### For SH2: plugging in the WASM engine

1. Implement `SheetsEngineTransport` with `kind: 'wasm'` and honest `features`. This means:
   - a module Worker from the bundle (`worker-src 'self'`, no blob: worker) running the xlsx-engine `wasm32-wasip1`
     build behind a cargo feature/cfg (C11);
   - the main-process session and save logic of `apps/sheets/src/main/sheets-main.ts` ported into the frame: session
     map and sheet names, `writeWorkbookTo` sheet-op resolution, the gateway planner (`saveWorkbookViaSidecar`) over an
     in-memory `ArchiveClient`.

   `serialize` must not touch the session. `replaceSession` closes the old session and opens the saved bytes.

2. In `install.ts`, replace `createUnavailableTransport()` with it.
3. Add `script-src 'wasm-unsafe-eval'` to the sheets entry of `web/docs/build/modules.ts` (C11: sheets + pdf only),
   with `alsoOn: ['/assets/**']` for the Worker script.
4. Nothing else changes. `sheetsWebCapabilities` derives `xlsxEngine`, `xlsImport` and `pivotRefresh` from the
   transport. `recalcFallback` and `mergeWorkbooks` stay hidden (C11).

Engine-side items from the measurements:

- the first viewport waits for the inline index (make the index incremental);
- two browser-shim fixes: geometric file growth, and removing non-empty directories on `close`;
- the size gates: host ≤ 5 MB stored, frame ≤ 40 MB of worksheet XML, until the index is incremental.

## Bridge mapping (`window.desktopApi`, 64 methods)

| desktopApi                                                                                                                               | web                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hasQueuedWorkbook` / `selectWorkbook`                                                                                                   | boot document: `init.open` or `api.open {documentId}` → `transport.open`. A host `open` request queues the payload and fires the renderer's `open` action. File > Open: `file.pick {accept: xlsx, xlsm[, xls]}` only with the `filePick` grant, asking before discarding unsaved edits |
| `readWorkbookRange` / `readWorkbookFormulas` / `readWorkbookMedia`                                                                       | transport                                                                                                                                                                                                                                                                              |
| `readPivotDefinition` / `recalcWorkbook`                                                                                                 | transport while `pivotRefresh` / `recalcFallback` are on; otherwise rejected (the renderer is already fail-soft)                                                                                                                                                                       |
| `saveWorkbookEdits`                                                                                                                      | `transport.serialize`, then `api.save {fileId, data, etag}` (never `auto`, C10) or `api.saveAs {name, data, sourceFileId}`, then `transport.replaceSession`; `saved` event                                                                                                             |
| save conflict                                                                                                                            | frame save: Overwrite (head etag, save again) / Reload latest (queued `api.open`, renderer `open` action) / Cancel (fails with the localized reason). Host-initiated save: the `conflict` goes into the host's result                                                                  |
| `begin/send/abortSaveEditsTransfer`                                                                                                      | in-frame accumulator, spliced into the next save                                                                                                                                                                                                                                       |
| `closeWorkbook`                                                                                                                          | `transport.close`                                                                                                                                                                                                                                                                      |
| `notifyPendingEdits` / host `doc.closeCheck`                                                                                             | `dirty` event / `{dirty, autoSave: false}`                                                                                                                                                                                                                                             |
| `onCloseSaveRequest` / `reportCloseSaveResult`                                                                                           | host `save` request runs the renderer's full save flow                                                                                                                                                                                                                                 |
| `onMenuAction`                                                                                                                           | host `saveAs` → `save-as`, host `print` → `print` / `export-pdf`, host `open` → `open`                                                                                                                                                                                                 |
| `onWorkbookRenamed`                                                                                                                      | host `file.renamed`                                                                                                                                                                                                                                                                    |
| `printWorkbook` / `exportPdf`                                                                                                            | the renderer's laid-out HTML printed from a hidden `srcdoc` frame (print dialog; no HTML→PDF host route in v1, lane decision B4-5)                                                                                                                                                     |
| `exportCsv`                                                                                                                              | browser download, UTF-8 with BOM                                                                                                                                                                                                                                                       |
| `confirmCsvSave`                                                                                                                         | `'xlsx'`: no CSV sessions in the frame                                                                                                                                                                                                                                                 |
| `openExternal`                                                                                                                           | guarded `window.open` (http/s, noopener)                                                                                                                                                                                                                                               |
| `writeWorkbookRecovery`, `onRecoveryPrompt`, `autoRenameWorkbook`, merge, screenshot, AI family, attachments, headless, `getPathForFile` | typed stubs behind the capability keys                                                                                                                                                                                                                                                 |
| `getTheme` / `getLanguage` / autosave default                                                                                            | shared module members (host-authoritative; autosave pinned off)                                                                                                                                                                                                                        |
| `window.projectApi`                                                                                                                      | the shared in-memory project store (AI-only)                                                                                                                                                                                                                                           |

If the engine is missing, the bridge reports it to the host once: `error {code: 'unsupported', message:
'engine-unavailable: …'}`, non-fatal, because the frame shows its own screen.

## Capability keys

Web defaults: `sheetsWebCapabilities()`. Grants: `sheetsHostGrants()`.

| key                                                                                            | web value                       | hides                                                                                                                                |
| ---------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ai`, `webSearch`, `imageSearch`, `imageGeneration`, `createDocument`, `autoRename`, `billing` | false                           | AI ribbon group, AI dock + its toggle state, ask-AI popover, AI tools                                                                |
| `autoSave`                                                                                     | false (C10)                     | AutoSave pill and its 30 s / blur timer                                                                                              |
| `recoveryCopy`                                                                                 | false (C10, C11)                | 30 s crash-recovery copy                                                                                                             |
| `screenshot`                                                                                   | false                           | Insert > Screenshot                                                                                                                  |
| `open`, `recents`                                                                              | host `filePick`, `recents`      | File > Open via the host picker                                                                                                      |
| `save`, `saveAs`                                                                               | host `save`, `saveAs`           | quick-access Save / Save As. Without `save` the frame is **view-only**: every save path is refused in the renderer and in the bridge |
| `exportCsv`                                                                                    | true                            | (browser download)                                                                                                                   |
| `xlsxEngine`                                                                                   | transport ≠ unavailable         | the whole workbook surface (off: the engine-unavailable screen)                                                                      |
| `xlsImport`, `pivotRefresh`                                                                    | from the transport's `features` | `.xls` in the picker; PivotTable Refresh + Refresh All, and the eager pivot reads                                                    |
| `recalcFallback`, `mergeWorkbooks`                                                             | false (C11)                     | IronCalc recalc fallback; Data > Merge workbooks                                                                                     |

View-only does not yet lock the grid (`FWorkbook.setEditable(false)`). No workbook can load in this build, so the lock
cannot be verified. It belongs to SH2 together with an e2e on a real workbook.

## Sizes (`npm run build:web -- --module sheets`)

| build                                 | files | total raw / gzip (MiB) | initial raw / gzip (MiB) |
| ------------------------------------- | ----- | ---------------------- | ------------------------ |
| GF scaffold (7f96156)                 | 206   | 21.44 / 6.05           | 10.44 / 2.91             |
| this lane (604ad69 + the `App` split) | 208   | 21.49 / 6.08           | **2.46 / 0.66**          |

- The cut: `main.tsx` imports `App` (and with it Univer, 8.4 MB / 2.37 MB gzip) dynamically, in parallel with the
  cell fonts. A frame without an engine never downloads it (the e2e asserts this).
- What is left in the initial chunk is essentially the 21-locale string tables (`i18n/`, about 2.4 MB of source).
  Splitting them per locale needs an async `t()` bootstrap. That is the next cut, not done here.
- Fonts: the CSS faces come out as WOFF2. `cell-font-fallback.ts` imports `Carlito-{Regular,Bold}.ttf?url` for the
  canvas FontFace API, which the CSS-only `woff2FontsPlugin` does not rewrite, so two TTFs (1.3 MB) are still emitted.
  They load only once the grid boots. Proposed fix (build framework, not this lane): map `@genoffice/ui/fonts/*.ttf?url`
  to the WOFF2 twins in the plugin's `resolveId`.
- Web-readiness blockers from `sheets-sidecar.md` section 8: the meta CSP, the absolute `/assets/` base and the TTF
  CSS faces are handled by the module build (header-only CSP, `base: './'`, WOFF2). The missing bridge and the missing
  capability mechanism are added here. The large main chunk is split.

## Tests

- `web/modules/sheets/bridge.test.ts` (27 tests, fake engine transport + the shared mocked protocol port, through
  `installModuleBridge`):
  - capability defaults and grants;
  - boot / `init.open` / picker / host `open`;
  - open → edit → save bytes reach `api.save` with the etag and without `auto`, then the session swap and the next
    save on the new etag;
  - chunked transfers, Save As (named, cancelled), host `save` and `saveAs`;
  - conflict Overwrite / Reload latest / Cancel, and the host-owned conflict;
  - view-only (no engine call, no save request, host `save` forbidden);
  - the engine stub and its one-time host report;
  - hidden recalc and pivot, CSV/print/PDF, stubs, rename, close-check.

  Run: `npx vitest run --root web/modules` (now part of `npm run test:web`).

- `apps/sheets/tests/web-capabilities.test.ts` (3): `cap()` on the desktop and in a frame (grants assigned later are
  seen), and the engine-unavailable detector.
- Affected existing renderer tests, run locally: `save-recovery-mode`, `csv-save-streamed`, `save-error-localization`,
  `recalc-size-gate`, `read-sheet-range-batching`, `univer-range-loading` (52 passed).
- `web/e2e/sheets.spec.ts` (5, Playwright, test host `?module=sheets`):
  - the engine-unavailable screen in en/vi × light/dark: styled card, theme-legible text, the host gets one non-fatal
    `unsupported`, no grid chunk fetched;
  - view-only from `readonly=1` and a live theme switch;
  - 0 console errors, 0 page errors, 0 failed requests, 0 CSP violations.

  Screenshots: `docs/web-modules/screenshots/sheets/engine-unavailable-{en,vi}-{light,dark}.png`.

## Open items

- SH2: the WASM transport (see above), the grid lock for view-only, an e2e on a real workbook (open → edit → save
  through the engine), the incremental index, the two shim fixes, and the size gates (host and frame).
- Host side (dev-uniwork, GD): decide what the host does with the frame's non-fatal `unsupported` error while
  `xlsxEngine` is off. Contract C4 already keeps G3 while `office_sheets_web` is off.
- Build framework (GF): the WOFF2 rewrite for JS `?url` font imports; a per-locale string split for every module's
  initial chunk.
- `apps/sheets` `tsc --noEmit` reports 3 errors that predate this lane (`src/main/sheets-main.ts` AiSettings
  `provider` typing, `packages/ai-provider/src/openrouter.ts`). This branch does not touch those files.
