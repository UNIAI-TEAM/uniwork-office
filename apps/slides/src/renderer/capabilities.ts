/**
 * Slides capability gating (GO-B5 / UNI-1015; same pattern as apps/docs/src/renderer/capabilities.ts
 * and @genoffice/ui/capabilities).
 *
 * The Electron preload sets no `slidesApi.capabilities`, so on the desktop every entry stays on.
 * The web bridge (web/modules/slides/install.ts) sets one mutable object before the renderer
 * boots and assigns the host grants into it after the frame handshake. Entries are declared with
 * `cap('key')` where they are rendered, never with an OS or URL check.
 *
 * | key              | hides on the web                                                                 |
 * |------------------|----------------------------------------------------------------------------------|
 * | ai               | AI dock + toggle, stage AI bar, AI ribbon buttons, ask-AI popover, AI menu items  |
 * | autoSave         | AutoSave toggle and its 30 s / blur timer (CONTRACT C10: explicit save only)      |
 * | open / recents   | File > Open (Ctrl+O) / recent files (on with the host's `filePick` / `recents`)    |
 * | save / saveAs    | Save (Ctrl+S, QAT) / Save As (on with the host's grants; no `save` = view-only)   |
 * | fontDownload     | font catalog download and the missing-font auto-download                         |
 * | fontInstallLocal | install a local font file                                                        |
 * | model3d          | Insert > 3D model                                                                |
 * | presenterWindow  | the presenter view's second-screen audience window and swap button               |
 * | desktopOpen      | the Open-in-app action of the "use the app" notes (on with the host's grant)     |
 * `platform()` is 'web' in the frame: no native window chrome (traffic lights, caption buttons,
 * vibrancy), the File tab always present, HTML fullscreen for the show on every OS.
 */
import { createCapabilityReader } from '@genoffice/ui/capabilities'

export type SlidesCapability =
  | 'ai'
  | 'autoSave'
  | 'open'
  | 'recents'
  | 'save'
  | 'saveAs'
  | 'fontDownload'
  | 'fontInstallLocal'
  | 'model3d'
  | 'presenterWindow'
  | 'desktopOpen'

// structural read: the web module typechecks this file without the renderer's Window augmentation
type CapabilityHolder = { slidesApi?: { capabilities?: Readonly<Record<string, unknown>> } }

export const { cap, platform, resetForTest } = createCapabilityReader<SlidesCapability>(
  () => (window as unknown as CapabilityHolder).slidesApi?.capabilities,
)

/** running inside the web frame (not Electron) */
export function isWeb(): boolean {
  return platform() === 'web'
}

/** a web frame without the host's `save` grant: the deck is shown, never saved */
export function isViewOnly(): boolean {
  return !cap('save')
}
