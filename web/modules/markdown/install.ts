/**
 * Web bridge entry for the Markdown frame (UNI-1014, lane GO-B4/B5/B6 scaffold).
 *
 * Loaded by ./index.html BEFORE the renderer entry (apps/markdown/src/renderer/main.tsx) so the renderer finds its
 * preload globals (markdownApi, projectApi). Everything generic comes from
 * web/docs/bridge/module-bridge.ts: the protocol client (`module: 'markdown'` in `ready`), host
 * theme/locale, the window.open guard, the capability object and the safe no-op Proxy (every
 * member nobody implements is an async no-op / no-op disposer, so the renderer boots without a
 * file and never throws on a missing desktop API).
 *
 * The scaffold implements no file API yet: open/save/export over the protocol
 * (`ctx.client.request('api.open', ...)`) are wired by the markdown module worker in this file.
 */
import { installModuleBridge } from '../../docs/bridge/module-bridge'

export const bridge = installModuleBridge({
  module: 'markdown',
  // what the bundle supports; the module worker declares save / print / ... once they are wired
  frameCapabilities: {},
  globals: {
    // window.markdownApi: scaffold only; the markdown module worker maps it onto the protocol
    markdownApi: () => ({}),
  },
})
