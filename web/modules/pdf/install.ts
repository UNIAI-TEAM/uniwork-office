/**
 * Web bridge entry for the PDF frame (UNI-1014, lane GO-B4/B5/B6 scaffold).
 *
 * Loaded by ./index.html BEFORE the renderer entry (apps/pdf/src/renderer/main.tsx) so the renderer finds its
 * preload globals (pdfApi, projectApi). Everything generic comes from
 * web/docs/bridge/module-bridge.ts: the protocol client (`module: 'pdf'` in `ready`), host
 * theme/locale, the window.open guard, the capability object and the safe no-op Proxy (every
 * member nobody implements is an async no-op / no-op disposer, so the renderer boots without a
 * file and never throws on a missing desktop API).
 *
 * The scaffold implements no file API yet: open/save/export over the protocol
 * (`ctx.client.request('api.open', ...)`) are wired by the pdf module worker in this file.
 */
import { installModuleBridge } from '../../docs/bridge/module-bridge'

export const bridge = installModuleBridge({
  module: 'pdf',
  // what the bundle supports; the module worker declares save / print / ... once they are wired
  frameCapabilities: {},
  globals: {
    // window.pdfApi: scaffold only; the pdf module worker maps it onto the protocol
    pdfApi: () => ({}),
  },
})
