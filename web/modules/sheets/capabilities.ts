/**
 * The Sheets frame's capability object (UNI-1016): web defaults + how host grants switch entries on.
 * Read by the renderer through apps/sheets/src/renderer/capabilities.ts `cap()`; key list and
 * what each hides: that file's header and docs/web-modules/sheets-sidecar.md section 7.3.
 */
import type { Capabilities } from '../../docs/protocol/types'
import { MODULE_WEB_CAPABILITIES } from '../../docs/bridge/module-bridge'
import type { SheetsCapability } from '../../../apps/sheets/src/renderer/capabilities'
import type { SheetsEngineTransport } from './engine/transport'

export type SheetsCapabilities = Record<SheetsCapability, boolean> & { platform: 'web' }

export function sheetsWebCapabilities(
  transport: Pick<SheetsEngineTransport, 'kind' | 'features'>,
): Readonly<Omit<SheetsCapabilities, 'platform'>> {
  return Object.freeze({
    ...(MODULE_WEB_CAPABILITIES as Record<'ai' | 'open' | 'recents' | 'autoSave', boolean>),
    // AI family (hidden as in Docs)
    webSearch: false,
    imageSearch: false,
    imageGeneration: false,
    createDocument: false,
    autoRename: false,
    billing: false,
    // desktop-only inputs and stores
    screenshot: false,
    recoveryCopy: false,
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
): Pick<SheetsCapabilities, 'open' | 'recents' | 'save' | 'saveAs'> {
  return {
    open: granted?.filePick === true,
    recents: granted?.recents === true,
    save: granted?.save === true,
    saveAs: granted?.saveAs === true,
  }
}
