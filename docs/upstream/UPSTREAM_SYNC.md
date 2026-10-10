# Upstream sync

UniWork Office is a long-lived fork of GenOffice with no shared git history: upstream changes arrive as a patch and the
UniWork brand is re-applied by script. Nothing is merged automatically; the weekly sync workflow only opens a pull request.

## Remotes

| Remote         | URL                                              | Role                          |
| -------------- | ------------------------------------------------ | ----------------------------- |
| `upstream`     | https://github.com/genspark-ai/genoffice.git     | Official GenOffice repository |
| `origin`       | https://github.com/UNIAI-TEAM/uniwork-office.git | UniWork-controlled fork       |
| Default branch | `main`                                           | Both remotes                  |

## One-time setup

```bash
git clone https://github.com/UNIAI-TEAM/uniwork-office.git
cd uniwork-office
git remote add upstream https://github.com/genspark-ai/genoffice.git   # already present on this clone
git fetch upstream
git branch -vv
```

## Sync procedure

Use `tools/rebrand/sync-upstream.mjs`; [`tools/rebrand/README.md`](../../tools/rebrand/README.md) ("Sync with upstream")
documents the commands, the dry run, the exit codes, the report and the weekly workflow.

```bash
node tools/rebrand/sync-upstream.mjs --dry-run   # preview against the upstream head
node tools/rebrand/sync-upstream.mjs             # branch upstream-sync/<sha>: patch, rebrand, UPSTREAM_BASE bump, checks
# resolve conflicts if it stops (exit 2), `git add`, then:
node tools/rebrand/sync-upstream.mjs --continue
npm run typecheck && npm run lint && npm test && npm run build:all
```

`git merge upstream/main` and `git cherry-pick` do not work here: the histories are unrelated. To absorb upstream only up to
a given commit (for example a release tag), run the script with `--to <sha|tag>`; the next sync starts from there.

## Conflict handling

Treat these as **expected conflict areas**. Prefer UniWork display strings and identifiers; prefer upstream engine/behavior:

- `README.md`, `docs/i18n/README.*.md`, `NOTICE`
- `apps/shell/package.json` `productName` / `homepage` / `desktopName`
- `apps/shell/electron-builder.cjs` (`appId`, `productName`, `artifactName`, maintainer)
- `apps/shell/src/renderer/src/strings.ts` (English product copy)
- `apps/shell/src/renderer/src/assets/`
- `packages/electron-utils/src/github-menu.ts`
- `docs/go1/**` (ours; keep)

## How to avoid overwriting UniWork branding

- Do not `git merge -X theirs upstream/main`
- After every sync, `npm run check:brand` must be clean (the script runs it and lists violations in its report)
- Keep `@genoffice/*` package names and `GENOFFICE_*` env vars unless a future phase has a migration plan
- Keep `docs/go1/` and `docs/upstream/` as UniWork-owned documentation

## Sheets wasm engine (fork delta, UNI-1016)

The Sheets web frame runs `apps/sheets/native/xlsx-engine` compiled to WebAssembly. That delta must survive every
upstream sync. Details and the full list are in [`SHEETS_WASM_ENGINE.md`](SHEETS_WASM_ENGINE.md). In short:

- Upstream's sidecar sources keep their desktop behaviour. Every web change sits behind `cfg(target_os = "wasi")`
  (or a `cfg!(target_os = "wasi")` guard) in `src/lib.rs`, `src/main.rs`, `src/worksheet.rs` and `src/archive.rs`.
  When a sync conflicts in those files, take upstream's code and re-apply the wasi blocks. Never delete them.
- `apps/sheets/native/xlsx-engine/wasm/` is UniWork-owned (ours; keep).
- After a sync that touches the engine, run `node apps/sheets/native/xlsx-engine/wasm/build-wasm.mjs`. A checksum
  mismatch is expected when upstream changed the engine: check the web tests, then `--update-checksum` and commit.

## Web module refactors (fork delta, UNI-1014 / UNI-1015 / UNI-1016)

The web module frames (`web/`, see [`web/modules/README.md`](../../web/modules/README.md)) reuse the desktop renderers and
the desktop engines. To do that the lane moved or wrapped code inside upstream's files. The sync is patch based, so an
upstream patch against a moved block does not apply: this section is the map. In every case the rule is the same:
**keep the desktop behaviour upstream's patch intends, apply it at the new location**. After any conflict in these
areas, run the check listed in the item.

### Slides: the session core left `slides-main.ts` (UNI-1015)

`apps/slides/src/main/slides-main.ts` was ~5 270 lines and is now ~2 000: the IPC handlers that work on a document
session moved to `apps/slides/src/session/` (no Electron imports), and `slides-main.ts` registers them in a loop.

| What upstream's `slides-main.ts` handled                                           | Where it lives now                                                   |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| text edits, find/replace, raw txn, edit script                                     | `session/handlers/text.ts`                                           |
| shape/element geometry, fill/stroke, z-order                                       | `session/handlers/elements.ts` (+ `session/fill.ts`)                 |
| tables, charts, SmartArt                                                           | `session/handlers/tables-charts.ts`                                  |
| pictures, picture/background fills, ink, media                                     | `session/handlers/pictures-media.ts`                                 |
| slide-level ops: new deck, add/move/delete, layouts, size, transitions, animations | `session/handlers/slides.ts`                                         |
| in-app clipboard and system clipboard probes                                       | `session/handlers/clipboard.ts` (+ `session/app-clipboard.ts`)       |
| master edit view                                                                   | `session/handlers/master.ts`                                         |
| links, header/footer, themes, notes, comments, sections                            | `session/handlers/document.ts`                                       |
| history batches, undo/redo, dirty, save, save as                                   | `session/handlers/history-save.ts`                                   |
| open pipeline, session state, render and txn helpers                               | `session/open.ts`, `state.ts`, `render.ts`, `txn.ts`, `apply-txn.ts` |

Everything the handlers need from the platform is `HostIO` (`session/host-io.ts`): file and picture pickers, message
boxes, the system clipboard, recent files, the save target. Electron implements it in `main/electron-host-io.ts`; the
web frame in `web/modules/slides/web-host-io.ts`; `session/memory-host-io.ts` is the test double. `main/session-state.ts`
is a thin re-export of `session/state.ts` plus the Electron-only parts. What stays in `slides-main.ts`: window and menu
wiring, fonts, AI and attachments, cloud page generation, PDF/print/presenter windows, the `slides:open*` entry points,
recent files, and the loop that registers `sessionHandlers` with `ipcMain.handle`.

**Resolving a conflict.** An upstream patch that edits a `ipcMain.handle('slides:x', ...)` body which is no longer in
`slides-main.ts` fails to apply (or lands as a "did not apply" file in the sync report). Find the channel with
`grep -rn "'slides:x'" apps/slides/src/session`, apply the same edit to that handler (replace direct `dialog` /
`clipboard` / `fs` calls by the matching `ctx.host.*` method, add one to `HostIO` and to all three implementations if
upstream needs a new platform call), and keep `ctx.clientId` where upstream used `e.sender.id`. A new upstream channel
that works on the session goes into the matching `handlers/*.ts` object (the registry type-checks the
`slides:` key); one that does not (window/menu/OS) stays in `slides-main.ts`. Run
`npx vitest run apps/slides/tests` (the characterisation harness `tests/helpers/slides-ipc-harness.ts` and its trace
snapshot `session-characterisation.trace.json` pin the channel behaviour: a changed trace is either an upstream
behaviour change to accept with `-u`, or a moved-handler mistake). `session-registry-guard.test.ts` fails when
a channel the registry serves is registered again in `slides-main.ts`.

### PDF: the save core has platform seams (UNI-1014)

The save pipeline (`save-pdf.ts`, `text-edit.ts`, `image-edit.ts`, `font-subset.ts`, `annot-delete.ts`) is bytes in, bytes
out. Its platform needs are behind `apps/pdf/src/main/core-env.ts` (`pdfCoreEnv()`: pdfium and hb-subset wasm bytes,
font files, system font lookup, image codec). Desktop installs `node-env.ts` + `electron-image.ts` from `pdf-main.ts`
(`installNodePdfEnv({ image: electronImageCodec })`); the web frame installs `web/modules/pdf/core-env-web.ts`.

- `savePdfToPath` moved to `save-pdf-file.ts`: it reads the file, calls `applyAndVerifySaveRequest` (new, in
  `save-pdf.ts`: apply + read-back verification, no I/O) and writes atomically. Behaviour is unchanged.
- Direct `readFileSync` / `pdfiumWasmPath()` / `findSystemFont` / `findFontCovering` calls in `text-edit.ts`,
  `image-edit.ts`, `font-subset.ts` became `pdfCoreEnv().…` calls; `nativeImage` use in `image-edit.ts` became
  `pdfCoreEnv().image.decode/encodePng`.
- `signature-store.ts` keeps the file I/O; the list rules (validation, cap, dedupe) are `shared/signature-list.ts`.

**Resolving a conflict.** Take upstream's logic and re-express its Node/Electron calls through the seam: a new
`readFileSync` or font lookup in the core becomes a `PdfCoreEnv` member (add it to `core-env.ts`, `node-env.ts` and
`web/modules/pdf/core-env-web.ts`); a new `nativeImage` call becomes an `image` codec method. A patch to
`savePdfToPath` applies to `save-pdf-file.ts` (I/O) or to `applyAndVerifySaveRequest` (logic). Check:
`npx vitest run apps/pdf/tests/save-pdf.test.ts web/modules/pdf` (`save-core.golden.test.ts` pins the saved bytes; a
changed golden is an upstream change to accept deliberately).

### Markdown: raw HTML is kept verbatim, diagrams go through `<img>` (UNI-1014, desktop-visible)

This is the one lane change that alters desktop behaviour on purpose (review finding RF-11, accepted by the lead):

- `editor/rawHtml.ts` (new, "option C"): block HTML becomes the atom `rawHtmlBlock`, inline HTML text with the
  `rawHtmlInline` mark; the exact source is serialized back and shown as escaped text, never rendered. Upstream
  degraded raw HTML through the schema on the first save. Registered in `editor/extensions.ts`; `editor/ops.ts`,
  `export/docxExport.ts` (`degradeRawHtml`: Word export still degrades through the schema) and `export/printHtml.ts`
  (`.md-raw-html` styles, comments dropped from print) know about it.
- `editor/diagrams.ts` `diagramSvgDataUrl()` + `CodeBlockView.tsx`: a rendered Mermaid SVG is shown as
  `<img src="data:image/svg+xml,…">` instead of being injected as markup.
- Tests changed with it: `apps/markdown/tests/markdown-nodes.test.ts`, `entities-inline-html.test.ts`, new
  `raw-html-fidelity.test.ts` and `fixtures/raw-html.md.txt`.

**Resolving a conflict.** Upstream edits to HTML handling in `extensions.ts` / `inlineTokens.ts` / `docText` and its
tests: keep our `rawHtml` nodes registered before upstream's HTML handling and re-run `raw-html-fidelity.test.ts`;
if an upstream test now expects degraded HTML, the expectation is the one to change (document it in
`docs/web-modules/markdown-html.md`). Upstream code that injects an SVG with `innerHTML`/`dangerouslySetInnerHTML`
must be routed through `diagramSvgDataUrl`: the web frame is same-origin with the host app, so no raw HTML sink may
come back. `npm run check:english-comments` and `tools/check-theme-colors.mjs` apply as always.

### Renderer capability gating (`cap()`), per app (UNI-1014/1015/1016)

`packages/ui/src/capabilities.ts` (`createCapabilityReader`) and one `apps/<app>/src/renderer/capabilities.ts` per app.
Entries that the web hides (AI, autosave, open from disk, native-only operations) are wrapped in `cap('key')` where they
render; the desktop leaves `<global>.capabilities` unset, so every `cap()` is true there. Touched renderer files:

| App      | Files                                                                                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| markdown | `App.tsx`, `components/Ribbon.tsx`, `ai/AiPanel.tsx`                                                                                                            |
| html     | `App.tsx`, `components/Ribbon.tsx`, `components/Breadcrumb.tsx`, `source/SourceEditor.tsx`, `preview/PreviewFrame.tsx` (+ `preview/inspector-validate.ts`)      |
| pdf      | `App.tsx`, `SignatureDialog.tsx`, `edit-ops/ops.ts`                                                                                                             |
| slides   | `App.tsx`, `components/Ribbon.tsx`, `RibbonHomeTab.tsx`, `RibbonInsertTab.tsx`, `PresenterView.tsx`, `AudienceView.tsx`, `SlideShowView.tsx`, `file-actions.ts` |
| sheets   | `App.tsx`, `ExcelShell.tsx`, `univer-sync.ts`, `save-actions.ts`, `view-only-guard.ts`, `web-engine.ts`, `EngineUnavailableScreen.tsx`, `main.tsx`              |
| docs     | `ai/AiPanel.tsx` (the rest is the B2/B3 pattern, unchanged)                                                                                                     |

**Resolving a conflict.** Upstream adds or moves a ribbon button, menu entry, dialog or timer in one of these files:
take upstream's markup and wrap the new entry in `cap('<key>')` with the key of the sibling it belongs to (AI entries
`ai`, autosave `autoSave`/`autoSaveToDisk`, anything that needs the file system or an OS engine the matching
`*Capability` union key; add a key to the app's `capabilities.ts` union and to the web defaults in
`web/modules/shared/capabilities.ts` / `web/modules/<m>/install.ts` when it must be hidden). Forgetting the wrapper is
silent on the desktop and shows a dead button on the web: `npx vitest run apps/slides/tests apps/markdown/tests apps/html/tests apps/sheets/tests/web-capabilities.test.ts`
and the modules smoke e2e (`web/e2e/modules-smoke.spec.ts`) catch the common cases.

### HTML preview: sandboxed preview frame (UNI-1014)

`apps/html/src/renderer/preview/PreviewFrame.tsx` posts the page to a sandboxed `preview.html` over a `MessagePort`
when `htmlApi.getPreviewInfo` names one (the web frame; on the desktop it keeps the Electron path), and
`preview/inspector-validate.ts` is the strict parser for inspector messages that the desktop listener also uses.
**Resolving a conflict:** keep the port branch and the validator; upstream changes to the inspector protocol need the
same change in `inspector.js` and `inspector-validate.ts`. Check: `npx vitest run apps/html/tests` and
`web/e2e/html-preview-security.spec.ts`.

### Web frames (`web/`) are UniWork-owned

`web/` (protocol, bridge, build registry, modules, test host, e2e) has no upstream counterpart: `docs/web-modules/` and
`web/modules/README.md` describe it. Upstream changes to the renderers it hosts surface as type errors in
`npm run typecheck:web` (the bridges are `satisfies` against the preload contracts, so a new preload method is a compile
error until the web API implements or hides it): implement it in the module's `webapi.ts` / `bridge.ts` or turn the
capability off in `install.ts`. `ci.yml`'s `web-e2e` job runs the browser proofs on production bundles.

### Sync checklist for the web delta

1. `npm run typecheck && npm run typecheck:web && npm test && npm run test:web`.
2. `npm run build:web -- --all`, then `WEB_E2E_REQUIRE_BUILD=1 npx playwright test -c web/e2e html-preview-security draft-recovery slides-presenter ai-web modules-smoke docs-web`.
3. `node tools/check-theme-colors.mjs --base origin/main`, `npm run check:english-comments`.
4. Sheets engine: the steps above in "After an upstream sync".
