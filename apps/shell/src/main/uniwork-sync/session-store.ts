import { FIRST_SAVES_STORE_REGISTRATION } from './first-saves'
import { INTENT_STORE_REGISTRATION } from './intent-store'
import type { StoreScope } from './keys'
import { DRAFTS_STORE_REGISTRATION } from './queue/drafts'
import { LEASE_STORE_REGISTRATION } from './lease/store'
import { PARKED_STORE_REGISTRATION } from './queue/parked'
import { PAUSE_STORE_REGISTRATION } from './queue/pause'
import { DOC_INDEX_REGISTRATION, FEED_CURSORS_REGISTRATION } from './runtime'
import type { StoreLayer, StoreRecords, StoreRegistration } from './store'
import { UPLOAD_SESSIONS_STORE_REGISTRATION } from './upload-sessions'

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
  LEASE_STORE_REGISTRATION,
  UPLOAD_SESSIONS_STORE_REGISTRATION,
  FIRST_SAVES_STORE_REGISTRATION,
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
  /**
   * Opens the store of `scope`, which need not be the live session's: an
   * account switch locks the account it leaves after the next account is
   * already live, and that lock must park into the leaving account's own
   * store. The live scope goes through `open`; any other scope gets a one-off
   * handle that is never cached or shared, and that a `lock` of its scope
   * started in the meantime discards.
   */
  openScope?(scope: StoreScope): Promise<SyncStoreOpen>
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
  /** bumped by forget: an open of any scope that started before it never lands */
  let generation = 0
  /**
   * bumped per scope by lock: an open of THAT scope that started before it
   * never lands. Locking the account being left must not discard the incoming
   * account's open already in flight (an account/deployment switch locks the
   * outgoing scope while the new session is already reading its own store).
   */
  const lockEpochs = new Map<string, number>()
  const epochOf = (token: string): string => `${generation}:${lockEpochs.get(token) ?? 0}`

  const currentToken = (): string | null => {
    const scope = options.scope()
    return scope ? tokenOf(scope) : null
  }

  const openScope = async (
    scope: StoreScope,
    token: string,
    started: string,
  ): Promise<SyncStoreOpen> => {
    const result = await options.layer.open(scope)
    if (result.kind !== 'ok') return result
    // the session may have moved, or the boundary locked/wiped the scope, while
    // the key was fetched: that handle belongs to nobody now
    if (started !== epochOf(token) || currentToken() !== token) return { kind: 'no_session' }
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
    const started = epochOf(token)
    const cached = opened
    if (cached?.token === token) {
      // a handle is only served while its key can still be produced
      const status = await options.layer.verifyKey(scope)
      if (started !== epochOf(token) || currentToken() !== token) return { kind: 'no_session' }
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
    openScope(scope) {
      const token = tokenOf(scope)
      if (currentToken() === token) return openToken(scope, token)
      const started = epochOf(token)
      const copy: StoreScope = { deploymentId: scope.deploymentId, accountId: scope.accountId }
      return options.layer.open(copy).then((result): SyncStoreOpen => {
        if (result.kind !== 'ok') return result
        if (started !== epochOf(token)) return { kind: 'no_session' }
        const store = result.store
        return { kind: 'ok', records: (name: string) => store.records(name) }
      })
    },
    forget() {
      dropHandle()
    },
    async lock(explicitScope) {
      // A bare lock() names the scope this access last handed out. With none
      // cached there is nothing to leave: it never falls back to the live scope,
      // which by then may be the incoming session's.
      const left = explicitScope ?? opened?.scope ?? pending?.scope ?? lastScope
      if (!left) return
      // only the scope being left loses its handles; another scope's open or
      // cached handle (the incoming session's) stays valid
      const token = tokenOf(left)
      lockEpochs.set(token, (lockEpochs.get(token) ?? 0) + 1)
      if (opened?.token === token) opened = null
      if (pending?.token === token) pending = null
      if (lastScope && tokenOf(lastScope) === token) lastScope = null
      await options.layer.lock(left)
    },
  }
}
