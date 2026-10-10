/**
 * Web bridge entry for the HTML frame (UNI-1014, lane GO-B4/B5/B6).
 *
 * Loaded by ./index.html BEFORE the renderer entry (apps/html/src/renderer/main.tsx) so the
 * renderer finds window.htmlApi / window.projectApi. The generic part (protocol client with
 * `module: 'html'` in `ready`, host theme/locale, window.open guard, capability object, safe no-op
 * Proxy) is web/docs/bridge/module-bridge.ts; the HTML members (preview with scripts in ./public/preview.html, static fallback) are ./webapi.ts.
 */
import { installModuleBridge } from '../../docs/bridge/module-bridge'
import { TEXT_MODULE_WEB_CAPABILITIES } from '../shared/capabilities'
import { HTML_WEB_CAPABILITIES, createHtmlWebApi, htmlModuleGrants } from './webapi'

export const bridge = installModuleBridge({
  module: 'html',
  // what the bundle supports (effective = frame ∩ host grant); exportPdf = print dialog,
  // exportHtml = in-frame single-file download
  frameCapabilities: {
    save: true,
    saveAs: true,
    print: true,
    exportPdf: true,
    exportHtml: true,
    images: true,
    desktopOpen: true,
  },
  capabilities: {
    defaults: { ...TEXT_MODULE_WEB_CAPABILITIES, ...HTML_WEB_CAPABILITIES },
    grants: htmlModuleGrants,
  },
  globals: {
    htmlApi: (ctx) => createHtmlWebApi(ctx),
  },
})
