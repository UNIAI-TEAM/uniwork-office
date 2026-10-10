/**
 * Web bridge entry for the PDF frame (GO-B4 / UNI-1014).
 *
 * Loaded by ./index.html BEFORE the renderer entry (apps/pdf/src/renderer/main.tsx) so the
 * renderer finds window.pdfApi / window.projectApi. The generic part (protocol client with
 * `module: 'pdf'`, host theme/locale, window.open guard, capability object, safe no-op Proxy) is
 * web/docs/bridge/module-bridge.ts; the file API is ./webapi.ts over an in-frame working copy and
 * the save core of apps/pdf/src/main (./core.ts) with the web seams (./core-env-web.ts).
 *
 * Capabilities (renderer: apps/pdf/src/renderer/capabilities.ts `cap()`):
 * | key                          | web                                                                 |
 * |------------------------------|---------------------------------------------------------------------|
 * | edit                         | host grant `save`; absent = view-only (edit UI disabled, no save)   |
 * | insertPages                  | host grant `filePick` (import / replace / merge pick a PDF there)   |
 * | pdfTextEdit, pdfImageEdit,   | on; turned off when pdfium cannot be compiled in this frame (the    |
 * |   pdfAnnotDelete             |   module CSP carries 'wasm-unsafe-eval' for it)                     |
 * | savedSignatures              | on, encrypted per-user store (./signatures.ts)                      |
 * | redaction                    | off (the desktop redacts into a working copy file next to the PDF); |
 * |                              |   the Redact entry stays with the 'use the app' message             |
 * | saveStatus, viewOnlyChip     | off, from MODULE_WEB_CAPABILITIES (the host header owns the save    |
 * |                              |   state, one host banner owns "view only")                          |
 * | ai, autoSave(ToDisk), auto-  | off (AI stays desktop-only; no autosave on the web, CONTRACT C10;   |
 * |   Rename, convertOffice, ocr,|   the rest need the desktop shell or an OS engine). Convert to      |
 * |                              |   Office and the OCR notice stay visible and say "use the app"      |
 * | desktopOpen                  | host grant `desktopOpen` (module-bridge.ts); the "Open in app"      |
 * |                              |   action of those messages (pdfApi.openInApp -> app.open)          |
 * |   webSearch, imageSearch,    |                                                                     |
 * |   imageGeneration, create-   |                                                                     |
 * |   Document, billing          |                                                                     |
 */
import type { Capabilities } from '../../docs/protocol/types'
import { capEnabled } from '../../docs/bridge/capability-object'
import { hostGrants } from '../../docs/bridge/hide'
import { MODULE_WEB_CAPABILITIES, installModuleBridge } from '../../docs/bridge/module-bridge'
import { fontUrls, hbSubsetWasmUrl, pdfiumWasmUrl } from './assets'
import { loadPdfCore } from './core'
import { installWebPdfEnv, type WebPdfEnv } from './core-env-web'
import { createPdfWebApi } from './webapi'

export const PDF_WEB_CAPABILITIES: Readonly<Record<string, unknown>> = Object.freeze({
  ...MODULE_WEB_CAPABILITIES,
  edit: false,
  insertPages: false,
  pdfTextEdit: true,
  pdfImageEdit: true,
  pdfAnnotDelete: true,
  savedSignatures: true,
  // redaction writes a working copy next to the file (desktop only)
  redaction: false,
  autoRename: false,
  convertOffice: false,
  ocr: false,
  webSearch: false,
  imageSearch: false,
  imageGeneration: false,
  createDocument: false,
  billing: false,
})

export function pdfGrants(granted: Capabilities | undefined): Record<string, unknown> {
  return {
    ...hostGrants(granted),
    edit: granted?.save === true,
    insertPages: granted?.filePick === true,
  }
}

let web: Promise<WebPdfEnv> | null = null
function webEnv(): Promise<WebPdfEnv> {
  web ??= installWebPdfEnv({ pdfiumWasmUrl, hbSubsetWasmUrl, fontUrls })
  return web
}

// lets the renderer's stylesheet tell the web frame from the desktop window (dialog primary colour)
document.documentElement.dataset.webFrame = 'pdf'

export const bridge = installModuleBridge({
  module: 'pdf',
  // what this bundle supports; effective = this ∩ the host grant
  frameCapabilities: { save: true, saveAs: true, print: true, filePick: true },
  capabilities: { defaults: PDF_WEB_CAPABILITIES, grants: pdfGrants, on: ['pdfApi'] },
  globals: {
    pdfApi: (ctx) =>
      createPdfWebApi(ctx.client, {
        capabilities: ctx.capabilities,
        core: async () => {
          await webEnv()
          return loadPdfCore()
        },
        ensureFonts: async () => (await webEnv()).ensureFonts(),
      }).api,
  },
})

// pdfium-backed entries stay on only when this frame can compile pdfium (CSP + asset); checked
// once the viewer may edit, off the critical path
void bridge.client
  .whenInitialized()
  .then(async () => {
    if (!capEnabled(bridge.capabilities, 'edit')) return
    try {
      await (await webEnv()).ensurePdfium()
    } catch (err) {
      console.warn(
        '[pdf-web] pdfium is unavailable; text/image edit and annotation delete are off:',
        err,
      )
      Object.assign(bridge.capabilities, {
        pdfTextEdit: false,
        pdfImageEdit: false,
        pdfAnnotDelete: false,
      })
    }
  })
  .catch(() => {})
