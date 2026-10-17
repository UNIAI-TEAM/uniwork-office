import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NEVER_READ_CAPABILITIES,
  type CapabilityRead,
} from '../src/main/uniwork-sync/capability/cache'
import { parseFeedPage, type FeedClient } from '../src/main/uniwork-sync/feed/client'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import {
  LeaseClientError,
  type LeaseClient,
  type OfficeOfflineLeaseSDO,
} from '../src/main/uniwork-sync/lease/client'
import { LEASE_STORE_REGISTRATION } from '../src/main/uniwork-sync/lease/store'
import {
  DOC_INDEX_REGISTRATION,
  FEED_CURSORS_REGISTRATION,
  OFFLINE_LIBRARY_STORE_REGISTRATION,
  SyncRuntime,
} from '../src/main/uniwork-sync/runtime'
import { INTENT_STORE_REGISTRATION } from '../src/main/uniwork-sync/intent-store'
import { DRAFTS_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/drafts'
import { createSyncStoreAccess } from '../src/main/uniwork-sync/session-store'
import { createStoreLayer } from '../src/main/uniwork-sync/store'
import { createLockableSafeStorage } from '../src/main/uniwork-sync/test-kit/compliance'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { cursorInvalid, FakeFeedClient } from './fixtures/fake-feed'
import { ORG, WS, addDoc, createFakeDocs, plaintext } from './uniwork-sync-offline-library-fakes'

/**
 * G5-05 through the production wiring: the runtime builds the library on its
 * own encrypted layer (not the sync layer's budget), on the same lease manager;
 * an online pass downloads the pins that waited, and a lease revoke (renew
 * lost permission) deletes the committed copy from disk.
 */

const T0 = Date.parse('2026-10-13T08:00:00Z')
const HOUR = 60 * 60 * 1000
const SCOPE = { deploymentId: 'dep_1', accountId: 'acc_1' }

function makeSdo(nowMs: number, documentId: string): OfficeOfflineLeaseSDO {
  return {
    lease: `ofl1.token-at-${nowMs}`,
    lease_id: '01J8X4LEASE1P2Q3R4S5T6U7V8',
    document_id: documentId,
    organization_id: ORG,
    workspace_id: WS,
    version_id: 'ver_1',
    version: 1,
    revision: '10',
    level: 'view',
    policy_epoch: 0,
    generation: 1,
    renewed: false,
    issued_at: new Date(nowMs).toISOString(),
    expires_at: new Date(nowMs + 24 * HOUR).toISOString(),
    renew_after: new Date(nowMs + 12 * HOUR).toISOString(),
    server_time: new Date(nowMs).toISOString(),
  }
}

let base: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'uw-sync-library-runtime-'))
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

const filesUnder = (root: string): string[] => {
  try {
    return readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
  } catch {
    return []
  }
}

interface HarnessOptions {
  feed?: FeedClient
  /** the wiring's onFeedGone (uniwork-docs/wiring.ts), handed the runtime it belongs to */
  onFeedGone?(runtime: SyncRuntime, documentId: string): void
  isOpenBound?(documentId: string): boolean
}

function harness(options: HarnessOptions = {}) {
  let wallMs = T0
  let revokeRenew = false
  const safeStorage = createLockableSafeStorage()
  const syncLayer = createStoreLayer({
    root: join(base, 'sync'),
    keys: createSafeStorageKeyProvider({ safeStorage, dir: join(base, 'keys') }),
    budgetBytes: 1 << 20,
    clock: () => wallMs,
  })
  syncLayer.register(FEED_CURSORS_REGISTRATION)
  syncLayer.register(DOC_INDEX_REGISTRATION)
  syncLayer.register(LEASE_STORE_REGISTRATION)
  syncLayer.register(INTENT_STORE_REGISTRATION)
  syncLayer.register(DRAFTS_STORE_REGISTRATION)
  const libraryLayer = createStoreLayer({
    root: join(base, 'library', 'store'),
    keys: createSafeStorageKeyProvider({ safeStorage, dir: join(base, 'library', 'keys') }),
    budgetBytes: 1 << 20,
    clock: () => wallMs,
  })
  libraryLayer.register(OFFLINE_LIBRARY_STORE_REGISTRATION)
  const store = createSyncStoreAccess({ layer: syncLayer, scope: () => ({ ...SCOPE }) })
  const leaseClient: LeaseClient = {
    async grant(documentId) {
      if (revokeRenew) {
        throw new LeaseClientError({ kind: 'revoked', code: 'offline_lease_revoked', status: 403 })
      }
      return makeSdo(wallMs, documentId)
    },
    async renew() {
      throw new LeaseClientError({ kind: 'revoked', code: 'offline_lease_revoked', status: 403 })
    },
    async release() {},
  }
  const feed: FeedClient = {
    async listChanges() {
      return {
        phase: 'snapshot',
        hasMore: false,
        expiresAt: '2026-10-14T00:00:00Z',
        changes: [],
        nextCursor: 'c1',
      }
    },
  }
  const capability: CapabilityRead = {
    kind: 'ok',
    capabilities: { ...NEVER_READ_CAPABILITIES, sync_feed: true, offline_library: true },
    source: 'fresh',
  }
  const docs = createFakeDocs()
  let docsOnline = true
  const runtime: SyncRuntime = new SyncRuntime({
    store,
    targets: { orgs: () => [ORG], workspaces: async () => [WS] },
    capability: async () => capability,
    client: () => options.feed ?? feed,
    isOpenBound: (documentId) => options.isOpenBound?.(documentId) ?? false,
    ...(options.onFeedGone
      ? { onFeedGone: (documentId: string) => options.onFeedGone?.(runtime, documentId) }
      : {}),
    keepDraft: async () => false,
    clock: { now: () => wallMs },
    schedule: () => () => undefined,
    lease: {
      client: () => leaseClient,
      session: () => 'dev_1',
      monotonicNow: () => 5_000 + (wallMs - T0),
    },
    library: {
      layer: libraryLayer,
      docs: () => (docsOnline ? docs : null),
      hasLocalWork: async () => false,
    },
  })
  return {
    runtime,
    syncLayer,
    docs,
    capability,
    libraryRoot: join(base, 'library', 'store'),
    syncRoot: join(base, 'sync'),
    setDocsOnline: (next: boolean) => {
      docsOnline = next
    },
    revokeOnRegrant: () => {
      revokeRenew = true
    },
    /** wall and monotonic clocks move together (a lease reaches its end) */
    advance: (ms: number) => {
      wallMs += ms
    },
  }
}

describe('G5-05 offline library inside the sync runtime (production wiring)', () => {
  it('builds the library on its own layer: library bytes are not in the sync store', async () => {
    const h = harness()
    const library = h.runtime.library!
    expect(library).not.toBeNull()
    const doc = addDoc(h, 'doc_1', 1, 64 * 1024)
    const pinned = await library.pin({ documentId: 'doc_1', orgId: ORG, workspaceId: WS })
    expect(pinned).toMatchObject({ kind: 'pinned', row: { state: 'view-only', readyVersion: 1 } })
    // the copy lives under the library root only, encrypted
    expect(filesUnder(h.libraryRoot).length).toBeGreaterThan(0)
    const probe = Buffer.from(doc.bytes.slice(0, 64))
    expect(filesUnder(h.libraryRoot).some((file) => readFileSync(file).includes(probe))).toBe(false)
    const syncBytes = filesUnder(h.syncRoot).reduce(
      (sum, file) => sum + readFileSync(file).length,
      0,
    )
    expect(syncBytes).toBeLessThan(64 * 1024)
    // the lease was granted through the runtime's one lease manager
    expect((await h.runtime.leases.effectiveState('doc_1')).state).toBe('valid')
    expect(await library.openCached('doc_1')).toMatchObject({ kind: 'ok', readOnly: true })
  })

  it('an online pass downloads a pin that waited for the network', async () => {
    const h = harness()
    addDoc(h, 'doc_1', 1)
    h.setDocsOnline(false)
    const pinned = await h.runtime.library!.pin({
      documentId: 'doc_1',
      orgId: ORG,
      workspaceId: WS,
    })
    expect(pinned).toMatchObject({ kind: 'pinned', row: { state: 'waiting-network' } })
    h.setDocsOnline(true)
    await h.runtime.tick()
    expect(await h.runtime.library!.row('doc_1')).toMatchObject({ readyVersion: 1 })
  })

  it('a renew that lost permission deletes the committed copy from disk, row revoked', async () => {
    const h = harness()
    addDoc(h, 'doc_1', 1)
    await h.runtime.library!.pin({ documentId: 'doc_1', orgId: ORG, workspaceId: WS })
    const before = filesUnder(h.libraryRoot).length
    h.revokeOnRegrant()
    await h.runtime.tick()
    expect((await h.runtime.leases.renew('doc_1', { force: true })).kind).toBe('revoked')
    await vi.waitFor(async () => {
      expect(await h.runtime.library!.row('doc_1')).toMatchObject({ state: 'revoked', bytes: 0 })
    })
    // only the pin row and the index remain
    expect(filesUnder(h.libraryRoot).length).toBeLessThan(before)
    expect(filesUnder(h.libraryRoot)).toHaveLength(2)
    expect(await h.runtime.library!.openCached('doc_1')).toEqual({
      kind: 'refused',
      code: 'revoked',
    })
  })

  it('capability offline_library off refuses a new pin through the runtime capability read', async () => {
    const h = harness()
    h.capability.capabilities.offline_library = false
    addDoc(h, 'doc_1', 1)
    expect(
      await h.runtime.library!.pin({ documentId: 'doc_1', orgId: ORG, workspaceId: WS }),
    ).toEqual({ kind: 'refused', code: 'capability_off' })
  })
})

describe('T5-3 a feed delete/revoke of a CLOSED pinned document reaches the library', () => {
  /** the feed lists the document, then a resync no longer does (the drop is reported) */
  const droppingFeed = () =>
    new FakeFeedClient([
      {
        phase: 'snapshot',
        rows: [{ document_id: 'doc_1', revision: '1', current_version: 1 }],
        next_cursor: 'c1',
      },
      cursorInvalid(),
      { phase: 'snapshot', rows: [], next_cursor: 'c2' },
    ])

  /** the production wiring's onFeedGone: the service for an open copy, plus the library */
  const wiringOnFeedGone = (runtime: SyncRuntime, documentId: string) => {
    void runtime.library?.refresh(documentId).catch(() => undefined)
  }

  async function pinnedClosed(h: ReturnType<typeof harness>) {
    addDoc(h, 'doc_1', 1)
    await h.runtime.library!.pin({ documentId: 'doc_1', orgId: ORG, workspaceId: WS })
    expect(await h.runtime.library!.row('doc_1')).toMatchObject({ readyVersion: 1 })
    // a draft and an intent of the document in the sync store (never the library's)
    const opened = await h.syncLayer.open(SCOPE)
    if (opened.kind !== 'ok') throw new Error('sync store did not open')
    const records = opened.store.records
    await records(INTENT_STORE_REGISTRATION.name).write('doc_1', plaintext('intent', 64))
    await records(DRAFTS_STORE_REGISTRATION.name).write('doc_1/1', plaintext('draft', 64))
    return records
  }

  async function draftsKept(records: Awaited<ReturnType<typeof pinnedClosed>>) {
    expect((await records(INTENT_STORE_REGISTRATION.name).read('doc_1')).kind).toBe('ok')
    expect((await records(DRAFTS_STORE_REGISTRATION.name).read('doc_1/1')).kind).toBe('ok')
  }

  it('closed pinned doc + feed delete -> row deleted and its file gone from the store root listing', async () => {
    const h = harness({ feed: droppingFeed(), onFeedGone: wiringOnFeedGone })
    const records = await pinnedClosed(h)
    const before = filesUnder(h.libraryRoot).length
    expect(before).toBeGreaterThan(2)
    h.docs.docs.get('doc_1')!.error = new UniworkDocError('document_deleted', { status: 410 })
    await h.runtime.tick()
    await h.runtime.tick()
    await vi.waitFor(async () => {
      expect(await h.runtime.library!.row('doc_1')).toMatchObject({ state: 'deleted', bytes: 0 })
    })
    // only the pin row and the index remain under the library root
    expect(filesUnder(h.libraryRoot)).toHaveLength(2)
    expect(await h.runtime.library!.openCached('doc_1')).toEqual({
      kind: 'refused',
      code: 'deleted',
    })
    await draftsKept(records)
  })

  it('closed pinned doc + feed revoke -> row revoked and its bytes gone', async () => {
    const h = harness({ feed: droppingFeed(), onFeedGone: wiringOnFeedGone })
    const records = await pinnedClosed(h)
    h.docs.docs.get('doc_1')!.error = new UniworkDocError('permission_revoked', { status: 403 })
    await h.runtime.tick()
    await h.runtime.tick()
    await vi.waitFor(async () => {
      expect(await h.runtime.library!.row('doc_1')).toMatchObject({ state: 'revoked', bytes: 0 })
    })
    expect(filesUnder(h.libraryRoot)).toHaveLength(2)
    expect(await h.runtime.library!.openCached('doc_1')).toEqual({
      kind: 'refused',
      code: 'revoked',
    })
    await draftsKept(records)
  })

  it('a dropped id that is neither pinned nor open bound is still not reported', async () => {
    const gone: string[] = []
    const h = harness({
      feed: droppingFeed(),
      onFeedGone: (_runtime, documentId) => gone.push(documentId),
    })
    await h.runtime.tick()
    await h.runtime.tick()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(gone).toEqual([])
  })
})

/** a pinned (never opened) doc_1 with a draft and an intent in the sync store */
async function pinnedNeverOpened(h: ReturnType<typeof harness>) {
  addDoc(h, 'doc_1', 1)
  await h.runtime.library!.pin({ documentId: 'doc_1', orgId: ORG, workspaceId: WS })
  expect(await h.runtime.library!.row('doc_1')).toMatchObject({ readyVersion: 1, open: false })
  const opened = await h.syncLayer.open(SCOPE)
  if (opened.kind !== 'ok') throw new Error('sync store did not open')
  const records = opened.store.records
  await records(INTENT_STORE_REGISTRATION.name).write('doc_1', plaintext('intent', 64))
  await records(DRAFTS_STORE_REGISTRATION.name).write('doc_1/1', plaintext('draft', 64))
  return async () => {
    expect((await records(INTENT_STORE_REGISTRATION.name).read('doc_1')).kind).toBe('ok')
    expect((await records(DRAFTS_STORE_REGISTRATION.name).read('doc_1/1')).kind).toBe('ok')
  }
}

/** the production wiring's onFeedGone (uniwork-docs/wiring.ts): the library re-checks the doc */
const wiringFeedGone = (runtime: SyncRuntime, documentId: string) => {
  void runtime.library?.refresh(documentId).catch(() => undefined)
}

/** snapshot lists doc_1, then the cursor is refused and a resync no longer lists it */
const feedDropping = () =>
  new FakeFeedClient([
    {
      phase: 'snapshot',
      rows: [{ document_id: 'doc_1', revision: '1', current_version: 1 }],
      next_cursor: 'c1',
    },
    cursorInvalid(),
    { phase: 'snapshot', rows: [], next_cursor: 'c2' },
  ])

/** snapshot lists doc_1, then feed pages re-send it with an archived flag (same revision) */
const feedArchiving = (archived: boolean[]) =>
  new FakeFeedClient([
    {
      phase: 'snapshot',
      rows: [{ document_id: 'doc_1', revision: '1', current_version: 1 }],
      next_cursor: 'c1',
    },
    ...archived.map((flag, index) => ({
      phase: 'feed',
      rows: [{ document_id: 'doc_1', revision: '1', current_version: 1, archived: flag }],
      next_cursor: `f${index + 1}`,
    })),
  ])

describe('R5BE-15 delete / revoke / archive of a pinned, never opened doc through the real SyncRuntime feed path', () => {
  it.each([
    ['410 document_deleted', new UniworkDocError('document_deleted', { status: 410 }), 'deleted'],
    [
      '403 permission_revoked',
      new UniworkDocError('permission_revoked', { status: 403 }),
      'revoked',
    ],
    ['404 not_found', new UniworkDocError('not_found', { status: 404 }), 'revoked'],
  ] as const)(
    'feed drop -> %s -> row %s, its blobs gone from the store root listing, drafts kept',
    async (_label, error, state) => {
      const h = harness({ feed: feedDropping(), onFeedGone: wiringFeedGone })
      const draftsKept = await pinnedNeverOpened(h)
      expect(filesUnder(h.libraryRoot).length).toBeGreaterThan(2)
      h.docs.docs.get('doc_1')!.error = error
      await h.runtime.tick()
      await h.runtime.tick()
      await vi.waitFor(async () => {
        expect(await h.runtime.library!.row('doc_1')).toMatchObject({ state, bytes: 0 })
      })
      // only the pin row and the index remain under the library root
      expect(filesUnder(h.libraryRoot)).toHaveLength(2)
      expect(await h.runtime.library!.openCached('doc_1')).toEqual({ kind: 'refused', code: state })
      await draftsKept()
    },
  )

  it('feed upsert archived=true -> row archived, its blobs kept, still opens read-only, drafts kept', async () => {
    const h = harness({ feed: feedArchiving([true]), onFeedGone: wiringFeedGone })
    const draftsKept = await pinnedNeverOpened(h)
    const before = filesUnder(h.libraryRoot).filter((file) => !file.endsWith('.tmp'))
    h.docs.docs.get('doc_1')!.archivedAt = '2026-10-13T09:00:00Z'
    await h.runtime.tick()
    await h.runtime.tick()
    await vi.waitFor(async () => {
      expect(await h.runtime.library!.row('doc_1')).toMatchObject({
        state: 'archived',
        archived: true,
        readyVersion: 1,
      })
    })
    expect(filesUnder(h.libraryRoot)).toEqual(before)
    expect(await h.runtime.library!.openCached('doc_1')).toMatchObject({
      kind: 'ok',
      readOnly: true,
    })
    await draftsKept()
  })
})

describe('R5BE-1b an archived pinned document reaches the library (handleArchived routed)', () => {
  it('the feed parser keeps a feed upsert archived flag (G5-01b DocumentChangeFeedSDO.archived)', () => {
    const page = parseFeedPage(
      JSON.stringify({
        phase: 'feed',
        changes: [],
        feed: [
          {
            document_id: 'doc_1',
            change_kind: 'upsert',
            kind: 'file',
            revision: '7',
            current_version: 1,
            version_id: null,
            archived: true,
            removal: '',
          },
        ],
        has_more: false,
        next_cursor: 'f1',
        expires_at: '',
      }),
    )
    expect(page.changes).toEqual([
      expect.objectContaining({ documentId: 'doc_1', revision: '7', archived: true }),
    ])
    // a snapshot row has no archived field: nothing is read into it
    const snapshot = parseFeedPage(
      JSON.stringify({
        phase: 'snapshot',
        changes: [{ document_id: 'doc_1', kind: 'file', revision: '7', current_version: 1 }],
        has_more: false,
        next_cursor: 'c1',
      }),
    )
    expect(snapshot.changes[0]).not.toHaveProperty('archived')
  })

  it('a feed archived=true for a pinned doc marks it with no metadata read; archived=false re-checks and clears it', async () => {
    const h = harness({ feed: feedArchiving([true, false]), onFeedGone: wiringFeedGone })
    await pinnedNeverOpened(h)
    const reads = vi.spyOn(h.docs, 'getDocument')
    await h.runtime.tick()
    await h.runtime.tick()
    await vi.waitFor(async () => {
      expect(await h.runtime.library!.row('doc_1')).toMatchObject({ archived: true })
    })
    expect(reads).not.toHaveBeenCalled()
    // restored on the server: the next feed row says so, the head is read again
    await h.runtime.tick()
    await vi.waitFor(async () => {
      expect(await h.runtime.library!.row('doc_1')).toMatchObject({
        archived: false,
        state: 'view-only',
      })
    })
    expect(reads).toHaveBeenCalledWith('doc_1')
  })

  it('a feed archived flag for a doc that is not pinned touches nothing', async () => {
    const h = harness({ feed: feedArchiving([true]), onFeedGone: wiringFeedGone })
    addDoc(h, 'doc_1', 1)
    const reads = vi.spyOn(h.docs, 'getDocument')
    await h.runtime.tick()
    await h.runtime.tick()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await h.runtime.library!.row('doc_1')).toBeNull()
    expect(reads).not.toHaveBeenCalled()
  })

  describe('R6BE-1 the feed archived flag reaches the library only for pinned documents', () => {
    const ids = ['doc_1', 'doc_2', 'doc_3', 'doc_4', 'doc_5']
    const snapshot = {
      phase: 'snapshot',
      rows: ids.map((document_id) => ({ document_id, revision: '1', current_version: 1 })),
      next_cursor: 'c1',
    }

    it('a committed feed page of 5 rows (archived:false, none pinned) calls noteArchived 0 times', async () => {
      const h = harness({
        feed: new FakeFeedClient([
          snapshot,
          {
            phase: 'feed',
            rows: ids.map((document_id) => ({
              document_id,
              revision: '1',
              current_version: 1,
              archived: false,
            })),
            next_cursor: 'f1',
          },
        ]),
        onFeedGone: wiringFeedGone,
      })
      const noted = vi.spyOn(h.runtime.library!, 'noteArchived')
      await h.runtime.tick()
      await h.runtime.tick()
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(noted).not.toHaveBeenCalled()
    })

    it('RES-G505-6: a page listing one pinned document twice hands it to the library once', async () => {
      const duplicate = {
        document_id: 'doc_1',
        revision: '1',
        current_version: 1,
        archived: true,
      }
      const h = harness({
        feed: new FakeFeedClient([
          snapshot,
          { phase: 'feed', rows: [duplicate, { ...duplicate }], next_cursor: 'f1' },
        ]),
        onFeedGone: wiringFeedGone,
      })
      addDoc(h, 'doc_1', 1)
      await h.runtime.library!.pin({ documentId: 'doc_1', orgId: ORG, workspaceId: WS })
      const noted = vi.spyOn(h.runtime.library!, 'noteArchived')
      await h.runtime.tick()
      await h.runtime.tick()
      await vi.waitFor(async () => {
        expect(await h.runtime.library!.row('doc_1')).toMatchObject({ archived: true })
      })
      expect(noted).toHaveBeenCalledTimes(1)
    })

    it('RES-G505-6: a pass stopped while the library is asked hands nothing over', async () => {
      const h = harness({
        feed: new FakeFeedClient([
          snapshot,
          {
            phase: 'feed',
            rows: [{ document_id: 'doc_1', revision: '1', current_version: 1, archived: true }],
            next_cursor: 'f1',
          },
        ]),
      })
      addDoc(h, 'doc_1', 1)
      await h.runtime.library!.pin({ documentId: 'doc_1', orgId: ORG, workspaceId: WS })
      const noted = vi.spyOn(h.runtime.library!, 'noteArchived')
      // the pass is stopped exactly between the `flagged` check and the per-row
      // read: the rows this pass collected must no longer reach the library.
      // The loop that would hand them over runs inside the awaited second tick,
      // so no timer is needed to observe it.
      const pinned = vi.spyOn(h.runtime.library!, 'pinnedIds').mockImplementation(async () => {
        h.runtime.stop()
        return new Set(['doc_1'])
      })
      await h.runtime.tick().catch(() => undefined)
      await h.runtime.tick().catch(() => undefined)
      expect(pinned).toHaveBeenCalled()
      expect(noted).not.toHaveBeenCalled()
    })

    it('an archived:true row of a pinned doc is handed over once; unpinned rows of the same page (true or false) are not', async () => {
      const h = harness({
        feed: new FakeFeedClient([
          snapshot,
          {
            phase: 'feed',
            rows: ids.map((document_id, index) => ({
              document_id,
              revision: '1',
              current_version: 1,
              archived: index < 3,
            })),
            next_cursor: 'f1',
          },
        ]),
        onFeedGone: wiringFeedGone,
      })
      addDoc(h, 'doc_1', 1)
      await h.runtime.library!.pin({ documentId: 'doc_1', orgId: ORG, workspaceId: WS })
      const noted = vi.spyOn(h.runtime.library!, 'noteArchived')
      await h.runtime.tick()
      await h.runtime.tick()
      await vi.waitFor(async () => {
        expect(await h.runtime.library!.row('doc_1')).toMatchObject({ archived: true })
      })
      expect(noted).toHaveBeenCalledTimes(1)
      expect(noted).toHaveBeenCalledWith('doc_1', true)
    })
  })

  it('the feed-gone re-check (refresh) of a closed pinned doc whose head is archived -> archived, opens until lease end, then locked', async () => {
    const h = harness({ feed: feedDropping(), onFeedGone: wiringFeedGone })
    const draftsKept = await pinnedNeverOpened(h)
    h.docs.docs.get('doc_1')!.archivedAt = '2026-10-13T09:00:00Z'
    await h.runtime.tick()
    await h.runtime.tick()
    await vi.waitFor(async () => {
      expect(await h.runtime.library!.row('doc_1')).toMatchObject({ state: 'archived' })
    })
    expect(await h.runtime.library!.openCached('doc_1')).toMatchObject({ kind: 'ok' })
    // the lease (24 h) ends: the row locks, the copy no longer opens, its bytes stay
    h.advance(25 * HOUR)
    expect(await h.runtime.library!.row('doc_1')).toMatchObject({
      state: 'lease-expired',
      archived: true,
    })
    expect(await h.runtime.library!.openCached('doc_1')).toMatchObject({
      kind: 'refused',
      code: 'lease_unusable',
    })
    expect(filesUnder(h.libraryRoot).length).toBeGreaterThan(2)
    await draftsKept()
  })

  it('the reconnect pass: a pin that waited for the network and is archived on the server downloads and reads archived', async () => {
    const h = harness()
    addDoc(h, 'doc_1', 1).archivedAt = '2026-10-13T09:00:00Z'
    h.setDocsOnline(false)
    await h.runtime.library!.pin({ documentId: 'doc_1', orgId: ORG, workspaceId: WS })
    expect(await h.runtime.library!.row('doc_1')).toMatchObject({ state: 'waiting-network' })
    h.setDocsOnline(true)
    await h.runtime.tick()
    expect(await h.runtime.library!.row('doc_1')).toMatchObject({
      state: 'archived',
      readyVersion: 1,
    })
    expect(await h.runtime.library!.openCached('doc_1')).toMatchObject({ kind: 'ok' })
  })
})
