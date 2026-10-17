import { describe, expect, it } from 'vitest'
import {
  OFFLINE_LIBRARY_MAX_PINS,
  OFFLINE_LIBRARY_QUOTA_BYTES,
  blobKey,
  type LibraryRefusal,
  type PinProgress,
  type PinRow,
} from '../src/main/uniwork-sync/offline-library'
import {
  offlineFailureOf,
  offlineLockReasonOf,
  offlineRowView,
  offlineSnapshot,
} from '../src/main/uniwork-sync/offline-library/view'
import { recordFileName } from '../src/main/uniwork-sync/store'
import { OFFLINE_ROW_STATES, type OfflineRowState } from '../src/shared/offline-library'
import {
  ORG,
  WS,
  addDoc,
  createHarness,
  leaseState,
  type Harness,
} from './uniwork-sync-offline-library-fakes'

/**
 * G5-05u B1/B2: the engine's rows projected onto the renderer's contract - the
 * S3 row fields, the visible rule and the refusal -> S11 reason mapping. The
 * engine's own states are the truth; this checks the projection only.
 */

const QUOTA = {
  usedBytes: 0,
  maxBytes: OFFLINE_LIBRARY_QUOTA_BYTES,
  pins: 0,
  maxPins: OFFLINE_LIBRARY_MAX_PINS,
}

/** a row as the engine's `view()` builds it, for the pure projection cases */
function rowOf(over: Partial<PinRow> = {}): PinRow {
  return {
    documentId: 'doc_1',
    orgId: ORG,
    workspaceId: WS,
    state: 'ready',
    baseState: 'ready',
    progress: null,
    bytes: 4096,
    pinnedAt: 1,
    lastVerifiedAt: 2,
    readyVersion: 1,
    updateAvailable: false,
    updateKept: false,
    archived: false,
    open: false,
    filename: 'doc_1.docx',
    sizeBytes: 4096,
    headVersion: 1,
    leaseUntil: null,
    leaseLevel: 'edit',
    updateKeptReason: null,
    lockReason: null,
    ...over,
  }
}

const pinDoc = (h: Harness, documentId = 'doc_1') =>
  h.manager.pin({ documentId, orgId: ORG, workspaceId: WS })

const engineRow = async (h: Harness, documentId = 'doc_1'): Promise<PinRow> => {
  const row = await h.manager.row(documentId)
  if (!row) throw new Error(`${documentId} is not pinned`)
  return row
}

/** a gate the fake download waits on before chunk `at`, so a mid-download state is exact */
function slowDownload(h: Harness, documentId: string, at: number) {
  const gate = Promise.withResolvers<void>()
  const reached = Promise.withResolvers<void>()
  h.docs.beforeChunk = async (id, index) => {
    if (id !== documentId || index !== at) return
    reached.resolve()
    await gate.promise
  }
  return { release: () => gate.resolve(), waiting: reached.promise }
}

describe('G5-05u B2 the S3 row projection', () => {
  it('carries every state of the engine through unchanged (the engine ranks, the view never re-ranks)', () => {
    const seen: OfflineRowState[] = []
    for (const state of OFFLINE_ROW_STATES) seen.push(offlineRowView(rowOf({ state }), true).state)
    expect(seen).toEqual([...OFFLINE_ROW_STATES])
  })

  it('names a row by its manifest file, falling back to the document id', () => {
    expect(offlineRowView(rowOf(), true).name).toBe('doc_1.docx')
    expect(offlineRowView(rowOf({ filename: null }), true).name).toBe('doc_1')
  })

  it('maps progress, size, versions, lease and the kept-update reason', () => {
    const view = offlineRowView(
      rowOf({
        state: 'downloading',
        progress: { receivedBytes: 512, totalBytes: 4096 },
        headVersion: 3,
        readyVersion: 2,
        leaseUntil: '2026-10-18T08:00:00.000Z',
        leaseLevel: 'view',
        updateKept: true,
        updateKeptReason: 'too_large',
        diskNeededBytes: 4096,
      }),
      true,
    )
    expect(view).toMatchObject({
      progress: { done: 512, total: 4096 },
      sizeBytes: 4096,
      headVersion: 3,
      version: 2,
      leaseUntil: '2026-10-18T08:00:00.000Z',
      leaseLevel: 'view',
      updateKeptReason: 'too_large',
      diskNeededBytes: 4096,
      open: false,
    })
  })

  it('a lease_expired row names its reason, and libraryOff once the org capability is off', () => {
    const expired = rowOf({ state: 'lease-expired', lockReason: 'lease_expired' })
    expect(offlineRowView(expired, true).lockReason).toBe('lease_expired')
    expect(offlineRowView(expired, true).libraryOff).toBeUndefined()
    expect(offlineRowView(expired, false)).toMatchObject({
      lockReason: 'lease_expired',
      libraryOff: true,
    })
  })

  it('a ready row carries no lock at all', () => {
    expect(offlineRowView(rowOf(), false).lockReason).toBeUndefined()
  })
})

describe('G5-05u B2 the engine rows behind the view (real library)', () => {
  it('a ready pin projects the file name, the committed bytes, the version and the lease level', async () => {
    const h = createHarness()
    const doc = addDoc(h, 'doc_1', 2)
    h.leases.states.set('doc_1', leaseState('valid', 'edit'))
    const pinned = await pinDoc(h)
    expect(pinned.kind).toBe('pinned')
    expect(offlineRowView(await engineRow(h), true)).toMatchObject({
      documentId: 'doc_1',
      workspaceId: WS,
      name: 'doc_1.docx',
      state: 'ready',
      version: 2,
      headVersion: 2,
      sizeBytes: doc.bytes.byteLength,
      leaseLevel: 'edit',
      leaseUntil: null,
      open: false,
    })
  })

  it('a view lease is view-only, and an expired one names lease_expired', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1)
    await pinDoc(h)
    h.leases.states.set('doc_1', leaseState('valid', 'view'))
    expect(offlineRowView(await engineRow(h), true)).toMatchObject({
      state: 'view-only',
      leaseLevel: 'view',
    })
    h.leases.states.set('doc_1', leaseState('expired', 'view'))
    expect(offlineRowView(await engineRow(h), true)).toMatchObject({
      state: 'lease-expired',
      lockReason: 'lease_expired',
    })
  })

  it('a boundary lock names signed_out, a locked keychain keystore_locked', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1)
    await pinDoc(h)
    h.leases.states.set('doc_1', {
      state: 'locked',
      kind: 'locked',
      level: 'edit',
      usable: false,
      locked: true,
      reason: 'signed_out',
    })
    expect(offlineRowView(await engineRow(h), true)).toMatchObject({
      state: 'locked',
      lockReason: 'signed_out',
    })
    h.leases.states.set('doc_1', {
      state: 'keystore_locked',
      kind: 'keystore_locked',
      level: 'edit',
      usable: false,
      locked: true,
    })
    expect(offlineRowView(await engineRow(h), true)).toMatchObject({
      state: 'locked',
      lockReason: 'keystore_locked',
    })
  })

  it('a first download that hit a full disk needs bytes; a kept update says why it was kept', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1, 4096)
    const firstStaging = recordFileName(blobKey('doc_1', '00000001', 'main'))
    h.fs.failWrite = (path) => path.includes(firstStaging)
    expect((await pinDoc(h)).kind).toBe('pinned')
    const failed = await engineRow(h)
    expect(failed).toMatchObject({ state: 'disk-full', updateKeptReason: null })
    expect(failed.diskNeededBytes).toBe(4096)
    // the retry ("Thử lại") downloads again into the same staging generation key
    h.fs.failWrite = null
    expect(await h.manager.downloadNow('doc_1')).toMatchObject({
      kind: 'ok',
      row: { state: 'ready', readyVersion: 1 },
    })
    addDoc(h, 'doc_1', 2, 8192)
    expect(await h.manager.refresh('doc_1')).toMatchObject({ row: { state: 'update-available' } })
    // the next staged snapshot (whatever generation it gets) hits the full disk
    h.fs.failWrite = (path) => path.includes(recordFileName(blobKey('doc_1', '00000003', 'main')))
    const kept = await h.manager.downloadNow('doc_1')
    expect(kept).toMatchObject({ kind: 'ok', row: { state: 'update-kept', readyVersion: 1 } })
    const keptView = offlineRowView(await engineRow(h), true)
    expect(keptView).toMatchObject({ state: 'update-kept', updateKeptReason: 'store_full' })
    expect(keptView.diskNeededBytes).toBe(4096)
  })

  it('a progress row carries done/total while the download runs', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1, 4096)
    h.docs.chunkSize = 1024
    const slow = slowDownload(h, 'doc_1', 2)
    const pinned = pinDoc(h)
    await slow.waiting
    const view = offlineRowView(await engineRow(h), true)
    expect(view.state).toBe('downloading')
    expect(view.progress).toEqual<PinProgress>({ done: 2048, total: 4096 })
    slow.release()
    expect((await pinned).kind).toBe('pinned')
    expect(await h.manager.row('doc_1')).toMatchObject({ state: 'ready' })
  })

  it('an open copy reads open, and a revoked row keeps its own state', async () => {
    const h = createHarness()
    addDoc(h, 'doc_1', 1)
    await pinDoc(h)
    h.manager.markOpen('doc_1')
    expect(offlineRowView(await engineRow(h), true).open).toBe(true)
    await h.manager.markClosed('doc_1')
    expect(offlineRowView(await engineRow(h), true).open).toBe(false)
    await h.manager.handlePermissionRevoked('doc_1')
    const revoked = offlineRowView(await engineRow(h), true)
    expect(revoked).toMatchObject({ state: 'revoked' })
    expect(revoked.lockReason).toBeUndefined()
  })
})

describe('G5-05u B1 the offline block of the snapshot', () => {
  it('visible when the capability is on, even with no rows', () => {
    const block = offlineSnapshot({ capabilityOn: true, signedOut: false, quota: QUOTA, rows: [] })
    expect(block).toEqual({ visible: true, capabilityOn: true, quota: QUOTA, rows: [] })
  })

  it('hidden when the capability is off and nothing is kept', () => {
    expect(
      offlineSnapshot({ capabilityOn: false, signedOut: false, quota: QUOTA, rows: [] }).visible,
    ).toBe(false)
  })

  it('capability off keeps the rows (OQ-UX11 a: a downloaded copy stays until sign-out)', () => {
    const block = offlineSnapshot({
      capabilityOn: false,
      signedOut: false,
      quota: QUOTA,
      rows: [rowOf()],
    })
    expect(block).toMatchObject({ visible: true, capabilityOn: false })
    expect(block.rows).toHaveLength(1)
  })

  it('signed out exposes a count only, never a name', () => {
    const block = offlineSnapshot({
      capabilityOn: false,
      signedOut: true,
      signedOutLockedCount: 3,
      quota: QUOTA,
      rows: [rowOf()],
    })
    expect(block).toEqual({
      visible: true,
      capabilityOn: false,
      signedOutLockedCount: 3,
      quota: QUOTA,
      rows: [],
    })
    expect(JSON.stringify(block)).not.toContain('doc_1.docx')
  })

  it('signed out with nothing kept stays hidden', () => {
    expect(
      offlineSnapshot({ capabilityOn: false, signedOut: true, quota: QUOTA, rows: [] }).visible,
    ).toBe(false)
  })
})

describe('G5-05u B5 refusal -> S11 reason', () => {
  const refusal = (over: Partial<LibraryRefusal>): LibraryRefusal =>
    ({ kind: 'refused', code: 'invalid', ...over }) as LibraryRefusal

  it('a lease refusal names its lease state; none and expired name lease_expired', () => {
    for (const [lease, expected] of [
      ['expired', 'lease_expired'],
      ['none', 'lease_expired'],
      ['clock_rollback', 'clock_rollback'],
      ['keystore_locked', 'keystore_locked'],
      ['keyring_unavailable', 'keystore_locked'],
      ['locked', 'keystore_locked'],
    ] as const) {
      expect(
        offlineLockReasonOf(refusal({ code: 'lease_unusable', lease }), { capabilityOn: true }),
      ).toEqual({ lockReason: expected })
    }
  })

  it('the row own lock names the boundary reason exactly (signed_out)', () => {
    expect(
      offlineLockReasonOf(refusal({ code: 'lease_unusable', lease: 'locked' }), {
        capabilityOn: true,
        leaseLock: 'signed_out',
      }),
    ).toEqual({ lockReason: 'signed_out' })
  })

  it('libraryOff marks a lease_expired lock while the capability is off', () => {
    expect(
      offlineLockReasonOf(refusal({ code: 'lease_unusable', lease: 'expired' }), {
        capabilityOn: false,
      }),
    ).toEqual({ lockReason: 'lease_expired', libraryOff: true })
  })

  it('revoked, deleted, no_session and a locked store name their S11 reason', () => {
    expect(offlineLockReasonOf(refusal({ code: 'revoked' }), { capabilityOn: true })).toEqual({
      lockReason: 'permission_revoked',
    })
    expect(offlineLockReasonOf(refusal({ code: 'deleted' }), { capabilityOn: true })).toEqual({
      lockReason: 'document_deleted',
    })
    expect(offlineLockReasonOf(refusal({ code: 'no_session' }), { capabilityOn: true })).toEqual({
      lockReason: 'signed_out',
    })
    expect(
      offlineLockReasonOf(refusal({ code: 'keystore_locked' }), { capabilityOn: true }),
    ).toEqual({ lockReason: 'keystore_locked' })
  })

  it('a capacity refusal is not a lock, and carries the byte cap and the pin cap', () => {
    expect(
      offlineFailureOf(refusal({ code: 'offline_cap_reached' }), {
        capabilityOn: true,
        cap: 2 * 1024 * 1024 * 1024,
        maxDocs: 200,
      }),
    ).toEqual({
      ok: false,
      code: 'offline_cap_reached',
      cap: 2 * 1024 * 1024 * 1024,
      maxDocs: 200,
    })
  })

  it('a corrupt copy, a not-ready row and a not-pinned row are refusals without a panel', () => {
    for (const code of ['corrupt', 'not_ready', 'not_pinned'] as const) {
      const failure = offlineFailureOf(refusal({ code }), { capabilityOn: true })
      expect(failure).toMatchObject({ ok: false, code })
      expect(failure.lockReason).toBeUndefined()
    }
  })

  it('every engine refusal code has a renderer code', () => {
    for (const code of [
      'offline_cap_reached',
      'too_large',
      'capability_off',
      'not_a_file',
      'not_pinned',
      'not_ready',
      'corrupt',
      'lease_unusable',
      'revoked',
      'deleted',
      'offline',
      'invalid',
      'store_full',
      'no_session',
      'keystore_locked',
      'keyring_unavailable',
      'interrupted',
    ] as const) {
      expect(offlineFailureOf(refusal({ code }), { capabilityOn: true }).code).toBe(code)
    }
  })
})

describe('G5-05u B3 the engine reports every row change', () => {
  it('a pin and its progress each call onChange with the document id', async () => {
    const seen: string[] = []
    const h = createHarness({ onChange: (documentId) => seen.push(documentId) })
    addDoc(h, 'doc_1', 1, 2048)
    h.docs.chunkSize = 1024
    await pinDoc(h)
    expect(seen.length).toBeGreaterThanOrEqual(3)
    expect(new Set(seen)).toEqual(new Set(['doc_1']))
  })
})
