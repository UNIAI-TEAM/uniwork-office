/**
 * Sheets capability gating (GO-B6 / UNI-1016; same pattern as apps/docs/src/renderer/capabilities.ts
 * and @genoffice/ui/capabilities).
 *
 * The Electron preload sets no `desktopApi.capabilities`, so on the desktop every entry stays on.
 * The web bridge (web/modules/sheets/install.ts) sets one mutable object before the renderer
 * boots and assigns the host grants into it after the frame handshake. Entries are declared with
 * `cap('key')` where they are rendered, never with a platform check.
 *
 * | key              | hides on the web                                                                 |
 * |------------------|----------------------------------------------------------------------------------|
 * | ai               | AI panel/dock + toggle, AI ribbon entries, ask-AI popover, AI presets            |
 * | aiCredentials    | the AI panel's settings entry (web: UniWork-stored provider keys; on with `ai`)  |
 * | webSearch / imageSearch / imageGeneration / createDocument | the matching AI tools         |
 * | attachments      | the AI composer's attach button (no web attachment store in this frame)           |
 * | autoRename       | post-AI rename of untitled workbooks                                             |
 * | screenshot       | Insert > Screenshot                                                              |
 * | autoSave         | AutoSave pill and its 30 s / blur timer (CONTRACT C10: explicit save only)        |
 * | recoveryCopy     | on: the 30 s recovery tick feeds web draft recovery (C18, encrypted in-browser)  |
 * | open             | File > Open / Ctrl+O (on with the host's `filePick` grant)                        |
 * | save / saveAs    | Save, Ctrl+S / Save As (on with the host's grants; no `save` = view-only)        |
 * | exportCsv        | CSV export                                                                       |
 * | viewOnlyChip     | the renderer's own "view only" status text + toast (one host banner owns it)     |
 * | statusEcho       | the ribbon-row copy of the status bar message and the AI run states ("AI is      |
 * |                  | thinking…" / "AI finished") that the AI panel already shows                      |
 * | xlsxEngine       | the whole workbook surface: off = the "cannot be opened on the web yet" screen   |
 * | recalcFallback   | IronCalc recalc fallback (C11: hidden on the web)                                |
 * | xlsImport        | opening legacy .xls (until the engine converts it)                               |
 * | pivotRefresh     | PivotTable refresh (until the engine reads pivot definitions)                    |
 * | mergeWorkbooks   | Data > Merge workbooks + AI attachment merge (C11: hidden on the web)            |
 */
import { createCapabilityReader } from '@genoffice/ui/capabilities'

export type SheetsCapability =
  | 'ai'
  | 'aiCredentials'
  | 'attachments'
  | 'webSearch'
  | 'imageSearch'
  | 'imageGeneration'
  | 'createDocument'
  | 'autoRename'
  | 'billing'
  | 'screenshot'
  | 'autoSave'
  | 'recoveryCopy'
  | 'open'
  | 'recents'
  | 'save'
  | 'saveAs'
  | 'exportCsv'
  | 'xlsxEngine'
  | 'recalcFallback'
  | 'xlsImport'
  | 'pivotRefresh'
  | 'mergeWorkbooks'
  | 'viewOnlyChip'
  | 'statusEcho'

// structural read: the web module typechecks this file without the renderer's Window augmentation
type CapabilityHolder = { desktopApi?: { capabilities?: Readonly<Record<string, unknown>> } }

export const { cap, platform, resetForTest } = createCapabilityReader<SheetsCapability>(
  () => (window as unknown as CapabilityHolder).desktopApi?.capabilities,
)

/** a web frame without the host's `save` grant: the workbook is shown read-only */
export function isViewOnly(): boolean {
  return !cap('save')
}
