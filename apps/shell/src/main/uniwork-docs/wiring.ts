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
  setUniworkSignOutHooks,
  uniworkAccount,
  uniworkDeploymentProfile,
  uniworkSessionIdentity,
} from '../uniwork-auth'
import { AccountBoundary } from './account-boundary'
import { setUniworkCloseGuard } from './close-guard'
import { createLaunchPusher } from './launch'
import {
  UniworkDocsService,
  type ConflictUi,
  type UnsavedCloseChoice,
  type UnsavedCloseKind,
} from './service'
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
  requestModuleSave(path: string, onNotWritten?: () => void): boolean
  reloadPath(path: string): void
  activePath(): string | undefined
  reveal(): void
  lang(): string
  defaultSaveDir(): string
  /** every file path a tab or detached editor window shows */
  openPaths(): string[]
  /** the normal close of the tab or window showing `path` (prompts included); true = closed */
  closePath(path: string): Promise<boolean>
  /** only the close prompts for the tab or window showing `path`; nothing closes; true = go ahead */
  confirmClosePath(path: string): Promise<boolean>
  /** closes the tab or window showing `path` with no prompt */
  closePathNow(path: string): void
  /** every file path the AI chat store knows */
  aiHistoryPaths(): string[]
  /** deletes the AI chat history and project entries of these paths */
  forgetAiHistory(paths: string[]): void
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
    async chooseConflict(title, signal) {
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
        ...(signal ? { signal } : {}),
      })
      return CHOICES[response] ?? 'later'
    },
    async confirmDiscard(title, signal) {
      const { response } = await box({
        type: 'warning',
        title: t('discardTitle'),
        message: t('discardMessage', title),
        detail: t('discardDetail'),
        buttons: [t('discardConfirm'), t('discardCancel')],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        ...(signal ? { signal } : {}),
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
    async chooseUnsavedClose(title, kind, reason) {
      // over whichever window is closing (a detached editor or the shell)
      const focused = BrowserWindow.getFocusedWindow()
      const choices = CLOSE_CHOICES[kind]
      const labels = {
        save: t('closeSave'),
        resolve: t('closeResolve'),
        close: t('closeAnyway'),
        cancel: t('closeCancel'),
      }
      const options: Electron.MessageBoxOptions = {
        type: 'warning',
        title,
        message: t('closeMessage'),
        detail:
          kind === 'conflict'
            ? t('closeConflictDetail')
            : kind === 'blocked'
              ? t(blockedReasonKey(reason))
              : t('closeDetail'),
        buttons: choices.map((choice) => labels[choice]),
        // a blocked document has no Save: the safe default is to keep it open
        defaultId: kind === 'blocked' ? choices.indexOf('cancel') : 0,
        cancelId: choices.indexOf('cancel'),
        noLink: true,
      }
      const { response } = focused
        ? await dialog.showMessageBox(focused, options)
        : await box(options)
      return choices[response] ?? 'cancel'
    },
  }
}

/** the buttons of each close prompt, in order; the first is the default (except blocked) */
const CLOSE_CHOICES: Record<UnsavedCloseKind, readonly UnsavedCloseChoice[]> = {
  unsent: ['save', 'close', 'cancel'],
  conflict: ['resolve', 'close', 'cancel'],
  blocked: ['close', 'cancel'],
}

function blockedReasonKey(reason: string | undefined): Parameters<typeof tUniworkDocs>[1] {
  if (reason === 'not_found') return 'closeBlockedNotFound'
  if (reason === 'deleted') return 'closeBlockedDeleted'
  return 'closeBlockedOther'
}

export interface UniworkDocsHandle {
  service: UniworkDocsService
  boundary: AccountBoundary
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
    requestModuleSave: (path, onNotWritten) => wiring.requestModuleSave(path, onNotWritten),
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
  // Sign out and a sign-in as someone else close the previous account's
  // documents and delete their AI history (see account-boundary.ts)
  const boundary = new AccountBoundary({
    root: service.store.root,
    openPaths: () => wiring.openPaths(),
    closeDocument: (path) => wiring.closePath(path),
    confirmClose: (path) => wiring.confirmClosePath(path),
    closeNow: (path) => wiring.closePathNow(path),
    aiHistoryPaths: () => wiring.aiHistoryPaths(),
    forgetAiHistory: (paths) => wiring.forgetAiHistory(paths),
    closeConflictPrompt: () => service.closeConflictPrompt(),
  })
  setUniworkSignOutHooks({
    before: () => boundary.beforeSignOut(),
    after: () => boundary.afterSignOut(),
  })

  return {
    service,
    boundary,
    activate(startLaunch) {
      let signedIn = uniworkAccount().status().state === 'signed-in'
      onUniworkAccountStatus((status) => {
        // the session's account may have changed: it becomes the last owner
        service.noteSessionIdentity()
        const identity = uniworkSessionIdentity()
        if (identity) void boundary.enforce(identity).catch(() => undefined)
        const now = status.state === 'signed-in'
        if (now && !signedIn) void service.launch.onSignedIn()
        signedIn = now
      })
      startLaunch((url) => void service.launch.handleUrl(url))
    },
  }
}
