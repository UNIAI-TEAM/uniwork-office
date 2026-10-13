import { readFileSync, statSync } from 'node:fs'
import { copyFile, readFile, rename, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  RecentUniworkSource,
  UniworkConflictChoice,
  UniworkCreateDocInput,
  UniworkDocAccess,
  UniworkDocActionError,
  UniworkDocActionResult,
  UniworkDocFolderRef,
  UniworkDocErrorCode,
  UniworkDocFormat,
  UniworkDocListPage,
  UniworkDocListQuery,
  UniworkDocLock,
  UniworkDocProperties,
  UniworkDocRenamedEvent,
  UniworkDocSummary,
  UniworkDocStatus,
  UniworkLaunchEvent,
  UniworkLockReason,
  UniworkResult,
  UniworkSharedPage,
  UniworkSharedQuery,
  UniworkUploadDocInput,
  UniworkUploadProgress,
  UniworkWorkspaceRef,
} from '../../shared/home-api'
import {
  callbackSchemeForChannel,
  type DeploymentChannel,
  type DeploymentProfile,
} from '../uniwork-auth/deployment'
import type { ProfileOutcome } from '../uniwork-auth/profile-store'
import {
  type Binding,
  BindingStore,
  type BoundDocument,
  documentNameIn,
  hasLegacyIntentFiles,
  type LastOwner,
  type NewerStore,
  type PathBinding,
  scopeWorkingCopyDirs,
} from './binding-store'
import { type FetchLike, type UniworkDocsClient, createUniworkDocsClient } from './client'
import { UniworkDocError } from './errors'
import {
  formatForMime,
  formatForName,
  hasReplacementChar,
  sha256Hex,
  workingCopyName,
} from './formats'
import { pathKey } from '../../shared/path-key'
import { LaunchController } from './launch'
import { actionFlags, type DocumentDetail, type LaunchDescriptor } from './parse'
import { SaveCoordinator, toStatus, type IntentAccess } from './save-coordinator'
import type { SyncStoreAccess, SyncStoreOpen } from '../uniwork-sync/session-store'
import { createIntentStore, INTENT_STORE_REGISTRATION } from '../uniwork-sync/intent-store'
import { migrateLegacyIntents } from '../uniwork-sync/migration'
import { APP_STORE_LEVEL } from '../uniwork-sync/store-level'

/**
 * UniWork documents in the shell main process: the picker reads, the open
 * flow (download -> working copy + binding -> the normal module open), the
 * launch bridge, the save coordinator, conflict resolution, the module
 * policy and the recents filter. Electron-free: windows, dialogs, tabs and
 * IPC come in through `deps` (see wiring.ts).
 */

/**
 * The decision the shell's open funnel makes before any module sees a path: a
 * working copy whose folder declares a store this build does not read is
 * refused (the service records the S11 lock) instead of opening. Exported and
 * Electron-free so the decision is exercised at runtime by a test with a seeded
 * store, not only by matching the router's source text.
 */
export function refuseLockedOpenPath(
  refuser: LockRefuser | null | undefined,
  path: string,
): boolean {
  return refuser ? refuser.refuseLockedPath(path) : false
}

/** the slice of the service the open funnel needs */
export interface LockRefuser {
  refuseLockedPath(path: string): boolean
}

export interface SessionIdentity {
  accountId: string
  deviceSessionId: string
  deploymentId: string
}

/** the native conflict choice (rule 3); the strings live with the dialog */
export interface ConflictUi {
  /** `signal` closes the dialog as "Decide later" */
  chooseConflict(title: string, signal?: AbortSignal): Promise<UniworkConflictChoice>
  /** `signal` closes the dialog as Cancel */
  confirmDiscard(title: string, signal?: AbortSignal): Promise<boolean>
  /** Save As for "Save a copy on this computer" (default `<stem> (my copy).<ext>`); null when cancelled */
  pickCopyPath(stem: string, format: UniworkDocFormat): Promise<string | null>
  showOpenLatestFailed(): void
  /** the "Save a copy on this computer" file could not be written */
  showCopyFailed(): void
  /** closing a document whose local changes are not in UniWork yet; `reason` is the binding's error */
  chooseUnsavedClose(
    title: string,
    kind: UnsavedCloseKind,
    reason?: UniworkDocErrorCode,
  ): Promise<UnsavedCloseChoice>
}

/** which close prompt: Save to UniWork, the conflict dialog, or the reason a save is not possible */
export type UnsavedCloseKind = 'unsent' | 'conflict' | 'blocked'

/** 'save' (unsent) and 'resolve' (conflict) are each kind's default button */
export type UnsavedCloseChoice = 'save' | 'resolve' | 'close' | 'cancel'

export interface UniworkDocsServiceDeps {
  userDataDir: string
  /**
   * The session's durable sync store (wiring): intents, feed cursors and the
   * doc index live here. Absent = no store-backed saves (tests that never
   * touch one).
   */
  syncStore?: SyncStoreAccess
  /** this build's version, stamped into every binding as `min_app_version` (display only) */
  appVersion?: () => string
  profile(): DeploymentProfile | null
  /** the channel of this build (its launch scheme), known before any server is chosen */
  channel(): DeploymentChannel
  /** applies the server a launch link names (confirm / sign-out rules live in uniwork-auth) */
  applyProfile(profile: DeploymentProfile): Promise<ProfileOutcome>
  identity(): SessionIdentity | null
  /**
   * True while the auth module is in its keystore-locked state: the OS keychain
   * cannot produce the store key even though a saved account exists. The store
   * then reports `keystore_locked` independently of the network session (a cold
   * restore has none), so the S11 lock and the save refusal still happen.
   */
  keystoreLocked?(): boolean
  /** the selected organization: id for org-scoped routes, slug for the members read */
  selectedOrg(): { id: string; slug: string } | null
  authorized<T>(call: (token: string) => Promise<T>): Promise<T>
  fetch?: FetchLike
  /** the shell's single document router; false = nothing opened */
  openPath(path: string): boolean
  /** a tab or detached window shows this path */
  isPathOpen(path: string): boolean
  /**
   * Runs the owning tab's module Save; false when no tab shows the path.
   * `onNotWritten` is called when the module reports that it did not write
   * (so no user-save hook will follow); modules that cannot tell never call it.
   */
  requestModuleSave(path: string, onNotWritten?: () => void): boolean
  /** remounts the tab showing the path so it re-reads the file */
  reloadPath(path: string): void
  activePath(): string | undefined
  /**
   * S18: the native open dialog for an upload (Electron-free seam). Null when
   * the person cancelled or the file is not usable.
   */
  pickUploadFile?(): Promise<{ path: string; name: string } | null>
  /** S18: bytes sent while an upload runs (the renderer's progress bar) */
  pushUploadProgress?(event: UniworkUploadProgress): void
  /** S18: a document's title changed (renamed here, or renamed elsewhere) */
  pushDocRenamed?(event: UniworkDocRenamedEvent): void
  /**
   * S18: the open tab/editor of a working copy must follow its new path (the
   * shell re-keys the tab and tells the editor, the desktop host's equivalent
   * of the X-02 `file.renamed` event). Absent in tests that do not open tabs.
   */
  notifyPathRenamed?(oldPath: string, newPath: string): void
  /**
   * S18: the file of an open working copy keeps its name while an editor holds
   * it (a rename under an open handle is refused on Windows), so the new title
   * is carried to the shell directly: the open tab/window is re-titled by its
   * path and the editor is told through the module's own rename IPC, without
   * moving the file. Absent in tests that do not open tabs.
   */
  notifyTitleRenamed?(path: string, title: string): void
  ui: ConflictUi
  pushStatus(status: UniworkDocStatus): void
  pushLaunch(event: UniworkLaunchEvent): void
  /** a working copy refused by the newer-store guard (S11 lock panel) */
  pushLock?(lock: UniworkDocLock): void
  /**
   * The lock list changed in a way the single-lock push does not carry (a
   * keystore lock cleared when the store opened): the shell replaces its list,
   * so a panel on screen goes away without waiting for an unrelated push.
   */
  pushLocks?(): void
  reveal(): void
  /**
   * G8-08: a launch ticket named a comment; after the editor shows the
   * document, ask it to reveal that thread. Optional: a standalone app or a
   * test installs none and the reveal is dropped.
   */
  revealComment?(path: string, commentId: string): void
  /** test seam: replaces the HTTP client */
  client?: UniworkDocsClient
  sleep?(ms: number): Promise<void>
  now?(): number
}

/** states whose working copy holds work UniWork does not have yet */
const KEEP_LOCAL_STATES: ReadonlySet<string> = new Set([
  'dirty',
  'conflict',
  'offline',
  'blocked',
  'signed-out',
  'error',
])

/** states whose local bytes are not in UniWork (the close prompt) */
const UNSENT_STATES: ReadonlySet<string> = new Set([
  'dirty',
  'offline',
  'signed-out',
  'error',
  'blocked',
  'conflict',
])

/**
 * How long a close waits for a Save to UniWork to settle before the tab stays
 * open. A module that reports "did not write" ends the wait at once; this cap
 * covers the modules that cannot tell (docs, sheets, slides) and a save that
 * never reaches the user-save hook.
 */
export const CLOSE_SAVE_WAIT_MS = 30_000

/** shared-with-me aggregation bounds (one workspace page, total rows, total pages) */
const SHARED_PAGE_SIZE = 50
const SHARED_MAX_ROWS = 500
const SHARED_MAX_PAGES = 10

/**
 * The org member list is paged by D (default 50, max 100 rows per page). The
 * properties panel needs the whole directory to resolve any actor id, so the
 * reads follow `next_cursor` until the end or this cap. 20 pages x 100 rows
 * bounds one logical read at 2000 members, so a pathological tenant cannot
 * make a panel open unbounded; a bigger org simply shows "—" for members past
 * the cap (documented residual, no D change).
 */
const MEMBERS_PAGE_SIZE = 100
const MEMBERS_MAX_PAGES = 20

/** `shared:<n>` -> n; anything else is the first page */
function parseOffsetCursor(cursor: string | undefined): number {
  if (!cursor) return 0
  const match = /^shared:(\d+)$/.exec(cursor)
  return match ? Number(match[1]) : 0
}

async function result<T>(run: () => Promise<T>): Promise<UniworkResult<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    return { ok: false, error: error instanceof UniworkDocError ? error.code : 'server_error' }
  }
}

/** one file (Windows paths compare case-insensitively) */
/** the longest document name D accepts, counted in runes (code points) like D's own check */
const MAX_DOC_NAME_RUNES = 500

/**
 * D stages at most 50 MiB per upload part (`files/registry.go`), so a bigger
 * file is refused before it is read: main must not buffer a multi-GB pick only
 * to be told too_large. Exactly 50 MiB is still sent.
 */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

/** the renderer's own id for one upload start; a Cancel names the upload through it */
const MAX_UPLOAD_ID_LENGTH = 128

/**
 * The upload id of one upload: a non-empty string the renderer minted. Without
 * one there is nothing a Cancel could name, so the upload is refused before any
 * read (the renderer always sends it).
 */
function requireUploadId(raw: unknown): string {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_UPLOAD_ID_LENGTH) {
    throw new UniworkDocError('not_found')
  }
  return raw
}

/** the upload a Cancel aborted: never part of UniworkDocErrorCode (see its action union) */
function cancelledUpload(): UniworkDocError {
  return new UniworkDocError('upload_cancelled' as UniworkDocErrorCode)
}

/**
 * a trimmed document name of 1..500 runes; the empty and the too-long cases are
 * S18's field errors, not requests. A duplicate name is allowed (FD-D10 a), so
 * there is no uniqueness check here.
 */
function requireName(raw: string): string {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (!name) throw new UniworkDocError('name_empty' as UniworkDocErrorCode)
  if (Array.from(name).length > MAX_DOC_NAME_RUNES) {
    throw new UniworkDocError('name_too_long' as UniworkDocErrorCode)
  }
  return name
}

/**
 * The S18 action result: like `result`, but the two name errors survive as
 * themselves (`name_empty` / `name_too_long`) so the renderer can show them at
 * the field. Duplicate names are allowed (FD-D10 a), so a server 409 is an
 * ordinary failure here, never a field error. `nameField` marks a call whose
 * title D validates (create, rename): D answers a title over 500 runes with a
 * bare 400 `invalid_request` (the message is not machine-readable), and the
 * empty title is caught before the request, so that 400 is the too-long case.
 */
async function actionResult<T>(
  run: () => Promise<T>,
  options: { nameField?: boolean } = {},
): Promise<UniworkDocActionResult<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    return { ok: false, error: actionErrorOf(error, options.nameField === true) }
  }
}

function actionErrorOf(error: unknown, nameField: boolean): UniworkDocActionError {
  if (error instanceof UniworkDocError) {
    // the name errors and a cancelled upload are carried on the error's `code`
    // even though they are not part of UniworkDocErrorCode; the cast is the one
    // place that bridges them
    const code = error.code as string
    if (code === 'name_empty' || code === 'name_too_long' || code === 'upload_cancelled') {
      return code
    }
    if (nameField && error.status === 400 && error.serverCode === 'invalid_request') {
      return 'name_too_long'
    }
    return error.code
  }
  return 'server_error'
}

function samePath(a: string, b: string): boolean {
  const ra = resolve(a)
  const rb = resolve(b)
  return process.platform === 'win32' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb
}

function accessFor(level: string | null): UniworkDocAccess {
  return level === 'edit' || level === 'manage' ? 'edit' : 'view'
}

/**
 * The core semver of a version string: `0.11.0-dev.3` -> `0.11.0` (build
 * metadata after `+` goes too). OQ-P4: `min_app_version` is display metadata,
 * so a prerelease build must not stamp its tail - the store gate reads
 * `min_store_level` only, and two builds differing only in the tail must
 * stamp the same value. Anything without a leading `major.minor.patch` is
 * kept verbatim.
 */
export function coreSemver(version: string): string {
  return /^\d+\.\d+\.\d+/.exec(version.trim())?.[0] ?? version
}

export class UniworkDocsService {
  readonly store: BindingStore
  readonly coordinator: SaveCoordinator
  readonly launch: LaunchController
  private readonly deps: UniworkDocsServiceDeps
  /** the build's own version, stamped into bindings (see binding-store's minAppVersion) */
  private readonly appVersion: () => string
  private client: UniworkDocsClient | null
  private clientOrigin: string | null = null
  private lastOwner: LastOwner | null
  private readonly statusListeners = new Set<(status: UniworkDocStatus) => void>()
  /** path key -> the newer-store lock currently shown for it (S11) */
  private readonly locks = new Map<string, UniworkDocLock>()
  /** path -> checksum of the file as of its mtime/size (the sync close check) */
  private readonly hashMemo = new Map<string, { mtimeMs: number; size: number; checksum: string }>()
  /** working copies whose editor holds edits not written to the file yet */
  private readonly editorDirty = new Set<string>()
  /** id -> display name of one org's members; dropped when the selected org changes */
  private orgMemberNames = new Map<string, string>()
  /** the org whose member names the map holds (null = nothing cached) */
  private orgMemberNamesOrg: string | null = null
  /** the one in-flight members read per org, shared by concurrent panel opens */
  private orgMemberNamesInFlight: { orgId: string; promise: Promise<Map<string, string>> } | null =
    null
  /** per path, the saveMark of its last user Save */
  private readonly lastUserSave = new Map<string, number>()
  private saveCounter = 0
  /** one open of the session's store is shared; never remembered when it failed */
  private syncOpen: Promise<SyncStoreOpen> | null = null
  /** the outcome of the last store open; 'unknown' until it is asked for */
  private storeOpenKind: SyncStoreOpen['kind'] | 'unknown' = 'unknown'
  /** scopes whose schema 1 -> 2 sweep has finished in this process */
  private readonly migratedScopes = new Set<string>()
  /**
   * The one conflict dialog open (native dialogs are window-wide, not per
   * tab). `fromClose` = opened by the close prompt of that document's tab.
   */
  private conflictPrompt: {
    path: string
    controller: AbortController
    fromClose: boolean
    done: Promise<unknown>
  } | null = null
  /**
   * S18: documents whose binding title this service just changed itself, keyed
   * by the revision its own rename produced. A `document.updated` from the feed
   * carrying exactly that revision is this service's own write coming back, so
   * it must not re-publish the rename a second time; a change for any other
   * revision is someone else's (the echo may never arrive at all, so a plain
   * set would swallow it) and is followed as usual.
   */
  private readonly selfRenamed = new Map<string, string>()
  /**
   * S18: the in-flight uploads by the renderer's own `uploadId`, so the dialog's
   * Cancel can abort the one it started (the read, or the POST already running).
   * An entry lives exactly as long as its upload call.
   */
  private readonly uploads = new Map<string, AbortController>()

  constructor(deps: UniworkDocsServiceDeps) {
    this.deps = deps
    this.client = deps.client ?? null
    this.appVersion = deps.appVersion ?? (() => '0.0.0')
    this.store = new BindingStore(join(deps.userDataDir, 'uniwork-documents'), (dir) =>
      this.heldByMigration(dir),
    )
    this.lastOwner = this.store.readLastOwner()
    this.coordinator = new SaveCoordinator({
      store: this.store,
      client: {
        upload: (input) => this.api().upload(input),
        commit: (input) => this.api().commit(input),
        getDocument: (documentId) => this.api().getDocument(documentId),
      },
      isSignedIn: () => deps.identity() !== null,
      ownsBinding: (doc) => this.owns(doc),
      intents: () => this.intentAccess(),
      publish: (status) => this.publish(status),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
    })
    this.launch = new LaunchController({
      scheme: () => callbackSchemeForChannel(deps.channel()),
      applyProfile: (profile) => deps.applyProfile(profile),
      isSignedIn: () => deps.identity() !== null,
      identity: () => deps.identity(),
      profile: () => deps.profile(),
      exchange: (input) => this.api().exchange(input),
      open: (descriptor) => this.openFromServer(descriptor.id, descriptor),
      emit: (event) => deps.pushLaunch(event),
      reveal: () => deps.reveal(),
      ...(deps.revealComment
        ? {
            revealComment: (path: string, commentId: string) =>
              deps.revealComment?.(path, commentId),
          }
        : {}),
      ...(deps.now ? { now: deps.now } : {}),
    })
  }

  /** the client for the current profile origin (rebuilt if the origin changes) */
  private api(): UniworkDocsClient {
    if (this.deps.client) return this.deps.client
    const profile = this.deps.profile()
    if (!profile) throw new UniworkDocError('not_signed_in')
    if (!this.client || this.clientOrigin !== profile.apiOrigin) {
      this.client = createUniworkDocsClient({
        apiOrigin: profile.apiOrigin,
        authorized: (call) => this.deps.authorized(call),
        isSignedIn: () => this.deps.identity() !== null,
        ...(this.deps.fetch ? { fetch: this.deps.fetch } : {}),
      })
      this.clientOrigin = profile.apiOrigin
    }
    return this.client
  }

  /** every status push: the shell window, then in-process waiters (close prompt) */
  private publish(status: UniworkDocStatus): void {
    this.deps.pushStatus(this.present(status))
    for (const listener of [...this.statusListeners]) listener(status)
  }

  /**
   * What the chip shows: the binding's state, except that a clean copy whose
   * editor holds unsaved edits reads dirty. Conflict, offline, signed-out and
   * the rest are never hidden by the editor state.
   */
  private present(status: UniworkDocStatus): UniworkDocStatus {
    const quiet = status.state === 'ready' || status.state === 'saved'
    return quiet && status.access === 'edit' && this.editorDirty.has(status.path)
      ? { ...status, state: 'dirty' }
      : status
  }

  private statusOf(doc: BoundDocument): UniworkDocStatus {
    return this.present(toStatus(doc))
  }

  /**
   * The editor showing `path` has (or no longer has) unsaved edits. Pushes the
   * chip only when that changes what it shows; never writes the binding.
   */
  noteEditorDirty(path: string, dirty: boolean, mark?: number): void {
    const doc = typeof path === 'string' ? this.store.lookup(path) : null
    if (!doc || !this.ownsLocally(doc) || doc.binding.access !== 'edit') return
    // a poll pass that began before the last Save still sees the pre-Save
    // edits: the next pass reads the editor again
    if (dirty && mark !== undefined && (this.lastUserSave.get(doc.path) ?? 0) > mark) return
    if (dirty === this.editorDirty.has(doc.path)) return
    const before = this.statusOf(doc).state
    if (dirty) this.editorDirty.add(doc.path)
    else this.editorDirty.delete(doc.path)
    const status = this.statusOf(doc)
    if (status.state !== before) this.deps.pushStatus(status)
  }

  /** the live session's identity; remembered (on disk) as the last owner */
  private liveIdentity(): SessionIdentity | null {
    const identity = this.deps.identity()
    if (!identity) return null
    const last = this.lastOwner
    if (
      !last ||
      last.accountId !== identity.accountId ||
      last.deploymentId !== identity.deploymentId
    ) {
      const owner = { accountId: identity.accountId, deploymentId: identity.deploymentId }
      this.lastOwner = owner
      void this.store.writeLastOwner(owner).catch(() => undefined)
    }
    return identity
  }

  /** the session's account may have changed: remember it as the last owner */
  noteSessionIdentity(): void {
    this.liveIdentity()
    // a live session opens its store: the scope's migration and every later
    // intent write go through this one open
    void this.openSyncStore().catch(() => undefined)
  }

  /** this build's version, as stamped into bindings (display only, never a gate) */
  private buildVersion(): string {
    try {
      return coreSemver(this.appVersion() || '0.0.0')
    } catch {
      return '0.0.0'
    }
  }

  /**
   * The durable store of the live session, or why it cannot be opened right
   * now. Concurrent callers share one open; a failed open (a locked keychain,
   * no keyring, no session) is never remembered, so the next call retries.
   */
  openSyncStore(): Promise<SyncStoreOpen> {
    const sync = this.deps.syncStore
    if (!sync) return Promise.resolve({ kind: 'no_session' })
    // A cold start with a locked keychain has no live session to name a scope
    // (the locked restore dropped it): the saved account's copies still need
    // the store, so this is the store's lock, not "no session".
    if (!this.deps.identity() && this.storeLocked()) {
      const open: SyncStoreOpen = { kind: 'keystore_locked' }
      this.noteStoreOpen(open)
      return Promise.resolve(open)
    }
    this.syncOpen ??= sync
      .open()
      .then(async (open) => {
        this.noteStoreOpen(open)
        if (open.kind === 'ok') await this.migrateLegacyState(sync, open)
        return open
      })
      .finally(() => {
        this.syncOpen = null
      })
    return this.syncOpen
  }

  /**
   * The schema 1 -> 2 sweep (the pre-store plaintext intent moves into the
   * durable store), once per scope and process: the first open after sign-in
   * (or after the keychain unlocks) runs it, every later open skips it. A
   * failed or deferred sweep is not remembered, so the next open retries; a
   * locked store never reaches here.
   */
  private async migrateLegacyState(
    sync: SyncStoreAccess,
    open: SyncStoreOpen & { kind: 'ok' },
  ): Promise<void> {
    const scope = sync.scope()
    if (!scope) return
    const token = `${scope.deploymentId}/${scope.accountId}`
    if (this.migratedScopes.has(token)) return
    try {
      const report = await migrateLegacyIntents({
        root: this.store.root,
        scope,
        records: (name) => open.records(name),
        appVersion: this.buildVersion(),
      })
      // a sweep that could not move every pre-store intent (a store at its
      // budget) is not complete: the next open runs it again, and until then
      // those copies are never rewritten (see awaitingMigration)
      if (report.deferred > 0) {
        console.warn(
          `uniwork sync: legacy save intent migration deferred for ${report.deferred} working copy/copies`,
        )
        return
      }
      this.migratedScopes.add(token)
      if (report.migrated > 0) {
        console.warn(`uniwork sync: moved ${report.migrated} legacy save intent(s) into the store`)
      }
    } catch (error) {
      // the store opened but the sweep could not finish: the next open retries
      console.warn('uniwork sync: legacy save intent migration failed:', error)
    }
  }

  /**
   * True while the copy still holds the pre-store intent pair and this
   * process's sweep has not moved it. Any binding rewrite would stamp schema 2
   * and drop `pendingIntent` - the only replayable record of the save - so
   * such a copy is left exactly as it is until the sweep completes (every
   * store open retries it; the caller sees the failure when one happened).
   */
  private awaitingMigration(doc: BoundDocument): boolean {
    return this.awaitingMigrationIn(doc.dir, doc.deploymentId, doc.userId)
  }

  /** the same for a folder, before the binding is read (the open flow, the guard) */
  private awaitingMigrationIn(dir: string, deploymentId: string, accountId: string): boolean {
    if (this.migratedScopes.has(`${deploymentId}/${accountId}`)) return false
    return hasLegacyIntentFiles(dir)
  }

  /**
   * The one choke point every binding rewrite goes through (BindingStore.write):
   * while the sweep still owns the folder, the write is refused - whatever
   * caller asked for it (a save, the status refresh behind docStatus /
   * refreshPath / confirmClose, an open, a conflict choice). The account scope
   * comes from the folder's own segments, so a folder that is not a
   * working-copy folder of ours is never held.
   */
  private heldByMigration(dir: string): boolean {
    const rel = relative(this.store.root, resolve(dir))
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return false
    const [deploymentId, accountId, key] = rel.split(sep)
    if (!deploymentId || !accountId || !key) return false
    return this.awaitingMigrationIn(dir, deploymentId, accountId)
  }

  /**
   * The save of a copy the sweep still owns: the store open runs the sweep
   * again, and while it cannot complete the save stops here - no intent, no
   * request and no binding write. True = the copy must not be written.
   */
  private async holdForMigration(doc: BoundDocument): Promise<boolean> {
    if (!this.awaitingMigration(doc)) return false
    await this.openSyncStore().catch(() => null)
    return this.awaitingMigration(doc)
  }

  /**
   * The refusal of a save the sweep still owns: the chip says why, but nothing
   * is written - a binding write would stamp schema 2 and drop the plaintext
   * intent. keystore_locked while the store is locked, store_full while it
   * refused the intent write; the next store open retries the sweep either way.
   */
  private refuseMigration(doc: BoundDocument): UniworkDocStatus {
    const status = toStatus({
      ...doc,
      binding: {
        ...doc.binding,
        state: 'error',
        error: this.migrationRefusalCode(),
      },
    })
    this.publish(status)
    return status
  }

  /**
   * The one reason a copy whose pre-store intent could not move reports: the
   * store's own lock while it cannot open, otherwise the store's refusal (a
   * budget it cannot fit). Shared by the save refusal (refuseMigration) and the
   * open's held corner, so the renderer's remedy matches the cause in both.
   */
  private migrationRefusalCode(): 'keystore_locked' | 'store_full' {
    return this.storeLocked() ? 'keystore_locked' : 'store_full'
  }

  /**
   * The outcome of the last open decides the S11 picture: while the store is
   * locked, a working copy that still holds a pre-store intent is locked too
   * (it cannot be opened until the intent can move into the store); once it
   * opens, those locks go - the migration (and every later save) works again.
   */
  private noteStoreOpen(open: SyncStoreOpen): void {
    const was = this.storeOpenKind
    this.storeOpenKind = open.kind
    if (open.kind === 'ok') this.clearKeystoreLocks()
    else if (open.kind === 'keystore_locked' && was !== 'keystore_locked') {
      this.lockLegacyIntents()
    }
  }

  /** the intent store of the session, or why a save cannot record an intent */
  private async intentAccess(): Promise<IntentAccess> {
    const open = await this.openSyncStore()
    if (open.kind === 'ok') {
      return {
        kind: 'ok',
        intents: createIntentStore(open.records(INTENT_STORE_REGISTRATION.name)),
      }
    }
    return open.kind === 'keystore_locked' ? { kind: 'keystore_locked' } : { kind: 'unavailable' }
  }

  /** whether the durable store holds an intent for `doc`; 'locked' = unreachable now */
  private async hasIntent(doc: BoundDocument): Promise<boolean | 'locked' | 'unavailable'> {
    const access = await this.intentAccess()
    if (access.kind === 'keystore_locked') return 'locked'
    if (access.kind !== 'ok') return 'unavailable'
    return (await access.intents.get(doc.key)) !== null
  }

  /** forget the stored intent of `doc` (a new base made it invalid) */
  private async dropIntent(doc: BoundDocument): Promise<void> {
    const access = await this.intentAccess()
    if (access.kind === 'ok') await access.intents.delete(doc.key)
  }

  /**
   * True while the document has local work the feed's full resync must never
   * evict: a working copy that is not clean (dirty, conflict, offline,
   * blocked, signed-out, error, saving), one whose editor holds unsaved edits
   * the file does not show yet, or one with a stored save intent. The
   * reconcile asks this for every indexed id the snapshot no longer lists.
   */
  async hasLocalDraft(documentId: string): Promise<boolean> {
    const identity = this.deps.identity()
    if (!identity) return false
    const dir = this.store.dirFor(identity.deploymentId, identity.accountId, documentId)
    const binding = await this.store.readDir(dir)
    if (!binding || binding.documentId !== documentId) return false
    if (KEEP_LOCAL_STATES.has(binding.state) || binding.state === 'saving') return true
    // the editor holds edits the file does not show yet: keeping the index
    // entry keeps the tab's document reachable until the save lands
    if (this.editorDirty.has(join(dir, binding.filename))) return true
    const access = await this.intentAccess()
    // the store cannot answer: keep the copy rather than evict local work
    if (access.kind !== 'ok') return true
    // the editor signal was read before this await: an editor that turned
    // dirty while the store was answering is local work too, so re-read it
    // here instead of evicting the entry the tab still needs
    return (
      (await access.intents.get(documentId)) !== null ||
      this.editorDirty.has(join(dir, binding.filename))
    )
  }

  /**
   * G8-16 S16: the selected organization changed. The member-name map belongs
   * to one org, so it is dropped (the library lists are re-read by the
   * renderer on the same status push; nothing else here caches a library).
   */
  noteSelectedOrg(orgId: string | null): void {
    if (this.orgMemberNamesOrg !== null && this.orgMemberNamesOrg !== orgId) {
      this.orgMemberNames = new Map()
      this.orgMemberNamesOrg = null
    }
    if (this.orgMemberNamesInFlight && this.orgMemberNamesInFlight.orgId !== orgId) {
      this.orgMemberNamesInFlight = null
    }
  }

  /** the binding belongs to the signed-in account and the active deployment */
  owns(doc: BoundDocument): boolean {
    const identity = this.liveIdentity()
    const profile = this.deps.profile()
    return (
      !!identity &&
      !!profile &&
      identity.deploymentId === profile.deploymentId &&
      doc.deploymentId === identity.deploymentId &&
      doc.userId === identity.accountId
    )
  }

  // ---- store guard (G5-04g newer store, G5-04 lock) ------------------------

  /**
   * The lock for a working copy that must not open: a folder whose binding
   * declares a store this build does not read (schema >= 2 outside the level
   * window), or - while the session store is locked - a copy still holding a
   * pre-store pending intent. Recorded and pushed, so the shell shows the S11
   * panel. True = nothing may open for that path. Nothing is written and no
   * client call is made for it.
   */
  refuseLockedPath(path: string): boolean {
    const lock = this.store.newerStoreAt(path)
    if (lock) {
      this.recordLock(lock)
      return true
    }
    if (this.storeLocked() && this.store.legacyIntentAt(path)) {
      this.recordPathLock(path, 'keystore_locked')
      return true
    }
    return false
  }

  /**
   * The same for a document folder known before the file name (a launch
   * ticket, the open flow). The store is asked only when the folder really
   * holds a pre-store intent: then a locked store refuses the folder, and a
   * store that opens lets the open (and its migration) go ahead.
   */
  private async refuseLockedDir(dir: string): Promise<boolean> {
    const lock = this.store.newerStoreIn(dir)
    if (lock) {
      this.recordLock(lock)
      return true
    }
    if (!hasLegacyIntentFiles(dir)) return false
    const open = await this.openSyncStore().catch(() => null)
    if (open?.kind !== 'keystore_locked') return false
    this.recordDirLock(dir, 'keystore_locked')
    return true
  }

  /** while the store cannot open, every copy still holding a pre-store intent is locked */
  private lockLegacyIntents(): void {
    const scope = this.localScope()
    if (!scope) return
    for (const dir of scopeWorkingCopyDirs(this.store.root, scope)) {
      if (!hasLegacyIntentFiles(dir)) continue
      this.recordDirLock(dir, 'keystore_locked')
    }
  }

  /**
   * The store cannot open right now: the last open said so, or the auth module
   * is in its keystore-locked state (which a cold restore reports with no live
   * session, before any open was even asked for).
   */
  private storeLocked(): boolean {
    return this.storeOpenKind === 'keystore_locked' || this.deps.keystoreLocked?.() === true
  }

  /**
   * The account boundary whose working copies this build may still act on: the
   * live session, or - with no session and a locked keychain - the saved owner
   * of the last live session on the active deployment (the same account whose
   * copies stay editable, see ownsLocally).
   */
  private localScope(): { deploymentId: string; accountId: string } | null {
    const live = this.deps.syncStore?.scope()
    if (live) return { deploymentId: live.deploymentId, accountId: live.accountId }
    if (this.deps.keystoreLocked?.() !== true) return null
    const last = this.lastOwner
    const profile = this.deps.profile()
    if (!last || !profile || last.deploymentId !== profile.deploymentId) return null
    return { deploymentId: last.deploymentId, accountId: last.accountId }
  }

  /** the store opened (again): the keystore_locked panels are stale */
  private clearKeystoreLocks(): void {
    let cleared = false
    for (const [key, lock] of [...this.locks]) {
      if (lock.reason === 'keystore_locked') {
        this.locks.delete(key)
        cleared = true
      }
    }
    // the renderer's list is its own: it must be told the list changed, or a
    // Retry that worked leaves the S11 panel up until some other push
    if (cleared) this.deps.pushLocks?.()
  }

  /**
   * True while an S11 panel is currently shown for this path. NOT "the path is
   * refused": dismissing the panel forgets the lock and the folder still
   * refuses the next open. No production caller; the renderer's own list is the
   * source of truth for what is on screen.
   */
  lockShownFor(path: string): boolean {
    return this.locks.has(pathKey(path))
  }

  /** the locks currently shown (the shell reads them when it mounts) */
  currentLocks(): UniworkDocLock[] {
    return [...this.locks.values()]
  }

  /** "Close" on the S11 panel: the lock is forgotten, nothing else happens */
  dismissLock(path: string): void {
    this.locks.delete(pathKey(path))
  }

  /**
   * Forgets every lock whose path matches, without touching the folders. The
   * account boundary uses it when the account those locks belong to goes away,
   * so the next session is not handed an S11 panel for another account's
   * working copy.
   */
  forgetLocksWhere(match: (path: string) => boolean): void {
    for (const [key, lock] of [...this.locks]) {
      if (match(lock.path)) this.locks.delete(key)
    }
  }

  private recordLock(store: NewerStore, reason: UniworkLockReason = 'store_newer'): void {
    const lock: UniworkDocLock = { path: store.path, reason, name: store.name }
    this.locks.set(pathKey(lock.path), lock)
    this.deps.pushLock?.(lock)
  }

  /** a lock named by the working-copy path itself */
  private recordPathLock(path: string, reason: UniworkLockReason): void {
    const full = resolve(path)
    this.recordLock({ path: full, name: basename(full) }, reason)
  }

  /** a lock named by the document file of its folder (the launch route knows the folder) */
  private recordDirLock(dir: string, reason: UniworkLockReason): void {
    const name = documentNameIn(dir)
    this.recordLock({ path: join(dir, name), name }, reason)
  }

  // ---- module policy -------------------------------------------------------

  /**
   * A working copy whose store is newer is bound (so no module treats it as a
   * plain local file) and read-only (so nothing writes it), even though no
   * binding could be read. One classification (and so one read of binding.json)
   * per call: the editor-state poll asks this for every open tab every second.
   */
  isBound(path: string): boolean {
    return this.store.classify(path).kind !== 'plain'
  }

  /**
   * Local ownership, which never depends on the session being live: with a
   * session the copy must be its account's on the active deployment; without
   * one (signed out, expired, restoring) the last signed-in account's copies
   * on the active deployment stay editable and save locally, and only the
   * UniWork step reports signed-out.
   */
  ownsLocally(doc: BoundDocument): boolean {
    if (this.liveIdentity()) return this.owns(doc)
    const last = this.lastOwner
    const profile = this.deps.profile()
    return (
      !!last &&
      !!profile &&
      last.deploymentId === profile.deploymentId &&
      doc.deploymentId === last.deploymentId &&
      doc.userId === last.accountId
    )
  }

  /** view access, another account's copy, or a newer store this build cannot read (one read) */
  isReadOnly(path: string): boolean {
    const found: PathBinding = this.store.classify(path)
    if (found.kind === 'newer') return true
    return (
      found.kind === 'bound' &&
      (found.doc.binding.access === 'view' || !this.ownsLocally(found.doc))
    )
  }

  /** moves on every user Save; see noteEditorDirty */
  saveMark(): number {
    return this.saveCounter
  }

  /** a module's successful explicit user Save of `path` */
  onUserSave(path: string): void {
    const doc = this.store.lookup(path)
    if (!doc || !this.ownsLocally(doc)) return
    this.lastUserSave.set(doc.path, ++this.saveCounter)
    // the module just wrote what its editor held
    this.editorDirty.delete(doc.path)
    // the sweep still owns this copy's pre-store intent: nothing is sent, and
    // a binding write here would drop the intent (the open retries the sweep)
    if (this.awaitingMigration(doc)) {
      void this.openSyncStore().catch(() => undefined)
      this.refuseMigration(doc)
      return
    }
    void this.coordinator.save(path)
  }

  // ---- renderer API ----------------------------------------------------------

  listWorkspaces(): Promise<UniworkResult<UniworkWorkspaceRef[]>> {
    return result(async () => {
      if (!this.liveIdentity()) throw new UniworkDocError('not_signed_in')
      // the renderer reloads the library through this call: a member-name read
      // that failed earlier is retried here
      this.noteLibraryReload()
      const org = this.deps.selectedOrg()
      if (!org) return []
      const workspaces = await this.api().listWorkspaces(org.id)
      // S17: each row carries my role. One read per workspace, in parallel; a
      // failed role read is null (the row still lists, the renderer shows "—").
      const roles = await Promise.all(
        workspaces.map((ws) =>
          this.api()
            .workspaceRole(ws.id)
            .catch(() => null),
        ),
      )
      return workspaces.map((ws, index) => ({ ...ws, myRole: roles[index] ?? null }))
    })
  }

  /**
   * S17 "Shared with me": the selected org's direct shares, aggregated across
   * its workspaces (the D route is per workspace), de-duplicated by document
   * id, newest first, then paged locally. `cursor` is this method's own
   * opaque offset cursor; a per-workspace page and total-row cap keeps one
   * call bounded.
   */
  listSharedWithMe(query: UniworkSharedQuery = {}): Promise<UniworkResult<UniworkSharedPage>> {
    return result(async () => {
      if (!this.liveIdentity()) throw new UniworkDocError('not_signed_in')
      this.noteLibraryReload()
      const org = this.deps.selectedOrg()
      if (!org) return { documents: [], nextCursor: null }
      const api = this.api()
      const workspaces = await api.listWorkspaces(org.id)
      const nameOf = new Map(workspaces.map((ws) => [ws.id, ws.name]))
      const merged = new Map<string, UniworkDocSummary>()
      await Promise.all(
        workspaces.map(async (ws) => {
          let cursor: string | undefined
          let pages = 0
          do {
            const page: Awaited<ReturnType<typeof api.listSharedWithMe>> =
              await api.listSharedWithMe({ workspaceId: ws.id, cursor, limit: SHARED_PAGE_SIZE })
            for (const doc of page.documents) {
              if (!merged.has(doc.id)) {
                merged.set(doc.id, {
                  ...doc,
                  workspaceName: nameOf.get(doc.workspaceId) ?? ws.name,
                })
              }
            }
            cursor = page.nextCursor ?? undefined
            pages += 1
          } while (cursor && pages < SHARED_MAX_PAGES && merged.size < SHARED_MAX_ROWS)
        }),
      )
      const all = [...merged.values()].sort((a, b) =>
        a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
      )
      const limit = Math.min(
        SHARED_PAGE_SIZE,
        Math.max(1, Math.floor(Number(query.limit) || SHARED_PAGE_SIZE)),
      )
      const offset = parseOffsetCursor(query.cursor)
      const slice = all.slice(offset, offset + limit)
      const next = offset + limit < all.length ? `shared:${offset + limit}` : null
      return { documents: slice, nextCursor: next }
    })
  }

  /**
   * S17 properties panel. Reads GET /documents/{id} for the ids/times/level/
   * version, then resolves display names best-effort through the org member
   * list (readable by every member). Anything unresolved stays null ("—").
   */
  documentProperties(documentId: string): Promise<UniworkResult<UniworkDocProperties>> {
    return result(async () => {
      if (!this.liveIdentity()) throw new UniworkDocError('not_signed_in')
      if (typeof documentId !== 'string') throw new UniworkDocError('not_found')
      const properties = await this.api().documentProperties(documentId)
      const names = await this.memberNames()
      // a name resolves only for an id in the member list; a person who left
      // stays null ("—")
      const nameOf = (id: string | null): string | null => (id ? (names.get(id) ?? null) : null)
      // an actor is a person only when the kind says so; a `work_product` owner
      // or an agent/system creator/updater is never shown as a member even if
      // its id happens to match one. A kind the server did not send stays
      // lenient (an older server omits it) and is looked up.
      const personName = (id: string | null, kind: string | null): string | null =>
        kind === null || kind === 'human' ? nameOf(id) : null
      return {
        documentId: properties.id,
        workspaceId: properties.workspaceId,
        title: properties.title,
        // the owner follows D's own rule: only owner_kind === 'human' is a person
        ownerName: properties.ownerKind === 'human' ? nameOf(properties.ownerId) : null,
        createdByName: personName(properties.createdById, properties.createdByKind),
        createdAt: properties.createdAt,
        updatedByName: personName(properties.updatedById, properties.updatedByKind),
        updatedAt: properties.updatedAt,
        myLevel: properties.myLevel,
        version: properties.currentVersion,
        // D's DocumentDTO carries no per-version updater: `updated_by` is also
        // set by a rename/metadata patch, so it must not name the version's
        // author. Always null until D sends one (see contract residual).
        versionByName: null,
        ownerId: properties.ownerId,
        createdById: properties.createdById,
        updatedById: properties.updatedById,
      }
    })
  }

  // ---- S18: create, rename, archive ------------------------------------------

  /** the folders of one workspace, for the "Location" field of create/upload */
  listFolders(workspaceId: string): Promise<UniworkResult<UniworkDocFolderRef[]>> {
    return result(async () => {
      if (typeof workspaceId !== 'string' || !workspaceId) throw new UniworkDocError('not_found')
      return this.api().listFolders(workspaceId)
    })
  }

  /**
   * Create a blank document (docx/xlsx/pptx) in a workspace/folder. The name is
   * validated before any call (empty -> `name_empty`, over 500 runes ->
   * `name_too_long`, no request), and the answer is the server document; the
   * caller opens it by id, so no second local copy exists. A duplicate name is
   * allowed: the request goes out and the server decides.
   */
  createDocument(input: UniworkCreateDocInput): Promise<UniworkDocActionResult<UniworkDocSummary>> {
    return actionResult(
      async () => {
        if (!this.liveIdentity()) throw new UniworkDocError('not_signed_in')
        const target = this.docTarget(input)
        const name = requireName(input.name)
        return this.api().createBlank({
          workspaceId: target.workspaceId,
          format: input.format,
          title: name,
          parentId: target.folderId,
          idempotencyKey: this.newIdempotencyKey(),
        })
      },
      { nameField: true },
    )
  }

  /**
   * Upload one local file as a UniWork document. Main stats the file first (a
   * pick past the server's 50 MiB stage limit is refused unread with
   * `too_large`), reads the bytes and sends them as the multipart `file` part
   * while reporting progress; the title is the file name (the server's own
   * default). Nothing is written locally: the working copy is the download the
   * open flow makes from the created document.
   *
   * The upload is reachable for the dialog's Cancel through its own `uploadId`:
   * `cancelUpload` aborts the read and the POST, and this call then answers
   * `upload_cancelled`. An abort that lands after D already answered 2xx is
   * ignored - the created document is returned as usual (never a hidden delete).
   */
  uploadDocument(input: UniworkUploadDocInput): Promise<UniworkDocActionResult<UniworkDocSummary>> {
    return actionResult(async () => {
      if (!this.liveIdentity()) throw new UniworkDocError('not_signed_in')
      const target = this.docTarget(input)
      const uploadId = requireUploadId(input.uploadId)
      if (typeof input.path !== 'string' || !input.path) throw new UniworkDocError('not_found')
      const filename = basename(input.path)
      if (!filename) throw new UniworkDocError('not_found')
      let size: number
      try {
        const info = await stat(input.path)
        if (!info.isFile()) throw new UniworkDocError('not_found')
        size = info.size
      } catch (error) {
        throw error instanceof UniworkDocError ? error : new UniworkDocError('not_found')
      }
      if (size > MAX_UPLOAD_BYTES) throw new UniworkDocError('too_large')
      const controller = new AbortController()
      this.uploads.set(uploadId, controller)
      try {
        let bytes: Uint8Array
        try {
          bytes = new Uint8Array(await readFile(input.path, { signal: controller.signal }))
        } catch {
          if (controller.signal.aborted) throw cancelledUpload()
          throw new UniworkDocError('not_found')
        }
        const total = bytes.byteLength
        this.deps.pushUploadProgress?.({ uploadId, path: input.path, loaded: 0, total })
        const created = await this.api()
          .createFile({
            workspaceId: target.workspaceId,
            bytes,
            filename,
            title: filename,
            parentId: target.folderId,
            idempotencyKey: this.newIdempotencyKey(),
            signal: controller.signal,
          })
          .catch((error: unknown) => {
            // the person cancelled while the POST was in flight: that is the
            // answer, not the network failure the abort surfaced as
            if (controller.signal.aborted) throw cancelledUpload()
            throw error
          })
        this.deps.pushUploadProgress?.({ uploadId, path: input.path, loaded: total, total })
        return created
      } finally {
        // a newer upload with the same id (never minted twice) keeps its controller
        if (this.uploads.get(uploadId) === controller) this.uploads.delete(uploadId)
      }
    })
  }

  /**
   * S18: the dialog's Cancel/Esc. The abort ends this upload's file read or its
   * running POST (whichever it is in); the upload call answers
   * `upload_cancelled`. An unknown or already-finished id is a no-op, so a
   * Cancel racing its own upload's settle is harmless.
   */
  cancelUpload(uploadId: string): void {
    if (typeof uploadId !== 'string' || !uploadId) return
    this.uploads.get(uploadId)?.abort()
  }

  /** S18: main shows the native open dialog for an upload */
  pickUploadFile(): Promise<{ path: string; name: string } | null> {
    return this.deps.pickUploadFile?.() ?? Promise.resolve(null)
  }

  /**
   * Rename a document. Anything below edit is refused before any write (the
   * server is the real gate, but the person has no such action, so main does not
   * even try): D omits `my_level` on a row it will not let the caller edit and
   * its documented default is view, so an absent or unknown level fails closed,
   * exactly like the list rows' `canEdit`. The current revision is read first
   * because PATCH requires it.
   */
  renameDocument(
    documentId: string,
    name: string,
  ): Promise<UniworkDocActionResult<UniworkDocSummary>> {
    return actionResult(
      async () => {
        if (!this.liveIdentity()) throw new UniworkDocError('not_signed_in')
        if (typeof documentId !== 'string' || !documentId) throw new UniworkDocError('not_found')
        const title = requireName(name)
        const detail = await this.api().getDocument(documentId)
        if (detail.myLevel !== 'edit' && detail.myLevel !== 'manage') {
          throw new UniworkDocError('forbidden')
        }
        if (title === detail.title) return this.summaryOf(detail)
        const renamed = await this.api().rename({ documentId, revision: detail.revision, title })
        // this service's own rename: only the revision it produced is its echo,
        // so a genuine later change for another revision is still followed (R1-6)
        this.selfRenamed.set(documentId, renamed.revision)
        await this.afterLocalRename(documentId, renamed.summary.title)
        return renamed.summary
      },
      { nameField: true },
    )
  }

  /** S18: archive a document (the server moves its subtree to the trash) */
  archiveDocument(documentId: string): Promise<UniworkDocActionResult<UniworkDocSummary>> {
    return actionResult(async () => {
      if (!this.liveIdentity()) throw new UniworkDocError('not_signed_in')
      if (typeof documentId !== 'string' || !documentId) throw new UniworkDocError('not_found')
      await this.requireManage(documentId)
      return this.api().archive(documentId, this.newIdempotencyKey())
    })
  }

  /** S18: restore an archived document (only its own archive batch comes back) */
  restoreDocument(documentId: string): Promise<UniworkDocActionResult<UniworkDocSummary>> {
    return actionResult(async () => {
      if (!this.liveIdentity()) throw new UniworkDocError('not_signed_in')
      if (typeof documentId !== 'string' || !documentId) throw new UniworkDocError('not_found')
      await this.requireManage(documentId)
      return this.api().restore(documentId, this.newIdempotencyKey())
    })
  }

  /** the workspace/folder a create or upload targets, validated before any call */
  private docTarget(input: { workspaceId?: unknown; folderId?: unknown }): {
    workspaceId: string
    folderId: string | null
  } {
    const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
    if (!workspaceId) throw new UniworkDocError('not_found')
    const folderId = typeof input.folderId === 'string' && input.folderId ? input.folderId : null
    return { workspaceId, folderId }
  }

  /** archive/restore need manage; a view row (and an edit row) is refused without a call */
  private async requireManage(documentId: string): Promise<void> {
    const detail = await this.api().getDocument(documentId)
    if (detail.myLevel !== 'manage') throw new UniworkDocError('forbidden')
  }

  /**
   * The summary a rename/create answer already carries, without a second read.
   * The flags come from the detail the call was gated on (a no-op rename of an
   * archived manage-level document must not report `canManage:false,
   * archived:false`), and the format from the file block first (R1-2).
   */
  private summaryOf(detail: DocumentDetail): UniworkDocSummary {
    return {
      id: detail.id,
      workspaceId: detail.workspaceId,
      title: detail.title,
      format:
        formatForMime(detail.file.mimeType) ??
        formatForName(detail.file.filename) ??
        formatForName(detail.title),
      updatedAt: '',
      ...actionFlags(detail.myLevel, detail.archivedAt),
    }
  }

  private newIdempotencyKey(): string {
    return this.deps.now
      ? `uniwork-doc-${this.deps.now()}-${randomUUID()}`
      : `uniwork-doc-${randomUUID()}`
  }

  /**
   * The org's member names (id -> display name), read across D's pages
   * (`next_cursor`, up to `MEMBERS_MAX_PAGES`). Only a success or a 403/404
   * (the org will not list members to a plain member) is cached, so the panel
   * never issues one logical read per document; a network error or 5xx is NOT
   * cached — the call returns an empty map ("—", no error banner) and the next
   * panel open retries. At most one logical read per org is in flight:
   * concurrent panel opens share the same promise. The cache is dropped on an
   * org change / sign-out (`noteSelectedOrg`) and at the next library reload
   * (`noteLibraryReload`).
   */
  private memberNames(): Promise<Map<string, string>> {
    const org = this.deps.selectedOrg()
    if (!org) return Promise.resolve(new Map())
    if (this.orgMemberNamesOrg === org.id) return Promise.resolve(this.orgMemberNames)
    if (this.orgMemberNamesInFlight?.orgId === org.id) return this.orgMemberNamesInFlight.promise
    const promise = this.loadMemberNames(org)
    this.orgMemberNamesInFlight = { orgId: org.id, promise }
    return promise
  }

  private async loadMemberNames(org: { id: string; slug: string }): Promise<Map<string, string>> {
    try {
      const names = await this.readAllMemberNames(org.slug)
      this.orgMemberNames = names
      this.orgMemberNamesOrg = org.id
      return names
    } catch (error) {
      // a 403/404 is a stable answer ("names unavailable for this org"); a
      // transient failure is not cached and is retried on the next open
      const stable =
        error instanceof UniworkDocError &&
        (error.code === 'forbidden' || error.code === 'not_found')
      if (stable) {
        const empty = new Map<string, string>()
        this.orgMemberNames = empty
        this.orgMemberNamesOrg = org.id
        return empty
      }
      return new Map()
    } finally {
      if (this.orgMemberNamesInFlight?.orgId === org.id) this.orgMemberNamesInFlight = null
    }
  }

  /**
   * Every member of the org as id -> display name, following D's `next_cursor`
   * across pages. One logical read per org (the caller caches the result and
   * dedupes concurrent opens), so an org larger than one page still resolves
   * names from later pages. `MEMBERS_MAX_PAGES` caps the walk.
   */
  private async readAllMemberNames(orgSlug: string): Promise<Map<string, string>> {
    const api = this.api()
    const names = new Map<string, string>()
    let cursor: string | undefined
    let pages = 0
    do {
      const page = await api.listOrgMembers({
        orgSlug,
        limit: MEMBERS_PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      })
      for (const member of page.members) names.set(member.userId, member.displayName)
      cursor = page.nextCursor ?? undefined
      pages += 1
    } while (cursor && pages < MEMBERS_MAX_PAGES)
    return names
  }

  /**
   * The renderer re-read the library (picker open, Retry, or the org-change
   * status push): the org member-name cache is dropped so a read that failed
   * earlier is retried at this point, not on every properties panel.
   */
  noteLibraryReload(): void {
    // a read still in flight settles its own cache entry; only the settled
    // map is dropped here, so the one-in-flight rule is not broken
    this.orgMemberNames = new Map()
    this.orgMemberNamesOrg = null
  }

  listDocuments(query: UniworkDocListQuery): Promise<UniworkResult<UniworkDocListPage>> {
    return result(async () => {
      if (!query || typeof query.workspaceId !== 'string') throw new UniworkDocError('not_found')
      return this.api().listDocuments({
        workspaceId: query.workspaceId,
        ...(typeof query.query === 'string' ? { query: query.query } : {}),
        ...(typeof query.cursor === 'string' ? { cursor: query.cursor } : {}),
        ...(typeof query.limit === 'number' ? { limit: query.limit } : {}),
      })
    })
  }

  openDocument(documentId: string): Promise<UniworkResult<{ path: string }>> {
    return result(async () => {
      if (typeof documentId !== 'string') throw new UniworkDocError('not_found')
      const { path } = await this.openFromServer(documentId)
      return { path }
    })
  }

  /** the status, after re-checking the working copy's bytes (A1.3) */
  async docStatus(path: string): Promise<UniworkDocStatus | null> {
    if (typeof path !== 'string') return null
    const doc = this.store.lookup(path)
    return doc && this.ownsLocally(doc) ? this.statusOf(await this.refreshDirty(doc)) : null
  }

  activeDocStatus(): Promise<UniworkDocStatus | null> {
    const path = this.deps.activePath()
    return path ? this.docStatus(path) : Promise.resolve(null)
  }

  /** tab activation: bytes written outside the save hook show as dirty */
  async refreshPath(path: string | undefined): Promise<void> {
    const doc = path ? this.store.lookup(path) : null
    if (!doc || !this.ownsLocally(doc)) return
    await this.refreshDirty(doc)
    // S18 renamed-elsewhere: a tab that gains focus re-reads the document's
    // metadata, so a title changed on the web shows here without the feed
    void this.refreshMetadataFor(doc.binding.documentId).catch(() => undefined)
  }

  // ---- S18: renamed elsewhere -------------------------------------------------

  /**
   * A change the G5-04 feed applied for `documentId` (wiring), with the
   * revision the feed reported. A rename this service made itself is skipped
   * only for the revision that rename produced: its own write echoing back. A
   * change for any other revision - including the first one when the echo never
   * arrived - is someone else's rename and is followed (R1-6). Without a
   * revision the notice is taken as this service's own echo, so the one-shot
   * suppression the callers without a feed still rely on is unchanged.
   */
  noteFeedChange(documentId: string, revision?: string): void {
    if (typeof documentId !== 'string' || !documentId) return
    const own = this.selfRenamed.get(documentId)
    if (own !== undefined) {
      this.selfRenamed.delete(documentId)
      if (revision === undefined || revision === own) return
    }
    void this.refreshMetadataFor(documentId).catch(() => undefined)
  }

  /**
   * Re-read one document's metadata and, when its title changed, follow it: the
   * binding's title (and the working-copy name, while the copy is clean and no
   * editor holds it), the pushed status, the shell's tab/editor re-key and the
   * renderer's S18 announce. Never runs for a document with local work (a
   * rename must not disturb an unsaved copy) or for one this session does not
   * own.
   */
  async refreshMetadataFor(documentId: string): Promise<void> {
    if (typeof documentId !== 'string' || !documentId) return
    const identity = this.liveIdentity()
    if (!identity) return
    const dir = this.store.dirFor(identity.deploymentId, identity.accountId, documentId)
    const existing = await this.store.readDir(dir)
    if (!existing || existing.documentId !== documentId) return
    const local = join(dir, existing.filename)
    if (!this.store.exists(local)) return
    if (KEEP_LOCAL_STATES.has(existing.state) || this.coordinator.isSaving(local)) return
    let detail: DocumentDetail
    try {
      detail = await this.api().getDocument(documentId)
    } catch {
      return
    }
    // the metadata read is async: a save may have started or settled, and an
    // editor may have made the copy dirty, while it was in flight. The title is
    // applied to the binding as it is NOW - never re-written from the one read
    // before the await, which would clear that newer state (R1-4).
    const latest = await this.store.readDir(dir)
    if (!latest || latest.documentId !== documentId) return
    const latestLocal = join(dir, latest.filename)
    if (!this.store.exists(latestLocal)) return
    if (KEEP_LOCAL_STATES.has(latest.state) || this.coordinator.isSaving(latestLocal)) return
    if (detail.title === latest.title) return
    await this.applyTitle(latest, detail.title, latestLocal, true)
  }

  /** the binding rewrite that follows a title change, plus the pushes it owes */
  private async applyTitle(
    doc: Binding,
    title: string,
    local: string,
    announce: boolean,
  ): Promise<void> {
    const dir = dirname(local)
    let filename = doc.filename
    let path = local
    const open = this.deps.isPathOpen(local)
    // the schema 1 -> 2 sweep still owns this folder: the store refuses every
    // binding write (see BindingStore.write), so moving the file first would
    // leave binding.json naming a file that no longer exists and the copy
    // unreachable by lookup. The title is what this call may still carry; the
    // pre-store intent pair stays byte for byte (R1-3, the open flow's guard).
    const held = this.heldByMigration(dir)
    // an editor holding the copy keeps its file name: the shell re-keys a tab
    // only for a path that actually moved, and Windows refuses a rename under an
    // open handle
    if (!open && !held) {
      const candidate = workingCopyName(title, doc.filename, doc.format)
      if (candidate !== doc.filename) {
        const next = join(dir, candidate)
        try {
          await rename(local, next)
          filename = candidate
          path = next
        } catch {
          // the old name stays; the title still updates
        }
      }
    }
    const written = await this.store.write(dir, { ...doc, title, filename })
    const fresh = written ? this.store.lookup(path) : null
    if (fresh) this.publish(toStatus(fresh))
    if (path !== local) this.deps.notifyPathRenamed?.(local, path)
    // the copy kept its name under an open editor: the title must still reach
    // the tab and the editor, so the shell re-titles the open tab/window by path
    // and the module follows through its own rename IPC (S18 `file.renamed`)
    else if (open) this.deps.notifyTitleRenamed?.(local, title)
    if (announce) this.deps.pushDocRenamed?.({ documentId: doc.documentId, title })
  }

  /** a rename this service made: follow the binding, but do not re-announce it */
  private async afterLocalRename(documentId: string, title: string): Promise<void> {
    const identity = this.liveIdentity()
    if (!identity) return
    const dir = this.store.dirFor(identity.deploymentId, identity.accountId, documentId)
    const existing = await this.store.readDir(dir)
    if (!existing || existing.documentId !== documentId) return
    const local = join(dir, existing.filename)
    if (!this.store.exists(local) || existing.title === title) return
    await this.applyTitle(existing, title, local, false)
  }

  /**
   * Bytes changed with no user-save hook (Save As onto the working copy, an
   * agent save-to, pdf page tools): a ready/saved binding whose file no
   * longer matches the base becomes dirty. Never uploads anything.
   */
  private async refreshDirty(doc: BoundDocument): Promise<BoundDocument> {
    const clean = (b: Binding) =>
      b.access === 'edit' &&
      (b.state === 'ready' || b.state === 'saved') &&
      !this.coordinator.isSaving(doc.path)
    if (!clean(doc.binding)) return doc
    let checksum: string
    try {
      checksum = sha256Hex(new Uint8Array(await readFile(doc.path)))
    } catch {
      return doc
    }
    if (checksum === doc.binding.baseChecksum) return doc
    // a save may have started or settled while hashing: decide on the latest binding
    const fresh = this.store.lookup(doc.path)
    if (
      !fresh ||
      !clean(fresh.binding) ||
      fresh.binding.baseChecksum !== doc.binding.baseChecksum
    ) {
      return fresh ?? doc
    }
    const next: Binding = { ...fresh.binding, state: 'dirty' }
    delete next.error
    return this.coordinator.commitState(fresh, next)
  }

  /**
   * Save/Retry from the chip. A stored pending intent is replayed as it is
   * (same key, its own payload) without asking the module to write: a module
   * Save may re-serialize different bytes, which would leave a landed save
   * looking dirty. With no intent it runs the module's own Save; a locked
   * store refuses before either, so no other save path exists.
   */
  async save(path: string): Promise<UniworkDocStatus | null> {
    const doc = typeof path === 'string' ? this.store.lookup(path) : null
    if (!doc || !this.ownsLocally(doc)) return null
    if (!this.canSave(doc)) return this.statusOf(doc)
    // a copy whose pre-store intent the sweep has not moved yet is left alone:
    // a save would rewrite its binding and drop that intent (R1-be-5)
    if (await this.holdForMigration(doc)) return this.refuseMigration(doc)
    const intent = await this.hasIntent(doc)
    if (intent === 'locked') {
      const refused = await this.coordinator.commitState(doc, {
        ...doc.binding,
        state: 'error',
        error: 'keystore_locked',
      })
      return this.statusOf(refused)
    }
    if (intent !== true && this.deps.requestModuleSave(doc.path)) return this.statusOf(doc)
    // a pending intent, or no tab shows it: the file on disk is the user's last saved bytes
    const saved = await this.coordinator.save(doc.path)
    return saved ? this.statusOf(saved) : null
  }

  /** a Save that can reach the UniWork step (not view, conflict, saving or blocked) */
  private canSave(doc: BoundDocument): boolean {
    const b = doc.binding
    if (b.access === 'view' || b.state === 'conflict' || this.coordinator.isSaving(doc.path)) {
      return false
    }
    return !(b.state === 'blocked' && b.error !== 'quota_exceeded')
  }

  // ---- close guard (A1.4) ----------------------------------------------------

  /** synchronous pre-check for the close guards: an editable copy of ours */
  isCloseGuarded(path: string): boolean {
    const doc = this.store.lookup(path)
    return !!doc && doc.binding.access === 'edit' && this.ownsLocally(doc)
  }

  /**
   * Synchronous: would closing `path` show the prompt? An editable copy of ours
   * that is not in `ready`/`saved`, has a pending intent or is saving, or whose
   * file no longer matches the base. A clean copy is false, so a window with
   * only clean documents closes without a prompt chain (see
   * installShellCloseGuard). Hashing is memoized by mtime and size.
   */
  needsClosePrompt(path: string): boolean {
    const doc = this.store.lookup(path)
    if (!doc || doc.binding.access !== 'edit' || !this.ownsLocally(doc)) return false
    const b = doc.binding
    if (this.coordinator.isSaving(doc.path)) return true
    if (b.state !== 'ready' && b.state !== 'saved') return true
    try {
      const { mtimeMs, size } = statSync(doc.path)
      const memo = this.hashMemo.get(doc.path)
      if (memo && memo.mtimeMs === mtimeMs && memo.size === size) {
        return memo.checksum !== b.baseChecksum
      }
      const checksum = sha256Hex(new Uint8Array(readFileSync(doc.path)))
      this.hashMemo.set(doc.path, { mtimeMs, size, checksum })
      return checksum !== b.baseChecksum
    } catch {
      return false
    }
  }

  /**
   * Closing (or quitting) a bound document whose local bytes are not in
   * UniWork: one native prompt. "Save to UniWork" runs the normal Save and
   * allows the close only once it reaches `saved`; in a conflict the default
   * button opens the conflict dialog (as the chip's "Resolve...") and the
   * close goes ahead only if that ends in `saved`; a blocked document has no
   * Save, only its reason. "Close anyway" closes (the copy stays on this
   * computer); "Cancel" keeps it open. True = may close.
   */
  async confirmClose(path: string): Promise<boolean> {
    for (;;) {
      let doc = this.store.lookup(path)
      if (!doc || doc.binding.access !== 'edit' || !this.ownsLocally(doc)) return true
      // a Save from the module's own close prompt may still be uploading
      if (this.coordinator.isSaving(doc.path)) {
        await this.coordinator.settled(doc.path)
        doc = this.store.lookup(path)
        if (!doc) return true
      }
      doc = await this.refreshDirty(doc)
      const b = doc.binding
      if (!UNSENT_STATES.has(b.state)) return true
      const kind: UnsavedCloseKind =
        b.state === 'conflict'
          ? 'conflict'
          : b.state === 'blocked' && b.error !== 'quota_exceeded'
            ? 'blocked'
            : 'unsent'
      const choice = await this.deps.ui.chooseUnsavedClose(b.title, kind, b.error)
      if (choice === 'close') return true
      if (kind === 'unsent' && choice === 'save') return this.saveForClose(path)
      if (kind === 'conflict' && choice === 'resolve') {
        const outcome = await this.resolveForClose(path)
        if (outcome === 'again') continue
        return outcome === 'closed'
      }
      return false
    }
  }

  /** "Save to UniWork" from the close prompt: true only once the save reached `saved` */
  private async saveForClose(path: string): Promise<boolean> {
    const latest = this.store.lookup(path)
    if (!latest || !this.canSave(latest)) return this.keepOpen(path)
    // the sweep still owns the copy's pre-store intent: nothing may be written
    if (await this.holdForMigration(latest)) {
      this.refuseMigration(latest)
      return false
    }
    const wait = this.waitForSettle(latest.path, CLOSE_SAVE_WAIT_MS)
    const notWritten = () => {
      if (!this.coordinator.isSaving(latest.path)) wait.cancel()
    }
    const intent = await this.hasIntent(latest)
    if (intent === 'locked') {
      // the store cannot record an intent: nothing is written and nothing is sent
      await this.coordinator.commitState(latest, {
        ...latest.binding,
        state: 'error',
        error: 'keystore_locked',
      })
      wait.cancel()
      return this.keepOpen(path)
    }
    // a stored intent is replayed as it is, the module is not asked to write
    if (intent === true || !this.deps.requestModuleSave(latest.path, notWritten)) {
      void this.coordinator.save(latest.path)
    }
    return (await wait.promise)?.state === 'saved' ? true : this.keepOpen(path)
  }

  /**
   * The conflict dialog from the close prompt. 'closed' = the resolution ended
   * in `saved`; 'again' = still in conflict (decide later, a copy, a cancelled
   * discard), so the prompt comes back; 'kept' = anything else (the tab stays).
   */
  private async resolveForClose(path: string): Promise<'closed' | 'again' | 'kept'> {
    // an overwrite saves in the background: dirty and saving are not the end of it
    const wait = this.waitForSettle(path, CLOSE_SAVE_WAIT_MS, new Set(['saving', 'dirty']))
    const notWritten = () => {
      if (!this.coordinator.isSaving(path)) wait.cancel()
    }
    await this.resolveConflict(path, notWritten, { fromClose: true })
    const after = this.store.lookup(path)
    if (!after || after.binding.state === 'saved') {
      wait.cancel()
      return 'closed'
    }
    if (after.binding.state === 'conflict') {
      wait.cancel()
      return 'again'
    }
    const status = await wait.promise
    if (status?.state === 'saved') return 'closed'
    if (status?.state === 'conflict') return 'again'
    this.keepOpen(path)
    return 'kept'
  }

  /** the tab stays open: publish its state so the chip says why */
  private keepOpen(path: string): false {
    const doc = this.store.lookup(path)
    if (doc) this.publish(toStatus(doc))
    return false
  }

  /**
   * The next status of `path` whose state is not in `ignore` (default: not
   * `saving`); null on timeout or `cancel()`.
   */
  private waitForSettle(
    path: string,
    timeoutMs: number,
    ignore: ReadonlySet<string> = new Set(['saving']),
  ): { promise: Promise<UniworkDocStatus | null>; cancel: () => void } {
    let finish: (status: UniworkDocStatus | null) => void = () => undefined
    const promise = new Promise<UniworkDocStatus | null>((resolveWait) => {
      const listener = (status: UniworkDocStatus) => {
        if (status.path === path && !ignore.has(status.state)) finish(status)
      }
      const timer = setTimeout(() => finish(null), timeoutMs)
      ;(timer as { unref?: () => void }).unref?.()
      finish = (status) => {
        clearTimeout(timer)
        this.statusListeners.delete(listener)
        resolveWait(status)
      }
      this.statusListeners.add(listener)
    })
    return { promise, cancel: () => finish(null) }
  }

  /**
   * The conflict dialog for the document at `path`, and only that document:
   * every step reads its binding again and acts on it only while it is still
   * the same document in conflict, so a choice never lands on another tab's
   * document, revision or format. One dialog at a time: a dialog for another
   * document closes as "Decide later" first.
   */
  async resolveConflict(
    path: string,
    onNotWritten?: () => void,
    opts: { fromClose?: boolean } = {},
  ): Promise<UniworkDocStatus | null> {
    const doc = typeof path === 'string' ? this.store.lookup(path) : null
    if (!doc || !this.ownsLocally(doc)) return null
    if (doc.binding.state !== 'conflict') return this.statusOf(doc)
    const open = this.conflictPrompt
    if (open && samePath(open.path, doc.path)) return this.statusOf(doc)
    if (open) {
      open.controller.abort()
      await open.done
    }
    const controller = new AbortController()
    const done = this.runConflict(doc, controller.signal, onNotWritten)
    const prompt = { path: doc.path, controller, fromClose: !!opts.fromClose, done }
    this.conflictPrompt = prompt
    try {
      return await done
    } finally {
      if (this.conflictPrompt === prompt) this.conflictPrompt = null
    }
  }

  /**
   * The active document changed (tab switch, the home tab, a language
   * switch): a conflict dialog opened for another document from its chip
   * closes as "Decide later", so it never sits over a tab it does not name.
   */
  noteActivePath(path: string | undefined): void {
    const open = this.conflictPrompt
    if (open && !open.fromClose && !(path && samePath(open.path, path))) open.controller.abort()
  }

  /** closes an open conflict dialog as "Decide later" (its text is in the old UI language) */
  closeConflictPrompt(): void {
    this.conflictPrompt?.controller.abort()
  }

  private async runConflict(
    doc: BoundDocument,
    signal: AbortSignal,
    onNotWritten?: () => void,
  ): Promise<UniworkDocStatus | null> {
    const choice = signal.aborted
      ? 'later'
      : await this.deps.ui.chooseConflict(doc.binding.title, signal)
    if (signal.aborted || choice === 'later') return this.currentStatus(doc)
    const chosen = this.stillInConflict(doc)
    if (!chosen) return this.currentStatus(doc)
    if (choice === 'overwrite') return this.overwrite(chosen, onNotWritten)
    if (choice === 'save-local-copy') {
      const b = chosen.binding
      const titleExt = extname(b.title)
      const stem = (titleExt ? b.title.slice(0, -titleExt.length) : b.title) || 'document'
      const target = await this.deps.ui.pickCopyPath(stem, b.format)
      // a plain local file; the document itself stays in conflict. A target
      // inside the working-copy folders would not be one (or is the copy itself)
      if (target) {
        const copied =
          !this.store.isInside(target) &&
          (await copyFile(chosen.path, target).then(
            () => true,
            () => false,
          ))
        if (!copied) this.deps.ui.showCopyFailed()
      }
      return this.currentStatus(chosen)
    }
    if (choice === 'open-latest') {
      const confirmed = await this.deps.ui.confirmDiscard(chosen.binding.title, signal)
      const latest = confirmed && !signal.aborted ? this.stillInConflict(chosen) : null
      if (!latest) return this.currentStatus(chosen)
      try {
        return this.statusOf(await this.replaceWithLatest(latest))
      } catch {
        this.deps.ui.showOpenLatestFailed()
        return this.currentStatus(latest)
      }
    }
    return this.currentStatus(doc)
  }

  /** the binding at `doc.path` now, if it is still that document and still in conflict */
  private stillInConflict(doc: BoundDocument): BoundDocument | null {
    const now = this.store.lookup(doc.path)
    return now &&
      now.binding.documentId === doc.binding.documentId &&
      now.binding.state === 'conflict' &&
      this.ownsLocally(now)
      ? now
      : null
  }

  /** the status of the document at `doc.path` as it is now (null once it is gone) */
  private currentStatus(doc: BoundDocument): UniworkDocStatus | null {
    const now = this.store.lookup(doc.path)
    return now ? this.statusOf(now) : null
  }

  /** recents: null = not a UniWork copy, 'hidden' = another account/deployment */
  recentSource(path: string): RecentUniworkSource | 'hidden' | null {
    const doc = this.store.lookup(path)
    if (!doc) return this.store.isInside(path) ? 'hidden' : null
    if (!this.owns(doc)) return 'hidden'
    const b = doc.binding
    return {
      documentId: b.documentId,
      workspaceId: b.workspaceId,
      title: b.title,
      access: b.access,
    }
  }

  // ---- flows -----------------------------------------------------------------

  /** "Save my version as the newest version": a new intent on the server's revision */
  private async overwrite(
    doc: BoundDocument,
    onNotWritten?: () => void,
  ): Promise<UniworkDocStatus | null> {
    let serverRevision = doc.binding.serverRevision
    if (!serverRevision) {
      try {
        serverRevision = (await this.api().getDocument(doc.binding.documentId)).revision
      } catch (error) {
        const code = error instanceof UniworkDocError ? error.code : 'server_error'
        await this.coordinator.commitState(doc, { ...doc.binding, error: code })
        return this.statusOf(doc)
      }
    }
    const next: Binding = {
      ...doc.binding,
      baseRevision: serverRevision,
      // the server's bytes are unknown here: the next Save always uploads
      baseChecksum: '',
      state: 'dirty',
    }
    delete next.error
    delete next.serverRevision
    // the old base's intent is invalid on the server's revision
    await this.dropIntent(doc)
    const ready = await this.coordinator.commitState(doc, next)
    if (this.deps.requestModuleSave(ready.path, onNotWritten)) return this.statusOf(ready)
    const saved = await this.coordinator.save(ready.path)
    return saved ? this.statusOf(saved) : this.statusOf(ready)
  }

  /** "Discard my changes and open the latest": download, replace, reload the tab */
  private async replaceWithLatest(doc: BoundDocument): Promise<BoundDocument> {
    const { detail, bytes } = await this.fetchLatest(doc.binding.documentId)
    await this.store.writeWorkingCopy(doc.dir, doc.binding.filename, bytes)
    // the local work (and its intent) is discarded: nothing is left to replay
    await this.dropIntent(doc)
    const next: Binding = {
      ...doc.binding,
      title: detail.title,
      access: accessFor(detail.myLevel),
      baseRevision: detail.revision,
      baseVersion: detail.file.version,
      baseChecksum: sha256Hex(bytes),
      state: 'saved',
    }
    delete next.error
    delete next.serverRevision
    const done = await this.coordinator.commitState(doc, next)
    this.deps.reloadPath(doc.path)
    return done
  }

  /** detail + bytes of the current version, consistent with each other */
  private async fetchLatest(
    documentId: string,
    first?: DocumentDetail,
  ): Promise<{ detail: DocumentDetail; bytes: Uint8Array }> {
    let detail = first ?? (await this.api().getDocument(documentId))
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { bytes } = await this.api().download(documentId)
      if (sha256Hex(bytes) === detail.file.checksumSha256) return { detail, bytes }
      // a save landed between the two reads: read the detail again
      detail = await this.api().getDocument(documentId)
    }
    throw new UniworkDocError('malformed_response')
  }

  /** picker, recents reopen and launch: the one open flow */
  async openFromServer(
    documentId: string,
    launch?: LaunchDescriptor,
  ): Promise<{ path: string; title: string }> {
    const identity = this.liveIdentity()
    if (!identity) throw new UniworkDocError('not_signed_in')
    const profile = this.deps.profile()
    if (!profile || profile.deploymentId !== identity.deploymentId) {
      throw new UniworkDocError('wrong_deployment')
    }
    // a ticket naming a version is a view ticket (the launch contract: the
    // client never upgrades a ticket to edit): a read-only copy of that version
    const viewTicket = !!launch && launch.version > 0
    const key = viewTicket ? `${documentId}@v${launch.version}` : documentId
    // G5-04g: the folder is known from the ids alone, so a document whose local
    // folder declares a newer store is refused BEFORE the first request: no
    // metadata read, no download, no write to that folder. The ticket itself was
    // already redeemed (it is the only way to learn the document); the lock is
    // pushed and the caller gets the "app needs updating" code.
    const dirs = [
      this.store.dirFor(identity.deploymentId, identity.accountId, key),
      this.store.dirFor(identity.deploymentId, identity.accountId, documentId),
    ]
    for (const dir of dirs) {
      if (await this.refuseLockedDir(dir)) throw new UniworkDocError('engine_incompatible')
    }
    const detail = await this.api().getDocument(documentId)
    const format =
      formatForMime(detail.file.mimeType) ??
      formatForName(detail.file.filename) ??
      formatForName(detail.title)
    if (!format) throw new UniworkDocError('unsupported_format')
    // A ticket without a version takes the live ACL (view only when the
    // descriptor says view). The one exception for a version ticket is a
    // version that is still the current one while a tab of the document is
    // open: that tab is focused, neither duplicated, downgraded nor upgraded.
    if (viewTicket && launch.version === detail.file.version) {
      const open = await this.openTabCopy(identity, documentId)
      if (open) return this.focusOpen(open.path, open.title)
    }
    const viewRequested = !!launch && launch.version === 0 && launch.operation === 'view'
    const access: UniworkDocAccess =
      viewTicket || viewRequested ? 'view' : accessFor(detail.myLevel)
    const dir = dirs[0]!
    const existing = await this.store.readDir(dir)
    const workspaceId = launch?.workspaceId ?? detail.workspaceId
    const orgId = launch?.organizationId ?? detail.organizationId

    if (existing && existing.documentId === documentId) {
      const local = join(dir, existing.filename)
      if (this.store.exists(local)) {
        const localChecksum = await readFile(local)
          .then((bytes) => sha256Hex(new Uint8Array(bytes)))
          .catch(() => '')
        const keepLocal =
          KEEP_LOCAL_STATES.has(existing.state) ||
          localChecksum !== existing.baseChecksum ||
          this.deps.isPathOpen(local)
        const current = viewTicket || existing.baseRevision === detail.revision
        if (keepLocal || current) {
          // permissions come from the server: a save refused with 403 left the
          // copy view-only; once the server grants edit again, its local work
          // can be saved (dirty), otherwise it stays view-only
          const binding: Binding = { ...existing, title: detail.title, access }
          if (existing.state === 'blocked' && existing.error === 'forbidden' && access === 'edit') {
            binding.state = 'dirty'
            delete binding.error
          }
          // a reopen has a live session (the identity check above): a "sign in
          // again" left by an earlier session is stale, so the copy reads as what
          // it holds now (its local work can be saved, or it matches UniWork)
          if (existing.state === 'signed-out') {
            binding.state = localChecksum === existing.baseChecksum ? 'ready' : 'dirty'
            delete binding.error
          }
          // the document answers again (restored from the trash, a transient
          // 404): its local work can be saved once more
          if (
            existing.state === 'blocked' &&
            (existing.error === 'not_found' || existing.error === 'deleted')
          ) {
            binding.state = localChecksum === existing.baseChecksum ? 'ready' : 'dirty'
            delete binding.error
          }
          // the sweep still owns this copy's pre-store intent: the rewrite is
          // refused by the store's own hold and the copy opens with its old
          // binding - opening is fine, dropping `pendingIntent` is not
          const written = await this.store.write(dir, binding)
          return this.show(local, written ? binding : existing)
        }
      }
    }

    let bytes: Uint8Array
    let base = detail
    if (viewTicket) {
      bytes = (await this.api().download(documentId, launch.version)).bytes
    } else {
      const latest = await this.fetchLatest(documentId, detail)
      bytes = latest.bytes
      base = latest.detail
    }
    // while the sweep still owns this folder the fresh download writes
    // nothing: its binding write below would be refused (the store's hold), so
    // the new file would open unbound - no binding names it - and the old
    // file, the one binding.json still carries, would be replaced or deleted.
    // The copy opens as it is, the route the branch above takes when its
    // rewrite is refused, and binding.json, that file and pending-upload.bin
    // stay byte for byte until the sweep moves the intent (R3-be-1)
    if (this.heldByMigration(dir)) {
      if (existing && existing.documentId === documentId) {
        const local = join(dir, existing.filename)
        if (this.store.exists(local)) return this.show(local, existing)
      }
      // nothing may be written and the binding names no copy to open: the
      // folder's pre-store intent could not move (the store refused it, or is
      // locked), so the open stops instead of landing a half-written copy.
      // The reason follows the same split a refused save reports (R4-be-1)
      throw new UniworkDocError(this.migrationRefusalCode())
    }
    // a copy keeps its name, unless an earlier build named it from a corrupt
    // upload name (U+FFFD): that one is renamed with this fresh download
    const stale = existing && hasReplacementChar(existing.filename) ? existing.filename : null
    const filename =
      (stale ? null : existing?.filename) ?? workingCopyName(base.title, base.file.filename, format)
    const path = await this.store.writeWorkingCopy(dir, filename, bytes)
    if (stale && stale !== filename) await this.store.removeWorkingCopy(dir, stale)
    const binding: Binding = {
      schema: 2,
      documentId,
      workspaceId,
      orgId,
      title: base.title,
      filename,
      format,
      access,
      baseRevision: viewTicket ? launch.revision : base.revision,
      baseVersion: viewTicket ? launch.version : base.file.version,
      baseChecksum: sha256Hex(bytes),
      state: 'ready',
      minStoreLevel: APP_STORE_LEVEL,
      minAppVersion: this.buildVersion(),
      ...(existing?.lastSavedAt ? { lastSavedAt: existing.lastSavedAt } : {}),
    }
    // a refused write is never ignored, exactly as in the branch above: the
    // copy then reads as the binding that persisted, not the refused one
    const written = await this.store.write(dir, binding)
    return this.show(path, written ? binding : (existing ?? binding))
  }

  /** the document's own working copy when a tab shows it */
  private async openTabCopy(
    identity: SessionIdentity,
    documentId: string,
  ): Promise<{ path: string; title: string } | null> {
    const dir = this.store.dirFor(identity.deploymentId, identity.accountId, documentId)
    const existing = await this.store.readDir(dir)
    if (!existing || existing.documentId !== documentId) return null
    const local = join(dir, existing.filename)
    if (!this.store.exists(local) || !this.deps.isPathOpen(local)) return null
    return { path: local, title: existing.title }
  }

  /** nothing opens for a path whose folder declares a newer store (never a wrong "unsupported") */
  private refuseOpen(path: string): void {
    if (this.refuseLockedPath(path)) throw new UniworkDocError('engine_incompatible')
  }

  private focusOpen(path: string, title: string): { path: string; title: string } {
    this.refuseOpen(path)
    if (!this.deps.openPath(path)) throw new UniworkDocError('unsupported_format')
    return { path, title }
  }

  private show(path: string, binding: Binding): { path: string; title: string } {
    this.refuseOpen(path)
    if (!this.deps.openPath(path)) throw new UniworkDocError('unsupported_format')
    const doc = this.store.lookup(path)
    if (doc) this.publish(toStatus(doc))
    return { path, title: binding.title }
  }
}
