/**
 * Bridge installer for the non-Docs genoffice modules (GO-B4/B5/B6, UNI-1014/1015/1016).
 *
 * Each web/modules/<module>/install.ts calls `installModuleBridge()` from its index.html BEFORE
 * the app's renderer entry, so the renderer finds its preload globals (window.pdfApi,
 * window.markdownApi, window.htmlApi, window.slidesApi + window.desktop, window.desktopApi)
 * and window.projectApi in place. It reuses the Docs bridge's generic pieces:
 *   ./frame-boot          protocol client (same origin, `module` in `ready`) + host theme/locale
 *   ./browser             theme/language (host-authoritative), print/download helpers, and
 *                         (on import) the window.open guard: http(s) only, no opener
 *   ./capability-object   one mutable capability object, host grants assigned on `init`
 *   ./safe-api            safe no-op Proxy: a member nobody implements never throws
 *   ./project-memory      in-memory projectApi (AI-only; AI is hidden on the web)
 *
 * Every global starts with the shared members (`sharedMembers`: getTheme, onThemeChanged,
 * getLanguage, onLanguageChanged, and the autosave preference pinned off, CONTRACT C10) and then
 * the module's own members (later wins). The module workers replace the scaffold's members with real file APIs over the
 * protocol (`ctx.client.request('api.open', ...)`).
 */
import type { Capabilities, OfficeModule } from '../protocol/types'
import browser from './browser'
import { createCapabilityObject } from './capability-object'
import { bindHostAppearance, createFrameClient, frameVersionFromDocument } from './frame-boot'
import type { FramePort } from './frame-port'
import { hostGrants } from './hide'
import { projectApi } from './project-memory'
import { mergeModules, safeApi, type BridgeObject } from './safe-api'

/** what the installer hands each global's factory */
export interface ModuleBridgeContext {
  module: OfficeModule
  client: ModuleBridgePort
  /** the shared capability object (also set as `<capabilitiesOn>.capabilities`) */
  capabilities: Record<string, unknown>
}

/** the slice of the protocol client the module bridges use (structural, so tests can mock it) */
export type ModuleBridgePort = Pick<
  FramePort,
  | 'whenInitialized'
  | 'request'
  | 'handleOpen'
  | 'handleSave'
  | 'handleSaveAs'
  | 'handlePrint'
  | 'handleCloseCheck'
  | 'onFileRenamed'
  | 'onTheme'
  | 'onLanguage'
  | 'setDirty'
  | 'setTitle'
  | 'reportSaved'
  | 'reportError'
>

export interface ModuleBridgeSpec {
  module: Exclude<OfficeModule, 'docs'>
  /** what this frame build supports (sent in `ready`; effective = frame ∩ host grant) */
  frameCapabilities: Capabilities
  /** window global name -> its members (merged over the appearance members) */
  globals: Record<string, (ctx: ModuleBridgeContext) => BridgeObject>
  /**
   * web capability defaults (desktop-only entries off) + how host grants turn entries on.
   * Default: MODULE_WEB_CAPABILITIES, grants as Docs (`open` <- filePick, `recents` <- recents).
   */
  capabilities?: {
    defaults: Readonly<Record<string, unknown>>
    grants?: (granted: Capabilities | undefined) => Record<string, unknown>
    /** which globals get `.capabilities` (default: every global) */
    on?: readonly string[]
  }
  /** test seam: an existing port instead of a new same-origin protocol client */
  client?: ModuleBridgePort
  /** test seam: where the globals go (default: window) */
  target?: Record<string, unknown>
}

export interface InstalledModuleBridge {
  client: ModuleBridgePort
  capabilities: Record<string, unknown>
  globals: Record<string, BridgeObject>
}

/**
 * What every module starts with on the web: AI hidden (as Docs), File > Open / recents until
 * granted, and no autosave of any kind (CONTRACT C10: explicit user save only; the renderers'
 * autosave toggles, timers and crash-recovery copies are hidden behind these keys).
 */
export const MODULE_WEB_CAPABILITIES: Readonly<Record<string, unknown>> = Object.freeze({
  ai: false,
  open: false,
  recents: false,
  autoSave: false,
  autoSaveToDisk: false,
})

/** NO_AUTO_SAVE_DEFAULT of @genoffice/ui auto-save-pref.ts: autosave off, never set */
const NO_AUTO_SAVE = Object.freeze({ on: false, updatedAt: 0 })

/**
 * Members every module global starts with: what the renderers call at boot (main.tsx: theme and
 * language, host-authoritative) and the shared autosave preference, pinned off on the web (C10).
 */
export function sharedMembers(): BridgeObject {
  return {
    getTheme: browser.getTheme,
    onThemeChanged: browser.onThemeChanged,
    getLanguage: browser.getLanguage,
    onLanguageChanged: browser.onLanguageChanged,
    getAutoSaveDefault: async () => ({ ...NO_AUTO_SAVE }),
    onAutoSaveDefaultChanged: () => () => {},
  }
}

export function installModuleBridge(spec: ModuleBridgeSpec): InstalledModuleBridge {
  const client: ModuleBridgePort =
    spec.client ??
    createFrameClient({
      module: spec.module,
      capabilities: spec.frameCapabilities,
      frameVersion: frameVersionFromDocument(),
    })
  const capabilities = createCapabilityObject<Record<string, unknown>>(
    { platform: 'web', ...(spec.capabilities?.defaults ?? MODULE_WEB_CAPABILITIES) },
    client,
    spec.capabilities?.grants ?? hostGrants,
  )
  bindHostAppearance(client)

  const ctx: ModuleBridgeContext = { module: spec.module, client, capabilities }
  const target = spec.target ?? (window as unknown as Record<string, unknown>)
  const capsOn = spec.capabilities?.on ?? Object.keys(spec.globals)
  const globals: Record<string, BridgeObject> = {}
  for (const [name, factory] of Object.entries(spec.globals)) {
    const api = mergeModules([sharedMembers(), factory(ctx)])
    if (capsOn.includes(name)) api.capabilities = capabilities
    globals[name] = safeApi(api)
    target[name] = globals[name]
  }
  if (!('projectApi' in spec.globals)) target.projectApi = projectApi
  target.__officeWebModule = spec.module
  return { client, capabilities, globals }
}
