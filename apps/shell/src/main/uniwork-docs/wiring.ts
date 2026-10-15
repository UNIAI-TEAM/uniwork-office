import { app, BrowserWindow, dialog, safeStorage, type IpcMain, type WebContents } from 'electron'
import { basename, extname, join } from 'node:path'
import { showSaveDialogWithMemory } from '@genoffice/electron-utils'
import { COMMENTS_CHANNELS } from '@genoffice/electron-utils/comments-ipc'
import {
  UNIWORK_DOC_CHANNELS,
  type AccountStatus,
  type UniworkConflictAction,
  type UniworkCreateDocInput,
  type UniworkDocListQuery,
  type UniworkDocLock,
  type UniworkRemoteAction,
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
import { INTENT_STORE_REGISTRATION } from '../uniwork-sync/intent-store'
import { DRAFTS_STORE_REGISTRATION } from '../uniwork-sync/queue/drafts'
import { PAUSE_STORE_REGISTRATION } from '../uniwork-sync/queue/pause'
import { createSafeStorageKeyProvider } from '../uniwork-sync/keys'
import {
  DOC_INDEX_REGISTRATION,
  FEED_CURSORS_REGISTRATION,
  LEASE_STORE_REGISTRATION,
  SyncRuntime,
  createLeaseClient,
  type LeaseClient,
  type SyncRuntimeTargets,
} from '../uniwork-sync/runtime'
import { createSyncStoreAccess, type SyncStoreAccess } from '../uniwork-sync/session-store'
import { createStoreLayer, type StoreLayer } from '../uniwork-sync/store'
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
  type UnsavedCloseChoice,
  type UnsavedCloseKind,
} from './service'
import { tUniworkDocs } from './strings'

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
  requestModuleSave(path: string, onNotWritten?: () => void): boolean
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
        extensions: ['docx', 'xlsx', 'pptx', 'pdf', 'md', 'html'],
      },
      { name: tUniworkDocs(wiring.lang(), 'uploadPickAll'), extensions: ['*'] },
    ],
  }
  const picked = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  const path = picked.canceled ? undefined : picked.filePaths[0]
  return path ? { path, name: basename(path) } : null
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

/** encrypted bytes the account's sync store (intents, cursors, index) may keep */
export const SYNC_STORE_BUDGET_BYTES = 256 * 1024 * 1024

/**
 * The durable sync store of the session. One key provider (keys wrapped by
 * Electron safeStorage) and one layer under `userData/uniwork-sync/`, holding
 * every store this build registers; the records are encrypted, budgeted and
 * wiped at the account boundary. The wrapped keys sit beside the layer root,
 * outside the wiped scope, so unlocking after a sign-out reads them again.
 */
function createSyncStoreLayer(root: string): StoreLayer {
  const layer = createStoreLayer({
    root: join(root, 'store'),
    keys: createSafeStorageKeyProvider({ safeStorage, dir: join(root, 'keys') }),
    budgetBytes: SYNC_STORE_BUDGET_BYTES,
    clock: () => Date.now(),
  })
  layer.register(INTENT_STORE_REGISTRATION)
  layer.register(DRAFTS_STORE_REGISTRATION)
  layer.register(PAUSE_STORE_REGISTRATION)
  layer.register(FEED_CURSORS_REGISTRATION)
  layer.register(DOC_INDEX_REGISTRATION)
  layer.register(LEASE_STORE_REGISTRATION)
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
 * Test seams of the feed runtime: the HTTP round trip of the capability and
 * feed clients, and the clock their caches read. Production leaves both out.
 */
export interface SyncRuntimeSeam {
  fetch?: FetchLike
  now?(): number
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
  return new SyncRuntime({
    store: syncStoreFor().access,
    // S18: a change the feed applies for a bound document re-reads its metadata,
    // so a rename on the web reaches the open desktop copy
    // the change's revision, so the echo of this service's own rename is
    // recognised by it and a genuine later change is never swallowed (R1-6)
    // G5-03a: the same change IS the S6 newer-version notice (head version +
    // version id), so one feed tick drives both
    onFeedChange: (change) => service.noteFeedChange(change.documentId, change.revision, change),
    // G5-03a: a full resync that no longer lists an open, bound document asks
    // the service to classify it (403/404 -> revoked, 410 -> deleted); the
    // runtime learns ids only, never paths
    isOpenBound: (documentId) => service.isOpenBound(documentId),
    onFeedGone: (documentId) => {
      void service.noteFeedGone(documentId).catch(() => undefined)
    },
    targets,
    capability: async (orgId) => {
      const found = clients()
      if (!found) {
        return {
          kind: 'ok' as const,
          capabilities: { ...NEVER_READ_CAPABILITIES },
          source: 'default' as const,
        }
      }
      return found.capability.get(orgId)
    },
    client: () => clients()?.feed ?? null,
    lease: {
      client: () => clients()?.lease ?? null,
      session: () => uniworkSessionIdentity()?.deviceSessionId ?? null,
    },
    keepDraft: (documentId) => service.hasLocalDraft(documentId),
    clock: { now: () => Date.now() },
    // the same poll drives the durable save queue: dispatch the pending intents
    // and advance their reconciling clocks on every pass (sign-in + interval),
    // and mirror the pass's connectivity onto the queue's waiting intents (a
    // failed round trip parks them, a working one wakes them)
    onPoll: async (online) => {
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
}

/** Registers the IPC handlers (safe before app ready: nothing touches the account yet). */
export function createUniworkDocs(ipcMain: IpcMain, wiring: UniworkDocsWiring): UniworkDocsHandle {
  const push = (channel: string, payload: unknown) => {
    const wc = wiring.shellContents()
    if (wc && !wc.isDestroyed()) wc.send(channel, payload)
  }
  const syncStore = syncStoreFor().access
  // the service is built before the runtime, but its save queue reads the
  // runtime's capability cache: this holder breaks the cycle (the read happens
  // only after `createSyncRuntime` assigned it, below)
  const seamRef: { runtime: SyncRuntime | null } = { runtime: null }
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
    requestModuleSave: (path, onNotWritten) => wiring.requestModuleSave(path, onNotWritten),
    reloadPath: (path) => wiring.reloadPath(path),
    // G5-03a: the fresh editor state of one path (W2's live read; the wiring
    // placeholder is what index.ts installs today)
    editorStateOf: (path) => wiring.editorStateOf(path),
    activePath: () => wiring.activePath(),
    // ADVISOR D4 (a): the dev-only fixture gate; index.ts passes app.isPackaged
    isPackaged: wiring.isPackaged,
    // S18: main owns the native dialog (Electron); the service stays Electron-free
    pickUploadFile: () => pickUploadFile(wiring),
    pickDownloadPath: (defaultName) => pickDownloadPath(wiring, defaultName),
    pushUploadProgress: (event) => push(UNIWORK_DOC_CHANNELS.uploadProgress, event),
    pushDocRenamed: (event) => push(UNIWORK_DOC_CHANNELS.docRenamed, event),
    notifyPathRenamed: (oldPath, newPath) => wiring.notifyPathRenamed(oldPath, newPath),
    notifyTitleRenamed: (path, title) => wiring.notifyTitleRenamed?.(path, title),
    ui: conflictUi(wiring),
    pushStatus: (status) => push(UNIWORK_DOC_CHANNELS.docStatusEvent, status),
    pushConflict: (view) => push(UNIWORK_DOC_CHANNELS.conflictOpen, view),
    pushConflictClosed: (sessionId) => push(UNIWORK_DOC_CHANNELS.conflictClosed, { sessionId }),
    isAiRunning: (path) => wiring.isAiRunning?.(path) === true,
    stopAiRun: (path) => wiring.stopAiRun?.(path),
    lang: () => wiring.lang(),
    // the save queue's lane verdicts read the same per-org capability cache the
    // feed runtime does (see the SyncRuntimeSeam note), so `sync_write` is read
    // once per account and cleared on an account switch for both
    capability: {
      get: (orgId) =>
        seamRef.runtime
          ? seamRef.runtime.capabilityRead(orgId)
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
  ipcMain.handle(UNIWORK_DOC_CHANNELS.listFolders, (_event, workspaceId: unknown) =>
    service.listFolders(workspaceId as string),
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
  setUniworkCloseGuard(service)
  const runtime = createSyncRuntime(service)
  seamRef.runtime = runtime
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
    // the outgoing account's durable store (intents, feed cursors, doc index)
    // is locked and wiped with its documents; the feed and the save queue stop
    // first so no in-flight consumer or dispatch writes into a wiped scope
    wipeStore: async (owner) => {
      // G5-08c: the leases lock at the account boundary itself (sign-out at
      // once; a switch never locks the incoming account), not on stop()
      runtime.leases.lockBoundary(owner)
      runtime.stop()
      // await the queue teardown BEFORE the wipe: the in-flight poll/dispatch
      // must unwind (and release its locks) before the scope is wiped, so no
      // lookup or record write runs into a wiped scope (G506-be-d1-1)
      await service.teardownSaveQueue?.()
      if (!owner) return
      const store = syncStoreFor()
      store.access.forget()
      await store.layer.lockAndWipe({
        deploymentId: owner.deploymentId,
        accountId: owner.accountId,
      })
    },
  })
  setUniworkSignOutHooks({
    before: () => boundary.beforeSignOut(),
    after: () => boundary.afterSignOut(),
  })

  return {
    service,
    boundary,
    comments,
    aiBinding: (path) => uniworkAiBinding(service, path),
    capabilityRead: (orgId) => runtime.capabilityRead(orgId),
    activate(startLaunch) {
      let signedIn = uniworkAccount().status().state === 'signed-in'
      /** the org the feed currently runs for; null = no pass may run */
      let feedOrg: string | null = null
      onUniworkAccountStatus((status) => {
        // the session's account may have changed: it becomes the last owner
        service.noteSessionIdentity()
        // G8-16 S16: changing the organization reloads the library data
        service.noteSelectedOrg(status.org?.id ?? null)
        const identity = uniworkSessionIdentity()
        if (identity) void boundary.enforce(identity).catch(() => undefined)
        const now = status.state === 'signed-in'
        if (now && !signedIn) void service.launch.onSignedIn()
        signedIn = now
        // the feed runs only for the chosen org of a live session: while the
        // picker is up nothing starts, and the choice's own status push starts
        // it for that org (one pass plus the 60 s poll). Sign-out, a lock, an
        // account switch or an org change stops the pass it replaces.
        const target = identity ? feedOrgId(status) : null
        if (target === feedOrg) return
        runtime.stop()
        feedOrg = target
        if (target) runtime.start()
      })
      startLaunch((url) => void service.launch.handleUrl(url))
    },
  }
}
