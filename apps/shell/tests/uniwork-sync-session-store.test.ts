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

  it("B's session never opens A's scope", async () => {
    const { layer } = make()
    let account = 'acc_a'
    const openedScopes: string[] = []
    const tracking: StoreLayer = {
      ...layer,
      open: async (scope) => {
        openedScopes.push(`${scope.deploymentId}/${scope.accountId}`)
        return layer.open(scope)
      },
    }
    const access = createSyncStoreAccess({
      layer: tracking,
      scope: () => ({ deploymentId: 'dep_1', accountId: account }),
    })

    const aOpen = await access.open()
    if (aOpen.kind !== 'ok') throw new Error(aOpen.kind)
    const aRecords = aOpen.records(INTENT_STORE_REGISTRATION.name)
    expect(await aRecords.write('doc_a', Buffer.from('only-for-a'))).toEqual({ kind: 'ok' })

    await access.lock()
    account = 'acc_b'
    openedScopes.length = 0

    const bOpen = await access.open()
    if (bOpen.kind !== 'ok') throw new Error(bOpen.kind)
    expect(access.scope()).toEqual({ deploymentId: 'dep_1', accountId: 'acc_b' })
    expect(openedScopes).toEqual(['dep_1/acc_b'])
    const bRecords = bOpen.records(INTENT_STORE_REGISTRATION.name)
    expect(await bRecords.read('doc_a')).toEqual({ kind: 'missing' })
    // A's old handle is locked and dead
    expect(await aRecords.read('doc_a')).toEqual({ kind: 'interrupted' })
  })

  it('lock() drops the cached handle and locks the left scope', async () => {
    const { layer } = make()
    let account: string | null = 'acc_1'
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
      scope: () => (account ? { deploymentId: 'dep_1', accountId: account } : null),
    })

    const first = await access.open()
    if (first.kind !== 'ok') throw new Error(first.kind)
    const firstRecords = first.records(INTENT_STORE_REGISTRATION.name)
    expect(await firstRecords.write('doc_1', Buffer.from('kept-ciphertext'))).toEqual({
      kind: 'ok',
    })
    expect(opens).toBe(1)

    // even if the live identity already moved to another account before lock() is called,
    // lock() locks the scope of the cached handle being left (acc_1), never acc_2
    account = 'acc_2'
    await access.lock()
    expect(await firstRecords.read('doc_1')).toEqual({ kind: 'interrupted' })
    expect(await firstRecords.write('doc_2', Buffer.from('nope'))).toEqual({
      kind: 'interrupted',
    })

    // switching back to acc_1 reopens from disk and reads the preserved ciphertext
    account = 'acc_1'
    const reopened = await access.open()
    if (reopened.kind !== 'ok') throw new Error(reopened.kind)
    expect(opens).toBe(2)
    const read = await reopened.records(INTENT_STORE_REGISTRATION.name).read('doc_1')
    expect(read).toEqual({ kind: 'ok', value: new Uint8Array(Buffer.from('kept-ciphertext')) })
  })

  it("locking the scope being left never discards the incoming scope's open (G5-11 F6)", async () => {
    const { layer } = make()
    let account = 'acc_1'
    let releaseOpen: (() => void) | null = null
    const gated: StoreLayer = {
      ...layer,
      open: async (scope) => {
        // acc_2's key fetch is still in flight when acc_1 is locked
        if (scope.accountId === 'acc_2') await new Promise<void>((r) => (releaseOpen = r))
        return layer.open(scope)
      },
    }
    const access = createSyncStoreAccess({
      layer: gated,
      scope: () => ({ deploymentId: 'dep_1', accountId: account }),
    })
    const first = await access.open()
    if (first.kind !== 'ok') throw new Error(first.kind)
    const outgoing = first.records(INTENT_STORE_REGISTRATION.name)

    account = 'acc_2'
    const incoming = access.open()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await access.lock({ deploymentId: 'dep_1', accountId: 'acc_1' })
    releaseOpen?.()
    const opened = await incoming
    if (opened.kind !== 'ok') throw new Error(opened.kind)
    const records = opened.records(INTENT_STORE_REGISTRATION.name)
    expect(await records.write('doc_1', Buffer.from('b'))).toEqual({ kind: 'ok' })
    // the incoming handle is cached; the outgoing one is dead
    expect((await access.open()).kind).toBe('ok')
    expect(await outgoing.read('doc_1')).toEqual({ kind: 'interrupted' })
  })

  it('a bare lock() with nothing cached leaves the live scope untouched (G5-11f d4-r1)', async () => {
    const { layer } = make()
    const locked: string[] = []
    const tracking: StoreLayer = {
      ...layer,
      lock: async (scope) => {
        locked.push(`${scope.deploymentId}/${scope.accountId}`)
        return layer.lock(scope)
      },
    }
    const access = createSyncStoreAccess({
      layer: tracking,
      scope: () => ({ deploymentId: 'dep_1', accountId: 'acc_live' }),
    })

    // nothing was opened through this access, so there is no scope being left
    await access.lock()
    expect(locked).toEqual([])

    // and the live scope still opens and serves its records
    const open = await access.open()
    if (open.kind !== 'ok') throw new Error(open.kind)
    expect(
      await open.records(INTENT_STORE_REGISTRATION.name).write('doc_1', Buffer.from('x')),
    ).toEqual({
      kind: 'ok',
    })
  })

  it("openScope opens the leaving account's own store while another account is live, and never caches it (G5-11 F7)", async () => {
    const { layer } = make()
    let account = 'acc_1'
    const access = createSyncStoreAccess({
      layer,
      scope: () => ({ deploymentId: 'dep_1', accountId: account }),
    })
    const a = { deploymentId: 'dep_1', accountId: 'acc_1' }
    const first = await access.open()
    if (first.kind !== 'ok') throw new Error(first.kind)
    expect(
      await first.records(INTENT_STORE_REGISTRATION.name).write('doc_a', Buffer.from('a')),
    ).toEqual({ kind: 'ok' })

    // B is live now: openScope(A) reads A's records, open() still serves B
    account = 'acc_2'
    const left = await access.openScope!(a)
    if (left.kind !== 'ok') throw new Error(left.kind)
    const leftRecords = left.records(INTENT_STORE_REGISTRATION.name)
    expect((await leftRecords.read('doc_a')).kind).toBe('ok')
    const live = await access.open()
    if (live.kind !== 'ok') throw new Error(live.kind)
    expect((await live.records(INTENT_STORE_REGISTRATION.name).read('doc_a')).kind).toBe('missing')

    // locking A interrupts the one-off handle and leaves B's handle alone
    await access.lock(a)
    expect(await leftRecords.read('doc_a')).toEqual({ kind: 'interrupted' })
    expect((await access.open()).kind).toBe('ok')
  })

  it('openScope discards a one-off open that a lock of its scope overtook', async () => {
    const { layer } = make()
    let release: (() => void) | null = null
    const gated: StoreLayer = {
      ...layer,
      open: async (scope) => {
        if (scope.accountId === 'acc_1') await new Promise<void>((r) => (release = r))
        return layer.open(scope)
      },
    }
    const access = createSyncStoreAccess({
      layer: gated,
      scope: () => ({ deploymentId: 'dep_1', accountId: 'acc_2' }),
    })
    const a = { deploymentId: 'dep_1', accountId: 'acc_1' }
    const pending = access.openScope!(a)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await access.lock(a)
    release?.()
    expect((await pending).kind).toBe('no_session')
  })
})
