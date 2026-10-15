import { describe, expect, it } from 'vitest'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import {
  OFFLINE_LIBRARY_LAYER_BUDGET_BYTES,
  OFFLINE_LIBRARY_MAX_PINS,
  OFFLINE_LIBRARY_QUOTA_BYTES,
  OFFLINE_LIBRARY_STORE_REGISTRATION,
  blobKey,
  createOfflineLibraryStore,
  isBlobKey,
  pinKey,
} from '../src/main/uniwork-sync/offline-library'
import { createStoreLayer } from '../src/main/uniwork-sync/store'
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
