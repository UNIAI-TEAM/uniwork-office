import type { UniworkDocLock, UniworkLockReason } from '../../shared/home-api'
import { pathKey } from './uniwork-docs-model'

/**
 * S11 lock panel model (G5-04g). Main refuses to open a working copy whose
 * store is newer than this app and pushes a lock; the shell shows one panel per
 * refused path. The strings are keys, translated at render time.
 */

export interface LockCopy {
  titleKey: 'uwLockNewerStoreTitle'
  bodyKey: 'uwLockNewerStore'
  /** the one primary action: dismisses the lock, nothing else */
  actionKey: 'uwPickClose'
}

const COPY: Record<UniworkLockReason, LockCopy> = {
  store_newer: {
    titleKey: 'uwLockNewerStoreTitle',
    bodyKey: 'uwLockNewerStore',
    actionKey: 'uwPickClose',
  },
}

export function lockCopyOf(lock: Pick<UniworkDocLock, 'reason'>): LockCopy {
  return COPY[lock.reason]
}

/** add a lock, or replace the one already shown for the same path (the newest push wins) */
export function mergeLocks(
  list: readonly UniworkDocLock[],
  incoming: readonly UniworkDocLock[],
): UniworkDocLock[] {
  const next = [...list]
  for (const lock of incoming) {
    const key = pathKey(lock.path)
    const at = next.findIndex((entry) => pathKey(entry.path) === key)
    if (at === -1) next.push(lock)
    else next[at] = lock
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
