/**
 * The Sheets frame's capability object (UNI-1016): web defaults + how host grants switch entries on.
 * Read by the renderer through apps/sheets/src/renderer/capabilities.ts `cap()`; key list and
 * what each hides: that file's header and docs/web-modules/sheets-sidecar.md section 7.3.
 */
import type { Capabilities } from '../../docs/protocol/types'
import { MODULE_WEB_CAPABILITIES } from '../../docs/bridge/module-bridge'
import { aiHostGrants } from '../shared/ai/web-ai'
import type { SheetsCapability } from '../../../apps/sheets/src/renderer/capabilities'
import type { SheetsEngineTransport } from './engine/transport'

export type SheetsCapabilities = Record<SheetsCapability, boolean> & { platform: 'web' }

export function sheetsWebCapabilities(
  transport: Pick<SheetsEngineTransport, 'kind' | 'features'>,
): Readonly<Omit<SheetsCapabilities, 'platform'>> {
  return Object.freeze({
    ...(MODULE_WEB_CAPABILITIES as Record<
      'ai' | 'aiCredentials' | 'open' | 'recents' | 'autoSave',
      boolean
    >),
    // AI family: off until the host grants it (sheetsHostGrants, CONTRACT C16); the cloud tools also
    // need the server's tool switch (modules/shared/ai/web-ai.ts applyCloud)
    webSearch: false,
    imageSearch: false,
    imageGeneration: false,
    // the AI members that write local files / rename a desktop file stay hidden whatever the host
    // grants: the bridge answers them with typed "unavailable" results (bridge.ts)
    createDocument: false,
    autoRename: false,
    // chat attachments need a web attachment store this frame does not have (the attach button
    // would do nothing)
    attachments: false,
    billing: false,
    // desktop-only inputs and stores
    screenshot: false,
    // the renderer's 30 s recovery tick feeds web draft recovery (C18: encrypted IndexedDB copy,
    // never a save); the desktop recovery dialog stays unused (bridge.ts onRecoveryPrompt)
    recoveryCopy: true,
    // granted by the host on `init` (see sheetsHostGrants)
    save: false,
    saveAs: false,
    // browser download
    exportCsv: true,
    // the engine (GO-D3 = C, CONTRACT C11)
    xlsxEngine: transport.kind !== 'unavailable',
    xlsImport: transport.kind !== 'unavailable' && transport.features.xlsImport,
    pivotRefresh: transport.kind !== 'unavailable' && transport.features.pivotRefresh,
    // hidden on the web whatever the engine supports (C11)
    recalcFallback: false,
    mergeWorkbooks: false,
  })
}

/** effective (frame ∩ host) protocol capabilities -> the renderer keys they turn on */
export function sheetsHostGrants(
  granted: Capabilities | undefined,
): Pick<
  SheetsCapabilities,
  'open' | 'recents' | 'save' | 'saveAs' | 'ai' | 'webSearch' | 'imageSearch' | 'imageGeneration'
> & { aiCredentials: boolean } {
  const ai = aiHostGrants(granted)
  return {
    // `ai` family (with the AI settings entry): the shared web AI bridge's mapping; each cloud
    // tool needs `ai` too
    ai: ai.ai!,
    aiCredentials: ai.aiCredentials!,
    webSearch: ai.webSearch!,
    imageSearch: ai.imageSearch!,
    imageGeneration: ai.imageGeneration!,
    open: granted?.filePick === true,
    recents: granted?.recents === true,
    save: granted?.save === true,
    saveAs: granted?.saveAs === true,
  }
}
