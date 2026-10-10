/**
 * HIDE class no-ops + the web capability source (UNI-1013).
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
 * Which UI entry points exist for each method is documented in
 * docs/web-spike/hide-flags.md; the entries are hidden by `webCapabilities` below,
 * so these no-ops are the safety net behind a hidden entry.
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
 * | Overridable default | consumePendingOpenDocx, onOpenDocx, onRenamedDocx (the open flow is webapi.ts, which wins)   | null / disposer                     |
 *
 * Merge order in install.ts is hide, ai, webapi, browser: a later module that
 * defines the same key silently replaces these (install.ts also replaces
 * `capabilities` with a copy that gets the host grants, see `hostGrants`).
 */
import type { DesktopApi, DesktopCapabilities } from '../../../apps/docs/src/shared/ipc'
import type { Capabilities } from '../protocol/types'

/**
 * THE web capability source. The renderer reads `window.desktop.capabilities`
 * once (apps/docs/src/renderer/capabilities.ts `cap()`) and every hidden entry
 * is declared against one of these keys; there is no `isWeb` check anywhere
 * else. Electron never sets the object, so on desktop every entry stays on.
 *
 * | capability      | hides (renderer entry)                                              |
 * |-----------------|---------------------------------------------------------------------|
 * | zotero          | References tab > Zotero group (4 buttons)                           |
 * | docPassword     | Protect dialog > open-password + confirm fields                     |
 * | tabs            | View > Window > New Tab, Switch Tabs                                |
 * | autoSaveToDisk  | quick-access AutoSave toggle, 30 s crash-recovery copy timer        |
 * | ai              | Home > AI group, Review > Editor/Translate/AI comments/AI revisions,|
 * |                 | View > AI panel, AI dock, ask-AI popover, context-menu Synonyms +   |
 * |                 | Translate, F7 / menu proofread                                      |
 * | webSearch       | AI tool web_search                                                  |
 * | imageSearch     | AI tool image_search                                                |
 * | imageGeneration | AI tool generate_image                                              |
 * | createDocument  | AI tool create_document                                             |
 * | billing         | AI panel "Buy plan" button                                          |
 * | aiCredentials   | AI panel "AI settings" button (web only, UniWork-stored keys)       |
 * | open            | File > Open, Ctrl+O (on only with the host's `filePick` grant)      |
 * | recents         | recent-files lookups (on only with the host's `recents` grant)      |
 * | desktopOpen     | the "Open in app" action of the "use the app" messages (Zotero group,|
 * |                 | open-password row, password-protected open); on only with the grant |
 */
export const webCapabilities: Readonly<Required<DesktopCapabilities>> = Object.freeze({
  platform: 'web',
  zotero: false,
  docPassword: false,
  tabs: false,
  autoSaveToDisk: false,
  ai: false,
  webSearch: false,
  imageSearch: false,
  imageGeneration: false,
  createDocument: false,
  billing: false,
  aiCredentials: false,
  open: false,
  recents: false,
  desktopOpen: false,
})

/**
 * The entries a host can turn on, from the effective (frame ∩ host) capabilities of `init`.
 * A host that cannot pick documents (`file.pick` answers `unsupported`) does not grant
 * `filePick`, so File > Open stays hidden instead of being a silent no-op.
 */
export function hostGrants(
  granted: Capabilities | undefined,
): Required<Pick<DesktopCapabilities, 'open' | 'recents' | 'desktopOpen'>> {
  return {
    open: granted?.filePick === true,
    recents: granted?.recents === true,
    desktopOpen: granted?.desktopOpen === true,
  }
}

const noopDisposer = () => () => {}
const NOT_AVAILABLE = 'Not available in the web build'

export default {
  // ---- capability flags (read once by the renderer; see webCapabilities) ----
  capabilities: webCapabilities,

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
