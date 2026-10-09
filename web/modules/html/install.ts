/**
 * Web bridge entry for the HTML frame (UNI-1014, lane GO-B4/B5/B6 scaffold).
 *
 * Loaded by ./index.html BEFORE the renderer entry (apps/html/src/renderer/main.tsx) so the renderer finds its
 * preload globals (htmlApi, projectApi). Everything generic comes from
 * web/docs/bridge/module-bridge.ts: the protocol client (`module: 'html'` in `ready`), host
 * theme/locale, the window.open guard, the capability object and the safe no-op Proxy (every
 * member nobody implements is an async no-op / no-op disposer, so the renderer boots without a
 * file and never throws on a missing desktop API).
 *
 * The scaffold implements no file API yet: open/save/export over the protocol
 * (`ctx.client.request('api.open', ...)`) are wired by the html module worker in this file.
 */
import { installModuleBridge } from '../../docs/bridge/module-bridge'

export const bridge = installModuleBridge({
  module: 'html',
  // what the bundle supports; the module worker declares save / print / ... once they are wired
  frameCapabilities: {},
  globals: {
    // window.htmlApi: scaffold only; the html module worker maps it onto the protocol
    htmlApi: () => ({
      // nothing pending: the renderer boots on an empty document instead of calling readFile
      consumePending: async () => null,
      // App.tsx reads `info.url` at boot; '' makes PreviewFrame show about:blank. The desktop
      // preview is the html-preview: protocol; its web replacement (and the frame-src it needs,
      // inventory-b4 C-3) belongs to the html module worker.
      getPreviewInfo: async () => ({ url: '' }),
    }),
  },
})
