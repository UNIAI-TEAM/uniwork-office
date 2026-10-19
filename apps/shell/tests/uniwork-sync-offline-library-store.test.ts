import { describe, expect, it } from 'vitest'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import {
  OFFLINE_LIBRARY_LAYER_BUDGET_BYTES,
  OFFLINE_LIBRARY_MAX_PINS,
  OFFLINE_LIBRARY_QUOTA_BYTES,
  OFFLINE_LIBRARY_STORE_REGISTRATION,
  PIN_RECORD_SCHEMA,
  blobKey,
  createOfflineLibraryStore,
  isBlobKey,
  pinKey,
  type PinRecord,
} from '../src/main/uniwork-sync/offline-library'
import { createStoreLayer, type StoreLayer } from '../src/main/uniwork-sync/store'
import {
  runStoreCompliance,
  type ComplianceEnv,
  type ComplianceSubject,
} from '../src/main/uniwork-sync/test-kit/compliance'
import {
  SCOPE,
  createFakeKeys,
  createLibraryLayer,
  createMemoryFs,
  filesContaining,
  plaintext,
  recordFile,
} from './uniwork-sync-offline-library-fakes'

function pinRow(documentId: string): PinRecord {
  return {
    schema: PIN_RECORD_SCHEMA,
    documentId,
    scope: { orgId: 'org_1', workspaceId: 'ws_1' },
    manifest: null,
    readyManifest: null,
    readyGeneration: null,
    readyVersion: null,
    state: 'waiting-network',
    progress: null,
    bytes: 0,
    pinnedAt: 1,
    lastVerifiedAt: null,
    staging: null,
    updateAvailable: false,
    updateKept: false,
    archived: false,
  }
}

describe('offline library store', () => {
  it('registers as offline-library, schema 1; the quota values are U-01', () => {
    expect(OFFLINE_LIBRARY_STORE_REGISTRATION).toMatchObject({ name: 'offline-library', schema: 1 })
    expect(OFFLINE_LIBRARY_QUOTA_BYTES).toBe(2 * 1024 ** 3)
    expect(OFFLINE_LIBRARY_MAX_PINS).toBe(200)
    // 2 GiB quota + one 256 MiB staging copy + 16 MiB of frames: not the sync budget
    expect(OFFLINE_LIBRARY_LAYER_BUDGET_BYTES).toBe(
      2 * 1024 ** 3 + 256 * 1024 ** 2 + 16 * 1024 ** 2,
    )
  })

  it('keeps blobs encrypted: no plaintext under the store root', async () => {
    const fs = createMemoryFs()
    const store = createOfflineLibraryStore({
      layer: createLibraryLayer(fs, createFakeKeys()),
      scope: SCOPE,
    })
    const bytes = plaintext('secret')
    expect(await store.putBlob(blobKey('doc_1', '0000000a', 'main'), bytes)).toEqual({ kind: 'ok' })
    expect(fs.listFiles()).toEqual([recordFile(blobKey('doc_1', '0000000a', 'main'))])
    expect(filesContaining(fs, bytes)).toEqual([])
    const read = await store.getBlob(blobKey('doc_1', '0000000a', 'main'))
    expect(read.kind === 'ok' && Buffer.from(read.bytes).equals(Buffer.from(bytes))).toBe(true)
  })

  it('reports keystore_locked, no_session and refused like the lease store', async () => {
    const fs = createMemoryFs()
    const keys = createFakeKeys()
    let scope: typeof SCOPE | null = SCOPE
    const store = createOfflineLibraryStore({
      layer: createLibraryLayer(fs, keys),
      scope: () => scope,
    })
    keys.locked = true
    expect(await store.readIndex()).toEqual({ kind: 'keystore_locked' })
    expect(await store.putBlob(blobKey('doc_1', '0000000a', 'main'), plaintext('x'))).toEqual({
      kind: 'keystore_locked',
    })
    expect(fs.listFiles()).toEqual([])
    keys.locked = false
    scope = null
    expect(await store.getPin('doc_1')).toEqual({ kind: 'no_session' })
    scope = SCOPE
    // a key outside the blob namespace is never written
    expect(await store.putBlob('../escape', plaintext('x'))).toEqual({ kind: 'refused' })
    expect(isBlobKey(pinKey('doc_1'))).toBe(false)
    expect(await store.getPin('../doc')).toEqual({ kind: 'refused' })
  })

  it('a full disk (ENOSPC) is store_full with nothing readable written', async () => {
    const fs = createMemoryFs()
    const store = createOfflineLibraryStore({
      layer: createLibraryLayer(fs, createFakeKeys()),
      scope: SCOPE,
    })
    fs.failWrite = () => true
    const key = blobKey('doc_1', '0000000a', 'main')
    expect(await store.putBlob(key, plaintext('full'))).toEqual({ kind: 'store_full' })
    fs.failWrite = null
    expect(await store.getBlob(key)).toEqual({ kind: 'missing' })
  })

  it('the layer budget refuses past it (store_full)', async () => {
    const fs = createMemoryFs()
    const store = createOfflineLibraryStore({
      layer: createLibraryLayer(fs, createFakeKeys(), 6000),
      scope: SCOPE,
    })
    expect(
      (await store.putBlob(blobKey('doc_1', '0000000a', 'main'), plaintext('a', 4000))).kind,
    ).toBe('ok')
    expect(await store.putBlob(blobKey('doc_2', '0000000a', 'main'), plaintext('b', 4000))).toEqual(
      {
        kind: 'store_full',
      },
    )
  })

  it('a tampered stored blob reads corrupt, a tampered pin row is refused', async () => {
    const fs = createMemoryFs()
    const store = createOfflineLibraryStore({
      layer: createLibraryLayer(fs, createFakeKeys()),
      scope: SCOPE,
    })
    const key = blobKey('doc_1', '0000000a', 'main')
    await store.putBlob(key, plaintext('t'))
    const file = fs.files.get(recordFile(key))!
    file[file.length - 1] ^= 0xff
    expect(await store.getBlob(key)).toEqual({ kind: 'corrupt' })
    await store.writeIndex({ pins: ['doc_1'], cleanup: {} })
    const index = fs.files.get(recordFile('index'))!
    index[index.length - 1] ^= 0xff
    expect(await store.readIndex()).toEqual({ kind: 'refused' })
  })
})

describe('R4F-2 (UNI-1362): a call in flight at sign-out never writes into the wiped scope', () => {
  /** the first `step` call of the layer waits for `release()`; `reached` says it is waiting */
  function holdFirst(layer: StoreLayer, step: 'verifyKey' | 'open') {
    let release!: () => void
    let reached!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const entered = new Promise<void>((resolve) => (reached = resolve))
    let armed = true
    const held: StoreLayer = {
      ...layer,
      [step]: async (scope: typeof SCOPE) => {
        if (armed) {
          armed = false
          reached()
          await gate
        }
        return layer[step](scope)
      },
    }
    return { held, release, entered }
  }

  /** the state a record can be found in by a handle opened after the wipe */
  async function pinAfterWipe(layer: StoreLayer, documentId: string) {
    const opened = await layer.open(SCOPE)
    if (opened.kind !== 'ok') throw new Error(`did not open: ${opened.kind}`)
    return opened.store.records(OFFLINE_LIBRARY_STORE_REGISTRATION.name).read(pinKey(documentId))
  }

  for (const step of ['verifyKey', 'open'] as const) {
    it(`${step} held across forget() + lockAndWipe: interrupted, no record, the next call works`, async () => {
      const fs = createMemoryFs()
      const layer = createLibraryLayer(fs, createFakeKeys())
      const { held, release, entered } = holdFirst(layer, step)
      const store = createOfflineLibraryStore({ layer: held, scope: SCOPE })
      const writing = store.putPin(pinRow('doc_1'))
      await entered
      // sign-out: the manager forgets the handle synchronously, then the wiring wipes
      store.forget()
      await layer.lockAndWipe(SCOPE)
      release()
      expect(await writing).toEqual({ kind: 'interrupted' })
      expect(await pinAfterWipe(layer, 'doc_1')).toEqual({ kind: 'missing' })
      expect(fs.listFiles()).toEqual([])
      // the boundary passed: a fresh call opens the scope again and works
      expect(await store.putPin(pinRow('doc_1'))).toEqual({ kind: 'ok' })
      expect(await store.getPin('doc_1')).toMatchObject({ kind: 'ok' })
    })
  }

  it('open held across forget() alone (new session, no wipe): interrupted, nothing cached', async () => {
    const fs = createMemoryFs()
    const layer = createLibraryLayer(fs, createFakeKeys())
    const { held, release, entered } = holdFirst(layer, 'open')
    let opens = 0
    const store = createOfflineLibraryStore({
      layer: {
        ...held,
        open: (scope) => {
          opens += 1
          return held.open(scope)
        },
      },
      scope: SCOPE,
    })
    const writing = store.putPin(pinRow('doc_1'))
    await entered
    // a new session crosses the boundary: the handle is forgotten, the scope is not wiped
    store.forget()
    release()
    expect(await writing).toEqual({ kind: 'interrupted' })
    expect(fs.listFiles()).toEqual([])
    expect(opens).toBe(1)
    // the handle the held call opened was not kept: the next call opens its own
    expect(await store.putPin(pinRow('doc_1'))).toEqual({ kind: 'ok' })
    expect(opens).toBe(2)
    expect(await store.getPin('doc_1')).toMatchObject({ kind: 'ok' })
  })
})

describe('FUSR-R1-1 (UNI-1362): forget() between the last resolve check and the record call', () => {
  /**
   * A layer whose opened handle calls `onRecords` each time the store asks it for
   * the record namespace: the last synchronous step of `resolve()`, after every
   * generation check inside it and before the caller's own continuation. Calling
   * `forget()` there is a boundary landing in the final async return.
   */
  function layerWithRecordsHook(layer: StoreLayer, calls: string[]) {
    let onRecords: (() => void) | null = null
    const hooked: StoreLayer = {
      ...layer,
      open: async (scope) => {
        const result = await layer.open(scope)
        if (result.kind !== 'ok') return result
        const wrap = (name: string) => {
          const records = result.store.records(name)
          return {
            ...records,
            write: (key: string, value: Uint8Array) => {
              calls.push(`write:${key}`)
              return records.write(key, value)
            },
            read: (key: string) => {
              calls.push(`read:${key}`)
              return records.read(key)
            },
            delete: (key: string) => {
              calls.push(`delete:${key}`)
              return records.delete(key)
            },
          }
        }
        return {
          kind: 'ok' as const,
          store: {
            scope: result.store.scope,
            records: (name: string) => {
              const hook = onRecords
              onRecords = null
              hook?.()
              return wrap(name)
            },
          },
        }
      },
    }
    return { hooked, arm: (hook: () => void) => (onRecords = hook) }
  }

  const readPin = async (layer: StoreLayer, documentId: string) => {
    const opened = await layer.open(SCOPE)
    if (opened.kind !== 'ok') throw new Error(`did not open: ${opened.kind}`)
    return opened.store.records(OFFLINE_LIBRARY_STORE_REGISTRATION.name).read(pinKey(documentId))
  }

  it('a cached handle: putPin after forget() is interrupted and writes no record', async () => {
    const fs = createMemoryFs()
    const layer = createLibraryLayer(fs, createFakeKeys())
    const calls: string[] = []
    const { hooked, arm } = layerWithRecordsHook(layer, calls)
    const store = createOfflineLibraryStore({ layer: hooked, scope: SCOPE })
    // cache the handle first: only the final continuation is left to race
    expect(await store.readIndex()).toMatchObject({ kind: 'ok' })
    calls.length = 0
    arm(() => store.forget())
    expect(await store.putPin(pinRow('doc_1'))).toEqual({ kind: 'interrupted' })
    expect(calls).toEqual([])
    expect(await readPin(layer, 'doc_1')).toEqual({ kind: 'missing' })
    // no wipe happened: the next call works
    expect(await store.putPin(pinRow('doc_1'))).toEqual({ kind: 'ok' })
    expect(await store.getPin('doc_1')).toMatchObject({ kind: 'ok' })
  })

  it('a cached handle: getPin after forget() is interrupted and never reads', async () => {
    const fs = createMemoryFs()
    const layer = createLibraryLayer(fs, createFakeKeys())
    const calls: string[] = []
    const { hooked, arm } = layerWithRecordsHook(layer, calls)
    const store = createOfflineLibraryStore({ layer: hooked, scope: SCOPE })
    expect(await store.putPin(pinRow('doc_1'))).toEqual({ kind: 'ok' })
    calls.length = 0
    arm(() => store.forget())
    expect(await store.getPin('doc_1')).toEqual({ kind: 'interrupted' })
    expect(calls).toEqual([])
    expect(await store.getPin('doc_1')).toMatchObject({ kind: 'ok' })
  })

  it('a cached handle: deletePin after forget() is interrupted and deletes nothing', async () => {
    const fs = createMemoryFs()
    const layer = createLibraryLayer(fs, createFakeKeys())
    const calls: string[] = []
    const { hooked, arm } = layerWithRecordsHook(layer, calls)
    const store = createOfflineLibraryStore({ layer: hooked, scope: SCOPE })
    expect(await store.putPin(pinRow('doc_1'))).toEqual({ kind: 'ok' })
    calls.length = 0
    arm(() => store.forget())
    expect(await store.deletePin('doc_1')).toEqual({ kind: 'interrupted' })
    expect(calls).toEqual([])
    expect(await readPin(layer, 'doc_1')).toMatchObject({ kind: 'ok' })
    expect(await store.deletePin('doc_1')).toEqual({ kind: 'ok' })
  })
})

runStoreCompliance('uniwork-sync offline-library', async (env: ComplianceEnv) => {
  const layer = createStoreLayer({
    root: env.root,
    keys: createSafeStorageKeyProvider({ safeStorage: env.safeStorage, dir: env.keyDir }),
    budgetBytes: env.budgetBytes,
    clock: env.clock,
  })
  layer.register(OFFLINE_LIBRARY_STORE_REGISTRATION)
  const opened = await layer.open(env.scope)
  if (opened.kind !== 'ok') throw new Error(`offline-library did not open: ${opened.kind}`)
  const subject: ComplianceSubject = {
    registration: OFFLINE_LIBRARY_STORE_REGISTRATION,
    layer,
    scope: env.scope,
    records: opened.store.records(OFFLINE_LIBRARY_STORE_REGISTRATION.name),
  }
  return subject
})
