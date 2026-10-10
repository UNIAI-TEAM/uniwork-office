# Sheets web module (UNI-1016, GO-B6, workers SH1 + SH2)

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

## SH2: the WASM engine (GO-D3 = C, CONTRACT C11)

The frame now ships its engine: `install.ts` installs `createWasmTransport` over a module Worker, in place of the
engine-unavailable stub.

| Piece                       | Where                                                                                                        | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine build                | `apps/sheets/native/xlsx-engine/wasm/`                                                                       | cdylib reactor over the unchanged sidecar sources (wasi-only `cfg` blocks, see `docs/upstream/SHEETS_WASM_ENGINE.md`). `build-wasm.mjs` uses the pinned toolchain (`rust-toolchain.toml`: 1.90.0 + wasm32-wasip1), a vendored zip 0.6.6 without C features, a staging path derived from the input hash, and remapped paths, and is verified against `xlsx-sidecar.wasm.sha256`. **Reproducible:** a copy of the crate at a different path with a fresh target dir built the identical module (`5587565a…`, 5 070 855 bytes). |
| Why build instead of commit |                                                                                                              | The fork CI never runs `build:web` and has no wasm target. `build:web --module sheets` runs `build-wasm.mjs` as its prebuild step, which compiles the module or reuses a cached one whose inputs are unchanged, then verifies the checksum. `WEB_SHEETS_WASM=<file>` supplies a prebuilt module, verified the same way. No binary in git.                                                                                                                                                                                    |
| Bundle                      | `assets/xlsx-sidecar-*.wasm` (5.07 MB, 1.70 MB gzip), `assets/engine.worker-*.js` (26 kB)                    | hashed files in the manifest; the Worker is a same-origin file (worker-src `'self'`, no `blob:`); `csp.json` adds `script-src 'wasm-unsafe-eval'` (sheets + pdf only), also sent on `/assets/**` for the Worker                                                                                                                                                                                                                                                                                                              |
| Engine host                 | `engine/host.ts`                                                                                             | the reactor on `@bjorn3/browser_wasi_shim` 0.4.2 (pinned) with an in-memory `/tmp`; two shim fixes: geometric file growth, and a directory removal that clears the contents (the shim's readdir skipped entries deleted during iteration, so `close` failed with ENOTEMPTY)                                                                                                                                                                                                                                                  |
| Transport                   | `engine/wasm-transport.ts`, `engine/save-plan.ts`, `engine/blank.ts`                                         | sessions, `.xls` via `convert_workbook`, the 40 MB worksheet-XML gate (`too_large`), reads, pivot definitions, save = the desktop `writeWorkbookTo` + `saveWorkbookViaSidecar` mirrored over the session's bytes (gateway planner loaded on the first save, `save_archive`, manifest checks), a 0-byte document opens blank, crash = reconnect                                                                                                                                                                               |
| Bridge additions            | `bridge.ts`                                                                                                  | `too_large` → fatal `error` to the host (GD2 then opens G3); Ctrl/Cmd+S, Shift+S, O, P map to the renderer's File actions (the desktop gets them from its native menu)                                                                                                                                                                                                                                                                                                                                                       |
| Renderer                    | `EngineUnavailableScreen` (`reason: 'too-large'`, shown as an overlay), `no-copilot` shell layout without AI | the grid used to lose its width when the AI dock was not rendered                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Capabilities per decision C: `xlsxEngine`, `xlsImport` and `pivotRefresh` are on (from the transport's features).
`recalcFallback` and `mergeWorkbooks` stay off. `recoveryCopy` is on only as the trigger of the renderer's 30 s
tick that feeds web draft recovery (C18, [draft-recovery.md](draft-recovery.md)); no recovery copy reaches disk or the
server and the desktop recovery dialog stays off.

**First viewport** (incremental index, `docs/web-modules/sheets-probes/results/sh2-incremental-node-shim.json`; frame
engine code in Node + the shim):

| rows × 22 (cells, file) | first viewport before → after | open + first viewport before → after | background index, total (longest pass) |
| ----------------------- | ----------------------------- | ------------------------------------ | -------------------------------------- |
| 10k (0.22M, 1.0 MB)     | 559 → 120 ms                  | 0.8 → 0.48 s                         | 0.8 s (0.46 s)                         |
| 20k (0.44M, 2.0 MB)     | 1 219 → 49 ms                 | 1.7 → 0.61 s                         | 1.9 s (0.94 s)                         |
| 50k (1.1M, 5.1 MB)      | 2 864 → 29 ms                 | 3.9 → 1.08 s                         | 3.5 s (2.4 s)                          |
| 100k (2.2M, 10.3 MB)    | 4 924 → 31 ms                 | 6.7 → 2.33 s                         | 9.5 s (5.3 s)                          |

"Before" is the SH1 Chromium probe. A read far below the indexed rows waits for at most one pass. Gates (lead-confirmed): host 10 MB stored, frame 80 MB of
worksheet XML (`MAX_WORKSHEET_XML_BYTES`). Chromium, production build, from page load: 20k / 50k / 100k rows usable
after 4.1 / 4.3 / 5.1 s (`sheets-sidecar.md` 4.5.3).

**Tests (SH2):**

- `web/modules/sheets/engine/wasm-transport.test.ts`: mocked channel (gate, crash/reconnect, features), plus the
  real engine in Node (open, read, value + formula save, reopen, `.xls`, incremental index exactly-once formulas,
  deep read, close).
- `bridge.test.ts`: plus too_large and the accelerators. `npx vitest run --root web/modules`: 38 passed.
- `cargo +1.90.0 test` (desktop): 186 + 6 passed, unchanged.
- `web/e2e/sheets.spec.ts`: 13 passed (incl. 3 Chromium timing runs) on the production build:
  - fixtures: edit, kitchen sink, structure;
  - 20k × 22: open, scroll, value + formula, Ctrl+S, bytes at the host, reopened session shows the edit;
  - conflict → Overwrite; `.xls` (vi, dark); view-only (vi, light); too_large (en light, vi dark); blank workbook;
  - 0 console errors, 0 page errors, 0 failed requests, 0 CSP violations.

  Screenshots are in `docs/web-modules/screenshots/sheets/`.

**Open at the end of SH2 (all three closed by SH3, below):** a formula typed into a streamed workbook showed blank after
the reopen; view-only did not lock the grid; a Rust panic lost the open sessions.

## SH3: follow-ups

| item                   | what changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cached formula values  | `engine/cached-values.ts` + `serialize` in `engine/wasm-transport.ts`. At save time the transport sends the save's pending cell edits (formulas verbatim, as the renderer's `toRecalcUserInput`) to the engine's `recalc_cells` (IronCalc) and reads back the typed formula cells; the results go to the gateway as `formulaValues`, which writes `<v>` next to the untouched `<f>`. Only on an explicit save (C10); the UI recalc fallback stays hidden (C11, `features.recalcFallback` false).                                                                                                                                                                                                       |
| View-only grid lock    | `apps/sheets/src/renderer/view-only-guard.ts`: a `BeforeCommandExecute` guard that cancels every command the sheet-protection guard knows (edits, formats, rows/columns, sort/filter) and the sheet-tab commands (insert, remove, copy, rename, reorder, tab colour). Loader writes run under `journalSuppression` and pass, so streamed rows still land. The user gets the `appWebViewOnly` toast (at most every 3 s). **Not `FWorkbook.setEditable(false)`**: Univer enforces that permission on every SetRangeValues command, the loader's own streamed-row writes included, and answers each refused edit with its own modal "no permission" dialog (the e2e hit it: the dialog covered the page). |
| Wasm panic recovery    | `createWasmTransport` keeps each session's last opened/saved bytes. An `engine_crashed` call disposes the Worker, starts a fresh engine and reopens every session from those bytes under the **same renderer-facing session id** (the engine's own id is swapped inside `call`); reads are repeated once, other commands report the crash and the next one works. `onRecovered` -> `notifyEngineRecovered` -> a toast (`appWebEngineRestarted`, 21 locales).                                                                                                                                                                                                                                           |
| Carlito `?url` imports | `woff2FontsPlugin.resolveId` maps `@genoffice/ui/fonts/<Face>.ttf?url` to the WOFF2 twin in `web/docs/fonts/`; `fontBuildOptions` then emits it under `fonts/` and never inlines it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Notes:

- The recalc covers the cells the user typed, not their dependents: a formula elsewhere in the file that depends on an
  edited value keeps its old cached `<v>` until the next engine/Univer evaluation (as before this change).
- The save skips the recalc, and saves the formulas without cached values, when: a structural or sheet-tab change is
  pending (file coordinates no longer match), a sheet added this session is referenced, the file is above 64 MB, more
  than 10 000 edits are pending, or IronCalc cannot import the workbook (its importer is strict; the engine answers
  `workbook_error`). A panic inside that recalc (no unwinding on wasip1) triggers the recovery above, the save goes on, and
  that session never asks the formula engine again.
- Recovery keeps the renderer's unsaved edits: the edit journal lives in the renderer, not in the engine, and the next
  save applies it over the reopened session. The toast says so. Draft recovery (DR1) remains the safety net for the page
  itself.
- A workbook that crashes the engine again while it is being reopened is dropped (no loop): the next read answers
  `Unknown workbook session`.

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

View-only locks the grid too (SH3, `view-only-guard.ts`): the e2e types into a view-only frame, the host hears of no pending
edit, and scrolling still streams rows.

## Sizes (`npm run build:web -- --module sheets`)

| build                                 | files | total raw / gzip (MiB) | initial raw / gzip (MiB) |
| ------------------------------------- | ----- | ---------------------- | ------------------------ |
| GF scaffold (7f96156)                 | 206   | 21.44 / 6.05           | 10.44 / 2.91             |
| this lane (604ad69 + the `App` split) | 208   | 21.49 / 6.08           | **2.46 / 0.66**          |

- The cut: `main.tsx` imports `App` (and with it Univer, 8.4 MB / 2.37 MB gzip) dynamically, in parallel with the
  cell fonts. A frame without an engine never downloads it (the e2e asserts this).
- What is left in the initial chunk is essentially the 21-locale string tables (`i18n/`, about 2.4 MB of source).
  Splitting them per locale needs an async `t()` bootstrap. That is the next cut, not done here.
- Fonts: the CSS faces come out as WOFF2, and since SH3 so do the two Carlito `?url` imports of
  `cell-font-fallback.ts` (canvas FontFace API): `woff2FontsPlugin.resolveId` maps `@genoffice/ui/fonts/<Face>.ttf?url`
  to the twin in `web/docs/fonts/`, so no TTF is emitted any more (the CSS faces and the JS imports share the same hashed
  files). Carlito Regular + Bold: 1 317 952 bytes of TTF -> 389 072 bytes of WOFF2 (-928 880 bytes, -70 %); the sheets bundle
  is 219 files, 26.63 MiB raw / 7.59 gzip, initial 3.13 MiB / 0.84 gzip (unchanged), and `manifest.json` lists no `.ttf`.
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
- SH3 (`engine/wasm-transport.test.ts`, 16 tests incl. the real engine): the cached-value plan and mapping; a formula
  typed at row 19 990 of a 20k-row workbook saved with its `<v>` and read back after the session swap; injected panics
  (a read repeated after the recovery, a panic while saving, a panic in the cached-value recalc, a workbook that crashes
  again on reopen); `notice.test.ts` (the recovery toast); `apps/sheets/tests/view-only-guard.test.ts` (the lock);
  `web/docs/build/fonts-woff2.test.ts` (the `?url` twin). e2e (14 passed on the production build): a formula typed
  at W15000 of the 20k workbook, saved with Ctrl+S, reopened by the host: `<v>1705</v>` in the file and the cell shown
  in the grid (`formula-cached-reopen-en-light.png`); the view-only frame types into the grid, the host hears no
  pending edit, the user gets the toast, scrolling still streams rows (`view-only-scrolled-vi-light.png`). The e2e
  helper now finds Univer's Name Box by `[data-u-comp="defined-name"] input` (its input has no accessible label on this
  Univer) and goes through another cell first (a jump to the already active cell leaves the focus in the box).
- `web/e2e/sheets.spec.ts` (5, Playwright, test host `?module=sheets`):
  - the engine-unavailable screen in en/vi × light/dark: styled card, theme-legible text, the host gets one non-fatal
    `unsupported`, no grid chunk fetched;
  - view-only from `readonly=1` and a live theme switch;
  - 0 console errors, 0 page errors, 0 failed requests, 0 CSP violations.

  Screenshots: `docs/web-modules/screenshots/sheets/engine-unavailable-{en,vi}-{light,dark}.png`.

## Open items

- Cached values cover the formulas the user typed; dependents of an edited value keep their old cached `<v>` until the
  next evaluation (see SH3 notes).
- Recovery from a panic keeps the renderer's unsaved edits, but a panic inside IronCalc's importer for the cached-value
  recalc means that session saves without cached values from then on (and one toast).
- Host side (dev-uniwork, GD): decide what the host does with the frame's non-fatal `unsupported` error while
  `xlsxEngine` is off. Contract C4 already keeps G3 while `office_sheets_web` is off.
- Build framework (GF): a per-locale string split for every module's initial chunk.
- `apps/sheets` `tsc --noEmit` reported 3 errors that predate this lane (`src/main/sheets-main.ts` AiSettings
  `provider` typing, `packages/ai-provider/src/openrouter.ts`). This branch does not touch those files.
