import type { UniworkDocLock, UniworkLockReason } from '../../shared/home-api'
import { pathKey } from './uniwork-docs-model'

/**
 * S11 lock panel model (G5-04g, widened by G5-05u). Main refuses to open a
 * working copy whose store is newer than this app, whose store key sits in a
 * locked keychain, whose offline copy lost its lease, or whose session/access
 * went away, and pushes a lock; the shell shows one panel per refused path.
 * The strings are keys, translated at render time.
 *
 * G5-05u (UNI-1360) added the offline library's reasons to `UniworkLockReason`
 * ("Lý do bị chặn" / "Trạng thái khóa (S11)"); the mutation lane (F7) owns the
 * per-reason action semantics (renew the lease, re-check, open the sync center,
 * switch account). The panel keeps one title, one sentence and one action.
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

export interface LockCopy {
  titleKey: LockTitleKey
  bodyKey: LockBodyKey
  actionKey: LockActionKey
  /** `retry` and `sign-in` have their own handlers; everything else dismisses the lock */
  action: 'dismiss' | 'retry' | 'sign-in'
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
    action: 'sign-in',
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
  // the lease cannot be renewed while the org turned offline documents off (S11 uwLockLibraryOff)
  if (lock.libraryOff === true && copy.bodyKey === 'uwLockExpired') {
    return { ...copy, bodyKey: 'uwLockLibraryOff' }
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
