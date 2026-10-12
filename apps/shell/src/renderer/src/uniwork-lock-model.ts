import type { UniworkDocLock, UniworkLockReason } from '../../shared/home-api'
import { pathKey } from './uniwork-docs-model'

/**
 * S11 lock panel model (G5-04g). Main refuses to open a working copy whose
 * store is newer than this app, or whose store key sits in a locked keychain,
 * and pushes a lock; the shell shows one panel per refused path. The strings
 * are keys, translated at render time.
 */

export type LockCopy =
  | {
      titleKey: 'uwLockNewerStoreTitle'
      bodyKey: 'uwLockNewerStore'
      /** the one primary action: dismisses the lock, nothing else */
      actionKey: 'uwPickClose'
      action: 'dismiss'
    }
  | {
      titleKey: 'uwLockKeystoreTitle'
      bodyKey: 'uwLockKeystore'
      /** retries the account (the keychain may be unlocked now); the lock goes away when the store opens */
      actionKey: 'uwActRetry'
      action: 'retry'
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
}

export function lockCopyOf(lock: Pick<UniworkDocLock, 'reason'>): LockCopy {
  return COPY[lock.reason]
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
