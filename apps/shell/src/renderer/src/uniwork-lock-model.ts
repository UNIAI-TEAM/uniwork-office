import type { UniworkDocLock, UniworkLockReason } from '../../shared/home-api'
import { pathKey } from './uniwork-docs-model'

/**
 * S11 lock panel model (G5-04g, widened by G5-05u). Main refuses to open a
 * working copy whose store is newer than this app, whose store key sits in a
 * locked keychain, whose offline copy lost its lease, or whose session/access
 * went away, and pushes a lock; the shell shows one panel per refused path.
 * The strings are keys, translated at render time.
 *
 * G5-05u (UNI-1360) added the offline library's reasons to `UniworkLockReason`:
 * title and sentence per "Trạng thái khóa (S11)", the one action per "Lý do bị
 * chặn" (Kết nối lại / Thử lại / Kiểm tra lại re-check the account and the
 * lock list, Đăng nhập, Chuyển tài khoản, Mở trung tâm đồng bộ, Đóng).
 */

export type LockTitleKey =
  | 'uwLockNewerStoreTitle'
  | 'uwLockKeystoreTitle'
  | 'uwLockSignedOutTitle'
  | 'uwLockLeaseTitle'
  | 'uwLockClockTitle'
  | 'uwLockRevokedTitle'
  | 'uwLockDeletedTitle'
  | 'uwLockForeignTitle'
  | 'uwLockOrgTitle'

export type LockBodyKey =
  | 'uwLockNewerStore'
  | 'uwLockKeystore'
  | 'uwLockSignedOut'
  | 'uwLockExpired'
  | 'uwLockLibraryOff'
  | 'uwLockClock'
  | 'uwRemoteRevoked'
  | 'uwRemoteDeleted'
  | 'uwLockForeign'
  | 'uwLockSuspended'
  | 'uwLockDeactivated'

export type LockActionKey =
  | 'uwPickClose'
  | 'uwActRetry'
  | 'uwActSignIn'
  | 'uwActSignInAgain'
  | 'uwActReconnect'
  | 'uwActRecheck'
  | 'uwActSwitchAccount'
  | 'uwQueueOpenCenter'

export interface LockCopy {
  titleKey: LockTitleKey
  bodyKey: LockBodyKey
  actionKey: LockActionKey
  /**
   * `retry`: re-read the account and the lock list (Kết nối lại, Thử lại, Kiểm tra lại);
   * `sign-in`; `switch-account` (Settings › Account); `sync-center` (lease_expired while
   * `offline_library` is off); `dismiss` closes the panel (Đóng)
   */
  action: 'dismiss' | 'retry' | 'sign-in' | 'switch-account' | 'sync-center'
}

const COPY: Record<UniworkLockReason, LockCopy> = {
  store_newer: {
    titleKey: 'uwLockNewerStoreTitle',
    bodyKey: 'uwLockNewerStore',
    actionKey: 'uwPickClose',
    action: 'dismiss',
  },
  keystore_locked: {
    titleKey: 'uwLockKeystoreTitle',
    bodyKey: 'uwLockKeystore',
    actionKey: 'uwActRetry',
    action: 'retry',
  },
  signed_out: {
    titleKey: 'uwLockSignedOutTitle',
    bodyKey: 'uwLockSignedOut',
    actionKey: 'uwActSignIn',
    action: 'sign-in',
  },
  session_expired: {
    titleKey: 'uwLockSignedOutTitle',
    bodyKey: 'uwLockSignedOut',
    actionKey: 'uwActSignInAgain',
    action: 'sign-in',
  },
  foreign_account: {
    titleKey: 'uwLockForeignTitle',
    bodyKey: 'uwLockForeign',
    actionKey: 'uwActSwitchAccount',
    action: 'switch-account',
  },
  permission_revoked: {
    titleKey: 'uwLockRevokedTitle',
    bodyKey: 'uwRemoteRevoked',
    actionKey: 'uwActRecheck',
    action: 'retry',
  },
  document_deleted: {
    titleKey: 'uwLockDeletedTitle',
    bodyKey: 'uwRemoteDeleted',
    actionKey: 'uwActRecheck',
    action: 'retry',
  },
  organization_suspended: {
    titleKey: 'uwLockOrgTitle',
    bodyKey: 'uwLockSuspended',
    actionKey: 'uwActRecheck',
    action: 'retry',
  },
  member_deactivated: {
    titleKey: 'uwLockOrgTitle',
    bodyKey: 'uwLockDeactivated',
    actionKey: 'uwActRecheck',
    action: 'retry',
  },
  lease_expired: {
    titleKey: 'uwLockLeaseTitle',
    bodyKey: 'uwLockExpired',
    actionKey: 'uwActReconnect',
    action: 'retry',
  },
  clock_rollback: {
    titleKey: 'uwLockClockTitle',
    bodyKey: 'uwLockClock',
    actionKey: 'uwActReconnect',
    action: 'retry',
  },
}

export function lockCopyOf(lock: Pick<UniworkDocLock, 'reason' | 'libraryOff'>): LockCopy {
  const copy = COPY[lock.reason]
  // the lease cannot be renewed while the org turned offline documents off (S11 uwLockLibraryOff):
  // "Kết nối lại" would do nothing, the drafts wait in the sync center
  if (lock.libraryOff === true && copy.bodyKey === 'uwLockExpired') {
    return {
      ...copy,
      bodyKey: 'uwLockLibraryOff',
      actionKey: 'uwQueueOpenCenter',
      action: 'sync-center',
    }
  }
  return copy
}

/**
 * add a lock; one already listed for the same path is replaced and moves to the
 * end, where the newest push is (it is the lock shown)
 */
export function mergeLocks(
  list: readonly UniworkDocLock[],
  incoming: readonly UniworkDocLock[],
): UniworkDocLock[] {
  const next = [...list]
  for (const lock of incoming) {
    const key = pathKey(lock.path)
    const at = next.findIndex((entry) => pathKey(entry.path) === key)
    if (at !== -1) next.splice(at, 1)
    next.push(lock)
  }
  return next
}

export function withoutLock(list: readonly UniworkDocLock[], path: string): UniworkDocLock[] {
  const key = pathKey(path)
  return list.filter((lock) => pathKey(lock.path) !== key)
}

/** the lock the panel shows: the most recently pushed one */
export function shownLock(list: readonly UniworkDocLock[]): UniworkDocLock | null {
  return list.length ? list[list.length - 1]! : null
}
