/**
 * G5-10 (UNI-1357): Shared IPC contract between main, preload, and renderer
 * for the UniWork Sync Center (S2: Settings › Sync center).
 *
 * The renderer reads `SyncCenterSnapshot` and invokes actions through
 * `window.uniworkSyncCenter`. Main owns all queue, draft, pause, capability,
 * and session state.
 */

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
  saveMyCopy: 'uniwork-sync-center:save-my-copy',
  retryStore: 'uniwork-sync-center:retry-store',
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

export type SyncCenterBlockedReason =
  | 'locked_other'
  | 'locked_expired'
  | 'revoked'
  | 'read_only'
  | 'archived'
  | 'removed'
  | 'moved'
  | 'parent_gone'

export type SyncCenterFailedReason = 'quota' | 'too_large' | 'other'

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
  failedReason?: SyncCenterFailedReason
  progress?: SyncCenterRowProgress
  /** ISO-8601 timestamp when this save intent / draft / commit was recorded. */
  savedAt: string
  /** Base version number the save was built against (`v{base}`). */
  base?: number
  /** Payload size in bytes when known. */
  sizeBytes?: number
  /** Number of reconcile attempts for `reconciling_stuck` rows. */
  reconcileAttempts?: number
  /** Server version metadata when `state === 'conflict'`. */
  conflict?: SyncCenterConflictInfo
  /** Committed server version number when `state === 'committed'`. */
  committedVersion?: number
  /** Target workspace name when `state === 'moved'` or `blockedReason === 'moved'`. */
  workspaceName?: string
  /** Lock holder display name when `blockedReason === 'locked_other'`. */
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

export type SyncCenterTabId = 'attention' | 'pending' | 'recent'
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
  /** `'attention'` when `tabs.attention.length > 0`, otherwise `'pending'`. */
  defaultTab: SyncCenterDefaultTab
}

export type SyncCenterActionErrorCode =
  | 'draft_cap'
  | 'store_full'
  | 'offline'
  | 'not_found'
  | 'busy'
  | 'other'

export type SyncCenterActionResult =
  | { ok: true }
  | { ok: false; code: SyncCenterActionErrorCode }

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
   * Safe cancel: never loses the user's typed content — delegates to `dispatcher.cancel`
   * with `openWindowHasNewer: false` when no open editor holds a newer copy so the
   * intent snapshot is preserved as a `kept_draft` (up to the 3-draft / store cap).
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
  /** Permanently remove a kept draft (`Bỏ nháp…`). */
  discardDraft(rowId: string): Promise<SyncCenterActionResult>
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
    uniworkSyncCenter?: UniworkSyncCenterApi
  }
}
