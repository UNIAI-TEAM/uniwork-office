import { join } from 'node:path'
import { BrowserWindow, type IpcMain, type WebContents } from 'electron'
import type { PdfPasswordUiState } from '../shared/pdf-password-api'
import { PDF_PASSWORD_CHANNELS } from '../shared/pdf-password-api'

/**
 * Password prompt for encrypted PDFs (P23): a frameless modal card centered
 * over the shell window, same lifecycle pattern as update-window.ts. One
 * promptPdfPassword() call resolves with one attempt (the entered password,
 * or null when the user cancels / closes the window). The window survives
 * across attempts — a rejected password re-prompts in place via pushed state
 * — and the caller closes it with closePdfPasswordDialog() when the retry
 * loop ends (success, cancel or unrelated failure).
 */

let pwWin: BrowserWindow | null = null
let currentState: PdfPasswordUiState | null = null
let pendingResolve: ((password: string | null) => void) | null = null

function settle(password: string | null): void {
  const resolve = pendingResolve
  pendingResolve = null
  resolve?.(password)
}

/**
 * Registers the window's three channels on `ipc` once, at main-process start (the
 * composition passes the sender-guarded object). Every handler is safe with no
 * pending prompt: state is null and settle() is a no-op.
 */
export function registerPdfPasswordIpc(ipc: Pick<IpcMain, 'handle'>): void {
  ipc.handle(PDF_PASSWORD_CHANNELS.getState, () => currentState)
  ipc.handle(PDF_PASSWORD_CHANNELS.submit, (_event, password: unknown) => {
    if (typeof password !== 'string') return
    pushState({ busy: true })
    settle(password)
  })
  ipc.handle(PDF_PASSWORD_CHANNELS.cancel, () => {
    settle(null)
    closePdfPasswordDialog()
  })
}

function pushState(patch: Partial<PdfPasswordUiState>): void {
  if (!currentState) return
  currentState = { ...currentState, ...patch }
  if (pwWin && !pwWin.isDestroyed()) {
    pwWin.webContents.send(PDF_PASSWORD_CHANNELS.changed, currentState)
  }
}

/** Ask the user for the PDF password; one call = one attempt. */
export function promptPdfPassword(
  parent: BrowserWindow | null,
  state: PdfPasswordUiState,
): Promise<string | null> {
  // a second prompt while one is pending would orphan the first caller —
  // resolve it as cancelled first (cannot happen in the single-flight export
  // path, but keeps the module safe on its own)
  settle(null)
  currentState = { ...state, busy: false }

  const promise = new Promise<string | null>((resolve) => {
    pendingResolve = resolve
  })

  if (pwWin && !pwWin.isDestroyed()) {
    pwWin.webContents.send(PDF_PASSWORD_CHANNELS.changed, currentState)
    pwWin.focus()
    return promise
  }

  const win = new BrowserWindow({
    width: 440,
    height: 312,
    ...(parent && !parent.isDestroyed() ? { parent, modal: true } : {}),
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
      preload: join(__dirname, '../preload/pdf-password.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  pwWin = win

  win.once('ready-to-show', () => win.show())
  // closing the window any other way (Alt+F4…) counts as cancel
  win.on('closed', () => {
    // a replaced window's late event must neither drop the new window nor cancel its pending prompt
    if (pwWin !== null && pwWin !== win) return
    pwWin = null
    settle(null)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/pdf-password.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/pdf-password.html'))
  }
  return promise
}

/** the live password window's webContents, read per call (null while it is closed); the own-window sender policy uses it */
export function pdfPasswordWindowContents(): WebContents | null {
  return pwWin && !pwWin.isDestroyed() ? pwWin.webContents : null
}

export function closePdfPasswordDialog(): void {
  if (pwWin && !pwWin.isDestroyed()) pwWin.close()
  pwWin = null
  currentState = null
}
