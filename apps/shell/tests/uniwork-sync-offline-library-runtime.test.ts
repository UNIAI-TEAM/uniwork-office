import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NEVER_READ_CAPABILITIES,
  type CapabilityRead,
} from '../src/main/uniwork-sync/capability/cache'
import type { FeedClient } from '../src/main/uniwork-sync/feed/client'
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
  const wallMs = T0
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
    lease: { client: () => leaseClient, session: () => 'dev_1', monotonicNow: () => 5_000 },
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
