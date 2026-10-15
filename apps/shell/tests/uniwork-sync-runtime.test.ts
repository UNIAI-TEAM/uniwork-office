import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { BINDING_FILE } from '../src/main/uniwork-docs/binding-store'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'
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
import { createSyncStoreAccess } from '../src/main/uniwork-sync/session-store'
import {
  createStoreLayer,
  type StoreLayer,
  type StoreRecords,
} from '../src/main/uniwork-sync/store'
import { createIntentStore, INTENT_STORE_REGISTRATION } from '../src/main/uniwork-sync/intent-store'
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
    /** replaces the capability read (a gate, a counter, ...) */
    capabilityRead?: (orgId: string) => Promise<CapabilityRead>
    pages?(call: { workspaceId: string; cursor?: string }): FeedPage | Error
    keepDraft?: (documentId: string) => Promise<boolean>
    /** S18: a page the doc cache committed (a renamed-elsewhere notice) */
    onFeedChange?: (change: Change) => void
    /** wraps one registered store's records (a refused write, a torn commit, ...) */
    wrapRecords?: (name: string, records: StoreRecords) => StoreRecords
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
        if (open.kind !== 'ok') return open
        const wrap = options.wrapRecords
        return {
          kind: 'ok',
          records: (name: string) => {
            const records = open.store.records(name)
            return wrap ? wrap(name, records) : records
          },
        }
      },
      forget: () => undefined,
      lock: async () => undefined,
    },
    targets: {
      orgs: () => options.orgs ?? ['org_a'],
      workspaces: async (orgId) => options.workspaces?.[orgId] ?? ['ws_1'],
    },
    capability: async (orgId) =>
      options.capabilityRead?.(orgId) ??
      options.capabilities?.[orgId] ??
      ({
        kind: 'ok',
        capabilities: { ...NEVER_READ_CAPABILITIES, sync_feed: true },
        source: 'fresh',
      } as CapabilityRead),
    client: () => client,
    keepDraft: options.keepDraft ?? (async () => false),
    ...(options.onFeedChange ? { onFeedChange: options.onFeedChange } : {}),
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

/** the workspace's cache record as the durable store holds it */
async function cacheOf(
  h: Harness,
  orgId: string,
  workspaceId: string,
): Promise<{ index: string[]; docs: Record<string, { documentId: string; revision: string }> }> {
  const read = await (
    await recordsOf(h.layer, DOC_INDEX_REGISTRATION.name)
  ).read(`${orgId}/${workspaceId}/index`)
  if (read.kind !== 'ok') return { index: [], docs: {} }
  return JSON.parse(new TextDecoder().decode(read.value)) as {
    index: string[]
    docs: Record<string, { documentId: string; revision: string }>
  }
}

/** the document ids the doc index holds for one workspace */
async function indexOf(h: Harness, orgId: string, workspaceId: string): Promise<string[]> {
  return (await cacheOf(h, orgId, workspaceId)).index
}

/** the record files one registered store of the account holds */
function recordFiles(storeName: string): string[] {
  try {
    return readdirSync(join(base, 'records', SCOPE.deploymentId, SCOPE.accountId, storeName))
  } catch {
    return []
  }
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
    // the evicted row went with the index: nothing left the index cannot reach
    expect(Object.keys((await cacheOf(h, 'org_a', 'ws_1')).docs)).toEqual(['doc_1'])
    expect(recordFiles(DOC_INDEX_REGISTRATION.name)).toHaveLength(1)
  })

  it('a torn page commit keeps the previous page whole: no orphan row (G504-be-2)', async () => {
    let commits = 0
    let page = 0
    const h = harness({
      pages: () => {
        page += 1
        return page === 1
          ? { ...PAGE, changes: [change('doc_1')], nextCursor: 'c1' }
          : { ...PAGE, changes: [change('doc_2')], nextCursor: 'c2' }
      },
      wrapRecords: (name, records) =>
        name === DOC_INDEX_REGISTRATION.name
          ? {
              ...records,
              write: async (key, value) => {
                commits += 1
                // the snapshot commits (page + reconcile); the next page dies
                // in its commit, before anything is published
                if (commits === 3) throw Object.assign(new Error('torn'), { code: 'EIO' })
                return records.write(key, value)
              },
            }
          : records,
    })
    await h.runtime.tick()
    expect(await indexOf(h, 'org_a', 'ws_1')).toEqual(['doc_1'])
    // the page dies mid-commit: neither its row nor its id is visible
    await expect(h.runtime.tick()).rejects.toThrow('torn')
    expect(await indexOf(h, 'org_a', 'ws_1')).toEqual(['doc_1'])
    expect(Object.keys((await cacheOf(h, 'org_a', 'ws_1')).docs)).toEqual(['doc_1'])
    expect(await cursorOf(h, 'org_a', 'ws_1')).toBe('c1')
    // one record per workspace, so no orphan row survives the torn commit
    expect(recordFiles(DOC_INDEX_REGISTRATION.name)).toHaveLength(1)
    // the replay commits the whole page at once
    await h.runtime.tick()
    expect(await indexOf(h, 'org_a', 'ws_1')).toEqual(['doc_1', 'doc_2'])
    expect(recordFiles(DOC_INDEX_REGISTRATION.name)).toHaveLength(1)
  })

  it('a store_full page apply never moves the cursor, and the page is retried (G504-be-1)', async () => {
    let full = false
    const h = harness({
      pages: ({ cursor }) =>
        cursor
          ? { ...PAGE, changes: [change('doc_2')], nextCursor: 'c2' }
          : { ...PAGE, changes: [change('doc_1')], nextCursor: 'c1' },
      wrapRecords: (name, records) =>
        name === DOC_INDEX_REGISTRATION.name
          ? {
              ...records,
              // the budget is full for this page's rows; the cursor write still fits
              write: async (key, value) =>
                full ? { kind: 'store_full' } : records.write(key, value),
            }
          : records,
    })
    await h.runtime.tick()
    expect(await cursorOf(h, 'org_a', 'ws_1')).toBe('c1')
    full = true
    await h.runtime.tick()
    // the page could not be applied: the cursor stays on the applied page
    expect(await cursorOf(h, 'org_a', 'ws_1')).toBe('c1')
    expect(await indexOf(h, 'org_a', 'ws_1')).toEqual(['doc_1'])
    // and the next tick asks the server for exactly that page again
    await h.runtime.tick()
    expect(h.calls.at(-1)?.cursor).toBe('c1')
    expect(await cursorOf(h, 'org_a', 'ws_1')).toBe('c1')
    // the budget frees up: the same page lands once and the cursor moves
    full = false
    await h.runtime.tick()
    expect(await cursorOf(h, 'org_a', 'ws_1')).toBe('c2')
    expect(await indexOf(h, 'org_a', 'ws_1')).toEqual(['doc_1', 'doc_2'])
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
        lock: async () => undefined,
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

  it('stop() ends the pass in flight and the next start runs at once (G504-be-7)', async () => {
    let release!: (read: CapabilityRead) => void
    const gate = new Promise<CapabilityRead>((resolve) => {
      release = resolve
    })
    let entered!: () => void
    const reading = new Promise<void>((resolve) => {
      entered = resolve
    })
    let reads = 0
    const h = harness({
      capabilityRead: async () => {
        reads += 1
        entered()
        return gate
      },
    })
    // the pass is suspended inside the capability read when the boundary lands
    const first = h.runtime.tick()
    await reading
    h.runtime.stop()
    // a start now must not wait behind the pass that was just cancelled
    const second = h.runtime.tick()
    release({
      kind: 'ok',
      capabilities: { ...NEVER_READ_CAPABILITIES, sync_feed: true },
      source: 'fresh',
    })
    await Promise.all([first, second])
    // only the pass that started after the stop reached the feed
    expect(reads).toBe(2)
    expect(h.calls).toHaveLength(1)
    expect(await cursorOf(h, 'org_a', 'ws_1')).toBe('c1')
  })
})

/**
 * W3b: the doc index is reconciled with the REAL service, wired the way
 * wiring.ts wires it (`keepDraft: (documentId) => service.hasLocalDraft(...)`).
 * The sweep and the intent store are the service's own, so "has local work"
 * is decided exactly as production decides it - and the editor's unsaved edits
 * count as local work too (a ready binding whose file does not show them yet).
 */
describe('the full resync keeps drafts through the real hasLocalDraft (wiring keepDraft)', () => {
  const IDS = {
    clean: 'doc_clean',
    dirty: 'doc_dirty',
    saving: 'doc_saving',
    intent: 'doc_intent',
    editor: 'doc_editor',
    listed: 'doc_listed',
  }

  /** a working copy of dep_1/acc_1 as the service reads one (schema 2, bound, editable) */
  function seedCopy(documentId: string, state: string): string {
    const folder = join(base, 'uniwork-documents', 'dep_1', 'acc_1', documentId)
    const path = join(folder, 'Plan.docx')
    mkdirSync(folder, { recursive: true })
    writeFileSync(path, `local bytes of ${documentId}`)
    writeFileSync(
      join(folder, BINDING_FILE),
      JSON.stringify({
        schema: 2,
        min_store_level: 2,
        min_app_version: '0.11.0',
        documentId,
        workspaceId: 'ws_1',
        orgId: 'org_a',
        title: 'Plan.docx',
        filename: 'Plan.docx',
        format: 'docx',
        access: 'edit',
        baseRevision: '41',
        baseVersion: 3,
        baseChecksum: 'base',
        state,
      }),
    )
    return path
  }

  /**
   * The service of dep_1/acc_1 over the runtime's own store layer.
   * `wrapRecords` (optional) wraps the stores the SERVICE opens, so a test can
   * hold one of its reads; the runtime's own handles are unaffected.
   */
  function serviceOver(
    layer: StoreLayer,
    wrapRecords?: (name: string, records: StoreRecords) => StoreRecords,
  ): UniworkDocsService {
    const profile = {
      deploymentId: 'dep_1',
      apiOrigin: 'https://uniwork.example',
      clientId: 'uniwork-office',
      channel: 'stable' as const,
    }
    const identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'dep_1' }
    const ui: ConflictUi = {
      chooseConflict: vi.fn(async () => 'later'),
      confirmDiscard: vi.fn(async () => false),
      pickCopyPath: vi.fn(async () => null),
      showOpenLatestFailed: vi.fn(),
      showCopyFailed: vi.fn(),
      chooseUnsavedClose: vi.fn(async () => 'cancel'),
    }
    return new UniworkDocsService({
      userDataDir: base,
      syncStore: createSyncStoreAccess({
        layer: wrapRecords
          ? {
              ...layer,
              async open(scope) {
                const opened = await layer.open(scope)
                if (opened.kind !== 'ok') return opened
                return {
                  kind: 'ok',
                  store: {
                    scope: opened.store.scope,
                    records: (name: string) => wrapRecords(name, opened.store.records(name)),
                  },
                }
              },
            }
          : layer,
        scope: () => ({ deploymentId: identity.deploymentId, accountId: identity.accountId }),
      }),
      appVersion: () => '0.11.0',
      profile: () => profile,
      channel: () => 'stable',
      applyProfile: async () => 'unchanged',
      identity: () => identity,
      keystoreLocked: () => false,
      selectedOrg: () => ({ id: 'org_a', slug: 'acme' }),
      authorized: <T>(call: (token: string) => Promise<T>) => call('token'),
      openPath: () => true,
      isPathOpen: () => false,
      requestModuleSave: () => false,
      reloadPath: vi.fn(),
      activePath: () => undefined,
      ui,
      pushStatus: vi.fn(),
      pushLaunch: vi.fn(),
      reveal: vi.fn(),
    })
  }

  it('keeps dirty, saving, intent-held and editor-dirty copies; evicts a clean unlisted one', async () => {
    const serviceRef: { current: UniworkDocsService | null } = { current: null }
    const h = harness({
      // exactly wiring.ts: keepDraft is the service's own answer
      keepDraft: (documentId) => {
        if (!serviceRef.current) throw new Error('service not built')
        return serviceRef.current.hasLocalDraft(documentId)
      },
      pages: () => ({ ...PAGE, changes: [change(IDS.listed)], nextCursor: 'c1' }),
    })
    const service = serviceOver(h.layer)
    serviceRef.current = service

    // one copy per reason to keep local work, plus a clean one
    seedCopy(IDS.dirty, 'dirty')
    seedCopy(IDS.saving, 'saving')
    seedCopy(IDS.intent, 'ready')
    seedCopy(IDS.clean, 'ready')
    const editorPath = seedCopy(IDS.editor, 'ready')
    // the editor holds edits the file does not show yet: still local work
    service.noteEditorDirty(editorPath, true)
    // the intent-held copy is clean on disk; its intent record is the local work
    const intents = createIntentStore(await recordsOf(h.layer, INTENT_STORE_REGISTRATION.name))
    await intents.put(
      IDS.intent,
      {
        intentId: 'intent_doc_intent',
        idempotencyKey: 'key_doc_intent',
        documentId: IDS.intent,
        baseRevision: '41',
        checksum: 'checksum',
        createdAt: '2026-10-12T00:00:00.000Z',
      },
      new TextEncoder().encode('payload'),
    )
    // the index already lists every copy; the snapshot below lists only doc_listed
    const cache = await recordsOf(h.layer, DOC_INDEX_REGISTRATION.name)
    await cache.write(
      'org_a/ws_1/index',
      new TextEncoder().encode(
        JSON.stringify({
          index: [IDS.clean, IDS.dirty, IDS.saving, IDS.intent, IDS.editor, IDS.listed],
          docs: {},
        }),
      ),
    )

    await h.runtime.tick()

    // the clean, unlisted copy is evicted from the index (and its row with it);
    // every copy with local work stays - including the editor-dirty one
    expect(await indexOf(h, 'org_a', 'ws_1')).toEqual([
      IDS.dirty,
      IDS.saving,
      IDS.intent,
      IDS.editor,
      IDS.listed,
    ])
    expect(Object.keys((await cacheOf(h, 'org_a', 'ws_1')).docs)).toEqual([IDS.listed])
  })

  /**
   * R5-be-1: the editor-dirty signal is re-read after the intent-store await.
   * The check before the await is one-shot, so an editor that turns dirty
   * while the store is answering must not lose the tab's document: the intent
   * read here is held open until the copy is reported dirty.
   */
  it('keeps a copy whose editor turns dirty while the intent store is answering (R5-be-1)', async () => {
    const serviceRef: { current: UniworkDocsService | null } = { current: null }
    const h = harness({
      keepDraft: (documentId) => {
        if (!serviceRef.current) throw new Error('service not built')
        return serviceRef.current.hasLocalDraft(documentId)
      },
      pages: () => ({ ...PAGE, changes: [change(IDS.listed)], nextCursor: 'c1' }),
    })
    // the service's own intent store: its read is held until the copy is dirty
    let entered!: () => void
    const reading = new Promise<void>((resolve) => {
      entered = resolve
    })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let held = false
    const service = serviceOver(h.layer, (name, records) =>
      name === INTENT_STORE_REGISTRATION.name
        ? {
            ...records,
            async read(key) {
              held = true
              entered()
              await gate
              return records.read(key)
            },
          }
        : records,
    )
    serviceRef.current = service

    // a clean, ready copy the snapshot no longer lists: the sweep would evict it
    const editorPath = seedCopy(IDS.editor, 'ready')
    const cache = await recordsOf(h.layer, DOC_INDEX_REGISTRATION.name)
    await cache.write(
      'org_a/ws_1/index',
      new TextEncoder().encode(JSON.stringify({ index: [IDS.editor, IDS.listed], docs: {} })),
    )

    const pass = h.runtime.tick()
    await reading
    // the editor turns dirty while the intent read is still in flight
    service.noteEditorDirty(editorPath, true)
    release()
    await pass

    expect(held).toBe(true)
    expect(await indexOf(h, 'org_a', 'ws_1')).toEqual([IDS.editor, IDS.listed])
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

describe('G506-be-3: only a failed feed round trip reports the queue offline', () => {
  function pollRuntime(orgs: string[], listChanges: FeedClient['listChanges']) {
    const h = harness()
    const polls: boolean[] = []
    const runtime = new SyncRuntime({
      store: {
        scope: () => h.scope(),
        open: async () => {
          const open = await h.layer.open(SCOPE)
          return open.kind === 'ok'
            ? { kind: 'ok', records: (name: string) => open.store.records(name) }
            : open
        },
        forget: () => undefined,
        lock: async () => undefined,
      },
      targets: { orgs: () => orgs, workspaces: async () => ['ws_1'] },
      capability: async () => ({
        kind: 'ok',
        capabilities: { ...NEVER_READ_CAPABILITIES, sync_feed: true },
        source: 'fresh',
      }),
      client: () => ({ listChanges }),
      keepDraft: async () => false,
      clock: { now: () => 1_700_000_000_000 },
      onPoll: async (online: boolean) => {
        polls.push(online)
      },
    })
    return { runtime, polls }
  }

  it('a pass with no org to feed (nothing attempted) reports no verdict', async () => {
    const { runtime, polls } = pollRuntime([], async () => ({
      ...PAGE,
      changes: [],
      nextCursor: 'c1',
    }))
    await runtime.tick()
    // neither online nor offline: nothing was attempted
    expect(polls).toHaveLength(1)
    expect(polls[0]).toBeUndefined()
  })

  it('a failed feed round trip parks the queue offline', async () => {
    const { runtime, polls } = pollRuntime(['org_a'], async () => {
      throw new FeedError({ kind: 'other', error: new UniworkDocError('network') })
    })
    await runtime.tick()
    expect(polls).toEqual([false])
  })
})

describe('the S18 change notice (G8-17)', () => {
  it('announces every document of a page the doc cache committed, exactly once', async () => {
    const seen: string[] = []
    const h = harness({
      pages: () => ({ ...PAGE, changes: [change('doc_1'), change('doc_2')], nextCursor: 'c1' }),
      onFeedChange: (c) => seen.push(c.documentId),
    })
    await h.runtime.tick()
    expect(seen).toEqual(['doc_1', 'doc_2'])
    // a replayed page (the cache already holds those rows) is inert: no second
    // notice, so the service is not asked to re-read metadata again
    seen.length = 0
    await h.runtime.tick()
    expect(seen).toEqual([])
  })

  // R1-7: a page can carry two changes for one document (a fast double edit);
  // both pass the revision comparison in the same pass, so the applied ids are
  // deduped per document - one metadata re-read, not two.
  it('announces a document with two changes in one page exactly once', async () => {
    const seen: string[] = []
    const h = harness({
      pages: () => ({
        ...PAGE,
        changes: [change('doc_1'), { ...change('doc_1'), revision: '42' }, change('doc_2')],
        nextCursor: 'c1',
      }),
      onFeedChange: (c) => seen.push(c.documentId),
    })
    await h.runtime.tick()
    expect(seen).toEqual(['doc_1', 'doc_2'])
  })

  it('announces nothing when the cache refuses the page', async () => {
    const seen: string[] = []
    const h = harness({
      onFeedChange: (c) => seen.push(c.documentId),
      wrapRecords: (name, records) =>
        name === DOC_INDEX_REGISTRATION.name
          ? { ...records, write: async () => ({ kind: 'store_full' as const }) }
          : records,
    })
    const result = await h.runtime.tick()
    expect(result).toBeUndefined()
    expect(seen).toEqual([])
  })
})
