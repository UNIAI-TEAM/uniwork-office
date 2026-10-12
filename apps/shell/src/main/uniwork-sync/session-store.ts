import type { StoreScope } from './keys'
import type { StoreLayer, StoreRecords } from './store'

/**
 * The signed-in session's view of the durable store. One scope per account
 * boundary ({deploymentId, accountId} of the live session): `open` names it,
 * opens it once and hands back its registered stores by name. A scope that
 * cannot open right now (a locked keychain, no usable keyring, no session) is
 * reported as it is, and a later call retries - only `forget` (the account
 * boundary wiped the scope) drops a handle, because after the wipe every
 * handle of that scope is dead.
 */

export type SyncStoreOpen =
  | { kind: 'ok'; records(name: string): StoreRecords }
  | { kind: 'keystore_locked' }
  | { kind: 'keyring_unavailable' }
  | { kind: 'no_session' }

export interface SyncStoreAccess {
  /** the scope of the live session, or null when it cannot be named */
  scope(): StoreScope | null
  open(): Promise<SyncStoreOpen>
  /** the opened handle is dead (the account boundary wiped the scope) */
  forget(): void
}

export function createSyncStoreAccess(options: {
  layer: StoreLayer
  scope(): StoreScope | null
}): SyncStoreAccess {
  const tokenOf = (scope: StoreScope) => `${scope.deploymentId}/${scope.accountId}`
  let opened: { token: string; records(name: string): StoreRecords } | null = null
  let pending: Promise<SyncStoreOpen> | null = null

  const openScope = async (): Promise<SyncStoreOpen> => {
    const scope = options.scope()
    if (!scope) return { kind: 'no_session' }
    const token = tokenOf(scope)
    if (opened?.token === token) return { kind: 'ok', records: opened.records }
    const result = await options.layer.open(scope)
    if (result.kind !== 'ok') return result
    const store = result.store
    const handle = { token, records: (name: string) => store.records(name) }
    opened = handle
    return { kind: 'ok', records: handle.records }
  }

  return {
    scope: () => options.scope(),
    open() {
      // concurrent calls share one open; a failed open is not remembered, so
      // the next call retries (a lock is transient)
      pending ??= openScope().finally(() => {
        pending = null
      })
      return pending
    },
    forget() {
      opened = null
    },
  }
}
