import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import { INTENT_STORE_REGISTRATION } from '../src/main/uniwork-sync/intent-store'
import { createSyncStoreAccess } from '../src/main/uniwork-sync/session-store'
import { createStoreLayer, type StoreLayer } from '../src/main/uniwork-sync/store'
import {
  createLockableSafeStorage,
  type LockableSafeStorage,
} from '../src/main/uniwork-sync/test-kit/compliance'

/**
 * W3b: one scope per account boundary. The access opens it once per session
 * (a hot path: every save asks for the intent store), retries after a lock,
 * follows an account switch, and forgets its handle when the boundary wiped
 * the scope.
 */

let base: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'uw-sync-session-'))
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

function make(): { layer: StoreLayer; safeStorage: LockableSafeStorage } {
  const safeStorage = createLockableSafeStorage()
  const layer = createStoreLayer({
    root: join(base, 'records'),
    keys: createSafeStorageKeyProvider({ safeStorage, dir: join(base, 'keys') }),
    budgetBytes: 1 << 20,
    clock: () => 1_700_000_000_000,
  })
  layer.register(INTENT_STORE_REGISTRATION)
  return { layer, safeStorage }
}

describe('createSyncStoreAccess', () => {
  it('opens the session scope once and hands back its registered stores', async () => {
    const { layer } = make()
    const opened: string[] = []
    const counting: StoreLayer = {
      ...layer,
      open: async (scope) => {
        opened.push(`${scope.deploymentId}/${scope.accountId}`)
        return layer.open(scope)
      },
    }
    const access = createSyncStoreAccess({
      layer: counting,
      scope: () => ({ deploymentId: 'dep_1', accountId: 'acc_1' }),
    })
    const first = await access.open()
    if (first.kind !== 'ok') throw new Error(first.kind)
    const records = first.records(INTENT_STORE_REGISTRATION.name)
    expect(await records.write('doc_1', Buffer.from('value'))).toEqual({ kind: 'ok' })
    const second = await access.open()
    if (second.kind !== 'ok') throw new Error(second.kind)
    expect((await second.records(INTENT_STORE_REGISTRATION.name).read('doc_1')).kind).toBe('ok')
    // the second open reused the handle: one key fetch, one layer open
    expect(opened).toEqual(['dep_1/acc_1'])
  })

  it('shares one open between concurrent calls', async () => {
    const { layer } = make()
    let opens = 0
    const counting: StoreLayer = {
      ...layer,
      open: async (scope) => {
        opens += 1
        return layer.open(scope)
      },
    }
    const access = createSyncStoreAccess({
      layer: counting,
      scope: () => ({ deploymentId: 'dep_1', accountId: 'acc_1' }),
    })
    const [a, b] = await Promise.all([access.open(), access.open()])
    expect(a.kind).toBe('ok')
    expect(b.kind).toBe('ok')
    expect(opens).toBe(1)
  })

  it('reports a locked keychain without remembering it, and opens after the unlock', async () => {
    const { layer, safeStorage } = make()
    const access = createSyncStoreAccess({
      layer,
      scope: () => ({ deploymentId: 'dep_1', accountId: 'acc_1' }),
    })
    const ok = await access.open()
    if (ok.kind !== 'ok') throw new Error(ok.kind)
    safeStorage.lock()
    access.forget()
    expect(await access.open()).toEqual({ kind: 'keystore_locked' })
    safeStorage.unlock()
    expect((await access.open()).kind).toBe('ok')
  })

  it('without a session there is no store to open', async () => {
    const { layer } = make()
    const access = createSyncStoreAccess({ layer, scope: () => null })
    expect(access.scope()).toBeNull()
    expect(await access.open()).toEqual({ kind: 'no_session' })
  })

  it('follows an account switch and forgets a wiped scope', async () => {
    const { layer } = make()
    let account = 'acc_1'
    const access = createSyncStoreAccess({
      layer,
      scope: () => ({ deploymentId: 'dep_1', accountId: account }),
    })
    const first = await access.open()
    if (first.kind !== 'ok') throw new Error(first.kind)
    expect(
      await first.records(INTENT_STORE_REGISTRATION.name).write('k', Buffer.from('a')),
    ).toEqual({ kind: 'ok' })
    account = 'acc_2'
    const second = await access.open()
    if (second.kind !== 'ok') throw new Error(second.kind)
    // acc_2's scope is empty: the handle is the new account's
    expect(await second.records(INTENT_STORE_REGISTRATION.name).read('k')).toEqual({
      kind: 'missing',
    })

    // the boundary wipes the scope and the access forgets its handle
    await layer.lockAndWipe({ deploymentId: 'dep_1', accountId: 'acc_2' })
    access.forget()
    const third = await access.open()
    if (third.kind !== 'ok') throw new Error(third.kind)
    expect(await third.records(INTENT_STORE_REGISTRATION.name).read('k')).toEqual({
      kind: 'missing',
    })
  })

  it('a keychain that relocks after the handle was cached refuses, and revokes it (G504-be-3)', async () => {
    const { layer, safeStorage } = make()
    let opens = 0
    const counting: StoreLayer = {
      ...layer,
      open: async (scope) => {
        opens += 1
        return layer.open(scope)
      },
    }
    const access = createSyncStoreAccess({
      layer: counting,
      scope: () => ({ deploymentId: 'dep_1', accountId: 'acc_1' }),
    })
    const first = await access.open()
    if (first.kind !== 'ok') throw new Error(first.kind)
    expect(
      await first.records(INTENT_STORE_REGISTRATION.name).write('k', Buffer.from('before')),
    ).toEqual({ kind: 'ok' })

    // the OS keychain relocks; nothing calls forget(): the cached handle must
    // not be served, so every save that asks for the store is refused
    safeStorage.lock()
    expect(await access.open()).toEqual({ kind: 'keystore_locked' })
    // the handle was revoked with the lock: the unlock opens a fresh one
    safeStorage.unlock()
    const again = await access.open()
    expect(again.kind).toBe('ok')
    expect(opens).toBe(2)
  })

  it('a pending open is never shared with another scope, and a stale result is discarded (G504-be-6)', async () => {
    const { layer } = make()
    let account = 'acc_1'
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let opens = 0
    const gated: StoreLayer = {
      ...layer,
      open: async (scope) => {
        opens += 1
        await gate
        return layer.open(scope)
      },
    }
    const access = createSyncStoreAccess({
      layer: gated,
      scope: () => ({ deploymentId: 'dep_1', accountId: account }),
    })
    // A's open is in flight when the account switches to B
    const a = access.open()
    account = 'acc_2'
    const b = access.open()
    release()
    const [aResult, bResult] = await Promise.all([a, b])
    expect(opens).toBe(2)
    // A's late handle is never handed out: it is A's records handle
    expect(aResult).toEqual({ kind: 'no_session' })
    if (bResult.kind !== 'ok') throw new Error(bResult.kind)
    expect(await bResult.records(INTENT_STORE_REGISTRATION.name).read('k')).toEqual({
      kind: 'missing',
    })
  })

  it('a completion that lands after forget is discarded and not cached (G504-be-6)', async () => {
    const { layer } = make()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let opens = 0
    const gated: StoreLayer = {
      ...layer,
      open: async (scope) => {
        opens += 1
        await gate
        return layer.open(scope)
      },
    }
    const access = createSyncStoreAccess({
      layer: gated,
      scope: () => ({ deploymentId: 'dep_1', accountId: 'acc_1' }),
    })
    const inflight = access.open()
    // the boundary wipes the scope while the open is still in flight
    access.forget()
    release()
    expect(await inflight).toEqual({ kind: 'no_session' })
    // the discarded handle was not written back into the cache: the next call
    // opens the (empty, post-wipe) scope again
    const next = await access.open()
    expect(next.kind).toBe('ok')
    expect(opens).toBe(2)
  })
})
