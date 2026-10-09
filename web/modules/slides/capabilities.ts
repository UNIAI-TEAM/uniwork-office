/** Slides capability keys on the web (installed on window.slidesApi.capabilities by ./install.ts). */
import { MODULE_WEB_CAPABILITIES } from '../../docs/bridge/module-bridge'

/**
 * The web defaults (inventory-b5 1.6; the renderer gates on them with
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
