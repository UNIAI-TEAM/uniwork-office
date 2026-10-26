/**
 * G5-10 (UNI-1357): Shared IPC contract between main, preload, and renderer
 * for the UniWork Sync Center (S2: Settings › Sync center).
 *
 * The renderer reads `SyncCenterSnapshot` and invokes actions through
 * `window.uniworkSyncCenter`. Main owns all queue, draft, pause, capability,
 * and session state.
 */

import {
  EMPTY_OFFLINE_LIBRARY_SNAPSHOT,
  type OfflineLibraryQuota,
  type OfflineLibrarySnapshot,
  type UniworkOfflineLibraryApi,
} from './offline-library'

export const UNIWORK_SYNC_CENTER_CHANNELS = {
  snapshot: 'uniwork-sync-center:snapshot',
  syncNow: 'uniwork-sync-center:sync-now',
  setSendingPaused: 'uniwork-sync-center:set-sending-paused',
  sendNow: 'uniwork-sync-center:send-now',
  cancelSave: 'uniwork-sync-center:cancel-save',
  recheck: 'uniwork-sync-center:recheck',
  copySupportCode: 'uniwork-sync-center:copy-support-code',
  discardSave: 'uniwork-sync-center:discard-save',
  openDocument: 'uniwork-sync-center:open-document',
  openDraft: 'uniwork-sync-center:open-draft',
  discardDraft: 'uniwork-sync-center:discard-draft',
  saveAgain: 'uniwork-sync-center:save-again',
  saveMyCopy: 'uniwork-sync-center:save-my-copy',
  retryStore: 'uniwork-sync-center:retry-store',
  /** G5-05u (UNI-1360): the offline library of the S3 tab, same object */
  offlinePin: 'uniwork-sync-center:offline-pin',
  offlineUnpin: 'uniwork-sync-center:offline-unpin',
  offlineCancel: 'uniwork-sync-center:offline-cancel',
  offlineDownloadNow: 'uniwork-sync-center:offline-download-now',
  offlineOpen: 'uniwork-sync-center:offline-open',
  offlineOpenFolder: 'uniwork-sync-center:offline-open-folder',
  offlineState: 'uniwork-sync-center:offline-state',
  changedEvent: 'uniwork-sync-center:changed',
} as const

/**
 * The 10 priority conditions of "Đầu trang S2" in EXPERIENCE.md, ordered from
 * highest priority (1: `store_newer`) to lowest (10: `online`).
 */
export const SYNC_CENTER_HEADER_PRIORITY = [
  'store_newer',
  'signed_out',
  'session_expired',
  'admin_paused',
  'offline',
  'paused',
  'resync_failed',
  'feed_off',
  'resynced',
  'online',
] as const

export type SyncCenterHeaderStatus = (typeof SYNC_CENTER_HEADER_PRIORITY)[number]

export interface SyncCenterAccountInfo {
  name: string
  email?: string
}

export interface SyncCenterOrgInfo {
  id: string
  name: string
}

export interface SyncCenterStoreBudget {
  /** Bytes currently used in the local sync/queue store. */
  used: number
  /** Maximum byte capacity of the local sync/queue store. */
  cap: number
}

export interface SyncCenterHeader {
  /** Resolved single status line discriminant from the 10-row priority table. */
  status: SyncCenterHeaderStatus
  online: boolean
  /** User-toggled pause ("Tạm dừng gửi"). */
  paused: boolean
  /** Admin capability `sync_write` disabled. */
  adminPaused: boolean
  /** ISO-8601 timestamp (or formatted label) of the last completed sync. */
  lastSyncAt?: string
  account?: SyncCenterAccountInfo
  org?: SyncCenterOrgInfo
  storeBudget?: SyncCenterStoreBudget
  /** True when another organization on this device has queued/attention intents. */
  otherOrgHasIntents: boolean
  /** Count of non-committed intents belonging to other organizations on this device. */
  otherOrgCount?: number
  resyncFailed: boolean
  feedOff: boolean
  resynced: boolean
}

export const SYNC_CENTER_ATTENTION_STATES = [
  'reconciling_stuck',
  'conflict',
  'blocked',
  'failed',
  'kept_draft',
] as const

export const SYNC_CENTER_PENDING_STATES = [
  'queued',
  'paused_offline',
  'paused_user',
  'paused_admin',
  'uploading',
  'committing',
  'reconciling',
  'moved',
  'archived',
] as const

export const SYNC_CENTER_RECENT_STATES = ['committed'] as const

export type SyncCenterRowState =
  | (typeof SYNC_CENTER_ATTENTION_STATES)[number]
  | (typeof SYNC_CENTER_PENDING_STATES)[number]
  | (typeof SYNC_CENTER_RECENT_STATES)[number]

/**
 * The 13 blocked reasons of EXPERIENCE.md › "Lý do bị chặn" (pill, S2 rows, S3,
 * S11). `keyring_unavailable` is not one: that machine never has a session.
 */
export const SYNC_CENTER_BLOCKED_REASONS = [
  'session_expired',
  'signed_out',
  'foreign_account',
  'permission_revoked',
  'document_deleted',
  'document_archived',
  'organization_suspended',
  'member_deactivated',
  'lease_expired',
  'keystore_locked',
  'clock_rollback',
  'store_full',
  'store_newer',
] as const

export type SyncCenterBlockedReason = (typeof SYNC_CENTER_BLOCKED_REASONS)[number]

/**
 * Blocked reasons whose row offers "Bỏ nháp…": the user may discard the local
 * snapshot of an intent the server will not take (access or document lost).
 */
export const SYNC_CENTER_DISCARDABLE_BLOCKED_REASONS: readonly SyncCenterBlockedReason[] = [
  'permission_revoked',
  'document_deleted',
  'document_archived',
  'member_deactivated',
]

export type SyncCenterFailedReason = 'quota' | 'too_large' | 'edit_locked' | 'other'

export interface SyncCenterRowProgress {
  done: number
  total: number
}

export interface SyncCenterConflictInfo {
  version: number
  author?: string
  savedAt?: string
}

export interface SyncCenterRow {
  id: string
  documentId: string
  documentKey: string
  title: string
  ext: string
  state: SyncCenterRowState
  blockedReason?: SyncCenterBlockedReason
  /**
   * True when `blockedReason === 'lease_expired'` and the org capability
   * `offline_library` is off: the lease cannot be renewed until it is back on,
   * so the row offers "Mở trung tâm đồng bộ" instead of "Kết nối lại".
   */
  libraryOff?: boolean
  failedReason?: SyncCenterFailedReason
  progress?: SyncCenterRowProgress
  /** ISO-8601 timestamp when this save intent / draft / commit was recorded. */
  savedAt: string
  /** Base version number the save was built against (`v{base}`). */
  base?: number
  /** Payload size in bytes when known. */
  sizeBytes?: number
  /** Maximum allowed document size in bytes when `failedReason === 'too_large'`. */
  maxBytes?: number
  /** Number of reconcile attempts for `reconciling_stuck` rows. */
  reconcileAttempts?: number
  /** Server version metadata when `state === 'conflict'`. */
  conflict?: SyncCenterConflictInfo
  /** Committed server version number when `state === 'committed'`. */
  committedVersion?: number
  /** Target workspace name when `state === 'moved'`. */
  workspaceName?: string
  /** Display name of the user holding the document lock. */
  lockedBy?: string
  /** Diagnostic support code for `reconciling_stuck` rows. */
  supportCode?: string
  /** Last known edit permission for the document (`Tải bản của tôi về máy` requires `canEdit`). */
  canEdit: boolean
  /** True on a `kept_draft` row whose access has been revoked (only `Bỏ nháp…` allowed). */
  revoked?: boolean
  /** Underlying kept-draft ID when `state === 'kept_draft'` (or when a draft is linked). */
  draftId?: string
}

/** the three tabs whose rows live in `SyncCenterTabs` */
export type SyncCenterRowTabId = 'attention' | 'pending' | 'recent'
/** the S2 tablist: attention, pending, offline (G5-05u, its own rows), recent */
export type SyncCenterTabId = SyncCenterRowTabId | 'offline'
export type SyncCenterDefaultTab = 'attention' | 'pending'

export interface SyncCenterTabs {
  attention: SyncCenterRow[]
  pending: SyncCenterRow[]
  recent: SyncCenterRow[]
}

export interface SyncCenterSignedOutSummary {
  /** Number of encrypted local items waiting on this device; no document titles are exposed when signed out. */
  lockedCount: number
}

export interface SyncCenterSnapshot {
  header: SyncCenterHeader
  /** Present when `header.status === 'signed_out'`. Never exposes document names. */
  signedOut?: SyncCenterSignedOutSummary
  /** True when the local SQLite/queue store could not be read (`uwSyncStoreError`). */
  storeError: boolean
  /** Rows filtered by the active organization (empty arrays when signed out or `storeError`). */
  tabs: SyncCenterTabs
  /**
   * G5-05u: the offline library (S3 tab "Dùng khi không có mạng"). Present on
   * every snapshot; `visible` false keeps the tab out of the tablist.
   */
  offline: OfflineLibrarySnapshot
  /** `'attention'` when `tabs.attention.length > 0`, otherwise `'pending'`. */
  defaultTab: SyncCenterDefaultTab
}

function isOfflineLibrarySnapshot(value: unknown): value is OfflineLibrarySnapshot {
  if (!value || typeof value !== 'object') return false
  const offline = value as Partial<OfflineLibrarySnapshot>
  if (typeof offline.visible !== 'boolean' || typeof offline.capabilityOn !== 'boolean')
    return false
  const quota = offline.quota as Partial<OfflineLibraryQuota> | null | undefined
  if (!quota || typeof quota !== 'object' || !Array.isArray(offline.rows)) return false
  return ['usedBytes', 'maxBytes', 'pins', 'maxPins'].every(
    (k) => typeof quota[k as never] === 'number',
  )
}

/**
 * The string fields the renderer's model reads off every tab row before it can
 * render it (plus the boolean `canEdit`); a row missing one would throw inside
 * the model, so the guard drops the whole snapshot rather than hand one over.
 */
const SYNC_CENTER_ROW_STRING_FIELDS = [
  'id',
  'documentId',
  'documentKey',
  'title',
  'ext',
  'state',
  'savedAt',
] as const

/**
 * A snapshot the renderer's model can read without crashing: a header with a
 * status and `online`, and the three tab arrays holding well-formed rows; when
 * `offline` is missing or malformed, it is replaced with the hidden empty
 * offline library block without dropping the snapshot.
 */
export function asSyncCenterSnapshot(value: unknown): SyncCenterSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const snap = value as { header?: unknown; tabs?: unknown; offline?: unknown }
  const header = snap.header as { status?: unknown; online?: unknown } | null | undefined
  const tabs = snap.tabs as Record<string, unknown> | null | undefined
  if (!header || typeof header !== 'object' || typeof header.status !== 'string') return null
  if (typeof header.online !== 'boolean') return null
  if (!tabs || typeof tabs !== 'object') return null
  if (!['attention', 'pending', 'recent'].every((tab) => Array.isArray(tabs[tab]))) return null
  if (
    !['attention', 'pending', 'recent'].every((tab) =>
      (tabs[tab] as unknown[]).every((row) => {
        if (!row || typeof row !== 'object') return false
        const fields = row as Record<string, unknown>
        return (
          SYNC_CENTER_ROW_STRING_FIELDS.every((field) => typeof fields[field] === 'string') &&
          typeof fields.canEdit === 'boolean'
        )
      }),
    )
  ) {
    return null
  }
  if (isOfflineLibrarySnapshot(snap.offline)) return value as SyncCenterSnapshot
  return { ...(value as SyncCenterSnapshot), offline: EMPTY_OFFLINE_LIBRARY_SNAPSHOT }
}

export type SyncCenterActionErrorCode =
  'draft_cap' | 'store_full' | 'offline' | 'not_found' | 'busy' | 'other'

export type SyncCenterActionResult = { ok: true } | { ok: false; code: SyncCenterActionErrorCode }

export interface UniworkSyncCenterApi {
  /** Read the current Sync Center snapshot. */
  getSnapshot(): Promise<SyncCenterSnapshot>
  /** Trigger an immediate sync pass (`Đồng bộ ngay`). Refuses with `'offline'` when offline. */
  syncNow(): Promise<SyncCenterActionResult>
  /** Pause (`true`) or resume (`false`) user sending (`Tạm dừng gửi` / `Tiếp tục gửi`). */
  setSendingPaused(paused: boolean): Promise<SyncCenterActionResult>
  /** Prioritize/send a single queued or paused row immediately (`Gửi ngay`). */
  sendNow(rowId: string): Promise<SyncCenterActionResult>
  /**
   * Cancel a pending/blocked/failed save (`Hủy lần lưu…`) after UI confirmation.
   * Safe cancel: never loses the user's typed content — goes through the save pill's own
   * cancel path; a document open in a window keeps its work there (its chip goes back to
   * unsaved), a closed one keeps the intent snapshot as a `kept_draft` (up to the 3-draft /
   * store cap; a refusal leaves the intent as it was: `'draft_cap'` / `'store_full'`).
   */
  cancelSave(rowId: string): Promise<SyncCenterActionResult>
  /** Re-verify a `reconciling` / `reconciling_stuck` / `blocked` / `failed` intent (`Kiểm tra lại` / `Thử lại`). */
  recheck(rowId: string): Promise<SyncCenterActionResult>
  /** Copy the `supportCode` of a `reconciling_stuck` row to the OS clipboard in main (`Sao chép mã hỗ trợ`). */
  copySupportCode(rowId: string): Promise<SyncCenterActionResult>
  /**
   * Convert a `reconciling_stuck` intent into a kept draft via `drafts.keep` (`Bỏ lần lưu…`).
   * Refuses with `'draft_cap'` (at 3 kept drafts for the document) or `'store_full'`, leaving
   * the intent untouched on refusal.
   */
  discardSave(rowId: string): Promise<SyncCenterActionResult>
  /** Open the row's document in the workbench (`Mở tài liệu` / `Xem phiên bản mới` / `So sánh`). */
  openDocument(rowId: string): Promise<SyncCenterActionResult>
  /** Open a kept draft in read-only mode (`Mở nháp`). */
  openDraft(rowId: string): Promise<SyncCenterActionResult>
  /**
   * Permanently remove a kept draft (`Bỏ nháp…`). Also works on a `blocked` intent row whose
   * reason is `permission_revoked`, `document_deleted`, `document_archived` or
   * `member_deactivated` (the user-confirmed way out; a block never deletes the snapshot by
   * itself): the intent is cancelled and its snapshot dropped without keeping a draft. Any
   * other blocked reason, or a non-blocked intent row, refuses with `'busy'`.
   */
  discardDraft(rowId: string): Promise<SyncCenterActionResult>
  /**
   * `Lưu lại` on a `failed` row: the old intent is superseded (`cancelled`, reason
   * `superseded`), then a new intent is minted from the same snapshot and enqueued.
   * Refuses with `'not_found'` for an unknown row, `'busy'` when the row is not `failed` (or the old
   * intent cannot be superseded), and `'store_full'` when the store will not take the new intent.
   * While offline the new intent parks `paused_offline`; it is not refused.
   */
  saveAgain(rowId: string): Promise<SyncCenterActionResult>
  /**
   * Export the user's local payload via the OS save dialog with default filename
   * `{title} (bản của tôi).{ext}` (`Tải bản của tôi về máy`). Only allowed when `canEdit` is true.
   */
  saveMyCopy(rowId: string): Promise<SyncCenterActionResult>
  /** Retry opening/reading the local sync store after `storeError` (`Thử lại`). */
  retryStore(): Promise<SyncCenterActionResult>
  /** Subscribe to debounced snapshot pushes when queue, pause, online, capability, or session changes. */
  subscribe(cb: (snapshot: SyncCenterSnapshot) => void): () => void
}

declare global {
  interface Window {
    /** G5-05u: one object, the S2 half (`UniworkSyncCenterApi`) and the offline library half */
    uniworkSyncCenter?: UniworkSyncCenterApi & UniworkOfflineLibraryApi
  }
}
