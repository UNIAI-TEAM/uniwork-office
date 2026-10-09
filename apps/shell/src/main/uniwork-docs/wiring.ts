import { app, BrowserWindow, dialog, type IpcMain, type WebContents } from 'electron'
import { join } from 'node:path'
import {
  UNIWORK_DOC_CHANNELS,
  type UniworkConflictChoice,
  type UniworkDocFormat,
  type UniworkDocListQuery,
} from '../../shared/home-api'
import {
  authorizedRequest,
  onUniworkAccountStatus,
  uniworkAccount,
  uniworkDeploymentProfile,
  uniworkSessionIdentity,
} from '../uniwork-auth'
import { setUniworkCloseGuard } from './close-guard'
import { createLaunchPusher } from './launch'
import { UniworkDocsService, type ConflictUi, type UnsavedCloseChoice } from './service'
import { tUniworkDocs } from './strings'

/**
 * Electron binding of the UniWork documents service: IPC handlers for every
 * HomeApi UniWork method, status and launch pushes to the shell window, the
 * native conflict dialogs (shown from main so they sit above module views),
 * and redeeming a held launch ticket once sign-in completes. Payloads carry
 * paths, ids, titles and states only; the access token never leaves main.
 */

export interface UniworkDocsWiring {
  shellWindow(): BrowserWindow | null
  shellContents(): WebContents | null
  openPath(path: string): boolean
  isPathOpen(path: string): boolean
  requestModuleSave(path: string): boolean
  reloadPath(path: string): void
  activePath(): string | undefined
  reveal(): void
  lang(): string
  defaultSaveDir(): string
}

const CHOICES: readonly UniworkConflictChoice[] = [
  'overwrite',
  'save-local-copy',
  'open-latest',
  'later',
]

function conflictUi(wiring: UniworkDocsWiring): ConflictUi {
  const t = (key: Parameters<typeof tUniworkDocs>[1], title?: string) =>
    tUniworkDocs(wiring.lang(), key, { title })
  const box = (options: Electron.MessageBoxOptions) => {
    const parent = wiring.shellWindow()
    return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)
  }
  return {
    async chooseConflict(title) {
      const { response } = await box({
        type: 'warning',
        title: t('conflictTitle'),
        message: t('conflictMessage', title),
        detail: t('conflictDetail'),
        buttons: [
          t('conflictOverwrite'),
          t('conflictSaveCopy'),
          t('conflictOpenLatest'),
          t('conflictLater'),
        ],
        defaultId: 3,
        cancelId: 3,
        noLink: true,
      })
      return CHOICES[response] ?? 'later'
    },
    async confirmDiscard(title) {
      const { response } = await box({
        type: 'warning',
        title: t('discardTitle'),
        message: t('discardMessage', title),
        detail: t('discardDetail'),
        buttons: [t('discardConfirm'), t('discardCancel')],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      return response === 0
    },
    async pickCopyPath(stem: string, format: UniworkDocFormat) {
      const parent = wiring.shellWindow()
      const options: Electron.SaveDialogOptions = {
        title: t('copyDialogTitle'),
        defaultPath: join(wiring.defaultSaveDir(), `${stem} ${t('copySuffix')}.${format}`),
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      }
      const picked = parent
        ? await dialog.showSaveDialog(parent, options)
        : await dialog.showSaveDialog(options)
      return picked.canceled || !picked.filePath ? null : picked.filePath
    },
    showOpenLatestFailed() {
      void box({ type: 'error', message: t('openLatestFailed'), buttons: ['OK'], noLink: true })
    },
    showCopyFailed() {
      void box({ type: 'error', message: t('copyFailed'), buttons: ['OK'], noLink: true })
    },
    async chooseUnsavedClose(title) {
      // over whichever window is closing (a detached editor or the shell)
      const focused = BrowserWindow.getFocusedWindow()
      const options: Electron.MessageBoxOptions = {
        type: 'warning',
        title,
        message: t('closeMessage'),
        detail: t('closeDetail'),
        buttons: [t('closeSave'), t('closeAnyway'), t('closeCancel')],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      }
      const { response } = focused
        ? await dialog.showMessageBox(focused, options)
        : await box(options)
      return CLOSE_CHOICES[response] ?? 'cancel'
    },
  }
}

const CLOSE_CHOICES: readonly UnsavedCloseChoice[] = ['save', 'close', 'cancel']

export interface UniworkDocsHandle {
  service: UniworkDocsService
  /**
   * At app ready, after the account started: redeems a held launch ticket
   * once sign-in completes, and routes launch links from now on.
   */
  activate(startLaunch: (route: (url: string) => void) => void): void
}

/** Registers the IPC handlers (safe before app ready: nothing touches the account yet). */
export function createUniworkDocs(ipcMain: IpcMain, wiring: UniworkDocsWiring): UniworkDocsHandle {
  const push = (channel: string, payload: unknown) => {
    const wc = wiring.shellContents()
    if (wc && !wc.isDestroyed()) wc.send(channel, payload)
  }
  const service = new UniworkDocsService({
    userDataDir: app.getPath('userData'),
    profile: () => uniworkDeploymentProfile(),
    identity: () => uniworkSessionIdentity(),
    selectedOrgId: () => uniworkAccount().status().org?.id ?? null,
    authorized: (call) => authorizedRequest(call),
    openPath: (path) => wiring.openPath(path),
    isPathOpen: (path) => wiring.isPathOpen(path),
    requestModuleSave: (path) => wiring.requestModuleSave(path),
    reloadPath: (path) => wiring.reloadPath(path),
    activePath: () => wiring.activePath(),
    ui: conflictUi(wiring),
    pushStatus: (status) => push(UNIWORK_DOC_CHANNELS.docStatusEvent, status),
    pushLaunch: createLaunchPusher(() => wiring.shellContents(), UNIWORK_DOC_CHANNELS.launchEvent),
    reveal: () => wiring.reveal(),
  })

  ipcMain.handle(UNIWORK_DOC_CHANNELS.listWorkspaces, () => service.listWorkspaces())
  ipcMain.handle(UNIWORK_DOC_CHANNELS.listDocuments, (_event, query: unknown) =>
    service.listDocuments((query ?? {}) as UniworkDocListQuery),
  )
  ipcMain.handle(UNIWORK_DOC_CHANNELS.openDocument, (_event, documentId: unknown) =>
    service.openDocument(documentId as string),
  )
  ipcMain.handle(UNIWORK_DOC_CHANNELS.docStatus, (_event, path: unknown) =>
    service.docStatus(path as string),
  )
  ipcMain.handle(UNIWORK_DOC_CHANNELS.activeDocStatus, () => service.activeDocStatus())
  ipcMain.handle(UNIWORK_DOC_CHANNELS.save, (_event, path: unknown) => service.save(path as string))
  ipcMain.handle(UNIWORK_DOC_CHANNELS.resolveConflict, (_event, path: unknown) =>
    service.resolveConflict(path as string),
  )
  setUniworkCloseGuard(service)

  return {
    service,
    activate(startLaunch) {
      let signedIn = uniworkAccount().status().state === 'signed-in'
      onUniworkAccountStatus((status) => {
        const now = status.state === 'signed-in'
        if (now && !signedIn) void service.launch.onSignedIn()
        signedIn = now
      })
      startLaunch((url) => void service.launch.handleUrl(url))
    },
  }
}
