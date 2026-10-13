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
 *
 * A cached handle is revalidated on every call: the OS keychain may have
 * relocked since it was opened, and a handle whose key can no longer be
 * produced must refuse (`keystore_locked`) instead of serving records. A
 * handle is also only ever handed back to the scope that asked for it - an
 * open still in flight when the session moves is discarded, never returned to
 * the other account and never written back into the cache.
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
  let pending: { token: string; promise: Promise<SyncStoreOpen> } | null = null
  /** bumped by forget: an open that started before it never lands */
  let generation = 0

  const currentToken = (): string | null => {
    const scope = options.scope()
    return scope ? tokenOf(scope) : null
  }

  const openScope = async (
    scope: StoreScope,
    token: string,
    started: number,
  ): Promise<SyncStoreOpen> => {
    const result = await options.layer.open(scope)
    if (result.kind !== 'ok') return result
    // the session may have moved, or the boundary wiped the scope, while the
    // key was fetched: that handle belongs to nobody now
    if (started !== generation || currentToken() !== token) return { kind: 'no_session' }
    const store = result.store
    const handle = { token, records: (name: string) => store.records(name) }
    opened = handle
    return { kind: 'ok', records: handle.records }
  }

  const openToken = async (scope: StoreScope, token: string): Promise<SyncStoreOpen> => {
    const started = generation
    const cached = opened
    if (cached?.token === token) {
      // a handle is only served while its key can still be produced
      const status = await options.layer.verifyKey(scope)
      if (started !== generation || currentToken() !== token) return { kind: 'no_session' }
      if (status !== 'ok') {
        if (opened === cached) opened = null
        return { kind: status }
      }
      return { kind: 'ok', records: cached.records }
    }
    const joined = pending
    // only this scope's own open is shared; another account never joins it
    if (joined && joined.token === token) return joined.promise
    const promise = openScope(scope, token, started)
    const entry = { token, promise }
    pending = entry
    const settled = promise.then(
      () => undefined,
      () => undefined,
    )
    void settled.then(() => {
      if (pending === entry) pending = null
    })
    return promise
  }

  return {
    scope: () => options.scope(),
    open() {
      const scope = options.scope()
      if (!scope) return Promise.resolve<SyncStoreOpen>({ kind: 'no_session' })
      // concurrent calls of this scope share one open; a failed open is not
      // remembered, so the next call retries (a lock is transient)
      return openToken(scope, tokenOf(scope))
    },
    forget() {
      generation += 1
      opened = null
      pending = null
    },
  }
}
