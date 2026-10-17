import {
  app,
  BrowserWindow,
  dialog,
  safeStorage,
  shell,
  type IpcMain,
  type WebContents,
} from 'electron'
import { randomUUID } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import { showSaveDialogWithMemory } from '@genoffice/electron-utils'
import { COMMENTS_CHANNELS } from '@genoffice/electron-utils/comments-ipc'
import {
  UNIWORK_DOC_CHANNELS,
  type AccountStatus,
  type SignOutPlan,
  type SignOutProgress,
  type SignOutPromptAnswer,
  type SignOutPromptRequest,
  type UniworkConflictAction,
  type UniworkCreateDocInput,
  type UniworkCreateFolderInput,
  type UniworkFirstSaveInput,
  type UniworkDocListQuery,
  type UniworkDocLock,
  type UniworkFolderQuery,
  type UniworkMoveDocumentInput,
  type UniworkRemoteAction,
  type UniworkSearchQuery,
  type UniworkUploadDocInput,
  type UniworkSharedQuery,
} from '../../shared/home-api'
import { createLaunchPusher, createPushHolder, type LaunchPushTarget } from './launch'
import {
  applyUniworkProfile,
  authorizedRequest,
  onUniworkAccountStatus,
  setUniworkSignOutHooks,
  uniworkAccount,
  uniworkAppChannel,
  uniworkDeploymentProfile,
  uniworkSessionIdentity,
} from '../uniwork-auth'
import { AccountBoundary } from './account-boundary'
import {
  createUniworkComments,
  type DiscussionPushTarget,
  type UniworkCommentsHandle,
} from './comments-wiring'
import type { CommentsRevealPayload } from '@genoffice/electron-utils/comments-ipc'
import { setUniworkCloseGuard } from './close-guard'
import { createSafeStorageKeyProvider } from '../uniwork-sync/keys'
import {
  SyncRuntime,
  createLeaseClient,
  type LeaseClient,
  type SyncRuntimeTargets,
} from '../uniwork-sync/runtime'
import {
  createSyncStoreAccess,
  SYNC_STORE_REGISTRATIONS,
  type SyncStoreAccess,
} from '../uniwork-sync/session-store'
import { createStoreLayer, type StoreLayer } from '../uniwork-sync/store'
import {
  OFFLINE_LIBRARY_LAYER_BUDGET_BYTES,
  OFFLINE_LIBRARY_STORE_REGISTRATION,
} from '../uniwork-sync/offline-library'
import { createFeedClient, type FeedClient } from '../uniwork-sync/feed/client'
import { createCapabilityFetch } from '../uniwork-sync/capability/client'
import {
  CapabilityCache,
  NEVER_READ_CAPABILITIES,
  type CapabilityRead,
} from '../uniwork-sync/capability/cache'
import { createUniworkDocsClient, type FetchLike, type UniworkDocsClient } from './client'
import {
  UniworkDocsService,
  type ConflictUi,
  type OfflineCopyOpen,
  type SessionIdentity,
  type UnsavedCloseChoice,
  type UnsavedCloseKind,
} from './service'
import { UPLOAD_EXTENSIONS } from './formats'
import { scopeWorkingCopyDirs } from './binding-store'
import { tUniworkDocs } from './strings'
import { createTreeChangedCoalescer } from './tree-changed'
import { registerFirstSaveOpenAck } from './first-save-open'
import { UNIWORK_SYNC_CENTER_CHANNELS } from '../../shared/sync-center'
import { createWiredSyncCenter } from '../uniwork-sync/sync-center'
import { createOfflineCopies } from '../uniwork-sync/offline-library/copies'
import {
  createOfflineLibraryApi,
  registerOfflineLibraryIpc,
  type OfflineLibraryApi,
} from '../uniwork-sync/offline-library/api'
import { offlineHeadIds } from '../uniwork-sync/offline-library/view'
import { clipboard } from 'electron'

/**
 * Electron binding of the UniWork documents service: IPC handlers for every
 * HomeApi UniWork method, status, conflict and launch pushes to the shell
 * window, and redeeming a held launch ticket once sign-in completes. Payloads
 * carry paths, ids, titles and states only; the access token never leaves main.
 */

export interface UniworkDocsWiring {
  shellWindow(): BrowserWindow | null
  shellContents(): WebContents | null
  openPath(path: string): boolean
  /**
   * True when `path` is a working copy whose folder declares a store this build
   * does not read: the shell records the lock (S11 panel) instead of opening a
   * module, and nothing is downloaded or written.
   */
  refuseLockedPath(path: string): boolean
  isPathOpen(path: string): boolean
  requestModuleSave(path: string, onNotWritten?: () => void, mode?: 'save' | 'capture'): boolean
  reloadPath(path: string): void
  /**
   * G5-03a: the FRESH editor state of one path, summed over every view that
   * shows it (tab, detached window, present view of its owner tab): unsaved
   * edits (null = no view answered), any running AI turn, and the sum of the
   * views' AI epochs (never decreases). The guarded clean reload reads this
   * before and after its fetch; it is never served from the 1 s poll cache.
   */
  editorStateOf(
    path: string,
  ): Promise<{ dirty: boolean | null; aiRunning: boolean; aiEpoch: number }>
  activePath(): string | undefined
  reveal(): void
  /**
   * G8-08: the editor webContents showing `path` (tab or detached window), for
   * the comments reveal push; undefined when nothing shows it.
   */
  commentsTarget?(path: string): LaunchPushTarget | undefined
  /**
   * G8-08/R1-2: the path an editor webContents shows, so its held reveal is
   * pulled for exactly that path; undefined when nothing shows one.
   */
  commentsPathFor?(sender: { id: number }): string | undefined
  /**
   * G8-11: the file paths open as tabs of the window whose shell webContents
   * is `sender`; null for any other sender (the discussion bridge is refused).
   */
  discussionTabPaths?(sender: { id: number }): readonly string[] | null
  /** G8-11: the shell webContents that has `path` open as a tab, for the reveal push */
  discussionTarget?(path: string): DiscussionPushTarget | null
  /**
   * G8-11: narrow / restore the active editor view of the sender's window
   */
  setDiscussionPanel?(sender: { id: number }, panel: { open: boolean; width: number }): void
  /**
   * ADVISOR D4 (a): this build's packaging flag (index.ts passes
   * app.isPackaged), read by the dev-only S6 display fixture. Optional and
   * absent = packaged, so a wiring that does not set it keeps the fixture off.
   */
  isPackaged?: boolean
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
  /**
   * S18: an open working copy got a new name; the shell re-keys its tab and the
   * module follows (the desktop equivalent of the X-02 `file.renamed` event).
   */
  notifyPathRenamed(oldPath: string, newPath: string): void
  /**
   * S18: an open working copy keeps its file name (an editor holds it), so the
   * shell re-titles the open tab/window by path and the module follows through
   * its own rename IPC; no file moves. Absent in tests that do not open tabs.
   */
  notifyTitleRenamed?(path: string, title: string): void
  /** G5-09 S5: whether an AI turn is running in the editor showing `path` */
  isAiRunning?(path: string): boolean
  /** G5-09 S5: stops the AI turn running in the editor showing `path` */
  stopAiRun?(path: string): void
}

/** the one question a web link may ask: connect this install to the server it names? */
async function confirmConnect(wiring: UniworkDocsWiring, origin: string): Promise<boolean> {
  const t = (key: Parameters<typeof tUniworkDocs>[1], title?: string) =>
    tUniworkDocs(wiring.lang(), key, { title })
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    title: t('connectTitle'),
    message: t('connectMessage', origin),
    detail: t('connectDetail'),
    buttons: [t('connectYes'), t('connectNo')],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }
  const parent = wiring.shellWindow()
  const { response } = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options)
  return response === 0
}

/**
 * S18 upload: the native open dialog. The filters follow the formats UniWork
 * Office can open (a file of any other type would be uploaded but never
 * openable here); a cancelled dialog is null and no request is made.
 */
async function pickUploadFile(
  wiring: UniworkDocsWiring,
): Promise<{ path: string; name: string } | null> {
  const parent = wiring.shellWindow()
  const options: Electron.OpenDialogOptions = {
    title: tUniworkDocs(wiring.lang(), 'uploadPickTitle'),
    properties: ['openFile'],
    filters: [
      {
        name: tUniworkDocs(wiring.lang(), 'uploadPickDocuments'),
        extensions: [...UPLOAD_EXTENSIONS],
      },
    ],
  }
  const picked = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  const path = picked.canceled ? undefined : picked.filePaths[0]
  if (!path) return null
  return { path, name: basename(path) }
}

/**
 * G5-12 "Download my version": the native save dialog over the shell window.
 * The suggested name is the copy name (`{name} (my version).docx`); a cancelled
 * dialog is null.
 */
async function pickDownloadPath(
  wiring: UniworkDocsWiring,
  defaultName: string,
): Promise<string | null> {
  const picked = await showSaveDialogWithMemory(
    dialog,
    wiring.shellWindow(),
    {
      defaultPath: defaultName,
      filters: [
        {
          name: tUniworkDocs(wiring.lang(), 'uploadPickDocuments'),
          extensions: [extname(defaultName).slice(1) || '*'],
        },
      ],
    },
    wiring.defaultSaveDir(),
  )
  return picked.canceled || !picked.filePath ? null : picked.filePath
}

function conflictUi(wiring: UniworkDocsWiring): ConflictUi {
  const t = (key: Parameters<typeof tUniworkDocs>[1], title?: string) =>
    tUniworkDocs(wiring.lang(), key, { title })
  const box = (options: Electron.MessageBoxOptions) => {
    const parent = wiring.shellWindow()
    return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)
  }
  return {
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
  // `document_archived` deliberately keeps the generic sentence: the block is an
  // info-tone state the user can lift (unarchive, then reopen), not the loss the
  // deleted/not-found copy describes, and no dedicated string is spent on it
  return 'closeBlockedOther'
}

export interface UniworkDocsHandle {
  service: UniworkDocsService
  boundary: AccountBoundary
  /** G8-08: the comments IPC/reveal handle (registered with the documents handlers) */
  comments: UniworkCommentsHandle
  /**
   * At app ready, after the account started: redeems a held launch ticket
   * once sign-in completes, and routes launch links from now on.
   */
  activate(startLaunch: (route: (url: string) => void) => void): void
  /**
   * G6-05: the UniWork binding a UniWork AI turn runs against (document +
   * its org), 'hidden' for another account's copy, null for a local file.
   */
  aiBinding(path: string): { documentId: string; orgId: string } | 'hidden' | null
  /** G6-05: the per-org capability read (shared cache, TTL rule) UniWork AI availability uses */
  capabilityRead(orgId: string): Promise<CapabilityRead>
  /** G5-05u: the offline library (S3 tab, the tab menu's pin/unpin, S11 refusals) */
  offline: OfflineLibraryApi
}

/** the binding of a path as UniWork AI sees it (see UniworkDocsHandle.aiBinding) */
export function uniworkAiBinding(
  service: Pick<UniworkDocsService, 'store' | 'owns'>,
  path: string,
): { documentId: string; orgId: string } | 'hidden' | null {
  const doc = service.store.lookup(path)
  if (!doc) return service.store.isInside(path) ? 'hidden' : null
  if (!service.owns(doc)) return 'hidden'
  return { documentId: doc.binding.documentId, orgId: doc.binding.orgId }
}

/** encrypted bytes the account's sync store (queue + drafts, not the offline library) may keep: 1 GiB (OQ-UX2) */
export const SYNC_STORE_BUDGET_BYTES = 1024 * 1024 * 1024

/**
 * The durable sync store of the session. One key provider (keys wrapped by
 * Electron safeStorage) and one layer under `userData/uniwork-sync/`, holding
 * every store this build registers; the records are encrypted, budgeted and
 * locked at the account boundary. The wrapped keys sit beside the layer root,
 * outside the scope, so unlocking after a sign-out reads them again.
 */
export function createSyncStoreLayer(root: string): StoreLayer {
  const layer = createStoreLayer({
    root: join(root, 'store'),
    keys: createSafeStorageKeyProvider({ safeStorage, dir: join(root, 'keys') }),
    budgetBytes: SYNC_STORE_BUDGET_BYTES,
    clock: () => Date.now(),
  })
  // one list (session-store.ts) so the layer and the store compliance test agree;
  // G5-08c's lease store is in it
  for (const reg of SYNC_STORE_REGISTRATIONS) layer.register(reg)
  return layer
}

/** the layer and the session's access to it: one pair per userData root */
const syncStores = new Map<string, { layer: StoreLayer; access: SyncStoreAccess }>()

function syncStoreFor(): { layer: StoreLayer; access: SyncStoreAccess } {
  const root = join(app.getPath('userData'), 'uniwork-sync')
  let found = syncStores.get(root)
  if (!found) {
    const layer = createSyncStoreLayer(root)
    const access = createSyncStoreAccess({
      layer,
      scope: () => {
        const identity = uniworkSessionIdentity()
        return identity
          ? { deploymentId: identity.deploymentId, accountId: identity.accountId }
          : null
      },
    })
    found = { layer, access }
    syncStores.set(root, found)
  }
  return found
}

/**
 * G5-05: the offline library's own encrypted layer under
 * `userData/uniwork-sync/library/` - its own root, safeStorage-wrapped key per
 * scope and budget, so pinned bytes never count against the sync store budget
 * (lead decision on W5 "A"). Wiped at the account boundary beside the sync
 * scope. Residual: moves into G5-11's SYNC_STORE_REGISTRATIONS when it lands.
 */
const libraryLayers = new Map<string, StoreLayer>()

function libraryLayerFor(): StoreLayer {
  const root = join(app.getPath('userData'), 'uniwork-sync', 'library')
  let layer = libraryLayers.get(root)
  if (!layer) {
    layer = createStoreLayer({
      root: join(root, 'store'),
      keys: createSafeStorageKeyProvider({ safeStorage, dir: join(root, 'keys') }),
      budgetBytes: OFFLINE_LIBRARY_LAYER_BUDGET_BYTES,
      clock: () => Date.now(),
    })
    layer.register(OFFLINE_LIBRARY_STORE_REGISTRATION)
    libraryLayers.set(root, layer)
  }
  return layer
}

/**
 * Test seams of the feed runtime: the HTTP round trip of the capability and
 * feed clients, and the clock their caches read. Production leaves both out.
 */
export interface SyncRuntimeSeam {
  fetch?: FetchLike
  now?(): number
  /**
   * FD-11: a committed feed page carried rows for this workspace, so its tree
   * views are stale. The wiring hands this to the push coalescer.
   */
  treeChanged?(workspaceId: string): void
  /**
   * G5-05u (B3): an offline library row changed (state, progress). The wiring
   * hands this to the sync center's push, throttled per row.
   */
  libraryChanged?(documentId: string): void
}

/**
 * G8-16 S16: the one organization the change-feed may touch - the chosen org
 * of the signed-in account, and only once the choice is made. Null while the
 * picker is up (or no org is chosen), so no capability, workspace or feed call
 * can run for a non-selected org or before the choice. Read on every pass, so
 * a pass that outlives its choice makes no call either.
 */
export function feedOrgId(status: AccountStatus): string | null {
  if (status.state !== 'signed-in' || status.needsOrgChoice) return null
  return status.org?.id ?? null
}

/**
 * The change-feed runtime of the shell: one FeedConsumer per (org, workspace)
 * of the signed-in account, over the shared durable store, started on sign-in
 * and re-run on a 60 s poll. There is no desktop realtime channel today, so
 * this poll (plus a pass per sign-in) is the whole mechanism. Clients are
 * rebuilt when the deployment origin changes; capabilities are cached per org
 * FOR ONE ACCOUNT - a same-origin account switch clears the cache, so the
 * outgoing account's org flags are never served to the incoming one.
 * A capability or feed 401 asks the account to re-evaluate its session.
 */
export function createSyncRuntime(
  service: UniworkDocsService,
  seam: SyncRuntimeSeam = {},
): SyncRuntime {
  let origin: string | null = null
  /** the account the capability cache belongs to: '', or `deployment/account` */
  let account = ''
  let docs: UniworkDocsClient | null = null
  let feed: FeedClient | null = null
  let lease: LeaseClient | null = null
  const clock = { now: () => seam.now?.() ?? Date.now() }
  let capability: CapabilityCache = new CapabilityCache({
    fetch: () => Promise.resolve({ status: 0, body: undefined }),
    clock,
  })
  const clients = (): {
    docs: UniworkDocsClient
    feed: FeedClient
    capability: CapabilityCache
    lease: LeaseClient
  } | null => {
    const profile = uniworkDeploymentProfile()
    if (!profile) return null
    const identity = uniworkSessionIdentity()
    const token = identity ? `${identity.deploymentId}/${identity.accountId}` : ''
    if (origin !== profile.apiOrigin) {
      origin = profile.apiOrigin
      account = token
      const options = {
        apiOrigin: profile.apiOrigin,
        authorized: <T>(call: (token: string) => Promise<T>) => authorizedRequest(call),
        isSignedIn: () => uniworkSessionIdentity() !== null,
        ...(seam.fetch ? { fetch: seam.fetch } : {}),
      }
      docs = createUniworkDocsClient(options)
      feed = createFeedClient(options)
      // G5-08c: the offline lease client rides the same authenticated profile
      lease = createLeaseClient(options)
      capability = new CapabilityCache({
        fetch: createCapabilityFetch(options),
        clock,
      })
    } else if (account !== token) {
      // the boundary is the identity, not the origin: cached per-org flags of
      // the outgoing account must never answer for the incoming one (R1-be-8)
      account = token
      capability.clear()
    }
    return docs && feed && lease ? { docs, feed, capability, lease } : null
  }
  const targets: SyncRuntimeTargets = {
    // G8-16 S16: the chosen org of the live session only. The feed never
    // touches another org of the account, a non-active one, or anything at
    // all while the picker is up (this is read on every pass).
    orgs: () => {
      const orgId = feedOrgId(uniworkAccount().status())
      return orgId ? [orgId] : []
    },
    workspaces: async (orgId) => {
      const found = clients()
      if (!found) return []
      return (await found.docs.listWorkspaces(orgId)).map((workspace) => workspace.id)
    },
  }
  const runtime: SyncRuntime = new SyncRuntime({
    store: syncStoreFor().access,
    // S18: a change the feed applies for a bound document re-reads its metadata,
    // so a rename on the web reaches the open desktop copy
    // the change's revision, so the echo of this service's own rename is
    // recognised by it and a genuine later change is never swallowed (R1-6)
    // G5-03a: the same change IS the S6 newer-version notice (head version +
    // version id), so one feed tick drives both
    onFeedChange: (change) => service.noteFeedChange(change.documentId, change.revision, change),
    // FD-11: a committed page with rows makes that workspace's tree stale; the
    // seam hands it to the coalescer the shell pushes through
    ...(seam.treeChanged ? { onWorkspaceChanged: seam.treeChanged } : {}),
    // G5-03a: a full resync that no longer lists an open, bound document asks
    // the service to classify it (403/404 -> revoked, 410 -> deleted); the
    // runtime learns ids only, never paths
    isOpenBound: (documentId) => service.isOpenBound(documentId),
    onFeedGone: (documentId) => {
      void service.noteFeedGone(documentId).catch(() => undefined)
      // T5-3: a pinned document, closed too, is classified by the library
      // (403/404 -> revoked, 410 -> deleted)
      void runtime.library?.refresh(documentId).catch(() => undefined)
    },
    targets,
    capability: async (orgId, options) => {
      const found = clients()
      if (!found) {
        return {
          kind: 'ok' as const,
          capabilities: { ...NEVER_READ_CAPABILITIES },
          source: 'default' as const,
        }
      }
      return found.capability.get(orgId, options)
    },
    client: () => clients()?.feed ?? null,
    lease: {
      client: () => clients()?.lease ?? null,
      session: () => uniworkSessionIdentity()?.deviceSessionId ?? null,
    },
    library: {
      layer: libraryLayerFor(),
      docs: () => clients()?.docs ?? null,
      hasLocalWork: (documentId) => service.hasLocalDraft(documentId),
      // G5-05u (B3): every row change reaches the sync center's push
      ...(seam.libraryChanged ? { onChange: seam.libraryChanged } : {}),
    },
    keepDraft: (documentId) => service.hasLocalDraft(documentId),
    clock: { now: () => Date.now() },
    // the same poll drives the durable save queue: dispatch the pending intents
    // and advance their reconciling clocks on every pass (sign-in + interval),
    // and mirror the pass's connectivity onto the queue's waiting intents (a
    // failed round trip parks them, a working one wakes them)
    onPoll: async (online) => {
      await service.restoreParked?.()
      // `undefined` = the pass had nothing to do (no chosen org, no scope): no
      // verdict to apply, so the queue's intents are left where they are
      // (G506-be-3). A real failed round trip parks them, a reached one wakes them
      if (online !== undefined) await service.setQueueOnline?.(online)
      await service.pollSaveQueue?.()
    },
    onSessionExpired: () => {
      // a capability or feed 401: the account re-reads the session and applies
      // its own state (keystore-locked, signed-out, restoring, ...)
      void uniworkAccount()
        .retry()
        .catch(() => undefined)
    },
    log: (message) => console.warn(message),
  })
  return runtime
}

async function promptSignOutFallback(
  wiring: UniworkDocsWiring,
  plan: SignOutPlan,
): Promise<boolean> {
  const lang = wiring.lang()
  const count = Math.max(plan.count, plan.ramOnly)
  const detail =
    plan.keystoreLocked && plan.ramOnly > 0 && plan.count === 0
      ? tUniworkDocs(lang, 'signOutKeystore')
      : tUniworkDocs(lang, 'signOutBody', { count })
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    title: tUniworkDocs(lang, 'signOutTitle'),
    message: tUniworkDocs(lang, 'signOutTitle'),
    detail,
    buttons: [tUniworkDocs(lang, 'signOutGo'), tUniworkDocs(lang, 'signOutBack')],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }
  const parent = wiring.shellWindow()
  const { response } = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options)
  return response === 0
}

/**
 * Q2 = a: the native notice after an account switch lost RAM-only content of
 * the previous account (no shell renderer to show it). One button; the lock
 * already happened, so nothing waits on it.
 */
async function noticeSwitchLossFallback(
  wiring: UniworkDocsWiring,
  plan: SignOutPlan,
): Promise<void> {
  const lang = wiring.lang()
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    title: tUniworkDocs(lang, 'switchLostTitle'),
    message: tUniworkDocs(lang, 'switchLostTitle'),
    detail: tUniworkDocs(lang, 'switchLostBody', { count: plan.ramOnly }),
    buttons: [tUniworkDocs(lang, 'switchLostOk')],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }
  const parent = wiring.shellWindow()
  if (parent) await dialog.showMessageBox(parent, options)
  else await dialog.showMessageBox(options)
}

/** Registers the IPC handlers (safe before app ready: nothing touches the account yet). */
export function createUniworkDocs(ipcMain: IpcMain, wiring: UniworkDocsWiring): UniworkDocsHandle {
  // told as a document status or the lock list is pushed (the sync center re-reads its snapshot)
  const changeListeners: Array<() => void> = []
  const push = (channel: string, payload: unknown) => {
    if (
      channel === UNIWORK_DOC_CHANNELS.docStatusEvent ||
      channel === UNIWORK_DOC_CHANNELS.locksChanged
    ) {
      for (const listener of changeListeners) listener()
    }
    const wc = wiring.shellContents()
    if (wc && !wc.isDestroyed()) wc.send(channel, payload)
  }
  const syncStore = syncStoreFor().access
  /**
   * FD-11: the one tree-changed push of this process. A feed page (through the
   * runtime) and this app's own folder actions (through the service) both report
   * here; the coalescer turns a burst into at most one push per workspace per
   * 500 ms. Only the workspace id leaves main.
   */
  const treeChanged = createTreeChangedCoalescer({
    emit: (workspaceId) => push(UNIWORK_DOC_CHANNELS.treeChanged, { workspaceId }),
  })
  // the service is built before the runtime, but its save queue reads the
  // runtime's capability cache: this holder breaks the cycle (the read happens
  // only after `createSyncRuntime` assigned it, below)
  const seamRef: { runtime: SyncRuntime | null } = { runtime: null }
  /**
   * G5-05u: the offline library is built after the service (it rides the runtime)
   * but the service opens its cached copy: this holder breaks the cycle.
   */
  const offlineRef: { open: (documentId: string) => Promise<OfflineCopyOpen> } = {
    open: async () => null,
  }
  /**
   * The runtime is built before the sync center: these are its two late-bound
   * callbacks - a row change and the debounced re-read the push runs.
   */
  let offlineRowChanged: (documentId: string) => void = () => undefined
  let offlinePush: () => void = () => undefined
  /**
   * G5-09 R2 (B7): the documents whose HEAD is the committed offline copy, read
   * off the rows of the last snapshot (the S5 "Tải lại" of a dirty working copy
   * checks this synchronously, so it cannot await the library).
   */
  const offlineHead = new Set<string>()
  /**
   * G5-11 be-3: true while the feed runtime is started. lockSession's step 1
   * stops it through `stopRuntime` on every path (including the account switch
   * that never reaches `lockStore`), and a same-org switch then re-runs the
   * status handler with `target === feedOrg`: the flag is what tells the
   * handler that the pass it should be running is gone and must start again.
   */
  let feedRunning = false
  // the comments handle is built after the service (it resolves bindings through
  // it) but the service needs it for the launch-ticket reveal: a holder breaks
  // the cycle, and the reveal only runs once both exist
  let comments: UniworkCommentsHandle | null = null
  const service = new UniworkDocsService({
    userDataDir: app.getPath('userData'),
    syncStore,
    storeUsage: async () => {
      const store = syncStoreFor()
      const scope = store.access.scope()
      return scope ? store.layer.usage(scope) : null
    },
    appVersion: () => app.getVersion(),
    profile: () => uniworkDeploymentProfile(),
    channel: () => uniworkAppChannel(),
    applyProfile: (profile) =>
      applyUniworkProfile(profile, { confirm: (origin) => confirmConnect(wiring, origin) }),
    identity: () => uniworkSessionIdentity(),
    // a locked keychain is the account's state, not the session's: a cold
    // restore has no session and must still lock the saved account's copies
    keystoreLocked: () => uniworkAccount().status().state === 'keystore-locked',
    selectedOrg: () => {
      const org = uniworkAccount().status().org
      return org ? { id: org.id, slug: org.slug } : null
    },
    authorized: (call) => authorizedRequest(call),
    openPath: (path) => {
      // G5-04g: a newer store is refused before any module sees the path
      if (wiring.refuseLockedPath(path)) return false
      return wiring.openPath(path)
    },
    isPathOpen: (path) => wiring.isPathOpen(path),
    requestModuleSave: (path, onNotWritten, mode) =>
      wiring.requestModuleSave(path, onNotWritten, mode),
    reloadPath: (path) => wiring.reloadPath(path),
    // G5-03a: the fresh editor state of one path (W2's live read; the wiring
    // placeholder is what index.ts installs today)
    editorStateOf: (path) => wiring.editorStateOf(path),
    activePath: () => wiring.activePath(),
    // G5-11 be-3: lockSession's own step 1/3 hooks, wired to the real runtime and
    // the real tab/window/AI-history surfaces, so the account switch (which runs
    // `lockSession`, not `lockStore`) stops the feed pass and closes the outgoing
    // account's views without a prompt too
    stopRuntime: () => stopFeed(),
    openPaths: () => wiring.openPaths(),
    closePathNow: (path) => wiring.closePathNow(path),
    aiHistoryPaths: () => wiring.aiHistoryPaths(),
    forgetAiHistory: (paths) => wiring.forgetAiHistory(paths),
    // ADVISOR D4 (a): the dev-only fixture gate; index.ts passes app.isPackaged
    isPackaged: wiring.isPackaged,
    // S18: main owns the native dialog (Electron); the service stays Electron-free
    pickUploadFile: () => pickUploadFile(wiring),
    pickDownloadPath: (defaultName) => pickDownloadPath(wiring, defaultName),
    pushUploadProgress: (event) => push(UNIWORK_DOC_CHANNELS.uploadProgress, event),
    pushDocRenamed: (event) => push(UNIWORK_DOC_CHANNELS.docRenamed, event),
    // FD-11: this app's own folder/tree actions; the coalescer decides when the
    // renderer actually hears about them
    pushTreeChanged: (event) => treeChanged.notify(event.workspaceId),
    notifyPathRenamed: (oldPath, newPath) => wiring.notifyPathRenamed(oldPath, newPath),
    notifyTitleRenamed: (path, title) => wiring.notifyTitleRenamed?.(path, title),
    ui: conflictUi(wiring),
    pushStatus: (status) => push(UNIWORK_DOC_CHANNELS.docStatusEvent, status),
    pushQueuePopover: (request) => push(UNIWORK_DOC_CHANNELS.queuePopover, request),
    // G5-06u RBE6u-03: a path open as a tab of the shell window (the target
    // discussionTarget already resolves); a detached editor window is not one
    isShellTab: (path) => (wiring.discussionTarget ? wiring.discussionTarget(path) !== null : true),
    pushSignOutProgress: (event: SignOutProgress) =>
      push(UNIWORK_DOC_CHANNELS.signOutProgress, event),
    pushConflict: (view) => push(UNIWORK_DOC_CHANNELS.conflictOpen, view),
    pushConflictClosed: (sessionId) => push(UNIWORK_DOC_CHANNELS.conflictClosed, { sessionId }),
    isAiRunning: (path) => wiring.isAiRunning?.(path) === true,
    stopAiRun: (path) => wiring.stopAiRun?.(path),
    lang: () => wiring.lang(),
    // the save queue's lane verdicts read the same per-org capability cache the
    // feed runtime does (see the SyncRuntimeSeam note), so `sync_write` is read
    // once per account and cleared on an account switch for both
    capability: {
      get: (orgId, options) =>
        seamRef.runtime
          ? seamRef.runtime.capabilityRead(orgId, options)
          : Promise.resolve({ kind: 'ok', capabilities: { sync_write: true }, source: 'default' }),
    },
    pushLaunch: createLaunchPusher(() => wiring.shellContents(), UNIWORK_DOC_CHANNELS.launchEvent),
    // A lock can be pushed before the shell page has loaded (a cold-start open):
    // main holds the latest one and sends it when the page finishes loading.
    // The preload does NOT replay a held lock - the shell reads uniworkLocks()
    // when it mounts, so a push missed before that is not lost and a lock the
    // user dismissed in the meantime is not resurrected.
    pushLock: createPushHolder<UniworkDocLock>(
      () => wiring.shellContents(),
      UNIWORK_DOC_CHANNELS.lock,
    ),
    // G5-05u B5/B7: the pinned copy an offline open falls back to, and the S5
    // "Tải lại" gate that asks whether the head is downloaded. The gate's
    // optional revision is not compared: the offline projection keeps no server
    // revision (a row's committed copy is the head by version), so BE-R1-6
    // answers from the row's openable state + version, never from a revision
    // the offline library cannot name.
    openOfflineCopy: (documentId) => offlineRef.open(documentId),
    hasOfflineHead: (documentId) => offlineHead.has(documentId),
    // the whole list when locks clear (a Retry that unlocked the keychain): the
    // shell replaces its list, so the S11 panel does not outlive the lock
    pushLocks: () => push(UNIWORK_DOC_CHANNELS.locksChanged, service.currentLocks()),
    reveal: () => wiring.reveal(),
    revealComment: (path, commentId) => comments?.reveal(path, commentId),
    // G8-12: a settled Save tells the editor's comment panel its new version
    notifySaved: (path, versionId) => comments?.saved(path, versionId),
  })

  // G8-08: the UniWork comments IPC (one handler per frame request kind) and
  // the reveal push for a launch ticket that named a comment
  comments = createUniworkComments(ipcMain, {
    service,
    profile: () => uniworkDeploymentProfile(),
    authorized: (call) => authorizedRequest(call),
    isSignedIn: () => uniworkSessionIdentity() !== null,
    sendReveal: (payload, stillWanted) => {
      // a cold start opens the editor after the reveal is decided: the push is
      // held until the editor renderer finished loading (same rule as a launch);
      // a pull that delivered the reveal in the meantime ends it (D1-4)
      return createPushHolder<CommentsRevealPayload>(
        () => wiring.commentsTarget?.(payload.path) ?? null,
        COMMENTS_CHANNELS.reveal,
        stillWanted,
      )(payload)
    },
    // R1-2: the sender's own path scopes the pending-reveal pull
    shownPath: (sender) => wiring.commentsPathFor?.(sender) ?? null,
    // G8-12: the saved push goes to the loaded editor showing the path only; a
    // page still loading reads the version through context() once it mounts
    sendSaved: (payload) => {
      const target = wiring.commentsTarget?.(payload.path)
      if (!target || target.isDestroyed() || target.isLoadingMainFrame()) return
      target.send(COMMENTS_CHANNELS.saved, payload)
    },
    // G8-11: the shell Discussion panel's bridge, served only for the shell
    // webContents and the open tabs of its window
    ...(wiring.discussionTabPaths
      ? {
          shellTabPaths: (sender: { id: number }) => wiring.discussionTabPaths?.(sender) ?? null,
          shellTarget: (path: string) => wiring.discussionTarget?.(path) ?? null,
          setDiscussionPanel: (sender: { id: number }, panel: { open: boolean; width: number }) =>
            wiring.setDiscussionPanel?.(sender, panel),
        }
      : {}),
  })

  ipcMain.handle(UNIWORK_DOC_CHANNELS.listWorkspaces, () => service.listWorkspaces())
  ipcMain.handle(UNIWORK_DOC_CHANNELS.listDocuments, (_event, query: unknown) =>
    service.listDocuments((query ?? {}) as UniworkDocListQuery),
  )
  ipcMain.handle(UNIWORK_DOC_CHANNELS.listSharedWithMe, (_event, query: unknown) =>
    service.listSharedWithMe((query ?? {}) as UniworkSharedQuery),
  )
  ipcMain.handle(UNIWORK_DOC_CHANNELS.documentProperties, (_event, documentId: unknown) =>
    service.documentProperties(documentId as string),
  )
  ipcMain.handle(UNIWORK_DOC_CHANNELS.createDocument, (_event, input: unknown) =>
    service.createDocument((input ?? {}) as UniworkCreateDocInput),
  )
  ipcMain.handle(UNIWORK_DOC_CHANNELS.pickUploadFile, () => service.pickUploadFile())
  ipcMain.handle(UNIWORK_DOC_CHANNELS.uploadDocument, (_event, input: unknown) =>
    service.uploadDocument((input ?? {}) as UniworkUploadDocInput),
  )
  // S18 cancel: a no-op for an id main does not hold, so a Cancel racing its own
  // upload's settle (or a stale dialog's) is harmless
  ipcMain.handle(UNIWORK_DOC_CHANNELS.cancelUpload, (_event, uploadId: unknown) => {
    if (typeof uploadId === 'string') service.cancelUpload(uploadId)
  })
  ipcMain.handle(
    UNIWORK_DOC_CHANNELS.renameDocument,
    (_event, documentId: unknown, name: unknown) =>
      service.renameDocument(documentId as string, name as string),
  )
  ipcMain.handle(UNIWORK_DOC_CHANNELS.archiveDocument, (_event, documentId: unknown) =>
    service.archiveDocument(documentId as string),
  )
  ipcMain.handle(UNIWORK_DOC_CHANNELS.restoreDocument, (_event, documentId: unknown) =>
    service.restoreDocument(documentId as string),
  )
  // FD-11: the folder-tree surface
  ipcMain.handle(UNIWORK_DOC_CHANNELS.folderTree, (_event, workspaceId: unknown) =>
    service.folderTree(workspaceId as string),
  )
  ipcMain.handle(UNIWORK_DOC_CHANNELS.listChildren, (_event, q: unknown) =>
    service.listChildren((q ?? {}) as UniworkFolderQuery),
  )
  ipcMain.handle(UNIWORK_DOC_CHANNELS.searchDocuments, (_event, q: unknown) =>
    service.searchDocuments((q ?? {}) as UniworkSearchQuery),
  )
  ipcMain.handle(UNIWORK_DOC_CHANNELS.createFolder, (_event, input: unknown) =>
    service.createFolder((input ?? {}) as UniworkCreateFolderInput),
  )
  ipcMain.handle(UNIWORK_DOC_CHANNELS.moveDocument, (_event, input: unknown) =>
    service.moveDocument((input ?? {}) as UniworkMoveDocumentInput),
  )
  ipcMain.handle(UNIWORK_DOC_CHANNELS.openDocument, (_event, documentId: unknown) =>
    service.openDocument(documentId as string),
  )
  ipcMain.handle(UNIWORK_DOC_CHANNELS.docStatus, (_event, path: unknown) =>
    service.docStatus(path as string),
  )
  ipcMain.handle(UNIWORK_DOC_CHANNELS.activeDocStatus, () => service.activeDocStatus())
  ipcMain.handle(UNIWORK_DOC_CHANNELS.save, (_event, path: unknown) => service.save(path as string))
  ipcMain.handle(UNIWORK_DOC_CHANNELS.ensureMyFolder, (_event, workspaceId: unknown) =>
    service.ensureMyFolder(workspaceId as string),
  )
  ipcMain.handle(UNIWORK_DOC_CHANNELS.firstSave, (_event, input: unknown) =>
    service.firstSave((input ?? {}) as UniworkFirstSaveInput),
  )
  // SAVE-01 r2 (S01-R1-6): the renderer's "dialog is open" ack that releases a
  // File > Save's pending firstSaveOpen; a stale or foreign ack is a no-op
  registerFirstSaveOpenAck(ipcMain)
  ipcMain.handle(UNIWORK_DOC_CHANNELS.saveLocalCopy, (_event, path: unknown) =>
    service.saveLocalCopy(path as string),
  )
  ipcMain.handle(UNIWORK_DOC_CHANNELS.resolveConflict, (_event, path: unknown) =>
    service.resolveConflict(path as string),
  )
  ipcMain.handle(UNIWORK_DOC_CHANNELS.conflictAct, (_event, sessionId: unknown, action: unknown) =>
    service.conflictAct(sessionId as string, action as UniworkConflictAction),
  )
  // G5-03a: the S6 bar's actions. The barInset handler is NOT registered here:
  // it belongs to the window chrome (index.ts, W2).
  ipcMain.handle(UNIWORK_DOC_CHANNELS.remoteAction, (_event, path: unknown, action: unknown) =>
    service.remoteAction(path as string, action as UniworkRemoteAction),
  )
  ipcMain.handle(UNIWORK_DOC_CHANNELS.locks, () => service.currentLocks())
  ipcMain.handle(UNIWORK_DOC_CHANNELS.dismissLock, (_event, path: unknown) => {
    if (typeof path === 'string') service.dismissLock(path)
  })
  ipcMain.handle(UNIWORK_DOC_CHANNELS.signOutPlan, () => service.signOutPlan())
  let signOutPromptPending: {
    requestId: string
    resolve: (confirmed: boolean) => void
  } | null = null
  ipcMain.handle(UNIWORK_DOC_CHANNELS.signOutPromptAnswer, (_event, payload: unknown) => {
    const answer =
      payload && typeof payload === 'object' ? (payload as Partial<SignOutPromptAnswer>) : null
    const pending = signOutPromptPending
    if (!pending) return
    if (answer?.requestId && answer.requestId !== pending.requestId) return
    signOutPromptPending = null
    pending.resolve(answer?.confirmed === true)
  })
  setUniworkCloseGuard(service)
  const runtime = createSyncRuntime(service, {
    treeChanged: (workspaceId) => treeChanged.notify(workspaceId),
    libraryChanged: (documentId) => offlineRowChanged(documentId),
  })
  seamRef.runtime = runtime
  /**
   * G5-05u B5: the read-only copies of pinned documents opened with no network.
   * They live beside the working copies of the session (their own document key),
   * go as soon as no tab shows them and at every account boundary.
   */
  const offlineCopies = createOfflineCopies({
    library: () => runtime.library,
    capabilityOn: async (orgId) =>
      (await runtime.capabilityRead(orgId)).capabilities.offline_library,
    store: service.store,
    // BE-R1-2: the leftover sweep walks the account's own working-copy folders
    scopeDirs: (deploymentId, accountId) =>
      scopeWorkingCopyDirs(service.store.root, { deploymentId, accountId }),
    scope: () => {
      const identity = uniworkSessionIdentity()
      return identity
        ? { deploymentId: identity.deploymentId, accountId: identity.accountId }
        : null
    },
    show: (path) => service.showOfflineCopy(path),
    isPathOpen: (path) => wiring.isPathOpen(path),
    appVersion: () => app.getVersion(),
  })
  // the service opens its cached copy through the same module (B5)
  offlineRef.open = (documentId) =>
    offlineCopies.open(documentId).then((outcome): OfflineCopyOpen => {
      if (outcome.kind === 'opened')
        return { kind: 'opened', path: outcome.path, title: outcome.title }
      return outcome.kind === 'refused' ? { kind: 'locked', ...outcome.lock } : null
    })
  const offlineApi = createOfflineLibraryApi({
    library: () => runtime.library,
    activeOrgId: () => feedOrgId(uniworkAccount().status()),
    capabilityOn: async (orgId) =>
      (await runtime.capabilityRead(orgId)).capabilities.offline_library,
    signedOut: () => uniworkAccount().status().state !== 'signed-in',
    lastOwner: () => service.store.readLastOwner(),
    libraryLayer: () => libraryLayerFor(),
    openDocument: (documentId) => service.openDocument(documentId),
    openCopy: (documentId) => offlineCopies.open(documentId),
    revealLibraryFolder: async () =>
      (await shell.openPath(join(app.getPath('userData'), 'uniwork-sync', 'library'))) === '',
    lockRefused: (lock) => service.recordOfflineLock(lock),
    changed: () => offlinePush(),
  })
  /** stops the feed pass and remembers it, so the next status push restarts it */
  const stopFeed = (): void => {
    runtime.stop()
    // FD-11: a window still pending belongs to the pass that just stopped (the
    // account may be switching): it must not reach the renderer afterwards
    treeChanged.cancel()
    feedRunning = false
  }
  // Sign out and a sign-in as someone else close the previous account's
  // documents and delete their AI history (see account-boundary.ts)
  const boundary = new AccountBoundary({
    root: service.store.root,
    openPaths: () => wiring.openPaths(),
    closeDocument: (path) => wiring.closePath(path),
    confirmClose: async () => true,
    closeNow: (path) => wiring.closePathNow(path),
    aiHistoryPaths: () => wiring.aiHistoryPaths(),
    forgetAiHistory: (paths) => wiring.forgetAiHistory(paths),
    // the previous account's locks go with its documents: the next session is
    // not shown an S11 panel for a working copy it cannot explain
    forgetLocks: (match) => service.forgetLocksWhere(match),
    closeConflictPrompt: () => service.closeConflictPrompt(),
    sessionOwner: () => {
      const identity = uniworkSessionIdentity()
      return identity
        ? { accountId: identity.accountId, deploymentId: identity.deploymentId }
        : null
    },
    confirmSignOut: async (owner, options) => {
      if (options?.confirmed === true) return true
      const plan = await service.signOutPlan(owner)
      if (plan.count === 0 && plan.ramOnly === 0) return true
      const wc = wiring.shellContents()
      if (wc && !wc.isDestroyed()) {
        const requestId = randomUUID()
        return new Promise<boolean>((resolve) => {
          signOutPromptPending = { requestId, resolve }
          const req: SignOutPromptRequest = { requestId, plan }
          wc.send(UNIWORK_DOC_CHANNELS.signOutPrompt, req)
        })
      }
      return promptSignOutFallback(wiring, plan)
    },
    // Q2 = a: the switch already locked the previous account; this only tells
    // the user what RAM-only content was lost. Its answer is never awaited (and
    // never resolves a pending confirm: its requestId is not the pending one).
    noticeSwitchLoss: (_owner, plan) => {
      const wc = wiring.shellContents()
      if (wc && !wc.isDestroyed()) {
        const req: SignOutPromptRequest = { requestId: randomUUID(), plan, mode: 'notice' }
        wc.send(UNIWORK_DOC_CHANNELS.signOutPrompt, req)
        return
      }
      void noticeSwitchLossFallback(wiring, plan).catch(() => undefined)
    },
    // G5-11: the outgoing account's durable store is locked (never wiped) after
    // waiting for any in-flight save, capturing N+1 editor/disk working copies
    // into `parked`, and deleting plaintext working + recovery copies.
    lockStore: async (owner, options) => {
      // G5-08c: the leases lock at the account boundary itself (sign-out at
      // once; a switch never locks the incoming account), not on stop()
      runtime.leases.lockBoundary(owner)
      // G5-05: every library download stops before the scope locks; the
      // read-only offline copies of the account go with its plaintext working copies
      runtime.library?.lockBoundary()
      await offlineCopies.dropAll()
      stopFeed()
      let captureFailed = 0
      try {
        // the service itself pushes the one `waiting` through pushSignOutProgress;
        // on a switch a refused park cannot abort (d5-1), its loss is counted
        const res = await service.lockSession(owner, undefined, {
          switch: options?.switch === true,
        })
        captureFailed = res.captureFailed.length
        // G5-05 OQ-UX11 (a): the pinned offline copies go at sign-out and at a
        // switch, beside the locked sync scope (their own layer, not parked
        // data); an aborted lock keeps them, as it keeps the working copies
        if (res.ok && owner) {
          await libraryLayerFor().lockAndWipe({
            deploymentId: owner.deploymentId,
            accountId: owner.accountId,
          })
        }
        return { ok: res.ok, lost: res.lost?.length ?? 0 }
      } finally {
        push(UNIWORK_DOC_CHANNELS.signOutProgress, {
          phase: 'done',
          ...(captureFailed > 0 ? { captureFailed } : {}),
        })
      }
    },
  })
  setUniworkSignOutHooks({
    before: (options) => boundary.beforeSignOut(options),
    after: () => boundary.afterSignOut(),
  })
  // G5-10 Sync center (S2): its read model and actions over the live service and runtime
  const syncCenter = createWiredSyncCenter({
    ipcMain,
    userDataDir: app.getPath('userData'),
    service,
    store: syncStoreFor(),
    accountStatus: () => uniworkAccount().status(),
    capabilityRead: (orgId) => runtime.capabilityRead(orgId),
    feedVerdict: () => runtime.feedVerdict(),
    resetFeedResync: () => runtime.resetFeedResync(),
    leaseState: (documentId) => runtime.leases.effectiveState(documentId),
    tickRuntime: () => runtime.tick(),
    openPath: (path) => (wiring.refuseLockedPath(path) ? false : wiring.openPath(path)),
    isPathOpen: (path) => wiring.isPathOpen(path),
    defaultSaveDir: () => wiring.defaultSaveDir(),
    writeClipboard: (text) => clipboard.writeText(text),
    pickSaveDialog: async ({ defaultPath, ext }) => {
      const parent = wiring.shellWindow()
      const options: Electron.SaveDialogOptions = {
        title: tUniworkDocs(wiring.lang(), 'copyDialogTitle'),
        defaultPath,
        filters: [{ name: String(ext).toUpperCase(), extensions: [String(ext)] }],
      }
      const picked = parent
        ? await dialog.showSaveDialog(parent, options)
        : await dialog.showSaveDialog(options)
      return picked.canceled || !picked.filePath ? null : picked.filePath
    },
    pushChanged: (snapshot) => push(UNIWORK_SYNC_CENTER_CHANNELS.changedEvent, snapshot),
    // G5-05u B1/B7: the S3 block, and the head-offline set the S5 gate reads
    offline: async () => {
      const block = await offlineApi.snapshot()
      offlineHead.clear()
      for (const documentId of offlineHeadIds(block.rows)) offlineHead.add(documentId)
      return block
    },
  })
  offlinePush = () => syncCenter.controller.notifyChanged()
  offlineRowChanged = (documentId) => offlineApi.rowChanged(documentId)
  registerOfflineLibraryIpc(ipcMain, offlineApi)
  // a copy no window shows any more goes at the next pass (the offline twin of the draft sweep)
  runtime.onPollVerdict(() => void offlineCopies.sweep())
  changeListeners.push(() => syncCenter.controller.notifyChanged())
  // every feed pass's connectivity verdict: the offline header, its refusals and lastSyncAt
  runtime.onPollVerdict((online) => void syncCenter.notePoll(online))

  return {
    service,
    boundary,
    comments,
    aiBinding: (path) => uniworkAiBinding(service, path),
    capabilityRead: (orgId) => runtime.capabilityRead(orgId),
    offline: offlineApi,
    activate(startLaunch) {
      let signedIn = uniworkAccount().status().state === 'signed-in'
      /** the org the feed currently runs for; null = no pass may run */
      let feedOrg: string | null = null
      /**
       * The feed runs only for the chosen org of a live session: while the
       * picker is up nothing starts, and the choice's own status push starts it
       * for that org (one pass plus the 60 s poll). Sign-out, a lock, an account
       * switch or an org change stops the pass it replaces; a stop the boundary
       * forced (`feedRunning` false with the same org) starts it again.
       */
      const syncFeed = (status: AccountStatus, identity: SessionIdentity | null): void => {
        const target = identity ? feedOrgId(status) : null
        if (target === feedOrg && (target === null || feedRunning)) return
        stopFeed()
        feedOrg = target
        if (target) {
          runtime.start()
          feedRunning = true
        }
      }
      onUniworkAccountStatus((status) => {
        // the session's account may have changed: it becomes the last owner
        service.noteSessionIdentity()
        // BE-R1-2: an account activation is the startup sweep - the last
        // session's read-only `@offline` plaintext goes before anything opens one
        void offlineCopies.recover().catch(() => undefined)
        // G8-16 S16: changing the organization reloads the library data. An
        // org-less push carrying orgsError is a transient /orgs failure; an
        // org-less push without it (deactivation, the picker) is a lasting
        // loss and a real session boundary (R5-01).
        service.noteSelectedOrg(status.org?.id ?? null, status.orgsError === undefined)
        void syncCenter.noteAccount()
        const identity = uniworkSessionIdentity()
        if (identity) {
          void boundary
            .enforce(identity)
            .then(() => service.restoreParked(identity))
            // the boundary's lockSession stops the feed pass (be-3): when the
            // session's org is unchanged the synchronous call below has already
            // returned, so the feed is re-evaluated once the boundary settled
            .then(() => syncFeed(status, uniworkSessionIdentity()))
            .catch(() => undefined)
        }
        const now = status.state === 'signed-in'
        if (now && !signedIn) void service.launch.onSignedIn()
        signedIn = now
        syncFeed(status, identity)
      })
      startLaunch((url) => void service.launch.handleUrl(url))
    },
  }
}
