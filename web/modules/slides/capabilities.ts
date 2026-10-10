/** Slides capability keys on the web (installed on window.slidesApi.capabilities by ./install.ts). */
import type { Capabilities } from '../../docs/protocol/types'
import { hostGrants } from '../../docs/bridge/hide'
import { MODULE_WEB_CAPABILITIES } from '../../docs/bridge/module-bridge'

/**
 * The web defaults the renderer gates on with `cap()` (apps/slides/src/renderer/capabilities.ts;
 * inventory-b5 1.6): AI, open/recents and save/saveAs until granted, every autosave key off
 * (C10), plus the Slides-only desktop features with no web counterpart in v1. presenterWindow is
 * on: the presenter view opens its audience window in the browser (SP1, CONTRACT C15(2)).
 */
export const SLIDES_WEB_CAPABILITIES: Readonly<Record<string, unknown>> = Object.freeze({
  ...MODULE_WEB_CAPABILITIES,
  save: false,
  saveAs: false,
  tabs: false,
  webSearch: false,
  imageSearch: false,
  imageGeneration: false,
  fontDownload: false,
  fontInstallLocal: false,
  presenterWindow: true,
  model3d: false,
  headlessExport: false,
  // the host's "Open in desktop app" flow (A7 contract, `app.open`): on with the host's grant; the
  // "use the app" notes show their action only then
  desktopOpen: false,
  // the AI panel's inline error is a full, typed sentence on the web ("No AI key yet. ..."): no
  // "Error:" label before it
  errorLabel: false,
})

/** host grants -> keys: File > Open (filePick), recents, and saving (a frame without `save` is view-only) */
export function slidesHostGrants(granted: Capabilities | undefined): Record<string, boolean> {
  return {
    ...hostGrants(granted),
    save: granted?.save === true,
    saveAs: granted?.saveAs === true,
    desktopOpen: granted?.desktopOpen === true,
  }
}
