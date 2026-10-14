import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PAUSE_STORE_REGISTRATION,
  createPauseStore,
  type PauseStore,
} from '../src/main/uniwork-sync/queue/pause'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import { createStoreLayer } from '../src/main/uniwork-sync/store'
import { createLockableSafeStorage } from '../src/main/uniwork-sync/test-kit/compliance'

const SCOPE = { deploymentId: 'dep_1', accountId: 'acc_1' }

let base: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'uw-sync-pause-'))
})
afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

const safeStorage = createLockableSafeStorage()

/** a fresh layer over the same root/keyring, as a restart would build */
async function openPauseStore(): Promise<PauseStore> {
  const layer = createStoreLayer({
    root: join(base, 'records'),
    keys: createSafeStorageKeyProvider({ safeStorage, dir: join(base, 'keys') }),
    budgetBytes: 1 << 20,
    clock: () => 1_700_000_000_000,
  })
  layer.register(PAUSE_STORE_REGISTRATION)
  const opened = await layer.open(SCOPE)
  if (opened.kind !== 'ok') throw new Error(`pause store did not open: ${opened.kind}`)
  return createPauseStore(opened.store.records(PAUSE_STORE_REGISTRATION.name))
}

describe('uniwork sync pause flag store', () => {
  it('is not paused by default', async () => {
    const store = await openPauseStore()
    expect(await store.isPaused()).toBe(false)
  })

  it('keeps a pause flag across a re-open of the store', async () => {
    const store = await openPauseStore()
    expect(await store.setPaused(true)).toEqual({ kind: 'ok' })
    expect(await store.isPaused()).toBe(true)

    // a restart builds a new layer over the same account scope: the flag is durable
    const reopened = await openPauseStore()
    expect(await reopened.isPaused()).toBe(true)
    expect(await reopened.setPaused(false)).toEqual({ kind: 'ok' })
    expect(await (await openPauseStore()).isPaused()).toBe(false)
  })

  it('a scope that cannot open reports its keystore_locked state', async () => {
    const store = await openPauseStore()
    await store.setPaused(true)
    safeStorage.lock()
    const layer = createStoreLayer({
      root: join(base, 'records'),
      keys: createSafeStorageKeyProvider({ safeStorage, dir: join(base, 'keys') }),
      budgetBytes: 1 << 20,
      clock: () => 1_700_000_000_000,
    })
    layer.register(PAUSE_STORE_REGISTRATION)
    expect(await layer.open(SCOPE)).toEqual({ kind: 'keystore_locked' })
    safeStorage.unlock()
  })
})
