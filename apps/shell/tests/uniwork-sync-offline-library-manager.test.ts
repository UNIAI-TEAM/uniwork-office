import { describe, expect, it } from 'vitest'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { INTENT_STORE_REGISTRATION } from '../src/main/uniwork-sync/intent-store'
import {
  PIN_RECORD_SCHEMA,
  blobKey,
  manifestFromDetail,
  pinKey,
  type PinRecord,
  type PinRow,
} from '../src/main/uniwork-sync/offline-library'
import { DRAFTS_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/drafts'
import { PAUSE_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/pause'
import { createStoreLayer } from '../src/main/uniwork-sync/store'
import {
  ORG,
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
    addDoc(h, 'doc_1', 1)
    rowOf(await pinDoc(h))
    expect(await h.manager.handleDeleted('doc_1')).toMatchObject({ state: 'deleted', bytes: 0 })
    expect(await h.manager.refresh('doc_1')).toEqual({ kind: 'refused', code: 'deleted' })
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
