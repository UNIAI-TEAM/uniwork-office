/**
 * Electron side of the GenOffice Slides session: runtime paths, window references,
 * and the wiring that plugs the environment-neutral session core (../session) into
 * Electron — system font metrics, TIFF decoding, setImmediate scheduling and the
 * webContents event sink. The session state itself (sessions, history, RenderSlide
 * rebuild helpers) lives in ../session and is re-exported here for the IPC modules
 * (slides-main, ai-ipc, presenter-show).
 */
import { BrowserWindow, webContents } from 'electron'
import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { OpenedPptx } from '@genoffice/pptx-engine'
import {
  configureSessionPlatform,
  resetFontMetricsCache,
  retintThemedSvg,
  type Session,
} from '../session'
import { createSystemFontMetrics, resetFontRegistry } from './fonts'
import { neutralizeJpegOrientation } from './jpeg-orientation'
import { displayMime } from './media-mime'
import { pictureDpiFor } from './picture-frame'
import { tiffToPng } from './tiff-decode'

export {
  attachedIds,
  beginHistoryBatch,
  buildAllRenderSlides,
  buildSlideUpdate,
  carryHistoryForReplacement,
  editorAttachedIds,
  endHistoryBatch,
  getFontMetrics,
  journalOps,
  markMetaDirty,
  makeMediaResolver,
  pushHistory,
  rebuildSlide,
  rebuildSlideWithReparse,
  registerAiSnapshot,
  restoreAiSnapshot,
  restoreSnapshot,
  retintThemedSvg,
  scheduleDeckBroadcast,
  scheduleHistoryNotify,
  sessions,
  settleStaleHistoryBatch,
  takeSnapshot,
  viewerWcIds,
  type HistorySnapshot,
  type OpLogEntry,
  type Session,
} from '../session'

type MediaSource = {
  opened: WeakRef<OpenedPptx>
  bytes: WeakRef<Uint8Array>
  mediaRef: string
  slidePath?: string
}
const mediaSources = new Map<string, MediaSource>()
const mediaUrls = new WeakMap<OpenedPptx, Map<string, string>>()
const mediaCleanup = new FinalizationRegistry<Map<string, string>>((urls) => {
  for (const url of urls.values()) mediaSources.delete(url)
})
const byteVersions = new WeakMap<Uint8Array, number>()
let nextByteVersion = 0
function byteVersion(bytes: Uint8Array | null): number {
  if (!bytes) return 0
  let version = byteVersions.get(bytes)
  if (version === undefined) byteVersions.set(bytes, (version = ++nextByteVersion))
  return version
}

/** Keep archive and rollback bytes, including media used by masters, layouts and notes. */
export function pruneMediaSources(session: Session): void {
  const urls = mediaUrls.get(session.opened)
  if (!urls) return
  const snapshots = [
    ...session.undoStack,
    ...session.redoStack,
    ...(session.previewRedo ?? []),
    ...(session.historyBatch ? [session.historyBatch.before] : []),
    ...(session.aiSnapshots?.values() ?? []),
  ]
  const retained = new Set(session.opened.archive.entries.values())
  for (const snapshot of snapshots)
    for (const bytes of snapshot.entries.values()) retained.add(bytes)
  for (const [key, url] of urls) {
    const bytes = mediaSources.get(url)?.bytes.deref()
    if (!bytes || !retained.has(bytes)) {
      urls.delete(key)
      mediaSources.delete(url)
    }
  }
}

/** Resolve opaque media URLs without cloning image bytes across the IPC boundary.
 * Weak references leave archive/history responsible for the lifetime of the bytes.
 * A replacement gets a new URL; undo reuses the original URL and decoded image. */
export function resolveSlideMediaUrl(
  opened: OpenedPptx,
  mediaRef: string,
  slidePath?: string,
): string | undefined {
  const bytes = opened.archive.readBytes(mediaRef)
  if (!bytes) return undefined
  const mime = displayMime(mediaRef, bytes)
  let context = ''
  // SVG theme classes depend on the live theme and clrMap, including per-slide overrides.
  if (mime === 'image/svg+xml') {
    const path = slidePath ?? opened.deck.slides[0]?.path
    if (path) {
      const chain = opened.archive.resolveSlideChain(path)
      context = [path, chain.layoutPath, chain.masterPath, chain.themePath]
        .map((p) => `${p}:${byteVersion(p ? opened.archive.readBytes(p) : null)}`)
        .join('|')
    }
  }
  let urls = mediaUrls.get(opened)
  if (!urls) {
    urls = new Map()
    mediaUrls.set(opened, urls)
    mediaCleanup.register(opened, urls)
  }
  const key = `${byteVersion(bytes)}:${mime}:${context}`
  let url = urls.get(key)
  if (!url) {
    url = `genoffice-slide-media://archive/${randomUUID()}?mime=${encodeURIComponent(mime)}`
    urls.set(key, url)
    mediaSources.set(url, {
      opened: new WeakRef(opened),
      bytes: new WeakRef(bytes),
      mediaRef,
      ...(slidePath ? { slidePath } : {}),
    })
  }
  return url
}

/** Display-only conversion; the original archive bytes are untouched for PPTX save. */
export function readSlideMedia(url: string): { body: Uint8Array; mime: string } | null {
  const source = mediaSources.get(url)
  const opened = source?.opened.deref()
  const bytes = source?.bytes.deref()
  if (!source || !opened || !bytes) return null
  let mime = displayMime(source.mediaRef, bytes)
  let body = bytes
  if (mime === 'image/tiff') {
    const decoded = tiffToPng(bytes)
    if (!decoded) return null
    body = decoded.png
    mime = 'image/png'
  } else if (mime === 'image/svg+xml') {
    const text = Buffer.from(bytes).toString('utf8')
    body = Buffer.from(retintThemedSvg(text, opened, source.slidePath), 'utf8')
  } else if (mime === 'image/jpeg') {
    body = neutralizeJpegOrientation(bytes)
  }
  return { body, mime }
}
configureSessionPlatform({
  createFontMetrics: createSystemFontMetrics,
  decodeTiff: tiffToPng,
  defer: (fn) => void setImmediate(fn),
  defaultPictureDpi: pictureDpiFor(process.platform === 'darwin'),
  mediaUrl: resolveSlideMediaUrl,
  pruneMedia: pruneMediaSources,
  events: {
    historyChanged: (ids, state) => {
      for (const id of ids) webContents.fromId(id)?.send('slides:history-changed', { ...state })
    },
    deckChanged: (ids, payload) => {
      for (const id of ids) webContents.fromId(id)?.send('slides:deck-changed', payload)
    },
  },
})

export interface RuntimePaths {
  preloadPath: string
  rendererDevUrl?: string | undefined
  rendererFilePath?: string | undefined
  /** Shell router used to open exported PDFs in a new GenOffice tab. */
  openGeneratedPath?: (path: string) => boolean
}

export const runtime: RuntimePaths = {
  preloadPath: join(__dirname, '../preload/index.js'),
  rendererDevUrl: process.env.ELECTRON_RENDERER_URL,
  rendererFilePath: join(__dirname, '../renderer/index.html'),
}

export function configureSlidesRuntime(paths: RuntimePaths): void {
  runtime.preloadPath = paths.preloadPath
  runtime.rendererDevUrl = paths.rendererDevUrl
  runtime.rendererFilePath = paths.rendererFilePath
  runtime.openGeneratedPath = paths.openGeneratedPath
}

// ── Window references (shell tab mode + active renderer tracking) ──────
export const windowRefs = {
  /** Parent window for dialogs in tab mode (the shell's single BrowserWindow) */
  shellWindow: null as BrowserWindow | null,
  /** Currently active slides renderer (window or tab view) — target of menu commands; the shell updates it on tab switch */
  activeWebContents: null as WebContents | null,
}

export function setSlidesShellWindow(win: BrowserWindow | null): void {
  windowRefs.shellWindow = win
}

/** Shell-registered hook (aggregate/tab mode only): cover the tab strip with a tab's
 *  view during a slideshow without going through HTML fullscreen. Standalone slides
 *  windows have no tab strip and leave this null. */
export const showChrome = {
  setBleed: null as ((wc: WebContents, on: boolean) => void) | null,
  /** the window hosting a tab's WebContentsView when BrowserWindow.fromWebContents
   *  cannot tell (a detached "Open in New Window" / torn-off editor) */
  hostWindow: null as ((wc: WebContents) => BrowserWindow | undefined) | null,
}

export function setSlidesShowBleed(cb: (wc: WebContents, on: boolean) => void): void {
  showChrome.setBleed = cb
}

export function setSlidesHostWindowHook(
  fn: ((wc: WebContents) => BrowserWindow | undefined) | null,
): void {
  showChrome.hostWindow = fn
}

/** the window a tab view lives in: its own BrowserWindow, the shell-registered
 *  detached window, else the shell window */
export function hostWindowFor(wc: WebContents): BrowserWindow | undefined {
  const own = BrowserWindow.fromWebContents(wc) ?? showChrome.hostWindow?.(wc)
  if (own && !own.isDestroyed()) return own
  return windowRefs.shellWindow && !windowRefs.shellWindow.isDestroyed()
    ? windowRefs.shellWindow
    : undefined
}

export function setActiveSlidesWebContents(wc: WebContents | null): void {
  windowRefs.activeWebContents = wc
}

export function dialogParent(): BrowserWindow | undefined {
  // Focused window first: a detached editor window must parent its own dialogs
  // (the shell's tab views live inside the shell window, so tab mode is unchanged)
  return BrowserWindow.getFocusedWindow() ?? windowRefs.shellWindow ?? undefined
}

/** Drop the cached metrics (and its font registry) after the user font store changes. */
export function resetFontMetrics(): void {
  resetFontRegistry()
  resetFontMetricsCache()
}
