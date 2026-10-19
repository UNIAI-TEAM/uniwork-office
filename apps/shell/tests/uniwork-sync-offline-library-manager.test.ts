import { describe, expect, it } from 'vitest'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { INTENT_STORE_REGISTRATION } from '../src/main/uniwork-sync/intent-store'
import type { StoreScope } from '../src/main/uniwork-sync/keys'
import {
  OFFLINE_LIBRARY_STORE_REGISTRATION,
  PIN_RECORD_SCHEMA,
  blobKey,
  decodePinRecord,
  manifestFromDetail,
  pinKey,
  type PinRecord,
  type PinRow,
} from '../src/main/uniwork-sync/offline-library'
import { DRAFTS_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/drafts'
import { PAUSE_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/pause'
import { createStoreLayer, recordFileName } from '../src/main/uniwork-sync/store'
import {
  ORG,
  ROOT,
  SCOPE,
  WS,
  addDoc,
  createHarness,
  filesContaining,
  leaseState,
  plaintext,
  recordFile,
  sha,
  type Harness,
} from './uniwork-sync-offline-library-fakes'

const MiB = 1024 * 1024
const GiB = 1024 * MiB

const pinDoc = (h: Harness, documentId = 'doc_1') =>
  h.manager.pin({ documentId, orgId: ORG, workspaceId: WS })

function rowOf(result: Awaited<ReturnType<Harness['manager']['pin']>>): PinRow {
  if (result.kind !== 'pinned') throw new Error(`not pinned: ${result.code}`)
  return result.row
}

/** every library record of one document on the fake disk (row, blobs, staging) */
function filesOfPin(h: Harness, documentId: string, generations: string[]): string[] {
  const keys = [pinKey(documentId)]
  for (const generation of generations) {
    keys.push(blobKey(documentId, generation, 'main'), blobKey(documentId, generation, 0))
  }
  const files = new Set(h.storeFiles())
  return keys.map(recordFile).filter((file) => files.has(file))
}

/**
 * The sync store beside the library (drafts, intents, the queue's pause), on
 * the same fake disk: what unpin and the removals must never touch.
 */
async function syncStoreWithLocalWork(h: Harness) {
  const layer = createStoreLayer({
    root: '/sync',
    keys: h.keys,
    budgetBytes: 1 << 20,
    clock: () => 1,
    fs: h.fs,
  })
  layer.register(INTENT_STORE_REGISTRATION)
  layer.register(DRAFTS_STORE_REGISTRATION)
  layer.register(PAUSE_STORE_REGISTRATION)
  const opened = await layer.open(SCOPE)
  if (opened.kind !== 'ok') throw new Error('sync store did not open')
  await opened.store.records(INTENT_STORE_REGISTRATION.name).write('doc_1', plaintext('intent', 64))
  await opened.store
    .records(DRAFTS_STORE_REGISTRATION.name)
    .write('doc_1/1', plaintext('draft', 64))
  await opened.store.records(PAUSE_STORE_REGISTRATION.name).write('queue', plaintext('pause', 16))
  h.localWork.add('doc_1')
  const snapshot = () =>
    new Map(h.fs.listFiles('/sync').map((path) => [path, Buffer.from(h.fs.files.get(path)!)]))
  return { snapshot, records: opened.store.records }
}

function seedRow(documentId: string, sizeBytes: number): PinRecord {
  return {
    schema: PIN_RECORD_SCHEMA,
    documentId,
    scope: { orgId: ORG, workspaceId: WS },
    manifest: {
      main: {
        version: 1,
        sha256: sha(plaintext(documentId)),
        sizeBytes,
        filename: `${documentId}.pdf`,
        mimeType: 'application/pdf',
      },
      assets: [],
    },
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

async function seedPins(h: Harness, count: number, sizeBytes: number) {
  const pins: string[] = []
  for (let index = 0; index < count; index += 1) {
    const documentId = `seed_${index}`
    expect((await h.store.putPin(seedRow(documentId, sizeBytes))).kind).toBe('ok')
    pins.push(documentId)
  }
  expect((await h.store.writeIndex({ pins, cleanup: {} })).kind).toBe('ok')
}

describe('G5-05 unpin leaves drafts/intents/queue untouched', () => {
  it('asks first when the document has drafts or intents, then deletes only the pin', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1)
    rowOf(await pinDoc(h))
    const sync = await syncStoreWithLocalWork(h)
    const before = sync.snapshot()
    expect(await h.manager.unpin('doc_1')).toEqual({ kind: 'needsConfirm' })
    expect(await h.manager.row('doc_1')).not.toBeNull()
    expect(await h.manager.unpin('doc_1', { confirmed: true })).toEqual({
      kind: 'unpinned',
      deferred: false,
    })
    // byte-identical sync store: every intent, draft and queue record stays
    expect(sync.snapshot()).toEqual(before)
    const intent = await sync.records(INTENT_STORE_REGISTRATION.name).read('doc_1')
    expect(intent.kind).toBe('ok')
    const draft = await sync.records(DRAFTS_STORE_REGISTRATION.name).read('doc_1/1')
    expect(draft.kind).toBe('ok')
    expect(h.leases.releases).toEqual(['doc_1'])
  })

  it('needs no confirmation without local work', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1)
    rowOf(await pinDoc(h))
    expect(await h.manager.unpin('doc_1')).toEqual({ kind: 'unpinned', deferred: false })
    expect(await h.manager.list()).toEqual([])
  })
})

describe('G5-05 unpin, eviction, revoke and delete remove bytes from disk (store root listing)', () => {
  async function pinnedWithAsset() {
    const asset = plaintext('asset', 1024)
    const h = createHarness({
      fetchAsset: async () => asset,
      manifestOf: (detail) => ({
        ...manifestFromDetail(detail),
        assets: [{ path: 'media/a.png', sha256: sha(asset), sizeBytes: 1024 }],
      }),
    })
    const doc = addDoc(h, 'doc_1', 1)
    rowOf(await pinDoc(h))
    expect(filesOfPin(h, 'doc_1', ['00000001'])).toEqual(
      [pinKey('doc_1'), blobKey('doc_1', '00000001', 'main'), blobKey('doc_1', '00000001', 0)].map(
        recordFile,
      ),
    )
    return { h, doc, asset }
  }

  it('unpin: no row, blob, asset or staging record of the pin is left', async () => {
    const { h, doc, asset } = await pinnedWithAsset()
    const others = h
      .storeFiles()
      .filter((file) => !filesOfPin(h, 'doc_1', ['00000001']).includes(file))
    await h.manager.unpin('doc_1')
    expect(filesOfPin(h, 'doc_1', ['00000001'])).toEqual([])
    expect(h.storeFiles()).toEqual(others)
    expect(filesContaining(h.fs, doc.bytes)).toEqual([])
    expect(filesContaining(h.fs, asset)).toEqual([])
  })

  it('eviction: the copy and its asset go, the pin stays to download again', async () => {
    const { h } = await pinnedWithAsset()
    const evicted = await h.manager.evict('doc_1')
    expect(evicted).toMatchObject({ kind: 'ok', row: { state: 'waiting-network', bytes: 0 } })
    expect(filesOfPin(h, 'doc_1', ['00000001'])).toEqual([recordFile(pinKey('doc_1'))])
    expect(h.storeFiles()).toEqual([recordFile('index'), recordFile(pinKey('doc_1'))].sort())
  })

  it('revoke: the copy and its asset go, the row shows revoked', async () => {
    const { h } = await pinnedWithAsset()
    await h.manager.handleLeaseRevoked({
      documentId: 'doc_1',
      reason: 'offline_lease_revoked',
      deleteCommittedCache: true,
      keepDrafts: true,
    })
    expect(h.storeFiles()).toEqual([recordFile('index'), recordFile(pinKey('doc_1'))].sort())
  })

  it('delete: the copy and its asset go, the row shows deleted', async () => {
    const { h } = await pinnedWithAsset()
    await h.manager.handleDeleted('doc_1')
    expect(h.storeFiles()).toEqual([recordFile('index'), recordFile(pinKey('doc_1'))].sort())
  })

  it('a revoke during a download stops it and leaves no staging record', async () => {
    const h = createHarness()
    const doc = addDoc(h, 'doc_1', 1, 8192)
    let revoked: Promise<unknown> | null = null
    h.docs.beforeChunk = (_id, index) => {
      if (index === 3) revoked = h.manager.handlePermissionRevoked('doc_1')
    }
    rowOf(await pinDoc(h))
    await revoked
    expect(await h.manager.row('doc_1')).toMatchObject({ state: 'revoked' })
    expect(h.storeFiles()).toEqual([recordFile('index'), recordFile(pinKey('doc_1'))].sort())
    expect(filesContaining(h.fs, doc.bytes)).toEqual([])
  })

  it('unpin with an open tab: the bytes go when the last tab closes', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1)
    rowOf(await pinDoc(h))
    h.manager.markOpen('doc_1')
    h.manager.markOpen('doc_1')
    expect(await h.manager.unpin('doc_1')).toEqual({ kind: 'unpinned', deferred: true })
    expect(await h.manager.list()).toEqual([])
    const main = recordFile(blobKey('doc_1', '00000001', 'main'))
    expect(h.storeFiles()).toContain(main)
    await h.manager.markClosed('doc_1')
    expect(h.storeFiles()).toContain(main)
    await h.manager.markClosed('doc_1')
    expect(h.storeFiles()).toEqual([recordFile('index')])
  })

  it('a deferred cleanup left by a crash is finished by recover()', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1)
    rowOf(await pinDoc(h))
    h.manager.markOpen('doc_1')
    await h.manager.unpin('doc_1')
    // restart: a new session's manager, no tab open
    h.session.id = 'sess_2'
    await h.manager.recover()
    expect(h.storeFiles()).toEqual([recordFile('index')])
  })

  it('a download a crash left behind: recover() deletes its staging and marks it interrupted', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1)
    const row = seedRow('doc_1', 4096)
    const staged = blobKey('doc_1', '000000ff', 'main')
    await h.store.putPin({
      ...row,
      state: 'downloading',
      staging: { generation: '000000ff', keys: [staged] },
    })
    await h.store.putBlob(staged, plaintext('half', 2048))
    await h.store.writeIndex({ pins: ['doc_1'], cleanup: {} })
    await h.manager.recover()
    expect(h.storeFiles()).not.toContain(recordFile(staged))
    expect(await h.manager.row('doc_1')).toMatchObject({ state: 'interrupted' })
  })
})

describe('G5-05 archived stays and opens until lease end', () => {
  it('a pinned document archived on the server stays in the library and opens read-only', async () => {
    const h = createHarness()
    const doc = addDoc(h, 'doc_1', 1)
    rowOf(await pinDoc(h))
    doc.archivedAt = '2026-10-14T00:00:00Z'
    expect(await h.manager.refresh('doc_1')).toMatchObject({
      kind: 'ok',
      row: { state: 'archived' },
    })
    const copy = await h.manager.openCached('doc_1')
    expect(copy).toMatchObject({ kind: 'ok', readOnly: true })
    // the lease ends: the row locks and the copy no longer opens
    h.leases.states.set('doc_1', leaseState('expired'))
    expect(await h.manager.row('doc_1')).toMatchObject({ state: 'lease-expired', archived: true })
    expect(await h.manager.openCached('doc_1')).toEqual({
      kind: 'refused',
      code: 'lease_unusable',
      lease: 'expired',
    })
    // the bytes are kept (not deleted): archived is not a removal
    expect(h.storeFiles()).toContain(recordFile(blobKey('doc_1', '00000001', 'main')))
  })

  it('handleArchived marks the row and keeps the copy', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1)
    rowOf(await pinDoc(h))
    expect(await h.manager.handleArchived('doc_1')).toMatchObject({ state: 'archived' })
    expect(await h.manager.openCached('doc_1')).toMatchObject({ kind: 'ok' })
  })
})

describe('G5-05 deleted -> cache + assets gone, drafts kept', () => {
  it('a server delete found on refresh deletes the copy; drafts and intents stay', async () => {
    const h = createHarness()
    const doc = addDoc(h, 'doc_1', 1)
    rowOf(await pinDoc(h))
    const sync = await syncStoreWithLocalWork(h)
    const before = sync.snapshot()
    doc.error = new UniworkDocError('deleted')
    expect(await h.manager.refresh('doc_1')).toMatchObject({
      kind: 'ok',
      row: { state: 'deleted' },
    })
    expect(await h.manager.openCached('doc_1')).toEqual({ kind: 'refused', code: 'deleted' })
    expect(h.storeFiles()).not.toContain(recordFile(blobKey('doc_1', '00000001', 'main')))
    expect(sync.snapshot()).toEqual(before)
  })

  it('handleDeleted (feed) keeps the row as deleted until unpinned', async () => {
    const h = createHarness()
    const doc = addDoc(h, 'doc_1', 1)
    rowOf(await pinDoc(h))
    expect(await h.manager.handleDeleted('doc_1')).toMatchObject({ state: 'deleted', bytes: 0 })
    // still deleted on the server (a readable one is restored, T5-5)
    doc.error = new UniworkDocError('deleted')
    expect(await h.manager.refresh('doc_1')).toMatchObject({ row: { state: 'deleted' } })
    expect(await h.manager.openCached('doc_1')).toEqual({ kind: 'refused', code: 'deleted' })
    expect(await h.manager.unpin('doc_1')).toEqual({ kind: 'unpinned', deferred: false })
  })
})

describe('G5-05 revoke -> cache + assets gone, drafts kept', () => {
  it('a lease revoke notice (renew lost permission) deletes the copy; drafts stay', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1)
    rowOf(await pinDoc(h))
    const sync = await syncStoreWithLocalWork(h)
    const before = sync.snapshot()
    h.leases.states.set('doc_1', leaseState('revoked', null))
    const row = await h.manager.handleLeaseRevoked({
      documentId: 'doc_1',
      reason: 'offline_lease_revoked',
      deleteCommittedCache: true,
      keepDrafts: true,
    })
    expect(row).toMatchObject({ state: 'revoked', bytes: 0 })
    expect(await h.manager.openCached('doc_1')).toEqual({ kind: 'refused', code: 'revoked' })
    expect(sync.snapshot()).toEqual(before)
  })

  it('permission_revoked / 403 on refresh deletes the copy the same way', async () => {
    const h = createHarness()
    const doc = addDoc(h, 'doc_1', 1)
    rowOf(await pinDoc(h))
    doc.error = new UniworkDocError('forbidden')
    expect(await h.manager.refresh('doc_1')).toMatchObject({
      kind: 'ok',
      row: { state: 'revoked' },
    })
    expect(h.storeFiles()).toEqual([recordFile('index'), recordFile(pinKey('doc_1'))].sort())
  })
})

describe('G5-05 over limit (2 GiB, 200 pins, 256 MiB) -> refused with a code', () => {
  it('the 201st pin is refused offline_cap_reached and nothing is downloaded', async () => {
    const h = createHarness()
    await seedPins(h, 200, 1024)
    addDoc(h, 'doc_1', 1)
    expect(await pinDoc(h)).toEqual({ kind: 'refused', code: 'offline_cap_reached' })
    expect(h.docs.downloads).toEqual([])
    expect(await h.manager.row('doc_1')).toBeNull()
    expect(await h.manager.quota()).toMatchObject({ pins: 200, maxPins: 200 })
  })

  it('a pin crossing 2 GiB is refused offline_cap_reached; one that fits is taken', async () => {
    const h = createHarness()
    // 8 x 256 MiB = 2 GiB declared, minus 8 KiB of room
    await seedPins(h, 7, 256 * MiB)
    expect((await h.store.putPin(seedRow('seed_7', 256 * MiB - 8192))).kind).toBe('ok')
    await h.store.writeIndex({
      pins: [...Array.from({ length: 8 }, (_, index) => `seed_${index}`)],
      cleanup: {},
    })
    expect(await h.manager.quota()).toMatchObject({ usedBytes: 2 * GiB - 8192, maxBytes: 2 * GiB })
    addDoc(h, 'doc_big', 1, 8192 + 1)
    expect(await pinDoc(h, 'doc_big')).toEqual({ kind: 'refused', code: 'offline_cap_reached' })
    expect(h.docs.downloads).toEqual([])
    addDoc(h, 'doc_fits', 1, 8192)
    expect(rowOf(await pinDoc(h, 'doc_fits')).state).toBe('ready')
  })

  it('a single file over 256 MiB is refused too_large before any download', async () => {
    const h = createHarness()
    const doc = addDoc(h, 'doc_1', 1)
    doc.declaredSize = 256 * MiB + 1
    expect(await pinDoc(h)).toEqual({ kind: 'refused', code: 'too_large' })
    expect(h.docs.downloads).toEqual([])
    expect(h.storeFiles()).toEqual([])
  })

  it('a folder (not a file) is never pinned', async () => {
    const h = createHarness()
    h.docs.docs.set('folder_1', {
      bytes: new Uint8Array(),
      version: 0,
      error: new UniworkDocError('unsupported_format'),
    })
    expect(await pinDoc(h, 'folder_1')).toEqual({ kind: 'refused', code: 'not_a_file' })
  })
})

describe('G5-05 capability off -> OQ-UX11 (a)', () => {
  it('keeps the copies, opens them while the lease is valid, refuses new pins, never renews', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1)
    addDoc(h, 'doc_2', 1)
    rowOf(await pinDoc(h))
    h.capability.on = false
    const grantsBefore = h.leases.grants.length
    // new pins refused with a code, nothing downloaded
    expect(await pinDoc(h, 'doc_2')).toEqual({ kind: 'refused', code: 'capability_off' })
    expect(h.docs.downloads).toEqual(['doc_1@1'])
    // the kept copy is listed and opens while the lease is valid
    expect(await h.manager.list()).toMatchObject([{ documentId: 'doc_1', state: 'ready' }])
    expect(await h.manager.openCached('doc_1')).toMatchObject({ kind: 'ok', readOnly: true })
    // no refresh, re-download or lease renewal
    addDoc(h, 'doc_1', 2)
    expect(await h.manager.downloadNow('doc_1')).toEqual({
      kind: 'refused',
      code: 'capability_off',
    })
    expect(await h.manager.onReconnect()).toEqual(new Map())
    expect(h.leases.grants.length).toBe(grantsBefore)
    // the lease ends: locked, the bytes are still kept (deleted only at sign-out)
    h.leases.states.set('doc_1', leaseState('expired'))
    expect(await h.manager.openCached('doc_1')).toMatchObject({ code: 'lease_unusable' })
    expect(h.storeFiles()).toContain(recordFile(blobKey('doc_1', '00000001', 'main')))
    // re-enabled: pinning works again
    h.capability.on = true
    expect(rowOf(await pinDoc(h, 'doc_2')).state).toBe('ready')
  })

  it('the lease grant answering office_capability_off refuses the pin', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1)
    h.leases.grantResult = 'capability_off'
    expect(await pinDoc(h)).toEqual({ kind: 'refused', code: 'capability_off' })
    expect(h.docs.downloads).toEqual([])
  })
})

describe('G5-05 pin offline -> waiting-network then downloads', () => {
  it('pins without a network as waiting-network and downloads on reconnect', async () => {
    const h = createHarness()
    const doc = addDoc(h, 'doc_1', 1)
    h.online.on = false
    const row = rowOf(await pinDoc(h))
    expect(row).toMatchObject({ state: 'waiting-network', readyVersion: null })
    expect(h.docs.downloads).toEqual([])
    expect(h.leases.grants).toEqual([])
    expect(await h.manager.onReconnect()).toEqual(new Map())
    h.online.on = true
    const results = await h.manager.onReconnect()
    expect(results.get('doc_1')).toMatchObject({
      kind: 'ok',
      row: { state: 'ready', readyVersion: 1 },
    })
    expect(h.leases.grants).toEqual(['doc_1'])
    const copy = await h.manager.openCached('doc_1')
    expect(copy.kind === 'ok' && Buffer.from(copy.bytes).equals(Buffer.from(doc.bytes))).toBe(true)
  })

  it('a network error while reading the head also waits for the network', async () => {
    const h = createHarness()
    const doc = addDoc(h, 'doc_1', 1)
    doc.error = new UniworkDocError('network')
    expect(rowOf(await pinDoc(h)).state).toBe('waiting-network')
    delete doc.error
    expect((await h.manager.onReconnect()).get('doc_1')).toMatchObject({ row: { state: 'ready' } })
  })
})

describe('G5-05 refresh: update-available', () => {
  it('a newer head marks update-available; "Tải ngay" replaces the copy and deletes the old one', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1)
    rowOf(await pinDoc(h))
    const v2 = addDoc(h, 'doc_1', 2)
    expect(await h.manager.refresh('doc_1')).toMatchObject({ row: { state: 'update-available' } })
    expect(await h.manager.downloadNow('doc_1')).toMatchObject({
      row: { state: 'ready', readyVersion: 2 },
    })
    expect(h.storeFiles()).not.toContain(recordFile(blobKey('doc_1', '00000001', 'main')))
    const copy = await h.manager.openCached('doc_1')
    expect(copy.kind === 'ok' && Buffer.from(copy.bytes).equals(Buffer.from(v2.bytes))).toBe(true)
  })

  it('a view lease shows view-only and still opens read-only', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1)
    rowOf(await pinDoc(h))
    h.leases.states.set('doc_1', leaseState('valid', 'view'))
    expect(await h.manager.row('doc_1')).toMatchObject({ state: 'view-only' })
    expect(await h.manager.openCached('doc_1')).toMatchObject({ kind: 'ok', readOnly: true })
  })

  it('without a session nothing is read or written', async () => {
    const h = createHarness()
    h.session.scope = null
    addDoc(h, 'doc_1', 1)
    expect(await pinDoc(h)).toEqual({ kind: 'refused', code: 'no_session' })
    expect(await h.manager.openCached('doc_1')).toEqual({ kind: 'refused', code: 'no_session' })
    expect(h.storeFiles()).toEqual([])
  })
})

/** a gate the fake download waits on before chunk `at` (a slow transfer) */
function slowDownload(h: Harness, documentId: string, at = 2) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let reached!: () => void
  const waiting = new Promise<void>((resolve) => {
    reached = resolve
  })
  h.docs.beforeChunk = async (id, index) => {
    if (id !== documentId || index !== at) return
    reached()
    await gate
  }
  return { release, waiting }
}

const settleWithin = <T>(promise: Promise<T>, ms = 300): Promise<T | 'BLOCKED'> =>
  Promise.race([
    promise,
    new Promise<'BLOCKED'>((resolve) => setTimeout(() => resolve('BLOCKED'), ms)),
  ])

const bytesOf = (copy: unknown): Buffer | null => {
  const read = copy as { kind: string; bytes?: Uint8Array }
  return read.kind === 'ok' && read.bytes ? Buffer.from(read.bytes) : null
}

describe('T5-1 caps hold under concurrent pins (check + reserve + index-add are one step)', () => {
  it('199 pins + two concurrent pins -> exactly one refused offline_cap_reached, nothing downloaded for it', async () => {
    const h = createHarness()
    await seedPins(h, 199, 1024)
    addDoc(h, 'doc_a', 1)
    addDoc(h, 'doc_b', 1)
    const results = await Promise.all([pinDoc(h, 'doc_a'), pinDoc(h, 'doc_b')])
    expect(results.filter((result) => result.kind === 'refused')).toEqual([
      { kind: 'refused', code: 'offline_cap_reached' },
    ])
    expect(results.filter((result) => result.kind === 'pinned')).toHaveLength(1)
    expect(await h.manager.quota()).toMatchObject({ pins: 200, maxPins: 200 })
    // only the taken pin was downloaded; the refused one left no row
    expect(h.docs.downloads).toHaveLength(1)
    const loser = results[0].kind === 'refused' ? 'doc_a' : 'doc_b'
    expect(h.docs.downloads[0]).not.toContain(loser)
    expect(await h.manager.row(loser)).toBeNull()
    expect(h.storeFiles()).not.toContain(recordFile(pinKey(loser)))
  })

  it('two concurrent pins that fit alone but cross 2 GiB together -> one refused', async () => {
    const h = createHarness()
    // 2 GiB minus 12 KiB declared: each 8 KiB pin fits alone, both together do not
    await seedPins(h, 7, 256 * MiB)
    expect((await h.store.putPin(seedRow('seed_7', 256 * MiB - 12288))).kind).toBe('ok')
    await h.store.writeIndex({
      pins: Array.from({ length: 8 }, (_, index) => `seed_${index}`),
      cleanup: {},
    })
    addDoc(h, 'doc_a', 1, 8192)
    addDoc(h, 'doc_b', 1, 8192)
    const results = await Promise.all([pinDoc(h, 'doc_a'), pinDoc(h, 'doc_b')])
    expect(results.filter((result) => result.kind === 'refused')).toEqual([
      { kind: 'refused', code: 'offline_cap_reached' },
    ])
    expect(h.docs.downloads).toHaveLength(1)
    const quota = await h.manager.quota()
    expect(quota).toMatchObject({ pins: 9, maxBytes: 2 * GiB })
    expect((quota as { usedBytes: number }).usedBytes).toBeLessThanOrEqual(2 * GiB)
  })

  it('a pin whose lease is refused after the reservation releases it', async () => {
    const h = createHarness()
    await seedPins(h, 199, 1024)
    addDoc(h, 'doc_a', 1)
    addDoc(h, 'doc_b', 1)
    h.leases.grantResult = 'revoked'
    expect(await pinDoc(h, 'doc_a')).toEqual({ kind: 'refused', code: 'revoked' })
    expect(await h.manager.quota()).toMatchObject({ pins: 199 })
    expect(await h.manager.row('doc_a')).toBeNull()
    h.leases.grantResult = 'renewed'
    expect(rowOf(await pinDoc(h, 'doc_b')).state).toBe('ready')
  })

  it('a cancelled first download releases its bytes from the quota', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1, 8192)
    const slow = slowDownload(h, 'doc_1')
    const pinning = pinDoc(h)
    await slow.waiting
    expect(await h.manager.quota()).toMatchObject({ usedBytes: 8192, pins: 1 })
    expect(h.manager.cancel('doc_1')).toBe(true)
    slow.release()
    expect(rowOf(await pinning).state).toBe('interrupted')
    expect(await h.manager.quota()).toMatchObject({ usedBytes: 0, pins: 1 })
  })
})

describe('T5-2 an in-flight re-download never blocks the old copy', () => {
  it('a slow re-download of a ready pin: openCached serves the old bytes at once, the new ones after commit', async () => {
    const h = createHarness()
    const v1 = addDoc(h, 'doc_1', 1, 8192)
    rowOf(await pinDoc(h))
    const v2 = addDoc(h, 'doc_1', 2, 8192)
    const slow = slowDownload(h, 'doc_1')
    const download = h.manager.downloadNow('doc_1')
    await slow.waiting
    const during = await settleWithin(h.manager.openCached('doc_1'))
    expect(during).toMatchObject({ kind: 'ok', readOnly: true })
    expect(bytesOf(during)?.equals(Buffer.from(v1.bytes))).toBe(true)
    // handleArchived is not held up by the transfer either
    expect(await settleWithin(h.manager.handleArchived('doc_1'))).toMatchObject({
      documentId: 'doc_1',
    })
    slow.release()
    expect(await download).toMatchObject({ row: { readyVersion: 2 } })
    expect(bytesOf(await h.manager.openCached('doc_1'))?.equals(Buffer.from(v2.bytes))).toBe(true)
    // the archived mark set during the download survived the commit
    expect(await h.manager.row('doc_1')).toMatchObject({ archived: true, readyVersion: 2 })
    expect(h.storeFiles()).not.toContain(recordFile(blobKey('doc_1', '00000001', 'main')))
  })

  it('a revoke arriving mid-download still wins: cache gone, staging wiped, nothing ready', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1, 8192)
    rowOf(await pinDoc(h))
    addDoc(h, 'doc_1', 2, 8192)
    const slow = slowDownload(h, 'doc_1')
    const download = h.manager.downloadNow('doc_1')
    await slow.waiting
    const revoking = h.manager.handlePermissionRevoked('doc_1')
    slow.release()
    expect(await revoking).toMatchObject({ state: 'revoked', bytes: 0 })
    await download
    expect(await h.manager.row('doc_1')).toMatchObject({ state: 'revoked', readyVersion: null })
    expect(h.storeFiles()).toEqual([recordFile('index'), recordFile(pinKey('doc_1'))].sort())
    expect(await h.manager.openCached('doc_1')).toEqual({ kind: 'refused', code: 'revoked' })
  })

  it('a server delete found by refresh mid-download still wins', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1, 8192)
    rowOf(await pinDoc(h))
    const v2 = addDoc(h, 'doc_1', 2, 8192)
    const slow = slowDownload(h, 'doc_1')
    const download = h.manager.downloadNow('doc_1')
    await slow.waiting
    v2.error = new UniworkDocError('document_deleted')
    const refreshing = h.manager.refresh('doc_1')
    slow.release()
    expect(await refreshing).toMatchObject({ kind: 'ok', row: { state: 'deleted' } })
    await download
    expect(await h.manager.row('doc_1')).toMatchObject({ state: 'deleted', readyVersion: null })
    expect(h.storeFiles()).toEqual([recordFile('index'), recordFile(pinKey('doc_1'))].sort())
    expect(await h.manager.openCached('doc_1')).toEqual({ kind: 'refused', code: 'deleted' })
  })
})

describe('T5-4 the lease revoke notice honours its reason', () => {
  const notice = (reason: string) => ({
    documentId: 'doc_1',
    reason,
    deleteCommittedCache: true as const,
    keepDrafts: true as const,
  })

  it('a delete found at lease renewal (document_deleted) -> row deleted', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1)
    rowOf(await pinDoc(h))
    expect(await h.manager.handleLeaseRevoked(notice('document_deleted'))).toMatchObject({
      state: 'deleted',
      bytes: 0,
    })
    expect(h.storeFiles()).toEqual([recordFile('index'), recordFile(pinKey('doc_1'))].sort())
  })

  it('a permission loss at lease renewal -> row revoked', async () => {
    for (const reason of ['permission_revoked', 'forbidden', 'offline_lease_revoked']) {
      const h = createHarness()
      addDoc(h, 'doc_1', 1)
      rowOf(await pinDoc(h))
      expect(await h.manager.handleLeaseRevoked(notice(reason))).toMatchObject({
        state: 'revoked',
        bytes: 0,
      })
    }
  })
})

describe('T5-5 restore and a quota refusal at reconnect', () => {
  it('a deleted row that is readable again is restored: waiting-network, then downloads', async () => {
    const h = createHarness()
    const doc = addDoc(h, 'doc_1', 1)
    rowOf(await pinDoc(h))
    doc.error = new UniworkDocError('deleted')
    expect(await h.manager.refresh('doc_1')).toMatchObject({ row: { state: 'deleted' } })
    // still gone: the row stays deleted
    expect(await h.manager.refresh('doc_1')).toMatchObject({ row: { state: 'deleted' } })
    delete doc.error
    expect(await h.manager.refresh('doc_1')).toMatchObject({
      kind: 'ok',
      row: { state: 'waiting-network' },
    })
    expect((await h.manager.onReconnect()).get('doc_1')).toMatchObject({
      row: { state: 'ready', readyVersion: 1 },
    })
    expect(bytesOf(await h.manager.openCached('doc_1'))?.equals(Buffer.from(doc.bytes))).toBe(true)
  })

  it('a revoked row whose access is back downloads again ("Tải ngay"), with a fresh lease', async () => {
    const h = createHarness()
    const doc = addDoc(h, 'doc_1', 1)
    rowOf(await pinDoc(h))
    h.leases.states.set('doc_1', leaseState('revoked', null))
    await h.manager.handleLeaseRevoked({
      documentId: 'doc_1',
      reason: 'permission_revoked',
      deleteCommittedCache: true,
      keepDrafts: true,
    })
    expect(await h.manager.row('doc_1')).toMatchObject({ state: 'revoked' })
    expect(await h.manager.downloadNow('doc_1')).toMatchObject({
      kind: 'ok',
      row: { state: 'ready', readyVersion: 1 },
    })
    expect(h.leases.releases).toContain('doc_1')
    expect(h.leases.grants).toEqual(['doc_1', 'doc_1'])
    expect(bytesOf(await h.manager.openCached('doc_1'))?.equals(Buffer.from(doc.bytes))).toBe(true)
  })

  it('a waiting-network pin over the quota at reconnect is refused offline_cap_reached and not retried every pass', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1, 8192)
    h.online.on = false
    expect(rowOf(await pinDoc(h)).state).toBe('waiting-network')
    // the library filled up while it waited (2 GiB declared by 8 other pins)
    for (let index = 0; index < 8; index += 1) {
      const held = { ...seedRow(`seed_${index}`, 256 * MiB), state: 'ready' as const }
      expect((await h.store.putPin({ ...held, bytes: 256 * MiB })).kind).toBe('ok')
    }
    await h.store.writeIndex({
      pins: ['doc_1', ...Array.from({ length: 8 }, (_, index) => `seed_${index}`)],
      cleanup: {},
    })
    h.online.on = true
    const first = await h.manager.onReconnect()
    expect(first.get('doc_1')).toEqual({ kind: 'refused', code: 'offline_cap_reached' })
    expect(await h.manager.row('doc_1')).toMatchObject({
      state: 'interrupted',
      failure: 'offline_cap_reached',
    })
    expect(h.docs.downloads).toEqual([])
    // the next pass does not try it again
    expect((await h.manager.onReconnect()).has('doc_1')).toBe(false)
    // room made: "Thử lại" downloads it
    expect(await h.manager.unpin('seed_0')).toMatchObject({ kind: 'unpinned' })
    expect(await h.manager.downloadNow('doc_1')).toMatchObject({ row: { state: 'ready' } })
  })
})

describe('R4F-2 (UNI-1362): a write in flight at the account boundary never recreates a row', () => {
  /**
   * The `nth` key verification of the library layer from now on waits for
   * `release()`; `reached` resolves once the call is waiting there.
   */
  function holdVerify(h: Harness, nth: number) {
    let release!: () => void
    let reached!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const entered = new Promise<void>((resolve) => (reached = resolve))
    const real = h.layer.verifyKey.bind(h.layer)
    let calls = 0
    h.layer.verifyKey = async (scope) => {
      calls += 1
      if (calls === nth) {
        reached()
        await gate
      }
      return real(scope)
    }
    return { release, entered }
  }

  /** sign-out the way the wiring does it: lock the manager, then wipe the library scope */
  async function signOut(h: Harness) {
    h.manager.lockBoundary()
    h.session.scope = null
    await h.layer.lockAndWipe(SCOPE)
  }

  const revokeNotice = {
    documentId: 'doc_1',
    reason: 'offline_lease_revoked',
    deleteCommittedCache: true,
    keepDrafts: true,
  } as const

  async function pinnedHarness() {
    const changes: string[] = []
    const h = createHarness({ onChange: (documentId) => changes.push(documentId) })
    addDoc(h, 'doc_1', 1)
    rowOf(await pinDoc(h))
    changes.length = 0
    return { h, changes }
  }

  it('handleArchived held in putPin across sign-out: no row recreated, no notice, null', async () => {
    const { h, changes } = await pinnedHarness()
    // getPin verifies first, putPin second
    const hold = holdVerify(h, 2)
    const archiving = h.manager.handleArchived('doc_1')
    await hold.entered
    await signOut(h)
    hold.release()
    expect(await archiving).toBeNull()
    expect(changes).toEqual([])
    expect(h.storeFiles()).toEqual([])
    h.session.scope = SCOPE
    h.session.id = 'sess_2'
    expect(await h.manager.row('doc_1')).toBeNull()
  })

  it('handleArchived held in putPin across a new session of the same account: no row recreated', async () => {
    const { h, changes } = await pinnedHarness()
    const hold = holdVerify(h, 2)
    const archiving = h.manager.handleArchived('doc_1')
    await hold.entered
    // the same account signs in again: the session change is the boundary
    h.session.id = 'sess_2'
    h.manager.markOpen('doc_other')
    await h.layer.lockAndWipe(SCOPE)
    hold.release()
    expect(await archiving).toBeNull()
    expect(changes).toEqual([])
    expect(h.storeFiles()).toEqual([])
    expect(await h.manager.row('doc_1')).toBeNull()
  })

  it('handleLeaseRevoked held in the final row write across sign-out: no revoked row', async () => {
    const { h, changes } = await pinnedHarness()
    // getPin, the copy's one delete, then the revoked row
    const hold = holdVerify(h, 3)
    const revoking = h.manager.handleLeaseRevoked(revokeNotice)
    await hold.entered
    await signOut(h)
    hold.release()
    expect(await revoking).toBeNull()
    expect(changes).toEqual([])
    expect(h.storeFiles()).toEqual([])
  })

  it('handleLeaseRevoked held in wipeKeys across sign-out: the row write after it is refused', async () => {
    const { h, changes } = await pinnedHarness()
    // getPin, then the copy's delete is held: the row write starts after the boundary
    const hold = holdVerify(h, 2)
    const revoking = h.manager.handleLeaseRevoked(revokeNotice)
    await hold.entered
    await signOut(h)
    hold.release()
    expect(await revoking).toBeNull()
    expect(changes).toEqual([])
    expect(h.storeFiles()).toEqual([])
    h.session.scope = SCOPE
    h.session.id = 'sess_2'
    expect(await h.manager.row('doc_1')).toBeNull()
  })

  describe('FUSR-R1 (UNI-1362): every step of an operation is checked against the boundary it started in', () => {
    const SCOPE_B: StoreScope = { deploymentId: 'dep_1', accountId: 'user_2' }
    const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

    function gate() {
      let release!: () => void
      let reached!: () => void
      const open = new Promise<void>((resolve) => (release = resolve))
      const entered = new Promise<void>((resolve) => (reached = resolve))
      return { open, release, entered, reached }
    }

    /** the first lease projection (`view`) from now on waits for `release()` */
    function holdLeaseView(h: Harness) {
      const held = gate()
      const real = h.leases.effectiveState.bind(h.leases)
      let armed = true
      h.leases.effectiveState = async (documentId) => {
        if (armed) {
          armed = false
          held.reached()
          await held.open
        }
        return real(documentId)
      }
      return { release: held.release, entered: held.entered }
    }

    /** the first metadata read of the documents client from now on waits for `release()` */
    function holdGetDocument(h: Harness) {
      const held = gate()
      const real = h.docs.getDocument.bind(h.docs)
      let armed = true
      h.docs.getDocument = async (documentId) => {
        const detail = await real(documentId)
        if (armed) {
          armed = false
          held.reached()
          await held.open
        }
        return detail
      }
      return { release: held.release, entered: held.entered }
    }

    /** like holdVerify, but counting only from `arm()` on */
    function holdVerifyAfter(h: Harness, nth: number) {
      const held = gate()
      const real = h.layer.verifyKey.bind(h.layer)
      let calls = -1
      h.layer.verifyKey = async (scope) => {
        if (calls >= 0) {
          calls += 1
          if (calls === nth) {
            held.reached()
            await held.open
          }
        }
        return real(scope)
      }
      return { arm: () => (calls = 0), release: held.release, entered: held.entered }
    }

    async function libraryRecords(h: Harness, scope: StoreScope) {
      const opened = await h.layer.open(scope)
      if (opened.kind !== 'ok') throw new Error(`did not open: ${opened.kind}`)
      return opened.store.records(OFFLINE_LIBRARY_STORE_REGISTRATION.name)
    }

    const filesOf = (h: Harness, scope: StoreScope) =>
      h.fs.listFiles(`${ROOT}/${scope.deploymentId}/${scope.accountId}`)

    /** sign-out while the outgoing scope is still the active one (the sign-out hook awaits the wipe) */
    async function lockAndWipeOutgoing(h: Harness) {
      h.manager.lockBoundary()
      await h.layer.lockAndWipe(SCOPE)
    }

    function switchTo(h: Harness, scope: StoreScope, session: string) {
      h.session.scope = scope
      h.session.id = session
    }

    it('FUSR-R1-2: a write that finished before the boundary announces nothing after it', async () => {
      const { h, changes } = await pinnedHarness()
      const held = gate()
      const real = h.store.putPin.bind(h.store)
      h.store.putPin = async (record) => {
        const result = await real(record)
        held.reached()
        await held.open
        return result
      }
      const archiving = h.manager.handleArchived('doc_1')
      await held.entered
      h.manager.lockBoundary()
      held.release()
      expect(await archiving).toBeNull()
      expect(changes).toEqual([])
    })

    it("FUSR-R1-3: a revoke queued behind the document lock leaves the next account's copy alone", async () => {
      const h = createHarness()
      addDoc(h, 'doc_1', 1)
      // account B holds its own usable copy of the same document id
      switchTo(h, SCOPE_B, 'sess_B1')
      rowOf(await pinDoc(h))
      const bRecords = await libraryRecords(h, SCOPE_B)
      const stored = await bRecords.read(pinKey('doc_1'))
      if (stored.kind !== 'ok') throw new Error('B did not pin')
      const bRow = decodePinRecord(stored.value)!
      const bBlob = blobKey('doc_1', bRow.readyGeneration!, 'main')
      expect(bRow.state).toBe('ready')
      expect((await bRecords.read(bBlob)).kind).toBe('ok')
      // account A pins it too; an archive of A holds A's document lock (lease projection)
      switchTo(h, SCOPE, 'sess_A1')
      rowOf(await pinDoc(h))
      const hold = holdLeaseView(h)
      const archiving = h.manager.handleArchived('doc_1')
      await hold.entered
      // A's revoke queues behind that lock
      const revoking = h.manager.handleLeaseRevoked(revokeNotice)
      await flush()
      await signOut(h)
      switchTo(h, SCOPE_B, 'sess_B2')
      hold.release()
      await archiving
      expect(await revoking).toBeNull()
      expect((await bRecords.read(bBlob)).kind).toBe('ok')
      const after = await bRecords.read(pinKey('doc_1'))
      expect(after.kind === 'ok' && decodePinRecord(after.value)?.state).toBe('ready')
    })

    it("FUSR-R1-3: a multi-key deletion that crosses a boundary between two keys never deletes in the next account's scope", async () => {
      const h = createHarness()
      const readyKey = blobKey('doc_1', '0000000a', 'main')
      const stagingKey = blobKey('doc_1', '0000000b', 'main')
      const seed = seedRow('doc_1', 4096)
      // account A holds a committed copy and a staging generation: two keys to delete
      expect(
        (
          await h.store.putPin({
            ...seed,
            state: 'ready',
            readyManifest: seed.manifest,
            readyGeneration: '0000000a',
            readyVersion: 1,
            bytes: 4096,
            staging: { generation: '0000000b', keys: [stagingKey] },
          })
        ).kind,
      ).toBe('ok')
      expect((await h.store.writeIndex({ pins: ['doc_1'], cleanup: {} })).kind).toBe('ok')
      expect((await h.store.putBlob(readyKey, plaintext('a-ready'))).kind).toBe('ok')
      expect((await h.store.putBlob(stagingKey, plaintext('a-staging'))).kind).toBe('ok')
      // account B owns a record at the key the revoke would reach second
      const bRecords = await libraryRecords(h, SCOPE_B)
      expect((await bRecords.write(stagingKey, plaintext('b-staging'))).kind).toBe('ok')
      // getPin, then the first delete is held
      const hold = holdVerify(h, 2)
      const revoking = h.manager.handleLeaseRevoked(revokeNotice)
      await hold.entered
      await signOut(h)
      switchTo(h, SCOPE_B, 'sess_B')
      hold.release()
      expect(await revoking).toBeNull()
      expect((await bRecords.read(stagingKey)).kind).toBe('ok')
    })

    it('FUSR-R1-4: an archive whose lease projection spans the sign-out returns nothing', async () => {
      const { h } = await pinnedHarness()
      const hold = holdLeaseView(h)
      const archiving = h.manager.handleArchived('doc_1')
      await hold.entered
      await signOut(h)
      hold.release()
      expect(await archiving).toBeNull()
      expect(h.storeFiles()).toEqual([])
    })

    it('FUSR-R1-5: a revoke whose lease projection spans the sign-out returns nothing', async () => {
      const { h } = await pinnedHarness()
      const hold = holdLeaseView(h)
      const revoking = h.manager.handleLeaseRevoked(revokeNotice)
      await hold.entered
      await signOut(h)
      hold.release()
      expect(await revoking).toBeNull()
      expect(h.storeFiles()).toEqual([])
    })

    it('FUSR-R1-6: a refresh whose metadata read spans the sign-out writes no row', async () => {
      const { h, changes } = await pinnedHarness()
      const hold = holdGetDocument(h)
      const refreshing = h.manager.refresh('doc_1')
      await hold.entered
      await lockAndWipeOutgoing(h)
      expect(h.storeFiles()).toEqual([])
      hold.release()
      expect(await refreshing).toEqual({ kind: 'refused', code: 'interrupted' })
      expect(h.storeFiles()).toEqual([])
      expect(changes).toEqual([])
    })

    it('FUSR-R1-6: a refresh whose metadata read spans an account switch persists nothing under the new account', async () => {
      const { h, changes } = await pinnedHarness()
      const hold = holdGetDocument(h)
      const refreshing = h.manager.refresh('doc_1')
      await hold.entered
      await lockAndWipeOutgoing(h)
      switchTo(h, SCOPE_B, 'sess_B')
      h.manager.markOpen('doc_other')
      hold.release()
      expect(await refreshing).toEqual({ kind: 'refused', code: 'interrupted' })
      expect(filesOf(h, SCOPE_B)).toEqual([])
      expect(filesOf(h, SCOPE)).toEqual([])
      expect(changes).toEqual([])
    })

    it('FUSR-R1-7: a refresh whose metadata read fails with a revoke across the sign-out recreates no row', async () => {
      const { h, changes } = await pinnedHarness()
      const held = gate()
      h.docs.getDocument = async () => {
        held.reached()
        await held.open
        throw new UniworkDocError('forbidden')
      }
      const refreshing = h.manager.refresh('doc_1')
      await held.entered
      await lockAndWipeOutgoing(h)
      held.release()
      expect(await refreshing).toEqual({ kind: 'refused', code: 'interrupted' })
      expect(h.storeFiles()).toEqual([])
      expect(changes).toEqual([])
    })

    it('FUSR-R1-6: an eviction whose copy deletion spans the sign-out writes no row', async () => {
      const { h, changes } = await pinnedHarness()
      // getPin, then the copy's delete is held
      const hold = holdVerify(h, 2)
      const evicting = h.manager.evict('doc_1')
      await hold.entered
      await lockAndWipeOutgoing(h)
      hold.release()
      expect(await evicting).toEqual({ kind: 'refused', code: 'interrupted' })
      expect(h.storeFiles()).toEqual([])
      expect(changes).toEqual([])
    })

    it('FUSR-R1-6: recovery whose staging deletion spans the sign-out writes no row', async () => {
      const changes: string[] = []
      const h = createHarness({ onChange: (documentId) => changes.push(documentId) })
      const stagingKey = blobKey('doc_1', '0000000a', 'main')
      expect(
        (
          await h.store.putPin({
            ...seedRow('doc_1', 4096),
            state: 'downloading',
            staging: { generation: '0000000a', keys: [stagingKey] },
          })
        ).kind,
      ).toBe('ok')
      expect((await h.store.writeIndex({ pins: ['doc_1'], cleanup: {} })).kind).toBe('ok')
      expect((await h.store.putBlob(stagingKey, plaintext('staged'))).kind).toBe('ok')
      // the index read, getPin, then the staging delete is held
      const hold = holdVerify(h, 3)
      const recovering = h.manager.recover()
      await hold.entered
      await lockAndWipeOutgoing(h)
      hold.release()
      await recovering
      expect(h.storeFiles()).toEqual([])
      expect(changes).toEqual([])
    })

    it('FUSR-R1-6/7: a failed download that settles into a revoke across the sign-out recreates no row', async () => {
      const changes: string[] = []
      const h = createHarness({ onChange: (documentId) => changes.push(documentId) })
      addDoc(h, 'doc_1', 1)
      // from the stream failure on: the settle's getPin, its staging delete, the purge's delete (held)
      const hold = holdVerifyAfter(h, 3)
      h.docs.downloadStream = async () => {
        hold.arm()
        throw new UniworkDocError('permission_revoked')
      }
      const pinning = pinDoc(h)
      await hold.entered
      await lockAndWipeOutgoing(h)
      changes.length = 0
      hold.release()
      await pinning
      expect(h.storeFiles()).toEqual([])
      expect(changes).toEqual([])
    })

    it('FUSR-R1-6: a deferred cleanup whose blob deletion spans an account switch copies no index into the new account', async () => {
      const h = createHarness()
      addDoc(h, 'doc_1', 1)
      addDoc(h, 'doc_2', 1)
      rowOf(await pinDoc(h, 'doc_1'))
      rowOf(await pinDoc(h, 'doc_2'))
      h.manager.markOpen('doc_1')
      expect(await h.manager.unpin('doc_1')).toEqual({ kind: 'unpinned', deferred: true })
      // the index read, then the first deferred blob delete is held
      const hold = holdVerify(h, 2)
      const closing = h.manager.markClosed('doc_1')
      await hold.entered
      h.manager.lockBoundary()
      switchTo(h, SCOPE_B, 'sess_B')
      await h.layer.lockAndWipe(SCOPE)
      hold.release()
      await closing
      expect(filesOf(h, SCOPE_B)).toEqual([])
      expect(await h.manager.pinnedIds()).toEqual(new Set())
    })

    describe('FUSR-R1-8: the held revoke is refused with a usable session already active', () => {
      for (const [label, scope, session] of [
        ['a new session of the same account', SCOPE, 'sess_2'],
        ['another account', SCOPE_B, 'sess_B'],
      ] as const) {
        it(`${label}: no row recreated in either scope, no notice`, async () => {
          const { h, changes } = await pinnedHarness()
          // getPin, then the copy's delete is held
          const hold = holdVerify(h, 2)
          const revoking = h.manager.handleLeaseRevoked(revokeNotice)
          await hold.entered
          await signOut(h)
          switchTo(h, scope, session)
          h.manager.markOpen('doc_other')
          hold.release()
          expect(await revoking).toBeNull()
          expect(changes).toEqual([])
          expect(filesOf(h, SCOPE)).toEqual([])
          expect(filesOf(h, SCOPE_B)).toEqual([])
          expect(await h.manager.row('doc_1')).toBeNull()
          // the new session is usable
          expect(rowOf(await pinDoc(h)).state).toBe('ready')
        })
      }
    })

    describe('FUSR-R1-9: after a boundary a fresh archive and revoke on the same manager persist', () => {
      for (const [label, scope] of [
        ['the same account', SCOPE],
        ['another account', SCOPE_B],
      ] as const) {
        it(label, async () => {
          const { h } = await pinnedHarness()
          await signOut(h)
          switchTo(h, scope, 'sess_2')
          rowOf(await pinDoc(h))
          expect(await h.manager.handleArchived('doc_1')).toMatchObject({ archived: true })
          const archived = await h.store.getPin('doc_1')
          expect(archived.kind === 'ok' && archived.record.archived).toBe(true)
          expect(await h.manager.handleLeaseRevoked(revokeNotice)).toMatchObject({
            state: 'revoked',
          })
          const revoked = await h.store.getPin('doc_1')
          expect(revoked.kind === 'ok' && revoked.record.state).toBe('revoked')
        })
      }
    })

    describe('FUSR-R4: a row the index does not list is never a pin - a fresh pin discards it and pins anew', () => {
      const interrupted = { kind: 'refused', code: 'interrupted' }

      /**
       * The first pin's reservation row is written, then a boundary that wipes
       * nothing (the sign-out hook was aborted) passes before the index entry:
       * the old pin is refused and the row is left behind, unlisted.
       */
      async function abortReservation(h: Harness, others: string[]) {
        const held = gate()
        const real = h.store.putPin.bind(h.store)
        let armed = true
        h.store.putPin = async (record) => {
          const result = await real(record)
          if (armed) {
            armed = false
            held.reached()
            await held.open
          }
          return result
        }
        const pinning = pinDoc(h)
        await held.entered
        h.manager.lockBoundary()
        held.release()
        expect(await pinning).toEqual(interrupted)
        h.store.putPin = real
        const orphan = await h.store.getPin('doc_1')
        expect(orphan.kind).toBe('ok')
        const index = await h.store.readIndex()
        expect(index.kind === 'ok' && index.index.pins).toEqual(others)
      }

      /**
       * An unpin whose index write completed is cut by a boundary that wipes
       * nothing: the document is no longer listed, its row (with its copy and
       * staging) is still there, and with `open` the copy's keys are on the
       * deferred cleanup list.
       */
      async function abortUnpin(h: Harness, options: { open?: boolean } = {}) {
        if (options.open) h.manager.markOpen('doc_1')
        const held = gate()
        const real = h.store.writeIndex.bind(h.store)
        let armed = true
        h.store.writeIndex = async (index) => {
          const result = await real(index)
          if (armed) {
            armed = false
            held.reached()
            await held.open
          }
          return result
        }
        const unpinning = h.manager.unpin('doc_1')
        await held.entered
        h.manager.lockBoundary()
        held.release()
        expect(await unpinning).toEqual(interrupted)
        h.store.writeIndex = real
        const orphan = await h.store.getPin('doc_1')
        expect(orphan.kind).toBe('ok')
        const index = await h.store.readIndex()
        expect(index.kind === 'ok' && index.index.pins).not.toContain('doc_1')
      }

      const cleanupOf = async (h: Harness, documentId = 'doc_1') => {
        const index = await h.store.readIndex()
        return index.kind === 'ok' ? (index.index.cleanup[documentId] ?? []) : []
      }
      const hasFile = (h: Harness, key: string) => h.storeFiles().includes(recordFile(key))
      const blobOf = (generation: string) => blobKey('doc_1', generation, 'main')
      /** the index record, plus a row and one blob for each ready pin */
      const filesOfReadyPins = (pins: number) => 1 + 2 * pins

      it('online: the fresh pin lists the document, holds a ready openable copy, keeps the others and leaves no orphan key', async () => {
        const h = createHarness()
        addDoc(h, 'doc_2', 1)
        const doc = addDoc(h, 'doc_1', 1)
        rowOf(await pinDoc(h, 'doc_2'))
        await abortReservation(h, ['doc_2'])
        expect(rowOf(await pinDoc(h)).state).toBe('ready')
        const index = await h.store.readIndex()
        expect(index.kind === 'ok' && index.index.pins).toEqual(['doc_2', 'doc_1'])
        expect((await h.manager.list()).map((row) => row.documentId)).toEqual(['doc_2', 'doc_1'])
        const opened = await h.manager.openCached('doc_1')
        expect(opened.kind).toBe('ok')
        expect(opened.kind === 'ok' && Buffer.from(opened.bytes).equals(doc.bytes)).toBe(true)
        expect(await h.manager.quota()).toEqual({
          usedBytes: 2 * 4096,
          maxBytes: 2 * GiB,
          pins: 2,
          maxPins: 200,
        })
        expect(await h.manager.row('doc_2')).toMatchObject({ state: 'ready' })
        expect(h.storeFiles()).toHaveLength(filesOfReadyPins(2))
      })

      it('offline: the fresh pin is waiting-network and listed, the reconnect downloads it, no orphan key is left', async () => {
        const h = createHarness()
        addDoc(h, 'doc_1', 1)
        h.online.on = false
        await abortReservation(h, [])
        expect(rowOf(await pinDoc(h)).state).toBe('waiting-network')
        const index = await h.store.readIndex()
        expect(index.kind === 'ok' && index.index.pins).toEqual(['doc_1'])
        expect((await h.manager.list()).map((row) => row.documentId)).toEqual(['doc_1'])
        // the index and the one row
        expect(h.storeFiles()).toHaveLength(2)
        h.online.on = true
        const results = await h.manager.onReconnect()
        expect(results.get('doc_1')).toMatchObject({ kind: 'ok', row: { state: 'ready' } })
        expect((await h.manager.openCached('doc_1')).kind).toBe('ok')
        expect(h.storeFiles()).toHaveLength(filesOfReadyPins(1))
      })

      it('FUSR-R3-1: a copy the deferred cleanup of an interrupted unpin owns is never reported ready and then deleted by recovery', async () => {
        const h = createHarness()
        addDoc(h, 'doc_1', 1)
        addDoc(h, 'doc_2', 1)
        rowOf(await pinDoc(h, 'doc_2'))
        rowOf(await pinDoc(h))
        await abortUnpin(h, { open: true })
        const owned = await cleanupOf(h)
        expect(owned).toHaveLength(1)
        h.online.on = false
        const pinned = rowOf(await pinDoc(h))
        await h.manager.recover()
        // whatever the fresh pin reported ready must still open after recovery
        if (pinned.state === 'ready') expect((await h.manager.openCached('doc_1')).kind).toBe('ok')
        h.online.on = true
        const results = await h.manager.onReconnect()
        expect(results.get('doc_1')).toMatchObject({ kind: 'ok', row: { state: 'ready' } })
        await h.manager.recover()
        expect((await h.manager.openCached('doc_1')).kind).toBe('ok')
        expect((await h.manager.openCached('doc_2')).kind).toBe('ok')
        // the cleanup ran for the keys it owns; nothing it names is a key of the live copy
        expect(await cleanupOf(h)).toEqual([])
        expect(hasFile(h, owned[0]!)).toBe(false)
        expect(h.storeFiles()).toHaveLength(filesOfReadyPins(2))
      })

      it('FUSR-R3-4: the keys a deferred unpin still owns stay for its tab, the fresh copy does not use them', async () => {
        const h = createHarness()
        addDoc(h, 'doc_1', 1)
        rowOf(await pinDoc(h))
        await abortUnpin(h, { open: true })
        const owned = await cleanupOf(h)
        expect(owned).toHaveLength(1)
        // the tab is open again in the new session
        h.manager.markOpen('doc_1')
        expect(rowOf(await pinDoc(h)).state).toBe('ready')
        expect(hasFile(h, owned[0]!)).toBe(true)
        expect(await cleanupOf(h)).toEqual(owned)
        await h.manager.markClosed('doc_1')
        expect(hasFile(h, owned[0]!)).toBe(false)
        expect(await cleanupOf(h)).toEqual([])
        expect((await h.manager.openCached('doc_1')).kind).toBe('ok')
        expect(h.storeFiles()).toHaveLength(filesOfReadyPins(1))
      })

      it('FUSR-R3-2: the replacement of an interrupted unpin keeps the byte cap', async () => {
        const h = createHarness({ limits: { maxBytes: 8192 } })
        addDoc(h, 'doc_1', 1)
        addDoc(h, 'doc_2', 1)
        rowOf(await pinDoc(h))
        rowOf(await pinDoc(h, 'doc_2'))
        await abortUnpin(h)
        // the head grew to the whole cap
        addDoc(h, 'doc_1', 2, 8192)
        h.docs.downloads.length = 0
        expect(await pinDoc(h)).toEqual({ kind: 'refused', code: 'offline_cap_reached' })
        expect(h.docs.downloads).toEqual([])
        const quota = await h.manager.quota()
        expect(quota.usedBytes).toBeLessThanOrEqual(quota.maxBytes)
        expect(await h.manager.row('doc_1')).toBeNull()
        expect(await h.manager.row('doc_2')).toMatchObject({ state: 'ready' })
        expect((await h.manager.openCached('doc_2')).kind).toBe('ok')
        expect(h.storeFiles()).toHaveLength(filesOfReadyPins(1))
      })

      it('FUSR-R3-3: a refused index write leaves no key without an owner, and the retry pins', async () => {
        const h = createHarness()
        addDoc(h, 'doc_1', 1)
        rowOf(await pinDoc(h))
        await abortUnpin(h)
        h.online.on = false
        // the next index write hits a full disk, once
        let failed = false
        h.fs.failWrite = (path) => {
          if (failed || !path.includes(recordFileName('index'))) return false
          failed = true
          return true
        }
        expect((await pinDoc(h)).kind).toBe('refused')
        h.fs.failWrite = null
        expect(failed).toBe(true)
        const row = await h.store.getPin('doc_1')
        const blobKept = hasFile(h, blobOf('00000001'))
        // never: row missing + blob there + no cleanup entry
        expect(row.kind !== 'ok' && blobKept && (await cleanupOf(h)).length === 0).toBe(false)
        expect(rowOf(await pinDoc(h)).state).toBe('waiting-network')
        const index = await h.store.readIndex()
        expect(index.kind === 'ok' && index.index.pins).toEqual(['doc_1'])
      })

      it('FUSR-R3-4: the staging an aborted refresh left on the row is deleted by the fresh pin, not abandoned', async () => {
        const h = createHarness()
        addDoc(h, 'doc_1', 1)
        rowOf(await pinDoc(h))
        addDoc(h, 'doc_1', 2)
        // v2 downloads: its first staging blob write completes, then a no-wipe boundary passes
        const held = gate()
        const real = h.store.putBlob.bind(h.store)
        h.store.putBlob = async (key, bytes) => {
          const result = await real(key, bytes)
          held.reached()
          await held.open
          return result
        }
        const refreshing = h.manager.downloadNow('doc_1')
        await held.entered
        h.manager.lockBoundary()
        held.release()
        expect(await refreshing).toEqual(interrupted)
        h.store.putBlob = real
        expect(hasFile(h, blobOf('00000002'))).toBe(true)
        await abortUnpin(h)
        expect(rowOf(await pinDoc(h)).state).toBe('ready')
        // the old copy and the abandoned staging are both gone; only the new generation is there
        expect(hasFile(h, blobOf('00000001'))).toBe(false)
        expect(hasFile(h, blobOf('00000002'))).toBe(false)
        expect(hasFile(h, blobOf('00000003'))).toBe(true)
        await h.manager.recover()
        expect(await h.manager.unpin('doc_1')).toEqual({ kind: 'unpinned', deferred: false })
        // only the index record is left
        expect(h.storeFiles()).toHaveLength(1)
      })

      it('FUSR-R3-5: an unlisted revoked row is no pin: with the lease still revoked the pin refuses like any revoked document and leaks nothing', async () => {
        const h = createHarness()
        addDoc(h, 'doc_1', 1)
        rowOf(await pinDoc(h))
        expect(await h.manager.handleLeaseRevoked(revokeNotice)).toMatchObject({ state: 'revoked' })
        h.leases.states.set('doc_1', leaseState('revoked'))
        await abortUnpin(h)
        h.docs.downloads.length = 0
        expect(await pinDoc(h)).toEqual({ kind: 'refused', code: 'revoked' })
        expect(await h.manager.row('doc_1')).toBeNull()
        const index = await h.store.readIndex()
        expect(index.kind === 'ok' && index.index.pins).toEqual([])
        expect(h.docs.downloads).toEqual([])
        // no half-listed row, no key: only the index record is left
        expect(h.storeFiles()).toHaveLength(1)
      })

      it('FUSR-R3-6: a transfer running for the unlisted row is stopped first - one transfer at a time, the stopped one aborted, no staging left', async () => {
        const h = createHarness()
        addDoc(h, 'doc_1', 1)
        await abortReservation(h, [])
        const signals: Array<AbortSignal | undefined> = []
        let active = 0
        let peak = 0
        const real = h.docs.downloadStream.bind(h.docs)
        h.docs.downloadStream = async (documentId, version, options) => {
          signals.push(options?.signal)
          active += 1
          peak = Math.max(peak, active)
          try {
            return await real(documentId, version, options)
          } finally {
            active -= 1
          }
        }
        const hold = slowDownload(h, 'doc_1', 1)
        const downloading = h.manager.downloadNow('doc_1')
        await hold.waiting
        const pinning = pinDoc(h)
        await flush()
        hold.release()
        await downloading
        expect(rowOf(await pinning).state).toBe('ready')
        expect(peak).toBe(1)
        expect(signals[0]?.aborted).toBe(true)
        expect(h.manager.cancel('doc_1')).toBe(false)
        expect((await h.manager.openCached('doc_1')).kind).toBe('ok')
        expect(h.storeFiles()).toHaveLength(filesOfReadyPins(1))
      })

      it('FUSR-R4-1: the settled state a full disk kept in memory for the discarded row does not outlive it', async () => {
        const h = createHarness()
        addDoc(h, 'doc_1', 1)
        rowOf(await pinDoc(h))
        await abortUnpin(h)
        // a fresh refresh of the unlisted row: the full disk refuses its settled row too
        addDoc(h, 'doc_1', 2)
        h.docs.beforeChunk = () => {
          h.fs.failWrite = () => true
        }
        expect(await h.manager.downloadNow('doc_1')).toMatchObject({
          kind: 'ok',
          row: { state: 'update-kept', readyVersion: 1 },
        })
        h.fs.failWrite = null
        h.docs.beforeChunk = null
        h.online.on = false
        const pinned = rowOf(await pinDoc(h))
        expect(pinned).toMatchObject({ state: 'waiting-network', bytes: 0, readyVersion: null })
        expect(pinned.failure).toBeUndefined()
        const stored = await h.store.getPin('doc_1')
        expect(stored.kind === 'ok' && stored.record).toMatchObject({
          state: 'waiting-network',
          bytes: 0,
          readyVersion: null,
        })
        const row = await h.manager.row('doc_1')
        expect(row).toMatchObject({ state: 'waiting-network', bytes: 0, readyVersion: null })
        expect(row?.failure).toBeUndefined()
        const listed = (await h.manager.list()).find((entry) => entry.documentId === 'doc_1')
        expect(listed).toMatchObject({ state: 'waiting-network', bytes: 0, readyVersion: null })
        expect(listed?.failure).toBeUndefined()
        expect(await h.manager.openCached('doc_1')).toMatchObject({
          kind: 'refused',
          code: 'not_ready',
        })
      })

      describe('FUSR-R4-2: a document id the cleanup map inherits a property for pins like any other', () => {
        it.each(['constructor', 'toString'])('%s', async (documentId) => {
          const h = createHarness()
          addDoc(h, documentId, 1)
          h.online.on = false
          const held = gate()
          const real = h.store.putPin.bind(h.store)
          let armed = true
          h.store.putPin = async (record) => {
            const result = await real(record)
            if (armed) {
              armed = false
              held.reached()
              await held.open
            }
            return result
          }
          const pinning = pinDoc(h, documentId)
          await held.entered
          h.manager.lockBoundary()
          held.release()
          expect(await pinning).toEqual(interrupted)
          h.store.putPin = real
          expect((await h.store.getPin(documentId)).kind).toBe('ok')
          expect(rowOf(await pinDoc(h, documentId)).state).toBe('waiting-network')
          const index = await h.store.readIndex()
          expect(index.kind === 'ok' && index.index.pins).toEqual([documentId])
          h.online.on = true
          const results = await h.manager.onReconnect()
          expect(results.get(documentId)).toMatchObject({ kind: 'ok', row: { state: 'ready' } })
          expect((await h.manager.openCached(documentId)).kind).toBe('ok')
        })

        it('control: a key the document own cleanup entry names is still left to its owner', async () => {
          const h = createHarness()
          addDoc(h, 'doc_1', 1)
          rowOf(await pinDoc(h))
          await abortUnpin(h, { open: true })
          const owned = await cleanupOf(h)
          expect(owned).toHaveLength(1)
          expect(rowOf(await pinDoc(h)).state).toBe('ready')
          expect(hasFile(h, owned[0]!)).toBe(true)
          expect(await cleanupOf(h)).toEqual(owned)
        })
      })

      it('FUSR-R4-4: a discard whose first key deletion completes across the boundary deletes nothing under the new account', async () => {
        const changes: string[] = []
        const h = createHarness({ onChange: (documentId) => changes.push(documentId) })
        addDoc(h, 'doc_1', 1)
        rowOf(await pinDoc(h))
        // the refresh of v2 leaves its first staging blob (generation 2) on the row
        addDoc(h, 'doc_1', 2)
        const staged = gate()
        const realPut = h.store.putBlob.bind(h.store)
        h.store.putBlob = async (key, bytes) => {
          const result = await realPut(key, bytes)
          staged.reached()
          await staged.open
          return result
        }
        const refreshing = h.manager.downloadNow('doc_1')
        await staged.entered
        h.manager.lockBoundary()
        staged.release()
        expect(await refreshing).toEqual(interrupted)
        h.store.putBlob = realPut
        await abortUnpin(h)
        expect(hasFile(h, blobOf('00000001'))).toBe(true)
        expect(hasFile(h, blobOf('00000002'))).toBe(true)
        // account B holds a usable copy and a blob at the key of A's second deletion
        switchTo(h, SCOPE_B, 'sess_B1')
        rowOf(await pinDoc(h))
        expect((await h.store.putBlob(blobOf('00000002'), Buffer.from('b-owned'))).kind).toBe('ok')
        const snapshot = () =>
          new Map(filesOf(h, SCOPE_B).map((path) => [path, Buffer.from(h.fs.files.get(path)!)]))
        const before = snapshot()
        // index, row, main blob and the one at A's key
        expect(before.size).toBe(4)
        switchTo(h, SCOPE, 'sess_A2')
        // A's fresh pin discards the orphan: the first deletion completes, then the boundary
        const held = gate()
        const realDelete = h.store.deleteBlob.bind(h.store)
        let deletes = 0
        h.store.deleteBlob = async (key) => {
          deletes += 1
          const result = await realDelete(key)
          if (deletes === 1) {
            held.reached()
            await held.open
          }
          return result
        }
        changes.length = 0
        const pinning = pinDoc(h)
        await held.entered
        await signOut(h)
        switchTo(h, SCOPE_B, 'sess_B2')
        held.release()
        expect(await pinning).toEqual(interrupted)
        expect(deletes).toBe(1)
        expect(snapshot()).toEqual(before)
        expect(filesOf(h, SCOPE)).toEqual([])
        expect(changes).toEqual([])
      })
    })

    describe('FUSR-R2-2: a transfer that finishes across a boundary publishes no row of the old scope', () => {
      it('a download whose old-version deletion completes across the sign-out is refused', async () => {
        const { h, changes } = await pinnedHarness()
        addDoc(h, 'doc_1', 2)
        // the committed v2 replaces v1: the deletion of v1's blob completes, then waits
        const held = gate()
        const real = h.store.deleteBlob.bind(h.store)
        h.store.deleteBlob = async (key) => {
          const result = await real(key)
          held.reached()
          await held.open
          return result
        }
        const downloading = h.manager.downloadNow('doc_1')
        await held.entered
        await signOut(h)
        switchTo(h, SCOPE_B, 'sess_B')
        changes.length = 0
        held.release()
        expect(await downloading).toEqual({ kind: 'refused', code: 'interrupted' })
        expect(changes).toEqual([])
        expect(filesOf(h, SCOPE)).toEqual([])
        expect(filesOf(h, SCOPE_B)).toEqual([])
      })

      it('a download that settles into a revoke across the sign-out is refused, not downloading', async () => {
        const changes: string[] = []
        const h = createHarness({ onChange: (documentId) => changes.push(documentId) })
        addDoc(h, 'doc_1', 1)
        // from the stream failure on: the settle's getPin, its staging delete, the purge's delete (held)
        const hold = holdVerifyAfter(h, 3)
        h.docs.downloadStream = async () => {
          hold.arm()
          throw new UniworkDocError('permission_revoked')
        }
        const pinning = pinDoc(h)
        await hold.entered
        await lockAndWipeOutgoing(h)
        changes.length = 0
        hold.release()
        expect(await pinning).toEqual({ kind: 'refused', code: 'interrupted' })
        expect(h.storeFiles()).toEqual([])
        expect(changes).toEqual([])
      })

      it('FUSR-R3-7: a pin whose downloading row write completes across the sign-out is refused, not pinned', async () => {
        const changes: string[] = []
        const h = createHarness({ onChange: (documentId) => changes.push(documentId) })
        addDoc(h, 'doc_1', 1)
        // only the successful write of the downloading row is held: beginDownload's settled return
        const held = gate()
        const real = h.store.putPin.bind(h.store)
        h.store.putPin = async (record) => {
          const result = await real(record)
          if (record.state === 'downloading') {
            held.reached()
            await held.open
          }
          return result
        }
        const pinning = pinDoc(h)
        await held.entered
        await lockAndWipeOutgoing(h)
        changes.length = 0
        held.release()
        expect(await pinning).toEqual({ kind: 'refused', code: 'interrupted' })
        expect(h.docs.downloads).toEqual([])
        expect(h.storeFiles()).toEqual([])
        expect(changes).toEqual([])
      })

      it('an offline pin whose lease projection spans the sign-out is refused, not waiting', async () => {
        const changes: string[] = []
        const h = createHarness({ onChange: (documentId) => changes.push(documentId) })
        h.online.on = false
        const hold = holdLeaseView(h)
        const pinning = pinDoc(h)
        await hold.entered
        await lockAndWipeOutgoing(h)
        changes.length = 0
        hold.release()
        expect(await pinning).toEqual({ kind: 'refused', code: 'interrupted' })
        expect(h.storeFiles()).toEqual([])
        expect(changes).toEqual([])
      })
    })

    describe('FUSR-R2-3..6: the boundary guards each have their own permanent pin', () => {
      const interrupted = { kind: 'refused', code: 'interrupted' }

      /** every file of the scope with its exact (encrypted) bytes */
      const snapshotOf = (h: Harness, scope: StoreScope) =>
        new Map(filesOf(h, scope).map((path) => [path, Buffer.from(h.fs.files.get(path)!)]))

      /** account B holds its own usable copy of doc_1; account A (the active one) pins it too */
      async function populatedB(h: Harness) {
        switchTo(h, SCOPE_B, 'sess_B1')
        rowOf(await pinDoc(h))
        switchTo(h, SCOPE, 'sess_A1')
        rowOf(await pinDoc(h))
        const before = snapshotOf(h, SCOPE_B)
        // index, row and the main blob
        expect(before.size).toBe(3)
        return before
      }

      it('FUSR-R2-3: an eviction queued behind the document lock across a switch to a populated B leaves B alone', async () => {
        const h = createHarness()
        addDoc(h, 'doc_1', 1)
        const before = await populatedB(h)
        // an archive of A holds A's document lock (lease projection); A's eviction queues behind it
        const hold = holdLeaseView(h)
        const archiving = h.manager.handleArchived('doc_1')
        await hold.entered
        const evicting = h.manager.evict('doc_1')
        await flush()
        await signOut(h)
        switchTo(h, SCOPE_B, 'sess_B2')
        hold.release()
        await archiving
        expect(await evicting).toEqual(interrupted)
        expect(snapshotOf(h, SCOPE_B)).toEqual(before)
      })

      it("FUSR-R2-4: a refresh that purges after a revoke answer holds the boundary inside purgeRecord's deletions", async () => {
        const changes: string[] = []
        const h = createHarness({ onChange: (documentId) => changes.push(documentId) })
        addDoc(h, 'doc_1', 1)
        const before = await populatedB(h)
        h.docs.getDocument = async () => {
          throw new UniworkDocError('forbidden')
        }
        changes.length = 0
        // getPin, then the purge's copy deletion (inside refresh -> purgeRecord -> wipeKeys) is held
        const hold = holdVerify(h, 2)
        const refreshing = h.manager.refresh('doc_1')
        await hold.entered
        await signOut(h)
        switchTo(h, SCOPE_B, 'sess_B2')
        hold.release()
        expect(await refreshing).toEqual(interrupted)
        expect(changes).toEqual([])
        expect(filesOf(h, SCOPE)).toEqual([])
        expect(snapshotOf(h, SCOPE_B)).toEqual(before)
      })

      it('FUSR-R2-5: cached bytes read before a sign-out that finishes during the verification write are not returned', async () => {
        const { h } = await pinnedHarness()
        const held = gate()
        const real = h.store.putPin.bind(h.store)
        h.store.putPin = async (record) => {
          const result = await real(record)
          held.reached()
          await held.open
          return result
        }
        const opening = h.manager.openCached('doc_1')
        await held.entered
        await signOut(h)
        held.release()
        expect(await opening).toEqual(interrupted)
        expect(h.storeFiles()).toEqual([])
      })

      it('FUSR-R2-6: a session change alone (no other manager call) interrupts a held refresh', async () => {
        const { h, changes } = await pinnedHarness()
        const hold = holdGetDocument(h)
        const refreshing = h.manager.refresh('doc_1')
        await hold.entered
        const before = snapshotOf(h, SCOPE)
        // the same account signs in again: only the session id moved, nothing else is called
        h.session.id = 'sess_2'
        hold.release()
        expect(await refreshing).toEqual(interrupted)
        expect(snapshotOf(h, SCOPE)).toEqual(before)
        expect(changes).toEqual([])
      })
    })
  })
})
