/**
 * Web bridge entry for the Sheets frame (UNI-1016, lane GO-B4/B5/B6 scaffold).
 *
 * Loaded by ./index.html BEFORE the renderer entry (apps/sheets/src/renderer/main.tsx) so the renderer finds its
 * preload globals (desktopApi, projectApi). Everything generic comes from
 * web/docs/bridge/module-bridge.ts: the protocol client (`module: 'sheets'` in `ready`), host
 * theme/locale, the window.open guard, the capability object and the safe no-op Proxy (every
 * member nobody implements is an async no-op / no-op disposer, so the renderer boots without a
 * file and never throws on a missing desktop API).
 *
 * The scaffold implements no file API yet: open/save/export over the protocol
 * (`ctx.client.request('api.open', ...)`) are wired by the sheets module worker in this file.
 */
import { config as zodConfig } from 'zod'
import { installModuleBridge } from '../../docs/bridge/module-bridge'

// zod v4 probes `new Function("")` once to decide on its JIT parsers; under the frame's
// script-src 'self' that probe is a CSP violation report (harmless, but noise in every
// security-policy check). jitless skips the probe and the eval-based fast path; the CSP would
// block that path anyway. Must run before the renderer's first schema parse.
zodConfig({ jitless: true })

export const bridge = installModuleBridge({
  module: 'sheets',
  // what the bundle supports; the module worker declares save / print / ... once they are wired
  frameCapabilities: {},
  globals: {
    // window.desktopApi: scaffold only; the sheets module worker maps it onto the protocol
    desktopApi: () => ({}),
  },
})
