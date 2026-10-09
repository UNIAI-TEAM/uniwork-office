/**
 * Web bridge entry for the Markdown frame (UNI-1014, lane GO-B4/B5/B6).
 *
 * Loaded by ./index.html BEFORE the renderer entry (apps/markdown/src/renderer/main.tsx) so the
 * renderer finds window.markdownApi / window.projectApi. The generic part (protocol client with
 * `module: 'markdown'` in `ready`, host theme/locale, window.open guard, capability object, safe
 * no-op Proxy) is web/docs/bridge/module-bridge.ts; the Markdown members are ./webapi.ts.
 */
import { installModuleBridge } from '../../docs/bridge/module-bridge'
import { TEXT_MODULE_WEB_CAPABILITIES, textModuleGrants } from '../shared/capabilities'
import { MARKDOWN_WEB_CAPABILITIES, createMarkdownWebApi } from './webapi'

export const bridge = installModuleBridge({
  module: 'markdown',
  // what the bundle supports (effective = frame ∩ host grant); exportPdf = print dialog
  frameCapabilities: { save: true, saveAs: true, print: true, exportPdf: true, images: true },
  capabilities: {
    defaults: { ...TEXT_MODULE_WEB_CAPABILITIES, ...MARKDOWN_WEB_CAPABILITIES },
    grants: textModuleGrants,
  },
  globals: {
    markdownApi: (ctx) => createMarkdownWebApi(ctx),
  },
})
