import { join } from 'node:path'
import { BrowserWindow, type IpcMain, type WebContents } from 'electron'
import type { UpdateUiState } from '../shared/update-api'
import { UPDATE_CHANNELS } from '../shared/update-api'

/**
 * The update window: a frameless card centered over the shell window —
 * non-modal since the settings entry landed, so it never blocks work; its
 * "minimize" action folds it away and Settings → About re-opens it on demand.
 * Content lives in renderer/update.html; this module owns the window
 * lifecycle, the pushed UI state, and the download / install / later IPC
 * surface, plus the settings-facing get-state / open-for-update entry. All six
 * channels are registered once by registerUpdateIpc on the ipc object the shell
 * composition passes in (the sender-guarded one), at main-process start, since
 * the shell window invokes get-state before any update is known.
 */

interface UpdateActions {
  onDownload: () => void
  onInstall: () => void
  onLater: () => void
  onOpenDownload: () => void
}

let updateWin: BrowserWindow | null = null
let currentState: UpdateUiState | null = null
let actions: UpdateActions | null = null
let parentGetter: () => BrowserWindow | null = () => null
/** fallback when no getter was registered (tests, direct callers) */
let lastParent: BrowserWindow | null = null
// distinguishes programmatic close (install/quit) from the user closing the
// window some other way (Alt+F4…), which counts as "later"
let closingProgrammatically = false

/** The shell window is recreated on macOS after close, so it is resolved per call, never cached. */
export function setUpdateParentWindow(getter: () => BrowserWindow | null): void {
  parentGetter = getter
}

function parentWindow(): BrowserWindow | null {
  const win = parentGetter() ?? lastParent
  return win && !win.isDestroyed() ? win : null
}

function broadcastState(): void {
  parentWindow()?.webContents.send(UPDATE_CHANNELS.stateChanged, currentState)
}

/**
 * Registers all six update:* channels on `ipc`, once, at main-process start.
 * get-state / open-for-update are invoked by the shell window from Settings →
 * About on mount — long before any update is known, which on a fresh launch
 * is every launch — so they cannot wait for showUpdateWindow: ipcRenderer.invoke
 * would reject with "No handler registered". currentState is null until the
 * updater reports something, and null is the answer ("no update known"), not an
 * error. The dialog's own channels read `actions`, which is only assigned
 * alongside the window, so their handlers tolerate `actions == null`.
 */
export function registerUpdateIpc(ipc: Pick<IpcMain, 'handle'>): void {
  ipc.handle(UPDATE_CHANNELS.getState, () => currentState)
  // Settings → About "update to vX": surface the dialog again (it may have
  // been minimized) and, when nothing has started yet, start the download.
  // Returns false while no update is known — the settings button stays
  // hidden in that state, so callers treat it as a no-op.
  ipc.handle(UPDATE_CHANNELS.openForUpdate, (): boolean => {
    if (!currentState) return false
    if (updateWin && !updateWin.isDestroyed()) {
      updateWin.show()
      updateWin.focus()
    } else {
      const parent = parentWindow()
      if (parent) showUpdateWindow(parent, currentState, actions ?? dummyActions)
    }
    if (currentState.phase === 'available' || currentState.phase === 'error') actions?.onDownload()
    return true
  })
  ipc.handle(UPDATE_CHANNELS.download, () => actions?.onDownload())
  ipc.handle(UPDATE_CHANNELS.install, () => actions?.onInstall())
  ipc.handle(UPDATE_CHANNELS.later, () => actions?.onLater())
  ipc.handle(UPDATE_CHANNELS.openDownload, () => actions?.onOpenDownload())
}

/** the live update window's webContents, read per call (null while it is closed); the own-window sender policy uses it */
export function updateWindowContents(): WebContents | null {
  return updateWin && !updateWin.isDestroyed() ? updateWin.webContents : null
}

/** keeps the handler total when actions are missing (cannot happen today) */
const dummyActions: UpdateActions = {
  onDownload: () => {},
  onInstall: () => {},
  onLater: () => {},
  onOpenDownload: () => {},
}

/** the freshest pushed state (null before the first update was ever seen) */
export function currentUpdateUiState(): UpdateUiState | null {
  return currentState
}

export function showUpdateWindow(
  parent: BrowserWindow | null,
  state: UpdateUiState,
  windowActions: UpdateActions,
): void {
  currentState = state
  actions = windowActions
  if (parent && !parent.isDestroyed()) lastParent = parent
  broadcastState()

  if (updateWin && !updateWin.isDestroyed()) {
    updateWin.webContents.send(UPDATE_CHANNELS.changed, currentState)
    updateWin.show()
    updateWin.focus()
    return
  }

  const win = new BrowserWindow({
    width: 400,
    height: 430,
    ...(parent && !parent.isDestroyed() ? { parent } : {}),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: state.strings.title,
    webPreferences: {
      preload: join(__dirname, '../preload/update.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  updateWin = win

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    updateWin = null
    if (!closingProgrammatically) actions?.onLater()
    closingProgrammatically = false
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/update.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/update.html'))
  }
}

export function isUpdateWindowOpen(): boolean {
  return updateWin !== null && !updateWin.isDestroyed()
}

export function pushUpdateState(patch: Partial<UpdateUiState>): void {
  if (!currentState) return
  currentState = { ...currentState, ...patch }
  if (updateWin && !updateWin.isDestroyed()) {
    updateWin.webContents.send(UPDATE_CHANNELS.changed, currentState)
  }
  broadcastState()
}

/** Forget the known update (channel switch): About stops offering it and open-for-update answers false. */
export function clearUpdateState(): void {
  closeUpdateWindow()
  currentState = null
  broadcastState()
}

export function closeUpdateWindow(): void {
  if (updateWin && !updateWin.isDestroyed()) {
    closingProgrammatically = true
    updateWin.close()
  }
  updateWin = null
}
