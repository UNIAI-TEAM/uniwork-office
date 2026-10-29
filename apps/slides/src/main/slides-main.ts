/**
 * UniWork Slides main process — pptx parsing/render-tree building/edit application/saving all live
 * here (Node side). The renderer only gets plain-data RenderSlide; edit intents are sent back
 * here to apply. Structure mirrors apps/docs: exports embeddable configure/register/start for
 * future shell reuse.
 */
import {
  notifyUniworkUserSave,
  setUniworkUserSaveHook,
  uniworkIsBound,
  uniworkIsLocked,
  uniworkIsReadOnly,
  uniworkRefusesOpen,
  uniworkReadOnlySave,
  uniworkSaveDecision,
  type UniworkSaveOrigin,
} from './uniwork-policy'
import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  session as electronSession,
  shell,
  webContents,
  WebContentsView,
} from 'electron'
import type { WebContents } from 'electron'
import { execFile } from 'node:child_process'
import { readFile, writeFile, rm, stat, mkdir, open } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { cleanupExpiredGeneratedPages } from './generated-page-temp'
import { exportSlidesPdf } from './pdf-export'
import { printSlidesHtml } from './print-window'
import { gskSlideGenerate } from '@genoffice/ai-search'
import {
  appMenuLabels,
  appMenuTemplate,
  configuredDefaultSaveDir,
  contextMenuLabels,
  convertedDocumentFor,
  fetchRemoteImage,
  forgetConvertedDocument,
  installContextMenu,
  installNavigationGuard,
  isHeadlessMode,
  assertModernSaveTarget,
  safeExternalUrl,
  saveAsSuggestion,
  showOpenDialogWithMemory,
  showSaveDialogWithMemory,
  helpMenuTemplate,
  toggleDevToolsItem,
  settingsMenuItem,
  installRendererProtocol,
  registerRendererScheme,
  rendererUrl,
  MAX_REMOTE_IMAGE_BYTES,
  readBodyCapped,
  newerCopyMtime,
  RecoveryClearEpochs,
  recoveryEpochKey,
} from '@genoffice/electron-utils'
import { isDraftPreviewPath } from '@genoffice/electron-utils/draft-preview'
import { answerUniworkAiFlagOff } from '@genoffice/electron-utils/uniwork-ai-flag'
import { answerUniworkCloudStatusOff } from '@genoffice/electron-utils/uniwork-cloud-status'
import { buildPagePptx, parsePageSpec } from '@genoffice/pipelines/slides'
import { sniffImageMime } from './media-mime'
import { canWriteElementClipboardImage, writeElementClipboardImage } from './element-clipboard'
import { getUiLang, normalizeLang, setUiLang } from '@genoffice/i18n'
import { ProjectStore } from '@genoffice/project-store'
import {
  createBlankPptx,
  listEmbeddedFonts,
  openPptx,
  savePptx,
  savePptxToFile,
  commitSaved,
  type OpenedPptx,
} from '@genoffice/pptx-engine'
import { refineComplexWidths, shapedMetricsReady } from './shaped-metrics'
import { cfbKind, isCfbHeader } from './cfb-sniff'
import type {
  PrintSlidesOp,
  ExportImagesOp,
  ExportImagesResult,
  SavePictureOp,
  SavePictureResult,
  ExportPdfOp,
  ExportPdfResult,
  OpenResult,
} from '../shared/ipc'
import { buildPrintDocumentHtml } from '../shared/print-html'
import { slidesMenuAccelerator, type SlidesMenuShortcut } from '../shared/slides-shortcuts'
import { tm } from './i18n-main'
import {
  attachedIds,
  editorAttachedIds,
  buildAllRenderSlides,
  dialogParent,
  getFontMetrics,
  hostWindowFor,
  markMetaDirty,
  resetFontMetrics,
  runtime,
  scheduleDeckBroadcast,
  scheduleHistoryNotify,
  setActiveSlidesWebContents,
  sessions,
  showChrome,
  windowRefs,
  type Session,
} from './session-state'
import { registerAiIpc, registerSlidesOnlyAiIpc } from './ai-ipc'
import {
  appClipboard,
  deckDefaultFont,
  forgetClient,
  landGeneratedPagesInSession,
  sessionDirty,
  sessionHandlers,
  type HostIO,
  type LandedPages,
  type LandMode,
  type SessionHandler,
} from '../session'
import { createElectronHostIO } from './electron-host-io'
import { listPrivateFontFaces, getPrivateFontData, registerEmbeddedFonts } from './fonts'
import { listMetafileFonts } from './metafile-fonts'
import {
  downloadFontFamily,
  initFontStore,
  installLocalFontFiles,
  listFontCatalog,
  missingCatalogFonts,
} from './font-store'

// Cloud-generated single-page pptx: marker strings travel in pageMarkers slots; only paths issued
// by slides:cloud-page-generate are readable (the renderer can't point the reader at arbitrary files)
const CLOUD_PAGE_PREFIX = 'cloudpptx:'
const issuedCloudPages = new Set<string>()
import { registerPresenterIpc } from './presenter-show'
import { registerAttachmentIpc } from './attachments-ipc'

export {
  configureSlidesRuntime,
  setActiveSlidesWebContents,
  setSlidesShellWindow,
  setSlidesHostWindowHook,
  setSlidesShowBleed,
} from './session-state'
export { registerAiIpc } from './ai-ipc'
export { isSlidesAudienceWebContents } from './presenter-show'
export { applySessionTxn } from '../session'

/** standalone: path queued before window creation (argv/open-file) */
let pendingOpenPath: string | null = null
/** tab mode: each view queues its own path; the renderer consumes it after mounting */
const pendingByWc = new Map<number, string>()
/**
 * Views waiting to re-open their deck from disk (queueSlidesForView), mapped to the session they
 * showed before: consume-pending-open restores it when the re-open fails and swaps every window
 * still on it to the fresh session when it succeeds.
 */
const reloadingByWc = new Map<number, Session | null>()

export interface SlidesAiPresetPayload {
  text: string
  autoRun?: boolean
  displayText?: string
}

/** Teacher / Home AI preset waiting for a slides tab */
const pendingAiPresets = new Map<number, SlidesAiPresetPayload>()

export function queueSlidesAiPreset(wcId: number, preset: SlidesAiPresetPayload): void {
  pendingAiPresets.set(wcId, preset)
}
/**
 * Renderer freeze watchdog: the freeze is sporadic and has never
 * reproduced under instrumentation, so when it does happen, capture the
 * discriminating evidence (per-process CPU/RSS, GPU feature state, and on
 * macOS native thread stacks of the renderer/GPU processes) and give
 * the user a way out. Reload restores from the main-side session, and the
 * 30s recovery draft bounds the loss for a force-quit instead.
 */
const freezeDialogOpen = new Set<number>()

async function handleRendererFreeze(wc: WebContents): Promise<void> {
  const ts = Date.now()
  try {
    const appMetrics = app.getAppMetrics()
    const diagnostics = {
      at: new Date().toISOString(),
      webContentsId: wc.id,
      sessionPath: sessions.get(wc.id)?.path ?? null,
      dirty: slidesIsDirty(wc.id),
      appMetrics,
      gpuFeatureStatus: app.getGPUFeatureStatus(),
    }
    await writeFile(
      join(app.getPath('userData'), `freeze-diagnostics-${ts}.json`),
      JSON.stringify(diagnostics, null, 2),
    )
    // macOS: native thread stacks of the renderer + GPU processes, taken from
    // outside the frozen event loop (task_for_pid based, so it works even when
    // a CDP attach suppresses the hang monitor and Runtime.evaluate is stuck).
    // This is the discriminating evidence for the freeze: a renderer main thread
    // parked in gpu::CommandBufferProxyImpl::WaitFor* confirms the GPU
    // command-buffer-wait hypothesis. Best effort — `sample` is denied for
    // hardened-runtime builds without the get-task-allow entitlement.
    if (process.platform === 'darwin') {
      const gpuPid = appMetrics.find((m) => m.type === 'GPU')?.pid
      const targets: Array<[string, number | undefined]> = [
        ['renderer', wc.getOSProcessId()],
        ['gpu', gpuPid],
      ]
      for (const [label, pid] of targets) {
        if (!pid) continue
        const out = join(app.getPath('userData'), `freeze-stacks-${ts}-${label}-${pid}.txt`)
        // Fire and forget: sampling runs for ~3s and must not delay the dialog
        execFile('/usr/bin/sample', [String(pid), '3', '-file', out], () => {})
      }
    }
  } catch {
    /* diagnostics must never make the freeze worse */
  }
  if (freezeDialogOpen.has(wc.id)) return
  freezeDialogOpen.add(wc.id)
  try {
    const parent = hostWindowFor(wc)
    const options = {
      type: 'warning' as const,
      message: tm('freezeTitle'),
      detail: tm('freezeBody'),
      buttons: [tm('freezeWait'), tm('freezeReload')],
      defaultId: 0,
      cancelId: 0,
    }
    const { response } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options)
    if (response === 1 && !wc.isDestroyed()) {
      wc.forcefullyCrashRenderer()
      wc.reload()
    }
  } finally {
    freezeDialogOpen.delete(wc.id)
  }
}

export function trackSlidesWebContents(wc: WebContents): void {
  windowRefs.activeWebContents = wc
  wc.on('unresponsive', () => void handleRendererFreeze(wc))
  // The AI panel opens links via window.open; route them to the system
  // browser instead of spawning an in-app window with remote content.
  wc.setWindowOpenHandler(({ url }) => {
    const target = safeExternalUrl(url)
    if (target) void shell.openExternal(target)
    return { action: 'deny' }
  })
  wc.once('destroyed', () => {
    // Untitled recovery draft: cleaned up on a clean close, kept when the session died dirty
    const s = sessions.get(wc.id)
    if (s && !sessionDirty(s)) dropUntitledRecovery(wc.id)
    else untitledRecovery.delete(wc.id)
    sessions.delete(wc.id)
    // A82 (UNI-1362): a closed deck whose path no live session holds any more
    // has nothing left for its sweep mark to protect, so drop it here instead
    // of keeping it until the next autosave tick's prune. An aliased session
    // (another view of the same deck) keeps the mark.
    if (s?.path) {
      const key = recoveryEpochKey(s.path)
      let live = false
      for (const open of sessions.values()) {
        if (open.path && recoveryEpochKey(open.path) === key) {
          live = true
          break
        }
      }
      if (!live) sweptRecoveryPaths.delete(key)
    }
    pendingByWc.delete(wc.id)
    reloadingByWc.delete(wc.id)
    forgetClient(wc.id)
    closeSaveWaiters.get(wc.id)?.(false)
    closeSaveWaiters.delete(wc.id)
    autoSavePrefByWc.delete(wc.id)
    if (windowRefs.activeWebContents === wc) windowRefs.activeWebContents = null
  })
}

/** Shell hook: a view opened a file (including ⌘O inside a tab) — used to update tab titles and de-duplicate paths */
let slidesOpenedHook: ((wc: WebContents, path: string) => void) | null = null
export function setSlidesOpenedHook(fn: ((wc: WebContents, path: string) => void) | null): void {
  slidesOpenedHook = fn
}

/** Detached editor windows (createSlidesWindow), keyed by webContents id — their titles are owned here */
const standaloneWindows = new Map<number, BrowserWindow>()

/**
 * A shared session's path changed (Save As): sync every attached surface — the
 * shell tab title/path of tab-hosted windows (via the opened hook; a no-op for
 * non-tab webContents) and the window title of detached editors. Without this a
 * Save As from a detached window left the shell tab on the old path, breaking
 * open-by-path dedupe.
 */
function syncAttachedPaths(session: Session, path: string): void {
  for (const id of attachedIds(session)) {
    const wc = webContents.fromId(id)
    if (!wc || wc.isDestroyed()) continue
    slidesOpenedHook?.(wc, path)
    // Peer renderers keep the path in React state (Save As defaults, path-keyed
    // guides); the saver also gets it from its own IPC result — idempotent
    wc.send('slides:renamed', path)
    const win = standaloneWindows.get(id)
    if (win && !win.isDestroyed()) win.setTitle(basename(path))
  }
}

/**
 * MCP save: write a visible session's deck to an explicit path with no dialogs
 * — the slides:save-as pipeline minus the dialog. Overwrite policy is the
 * caller's (the MCP tool layer guards clobbering); this commits the save side
 * effects: session path, recents, attached-surface titles, dirty-flag reset.
 */
export async function saveSessionDeckTo(session: Session, filePath: string): Promise<void> {
  // A view-only UniWork document is never written; an agent save never fires
  // the UniWork user-save hook (only an explicit Save does).
  const uniwork = uniworkSaveDecision({
    kind: 'mcp',
    origin: 'user',
    currentPath: session.path || null,
    targetPath: filePath,
  })
  if (!uniwork.write) throw new Error(`file is view-only: ${filePath}`)
  // the caller supplies an arbitrary absolute path, so its parent may not exist
  // yet (the dialog-driven paths always land in an existing folder)
  await mkdir(dirname(filePath), { recursive: true })
  const metaRevAtSave = session.metaRev ?? 0
  await savePptxToFile(session.opened, filePath)
  session.path = filePath
  autosaveBackoff.delete(filePath)
  // mirror slides:save-as: a saved deck is no longer an unsaved untitled draft
  for (const id of attachedIds(session)) dropUntitledRecovery(id)
  await pushRecent(filePath)
  syncAttachedPaths(session, filePath)
  commitSaved(session.opened)
  if ((session.metaRev ?? 0) === metaRevAtSave) session.metaDirty = false
}

const RECENT_PATH = () => join(app.getPath('userData'), 'slides-recent.json')

async function readRecent(): Promise<string[]> {
  try {
    const raw = await readFile(RECENT_PATH(), 'utf8')
    return (JSON.parse(raw) as string[]).filter((p) => existsSync(p))
  } catch {
    return []
  }
}

/** the raw recent list, for the shell's folder bookkeeping (no existence filter) */
export function readSlidesRecentFiles(): string[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(RECENT_PATH(), 'utf8'))
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

async function pushRecent(path: string): Promise<void> {
  // A headless export is not a document the user opened.
  if (isHeadlessMode()) return
  // A kept-draft preview is a temporary decrypted copy, not a file the user opened.
  if (isDraftPreviewPath(app.getPath('userData'), path)) return
  // A converted legacy copy is a staging file swept when its tab closes: never a recent entry.
  if (convertedDocumentFor(path)) return
  const cur = await readRecent()
  const next = [path, ...cur.filter((p) => p !== path)].slice(0, 10)
  try {
    await writeFile(RECENT_PATH(), JSON.stringify(next), 'utf8')
  } catch {
    /* best-effort */
  }
}

/** File renamed externally (shell Home list rename): swap the old path in the recent list for the new one (keeping its position). */
export async function replaceSlidesRecentFile(oldPath: string, newPath: string): Promise<void> {
  try {
    // Do not use readRecent(): it filters out old paths that no longer exist, so the map would miss
    const raw = await readFile(RECENT_PATH(), 'utf8')
    const cur = JSON.parse(raw) as string[]
    await writeFile(
      RECENT_PATH(),
      JSON.stringify(cur.map((p) => (p === oldPath ? newPath : p))),
      'utf8',
    )
  } catch {
    /* best-effort */
  }
}

/** Shell notification: an open view's file was renamed — sync the session path (subsequent
 *  saves write the new file) and push to the renderer to update the editor title bar. */
export function slidesFileRenamed(wc: WebContents, oldPath: string, newPath: string): void {
  const session = sessions.get(wc.id)
  if (session && session.path === oldPath) session.path = newPath
  wc.send('slides:renamed', newPath)
}

// ── Autosave (crash recovery): dirty sessions write a recovery copy every 30s; a normal save cleans it up ──
const autosaveDir = () => join(app.getPath('userData'), 'slides-autosave')
const autosavePathFor = (filePath: string) =>
  join(autosaveDir(), `${createHash('sha1').update(filePath).digest('hex').slice(0, 16)}.pptx`)

/** mtime of a crash copy newer than `filePath`, or null; read-only (the shell's Desk lists it, opening offers the restore) */
export function recoveryCopyMtime(filePath: string): number | null {
  return newerCopyMtime(autosavePathFor(filePath), filePath)
}

/**
 * Ticks to skip after a failed recovery copy, per deck. Retrying every 30s just
 * repeats an expensive failure, but disabling the safety net for the rest of the
 * session was worse: on a heavy deck one slow serialization used to remove crash
 * recovery permanently and silently. Back off instead, and keep the
 * skip count so a deck that always fails only pays for it every ~5 minutes.
 */
const autosaveBackoff = new Map<string, number>()
const AUTOSAVE_BACKOFF_TICKS = 10
let autosaveRunning = false

/** Bumped by every clear so an in-flight 30s autosave tick that started before the clear cannot leave a stale recovery copy behind; held only while a write is in flight */
const recoveryClearEpochs = new RecoveryClearEpochs()

/** open clear-epoch entries (tests): bounded by the autosave writes in flight */
export function slidesRecoveryEpochEntries(): number {
  return recoveryClearEpochs.size
}

function clearRecoveryCopy(filePath: string): void {
  recoveryClearEpochs.bump(filePath)
  autosaveBackoff.delete(filePath)
  try {
    rmSync(autosavePathFor(filePath), { force: true })
  } catch {
    /* nothing to clean */
  }
}

/**
 * Paths the shell's sign-out sweep cleared while a session of the deck may still
 * be alive (its view closes on a later turn). The autosave tick skips them: the
 * sweep also deleted the binding, so the bound-path gate no longer holds and a
 * tick landing in that gap would write the deck's plaintext back after the
 * sweep. Dropped when a session opens the path again, and pruned once no live
 * session has the path.
 */
const sweptRecoveryPaths = new Set<string>()

/** The shell's sign-out sweep: drops the deck's recovery copy, undoes a write in flight, and keeps the tick from writing it again */
export function clearSlidesRecovery(filePath: string): void {
  sweptRecoveryPaths.add(recoveryEpochKey(filePath))
  clearRecoveryCopy(filePath)
}

/**
 * Recovery drafts for never-saved decks (wcId → visible path in <Documents>/UniWork Office):
 * the sha1-keyed recovery copy needs session.path, so before the first save a freeze or
 * crash used to lose everything. Removed on save, explicit discard, or clean close.
 */
const untitledRecovery = new Map<number, string>()

function dropUntitledRecovery(wcId: number): void {
  const draft = untitledRecovery.get(wcId)
  if (draft) void rm(draft, { force: true }).catch(() => {})
  untitledRecovery.delete(wcId)
}

/**
 * Queue a deck this tab's next consume-pending-open opens from disk without a recovery prompt (shell reload routing).
 * Only the reloading view's own session is dropped (so its consume re-reads the file instead of
 * aliasing onto a peer's stale session). Windows sharing the deck keep editing the old session
 * until the fresh one exists; consume-pending-open then swaps them over, or restores the old
 * session on every window when the re-open fails.
 */
export function queueSlidesForView(contents: WebContents, path: string): void {
  clearRecoveryCopy(path)
  dropUntitledRecovery(contents.id)
  // the session the view shows now; on a retry after a failed re-open it is already evicted, so keep the earlier entry
  reloadingByWc.set(
    contents.id,
    sessions.get(contents.id) ?? reloadingByWc.get(contents.id) ?? null,
  )
  sessions.delete(contents.id)
  pendingByWc.set(contents.id, path)
}

setInterval(() => {
  if (autosaveRunning) return
  autosaveRunning = true
  void (async () => {
    const seen = new Set<Session>() // aliased entries share the session; save it once
    if (sweptRecoveryPaths.size > 0) {
      const live = new Set<string>()
      for (const open of sessions.values()) if (open.path) live.add(recoveryEpochKey(open.path))
      for (const key of [...sweptRecoveryPaths]) if (!live.has(key)) sweptRecoveryPaths.delete(key)
    }
    for (const [wcId, session] of sessions.entries()) {
      if (seen.has(session)) continue
      seen.add(session)
      if (session.masterEdit || !sessionDirty(session)) continue
      // G5-11: a bound UniWork working copy keeps no plaintext copy under
      // userData (sign-out deletes the account's folder; a copy here would outlive it)
      if (session.path && uniworkIsBound(session.path)) continue
      if (session.path && sweptRecoveryPaths.has(recoveryEpochKey(session.path))) continue
      let target: string
      if (session.path) {
        target = autosavePathFor(session.path)
      } else {
        let draft = untitledRecovery.get(wcId)
        if (!draft) {
          draft = join(getDraftsDir(), newDraftFilename())
          untitledRecovery.set(wcId, draft)
        }
        target = draft
      }
      const backoffKey = session.path ?? target
      const skip = autosaveBackoff.get(backoffKey) ?? 0
      if (skip > 0) {
        autosaveBackoff.set(backoffKey, skip - 1)
        continue
      }
      const ticket = recoveryClearEpochs.begin(backoffKey)
      try {
        await mkdir(dirname(target), { recursive: true })
        await savePptxToFile(session.opened, target)
        if (recoveryClearEpochs.cleared(ticket)) {
          await rm(target, { force: true }).catch(() => {})
          continue
        }
        autosaveBackoff.delete(backoffKey)
      } catch (error) {
        autosaveBackoff.set(backoffKey, AUTOSAVE_BACKOFF_TICKS)
        console.warn('[slides] autosave failed, retrying in ~5 min:', error)
      } finally {
        recoveryClearEpochs.end(ticket)
      }
    }
  })().finally(() => {
    autosaveRunning = false
  })
}, 30_000)

// ── Close guard (aligned with sheets/pdf): dirty sessions prompt Save/Don't Save/Cancel before closing a tab/window ──
const closeSaveWaiters = new Map<number, (ok: boolean) => void>()
/** Autosave toggle mirrored from the renderer: files with it on save silently on close and proceed, no dialog */
const autoSavePrefByWc = new Map<number, boolean>()

ipcMain.on('slides:autosave-pref', (event, on: unknown) => {
  autoSavePrefByWc.set(event.sender.id, on === true)
})

ipcMain.on('slides:close-save-result', (event, ok: unknown) => {
  const waiter = closeSaveWaiters.get(event.sender.id)
  if (!waiter) return
  closeSaveWaiters.delete(event.sender.id)
  waiter(ok === true)
})

/** Ask the renderer to run the full save flow and await the result (failure/timeout = false). */
function requestRendererSave(
  contents: WebContents,
  origin: UniworkSaveOrigin = 'user',
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      closeSaveWaiters.delete(contents.id)
      resolve(false)
    }, 120_000)
    closeSaveWaiters.set(contents.id, (ok) => {
      clearTimeout(timer)
      resolve(ok)
    })
    contents.send('slides:close-save-request', origin)
  })
}

export function slidesIsDirty(webContentsId: number): boolean {
  const session = sessions.get(webContentsId)
  return !!session && sessionDirty(session)
}

/**
 * Close guard for the slides renderer: true means proceed with closing.
 * Clean -> true; with changes -> Save/Don't Save/Cancel. Choosing Save asks the renderer to run
 * the existing save flow (flushNotes + adoptSavedSlides + Save As dialog for untitled) and
 * awaits the result; on failure/timeout stay open.
 */
export async function requestSlidesClose(
  contents: WebContents,
  parent?: BrowserWindow | null,
): Promise<boolean> {
  if (!slidesIsDirty(contents.id) || contents.isDestroyed()) return true
  // A shared session stays alive in another EDITOR window; this window can leave
  // without a save prompt — the changes are not being discarded. View-only
  // attachments (presenter audience) don't count: they cannot save.
  const shared = sessions.get(contents.id)
  if (shared && editorAttachedIds(shared).length > 1) return true
  // Autosave on and a path exists: save silently and proceed without bothering the user; only a failed save falls through to the dialog
  // (never for a UniWork document: it only takes explicit saves, so it gets the normal prompt)
  const autoSavePath = sessions.get(contents.id)?.path
  if (autoSavePrefByWc.get(contents.id) && autoSavePath && !uniworkIsBound(autoSavePath)) {
    if (await requestRendererSave(contents, 'auto')) return true
  }
  const options = {
    type: 'warning' as const,
    message: tm('closeUnsavedMsg'),
    detail: tm('closeUnsavedDetail'),
    buttons: [tm('menuSave'), tm('btnDontSave'), tm('btnCancel')],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  }
  const { response } =
    parent && !parent.isDestroyed()
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options)
  if (response === 2) return false
  if (response === 1) {
    // User explicitly discarded changes: also delete the recovery copy, so the next open does not show a pointless recovery prompt
    const session = sessions.get(contents.id)
    if (session?.path) void rm(autosavePathFor(session.path), { force: true }).catch(() => {})
    dropUntitledRecovery(contents.id)
    return true
  }
  return requestRendererSave(contents)
}

/**
 * Drop a session's crash-recovery copies without saving — the dialog-free
 * counterpart of answering "Don't Save" in `requestSlidesClose`, for the MCP
 * `open_documents` discard path (which must not raise a prompt the user did not
 * start). Without this the autosave copy survives, and the next open offers to
 * restore edits the caller explicitly discarded.
 */
export function discardSlidesRecovery(contents: WebContents): void {
  const session = sessions.get(contents.id)
  if (session?.path) void rm(autosavePathFor(session.path), { force: true }).catch(() => {})
  dropUntitledRecovery(contents.id)
}

/** Electron HostIO for one calling webContents (save bookkeeping is per window). */
function hostFor(wc: WebContents): HostIO {
  return createElectronHostIO({
    recent: readRecent,
    untitledTarget: () => {
      const draftsDir = getDraftsDir()
      if (!existsSync(draftsDir)) mkdirSync(draftsDir, { recursive: true })
      return pickDraftPath(draftsDir, tm('untitledDeck'))
    },
    saveAsTarget: async (currentPath, defaultName) => {
      const options = {
        // a UniWork working copy's Save As starts outside its hidden folder
        defaultPath: uniworkIsBound(currentPath)
          ? defaultName
          : (convertedDocumentFor(currentPath)?.suggestSaveAs ??
            saveAsSuggestion(currentPath, defaultName)),
        filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
      }
      const r = await showSaveDialogWithMemory(dialog, dialogParent(), options, getDraftsDir())
      return r.canceled || !r.filePath ? null : assertModernSaveTarget(r.filePath, 'pptx')
    },
    saveGate: (input) => uniworkSaveDecision(input),
    userSaved: (path) => notifyUniworkUserSave(path),
    saved: async ({ kind, session, path, previousPath }) => {
      if (kind === 'untitled') {
        await pushRecent(path)
        slidesOpenedHook?.(wc, path)
        return
      }
      autosaveBackoff.delete(path)
      if (kind === 'save') void rm(autosavePathFor(path), { force: true }).catch(() => {})
      dropUntitledRecovery(wc.id)
      if (kind === 'saveAs') {
        // a converted legacy deck has its real home now
        forgetConvertedDocument(previousPath)
        await pushRecent(path)
        syncAttachedPaths(session, path)
      }
    },
  })
}

/** On open, if a recovery copy newer than the original exists, ask whether to restore (still points at the original path; only save persists it). */
async function maybeRecoverBytes(
  path: string,
  original: Uint8Array,
): Promise<{ bytes: Uint8Array; recovered: boolean }> {
  const asPath = autosavePathFor(path)
  try {
    const [asStat, origStat] = await Promise.all([stat(asPath), stat(path)])
    if (asStat.mtimeMs <= origStat.mtimeMs) {
      await rm(asPath, { force: true })
      return { bytes: original, recovered: false }
    }
  } catch {
    return { bytes: original, recovered: false }
  }
  const parent = dialogParent()
  const options = {
    type: 'question' as const,
    buttons: [tm('autosaveRestore'), tm('autosaveDiscard')],
    defaultId: 0,
    cancelId: 1,
    message: tm('autosaveFoundTitle'),
    detail: tm('autosaveFoundBody'),
  }
  const r = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options)
  if (r.response === 0) {
    const bytes = await readFile(asPath)
    return { bytes: new Uint8Array(bytes), recovered: true }
  }
  await rm(asPath, { force: true })
  return { bytes: original, recovered: false }
}

/**
 * .ppt (97-2003 binary compound document) and encrypted OOXML are unsupported: show an actionable message instead of a parse error.
 * Detection uses the magic number rather than the extension -- a binary ppt with a renamed suffix is caught too. A CFB containing an
 * EncryptedPackage stream is a password-protected pptx and gets dedicated copy (instead of being mislabeled as the legacy format).
 */
async function rejectLegacyPpt(path: string): Promise<boolean> {
  let head: Buffer
  try {
    const fh = await open(path, 'r')
    try {
      head = Buffer.alloc(8)
      await fh.read(head, 0, 8, 0)
    } finally {
      await fh.close()
    }
  } catch {
    return false
  }
  if (!isCfbHeader(head)) return false
  let kind: 'legacy' | 'encrypted' = 'legacy'
  try {
    kind = cfbKind(await readFile(path)) ?? 'legacy'
  } catch {
    // on read failure, fall back to the legacy-format message
  }
  const parent = dialogParent()
  const options = {
    type: 'warning' as const,
    buttons: [tm('legacyPptOk')],
    message: tm(kind === 'encrypted' ? 'encryptedPptxTitle' : 'legacyPptTitle'),
    detail: tm(kind === 'encrypted' ? 'encryptedPptxBody' : 'legacyPptBody'),
  }
  if (parent) await dialog.showMessageBox(parent, options)
  else await dialog.showMessageBox(options)
  return true
}

/** Register the deck's usable embedded fonts before layout; new faces invalidate cached metrics. */
function adoptEmbeddedFonts(opened: OpenedPptx): void {
  try {
    if (registerEmbeddedFonts(listEmbeddedFonts(opened.archive))) resetFontMetrics()
  } catch {
    // Embedded fonts are best-effort: a malformed fntdata must never block opening
  }
  // Metafile pictures draw text through canvas fonts: resolving their facenames here puts the
  // Office-private faces (Yu Gothic UI, MS PGothic…) on the renderer's private-font list before
  // the EMF/WMF previews rasterize.
  try {
    const metrics = getFontMetrics()
    for (const f of listMetafileFonts(opened.archive))
      metrics.displayFamily?.({
        fontFamily: f.family,
        fontSizePx: 100,
        bold: f.bold,
        italic: f.italic,
      })
  } catch {
    // best-effort as well
  }
}

/** The renderer's open payload for a deck the main process already holds. */
function buildSessionOpenResult(session: Session, fitWidthPx: number): OpenResult {
  return {
    path: session.path,
    slides: buildAllRenderSlides(session.opened, fitWidthPx),
    size: { cx: session.opened.deck.size.cx, cy: session.opened.deck.size.cy },
    defaultFont: deckDefaultFont(session.opened),
  }
}

async function openAndBuild(
  wc: WebContents,
  path: string,
  fitWidthPx: number,
  /** reload: read the file from disk even when another window already holds a session for it */
  fresh = false,
): Promise<OpenResult | null> {
  // G5-04g: a deck whose folder declares a store this build does not read is
  // refused before any read of the file (the shell already pushed the S11
  // lock). null is this function's existing nothing-opened result.
  if (uniworkRefusesOpen(path)) return null
  // Same file already open in another window: attach to that session instead of
  // opening an independent copy (which would silently lose the loser's edits on
  // save). Both windows then see the same live deck; edits propagate via
  // scheduleDeckBroadcast. Untitled sessions have path '' and never alias.
  const wanted = resolve(path)
  for (const [id, existing] of fresh ? [] : sessions) {
    if (id === wc.id || !existing.path || resolve(existing.path) !== wanted) continue
    sessions.set(wc.id, existing)
    scheduleHistoryNotify(existing)
    await pushRecent(path)
    slidesOpenedHook?.(wc, path)
    return {
      path: existing.path,
      slides: buildAllRenderSlides(existing.opened, fitWidthPx),
      size: { cx: existing.opened.deck.size.cx, cy: existing.opened.deck.size.cy },
      defaultFont: deckDefaultFont(existing.opened),
    }
  }
  const raw = await readFile(path)
  // a 0-byte .pptx is an empty deck, not a corrupt one: open the blank template
  // under the file's own path so Save writes back to it
  const original = raw.length === 0 ? await createBlankPptx() : new Uint8Array(raw)
  // an export window must never ask about, or discard, crash recovery (it exports the saved file)
  const { bytes, recovered } = headlessExportWaiters.has(wc.id)
    ? { bytes: original, recovered: false }
    : await maybeRecoverBytes(path, original)
  await shapedMetricsReady() // Lay out only after complex-script shaped metrics are ready, avoiding an init race falling back to estimation
  const opened = await openPptx(bytes)
  adoptEmbeddedFonts(opened)
  if (path) sweptRecoveryPaths.delete(recoveryEpochKey(path))
  sessions.set(wc.id, {
    path,
    opened,
    fitWidthPx,
    undoStack: [],
    redoStack: [],
    ...(recovered ? { metaDirty: true } : {}),
  })
  scheduleHistoryNotify(sessions.get(wc.id)!)
  await pushRecent(path)
  slidesOpenedHook?.(wc, path)
  let slides = buildAllRenderSlides(opened, fitWidthPx)
  // If the first layout pass had complex-script misses (Arabic/Thai etc.), re-lay out once with renderer-measured widths
  if (await refineComplexWidths(wc)) slides = buildAllRenderSlides(opened, fitWidthPx)
  return {
    path,
    slides,
    size: { cx: opened.deck.size.cx, cy: opened.deck.size.cy },
    defaultFont: deckDefaultFont(opened),
  }
}

/** Directory where AI-generated drafts are saved: the configurable default save folder (falls back to <Documents>/UniWork Office) */
function getDraftsDir(): string {
  return configuredDefaultSaveDir(app)
}

/** Fallback draft filename: <untitled label>-YYYYMMDD-HHmmss.pptx */
function newDraftFilename(): string {
  const d = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `${tm('untitledDraft')}-${date}-${time}.pptx`
}

/** Sanitize an AI-provided topic/title into a safe filename base: strip illegal path chars, collapse whitespace, cap length; null if invalid. */
function sanitizeDraftBaseName(raw: string | undefined): string | null {
  if (!raw) return null
  const cleaned = raw
    // eslint-disable-next-line no-control-regex -- stripping control chars is the point here
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Strip leading/trailing dots (Windows disallows a trailing dot; a hidden-file prefix is meaningless here)
    .replace(/^\.+|\.+$/g, '')
    .trim()
  if (!cleaned) return null
  return cleaned.length > 40 ? cleaned.slice(0, 40).trim() : cleaned
}

/**
 * After pages land in an existing deck: persist the whole deck as the draft (append mode),
 * then reopen from the written bytes so the session is clean (same as slides:save) —
 * otherwise pure AI generation (per-page merges mark structureDirty) would trigger the
 * close confirmation even without edits. A UniWork-bound deck is not serialized at all
 * (serializing clears the dirty flags): it stays dirty until the user saves. Returns
 * whether a draft was written.
 */
async function draftLandedPages(
  wc: WebContents,
  session: Session,
  deckName?: string,
): Promise<boolean> {
  if (uniworkIsBound(session.path)) {
    // merged pages carry no dirty flags of their own: flag the deck so Save and the
    // close guard see the generated pages as unsaved
    markMetaDirty(session)
    return false
  }
  const bytes = await savePptx(session.opened)
  if (!(await saveDraftAfterGenerate(wc, session, bytes, 'append', deckName))) return false
  if (session.path) {
    session.opened = await openPptx(bytes)
    session.metaDirty = false
  }
  return true
}

/** Pick a draft path from deckName: append -2/-3… if a same-named file exists; fall back to timestamp naming without a valid deckName. */
function pickDraftPath(draftsDir: string, deckName?: string): string {
  const base = sanitizeDraftBaseName(deckName)
  if (base) {
    let candidate = join(draftsDir, `${base}.pptx`)
    for (let i = 2; existsSync(candidate) && i < 100; i++) {
      candidate = join(draftsDir, `${base}-${i}.pptx`)
    }
    if (!existsSync(candidate)) return candidate
  }
  return join(draftsDir, newDraftFilename())
}

/**
 * Auto-save the draft to <Documents>/UniWork Office/<name>.pptx after AI generation completes.
 * Append mode reuses the session's existing draft path (overwrite); replace mode generates a
 * new filename. On successful write, update session.path, pushRecent, slidesOpenedHook.
 * On write failure, degrade silently (console.warn) without blocking the in-memory session.
 * A UniWork-bound deck is never drafted: the generated pages stay in the editor (unsaved)
 * until the user saves, so nothing is written outside the document and the session keeps
 * its path. Returns false in that case, and when the draft write fails.
 */
async function saveDraftAfterGenerate(
  wc: WebContents,
  session: Session,
  bytes: Uint8Array,
  mode: 'replace' | 'append',
  deckName?: string,
): Promise<boolean> {
  if (uniworkIsBound(session.path)) return false
  try {
    const draftsDir = getDraftsDir()
    // Ensure the directory exists
    if (!existsSync(draftsDir)) mkdirSync(draftsDir, { recursive: true })

    // Append mode: overwrite if the session already has a draft path; otherwise create a new file too
    let draftPath: string
    if (mode === 'append' && session.path && session.path.startsWith(draftsDir)) {
      draftPath = session.path
    } else {
      draftPath = pickDraftPath(draftsDir, deckName)
    }

    await writeFile(draftPath, Buffer.from(bytes))
    session.path = draftPath
    await pushRecent(draftPath)
    slidesOpenedHook?.(wc, draftPath)
  } catch (err) {
    console.warn(
      '[slides] Failed to persist AI-generated draft to disk; the in-memory session still works:',
      err,
    )
    return false
  }
  return true
}

/** After a successful Slides → PDF export: open the file in a PDF tab (shell)
 * or reveal it in the folder (standalone). Tab-opening failure must not
 * report the export itself as failed — the file is already persisted. */
function openExportedPdf(path: string): void {
  // Headless export must stay silent: no tab, no Finder window.
  if (isHeadlessMode()) return
  try {
    if (runtime.openGeneratedPath?.(path)) return
  } catch (err) {
    console.warn('[slides] Failed to open exported PDF:', err)
  }
  shell.showItemInFolder(path)
}

let ipcRegistered = false

export function registerSlidesIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true

  // AI-generated slide pages land in app-owned temp directories; sweep
  // expired ones at startup (never at land time — markers can be redeemed
  // more than once), mirroring the sheets pasted-file cleanup.
  void cleanupExpiredGeneratedPages(app.getPath('temp'))

  // shared with the other editor modules — last (identical) registration wins
  ipcMain.removeHandler('app:get-language')
  ipcMain.handle('app:get-language', () => getUiLang())

  // Screen recording: source dispatch for the renderer's navigator.mediaDevices.getDisplayMedia.
  // macOS prefers the system picker (with its permission flow), falling back to the first screen.
  void app.whenReady().then(() => {
    try {
      electronSession.defaultSession.setDisplayMediaRequestHandler(
        (_request, callback) => {
          desktopCapturer
            .getSources({ types: ['screen', 'window'] })
            .then((sources) => {
              if (sources[0]) callback({ video: sources[0] })
              else callback({})
            })
            .catch(() => callback({}))
        },
        { useSystemPicker: true },
      )
    } catch {
      /* Older Electron lacks this API: the screen-record button will get no stream and report failure */
    }
  })

  ipcMain.handle('slides:private-font-faces', () => listPrivateFontFaces())
  ipcMain.handle('slides:private-font-data', (_e, id: string) => getPrivateFontData(id))

  initFontStore()
  // Fonts changed (download or local install): rebuild every open session with a fresh
  // registry and push the relaid-out slides + a re-sync ping to all attached windows.
  const afterFontsChanged = (): void => {
    resetFontMetrics()
    const seen = new Set<Session>()
    for (const [wcId, session] of sessions) {
      if (seen.has(session)) continue
      seen.add(session)
      const payload = {
        slides: buildAllRenderSlides(session.opened, session.fitWidthPx),
        size: { cx: session.opened.deck.size.cx, cy: session.opened.deck.size.cy },
      }
      for (const id of attachedIds(session))
        webContents.fromId(id)?.send('slides:deck-changed', payload)
      void wcId
    }
    for (const wc of webContents.getAllWebContents()) wc.send('slides:fonts-changed')
  }
  ipcMain.handle('slides:font-catalog', () => listFontCatalog())
  ipcMain.handle('slides:font-download', async (_e, family: string) => {
    try {
      await downloadFontFamily(family)
      afterFontsChanged()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('slides:font-install-local', async () => {
    const r = await showOpenDialogWithMemory(dialog, dialogParent(), {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'ttc', 'otc'] }],
    })
    if (r.canceled || !r.filePaths.length) return { families: [] }
    const families = installLocalFontFiles(r.filePaths)
    if (families.length) afterFontsChanged()
    return { families }
  })
  ipcMain.handle('slides:font-missing', (e) => {
    const session = sessions.get(e.sender.id)
    return session ? missingCatalogFonts(session.opened) : []
  })

  // UniWork seam: whether this webContents' own document is a UniWork working
  // copy (AutoSave forced off) and whether it is view-only (Save disabled)
  ipcMain.handle('slides:uniwork-state', (e) => {
    const path = sessions.get(e.sender.id)?.path || null
    return {
      bound: uniworkIsBound(path),
      readOnly: uniworkIsReadOnly(path),
      converted: path ? convertedDocumentFor(path) !== undefined : false,
    }
  })
  ipcMain.handle('slides:uniwork-read-only-save', (e, filePath?: unknown) => {
    const path = sessions.get(e.sender.id)?.path || null
    if (!path) return
    if (typeof filePath === 'string' && filePath.length > 0 && filePath !== path) return
    uniworkReadOnlySave(path)
  })

  // Document session handlers (../session): main is a thin adapter — the calling
  // webContents is the session client, and pickers/dialogs/clipboard/save go through
  // the Electron HostIO.
  for (const [channel, handler] of Object.entries(sessionHandlers) as Array<
    [string, SessionHandler]
  >) {
    ipcMain.handle(channel, (e, ...args: unknown[]) =>
      handler({ clientId: e.sender.id, host: hostFor(e.sender) }, ...args),
    )
  }

  ipcMain.handle('slides:open', async (e, fitWidthPx: number) => {
    const parent = dialogParent()
    const options = {
      properties: ['openFile' as const],
      filters: [{ name: 'PowerPoint', extensions: ['pptx', 'ppt'] }],
    }
    const r = await showOpenDialogWithMemory(dialog, parent, options)
    if (r.canceled || !r.filePaths[0]) return null
    // G5-04g: a locked working copy is refused before rejectLegacyPpt reads it
    if (uniworkRefusesOpen(r.filePaths[0])) return null
    if (await rejectLegacyPpt(r.filePaths[0])) return null
    return openAndBuild(e.sender, r.filePaths[0], fitWidthPx)
  })

  ipcMain.handle('slides:open-path', async (e, path: string, fitWidthPx: number) => {
    if (!path || !existsSync(path)) return null
    // G5-04g: a locked working copy is refused before rejectLegacyPpt reads it
    if (uniworkRefusesOpen(path)) return null
    if (await rejectLegacyPpt(path)) return null
    return openAndBuild(e.sender, path, fitWidthPx)
  })

  ipcMain.handle('slides:consume-ai-preset', (e): SlidesAiPresetPayload | null => {
    const preset = pendingAiPresets.get(e.sender.id) ?? null
    pendingAiPresets.delete(e.sender.id)
    return preset
  })

  ipcMain.handle('slides:consume-pending-open', async (e, fitWidthPx: number) => {
    // renderer app just mounted: safe to reveal the vibrancy material behind
    // the (now painted) page without flashing raw desktop during load
    vibFlip.get(e.sender.id)?.('#00000000')
    const wcId = e.sender.id
    const queued = pendingByWc.get(wcId) ?? pendingOpenPath
    const reloading = reloadingByWc.has(wcId)
    const previous = reloadingByWc.get(wcId) ?? null
    // A failed reload re-open leaves the view on the deck it showed (and every window sharing it on
    // theirs): nothing is lost, the tab stays on its UniWork path, and the queue entry is dropped so
    // the next remount is not stuck retrying a file that cannot open
    const keepPreviousDeck = (): OpenResult | null => {
      if (pendingByWc.get(wcId) === queued) pendingByWc.delete(wcId)
      reloadingByWc.delete(wcId)
      if (!previous) return null
      if (!sessions.has(wcId)) sessions.set(wcId, previous)
      previous.fitWidthPx = fitWidthPx
      return buildSessionOpenResult(previous, fitWidthPx)
    }
    if (queued && existsSync(queued)) {
      const dropQueued = () => {
        if (pendingByWc.get(wcId) === queued) pendingByWc.delete(wcId)
        if (pendingOpenPath === queued) pendingOpenPath = null
        reloadingByWc.delete(wcId)
      }
      // A CFB file (legacy .ppt / encrypted, possibly misnamed .pptx) can never
      // parse: tell the user and drop it, or every relaunch restores a blank tab
      // G5-04g: a locked working copy is refused before rejectLegacyPpt reads it
      if (uniworkRefusesOpen(queued) || (await rejectLegacyPpt(queued))) {
        if (reloading) return keepPreviousDeck()
        dropQueued()
        return null
      }
      // Clear the queue only after a successful open: keep it on parse failure or a mid-flight renderer reload, so a remount can retry
      let result: OpenResult | null
      try {
        result = await openAndBuild(e.sender, queued, fitWidthPx, reloading)
      } catch (error) {
        // A reload must never reject: the renderer's rejection handler boots a blank deck over the
        // restored session and the bound UniWork document silently detaches. Keep the previous deck
        // like the other failures, which also drops the queue entry (no endless retry: the renderer
        // does not re-consume after this mount anyway). A first open still throws to its caller.
        if (reloading && previous) {
          console.warn('slides: reload re-open failed, keeping the previous deck', error)
          return keepPreviousDeck()
        }
        throw error
      }
      const fresh = sessions.get(wcId)
      if (reloading && previous && (!result || !fresh)) return keepPreviousDeck()
      dropQueued()
      if (reloading && result && fresh) {
        // every window still on the old deck (same session object, or the same file) moves to the fresh one
        const wanted = resolve(queued)
        for (const [id, existing] of sessions) {
          if (id === wcId || existing === fresh) continue
          if (existing === previous || (existing.path && resolve(existing.path) === wanted)) {
            sessions.set(id, fresh)
          }
        }
        scheduleHistoryNotify(fresh)
        scheduleDeckBroadcast(fresh)
      }
      return result
    }
    if (reloading) keepPreviousDeck()
    // No queued path but the main process already has a session (remount after an HMR full
    // reload/crash recovery) -> restore from the session; otherwise the document is lost leaving
    // only the start screen, and reopening the same file just activates this empty tab with no
    // way to self-heal
    const session = sessions.get(wcId)
    if (session) {
      session.fitWidthPx = fitWidthPx
      return buildSessionOpenResult(session, fitWidthPx)
    }
    return null
  })

  // ── Cloud single-page generation: brief → cloud HTML+conversion → one-slide pptx saved to a
  // temp file. Returns a marker string that slides:land-generated-pages redeems for the bytes.
  // Off: slide generation is not a UniWork cloud tool (gskSlideGenerate always
  // rejects), so the panel keeps the local pipeline even while signed in.
  const cloudSlideEnabled = () => false

  ipcMain.handle('slides:cloud-gen-status', () => ({ enabled: cloudSlideEnabled() }))

  // In-flight cloud generations keyed by the requesting window: stop in one
  // panel aborts all of that window's pages (a deck batch shares one stop
  // signal) and none of another window's
  const cloudPageAborts = new Map<number, Set<AbortController>>()

  ipcMain.handle('slides:cloud-page-cancel', (e) => {
    const aborts = cloudPageAborts.get(e.sender.id)
    if (!aborts) return
    for (const c of aborts) c.abort()
    cloudPageAborts.delete(e.sender.id)
  })

  ipcMain.handle(
    'slides:cloud-page-generate',
    async (
      e,
      op: {
        brief: string
        title?: string
        styleSkill?: string
        deckContext?: Record<string, unknown>
        images?: { url: string; caption?: string }[]
        width?: number
        height?: number
      },
    ): Promise<{ ok: boolean; marker?: string; error?: string }> => {
      if (!cloudSlideEnabled()) return { ok: false, error: 'cloud slide generation is disabled' }
      try {
        // Ultra resolves to the opus-class slide model server-side; standard is the
        // lighter MiniMax M3 model. Keep an explicit escape hatch for quality
        // comparisons and emergency rollback.
        const tier = process.env.GENOFFICE_CLOUD_SLIDE_TIER === 'standard' ? 'standard' : 'ultra'
        const started = Date.now()
        // Stop must reach the cloud request: without this the generation keeps
        // running (and billing) after the user pressed stop
        const abort = new AbortController()
        const windowAborts = cloudPageAborts.get(e.sender.id) ?? new Set<AbortController>()
        windowAborts.add(abort)
        cloudPageAborts.set(e.sender.id, windowAborts)
        let bytes: Uint8Array
        let model: string
        try {
          ;({ bytes, model } = await gskSlideGenerate({
            tier,
            brief: String(op.brief ?? ''),
            title: op.title ? String(op.title) : undefined,
            styleSkill: op.styleSkill ? String(op.styleSkill) : undefined,
            deckContext: op.deckContext,
            images: Array.isArray(op.images) ? op.images : undefined,
            width: op.width,
            height: op.height,
            signal: abort.signal,
          }))
        } finally {
          windowAborts.delete(abort)
          if (windowAborts.size === 0) cloudPageAborts.delete(e.sender.id)
        }
        console.log(
          `[cloud-slide] page generated: tier=${tier} model=${model} bytes=${bytes.length} ms=${Date.now() - started}`,
        )
        const dir = join(app.getPath('temp'), 'genoffice-cloud-pages')
        mkdirSync(dir, { recursive: true })
        const path = join(dir, `${randomUUID()}.pptx`)
        await writeFile(path, bytes)
        issuedCloudPages.add(path)
        return { ok: true, marker: CLOUD_PAGE_PREFIX + path }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  // ── Local single-page generation (no cloud needed, e.g. BYOK): a JSON slide spec written by
  // the renderer's LLM call is built directly into a one-slide pptx with pptx-engine
  // primitives — no HTML intermediate. Returns the same marker kind as the cloud path, so
  // landing (slides:land-generated-pages) is shared.
  ipcMain.handle(
    'slides:local-page-generate',
    async (
      _e,
      op: { specJson: string },
    ): Promise<{ ok: boolean; marker?: string; error?: string; imageFailures?: string[] }> => {
      const parsed = parsePageSpec(String(op?.specJson ?? ''))
      if (!parsed.ok) return { ok: false, error: parsed.error }
      try {
        const started = Date.now()
        const { bytes, imageFailures } = await buildPagePptx(parsed.spec, {
          fontMetrics: getFontMetrics(),
          fetchImage: async (url) => {
            const resp = await fetchRemoteImage(url)
            if (!resp || !resp.ok) return null
            const buf = await readBodyCapped(resp, MAX_REMOTE_IMAGE_BYTES)
            const mime = sniffImageMime(buf) ?? resp.headers.get('content-type') ?? ''
            const ext = /png/.test(mime)
              ? 'png'
              : /gif/.test(mime)
                ? 'gif'
                : /webp/.test(mime)
                  ? 'webp'
                  : /bmp/.test(mime)
                    ? 'bmp'
                    : 'jpg'
            return { bytes: buf, ext }
          },
          imageDims: (bytes) => {
            try {
              const s = nativeImage.createFromBuffer(Buffer.from(bytes)).getSize()
              return s.width > 0 && s.height > 0 ? s : null
            } catch {
              return null
            }
          },
        })
        console.log(
          `[local-slide] page generated: bytes=${bytes.length} imageFails=${imageFailures.length} ms=${Date.now() - started}`,
        )
        const dir = join(app.getPath('temp'), 'genoffice-local-pages')
        mkdirSync(dir, { recursive: true })
        const path = join(dir, `${randomUUID()}.pptx`)
        await writeFile(path, bytes)
        issuedCloudPages.add(path)
        return {
          ok: true,
          marker: CLOUD_PAGE_PREFIX + path,
          ...(imageFailures.length ? { imageFailures } : {}),
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(
    'slides:land-generated-pages',
    async (
      e,
      pageMarkers: string[],
      fitWidthPx: number,
      mode?: LandMode,
      atIndex?: number,
      deckName?: string,
    ): Promise<LandedPages> => {
      // Every page arrives as a cloud marker (cloudpptx:<path> written by
      // slides:cloud-page-generate, pointing at a one-slide pptx temp file); this handler only
      // reads and lands the bytes (src/session/generated-pages.ts).
      const issuedPages = {
        take: async (marker: string): Promise<Uint8Array> => {
          if (!marker.startsWith(CLOUD_PAGE_PREFIX)) throw new Error('expected a cloud page marker')
          const path = marker.slice(CLOUD_PAGE_PREFIX.length)
          if (!issuedCloudPages.has(path)) throw new Error('unknown cloud page marker')
          return new Uint8Array(await readFile(path))
        },
      }
      // An unbound deck is saved as a draft after landing; a UniWork-bound deck is not: its
      // generated pages stay unsaved in the editor (no draft, the document's path is kept)
      const draft = uniworkIsBound(sessions.get(e.sender.id)?.path)
        ? undefined
        : {
            pages: (session: Session) => draftLandedPages(e.sender, session, deckName),
            deck: (session: Session, bytes: Uint8Array) =>
              saveDraftAfterGenerate(e.sender, session, bytes, 'replace', deckName),
          }
      return landGeneratedPagesInSession(
        e.sender.id,
        pageMarkers,
        issuedPages,
        fitWidthPx,
        mode,
        atIndex,
        draft,
      )
    },
  )

  ipcMain.handle('slides:copy-elements-image', (e, clipboardToken: string, pngBase64: string) => {
    if (!canWriteElementClipboardImage(appClipboard.elements, e.sender.id, clipboardToken))
      return false
    return writeElementClipboardImage(clipboardToken, pngBase64)
  })

  // System clipboard while text-editing (menu commands are echoed back by the renderer per context)
  ipcMain.handle('slides:native-clipboard', (e, op: 'cut' | 'copy' | 'paste') => {
    if (op === 'cut') e.sender.cut()
    else if (op === 'copy') e.sender.copy()
    else e.sender.paste()
  })

  // ── Export (PDF / images): the renderer renders hi-res PNGs with offscreen Konva; the main process handles dialogs/writing ──

  ipcMain.handle('slides:pick-export-dir', async () => {
    const parent = dialogParent()
    const options = {
      title: tm('dlgPickExportDir'),
      buttonLabel: tm('btnExport'),
      properties: ['openDirectory' as const, 'createDirectory' as const],
    }
    const r = await showOpenDialogWithMemory(dialog, parent, options)
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
  })

  ipcMain.handle(
    'slides:export-images',
    async (e, op: ExportImagesOp): Promise<ExportImagesResult> => {
      // G5-03a: a locked working copy exports nothing
      if (uniworkIsLocked(sessions.get(e.sender.id)?.path ?? null)) return { ok: false }
      try {
        // Zero-padding width follows the total page count (3 digits for ≥100 pages)
        const pad = op.pngsBase64.length >= 100 ? 3 : 2
        const paths: string[] = []
        for (let i = 0; i < op.pngsBase64.length; i++) {
          const p = join(op.dir, `${op.baseName}-${String(i + 1).padStart(pad, '0')}.png`)
          await writeFile(p, Buffer.from(op.pngsBase64[i], 'base64'))
          paths.push(p)
        }
        return { ok: true, paths }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    },
  )

  ipcMain.handle('slides:pick-export-pdf-path', async (_e, defaultName: string) => {
    const parent = dialogParent()
    const options = {
      title: tm('dlgExportPdf'),
      defaultPath: defaultName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    }
    const r = await showSaveDialogWithMemory(dialog, parent, options, getDraftsDir())
    return r.canceled || !r.filePath ? null : r.filePath
  })

  ipcMain.handle(
    'slides:save-picture',
    async (e, op: SavePictureOp): Promise<SavePictureResult> => {
      // G5-03a: an image out of a locked working copy is an export it may not have
      if (uniworkIsLocked(sessions.get(e.sender.id)?.path ?? null)) return { ok: false }
      const options = {
        title: tm('dlgSavePicture'),
        defaultPath: `${op.defaultName}.png`,
        filters: [{ name: 'PNG', extensions: ['png'] }],
      }
      const r = await showSaveDialogWithMemory(dialog, dialogParent(), options, getDraftsDir())
      if (r.canceled || !r.filePath) return { ok: false }
      try {
        await writeFile(r.filePath, Buffer.from(op.pngBase64, 'base64'))
        return { ok: true, path: r.filePath }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    },
  )

  ipcMain.handle('slides:export-pdf', async (e, op: ExportPdfOp): Promise<ExportPdfResult> => {
    // G5-03a: a locked working copy exports nothing
    if (uniworkIsLocked(sessions.get(e.sender.id)?.path ?? null)) return { ok: false }
    return exportSlidesPdf({
      ...op,
      // hidden window: without this, throttled timers/rAF stall the
      // PRINT_READY_SCRIPT settle wait (same as the headless export window)
      createWindow: () =>
        new BrowserWindow({
          show: false,
          webPreferences: { sandbox: true, backgroundThrottling: false },
        }),
      openExportedPdf,
    })
  })

  ipcMain.handle(
    'slides:print',
    async (e, op: PrintSlidesOp): Promise<{ ok: boolean; error?: string }> => {
      // G5-03a: a locked working copy prints nothing
      if (uniworkIsLocked(sessions.get(e.sender.id)?.path ?? null)) return { ok: false }
      // Page assembly is shared with the renderer's print-preview pane (print-html.ts)
      const html = buildPrintDocumentHtml({
        srcs: op.pngsBase64.map((b64) => `data:image/png;base64,${b64}`),
        ratio: op.widthPx / op.heightPx,
        layout: op.layout ?? 'full',
        ...(op.notes ? { notes: op.notes } : {}),
        ...(op.orientation ? { orientation: op.orientation } : {}),
        ...(op.frame ? { frame: true } : {}),
      })
      const owner = hostWindowFor(e.sender) ?? dialogParent()
      const win = new BrowserWindow({
        show: false,
        ...(owner && !owner.isDestroyed() ? { parent: owner } : {}),
        ...(process.platform === 'win32'
          ? {
              width: 900,
              height: 700,
              autoHideMenuBar: true,
              closable: false,
              skipTaskbar: true,
            }
          : {}),
        webPreferences: { sandbox: true },
      })
      return printSlidesHtml(html, win)
    },
  )

  // ---- headless export mode (--headless-export) ----

  ipcMain.handle('slides:consume-headless-export', (e): string | null => {
    const target = headlessExportTargets.get(e.sender.id) ?? null
    headlessExportTargets.delete(e.sender.id)
    return target
  })

  ipcMain.on('slides:headless-export-done', (e, result: unknown) => {
    const settle = headlessExportWaiters.get(e.sender.id)
    if (!settle) return
    headlessExportWaiters.delete(e.sender.id)
    const state = result as { ok?: unknown; error?: unknown } | null
    settle({
      ok: state?.ok === true,
      ...(typeof state?.error === 'string' ? { error: state.error } : {}),
    })
  })

  // ── Show fullscreen: macOS native fullscreen is an animated Space transition, so
  // the slideshow would render windowed for ~1s mid-flight. Instead one call covers
  // everything while the show's black root hides the relayout: the tab view bleeds
  // over the tab strip (shell hook) and the window snaps via simpleFullScreen (same
  // trick as the audience window in presenter-show.ts). The renderer skips HTML
  // fullscreen on macOS entirely. Snap is skipped when the user already fullscreened
  // the window into its own Space; Windows/Linux keep HTML fullscreen (instant there)
  // and only need the bleed. Release is debounced: React strict-mode remounts and
  // presenter→show handoffs flip off→on within a tick, and honoring the off
  // immediately makes the window visibly bounce. ──
  let showFsRelease: ReturnType<typeof setTimeout> | null = null
  ipcMain.handle('slides:show-fullscreen', (e, on: boolean) => {
    // a detached editor window fullscreens itself, never the shell behind it
    const win = hostWindowFor(e.sender)
    if (!win || win.isDestroyed()) return
    const wc = e.sender
    if (showFsRelease) {
      clearTimeout(showFsRelease)
      showFsRelease = null
    }
    if (on) {
      showChrome.setBleed?.(wc, true)
      if (process.platform === 'darwin' && !win.isFullScreen()) {
        win.setFullScreenable(false)
        if (!win.isSimpleFullScreen()) win.setSimpleFullScreen(true)
      }
      // The snap can leave the window's first responder on the shell chrome view, so
      // keys land in the tab-strip renderer (Esc dead until a click on the show).
      // win.focus() must NOT be used here — it focuses the shell renderer itself.
      // Focus the tab's webContents now and once more on the next tick (the snap's
      // responder change lands async). HTML fullscreen used to do this implicitly.
      wc.focus()
      setTimeout(() => {
        if (!wc.isDestroyed()) wc.focus()
      }, 50)
    } else {
      showFsRelease = setTimeout(() => {
        showFsRelease = null
        if (!wc.isDestroyed()) showChrome.setBleed?.(wc, false)
        if (win.isDestroyed()) return
        if (process.platform === 'darwin') {
          if (win.isSimpleFullScreen()) win.setSimpleFullScreen(false)
          win.setFullScreenable(true)
        }
      }, 150)
    }
  })

  // ── Chat attachments (slides:files-*) ──
  registerAttachmentIpc()

  // ── Presenter-view multi-screen show (registered inside registerSlidesIpc: shell
  // aggregate mode only calls this function) ──
  registerPresenterIpc()

  registerSlidesOnlyAiIpc()
}

// ── project-store IPC (standalone mode) ───────────────────────────────────
// In shell mode docs-main.registerProjectIpc registers these centrally (idempotent guard,
// registers once). Slides standalone calls this function.

let slidesProjectStore: ProjectStore | null = null
let slidesProjectIpcRegistered = false

function getSlidesProjectStore(): ProjectStore {
  if (!slidesProjectStore) slidesProjectStore = new ProjectStore(app.getPath('userData'))
  return slidesProjectStore
}

export function registerProjectIpc(): void {
  if (slidesProjectIpcRegistered) return
  slidesProjectIpcRegistered = true

  ipcMain.handle(
    'project:resolveChat',
    (_event, args: { filePath: string | null; tempChatId?: string }) => {
      const store = getSlidesProjectStore()
      store.ensureDefaultProject()
      if (!args.filePath) {
        return { projectId: 'default', chatId: args.tempChatId ?? `unsaved-${Date.now()}` }
      }
      return store.resolveChatForFile(args.filePath)
    },
  )

  ipcMain.handle(
    'project:appendChat',
    (
      _event,
      args: {
        projectId: string
        chatId: string
        role: 'user' | 'assistant'
        text: string
        tools?: Array<{
          name: string
          summary: string
          isError?: boolean
          input?: string
          output?: string
        }>
        attachments?: Array<{ name: string; path?: string; ext?: string; sizeBytes?: number }>
        scope?: { label: string; text?: string }
      },
    ) => {
      if (args.role !== 'user' && args.role !== 'assistant') {
        throw new Error(`Invalid chat role: ${String(args.role)}`)
      }
      if (typeof args.text !== 'string' || args.text.length > 200_000) {
        throw new Error('Invalid chat text: must be a string up to 200000 chars')
      }
      if (args.tools && !Array.isArray(args.tools)) throw new Error('Invalid chat tools')
      if (args.attachments && !Array.isArray(args.attachments)) {
        throw new Error('Invalid chat attachments')
      }
      const msg: Parameters<ProjectStore['appendChatMessage']>[2] = {
        role: args.role,
        text: args.text,
      }
      if (args.tools) msg.tools = args.tools
      if (args.attachments) msg.attachments = args.attachments
      if (args.scope) msg.scope = args.scope

      getSlidesProjectStore().appendChatMessage(args.projectId, args.chatId, msg)
    },
  )

  ipcMain.handle(
    'project:loadChat',
    (_event, args: { projectId: string; chatId: string; limit?: number }) => {
      return getSlidesProjectStore().loadChat(args.projectId, args.chatId, args.limit ?? 200)
    },
  )

  ipcMain.handle(
    'project:rebindChat',
    (
      _event,
      args: { projectId: string; tempChatId: string; newChatId?: string; newFilePath?: string },
    ) => {
      const store = getSlidesProjectStore()
      if (args.newFilePath) {
        return store.rebindChatToFile(args.projectId, args.tempChatId, args.newFilePath)
      }
      if (args.newChatId) store.rebindChat(args.projectId, args.tempChatId, args.newChatId)
      return { projectId: args.projectId, chatId: args.newChatId ?? args.tempChatId }
    },
  )
}

/** hidden export windows: webContents id -> the PDF path the renderer must write */
const headlessExportTargets = new Map<number, string>()
/** settled by 'slides:headless-export-done' (or by the renderer dying) */
const headlessExportWaiters = new Map<number, (result: HeadlessSlidesReport) => void>()

interface HeadlessSlidesReport {
  ok: boolean
  error?: string
}

/**
 * Render `input` to `outPath` with no visible window: a hidden slides
 * renderer opens the deck through the normal pending-open queue, rasterizes
 * every visible page offscreen exactly as the File menu export does, and
 * hands the PNGs to the same hidden print window (main/pdf-export.ts).
 */
export async function exportSlidesPdfHeadless(
  input: string,
  outPath: string,
  timeoutMs = 300_000,
): Promise<void> {
  registerSlidesIpc()
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 840,
    webPreferences: {
      preload: runtime.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  const wcId = win.webContents.id
  trackSlidesWebContents(win.webContents)
  pendingByWc.set(wcId, input)
  headlessExportTargets.set(wcId, outPath)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const report = await new Promise<HeadlessSlidesReport>((resolve) => {
      headlessExportWaiters.set(wcId, resolve)
      win.webContents.on('render-process-gone', (_event, details) =>
        resolve({ ok: false, error: `slides renderer stopped (${details.reason})` }),
      )
      timer = setTimeout(
        () => resolve({ ok: false, error: `slides export timed out after ${timeoutMs}ms` }),
        timeoutMs,
      )
      void win.webContents.loadURL(rendererUrl(runtime.rendererDevUrl, 'slides'))
    })
    if (!report.ok) throw new Error(report.error ?? 'slides export failed')
  } finally {
    if (timer) clearTimeout(timer)
    headlessExportWaiters.delete(wcId)
    headlessExportTargets.delete(wcId)
    pendingByWc.delete(wcId)
    if (!win.isDestroyed()) win.destroy()
  }
}

export function createSlidesWindow(openPath?: string | null): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    title: 'UniWork Slides',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const }
      : {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: { color: '#ffffff', symbolColor: '#444444', height: 40 },
        }),
    webPreferences: {
      preload: runtime.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  trackSlidesWebContents(win.webContents)
  standaloneWindows.set(win.webContents.id, win)
  const standaloneWcId = win.webContents.id
  win.on('closed', () => standaloneWindows.delete(standaloneWcId))
  // The focused window owns the process-global menu-command target and the app
  // menu (the shell's tab manager re-claims both on its own window's focus)
  win.on('focus', () => {
    setActiveSlidesWebContents(win.webContents)
    installSlidesMenu()
  })
  // Titles are owned by the main process (initial file name, Save As updates);
  // the renderer's static <title> must not overwrite them
  win.on('page-title-updated', (event) => event.preventDefault())
  // Close guard for standalone-window mode (tab mode runs the same flow via the shell's tab-manager/window-close path)
  win.on('close', (event) => {
    if (!slidesIsDirty(win.webContents.id)) return
    event.preventDefault()
    void requestSlidesClose(win.webContents, win).then((proceed) => {
      // destroy() exits bypassing this handler (close() would re-enter the guard)
      if (proceed && !win.isDestroyed()) win.destroy()
    })
  })

  void win.loadURL(rendererUrl(runtime.rendererDevUrl, 'slides'))

  if (openPath) {
    win.setTitle(basename(openPath))
    win.webContents.once('did-finish-load', async () => {
      try {
        const result = await openAndBuild(win.webContents, openPath, 1280)
        win.webContents.send('slides:opened', result)
      } catch {
        /* ignore */
      }
    })
  }
  return win
}

/** per-webContents background setter: opaque white while (re)loading, flipped
 * to transparent by consume-pending-open once the renderer has mounted, so the
 * vibrancy hole never shows the raw desktop behind an unpainted page */
const vibFlip = new Map<number, (color: string) => void>()

function armVibrancy(view: WebContentsView): void {
  if (process.platform !== 'darwin') return
  const setColor = (c: string) => view.setBackgroundColor(c)
  setColor('#ffffff')
  // view.webContents becomes undefined after destroy, so grab the id beforehand
  const wcId = view.webContents.id
  vibFlip.set(wcId, setColor)
  view.webContents.on('did-start-loading', () => setColor('#ffffff'))
  view.webContents.once('destroyed', () => vibFlip.delete(wcId))
}

/** Tab version of createSlidesWindow: same runtime/IPC, hosted in the shell's WebContentsView */
export function createSlidesView(openPath?: string | null): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload: runtime.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  registerSlidesIpc()
  trackSlidesWebContents(view.webContents)
  armVibrancy(view)
  // The renderer calls consumePendingOpen on mount; use that to avoid a did-finish-load timing race
  if (openPath && existsSync(openPath)) pendingByWc.set(view.webContents.id, openPath)
  // mode=tab: the shell's tab strip owns the traffic lights / caption buttons,
  // so the ribbon must not reserve space for them
  void view.webContents.loadURL(rendererUrl(runtime.rendererDevUrl, 'slides', { mode: 'tab' }))
  return view
}

/** Items the shell injects into the File menu (e.g. Back to Home) */
let extraFileMenuItems: Electron.MenuItemConstructorOptions[] = []
export function setSlidesExtraFileMenuItems(items: Electron.MenuItemConstructorOptions[]): void {
  extraFileMenuItems = items
}

/** Tab mode: Cmd+W closes the current tab rather than the whole shell window */
let closeActiveTabHook: (() => void) | null = null
export function setSlidesCloseTabHook(fn: (() => void) | null): void {
  closeActiveTabHook = fn
}

export function buildSlidesMenu(): Menu {
  const send = (cmd: string) =>
    (windowRefs.activeWebContents ?? BrowserWindow.getFocusedWindow()?.webContents)?.send(
      'slides:menu',
      cmd,
    )
  const isMac = process.platform === 'darwin'
  const acc = (item: SlidesMenuShortcut) => slidesMenuAccelerator(item, isMac ? 'mac' : 'win')
  const labels = appMenuLabels(getUiLang())
  const appMenu = appMenuTemplate(process.platform, labels, {
    appLabel: app.name,
    extra: [settingsMenuItem(labels)],
  })
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(appMenu ? [appMenu] : []),
    {
      label: tm('menuFile'),
      submenu: [
        { label: tm('menuOpen'), accelerator: acc('open'), click: () => send('open') },
        {
          // Detached second editor window on the same saved file: it attaches to
          // the shared session (openAndBuild), so both windows co-edit live
          label: tm('menuOpenNewWindow'),
          click: () => {
            const wc = windowRefs.activeWebContents ?? BrowserWindow.getFocusedWindow()?.webContents
            const path = wc ? sessions.get(wc.id)?.path : undefined
            if (path) createSlidesWindow(path)
          },
        },
        ...(extraFileMenuItems.length > 0
          ? [{ type: 'separator' as const }, ...extraFileMenuItems]
          : []),
        { type: 'separator' },
        { label: tm('menuSave'), accelerator: acc('save'), click: () => send('save') },
        { label: tm('menuSaveAs'), accelerator: acc('saveAs'), click: () => send('save-as') },
        { type: 'separator' },
        // The ribbon's File tab is Windows-only, so without these macOS had no way
        // to export or print at all
        { label: tm('menuExportPdf'), click: () => send('export-pdf') },
        { label: tm('menuExportImages'), click: () => send('export-images') },
        { label: tm('menuPrint'), accelerator: acc('print'), click: () => send('print') },
        { type: 'separator' },
        closeActiveTabHook
          ? {
              // closes the tab on every platform (the hook only exists in tab mode)
              label: tm('menuClose'),
              accelerator: acc('close'),
              click: () => closeActiveTabHook?.(),
            }
          : isMac
            ? { role: 'close' as const, label: tm('menuClose') }
            : { role: 'quit' as const, label: tm('menuQuit') },
        { type: 'separator' },
        settingsMenuItem(labels, undefined, { accelerator: isMac }),
      ],
    },
    {
      label: tm('menuEdit'),
      submenu: [
        // Undo/redo are sent to the renderer: text-editing state uses native execCommand, otherwise document history
        { label: tm('menuUndo'), accelerator: acc('undo'), click: () => send('undo') },
        // PowerPoint's Ctrl+Y / Cmd+Y; Shift+Ctrl+Z still redoes through the renderer handler
        { label: tm('menuRedo'), accelerator: acc('redo'), click: () => send('redo') },
        { type: 'separator' },
        // Cut/copy/paste forward the same way: in text state the renderer calls back to the native clipboard; in canvas state the element clipboard is used
        { label: tm('menuCut'), accelerator: 'CmdOrCtrl+X', click: () => send('cut') },
        { label: tm('menuCopy'), accelerator: 'CmdOrCtrl+C', click: () => send('copy') },
        { label: tm('menuPaste'), accelerator: 'CmdOrCtrl+V', click: () => send('paste') },
        { role: 'selectAll', label: labels.selectAll },
      ],
    },
    {
      label: tm('menuView'),
      submenu: [
        { label: tm('menuZoomIn'), accelerator: 'CmdOrCtrl+=', click: () => send('zoom-in') },
        { label: tm('menuZoomOut'), accelerator: 'CmdOrCtrl+-', click: () => send('zoom-out') },
        {
          label: tm('menuActualSize'),
          accelerator: 'CmdOrCtrl+0',
          click: () => send('zoom-reset'),
        },
        // Developer Tools only in dev builds, like Docs and Sheets (UNI-2011 P0)
        ...(app.isPackaged ? [] : [{ type: 'separator' as const }, toggleDevToolsItem(labels)]),
      ],
    },
    helpMenuTemplate(labels),
  ]
  return Menu.buildFromTemplate(template)
}

export function installSlidesMenu(): void {
  Menu.setApplicationMenu(buildSlidesMenu())
}

/**
 * Attach a proxy to the main process's global fetch. Environment variables take priority;
 * otherwise, after app ready, read the system proxy via session.resolveProxy() (the critical
 * path for packaged builds launched by double-click).
 */
async function applyMainProcessProxy(): Promise<void> {
  const setDispatcher = async (proxyUrl: string) => {
    try {
      const { ProxyAgent, setGlobalDispatcher } = await import('undici')
      setGlobalDispatcher(new ProxyAgent(proxyUrl))
      // strip user:pass credentials before logging
      console.log('[proxy] main-process fetch via', proxyUrl.replace(/\/\/[^@/]*@/, '//***@'))
    } catch (e) {
      console.warn('[proxy] failed to set ProxyAgent:', e)
    }
  }
  const envProxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy
  if (envProxy) {
    await setDispatcher(envProxy)
    return
  }
  // No environment variables: read the system proxy (requires app ready)
  try {
    await app.whenReady()
    // PAC/rule proxies answer per-host: probe the host the default UniAI chat route targets
    const resolved = await electronSession.defaultSession.resolveProxy('https://openrouter.ai/')
    // resolveProxy returns strings like "PROXY 127.0.0.1:1087" or "DIRECT"
    const m = /PROXY\s+([^;]+)/i.exec(resolved || '')
    if (m) {
      await setDispatcher(`http://${m[1].trim()}`)
    } else {
      console.log('[proxy] system proxy = DIRECT, no dispatcher set')
    }
  } catch (e) {
    console.warn('[proxy] resolveProxy failed:', e)
  }
}

export function startSlidesStandalone(): void {
  // no shell here: answer the renderer's UniWork AI flag pull with "off" instead of an unregistered channel
  answerUniworkAiFlagOff(ipcMain)
  answerUniworkCloudStatusOff(ipcMain)
  registerRendererScheme()
  installNavigationGuard(app)
  installContextMenu(app, () => contextMenuLabels(getUiLang()))
  // Optional debug switch: enable CDP only in dev with SLIDES_CDP_PORT explicitly set (for
  // automated testing/troubleshooting); packaged builds (isPackaged) are unaffected.
  if (!app.isPackaged && process.env.SLIDES_CDP_PORT) {
    app.commandLine.appendSwitch('remote-debugging-port', process.env.SLIDES_CDP_PORT)
    app.commandLine.appendSwitch('remote-allow-origins', '*')
  }
  // GENOFFICE_USER_DATA: test drivers point this at a scratch dir so automated
  // instances get their own userData AND single-instance lock (the lock is scoped
  // to userData), allowing parallel instances alongside a normal dev run.
  if (!app.isPackaged && process.env.GENOFFICE_USER_DATA) {
    app.setPath('userData', process.env.GENOFFICE_USER_DATA)
  }
  // The main process's Node fetch (undici) does not use the system proxy by default, so access
  // from mainland China to overseas LLM APIs like api.anthropic.com hits ETIMEDOUT on direct
  // connections. Route the global dispatcher through the proxy; the renderer (Chromium) uses
  // the system proxy on its own and is unaffected. Prefer environment variables (terminal
  // launches); packaged builds launched by double-click don't inherit terminal environment
  // variables, so fall back to Electron session.resolveProxy() reading the system proxy
  // settings.
  void applyMainProcessProxy()
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on('open-file', (event, path) => {
    event.preventDefault()
    if (app.isReady()) {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        openAndBuild(win.webContents, path, 1280).then((r) =>
          win.webContents.send('slides:opened', r),
        )
        win.focus()
      } else createSlidesWindow(path)
    } else pendingOpenPath = path
  })

  const argPath = process.argv.find((a) => a.toLowerCase().endsWith('.pptx'))
  if (argPath && existsSync(argPath)) pendingOpenPath = argPath

  app.whenReady().then(async () => {
    installRendererProtocol({ slides: join(__dirname, '../renderer') })
    setUiLang(normalizeLang(process.env.GENOFFICE_LANG ?? app.getLocale()))
    registerSlidesIpc()
    registerAiIpc()
    registerProjectIpc()
    Menu.setApplicationMenu(buildSlidesMenu())
    const win = createSlidesWindow(pendingOpenPath)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createSlidesWindow()
    })

    // Test-only: with SLIDES_SMOKE_SHOT=/path, take a screenshot after loading and quit
    if (!app.isPackaged && process.env.SLIDES_SMOKE_SHOT) {
      win.webContents.once('did-finish-load', async () => {
        await new Promise((r) => setTimeout(r, 1800))
        try {
          const info = await win.webContents.executeJavaScript(
            `({ thumbs: document.querySelectorAll('.thumb').length,` +
              ` canvases: document.querySelectorAll('canvas').length,` +
              ` empty: !!document.querySelector('.empty') })`,
          )

          console.log('SMOKE_INFO=' + JSON.stringify(info))
          const png = await win.webContents.capturePage()
          const { writeFileSync } = await import('node:fs')
          writeFileSync(process.env.SLIDES_SMOKE_SHOT!, png.toPNG())

          console.log('SMOKE_SHOT_OK')
        } catch (e) {
          console.error('SMOKE_ERR', e)
        }
        app.quit()
      })
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

export type { UniworkDocumentPolicy } from './uniwork-policy'
export { setUniworkDocumentPolicy } from './uniwork-policy'

/** Fires once per explicit user Save that wrote to the same path (UniWork seam). */
export function setSlidesUserSaveHook(hook: ((path: string) => void) | null): void {
  setUniworkUserSaveHook(hook)
}
