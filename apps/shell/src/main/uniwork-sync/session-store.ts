import { INTENT_STORE_REGISTRATION } from './intent-store'
import type { StoreScope } from './keys'
import { DRAFTS_STORE_REGISTRATION } from './queue/drafts'
import { PARKED_STORE_REGISTRATION } from './queue/parked'
import { PAUSE_STORE_REGISTRATION } from './queue/pause'
import { DOC_INDEX_REGISTRATION, FEED_CURSORS_REGISTRATION } from './runtime'
import type { StoreLayer, StoreRecords, StoreRegistration } from './store'

/**
 * The signed-in session's view of the durable store. One scope per account
 * boundary ({deploymentId, accountId} of the live session): `open` names it,
 * opens it once and hands back its registered stores by name. A scope that
 * cannot open right now (a locked keychain, no usable keyring, no session) is
 * reported as it is, and a later call retries - only `forget` (or `lock`)
 * drops a handle, because after the boundary every handle of that scope is dead.
 *
 * A cached handle is revalidated on every call: the OS keychain may have
 * relocked since it was opened, and a handle whose key can no longer be
 * produced must refuse (`keystore_locked`) instead of serving records. A
 * handle is also only ever handed back to the scope that asked for it - an
 * open still in flight when the session moves is discarded, never returned to
 * the other account and never written back into the cache.
 */

/**
 * Every store registered on the account's sync store layer. Kept here as one
 * list so `createSyncStoreLayer` and the store compliance test agree on the
 * exact set of registered stores.
 */
export const SYNC_STORE_REGISTRATIONS: readonly StoreRegistration[] = [
  INTENT_STORE_REGISTRATION,
  DRAFTS_STORE_REGISTRATION,
  PAUSE_STORE_REGISTRATION,
  PARKED_STORE_REGISTRATION,
  FEED_CURSORS_REGISTRATION,
  DOC_INDEX_REGISTRATION,
]

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
  /** forget the cached handle and lock the scope being left (ciphertext stays) */
  lock(scope?: StoreScope): Promise<void>
}

export type SessionStore = SyncStoreAccess

export function createSyncStoreAccess(options: {
  layer: StoreLayer
  scope(): StoreScope | null
}): SyncStoreAccess {
  const tokenOf = (scope: StoreScope) => `${scope.deploymentId}/${scope.accountId}`
  let opened: { scope: StoreScope; token: string; records(name: string): StoreRecords } | null =
    null
  let pending: { scope: StoreScope; token: string; promise: Promise<SyncStoreOpen> } | null = null
  let lastScope: StoreScope | null = null
  /** bumped by forget / lock: an open that started before it never lands */
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
    // the session may have moved, or the boundary locked/wiped the scope, while
    // the key was fetched: that handle belongs to nobody now
    if (started !== generation || currentToken() !== token) return { kind: 'no_session' }
    const store = result.store
    const handle = {
      scope: { deploymentId: scope.deploymentId, accountId: scope.accountId },
      token,
      records: (name: string) => store.records(name),
    }
    opened = handle
    lastScope = handle.scope
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
    const scopeCopy: StoreScope = { deploymentId: scope.deploymentId, accountId: scope.accountId }
    lastScope = scopeCopy
    const promise = openScope(scopeCopy, token, started)
    const entry = { scope: scopeCopy, token, promise }
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

  const dropHandle = (): void => {
    generation += 1
    opened = null
    pending = null
    lastScope = null
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
      dropHandle()
    },
    async lock(explicitScope) {
      const left = explicitScope ?? opened?.scope ?? pending?.scope ?? lastScope ?? options.scope()
      dropHandle()
      if (left) await options.layer.lock(left)
    },
  }
}
