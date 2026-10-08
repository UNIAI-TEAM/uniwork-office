/**
 * HIDE class no-ops (W6 - UNI-1011 spike).
 *
 * HIDE = desktop-only capability with no web equivalent. Every method is a typed
 * no-op returning the sensible "nothing / not supported" value and NEVER throws or
 * rejects; `on*` subscribers return a disposer (the renderer calls them
 * synchronously and uses the return value as its effect cleanup).
 *
 * Why every one needs an explicit entry even though install.ts has a generic
 * fallback: the fallback resolves `undefined`, which is wrong for (a) synchronous
 * methods (getPathForFile would return a truthy Promise) and (b) methods whose
 * result is destructured / branched on (zoteroCommand().ok, openDocxDecrypt().ok,
 * setDocPassword().ok, getAutoSaveDefault validation).
 *
 * Which UI entry points exist for each method, and whether the renderer has a flag
 * to hide them, is documented in docs/web-spike/hide-flags.md.
 *
 * | group               | methods                                                                                      | value returned                      |
 * |---------------------|----------------------------------------------------------------------------------------------|-------------------------------------|
 * | Zotero              | zoteroCommand, onZoteroRequest, respondToZotero                                              | {ok:false,...}, disposer, void      |
 * | Doc passwords       | openDocxDecrypt, setDocPassword, docPasswordIntentRevision, discardDocPasswordIntents        | {ok:false}, {ok:false}, 0, {ok:true}|
 * | Recovery / autosave | writeRecoveryCopy, getAutoSaveDefault, onAutoSaveDefaultChanged                              | {ok:false}, {on:false}, disposer    |
 * | Tabs / chrome       | openNewTab, listDocsTabs, focusDocsTab, onTeardown, onChromePressed, respellKick             | void, [], void, disposer, disposer  |
 * | Menu / close guard  | onMenuCommand, onCloseCheck, onCloseSaveRequest, reportCloseCheck, reportCloseSaveResult,    | disposer / void                     |
 * |                     | reportViewMenuState                                                                          |                                     |
 * | Launch / headless   | consumeNewBlankDoc, consumeAiDocContent, consumeAiPreset, onAiPreset, consumeHeadlessExport, | false / null / disposer / void      |
 * |                     | headlessExportDone, createDocument, convertAltChunkHtml                                      |                                     |
 * | Shell drag-drop     | getPathForFile                                                                               | '' (no OS path in a browser)        |
 * | Overridable default | consumePendingOpenDocx, onOpenDocx, onRenamedDocx (open flow is W5's webapi.ts, which wins)  | null / disposer                     |
 *
 * Merge order in install.ts is hide, webapi, ai, browser: a later module that
 * defines the same key silently replaces these.
 */
import type { DesktopApi } from '../../../apps/docs/src/shared/ipc'

const noopDisposer = () => () => {}
const NOT_AVAILABLE = 'Not available in the web build'

export default {
  // ---- Zotero (local desktop app over its connector port) ------------------
  zoteroCommand: async () => ({
    ok: false,
    errorCode: 'unsupported-command' as const,
    error: NOT_AVAILABLE,
  }),
  onZoteroRequest: noopDisposer,
  respondToZotero: () => {},

  // ---- document passwords / ECMA-376 encryption (main-process crypto) ------
  openDocxDecrypt: async () => ({ ok: false as const, reason: 'unsupported' as const }),
  // ok:false => renderer does NOT mark the doc encrypted (App.tsx:1835), so the
  // UI never claims a password that will not be applied on save
  setDocPassword: async () => ({ ok: false }),
  docPasswordIntentRevision: async () => 0,
  discardDocPasswordIntents: async () => ({ ok: true }),

  // ---- crash recovery / autosave to disk -----------------------------------
  writeRecoveryCopy: async () => ({ ok: false }),
  // NO_AUTO_SAVE_DEFAULT (packages/ui/src/auto-save-pref.ts): autosave off, never set
  getAutoSaveDefault: async () => ({ on: false, updatedAt: 0 }),
  onAutoSaveDefaultChanged: noopDisposer,

  // ---- tabs / window chrome (shell WebContentsViews) -----------------------
  openNewTab: async () => {},
  listDocsTabs: async () => [],
  focusDocsTab: async () => {},
  onTeardown: noopDisposer,
  onChromePressed: noopDisposer,
  // needs a trusted OS keystroke; a page cannot synthesize one
  respellKick: async () => {},

  // ---- native menu + close guard -------------------------------------------
  onMenuCommand: noopDisposer,
  onCloseCheck: noopDisposer,
  onCloseSaveRequest: noopDisposer,
  reportCloseCheck: () => {},
  reportCloseSaveResult: () => {},
  reportViewMenuState: () => {},

  // ---- launch handshakes, headless export, AI create_document --------------
  consumeNewBlankDoc: async () => false,
  consumeAiDocContent: async () => null,
  consumeAiPreset: async () => null,
  onAiPreset: noopDisposer,
  consumeHeadlessExport: async () => null,
  headlessExportDone: () => {},
  createDocument: async () => ({ ok: false, error: NOT_AVAILABLE }),
  // null = "conversion failed"; the engine then drops the w:altChunk (hidden-window html2docx)
  convertAltChunkHtml: async () => null,

  // ---- shell drag-drop (Electron webUtils.getPathForFile) -------------------
  // SYNC and truthiness-tested (AiPanel.tsx:1139/1148): '' routes files through
  // addPastedImage instead of addAttachmentPaths
  getPathForFile: () => '',

  // ---- defaults for the open flow; webapi.ts (W5) overrides these ----------
  consumePendingOpenDocx: async () => null,
  onOpenDocx: noopDisposer,
  onRenamedDocx: noopDisposer,
} satisfies Partial<DesktopApi>
