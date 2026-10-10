# HIDE class: can the renderer hide the desktop-only UI? (UNI-1011 spike, W6)

Scope: every `DesktopApi` method that `web/docs/bridge/hide.ts` turns into a no-op
(31 methods + 3 open-flow defaults that `webapi.ts` overrides), plus the two
AI-class login/billing buttons in `ai.ts`. Paths are relative to
`apps/docs/src/renderer` unless noted. Line numbers are against base `acb932a`.

## Summary

| Result                                                                | Count | Methods                                                                                                                 |
| --------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------- |
| **NO FLAG, visible UI stays** (needs a renderer change)               | 7     | `zoteroCommand`, `setDocPassword`, `openNewTab`, `listDocsTabs`, `focusDocsTab`, `getAutoSaveDefault`, `createDocument` |
| Hidden by the shim return, no change needed                           | 1     | `openDocxDecrypt`                                                                                                       |
| UI stays but degrades harmlessly                                      | 2     | `respellKick`, `getPathForFile`                                                                                         |
| No UI entry, but a behavioural side effect to know about              | 1     | `writeRecoveryCopy`                                                                                                     |
| No UI entry point at all (event wiring / launch handshake / internal) | 20    | rest of the 31                                                                                                          |
| AI class (in `ai.ts`), hidden by the shim return                      | 2     | `aiGskLogin`, `aiOpenBilling`                                                                                           |

**There is no capability or platform flag for any desktop-only feature in the
renderer.** A grep for `isZotero*`, `isElectron`, `desktop.platform`, `import.meta.env`,
`__WEB__` finds nothing relevant. The only `navigator.platform` uses are macOS shortcut
hints (`App.tsx:300`, `components/Ribbon.tsx:318`, `editor/protected-render.ts:88`) and a
Windows spellcheck delay (`App.tsx:1353`).

### The only "flag" mechanism that exists: optional-call presence checks

The renderer guards a few `DesktopApi` members with `?.`, so that standalone/test runs
without a preload keep working:

`convertAltChunkHtml` (`main.tsx:20`), `onThemeChanged`/`onAiPanelPrefsChanged`/`getAiPanelPrefs`
(`main.tsx:45-50`), `onTeardown` (`App.tsx:1492`), `reportViewMenuState` (`App.tsx:1497`),
`onAiPreset` (`App.tsx:1771`), `onCloseCheck`/`onCloseSaveRequest` (`App.tsx:4209/4216`),
`onChromePressed` (`components/ContextMenu.tsx:120`), `aiOpenBilling`
(`ai/AiPanel.tsx:1401`), `aiGskStatus` (`ai/AiPanel.tsx:466`),
`copyImageToClipboard` (`editor/extensions.ts:3185`),
`getAutoSaveDefault`/`onAutoSaveDefaultChanged` (`packages/ui/src/auto-save-pref.ts:78/83`).

`web/docs/bridge/install.ts` defeats all of them: its Proxy synthesizes a function for any
key that is not already in the target (`get` -> `fallbackFor`), so `x?.()` always runs.
To make a `?.` guard short-circuit, a shim module must export the key explicitly with the
value `undefined` (`'x' in target` is then true and `undefined` comes back). That works for
the non-UI wiring above, but none of these guards sits in front of a button, except
`aiOpenBilling`. So the presence-check mechanism cannot hide any of the 7 visible entry points.

## Per-method table

Legend: **NO FLAG** = needs a renderer change (suggestion in the last column).

### Zotero

| Method            | UI entry point(s)                                                                                                                                                                                                                             | Flag? / what the shim returns                                                                                                                                         | Minimal renderer change                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `zoteroCommand`   | References tab, whole "Zotero" ribbon group: 4 buttons `components/ribbon-references-tab.tsx:494-553` (Citation :497, Bibliography :506, Refresh :517, Document settings menu :529-548; handler `runZotero` :367, IPC :378; group label :554) | **NO FLAG**. Shim returns `{ok:false, errorCode:'unsupported-command'}`, so each click shows the `zoteroOperationError` alert. The buttons stay visible and are dead. | Wrap the group (`:494-555`) in `{window.desktop.capabilities?.zotero !== false && (...)}` (see "Suggested capability object"). |
| `onZoteroRequest` | none. Effect `App.tsx:2061`                                                                                                                                                                                                                   | n/a, disposer returned                                                                                                                                                | none                                                                                                                           |
| `respondToZotero` | none. `App.tsx:2076/2078`                                                                                                                                                                                                                     | n/a                                                                                                                                                                   | none                                                                                                                           |

### Document passwords / encryption

| Method                                                    | UI entry point(s)                                                                                                                                                                                            | Flag? / return                                                                                                                                                                                                                                                         | Minimal renderer change                                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setDocPassword`                                          | Review > Protect Document button `components/ribbon-tabs.tsx:1043-1049` opens `ProtectDialog` (`App.tsx:5727`); the "open password" fields `components/ProtectDialog.tsx:166-185`; applied at `App.tsx:1835` | **NO FLAG**. Shim returns `{ok:false}`, so `App.tsx:1836` skips `setDoc({encrypted})` and the dialog closes silently. The user typed a password that is never applied. The write-protect and editing-restriction parts of the dialog are pure docx XML and still work. | Add a prop to `ProtectDialog`, e.g. `allowOpenPassword={caps.docPassword !== false}`, and drop the two fields at `ProtectDialog.tsx:166-185` when false. |
| `openDocxDecrypt`                                         | `PasswordDialog` `App.tsx:5710`, submit `App.tsx:1809`                                                                                                                                                       | **Hidden by shim return.** The prompt only opens when `openDocx*` returns `{needsPassword:true}` (`loadFile`). W5's `openDocx` never returns that, so it is unreachable. An encrypted `.docx` will fail to parse instead.                                              | none                                                                                                                                                     |
| `docPasswordIntentRevision` / `discardDocPasswordIntents` | none. `file-actions.ts:735/738` (called on every document swap)                                                                                                                                              | n/a, return `0` / `{ok:true}`                                                                                                                                                                                                                                          | none                                                                                                                                                     |

### Crash recovery / autosave to disk

| Method                                            | UI entry point(s)                                                                                               | Flag? / return                                                                                                                                                                                                                                                                              | Minimal renderer change                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `writeRecoveryCopy`                               | none. 30 s timer `App.tsx:1504-1509` -> `file-actions.ts:700-720`                                               | No flag. The timer is gated only by `tornDown` (`App.tsx:1504`), which `onTeardown` sets. **Side effect:** for a dirty, never-saved, non-blank doc, `file-actions.ts:703-708` calls `save(ctx,false,true)` every 30 s. That is `saveDocxNew` (W5), which downloads a file in the web build. | Option A (no renderer change): `hide.ts` `onTeardown` could invoke its handler once, setting `tornDown` and stopping this timer. This also stops the autosave interval (`App.tsx:4239`) and is therefore not enabled by default. Option B: gate `writeRecoveryCopyImpl` on `caps.recoveryCopy !== false`. |
| `getAutoSaveDefault` / `onAutoSaveDefaultChanged` | AutoSave toggle in the quick-access bar `App.tsx:5057-5066` (state `App.tsx:872`, interval `App.tsx:4239-4253`) | **NO FLAG**. Shim returns `{on:false, updatedAt:0}` (= `NO_AUTO_SAVE_DEFAULT`, so autosave starts off). The toggle stays and works: when on, every 30 s / window blur it calls `save(false,true)` and lands in W5's save (a download per tick unless W5 handles `auto`).                    | Hide the `<label className="autosave-toggle">` (`App.tsx:5057`) when `caps.autoSaveToDisk === false`, and force `autoSave=false`.                                                                                                                                                                         |

### Tabs / window chrome

| Method            | UI entry point(s)                                                                                           | Flag? / return                                                                                                                                                                    | Minimal renderer change                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `openNewTab`      | View > Window group > "New Tab" `components/ribbon-tabs.tsx:1332-1342` (click :1335)                        | **NO FLAG**. Click does nothing.                                                                                                                                                  | Hide the button when `caps.tabs === false`.                      |
| `listDocsTabs`    | View > "Switch Tabs" `ribbon-tabs.tsx:1356-1380` (fetch :1120). Shim returns `[]`, so the menu opens empty. | **NO FLAG**                                                                                                                                                                       | Hide the button (same guard as above).                           |
| `focusDocsTab`    | same menu, item click `ribbon-tabs.tsx:1371`                                                                | **NO FLAG** (unreachable once the menu is empty)                                                                                                                                  | same guard; the whole Window group `:1383` label can go with it. |
| `onTeardown`      | none. `App.tsx:1492` (`?.` guard)                                                                           | `?.` guard exists (defeated by the Proxy)                                                                                                                                         | none                                                             |
| `onChromePressed` | none. `components/ContextMenu.tsx:120` (`?.`)                                                               | `?.` guard exists                                                                                                                                                                 | none                                                             |
| `respellKick`     | Review tab spellcheck toggle `ribbon-tabs.tsx:732-740` -> `App.tsx:1236-1372`                               | **Degrades.** The toggle itself works natively; the kick needs a trusted OS keystroke, so after re-enabling, existing misspellings may not be re-underlined until the user types. | none for the spike                                               |

### Native menu / close guard / view-menu state

| Method                                                                               | UI entry point(s)                                                                                              | Flag? / return                                                  | Minimal renderer change |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------- |
| `onMenuCommand`                                                                      | none (native menu only). `App.tsx:4521`. All 37 `MenuCommand`s are also reachable from the ribbon / shortcuts. | n/a (disposer)                                                  | none                    |
| `onCloseCheck` / `onCloseSaveRequest` / `reportCloseCheck` / `reportCloseSaveResult` | none. `App.tsx:4209-4228`                                                                                      | n/a. Web equivalent would be `beforeunload` (not part of HIDE). | none                    |
| `reportViewMenuState`                                                                | none. `App.tsx:1497` (`?.`)                                                                                    | n/a                                                             | none                    |

### Launch handshakes / headless / AI create_document

| Method                                         | UI entry point(s)                                                                                                                                          | Flag? / return                                                                                                                                                                                                                 | Minimal renderer change                                                                              |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `consumeNewBlankDoc`                           | none. `App.tsx:1732` (boot)                                                                                                                                | `false`                                                                                                                                                                                                                        | none                                                                                                 |
| `consumeAiDocContent`                          | none. `App.tsx:1733`                                                                                                                                       | `null`                                                                                                                                                                                                                         | none                                                                                                 |
| `consumeAiPreset` / `onAiPreset`               | none. `App.tsx:1734/1771`                                                                                                                                  | `null` / disposer                                                                                                                                                                                                              | none                                                                                                 |
| `consumeHeadlessExport` / `headlessExportDone` | none. `App.tsx:2179/2192`                                                                                                                                  | `null` -> normal mode                                                                                                                                                                                                          | none                                                                                                 |
| `convertAltChunkHtml`                          | none. Installed as the docx-engine converter `main.tsx:20-21`                                                                                              | `null` = "conversion failed", so `w:altChunk` content is dropped on import. Returning `undefined` from the key would skip installing the converter. Both degrade the same way.                                                 | none                                                                                                 |
| `createDocument`                               | AI tool `create_document` is always advertised to the model: `ai/tools.ts:359` (def) / `:636-670` (handler). No visible button, but the model can call it. | **NO FLAG**. Shim returns `{ok:false, error}` -> tool failure text goes back to the model. There is a precedent for gating tools by a predicate: `generate_image` uses `imageGenerationAvailable(...)` (`ai/AiPanel.tsx:738`). | Pass an `isAvailable` predicate for `create_document` the same way, driven by `caps.createDocument`. |

### Shell drag-drop

| Method                                                                                                       | UI entry point(s)                                          | Flag? / return                                                                                                                                                                                                                          | Minimal renderer change                                   |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `getPathForFile`                                                                                             | AI panel drop zone `ai/AiPanel.tsx:1139` and paste `:1148` | **Degrades, needs the explicit shim entry.** SYNC and truthiness-tested: the generic Proxy fallback would return a truthy `Promise` and break attachments. `''` routes files via `addPastedImage` (W4) instead of `addAttachmentPaths`. | none                                                      |
| (OS-level document drop onto the window: `installDropOpenBridge()` in the preload, not part of `DesktopApi`) | n/a                                                        | Does not exist in the web bridge; the browser default (navigating to the dropped file) applies. Not a renderer entry point.                                                                                                             | out of scope; a web `dragover/drop` handler belongs to W5 |

### Open-flow defaults (`hide.ts` supplies them, `webapi.ts` overrides)

`consumePendingOpenDocx` -> `null` (`App.tsx:1730`), `onOpenDocx` (`App.tsx:1722`), `onRenamedDocx`
(`App.tsx:1706`): no UI entry. Neither of the last two is `?.`-guarded; both need a disposer.

### AI class (implemented in `ai.ts`)

| Method          | UI entry point(s)                                                                                                                                                                                  | Flag? / return                                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `aiGskLogin`    | "Sign in" button in the failed-reply actions `ai/AiPanel.tsx:1395`. Shown only when `entry.loginRequired`, which `AiPanel.tsx:841-855` sets when `aiGskStatus().loggedIn` is false after an error. | **Hidden by flag**: the shim's `aiGskStatus` returns `{loggedIn:true}`.                                                                |
| `aiOpenBilling` | "Buy plan" button `ai/AiPanel.tsx:1401` (`?.` guard, defeated by the Proxy). Only rendered next to a failed reply (login-required or an error text matching the API-key regex at `:1388-1392`).    | Not shown in the stub flow (the stub never errors). Becomes visible on a real Gateway error. Not hidden by a flag; add `caps.billing`. |

## Suggested capability object (one renderer change that covers all 7 NO FLAG items)

Add one optional member to `DesktopApi` (`apps/docs/src/shared/ipc.ts`), absent / `true` by default so the
Electron preload and every existing test stay unchanged:

```ts
capabilities?: {
  zotero?: boolean          // References > Zotero group
  docPassword?: boolean     // ProtectDialog open-password fields
  tabs?: boolean            // View > New Tab / Switch Tabs
  autoSaveToDisk?: boolean  // quick-access AutoSave toggle
  createDocument?: boolean  // AI create_document tool
  billing?: boolean         // AI panel "Buy plan"
}
```

Each consumer reads `window.desktop.capabilities?.<key> !== false`. The web shim then sets
all six to `false`; `install.ts` would need to copy the key through (it does for any key a
module exports). Total diff: roughly 6 call sites, about 15 lines, no behavioural change
on desktop. These edits are listed here and NOT applied: this spike may not modify `apps/**`.

## Not in `DesktopApi`

No updater method exists on `DesktopApi` (auto-update lives in the shell main process), so
there is nothing to stub or hide for it in the Docs renderer.

## Verification

- `npx tsc --noEmit --strict --module esnext --moduleResolution bundler --target es2022 --lib es2023,dom,dom.iterable web/docs/bridge/ai.ts web/docs/bridge/hide.ts` passes.
- Runtime smoke (tsx, Node): `aiStream` emits 10 `delta` chunks (last at about 505 ms) then one `done`; cancel at 120 ms
  yields 2 deltas then a plain `done`; `hide.zoteroCommand()` resolves `{ok:false,...}`.
