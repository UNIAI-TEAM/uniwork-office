import { existsSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs'
import {
  lstat,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  RecentUniworkSource,
  SignOutPlan,
  SignOutProgress,
  UniworkConflictChoice,
  UniworkCreateDocInput,
  UniworkCreatePageInput,
  UniworkCreateFolderInput,
  UniworkDocAccess,
  UniworkDocActionError,
  UniworkDocActionResult,
  UniworkDocErrorCode,
  UniworkDocFormat,
  UniworkDocListPage,
  UniworkDocListQuery,
  UniworkDocLock,
  UniworkDocProperties,
  UniworkDocRenamedEvent,
  UniworkDocSummary,
  UniworkDocStatus,
  UniworkDocEditLock,
  UniworkEditLockSessionView,
  UniworkFirstSaveInput,
  UniworkFirstSaveNameRequest,
  UniworkFolderChildren,
  UniworkFolderNode,
  UniworkFolderQuery,
  UniworkLaunchEvent,
  UniworkListFilters,
  UniworkLockReason,
  UniworkMoveDocumentInput,
  UniworkMoveResult,
  UniworkQueuePopoverRequest,
  UniworkRemoteAction,
  UniworkRemoteBar,
  UniworkResult,
  UniworkSourceDownloadInput,
  UniworkSourceListPage,
  UniworkSourceListQuery,
  UniworkSearchPage,
  UniworkSearchQuery,
  UniworkSharedPage,
  UniworkSharedQuery,
  UniworkShelvedQuery,
  UniworkTreeChangedEvent,
  UniworkUploadDocInput,
  UniworkUploadProgress,
  UniworkWorkspaceRef,
} from '../../shared/home-api'
import type {
  UniworkArchiveImpact,
  UniworkDocFavoriteResult,
  UniworkDocShelveResult,
} from '../../shared/home-api'
import type {
  UniworkConflictAction,
  UniworkConflictIntentBlock,
  UniworkConflictKeepDraft,
  UniworkConflictNotice,
  UniworkConflictReply,
  UniworkConflictView,
} from '../../shared/uniwork-conflict'
import {
  callbackSchemeForChannel,
  type DeploymentChannel,
  type DeploymentProfile,
} from '../uniwork-auth/deployment'
import type { ProfileOutcome } from '../uniwork-auth/profile-store'
import {
  BINDING_FILE,
  type Binding,
  BindingStore,
  type BoundDocument,
  bindingKindOf,
  docLevelOf,
  documentNameIn,
  hasLegacyIntentFiles,
  type LastOwner,
  type NewerStore,
  type PathBinding,
  parseBinding,
  scopeWorkingCopyDirs,
} from './binding-store'
import {
  type FetchLike,
  type UniworkCreateTarget,
  type UniworkDocsClient,
  createUniworkDocsClient,
  isListSort,
  uniworkId,
  uniworkSourceId,
} from './client'
import { zipErrorOf } from './zip-download/runner'
import type { FileDownloadResult } from '../../shared/zip-download-api'
import {
  createUniworkEditLockClient,
  type UniworkEditLockClient,
} from '../uniwork-edit-lock/client'
import {
  EditLockSession,
  asEditLockTransport,
  newEditorId,
  type EditLockSessionView,
} from '../uniwork-edit-lock/session'
import { UniworkDocError } from './errors'
import { EDIT_LOCK_QUIT_CAP_MS } from './edit-lock-quit'
import {
  copyTitleFor,
  formatForMime,
  formatForName,
  hasReplacementChar,
  legacyOfFile,
  sanitizeFilename,
  sha256Hex,
  workingCopyName,
} from './formats'
import {
  conversionFor,
  convertedTitle,
  legacyTargetFormat,
  type LegacyConversion,
  type LegacyFrom,
} from './legacy-cloud'
import {
  isCfbBytes,
  legacyOfCfbBytes,
  type CloudConvertOutcome,
  type CloudLegacyConvertInput,
} from './legacy-cloud-open'
import { detectOoxmlKindFromZipBytes } from '../legacy-converter'
import { pathKey } from '../../shared/path-key'
import { isBlankDefaultTitle } from '../../shared/blank-default-names'
import { LaunchController } from './launch'
import { createDocumentLimitsCache, type DocumentLimits, type DocumentLimitsCache } from './limits'
import { createAvatarCache, type AvatarCache } from './avatar'
import { DRAFT_PREVIEW_DIR } from '@genoffice/electron-utils/draft-preview'
import type { OpenSourceValue, SourceViewResult, SourceViewState } from '../../shared/source-view'
import { SourceViewRegistry, createSourceViewOpener, type SourceViewOpener } from './source-view'
import { tUniworkDocs } from './strings'
import { normalizeTypePicks } from './type-picks'
import {
  abortUploadSession,
  readLocalFileProbe,
  runChunkedUpload,
  sha256File,
  shouldUseChunkedUpload,
  type ChunkedUploadResult,
  type SavedUploadSession,
  type UploadSessionTarget,
} from './upload-session'
import {
  createFirstSaveStore,
  firstSaveKey,
  FIRST_SAVES_STORE_REGISTRATION,
  type FirstSaveStore,
} from '../uniwork-sync/first-saves'
import {
  createUploadSessionStore,
  uploadSessionKey,
  UPLOAD_SESSIONS_STORE_REGISTRATION,
  type UploadSessionRecord,
  type UploadSessionStore,
} from '../uniwork-sync/upload-sessions'
import type { CommentsContextResult } from '@genoffice/electron-utils/comments-ipc'
import { actionFlags, type DocumentDetail, type DocumentRef, type LaunchDescriptor } from './parse'
import {
  QUEUE_LIMITS,
  SaveCoordinator,
  toStatus,
  type IntentAccess,
  queueChipState,
  type SaveQueueEngine,
} from './save-coordinator'
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
import {
  isTerminalQueueState,
  type IntentRecordV2,
  type QueueState,
} from '../uniwork-sync/queue/record'
import { compareRevision } from '../uniwork-sync/feed/revision'
import type { FeedChange } from '../uniwork-sync/feed/client'
import { decideRemote, type RemoteLocal, type RemoteNotice } from './remote-newer'
import type { StoreRecords } from '../uniwork-sync/store'
import { offlineCopyKey } from '../uniwork-sync/offline-library/copies'

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

/**
 * S01-R2-4: one first-save attempt's Idempotency-Key and its durable record
 * (`store` is null when the account has no store to keep it in). `restored`:
 * the key came from the record of an earlier run, not from this process.
 */
interface FirstSaveAttempt {
  store: FirstSaveStore | null
  recordKey: string
  idempotencyKey: string
  fingerprint: string
  restored: boolean
}

export interface SessionIdentity {
  accountId: string
  deviceSessionId: string
  deploymentId: string
}

/** the close prompt and legacy conflict seams */
export interface ConflictUi {
  /** `signal` closes the dialog as "Decide later" (legacy native conflict dialog; unused by S5) */
  chooseConflict?(title: string, signal?: AbortSignal): Promise<UniworkConflictChoice>
  /** `signal` closes the dialog as Cancel (legacy native discard dialog; unused by S5) */
  confirmDiscard?(title: string, signal?: AbortSignal): Promise<boolean>
  /** Save As for "Save a copy on this computer" (legacy; unused by S5) */
  pickCopyPath?(stem: string, format: UniworkDocFormat): Promise<string | null>
  showOpenLatestFailed?(): void
  /** the "Save a copy on this computer" file could not be written (legacy; unused by S5) */
  showCopyFailed?(): void
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
/**
 * G5-05u (B5): what the offline library did with a document whose server open
 * failed. `opened` = the read-only cached copy is on screen; `locked` = it
 * refused and the shell shows the S11 panel named by `reason`; null = nothing is
 * pinned.
 */
export type OfflineCopyOpen =
  | { kind: 'opened'; path: string; title: string }
  | {
      kind: 'locked'
      path: string
      name: string
      reason: UniworkLockReason
      libraryOff?: boolean
    }
  | null

export interface SignOutLockResult {
  ok: boolean
  captureFailed: string[]
  /**
   * G5-11 d5-1, account switch only: the document keys whose N+1 could not be
   * parked by any candidate (store full). Their plaintext is deleted anyway,
   * so the bytes are lost and the switch notice counts them. Absent when none.
   */
  lost?: string[]
}

export interface UniworkDocsServiceDeps {
  userDataDir: string
  /**
   * The session's durable sync store (wiring): intents, feed cursors and the
   * doc index live here. Absent = no store-backed saves (tests that never
   * touch one).
   */
  syncStore?: SyncStoreAccess
  /** G5-09 S5: non-mutating account store usage for the drafts budget probe */
  storeUsage?(): Promise<{ bytes: number; budgetBytes: number } | null>
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
  /** UNI-2275 R1-1: the fetch used for presigned avatar URLs (wiring passes Electron's `net.fetch`); defaults to `fetch` */
  avatarFetch?: FetchLike
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
  /**
   * The shell itself rewrote the file at `path` behind its module: a module
   * that refuses to write over another program's change (docs) forgets what
   * it recorded, so the next Save writes. Absent / a no-op for the others.
   */
  noteShellRewrote?(path: string): void
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
   * FD-11: something in this workspace's document tree changed - one of this
   * app's own folder actions (new, upload, create-folder, rename, move, copy),
   * which the feed would otherwise only notice on its next page. Main
   * coalesces the notices and pushes one per workspace per window; the event
   * carries the workspace id only.
   */
  pushTreeChanged?(event: UniworkTreeChangedEvent): void
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
  /** G5-06u: ask the shell renderer to open the queue popover of a path */
  pushQueuePopover?(request: UniworkQueuePopoverRequest): void
  /**
   * UNI-1959: ask the shell renderer for the "Name the document" dialog on the
   * first save of a blank-created document and wait for its verdict:
   * `continue` (named / moved / unchanged: the save goes on), `cancel` (no
   * save) or `unavailable` (no dialog host was ever up: the save goes on, but
   * nothing was confirmed). Absent = the save never asks (a build without the
   * dialog host).
   */
  requestFirstSaveName?(
    request: UniworkFirstSaveNameRequest,
  ): Promise<'continue' | 'cancel' | 'unavailable'>
  /** UNI-1959: takes a pending ask back (its tab closed, its session ended): cancel + drop its dialog */
  dismissFirstSaveName?(requestId: string): void
  /**
   * EL-1(b) fix6 (VEL-2): broadcast `{ path }` on `uniwork:doc-state-changed`
   * when `isReadOnly(path)` or `isBound(path)` may have changed.
   */
  pushDocStateChanged?(path: string): void
  /**
   * G5-06u: whether `path` is a tab of the shell window (the only window with
   * a pill and a queue popover). False for a detached editor window, whose
   * Ctrl/Cmd+S keeps the inline replay. Absent = every path is a shell tab.
   */
  isShellTab?(path: string): boolean
  pushLaunch(event: UniworkLaunchEvent): void
  /** G5-11: sign-out progress push (`waiting` | `done`) */
  pushSignOutProgress?(event: SignOutProgress): void
  /** G5-11: optional hooks so lockSession can run step 1 runtime stop and step 3 view/history cleanup directly */
  stopRuntime?(): void
  openPaths?(): string[]
  closePathNow?(path: string): void
  /**
   * UNI-1993: the sync center's startup sweep of the draft-preview root (one
   * promise, shared). A source file is written only after it settled; absent =
   * nothing to wait for.
   */
  sourceViewStartupSweep?: Promise<unknown>
  aiHistoryPaths?(): string[]
  forgetAiHistory?(paths: string[]): void
  /** G5-09 S5: pushes the current conflict dialog view to the shell renderer */
  pushConflict?(view: UniworkConflictView): void
  /** G5-09 S5: main ended the open conflict dialog session itself */
  pushConflictClosed?(sessionId: string): void
  /** G5-09 S5: whether an AI turn is running in the editor showing `path` */
  isAiRunning?(path: string): boolean
  /** G5-09 S5: stops the AI turn running in the editor showing `path` */
  stopAiRun?(path: string): void
  /** G5-12: the app's UI language, for the title of a saved copy (absent = en) */
  lang?(): string
  /**
   * G5-12: the native save dialog of "Download my version" (Electron-free seam),
   * suggesting `defaultName`. Null when the person cancelled.
   */
  pickDownloadPath?(defaultName: string): Promise<string | null>
  /** G5-09 S5: seam for G5-05 offline head availability (default false until G5-05 lands) */
  hasOfflineHead?(documentId: string, revision?: string): boolean
  /**
   * G5-05u (B5): the verified cached copy of a pinned document, for an open
   * whose server read failed (no network). `opened` = the read-only copy is on
   * screen; `locked` = the library refused and the S11 panel names `reason`;
   * null = nothing is pinned (the open fails as it did before).
   */
  openOfflineCopy?(documentId: string): Promise<OfflineCopyOpen>
  /**
   * UNI-2212: the app's legacy converter (progress box, Cancel, typed notices), for a cloud
   * .doc / .xls / .ppt whose bytes were just downloaded. Absent = such a document cannot be
   * opened (`unsupported_format`), exactly as before the converter existed.
   */
  convertLegacy?(input: CloudLegacyConvertInput): Promise<CloudConvertOutcome>
  /**
   * The org capability cache (the same one the sync runtime reads), for the
   * save queue's lane verdicts. Absent = writes allowed (tests that never read
   * a capability); the production wiring passes the runtime's cache.
   */
  capability?: { get(orgId: string, options?: { force?: boolean }): Promise<QueueCapabilityRead> }
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
  /** EL-1(b): test seam for the edit-lock client (absent = no acquire in injected-client tests) */
  editLockClient?: UniworkEditLockClient
  /** SIZE-F1: overrides `documents.limits` (`GET /api/v1/config`); a test seam */
  limits?: () => Promise<DocumentLimits> | DocumentLimits
  sleep?(ms: number): Promise<void>
  now?(): number
  /**
   * SAVE-01 r2 (S01-R1-1): how long a first save waits for the editor's own
   * Save before failing the attempt (never reading stale disk bytes). Tests
   * shrink it; production leaves the shared CLOSE_SAVE_WAIT_MS default.
   */
  firstSaveFlushTimeoutMs?: number
  /**
   * How long "Save to UniWork" from the close prompt waits for the upload to
   * settle (UNI-1959 test seam; production leaves CLOSE_SAVE_WAIT_MS).
   */
  closeSaveWaitMs?: number
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
  'failed',
  'edit_locked',
])

/** states whose local bytes are not in UniWork (the close prompt) */
const UNSENT_STATES: ReadonlySet<string> = new Set([
  'dirty',
  'offline',
  'signed-out',
  'error',
  'blocked',
  'conflict',
  'failed',
  'edit_locked',
])

/**
 * How long a close waits for a Save to UniWork to settle before the tab stays
 * open. A module that reports "did not write" ends the wait at once; this cap
 * covers the modules that cannot tell (docs, sheets, slides) and a save that
 * never reaches the user-save hook.
 */
export const CLOSE_SAVE_WAIT_MS = 30_000

/** UNI-1959: one first-save naming operation (see `firstSaveOps`) */
interface FirstSaveOp {
  /** the session that started it: its identity and epoch are revalidated before every step */
  session: { identity: SessionIdentity; epoch: number }
  documentId: string
  /** the id of the ask pushed to the renderer, once there is one (dismissed with it) */
  requestId: string | null
  cancelled: boolean
}

/** back-off before a failed last-account.json write is retried */
const LAST_OWNER_RETRY_MS = 2000

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

/**
 * UNI-2047: the merge order of "Shared with me". Every workspace answers in the
 * server's own order, so the aggregate re-sorts by the requested key. Each key
 * has its own default direction (the web's); a row without the key sorts last
 * in either direction. Nothing requested = newest first, as before.
 */
function sharedComparator(
  sort: UniworkListFilters['sort'],
  order: UniworkListFilters['order'],
): (a: UniworkDocSummary, b: UniworkDocSummary) => number {
  const key = sort ?? 'updated'
  const sortKey = (row: UniworkDocSummary): string | number | undefined => {
    switch (key) {
      case 'name':
        return row.title
      case 'size':
        return row.sizeBytes
      case 'editor':
        return row.updatedByUser?.name ?? row.updatedByName
      case 'shared':
        return row.shared?.at
      case 'activity':
        return row.lastActivity?.at
      case 'starred':
        return row.favoritedAt
      case 'deleted':
        return row.archivedAt
      case 'shelved':
        return row.shelvedAt
      default:
        return row.updatedAt
    }
  }
  const ascending = (order ?? (key === 'name' || key === 'editor' ? 'asc' : 'desc')) === 'asc'
  return (a, b) => {
    const left = sortKey(a)
    const right = sortKey(b)
    if (left !== right) {
      if (left === undefined) return 1
      if (right === undefined) return -1
      const cmp =
        key === 'name' || key === 'editor'
          ? String(left).localeCompare(String(right))
          : left < right
            ? -1
            : 1
      return ascending ? cmp : -cmp
    }
    // a stable tie-break: newest first
    return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0
  }
}

/** UNI-1961: a source file's suggested save name: its last segment, never a path */
function sourceFileName(name: unknown): string {
  const last = typeof name === 'string' ? (name.split(/[\\/]/).pop() ?? '') : ''
  // eslint-disable-next-line no-control-regex -- a file name never carries control characters
  const clean = last.replace(/[<>:"|?*\u0000-\u001f]/g, '').trim()
  if (!clean || clean === '.' || clean === '..') return 'download'
  if (clean.length <= 200) return clean
  const rawExt = extname(clean)
  const ext = rawExt.length > 1 && rawExt.length <= 32 ? rawExt : ''
  return `${clean.slice(0, 200 - ext.length)}${ext}`
}

async function resolvePhysicalPath(targetPath: string): Promise<string> {
  let current = resolve(targetPath)
  const tail: string[] = []
  for (;;) {
    try {
      const real = await realpath(current)
      return tail.length > 0 ? join(real, ...tail.reverse()) : real
    } catch {
      const parent = dirname(current)
      if (parent === current) return resolve(targetPath)
      tail.push(basename(current))
      current = parent
    }
  }
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
 * FD-11: the longest FOLDER name D accepts. Folders are the only entries whose
 * names must be unique among their siblings, and D caps them tighter than a
 * document (255 runes).
 */
const MAX_FOLDER_NAME_RUNES = 255

/**
 * The interim single-request staging cap: D stages at most 50 MiB per upload
 * part (`files/registry.go`), so one multipart POST cannot carry more. Since
 * BIGUP-A1 this is the cap of the SINGLE-REQUEST path only: a file above the
 * server's `chunked_upload_threshold_bytes` goes through an upload session
 * instead and is bounded by `limits.max_bytes` alone. A deployment with no
 * threshold (a `local` backend that cannot presign parts) keeps the old rule -
 * refuse above 50 MiB before reading - and names `min(max_bytes, 50 MiB)`.
 */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

/**
 * SIZE-F1 / SAVE-01 merge M-2 (D-S1) / BIGUP-A1: the ONE size preflight upload
 * and first save share. The server's `max_bytes` comes first and is named as
 * itself; then the single-request staging cap, which applies only to a file the
 * chunked path will not take (no threshold, or one above this size) and whose
 * refusal names `min(max_bytes, 50 MiB)` so the copy stays truthful.
 * `filename` is the basename sent as the upload `file` part; `size` is the
 * payload's byte length at this call's point - the stat's size before the read,
 * the buffer's after it. Both callers run it on both, so a file that grew
 * between the two is refused too. The refusal carries
 * filename/sizeBytes/maxBytes to the renderer unchanged.
 */
function assertUploadSize(filename: string, size: number, limits: DocumentLimits): void {
  if (size > limits.max_bytes) {
    throw new UniworkDocError('too_large', {
      filename,
      sizeBytes: size,
      maxBytes: limits.max_bytes,
    })
  }
  if (size > MAX_UPLOAD_BYTES && !shouldUseChunkedUpload(size, limits)) {
    throw new UniworkDocError('too_large', {
      filename,
      sizeBytes: size,
      maxBytes: Math.min(limits.max_bytes, MAX_UPLOAD_BYTES),
    })
  }
}

/**
 * SAVE-01 r4 (S01-R4-3): the ONE re-wrap both POST paths answer a server
 * `too_large` with. D can refuse the bytes after the local preflight passed (a
 * stale limits cache, or a cap lowered between the read and the POST);
 * `errorFromResponse` fills `sizeBytes`/`maxBytes` from the envelope's fields
 * but never the filename, so the caller supplies its own basename and its own
 * payload length - the bytes it handed the client - as the fallbacks. Upload
 * and first save therefore answer the renderer the identical shape.
 */
function rethrowServerTooLarge(
  error: UniworkDocError,
  filename: string,
  sizeBytes: number,
  limits: DocumentLimits,
): never {
  throw new UniworkDocError('too_large', {
    status: error.status,
    serverCode: error.serverCode,
    filename,
    sizeBytes: error.sizeBytes ?? sizeBytes,
    maxBytes: error.maxBytes ?? limits.max_bytes,
  })
}

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
 * BIGUP-A1: one part of a large file, read straight off the disk. A chunked
 * upload never buffers the whole file: `runChunkedUpload` asks for
 * `[offset, offset+length)` and the handle is opened and closed for that read,
 * so peak memory is the parts in flight (4 x 8 MiB) whatever the file's size.
 * A short read means the file changed under us - refused as `malformed_response`
 * rather than uploaded as a part of the wrong length.
 */
async function readFileRange(
  path: string,
  offset: number,
  length: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (signal?.aborted) throw cancelledUpload()
  const handle = await open(path, 'r')
  try {
    const buffer = new Uint8Array(length)
    let done = 0
    while (done < length) {
      if (signal?.aborted) throw cancelledUpload()
      const step = await handle.read(buffer, done, length - done, offset + done)
      if (step.bytesRead <= 0) break
      done += step.bytesRead
    }
    if (done !== length) {
      throw new UniworkDocError('malformed_response', { serverCode: 'upload_size_mismatch' })
    }
    return buffer
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/**
 * a trimmed, NFC-normalized name of 1..`max` runes (the server trims and
 * normalizes the same way, so the string the field shows is the one the server
 * stored). `max` defaults to the widest document cap; FD-11 passes the folder
 * cap for a folder. The empty and the too-long cases are field errors, not
 * requests. A duplicate name is allowed for documents (FD-D10 a), so there is
 * no uniqueness check here; only a folder collides, and the server says so.
 */
function requireName(raw: string, max = MAX_DOC_NAME_RUNES): string {
  const name = typeof raw === 'string' ? raw.trim().normalize('NFC') : ''
  if (!name) throw new UniworkDocError('name_empty' as UniworkDocErrorCode)
  if (Array.from(name).length > max) {
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
  options: {
    nameField?: boolean
    flagMissingEndpoint?: boolean
    /** the flag needs an envelope-less answer (a router/gateway 404/501, no server `code`) */
    uncodedOnly?: boolean
  } = {},
): Promise<UniworkDocActionResult<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    const code = actionErrorOf(error, options.nameField === true)
    if (error instanceof UniworkDocError && code === 'too_large') {
      return {
        ok: false,
        error: code,
        ...(error.filename !== undefined ? { name: error.filename } : {}),
        ...(error.sizeBytes !== undefined ? { sizeBytes: error.sizeBytes } : {}),
        ...(error.maxBytes !== undefined ? { maxBytes: error.maxBytes } : {}),
      }
    }
    // FD-11: a `document_too_deep` refusal names the server's own depth cap, so
    // the renderer can show it instead of a hardcoded number
    const max = error instanceof UniworkDocError ? error.maxDepth : undefined
    // SAVE-01 r2 (S01-R1-2): a first save that created then failed to bind
    // names the server document it left (compensated or not)
    const documentId = error instanceof UniworkDocError ? error.documentId : undefined
    const documentTitle = error instanceof UniworkDocError ? error.documentTitle : undefined
    // UNI-1959: the server has no route for this create (the web's isEndpointMissing)
    const endpointMissing =
      options.flagMissingEndpoint === true &&
      error instanceof UniworkDocError &&
      (error.status === 404 || error.status === 501) &&
      !(options.uncodedOnly === true && error.serverCode)
    // UNI-2047: a throttle (429 / 503) is the one failure a batch may repeat once
    const retryable =
      error instanceof UniworkDocError && (error.status === 429 || error.status === 503)
    return {
      ok: false,
      error: code,
      ...(retryable ? { retryable: true } : {}),
      ...(max === undefined ? {} : { max }),
      ...(documentId === undefined ? {} : { documentId }),
      ...(documentTitle === undefined ? {} : { documentTitle }),
      ...(endpointMissing ? { endpointMissing: true } : {}),
    }
  }
}

function actionErrorOf(error: unknown, nameField: boolean): UniworkDocActionError {
  if (error instanceof UniworkDocError) {
    // the name errors and a cancelled upload are carried on the error's `code`
    // even though they are not part of UniworkDocErrorCode; the cast is the one
    // place that bridges them
    const code = error.code as string
    if (
      code === 'name_empty' ||
      code === 'name_too_long' ||
      code === 'upload_cancelled' ||
      // SAVE-01 r2: the first-save boundary's own verdicts are carried on the
      // error's `code` like the name errors (never part of UniworkDocErrorCode,
      // which the renderer switches exhaustively)
      code === 'first_save_flush_failed' ||
      code === 'first_save_bind_failed' ||
      code === 'first_save_orphaned'
    ) {
      return code
    }
    // MYFOLDER-01 / SAVE-01: the two folder server-codes are matched on `code`
    // BEFORE any error_class-based switch - a 409 `my_folder_locked` carries
    // error_class "conflict" and a class-first read would send the action down
    // the revision-conflict path (re-read/retry/"conflict" state), which it is
    // not. `invalid_destination` (400) is a destination field error.
    if (error.serverCode === 'my_folder_locked') return 'my_folder_locked'
    if (error.serverCode === 'invalid_destination') return 'invalid_destination'
    // B-R1-03 / B-R1-09: `folder_name_taken` stays off UniworkDocErrorCode;
    // create/rename (`nameField: true`) report `folder_name_taken` for the name
    // field, while a move exhausting "(n)" names reports `move_name_taken`
    if (error.serverCode === 'folder_name_taken') {
      return nameField ? 'folder_name_taken' : 'move_name_taken'
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
 * SAVE-01 r2 (S01-R1-5): the IPC target of a first save as the exact runtime
 * union - `{ kind: 'my_folder' }` or `{ kind: 'folder', folderId: <a non-empty,
 * non-blank string> }`. Anything else (missing target, an unknown kind, an
 * empty or blank folderId, a non-object) is refused `invalid_destination`
 * BEFORE any flush, read or request: a malformed target must never fall
 * through to a silent My Folder create, and an empty parent_id must never
 * land the document at the workspace root.
 */
function firstSaveTargetOf(target: unknown): UniworkCreateTarget {
  if (target && typeof target === 'object' && 'kind' in target) {
    const kind = target.kind
    if (kind === 'my_folder') return { destination: 'my_folder' }
    if (kind === 'folder' && 'folderId' in target) {
      const folderId = target.folderId
      if (typeof folderId === 'string' && folderId.trim()) {
        return { parentId: folderId.trim() }
      }
    }
  }
  throw new UniworkDocError('invalid_destination' as UniworkDocErrorCode)
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

/** the first wait before a blocked intent's document is re-probed; doubles to recheckMs */
const BLOCKED_PROBE_BASE_MS = 60_000

/**
 * The blocked reasons only the document itself can prove: a metadata read is
 * what answers whether writing is allowed again - and, for a document in the
 * trash or the archive, whether it is out of there too. The capability reasons
 * are proved by the intent's own org lane instead, never by a document read.
 */
function isDocumentProbeReason(
  reason: UniworkDocErrorCode | undefined,
): reason is 'permission_revoked' | 'document_deleted' | 'document_archived' {
  return (
    reason === 'permission_revoked' ||
    reason === 'document_deleted' ||
    reason === 'document_archived'
  )
}

/**
 * S01-R2-4 fix2: the binding errors that mean the account no longer holds the
 * document (archived, deleted, access lost): a first-save record of such a
 * document is stale. The same words the blocked-document paths already use.
 */
const FIRST_SAVE_ENDED_ERRORS: ReadonlySet<string> = new Set([
  'document_archived',
  'document_deleted',
  'deleted',
  'not_found',
  'permission_revoked',
  'forbidden',
])

function errorCodeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

/** a path that is not there (a missing file, or a file where a folder should be) - not an I/O failure */
function isAbsentPath(error: unknown): boolean {
  const code = errorCodeOf(error)
  return code === 'ENOENT' || code === 'ENOTDIR'
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
  const shelved = Boolean(detail.shelvedAt)
  const level = docLevelOf(detail.myLevel)
  // a read-only copy (a view ticket, or a launch that asked to view) never shows a level above view;
  // a shelved document keeps its real ACL in `level` while `shelved: true` and `access: 'view'`
  // enforce read-only in main-process policy (R1-7)
  if (level) next.level = readOnly ? 'view' : level
  else delete next.level
  if (shelved) {
    next.shelved = true
    next.access = 'view'
  } else {
    delete next.shelved
  }
  if (detail.file.versionId && next.baseVersion === detail.file.version) {
    next.baseVersionId = detail.file.versionId
  }
  // UNI-2212: a copy of a head that is still a legacy .doc/.xls/.ppt is its OOXML conversion and
  // owes the server that conversion with its next commit; a read-only copy (a version view or a
  // view launch) never saves, and a head that moved on to OOXML owes nothing
  const legacy = readOnly ? null : legacyOfFile(detail.file, detail.title)
  if (readOnly) delete next.legacyFrom
  // a read older than the binding's base (a held reply that a save outran) says nothing about
  // what the head owes now: it must not bring back a conversion the save already settled
  else if (detail.file.version >= next.baseVersion) {
    if (legacy && legacyTargetFormat(legacy) === next.format) next.legacyFrom = legacy
    else delete next.legacyFrom
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
 *
 * `current` is the binding as it is right now: a parked `edit_locked` record
 * carries no holder metadata of its own (IntentRecordV2 has no editLock), so the
 * mapping keeps the one the binding already has (EL1A-BE-2). Exported for its
 * unit test.
 */
export function queueBindingPatch(
  record: IntentRecordV2,
  current?: Binding,
): Partial<Binding> | null {
  const state = queueChipState(record.state)
  if (!state) return null
  const error = record.lastError
  const patched: Partial<Binding> = { state }
  if (state === 'paused_admin') patched.error = 'capability_off'
  else if (state === 'paused_offline') patched.error = 'network'
  else if (state === 'blocked') patched.error = error ?? 'server_error'
  else if (state === 'reconciling-stuck') patched.error = error ?? 'intent_unknown'
  else if (state === 'failed') {
    if (error === 'edit_locked') {
      patched.state = 'edit_locked'
      patched.error = 'edit_locked'
      // EL1A-BE-2: a queue rewrite of a parked edit_locked intent keeps the holder metadata the
      // binding already carries; dropping it would make the chip fall back to the null holder
      // and lose the name it names in AC-1
      if (current?.editLock) patched.editLock = current.editLock
    } else {
      patched.error = error ?? 'server_error'
      if (record.maxBytes !== undefined) {
        patched.maxBytes = record.maxBytes
        patched.sizeBytes = record.length
      }
    }
  }
  // the waiting states carry no refusal: a block that lifted (the `unblock`
  // event: `blocked -> queued`, or `paused_user` while the user's own pause
  // holds it) must not keep the code it was parked with. The explicit
  // `undefined` overwrites the stale code in the merge; the store's JSON drops it
  else if (state === 'queued' || state === 'paused_user') {
    patched.error = undefined
    patched.editLock = undefined
    patched.maxBytes = undefined
    patched.sizeBytes = undefined
  }
  // G8-12: a refused permission is a fact about the caller's level, as on the inline path
  if (patched.error === 'permission_revoked' || patched.error === 'forbidden') {
    patched.level = 'view'
  }
  return patched
}

interface ConflictSession {
  sessionId: string
  draftId: string
  path: string
  doc: BoundDocument
  /**
   * G5-11 d5-2: the account whose copy this dialog is about, fixed when it
   * opens. Its drafts are probed in and kept into that account's store only,
   * never whichever account is live by the time an await returns.
   */
  owner: LastOwner
  controller: AbortController
  fromClose: boolean
  onNotWritten?: () => void
  remoteNotice?: RemoteNotice
  knownServerRevision: string | null
  knownServerVersion: number | null
  knownServerSavedAt: string | null
  knownServerBy: string | null
  /**
   * FD-11: the workspace and folder the source document sits in, as the view's
   * own server read answered them; absent while no read has answered. Carried
   * to the conflict view so the Save-as-a-copy Location starts there.
   */
  knownServerWorkspaceId?: string
  knownServerParentId?: string | null
  knownCanEdit: boolean | null
  serverOnline: boolean
  locked?: 'revoked' | 'deleted'
  draftBlock?: UniworkConflictKeepDraft
  /**
   * G5-12: the notice that put the dialog on the "Download my version" step 2
   * (no_seat, folder_refused, or download_failed after a failed write); a cancelled
   * OS dialog answers with it again so the alert does not change
   */
  downloadNotice?: DownloadStepNotice
  opened: boolean
  done: Promise<UniworkDocStatus | null>
  finish: () => void
}

/** BE-12F-01: the one wait before the copy's commit lookup is asked again */
const COPY_LOOKUP_WAIT_MS = 1500

/** the notices that make step 2 of Save as a copy the "Download my version" step */
type DownloadStepNotice = 'save_copy_no_seat' | 'save_copy_folder_refused' | 'download_failed'

/** UNI-2078: the shape of a dialog-open Idempotency-Key main accepts from the renderer */
const COPY_KEY_SHAPE = /^[A-Za-z0-9._:-]{8,128}$/

/** BE-12-201: the server's refusal of a copy for a caller with no seat in the source's workspace */
const COPY_NO_SEAT_CODE = 'workspace_seat_required'

/** BE-12-304: the server's plain refusal of a copy by the parent folder gate */
const COPY_FOLDER_REFUSED_CODE = 'forbidden'

export class UniworkDocsService {
  readonly store: BindingStore
  readonly coordinator: SaveCoordinator
  readonly launch: LaunchController
  readonly limitsCache: DocumentLimitsCache
  readonly avatarCache: AvatarCache
  /** UNI-1993: the view-only source files (not documents); index.ts merges it into the module seams */
  readonly sourceViews = new SourceViewRegistry()
  private readonly sourceViewOpener: SourceViewOpener
  private readonly deps: UniworkDocsServiceDeps
  /** the build's own version, stamped into bindings (see binding-store's minAppVersion) */
  private readonly appVersion: () => string
  private client: UniworkDocsClient | null
  private clientOrigin: string | null = null
  private editLockHttp: UniworkEditLockClient | null = null
  private editLockOrigin: string | null = null
  /** pathKey -> live edit-lock session of this window */
  private readonly editLocks = new Map<string, EditLockSession>()
  /**
   * EL1B-BE-R2-1: fire-and-forget drop DELETEs (window closed / removeTab /
   * detached teardown) still in flight. will-quit joins these under the same
   * cap as held sessions. Settled promises leave the set.
   */
  private readonly inFlightDropReleases = new Set<Promise<unknown>>()
  /** pathKey -> editor_id for this process + path */
  private readonly editorIds = new Map<string, string>()
  private lastOwner: LastOwner | null
  /** the owner last-account.json holds: a failed write leaves it behind `lastOwner` and is retried */
  private lastOwnerOnDisk: LastOwner | null
  private lastOwnerRetryAt = 0
  private readonly statusListeners = new Set<(status: UniworkDocStatus) => void>()
  /** path key -> the newer-store lock currently shown for it (S11) */
  private readonly locks = new Map<string, UniworkDocLock>()
  /** pathKey -> last published access/lock signature so access flips broadcast once */
  private readonly lastPublishedAccess: Record<string, string> = Object.create(null)
  /** path -> checksum of the file as of its mtime/size (the sync close check) */
  private readonly hashMemo = new Map<string, { mtimeMs: number; size: number; checksum: string }>()
  /** working copies whose editor holds edits not written to the file yet */
  private readonly editorDirty = new Set<string>()
  /** id -> display name of one org's members; dropped when the selected org changes */
  private orgMemberNames = new Map<string, string>()
  /** the org whose member names the map holds (null = nothing cached) */
  private orgMemberNamesOrg: string | null = null
  /** the last organization id observed by `noteSelectedOrg` */
  private notedOrgId: string | null = null
  /** the one in-flight members read per org, shared by concurrent panel opens */
  private orgMemberNamesInFlight: { orgId: string; promise: Promise<Map<string, string>> } | null =
    null
  /** DESKTOP-HOME: workspaceId -> (userId -> displayName) cache; dropped on org/account change & reload */
  private readonly workspaceMemberNames = new Map<string, Map<string, string>>()
  /** DESKTOP-HOME: the one in-flight workspace members read per workspaceId */
  private readonly workspaceMemberNamesInFlight = new Map<string, Promise<Map<string, string>>>()
  /** DESKTOP-HOME: the org id under which `workspaceMemberNames` was populated */
  private workspaceMemberNamesOrg: string | null = null
  /** DESKTOP-HOME: the last live account key (`deploymentId/accountId`) observed for member caches */
  private sessionAccountKey: string | null = null
  /** per path, the saveMark of its last user Save */
  private readonly lastUserSave = new Map<string, number>()
  private saveCounter = 0
  /** one open of the session's store is shared; never remembered when it failed */
  private syncOpen: Promise<SyncStoreOpen> | null = null
  /** the outcome of the last store open; 'unknown' until it is asked for */
  private storeOpenKind: SyncStoreOpen['kind'] | 'unknown' = 'unknown'
  /**
   * d7-2/d1-3: per scope token, the document keys the last `planSignOut` of that
   * scope counted as RAM-only. The switch notice sums that count with the lock's
   * own lost documents, so the lock of the scope leaves these keys out: a
   * document is counted once. A re-plan replaces the scope's entry and the lock
   * drops it, so an interleaved plan of another scope cannot clobber it and the
   * map never holds more than one entry per scope.
   */
  private readonly plannedRamOnly = new Map<string, Set<string>>()
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
   * The one conflict dialog open (G5-09 S5 session). `fromClose` = opened by
   * the close prompt of that document's tab.
   */
  private conflictPrompt: ConflictSession | null = null
  /** path key -> in-flight S5 reload draft flush waiter (intercepts onUserSave so the flush never uploads) */
  private readonly draftFlushWaiters = new Map<string, (wrote: boolean) => void>()
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
   * UNI-1961 (R4-1): per-document generation advanced on each successful own
   * shelve/unshelve transition so a metadata GET begun beforehand cannot
   * overwrite the local transition with a stale shelved answer.
   */
  private readonly localPolicyGen = new Map<string, number>()
  /**
   * UNI-1959: documents this app created blank from the menu / strip / default
   * name (`createDocument`) and has not had a first save for yet; their first
   * user save asks name + folder. Keyed by account + document
   * (`firstSaveKeyOf`), and emptied at every session boundary. A document the
   * dialog already answered is in `firstSaveNamed` instead.
   */
  private readonly createdBlank = new Set<string>()
  /** UNI-1959: documents whose "Name the document" step the person answered this session (never asked twice) */
  private readonly firstSaveNamed = new Set<string>()
  /**
   * UNI-1959: the naming operation in flight per path key - the metadata read,
   * the pushed ask and the held save are one unit owned by the session that
   * started it. A second Save while it is open only waits; a closed tab or a
   * session boundary cancels it.
   */
  private readonly firstSaveOps = new Map<string, FirstSaveOp>()
  /** UNI-1959: told the path key of every naming op that ends (a close-save wait re-arms on it) */
  private readonly firstSaveOpEnded = new Set<(key: string) => void>()
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
  /** documentId → real working-copy path; forgetLocksWhere cannot rehydrate via pathKey on Windows */
  private readonly remoteLockPath = new Map<string, string>()
  /** ADVISOR D4 (a): the parsed dev-only fixture and the mtime it was read at */
  private devFixture: {
    file: string
    mtimeMs: number
    bars: Record<string, UniworkRemoteBar>
  } | null = null
  /** per path, the last editor state the poll reported (the AI settle edge) */
  private readonly editorAi = new Map<string, { aiRunning: boolean; aiEpoch: number }>()
  /**
   * A3 (UNI-1362): the remote decisions of a path that are running right now,
   * keyed by `pathKey`. Every decision registers into an identity-bearing entry
   * (`{ n }`, captured at increment) and its `finally` decrements/deletes only
   * while that very entry is still the map's: `lockSession` clears the map
   * without awaiting the decisions it drops, so an old finalizer must never
   * release the entry a decision of the next session registered.
   * `pruneClosedRemoteState` keeps `editorAi` while any entry exists, so the bar
   * a decision is about to publish still has the AI sample its own settle edge
   * re-decides on.
   */
  private readonly remoteDecisions = new Map<string, { n: number }>()
  /** one guarded reload per path at a time; a notice queued behind it runs after */
  private readonly remoteReloads = new Map<string, Promise<void>>()
  /**
   * S18: the in-flight uploads by the renderer's own `uploadId`, so the dialog's
   * Cancel can abort the one it started (the read, or the POST already running).
   * An entry lives exactly as long as its upload call.
   */
  private readonly uploads = new Map<string, AbortController>()
  /**
   * SAVE-01 r2 (S01-R1-4): one in-flight first save per unbound path, keyed by
   * pathKey. A second call for the same path JOINS the running attempt (same
   * result object), so a double-submit can never race two creates.
   */
  private readonly firstSaveInFlight = new Map<
    string,
    Promise<UniworkDocActionResult<UniworkDocSummary>>
  >()
  /**
   * SAVE-01 r2 (S01-R1-4): the Idempotency-Key of one first-save ATTEMPT, keyed
   * by account + workspace + path + title + target. A retry of the same save
   * after a lost create answer reuses it, so the server dedups to the one
   * document (D fingerprints destination too). Dropped only when the attempt
   * is bound, compensated, or failed before the POST existed.
   */
  private readonly firstSaveKeys = new Map<string, string>()
  /**
   * SAVE-01 r2 (S01-R1-3): paths whose first save already bound this session
   * (the user's original file stays where it was, still plain): a retry from
   * the old path is refused `conflict` instead of creating a second document.
   */
  private readonly firstSaveDone = new Set<string>()
  /**
   * S01-R2-4 fix2: Idempotency-Keys the server refused (a payload mismatch) or
   * that were replaced. Kept in process whatever the durable delete did, so a
   * key that is known spent is never restored from a record again.
   */
  private readonly spentFirstSaveKeys = new Set<string>()
  /**
   * bumped on lockSession and on an organization change so an own action
   * started before sign-out/switch/org-change never pushes treeChanged after
   */
  private sessionEpoch = 0
  /** the org id of the current session epoch; undefined until first read or noted */
  private sessionOrgId: string | null | undefined = undefined

  constructor(deps: UniworkDocsServiceDeps) {
    this.deps = deps
    this.client = deps.client ?? null
    this.appVersion = deps.appVersion ?? (() => '0.0.0')
    this.store = new BindingStore(join(deps.userDataDir, 'uniwork-documents'), (dir) =>
      this.heldByMigration(dir),
    )
    this.lastOwner = this.store.readLastOwner()
    this.lastOwnerOnDisk = this.lastOwner
    this.limitsCache = createDocumentLimitsCache({
      origin: () => this.deps.profile()?.apiOrigin ?? null,
      fetchLimits: async (startedOrigin) => {
        if (this.deps.limits) return await this.deps.limits()
        // a session that is not signed in has no deployment to ask: the
        // defaults hold until one is, and `noteSessionIdentity` refreshes
        if (!this.deps.identity()) return null
        const currentOrigin = this.deps.profile()?.apiOrigin?.trim().replace(/\/+$/, '') || null
        if (startedOrigin !== currentOrigin) return null
        const client = this.api()
        return client.getDocumentLimits ? await client.getDocumentLimits() : null
      },
    })
    this.avatarCache = createAvatarCache({
      fetch: deps.avatarFetch ?? deps.fetch,
      now: deps.now,
    })
    this.sourceViewOpener = createSourceViewOpener({
      previewRoot: join(deps.userDataDir, DRAFT_PREVIEW_DIR),
      ...(deps.sourceViewStartupSweep ? { startupSweep: deps.sourceViewStartupSweep } : {}),
      registry: this.sourceViews,
      identity: () => this.deps.identity(),
      profile: () => this.deps.profile(),
      storeLocked: () => this.storeLocked(),
      documentMaxBytes: () => this.limitsCache.peek().max_bytes,
      downloadSource: (workspaceId, sourceId) => this.api().downloadSource(workspaceId, sourceId),
      openPath: (path) => this.deps.openPath(path),
      closePath: (path) => this.deps.closePathNow?.(path),
      isPathOpen: (path) => this.deps.isPathOpen(path),
    })
    this.coordinator = new SaveCoordinator({
      store: this.store,
      client: {
        upload: (input) => this.api().upload(input),
        commit: (input) => this.api().commit(input),
        getDocument: (documentId) => this.api().getDocument(documentId),
        // UNI-1918 (B69-lite): the one lookup the inline pipeline runs when the
        // server refuses a staged upload whose claim expired
        lookupCommit: (input) => this.api().lookupCommit(input),
        // BIGUP-A1: a version payload above `chunked_upload_threshold_bytes`
        // goes through an upload session instead of one multipart POST
        uploadSession: {
          createDocumentUploadSession: (input) => this.api().createDocumentUploadSession(input),
          getUploadSession: (sessionId, signal) => this.api().getUploadSession(sessionId, signal),
          completeUploadSession: (input) => this.api().completeUploadSession(input),
          deleteUploadSession: (sessionId) => this.api().deleteUploadSession(sessionId),
          putUploadPart: (input) => this.api().putUploadPart(input),
        },
      },
      isSignedIn: () => deps.identity() !== null,
      ownsBinding: (doc) => this.owns(doc),
      intents: () => this.intentAccess(),
      publish: (status) => this.publish(status),
      requestQueuePopover: (path) => this.deps.pushQueuePopover?.({ path }),
      onSaved: (doc, versionId) => this.deps.notifySaved?.(doc.path, versionId),
      limits: () => this.limitsCache.get(),
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
        // d6-3: a cancel/discard keeps the snapshot as a draft in the engine's
        // own store, so only the engine of the account the copy belongs to may
        // run it (a switch can land between the intent read and here)
        cancel: async (doc, options) =>
          (await this.queueEngineFor(doc.path))?.cancel(doc, options) ?? doc.record.state,
        discard: async (doc, options) =>
          (await this.queueEngineFor(doc.path))?.discard(doc, options) ?? doc.record.state,
        supersede: async (doc) => {
          const engine = await this.queueEngineOrNull()
          const st = (await engine?.supersede(doc)) ?? doc.record.state
          return st
        },
        supersedeDeferRelease: async (doc) => {
          const engine = await this.queueEngineOrNull()
          if (engine?.supersedeDeferRelease) return engine.supersedeDeferRelease(doc)
          return {
            state: (await engine?.supersede(doc)) ?? doc.record.state,
            release: async () => {},
          }
        },
        tombstone: async (doc) =>
          (await this.queueEngineOrNull())?.tombstone(doc) ?? doc.record.state,
        isOtherWindow: (key) => this.queueSession?.dispatcher.isOtherWindow(key) === true,
        // A32: no engine means the durable lease cannot be read, so the overlay
        // is kept rather than cleared on a guess (see revalidateOtherWindow)
        holdsOtherWindow: async (key) => {
          const dispatcher = await this.queueEngineOrNull()
          return dispatcher ? await dispatcher.holdsOtherWindow(key) : true
        },
      },
      // the queue engine exposes no public in-flight state, so the service
      // reports the keys its own poll pass is running right now (G506-be-1)
      dispatcherBusy: (key) => this.queueInFlight.has(key),
      prepareEditLock: (path) => this.prepareEditLock(path),
      editLockId: (path) => this.editLockIdOf(path),
      editLockHolder: (path) => this.editLockHolderOf(path),
      onCommitEditLocked: (path, error) =>
        this.editLocks.get(pathKey(path))?.markLostFromCommit(error),
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

  /** EL-1(b): lock client of this profile; null when tests inject only a docs client */
  private editLockApi(): UniworkEditLockClient | null {
    if (this.deps.editLockClient) return this.deps.editLockClient
    if (this.deps.client) return null
    const profile = this.deps.profile()
    if (!profile) return null
    if (!this.editLockHttp || this.editLockOrigin !== profile.apiOrigin) {
      this.editLockHttp = createUniworkEditLockClient({
        apiOrigin: profile.apiOrigin,
        authorized: (call) => this.deps.authorized(call),
        isSignedIn: () => this.deps.identity() !== null,
        ...(this.deps.fetch ? { fetch: this.deps.fetch } : {}),
      })
      this.editLockOrigin = profile.apiOrigin
    }
    return this.editLockHttp
  }

  private editLockIdOf(path: string): string | null {
    return this.editLocks.get(pathKey(path))?.lockId() ?? null
  }

  private editLockHolderOf(path: string): UniworkDocEditLock | null {
    const view = this.editLocks.get(pathKey(path))?.view()
    if (!view) return null
    return {
      holderName: view.holderName,
      since: view.since,
      expiresAt: null,
      heldByMe: view.phase === 'self_elsewhere',
    }
  }

  private async prepareEditLock(path: string): Promise<'held' | 'park' | 'proceed'> {
    const session = this.editLocks.get(pathKey(path))
    if (!session) return 'proceed'
    return session.ensureHeldBeforeCommit()
  }

  private editLockReadOnly(path: string): boolean {
    return this.editLocks.get(pathKey(path))?.isReadOnly() === true
  }

  private toLockView(view: EditLockSessionView): UniworkEditLockSessionView | undefined {
    if (view.phase === 'none') return undefined
    return {
      phase: view.phase,
      holderName: view.holderName,
      since: view.since,
      ...(view.phase === 'lost'
        ? { lostReason: view.lostReason ?? 'unknown', byName: view.byName ?? null }
        : {}),
    }
  }

  private startEditLock(doc: BoundDocument): void {
    if (doc.binding.access !== 'edit') {
      void this.stopEditLock(doc.path, true)
      return
    }
    if (this.coordinator.isOtherWindow(doc.key)) return
    const api = this.editLockApi()
    if (!api) return
    const key = pathKey(doc.path)
    const existing = this.editLocks.get(key)
    if (
      existing &&
      existing.documentId === doc.binding.documentId &&
      existing.view().phase !== 'acquiring'
    ) {
      return
    }
    if (existing) void this.stopEditLock(doc.path, true)
    let editorId = this.editorIds.get(key)
    if (!editorId) {
      editorId = newEditorId()
      this.editorIds.set(key, editorId)
    }
    const session = new EditLockSession({
      documentId: doc.binding.documentId,
      path: doc.path,
      editorId,
      transport: asEditLockTransport(api),
      isOnline: () => this.queueOnline !== false,
      isSignedIn: () => this.deps.identity() !== null,
      onChange: (view) => {
        if (view.phase === 'acquiring' || view.phase === 'none') return
        const now = this.store.lookup(doc.path)
        if (now) this.publish(this.statusOf(now))
        this.notifyDocStateChanged(doc.path)
        void this.maybeReplayRemoteAfterUnlock(doc.path)
      },
    })
    this.editLocks.set(key, session)
    void session.acquire().then(() => {
      const view = session.view()
      if (view.phase === 'none') {
        if (this.editLocks.get(key) === session) {
          this.editLocks.delete(key)
          session.dispose()
          this.notifyDocStateChanged(doc.path)
        }
        return
      }
      const now = this.store.lookup(doc.path)
      if (now) this.publish(this.statusOf(now))
      void this.maybeReplayRemoteAfterUnlock(doc.path)
    })
  }

  private async stopEditLock(path: string, release: boolean): Promise<void> {
    const key = pathKey(path)
    const session = this.editLocks.get(key)
    if (!session) return
    if (this.editLocks.get(key) === session) this.editLocks.delete(key)
    if (release) await this.capped(session.release(), EDIT_LOCK_QUIT_CAP_MS)
    session.dispose()
    this.notifyDocStateChanged(path)
  }

  async releaseAllEditLocks(capMs?: number): Promise<void> {
    const sessions = [...this.editLocks.values()]
    const paths = sessions
      .map((s) => s.path)
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
    this.editLocks.clear()
    const drops = [...this.inFlightDropReleases]
    const work = Promise.all([...sessions.map((s) => s.release().catch(() => undefined)), ...drops])
    if (capMs !== undefined) {
      await this.capped(work, capMs)
    } else {
      await work
    }
    for (const s of sessions) s.dispose()
    for (const p of paths) this.notifyDocStateChanged(p)
  }

  /** will-quit holds the quit only while a held lock or a drop release is outstanding */
  hasEditLocksToRelease(): boolean {
    return this.editLocks.size > 0 || this.inFlightDropReleases.size > 0
  }

  /** will-quit: best-effort, 1.5 s cap; the quit gate awaits this then re-quits */
  releaseEditLocksOnQuit(): Promise<void> {
    return this.releaseAllEditLocks(EDIT_LOCK_QUIT_CAP_MS)
  }

  /**
   * EL-1(b) fix3 B2: MCP closeTabWithoutPrompt / removeTab and a macOS
   * clean-window close drop bound paths without confirmClose. One hook,
   * best-effort, capped like quit. Callers stay fire-and-forget; will-quit
   * joins the in-flight DELETE under the same single cap (EL1B-BE-R2-1).
   */
  async notePathsDropped(paths: string[]): Promise<void> {
    const sessions: EditLockSession[] = []
    const droppedPaths: string[] = []
    for (const path of paths) {
      if (typeof path !== 'string' || !path) continue
      // UNI-1959: a name dialog still open for a closed tab is dismissed with it
      this.cancelFirstSaveFor(path)
      const key = pathKey(path)
      const session = this.editLocks.get(key)
      if (!session) continue
      this.editLocks.delete(key)
      sessions.push(session)
      droppedPaths.push(path)
    }
    if (sessions.length === 0) return
    const work = Promise.all(sessions.map((s) => s.release().catch(() => undefined)))
    this.inFlightDropReleases.add(work)
    void work.finally(() => {
      this.inFlightDropReleases.delete(work)
    })
    await this.capped(work, EDIT_LOCK_QUIT_CAP_MS)
    for (const s of sessions) s.dispose()
    for (const p of droppedPaths) this.notifyDocStateChanged(p)
  }

  private async capped(work: Promise<unknown>, capMs: number): Promise<void> {
    await Promise.race([work.catch(() => undefined), this.sleepMs(capMs)])
  }

  notePowerResume(): void {
    for (const session of this.editLocks.values()) void session.wake()
  }

  noteWindowFocus(): void {
    for (const session of this.editLocks.values()) {
      if (session.view().phase === 'other') void session.wake()
    }
  }

  /** EL-1(b): "Sửa ở đây" */
  async editHere(path: string): Promise<UniworkDocStatus | null> {
    if (typeof path !== 'string') return null
    const doc = this.store.lookup(path)
    if (!doc || !this.ownsLocally(doc)) return null
    let session = this.editLocks.get(pathKey(path))
    if (!session) {
      this.startEditLock(doc)
      session = this.editLocks.get(pathKey(path))
    }
    if (!session) return this.statusOf(doc)
    const ok = await session.editHere()
    if (!ok) return null
    const now = this.store.lookup(path)
    if (!now) return null
    void this.maybeReplayRemoteAfterUnlock(path)
    const status = this.statusOf(now)
    this.publish(status)
    return status
  }

  private async maybeReplayRemoteAfterUnlock(path: string): Promise<void> {
    const doc = this.store.lookup(path)
    if (!doc) return
    const phase = this.editLocks.get(pathKey(path))?.view().phase
    // granted / lock free — leave edit_locked and edit_lock read-only
    if (phase !== 'held' && phase !== 'free') return
    const documentId = doc.binding.documentId
    const held = this.remoteHeld.get(documentId)
    try {
      const detail = await this.api().getDocument(documentId)
      if (held) await this.redecideHeld(documentId)
      if (compareRevision(detail.revision, doc.binding.baseRevision) > 0) {
        await this.noteRemoteChange({
          documentId,
          revision: detail.revision,
          version: detail.file.version,
          versionId: detail.file.versionId ?? null,
        })
      }
    } catch {
      if (held) await this.redecideHeld(documentId).catch(() => undefined)
    }
  }

  private notifyDocStateChanged(path: string): void {
    if (typeof path !== 'string' || !path) return
    this.deps.pushDocStateChanged?.(path)
  }

  /** every status push: the shell window, then in-process waiters (close prompt) */
  private publish(status: UniworkDocStatus): void {
    const full = this.withRemote(this.present(this.withLockSession(status)))
    this.deps.pushStatus(full)
    for (const listener of [...this.statusListeners]) listener(full)
    const accessSig = `${full.access}:${full.state === 'blocked' ? (full.error ?? '') : ''}`
    const sigKey = pathKey(full.path)
    const prevSig = this.lastPublishedAccess[sigKey]
    this.lastPublishedAccess[sigKey] = accessSig
    if (prevSig !== undefined && prevSig !== accessSig) {
      this.notifyDocStateChanged(full.path)
    }
    const open = this.conflictPrompt
    if (open && !open.controller.signal.aborted && samePath(open.path, full.path)) {
      if (full.state === 'blocked') {
        const locked: 'revoked' | 'deleted' | undefined =
          full.error === 'permission_revoked' || full.error === 'forbidden'
            ? 'revoked'
            : full.error === 'document_deleted' ||
                full.error === 'deleted' ||
                full.error === 'not_found'
              ? 'deleted'
              : undefined
        if (locked && open.locked !== locked) {
          open.locked = locked
          open.knownCanEdit = false
          void this.buildConflictView(open, { fetchServer: false })
            .then((view) => {
              if (this.conflictPrompt === open && !open.controller.signal.aborted) {
                this.deps.pushConflict?.(view)
              }
            })
            .catch(() => undefined)
        }
      }
    }
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
    // EL1A-BE-1: an edit_locked copy never rebuilds a newer-* bar from a revision the 423
    // handed back: the chip's edit_locked pill outranks it and names the holder instead
    if (binding.state === 'edit_locked') return null
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
    return this.withRemote(this.present(this.withLockSession(toStatus(doc))))
  }

  /** live lock view on every status (B6: one place, including non-statusOf publishes) */
  private withLockSession(status: UniworkDocStatus): UniworkDocStatus {
    const lockSession = this.toLockView(
      this.editLocks.get(pathKey(status.path))?.view() ?? {
        phase: 'none',
        holderName: null,
        since: null,
      },
    )
    if (!lockSession) {
      if (!status.lockSession) return status
      const { lockSession: _dropped, ...rest } = status
      return rest
    }
    return { ...status, lockSession }
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
    // UWNM-BE-R4-2: while the naming ask holds a first Save its bytes are unsent
    // work, however clean the editor that wrote them reads
    if (!dirty && this.firstSaveOps.has(pathKey(doc.path))) return
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
    const owner = { accountId: identity.accountId, deploymentId: identity.deploymentId }
    const sameOwner = (known: LastOwner | null) =>
      !!known && known.accountId === owner.accountId && known.deploymentId === owner.deploymentId
    if (!sameOwner(this.lastOwner)) {
      this.lastOwner = owner
      // the back-off belongs to the owner whose write failed, not to the next one
      this.lastOwnerRetryAt = 0
    }
    // a failed write is not remembered as persisted: a later observation retries it,
    // at most once per back-off so a stuck disk does not stall every status read
    if (!sameOwner(this.lastOwnerOnDisk) && Date.now() >= this.lastOwnerRetryAt) {
      if (this.store.writeLastOwner(owner)) this.lastOwnerOnDisk = owner
      else this.lastOwnerRetryAt = Date.now() + LAST_OWNER_RETRY_MS
    }
    return identity
  }

  /** the session's account may have changed: remember it as the last owner */
  noteSessionIdentity(): void {
    const identity = this.liveIdentity()
    const accountKey = identity ? `${identity.deploymentId}/${identity.accountId}` : null
    if (this.sessionAccountKey !== accountKey) {
      this.sessionAccountKey = accountKey
      this.orgMemberNames = new Map()
      this.orgMemberNamesOrg = null
      this.orgMemberNamesInFlight = null
      this.workspaceMemberNames.clear()
      this.workspaceMemberNamesInFlight.clear()
      this.workspaceMemberNamesOrg = null
      this.avatarCache.clear()
    }
    if (identity) {
      // session boot / deployment switch: the new server's `documents.limits`
      // replace whatever the previous one published
      void this.limitsCache.refresh().catch(() => undefined)
    } else {
      this.notedOrgId = null
      this.limitsCache.reset()
    }
    // a live session opens its store: the scope's migration and every later
    // intent write go through this one open
    void this.openSyncStore().catch(() => undefined)
  }

  /**
   * SIZE-F1: "Lưu bản sao về máy" / "Save a copy to computer" from the save-block
   * prompt. Opens the native Save-As dialog pointed at the local working copy and
   * writes the current working copy bytes to the user-chosen path.
   */
  async saveLocalCopy(path: string): Promise<boolean> {
    if (typeof path !== 'string' || !path) return false
    const doc = this.store.lookup(path)
    if (!doc || !this.ownsLocally(doc)) return false
    const defaultName = doc.binding.filename
    let target: string | null = null
    try {
      if (this.deps.pickDownloadPath) {
        target = await this.deps.pickDownloadPath(defaultName)
      } else if (this.deps.ui?.pickCopyPath) {
        target = await this.deps.ui.pickCopyPath(doc.binding.title, doc.binding.format)
      }
    } catch {
      return false
    }
    if (!target) return false
    const current = this.store.lookup(doc.path)
    if (
      !current ||
      current.binding.documentId !== doc.binding.documentId ||
      !this.ownsLocally(current)
    ) {
      return false
    }
    if (await this.isSameWorkingCopy(current.path, target)) return false
    // A106 (UNI-1362): the working-copy root is the app's own folder; a user-picked
    // export path may never land inside it
    if (this.store.isInside(target)) return false
    try {
      const localBytes = new Uint8Array(await readFile(current.path))
      await writeFile(target, localBytes)
      return true
    } catch {
      return false
    }
  }

  /** true when `targetPath` points to the same file as `sourcePath` (resolved, realpath, or dev+ino) */
  private async isSameWorkingCopy(sourcePath: string, targetPath: string): Promise<boolean> {
    const resolvedSource = resolve(sourcePath)
    const resolvedTarget = resolve(targetPath)
    if (pathKey(resolvedSource) === pathKey(resolvedTarget)) return true
    const [sourceStat, targetStat] = await Promise.all([
      stat(resolvedSource).catch(() => null),
      stat(resolvedTarget).catch(() => null),
    ])
    if (
      sourceStat &&
      targetStat &&
      sourceStat.dev === targetStat.dev &&
      sourceStat.ino === targetStat.ino &&
      sourceStat.ino !== 0
    ) {
      return true
    }
    const realSource = await realpath(resolvedSource).catch(() => resolvedSource)
    const realTarget = await realpath(resolvedTarget).catch(async () => {
      const realParent = await realpath(dirname(resolvedTarget)).catch(() =>
        dirname(resolvedTarget),
      )
      return join(realParent, basename(resolvedTarget))
    })
    return pathKey(realSource) === pathKey(realTarget)
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
   * The store of `owner`, the account a lock is for. While `owner` is the live
   * session this is `openSyncStore`; after an account switch the next account
   * is already live, and the leaving account's intents and N+1 must be read
   * from and parked into its own store, never the live one (a one-off handle).
   */
  private openStoreOf(owner: LastOwner): Promise<SyncStoreOpen> {
    const sync = this.deps.syncStore
    const live = sync?.scope()
    if (
      !sync ||
      !live ||
      (live.deploymentId === owner.deploymentId && live.accountId === owner.accountId)
    ) {
      return this.openSyncStore()
    }
    if (!sync.openScope) return Promise.resolve({ kind: 'no_session' })
    return sync.openScope({ deploymentId: owner.deploymentId, accountId: owner.accountId })
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
        this.queueSession?.id !== id || this.deadQueueSessions.has(id)
          ? { kind: 'unavailable' }
          : { kind: 'ok', intents },
      client: {
        upload: (input) =>
          this.api().upload({ ...input, format: input.format as UniworkDocFormat }),
        commit: (input) => this.api().commit(input),
        lookupCommit: (input) => this.api().lookupCommit(input),
        // BIGUP-A1: the same session routes the inline pipeline uses, so a
        // replayed intent above the threshold takes the chunked path too
        uploadSession: {
          createDocumentUploadSession: (input) => this.api().createDocumentUploadSession(input),
          getUploadSession: (sessionId, signal) => this.api().getUploadSession(sessionId, signal),
          completeUploadSession: (input) => this.api().completeUploadSession(input),
          deleteUploadSession: (sessionId) => this.api().deleteUploadSession(sessionId),
          putUploadPart: (input) => this.api().putUploadPart(input),
        },
      },
      // BIGUP-A1: the deployment's `chunked_upload_threshold_bytes`, read from
      // the same cache the coordinator uses
      documentLimits: () => this.limitsCache.get(),
      capability: {
        get: (orgId, options) =>
          this.deps.capability
            ? this.deps.capability.get(orgId, options)
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
      // UNI-2212: a converted copy of a legacy document declares its conversion with its commit
      conversionFor: (path) => this.conversionOf(path),
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
        if (this.queueSession?.id !== id || this.deadQueueSessions.has(id)) return
        this.publishRecord(record)
      },
      prepareEditLock: (path) => this.prepareEditLock(path),
      editLockId: (path) => this.editLockIdOf(path),
      editLockHolder: (path) => this.editLockHolderOf(path),
      onCommitEditLocked: (path, error) =>
        this.editLocks.get(pathKey(path))?.markLostFromCommit(error),
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
   * The queue engine of the live session only when the working copy at `path`
   * belongs to that session's account; null otherwise (never throws). Its
   * drafts store is that account's, so nothing of one account is kept in the
   * store of another.
   */
  private async queueEngineFor(path: string): Promise<SaveQueueEngine | null> {
    try {
      const access = await this.queueEngine()
      if (access.kind !== 'ok') return null
      const [deploymentId = '', accountId = ''] = access.token.split('/')
      return this.pathBelongsTo({ deploymentId, accountId }, path) ? access.dispatcher : null
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

  /** the queue's last connectivity verdict; false keeps the blocked re-probe home */
  private queueOnline: boolean | undefined = undefined
  /** when a blocked intent's document may be re-probed next, by document key */
  private readonly blockedProbeAt = new Map<string, number>()
  /** how many re-probes one blocked intent already spent (the backoff's exponent) */
  private readonly blockedProbeCount = new Map<string, number>()
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
    // a spent record (committed / cancelled) leaves no intent for an N+1 to
    // wait behind (RBE6u-02)
    if (isTerminalQueueState(record.state)) this.coordinator.clearPendingNext(doc.path)
    if (record.state === 'committed') {
      await this.settleFromRecord(doc, record)
      return
    }
    const patch = queueBindingPatch(record, doc.binding)
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
    delete next.editLock
    delete next.sizeBytes
    delete next.maxBytes
    delete next.serverRevision
    delete next.serverVersion
    // UNI-2212: the converted copy is now the live version: an ordinary OOXML document, whose
    // title the server rewrote from the legacy suffix (the title notice would say the same)
    if (next.legacyFrom) {
      next.title = convertedTitle(next.title, next.legacyFrom)
      delete next.legacyFrom
    }
    // the intent landed: nothing newer waits behind it (RBE6u-02)
    this.coordinator.clearPendingNext(doc.path)
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
    // A3 (UNI-1362): the poll is the lifecycle hook a closed path gets: prune
    // the ephemeral per-path state no view holds any more before the pass runs
    this.pruneClosedRemoteState()
    const pass = this.runQueuePass()
    // teardownSaveQueue awaits this very pass, so it must be observable while it runs
    this.queuePass = pass
    try {
      await pass
    } finally {
      if (this.queuePass === pass) this.queuePass = null
    }
  }

  /**
   * A3 (UNI-1362): the ephemeral per-path S6 state of a document no view shows
   * any more. Closing is the shell's (`tab-manager` / `closePathNow`), so the
   * poll - the one lifecycle the service runs on its own - is where a closed
   * path's entries go.
   *
   * - `editorAi`: the last editor answer of the path (a stale `aiRunning` /
   *   `aiEpoch`). Kept while a bar is on screen: a `newer-ai` bar re-decides its
   *   notice on this very memory when the turn ends, and a hidden (`null`) bar
   *   or no bar at all can never reach that edge. Also kept while a remote
   *   decision for the path is still in flight: that decision already read the
   *   sample into its verdict, so dropping it would leave the bar it is about to
   *   publish with no memory for its own settle edge.
   * - `remoteReloads`: a per-path reload chain that has already settled. An
   *   in-flight one is the promise a queued notice waits on and stays.
   *
   * The bars, notices, held notices and lock verdicts are authoritative (a
   * `null` bar is the session's own `later`/`close` decision and a revoke/delete
   * verdict must outlive the close), so they are left to their own writers and
   * to the account boundary.
   */
  private pruneClosedRemoteState(): void {
    for (const path of [...this.editorAi.keys()]) {
      if (this.deps.isPathOpen(path)) continue
      if (this.remoteDecisions.has(pathKey(path))) continue
      if (this.remoteBars.get(pathKey(path))) continue
      this.editorAi.delete(path)
    }
  }

  /** G5-10: expose the live session's queue dispatcher and stores to Sync Center */
  async syncCenterEngine(): Promise<QueueEngineAccess> {
    return this.queueEngine()
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
      await this.reprobeBlockedDocs(
        access.dispatcher,
        docs,
        this.deps.now ? this.deps.now() : Date.now(),
      )
      await access.dispatcher.tick(docs)
      await access.dispatcher.dispatchAll(docs)
    } finally {
      for (const doc of docs) this.queueInFlight.delete(doc.key)
    }
  }

  /**
   * A blocked intent whose condition only the document itself can prove
   * (`permission_revoked`, `document_deleted`, `document_archived`): one bounded
   * metadata re-probe per intent, spaced by a backoff, so the SAME intent goes
   * back to the queue once the document answers for writing again. This is the
   * runtime's access check: a document listed by the feed only proves the
   * account may READ it (a listed row is not evidence that writing returned),
   * while a document read reports the level itself - and, for a block earned by
   * an archived/deleted document, whether the document is still in the
   * trash/archive. The pass only runs with a live session and store, and an
   * offline verdict keeps every probe home, so a probe never leaves the account,
   * deployment or org of the intent.
   */
  private async reprobeBlockedDocs(
    dispatcher: QueueDispatcher,
    docs: QueueDoc[],
    now: number,
  ): Promise<void> {
    if (this.queueOnline === false) return
    // one probe state per blocked intent: a key that is no longer blocked (it
    // committed, was cancelled, or was abandoned) forgets its backoff
    const blocked = new Set<string>()
    for (const doc of docs) {
      if (doc.record.state === 'blocked') blocked.add(doc.key)
    }
    for (const key of [...this.blockedProbeAt.keys()]) {
      if (blocked.has(key)) continue
      this.blockedProbeAt.delete(key)
      this.blockedProbeCount.delete(key)
    }
    for (const doc of docs) {
      const reason = doc.record.state === 'blocked' ? doc.record.lastError : undefined
      if (!isDocumentProbeReason(reason)) continue
      const due = this.blockedProbeAt.get(doc.key)
      if (due !== undefined && now < due) continue
      // the pass backs off a probe that did not lift; a refusal and a lift are
      // both answered by the state the record was left in
      if ((await this.probeBlockedDoc(dispatcher, doc, now)) !== 'blocked') {
        this.blockedProbeAt.delete(doc.key)
        this.blockedProbeCount.delete(doc.key)
        continue
      }
      const count = (this.blockedProbeCount.get(doc.key) ?? 0) + 1
      this.blockedProbeCount.set(doc.key, count)
      this.blockedProbeAt.set(
        doc.key,
        now + Math.min(QUEUE_LIMITS.recheckMs, BLOCKED_PROBE_BASE_MS * 2 ** (count - 1)),
      )
    }
  }

  /**
   * One blocked intent's document re-probe: a single metadata read, the only
   * answer that proves write access came back. A refused/unreachable read
   * leaves the block alone, and a block earned by an archived or deleted
   * document lifts only when the document is out of the trash/archive too - an
   * archived document keeps refusing the write, so waking the intent would only
   * earn the same block again. Returns the state the record was left in, so
   * both callers (the poll's bounded pass and "Kiểm tra lại") read a refusal and
   * a lift apart.
   */
  private async probeBlockedDoc(
    dispatcher: QueueDispatcher,
    doc: QueueDoc,
    now: number,
  ): Promise<QueueState> {
    const reason = doc.record.lastError
    if (!isDocumentProbeReason(reason)) return doc.record.state
    let flags: { canEdit: boolean; archived: boolean } | null = null
    try {
      const detail = await this.api().getDocument(doc.record.documentId)
      flags = actionFlags(detail.myLevel, detail.archivedAt)
    } catch {
      // still refused (403/404/410) or unreachable: the block stays
    }
    // a document still in the trash or the archive cannot be written: the
    // block lifts only once the read sees it active and writable again
    const forWriting =
      flags !== null && flags.canEdit && (reason === 'permission_revoked' || !flags.archived)
    if (!forWriting) return doc.record.state
    const states = await dispatcher.unblock([doc], reason, now)
    const state = states[0] ?? doc.record.state
    if (state !== 'blocked') {
      // the server lets this copy be edited again: the session's lock verdict on
      // it is spent, exactly as the reopen path spends it
      this.clearRemoteLock(doc.record.documentId, doc.path)
    }
    return state
  }

  /**
   * The session's connectivity changed (a network failure or a successful
   * request the service already saw): move the waiting intents with it. Going
   * online wakes the `paused_offline` ones (the next poll dispatches them);
   * going offline parks the waiting ones. A store that cannot be read right now
   * is left alone - nothing may move without being persisted.
   */
  async setQueueOnline(online: boolean): Promise<void> {
    // remembered for the blocked re-probe: a pass that reported offline never
    // sends an access check either
    this.queueOnline = online
    // EL-1(b): network-back wake (same signal the feed poll / queue uses)
    if (online) {
      for (const session of this.editLocks.values()) void session.wake()
    }
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
    if (closed) await this.stopEditLock(path, true)
    if (closed && this.conflictPrompt && samePath(this.conflictPrompt.path, path)) {
      this.endConflictByMain(this.conflictPrompt)
    }
    const doc = typeof path === 'string' ? this.store.lookup(path) : null
    if (!doc || !this.ownsLocally(doc)) return
    const queueDoc = await this.queueDocFromStore(doc)
    // d6-3: an account switch may have landed during the intent read
    if (!queueDoc || !this.ownsLocally(doc)) return
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
        // EL1A-BE-4: like withoutError on the inline settle: a cancelled save drops the 423's
        // holder metadata, so a later writer spreading the binding cannot resurrect it
        delete next.editLock
        await this.coordinator.commitState(fresh, next)
      }
    }
  }

  /** "Bỏ lần lưu..." on a stuck intent: the snapshot becomes a kept draft */
  async discardSave(path: string): Promise<void> {
    const doc = typeof path === 'string' ? this.store.lookup(path) : null
    if (!doc || !this.ownsLocally(doc)) return
    const queueDoc = await this.queueDocFromStore(doc)
    // d6-3: an account switch may have landed during the intent read
    if (!queueDoc || !this.ownsLocally(doc)) return
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

  /**
   * "Kiểm tra lại" on a BLOCKED row: the same access re-probe the poll runs
   * (F1), now and for this one intent instead of at the next backoff. The
   * document reasons (`permission_revoked`, `document_deleted`,
   * `document_archived`) are proven by the document read; the capability reasons
   * (`session_expired`, `member_deactivated`, `organization_suspended`) by a
   * real read of the intent's own org lane, which the normal pass forces for a
   * lane holding one of them. Only a condition that really lifted moves the
   * record - the commit lookup, which can wake a blocked intent without proving
   * anything, stays the reconciling rows' action. `false` = the re-probe could
   * not run at all (no live session, no store, nothing blocked at this path).
   */
  async recheckBlockedSave(path: string): Promise<boolean> {
    const doc = typeof path === 'string' ? this.store.lookup(path) : null
    if (!doc || !this.ownsLocally(doc)) return false
    const queueDoc = await this.queueDocFromStore(doc)
    if (!queueDoc || queueDoc.record.state !== 'blocked') return false
    const access = await this.queueEngine()
    if (access.kind !== 'ok' || !this.isQueueSessionCurrent(access)) return false
    const now = this.deps.now ? this.deps.now() : Date.now()
    const reason = queueDoc.record.lastError
    if (isDocumentProbeReason(reason)) {
      // the document itself proves this block: one read, right now
      if ((await this.probeBlockedDoc(access.dispatcher, queueDoc, now)) === 'blocked') return true
    } else if (
      reason !== 'session_expired' &&
      reason !== 'member_deactivated' &&
      reason !== 'organization_suspended'
    ) {
      // a block this click cannot prove (a lease, a cause nobody named): the row
      // keeps its block
      return true
    }
    // the same pass the poll runs: the lane's capability is read for real and
    // lifts its own reason only, and an intent a lift released goes back
    // through the normal path - the SAME intent, never a new attempt
    await access.dispatcher.dispatchAll([queueDoc], now)
    return true
  }

  /** true while another window holds this document's lock (this one is read-only) */
  isOtherWindow(path: string): boolean {
    const doc = typeof path === 'string' ? this.store.lookup(path) : null
    return doc ? this.coordinator.isOtherWindow(doc.key) : false
  }

  /**
   * A32 (UNI-1362): a status read revalidates the window-local `other_window`
   * overlay against the durable lease, because `applyRecord` - the only other
   * path that clears it - runs only on a queue record push. The holder can
   * release the lock and no record of this document ever move again: without
   * this, `present` keeps re-applying a read-only status the window no longer
   * has. Cosmetic only (`canSave` reads the live dispatcher), so a lock whose
   * state cannot be read keeps the overlay rather than clearing it on a guess.
   */
  private async revalidateOtherWindow(doc: BoundDocument): Promise<void> {
    if (!this.otherWindowStatus.has(doc.path)) return
    if (await this.coordinator.holdsOtherWindow(doc.key)) return
    this.otherWindowStatus.delete(doc.path)
  }

  /**
   * "Ghi đè" / "Tải lại" / "Lưu lại": the old intent is superseded BEFORE the
   * new one is minted or the base is replaced (EXPERIENCE - Superseded, :239).
   */
  private async supersedePending(doc: BoundDocument): Promise<void> {
    const queueDoc = await this.queueDocFromStore(doc)
    if (queueDoc) await this.coordinator.supersede(queueDoc)
  }

  /**
   * `supersedePending` for the conflict actions: the old intent is persisted
   * `cancelled` now, but the retained upload session's network DELETE is
   * returned for the caller to run AFTER its local destructive steps, so no
   * network sits between `saveRacedReplacement` and the last store write.
   */
  private async supersedePendingDeferRelease(doc: BoundDocument): Promise<() => Promise<void>> {
    const queueDoc = await this.queueDocFromStore(doc)
    return queueDoc ? await this.coordinator.supersedeDeferRelease(queueDoc) : async () => {}
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

  /** UNI-2212: the conversion the next commit of this working copy declares, if it owes one */
  private conversionOf(path: string): LegacyConversion | null {
    const from = this.store.lookup(path)?.binding.legacyFrom
    return from ? conversionFor(from) : null
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
    if (session) this.pruneQueueSessionTombstones(session.id)
  }

  /**
   * A30 (UNI-1362): once a session is detached from `queueSession` and every
   * pass/publish closure has drained, its `id` can never match `queueSession?.id`
   * again, so the tombstone sets may drop it while stale callbacks stay refused.
   */
  private pruneQueueSessionTombstones(id: string): void {
    const drain = async (): Promise<void> => {
      await this.queuePass?.catch(() => undefined)
      if (this.pendingApplyRecords.size > 0) {
        await Promise.all([...this.pendingApplyRecords])
      }
      if (this.queueSession?.id === id) return
      this.stoppingQueueSessions.delete(id)
      this.deadQueueSessions.delete(id)
    }
    void drain()
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
    if (this.pendingApplyRecords.size > 0) {
      await Promise.all([...this.pendingApplyRecords])
    }
    if (session && this.queueSession?.id !== session.id) {
      this.stoppingQueueSessions.delete(session.id)
      this.deadQueueSessions.delete(session.id)
    }
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
    // A62 (UNI-1362): the plan enumerates `target`'s folders, so its intents must
    // come from `target`'s own store, never the live session's. After an account
    // switch the next account is already live, and reading through the live scope
    // planned the leaving account's copies against the wrong account's intents (a
    // copy with a stored intent could read as clean, and one without as pending).
    // This is the same owner-scoped open `lockSession` already uses.
    const open = !keystoreLocked
      ? await this.openStoreOf(target)
      : ({ kind: 'keystore_locked' } as const)
    const intents =
      open.kind === 'ok' ? createIntentStore(open.records(INTENT_STORE_REGISTRATION.name)) : null
    const storeLockedNow = keystoreLocked || open.kind === 'keystore_locked'
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
      if (intents) {
        const stored = await intents.read(key, {
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

    // d1-3: the entry belongs to this scope alone, and a re-plan replaces it
    // (an empty plan drops it) so a scope that is never locked cannot grow it
    const planToken = `${target.deploymentId}/${target.accountId}`
    if (storeLockedNow) this.plannedRamOnly.set(planToken, ramOnlyDocs)
    else this.plannedRamOnly.delete(planToken)
    return {
      count: unsavedDocs.size,
      waiting: waitingDocs.size,
      keystoreLocked: storeLockedNow,
      ramOnly: storeLockedNow ? ramOnlyDocs.size : 0,
    }
  }

  /**
   * Alias for `planSignOut` used by IPC handler (`UNIWORK_DOC_CHANNELS.signOutPlan`).
   * A87 (UNI-1362): an interactive sign-out plan is always for the live session's
   * scope (`owner` omitted -> `target` = live identity / lastOwner), so any
   * entry left behind by a previously cancelled plan of another scope cannot
   * still be paired with a pending lock and is pruned here without disturbing
   * `AccountBoundary`'s interleaved `planSignOut(previous)` switch accounting.
   */
  async signOutPlan(owner?: LastOwner | null): Promise<SignOutPlan> {
    if (!owner) {
      const target = this.liveIdentity() ?? this.lastOwner
      const keepToken = target ? `${target.deploymentId}/${target.accountId}` : null
      for (const token of [...this.plannedRamOnly.keys()]) {
        if (token !== keepToken) this.plannedRamOnly.delete(token)
      }
    }
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
  async lockSession(
    owner?: LastOwner | null,
    onWaiting?: () => void,
    options?: { switch?: boolean },
  ): Promise<SignOutLockResult> {
    // UNI-1993: a source view belongs to the session, not to a stored document: it goes first
    await this.dropSourceViews()
    const target = owner ?? this.liveIdentity() ?? this.lastOwner
    if (!target) return { ok: true, captureFailed: [] }
    // d5-1: an account switch is already effective, so a refused park cannot
    // abort it; an explicit sign-out keeps the folder and aborts instead
    const switching = options?.switch === true
    const scopeToken = `${target.deploymentId}/${target.accountId}`
    const keystoreLocked = this.storeLocked()
    // d7-2/d1-3: what the plan of THIS scope just counted as RAM-only is not
    // counted again as lost; the entry is consumed here, so a plan of another
    // scope (or a later lock) can never reuse it
    const planned = this.plannedRamOnly.get(scopeToken)
    this.plannedRamOnly.delete(scopeToken)

    // EL-1(b): release held locks BEFORE the token / runtime go (capped)
    await this.releaseAllEditLocks(EDIT_LOCK_QUIT_CAP_MS)

    // Step 1: stop runtime, block new commits, bounded receipt wait (30s)
    this.sessionEpoch += 1
    this.endFirstSaveNaming()
    this.deps.stopRuntime?.()
    if (this.queueSession) {
      this.stoppingQueueSessions.add(this.queueSession.id)
    }
    const dirs = scopeWorkingCopyDirs(this.store.root, target)
    const savingPromises: Promise<unknown>[] = []
    if (this.queuePass) savingPromises.push(this.queuePass.catch(() => undefined))
    let hasInFlightRecord = false
    const open = !keystoreLocked
      ? await this.openStoreOf(target)
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

    // Mark the queue session dead so any late HTTP response writes nothing.
    // Deliberately AFTER the bounded wait above (unlike teardownSaveQueue, which
    // marks dead first): a pass that answers inside the wait must still record
    // its receipt so the document settles as committed instead of reconciling
    // (sign-out-lock tests 5/5b). New commits are already blocked by
    // stoppingQueueSessions, and the store lock below is last, so a late write
    // reads `interrupted`.
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
    const lostKeys = new Set<string>()
    let parked: ParkedStore | null = null
    if (!keystoreLocked && open.kind === 'ok' && intents) {
      const store = createParkedStore(open.records(PARKED_STORE_REGISTRATION.name))
      parked = store
      const parkBytes = async (
        key: string,
        binding: Binding,
        bytes: Uint8Array,
      ): Promise<boolean> => {
        try {
          const res = await store.park({
            documentKey: key,
            binding: {
              ...binding,
              state: 'dirty',
              minStoreLevel: APP_STORE_LEVEL,
              minAppVersion: this.buildVersion(),
            },
            bytes,
            parkedAt: this.nowIso(),
          })
          return res === 'ok'
        } catch {
          return false
        }
      }
      /**
       * A park of `tried` was refused. Sign-out: the folder is kept and the
       * lock reports `ok: false`. Switch (d5-1): the other candidate bytes are
       * tried (the d1-1 capture-failed fallback); when none parks, the
       * document is lost and counted, and its folder still goes, so no
       * plaintext of the leaving account stays readable by the next one.
       */
      const parkRefused = async (
        dir: string,
        key: string,
        binding: Binding,
        tried: Uint8Array,
        others: Array<Uint8Array | null>,
      ): Promise<void> => {
        if (!switching) {
          parkFailedDirs.add(dir)
          return
        }
        const triedHash = sha256Hex(tried)
        for (const bytes of others) {
          if (!bytes || sha256Hex(bytes) === triedHash) continue
          if (await parkBytes(key, binding, bytes)) return
        }
        lostKeys.add(key)
      }
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
          if (candidateBytes && !(await parkBytes(key, binding, candidateBytes))) {
            await parkRefused(dir, key, binding, candidateBytes, [
              diskBytes && diskHash !== binding.baseChecksum ? diskBytes : null,
            ])
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
          if (!(await parkBytes(key, binding, diskBytes))) {
            await parkRefused(dir, key, binding, diskBytes, [
              this.findNewestRecoveryBytes(path, diskMtimeMs),
            ])
          }
        } else if (captureNeeded) {
          // the disk still holds only the base bytes: the capture did not land
          captureFailedKeys.add(key)
          const recoveryBytes = this.findNewestRecoveryBytes(path, diskMtimeMs)
          if (recoveryBytes && !(await parkBytes(key, binding, recoveryBytes))) {
            await parkRefused(dir, key, binding, recoveryBytes, [])
          }
        }
      }
    }

    // d6-2: on a switch whose leaving account's own store could not open (its
    // epoch moved, its key cannot be produced) nothing could be parked, yet the
    // folders still go below: every dirty or keep-local copy is lost and is
    // counted, so the notice tells it. A locked keychain of the live session is
    // already counted by the plan as RAM-only content.
    if (switching && !parked && !keystoreLocked) {
      for (const dir of dirs) {
        if (this.store.newerStoreIn(dir)) continue
        const binding = await this.store.readDir(dir)
        if (!binding) continue
        const path = join(dir, binding.filename)
        let dirty =
          KEEP_LOCAL_STATES.has(binding.state) ||
          this.editorDirty.has(path) ||
          this.editorDirty.has(pathKey(path))
        if (!dirty && this.store.exists(path)) {
          try {
            dirty = sha256Hex(new Uint8Array(readFileSync(path))) !== binding.baseChecksum
          } catch {
            // an unreadable copy has no bytes to keep
          }
        }
        if (!dirty && this.deps.isPathOpen(path) && this.deps.editorStateOf) {
          dirty = (await this.editorState(path)).dirty === true
        }
        if (dirty) lostKeys.add(basename(dir))
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

    // Step 5: clear all 16 in-memory caches on the service
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
    this.remoteLockPath.clear()
    this.editorAi.clear()
    this.remoteDecisions.clear()
    this.remoteReloads.clear()
    this.orgMemberNames.clear()
    this.orgMemberNamesOrg = null
    this.notedOrgId = null
    this.orgMemberNamesInFlight = null
    this.workspaceMemberNames.clear()
    this.workspaceMemberNamesInFlight.clear()
    this.workspaceMemberNamesOrg = null
    this.avatarCache.clear()
    this.sessionAccountKey = null
    this.migratedScopes.delete(scopeToken)
    this.limitsCache.reset()
    this.coordinator.resetSessionWarnings()

    // Step 6: lock the encrypted store for this scope
    await this.deps.syncStore?.lock({
      deploymentId: target.deploymentId,
      accountId: target.accountId,
    })
    this.syncOpen = null
    this.storeOpenKind = 'unknown'
    const captureFailed = [...captureFailedKeys]
    if (planned) for (const key of planned) lostKeys.delete(key)
    // The single `done` of a sign-out is pushed by the caller's finally (the
    // wiring's lockStore), so it also fires when this method throws.

    return {
      ok: parkFailedDirs.size === 0,
      captureFailed,
      ...(lostKeys.size > 0 ? { lost: [...lostKeys] } : {}),
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
    const scopeToken = `${target.deploymentId}/${target.accountId}`
    this.lockedScopes.delete(scopeToken)
    // d1-3: a plan of a scope that is live again is stale; it must not suppress
    // the lost count of that scope's next lock
    this.plannedRamOnly.delete(scopeToken)
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
    const clearedPaths: string[] = []
    for (const [key, lock] of [...this.locks]) {
      if (lock.reason === 'signed_out') {
        this.locks.delete(key)
        cleared = true
        clearedPaths.push(lock.path)
      }
    }
    if (cleared) this.deps.pushLocks?.()
    for (const p of clearedPaths) this.notifyDocStateChanged(p)
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
    this.coordinator.clearPendingNext(doc.path)
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
    const bound = binding && binding.documentId === documentId ? binding : null
    if (bound) {
      if (KEEP_LOCAL_STATES.has(bound.state) || bound.state === 'saving') return true
      // the editor holds edits the file does not show yet: keeping the index
      // entry keeps the tab's document reachable until the save lands
      if (this.editorDirty.has(join(dir, bound.filename))) return true
      const access = await this.intentAccess()
      // the store cannot answer: keep the copy rather than evict local work
      if (access.kind !== 'ok') return true
      // the editor signal was read before this await: an editor that turned
      // dirty while the store was answering is local work too, so re-read it
      // here instead of evicting the entry the tab still needs
      if ((await access.intents.get(documentId)) !== null) return true
    }
    // B34 (UNI-1362): a kept draft - the user's snapshot of a cancelled intent -
    // is local work as well, and it lives in its own store, never in the intent
    // one. A closed document whose only local work is a kept draft must still
    // answer true: the offline library asks this before an unpin deletes the
    // committed copy, and the feed's resync asks it before evicting the index
    // entry. Read only: the draft bytes are never touched.
    //
    // R1-1: this runs even without a readable binding. A copy whose plaintext
    // folder the sign-out deleted (never parked: it was clean) or that was
    // never opened here has no binding at all, and the kept draft of it is
    // still the user's work - answering "nothing local" there loses it.
    if ((await this.hasKeptDraft(documentId)) === true) return true
    return bound ? this.editorDirty.has(join(dir, bound.filename)) : false
  }

  /**
   * B34 (UNI-1362): whether the drafts store holds at least one kept draft of
   * `documentId`. The store is only read, never written.
   *
   * R1-2: every outcome that cannot prove "no draft" answers true, because the
   * callers use this to decide whether deleting or evicting the copy is safe: a
   * store that will not open, a namespace this build cannot reach, a read the
   * boundary refused or interrupted, and a read that throws all leave the draft
   * unproven, so they count as local work. Only a readable record with no
   * entries answers false.
   */
  private async hasKeptDraft(documentId: string): Promise<boolean> {
    try {
      const open = await this.openSyncStore()
      if (open.kind !== 'ok') return true
      const drafts = createDraftStore(open.records(DRAFTS_STORE_REGISTRATION.name))
      return (await drafts.has(documentId)) !== false
    } catch {
      return true
    }
  }

  /**
   * G8-16 S16: the selected organization changed. The member-name map belongs
   * to one org, so it is dropped (the library lists are re-read by the
   * renderer on the same status push; nothing else here caches a library).
   * FD-11 / FD11-C-R1-04: changing the organization also bumps `sessionEpoch`
   * so an in-flight own action from the previous org never pushes `treeChanged`
   * after the switch.
   *
   * An org-less status push is ambiguous, so the caller says which it is:
   * `orgGone` false = a transient `/orgs` read failure (status.orgsError set)
   * keeps the last known org and does not bump, so A -> null -> A is not a
   * boundary; `orgGone` true = a lasting loss (the chosen org deactivated or
   * the S16 picker came back: org undefined without orgsError) latches null
   * and bumps when the session actually had an org.
   */
  noteSelectedOrg(orgId: string | null, orgGone = false): void {
    // SIZE-F1: the limits refresh is deduplicated per org. A transient org-less
    // push (orgGone false) is not a boundary, so it keeps the noted org and
    // A -> null -> A does not re-read the limits; a lasting loss forgets it.
    const orgKnown = orgId !== null || orgGone
    const changed =
      (orgKnown && this.notedOrgId !== orgId) ||
      (this.orgMemberNamesOrg !== null && this.orgMemberNamesOrg !== orgId)
    if (orgKnown) this.notedOrgId = orgId
    const prevOrgId =
      this.sessionOrgId !== undefined ? this.sessionOrgId : (this.deps.selectedOrg()?.id ?? null)
    if (orgId !== null) {
      this.sessionOrgId = orgId
      if (prevOrgId !== null && prevOrgId !== orgId) {
        this.sessionEpoch += 1
        this.endFirstSaveNaming()
      }
    } else if (orgGone) {
      this.sessionOrgId = null
      if (prevOrgId !== null) {
        this.sessionEpoch += 1
        this.endFirstSaveNaming()
      }
    } else if (this.sessionOrgId === undefined) {
      this.sessionOrgId = prevOrgId
    }
    if (this.orgMemberNamesOrg !== null && this.orgMemberNamesOrg !== orgId) {
      this.orgMemberNames = new Map()
      this.orgMemberNamesOrg = null
    }
    if (this.orgMemberNamesInFlight && this.orgMemberNamesInFlight.orgId !== orgId) {
      this.orgMemberNamesInFlight = null
    }
    if (
      orgKnown &&
      ((this.workspaceMemberNamesOrg !== null && this.workspaceMemberNamesOrg !== orgId) ||
        (prevOrgId !== null && prevOrgId !== orgId))
    ) {
      this.workspaceMemberNames.clear()
      this.workspaceMemberNamesInFlight.clear()
      this.workspaceMemberNamesOrg = orgId
      this.avatarCache.clear()
    }
    if (changed && orgId && this.deps.identity()) {
      void this.limitsCache.refresh().catch(() => undefined)
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
    const clearedPaths: string[] = []
    for (const [key, lock] of [...this.locks]) {
      if (lock.reason === 'keystore_locked') {
        this.locks.delete(key)
        cleared = true
        clearedPaths.push(lock.path)
      }
    }
    // the renderer's list is its own: it must be told the list changed, or a
    // Retry that worked leaves the S11 panel up until some other push
    if (cleared) this.deps.pushLocks?.()
    for (const p of clearedPaths) this.notifyDocStateChanged(p)
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
      this.remoteLockPath.delete(doc.binding.documentId)
    }
    // pathKey lowercases the filename on Windows, so lookup(pathKey) misses
    // (`Plan.docx` !== `plan.docx`) and the bar loop cannot drop the verdict.
    // remoteLockPath keeps the real path lockFromServer saw.
    for (const [documentId, path] of [...this.remoteLockPath]) {
      if (!match(path)) continue
      this.remoteLocked.delete(documentId)
      this.remoteHeld.delete(documentId)
      this.remoteLockPath.delete(documentId)
    }
  }

  private recordLock(
    store: NewerStore,
    reason: UniworkLockReason = 'store_newer',
    libraryOff?: boolean,
  ): void {
    const lock: UniworkDocLock = {
      path: store.path,
      reason,
      name: store.name,
      ...(libraryOff ? { libraryOff: true } : {}),
    }
    this.locks.set(pathKey(lock.path), lock)
    this.deps.pushLock?.(lock)
    this.notifyDocStateChanged(lock.path)
  }

  /**
   * G5-05u (B5): the offline library refused to open a pinned document's copy.
   * The reason is an S11 row ("Lý do bị chặn"); `libraryOff` says the org turned
   * offline documents off, so the lease cannot be renewed (`uwLockLibraryOff`).
   */
  recordOfflineLock(lock: {
    path: string
    name: string
    reason: UniworkLockReason
    libraryOff?: boolean
  }): void {
    this.recordLock({ path: lock.path, name: lock.name }, lock.reason, lock.libraryOff)
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
      found.doc.binding.shelved === true ||
      !this.ownsLocally(found.doc) ||
      this.coordinator.isOtherWindow(found.doc.key) ||
      this.editLockReadOnly(found.doc.path)
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
    // SAVE-01: a first-save flush waits on this hook even for a path that is
    // not bound yet (no binding before the first upload); release it anyway
    if (!doc || !this.ownsLocally(doc)) {
      this.draftFlushWaiters.get(pathKey(path))?.(true)
      return
    }
    this.lastUserSave.set(doc.path, ++this.saveCounter)
    // the module just wrote what its editor held
    this.editorDirty.delete(doc.path)
    const flushKey = pathKey(doc.path)
    const flush = this.draftFlushWaiters.get(flushKey)
    if (flush) {
      this.draftFlushWaiters.delete(flushKey)
      flush(true)
      // The hook may be the user's own Save landing in the flush window: it is
      // consumed here (the flush never uploads), so nothing else will hash the
      // file. Re-decide dirty from the file vs base now, so a copy that was
      // never uploaded cannot read saved whatever the dialog does next.
      void this.refreshDirty(doc).catch(() => undefined)
      return
    }
    // the sweep still owns this copy's pre-store intent: nothing is sent, and
    // a binding write here would drop the intent (the open retries the sweep)
    if (this.awaitingMigration(doc)) {
      void this.openSyncStore().catch(() => undefined)
      this.refuseMigration(doc)
      return
    }
    // UNI-1959: the first save of a document created blank asks name + folder;
    // the upload below waits for the verdict. An ask already open for this path
    // is checked BEFORE eligibility is read again: the dialog's own rename
    // changes the title the fallback predicate reads, and must not release the
    // hold (BE-2). While it is open the edits the module just wrote are unsent
    // work, so the copy stays dirty (BE-1) and a second Save only waits.
    const key = pathKey(doc.path)
    if (this.firstSaveOps.has(key)) {
      this.editorDirty.add(doc.path)
      return
    }
    const session = this.wantsFirstSaveName(doc) ? this.captureActionSessionOrNull() : null
    if (session) {
      const op: FirstSaveOp = {
        session,
        documentId: doc.binding.documentId,
        requestId: null,
        cancelled: false,
      }
      this.firstSaveOps.set(key, op)
      this.editorDirty.add(doc.path)
      void this.askFirstSaveName(op, doc)
        .then((answer) => {
          const live = this.firstSaveOpLive(op)
          if (this.firstSaveOps.get(key) === op) this.endFirstSaveOp(key)
          // a verdict that lands after the tab closed or the session ended resumes nothing
          if (!live) return
          if (answer === 'cancel') {
            this.afterFirstSaveCancelled(path)
            return
          }
          // only the person's own verdict marks the document named: an unavailable
          // dialog host (nobody was asked) leaves the next Save to ask
          if (answer === 'continue') this.markFirstSaveNamed(op)
          const now = this.store.lookup(path)
          if (!now || now.binding.documentId !== op.documentId || !this.ownsLocally(now)) return
          this.editorDirty.delete(now.path)
          this.saveAfterFirstSaveName(path)
        })
        // a store that throws here leaves the op ended and the edits unsent
        .catch(() => undefined)
      return
    }
    this.saveAfterFirstSaveName(path)
  }

  /**
   * G5-06u: the user's own Save: a pending intent is not replayed and no
   * second one is minted; the coordinator asks for the queue popover instead.
   * Only a shell tab has the pill and popover: a detached editor window keeps
   * the inline replay, so its Ctrl/Cmd+S is never a silent no-op (RBE6u-03)
   */
  private saveAfterFirstSaveName(path: string): void {
    void this.coordinator.save(path, { userSave: this.deps.isShellTab?.(path) ?? true })
  }

  /**
   * UNI-1959 (the web's first-save-naming predicate): a document never saved -
   * file version 1 - that this app created blank from the menu in this session
   * or, after a restart, that still carries one of the default blank titles,
   * and has not been asked yet. Version 1 is the one invariant: a document that
   * reached version 2 by any save (a detached window, the chip) is never asked.
   * A detached editor window has no dialog host, so it never asks.
   */
  private wantsFirstSaveName(doc: BoundDocument): boolean {
    if (!this.deps.requestFirstSaveName) return false
    if (this.deps.isShellTab?.(doc.path) === false) return false
    const key = this.firstSaveKeyOf(doc.binding.documentId)
    if (!key) return false
    if (doc.binding.baseVersion !== 1) {
      this.createdBlank.delete(key)
      return false
    }
    if (this.firstSaveNamed.has(key)) return false
    return this.createdBlank.has(key) || isBlankDefaultTitle(doc.binding.title)
  }

  /** `firstSaveNamed` / `createdBlank` are keyed by account too: a shared document is another account's own question */
  private firstSaveKeyOf(documentId: string): string | null {
    const identity = this.deps.identity()
    return identity ? `${identity.deploymentId}/${identity.accountId}/${documentId}` : null
  }

  private markFirstSaveNamed(op: FirstSaveOp): void {
    const key = this.firstSaveKeyOf(op.documentId)
    if (!key) return
    this.firstSaveNamed.add(key)
    this.createdBlank.delete(key)
  }

  /** the operation may still act: not cancelled, and its session is the live one */
  private firstSaveOpLive(op: FirstSaveOp): boolean {
    return !op.cancelled && this.sessionLive(op.session)
  }

  /** cancel one operation and take its dialog off the renderer's queue */
  private cancelFirstSaveOp(op: FirstSaveOp): void {
    if (op.cancelled) return
    op.cancelled = true
    for (const [key, held] of this.firstSaveOps) if (held === op) this.endFirstSaveOp(key)
    if (op.requestId) {
      try {
        this.deps.dismissFirstSaveName?.(op.requestId)
      } catch {
        // the dialog host is gone with the window; there is nothing to drop
      }
    }
  }

  /** the op of `key` is over: the path is free, and a waiting close starts its upload window */
  private endFirstSaveOp(key: string): void {
    this.firstSaveOps.delete(key)
    for (const listener of [...this.firstSaveOpEnded]) listener(key)
  }

  /** a tab or window of `path` is gone: its naming operation goes with it */
  private cancelFirstSaveFor(path: string): void {
    const op = this.firstSaveOps.get(pathKey(path))
    if (op) this.cancelFirstSaveOp(op)
  }

  /** a session boundary: every operation is cancelled and dismissed, and nothing remembered about naming survives */
  private endFirstSaveNaming(): void {
    for (const op of [...this.firstSaveOps.values()]) this.cancelFirstSaveOp(op)
    this.firstSaveOps.clear()
    this.createdBlank.clear()
    this.firstSaveNamed.clear()
  }

  /**
   * The person gave up naming: nothing is sent and the edits the editor wrote
   * stay unsent work. The chip is published so a waiting close attempt hears it.
   */
  private afterFirstSaveCancelled(path: string): void {
    const doc = this.store.lookup(path)
    if (!doc || !this.ownsLocally(doc)) return
    this.editorDirty.add(doc.path)
    this.publish(this.statusOf(doc))
    void this.refreshDirty(doc).catch(() => undefined)
  }

  /**
   * Reads where the document sits now, asks the renderer for the dialog and
   * answers its outcome. Every step is revalidated against the session that
   * started the operation: metadata that lands after a sign-out, an account or
   * organization change, or after the tab closed is never shown. An unreadable
   * document (offline, gone) or a missing / failing dialog host is
   * `unavailable`: the save is not blocked, but nothing was confirmed.
   */
  private async askFirstSaveName(
    op: FirstSaveOp,
    doc: BoundDocument,
  ): Promise<'continue' | 'cancel' | 'unavailable'> {
    let ref: DocumentRef
    try {
      ref = await this.api().documentRef(op.documentId)
    } catch {
      return 'unavailable'
    }
    if (!this.firstSaveOpLive(op)) return 'cancel'
    const requestId = `fsn-${randomUUID()}`
    op.requestId = requestId
    try {
      return await this.deps.requestFirstSaveName!({
        requestId,
        path: doc.path,
        documentId: op.documentId,
        workspaceId: ref.workspaceId || doc.binding.workspaceId,
        title: ref.title,
        parentId: ref.parentId,
      })
    } catch {
      return 'unavailable'
    }
  }

  /**
   * EL-1(b) fix6 (VEL-1): an editor module's explicit Save while the bound
   * working copy is read-only. Never writes and never fires the user-save
   * hook; asks the shell renderer to open the explain popover for that path.
   */
  onReadOnlySave(path: string): void {
    const doc = typeof path === 'string' ? this.store.lookup(path) : null
    if (!doc || !this.ownsLocally(doc)) return
    if (!this.isReadOnly(doc.path)) return
    const status = this.statusOf(doc)
    this.publish(status)
    if (this.deps.isShellTab?.(doc.path) ?? true) {
      this.deps.pushQueuePopover?.({ path: doc.path })
    }
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
   * MYFOLDER-01 / SAVE-01 (Q3): the Save dialog opens on this call, which lazily
   * creates and returns the caller's personal "My Folder" row (systemKind
   * `'my_folder'`); the "Đang lưu trong" row and the folder picker read it.
   */
  ensureMyFolder(workspaceId: string): Promise<UniworkResult<UniworkDocSummary>> {
    return result(async () => {
      const session = this.captureActionSession()
      const ws = typeof workspaceId === 'string' ? workspaceId : ''
      if (!ws) throw new UniworkDocError('not_found')
      const folder = await this.api().ensureMyFolder(ws)
      // a first ensure may have created the folder: its workspace's tree changed
      this.pushTreeChangedFor(session, folder.workspaceId)
      return folder
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
      // UNI-2047: type / updater / date filters and the sort go to every workspace
      const { types, updatedBy, updatedFrom, sort, order } = this.listFiltersOf(query)
      const filters: UniworkListFilters = {
        ...(types ? { types } : {}),
        ...(updatedBy ? { updatedBy } : {}),
        ...(updatedFrom ? { updatedFrom } : {}),
        ...(sort ? { sort } : {}),
        ...(order ? { order } : {}),
      }
      const workspaces = await api.listWorkspaces(org.id)
      const nameOf = new Map(workspaces.map((ws) => [ws.id, ws.name]))
      const merged = new Map<string, UniworkDocSummary>()
      await Promise.all(
        workspaces.map(async (ws) => {
          let cursor: string | undefined
          let pages = 0
          do {
            const page: Awaited<ReturnType<typeof api.listSharedWithMe>> =
              await api.listSharedWithMe({
                workspaceId: ws.id,
                cursor,
                limit: SHARED_PAGE_SIZE,
                ...(query.includePages === true ? { includePages: true } : {}),
                ...filters,
              })
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
      // each workspace answers in its own order, so the merge re-sorts by the
      // requested key; no sort/order = newest first, as before
      const all = [...merged.values()].sort(sharedComparator(sort, order))
      const limit = Math.min(
        SHARED_PAGE_SIZE,
        Math.max(1, Math.floor(Number(query.limit) || SHARED_PAGE_SIZE)),
      )
      const offset = parseOffsetCursor(query.cursor)
      const pageRows = all.slice(offset, offset + limit)
      const slice = this.avatarCache.materializeRows(pageRows)
      const workspaceIds = [
        ...new Set([
          ...workspaces.map((ws) => ws.id),
          ...pageRows.map((doc) => doc.workspaceId).filter(Boolean),
        ]),
      ]
      this.warmAvatarsInBackground(pageRows, workspaceIds)
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
        ownerKind: properties.ownerKind,
        shelvedAt: properties.shelvedAt,
        adminScope: properties.adminScope,
        archivedAt: properties.archivedAt,
      }
    })
  }

  // ---- S18: create, rename, archive ------------------------------------------

  /** FD-11: the workspace's whole folder tree, for the browser and the picker */
  folderTree(workspaceId: string): Promise<UniworkResult<UniworkFolderNode[]>> {
    return result(async () => {
      if (typeof workspaceId !== 'string' || !workspaceId) throw new UniworkDocError('not_found')
      return this.api().folderTree(workspaceId)
    })
  }

  /**
   * FD-11: one folder's contents (folders + files + pages, in the server's own
   * order); `parentId: null` is the workspace root.
   */
  listChildren(q: UniworkFolderQuery): Promise<UniworkResult<UniworkFolderChildren>> {
    return result(async () => {
      if (!q || typeof q.workspaceId !== 'string' || !q.workspaceId) {
        throw new UniworkDocError('not_found')
      }
      const page = await this.api().listChildren({
        workspaceId: q.workspaceId,
        parentId: typeof q.parentId === 'string' && q.parentId ? q.parentId : null,
        ...(typeof q.cursor === 'string' ? { cursor: q.cursor } : {}),
        ...(typeof q.limit === 'number' ? { limit: q.limit } : {}),
        ...this.listFiltersOf(q),
      })
      const items = await this.enrichWorkspaceRows(q.workspaceId, page.documents)
      return { items, nextCursor: page.nextCursor }
    })
  }

  /** FD-11: title search across a workspace; every hit carries its own path */
  searchDocuments(q: UniworkSearchQuery): Promise<UniworkResult<UniworkSearchPage>> {
    return result(async () => {
      if (!q || typeof q.workspaceId !== 'string' || !q.workspaceId) {
        throw new UniworkDocError('not_found')
      }
      const types = normalizeTypePicks(q.types)
      const shelved = q.shelved === true
      const page = await this.api().searchDocuments({
        workspaceId: q.workspaceId,
        query: typeof q.query === 'string' ? q.query : '',
        kind: q.kind === 'folder' || q.kind === 'document' ? q.kind : 'all',
        ...(types.length > 0 ? { types } : {}),
        ...(shelved ? { shelved: true } : {}),
        ...(typeof q.cursor === 'string' ? { cursor: q.cursor } : {}),
        ...(typeof q.limit === 'number' ? { limit: q.limit } : {}),
      })
      // a shelf hit carries its shelver by name like a shelf row, for the Lưu trữ bởi chip and column
      const items = shelved
        ? await this.enrichShelvedRows(q.workspaceId, page.documents)
        : await this.enrichWorkspaceRows(q.workspaceId, page.documents)
      return { items, nextCursor: page.nextCursor }
    })
  }

  /**
   * FD-11: create one folder. The name follows the folder rule (trim + NFC,
   * 1..255 runes, both field errors); a name already taken among its siblings
   * is the server's 409 `folder_name_taken`, which the renderer also shows at
   * the field - only folders collide.
   */
  /**
   * FD-11: notify the tree-changed coalescer for `workspaceId` only while the
   * session that started the action (`started`) is still the live session. A
   * response arriving after sign-out, account switch, organization change, or
   * `lockSession` must not reopen a coalescer window for the outgoing scope.
   */
  private captureActionSessionOrNull(): {
    identity: SessionIdentity
    epoch: number
    apiOrigin: string | null
  } | null {
    const identity = this.liveIdentity()
    if (!identity) return null
    if (this.sessionOrgId === undefined) {
      this.sessionOrgId = this.deps.selectedOrg?.()?.id ?? null
    }
    return {
      identity,
      epoch: this.sessionEpoch ?? 0,
      apiOrigin: this.deps.profile?.()?.apiOrigin ?? null,
    }
  }

  private captureActionSession(): {
    identity: SessionIdentity
    epoch: number
    apiOrigin: string | null
  } {
    const session = this.captureActionSessionOrNull()
    if (!session) throw new UniworkDocError('not_signed_in')
    return session
  }

  /** the session that started an async action is still the live one (same epoch, same device session, same origin) */
  private sessionLive(started: {
    identity: SessionIdentity
    epoch: number
    apiOrigin?: string | null
  }): boolean {
    if ((this.sessionEpoch ?? 0) !== started.epoch) return false
    const current = this.deps.identity()
    const owner = started.identity
    if (
      !current ||
      current.accountId !== owner.accountId ||
      current.deploymentId !== owner.deploymentId ||
      current.deviceSessionId !== owner.deviceSessionId
    ) {
      return false
    }
    if (started.apiOrigin !== undefined) {
      const currentOrigin = this.deps.profile?.()?.apiOrigin ?? null
      if (currentOrigin !== started.apiOrigin) return false
    }
    return true
  }

  private pushTreeChangedFor(
    started: { identity: SessionIdentity; epoch: number },
    workspaceId: string,
  ): void {
    if (!this.sessionLive(started)) return
    this.deps.pushTreeChanged?.({ workspaceId })
  }

  createFolder(
    input: UniworkCreateFolderInput,
  ): Promise<UniworkDocActionResult<UniworkDocSummary>> {
    return actionResult(
      async () => {
        const session = this.captureActionSession()
        const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
        if (!workspaceId) throw new UniworkDocError('not_found')
        const title = requireName(input.title, MAX_FOLDER_NAME_RUNES)
        const created = await this.api().createFolder({
          workspaceId,
          parentId: typeof input.parentId === 'string' && input.parentId ? input.parentId : null,
          title,
          idempotencyKey: this.newIdempotencyKey(),
        })
        // FD-11: the new folder is a row in its parent's tree and contents
        this.pushTreeChangedFor(session, created.workspaceId)
        return created
      },
      { nameField: true },
    )
  }

  /**
   * FD-11: move a document or folder under another folder (null = the root).
   * The client reads the current revision and retries the move once if the head
   * moved in between; `renamedTo` carries the title the server gave the entry
   * when a name collision made it rename itself ("Name (2)").
   */
  moveDocument(
    input: UniworkMoveDocumentInput,
  ): Promise<UniworkDocActionResult<UniworkMoveResult>> {
    return actionResult(async () => {
      const session = this.captureActionSession()
      const documentId = typeof input.documentId === 'string' ? input.documentId : ''
      if (!documentId) throw new UniworkDocError('not_found')
      const moved = await this.api().moveDocument({
        documentId,
        parentId: typeof input.parentId === 'string' && input.parentId ? input.parentId : null,
        idempotencyKey: this.newIdempotencyKey(),
      })
      // FD-11: the entry left one folder's rows and joined another's (both are
      // in the same workspace, which is all the push names)
      this.pushTreeChangedFor(session, moved.summary.workspaceId)
      return moved
    })
  }

  /**
   * Create a blank document (docx/xlsx/pptx/md/html/pdf) in a workspace/folder. The name is
   * validated before any call (empty -> `name_empty`, over 500 runes ->
   * `name_too_long`, no request), and the answer is the server document; the
   * caller opens it by id, so no second local copy exists. A duplicate name is
   * allowed: the request goes out and the server decides.
   */
  createDocument(input: UniworkCreateDocInput): Promise<UniworkDocActionResult<UniworkDocSummary>> {
    return actionResult(
      async () => {
        const session = this.captureActionSession()
        const target = this.docTarget(input)
        const name = requireName(input.name)
        const created = await this.api().createBlank({
          workspaceId: target.workspaceId,
          format: input.format,
          title: name,
          ...target.create,
          idempotencyKey: this.newIdempotencyKey(),
        })
        // UNI-1959: a default-named blank (the menu / strip) is never saved yet - its
        // first user save asks name + folder. A document the person named in the
        // retained dialog is placed already and never asks (BE-6); a response that
        // lands after the session ended marks nothing (BE-9).
        const marked = isBlankDefaultTitle(name) ? this.firstSaveKeyOf(created.id) : null
        if (marked && this.sessionLive(session)) this.createdBlank.add(marked)
        // FD-11: a new document changes the folder's contents for every view
        this.pushTreeChangedFor(session, target.workspaceId)
        return created
      },
      { nameField: true, flagMissingEndpoint: true },
    )
  }

  /**
   * UNI-1953: create a UniNote (a `page`) the way createDocument creates a blank
   * file: same name check, same My Folder / parent rule, same tree-changed
   * push. The app has no page editor, so the caller opens the answer on the web.
   */
  createPage(input: UniworkCreatePageInput): Promise<UniworkDocActionResult<UniworkDocSummary>> {
    return actionResult(
      async () => {
        const session = this.captureActionSession()
        const target = this.docTarget(input)
        const name = requireName(input.name)
        const created = await this.api().createPage({
          workspaceId: target.workspaceId,
          title: name,
          ...target.create,
          idempotencyKey: this.newIdempotencyKey(),
        })
        this.pushTreeChangedFor(session, target.workspaceId)
        return created
      },
      // a server without the pages route (404 / 501) disables the UniNote kind like
      // any other create; a folder create keeps ordinary errors (its row never disables)
      { nameField: true, flagMissingEndpoint: true },
    )
  }

  /**
   * Upload one local file as a UniWork document. Main resolves the file name's
   * extension first (`unsupported_format` before any read when the formats table
   * does not know it - the picker's filter alone is not a contract), stats the
   * file (a pick past the configured `documents.limits.upload_max_bytes`, 200 MiB
   * by default, is refused unread with `too_large`), then sends it: a file above
   * the server's `chunked_upload_threshold_bytes` (BIGUP-A1) goes through an
   * upload session - parts straight to the storage's presigned URLs, never the
   * whole file in RAM - and anything smaller through the one multipart POST.
   * Progress is pushed with the bytes actually sent, and `phase: 'checking'`
   * while the server validates a chunked upload; the title is the file name
   * (the server's own default). Nothing is written locally: the working copy is
   * the download the open flow makes from the created document.
   *
   * The upload is reachable for the dialog's Cancel through its own `uploadId`:
   * `cancelUpload` aborts the read and the POST (or the in-flight part PUTs) and
   * aborts the upload session, and this call then answers `upload_cancelled`. An
   * abort that lands after D already answered 2xx is ignored - the created
   * document is returned as usual (never a hidden delete).
   */
  uploadDocument(input: UniworkUploadDocInput): Promise<UniworkDocActionResult<UniworkDocSummary>> {
    return actionResult(async () => {
      const session = this.captureActionSession()
      const target = this.docTarget(input)
      const uploadId = requireUploadId(input.uploadId)
      if (typeof input.path !== 'string' || !input.path) throw new UniworkDocError('not_found')
      const filename = basename(input.path)
      if (!filename) throw new UniworkDocError('not_found')
      // R1-1: the picker's native filter is not a contract - a typed path or a
      // direct IPC call reaches here with any basename. A document whose
      // extension the formats table does not resolve could never be opened
      // afterwards (formatForName is the same authority the open flow uses), so
      // it is refused before the stat, the read and the POST.
      if (!formatForName(filename)) throw new UniworkDocError('unsupported_format')
      // the controller is registered before the first await: a Cancel that lands
      // while the file is still being stat'ed finds the upload and is never
      // dropped (R2-1)
      const controller = new AbortController()
      this.uploads.set(uploadId, controller)
      try {
        let size: number
        let mtimeMs: number
        try {
          const info = await stat(input.path)
          if (!info.isFile()) throw new UniworkDocError('not_found')
          size = info.size
          mtimeMs = info.mtimeMs
        } catch (error) {
          throw error instanceof UniworkDocError ? error : new UniworkDocError('not_found')
        }
        // a Cancel during the stat: answer it before the read and the POST
        if (controller.signal.aborted) throw cancelledUpload()
        const limits = await this.limitsCache.get()
        if (controller.signal.aborted) throw cancelledUpload()
        assertUploadSize(filename, size, limits)
        const singleRequest = (): Promise<UniworkDocSummary> =>
          this.uploadSingleRequestDocument({
            uploadId,
            path: input.path,
            filename,
            size,
            target,
            limits,
            controller,
          })
        const created = shouldUseChunkedUpload(size, limits)
          ? await this.uploadChunkedDocument({
              uploadId,
              path: input.path,
              filename,
              size,
              mtimeMs,
              target,
              limits,
              controller,
            }).catch(async (error: unknown) => {
              // BIGUP-A1: the server refused the session because the file is at
              // or under its own threshold - the limits cache was stale. The
              // file fits one request, so that is the path to take.
              if (
                error instanceof UniworkDocError &&
                error.serverCode === 'upload_session_too_small'
              ) {
                return await singleRequest()
              }
              throw error
            })
          : await singleRequest()
        // FD-11: the uploaded document is a new row in its folder
        this.pushTreeChangedFor(session, target.workspaceId)
        return created
      } finally {
        // a newer upload with the same id (never minted twice) keeps its controller
        if (this.uploads.get(uploadId) === controller) this.uploads.delete(uploadId)
      }
    })
  }

  /**
   * The one-request upload: main buffers the file and sends it as the multipart
   * `file` part. Bounded by the 50 MiB staging cap, so the buffer is small; a
   * file the server answers `too_large` for (a stale limits cache) is re-wrapped
   * with the basename and the size main actually sent.
   */
  private async uploadSingleRequestDocument(input: {
    uploadId: string
    path: string
    filename: string
    size: number
    target: { workspaceId: string; create: UniworkCreateTarget }
    limits: DocumentLimits
    controller: AbortController
  }): Promise<UniworkDocSummary> {
    const { uploadId, path, filename, target, limits, controller } = input
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await readFile(path, { signal: controller.signal }))
    } catch {
      if (controller.signal.aborted) throw cancelledUpload()
      throw new UniworkDocError('not_found')
    }
    // the read can also resolve just as the abort lands: no POST then
    if (controller.signal.aborted) throw cancelledUpload()
    const total = bytes.byteLength
    assertUploadSize(filename, total, limits)
    this.deps.pushUploadProgress?.({ uploadId, path, loaded: 0, total })
    const created = await this.api()
      .createFile({
        workspaceId: target.workspaceId,
        bytes,
        filename,
        title: filename,
        ...target.create,
        idempotencyKey: this.newIdempotencyKey(),
        signal: controller.signal,
      })
      .catch((error: unknown) => {
        // the person cancelled while the POST was in flight: that is the
        // answer, not the network failure the abort surfaced as
        if (controller.signal.aborted) throw cancelledUpload()
        if (error instanceof UniworkDocError && error.code === 'too_large') {
          rethrowServerTooLarge(error, filename, total, limits)
        }
        throw error
      })
    this.deps.pushUploadProgress?.({ uploadId, path, loaded: total, total })
    return created
  }

  /**
   * BIGUP-A1: the chunked upload of one new document. The probe is read from
   * the file's head and ZIP tail (bounded, never the whole file), a session is
   * opened for the workspace, the parts go to the storage's presigned URLs four
   * at a time, and `complete` creates the document. The session id and the
   * finished parts are persisted in the `upload-sessions` store, so a restart
   * (or a re-pick of the same, unmodified file) resumes instead of re-sending
   * everything; the record is removed once the document exists or the person
   * cancelled.
   *
   * A `422 upload_session_too_small` is the threshold having drifted under us
   * (a cached limit, a server changed between the stat and the call): the file
   * is small enough for one request, so the single-request path runs instead.
   */
  private async uploadChunkedDocument(input: {
    uploadId: string
    path: string
    filename: string
    size: number
    mtimeMs: number
    target: { workspaceId: string; create: UniworkCreateTarget }
    limits: DocumentLimits
    controller: AbortController
  }): Promise<UniworkDocSummary> {
    const { uploadId, path, filename, size, mtimeMs, target, limits, controller } = input
    const format = formatForName(filename)!
    // the probe refuses a file the server would refuse anyway (a macro package,
    // a broken container) before one byte is sent
    const probe = await readLocalFileProbe({ path }, size, filename)
    const api = this.api()
    const resumeKey = uploadSessionKey(path, size, mtimeMs)
    const store = await this.uploadSessionStore()
    // the session route names its folder by id only (there is no `destination`
    // field), so a `my_folder` target is resolved to the caller's personal
    // folder first - the same row `POST .../documents/files` would land in
    const parentId = await this.uploadSessionParentId(api, target)
    const title = filename
    // R1-BE-03: resume only when the WHOLE create fingerprint still matches
    // (workspace, effective parent, title, filename). A record left by a failed
    // upload into folder A must never be resumed by a pick aimed at folder B -
    // the old session is aborted (best effort) and this run starts fresh.
    const saved = (await store?.get(resumeKey)) ?? null
    const resume = await this.resumeForCreate(api, saved, {
      workspaceId: target.workspaceId,
      folderId: parentId,
      title,
      filename,
    })
    const targetForSession: UploadSessionTarget = {
      kind: 'workspace',
      workspaceId: target.workspaceId,
      parentId,
      title,
    }
    const pushProgress = (loaded: number, total: number, phase?: 'checking'): void => {
      this.deps.pushUploadProgress?.({
        uploadId,
        path,
        loaded,
        total,
        ...(phase ? { phase } : {}),
      })
    }
    // R1-BE-02: the LIVE session id, held in memory for the whole operation so a
    // Cancel can issue the DELETE even when the resume store never accepted the
    // record (refused / full / unavailable). The store is a convenience, not the
    // authority on what to abort.
    let liveSessionId: string | null = null
    const result = await runChunkedUpload(api, {
      target: targetForSession,
      filename,
      size,
      readRange: (offset, length) => readFileRange(path, offset, length, controller.signal),
      probe,
      idempotencyKey: this.newIdempotencyKey(),
      ...(resume ? { resume } : {}),
      signal: controller.signal,
      freshIdempotencyKey: () => this.newIdempotencyKey(),
      onProgress: (loaded, total) => pushProgress(loaded, total),
      onPhase: (phase) => pushProgress(size, size, phase === 'checking' ? 'checking' : undefined),
      onSessionState: async (state) => {
        liveSessionId = state.sessionId
        await store?.put(resumeKey, {
          sessionId: state.sessionId,
          workspaceId: target.workspaceId,
          folderId: parentId,
          title,
          filename,
          path,
          size,
          mtimeMs,
          partSize: state.partSize,
          totalParts: state.totalParts,
          completedParts: state.completedParts,
          expiresAt: state.expiresAt,
          updatedAt: new Date().toISOString(),
        })
      },
    }).catch(async (error: unknown) => {
      if (controller.signal.aborted) {
        await this.abortChunkedUpload(api, resumeKey, liveSessionId)
        throw cancelledUpload()
      }
      if (error instanceof UniworkDocError && error.code === 'too_large') {
        rethrowServerTooLarge(error, filename, size, limits)
      }
      throw error
    })
    await store?.remove(resumeKey)
    if (result.kind === 'upload') {
      // the workspace route answers the created document; a staged upload here
      // would mean the server routed a create through the version shape
      throw new UniworkDocError('malformed_response')
    }
    // the create answer may omit the format; the extension main already
    // resolved is the same authority the open flow uses
    const created = result.document
    return created.format ? created : { ...created, format }
  }

  /** the resume store of the new-document chunked upload, or null without a store */
  private async uploadSessionStore(): Promise<UploadSessionStore | null> {
    const open = await this.openSyncStore()
    if (open.kind !== 'ok') return null
    return createUploadSessionStore(open.records(UPLOAD_SESSIONS_STORE_REGISTRATION.name))
  }

  /**
   * R1-BE-03: the saved session this command may resume from, or undefined.
   * Resume requires the WHOLE create fingerprint - workspace, effective parent
   * folder, title and file name - to match the record the session was opened
   * with. A record whose fingerprint differs (the same unchanged file re-picked
   * for another folder, or a first save retried under another title) describes a
   * DIFFERENT command, so the stale session is aborted best-effort and the run
   * starts fresh; a record written before this build carries no fingerprint and
   * is likewise never resumed.
   */
  private async resumeForCreate(
    api: UniworkDocsClient,
    saved: UploadSessionRecord | null,
    want: { workspaceId: string; folderId: string | null; title: string; filename: string },
  ): Promise<SavedUploadSession | undefined> {
    if (!saved || !saved.sessionId) return undefined
    const matches =
      saved.workspaceId === want.workspaceId &&
      (saved.folderId ?? null) === (want.folderId ?? null) &&
      saved.title === want.title &&
      saved.filename === want.filename
    if (!matches) {
      // the record is for another command: free its session so it cannot hold
      // quota for 24 h, then start over (a failed DELETE is logged, not fatal)
      await abortUploadSession(api, saved.sessionId).catch(() => undefined)
      return undefined
    }
    return {
      sessionId: saved.sessionId,
      partSize: saved.partSize,
      totalParts: saved.totalParts,
      completedParts: saved.completedParts,
      expiresAt: saved.expiresAt,
    }
  }

  /**
   * The folder id an upload session creates its document in. The session route
   * takes `parent_id` only (never the one-request route's `destination`), so a
   * `my_folder` target is resolved through the same idempotent `my-folder`
   * route the save dialog already calls - never left to the server's default,
   * which would put the document at the workspace root instead.
   */
  private async uploadSessionParentId(
    api: UniworkDocsClient,
    target: { workspaceId: string; create: UniworkCreateTarget },
  ): Promise<string | null> {
    if ('parentId' in target.create && target.create.parentId) return target.create.parentId
    return (await api.ensureMyFolder(target.workspaceId)).id
  }

  /**
   * Cancel a chunked upload: the session goes, and so does its saved record.
   * R1-BE-02: the DELETE is issued from the in-memory session id the running
   * operation holds - the resume store may have refused or never received the
   * record, and a Cancel must still free the server session. A failed DELETE is
   * NOT reported as clean: the typed code is logged and the saved record is
   * KEPT, so the next start can retry the abort (its session id survives).
   */
  private async abortChunkedUpload(
    api: UniworkDocsClient,
    resumeKey: string,
    liveSessionId: string | null,
  ): Promise<void> {
    const store = await this.uploadSessionStore().catch(() => null)
    const saved = await store?.get(resumeKey).catch(() => null)
    const sessionId = liveSessionId ?? saved?.sessionId ?? null
    if (sessionId) {
      try {
        await abortUploadSession(api, sessionId)
      } catch (error) {
        // only the typed code: a store/filesystem error can carry a local path
        console.warn(
          'uniwork docs: the upload session could not be aborted:',
          error instanceof UniworkDocError ? error.code : 'unknown',
        )
        return
      }
    }
    await store?.remove(resumeKey).catch(() => undefined)
  }

  /**
   * SAVE-01: the first Save to UniWork of a tab that is not bound yet. The
   * editor is flushed to disk (its own module Save, so unwritten state lands),
   * then `createFile` creates the document with the dialog's title and target -
   * `destination: 'my_folder'` (Advisor Q1/Q3) or the picked `parent_id` - and
   * the tab is bound exactly as the open-by-id flow binds: the working copy
   * moves into the document's store folder and a binding.json names it, so the
   * next Ctrl+S is a normal bound save with no dialog. The session is captured
   * at entry like every own action, so a sign-out mid-flight pushes nothing.
   *
   * `conflict` answers a path that is already bound (a double-submit or a
   * second Lưu racing the first): the document exists already, so creating
   * again would duplicate it.
   *
   * S01-R1-4: single-flight per path - a second call while an attempt of this
   * path runs JOINS it (the same promise answers both), so two submits can
   * never race two creates.
   */
  firstSave(input: UniworkFirstSaveInput): Promise<UniworkDocActionResult<UniworkDocSummary>> {
    const key =
      typeof input.tabPath === 'string' && input.tabPath ? pathKey(resolve(input.tabPath)) : ''
    if (!key) {
      return actionResult(() => this.runFirstSave(input), { nameField: true })
    }
    const running = this.firstSaveInFlight.get(key)
    if (running) return running
    const attempt = actionResult(() => this.runFirstSave(input), { nameField: true })
    this.firstSaveInFlight.set(key, attempt)
    void attempt.finally(() => {
      if (this.firstSaveInFlight.get(key) === attempt) this.firstSaveInFlight.delete(key)
    })
    return attempt
  }

  /**
   * The body of `firstSave` (the single-flight wrapper holds the join). Every
   * await that could observe a claim is followed by a fresh re-check: the path
   * may have been bound by another caller while this one flushed, read or
   * created (S01-R1-4).
   */
  private async runFirstSave(input: UniworkFirstSaveInput): Promise<UniworkDocSummary> {
    const session = this.captureActionSession()
    const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
    if (!workspaceId) throw new UniworkDocError('not_found')
    const tabPath = typeof input.tabPath === 'string' && input.tabPath ? resolve(input.tabPath) : ''
    if (!tabPath) throw new UniworkDocError('not_found')
    const key = pathKey(tabPath)
    const owner = `${session.identity.deploymentId}${session.identity.accountId}`
    // S01-R2-1: the IPC target is the exact runtime union, validated FIRST -
    // before the claimed-path classification (its binding.json read), the
    // flush, the stat, any file read or a request. A malformed target on a
    // store-owned or already-claimed path is invalid_destination, never a
    // conflict, and never touches the disk (S01-R1-5 pin stands)
    const createTarget = firstSaveTargetOf(input.target)
    // an already-bound path is never re-created, and neither is the original
    // of a first save this account already bound: its tab moved to the store
    // copy, so a retry from the old path finds a plain file and would create
    // a twin (S01-R1-3)
    if (this.claimedFirstSave(owner, tabPath)) throw new UniworkDocError('conflict')
    // S01-R2-4: the same refusal across a restart, from the account's durable record
    await this.refuseBoundFirstSave(session, owner, tabPath)
    const title = requireName(input.title)
    const filename = basename(tabPath)
    if (!filename || !formatForName(filename)) {
      throw new UniworkDocError('unsupported_format')
    }
    // the editor's own Save writes the bytes; unbound paths resolve the
    // flush waiter through the branch onUserSave keeps for them. A refused or
    // timed-out flush FAILS the save (S01-R1-1): uploading the stale disk
    // bytes would silently replace what the editor holds, so nothing is read
    // or sent.
    if (this.deps.isPathOpen(tabPath)) {
      const flushed = await this.flushEditorToDisk(tabPath)
      if (!flushed) {
        throw new UniworkDocError('first_save_flush_failed' as UniworkDocErrorCode)
      }
      if (this.claimedFirstSave(owner, tabPath)) throw new UniworkDocError('conflict')
    }
    // S01-R1-9: a real regular file, stat'ed before anything is read - the
    // path that is a directory (or is gone) is `not_found`, never an upload
    let size: number
    let mtimeMs: number
    try {
      const info = await stat(tabPath)
      if (!info.isFile()) throw new UniworkDocError('not_found')
      size = info.size
      mtimeMs = info.mtimeMs
    } catch (error) {
      throw error instanceof UniworkDocError ? error : new UniworkDocError('not_found')
    }
    // S01-R1-9 / merge M-2 (D-S1) / BIGUP-A1: the upload path's OWN preflight,
    // one shared guard - the server cap first, then the single-request staging
    // cap for a file the chunked path will not take - so a first save is refused
    // typed and unread exactly like an upload, details included
    const limits = await this.limitsCache.get()
    assertUploadSize(filename, size, limits)
    // BIGUP-A1: above the server's threshold the file goes up in parts through
    // an upload session. It is never buffered whole, so a 200 MiB first save no
    // longer needs 200 MiB of RAM; the working copy is the file itself, written
    // into the document's store folder below.
    if (shouldUseChunkedUpload(size, limits)) {
      return await this.runChunkedFirstSave({
        session,
        owner,
        tabPath,
        key,
        title,
        filename,
        size,
        mtimeMs,
        workspaceId,
        createTarget,
        limits,
        // the server may answer `upload_session_too_small` (a stale limits
        // cache): the file then fits one request, which is the path below
        onThresholdDrift: () =>
          this.runBufferedFirstSave({
            session,
            owner,
            tabPath,
            key,
            title,
            filename,
            workspaceId,
            createTarget,
            limits,
          }),
      })
    }
    return await this.runBufferedFirstSave({
      session,
      owner,
      tabPath,
      key,
      title,
      filename,
      workspaceId,
      createTarget,
      limits,
    })
  }

  /**
   * SAVE-01's original first save: main buffers the file and sends it as the
   * multipart `file` part (bounded by the 50 MiB staging cap), then binds the
   * created document. BIGUP-A1 keeps it as the path for a small file and as the
   * fallback when the server refuses a session as too small.
   */
  private async runBufferedFirstSave(input: {
    session: { identity: SessionIdentity; epoch: number }
    owner: string
    tabPath: string
    key: string
    title: string
    filename: string
    workspaceId: string
    createTarget: UniworkCreateTarget
    limits: DocumentLimits
  }): Promise<UniworkDocSummary> {
    const { session, owner, tabPath, key, title, filename, workspaceId, createTarget, limits } =
      input
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await readFile(tabPath))
    } catch {
      throw new UniworkDocError('not_found')
    }
    // the same re-check the upload runs on what it actually buffered: a file
    // that grew past the cap between the stat and the read is refused too
    assertUploadSize(filename, bytes.byteLength, limits)
    // the path may have been bound (another first save, an open) while the
    // flush, the stat or the read ran: its document wins, this attempt never
    // creates
    if (this.claimedFirstSave(owner, tabPath)) throw new UniworkDocError('conflict')
    // S01-R1-4: one Idempotency-Key per attempt, kept while the create's fate
    // is unknown: a retry after a lost answer replays it, so the server dedups
    // to one document.
    //
    // S01-R2-3: the key belongs to the exact attempt BODY. D fingerprints the
    // create by its checksum (fileCreateFingerprint, server
    // document_files.go), so the local fingerprint carries the bytes' sha256
    // too: edited bytes mint a NEW attempt under a NEW key - replaying a spent
    // key against different bytes is refused there and must never be sent.
    const destination =
      'parentId' in createTarget && createTarget.parentId
        ? `parent:${createTarget.parentId}`
        : 'my_folder'
    const bytesChecksum = sha256Hex(bytes)
    const keyFp = [owner, workspaceId, key, title, destination, bytesChecksum].join('')
    // S01-R2-4: the attempt's key and its durable record, written `pending`
    // BEFORE the request exists - a restart finds the key the create used
    const attempt = await this.beginFirstSaveAttempt(session, owner, key, keyFp)
    // one client per save: the create + the bind read share it, so a
    // session landing mid-flight does not turn the second call into a
    // fresh not_signed_in on the same action
    const api = this.api()
    const created = await this.runFirstSaveCreate(attempt, keyFp, (idempotencyKey) =>
      api
        .createFile({
          workspaceId,
          bytes,
          filename,
          title,
          idempotencyKey,
          ...createTarget,
        })
        .catch((error: unknown) => {
          // S01-R4-3: the server's own size refusal, after the local preflight
          // passed - re-wrapped exactly as the upload path does, so the renderer
          // gets the basename, the size and the cap, never a bare too_large
          if (error instanceof UniworkDocError && error.code === 'too_large') {
            rethrowServerTooLarge(error, filename, bytes.byteLength, limits)
          }
          throw error
        }),
    )
    return await this.bindFirstSaveDocument({
      session,
      owner,
      tabPath,
      key,
      title,
      filename,
      limits,
      api,
      created,
      bytesChecksum,
      attempt,
      onBindFailure: () => this.firstSaveKeys.delete(keyFp),
      writeWorkingCopy: (dir, name) => this.store.writeWorkingCopy(dir, name, bytes),
    })
  }

  /**
   * BIGUP-A1: the first save of a file above the server's chunked threshold. The
   * same flow as the one-request path - one Idempotency-Key per attempt body, a
   * create, then the bind - but the bytes never enter main: the probe reads the
   * head and the ZIP tail, the parts go straight to the storage, and the working
   * copy is written from the file itself. The attempt's fingerprint still names
   * the file's sha256 (streamed once, 1 MiB at a time), so a retry after an
   * edit mints a new key exactly as the buffered path does.
   */
  private async runChunkedFirstSave(input: {
    session: { identity: SessionIdentity; epoch: number }
    owner: string
    tabPath: string
    key: string
    title: string
    filename: string
    size: number
    mtimeMs: number
    workspaceId: string
    createTarget: UniworkCreateTarget
    limits: DocumentLimits
    /** the server refused the session as too small: the file fits one request */
    onThresholdDrift(): Promise<UniworkDocSummary>
  }): Promise<UniworkDocSummary> {
    const {
      session,
      owner,
      tabPath,
      key,
      title,
      filename,
      size,
      mtimeMs,
      workspaceId,
      createTarget,
    } = input
    const destination =
      'parentId' in createTarget && createTarget.parentId
        ? `parent:${createTarget.parentId}`
        : 'my_folder'
    const bytesChecksum = await sha256File(tabPath)
    // the path may have been bound while the checksum streamed
    if (this.claimedFirstSave(owner, tabPath)) throw new UniworkDocError('conflict')
    const keyFp = [owner, workspaceId, key, title, destination, bytesChecksum].join('')
    // S01-R2-4: see the buffered path - the durable record carries the key
    const attempt = await this.beginFirstSaveAttempt(session, owner, key, keyFp)
    let idempotencyKey = attempt.idempotencyKey
    const api = this.api()
    const probe = await readLocalFileProbe({ path: tabPath }, size, filename)
    const parentId = await this.uploadSessionParentId(api, {
      workspaceId,
      create: createTarget,
    })
    const resumeKey = uploadSessionKey(tabPath, size, mtimeMs)
    const store = await this.uploadSessionStore()
    // R1-BE-03: the same full-fingerprint rule as the new-document path - a
    // first save retried under another title or destination must not finish the
    // old command through the old session.
    const saved = (await store?.get(resumeKey)) ?? null
    const resume = await this.resumeForCreate(api, saved, {
      workspaceId,
      folderId: parentId,
      title,
      filename,
    })
    let result: ChunkedUploadResult
    try {
      result = await runChunkedUpload(api, {
        target: { kind: 'workspace', workspaceId, parentId, title },
        filename,
        size,
        readRange: (offset, length) => readFileRange(tabPath, offset, length),
        probe,
        idempotencyKey,
        ...(resume ? { resume } : {}),
        // R1-BE-08: a `409 idempotency_payload_mismatch` (or a session the
        // server no longer knows) restarts under a NEW key, and the rejected
        // one is dropped so no later retry of these bytes reuses it
        freshIdempotencyKey: () => this.newIdempotencyKey(),
        onIdempotencyKey: async (fresh) => {
          this.firstSaveKeys.set(keyFp, fresh)
          // the key this run leaves (refused, expired or unknown to D) is spent
          this.spentFirstSaveKeys.add(attempt.idempotencyKey)
          idempotencyKey = fresh
          // S01-R2-4: the record follows the key the run adopted (a restored key
          // D no longer knows, or one it refused, is replaced for good)
          attempt.idempotencyKey = fresh
          attempt.restored = false
          await this.saveFirstSaveRecord(attempt, { state: 'pending' })
        },
        onSessionState: async (state) => {
          await store?.put(resumeKey, {
            sessionId: state.sessionId,
            workspaceId,
            folderId: parentId,
            title,
            filename,
            path: tabPath,
            size,
            mtimeMs,
            partSize: state.partSize,
            totalParts: state.totalParts,
            completedParts: state.completedParts,
            expiresAt: state.expiresAt,
            updatedAt: new Date().toISOString(),
          })
        },
      })
    } catch (error) {
      if (error instanceof UniworkDocError && error.serverCode === 'upload_session_too_small') {
        // the limits cache was stale and the file fits one request
        await store?.remove(resumeKey)
        return await input.onThresholdDrift()
      }
      if (error instanceof UniworkDocError && error.code === 'too_large') {
        rethrowServerTooLarge(error, filename, size, input.limits)
      }
      if (error instanceof UniworkDocError && error.code === 'idempotency_mismatch') {
        // S01-R2-4: the key D refused is spent - not for this process, not for the next
        this.firstSaveKeys.delete(keyFp)
        this.spentFirstSaveKeys.add(attempt.idempotencyKey)
        await this.dropFirstSaveRecord(attempt)
      }
      throw error
    }
    await store?.remove(resumeKey)
    if (result.kind === 'upload') throw new UniworkDocError('malformed_response')
    const created = result.document
    // R1-BE-04: the chunked path copies the LIVE file after the server has
    // validated the uploaded bytes. If the editor autosaved (or another process
    // replaced the file) during the upload/checking interval, the copy would be
    // a different generation than the document the server created, and binding
    // it `ready` would silently declare those mismatched bytes as saved. The
    // copied working copy is therefore stream-hashed and must equal BOTH the
    // pre-upload hash and the server's own `checksum_sha256`; otherwise nothing
    // is bound, the created row is compensated, and the user's file is left
    // untouched (a disk copy, never a whole-file buffer).
    return await this.bindFirstSaveDocument({
      session,
      owner,
      tabPath,
      key,
      title,
      filename,
      limits: input.limits,
      api,
      created,
      bytesChecksum,
      attempt,
      onBindFailure: () => this.firstSaveKeys.delete(keyFp),
      writeWorkingCopy: (dir, name) => this.store.copyIntoWorkingCopy(dir, name, tabPath),
      verifyWorkingCopy: async (copiedPath, serverChecksum) => {
        const copied = await sha256File(copiedPath)
        if (copied !== bytesChecksum || serverChecksum !== copied) {
          throw new UniworkDocError('malformed_response', {
            serverCode: 'upload_checksum_mismatch',
          })
        }
      },
    })
  }

  /**
   * The bind half of a first save, shared by both upload shapes: the document
   * exists on the server and the local copy must become its working copy. Every
   * failure after the create compensates the created row (archive, never a
   * delete - no such route) so no server document is left without a binding.
   * `writeWorkingCopy` is the only difference between the two callers: the
   * buffered path writes the bytes it already holds, the chunked path copies
   * the file it never read whole. That chunked copy also supplies
   * `verifyWorkingCopy` (R1-BE-04), which runs on the copied path and throws
   * when the copy is not the bytes the server validated - so a source that
   * changed under the upload never binds.
   */
  private async bindFirstSaveDocument(input: {
    session: { identity: SessionIdentity; epoch: number }
    owner: string
    tabPath: string
    key: string
    title: string
    filename: string
    limits: DocumentLimits
    api: UniworkDocsClient
    created: UniworkDocSummary
    bytesChecksum: string
    /** S01-R2-4: the durable record of this attempt, kept in step with the bind */
    attempt: FirstSaveAttempt
    writeWorkingCopy(dir: string, name: string): Promise<string>
    /** R1-BE-04: proves the copied working copy matches the uploaded bytes, or throws */
    verifyWorkingCopy?(copiedPath: string, serverChecksum: string): Promise<void>
    onBindFailure(): void
  }): Promise<UniworkDocSummary> {
    const { session, owner, tabPath, key, title, filename, api, created, bytesChecksum } = input
    const createdTitle = created.title || title
    // S01-R2-4 fix2: ONE overwrite guard, whatever the key's provenance (fresh,
    // restored, cached across a retry) and whatever the copy's save state. A key
    // that answers a document whose store folder holds anything - a binding of any
    // state or schema, an unreadable one, any file - or whose folder cannot be
    // inspected has been bound before: its copy may hold edits. Nothing is
    // written, nothing is archived (outside the compensating try on purpose), the
    // record catches up to `bound` and the existing `conflict` verdict answers.
    // Only an absent or empty folder binds; a fresh key yields a fresh document id,
    // so the guard costs nothing on the ordinary path.
    const held = await this.inspectFirstSaveFolder(session.identity, created.id)
    if (held.kind === 'held') {
      this.firstSaveDone.add(`${owner}${key}`)
      input.onBindFailure()
      await this.saveFirstSaveRecord(input.attempt, {
        state: 'bound',
        documentId: created.id,
        ...(held.copy ? { workingCopyPath: held.copy } : {}),
      })
      throw new UniworkDocError('conflict')
    }
    // S01-R2-6: the written working copy is tracked so the compensation catch
    // can remove it on EVERY bind failure - a store.write that throws strands
    // it just like the sweep-refusal branch below did
    let workingCopy: { dir: string; name: string } | null = null
    try {
      // a binder that won the race while the create was in flight: this row
      // is a duplicate, compensated below like any other bind failure
      if (this.claimedFirstSave(owner, tabPath)) throw new UniworkDocError('conflict')
      // the create summary carries no revision: the read binds the same
      // fields the open flow binds (revision, version, checksum, level)
      const detail = await api.getDocument(created.id)
      const dir = this.store.dirFor(
        session.identity.deploymentId,
        session.identity.accountId,
        created.id,
      )
      const name = workingCopyName(title, detail.file.filename, formatForName(filename)!)
      const path = await input.writeWorkingCopy(dir, name)
      workingCopy = { dir, name }
      // R1-BE-04: the copy exists but is not yet declared ready - the chunked
      // caller hashes it here (streamed) and refuses when the live source
      // drifted from the bytes the server validated. The throw lands in the
      // compensation catch below: the created row is archived and the user's
      // own file is never touched.
      await input.verifyWorkingCopy?.(path, detail.file.checksumSha256)
      const binding = withServerContext(
        {
          schema: 2,
          documentId: created.id,
          workspaceId: detail.workspaceId || created.workspaceId,
          orgId: detail.organizationId,
          title: detail.title,
          filename: name,
          format: formatForName(filename)!,
          access: accessFor(detail.myLevel),
          baseRevision: detail.revision,
          baseVersion: detail.file.version,
          baseChecksum: bytesChecksum,
          state: 'ready',
          minStoreLevel: APP_STORE_LEVEL,
          minAppVersion: this.buildVersion(),
          lastSavedAt: new Date().toISOString(),
        },
        detail,
      )
      const written = await this.store.write(dir, binding)
      if (!written) {
        // the migration sweep holds this folder: the bound copy cannot land
        throw new UniworkDocError('server_error')
      }
      // the tab follows its file into the store: from here the path is a
      // bound working copy, so the next save is one upload + commit. The
      // user's original file stays where it is, byte for byte and
      // unbound - a first save never deletes or moves it (S01-W1-1).
      //
      // S01-R1-3: the written binding.json IS the save. Everything below is a
      // notification whose failure is logged, never a retryable answer - a
      // retry of this path is refused by firstSaveDone above.
      this.firstSaveDone.add(`${owner}${key}`)
      input.onBindFailure()
      // S01-R2-4: the same fact, durably: a restart refuses the original too
      await this.saveFirstSaveRecord(input.attempt, {
        state: 'bound',
        documentId: created.id,
        workingCopyPath: path,
      })
      try {
        this.deps.notifyPathRenamed?.(tabPath, path)
      } catch (error) {
        console.warn('uniwork docs: first-save: the tab re-key failed:', error)
      }
      try {
        const doc = this.store.lookup(path)
        if (doc) {
          if (doc.binding.access === 'edit') this.startEditLock(doc)
          this.publish(toStatus(doc))
        }
      } catch (error) {
        console.warn('uniwork docs: first-save: the status push failed:', error)
      }
      try {
        this.pushTreeChangedFor(session, created.workspaceId)
      } catch (error) {
        console.warn('uniwork docs: first-save: the tree push failed:', error)
      }
      return created
    } catch (error) {
      // anything between the create and the written binding left a server
      // document with no local binding: compensate it the way the FD-11
      // save-copy flow does when its step 2 fails - archive moves the created
      // document to the trash (restorable), never a delete (no such route)
      // (S01-R1-2)
      //
      // S01-R2-6: the written working copy (a thrown store.write strands it
      // as much as the refused write did) goes first, so the folder never
      // keeps a partial document the store would scan back. Its failure is
      // logged and never replaces the typed result below.
      if (workingCopy) {
        try {
          await this.store.removeWorkingCopy(workingCopy.dir, workingCopy.name)
        } catch (cleanupError) {
          console.warn(
            `uniwork docs: first-save: the stranded working copy ${workingCopy.name} could not be removed`,
            cleanupError,
          )
        }
      }
      console.warn(
        `uniwork docs: first-save: binding ${created.id} failed; archiving the created document`,
        error instanceof UniworkDocError ? error.code : 'unknown',
      )
      try {
        await api.archive(created.id, this.newIdempotencyKey())
      } catch (archiveError) {
        console.warn(
          `uniwork docs: first-save: created document ${created.id} could not be archived`,
          archiveError instanceof UniworkDocError ? archiveError.code : 'unknown',
        )
        throw new UniworkDocError('first_save_orphaned' as UniworkDocErrorCode, {
          documentId: created.id,
          documentTitle: createdTitle,
        })
      }
      // compensated: the attempt's key is spent - a retry re-creates (binding
      // the trashed row would resurrect it without its own save)
      input.onBindFailure()
      await this.dropFirstSaveRecord(input.attempt)
      const raced = error instanceof UniworkDocError && error.code === 'conflict'
      throw new UniworkDocError(
        (raced ? 'conflict' : 'first_save_bind_failed') as UniworkDocErrorCode,
        { documentId: created.id, documentTitle: createdTitle },
      )
    }
  }

  /**
   * S01-R2-4: the durable first-save record store of the live session, or null
   * when there is none to use (no store, a locked keychain, or the session moved
   * off the account the action started under: a record is never read or written
   * for another owner).
   */
  private async firstSaveStore(session: {
    identity: SessionIdentity
  }): Promise<FirstSaveStore | null> {
    const sync = this.deps.syncStore
    if (!sync) return null
    const scoped = (): boolean => {
      const live = sync.scope()
      return (
        !!live &&
        live.deploymentId === session.identity.deploymentId &&
        live.accountId === session.identity.accountId
      )
    }
    if (!scoped()) return null
    // S01-R2-4 fix2 (R1-23): the service-level open runs the one-time legacy sweep,
    // and it is ONE promise every caller joins - its handle can be the account that
    // started it while the session has since moved on. It is awaited for the sweep
    // only; the records come from the access itself, which opens the live scope's
    // own handle, checked against the scope this action started under.
    const swept = await this.openSyncStore().catch(() => null)
    if (!swept || swept.kind !== 'ok' || !scoped()) return null
    const own = await sync.open().catch(() => null)
    if (!own || own.kind !== 'ok' || !scoped()) return null
    return createFirstSaveStore(own.records(FIRST_SAVES_STORE_REGISTRATION.name))
  }

  /**
   * S01-R2-4: a restart forgets `firstSaveDone`, and the original file is still
   * plain. A `bound` record whose document this machine still holds (a binding of
   * any non-terminal state and its working copy, see `firstSaveCopyState`) means
   * the original already is a UniWork document: refuse with the same `conflict`
   * the in-process guard answers, before any flush, read or request. A record
   * whose document is gone (the working copy or the store folder was removed, the
   * store wiped, the document archived or lost) is stale and never blocks a
   * legitimate first save: it is dropped.
   */
  private async refuseBoundFirstSave(
    session: { identity: SessionIdentity },
    owner: string,
    tabPath: string,
  ): Promise<void> {
    const store = await this.firstSaveStore(session)
    if (!store) return
    const recordKey = firstSaveKey(owner, pathKey(tabPath))
    const saved = await store.get(recordKey).catch(() => null)
    if (saved?.state !== 'bound' || !saved.documentId) return
    const copy = await this.firstSaveCopyState(session.identity, saved.documentId)
    if (copy.live) {
      // a rename of the document moves its closed copy: the record follows the binding
      if (copy.path && copy.path !== saved.workingCopyPath) {
        await store
          .put(recordKey, { ...saved, workingCopyPath: copy.path, at: new Date().toISOString() })
          .catch(() => undefined)
      }
      throw new UniworkDocError('conflict')
    }
    await store.remove(recordKey).catch(() => undefined)
  }

  /**
   * Is `documentId` still held on this machine? The binding.json of its store
   * folder decides, and its CURRENT file name (not the path the record was made
   * with) names the working copy. Live unless the account lost the document:
   * a binding in any state but a terminal one (archived / deleted / access lost)
   * whose copy exists. Only a missing binding.json or copy says it is gone; any
   * other answer (an unreadable binding, a newer schema, a stat or read error)
   * is unknown, and unknown is live - a record is never dropped on a guess.
   */
  private async firstSaveCopyState(
    identity: SessionIdentity,
    documentId: string,
  ): Promise<{ live: false } | { live: true; path?: string }> {
    let dir: string
    try {
      dir = this.store.dirFor(identity.deploymentId, identity.accountId, documentId)
    } catch {
      return { live: false }
    }
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(join(dir, BINDING_FILE), 'utf8'))
    } catch (error) {
      return isAbsentPath(error) ? { live: false } : { live: true }
    }
    if (bindingKindOf(raw) === 'newer') return { live: true }
    const binding = parseBinding(raw)
    if (!binding) return { live: true }
    if (binding.documentId !== documentId) return { live: false }
    if (
      binding.state === 'blocked' &&
      binding.error &&
      FIRST_SAVE_ENDED_ERRORS.has(binding.error)
    ) {
      return { live: false }
    }
    const path = join(dir, binding.filename)
    try {
      return (await stat(path)).isFile() ? { live: true, path } : { live: false }
    } catch (error) {
      return isAbsentPath(error) ? { live: false } : { live: true, path }
    }
  }

  /**
   * S01-R2-4 fix2: what the store folder of a created or replayed document holds
   * before the bind writes into it. Only a folder that is confirmed absent (ENOENT)
   * or empty is `free`; any entry (a binding of any state or schema, an unreadable
   * one, a working copy, a stray file) and any failure to look (EIO, EPERM: unknown)
   * is `held`, and `copy` is the working copy the CURRENT binding names when it reads.
   */
  private async inspectFirstSaveFolder(
    identity: SessionIdentity,
    documentId: string,
  ): Promise<{ kind: 'free' } | { kind: 'held'; copy?: string }> {
    let dir: string
    try {
      dir = this.store.dirFor(identity.deploymentId, identity.accountId, documentId)
    } catch {
      // not a folder name at all: the bind refuses it and compensates as before
      return { kind: 'free' }
    }
    let names: string[]
    try {
      names = await readdir(dir)
    } catch (error) {
      return errorCodeOf(error) === 'ENOENT' ? { kind: 'free' } : { kind: 'held' }
    }
    if (names.length === 0) return { kind: 'free' }
    const binding = await this.store.readDir(dir)
    return {
      kind: 'held',
      ...(binding && binding.documentId === documentId
        ? { copy: join(dir, binding.filename) }
        : {}),
    }
  }

  /**
   * S01-R2-4: the Idempotency-Key of this attempt and its durable `pending`
   * record, written BEFORE the create request. In process the key is the one
   * `firstSaveKeys` holds; after a restart it is the key of a `pending` record
   * of the SAME fingerprint (workspace, title, destination, bytes) - D replays
   * a create it committed to the same document, so the retry binds that one
   * instead of minting a twin. Another fingerprint is another attempt: a new key.
   */
  private async beginFirstSaveAttempt(
    session: { identity: SessionIdentity },
    owner: string,
    key: string,
    keyFp: string,
  ): Promise<FirstSaveAttempt> {
    const store = await this.firstSaveStore(session)
    const recordKey = firstSaveKey(owner, key)
    const fingerprint = sha256Hex(new TextEncoder().encode(keyFp))
    let idempotencyKey = this.firstSaveKeys.get(keyFp)
    let restored = false
    if (!idempotencyKey) {
      const saved = await store?.get(recordKey).catch(() => null)
      if (
        saved?.state === 'pending' &&
        saved.fingerprint === fingerprint &&
        !this.spentFirstSaveKeys.has(saved.idempotencyKey)
      ) {
        idempotencyKey = saved.idempotencyKey
        restored = true
      }
    }
    idempotencyKey ??= this.newIdempotencyKey()
    this.firstSaveKeys.set(keyFp, idempotencyKey)
    const attempt: FirstSaveAttempt = { store, recordKey, idempotencyKey, fingerprint, restored }
    await this.saveFirstSaveRecord(attempt, { state: 'pending' })
    return attempt
  }

  /**
   * S01-R2-4: one first-save create under the attempt's key. A key restored from
   * the durable record is a REPLAY of an earlier run: D answers the document it
   * committed, and for a create it never committed (409 document_upload_invalid,
   * the staged claim expired) or whose document is gone (404) nothing exists
   * under the key any more - the record is dropped and the create is made ONCE
   * more under a new key (the person asked to save now). A fingerprint mismatch
   * (the key is for another body) drops the record and the retained key, and the
   * typed, retryable verdict answers: the next try mints a fresh key.
   */
  private async runFirstSaveCreate<T>(
    attempt: FirstSaveAttempt,
    keyFp: string,
    create: (idempotencyKey: string) => Promise<T>,
  ): Promise<T> {
    try {
      return await create(attempt.idempotencyKey)
    } catch (error) {
      if (error instanceof UniworkDocError && error.code === 'idempotency_mismatch') {
        // S01-R2-3: the retained key is wrong for this body and must not pin
        // the path until restart
        this.firstSaveKeys.delete(keyFp)
        this.spentFirstSaveKeys.add(attempt.idempotencyKey)
        await this.dropFirstSaveRecord(attempt)
      } else if (
        attempt.restored &&
        error instanceof UniworkDocError &&
        (error.status === 404 ||
          (error.status === 409 && error.serverCode === 'document_upload_invalid'))
      ) {
        this.spentFirstSaveKeys.add(attempt.idempotencyKey)
        await this.dropFirstSaveRecord(attempt)
        attempt.idempotencyKey = this.newIdempotencyKey()
        attempt.restored = false
        this.firstSaveKeys.set(keyFp, attempt.idempotencyKey)
        await this.saveFirstSaveRecord(attempt, { state: 'pending' })
        return await create(attempt.idempotencyKey).catch(async (again: unknown) => {
          if (again instanceof UniworkDocError && again.code === 'idempotency_mismatch') {
            this.firstSaveKeys.delete(keyFp)
            this.spentFirstSaveKeys.add(attempt.idempotencyKey)
            await this.dropFirstSaveRecord(attempt)
          }
          throw again
        })
      }
      throw error
    }
  }

  /**
   * S01-R2-4: writes the attempt's record. The record is bookkeeping for the next
   * start: a store that is missing, locked or full never fails the save itself.
   */
  private async saveFirstSaveRecord(
    attempt: FirstSaveAttempt,
    state: { state: 'pending' } | { state: 'bound'; documentId: string; workingCopyPath?: string },
  ): Promise<void> {
    if (!attempt.store) return
    try {
      const written = await attempt.store.put(attempt.recordKey, {
        idempotencyKey: attempt.idempotencyKey,
        fingerprint: attempt.fingerprint,
        ...state,
        at: new Date().toISOString(),
      })
      if (written.kind !== 'ok') {
        console.warn('uniwork docs: first-save: the restart record was not stored:', written.kind)
      }
    } catch {
      console.warn('uniwork docs: first-save: the restart record was not stored')
    }
  }

  /** S01-R2-4: removes the attempt's own `pending` record, never a newer attempt's or a bound one */
  private async dropFirstSaveRecord(attempt: FirstSaveAttempt): Promise<void> {
    const store = attempt.store
    if (!store) return
    try {
      const saved = await store.get(attempt.recordKey)
      if (saved?.state === 'pending' && saved.idempotencyKey === attempt.idempotencyKey) {
        await store.remove(attempt.recordKey)
      }
    } catch {
      // bookkeeping only: a stale record is dropped by the next reconcile
    }
  }

  /** `tabPath` is already spoken for: this account bound it, or a binding names it */
  private claimedFirstSave(owner: string, tabPath: string): boolean {
    return (
      this.firstSaveDone.has(`${owner}${pathKey(tabPath)}`) ||
      this.store.classify(tabPath).kind !== 'plain'
    )
  }

  /**
   * SAVE-01: flushes the open editor of an unbound `path` to disk and awaits
   * the module's user-save hook, without ever starting a save upload (the
   * binding does not exist yet). No tab answer within the wait = the save
   * FAILS (S01-R1-1): the disk copy is never uploaded in place of the edits
   * the editor could not write.
   */
  private flushEditorToDisk(path: string): Promise<boolean> {
    const key = pathKey(path)
    this.draftFlushWaiters.get(key)?.(false)
    // S01-R1-1: the wait is finite by contract; a test shrinks it through the dep
    const waitMs = this.deps.firstSaveFlushTimeoutMs ?? CLOSE_SAVE_WAIT_MS
    return new Promise<boolean>((resolveFlush) => {
      let settled = false
      const finish = (wrote: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (this.draftFlushWaiters.get(key) === finish) {
          this.draftFlushWaiters.delete(key)
        }
        resolveFlush(wrote)
      }
      const timer = setTimeout(() => finish(false), waitMs)
      ;(timer as { unref?: () => void }).unref?.()
      this.draftFlushWaiters.set(key, finish)
      let requested: boolean
      try {
        requested = this.deps.requestModuleSave(path, () => finish(false))
      } catch {
        requested = false
      }
      if (!requested) {
        finish(false)
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
    options?: { shareWithWorkspace?: boolean },
  ): Promise<UniworkDocActionResult<UniworkDocSummary>> {
    return actionResult(
      async () => {
        const session = this.captureActionSession()
        if (typeof documentId !== 'string' || !documentId) throw new UniworkDocError('not_found')
        // the empty name and the widest cap are refused without a request; the
        // folder's own, tighter cap needs the document's kind, which the read
        // below answers (FD-11)
        const nameAtDocumentCap = requireName(name)
        const ref = await this.api().documentRef(documentId)
        const title =
          ref.kind === 'folder' ? requireName(name, MAX_FOLDER_NAME_RUNES) : nameAtDocumentCap
        if (ref.myLevel !== 'edit' && ref.myLevel !== 'manage') {
          throw new UniworkDocError('forbidden')
        }
        // SD-D2, the web's first-save rule (first-save-naming.tsx): the PATCH also carries
        // `visibility: "workspace"` only for a manager and only while the document is not
        // already shared; only a literal true asks for it
        const shareNow =
          options?.shareWithWorkspace === true &&
          ref.myLevel === 'manage' &&
          ref.visibility !== 'workspace'
        if (title === ref.title && !shareNow) return this.summaryOf(ref)
        const renamed = await this.api().rename({
          documentId,
          revision: ref.revision,
          title,
          ...(shareNow ? { visibility: 'workspace' as const } : {}),
        })
        // this service's own rename: only the revision it produced is its echo,
        // so a genuine later change for another revision is still followed (R1-6)
        this.selfRenamed.set(documentId, renamed.revision)
        // FD-11: the row's title changed for every view of the tree (not for a
        // no-op rename, which returned above)
        this.pushTreeChangedFor(session, renamed.summary.workspaceId)
        // a share-only PATCH keeps the title: the working copy has nothing to follow
        if (title !== ref.title) await this.afterLocalRename(documentId, renamed.summary.title)
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
      const session = this.captureActionSession()
      const archived = await this.api().archive(documentId, this.newIdempotencyKey())
      // S01-R2-4 fix2: an archived document is no longer the one its original was
      // first-saved into; the record ends, the user's bytes are not touched
      await this.endFirstSaveRecords(session, documentId)
      return archived
    })
  }

  /** S01-R2-4 fix2: removes this account's first-save records of `documentId`; bookkeeping only, never fails the caller */
  private async endFirstSaveRecords(
    session: { identity: SessionIdentity },
    documentId: string,
  ): Promise<void> {
    try {
      const store = await this.firstSaveStore(session)
      await store?.removeForDocument(documentId)
    } catch {
      // a record left behind is only a stale one: nothing is lost by it
    }
  }

  /**
   * UNI-2066: what trashing a folder would move, for the confirmation. Like archive it needs
   * manage, but the gate is the kind-agnostic read (the archive route is file-only here;
   * a folder's own detail has no file block). A refused level never reaches the impact route.
   */
  getArchiveImpact(documentId: string): Promise<UniworkDocActionResult<UniworkArchiveImpact>> {
    return actionResult(async () => {
      if (!this.liveIdentity()) throw new UniworkDocError('not_signed_in')
      if (typeof documentId !== 'string' || !documentId) throw new UniworkDocError('not_found')
      await this.requireManageAnyKind(documentId)
      return this.api().getArchiveImpact(documentId)
    })
  }

  /** S18: restore an archived document (only its own archive batch comes back) */
  restoreDocument(documentId: string): Promise<UniworkDocActionResult<UniworkDocSummary>> {
    return actionResult(async () => {
      const session = this.captureActionSession()
      if (typeof documentId !== 'string' || !documentId) throw new UniworkDocError('not_found')
      await this.requireManageAnyKind(documentId, session)
      return this.api().restore(documentId, this.newIdempotencyKey())
    })
  }

  /**
   * UNI-2078: delete a trashed document forever (the web's purge). Main never trusts the renderer:
   * the document is re-read and refused BEFORE any POST unless the caller manages it (or holds
   * `admin_scope`, decision Q4 - the web's canManageTrashed) and it is in the trash. The server
   * purges the item and the trashed descendants the caller manages, in one transaction.
   */
  purgeDocument(documentId: string): Promise<UniworkDocActionResult<{ id: string }>> {
    return actionResult(async () => {
      const session = this.captureActionSession()
      if (typeof documentId !== 'string' || !documentId) throw new UniworkDocError('not_found')
      const ref = await this.api().documentManageRef(documentId)
      if (!this.sessionLive(session)) throw new UniworkDocError('not_signed_in')
      if (ref.myLevel !== 'manage' && !ref.adminScope) throw new UniworkDocError('forbidden')
      if (!ref.archivedAt) throw new UniworkDocError('document_not_in_trash')
      await this.api().purgeDocument(documentId)
      if (ref.workspaceId) this.pushTreeChangedFor(session, ref.workspaceId)
      return { id: documentId }
    })
  }

  /**
   * UNI-2078: a plain copy of a file document (the web's "Create a copy"): a new document at the
   * workspace root that keeps the source's access. Main never trusts the renderer: the document is
   * re-read and refused BEFORE any POST unless it is a live file the caller can edit and no other
   * module owns. `title` blank = the server names the copy. The renderer's `idempotencyKey` (one
   * per dialog open) is kept across a retry of the same open when it has the expected shape;
   * anything else is replaced by a key minted here. No `parent_id` (workspace root, web parity).
   * An envelope-less 404 / 501 of the copy route (not the re-read) answers `endpointMissing`; a
   * coded one (`404 not_found`: the source went between the re-read and the POST) is a normal failure.
   */
  copyDocument(input: {
    documentId: string
    title?: string
    idempotencyKey?: string
  }): Promise<UniworkDocActionResult<UniworkDocSummary>> {
    return actionResult(
      async () => {
        const session = this.captureActionSession()
        const documentId = typeof input?.documentId === 'string' ? input.documentId : ''
        if (!documentId) throw new UniworkDocError('not_found')
        const title =
          typeof input.title === 'string' && input.title.trim()
            ? requireName(input.title)
            : undefined
        const ref = await this.api()
          .documentRef(documentId)
          // the re-read failing (a vanished document) says nothing about the copy route: drop the
          // status so a 404 here never hides the action for the session
          .catch((error: unknown) => {
            if (error instanceof UniworkDocError) {
              throw new UniworkDocError(error.code, { serverCode: error.serverCode })
            }
            throw error
          })
        if (!this.sessionLive(session)) throw new UniworkDocError('not_signed_in')
        if (ref.myLevel !== 'edit' && ref.myLevel !== 'manage') {
          throw new UniworkDocError('forbidden')
        }
        if (ref.archivedAt) throw new UniworkDocError('document_deleted')
        if (ref.shelvedAt) throw new UniworkDocError('document_archived')
        if (ref.kind === 'folder') throw new UniworkDocError('unsupported_format')
        if (ref.kind === 'page') throw new UniworkDocError('page_copy_not_supported')
        if (ref.ownerKind) throw new UniworkDocError('owner_requires_copy')
        const given = typeof input.idempotencyKey === 'string' ? input.idempotencyKey : ''
        const created = await this.api().copyDocument({
          documentId,
          ...(title ? { title } : {}),
          parentId: null,
          idempotencyKey: COPY_KEY_SHAPE.test(given)
            ? `uniwork-doc-copy-${given}`
            : this.newIdempotencyKey(),
        })
        this.pushTreeChangedFor(session, created.summary.workspaceId)
        return created.summary
      },
      { flagMissingEndpoint: true, uncodedOnly: true },
    )
  }

  /** the workspace + create target of a create or upload, validated before any call */
  private docTarget(input: { workspaceId?: unknown; folderId?: unknown }): {
    workspaceId: string
    create: UniworkCreateTarget
  } {
    const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
    if (!workspaceId) throw new UniworkDocError('not_found')
    const folderId = typeof input.folderId === 'string' && input.folderId ? input.folderId : null
    // MYFOLDER-01 / SAVE-01 (Q1): a create/upload with no folder lands in the
    // caller's My Folder, never at the workspace root
    const create: UniworkCreateTarget = folderId
      ? { parentId: folderId }
      : { destination: 'my_folder' }
    return { workspaceId, create }
  }

  /** archive/restore need manage; a view row (and an edit row) is refused without a call */
  private async requireManage(documentId: string): Promise<void> {
    const detail = await this.api().getDocument(documentId)
    if (detail.myLevel !== 'manage') throw new UniworkDocError('forbidden')
  }

  /**
   * The summary a rename/create answer already carries, without a second read.
   * The flags come from the ref the call was gated on (a no-op rename of an
   * archived manage-level document must not report `canManage:false,
   * archived:false`), and the format from the row's own file block first
   * (R1-2); FD-11 adds the entry's kind and where it sits.
   */
  private summaryOf(ref: DocumentRef): UniworkDocSummary {
    return {
      id: ref.id,
      workspaceId: ref.workspaceId,
      title: ref.title,
      format: ref.format,
      updatedAt: '',
      ...actionFlags(ref.myLevel, ref.archivedAt),
      kind: ref.kind,
      parentId: ref.parentId,
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
   * The workspace member names (userId → display name) the shelved / trash
   * rows use, for other main-process readers (the Drive activity). Never
   * rejects: an unreadable member list is an empty map.
   */
  memberNamesOf(workspaceId: string): Promise<Map<string, string>> {
    return this.memberNamesForWorkspace(workspaceId).catch(() => new Map<string, string>())
  }

  /**
   * DESKTOP-HOME: the workspace's member names (`user_id` -> `display_name`),
   * read once per `workspaceId` via `GET /workspaces/{ws}/members` (capped at
   * `MEMBERS_PAGE_SIZE * MEMBERS_MAX_PAGES` = 2000 entries). Concurrent list
   * calls for the same workspace share one in-flight read; on failure, an empty
   * `Map` is cached for the session so a missing/forbidden members read is
   * never retried per row. Dropped on org change, account change, and
   * `noteLibraryReload()`.
   */
  private memberNamesForWorkspace(workspaceId: string): Promise<Map<string, string>> {
    const identity = this.deps.identity()
    const accountKey = identity ? `${identity.deploymentId}/${identity.accountId}` : null
    if (this.sessionAccountKey !== null && this.sessionAccountKey !== accountKey) {
      this.workspaceMemberNames.clear()
      this.workspaceMemberNamesInFlight.clear()
      this.workspaceMemberNamesOrg = null
      this.avatarCache.clear()
    }
    this.sessionAccountKey = accountKey
    const orgId = this.deps.selectedOrg()?.id ?? null
    if (this.workspaceMemberNamesOrg !== null && this.workspaceMemberNamesOrg !== orgId) {
      this.workspaceMemberNames.clear()
      this.workspaceMemberNamesInFlight.clear()
      this.avatarCache.clear()
    }
    this.workspaceMemberNamesOrg = orgId
    const cached = this.workspaceMemberNames.get(workspaceId)
    if (cached) return Promise.resolve(cached)
    const inflight = this.workspaceMemberNamesInFlight.get(workspaceId)
    if (inflight) return inflight
    const epoch = this.sessionEpoch
    const promise = this.loadWorkspaceMemberNames(workspaceId, epoch, accountKey, orgId)
    this.workspaceMemberNamesInFlight.set(workspaceId, promise)
    return promise
  }

  private async loadWorkspaceMemberNames(
    workspaceId: string,
    epoch: number,
    accountKey: string | null,
    orgId: string | null,
  ): Promise<Map<string, string>> {
    const cap = MEMBERS_PAGE_SIZE * MEMBERS_MAX_PAGES
    try {
      const api = this.api()
      if (typeof api.listWorkspaceMembers !== 'function') {
        return new Map()
      }
      const members = await api.listWorkspaceMembers(workspaceId)
      const names = new Map<string, string>()
      for (const member of members) {
        if (names.size >= cap) break
        names.set(member.userId, member.displayName)
      }
      if (
        this.sessionEpoch === epoch &&
        this.sessionAccountKey === accountKey &&
        this.workspaceMemberNamesOrg === orgId
      ) {
        this.workspaceMemberNames.set(workspaceId, names)
      }
      return names
    } catch {
      const empty = new Map<string, string>()
      if (
        this.sessionEpoch === epoch &&
        this.sessionAccountKey === accountKey &&
        this.workspaceMemberNamesOrg === orgId
      ) {
        this.workspaceMemberNames.set(workspaceId, empty)
      }
      return empty
    } finally {
      this.workspaceMemberNamesInFlight.delete(workspaceId)
    }
  }

  /**
   * UNI-2275 R2-1: warm missing avatars in the background and emit ONE
   * session-fenced `pushTreeChangedFor` per affected workspace only when at
   * least one new `data:` URL actually entered the cache.
   */
  private warmAvatarsInBackground(
    rows: readonly UniworkDocSummary[],
    workspaceIds: readonly string[],
  ): void {
    const session = this.captureActionSessionOrNull()
    void this.avatarCache
      .warmRows(rows)
      .then((changed) => {
        if (!changed || !session) return
        for (const wsId of workspaceIds) {
          if (!wsId) continue
          try {
            this.pushTreeChangedFor(session, wsId)
          } catch {
            // a callback error never rejects into an unhandled promise
          }
        }
      })
      .catch(() => undefined)
  }

  private async enrichWorkspaceRows(
    workspaceId: string,
    rows: UniworkDocSummary[],
  ): Promise<UniworkDocSummary[]> {
    const names = await this.memberNamesForWorkspace(workspaceId)
    const withAvatars = this.avatarCache.materializeRows(rows)
    this.warmAvatarsInBackground(rows, [workspaceId])
    if (names.size === 0) return withAvatars
    return withAvatars.map((row) => {
      const updatedByName = row.updatedById ? names.get(row.updatedById) : undefined
      // UNI-2047: the trash's "deleted by"; a former member stays unnamed
      const archivedByName = row.archivedById ? names.get(row.archivedById)?.trim() : undefined
      return updatedByName || archivedByName
        ? {
            ...row,
            ...(updatedByName ? { updatedByName } : {}),
            ...(archivedByName ? { archivedByName } : {}),
          }
        : row
    })
  }

  /**
   * The IPC boundary of the list filters: a value outside the server's
   * vocabulary (type / sort / order / activity) or of the wrong type is dropped, so an
   * unset query stays today's request and a stray value never leaves. UNI-2113: the Type picks
   * replace the single `format` / `kind=page` filter, which no longer crosses the boundary.
   */
  private listFiltersOf(q: UniworkListFilters): UniworkListFilters {
    const types = normalizeTypePicks(q.types)
    return {
      ...(types.length > 0 ? { types } : {}),
      ...(typeof q.updatedBy === 'string' && q.updatedBy ? { updatedBy: q.updatedBy } : {}),
      ...(typeof q.updatedFrom === 'string' && q.updatedFrom ? { updatedFrom: q.updatedFrom } : {}),
      ...(isListSort(q.sort) ? { sort: q.sort } : {}),
      ...(q.order === 'asc' || q.order === 'desc' ? { order: q.order } : {}),
      ...(q.activity === 'opened' || q.activity === 'edited' ? { activity: q.activity } : {}),
    }
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
    this.workspaceMemberNames.clear()
  }

  listDocuments(query: UniworkDocListQuery): Promise<UniworkResult<UniworkDocListPage>> {
    return result(async () => {
      if (!query || typeof query.workspaceId !== 'string' || !query.workspaceId) {
        throw new UniworkDocError('not_found')
      }
      const page = await this.api().listDocuments({
        workspaceId: query.workspaceId,
        ...(typeof query.query === 'string' ? { query: query.query } : {}),
        ...(typeof query.cursor === 'string' ? { cursor: query.cursor } : {}),
        ...(typeof query.limit === 'number' ? { limit: query.limit } : {}),
        ...(query.includePages === true ? { includePages: true } : {}),
        ...this.listFiltersOf(query),
      })
      const documents = await this.enrichWorkspaceRows(query.workspaceId, page.documents)
      return { documents, nextCursor: page.nextCursor }
    })
  }

  /** DESKTOP-HOME: documents shared by the caller in one workspace (paged) */
  listSharedByMe(
    q: { workspaceId: string; cursor?: string; limit?: number } & UniworkListFilters,
  ): Promise<UniworkResult<UniworkDocListPage>> {
    return result(async () => {
      if (!q || typeof q.workspaceId !== 'string' || !q.workspaceId) {
        throw new UniworkDocError('not_found')
      }
      const page = await this.api().listSharedByMe({
        workspaceId: q.workspaceId,
        ...(typeof q.cursor === 'string' ? { cursor: q.cursor } : {}),
        ...(typeof q.limit === 'number' ? { limit: q.limit } : {}),
        ...this.listFiltersOf(q),
      })
      const documents = await this.enrichWorkspaceRows(q.workspaceId, page.documents)
      return { documents, nextCursor: page.nextCursor }
    })
  }

  /** DESKTOP-HOME: archived documents in the workspace's trash (`archived=1`, paged) */
  listTrash(
    q: { workspaceId: string; cursor?: string; limit?: number } & UniworkListFilters,
  ): Promise<UniworkResult<UniworkDocListPage>> {
    return result(async () => {
      if (!q || typeof q.workspaceId !== 'string' || !q.workspaceId) {
        throw new UniworkDocError('not_found')
      }
      const page = await this.api().listTrash({
        workspaceId: q.workspaceId,
        ...(typeof q.cursor === 'string' ? { cursor: q.cursor } : {}),
        ...(typeof q.limit === 'number' ? { limit: q.limit } : {}),
        ...this.listFiltersOf(q),
      })
      const documents = await this.enrichWorkspaceRows(q.workspaceId, page.documents)
      return { documents, nextCursor: page.nextCursor }
    })
  }

  /**
   * UNI-2047 B6: the caller's stars in one workspace (SV-2, newest star first, paged). The route
   * reads only the type, the kind, the sort and the paging, so the editor / date / activity filters
   * stop here; an older server's 404 comes back as the usual `not_found` error result.
   */
  listFavorites(
    q: { workspaceId: string; cursor?: string; limit?: number } & UniworkListFilters,
  ): Promise<UniworkResult<UniworkDocListPage>> {
    return result(async () => {
      if (!q || typeof q.workspaceId !== 'string' || !q.workspaceId) {
        throw new UniworkDocError('not_found')
      }
      const { types, sort, order } = this.listFiltersOf(q)
      const page = await this.api().listFavorites({
        workspaceId: q.workspaceId,
        ...(typeof q.cursor === 'string' ? { cursor: q.cursor } : {}),
        ...(typeof q.limit === 'number' ? { limit: q.limit } : {}),
        ...(types ? { types } : {}),
        ...(sort ? { sort } : {}),
        ...(order ? { order } : {}),
      })
      const documents = await this.enrichWorkspaceRows(q.workspaceId, page.documents)
      return { documents, nextCursor: page.nextCursor }
    })
  }

  /** UNI-2047 B6: Gắn sao - the server checks the view level and answers the same on a repeat */
  favoriteDocument(documentId: string): Promise<UniworkDocActionResult<UniworkDocFavoriteResult>> {
    return actionResult(async () => {
      if (!this.liveIdentity()) throw new UniworkDocError('not_signed_in')
      if (typeof documentId !== 'string' || !documentId) throw new UniworkDocError('not_found')
      return this.api().favorite(documentId)
    })
  }

  /** UNI-2047 B6: Bỏ gắn sao - a star that is not there is still a success on the server */
  unfavoriteDocument(documentId: string): Promise<UniworkDocActionResult<{ documentId: string }>> {
    return actionResult(async () => {
      if (!this.liveIdentity()) throw new UniworkDocError('not_signed_in')
      if (typeof documentId !== 'string' || !documentId) throw new UniworkDocError('not_found')
      await this.api().unfavorite(documentId)
      return { documentId }
    })
  }

  /** UNI-1961 (ARCHIVE-01): the workspace's Lưu trữ shelf (paged, shelved_at DESC) */
  listShelved(q: UniworkShelvedQuery): Promise<UniworkResult<UniworkDocListPage>> {
    return result(async () => {
      if (!q || typeof q.workspaceId !== 'string' || !q.workspaceId) {
        throw new UniworkDocError('not_found')
      }
      // UNI-2047: the shelf takes the type filter and the sort, nothing else
      const { types, sort, order } = this.listFiltersOf(q)
      const page = await this.api().listShelved({
        workspaceId: q.workspaceId,
        ...(typeof q.cursor === 'string' ? { cursor: q.cursor } : {}),
        ...(typeof q.limit === 'number' ? { limit: q.limit } : {}),
        ...(types ? { types } : {}),
        ...(sort ? { sort } : {}),
        ...(order ? { order } : {}),
      })
      const documents = await this.enrichShelvedRows(q.workspaceId, page.documents)
      return { documents, nextCursor: page.nextCursor }
    })
  }

  /** UNI-1961: the Documents home's "other sources" files (owner names come from the server) */
  listSources(q: UniworkSourceListQuery): Promise<UniworkResult<UniworkSourceListPage>> {
    return result(async () => {
      if (!q || typeof q.workspaceId !== 'string' || !q.workspaceId) {
        throw new UniworkDocError('not_found')
      }
      const types = normalizeTypePicks(q.types)
      return this.api().listSources({
        workspaceId: q.workspaceId,
        ...(typeof q.source === 'string' ? { source: q.source } : {}),
        ...(types.length > 0 ? { types } : {}),
        ...(typeof q.q === 'string' ? { q: q.q } : {}),
        ...(typeof q.cursor === 'string' ? { cursor: q.cursor } : {}),
        ...(typeof q.limit === 'number' ? { limit: q.limit } : {}),
      })
    })
  }

  /**
   * UNI-1961: the updater and the shelver by name. An id the member list does
   * not hold is a former member; with no member list at all nothing is
   * guessed (the renderer shows "—").
   */
  private async enrichShelvedRows(
    workspaceId: string,
    rows: UniworkDocSummary[],
  ): Promise<UniworkDocSummary[]> {
    const names = await this.memberNamesForWorkspace(workspaceId)
    const withAvatars = this.avatarCache.materializeRows(rows)
    this.warmAvatarsInBackground(rows, [workspaceId])
    if (names.size === 0) return withAvatars
    return withAvatars.map((row) => {
      const updatedByName = row.updatedById ? names.get(row.updatedById) : undefined
      const shelvedByName = row.shelvedById ? names.get(row.shelvedById)?.trim() : undefined
      return {
        ...row,
        ...(updatedByName ? { updatedByName } : {}),
        ...(shelvedByName
          ? { shelvedByName }
          : row.shelvedById && !names.has(row.shelvedById)
            ? { shelvedByFormer: true }
            : {}),
      }
    })
  }

  /** UNI-1961: Bỏ lưu trữ, for a shelved item of any kind the caller manages */
  unshelveDocument(documentId: string): Promise<UniworkDocActionResult<UniworkDocShelveResult>> {
    return actionResult(async () => {
      const session = this.captureActionSession()
      if (typeof documentId !== 'string' || !documentId) throw new UniworkDocError('not_found')
      await this.requireManageAnyKind(documentId, session)
      const res = await this.api().unshelve(documentId, this.newIdempotencyKey())
      await this.afterLocalShelveChange(session, documentId, false, res.affected)
      return res
    })
  }

  /**
   * UNI-1961: Chuyển vào thùng rác from Lưu trữ - the same trash route as
   * `archiveDocument`, gated by the kind-agnostic manage read so a shelved
   * folder or page can go too (`archiveDocument` itself stays file-only).
   */
  trashShelvedDocument(documentId: string): Promise<UniworkDocActionResult<UniworkDocSummary>> {
    return actionResult(async () => {
      const session = this.captureActionSession()
      if (typeof documentId !== 'string' || !documentId) throw new UniworkDocError('not_found')
      await this.requireManageAnyKind(documentId, session)
      const archived = await this.api().archive(documentId, this.newIdempotencyKey())
      await this.endFirstSaveRecords(session, documentId)
      return archived
    })
  }

  /** UNI-1961: Lưu trữ a live item the caller manages (the web's row ⋯ "Lưu trữ") */
  shelveDocument(documentId: string): Promise<UniworkDocActionResult<UniworkDocShelveResult>> {
    return actionResult(async () => {
      const session = this.captureActionSession()
      if (typeof documentId !== 'string' || !documentId) throw new UniworkDocError('not_found')
      await this.requireManageAnyKind(documentId, session)
      const res = await this.api().shelve(documentId, this.newIdempotencyKey())
      await this.afterLocalShelveChange(session, documentId, true, res.affected)
      return res
    })
  }

  /**
   * UNI-1961 (R1-7): refresh any locally bound copy touched by a shelve or
   * unshelve action so main-process read-only, save, comment, and edit-lock
   * policy stay consistent with the server without altering the stored ACL (`level`).
   */
  private async afterLocalShelveChange(
    session: { identity: SessionIdentity; epoch: number; apiOrigin?: string | null },
    documentId: string,
    shelved: boolean,
    affected: readonly string[] = [],
  ): Promise<void> {
    if (!this.sessionLive(session) || typeof this.store?.dirFor !== 'function') return
    const ids = new Set<string>([documentId, ...affected])
    for (const id of ids) {
      if (typeof id !== 'string' || !id) continue
      const dir = this.store.dirFor(session.identity.deploymentId, session.identity.accountId, id)
      const existing = await this.store.readDir(dir)
      if (!existing || existing.documentId !== id) continue
      const local = join(dir, existing.filename)
      const doc = this.store.lookup(local)
      if (!doc || doc.binding.documentId !== id || !this.store.exists(doc.path)) continue
      if (shelved) await this.stopEditLock(doc.path, true)
      if (!this.sessionLive(session)) return
      const prevGen = this.localPolicyGen.get(id) ?? 0
      let advancedGen = false
      let fresh: BoundDocument | null
      try {
        fresh = await this.coordinator.updateBinding(doc, (latest) => {
          const preservedLevel = latest.level ?? (latest.access === 'edit' ? 'edit' : undefined)
          const next: Binding = {
            ...latest,
            ...(preservedLevel ? { level: preservedLevel } : {}),
          }
          if (shelved) {
            next.shelved = true
            next.access = 'view'
          } else {
            delete next.shelved
            next.access = accessFor(next.level ?? null)
          }
          this.localPolicyGen.set(id, prevGen + 1)
          advancedGen = true
          return next
        })
      } catch (error) {
        if (advancedGen) this.localPolicyGen.set(id, prevGen)
        throw error
      }
      if (fresh) {
        this.notifyDocStateChanged(fresh.path)
        if (!shelved && fresh.binding.access === 'edit' && this.deps.isPathOpen(fresh.path)) {
          this.startEditLock(fresh)
        }
      } else if (advancedGen) {
        this.localPolicyGen.set(id, prevGen)
      }
    }
  }

  /** UNI-1961: manage (or admin_scope, the web's canManageTrashed) on a row of any kind */
  private async requireManageAnyKind(
    documentId: string,
    session = this.captureActionSession(),
  ): Promise<void> {
    const ref = await this.api().documentManageRef(documentId)
    if (!this.sessionLive(session)) throw new UniworkDocError('not_signed_in')
    if (ref.myLevel !== 'manage' && !ref.adminScope) throw new UniworkDocError('forbidden')
  }

  /**
   * UNI-1961: a source row's Download (the web's primary action when it cannot
   * view the file): the save dialog suggests the file's own name, then the
   * bytes are read and written there. A cancelled dialog reads nothing.
   */
  downloadSource(
    input: UniworkSourceDownloadInput,
  ): Promise<UniworkResult<{ path: string | null }>> {
    return result(async () => {
      if (!input || typeof input.workspaceId !== 'string' || typeof input.sourceId !== 'string') {
        throw new UniworkDocError('not_found')
      }
      // refused ids never open the dialog
      uniworkId(input.workspaceId)
      uniworkSourceId(input.sourceId)
      const target = (await this.deps.pickDownloadPath?.(sourceFileName(input.name))) ?? null
      if (!target) return { path: null }
      // A106 (UNI-1362) + R1-6: the working-copy root is the app's own folder
      if (await this.isForbiddenDownloadTarget(target)) throw new UniworkDocError('forbidden')
      const { bytes } = await this.api().downloadSource(input.workspaceId, input.sourceId)
      if (await this.isForbiddenDownloadTarget(target)) throw new UniworkDocError('forbidden')
      await this.writeBytesViaTemp(target, bytes)
      return { path: target }
    })
  }

  /**
   * A downloaded file's bytes onto `target`: a `.uw-dl-*.tmp` beside it (exclusive, 0600), the
   * target's own mode restored, a last forbidden-target check, then one rename. The temp file is
   * removed on any failure, so no half file is left. Shared by the source and document downloads.
   */
  private async writeBytesViaTemp(target: string, bytes: Uint8Array): Promise<void> {
    const resolvedTarget = resolve(target)
    const tmp = join(dirname(resolvedTarget), `.uw-dl-${randomBytes(8).toString('hex')}.tmp`)
    let createdTmp = false
    try {
      const existingStat = await lstat(resolvedTarget).catch(() => null)
      const targetMode = existingStat?.isFile() ? existingStat.mode & 0o777 : 0o600
      const handle = await open(tmp, 'wx', 0o600)
      createdTmp = true
      try {
        await handle.writeFile(bytes)
        await handle.chmod(targetMode)
      } finally {
        await handle.close()
      }
      if (await this.isForbiddenDownloadTarget(target)) throw new UniworkDocError('forbidden')
      await rename(tmp, resolvedTarget)
    } catch (error) {
      if (createdTmp) await unlink(tmp).catch(() => undefined)
      throw error
    }
  }

  /**
   * UNI-2068 (D4): the plain download of ONE document file when exactly one file of a bulk
   * selection is downloadable (no zip job, no job slot). The save dialog suggests the file's own
   * name and opens first; a canceled dialog reads nothing. The read is the open flow's streamed
   * download, so a file past its 256 MiB cap answers `too_large`.
   */
  async downloadDocumentFile(input: unknown): Promise<FileDownloadResult> {
    const fail = (code: NonNullable<FileDownloadResult['code']>): FileDownloadResult => ({
      ok: false,
      path: null,
      code,
    })
    try {
      const raw = (input ?? {}) as Record<string, unknown>
      if (typeof raw.workspaceId !== 'string' || typeof raw.documentId !== 'string') {
        return fail('server_error')
      }
      // refused ids never open the dialog
      uniworkId(raw.workspaceId)
      uniworkId(raw.documentId)
      if (!this.deps.identity()) return fail('signed_out')
      const target = (await this.deps.pickDownloadPath?.(sourceFileName(raw.suggestedName))) ?? null
      if (!target) return fail('dialog_canceled')
      if (await this.isForbiddenDownloadTarget(target)) return fail('forbidden_target')
      const { bytes } = await this.api().downloadStream(raw.documentId, undefined)
      if (await this.isForbiddenDownloadTarget(target)) return fail('forbidden_target')
      await this.writeBytesViaTemp(target, bytes)
      return { ok: true, path: target }
    } catch (error) {
      if (
        error instanceof UniworkDocError &&
        error.code === 'forbidden' &&
        error.status === undefined
      ) {
        // the target check carries no status; a server 403 is not a folder problem
        return fail('forbidden_target')
      }
      return fail(zipErrorOf(error).code)
    }
  }

  /**
   * UNI-2077: one version of a document saved where the user picks - the same dialog, target
   * rule and temp-file write as `downloadDocumentFile`, from `download?version=N`. Null = the
   * dialog was canceled (nothing was asked of the server); a server failure throws.
   */
  async downloadDocumentVersion(
    documentId: string,
    versionNo: number,
    suggestedName: string,
  ): Promise<{ path: string } | 'forbidden_target' | null> {
    // a refused id never opens the dialog
    uniworkId(documentId)
    if (!this.liveIdentity()) throw new UniworkDocError('not_signed_in')
    const target = (await this.deps.pickDownloadPath?.(sourceFileName(suggestedName))) ?? null
    if (!target) return null
    const forbidden = (): Promise<boolean> =>
      this.isForbiddenDownloadTarget(target).catch((error: unknown) => {
        // the target check refuses with a status-less `forbidden`; it is a folder problem
        if (error instanceof UniworkDocError && error.status === undefined) return true
        throw error
      })
    if (await forbidden()) return 'forbidden_target'
    const { bytes } = await this.api().downloadStream(documentId, versionNo)
    if (await forbidden()) return 'forbidden_target'
    try {
      await this.writeBytesViaTemp(target, bytes)
    } catch (error) {
      // the last target check inside the write carries no status; same mapping as the file download
      if (
        error instanceof UniworkDocError &&
        error.code === 'forbidden' &&
        error.status === undefined
      ) {
        return 'forbidden_target'
      }
      throw error
    }
    return { path: target }
  }

  /**
   * UNI-2077: the open tab of a document in this session, for a restore: the edit lock this app
   * holds on it and the base revision of its working copy. Null when it is not open here.
   */
  async historyOpenCopy(
    documentId: string,
  ): Promise<{ editLockId: string | null; baseRevision: string | null } | null> {
    uniworkId(documentId)
    const doc = await this.boundDocFor(documentId)
    if (!doc || !this.deps.isPathOpen(doc.path)) return null
    return {
      editLockId: this.editLockIdOf(doc.path),
      baseRevision: doc.binding.baseRevision || null,
    }
  }

  /** UNI-2077: a restore landed on the server; an open tab takes it like any newer revision (S6) */
  noteVersionRestored(notice: RemoteNotice): void {
    void this.noteRemoteChange(notice).catch(() => undefined)
  }

  /** UNI-2068: the zip download's target check - the same rule as every download here */
  isDownloadTargetForbidden(target: string): Promise<boolean> {
    return this.isForbiddenDownloadTarget(target)
  }

  /** UNI-1993: opens a Workspace source file as a view-only tab (see ./source-view) */
  openSource(input: unknown): Promise<SourceViewResult<OpenSourceValue>> {
    return this.sourceViewOpener.openSource(input)
  }

  /** UNI-1993: the tab chip's state of a path; null unless it is a source view */
  sourceViewState(path: string): SourceViewState | null {
    return this.sourceViews.meta(path)
  }

  /** UNI-1993: deletes the source files whose tab has been closed for the grace */
  sweepSourceViews(): Promise<void> {
    return this.sourceViewOpener.sweep()
  }

  /** UNI-1993: account boundary: closes every source tab and deletes the files */
  dropSourceViews(): Promise<void> {
    return this.sourceViewOpener.dropAll((path) => this.deps.closePathNow?.(path))
  }

  /** UNI-1993: quit: removes this session's source files synchronously */
  disposeSourceViews(): void {
    this.sourceViewOpener.disposeSync()
  }

  private async isForbiddenDownloadTarget(target: string): Promise<boolean> {
    if (this.store.isInside(target)) return true
    const resolvedTarget = resolve(target)
    const linkStat = await lstat(resolvedTarget).catch(() => null)
    if (linkStat?.isSymbolicLink()) return true
    if (typeof this.store.root !== 'string' || !this.store.root) return false
    const resolvedRoot = resolve(this.store.root)
    const realRoot = await resolvePhysicalPath(resolvedRoot)
    const insideRoot = (candidate: string): boolean => {
      for (const root of [resolvedRoot, realRoot]) {
        const rel = relative(root, resolve(candidate))
        if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) return true
      }
      return false
    }
    if (insideRoot(resolvedTarget)) return true
    const realParent = await resolvePhysicalPath(dirname(resolvedTarget))
    if (insideRoot(join(realParent, basename(resolvedTarget)))) return true
    const realTarget = await realpath(resolvedTarget).catch(() => null)
    return realTarget !== null && insideRoot(realTarget)
  }

  openDocument(documentId: string): Promise<UniworkResult<{ path: string }>> {
    return result(async () => {
      if (typeof documentId !== 'string') throw new UniworkDocError('not_found')
      // G703B-P3 (FL-09): a cold restore with a locked keychain has no session
      // to open with, and "sign in again" is the wrong answer for it: S11 says
      // unlock the machine and retry (the data is not deleted)
      if (!this.deps.identity() && this.storeLocked()) throw new UniworkDocError('keystore_locked')
      const { path } = await this.openFromServer(documentId)
      return { path }
    })
  }

  /**
   * UNI-2079: a notice's "open at the comment". The plain open, then the thread of `commentId`
   * revealed in the opened copy through the same held reveal a launch ticket uses.
   */
  async openDocumentAt(
    documentId: string,
    commentId?: string,
  ): Promise<UniworkResult<{ path: string }>> {
    const opened = await this.openDocument(documentId)
    if (opened.ok && commentId) this.deps.revealComment?.(opened.value.path, commentId)
    return opened
  }

  /**
   * G703B-P3: the S11 lock of an offline open the locked keychain refused. The
   * tab never opened, so the lock names where the offline copy of the document
   * would sit: under the saved owner's scope when one is known, else under the
   * store root (a session-less machine still has a panel to show).
   */
  offlineKeystoreLock(documentId: string): UniworkDocLock {
    const scope = this.localScope()
    const key = offlineCopyKey(documentId)
    const dir = scope
      ? this.store.dirFor(scope.deploymentId, scope.accountId, key)
      : join(this.store.root, key)
    const name = sanitizeFilename(documentId, 'docx')
    return { path: join(dir, name), name, reason: 'keystore_locked' }
  }

  /** the status, after re-checking the working copy's bytes (A1.3) */
  async docStatus(path: string): Promise<UniworkDocStatus | null> {
    if (typeof path !== 'string') return null
    const doc = this.store.lookup(path)
    if (!doc || !this.ownsLocally(doc)) return null
    // A32 (UNI-1362): the overlay is revalidated against the durable lease here,
    // so a window whose holder released the lock stops showing read-only even
    // when no queue record of this document ever moves again
    await this.revalidateOtherWindow(doc)
    return this.statusOf(await this.refreshDirty(doc))
  }

  activeDocStatus(): Promise<UniworkDocStatus | null> {
    const path = this.deps.activePath()
    return path ? this.docStatus(path) : Promise.resolve(null)
  }

  /** tab activation: bytes written outside the save hook show as dirty */
  async refreshPath(path: string | undefined): Promise<void> {
    const doc = path ? this.store.lookup(path) : null
    if (!doc || !this.ownsLocally(doc)) return
    // A32 (UNI-1362): the same revalidation the status read runs, so a tab that
    // gains focus after the holder released the lock stops reading read-only
    await this.revalidateOtherWindow(doc)
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
    const open = this.conflictPrompt
    if (open && !open.controller.signal.aborted && open.doc.binding.documentId === documentId) {
      void this.buildConflictView(open, { fetchServer: true })
        .then((view) => {
          if (this.conflictPrompt === open && !open.controller.signal.aborted) {
            this.deps.pushConflict?.(view)
          }
        })
        .catch(() => undefined)
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
    if (this.coordinator.isSaving(local)) return
    const policyGen = this.localPolicyGen.get(documentId) ?? 0
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
    const currentIdentity = this.liveIdentity()
    if (
      !currentIdentity ||
      currentIdentity.deploymentId !== identity.deploymentId ||
      currentIdentity.accountId !== identity.accountId
    ) {
      return
    }
    // the metadata read is async: a save may have started or settled, and an
    // editor may have made the copy dirty, while it was in flight. A shelved
    // server verdict downgrades the latest binding to read-only through the
    // coordinator's per-key chain independently of dirty/title handling
    // (R1-7 residual), never upgrading in the reverse direction; the title is
    // applied only when the copy is still clean and idle (R1-4).
    const latest = await this.store.readDir(dir)
    if (!latest || latest.documentId !== documentId) return
    const latestLocal = join(dir, latest.filename)
    const doc = this.store.lookup(latestLocal)
    if (!doc || !this.store.exists(doc.path)) return
    let after: BoundDocument | null = doc
    if (detail.shelvedAt && (this.localPolicyGen.get(documentId) ?? 0) === policyGen) {
      await this.stopEditLock(doc.path, true)
      let policyChanged = false
      try {
        const refreshed = await this.coordinator.updateBinding(doc, (cur) => {
          if ((this.localPolicyGen.get(documentId) ?? 0) !== policyGen) return null
          if (cur.state === 'blocked') return null
          if (cur.shelved && cur.access === 'view') return null
          policyChanged = true
          const preservedLevel = cur.level ?? (cur.access === 'edit' ? 'edit' : undefined)
          return {
            ...cur,
            ...(preservedLevel ? { level: preservedLevel } : {}),
            shelved: true,
            access: 'view',
          }
        })
        after = refreshed ?? this.store.lookup(doc.path)
        if (policyChanged && after) this.notifyDocStateChanged(after.path)
      } catch (error) {
        console.warn(
          `uniwork docs: shelving policy refresh for ${documentId} could not be persisted:`,
          error instanceof UniworkDocError ? error.code : 'unknown',
        )
        return
      }
    }
    if (!after || !this.store.exists(after.path)) return
    if (KEEP_LOCAL_STATES.has(after.binding.state) || this.coordinator.isSaving(after.path)) return
    if (detail.title === after.binding.title) return
    await this.applyTitle(after.binding, detail.title, after.path, true)
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
    if (this.editLockReadOnly(doc.path)) {
      const status = this.statusOf(doc)
      this.publish(status)
      if (this.deps.isShellTab?.(doc.path) ?? true) {
        this.deps.pushQueuePopover?.({ path: doc.path })
      }
      return status
    }
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
    if (
      b.access === 'view' ||
      b.shelved === true ||
      b.state === 'conflict' ||
      this.coordinator.isSaving(doc.path)
    ) {
      return false
    }
    // another window holds the document lock: this window is read-only and
    // never writes (EXPERIENCE - Second-window bar, :129)
    if (this.coordinator.isOtherWindow(doc.key)) return false
    if (this.editLockReadOnly(doc.path)) return false
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
    // A3 (UNI-1362): this decision samples the editor's AI state into the verdict
    // it acts on, so `editorAi` is kept until it has published its bar: a close
    // plus a poll in that window must not drop the sample that very bar's own
    // settle edge (`noteEditorState`) re-decides the notice on. The next poll
    // after it settles prunes the closed path as usual.
    const key = pathKey(doc.path)
    // the entry this decision owns: an old finalizer (a decision dropped by a
    // session reset) must release only its own entry, never the one a decision
    // of the next session registered under the same path
    const entry = this.remoteDecisions.get(key) ?? { n: 0 }
    entry.n += 1
    this.remoteDecisions.set(key, entry)
    try {
      const decision = decideRemote(notice, await this.remoteLocalFor(doc))
      await this.applyRemoteDecision(doc, notice, decision)
    } finally {
      if (this.remoteDecisions.get(key) === entry) {
        entry.n -= 1
        if (entry.n > 0) this.remoteDecisions.set(key, entry)
        else this.remoteDecisions.delete(key)
      }
    }
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
        // EL1A-R2-1: keep a notice ignored because of edit_locked / edit_lock
        if (
          decision.reason === 'locked' &&
          (doc.binding.state === 'edit_locked' || this.editLockReadOnly(doc.path))
        ) {
          this.remoteHeld.set(notice.documentId, notice)
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
        doc.binding.state === 'dirty' ||
        this.editorDirty.has(doc.path) ||
        // UNI-1959: the bytes the editor saved while the name dialog is open are not sent yet
        this.firstSaveOps.has(pathKey(doc.path)) ||
        editor.dirty === true,
      aiRunning: editor.aiRunning,
      queue: record && !isTerminalQueueState(record.state) ? record.state : null,
      ...(record?.receipt ? { receiptRevision: record.receipt.revision } : {}),
      ownEcho: this.echoSet(doc.binding.documentId),
      // EL1A-BE-1: an edit_locked copy takes no notice either - the holder's own
      // commits are the newer versions, and reloading over a copy someone else is
      // editing would fight the lock (the pill names the holder instead)
      locked:
        this.lockedFor(doc.binding) ??
        (doc.binding.state === 'edit_locked' || this.editLockReadOnly(doc.path)
          ? 'edit_locked'
          : null),
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
   * "Tải lại bản mới nhất…": the S5 conflict dialog, opened from the S6 bar.
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
    return this.openConflictSession(doc, { remoteNotice: notice })
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
    this.remoteLockPath.set(documentId, doc.path)
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
    this.remoteLockPath.delete(documentId)
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
    const chain: Promise<void> = run.then(
      () => {
        if (this.remoteReloads.get(key) === chain) this.remoteReloads.delete(key)
      },
      () => {
        if (this.remoteReloads.get(key) === chain) this.remoteReloads.delete(key)
      },
    )
    this.remoteReloads.set(key, chain)
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
    // a save, a first-save naming hold (UNI-1959: the module already wrote the
    // bytes the upload waits on) or the schema 1 -> 2 sweep took the copy while
    // it was fetching: the fetched bytes may not be written over it
    if (
      this.coordinator.isSaving(fresh.path) ||
      this.firstSaveOps.has(pathKey(fresh.path)) ||
      this.heldByMigration(fresh.dir)
    ) {
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
    // A5 (UNI-1362): the previous bytes are the only way back from a late edit
    // or AI turn that starts after the write. If they cannot be read, the
    // replacement would be unrecoverable, so refuse the reload here with the
    // existing `reload-failed` bar instead of writing the fetched head.
    if (previousBytes === null) {
      await this.showRemoteBar(fresh, notice, {
        kind: 'reload-failed',
        version: notice.version,
      })
      return
    }
    // UWNM-BE-R3-1: a Save (or its naming hold) that took the copy while the
    // previous bytes were read: they may already be the person's bytes the
    // upload waits on. No await between this check and the write below
    if (
      this.coordinator.isSaving(fresh.path) ||
      this.firstSaveOps.has(pathKey(fresh.path)) ||
      this.heldByMigration(fresh.dir)
    ) {
      await this.showRemoteBar(fresh, notice, { kind: 'newer-dirty', version: notice.version })
      return
    }
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
    // UNI-1959: a first Save that landed after the pre-write check is held by its naming op
    const lateSave = this.firstSaveOps.has(pathKey(done.path))
    if (final.dirty === true || final.aiRunning || lateMove || lateSave) {
      // a turn (or an edit) started after the write: the previous copy goes back
      // byte for byte, binding included, and the bar says why. A late Save may
      // already have written the person's bytes over the fetched head: those
      // stay, and only the binding goes back
      const ownBytes = lateSave && !(await this.holdsBytes(done.path, fetched.bytes))
      await this.restoreWorkingCopy(done, previousBinding, ownBytes ? null : previousBytes)
      if (lateSave && !ownBytes) {
        // UWNM-BE-R3-1: the Save wrote before the head landed over it (or wrote
        // the head's own bytes), so the person's bytes are only in the editor.
        // The copy stays unsent work and the module writes them again: that
        // Save lands under the still-open naming op, and the verdict uploads it
        this.editorDirty.add(done.path)
        // UWNM-BE-R4-1: the restore was the shell's own write, not another program's
        this.deps.noteShellRewrote?.(done.path)
        this.deps.requestModuleSave(done.path)
      }
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

  /** undo the write of a reload the last read refused (`bytes` null: the file is not touched) */
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

  /** whether the file at `path` still holds exactly `bytes` (an unreadable file does not) */
  private async holdsBytes(path: string, bytes: Uint8Array): Promise<boolean> {
    const current = await readFile(path).catch(() => null)
    return current !== null && sha256Hex(new Uint8Array(current)) === sha256Hex(bytes)
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
    const release = async (): Promise<true> => {
      await this.stopEditLock(path, true)
      return true
    }
    for (;;) {
      let doc = this.store.lookup(path)
      if (!doc || doc.binding.access !== 'edit' || !this.ownsLocally(doc)) return release()
      // a Save from the module's own close prompt may still be uploading
      if (this.coordinator.isSaving(doc.path)) {
        await this.coordinator.settled(doc.path)
        doc = this.store.lookup(path)
        if (!doc) return release()
      }
      doc = await this.refreshDirty(doc)
      const b = doc.binding
      if (!UNSENT_STATES.has(b.state)) return release()
      const kind: UnsavedCloseKind =
        b.state === 'conflict'
          ? 'conflict'
          : b.state === 'blocked' && b.error !== 'quota_exceeded'
            ? 'blocked'
            : 'unsent'
      const choice = await this.deps.ui.chooseUnsavedClose(b.title, kind, b.error)
      if (choice === 'close') {
        if (this.conflictPrompt && samePath(this.conflictPrompt.path, path)) {
          this.endConflictByMain(this.conflictPrompt)
        }
        return release()
      }
      if (kind === 'unsent' && choice === 'save') {
        const ok = await this.saveForClose(path)
        if (ok) await this.stopEditLock(path, true)
        return ok
      }
      if (kind === 'conflict' && choice === 'resolve') {
        const outcome = await this.resolveForClose(path)
        if (outcome === 'again') continue
        if (outcome === 'closed') await this.stopEditLock(path, true)
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
    const wait = this.waitForSettle(latest.path, this.deps.closeSaveWaitMs ?? CLOSE_SAVE_WAIT_MS)
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
      const key = pathKey(path)
      const listener = (status: UniworkDocStatus) => {
        if (status.path === path && !ignore.has(status.state)) finish(status)
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      const arm = () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          // UNI-1959: a person still naming the document is not a stalled upload:
          // the wait goes on, and the dialog's answer arms a fresh window
          if (!this.firstSaveOps.has(key)) finish(null)
        }, timeoutMs)
        ;(timer as { unref?: () => void }).unref?.()
      }
      // the upload a naming op held starts when the op ends: it gets the whole
      // deadline from that moment, however long the person took to answer
      const opEnded = (ended: string) => {
        if (ended === key) arm()
      }
      arm()
      finish = (status) => {
        clearTimeout(timer)
        this.statusListeners.delete(listener)
        this.firstSaveOpEnded.delete(opEnded)
        resolveWait(status)
      }
      this.statusListeners.add(listener)
      this.firstSaveOpEnded.add(opEnded)
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
    return this.openConflictSession(doc, {
      fromClose: opts.fromClose,
      onNotWritten,
    })
  }

  private async openConflictSession(
    doc: BoundDocument,
    opts: {
      fromClose?: boolean
      onNotWritten?: () => void
      remoteNotice?: RemoteNotice
    } = {},
  ): Promise<UniworkDocStatus | null> {
    const open = this.conflictPrompt
    if (open && samePath(open.path, doc.path)) return this.statusOf(doc)
    if (open) {
      this.endConflictByMain(open)
      await open.done
    }
    const controller = new AbortController()
    let finish: () => void = () => undefined
    const done = new Promise<UniworkDocStatus | null>((resolveDone) => {
      finish = () => resolveDone(this.currentStatus(doc))
    })
    const prompt: ConflictSession = {
      sessionId: randomUUID(),
      draftId: `conflict-draft-${randomUUID()}`,
      path: doc.path,
      doc,
      owner: { deploymentId: doc.deploymentId, accountId: doc.userId },
      controller,
      fromClose: !!opts.fromClose,
      onNotWritten: opts.onNotWritten,
      remoteNotice: opts.remoteNotice,
      knownServerRevision: opts.remoteNotice?.revision ?? doc.binding.serverRevision ?? null,
      knownServerVersion: opts.remoteNotice?.version ?? doc.binding.serverVersion ?? null,
      knownServerSavedAt: null,
      knownServerBy: null,
      knownCanEdit: doc.binding.access === 'edit' ? true : false,
      serverOnline: true,
      opened: false,
      done,
      finish,
    }
    this.conflictPrompt = prompt
    try {
      const view = await this.buildConflictView(prompt, { fetchServer: true })
      if (this.conflictPrompt === prompt && !controller.signal.aborted) {
        prompt.opened = true
        this.deps.pushConflict?.(view)
      }
      return await done
    } finally {
      if (this.conflictPrompt === prompt) this.conflictPrompt = null
    }
  }

  /** G5-09 S5: main ended the open conflict session itself -> abort and push close */
  private endConflictByMain(open: ConflictSession): void {
    if (this.conflictPrompt === open) this.conflictPrompt = null
    if (open.controller.signal.aborted) return
    open.controller.abort()
    open.finish()
    if (open.opened) {
      this.deps.pushConflictClosed?.(open.sessionId)
    }
  }

  /**
   * The active document changed (tab switch, the home tab, a language
   * switch): a conflict dialog opened for another document from its chip
   * closes as "Decide later", so it never sits over a tab it does not name.
   */
  noteActivePath(path: string | undefined): void {
    const open = this.conflictPrompt
    if (open && !open.fromClose && !(path && samePath(open.path, path))) {
      this.endConflictByMain(open)
    }
  }

  /** closes an open conflict dialog as "Decide later" (its text is in the old UI language) */
  closeConflictPrompt(): void {
    const open = this.conflictPrompt
    if (open) {
      this.endConflictByMain(open)
    }
  }

  /** G5-09 S5: answer the open conflict dialog session */
  async conflictAct(
    sessionId: string,
    action: UniworkConflictAction,
  ): Promise<UniworkConflictReply> {
    const open = this.conflictPrompt
    if (!open || open.sessionId !== sessionId || open.controller.signal.aborted) {
      return { kind: 'closed' }
    }
    const actionSession = this.captureActionSessionOrNull()
    if (!action || typeof action !== 'object' || typeof action.kind !== 'string') {
      return { kind: 'view', view: await this.buildConflictView(open, { fetchServer: false }) }
    }
    if (action.kind === 'cancel') {
      open.controller.abort()
      open.finish()
      return { kind: 'closed' }
    }
    if (open.locked) {
      return { kind: 'view', view: await this.buildConflictView(open, { fetchServer: false }) }
    }
    const chosen = open.remoteNotice ? this.sameLiveDoc(open.doc) : this.stillInConflict(open.doc)
    if (!chosen) {
      open.controller.abort()
      open.finish()
      return { kind: 'closed' }
    }
    open.doc = chosen
    const currentView = await this.buildConflictView(open, { fetchServer: false })
    if (currentView.intent !== 'none') {
      return { kind: 'view', view: currentView }
    }
    if (action.kind === 'save-copy') {
      return this.saveCopyInConflict(open, chosen, action, currentView, actionSession)
    }
    if (action.kind === 'download-mine') {
      return this.downloadMineInConflict(open, chosen, action)
    }
    if (action.kind === 'reload') {
      return this.reloadInConflict(open, chosen, action, currentView)
    }
    if (action.kind === 'overwrite') {
      return this.overwriteInConflict(open, chosen, action, currentView)
    }
    return { kind: 'view', view: currentView }
  }

  private async buildConflictView(
    session: ConflictSession,
    opts: {
      fetchServer: boolean
      notice?: UniworkConflictNotice | null
      noticeArg?: string | null
    },
  ): Promise<UniworkConflictView> {
    const fresh = this.store.lookup(session.path)
    if (fresh) session.doc = fresh
    const b = session.doc.binding
    if (b.serverRevision) session.knownServerRevision = b.serverRevision
    if (b.state === 'blocked' && (b.error === 'permission_revoked' || b.error === 'forbidden')) {
      session.locked = 'revoked'
      session.knownCanEdit = false
    } else if (
      b.state === 'blocked' &&
      (b.error === 'document_deleted' || b.error === 'deleted' || b.error === 'not_found')
    ) {
      session.locked = 'deleted'
      session.knownCanEdit = false
    }

    if (opts.fetchServer && !session.locked) {
      if (this.liveIdentity()) {
        try {
          const api = this.api()
          const detail = await api.getDocument(b.documentId)
          const props =
            typeof api.documentProperties === 'function'
              ? await api.documentProperties(b.documentId).catch(() => null)
              : null
          session.knownServerRevision = detail.revision
          session.knownServerVersion = detail.file.version
          session.knownServerSavedAt = props?.updatedAt ?? null
          session.knownServerBy = null
          // FD-11 / B-R1-05: the fresh read's workspace and parent, so a web-side
          // workspace move is reflected in the Location tree
          if (detail.workspaceId) session.knownServerWorkspaceId = detail.workspaceId
          if (detail.parentId !== undefined) session.knownServerParentId = detail.parentId
          session.knownCanEdit = detail.myLevel === 'edit' || detail.myLevel === 'manage'
          session.serverOnline = true
        } catch (error) {
          if (error instanceof UniworkDocError) {
            if (error.code === 'permission_revoked' || error.code === 'forbidden') {
              session.locked = 'revoked'
              session.knownCanEdit = false
            } else if (
              error.code === 'document_deleted' ||
              error.code === 'deleted' ||
              error.code === 'not_found'
            ) {
              session.locked = 'deleted'
              session.knownCanEdit = false
            } else if (error.code === 'network') {
              session.serverOnline = false
            }
          } else {
            session.serverOnline = false
          }
        }
      } else {
        session.serverOnline = false
      }
    }

    let online = session.serverOnline && !!this.liveIdentity()
    if (this.deps.capability && b.orgId) {
      try {
        await this.deps.capability.get(b.orgId)
      } catch {
        online = false
      }
    }

    const intent = await this.conflictIntentBlock(session.doc, session.path)

    const keepDraft = await this.probeKeepDraft(session, session.doc)
    const moduleKind: UniworkConflictView['module'] =
      b.format === 'docx'
        ? 'docs'
        : b.format === 'xlsx'
          ? 'sheets'
          : b.format === 'pptx'
            ? 'slides'
            : 'other'
    const canEdit = session.locked ? false : (session.knownCanEdit ?? b.access === 'edit')
    const viewWorkspaceId = session.knownServerWorkspaceId ?? b.workspaceId

    return {
      sessionId: session.sessionId,
      path: session.path,
      documentId: b.documentId,
      title: b.title,
      // FD-11: where the source sits, so the Save-as-a-copy Location can start
      // there (absent parent = no read answered it yet)
      ...(viewWorkspaceId ? { workspaceId: viewWorkspaceId } : {}),
      ...(session.knownServerParentId === undefined
        ? {}
        : { parentId: session.knownServerParentId }),
      module: moduleKind,
      mine: { baseVersion: b.baseVersion ?? null },
      server: {
        version: session.knownServerVersion,
        savedAt: session.knownServerSavedAt,
        by: session.knownServerBy,
      },
      canEdit,
      online,
      headOffline:
        this.deps.hasOfflineHead?.(b.documentId, session.knownServerRevision ?? undefined) === true,
      intent,
      keepDraft,
      draftCap: QUEUE_LIMITS.draftsPerDocument,
      aiRunning: this.deps.isAiRunning?.(session.path) === true,
      locked: session.locked ?? 'none',
      notice: opts.notice ?? null,
      noticeArg: opts.noticeArg ?? null,
    }
  }

  /**
   * The conflict dialog's uncertain-intent block for `doc`: `committing` /
   * `reconciling` / `reconciling-stuck` from the durable store, or `committing`
   * while a Save of the path is in flight in memory.
   */
  private async conflictIntentBlock(
    doc: BoundDocument,
    savingPath = doc.path,
  ): Promise<UniworkConflictIntentBlock> {
    const b = doc.binding
    let intent: UniworkConflictIntentBlock = 'none'
    const access = await this.intentAccess()
    if (access.kind === 'ok') {
      const stored = await access.intents.read(doc.key, {
        orgId: b.orgId,
        workspaceId: b.workspaceId,
        baseVersion: b.baseVersion,
        length: 0,
      })
      const st = stored?.intent.state
      if (st === 'committing' || st === 'reconciling' || st === 'reconciling-stuck') {
        intent = st
      }
    }
    if (intent === 'none' && this.coordinator.isSaving(savingPath)) {
      intent = 'committing'
    }
    return intent
  }

  /**
   * N1: did a Save land between the action's view check and its first
   * destructive step? The only await here is the drain of an in-flight
   * attempt; the caller must keep this immediately before its
   * `supersedePending` / `writeWorkingCopy` / `dropIntent`. True = a Save ran
   * (its durable intent is not `none`, or the base the action started from
   * moved): the replacement must supersede, drop and overwrite nothing.
   */
  private async saveRacedReplacement(
    doc: BoundDocument,
    start: { baseRevision: string; baseChecksum: string },
  ): Promise<boolean> {
    if (this.coordinator.isSaving(doc.path)) await this.coordinator.settled(doc.path)
    if ((await this.conflictIntentBlock(doc)) !== 'none') return true
    const now = this.store.lookup(doc.path)
    if (!now) return true
    return (
      now.binding.baseRevision !== start.baseRevision ||
      now.binding.baseChecksum !== start.baseChecksum
    )
  }

  private async probeKeepDraft(
    session: ConflictSession,
    doc: BoundDocument,
  ): Promise<UniworkConflictKeepDraft> {
    if (this.storeLocked()) return 'keystore_locked'
    const access = await this.draftsOf(session.owner)
    if (access.kind === 'keystore_locked') return 'keystore_locked'
    if (access.kind !== 'ok') return session.draftBlock ?? 'ok'
    const existing = await access.drafts.list(doc.key)
    const others = existing.filter((d) => d.id !== session.draftId)
    if (others.length >= QUEUE_LIMITS.draftsPerDocument) return 'drafts_full'
    if (this.deps.storeUsage) {
      const usage = await this.deps.storeUsage().catch(() => null)
      if (usage) {
        let fileBytes: number
        try {
          fileBytes = (await stat(doc.path)).size
        } catch {
          fileBytes = 0
        }
        const overhead =
          (existing.length === 0 ? 220 : 120) + Buffer.byteLength(doc.binding.title, 'utf8')
        if (usage.bytes + fileBytes + overhead > usage.budgetBytes) {
          return 'store_full'
        }
      }
    }
    return session.draftBlock ?? 'ok'
  }

  /**
   * G5-11 d5-2: the drafts store of `owner`. While `owner` is the live session
   * this is the queue engine's own (the coordinator keeps drafts there too);
   * after an account switch it is `owner`'s own store through `openStoreOf`,
   * never the store of the account that is live now.
   */
  private async draftsOf(
    owner: LastOwner,
  ): Promise<
    { kind: 'ok'; drafts: DraftStore } | { kind: 'keystore_locked' } | { kind: 'unavailable' }
  > {
    const live = this.deps.syncStore?.scope()
    if (live && live.deploymentId === owner.deploymentId && live.accountId === owner.accountId) {
      const access = await this.queueEngine().catch(() => ({ kind: 'unavailable' as const }))
      if (access.kind === 'ok') return { kind: 'ok', drafts: access.drafts }
      return access.kind === 'keystore_locked' ? access : { kind: 'unavailable' }
    }
    const open = await this.openStoreOf(owner).catch(() => ({ kind: 'unavailable' as const }))
    if (open.kind === 'ok') {
      return { kind: 'ok', drafts: createDraftStore(open.records(DRAFTS_STORE_REGISTRATION.name)) }
    }
    return open.kind === 'keystore_locked' ? { kind: 'keystore_locked' } : { kind: 'unavailable' }
  }

  /**
   * Flushes an open dirty module to `path` and awaits its `onUserSave` hook
   * before `drafts.keep` reads the working copy, without starting a save upload.
   */
  private flushModuleForDraft(open: ConflictSession, path: string): Promise<boolean> {
    const key = pathKey(path)
    this.draftFlushWaiters.get(key)?.(false)
    return new Promise<boolean>((resolveFlush) => {
      let settled = false
      const finish = (wrote: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        open.controller.signal.removeEventListener('abort', onAbort)
        if (this.draftFlushWaiters.get(key) === finish) {
          this.draftFlushWaiters.delete(key)
        }
        resolveFlush(wrote)
      }
      const onAbort = () => finish(false)
      const timer = setTimeout(() => finish(false), CLOSE_SAVE_WAIT_MS)
      ;(timer as { unref?: () => void }).unref?.()
      open.controller.signal.addEventListener('abort', onAbort, { once: true })
      this.draftFlushWaiters.set(key, finish)
      let requested: boolean
      try {
        requested = this.deps.requestModuleSave(path, () => finish(false))
      } catch {
        requested = false
      }
      if (!requested) {
        finish(false)
      }
    })
  }

  private async reloadInConflict(
    open: ConflictSession,
    chosen: BoundDocument,
    action: Extract<UniworkConflictAction, { kind: 'reload' }>,
    currentView: UniworkConflictView,
  ): Promise<UniworkConflictReply> {
    if (!currentView.online && !currentView.headOffline) {
      return { kind: 'view', view: currentView }
    }
    if (action.keep === 'draft') {
      if (currentView.keepDraft !== 'ok') {
        return { kind: 'view', view: currentView }
      }
      if (action.stopAi) this.deps.stopAiRun?.(chosen.path)
      const editor = await this.editorState(chosen.path)
      if (editor.dirty === true || this.editorDirty.has(chosen.path)) {
        if (!(await this.flushModuleForDraft(open, chosen.path))) {
          if (open.controller.signal.aborted) return { kind: 'closed' }
          return {
            kind: 'view',
            view: await this.buildConflictView(open, {
              fetchServer: false,
              notice: open.locked ? null : 'reload_failed',
            }),
          }
        }
        if (open.controller.signal.aborted) return { kind: 'closed' }
        if (open.locked) {
          return { kind: 'view', view: await this.buildConflictView(open, { fetchServer: false }) }
        }
        chosen = await this.refreshDirty(chosen)
        open.doc = chosen
      }
      let localBytes: Uint8Array
      try {
        localBytes = new Uint8Array(await readFile(chosen.path))
      } catch {
        return {
          kind: 'view',
          view: await this.buildConflictView(open, { fetchServer: false, notice: 'reload_failed' }),
        }
      }
      const access = await this.draftsOf(open.owner)
      // d5-2: an account switch (or a lock) inside the awaits above ends the
      // dialog; the bytes of this account's copy are never kept anywhere else
      if (open.controller.signal.aborted) return { kind: 'closed' }
      if (!this.ownsLocally(chosen)) {
        open.controller.abort()
        open.finish()
        return { kind: 'closed' }
      }
      if (access.kind === 'keystore_locked') {
        open.draftBlock = 'keystore_locked'
        return { kind: 'view', view: await this.buildConflictView(open, { fetchServer: false }) }
      }
      if (access.kind !== 'ok') {
        return {
          kind: 'view',
          view: await this.buildConflictView(open, { fetchServer: false, notice: 'reload_failed' }),
        }
      }
      const kept = await access.drafts.keep(chosen.key, localBytes, {
        id: open.draftId,
        createdAt: new Date(this.deps.now?.() ?? Date.now()).toISOString(),
        title: chosen.binding.title,
      })
      if (kept !== 'ok') {
        open.draftBlock = kept
        return { kind: 'view', view: await this.buildConflictView(open, { fetchServer: false }) }
      }
      // the dialog ended while the draft was being kept: the draft stays, the tab is not reloaded
      if (open.controller.signal.aborted) return { kind: 'closed' }
    } else if (action.stopAi) {
      this.deps.stopAiRun?.(chosen.path)
    }
    try {
      const done = await this.replaceWithLatest(chosen)
      if (!done) {
        return { kind: 'view', view: await this.buildConflictView(open, { fetchServer: false }) }
      }
      if (open.remoteNotice) {
        this.remoteBars.set(pathKey(done.path), {
          kind: 'updated',
          version: open.remoteNotice.version,
        })
        this.remoteNotices.set(pathKey(done.path), open.remoteNotice)
        this.publish(toStatus(done))
      }
    } catch (error) {
      if (error instanceof UniworkDocError) {
        if (error.code === 'permission_revoked' || error.code === 'forbidden') {
          open.locked = 'revoked'
          open.knownCanEdit = false
        } else if (
          error.code === 'document_deleted' ||
          error.code === 'deleted' ||
          error.code === 'not_found'
        ) {
          open.locked = 'deleted'
          open.knownCanEdit = false
        }
      }
      return {
        kind: 'view',
        view: await this.buildConflictView(open, {
          fetchServer: false,
          notice: open.locked ? null : 'reload_failed',
        }),
      }
    }
    open.controller.abort()
    open.finish()
    return { kind: 'closed' }
  }

  /**
   * G5-12 S5 "Save as a copy": the user's local version becomes a new document
   * and the conflicted one is left exactly as it is (binding, intent, editor).
   * Online only, edit access only; two steps, nothing queued:
   *   1. flush the module's unsaved bytes (the non-uploading flush Reload
   *      keep=draft uses), then POST /documents/{id}/copies (the copy starts as
   *      the server's head bytes, version 1);
   *   2. upload the local bytes and commit them as version 2 of the copy, retried
   *      once. A copy that never got step 2 holds the SERVER's content, so it is
   *      archived (best effort, logged when that fails) and never reported done.
   * A dialog closed mid-flight shows no notice, but the copy it left is archived
   * and logged, never kept silently.
   */
  private async saveCopyInConflict(
    open: ConflictSession,
    chosen: BoundDocument,
    action: Extract<UniworkConflictAction, { kind: 'save-copy' }>,
    currentView: UniworkConflictView,
    copySession: { identity: SessionIdentity; epoch: number } | null,
  ): Promise<UniworkConflictReply> {
    if (!currentView.canEdit) {
      return { kind: 'view', view: { ...currentView, notice: null, noticeArg: null } }
    }
    if (!currentView.online) {
      return { kind: 'view', view: currentView }
    }
    if (action.stopAi) this.deps.stopAiRun?.(chosen.path)
    const aborted = () => open.controller.signal.aborted
    const failed = async (): Promise<UniworkConflictReply> => ({
      kind: 'view',
      view: await this.buildConflictView(open, {
        fetchServer: false,
        notice: open.locked ? null : 'save_copy_failed',
      }),
    })
    if (!copySession || !this.liveIdentity()) {
      return aborted() ? { kind: 'closed' } : failed()
    }
    const lockOn = (error: unknown) => {
      if (!(error instanceof UniworkDocError)) return
      if (error.code === 'permission_revoked' || error.code === 'forbidden') {
        open.locked = 'revoked'
        open.knownCanEdit = false
      } else if (
        error.code === 'document_deleted' ||
        error.code === 'deleted' ||
        error.code === 'not_found'
      ) {
        open.locked = 'deleted'
        open.knownCanEdit = false
      }
    }

    const editor = await this.editorState(chosen.path)
    if (editor.dirty === true || this.editorDirty.has(chosen.path)) {
      if (!(await this.flushModuleForDraft(open, chosen.path))) {
        return aborted() ? { kind: 'closed' } : failed()
      }
      if (aborted()) return { kind: 'closed' }
      if (open.locked) {
        return { kind: 'view', view: await this.buildConflictView(open, { fetchServer: false }) }
      }
      chosen = await this.refreshDirty(chosen)
      open.doc = chosen
    }
    let localBytes: Uint8Array
    try {
      localBytes = new Uint8Array(await readFile(chosen.path))
    } catch {
      return failed()
    }

    const api = this.api()
    const documentId = chosen.binding.documentId
    const title = copyTitleFor(
      chosen.binding.title,
      tUniworkDocs(this.deps.lang?.() ?? 'en', 'copyMyVersion'),
      chosen.binding.format,
    )
    let parentId: string | null
    try {
      // FD-11: the Location the dialog chose wins; without one the copy lands
      // next to its source (today's behaviour). The source is read either way:
      // the read is what proves the copy route is still open to this caller,
      // and its answer is used when no folder was chosen.
      const source = await api.getDocument(documentId)
      if (aborted()) return { kind: 'closed' }
      if (action.targetFolder && action.targetFolder.workspaceId !== source.workspaceId) {
        open.downloadNotice = 'save_copy_folder_refused'
        return {
          kind: 'view',
          view: await this.buildConflictView(open, {
            fetchServer: false,
            notice: 'save_copy_folder_refused',
          }),
        }
      }
      parentId = action.targetFolder ? action.targetFolder.folderId : (source.parentId ?? null)
    } catch (error) {
      lockOn(error)
      return aborted() ? { kind: 'closed' } : failed()
    }
    let created: { summary: UniworkDocSummary; revision: string }
    try {
      created = await api.copyDocument({
        documentId,
        title,
        parentId,
        idempotencyKey: this.newIdempotencyKey(),
      })
    } catch (error) {
      if (aborted()) return { kind: 'closed' }
      // BE-12-201: the server's seat refusal (403 workspace_seat_required): the person is not a
      // member of the source's workspace, so no copy can be made for them. Their version is
      // still local; the dialog offers "Download my version". Any other 403 - a deactivated
      // member, a suspended organization - says nothing about the seat and stays a plain failure
      // (`forbidden` is the folder refusal, below)
      if (
        error instanceof UniworkDocError &&
        error.status === 403 &&
        error.serverCode === COPY_NO_SEAT_CODE
      ) {
        open.downloadNotice = 'save_copy_no_seat'
        return {
          kind: 'view',
          view: await this.buildConflictView(open, {
            fetchServer: false,
            notice: 'save_copy_no_seat',
          }),
        }
      }
      // BE-12-304: a plain 403 `forbidden` of the copy route is the parent folder gate (the request
      // carries the source's own parent_id): the member holds a seat but may not create documents
      // in that folder, and a retry meets the same gate. Same Download step, its own reason
      if (
        error instanceof UniworkDocError &&
        error.status === 403 &&
        error.serverCode === COPY_FOLDER_REFUSED_CODE
      ) {
        open.downloadNotice = 'save_copy_folder_refused'
        return {
          kind: 'view',
          view: await this.buildConflictView(open, {
            fetchServer: false,
            notice: 'save_copy_folder_refused',
          }),
        }
      }
      // any other refusal of the copy itself (owner_requires_copy, a 5xx) is "couldn't create
      // the copy"
      return failed()
    }
    const copyId = created.summary.id

    // UNI-2212: the copy starts as the source's head. A tab declares a conversion only when that
    // head is legacy: the source may have been converted by another device since, or restored to
    // its legacy version after this copy's own conversion cleared the flag
    const copyHead = await this.readLegacyHead(copyId, chosen.binding.format)
    const copyConversion = copyHead?.legacyFrom ? conversionFor(copyHead.legacyFrom) : undefined

    // step 2: the local bytes become version 2 of the copy; one retry, same keys
    const commitKey = this.newIdempotencyKey()
    // BE-12F-02 / FD11-C-R2-01 / R3-01: the account and session epoch that
    // started the conflict action (captured at conflictAct entry before the
    // first await); the cleanup below only talks to the server while it is
    // still signed in (the new account has no access to this copy) and the
    // final push uses the immutable copySession.
    const owner = copySession.identity
    let committed = false
    for (let attempt = 0; attempt < 2 && !committed && !aborted(); attempt += 1) {
      try {
        const upload = await api.upload({
          documentId: copyId,
          bytes: localBytes,
          filename: chosen.binding.filename,
          format: chosen.binding.format,
          idempotencyKey: commitKey,
        })
        if (upload.checksumSha256 !== sha256Hex(localBytes)) {
          throw new UniworkDocError('malformed_response', {
            serverCode: 'upload_checksum_mismatch',
          })
        }
        // an account switch during the upload must not commit this copy under the other account
        if (!this.liveIdentity() || !this.ownsLocally(chosen)) {
          throw new UniworkDocError('not_signed_in')
        }
        await api.commit({
          documentId: copyId,
          uploadId: upload.uploadId,
          baseRevision: created.revision,
          idempotencyKey: commitKey,
          ...(copyConversion ? { conversion: copyConversion } : {}),
        })
        committed = true
      } catch (error) {
        if (error instanceof UniworkDocError && error.code === 'not_signed_in') break
      }
    }
    if (!committed) {
      const current = this.deps.identity()
      if (
        !current ||
        current.accountId !== owner.accountId ||
        current.deploymentId !== owner.deploymentId
      ) {
        // BE-12F-02: nothing is sent under the other account; say what was left behind
        console.warn(
          `uniwork docs: save-copy: copy ${copyId} of account ${owner.accountId} was left behind after an account switch`,
        )
        return aborted() ? { kind: 'closed' } : failed()
      }
      // BE-12F-01: "no answer" is not "not committed": the commit may have landed with its
      // answer lost, and the server refuses to archive a copy that already holds version 2
      const verdict = await this.lookupCopyCommit(copyId, commitKey)
      if (verdict === 'committed') {
        committed = true
      } else if (verdict === 'in_flight') {
        console.warn(
          `uniwork docs: save-copy: copy ${copyId} is still being saved by the server; it was not archived`,
        )
        return aborted() ? { kind: 'closed' } : failed()
      }
    }
    if (committed) {
      // FD-11 / FD11-C-R1-05: announce the copy only once its bytes are committed
      this.pushTreeChangedFor(copySession, created.summary.workspaceId)
      if (aborted()) {
        console.warn(`uniwork docs: save-copy: the dialog closed after copy ${copyId} was saved`)
        return { kind: 'closed' }
      }
      return {
        kind: 'view',
        view: await this.buildConflictView(open, {
          fetchServer: false,
          notice: 'save_copy_done',
          noticeArg: created.summary.title || title,
        }),
      }
    }
    // never leave the server's bytes behind as "your version"
    try {
      await api.archive(copyId, this.newIdempotencyKey())
    } catch (error) {
      console.warn(
        `uniwork docs: save-copy: copy ${copyId} was not completed and could not be archived`,
        error instanceof UniworkDocError ? error.code : 'unknown',
      )
    }
    if (aborted()) {
      console.warn(`uniwork docs: save-copy: the dialog closed before copy ${copyId} was complete`)
      return { kind: 'closed' }
    }
    return failed()
  }

  /**
   * BE-12F-01: what became of the copy's step-2 commit, asked by its own key.
   * `in_flight` gets one bounded wait and a second look; a lookup that cannot
   * be answered (network, malformed) is `not_committed`, so the caller falls
   * back to the cleanup it would have done without it.
   */
  private async lookupCopyCommit(
    copyId: string,
    commitKey: string,
  ): Promise<'committed' | 'not_committed' | 'in_flight'> {
    for (let look = 0; look < 2; look += 1) {
      let outcome: string
      try {
        outcome = (await this.api().lookupCommit({ documentId: copyId, idempotencyKey: commitKey }))
          .outcome
      } catch {
        return 'not_committed'
      }
      if (outcome === 'committed') return 'committed'
      if (outcome !== 'in_flight') return 'not_committed'
      if (look === 0)
        await (this.deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(
          COPY_LOOKUP_WAIT_MS,
        )
    }
    return 'in_flight'
  }

  /**
   * G5-12 "Download my version" (the step-2 button once Save as a copy was
   * refused with no seat): the local version goes to a file the person picks,
   * so no edit is lost. Local only: no server call, no intent, no change to
   * the source, its binding or the editor beyond the same non-uploading flush
   * a kept draft uses. A cancelled OS dialog changes nothing (the notice that
   * opened this step is answered again); a write error stays on step 2.
   */
  private async downloadMineInConflict(
    open: ConflictSession,
    chosen: BoundDocument,
    action: Extract<UniworkConflictAction, { kind: 'download-mine' }>,
  ): Promise<UniworkConflictReply> {
    if (action.stopAi) this.deps.stopAiRun?.(chosen.path)
    const aborted = () => open.controller.signal.aborted
    const stay = async (notice: DownloadStepNotice): Promise<UniworkConflictReply> => {
      open.downloadNotice = notice
      return {
        kind: 'view',
        view: await this.buildConflictView(open, { fetchServer: false, notice }),
      }
    }
    const failed = () => (aborted() ? { kind: 'closed' as const } : stay('download_failed'))

    const editor = await this.editorState(chosen.path)
    if (editor.dirty === true || this.editorDirty.has(chosen.path)) {
      if (!(await this.flushModuleForDraft(open, chosen.path))) return failed()
      if (aborted()) return { kind: 'closed' }
      if (open.locked) {
        return { kind: 'view', view: await this.buildConflictView(open, { fetchServer: false }) }
      }
      chosen = await this.refreshDirty(chosen)
      open.doc = chosen
    }
    let localBytes: Uint8Array
    try {
      localBytes = new Uint8Array(await readFile(chosen.path))
    } catch {
      return failed()
    }

    const format = chosen.binding.format
    let defaultName = copyTitleFor(
      chosen.binding.title,
      tUniworkDocs(this.deps.lang?.() ?? 'en', 'copyMyVersion'),
      format,
    )
    if (formatForName(defaultName) !== format) defaultName = `${defaultName}.${format}`
    let target: string | null
    try {
      target = (await this.deps.pickDownloadPath?.(defaultName)) ?? null
    } catch {
      return failed()
    }
    if (aborted()) return { kind: 'closed' }
    if (!target) {
      // the person cancelled the OS dialog: nothing changed
      return stay(open.downloadNotice ?? 'save_copy_no_seat')
    }
    // A105 (UNI-1362): an account switch (or a lock) inside the awaits above ends
    // the dialog. The same guard the reload path applies, right before the bytes
    // leave: this account's version is never written out under another one.
    if (!this.ownsLocally(chosen)) {
      open.controller.abort()
      open.finish()
      return { kind: 'closed' }
    }
    // A106 (UNI-1362): reject a target picked inside the app's working-copy root
    // before writing, using the existing download_failed refusal outcome.
    if (this.store.isInside(target)) return failed()
    try {
      await writeFile(target, localBytes)
    } catch {
      return failed()
    }
    if (aborted()) return { kind: 'closed' }
    open.downloadNotice = undefined
    return {
      kind: 'view',
      view: await this.buildConflictView(open, {
        fetchServer: false,
        notice: 'download_done',
        noticeArg: basename(target),
      }),
    }
  }

  /**
   * UNI-2212: the head of a document as it is now - its revision and the legacy format a copy
   * bound as `format` still owes it (undefined when the head is OOXML, or another family). Null
   * when the read cannot answer: the caller then keeps what it knew.
   */
  private async readLegacyHead(
    documentId: string,
    format: UniworkDocFormat,
  ): Promise<{ revision: string; legacyFrom: LegacyFrom | undefined } | null> {
    try {
      const detail = await this.api().getDocument(documentId)
      const legacy = legacyOfFile(detail.file, detail.title)
      return {
        revision: detail.revision,
        legacyFrom: legacy && legacyTargetFormat(legacy) === format ? legacy : undefined,
      }
    } catch {
      return null
    }
  }

  private async overwriteInConflict(
    open: ConflictSession,
    chosen: BoundDocument,
    action: Extract<UniworkConflictAction, { kind: 'overwrite' }>,
    currentView: UniworkConflictView,
  ): Promise<UniworkConflictReply> {
    if (!currentView.canEdit) {
      return { kind: 'view', view: { ...currentView, notice: null, noticeArg: null } }
    }
    let serverRevision = open.knownServerRevision ?? chosen.binding.serverRevision ?? null
    if (!serverRevision && currentView.online) {
      try {
        const api = this.api()
        const detail = await api.getDocument(chosen.binding.documentId)
        const props =
          typeof api.documentProperties === 'function'
            ? await api.documentProperties(chosen.binding.documentId).catch(() => null)
            : null
        serverRevision = detail.revision
        open.knownServerRevision = detail.revision
        open.knownServerVersion = detail.file.version
        open.knownServerSavedAt = props?.updatedAt ?? open.knownServerSavedAt
      } catch (error) {
        if (error instanceof UniworkDocError) {
          if (error.code === 'permission_revoked' || error.code === 'forbidden') {
            open.locked = 'revoked'
            open.knownCanEdit = false
          } else if (
            error.code === 'document_deleted' ||
            error.code === 'deleted' ||
            error.code === 'not_found'
          ) {
            open.locked = 'deleted'
            open.knownCanEdit = false
          }
        }
        return {
          kind: 'view',
          view: await this.buildConflictView(open, {
            fetchServer: false,
            notice: open.locked ? null : 'overwrite_failed',
          }),
        }
      }
    }
    if (!serverRevision) {
      return {
        kind: 'view',
        view: await this.buildConflictView(open, {
          fetchServer: false,
          notice: 'overwrite_failed',
        }),
      }
    }
    if (action.stopAi) this.deps.stopAiRun?.(chosen.path)
    // UNI-2212: the head may have been converted by another device since this copy was opened,
    // so what the commit owes follows the head as it is now, read with its revision: a head that
    // is OOXML already takes an ordinary commit (a stale conversion would be refused not_legacy),
    // and a head restored to legacy needs the conversion even though this copy's flag was cleared
    let legacyFrom = chosen.binding.legacyFrom
    if (currentView.online) {
      const head = await this.readLegacyHead(chosen.binding.documentId, chosen.binding.format)
      // an ordinary head keeps the revision the dialog showed: a head that moved since is a 409
      if (head && (legacyFrom || head.legacyFrom)) {
        serverRevision = head.revision
        legacyFrom = head.legacyFrom
      }
    }
    const next: Binding = {
      ...chosen.binding,
      baseRevision: serverRevision,
      // the server's bytes are unknown here: the next Save always uploads.
      // baseVersionId stays: it names the version these bytes were based on (baseVersion is
      // unchanged too), so comments anchored against it remain valid until a Save moves the base
      baseChecksum: '',
      state: 'dirty',
    }
    if (legacyFrom) next.legacyFrom = legacyFrom
    else delete next.legacyFrom
    delete next.error
    delete next.serverRevision
    delete next.serverVersion
    // N1: the view this action decided on was built earlier (its keep-draft
    // probe and capability read await). A Save admitted since then - the user's
    // Ctrl/Cmd+S - must not have its intent superseded or deleted under it, and
    // the base it committed must not be overwritten by this one. Drain it and
    // re-check right before the first destructive step, with no other await in
    // between; a Save that ran leaves the decision to the conflict view.
    if (
      await this.saveRacedReplacement(chosen, {
        baseRevision: chosen.binding.baseRevision,
        baseChecksum: chosen.binding.baseChecksum,
      })
    ) {
      return { kind: 'view', view: await this.buildConflictView(open, { fetchServer: false }) }
    }
    // "Ghi đè": the old intent is superseded BEFORE a new one is minted, so the
    // user's snapshot is spent (superseded), never replayed against the new base
    const releaseSession = await this.supersedePendingDeferRelease(chosen)
    let ready: BoundDocument
    try {
      // the old base's intent is invalid on the server's revision
      await this.dropIntent(chosen)
      ready = await this.coordinator.commitState(chosen, next)
    } finally {
      // the superseded intent's upload session is released after the local steps, and also
      // when one of them fails, so the server session is never leaked
      await releaseSession()
    }
    if (!currentView.online) {
      await this.coordinator.save(ready.path, { forceOffline: true })
      open.controller.abort()
      open.finish()
      return { kind: 'closed' }
    }
    if (this.deps.requestModuleSave(ready.path, open.onNotWritten)) {
      open.controller.abort()
      open.finish()
      return { kind: 'closed' }
    }
    const saved = await this.coordinator.save(ready.path)
    const after = this.store.lookup(ready.path) ?? saved ?? ready
    if (after.binding.state === 'conflict') {
      open.doc = after
      if (after.binding.serverRevision) open.knownServerRevision = after.binding.serverRevision
      const refreshed = await this.buildConflictView(open, {
        fetchServer: true,
        notice: 'head_moved',
      })
      return {
        kind: 'view',
        view: {
          ...refreshed,
          notice: 'head_moved',
          noticeArg: open.knownServerVersion !== null ? String(open.knownServerVersion) : null,
        },
      }
    }
    if (after.binding.state === 'blocked' && open.locked) {
      return { kind: 'view', view: await this.buildConflictView(open, { fetchServer: false }) }
    }
    if (after.binding.state === 'error' || after.binding.state === 'failed') {
      return {
        kind: 'view',
        view: await this.buildConflictView(open, {
          fetchServer: false,
          notice: 'overwrite_failed',
        }),
      }
    }
    open.controller.abort()
    open.finish()
    return { kind: 'closed' }
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
      access: b.shelved ? 'view' : b.access,
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
      ...(b.shelved ? { level: 'view' } : b.level ? { level: b.level } : {}),
      myUserId: doc.userId,
    }
  }

  // ---- flows -----------------------------------------------------------------

  /** "Discard my changes and open the latest": download, replace, reload the tab */
  private async replaceWithLatest(doc: BoundDocument): Promise<BoundDocument | null> {
    // A Save of this path may still be in flight: the module's own Save landing
    // in the keep-draft flush window, or a Ctrl/Cmd+S racing the dialog. Its
    // durable intent must never be superseded or deleted under it - the record
    // is what authorizes the commit POST (R2), so deleting it refuses the POST
    // and orphans the staged upload, and the base read below would race the
    // commit.
    // N1: a Save can also be admitted DURING this action (the user's Ctrl/Cmd+S
    // while the download runs). So the drain + re-check runs immediately before
    // the first destructive step - `supersedePending` / `writeWorkingCopy` /
    // `dropIntent` - with no other await in between: a Save that ran (its
    // durable intent is not `none`, or the base this action started from moved)
    // leaves the replacement to the dialog's conflict view instead.
    const start = {
      baseRevision: doc.binding.baseRevision,
      baseChecksum: doc.binding.baseChecksum,
    }
    const { detail, bytes } = await this.fetchLatest(doc.binding.documentId)
    if (await this.saveRacedReplacement(doc, start)) return null
    // "Tải lại": the old intent is superseded BEFORE the base is replaced, so
    // it is spent (cancelled/superseded), never replayed against the new base
    const releaseSession = await this.supersedePendingDeferRelease(doc)
    let done: BoundDocument
    try {
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
      // reloading the tab discards any pre-reload editor edits (and outdates an in-flight poll pass)
      this.lastUserSave.set(doc.path, ++this.saveCounter)
      this.editorDirty.delete(doc.path)
      done = await this.coordinator.commitState(doc, next)
      // the bar belonged to the replaced base: the copy is at the head now
      this.remoteBars.delete(pathKey(doc.path))
      this.remoteNotices.delete(pathKey(doc.path))
      this.deps.reloadPath(doc.path)
    } finally {
      // the superseded intent's upload session is released after the local steps, and also
      // when one of them fails, so the server session is never leaked
      await releaseSession()
    }
    return done
  }

  /** detail + bytes of the current version, consistent with each other */
  private async fetchLatest(
    documentId: string,
    first?: DocumentDetail,
  ): Promise<{ detail: DocumentDetail; bytes: Uint8Array; format: UniworkDocFormat | null }> {
    let detail = first ?? (await this.api().getDocument(documentId))
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { bytes } = await this.api().download(documentId)
      if (sha256Hex(bytes) === detail.file.checksumSha256) {
        // UNI-2212: the bytes the caller writes as the working copy are the converted OOXML of a
        // legacy head (the checksum above is the server's, of the raw bytes)
        const opened = await this.openableBytes(bytes, {
          hint: legacyOfFile(detail.file, detail.title),
          name: detail.title,
        })
        return { detail, bytes: opened.bytes, format: opened.format }
      }
      // a save landed between the two reads: read the detail again
      detail = await this.api().getDocument(documentId)
    }
    throw new UniworkDocError('malformed_response')
  }

  /**
   * UNI-2212: what a downloaded file opens as. A compound file (.doc/.xls/.ppt) goes through the
   * app's converter (the progress box, Cancel and typed notices are the converter's); an OOXML
   * package under a legacy name opens as it is. Anything else is not ours to touch.
   */
  private async openableBytes(
    bytes: Uint8Array,
    options: { hint: LegacyFrom | null; name: string },
  ): Promise<{ bytes: Uint8Array; format: UniworkDocFormat | null }> {
    if (!isCfbBytes(bytes)) {
      if (!options.hint) return { bytes, format: null }
      // a legacy MIME type or name on a file that is really OOXML: it opens as the format it is,
      // provided it is the family the commit's conversion pair names
      const kind = detectOoxmlKindFromZipBytes(bytes)
      if (kind !== legacyTargetFormat(options.hint)) throw new UniworkDocError('unsupported_format')
      return { bytes, format: kind }
    }
    const detected = legacyOfCfbBytes(bytes)
    // the head says it is one legacy family and the compound file is another: the commit's
    // conversion pair would be refused, so nothing opens (the same refusal as an OOXML mismatch)
    if (options.hint && detected && detected !== options.hint) {
      throw new UniworkDocError('unsupported_format')
    }
    const from = detected ?? options.hint
    if (!from) return { bytes, format: null }
    const convert = this.deps.convertLegacy
    if (!convert) throw new UniworkDocError('unsupported_format')
    const name = options.name.toLowerCase().endsWith(`.${from}`)
      ? options.name
      : `${options.name}.${from}`
    const out = await convert({ bytes, from, name })
    if (!out.ok) {
      throw new UniworkDocError(
        out.reason === 'cancelled' ? 'legacy_cancelled' : 'legacy_open_failed',
      )
    }
    return { bytes: out.bytes, format: out.to }
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
    let detail: DocumentDetail
    try {
      detail = await this.api().getDocument(documentId)
    } catch (error) {
      // G5-05u (B5): with no network a pinned document opens its verified cached
      // copy, read-only - the offline edit hold is G5-08d (UNI-1645). Only the
      // network/timeout class falls back (BE-R1-4): 401/403/404/410 are the
      // server's own verdict about this document (a revoke, a delete), and a
      // stale ready copy must never reopen over them.
      const offline =
        error instanceof UniworkDocError && (error.code === 'network' || error.code === 'timeout')
      if (offline) {
        const copy: OfflineCopyOpen =
          (await this.deps.openOfflineCopy?.(documentId).catch(() => null as OfflineCopyOpen)) ??
          null
        if (copy?.kind === 'opened') return { path: copy.path, title: copy.title }
        if (copy?.kind === 'locked') this.recordOfflineLock(copy)
      }
      throw error
    }
    // UNI-2212: a live version that is still a legacy .doc/.xls/.ppt opens as its OOXML conversion
    const legacyHead = legacyOfFile(detail.file, detail.title)
    let format =
      (legacyHead ? legacyTargetFormat(legacyHead) : null) ??
      formatForMime(detail.file.mimeType) ??
      formatForName(detail.file.filename) ??
      formatForName(detail.title)
    if (!format) throw new UniworkDocError('unsupported_format')
    // A ticket without a version takes the live ACL (view only when the
    // descriptor says view). The one exception for a version ticket is a
    // version that is still the current one while a tab of the document is
    // open: that tab is focused, neither duplicated, downgraded nor upgraded. A legacy head is the
    // exception (UNI-2212): its history view must stay the read-only @vN copy, because the editable
    // tab of a legacy head can still commit its conversion.
    if (viewTicket && launch.version === detail.file.version && !legacyHead) {
      const open = await this.openTabCopy(identity, documentId)
      if (open) return this.focusOpen(open.path, open.title)
    }
    // UNI-2033: the @vN copy names the version it shows to the comments seam; a failed lookup
    // leaves it unset (the comments kit then keeps a lost thread lost)
    const viewVersionId = viewTicket
      ? await this.versionIdOf(documentId, launch.version, detail)
      : undefined
    const viewRequested = !!launch && launch.version === 0 && launch.operation === 'view'
    const effectiveViewOnly = viewTicket || viewRequested || Boolean(detail.shelvedAt)
    const access: UniworkDocAccess = effectiveViewOnly ? 'view' : accessFor(detail.myLevel)
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
          if (viewVersionId) binding.baseVersionId = viewVersionId
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
          // 404): its local work can be saved once more. An archived document
          // answers again only when THIS read proves BOTH that the archive
          // lifted AND that this copy may be edited (the same `canEdit` the
          // queue's blocked re-probe reads: probeBlockedDoc lifts an archived
          // block only for `flags.canEdit && !flags.archived`,
          // service.ts:1760-1763; `access` folds in the view-ticket downgrade
          // the probe has no copy of, so it is the stricter of the two) - while
          // either holds, the write is still refused and clearing the block
          // would only earn it again
          if (
            existing.state === 'blocked' &&
            (existing.error === 'not_found' ||
              existing.error === 'deleted' ||
              existing.error === 'document_deleted' ||
              (existing.error === 'document_archived' &&
                access === 'edit' &&
                detail.archivedAt === null))
          ) {
            binding.state = localChecksum === existing.baseChecksum ? 'ready' : 'dirty'
            delete binding.error
            // the document answers again: the verdict it earned is spent (an
            // archived block raised no lock, so this is a no-op for it)
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
      // UNI-2212: a version from history can be a legacy file under a document whose head is
      // already OOXML, so the bytes (not the head's metadata) decide whether the converter runs
      const raw = (await this.api().download(documentId, launch.version)).bytes
      const opened = await this.openableBytes(raw, { hint: null, name: detail.title })
      bytes = opened.bytes
      if (opened.format) format = opened.format
    } else {
      const latest = await this.fetchLatest(documentId, detail)
      bytes = latest.bytes
      base = latest.detail
      if (latest.format) format = latest.format
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
    if (viewVersionId) binding.baseVersionId = viewVersionId
    // a refused write is never ignored, exactly as in the branch above: the
    // copy then reads as the binding that persisted, not the refused one
    const written = await this.store.write(dir, binding)
    return this.show(path, written ? binding : (existing ?? binding))
  }

  /**
   * UNI-2033: the server id of version `versionNo`, or undefined when it cannot be read. The head
   * version is already named by the document read, so only an older one costs a request.
   */
  private async versionIdOf(
    documentId: string,
    versionNo: number,
    detail: DocumentDetail,
  ): Promise<string | undefined> {
    if (versionNo === detail.file.version) return detail.file.versionId
    try {
      return await this.api().getVersionId(documentId, versionNo)
    } catch {
      return undefined
    }
  }

  /**
   * UNI-2033 "View in version N" (and the UNI-2077 version preview): the read-only `@vN` copy
   * of a document, opened like a view ticket but without one (the shell already holds the
   * account session), then the thread of `commentId`, when one is named, is revealed in it
   * through the same held reveal a launch ticket uses.
   */
  async openVersionView(
    documentId: string,
    versionNo: number,
    commentId?: string,
  ): Promise<{ path: string; title: string }> {
    if (!this.liveIdentity()) throw new UniworkDocError('not_signed_in')
    const detail = await this.api().getDocument(documentId)
    const opened = await this.openFromServer(documentId, {
      // a ticket's bookkeeping fields; the view open reads none of them
      receiptId: '',
      redeemedAt: '',
      downloadPath: '',
      id: documentId,
      organizationId: detail.organizationId,
      workspaceId: detail.workspaceId,
      title: detail.title,
      operation: 'view',
      version: versionNo,
      revision: detail.revision,
    })
    // UNI-2077: the version history opens the same copy with no thread to reveal
    if (commentId) this.deps.revealComment?.(opened.path, commentId)
    return opened
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

  /**
   * G5-05u B5: show a file of this session's working-copy store that no open
   * flow produced - the read-only offline copy of a pinned document. Null when
   * the shell did not open it.
   */
  showOfflineCopy(path: string): { path: string; title: string } | null {
    try {
      return this.show(path, null)
    } catch {
      return null
    }
  }

  private show(path: string, binding: Binding | null): { path: string; title: string } {
    this.refuseOpen(path)
    if (!this.deps.openPath(path)) throw new UniworkDocError('unsupported_format')
    const doc = this.store.lookup(path)
    if (doc) this.publish(toStatus(doc))
    if (doc && doc.binding.access === 'edit' && !doc.binding.shelved) this.startEditLock(doc)
    return { path, title: binding?.title ?? doc?.binding.title ?? basename(path) }
  }
}
