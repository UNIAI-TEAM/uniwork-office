/**
 * Web bridge entry for the Sheets frame (UNI-1016).
 *
 * Loaded by ./index.html BEFORE the renderer entry (apps/sheets/src/renderer/main.tsx) so the
 * renderer finds window.desktopApi / window.projectApi. Generic pieces (protocol client with
 * `module: 'sheets'`, host theme/locale, window.open guard, capability object, safe no-op Proxy,
 * in-memory projectApi) come from web/docs/bridge/module-bridge.ts; the Sheets file and session
 * API is ./bridge.ts over the engine seam ./engine/transport.ts.
 *
 * Engine: GO-D3 = C (CONTRACT C11): the xlsx-sidecar compiled to a wasm32-wasip1 reactor,
 * running in a module Worker of this frame (./engine/engine.worker.ts, emitted by the build as its
 * own same-origin file: worker-src 'self', no blob: worker). The Worker starts on the first
 * workbook operation.
 */
// must stay the first import: switches zod to jitless before any schema is constructed
import './zod-jitless'
import { installModuleBridge } from '../../docs/bridge/module-bridge'
import { createSheetsWebApi } from './bridge'
import { sheetsHostGrants, sheetsWebCapabilities } from './capabilities'
import { createWorkerChannel } from './engine/channel'
import { createWasmTransport } from './engine/wasm-transport'
import { notifyEngineRecovered } from './notice'

const transport = createWasmTransport({
  // a panic aborts the engine; the transport reopens the workbook from its last saved bytes
  onRecovered: notifyEngineRecovered,
  connect: () =>
    createWorkerChannel(
      new Worker(new URL('./engine/engine.worker.ts', import.meta.url), {
        type: 'module',
        name: 'sheets-engine',
      }),
    ),
})

let sheetsApi: ReturnType<typeof createSheetsWebApi> | null = null

export const bridge = installModuleBridge({
  module: 'sheets',
  // what this frame build supports (effective = frame ∩ host grant)
  frameCapabilities: { save: true, saveAs: true, filePick: true, print: true, exportPdf: true },
  capabilities: { defaults: sheetsWebCapabilities(transport), grants: sheetsHostGrants },
  globals: {
    desktopApi: (ctx) => {
      sheetsApi = createSheetsWebApi(ctx.client, { transport, capabilities: ctx.capabilities })
      return sheetsApi.desktopApi
    },
  },
})

// read-only inspection for e2e and support: which session the frame shows (no cell data)
;(window as unknown as { __sheetsWebState: unknown }).__sheetsWebState = {
  workbook: () => sheetsApi?.state.workbook() ?? null,
}
