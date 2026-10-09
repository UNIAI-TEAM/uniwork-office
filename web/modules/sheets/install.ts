/**
 * Web bridge entry for the Sheets frame (UNI-1016).
 *
 * Loaded by ./index.html BEFORE the renderer entry (apps/sheets/src/renderer/main.tsx) so the
 * renderer finds window.desktopApi / window.projectApi. Generic pieces (protocol client with
 * `module: 'sheets'`, host theme/locale, window.open guard, capability object, safe no-op Proxy,
 * in-memory projectApi) come from web/docs/bridge/module-bridge.ts; the Sheets file and session
 * API is ./bridge.ts over the engine seam ./engine/transport.ts.
 *
 * Engine: GO-D3 = C (CONTRACT C11) runs xlsx-engine as WASM in a Worker of this frame; that
 * backend is a follow-up, so this build installs the `engine-unavailable` stub and the renderer
 * shows its styled "cannot be opened on the web yet" screen.
 */
import { config as zodConfig } from 'zod'
import { installModuleBridge } from '../../docs/bridge/module-bridge'
import { createSheetsWebApi } from './bridge'
import { sheetsHostGrants, sheetsWebCapabilities } from './capabilities'
import { createUnavailableTransport } from './engine/unavailable'

// zod v4 probes `new Function("")` once to decide on its JIT parsers; under the frame's
// script-src 'self' that probe is a CSP violation report (harmless, but noise in every
// security-policy check). jitless skips the probe and the eval-based fast path; the CSP would
// block that path anyway. Must run before the renderer's first schema parse.
zodConfig({ jitless: true })

const transport = createUnavailableTransport()

export const bridge = installModuleBridge({
  module: 'sheets',
  // what this frame build supports (effective = frame ∩ host grant)
  frameCapabilities: { save: true, saveAs: true, filePick: true, print: true, exportPdf: true },
  capabilities: { defaults: sheetsWebCapabilities(transport), grants: sheetsHostGrants },
  globals: {
    desktopApi: (ctx) =>
      createSheetsWebApi(ctx.client, { transport, capabilities: ctx.capabilities }).desktopApi,
  },
})
