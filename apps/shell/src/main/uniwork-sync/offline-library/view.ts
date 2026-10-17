import type {
  OfflineBlockedReason,
  OfflineFailure,
  OfflineFailureCode,
  OfflineLibraryQuota,
  OfflineLibrarySnapshot,
  OfflineRowView,
} from '../../../shared/offline-library'
import type { LibraryRefusal, LibraryRefusalCode, PinRow } from './manager'

/**
 * G5-05u (B1/B2): the engine's rows projected onto the renderer's contract.
 * Pure: every value comes from the row main already read - the renderer learns
 * nothing the engine did not compute, and nothing here writes.
 */

/**
 * The engine's refusal codes, one way only: a code the engine adds without a
 * renderer counterpart fails to compile here.
 */
const FAILURE_CODES: Record<LibraryRefusalCode, OfflineFailureCode> = {
  offline_cap_reached: 'offline_cap_reached',
  too_large: 'too_large',
  capability_off: 'capability_off',
  not_a_file: 'not_a_file',
  not_pinned: 'not_pinned',
  not_ready: 'not_ready',
  corrupt: 'corrupt',
  lease_unusable: 'lease_unusable',
  revoked: 'revoked',
  deleted: 'deleted',
  offline: 'offline',
  invalid: 'invalid',
  store_full: 'store_full',
  no_session: 'no_session',
  keystore_locked: 'keystore_locked',
  keyring_unavailable: 'keyring_unavailable',
  interrupted: 'interrupted',
}

export interface OfflineFailureContext {
  /** the org capability `offline_library`: names a `lease_expired` lock `libraryOff` */
  capabilityOn: boolean
  /**
   * The row's own blocked reason (the engine's projection). It is what names a
   * `lease_unusable` refusal exactly: a boundary lock's reason never leaves the
   * engine on the refusal itself.
   */
  leaseLock?: OfflineBlockedReason | null
  /** `offline_cap_reached`: the account's byte cap and pin cap (U-01) */
  cap?: number
  maxDocs?: number
}

/** one engine refusal as the renderer reads it, with the S11 reason it names */
export function offlineFailureOf(
  refusal: LibraryRefusal,
  context: OfflineFailureContext,
): OfflineFailure {
  const code = FAILURE_CODES[refusal.code]
  const lock = offlineLockReasonOf(refusal, context)
  return {
    ok: false,
    code,
    ...lock,
    ...(code === 'offline_cap_reached'
      ? { cap: context.cap ?? 0, maxDocs: context.maxDocs ?? 0 }
      : {}),
  }
}

/**
 * The S11 reason a refusal names, or none when the refusal is not a lock (a
 * capacity refusal, a corrupt copy, an unpin that needs confirming).
 */
export function offlineLockReasonOf(
  refusal: LibraryRefusal,
  context: Pick<OfflineFailureContext, 'capabilityOn' | 'leaseLock'>,
): Pick<OfflineFailure, 'lockReason' | 'libraryOff'> {
  const lease = refusal.code === 'lease_unusable'
  const lockReason: OfflineBlockedReason | undefined = lease
    ? // the engine named the lease state; the row names the boundary reason exactly
      (context.leaseLock ??
      (refusal.lease === 'clock_rollback'
        ? 'clock_rollback'
        : refusal.lease === 'keystore_locked' ||
            refusal.lease === 'keyring_unavailable' ||
            refusal.lease === 'locked'
          ? 'keystore_locked'
          : 'lease_expired'))
    : refusal.code === 'revoked'
      ? 'permission_revoked'
      : refusal.code === 'deleted'
        ? 'document_deleted'
        : refusal.code === 'no_session'
          ? 'signed_out'
          : refusal.code === 'keystore_locked' || refusal.code === 'keyring_unavailable'
            ? 'keystore_locked'
            : undefined
  if (!lockReason) return {}
  // OQ-UX11 (a): with the capability off the lease cannot be renewed, so S11 says why (uwLockLibraryOff)
  const libraryOff =
    lockReason === 'lease_expired' && context.capabilityOn === false ? { libraryOff: true } : {}
  return { lockReason, ...libraryOff }
}

/** one engine row as the S3 view reads it */
export function offlineRowView(row: PinRow, capabilityOn: boolean): OfflineRowView {
  return {
    documentId: row.documentId,
    workspaceId: row.workspaceId,
    name: row.filename ?? row.documentId,
    state: row.state,
    progress: row.progress
      ? { done: row.progress.receivedBytes, total: row.progress.totalBytes }
      : null,
    version: row.readyVersion,
    headVersion: row.headVersion,
    sizeBytes: row.sizeBytes,
    leaseUntil: row.leaseUntil,
    leaseLevel: row.leaseLevel,
    updateKeptReason: row.updateKeptReason,
    ...(row.diskNeededBytes !== undefined ? { diskNeededBytes: row.diskNeededBytes } : {}),
    ...(row.lockReason
      ? {
          lockReason: row.lockReason,
          ...(row.lockReason === 'lease_expired' && capabilityOn === false
            ? { libraryOff: true }
            : {}),
        }
      : {}),
    open: row.open,
  }
}

/**
 * G5-09 R2 (B7): the documents whose HEAD is the committed offline copy. The
 * S5 "Tải lại" of a dirty working copy reads this synchronously (`hasOfflineHead`
 * cannot await the library), so it is derived once per snapshot - a copy
 * that is behind its head is not offline, and a document with no copy never is.
 */
export function offlineHeadIds(rows: readonly OfflineRowView[]): Set<string> {
  const heads = new Set<string>()
  for (const row of rows) {
    if (row.version !== null && row.version === row.headVersion) heads.add(row.documentId)
  }
  return heads
}

export interface OfflineSnapshotInput {
  /** the org capability `offline_library`; false hides pin and "Thêm tài liệu…" */
  capabilityOn: boolean
  /** no session: the rows are omitted, only a count is exposed */
  signedOut: boolean
  /**
   * Signed out only: the number of items the last account kept on this machine
   * (OQ-UX11 a). Never a name.
   */
  signedOutLockedCount?: number
  quota: OfflineLibraryQuota
  rows: readonly PinRow[]
}

/** the offline block of every sync center snapshot (B1) */
export function offlineSnapshot(input: OfflineSnapshotInput): OfflineLibrarySnapshot {
  if (input.signedOut) {
    const lockedCount = Math.max(0, input.signedOutLockedCount ?? 0)
    return {
      visible: input.capabilityOn || lockedCount > 0,
      capabilityOn: input.capabilityOn,
      signedOutLockedCount: lockedCount,
      quota: input.quota,
      rows: [],
    }
  }
  const rows = input.rows.map((row) => offlineRowView(row, input.capabilityOn))
  return {
    visible: input.capabilityOn || rows.length > 0,
    capabilityOn: input.capabilityOn,
    quota: input.quota,
    rows,
  }
}
