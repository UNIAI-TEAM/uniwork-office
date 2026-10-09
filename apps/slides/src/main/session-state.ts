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
import { join } from 'node:path'
import { configureSessionPlatform, resetFontMetricsCache } from '../session'
import { createSystemFontMetrics, resetFontRegistry } from './fonts'
import { tiffToPng } from './tiff-decode'

export {
  attachedIds,
  beginHistoryBatch,
  buildAllRenderSlides,
  carryHistoryForReplacement,
  editorAttachedIds,
  endHistoryBatch,
  getFontMetrics,
  journalOps,
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

configureSessionPlatform({
  createFontMetrics: createSystemFontMetrics,
  decodeTiff: tiffToPng,
  defer: (fn) => void setImmediate(fn),
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
}

export function setSlidesShowBleed(cb: (wc: WebContents, on: boolean) => void): void {
  showChrome.setBleed = cb
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
