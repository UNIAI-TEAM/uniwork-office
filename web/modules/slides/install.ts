/**
 * Web bridge entry for the Slides frame (GO-B5, UNI-1015).
 *
 * Loaded by ./index.html BEFORE the renderer entry (apps/slides/src/renderer/main.tsx) so the
 * renderer finds its preload globals: window.slidesApi (./web-slides-api.ts: the document
 * engine in the frame + the protocol file APIs), window.desktop (the Docs attachment subset of
 * web/docs/bridge/browser.ts; AI panel only) and window.projectApi (in-memory, added by
 * installModuleBridge). Everything generic comes from web/docs/bridge/module-bridge.ts.
 */
import browser from '../../docs/bridge/browser'
import { hostGrants } from '../../docs/bridge/hide'
import { installModuleBridge, MODULE_WEB_CAPABILITIES } from '../../docs/bridge/module-bridge'
import type { BridgeObject } from '../../docs/bridge/safe-api'
import { createWebSlidesApi } from './web-slides-api'

/**
 * Slides capability keys on the web (inventory-b5 1.6; the renderer gates on them with
 * `cap()` once the S3 retrofit lands): AI, open/recents until granted and every autosave key
 * off (C10), plus the Slides-only desktop features with no web counterpart in v1.
 */
export const SLIDES_WEB_CAPABILITIES: Readonly<Record<string, unknown>> = Object.freeze({
  ...MODULE_WEB_CAPABILITIES,
  tabs: false,
  webSearch: false,
  imageSearch: false,
  imageGeneration: false,
  fontDownload: false,
  fontInstallLocal: false,
  presenterWindow: false,
  model3d: false,
  headlessExport: false,
})

export const bridge = installModuleBridge({
  module: 'slides',
  // the frame saves (api.save / api.saveAs), opens other decks (file.pick), lists recents, and
  // prints / exports PDF in the frame; no AI, no attachments upload
  frameCapabilities: {
    save: true,
    saveAs: true,
    recents: true,
    filePick: true,
    print: true,
    exportPdf: true,
    images: true,
  },
  capabilities: { defaults: SLIDES_WEB_CAPABILITIES, grants: hostGrants },
  globals: {
    slidesApi: (ctx) => createWebSlidesApi(ctx).slidesApi as unknown as BridgeObject,
    desktop: () => ({
      pickAttachments: browser.pickAttachments,
      addAttachmentPaths: browser.addAttachmentPaths,
      addPastedImage: browser.addPastedImage,
      readAttachment: browser.readAttachment,
      readAttachmentImage: browser.readAttachmentImage,
      getPathForFile: browser.getPathForFile,
    }),
  },
})
