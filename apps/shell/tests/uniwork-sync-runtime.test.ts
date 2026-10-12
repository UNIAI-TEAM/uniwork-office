import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { FeedError } from '../src/main/uniwork-sync/feed/errors'
import type { FeedClient, FeedPage } from '../src/main/uniwork-sync/feed/client'
import type { CapabilityRead } from '../src/main/uniwork-sync/capability/cache'
import { NEVER_READ_CAPABILITIES } from '../src/main/uniwork-sync/capability/cache'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import {
  DOC_INDEX_REGISTRATION,
  FEED_CURSORS_REGISTRATION,
  SyncRuntime,
} from '../src/main/uniwork-sync/runtime'
import {
  createStoreLayer,
  type StoreLayer,
  type StoreRecords,
} from '../src/main/uniwork-sync/store'
import { INTENT_STORE_REGISTRATION } from '../src/main/uniwork-sync/intent-store'
import {
  createLockableSafeStorage,
  runStoreCompliance,
  type ComplianceEnv,
  type ComplianceSubject,
  type LockableSafeStorage,
} from '../src/main/uniwork-sync/test-kit/compliance'

/**
 * W3b: the feed runtime. One consumer per (org, workspace) with `sync_feed`
 * on, over the account's durable store: the cursor only moves after a page
 * landed, a full resync keeps local drafts and evicts documents the snapshot
 * no longer lists, another account or deployment never sees this stream, and a
 * locked keychain or `sync_feed` off means no feed request at all. There is no
 * desktop realtime channel today; this poll is the whole mechanism.
 */

const SCOPE = { deploymentId: 'dep_1', accountId: 'acc_1' }
const PAGE: Omit<FeedPage, 'changes' | 'nextCursor'> = {
  phase: 'snapshot',
  hasMore: false,
  expiresAt: '2026-10-12T00:00:00Z',
}

type Change = FeedPage['changes'][number]
const change = (documentId: string): Change => ({
  documentId,
  kind: 'file',
  revision: '41',
  currentVersion: 3,
  versionId: null,
})

let base: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'uw-sync-runtime-'))
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

interface Harness {
  runtime: SyncRuntime
  layer: StoreLayer
  safeStorage: LockableSafeStorage
  calls: Array<{ workspaceId: string; cursor?: string }>
  clock: { now(): number }
  scope(): { deploymentId: string; accountId: string } | null
  setScope(next: { deploymentId: string; accountId: string } | null): void
  sessionExpired: () => number
}

/** a scripted change feed: pages per workspace, in call order */
function harness(
  options: {
    orgs?: string[]
    workspaces?: Record<string, string[]>
    capabilities?: Record<string, CapabilityRead>
    pages?(call: { workspaceId: string; cursor?: string }): FeedPage | Error
    keepDraft?: (documentId: string) => Promise<boolean>
  } = {},
): Harness {
  const safeStorage = createLockableSafeStorage()
  const layer = createStoreLayer({
    root: join(base, 'records'),
    keys: createSafeStorageKeyProvider({ safeStorage, dir: join(base, 'keys') }),
    budgetBytes: 1 << 20,
    clock: () => clock.now(),
  })
  layer.register(INTENT_STORE_REGISTRATION)
  layer.register(FEED_CURSORS_REGISTRATION)
  layer.register(DOC_INDEX_REGISTRATION)

  let scope: { deploymentId: string; accountId: string } | null = { ...SCOPE }
  const calls: Harness['calls'] = []
  let expired = 0
  const clock = { now: () => 1_700_000_000_000 }
  const client: FeedClient = {
    async listChanges(workspaceId, cursor) {
      calls.push({ workspaceId, ...(cursor ? { cursor } : {}) })
      const page = options.pages?.({ workspaceId, ...(cursor ? { cursor } : {}) })
      if (page instanceof Error) throw page
      return page ?? { ...PAGE, changes: [change('doc_1')], nextCursor: 'c1' }
    },
  }
  const runtime = new SyncRuntime({
    store: {
      scope: () => scope,
      open: async () => {
        if (!scope) return { kind: 'no_session' }
        const open = await layer.open(scope)
        return open.kind === 'ok'
          ? { kind: 'ok', records: (name: string) => open.store.records(name) }
          : open
      },
      forget: () => undefined,
    },
    targets: {
      orgs: () => options.orgs ?? ['org_a'],
      workspaces: async (orgId) => options.workspaces?.[orgId] ?? ['ws_1'],
    },
    capability: async (orgId) =>
      options.capabilities?.[orgId] ??
      ({
        kind: 'ok',
        capabilities: { ...NEVER_READ_CAPABILITIES, sync_feed: true },
        source: 'fresh',
      } as CapabilityRead),
    client: () => client,
    keepDraft: options.keepDraft ?? (async () => false),
    clock,
    onSessionExpired: () => {
      expired += 1
    },
  })
  return {
    runtime,
    layer,
    safeStorage,
    calls,
    clock,
    scope: () => scope,
    setScope: (next) => {
      scope = next
    },
    sessionExpired: () => expired,
  }
}

async function recordsOf(layer: StoreLayer, name: string): Promise<StoreRecords> {
  const opened = await layer.open(SCOPE)
  if (opened.kind !== 'ok') throw new Error(`store did not open: ${opened.kind}`)
  return opened.store.records(name)
}

/** the cursor of one stream, as the durable store holds it */
async function cursorOf(h: Harness, orgId: string, workspaceId: string): Promise<string | null> {
  const read = await (
    await recordsOf(h.layer, FEED_CURSORS_REGISTRATION.name)
  ).read(`${SCOPE.deploymentId}/${SCOPE.accountId}/${orgId}/${workspaceId}`)
  return read.kind === 'ok' ? new TextDecoder().decode(read.value) : null
}

/** the document ids the doc index holds for one workspace */
async function indexOf(h: Harness, orgId: string, workspaceId: string): Promise<string[]> {
  const read = await (
    await recordsOf(h.layer, DOC_INDEX_REGISTRATION.name)
  ).read(`${orgId}/${workspaceId}/index`)
  return read.kind === 'ok' ? (JSON.parse(new TextDecoder().decode(read.value)) as string[]) : []
}

const networkError = () => new FeedError({ kind: 'other', error: new UniworkDocError('network') })

describe('the feed runtime', () => {
  it('pulls every (org, workspace) whose capability says sync_feed, and nothing else', async () => {
    const h = harness({
      orgs: ['org_a', 'org_b'],
      workspaces: { org_a: ['ws_1', 'ws_2'], org_b: ['ws_3'] },
      capabilities: {
        org_a: {
          kind: 'ok',
          capabilities: { ...NEVER_READ_CAPABILITIES, sync_feed: true },
          source: 'fresh',
        },
        org_b: {
          kind: 'ok',
          capabilities: { ...NEVER_READ_CAPABILITIES, sync_feed: false },
          source: 'fresh',
        },
      },
    })
    await h.runtime.tick()
    expect(h.calls.map((call) => call.workspaceId).sort()).toEqual(['ws_1', 'ws_2'])
    expect(await cursorOf(h, 'org_a', 'ws_1')).toBe('c1')
    expect(await cursorOf(h, 'org_a', 'ws_2')).toBe('c1')
    // sync_feed off: no request, no cursor for that workspace
    expect(await cursorOf(h, 'org_b', 'ws_3')).toBeNull()
  })

  it('a crash mid-page keeps the cursor on the applied page; the replay is idempotent', async () => {
    let phase = 0
    const h = harness({
      pages: () => {
        phase += 1
        // one clean page first, so a cursor is saved and the next run is incremental
        if (phase === 1) return { ...PAGE, changes: [change('doc_1')], nextCursor: 'c1' }
        if (phase === 2) return networkError()
        return { ...PAGE, changes: [change('doc_2')], nextCursor: 'c2' }
      },
    })
    await h.runtime.tick()
    expect(await cursorOf(h, 'org_a', 'ws_1')).toBe('c1')
    expect(await indexOf(h, 'org_a', 'ws_1')).toEqual(['doc_1'])
    // the second page fails: the cursor does not move past the applied one
    await h.runtime.tick()
    expect(await cursorOf(h, 'org_a', 'ws_1')).toBe('c1')
    expect(await indexOf(h, 'org_a', 'ws_1')).toEqual(['doc_1'])
    // the replay continues from the same cursor and lands once
    await h.runtime.tick()
    expect(h.calls[2]?.cursor).toBe('c1')
    expect(await cursorOf(h, 'org_a', 'ws_1')).toBe('c2')
    expect(await indexOf(h, 'org_a', 'ws_1')).toEqual(['doc_1', 'doc_2'])
  })

  it('a full resync keeps drafts and evicts documents the snapshot no longer lists', async () => {
    let draft = true
    let snapshot: Change[] = [change('doc_1'), change('doc_2')]
    let expire = false
    const h = harness({
      keepDraft: async () => draft,
      pages: ({ cursor }) => {
        if (expire && cursor) {
          expire = false
          return new FeedError({ kind: 'cursor_expired' })
        }
        return { ...PAGE, hasMore: false, changes: snapshot, nextCursor: `c${snapshot.length}` }
      },
    })
    await h.runtime.tick()
    expect(await indexOf(h, 'org_a', 'ws_1')).toEqual(['doc_1', 'doc_2'])
    // the cursor expires; the snapshot no longer lists doc_2, which has local work
    snapshot = [change('doc_1')]
    expire = true
    await h.runtime.tick()
    expect(await indexOf(h, 'org_a', 'ws_1')).toEqual(['doc_1', 'doc_2'])
    // the local work is gone: the next resync evicts it, record and all
    draft = false
    expire = true
    await h.runtime.tick()
    expect(await indexOf(h, 'org_a', 'ws_1')).toEqual(['doc_1'])
    const read = await (
      await recordsOf(h.layer, DOC_INDEX_REGISTRATION.name)
    ).read('org_a/ws_1/doc_2')
    expect(read.kind).toBe('missing')
  })

  it('another account or deployment never sees this stream', async () => {
    const h = harness()
    await h.runtime.tick()
    expect(await cursorOf(h, 'org_a', 'ws_1')).toBe('c1')
    // the session moves to another deployment: the new scope starts cold (the
    // old stream's cursor is never read into it)
    h.setScope({ deploymentId: 'dep_2', accountId: 'acc_1' })
    h.calls.length = 0
    await h.runtime.tick()
    expect(h.calls[0]?.cursor).toBeUndefined()
    expect(await cursorOf(h, 'org_a', 'ws_1')).toBe('c1')
  })

  it('a locked keychain or an off capability never asks the feed server', async () => {
    const locked = harness()
    locked.safeStorage.lock()
    await locked.runtime.tick()
    expect(locked.calls).toEqual([])
    const off = harness({
      capabilities: {
        org_a: { kind: 'ok', capabilities: { ...NEVER_READ_CAPABILITIES }, source: 'fresh' },
      },
    })
    await off.runtime.tick()
    expect(off.calls).toEqual([])
  })

  it('a capability 401 is handed to the session', async () => {
    const h = harness({
      capabilities: {
        org_a: {
          kind: 'session_expired',
          capabilities: { ...NEVER_READ_CAPABILITIES },
          source: 'stale',
        },
      },
    })
    await h.runtime.tick()
    expect(h.sessionExpired()).toBe(1)
    expect(h.calls).toEqual([])
  })

  it('start polls on the injected schedule and stop cancels it', async () => {
    const h = harness()
    const runs: Array<() => void> = []
    const stop = vi.fn()
    // a fresh runtime with the schedule seam
    const scheduled = new SyncRuntime({
      store: {
        scope: () => h.scope(),
        open: async () => {
          const open = await h.layer.open(SCOPE)
          return open.kind === 'ok'
            ? { kind: 'ok', records: (name: string) => open.store.records(name) }
            : open
        },
        forget: () => undefined,
      },
      targets: { orgs: () => ['org_a'], workspaces: async () => ['ws_1'] },
      capability: async () => ({
        kind: 'ok',
        capabilities: { ...NEVER_READ_CAPABILITIES, sync_feed: true },
        source: 'fresh',
      }),
      client: () => ({ listChanges: async () => ({ ...PAGE, changes: [], nextCursor: 'c1' }) }),
      keepDraft: async () => false,
      clock: { now: () => 1 },
      schedule: (run) => {
        runs.push(run)
        return stop
      },
    })
    scheduled.start()
    await scheduled.tick()
    expect(runs).toHaveLength(1)
    scheduled.stop()
    expect(stop).toHaveBeenCalled()
  })
})

// the two new registered stores take the store compliance contract (sign-out
// wipes them, the budget is accounted, a newer-level record is refused, ...)
runStoreCompliance('uniwork-sync feed cursors', async (env: ComplianceEnv) => {
  const layer = createStoreLayer({
    root: env.root,
    keys: createSafeStorageKeyProvider({ safeStorage: env.safeStorage, dir: env.keyDir }),
    budgetBytes: env.budgetBytes,
    clock: env.clock,
  })
  layer.register(FEED_CURSORS_REGISTRATION)
  const opened = await layer.open(env.scope)
  if (opened.kind !== 'ok') throw new Error(`feed cursors did not open: ${opened.kind}`)
  const subject: ComplianceSubject = {
    registration: FEED_CURSORS_REGISTRATION,
    layer,
    scope: env.scope,
    records: opened.store.records(FEED_CURSORS_REGISTRATION.name),
  }
  return subject
})

runStoreCompliance('uniwork-sync doc index', async (env: ComplianceEnv) => {
  const layer = createStoreLayer({
    root: env.root,
    keys: createSafeStorageKeyProvider({ safeStorage: env.safeStorage, dir: env.keyDir }),
    budgetBytes: env.budgetBytes,
    clock: env.clock,
  })
  layer.register(DOC_INDEX_REGISTRATION)
  const opened = await layer.open(env.scope)
  if (opened.kind !== 'ok') throw new Error(`doc index did not open: ${opened.kind}`)
  const subject: ComplianceSubject = {
    registration: DOC_INDEX_REGISTRATION,
    layer,
    scope: env.scope,
    records: opened.store.records(DOC_INDEX_REGISTRATION.name),
  }
  return subject
})
