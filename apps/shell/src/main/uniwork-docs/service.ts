import { existsSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { copyFile, readFile, rename, stat } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  RecentUniworkSource,
  SignOutPlan,
  SignOutProgress,
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
  UniworkRemoteAction,
  UniworkRemoteBar,
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
  docLevelOf,
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
import type { CommentsContextResult } from '@genoffice/electron-utils/comments-ipc'
import { actionFlags, type DocumentDetail, type LaunchDescriptor } from './parse'
import { SaveCoordinator, toStatus, type IntentAccess } from './save-coordinator'
import type { SyncStoreAccess, SyncStoreOpen } from '../uniwork-sync/session-store'
import {
  createIntentStore,
  INTENT_STORE_REGISTRATION,
  type IntentStore,
} from '../uniwork-sync/intent-store'
import { migrateLegacyIntents } from '../uniwork-sync/migration'
import { APP_STORE_LEVEL } from '../uniwork-sync/store-level'
import { createDocLock, type DocLock } from '../uniwork-sync/doc-lock'
import {
  createDraftStore,
  DRAFTS_STORE_REGISTRATION,
  type DraftStore,
} from '../uniwork-sync/queue/drafts'
import {
  createPauseStore,
  PAUSE_STORE_REGISTRATION,
  type PauseStore,
} from '../uniwork-sync/queue/pause'
import {
  createParkedStore,
  PARKED_STORE_REGISTRATION,
  type ParkedStore,
} from '../uniwork-sync/queue/parked'
import { SIGN_OUT_RECEIPT_WAIT_MS } from '../uniwork-sync/queue/limits'
import {
  QueueDispatcher,
  type QueueCapabilityRead,
  type QueueDoc,
} from '../uniwork-sync/queue/dispatcher'
import { isTerminalQueueState, type IntentRecordV2 } from '../uniwork-sync/queue/record'
import { compareRevision } from '../uniwork-sync/feed/revision'
import type { FeedChange } from '../uniwork-sync/feed/client'
import { decideRemote, type RemoteLocal, type RemoteNotice } from './remote-newer'
import type { StoreRecords } from '../uniwork-sync/store'
import { queueChipState, type SaveQueueEngine } from './save-coordinator'

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

/**
 * G5-11 be-1: what a session lock settled to. `ok` is false when a dirty working
 * copy could not be parked (the plan promised it would be kept encrypted).
 * `captureFailed` lists the document keys whose capture never landed on disk:
 * their working-copy folder was NOT deleted (nothing may be deleted that was not
 * captured), so the copy stays as the owner's own locked folder until the owner
 * signs in again.
 */
export interface SignOutLockResult {
  ok: boolean
  captureFailed: string[]
}

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
   * `mode: 'capture'` (G5-11 D3) flushes editor bytes to disk without firing
   * `onUserSave`.
   */
  requestModuleSave(path: string, onNotWritten?: () => void, mode?: 'save' | 'capture'): boolean
  /** remounts the tab showing the path so it re-reads the file */
  reloadPath(path: string): void
  activePath(): string | undefined
  /**
   * G5-03a: the FRESH editor state of one path (tab, detached window, present
   * view of the owner tab), never the 1 s poll cache - the guarded reload reads
   * it before and after its fetch, so an AI turn that starts in between drops
   * the result. Absent = a clean, idle editor (tests that never poll).
   */
  editorStateOf?(
    path: string,
  ): Promise<{ dirty: boolean | null; aiRunning: boolean; aiEpoch: number }>
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
  /** G5-11: sign-out progress push (`waiting` | `done`) */
  pushSignOutProgress?(event: SignOutProgress): void
  /** G5-11: optional hooks so lockSession can run step 1 runtime stop and step 3 view/history cleanup directly */
  stopRuntime?(): void
  openPaths?(): string[]
  closePathNow?(path: string): void
  aiHistoryPaths?(): string[]
  forgetAiHistory?(paths: string[]): void
  /**
   * The org capability cache (the same one the sync runtime reads), for the
   * save queue's lane verdicts. Absent = writes allowed (tests that never read
   * a capability); the production wiring passes the runtime's cache.
   */
  capability?: { get(orgId: string): Promise<QueueCapabilityRead> }
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
  /**
   * G8-12: a Save of `path` settled with a commit; `versionId` is the server
   * version the editor's comment anchors now refer to. Optional (read at push
   * time): a standalone app or a test installs none.
   */
  notifySaved?(path: string, versionId: string): void
  /** test seam: replaces the HTTP client */
  client?: UniworkDocsClient
  sleep?(ms: number): Promise<void>
  now?(): number
  /**
   * ADVISOR D4 (a): this build's packaging flag (the wiring passes
   * app.isPackaged), read only by the dev-only S6 display fixture. Absent reads
   * as packaged, so a test that does not install the wiring stays inert.
   */
  isPackaged?: boolean
}

/**
 * ADVISOR D4 (a): the bar kinds the dev-only S6 fixture may display. Anything
 * else in the JSON file is dropped so a typo cannot inject an unknown bar.
 * Never in product copy: no string, no i18n key, no UI mention.
 */
const DEV_FIXTURE_BAR_KINDS: ReadonlySet<string> = new Set([
  'updated',
  'newer-dirty',
  'newer-ai',
  'now-clean',
  'reload-failed',
  'revoked',
  'deleted',
])

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

/**
 * G5-03a: the S6 lock verdict of a failed documents call, read from the CODES
 * the client's own mapping produced - a coded 403/404 is `forbidden` /
 * `permission_revoked` / `not_found`, a coded 410 is `deleted`, and the
 * tombstone code `document_deleted`. A bare 403/404 (no UniWork envelope: a
 * gateway, a captive portal) stays `server_error` on purpose, so it is
 * transient here too - the bar says `reload-failed`, never a lock.
 */
function lockVerdict(error: unknown): 'revoked' | 'deleted' | null {
  if (!(error instanceof UniworkDocError)) return null
  if (error.code === 'document_deleted' || error.code === 'deleted') return 'deleted'
  if (
    error.code === 'permission_revoked' ||
    error.code === 'forbidden' ||
    error.code === 'not_found'
  ) {
    return 'revoked'
  }
  return null
}

/** the refusal code a queue record's blocked state carries, as an S6 lock verdict */
function refusalVerdict(code: UniworkDocErrorCode | undefined): 'revoked' | 'deleted' | null {
  if (code === 'permission_revoked') return 'revoked'
  if (code === 'document_deleted') return 'deleted'
  return null
}

/** no revision of this app's own has been seen for a document yet */
const NO_ECHO: ReadonlySet<string> = new Set()

function accessFor(level: string | null): UniworkDocAccess {
  return level === 'edit' || level === 'manage' ? 'edit' : 'view'
}

/**
 * G8-12: what a document read tells a binding for the comments seam: the
 * caller's level, and the server version id of the base bytes when the base is
 * the version that read describes (a binding on another version keeps its own).
 */
function withServerContext(binding: Binding, detail: DocumentDetail, readOnly = false): Binding {
  const next = { ...binding }
  const level = docLevelOf(detail.myLevel)
  // a read-only copy (a view ticket, or a launch that asked to view) never shows a level above view
  if (level) next.level = readOnly ? 'view' : level
  else delete next.level
  if (detail.file.versionId && next.baseVersion === detail.file.version) {
    next.baseVersionId = detail.file.versionId
  }
  return next
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

/**
 * The save queue of the live session, or why it cannot be reached. `ok` hands
 * back the dispatcher and the three stores it was built from; a locked keychain
 * and a session without a store are the two refusals a save can meet.
 */
type QueueEngineAccess =
  | {
      kind: 'ok'
      /** the session's unique id (see isQueueSessionCurrent) */
      id: string
      token: string
      dispatcher: QueueDispatcher
      lock: DocLock
      intents: IntentStore
      drafts: DraftStore
      pause: PauseStore
    }
  | { kind: 'keystore_locked' }
  | { kind: 'unavailable' }

/** what a queue call reports when the engine cannot be built (nothing was done) */
const EMPTY_DISPATCH = { dispatched: 0, parked: 0, outcomes: new Map() }

/**
 * The chip a queue record maps onto, or null for a record that leaves the chip
 * where it is (a committed/cancelled record is spent; the front's own settle or
 * cancel already moved the binding). This is the ONE mapping from a durable
 * queue state to the binding a restart reads back.
 */
function queueBindingPatch(record: IntentRecordV2): Partial<Binding> | null {
  const state = queueChipState(record.state)
  if (!state) return null
  const error = record.lastError
  const patched: Partial<Binding> = { state }
  if (state === 'paused_admin') patched.error = 'capability_off'
  else if (state === 'paused_offline') patched.error = 'network'
  else if (state === 'blocked') patched.error = error ?? 'server_error'
  else if (state === 'reconciling-stuck') patched.error = error ?? 'intent_unknown'
  else if (state === 'failed') patched.error = error ?? 'server_error'
  // G8-12: a refused permission is a fact about the caller's level, as on the inline path
  if (patched.error === 'permission_revoked' || patched.error === 'forbidden') {
    patched.level = 'view'
  }
  return patched
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
   * The save queue of the live session: one `QueueDispatcher` per account
   * boundary, built lazily the first time the session's store opens and torn
   * down when the scope is wiped (sign-out / switch). It carries the account
   * scope and a per-window lock owner, so two windows contend for one document.
   */
  private queueSession: {
    /** a unique id per built session; the dispatcher's canCommit guard reads it */
    id: string
    token: string
    dispatcher: QueueDispatcher
    lock: DocLock
    intents: IntentStore
    drafts: DraftStore
    pause: PauseStore
  } | null = null
  /** the per-window lock owner (one window = one service instance) */
  private readonly windowOwner = `${process.pid}:${randomUUID()}`
  /** the document keys the current poll pass is dispatching (see dispatcherBusy) */
  private readonly queueInFlight = new Set<string>()
  /**
   * A read-only window's own `blocked/other_window` status, keyed by path. It is
   * window-local and never written to the shared binding.json: the holder reads
   * the same file and keeps its own chip (G506-be-d1-2).
   */
  private readonly otherWindowStatus = new Map<string, UniworkDocStatus>()
  /** the poll pass in flight right now, awaited by teardownSaveQueue (G506-be-4) */
  private queuePass: Promise<void> | null = null
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
   * G5-03a (S6): the bar of each path as this session knows it, keyed by path.
   * An entry (even `null`, an explicitly hidden bar) is authoritative over the
   * rebuild from the binding - so `later`/`close` stay hidden and a fresh
   * notice is what brings the bar back.
   */
  private readonly remoteBars = new Map<string, UniworkRemoteBar | null>()
  /** the notice behind a path's bar (or the last one handled): re-decisions and actions */
  private readonly remoteNotices = new Map<string, RemoteNotice>()
  /** notices held while an intent is validating/uploading/committing */
  private readonly remoteHeld = new Map<string, RemoteNotice>()
  /**
   * Revisions this app itself produced, per document: a settled receipt or the
   * rename revision of `selfRenamed`. A notice carrying one is this app's own
   * write echoing back through the feed, never a reason for a bar (the receipt
   * may settle after the notice arrived, so the equality must outlive it).
   */
  private readonly ownEcho = new Map<string, Set<string>>()
  /** documents locked by a server verdict (403/404 revoked, 410 deleted) */
  private readonly remoteLocked = new Map<string, 'revoked' | 'deleted'>()
  /** ADVISOR D4 (a): the parsed dev-only fixture and the mtime it was read at */
  private devFixture: {
    file: string
    mtimeMs: number
    bars: Record<string, UniworkRemoteBar>
  } | null = null
  /** per path, the last editor state the poll reported (the AI settle edge) */
  private readonly editorAi = new Map<string, { aiRunning: boolean; aiEpoch: number }>()
  /** one guarded reload per path at a time; a notice queued behind it runs after */
  private readonly remoteReloads = new Map<string, Promise<void>>()
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
      onSaved: (doc, versionId) => this.deps.notifySaved?.(doc.path, versionId),
      capability: {
        get: (orgId) =>
          deps.capability
            ? deps.capability.get(orgId)
            : Promise.resolve({
                kind: 'ok',
                capabilities: { sync_write: true },
                source: 'default',
              }),
      },
      pause: {
        isPaused: async () => (await this.queueStores())?.pause.isPaused() ?? false,
        setPaused: async (paused) =>
          (await this.queueStores())?.pause.setPaused(paused) ?? { kind: 'interrupted' },
      },
      drafts: {
        keep: async (key, snapshot, meta) =>
          (await this.queueStores())?.drafts.keep(key, snapshot, meta) ?? 'keystore_locked',
      },
      // The queue front: the coordinator's own `save` still runs the inline
      // pipeline (it never calls these), so the injected dispatcher serves only
      // the EXPERIENCE actions. Each is a no-op while the engine cannot be built
      // (a locked keychain, a store without the queue's registrations): the save
      // itself is refused by `intents()` before any of this is reached.
      dispatcher: {
        mint: async (input) => (await this.requireQueueEngine()).mint(input),
        enqueue: async (doc) => (await this.requireQueueEngine()).enqueue(doc),
        dispatchAll: async (docs) =>
          (await this.queueEngineOrNull())?.dispatchAll(docs) ?? EMPTY_DISPATCH,
        reconcile: async (doc, now) =>
          (await this.queueEngineOrNull())?.reconcile(doc, now) ?? doc.record.state,
        recheck: async (doc, now) =>
          (await this.queueEngineOrNull())?.recheck(doc, now) ?? doc.record.state,
        pause: async () => {
          await (await this.queueEngineOrNull())?.pause()
        },
        resume: async (docs) => (await this.queueEngineOrNull())?.resume(docs) ?? [],
        cancel: async (doc, options) =>
          (await this.queueEngineOrNull())?.cancel(doc, options) ?? doc.record.state,
        discard: async (doc, options) =>
          (await this.queueEngineOrNull())?.discard(doc, options) ?? doc.record.state,
        supersede: async (doc) => {
          const engine = await this.queueEngineOrNull()
          const st = (await engine?.supersede(doc)) ?? doc.record.state
          return st
        },
        tombstone: async (doc) =>
          (await this.queueEngineOrNull())?.tombstone(doc) ?? doc.record.state,
        isOtherWindow: (key) => this.queueSession?.dispatcher.isOtherWindow(key) === true,
      },
      // the queue engine exposes no public in-flight state, so the service
      // reports the keys its own poll pass is running right now (G506-be-1)
      dispatcherBusy: (key) => this.queueInFlight.has(key),
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
    const full = this.withRemote(this.present(status))
    this.deps.pushStatus(full)
    for (const listener of [...this.statusListeners]) listener(full)
  }

  /**
   * G5-03a: the status plus its S6 bar. The session's own bar for the path wins
   * (including an explicit `null`, a hidden one); otherwise the bar is rebuilt
   * from the binding - a newer-* notice or a revoke/delete survives a restart
   * because the feed cursor never replays it.
   */
  private withRemote(status: UniworkDocStatus): UniworkDocStatus {
    // ADVISOR D4 (a): the dev-only display fixture wins for a matching path; a
    // packaged build never reads the env or the file (see devRemoteFixture)
    const fixture = this.devRemoteFixture(status.path)
    if (fixture) return { ...status, remote: fixture }
    const key = pathKey(status.path)
    if (this.remoteBars.has(key)) {
      const bar = this.remoteBars.get(key)
      return bar ? { ...status, remote: bar } : status
    }
    const doc = this.store.lookup(status.path)
    const rebuilt = doc ? this.rebuiltRemote(doc.binding) : null
    return rebuilt ? { ...status, remote: rebuilt } : status
  }

  /**
   * ADVISOR D4 (a): the dev-only S6 display fixture. When this build is
   * unpackaged and UNIWORK_DEV_REMOTE_FIXTURE names a JSON file of
   * `{ "<abs path>": UniworkRemoteBar }`, a matching path's status shows that
   * bar, so the visual stage can reach every S6 state. Display only: it never
   * writes a binding, never reloads, never sends a request; the file is parsed
   * once and re-read when its mtime moves. A packaged build returns before the
   * env is read, so the fixture is unreachable there. Code only - no product
   * string, no i18n key, no UI copy.
   */
  private devRemoteFixture(path: string): UniworkRemoteBar | null {
    if (this.deps.isPackaged !== false) return null
    const file = process.env.UNIWORK_DEV_REMOTE_FIXTURE
    if (!file) return null
    try {
      const mtimeMs = statSync(file).mtimeMs
      if (
        !this.devFixture ||
        this.devFixture.file !== file ||
        this.devFixture.mtimeMs !== mtimeMs
      ) {
        const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
        const bars: Record<string, UniworkRemoteBar> = {}
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          const bar = value as UniworkRemoteBar | null
          if (bar && typeof bar === 'object' && DEV_FIXTURE_BAR_KINDS.has(bar.kind)) bars[key] = bar
        }
        this.devFixture = { file, mtimeMs, bars }
      }
      return this.devFixture.bars[path] ?? null
    } catch {
      // a missing or malformed fixture is not an error: show the real statuses
      return null
    }
  }

  /** the bar a binding alone can prove: a lock verdict, or a known newer head */
  private rebuiltRemote(binding: Binding): UniworkRemoteBar | null {
    if (binding.state === 'blocked') {
      if (binding.error === 'permission_revoked') return { kind: 'revoked' }
      if (binding.error === 'document_deleted') return { kind: 'deleted' }
    }
    if (
      binding.serverRevision !== undefined &&
      binding.serverVersion !== undefined &&
      compareRevision(binding.serverRevision, binding.baseRevision) > 0
    ) {
      return { kind: 'newer-dirty', version: binding.serverVersion }
    }
    return null
  }

  /**
   * What the chip shows: the binding's state, except that a clean copy whose
   * editor holds unsaved edits reads dirty. Conflict, offline, signed-out and
   * the rest are never hidden by the editor state.
   */
  private present(status: UniworkDocStatus): UniworkDocStatus {
    // a read-only window's own status wins for THIS window (never written to the
    // shared binding, so the holder is unaffected) - G506-be-d1-2
    const overlay = this.otherWindowStatus.get(status.path)
    if (overlay) return overlay
    const quiet = status.state === 'ready' || status.state === 'saved'
    return quiet && status.access === 'edit' && this.editorDirty.has(status.path)
      ? { ...status, state: 'dirty' }
      : status
  }

  private statusOf(doc: BoundDocument): UniworkDocStatus {
    return this.withRemote(this.present(toStatus(doc)))
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

  /**
   * G5-03a: one editor poll pass's answer for `path` (W2's poll). `dirty` keeps
   * noteEditorDirty's behaviour (the chip); `aiRunning`/`aiEpoch` are remembered
   * for the reload race guard and the bar's own settle edges: a `newer-ai` bar
   * whose turn ended is re-decided (a copy that is clean again reloads), and a
   * `newer-dirty` bar on a copy that is clean again becomes `now-clean`
   * (EXPERIENCE :333, :338 - no auto reload of an undone edit).
   */
  noteEditorState(
    path: string,
    state: { dirty: boolean | null; aiRunning: boolean; aiEpoch: number },
    mark?: number,
  ): void {
    const doc = typeof path === 'string' ? this.store.lookup(path) : null
    if (!doc || !this.ownsLocally(doc) || doc.binding.access !== 'edit') return
    if (state.dirty !== null) this.noteEditorDirty(doc.path, state.dirty, mark)
    const before = this.editorAi.get(doc.path)
    this.editorAi.set(doc.path, { aiRunning: state.aiRunning, aiEpoch: state.aiEpoch })
    const key = pathKey(doc.path)
    const bar = this.remoteBars.get(key)
    if (!bar) return
    const notice = this.remoteNotices.get(key)
    if (!notice) return
    if (bar.kind === 'newer-ai' && before?.aiRunning === true && !state.aiRunning) {
      void this.rerunRemoteDecision(doc.path, notice).catch(() => undefined)
      return
    }
    if (bar.kind === 'newer-dirty' && state.dirty === false) {
      const clean = doc.binding.state === 'ready' || doc.binding.state === 'saved'
      if (!clean || this.editorDirty.has(doc.path)) return
      void this.showRemoteBar(doc, notice, { kind: 'now-clean', version: notice.version }).catch(
        () => undefined,
      )
    }
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

  // ---- durable save queue (G5-06 W4b) ---------------------------------------

  /**
   * The save queue of the live session, built on the first store open and
   * rebuilt if the scope moved. It is one `QueueDispatcher` per account
   * boundary, over the same durable layer the intent store lives in: the three
   * queue stores (`intents`, `drafts`, `pause`), a document lock owned by this
   * window under the account store root, and the shared capability cache the
   * sync runtime reads. The dispatcher's `publish` re-maps a record onto the
   * document's binding, so a dispatched state lands on the chip too.
   */
  private async queueEngine(): Promise<QueueEngineAccess> {
    const sync = this.deps.syncStore
    if (!sync) return { kind: 'unavailable' }
    const open = await this.openSyncStore()
    if (open.kind !== 'ok') {
      return open.kind === 'keystore_locked' ? { kind: 'keystore_locked' } : { kind: 'unavailable' }
    }
    const scope = sync.scope()
    if (!scope) return { kind: 'unavailable' }
    const token = `${scope.deploymentId}/${scope.accountId}`
    if (this.queueSession?.token === token) return { kind: 'ok', ...this.queueSession }
    const records = (name: string): StoreRecords => open.records(name)
    const intents = createIntentStore(records(INTENT_STORE_REGISTRATION.name))
    const drafts = createDraftStore(records(DRAFTS_STORE_REGISTRATION.name))
    const pause = createPauseStore(records(PAUSE_STORE_REGISTRATION.name))
    const lock = createDocLock({
      root: this.store.root,
      scope,
      clock: () => Date.now(),
      owner: this.windowOwner,
    })
    // the session this dispatcher belongs to: the canCommit guard below reads
    // this exact id, so a torn-down or switched session reads false
    const id = randomUUID()
    const dispatcher = new QueueDispatcher({
      intents: async () =>
        this.deadQueueSessions.has(id) ? { kind: 'unavailable' } : { kind: 'ok', intents },
      client: {
        upload: (input) =>
          this.api().upload({ ...input, format: input.format as UniworkDocFormat }),
        commit: (input) => this.api().commit(input),
        lookupCommit: (input) => this.api().lookupCommit(input),
      },
      capability: {
        get: (orgId) =>
          this.deps.capability
            ? this.deps.capability.get(orgId)
            : Promise.resolve({
                kind: 'ok',
                capabilities: { sync_write: true },
                source: 'default',
              }),
      },
      lock,
      pause,
      drafts,
      clock: () => Date.now(),
      // an account switch (or a sign-out) between the upload and the commit
      // must not commit this copy under the other account: the dispatcher
      // re-asks this right before the upload and right before the commit
      canCommit: (doc) => {
        const bound = this.store.lookup(doc.path)
        return (
          this.isQueueSessionCurrent({ id }) &&
          this.deps.identity() !== null &&
          bound !== null &&
          this.owns(bound)
        )
      },
      publish: (record) => {
        if (this.deadQueueSessions.has(id)) return
        this.publishRecord(record)
      },
    })
    this.queueSession = { id, token, dispatcher, lock, intents, drafts, pause }
    return { kind: 'ok', ...this.queueSession }
  }

  /**
   * The queue engine of the live session, or null when it cannot be reached
   * right now (a locked keychain, no session). Never throws: a save that cannot
   * reach the queue falls back to the legacy pipeline.
   */
  private async queueEngineOrNull(): Promise<SaveQueueEngine | null> {
    try {
      const access = await this.queueEngine()
      return access.kind === 'ok' ? access.dispatcher : null
    } catch {
      return null
    }
  }

  /**
   * The queue engine for the coordinator's injected dispatcher: it throws when
   * the store cannot be reached, which the front treats like any other queue
   * failure (the intent stays, nothing is sent).
   */
  private async requireQueueEngine(): Promise<QueueDispatcher> {
    const access = await this.queueEngine()
    if (access.kind !== 'ok') throw new UniworkDocError('keystore_locked')
    return access.dispatcher
  }

  /** the pause + drafts stores of the live session, or null when unreachable */
  private async queueStores(): Promise<{ pause: PauseStore; drafts: DraftStore } | null> {
    try {
      const access = await this.queueEngine()
      return access.kind === 'ok' ? { pause: access.pause, drafts: access.drafts } : null
    } catch {
      return null
    }
  }

  private readonly pendingApplyRecords = new Set<Promise<void>>()

  /**
   * The queue's status push: it lands on the document's binding too, so a
   * dispatched state (queued / paused_* / reconciling / blocked) is what the
   * chip reads after a restart, and the shell window is told. A record with no
   * live binding (a version copy, or one of another account) is dropped.
   */
  private publishRecord(record: IntentRecordV2): void {
    const p = this.applyRecord(record).finally(() => {
      this.pendingApplyRecords.delete(p)
    })
    this.pendingApplyRecords.add(p)
  }

  /** resolve the live session's working copy of a document, or null */
  private async boundDocFor(documentId: string): Promise<BoundDocument | null> {
    const identity = this.deps.identity()
    if (!identity) return null
    const dir = this.store.dirFor(identity.deploymentId, identity.accountId, documentId)
    const binding = await this.store.readDir(dir)
    if (!binding || binding.documentId !== documentId) return null
    const doc = this.store.lookup(join(dir, binding.filename))
    return doc && this.ownsLocally(doc) ? doc : null
  }

  /** a queue record change: move the chip, or settle the base on a commit */
  private async applyRecord(record: IntentRecordV2): Promise<void> {
    try {
      await this.applyRecordToChip(record)
    } finally {
      // G5-03a: a notice the intent held up is re-decided now that the record moved
      await this.redecideHeld(record.documentId, record).catch(() => undefined)
    }
  }

  /** the chip side of one record change */
  private async applyRecordToChip(record: IntentRecordV2): Promise<void> {
    const doc = await this.boundDocFor(record.documentId)
    if (!doc) return
    if (record.state === 'blocked' && record.lastError === 'other_window') {
      // a read-only window's own status: pushed to THIS window only, never the
      // shared binding.json - the holder reads the same file and must keep its
      // own chip (G506-be-d1-2)
      const local: UniworkDocStatus = {
        ...this.statusOf(doc),
        state: 'blocked',
        error: 'other_window',
      }
      this.otherWindowStatus.set(doc.path, local)
      this.publish(local)
      return
    }
    // G5-03a: a queue refusal that lost the document for good IS the S6 lock
    // (revoked/deleted), from the same server verdicts the reload path reads
    const refusal = record.state === 'blocked' ? refusalVerdict(record.lastError) : null
    if (refusal) {
      this.otherWindowStatus.delete(doc.path)
      await this.lockFromServer(record.documentId, refusal)
      return
    }
    // a real record change ends the window-local read-only status
    this.otherWindowStatus.delete(doc.path)
    if (record.state === 'committed') {
      await this.settleFromRecord(doc, record)
      return
    }
    const patch = queueBindingPatch(record)
    if (patch) await this.coordinator.commitState(doc, { ...doc.binding, ...patch })
  }

  /**
   * A queue-dispatched commit landed: the base moves to the receipt's revision
   * and the intent's checksum, exactly as the inline settle does. The record is
   * the queue's own, so its checksum is what these bytes are; the file decides
   * only whether the copy is clean (`saved`) or has moved on (`dirty`).
   */
  private async settleFromRecord(doc: BoundDocument, record: IntentRecordV2): Promise<void> {
    if (!record.receipt) return
    // G5-03a: this app's own commit, by its exact revision - a feed notice for
    // it is an echo, never a newer version (its own base moves below; a notice
    // that arrived earlier is still held and matched by this receipt)
    this.rememberOwnEcho(record.documentId, record.receipt.revision)
    let current: string | null
    try {
      current = sha256Hex(new Uint8Array(await readFile(doc.path)))
    } catch {
      current = null
    }
    const next: Binding = {
      ...doc.binding,
      baseRevision: record.receipt.revision,
      baseVersion: record.receipt.version,
      baseChecksum: record.checksum,
      state: current === record.checksum ? 'saved' : 'dirty',
      lastSavedAt: new Date().toISOString(),
      // G8-12: the comments anchor base moves with the base version (the
      // queue's receipt always names the produced version)
      baseVersionId: record.receipt.versionId,
    }
    delete next.error
    delete next.serverRevision
    delete next.serverVersion
    const done = await this.coordinator.commitState(doc, next)
    // G8-12: a queue-settled Save (dispatched, or found committed by a lookup
    // at rest) tells the editor's comment panel its new version, exactly as
    // the inline settle does; a refused binding write pushes nothing
    if (done.binding.baseVersionId === record.receipt.versionId) {
      this.deps.notifySaved?.(done.path, record.receipt.versionId)
    }
  }

  /**
   * One pending intent per document, from the binding store's folders of the
   * live scope: the payload bytes come from the durable intent record itself,
   * so the drafts folder is never read at startup (see EXPERIENCE - Queue
   * rows). A folder whose binding is not the live session's, or which holds no
   * pending intent, is skipped.
   */
  private async pendingQueueDocs(): Promise<QueueDoc[]> {
    const sync = this.deps.syncStore
    const scope = sync?.scope()
    if (!scope) return []
    const access = await this.intentAccess()
    if (access.kind !== 'ok') return []
    const docs: QueueDoc[] = []
    for (const dir of scopeWorkingCopyDirs(this.store.root, scope)) {
      const binding = await this.store.readDir(dir)
      if (!binding) continue
      const key = basename(dir)
      const stored = await access.intents.read(key, {
        orgId: binding.orgId,
        workspaceId: binding.workspaceId,
        baseVersion: binding.baseVersion,
        length: 0,
      })
      if (!stored || isTerminalQueueState(stored.intent.state)) continue
      // the inline pipeline is saving this very key right now: one writer per
      // intent, so the poll leaves it to the pipeline (G506-be-1)
      if (this.coordinator.isSaving(join(dir, binding.filename))) continue
      docs.push({
        key,
        path: join(dir, binding.filename),
        filename: binding.filename,
        format: binding.format,
        orgId: stored.intent.orgId || binding.orgId,
        workspaceId: stored.intent.workspaceId || binding.workspaceId,
        baseVersion: stored.intent.baseVersion || binding.baseVersion,
        record: stored.intent,
        payload: stored.payload,
      })
    }
    return docs
  }

  /**
   * One poll pass of the durable save queue: enumerate the pending intents,
   * advance their reconciling clocks (`tick`) and dispatch what can move
   * (`dispatchAll`). Called on sign-in and on the sync interval (see
   * wiring's `onPoll`), never on its own timer.
   */
  async pollSaveQueue(): Promise<void> {
    const pass = this.runQueuePass()
    // teardownSaveQueue awaits this very pass, so it must be observable while it runs
    this.queuePass = pass
    try {
      await pass
    } finally {
      if (this.queuePass === pass) this.queuePass = null
    }
  }

  /** one poll pass; see pollSaveQueue */
  private async runQueuePass(): Promise<void> {
    const access = await this.queueEngine()
    if (access.kind !== 'ok') return
    // a teardown may have marked this session dead while the store was opening:
    // a dead session dispatches nothing (G506-be-4)
    if (!this.isQueueSessionCurrent(access)) return
    const docs = await this.pendingQueueDocs()
    if (docs.length === 0) return
    if (!this.isQueueSessionCurrent(access)) return
    // the keys this pass is about to run, marked BEFORE `tick`: the inline
    // pipeline skips them for the WHOLE pass, so the poll's tick/reconcile and
    // its dispatch never race a Save of the same intent (G506-be-1, d1-3)
    for (const doc of docs) this.queueInFlight.add(doc.key)
    try {
      await access.dispatcher.tick(docs)
      await access.dispatcher.dispatchAll(docs)
    } finally {
      for (const doc of docs) this.queueInFlight.delete(doc.key)
    }
  }

  /**
   * The session's connectivity changed (a network failure or a successful
   * request the service already saw): move the waiting intents with it. Going
   * online wakes the `paused_offline` ones (the next poll dispatches them);
   * going offline parks the waiting ones. A store that cannot be read right now
   * is left alone - nothing may move without being persisted.
   */
  async setQueueOnline(online: boolean): Promise<void> {
    const access = await this.queueEngine()
    if (access.kind !== 'ok') return
    if (!this.isQueueSessionCurrent(access)) return
    const docs = await this.pendingQueueDocs()
    if (docs.length === 0) return
    await access.dispatcher.setOnline(docs, online)
  }

  /** "Tạm dừng gửi": the durable per-account pause flag (nothing is deleted) */
  async pauseSending(): Promise<void> {
    await this.coordinator.pause()
  }

  /** "Tiếp tục gửi": clear the flag and move waiting intents back to queued */
  async resumeSending(): Promise<void> {
    await this.coordinator.resume(await this.pendingQueueDocs())
  }

  /** "Hủy lần lưu" of one document; `closed` = its tab is closed -> kept draft */
  async cancelSave(path: string, closed = false): Promise<void> {
    const doc = typeof path === 'string' ? this.store.lookup(path) : null
    if (!doc || !this.ownsLocally(doc)) return
    const queueDoc = await this.queueDocFromStore(doc)
    if (!queueDoc) return
    await this.coordinator.cancel(queueDoc, {
      documentClosed: closed,
      title: doc.binding.title,
    })
    // the document is still open and its work is now unsent: the chip reads
    // "unsaved changes" (EXPERIENCE - Cancel intent). A closed document has no
    // chip to move; its snapshot is a kept draft.
    if (!closed) {
      const fresh = this.store.lookup(doc.path)
      if (fresh) {
        const next: Binding = { ...fresh.binding, state: 'dirty' }
        delete next.error
        await this.coordinator.commitState(fresh, next)
      }
    }
  }

  /** "Bỏ lần lưu..." on a stuck intent: the snapshot becomes a kept draft */
  async discardSave(path: string): Promise<void> {
    const doc = typeof path === 'string' ? this.store.lookup(path) : null
    if (!doc || !this.ownsLocally(doc)) return
    const queueDoc = await this.queueDocFromStore(doc)
    if (!queueDoc) return
    await this.coordinator.discard(queueDoc, { title: doc.binding.title })
  }

  /** "Kiểm tra lại" (check again): a lookup of the intent only, never a new attempt */
  async recheckSave(path: string): Promise<void> {
    const doc = typeof path === 'string' ? this.store.lookup(path) : null
    if (!doc || !this.ownsLocally(doc)) return
    const queueDoc = await this.queueDocFromStore(doc)
    if (!queueDoc) return
    await this.coordinator.recheck(queueDoc)
  }

  /** true while another window holds this document's lock (this one is read-only) */
  isOtherWindow(path: string): boolean {
    const doc = typeof path === 'string' ? this.store.lookup(path) : null
    return doc ? this.coordinator.isOtherWindow(doc.key) : false
  }

  /**
   * "Ghi đè" / "Tải lại" / "Lưu lại": the old intent is superseded BEFORE the
   * new one is minted or the base is replaced (EXPERIENCE - Superseded, :239).
   */
  private async supersedePending(doc: BoundDocument): Promise<void> {
    const queueDoc = await this.queueDocFromStore(doc)
    if (queueDoc) await this.coordinator.supersede(queueDoc)
  }

  /** the document's stored intent as a queue doc, or null when there is none */
  private async queueDocFromStore(doc: BoundDocument): Promise<QueueDoc | null> {
    const access = await this.intentAccess()
    if (access.kind !== 'ok') return null
    const stored = await access.intents.read(doc.key, {
      orgId: doc.binding.orgId,
      workspaceId: doc.binding.workspaceId,
      baseVersion: doc.binding.baseVersion,
      length: 0,
    })
    if (!stored || isTerminalQueueState(stored.intent.state)) return null
    return {
      key: doc.key,
      path: doc.path,
      filename: doc.binding.filename,
      format: doc.binding.format,
      orgId: stored.intent.orgId || doc.binding.orgId,
      workspaceId: stored.intent.workspaceId || doc.binding.workspaceId,
      baseVersion: stored.intent.baseVersion || doc.binding.baseVersion,
      record: stored.intent,
      payload: stored.payload,
    }
  }

  /** the queue sessions whose dispatcher must not commit any more (torn down) */
  /** the queue sessions whose dispatcher must not start a new upload/commit */
  private readonly stoppingQueueSessions = new Set<string>()
  /** the queue sessions whose dispatcher must not commit or write any more (torn down) */
  private readonly deadQueueSessions = new Set<string>()
  /** scopes explicitly locked by sign-out / account switch until the account signs in again */
  private readonly lockedScopes = new Set<string>()
  /**
   * G5-11 be-7: parked records a restore refused (`scope/key`) because the
   * binding or its folder declares a newer store. Kept so the 60 s poll does
   * not re-read a record that cannot be restored in this build.
   */
  private readonly refusedParkedKeys = new Set<string>()
  private readonly refusedParkedFolderKeys = new Set<string>()
  /** paths armed for a one-shot capture save (G5-11 D3) */
  private readonly armedCaptures = new Map<string, () => void>()

  /**
   * G5-11 D3: arms a one-shot capture save for `path` so the owning module writes
   * the bound file to disk without firing the user-save hook.
   */
  armCapture(path: string, onConsumed?: () => void): void {
    this.armedCaptures.set(pathKey(path), onConsumed ?? (() => undefined))
  }

  /**
   * G5-11 D3: consumes a one-shot capture request for `path`.
   */
  consumeCapture(path: string): boolean {
    const key = pathKey(path)
    const cb = this.armedCaptures.get(key)
    if (!cb) return false
    this.armedCaptures.delete(key)
    setImmediate(cb)
    return true
  }

  /**
   * Whether `session` is still the live queue session of this service. The
   * dispatcher's `canCommit` guard reads this right before a request, so a
   * torn-down session commits nothing (G506-be-4). The check is the session's
   * unique id: the service hands the dispatcher its own session value.
   */
  private isQueueSessionCurrent(session: { id?: string } | null | undefined): boolean {
    const id = session?.id
    if (!id || !this.queueSession) return false
    return (
      this.queueSession.id === id &&
      !this.deadQueueSessions.has(id) &&
      !this.stoppingQueueSessions.has(id)
    )
  }

  /**
   * The account boundary wiped this scope: stop the queue before the wipe. No
   * request runs after this, and the in-flight dispatch's lock is released.
   */
  private stopQueue(): void {
    const session = this.queueSession
    if (session) {
      this.stoppingQueueSessions.add(session.id)
      this.deadQueueSessions.add(session.id)
    }
    this.queueSession = null
  }

  /**
   * The account boundary is about to wipe the live scope: mark the session dead
   * FIRST (so an in-flight dispatch's `canCommit` reads false and sends nothing
   * more), await any in-flight poll/dispatch - whose own `finally` releases the
   * document locks it took - and only then drop the queue. Nothing is torn down
   * before the in-flight pass unwinds, so no request can outlive the boundary.
   * A later open rebuilds the queue for the next session (the scope token moves).
   */
  async teardownSaveQueue(): Promise<void> {
    const session = this.queueSession
    if (session) {
      this.stoppingQueueSessions.add(session.id)
      this.deadQueueSessions.add(session.id)
    }
    // the dispatcher's next `canCommit` reads false now; wait for the pass that
    // is already running to unwind (and release its locks) before the records go
    await this.queuePass?.catch(() => undefined)
    this.stopQueue()
  }

  private sleepMs(ms: number): Promise<void> {
    if (this.deps.sleep) return this.deps.sleep(ms)
    return new Promise((resolveWait) => {
      const timer = setTimeout(resolveWait, ms)
      ;(timer as { unref?: () => void }).unref?.()
    })
  }

  private nowIso(): string {
    return new Date(this.deps.now ? this.deps.now() : Date.now()).toISOString()
  }

  /**
   * G5-11: inspects the target owner's working copies, open editors, and durable
   * intent store to compute what the sign-out prompt needs without changing anything.
   */
  async planSignOut(owner?: LastOwner | null): Promise<SignOutPlan> {
    const target = owner ?? this.liveIdentity() ?? this.lastOwner
    if (!target) {
      return {
        count: 0,
        waiting: 0,
        keystoreLocked: false,
        ramOnly: 0,
      }
    }
    const keystoreLocked = this.storeLocked()
    const access = !keystoreLocked
      ? await this.intentAccess()
      : ({ kind: 'keystore_locked' } as const)
    const storeLockedNow = keystoreLocked || access.kind === 'keystore_locked'
    const unsavedDocs = new Set<string>()
    const waitingDocs = new Set<string>()
    const ramOnlyDocs = new Set<string>()

    for (const dir of scopeWorkingCopyDirs(this.store.root, target)) {
      if (this.store.newerStoreIn(dir)) continue
      const binding = await this.store.readDir(dir)
      if (!binding) continue
      const key = basename(dir)
      const path = join(dir, binding.filename)
      if (this.coordinator.isSaving(path) || this.queueInFlight.has(key)) {
        waitingDocs.add(key)
        unsavedDocs.add(key)
      }
      if (access.kind === 'ok') {
        const stored = await access.intents.read(key, {
          orgId: binding.orgId,
          workspaceId: binding.workspaceId,
          baseVersion: binding.baseVersion,
          length: 0,
        })
        if (stored && !isTerminalQueueState(stored.intent.state)) {
          unsavedDocs.add(key)
          if (
            stored.intent.state === 'validating' ||
            stored.intent.state === 'uploading' ||
            stored.intent.state === 'committing' ||
            stored.intent.state === 'reconciling'
          ) {
            waitingDocs.add(key)
          }
        }
      } else if (binding.state === 'saving' || binding.state === 'reconciling') {
        waitingDocs.add(key)
        unsavedDocs.add(key)
      }
      let diskDirty = false
      if (this.store.exists(path)) {
        diskDirty = KEEP_LOCAL_STATES.has(binding.state)
        if (!diskDirty) {
          try {
            const diskHash = sha256Hex(new Uint8Array(readFileSync(path)))
            if (diskHash !== binding.baseChecksum) diskDirty = true
          } catch {
            // ignore unreadable working copy
          }
        }
      }
      let edDirty = this.editorDirty.has(path) || this.editorDirty.has(pathKey(path))
      if (!edDirty && this.deps.isPathOpen(path) && this.deps.editorStateOf) {
        const st = await this.editorState(path)
        if (st.dirty === true) edDirty = true
      }
      if (diskDirty || edDirty) {
        unsavedDocs.add(key)
        if (storeLockedNow) ramOnlyDocs.add(key)
      }
    }

    return {
      count: unsavedDocs.size,
      waiting: waitingDocs.size,
      keystoreLocked: storeLockedNow,
      ramOnly: storeLockedNow ? ramOnlyDocs.size : 0,
    }
  }

  /** Alias for `planSignOut` used by IPC handler (`UNIWORK_DOC_CHANNELS.signOutPlan`). */
  async signOutPlan(owner?: LastOwner | null): Promise<SignOutPlan> {
    return this.planSignOut(owner)
  }

  /**
   * G5-11: 6-step sign-out / account-switch / deployment-switch session lock:
   * 1. Stop runtime + mark queue session stopping, bounded wait (`SIGN_OUT_RECEIPT_WAIT_MS`)
   *    for any in-flight upload/commit, transitioning still-in-flight records to
   *    `reconciling` and marking the queue session dead so late responses write nothing.
   * 2. Capture N+1 editor/disk working copies into the encrypted `parked` store
   *    (skipped when `keystoreLocked`).
   * 3. Close every open view of `owner`'s working copies with no prompt, forget AI
   *    history and locks.
   * 4. Delete the plaintext working copies and docs/sheets/slides recovery copies of
   *    `owner`, and its archived docs originals, only for docs whose step 2
   *    capture/park succeeded (or after the keystore confirmation); a doc whose
   *    capture never landed keeps its folder and is reported in `captureFailed`.
   * 5. Clear all in-memory caches on the service.
   * 6. Lock the encrypted store (`syncStore.lock(owner)`).
   */
  async lockSession(owner?: LastOwner | null, onWaiting?: () => void): Promise<SignOutLockResult> {
    const target = owner ?? this.liveIdentity() ?? this.lastOwner
    if (!target) return { ok: true, captureFailed: [] }
    const scopeToken = `${target.deploymentId}/${target.accountId}`
    const keystoreLocked = this.storeLocked()

    // Step 1: stop runtime, block new commits, bounded receipt wait (30s)
    this.deps.stopRuntime?.()
    if (this.queueSession) {
      this.stoppingQueueSessions.add(this.queueSession.id)
    }
    const dirs = scopeWorkingCopyDirs(this.store.root, target)
    const savingPromises: Promise<unknown>[] = []
    if (this.queuePass) savingPromises.push(this.queuePass.catch(() => undefined))
    let hasInFlightRecord = false
    const open = !keystoreLocked
      ? await this.openSyncStore()
      : ({ kind: 'keystore_locked' } as const)
    const intents =
      open.kind === 'ok' ? createIntentStore(open.records(INTENT_STORE_REGISTRATION.name)) : null

    for (const dir of dirs) {
      if (this.store.newerStoreIn(dir)) continue
      const binding = await this.store.readDir(dir)
      if (!binding) continue
      const key = basename(dir)
      const path = join(dir, binding.filename)
      if (this.coordinator.isSaving(path)) {
        savingPromises.push(this.coordinator.settled(path).catch(() => undefined))
      }
      if (intents) {
        const stored = await intents.read(key, {
          orgId: binding.orgId,
          workspaceId: binding.workspaceId,
          baseVersion: binding.baseVersion,
          length: 0,
        })
        if (
          stored &&
          (stored.intent.state === 'validating' ||
            stored.intent.state === 'uploading' ||
            stored.intent.state === 'committing')
        ) {
          hasInFlightRecord = true
        }
      }
    }

    if (savingPromises.length > 0 || hasInFlightRecord) {
      onWaiting?.()
      this.deps.pushSignOutProgress?.({ phase: 'waiting' })
      if (savingPromises.length > 0) {
        await Promise.race([Promise.all(savingPromises), this.sleepMs(SIGN_OUT_RECEIPT_WAIT_MS)])
      } else {
        await this.sleepMs(SIGN_OUT_RECEIPT_WAIT_MS)
      }
    }
    if (this.pendingApplyRecords.size > 0) {
      await Promise.all([...this.pendingApplyRecords])
    }

    // Mark the queue session dead so any late HTTP response writes nothing
    this.stopQueue()

    // Transition any record still in validating | uploading | committing to reconciling
    if (intents) {
      const now = this.nowIso()
      for (const dir of dirs) {
        if (this.store.newerStoreIn(dir)) continue
        const binding = await this.store.readDir(dir)
        if (!binding) continue
        const key = basename(dir)
        const stored = await intents.read(key, {
          orgId: binding.orgId,
          workspaceId: binding.workspaceId,
          baseVersion: binding.baseVersion,
          length: 0,
        })
        if (
          stored &&
          (stored.intent.state === 'validating' ||
            stored.intent.state === 'uploading' ||
            stored.intent.state === 'committing')
        ) {
          const reconciled: IntentRecordV2 = {
            ...stored.intent,
            state: 'reconciling',
            reconcileSince: stored.intent.reconcileSince ?? now,
            updatedAt: now,
          }
          await intents.put(key, reconciled, stored.payload)
        }
      }
    }

    // Step 2: capture N+1 from open editors and park dirty / queued working copies
    const parkFailedDirs = new Set<string>()
    /**
     * G5-11 d1-1: document keys whose editor capture never landed on disk.
     * When the capture did not land, we park the newest bytes available (the
     * module's recovery copy if newer than disk, else disk bytes if different
     * from baseChecksum) and delete the folder + recovery copies so NO plaintext
     * of the account survives under userData.
     */
    const captureFailedKeys = new Set<string>()
    let parked: ParkedStore | null = null
    if (!keystoreLocked && open.kind === 'ok' && intents) {
      parked = createParkedStore(open.records(PARKED_STORE_REGISTRATION.name))
      for (const dir of dirs) {
        if (this.store.newerStoreIn(dir)) continue
        const binding = await this.store.readDir(dir)
        if (!binding) continue
        const key = basename(dir)
        const path = join(dir, binding.filename)
        const isOpen = this.deps.isPathOpen(path)
        let edDirty = this.editorDirty.has(path) || this.editorDirty.has(pathKey(path))
        if (!edDirty && isOpen && this.deps.editorStateOf) {
          const st = await this.editorState(path)
          if (st.dirty === true) edDirty = true
        }
        const captureNeeded = isOpen && edDirty
        let beforeHash: string | null = null
        let captureLanded = false
        if (captureNeeded) {
          beforeHash = this.store.exists(path)
            ? sha256Hex(new Uint8Array(readFileSync(path)))
            : null
          await new Promise<void>((resolveCapture) => {
            let done = false
            const finish = () => {
              if (done) return
              done = true
              this.armedCaptures.delete(pathKey(path))
              resolveCapture()
            }
            this.armCapture(path, () => {
              captureLanded = true
              finish()
            })
            const started = this.deps.requestModuleSave(path, finish, 'capture')
            if (!started) {
              finish()
              return
            }
            const afterHash = this.store.exists(path)
              ? sha256Hex(new Uint8Array(readFileSync(path)))
              : null
            if (afterHash !== beforeHash || !this.armedCaptures.has(pathKey(path))) {
              captureLanded = true
              finish()
              return
            }
            void Promise.resolve().then(() => {
              const nextHash = this.store.exists(path)
                ? sha256Hex(new Uint8Array(readFileSync(path)))
                : null
              if (nextHash !== beforeHash || !this.armedCaptures.has(pathKey(path))) {
                captureLanded = true
                finish()
              }
            })
            void this.sleepMs(5_000).then(finish)
          })
          if (!captureLanded && this.store.exists(path)) {
            const endHash = sha256Hex(new Uint8Array(readFileSync(path)))
            if (endHash !== beforeHash) captureLanded = true
          }
          if (!captureLanded || !this.store.exists(path)) {
            captureFailedKeys.add(key)
          }
        }
        const diskExists = this.store.exists(path)
        let diskMtimeMs: number | null = null
        let diskBytes: Uint8Array | null = null
        let diskHash: string | null = null
        if (diskExists) {
          try {
            diskMtimeMs = statSync(path).mtimeMs
            diskBytes = new Uint8Array(readFileSync(path))
            diskHash = sha256Hex(diskBytes)
          } catch {
            // unreadable working copy
          }
        }
        if (captureNeeded && !captureLanded) {
          // d1-1: capture did not land; park the newest bytes available (recovery copy if newer than disk, else disk if != baseChecksum)
          const recoveryBytes = this.findNewestRecoveryBytes(path, diskMtimeMs)
          const candidateBytes =
            recoveryBytes ?? (diskBytes && diskHash !== binding.baseChecksum ? diskBytes : null)
          if (candidateBytes) {
            const parkRes = await parked.park({
              documentKey: key,
              binding: {
                ...binding,
                state: 'dirty',
                minStoreLevel: APP_STORE_LEVEL,
                minAppVersion: this.buildVersion(),
              },
              bytes: candidateBytes,
              parkedAt: this.nowIso(),
            })
            if (parkRes !== 'ok') {
              parkFailedDirs.add(dir)
            }
          }
          continue
        }
        if (!diskBytes || diskHash === null) continue
        const stored = await intents.read(key, {
          orgId: binding.orgId,
          workspaceId: binding.workspaceId,
          baseVersion: binding.baseVersion,
          length: diskBytes.byteLength,
        })
        const hasActiveIntent = stored !== null && !isTerminalQueueState(stored.intent.state)
        const needsPark =
          diskHash !== binding.baseChecksum ||
          KEEP_LOCAL_STATES.has(binding.state) ||
          hasActiveIntent
        if (needsPark) {
          const parkRes = await parked.park({
            documentKey: key,
            binding: {
              ...binding,
              state: 'dirty',
              minStoreLevel: APP_STORE_LEVEL,
              minAppVersion: this.buildVersion(),
            },
            bytes: diskBytes,
            parkedAt: this.nowIso(),
          })
          if (parkRes !== 'ok') {
            parkFailedDirs.add(dir)
          }
        } else if (captureNeeded) {
          // the disk still holds only the base bytes: the capture did not land
          captureFailedKeys.add(key)
          const recoveryBytes = this.findNewestRecoveryBytes(path, diskMtimeMs)
          if (recoveryBytes) {
            const parkRes = await parked.park({
              documentKey: key,
              binding: {
                ...binding,
                state: 'dirty',
                minStoreLevel: APP_STORE_LEVEL,
                minAppVersion: this.buildVersion(),
              },
              bytes: recoveryBytes,
              parkedAt: this.nowIso(),
            })
            if (parkRes !== 'ok') {
              parkFailedDirs.add(dir)
            }
          }
        }
      }
    }

    // Step 3: close every view of the owner's copies with NO prompt, forget AI history + locks
    this.closeConflictPrompt()
    const ownedPath = (p: string): boolean => this.pathBelongsTo(target, p)
    this.forgetLocksWhere(ownedPath)
    if (this.deps.closePathNow && parkFailedDirs.size === 0) {
      const openPaths = this.deps.openPaths ? this.deps.openPaths() : []
      for (const p of openPaths) {
        if (ownedPath(p)) this.deps.closePathNow(p)
      }
    }
    if (this.deps.aiHistoryPaths && this.deps.forgetAiHistory && parkFailedDirs.size === 0) {
      const toForget = this.deps.aiHistoryPaths().filter(ownedPath)
      if (toForget.length > 0) this.deps.forgetAiHistory(toForget)
    }

    // Step 4: delete the plaintext working copies whose bytes were captured or
    // parked, and every docs/sheets/slides recovery copy of the owner's paths. Only a
    // dir whose park was refused (parkFailedDirs) or declares a newer store stays.
    const keptDirs = new Set<string>()
    const deletedPaths = new Set<string>()
    const originalsTargets = new Map<string, { path: string; baseChecksum?: string }>()
    for (const dir of scopeWorkingCopyDirs(this.store.root, target)) {
      if (this.store.newerStoreIn(dir) || parkFailedDirs.has(dir)) {
        keptDirs.add(dir)
        continue
      }
      const binding = await this.store.readDir(dir)
      const filename = binding?.filename ?? documentNameIn(dir)
      const fullPath = join(dir, filename)
      deletedPaths.add(fullPath)
      originalsTargets.set(fullPath, {
        path: fullPath,
        ...(binding?.baseChecksum ? { baseChecksum: binding.baseChecksum } : {}),
      })
    }
    // be-8: recovery copies of a path whose folder is already gone have no
    // folder left to walk; the parked records and the owner's still-open paths
    // are the only names that can still find them
    for (const path of await this.sweepRecoveryPaths(target, parked)) {
      deletedPaths.add(path)
      if (!originalsTargets.has(path)) originalsTargets.set(path, { path })
    }
    for (const path of deletedPaths) this.deleteRecoveryCopies(path)
    // be-2 / d1-3: the docs originals archive is keyed by the sha256 of the
    // open-time bytes (baseChecksum) or current bytes, cleared before rmSync
    try {
      this.clearOriginalsFn?.([...originalsTargets.values()])
    } catch {
      // the archive is module state; a failure never blocks the lock
    }
    for (const dir of scopeWorkingCopyDirs(this.store.root, target)) {
      if (keptDirs.has(dir)) continue
      rmSync(dir, { recursive: true, force: true })
    }
    if (keptDirs.size === 0) {
      const accountDir = join(this.store.root, target.deploymentId, target.accountId)
      rmSync(accountDir, { recursive: true, force: true })
    }

    // Step 5: clear all 15 in-memory caches on the service
    this.lockedScopes.add(scopeToken)
    // be-10: only the owner's own locks go (`forgetLocksWhere` already matched
    // this account): another account's S11 panel is not this sign-out's to drop
    for (const [key, lock] of [...this.locks]) {
      if (ownedPath(lock.path)) this.locks.delete(key)
    }
    this.hashMemo.clear()
    this.editorDirty.clear()
    this.lastUserSave.clear()
    this.otherWindowStatus.clear()
    this.selfRenamed.clear()
    this.remoteBars.clear()
    this.remoteNotices.clear()
    this.remoteHeld.clear()
    this.ownEcho.clear()
    this.remoteLocked.clear()
    this.editorAi.clear()
    this.remoteReloads.clear()
    this.orgMemberNames.clear()
    this.orgMemberNamesOrg = null
    this.orgMemberNamesInFlight = null
    this.migratedScopes.delete(scopeToken)

    // Step 6: lock the encrypted store for this scope
    await this.deps.syncStore?.lock({
      deploymentId: target.deploymentId,
      accountId: target.accountId,
    })
    this.syncOpen = null
    this.storeOpenKind = 'unknown'
    const captureFailed = [...captureFailedKeys]
    // The single `done` of a sign-out is pushed by the caller's finally (the
    // wiring's lockStore), so it also fires when this method throws.

    return {
      ok: parkFailedDirs.size === 0,
      captureFailed,
    }
  }

  private clearRecoveryFn: ((path: string) => void) | null = null

  setClearRecovery(clear: (path: string) => void): void {
    this.clearRecoveryFn = clear
  }

  private clearOriginalsFn:
    ((entries: Array<string | { path: string; baseChecksum?: string }>) => void) | null = null

  /**
   * G5-11 be-2 / d1-3: the docs originals archive (`userData/originals/<sha256>.docx`)
   * is kept for plain local files only; sign-out clears the copies archived for
   * the owner's working copies, by the open-time `baseChecksum` and the hash of
   * the bytes that are about to be deleted (the module seam owns the archive).
   */
  setClearOriginals(
    clear: (entries: Array<string | { path: string; baseChecksum?: string }>) => void,
  ): void {
    this.clearOriginalsFn = clear
  }

  /** true when `path` is a working copy under `owner`'s account folder */
  private pathBelongsTo(owner: LastOwner, path: string): boolean {
    const rel = relative(resolve(this.store.root), resolve(path))
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return false
    const [dep, acc] = rel.split(sep)
    return dep === owner.deploymentId && acc === owner.accountId
  }

  /**
   * G5-11 be-8: the working-copy paths of `owner` that a folder walk cannot
   * reach any more - a parked record whose folder was removed at an earlier
   * lock, and a path still open in a view whose folder was deleted or renamed
   * underneath it. Both only exist as the path the module hashed, so these
   * names are the only way to clear the recovery copies they left behind.
   */
  private async sweepRecoveryPaths(
    owner: LastOwner,
    parked: ParkedStore | null,
  ): Promise<string[]> {
    const paths: string[] = []
    for (const path of this.deps.openPaths?.() ?? []) {
      if (this.pathBelongsTo(owner, path)) paths.push(path)
    }
    if (parked) {
      try {
        for (const key of await parked.list()) {
          const dir = this.store.dirFor(owner.deploymentId, owner.accountId, key)
          // a folder still on disk is walked by step 4 itself
          if (existsSync(dir)) continue
          const copy = await parked.take(key)
          if (copy) paths.push(join(dir, copy.binding.filename))
        }
      } catch {
        // the parked store is module state; a failure never blocks the lock
      }
    }
    return paths
  }

  /**
   * G5-11 d1-1: returns the module crash-recovery copy's bytes for `filePath`
   * when one exists under the same naming `deleteRecoveryCopies` uses and is
   * newer than `diskMtimeMs` (or when the disk file is missing).
   */
  private findNewestRecoveryBytes(filePath: string, diskMtimeMs: number | null): Uint8Array | null {
    let bestBytes: Uint8Array | null = null
    // d2-3: with no disk file every candidate competes on mtime alone
    let bestMtime = diskMtimeMs ?? -Infinity
    for (const target of this.recoveryCopyPaths(filePath)) {
      try {
        if (!existsSync(target)) continue
        const st = statSync(target)
        if (st.mtimeMs > bestMtime) {
          bestBytes = new Uint8Array(readFileSync(target))
          bestMtime = st.mtimeMs
        }
      } catch {
        // ignore unreadable recovery copy
      }
    }
    return bestBytes
  }

  /**
   * G5-11 be-6: the crash-recovery copies of one working copy. The modules name
   * them `sha1(<the path they were given>).slice(0, 16)` with their own
   * extension (`docs-autosave/*.docx`, `sheets-autosave/*.xlsx`, and d2-1
   * `slides-autosave/*.pptx`, which a build before the slides bound-path gate
   * still wrote). The path is hashed as given, as resolved, and through the
   * shared `pathKey` normalizer, so a separator or drive-letter spelling
   * difference does not leave a copy behind.
   */
  private recoveryCopyPaths(filePath: string): string[] {
    const dirs: Array<[string, string]> = [
      ['docs-autosave', 'docx'],
      ['sheets-autosave', 'xlsx'],
      ['slides-autosave', 'pptx'],
    ]
    const spellings = new Set([
      filePath,
      resolve(filePath),
      pathKey(filePath),
      pathKey(resolve(filePath)),
    ])
    const out: string[] = []
    for (const spelling of spellings) {
      const shortHash = createHash('sha1').update(spelling).digest('hex').slice(0, 16)
      for (const [sub, ext] of dirs) {
        out.push(join(this.deps.userDataDir, sub, `${shortHash}.${ext}`))
      }
    }
    return out
  }

  /**
   * Deletes every crash-recovery copy of one working copy (`recoveryCopyPaths`).
   * The registered module clearer is the load-bearing path (it also bumps the
   * stale-recovery epoch).
   */
  private deleteRecoveryCopies(filePath: string): void {
    try {
      this.clearRecoveryFn?.(filePath)
    } catch {
      // ignore when Electron app path is not initialized in unit tests
    }
    for (const target of this.recoveryCopyPaths(filePath)) {
      try {
        if (existsSync(target)) unlinkSync(target)
      } catch {
        // ignore
      }
    }
  }

  /**
   * G5-11: on same-account sign-in, restores any parked working copies from the
   * encrypted `parked` store back to `uniwork-documents/<dep>/<acc>/<doc>/`,
   * verifies the written file's sha256 against the parked bytes, and removes
   * the parked record only after verification succeeds. Refuses to restore
   * records whose binding declares a newer `minStoreLevel` (or whose folder
   * declares a newer store), and remembers the refusal so a poll does not
   * re-read them every 60 s.
   *
   * The binding is written BEFORE the working copy: a refused binding write (or
   * a crash between the two writes) must never leave plaintext on disk that no
   * binding explains, and the working copy is only written once the binding
   * landed.
   */
  async restoreParked(owner?: LastOwner | null): Promise<void> {
    const target = owner ?? this.liveIdentity()
    if (!target || !this.deps.syncStore) return
    const scope = this.deps.syncStore.scope()
    if (
      !scope ||
      scope.deploymentId !== target.deploymentId ||
      scope.accountId !== target.accountId
    ) {
      return
    }
    this.lockedScopes.delete(`${target.deploymentId}/${target.accountId}`)
    this.clearSignedOutLocks()
    const open = await this.openSyncStore()
    if (open.kind !== 'ok') return
    const parked = createParkedStore(open.records(PARKED_STORE_REGISTRATION.name))
    const keys = await parked.list()
    for (const key of keys) {
      const refusal = `${target.deploymentId}/${target.accountId}/${key}`
      const dir = this.store.dirFor(target.deploymentId, target.accountId, key)
      // d1-5: drop folder-level refusal when `newerStoreIn(dir)` turns false
      if (this.store.newerStoreIn(dir)) {
        this.refusedParkedKeys.add(refusal)
        this.refusedParkedFolderKeys.add(refusal)
        continue
      }
      if (this.refusedParkedFolderKeys.delete(refusal)) {
        this.refusedParkedKeys.delete(refusal)
      }
      if (this.refusedParkedKeys.has(refusal)) continue
      const copy = await parked.take(key)
      if (!copy) continue
      if ((copy.binding.minStoreLevel ?? APP_STORE_LEVEL) > APP_STORE_LEVEL) {
        this.refusedParkedKeys.add(refusal)
        continue
      }
      const written = await this.store.write(dir, {
        ...copy.binding,
        state: 'dirty',
        minStoreLevel: APP_STORE_LEVEL,
        minAppVersion: this.buildVersion(),
      })
      if (!written) continue
      const filePath = await this.store.writeWorkingCopy(dir, copy.binding.filename, copy.bytes)
      const readBack = new Uint8Array(await readFile(filePath))
      if (sha256Hex(readBack) === sha256Hex(copy.bytes)) {
        await parked.remove(key)
        this.refusedParkedKeys.delete(refusal)
      }
    }
  }

  private clearSignedOutLocks(): void {
    let cleared = false
    for (const [key, lock] of [...this.locks]) {
      if (lock.reason === 'signed_out') {
        this.locks.delete(key)
        cleared = true
      }
    }
    if (cleared) this.deps.pushLocks?.()
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
   * pre-store pending intent, or - while signed out - a residual working copy
   * of a signed-out account (G5-11). Recorded and pushed, so the shell shows
   * the S11 panel. True = nothing may open for that path.
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
    if (!this.deps.identity()) {
      if (!this.storeLocked() && this.store.classify(path).kind === 'bound') {
        this.recordPathLock(path, 'signed_out')
        return true
      }
      return false
    }
    // d2-2: a folder a sign-out kept (park refused, newer store) stays locked
    // for every other live identity; only its own account reopens it
    const found = this.store.classify(path)
    if (found.kind === 'bound' && this.lockedForOtherIdentity(found.doc)) {
      this.recordPathLock(path, 'signed_out')
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
   *
   * G5-03a: the S6 state of those paths goes with the locks. A revoked/deleted
   * verdict is keyed by document id and would otherwise answer for the next
   * account's copy of the same document, and a bar of the account that went
   * away must not survive the boundary either.
   */
  forgetLocksWhere(match: (path: string) => boolean): void {
    for (const [key, lock] of [...this.locks]) {
      if (match(lock.path)) this.locks.delete(key)
    }
    for (const key of [...this.remoteBars.keys()]) {
      const doc = this.store.lookup(key)
      if (!match(doc?.path ?? key)) continue
      this.remoteBars.delete(key)
      this.remoteNotices.delete(key)
      if (!doc) continue
      this.remoteLocked.delete(doc.binding.documentId)
      this.remoteHeld.delete(doc.binding.documentId)
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

  private isSignedOutLocked(path: string, doc: BoundDocument): boolean {
    if (this.locks.get(pathKey(path))?.reason === 'signed_out') return true
    if (this.lockedForOtherIdentity(doc)) return true
    return (
      !this.deps.identity() &&
      !this.storeLocked() &&
      this.lockedScopes.has(`${doc.deploymentId}/${doc.userId}`)
    )
  }

  /** d2-2: a signed-out account's copy while a different identity is live */
  private lockedForOtherIdentity(doc: BoundDocument): boolean {
    return (
      !!this.deps.identity() &&
      this.lockedScopes.has(`${doc.deploymentId}/${doc.userId}`) &&
      !this.owns(doc)
    )
  }

  /** view access, another account's copy, a newer store this build cannot read, or an S6 lock (one read) */
  isReadOnly(path: string): boolean {
    const found: PathBinding = this.store.classify(path)
    if (found.kind === 'newer') return true
    if (found.kind !== 'bound') return false
    if (this.isSignedOutLocked(path, found.doc)) return true
    // G5-03a: a document the server has revoked or deleted while it is open is
    // read-only for good (its module refuses the save, and W4's export gate
    // reads the same answer)
    if (this.lockedFor(found.doc.binding)) return true
    // G5-06: another window holds this document's lock: this one is read-only
    // (EXPERIENCE - Second-window bar, :129). The queue never writes for it, and
    // the module is told so too. No extra binding read: `classify` already gave
    // the document key the in-memory lock map is keyed by.
    return (
      found.doc.binding.access === 'view' ||
      !this.ownsLocally(found.doc) ||
      this.coordinator.isOtherWindow(found.doc.key)
    )
  }

  /**
   * G5-03a: the server revoked or deleted this open working copy, or (G5-11)
   * it is a residual working copy while signed out. The module seam reads this
   * to refuse export / Save As / print-to-PDF; `isReadOnly` already covers the
   * save side.
   */
  isLocked(path: string): boolean {
    const found: PathBinding = this.store.classify(path)
    if (found.kind !== 'bound') return false
    if (this.isSignedOutLocked(path, found.doc)) return true
    return this.lockedFor(found.doc.binding) !== null
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
      // the controller is registered before the first await: a Cancel that lands
      // while the file is still being stat'ed finds the upload and is never
      // dropped (R2-1)
      const controller = new AbortController()
      this.uploads.set(uploadId, controller)
      try {
        let size: number
        try {
          const info = await stat(input.path)
          if (!info.isFile()) throw new UniworkDocError('not_found')
          size = info.size
        } catch (error) {
          throw error instanceof UniworkDocError ? error : new UniworkDocError('not_found')
        }
        // a Cancel during the stat: answer it before the read and the POST
        if (controller.signal.aborted) throw cancelledUpload()
        if (size > MAX_UPLOAD_BYTES) throw new UniworkDocError('too_large')
        let bytes: Uint8Array
        try {
          bytes = new Uint8Array(await readFile(input.path, { signal: controller.signal }))
        } catch {
          if (controller.signal.aborted) throw cancelledUpload()
          throw new UniworkDocError('not_found')
        }
        // the read can also resolve just as the abort lands: no POST then
        if (controller.signal.aborted) throw cancelledUpload()
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
      // coded 403 maps to permission_revoked (errors.ts), so both spellings
      // count. A transient failure is not cached and is retried on the next open.
      const stable =
        error instanceof UniworkDocError &&
        (error.code === 'forbidden' ||
          error.code === 'permission_revoked' ||
          error.code === 'not_found')
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
   *
   * G5-03a: the same change is the S6 notice (`change` carries the head version
   * and version id), so one feed tick drives both the rename follow and the
   * newer-version decision.
   */
  noteFeedChange(documentId: string, revision?: string, change?: FeedChange): void {
    if (typeof documentId !== 'string' || !documentId) return
    const rev = typeof revision === 'string' ? revision : change?.revision
    const own = this.selfRenamed.get(documentId)
    if (own !== undefined) {
      this.selfRenamed.delete(documentId)
      if (rev === undefined || rev === own) {
        // its own revision, now settled: never a newer-version notice either
        if (rev !== undefined) this.rememberOwnEcho(documentId, rev)
        return
      }
    }
    void this.refreshMetadataFor(documentId).catch(() => undefined)
    if (change && rev !== undefined) {
      void this.noteRemoteChange({
        documentId,
        revision: rev,
        version: change.currentVersion,
        versionId: change.versionId,
      }).catch(() => undefined)
    }
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
    } catch (error) {
      // G5-03a: the server's own verdicts are no longer swallowed - a 403/404
      // revokes the copy and a 410 deletes it (the S6 lock); the rest is
      // transient and stays invisible here
      const verdict = lockVerdict(error)
      if (verdict) await this.lockFromServer(documentId, verdict)
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
    // G5-03a FF: guarded by the base just read. A guarded reload/restore can put
    // a different base in place between that read and the queued write (W4: its
    // `9/saved` lands after this `10/saved` read); the coordinator compares the
    // guard inside its chain, so the superseded base is never resurrected as
    // `dirty` - and a copy the restore made match its base again stays `saved`.
    return this.coordinator.commitState(fresh, next, {
      baseRevision: fresh.binding.baseRevision,
      baseChecksum: fresh.binding.baseChecksum,
    })
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
    // another window holds the document lock: this window is read-only and
    // never writes (EXPERIENCE - Second-window bar, :129)
    if (this.coordinator.isOtherWindow(doc.key)) return false
    return !(b.state === 'blocked' && b.error !== 'quota_exceeded')
  }

  // ---- S6: a newer version on the server (G5-03a) ---------------------------

  /**
   * One feed notice for an open, bound document of this session: the pure rule
   * order decides (remote-newer.ts) and this class only acts - hold it, show
   * its bar, or run the guarded clean reload. A notice for a closed or unknown
   * document does nothing: there is no surface to move.
   */
  private async noteRemoteChange(notice: RemoteNotice): Promise<void> {
    const doc = await this.boundDocFor(notice.documentId)
    if (!doc || !this.deps.isPathOpen(doc.path)) return
    const decision = decideRemote(notice, await this.remoteLocalFor(doc))
    await this.applyRemoteDecision(doc, notice, decision)
  }

  private async applyRemoteDecision(
    doc: BoundDocument,
    notice: RemoteNotice,
    decision: ReturnType<typeof decideRemote>,
  ): Promise<void> {
    switch (decision.kind) {
      case 'ignore':
        if (decision.reason === 'malformed') {
          console.warn(`uniwork docs: ignoring a malformed feed revision for ${notice.documentId}`)
        }
        return
      case 'hold':
        // the intent's own receipt decides: settleFromRecord/applyRecord re-decide it
        this.remoteHeld.set(notice.documentId, notice)
        return
      case 'bar':
        await this.showRemoteBar(doc, notice, decision.bar)
        return
      case 'reload':
        await this.runGuardedReload(doc.path, notice)
    }
  }

  /** everything decideRemote needs about the local copy; nulls where the store cannot answer */
  private async remoteLocalFor(doc: BoundDocument): Promise<RemoteLocal> {
    const editor = await this.editorState(doc.path)
    const record = await this.queueRecordFor(doc)
    return {
      documentId: doc.binding.documentId,
      baseRevision: doc.binding.baseRevision,
      feedOn: await this.feedOnFor(doc.binding.orgId),
      dirty:
        doc.binding.state === 'dirty' || this.editorDirty.has(doc.path) || editor.dirty === true,
      aiRunning: editor.aiRunning,
      queue: record && !isTerminalQueueState(record.state) ? record.state : null,
      ...(record?.receipt ? { receiptRevision: record.receipt.revision } : {}),
      ownEcho: this.echoSet(doc.binding.documentId),
      locked: this.lockedFor(doc.binding),
    }
  }

  /** the document's live intent record, or null (none, terminal, store unreachable) */
  private async queueRecordFor(doc: BoundDocument): Promise<IntentRecordV2 | null> {
    const access = await this.intentAccess()
    if (access.kind !== 'ok') return null
    const stored = await access.intents.read(doc.key, {
      orgId: doc.binding.orgId,
      workspaceId: doc.binding.workspaceId,
      baseVersion: doc.binding.baseVersion,
      length: 0,
    })
    return stored ? stored.intent : null
  }

  /**
   * `sync_feed` of the document's org through the SAME capability cache the save
   * queue reads. A store that cannot answer (session expired, a network throw)
   * counts as on: the notice was already produced by the feed, so a transient
   * capability failure must not hide the bar.
   */
  private async feedOnFor(orgId: string): Promise<boolean> {
    if (!this.deps.capability || !orgId) return true
    try {
      const read = await this.deps.capability.get(orgId)
      const capabilities = read.capabilities as { sync_feed?: boolean }
      if (read.source === 'default' || capabilities.sync_feed === undefined) return true
      return capabilities.sync_feed === true
    } catch {
      return true
    }
  }

  /** the fresh editor state; a missing seam or a view that cannot answer reads clean and idle */
  private async editorState(
    path: string,
  ): Promise<{ dirty: boolean | null; aiRunning: boolean; aiEpoch: number }> {
    if (!this.deps.editorStateOf) return { dirty: null, aiRunning: false, aiEpoch: 0 }
    try {
      return await this.deps.editorStateOf(path)
    } catch {
      return { dirty: null, aiRunning: false, aiEpoch: 0 }
    }
  }

  private rememberOwnEcho(documentId: string, revision: string): void {
    let set = this.ownEcho.get(documentId)
    if (!set) {
      set = new Set()
      this.ownEcho.set(documentId, set)
    }
    set.add(revision)
    // the check only ever looks at the notice's own revision: a bounded window
    // of the newest ones is enough, and a long session cannot grow it forever
    while (set.size > 16) {
      const oldest = set.values().next().value
      if (oldest === undefined) break
      set.delete(oldest)
    }
  }

  private echoSet(documentId: string): ReadonlySet<string> {
    return this.ownEcho.get(documentId) ?? NO_ECHO
  }

  /** the lock of a document: this session's verdict, or the one the binding carries */
  private lockedFor(binding: Binding): 'revoked' | 'deleted' | null {
    const known = this.remoteLocked.get(binding.documentId)
    if (known) return known
    if (binding.state !== 'blocked') return null
    if (binding.error === 'permission_revoked') return 'revoked'
    if (binding.error === 'document_deleted') return 'deleted'
    return null
  }

  /**
   * Show one bar: remembered for the path (the authoritative in-memory state),
   * and carried onto the binding for the newer-* kinds so a restart still shows
   * it - the feed never replays the notice.
   */
  private async showRemoteBar(
    doc: BoundDocument,
    notice: RemoteNotice,
    bar: UniworkRemoteBar,
  ): Promise<void> {
    const key = pathKey(doc.path)
    this.remoteBars.set(key, bar)
    this.remoteNotices.set(key, notice)
    const fresh = this.store.lookup(doc.path)
    if (!fresh) return
    if (bar.kind === 'updated') {
      this.publish(toStatus(fresh))
      return
    }
    const next: Binding = {
      ...fresh.binding,
      serverRevision: notice.revision,
      serverVersion: notice.version,
    }
    await this.coordinator.commitState(fresh, next)
  }

  /**
   * The S6 bar's actions. `later` keeps the bar in the status - the renderer is
   * what hides it (per path + bar signature), so the chip's `remote-newer` pill
   * stays; `close` is the action that clears it in this session. `reload` opens
   * the existing conflict dialog flow (S5 proper is G5-09), and
   * `retry`/`reload-now` are the guarded clean reload again.
   */
  async remoteAction(path: string, action: UniworkRemoteAction): Promise<UniworkDocStatus | null> {
    const doc = typeof path === 'string' ? this.store.lookup(path) : null
    if (!doc || !this.ownsLocally(doc)) return null
    const key = pathKey(doc.path)
    const notice = this.remoteNotices.get(key)
    switch (action) {
      case 'later':
        // EXPERIENCE S6: Later only hides the BAR, in the window that pressed it
        // (the renderer keeps that per path + bar signature); main keeps the bar
        // in the status, so the chip's `remote-newer` pill stays. A newer
        // revision replaces the version as usual.
        return this.statusOf(doc)
      case 'close':
        // Close hides the info bar for this session (one bar, no stacking)
        this.remoteBars.set(key, null)
        return this.statusOf(doc)
      case 'retry':
      case 'reload-now': {
        if (!notice) return this.statusOf(doc)
        await this.runGuardedReload(doc.path, notice)
        return this.currentStatus(doc)
      }
      case 'reload':
        return this.remoteReloadFlow(doc)
      default:
        return this.statusOf(doc)
    }
  }

  /**
   * "Tải lại bản mới nhất…": the existing conflict dialog, opened from the bar.
   * One dialog at a time, exactly as the chip's conflict flow: a dialog for
   * another document closes as "Decide later" first. While the AI turn is still
   * running the action is inert (D3: no stop channel yet, the renderer shows it
   * aria-disabled).
   */
  private async remoteReloadFlow(doc: BoundDocument): Promise<UniworkDocStatus | null> {
    const notice = this.remoteNotices.get(pathKey(doc.path))
    if (!notice) return this.statusOf(doc)
    if (this.remoteBars.get(pathKey(doc.path))?.kind === 'newer-ai') {
      const editor = await this.editorState(doc.path)
      if (editor.aiRunning) return this.statusOf(doc)
    }
    const open = this.conflictPrompt
    if (open) {
      open.controller.abort()
      await open.done
    }
    const controller = new AbortController()
    const done = this.runRemoteReload(doc, notice, controller.signal)
    const prompt = { path: doc.path, controller, fromClose: false, done }
    this.conflictPrompt = prompt
    try {
      return await done
    } finally {
      if (this.conflictPrompt === prompt) this.conflictPrompt = null
    }
  }

  private async runRemoteReload(
    doc: BoundDocument,
    notice: RemoteNotice,
    signal: AbortSignal,
  ): Promise<UniworkDocStatus | null> {
    const choice = signal.aborted
      ? 'later'
      : await this.deps.ui.chooseConflict(doc.binding.title, signal)
    if (signal.aborted || choice === 'later') return this.currentStatus(doc)
    const chosen = this.sameLiveDoc(doc)
    if (!chosen) return this.currentStatus(doc)
    if (choice === 'open-latest') {
      const confirmed = await this.deps.ui.confirmDiscard(chosen.binding.title, signal)
      if (!confirmed || signal.aborted) return this.currentStatus(chosen)
      try {
        const done = await this.replaceWithLatest(chosen)
        this.remoteBars.set(pathKey(done.path), { kind: 'updated', version: notice.version })
        this.remoteNotices.set(pathKey(done.path), notice)
        return this.statusOf(done)
      } catch {
        this.deps.ui.showOpenLatestFailed()
        return this.currentStatus(chosen)
      }
    }
    if (choice === 'overwrite') return this.overwrite(chosen)
    if (choice === 'save-local-copy') {
      await this.copyAside(chosen)
      return this.currentStatus(chosen)
    }
    return this.currentStatus(doc)
  }

  /**
   * A successful resync no longer lists this open, bound document: classify it
   * with ONE metadata read. 403/404 -> revoked, 410 -> deleted, an answer ->
   * nothing (the snapshot may simply have moved on).
   */
  async noteFeedGone(documentId: string): Promise<void> {
    if (typeof documentId !== 'string' || !documentId) return
    const doc = await this.boundDocFor(documentId)
    if (!doc) return
    try {
      await this.api().getDocument(documentId)
    } catch (error) {
      const verdict = lockVerdict(error)
      if (verdict) await this.lockFromServer(documentId, verdict)
    }
  }

  /** the runtime's drop filter: the id belongs to an open, bound copy of this session */
  async isOpenBound(documentId: string): Promise<boolean> {
    if (typeof documentId !== 'string' || !documentId) return false
    const doc = await this.boundDocFor(documentId)
    return doc !== null && this.deps.isPathOpen(doc.path)
  }

  /**
   * Lock a copy the server no longer lets this session use: the binding reads
   * `blocked` with the verdict's reason, the S6 bar says revoked/deleted, and
   * isReadOnly(path) is true from now on (module saves refused). The editor
   * content is never touched: no reload, no delete.
   */
  private async lockFromServer(documentId: string, verdict: 'revoked' | 'deleted'): Promise<void> {
    this.remoteLocked.set(documentId, verdict)
    const doc = await this.boundDocFor(documentId)
    if (!doc) return
    this.remoteBars.set(pathKey(doc.path), { kind: verdict })
    const next: Binding = {
      ...doc.binding,
      state: 'blocked',
      error: verdict === 'revoked' ? 'permission_revoked' : 'document_deleted',
      // G8-12: a locked copy can never be edited again, so its comments level
      // caps at view here exactly as on the inline 403 path - a queue refusal
      // (and the metadata/feed reads) settles through this writer, so the cap
      // in queueBindingPatch never sees it
      level: 'view',
    }
    await this.coordinator.commitState(doc, next)
  }

  /**
   * The server lets this copy be edited again (the path that re-grants the
   * binding): the session's verdict is spent, so the lock map and the bar it
   * put up go with it, and `lockedFor` answers from the binding again - the
   * two sources of truth never disagree. A no-op for a document this session
   * never locked (a newer-version bar is left alone), and only the verdict's
   * own bar is dropped.
   */
  private clearRemoteLock(documentId: string, path: string): void {
    const verdict = this.remoteLocked.get(documentId)
    if (!verdict) return
    this.remoteLocked.delete(documentId)
    const key = pathKey(path)
    if (this.remoteBars.get(key)?.kind !== verdict) return
    this.remoteBars.delete(key)
    this.remoteNotices.delete(key)
  }

  /**
   * One guarded reload per path at a time: a second notice queues behind the
   * one in flight, so two fetches never race the same working copy.
   */
  private runGuardedReload(path: string, notice: RemoteNotice): Promise<void> {
    const key = pathKey(path)
    const previous = this.remoteReloads.get(key) ?? Promise.resolve()
    const run = previous.then(
      () => this.guardedReload(path, notice),
      () => this.guardedReload(path, notice),
    )
    this.remoteReloads.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    )
    return run
  }

  /**
   * The reload race rule: only a clean, idle copy is replaced with the fetched
   * head, and the editor state is read again AFTER the fetch and AFTER the
   * write - an AI turn that starts in between (a moved aiEpoch), or an edit,
   * drops the result (no file write, no reloadPath; a late write is undone).
   * The path never supersedes or drops an intent: it only runs with none.
   */
  private async guardedReload(path: string, notice: RemoteNotice): Promise<void> {
    const doc = this.store.lookup(path)
    if (!doc || !this.ownsLocally(doc) || doc.binding.documentId !== notice.documentId) return
    // the notice was decided on an older read: re-run the rule order before any
    // download, so a copy that turned dirty/AI-busy in between gets its bar
    const before = await this.editorState(doc.path)
    const decision = decideRemote(notice, await this.remoteLocalFor(doc))
    if (decision.kind !== 'reload') {
      await this.applyRemoteDecision(doc, notice, decision)
      return
    }
    let fetched: { detail: DocumentDetail; bytes: Uint8Array }
    try {
      fetched = await this.fetchLatest(notice.documentId)
    } catch (error) {
      const verdict = lockVerdict(error)
      if (verdict) {
        await this.lockFromServer(notice.documentId, verdict)
        return
      }
      await this.showRemoteBar(doc, notice, { kind: 'reload-failed', version: notice.version })
      return
    }
    const after = await this.editorState(doc.path)
    const moved = after.aiEpoch !== before.aiEpoch
    if (after.dirty === true || after.aiRunning || moved) {
      await this.showRemoteBar(doc, notice, {
        kind: after.aiRunning || moved ? 'newer-ai' : 'newer-dirty',
        version: notice.version,
      })
      return
    }
    const fresh = this.store.lookup(doc.path)
    if (!fresh) return
    // a save or the schema 1 -> 2 sweep took the copy while it was fetching:
    // the fetched bytes may not be written over it
    if (this.coordinator.isSaving(fresh.path) || this.heldByMigration(fresh.dir)) {
      await this.showRemoteBar(fresh, notice, { kind: 'newer-dirty', version: notice.version })
      return
    }
    if (compareRevision(fetched.detail.revision, fresh.binding.baseRevision) <= 0) {
      // EXPERIENCE :341: the head is not newer than the open base after all
      console.warn(
        `uniwork docs: a fetched version of ${notice.documentId} is not newer than the open base; dropped`,
      )
      return
    }
    const previousBytes = await readFile(fresh.path)
      .then((bytes) => new Uint8Array(bytes))
      .catch(() => null)
    const previousBinding = fresh.binding
    await this.store.writeWorkingCopy(fresh.dir, fresh.binding.filename, fetched.bytes)
    const reloaded: Binding = {
      ...previousBinding,
      title: fetched.detail.title,
      access: accessFor(fetched.detail.myLevel),
      baseRevision: fetched.detail.revision,
      baseVersion: fetched.detail.file.version,
      baseChecksum: sha256Hex(fetched.bytes),
      state: 'saved',
    }
    // the base moved to the fetched head: the anchor base and the comments
    // level come from the read, so an id or level it does not name is dropped
    delete reloaded.baseVersionId
    const next = withServerContext(reloaded, fetched.detail)
    delete next.error
    delete next.serverRevision
    delete next.serverVersion
    const done = await this.coordinator.commitState(fresh, next)
    const final = await this.editorState(done.path)
    const lateMove = final.aiEpoch !== before.aiEpoch
    if (final.dirty === true || final.aiRunning || lateMove) {
      // a turn (or an edit) started after the write: the previous copy goes back
      // byte for byte, binding included, and the bar says why
      await this.restoreWorkingCopy(done, previousBinding, previousBytes)
      const restored = this.store.lookup(path)
      if (restored) {
        await this.showRemoteBar(restored, notice, {
          kind: final.aiRunning || lateMove ? 'newer-ai' : 'newer-dirty',
          version: notice.version,
        })
      }
      return
    }
    this.remoteBars.set(pathKey(done.path), { kind: 'updated', version: notice.version })
    this.remoteNotices.set(pathKey(done.path), notice)
    this.deps.reloadPath(done.path)
    const shown = this.store.lookup(path)
    if (shown) this.publish(toStatus(shown))
  }

  /** undo the write of a reload the last read refused */
  private async restoreWorkingCopy(
    doc: BoundDocument,
    binding: Binding,
    bytes: Uint8Array | null,
  ): Promise<void> {
    if (bytes) {
      await this.store.writeWorkingCopy(doc.dir, binding.filename, bytes).catch(() => undefined)
    }
    // the coordinator's chain, so the restore cannot interleave with a save's
    // own binding write for the same document
    await this.coordinator.commitState(doc, binding)
  }

  /** the rule order again for a notice whose bar needs a fresh verdict (an AI turn ended) */
  private async rerunRemoteDecision(path: string, notice: RemoteNotice): Promise<void> {
    const doc = this.store.lookup(path)
    if (!doc || !this.ownsLocally(doc) || doc.binding.documentId !== notice.documentId) return
    const decision = decideRemote(notice, await this.remoteLocalFor(doc))
    await this.applyRemoteDecision(doc, notice, decision)
  }

  /**
   * A record moved: a notice held for its document is re-decided on the new
   * record. A receipt that already covers the notice is this app's own commit
   * (dropped, never shown); anything else runs the rule order again, where a
   * still-holding intent holds the notice further.
   */
  private async redecideHeld(documentId: string, record?: IntentRecordV2): Promise<void> {
    const notice = this.remoteHeld.get(documentId)
    if (!notice) return
    if (record?.receipt && compareRevision(record.receipt.revision, notice.revision) >= 0) {
      this.rememberOwnEcho(documentId, record.receipt.revision)
      this.remoteHeld.delete(documentId)
      return
    }
    const doc = await this.boundDocFor(documentId)
    if (!doc || !this.deps.isPathOpen(doc.path)) {
      this.remoteHeld.delete(documentId)
      return
    }
    const decision = decideRemote(notice, await this.remoteLocalFor(doc))
    if (decision.kind === 'hold') return
    this.remoteHeld.delete(documentId)
    await this.applyRemoteDecision(doc, notice, decision)
  }

  /** the binding at `doc.path` now, if it is still that document and still ours */
  private sameLiveDoc(doc: BoundDocument): BoundDocument | null {
    const now = this.store.lookup(doc.path)
    return now && now.binding.documentId === doc.binding.documentId && this.ownsLocally(now)
      ? now
      : null
  }

  /** "Save a copy on this computer": a plain file beside the working copy */
  private async copyAside(doc: BoundDocument): Promise<void> {
    const b = doc.binding
    const titleExt = extname(b.title)
    const stem = (titleExt ? b.title.slice(0, -titleExt.length) : b.title) || 'document'
    const target = await this.deps.ui.pickCopyPath(stem, b.format)
    // a plain local file; the document itself keeps its state. A target inside
    // the working-copy folders would not be one (or is the copy itself)
    if (target) {
      const copied =
        !this.store.isInside(target) &&
        (await copyFile(doc.path, target).then(
          () => true,
          () => false,
        ))
      if (!copied) this.deps.ui.showCopyFailed()
    }
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
      await this.copyAside(chosen)
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

  /**
   * G8-12: the comments context of the bound copy at `path` - everything comes
   * from the binding and the session, nothing from the renderer. null when the
   * path is not a copy of the signed-in account (no request is made for it).
   */
  commentContext(path: string): CommentsContextResult | null {
    const doc = this.store.lookup(path)
    if (!doc || !this.owns(doc)) return null
    const b = doc.binding
    return {
      documentId: b.documentId,
      versionId: b.baseVersionId ?? null,
      ...(b.level ? { level: b.level } : {}),
      myUserId: doc.userId,
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
      // the server's bytes are unknown here: the next Save always uploads.
      // baseVersionId stays: it names the version these bytes were based on (baseVersion is
      // unchanged too), so comments anchored against it remain valid until a Save moves the base
      baseChecksum: '',
      state: 'dirty',
    }
    delete next.error
    delete next.serverRevision
    // "Ghi đè": the old intent is superseded BEFORE a new one is minted, so the
    // user's snapshot is spent (superseded), never replayed against the new base
    await this.supersedePending(doc)
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
    // "Tải lại": the old intent is superseded BEFORE the base is replaced, so
    // it is spent (cancelled/superseded), never replayed against the new base
    await this.supersedePending(doc)
    await this.store.writeWorkingCopy(doc.dir, doc.binding.filename, bytes)
    // the local work (and its intent) is discarded: nothing is left to replay
    await this.dropIntent(doc)
    const fresh: Binding = {
      ...doc.binding,
      title: detail.title,
      access: accessFor(detail.myLevel),
      baseRevision: detail.revision,
      baseVersion: detail.file.version,
      baseChecksum: sha256Hex(bytes),
      // the old intent is superseded below; the copy reads saved
      state: 'saved',
    }
    // the base moved: the old version id must not survive an unknown new one
    delete fresh.baseVersionId
    const next = withServerContext(fresh, detail)
    delete next.error
    delete next.serverRevision
    delete next.serverVersion
    const done = await this.coordinator.commitState(doc, next)
    // the bar belonged to the replaced base: the copy is at the head now
    this.remoteBars.delete(pathKey(doc.path))
    this.remoteNotices.delete(pathKey(doc.path))
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
          const binding: Binding = withServerContext(
            { ...existing, title: detail.title, access },
            detail,
            viewTicket || viewRequested,
          )
          // G5-06 W4b: the queue's refusal code is `permission_revoked` (the old
          // `forbidden`); a re-granted edit level clears the copy for saving
          if (
            existing.state === 'blocked' &&
            (existing.error === 'permission_revoked' || existing.error === 'forbidden') &&
            access === 'edit'
          ) {
            binding.state = 'dirty'
            delete binding.error
            // the re-grant spends the session's lock verdict (G5-03a)
            this.clearRemoteLock(documentId, local)
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
            (existing.error === 'not_found' ||
              existing.error === 'deleted' ||
              existing.error === 'document_deleted')
          ) {
            binding.state = localChecksum === existing.baseChecksum ? 'ready' : 'dirty'
            delete binding.error
            // the document answers again: the deleted verdict it earned is spent
            this.clearRemoteLock(documentId, local)
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
    const binding: Binding = withServerContext(
      {
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
      },
      base,
      viewTicket || viewRequested,
    )
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
