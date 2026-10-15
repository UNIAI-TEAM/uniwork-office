import { describe, expect, it, vi } from 'vitest'
import { createUniworkDocsClient, type FetchLike } from '../src/main/uniwork-docs/client'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import {
  blobKey,
  manifestFromDetail,
  type CachedDocument,
  type FetchAssetPort,
  type PinManifest,
  type PinRow,
} from '../src/main/uniwork-sync/offline-library'
import { recordFileName } from '../src/main/uniwork-sync/store'
import {
  ORG,
  SCOPE,
  WS,
  addDoc,
  createHarness,
  filesContaining,
  plaintext,
  recordFile,
  sha,
  type Harness,
} from './uniwork-sync-offline-library-fakes'

const pinDoc = (h: Harness, documentId = 'doc_1') =>
  h.manager.pin({ documentId, orgId: ORG, workspaceId: WS })

function rowOf(result: Awaited<ReturnType<Harness['manager']['pin']>>): PinRow {
  if (result.kind !== 'pinned') throw new Error(`not pinned: ${result.code}`)
  return result.row
}

async function opened(h: Harness, documentId = 'doc_1'): Promise<CachedDocument> {
  const result = await h.manager.openCached(documentId)
  if (result.kind !== 'ok') throw new Error(`not opened: ${result.code}`)
  return result
}

const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b))

/** a pinned, ready doc_1 at version 1, then version 2 published on the server */
async function readyThenNewer(h: Harness) {
  const v1 = addDoc(h, 'doc_1', 1)
  rowOf(await pinDoc(h))
  const v2 = addDoc(h, 'doc_1', 2)
  return { v1, v2 }
}

describe('G5-05 download: network loss mid-download -> interrupted, old copy kept', () => {
  it('a first download that loses the network is interrupted with no staging left', async () => {
    const h = createHarness()
    const doc = addDoc(h, 'doc_1', 1, 8192)
    h.docs.beforeChunk = (_id, index) => {
      if (index === 3) throw new UniworkDocError('network')
    }
    const row = rowOf(await pinDoc(h))
    expect(row.state).toBe('interrupted')
    expect(row.baseState).toBe('interrupted')
    expect(await h.manager.openCached('doc_1')).toMatchObject({
      kind: 'refused',
      code: 'not_ready',
    })
    // only the row and the index are on disk: no staging blob
    expect(h.storeFiles()).toEqual([recordFile('index'), recordFile('pin/doc_1')].sort())
    expect(filesContaining(h.fs, doc.bytes)).toEqual([])
  })

  it('a re-download that loses the network keeps the old ready copy, which still opens', async () => {
    const h = createHarness()
    const { v1 } = await readyThenNewer(h)
    h.docs.beforeChunk = (_id, index) => {
      if (index === 2) throw new UniworkDocError('network')
    }
    const result = await h.manager.downloadNow('doc_1')
    expect(result).toMatchObject({ kind: 'ok', row: { state: 'interrupted', readyVersion: 1 } })
    const copy = await opened(h)
    expect(same(copy.bytes, v1.bytes)).toBe(true)
    // the old generation only: no blob of the interrupted download
    expect(h.storeFiles()).toContain(recordFile(blobKey('doc_1', '00000001', 'main')))
    expect(h.storeFiles()).not.toContain(recordFile(blobKey('doc_1', '00000002', 'main')))
  })
})

describe('G5-05 download: disk full on re-download keeps old ready', () => {
  it('store_full while staging the update -> the old copy stays ready (update-kept)', async () => {
    const h = createHarness()
    const { v1 } = await readyThenNewer(h)
    const staging = recordFileName(blobKey('doc_1', '00000002', 'main'))
    h.fs.failWrite = (path) => path.includes(staging)
    const result = await h.manager.downloadNow('doc_1')
    expect(result).toMatchObject({
      kind: 'ok',
      row: { state: 'update-kept', baseState: 'ready', readyVersion: 1, failure: 'store_full' },
    })
    h.fs.failWrite = null
    expect(same((await opened(h)).bytes, v1.bytes)).toBe(true)
    // the torn temp file of the failed write is encrypted, and scrubbed when the
    // scope is opened again (the next session / restart)
    expect(filesContaining(h.fs, h.docs.docs.get('doc_1')!.bytes)).toEqual([])
    h.store.forget()
    await h.store.readIndex()
    expect(h.storeFiles().some((path) => path.includes(staging))).toBe(false)
  })

  it('the layer budget reached by the update -> update-kept, nothing of it left', async () => {
    const h = createHarness({ budgetBytes: 4096 + 3072 })
    await readyThenNewer(h)
    const result = await h.manager.downloadNow('doc_1')
    expect(result).toMatchObject({ kind: 'ok', row: { state: 'update-kept', readyVersion: 1 } })
    expect(h.storeFiles()).not.toContain(recordFile(blobKey('doc_1', '00000002', 'main')))
  })

  it('a full disk on the first download -> disk-full, never ready', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1)
    const staging = recordFileName(blobKey('doc_1', '00000001', 'main'))
    h.fs.failWrite = (path) => path.includes(staging)
    const row = rowOf(await pinDoc(h))
    expect(row).toMatchObject({ state: 'disk-full', readyVersion: null })
    h.fs.failWrite = null
    expect(await h.manager.openCached('doc_1')).toMatchObject({
      kind: 'refused',
      code: 'not_ready',
    })
  })
})

describe('G5-05 download: corrupt cache never ready', () => {
  it('main checksum mismatch on a first download -> corrupt, never ready', async () => {
    const h = createHarness()
    const doc = addDoc(h, 'doc_1', 1)
    doc.declaredSha = sha(plaintext('something else'))
    const row = rowOf(await pinDoc(h))
    expect(row).toMatchObject({
      state: 'corrupt',
      failure: 'checksum_mismatch',
      readyVersion: null,
    })
    expect(filesContaining(h.fs, doc.bytes)).toEqual([])
    expect(h.storeFiles()).not.toContain(recordFile(blobKey('doc_1', '00000001', 'main')))
  })

  it('truncated bytes (fewer than the declared size) -> corrupt, never ready', async () => {
    const h = createHarness()
    const doc = addDoc(h, 'doc_1', 1)
    doc.declaredSize = doc.bytes.byteLength + 10
    expect(rowOf(await pinDoc(h))).toMatchObject({ state: 'corrupt', failure: 'size_mismatch' })
  })

  it('a corrupt update keeps the old ready copy (update-kept)', async () => {
    const h = createHarness()
    const { v1, v2 } = await readyThenNewer(h)
    v2.declaredSha = sha(plaintext('tampered upstream'))
    const result = await h.manager.downloadNow('doc_1')
    expect(result).toMatchObject({ kind: 'ok', row: { state: 'update-kept', readyVersion: 1 } })
    expect(same((await opened(h)).bytes, v1.bytes)).toBe(true)
  })

  it('a tampered stored blob is never served: the row turns corrupt and the bytes go', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1)
    rowOf(await pinDoc(h))
    const file = h.fs.files.get(recordFile(blobKey('doc_1', '00000001', 'main')))!
    file[file.length - 5] ^= 0x01
    expect(await h.manager.openCached('doc_1')).toEqual({ kind: 'refused', code: 'corrupt' })
    expect(await h.manager.row('doc_1')).toMatchObject({ state: 'corrupt', readyVersion: null })
    expect(h.storeFiles()).not.toContain(recordFile(blobKey('doc_1', '00000001', 'main')))
    // "Tải ngay" from corrupt downloads a fresh verified copy
    const retried = await h.manager.downloadNow('doc_1')
    expect(retried).toMatchObject({ kind: 'ok', row: { state: 'ready', readyVersion: 1 } })
  })

  it('a stored blob that verifies against the wrong bytes (swapped record) is never served', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1)
    addDoc(h, 'doc_2', 1)
    rowOf(await pinDoc(h, 'doc_1'))
    rowOf(await pinDoc(h, 'doc_2'))
    // a valid encrypted record of another document copied over this one
    h.fs.files.set(
      recordFile(blobKey('doc_1', '00000001', 'main')),
      h.fs.files.get(recordFile(blobKey('doc_2', '00000002', 'main')))!,
    )
    expect(await h.manager.openCached('doc_1')).toEqual({ kind: 'refused', code: 'corrupt' })
  })
})

describe('G5-05 download: declared assets (G5-A04)', () => {
  const ASSET = plaintext('asset-image', 2048)

  function withAsset(h: Harness, asset: { sha256: string; sizeBytes: number }) {
    return (detail: Parameters<typeof manifestFromDetail>[0]): PinManifest => ({
      ...manifestFromDetail(detail),
      assets: [{ path: 'media/image1.png', ...asset }],
    })
  }

  it('declared asset missing -> not ready', async () => {
    const fetchAsset = vi.fn<FetchAssetPort>(async () => {
      throw new UniworkDocError('not_found')
    })
    const holder: { h?: Harness } = {}
    const h = createHarness({
      fetchAsset,
      manifestOf: (detail) => withAsset(holder.h!, { sha256: sha(ASSET), sizeBytes: 2048 })(detail),
    })
    holder.h = h
    addDoc(h, 'doc_1', 1)
    const row = rowOf(await pinDoc(h))
    expect(row).toMatchObject({ state: 'corrupt', failure: 'asset_missing', readyVersion: null })
    expect(fetchAsset).toHaveBeenCalledTimes(1)
    expect(await h.manager.openCached('doc_1')).toMatchObject({
      kind: 'refused',
      code: 'not_ready',
    })
    // the verified main file was staged, then wiped with the failed snapshot
    expect(h.storeFiles()).toEqual([recordFile('index'), recordFile('pin/doc_1')].sort())
  })

  it('declared asset missing because no asset route exists (no fetchAsset port) -> not ready', async () => {
    const h = createHarness({
      manifestOf: (detail) => ({
        ...manifestFromDetail(detail),
        assets: [{ path: 'media/image1.png', sha256: sha(ASSET), sizeBytes: 2048 }],
      }),
    })
    addDoc(h, 'doc_1', 1)
    expect(rowOf(await pinDoc(h))).toMatchObject({ state: 'corrupt', failure: 'asset_missing' })
  })

  it('declared asset checksum mismatch -> not ready', async () => {
    const h = createHarness({
      fetchAsset: async () => plaintext('not-the-asset', 2048),
      manifestOf: (detail) => ({
        ...manifestFromDetail(detail),
        assets: [{ path: 'media/image1.png', sha256: sha(ASSET), sizeBytes: 2048 }],
      }),
    })
    addDoc(h, 'doc_1', 1)
    expect(rowOf(await pinDoc(h))).toMatchObject({ state: 'corrupt', failure: 'asset_mismatch' })
    expect(await h.manager.openCached('doc_1')).toMatchObject({
      kind: 'refused',
      code: 'not_ready',
    })
  })

  it('every declared asset verified -> ready, and openCached returns them read-only', async () => {
    const h = createHarness({
      fetchAsset: async ({ asset }) =>
        asset.path === 'media/image1.png' ? ASSET : new Uint8Array(),
      manifestOf: (detail) => ({
        ...manifestFromDetail(detail),
        assets: [{ path: 'media/image1.png', sha256: sha(ASSET), sizeBytes: 2048 }],
      }),
    })
    const doc = addDoc(h, 'doc_1', 1)
    expect(rowOf(await pinDoc(h))).toMatchObject({ state: 'ready', bytes: 4096 + 2048 })
    const copy = await opened(h)
    expect(copy.readOnly).toBe(true)
    expect(same(copy.bytes, doc.bytes)).toBe(true)
    expect(copy.assets.map((asset) => asset.path)).toEqual(['media/image1.png'])
    expect(same(copy.assets[0]!.bytes, ASSET)).toBe(true)
    expect(filesContaining(h.fs, ASSET)).toEqual([])
  })

  it('a stored asset tampered after commit -> the copy is not served', async () => {
    const h = createHarness({
      fetchAsset: async () => ASSET,
      manifestOf: (detail) => ({
        ...manifestFromDetail(detail),
        assets: [{ path: 'media/image1.png', sha256: sha(ASSET), sizeBytes: 2048 }],
      }),
    })
    addDoc(h, 'doc_1', 1)
    rowOf(await pinDoc(h))
    h.fs.files.delete(recordFile(blobKey('doc_1', '00000001', 0)))
    expect(await h.manager.openCached('doc_1')).toEqual({ kind: 'refused', code: 'corrupt' })
    expect(h.storeFiles()).not.toContain(recordFile(blobKey('doc_1', '00000001', 'main')))
  })
})

describe('G5-05 download: progress events and cancel', () => {
  it('reports progress up to the total, then ready only after verification', async () => {
    const h = createHarness()
    const states: string[] = []
    const putPin = h.store.putPin.bind(h.store)
    h.store.putPin = async (record) => {
      states.push(record.state)
      return putPin(record)
    }
    addDoc(h, 'doc_1', 1, 4096)
    const progress: number[] = []
    h.docs.beforeChunk = async () => {
      const row = await h.manager.row('doc_1')
      if (row?.progress) progress.push(row.progress.receivedBytes)
    }
    const row = rowOf(await pinDoc(h))
    expect(row.state).toBe('ready')
    expect(progress).toEqual([0, 1024, 2048, 3072])
    // the stored row: pinned (waiting), downloading, verifying, then the commit
    expect(states).toEqual(['waiting-network', 'downloading', 'verifying', 'ready'])
    expect(row.progress).toBeNull()
  })

  it('cancel ("Hủy tải") -> interrupted, staging wiped, nothing ready', async () => {
    const h = createHarness()
    const doc = addDoc(h, 'doc_1', 1, 8192)
    h.docs.beforeChunk = (_id, index) => {
      if (index === 2) expect(h.manager.cancel('doc_1')).toBe(true)
    }
    const row = rowOf(await pinDoc(h))
    expect(row).toMatchObject({ state: 'interrupted', failure: 'cancelled', readyVersion: null })
    expect(h.manager.cancel('doc_1')).toBe(false)
    expect(filesContaining(h.fs, doc.bytes)).toEqual([])
    expect(h.storeFiles()).toEqual([recordFile('index'), recordFile('pin/doc_1')].sort())
    // "Thử lại" downloads it again
    h.docs.beforeChunk = null
    expect(await h.manager.downloadNow('doc_1')).toMatchObject({
      kind: 'ok',
      row: { state: 'ready' },
    })
  })

  it('cancel of a re-download keeps the old copy', async () => {
    const h = createHarness()
    const { v1 } = await readyThenNewer(h)
    h.docs.beforeChunk = (_id, index) => {
      if (index === 1) h.manager.cancel('doc_1')
    }
    expect(await h.manager.downloadNow('doc_1')).toMatchObject({
      kind: 'ok',
      row: { state: 'interrupted', readyVersion: 1 },
    })
    expect(same((await opened(h)).bytes, v1.bytes)).toBe(true)
  })
})

describe('G5-05 download: sign-out during download', () => {
  async function signOut(h: Harness) {
    h.manager.lockBoundary()
    h.session.scope = null
    await h.layer.lockAndWipe(SCOPE)
  }

  it('sign-out mid-stream -> interrupted, no partial ready, no plaintext under the store root', async () => {
    const h = createHarness()
    const doc = addDoc(h, 'doc_1', 1, 8192)
    let wiped: Promise<void> | null = null
    h.docs.beforeChunk = (_id, index) => {
      if (index === 4) wiped = signOut(h)
    }
    const row = rowOf(await pinDoc(h))
    await wiped
    expect(row.state).toBe('interrupted')
    expect(row.readyVersion).toBeNull()
    expect(h.storeFiles()).toEqual([])
    expect(filesContaining(h.fs, doc.bytes)).toEqual([])
    // the same account signs in again: nothing of the download is ready
    h.session.scope = SCOPE
    h.session.id = 'sess_2'
    expect(await h.manager.list()).toEqual([])
    expect(await h.manager.openCached('doc_1')).toMatchObject({
      kind: 'refused',
      code: 'not_pinned',
    })
  })

  it('sign-out while the verified bytes are being staged -> never committed', async () => {
    const h = createHarness()
    const doc = addDoc(h, 'doc_1', 1)
    const staging = recordFileName(blobKey('doc_1', '00000001', 'main'))
    let wiped: Promise<void> | null = null
    h.fs.failWrite = (path) => {
      if (path.includes(staging) && !wiped) wiped = signOut(h)
      return false
    }
    const row = rowOf(await pinDoc(h))
    await wiped
    expect(row.state).toBe('interrupted')
    expect(h.storeFiles()).toEqual([])
    expect(filesContaining(h.fs, doc.bytes)).toEqual([])
    h.session.scope = SCOPE
    h.session.id = 'sess_2'
    expect(await h.manager.row('doc_1')).toBeNull()
  })

  it('a pinned copy never leaves plaintext on disk', async () => {
    const h = createHarness()
    const doc = addDoc(h, 'doc_1', 1)
    rowOf(await pinDoc(h))
    expect(h.storeFiles().length).toBeGreaterThan(0)
    expect(filesContaining(h.fs, doc.bytes)).toEqual([])
  })
})

describe('uniwork-docs downloadStream (additive, same route and 256 MiB cap)', () => {
  const ORIGIN = 'https://uniwork.example'
  const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'

  function streamResponse(
    chunks: Uint8Array[],
    headers: Record<string, string> = {},
    fail?: number,
  ) {
    let index = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (fail !== undefined && index === fail) {
          controller.error(new TypeError('socket hang up'))
          return
        }
        if (index >= chunks.length) {
          controller.close()
          return
        }
        controller.enqueue(chunks[index++]!)
      },
    })
    return new Response(body, { status: 200, headers })
  }

  const client = (fetch: FetchLike) =>
    createUniworkDocsClient({
      apiOrigin: ORIGIN,
      authorized: (call) => call('tok'),
      isSignedIn: () => true,
      fetch,
    })

  async function codeOf(promise: Promise<unknown>): Promise<string> {
    try {
      await promise
    } catch (error) {
      return error instanceof UniworkDocError ? error.code : `other:${String(error)}`
    }
    return 'resolved'
  }

  it('streams the same route with progress and returns every byte', async () => {
    const chunks = [plaintext('a', 10), plaintext('b', 20), plaintext('c', 5)]
    const fetch = vi.fn<FetchLike>(async () => streamResponse(chunks, { 'Content-Length': '35' }))
    const progress: Array<[number, number | null]> = []
    const result = await client(fetch).downloadStream(DOC, 3, {
      onProgress: ({ receivedBytes, totalBytes }) => progress.push([receivedBytes, totalBytes]),
    })
    expect(fetch.mock.calls[0]![0]).toBe(`${ORIGIN}/api/v1/documents/${DOC}/download?version=3`)
    expect(result.bytes.byteLength).toBe(35)
    expect(Buffer.from(result.bytes).equals(Buffer.concat(chunks))).toBe(true)
    expect(progress).toEqual([
      [10, 35],
      [30, 35],
      [35, 35],
    ])
  })

  it('refuses a Content-Length over 256 MiB before reading the body', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      streamResponse([plaintext('x', 4)], { 'Content-Length': String(256 * 1024 * 1024 + 1) }),
    )
    expect(await codeOf(client(fetch).downloadStream(DOC, 1))).toBe('too_large')
  })

  it('refuses a body that streams past 256 MiB with no Content-Length', async () => {
    const big = new Uint8Array(64 * 1024 * 1024)
    const fetch = vi.fn<FetchLike>(async () =>
      streamResponse([big, big, big, big, new Uint8Array(1)]),
    )
    expect(await codeOf(client(fetch).downloadStream(DOC, 1))).toBe('too_large')
  })

  it('a broken body is network; a cancel mid-body is network and stops the stream', async () => {
    const broken = vi.fn<FetchLike>(async () =>
      streamResponse([plaintext('a', 4), plaintext('b', 4)], {}, 1),
    )
    expect(await codeOf(client(broken).downloadStream(DOC, 1))).toBe('network')

    const controller = new AbortController()
    const fetch = vi.fn<FetchLike>(async () =>
      streamResponse([plaintext('a', 4), plaintext('b', 4), plaintext('c', 4)]),
    )
    const seen: number[] = []
    const code = await codeOf(
      client(fetch).downloadStream(DOC, 1, {
        signal: controller.signal,
        onProgress: ({ receivedBytes }) => {
          seen.push(receivedBytes)
          if (receivedBytes === 4) controller.abort()
        },
      }),
    )
    expect(code).toBe('network')
    expect(seen).toEqual([4])
  })

  it('leaves download() unchanged', async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response(plaintext('z', 8), { status: 200 }))
    const result = await client(fetch).download(DOC, 2)
    expect(result.bytes.byteLength).toBe(8)
    expect(fetch.mock.calls[0]![0]).toBe(`${ORIGIN}/api/v1/documents/${DOC}/download?version=2`)
  })
})
