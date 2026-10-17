import type { UniworkLockReason } from './home-api'

/**
 * G5-05u (UNI-1360): the offline library's slice of the Sync Center contract -
 * the S3 tab "Dùng khi không có mạng" and the S11 lock reasons it can raise.
 *
 * Main owns every state. The renderer reads this projection and sends intents
 * only (pin / unpin / cancel / download / open / openFolder): A04-3 holds, no
 * call can set a row ready, verified or a lease. An offline copy is ALWAYS
 * read-only here (UNI-1645): the offline edit hold is G5-08d / EL-DESKTOP.
 */

/**
 * The states of EXPERIENCE.md › "Offline library rows (S3)", highest priority
 * first (revoked/deleted > lease-expired/locked > disk-full/corrupt >
 * interrupted > downloading/verifying > lease-expiring > update-available/
 * update kept > waiting-network > archived/moved > ready/view-only). The engine
 * picks the one state a row shows; the renderer never re-ranks.
 */
export const OFFLINE_ROW_STATES = [
  'revoked',
  'deleted',
  'lease-expired',
  'locked',
  'disk-full',
  'corrupt',
  'interrupted',
  'downloading',
  'verifying',
  'lease-expiring',
  'update-available',
  'update-kept',
  'waiting-network',
  'archived',
  'moved',
  'view-only',
  'ready',
] as const

export type OfflineRowState = (typeof OFFLINE_ROW_STATES)[number]

/**
 * A blocked reason an S3 row or the S11 panel names (EXPERIENCE.md › "Lý do bị
 * chặn"). Every one of them is an S11 lock reason.
 */
export type OfflineBlockedReason = Extract<
  UniworkLockReason,
  | 'session_expired'
  | 'signed_out'
  | 'foreign_account'
  | 'permission_revoked'
  | 'document_deleted'
  | 'organization_suspended'
  | 'member_deactivated'
  | 'lease_expired'
  | 'keystore_locked'
  | 'clock_rollback'
>

export interface OfflineRowProgress {
  done: number
  total: number
}

/** one S3 row, as main projects it (`PinRow` -> `OfflineRowView`) */
export interface OfflineRowView {
  documentId: string
  workspaceId: string
  /** the file name of the manifest (an S3 row is named by its file) */
  name: string
  state: OfflineRowState
  /** the download's progress while it runs, else null */
  progress: OfflineRowProgress | null
  /** the committed version of a ready row */
  version: number | null
  /** the head version the pin asks for (update-available / update-kept) */
  headVersion: number | null
  /** committed bytes, or the declared bytes while the snapshot is on its way */
  sizeBytes: number | null
  /** ISO expiry of the lease behind the copy (null without one) */
  leaseUntil: string | null
  leaseLevel: 'view' | 'edit' | null
  /** why an update was kept instead of applied (`too_large`, `corrupt`, `store_full`, ...) */
  updateKeptReason: string | null
  /** bytes a `disk-full` row needs, when the manifest names them */
  diskNeededBytes?: number
  /** the blocked reason of a `lease-expired` / `locked` row (`uwRowBlocked {reason}`) */
  lockReason?: OfflineBlockedReason
  /** a `lease_expired` lock while the org capability `offline_library` is off */
  libraryOff?: boolean
  /** a tab of the copy is open: its unpin cleanup waits for the last close */
  open: boolean
}

/** the U-01 quota of the library: 2 GiB and 200 pins per account per machine */
export interface OfflineLibraryQuota {
  usedBytes: number
  maxBytes: number
  pins: number
  maxPins: number
}

export interface OfflineLibrarySnapshot {
  /** the S3 tab is in the tablist: the capability is on, or rows are kept (OQ-UX11) */
  visible: boolean
  /** the org capability `offline_library`; false hides pin and "Thêm tài liệu…" */
  capabilityOn: boolean
  /** signed out: the number of kept items, never a name */
  signedOutLockedCount?: number
  quota: OfflineLibraryQuota
  rows: OfflineRowView[]
}

/**
 * A refusal of any offline library action. `lockReason` is what the S11 panel
 * names; the rest are the engine's refusal codes (its own vocabulary, checked
 * one way at the projection).
 */
export type OfflineFailureCode =
  | 'offline_cap_reached'
  | 'too_large'
  | 'capability_off'
  | 'not_a_file'
  | 'not_pinned'
  | 'not_ready'
  | 'corrupt'
  | 'lease_unusable'
  | 'revoked'
  | 'deleted'
  | 'offline'
  | 'invalid'
  | 'store_full'
  | 'no_session'
  | 'keystore_locked'
  | 'keyring_unavailable'
  | 'interrupted'
  | 'needs_confirm'
  | 'unknown'

export interface OfflineFailure {
  ok: false
  code: OfflineFailureCode
  /** the S11 reason this refusal names (absent when nothing is locked) */
  lockReason?: OfflineBlockedReason
  /** `lockReason === 'lease_expired'` while `offline_library` is off (`uwLockLibraryOff`) */
  libraryOff?: boolean
  /** `offline_cap_reached`: the account's byte cap (`uwOfflineCapReached {cap}`) */
  cap?: number
  /** `offline_cap_reached`: the pin cap (`uwOfflineCapReached {maxDocs}`) */
  maxDocs?: number
}

export type OfflineResult = { ok: true } | OfflineFailure

export type OfflineUnpinResult = { ok: true; deferred: boolean } | OfflineFailure

/** the menu state of one document (`uwOfflinePin` / `uwOfflineUnpin`) */
export interface OfflineDocState {
  pinned: boolean
  state: OfflineRowState | null
  capabilityOn: boolean
}

/**
 * The offline library's half of `window.uniworkSyncCenter` (G5-05u B4): the same
 * preload object as the S2 api, its own channels. The renderer sends intents and
 * reads the projection - no call can set a row ready, verified or a lease.
 */
export interface UniworkOfflineLibraryApi {
  /**
   * Pin a document into the offline library (`Dùng khi không có mạng`,
   * `Thêm tài liệu…`). Main resolves the organization; the call returns at once
   * (the download is never awaited) and the row arrives through the snapshot.
   * Refuses with `offline_cap_reached` (carrying `cap` / `maxDocs`) or
   * `capability_off`, pinning nothing.
   */
  offlinePin(input: {
    documentId: string
    workspaceId: string
    orgId?: string
  }): Promise<OfflineResult>
  /**
   * Remove a pinned copy (`Bỏ ghim`). `needs_confirm` when the document still
   * has drafts or intents (`uwOfflineUnpinConfirm`); the call is repeated with
   * `confirmed: true`. Runs at once (an open copy's bytes go at its close).
   */
  offlineUnpin(documentId: string, options?: { confirmed?: boolean }): Promise<OfflineUnpinResult>
  /** Stop a running download of the copy (`Hủy tải`). */
  offlineCancel(documentId: string): Promise<OfflineResult>
  /** Download now / retry (`Tải ngay` / `Thử lại`). */
  offlineDownloadNow(documentId: string): Promise<OfflineResult>
  /**
   * S3 `Mở`: the normal server path when the document opens, the verified
   * cached copy - read-only, never edited - when it does not. A refused open
   * names its S11 reason (`lockReason`) and whether the org capability is off
   * (`libraryOff`).
   */
  offlineOpen(documentId: string): Promise<OfflineResult>
  /** Show the library's storage folder (`Mở thư mục lưu trữ`). */
  offlineOpenFolder(): Promise<OfflineResult>
  /** Whether a document is pinned, for the `uwOfflinePin` / `uwOfflineUnpin` menus. */
  offlineState(documentId: string): Promise<OfflineDocState>
}
