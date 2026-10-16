import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createWiredSyncCenter,
  DRAFT_PREVIEW_CLOSE_GRACE_MS,
  isDraftPreviewPath,
  type SyncFeedVerdict,
} from '../src/main/uniwork-sync/sync-center'
import { QueueDispatcher, type QueueIntents } from '../src/main/uniwork-sync/queue/dispatcher'
import { createDraftStore } from '../src/main/uniwork-sync/queue/drafts'
import type { IntentRecordV2 } from '../src/main/uniwork-sync/queue/record'
import type { StoreRecords, StoreWriteResult } from '../src/main/uniwork-sync/store'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { FeedError } from '../src/main/uniwork-sync/feed/errors'
import type { FeedClient, FeedPage } from '../src/main/uniwork-sync/feed/client'
import { NEVER_READ_CAPABILITIES } from '../src/main/uniwork-sync/capability/cache'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import {
  DOC_INDEX_REGISTRATION,
  FEED_CURSORS_REGISTRATION,
  FEED_RESYNC_FAILED_AFTER,
  SyncRuntime,
} from '../src/main/uniwork-sync/runtime'
import { createStoreLayer } from '../src/main/uniwork-sync/store'
import { INTENT_STORE_REGISTRATION } from '../src/main/uniwork-sync/intent-store'
import { createLockableSafeStorage } from '../src/main/uniwork-sync/test-kit/compliance'

/**
 * G5-10 BE review r1: the WIRED sync center (createWiredSyncCenter over a live-shaped
 * service, store and runtime), not the pure builder. Each block names the finding it
 * proves; every one of them was invisible to the builder-only tests.
 */

const NOW_MS = Date.parse('2026-10-15T09:00:00.000Z')
const NOW_ISO = new Date(NOW_MS).toISOString()
const SCOPE = { deploymentId: 'dep-1', accountId: 'acc-1' }

let base: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'uw-sync-center-wired-'))
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

function memoryRecords(): StoreRecords {
  const map = new Map<string, Uint8Array>()
  return {
    async read(key) {
      const found = map.get(key)
      return found ? { kind: 'ok', value: found } : { kind: 'missing' }
    },
    async write(key, value): Promise<StoreWriteResult> {
      map.set(key, new Uint8Array(value))
      return { kind: 'ok' }
    },
    async delete(key) {
      map.delete(key)
    },
    async listKeys() {
      return [...map.keys()]
    },
  }
}

interface DocSpec {
  key: string
  state?: IntentRecordV2['state']
  lastError?: string
  maxBytes?: number
}

function record(key: string, spec: DocSpec): IntentRecordV2 {
  return {
    v: 2,
    intentId: `intent-${key}`,
    idempotencyKey: `idem-${key}`,
    documentId: key,
    orgId: 'org-1',
    workspaceId: 'ws-1',
    baseRevision: '10',
    baseVersion: 2,
    checksum: 'sha256-payload',
    length: 5,
    generation: 1,
    state: spec.state ?? 'queued',
    attempt: 1,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...(spec.lastError ? { lastError: spec.lastError as IntentRecordV2['lastError'] } : {}),
    ...(spec.maxBytes !== undefined ? { maxBytes: spec.maxBytes } : {}),
  }
}

function wired(
  options: {
    docs?: DocSpec[]
    locks?: Array<{ reason: 'store_newer' | 'keystore_locked' }>
    feed?: () => SyncFeedVerdict
    /** the runtime pass "Đồng bộ ngay" runs (default: nothing) */
    tick?: () => Promise<void>
    resetFeed?: () => Promise<void>
    status?: Record<string, unknown>
    usage?: { bytes: number; budgetBytes: number }
    /** the lease manager's effective state per document id (RES-3) */
    lease?: (documentId: string) => string
    offlineLibrary?: boolean
  } = {},
) {
  const storeRoot = join(base, 'store')
  const userDataDir = join(base, 'userData')
  const bindings = new Map<string, Record<string, unknown>>()
  const intents = new Map<string, { intent: IntentRecordV2; payload: Uint8Array }>()
  for (const spec of options.docs ?? []) {
    mkdirSync(join(storeRoot, SCOPE.deploymentId, SCOPE.accountId, spec.key), { recursive: true })
    bindings.set(spec.key, {
      documentId: spec.key,
      orgId: 'org-1',
      workspaceId: 'ws-1',
      title: `${spec.key} title`,
      filename: `${spec.key}.docx`,
      format: 'docx',
      access: 'edit',
      baseVersion: 2,
      state: spec.state ?? 'queued',
    })
    intents.set(spec.key, {
      intent: record(spec.key, spec),
      payload: new Uint8Array([1, 2, 3, 4, 5]),
    })
  }
  const pathOf = (key: string) =>
    join(storeRoot, SCOPE.deploymentId, SCOPE.accountId, key, `${key}.docx`)
  const keyOfPath = (path: string) => basename(path).replace(/\.docx$/, '')

  const queueIntents: QueueIntents = {
    async read(key) {
      return intents.get(key) ?? null
    },
    async get(key) {
      return intents.get(key) ?? null
    },
    async put(key, intent, payload) {
      intents.set(key, { intent: intent as IntentRecordV2, payload })
      return { kind: 'ok' }
    },
    async delete(key) {
      intents.delete(key)
    },
  }
  const drafts = createDraftStore(memoryRecords())
  let paused = false
  const pause = {
    isPaused: async () => paused,
    setPaused: async (next: boolean) => {
      paused = next
      return { kind: 'ok' as const }
    },
  }
  let seq = 0
  const dispatcher = new QueueDispatcher({
    intents: async () => ({ kind: 'ok', intents: queueIntents }),
    client: {
      upload: async () => ({ uploadId: 'up-1', checksumSha256: 'sha256-payload' }),
      commit: async () => ({
        documentId: 'doc-1',
        versionId: 'v-3',
        version: 3,
        revision: '11',
        checksumSha256: 'sha256-payload',
      }),
      lookupCommit: async () => ({ outcome: 'not_committed' as const }),
    },
    capability: {
      get: async () => ({ kind: 'ok', capabilities: { sync_write: true }, source: 'live' }),
    },
    lock: {
      acquire: async () => ({ kind: 'acquired', generation: 1 }),
      check: async () => true,
      heartbeat: async () => true,
      release: async () => undefined,
    },
    pause,
    drafts,
    clock: () => NOW_MS,
    uuid: () => `draft-uuid-${++seq}`,
    publish: () => undefined,
  } as never)

  const openPaths = new Set<string>()
  const opened: string[] = []
  let clock = NOW_MS
  let scope: typeof SCOPE | null = { ...SCOPE }
  // the save pill's own cancel path, as UniworkDocsService.cancelSave does it: a closed
  // document keeps its snapshot as a draft, an open one goes back to unsaved (dirty)
  const cancelSave = vi.fn(async (path: string, closed: boolean) => {
    const key = keyOfPath(path)
    const stored = intents.get(key)
    const binding = bindings.get(key)
    if (!stored || !binding) return
    await dispatcher.cancel(
      {
        key,
        path,
        filename: `${key}.docx`,
        format: 'docx',
        orgId: 'org-1',
        workspaceId: 'ws-1',
        baseVersion: 2,
        record: stored.intent,
        payload: stored.payload,
      },
      { documentClosed: closed, title: binding.title as string },
    )
    if (!closed) binding.state = 'dirty'
  })
  const service = {
    store: {
      root: storeRoot,
      readDir: async (dir: string) => bindings.get(basename(dir)) ?? null,
      readLastOwner: () => SCOPE,
      exists: () => true,
    },
    currentLocks: () => options.locks ?? [],
    syncCenterEngine: async () => ({
      kind: 'ok' as const,
      dispatcher,
      intents: queueIntents,
      drafts,
      pause,
    }),
    openSyncStore: async () => ({ kind: 'ok' }),
    pollSaveQueue: vi.fn(async () => undefined),
    pauseSending: async () => undefined,
    resumeSending: async () => undefined,
    cancelSave,
    openDocument: async () => ({ ok: true }),
  }
  const center = createWiredSyncCenter({
    ipcMain: { handle: () => undefined },
    userDataDir,
    service: service as never,
    store: {
      layer: {
        usage: async () => options.usage ?? { bytes: 1000, budgetBytes: 1 << 30 },
      },
      access: { scope: () => scope },
    } as never,
    accountStatus: () =>
      ({
        loggedIn: true,
        state: 'signed-in',
        org: { id: 'org-1', name: 'VietAnts' },
        ...options.status,
      }) as never,
    capabilityRead: async () => ({
      kind: 'ok',
      capabilities: {
        sync_write: true,
        sync_feed: true,
        ...(options.offlineLibrary === undefined
          ? {}
          : { offline_library: options.offlineLibrary }),
      },
    }),
    ...(options.lease
      ? {
          leaseState: async (documentId: string) =>
            ({ state: options.lease!(documentId) }) as never,
        }
      : {}),
    feedVerdict: options.feed ?? (() => ({ resynced: false, resyncFailed: false })),
    tickRuntime: options.tick ?? (async () => undefined),
    resetFeedResync: options.resetFeed ?? (async () => undefined),
    openPath: (path) => {
      opened.push(path)
      openPaths.add(path)
      return true
    },
    isPathOpen: (path) => openPaths.has(path),
    defaultSaveDir: () => base,
    writeClipboard: () => undefined,
    pickSaveDialog: async () => null,
    pushChanged: () => undefined,
    now: () => clock,
  })
  return {
    ...center,
    bindings,
    intents,
    drafts,
    cancelSave,
    opened,
    openPaths,
    userDataDir,
    pathOf,
    previewRoot: join(userDataDir, 'uniwork-drafts-preview'),
    advance: (ms: number) => {
      clock += ms
    },
    setScope: (next: typeof SCOPE | null) => {
      scope = next
    },
  }
}

/** every file under `dir`, recursively ([] when it does not exist) */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath ?? (entry as { path: string }).path, entry.name))
}

describe('BE-1: the runtime poll verdict reaches the wired sync center', () => {
  it('an offline verdict shows the offline header and refuses syncNow / sendNow / recheck', async () => {
    const h = wired({ docs: [{ key: 'doc-1' }] })
    await h.notePoll(false)
    const snap = await h.controller.getSnapshot()
    expect(snap.header.status).toBe('offline')
    expect(snap.header.online).toBe(false)
    expect(await h.controller.syncNow()).toEqual({ ok: false, code: 'offline' })
    expect(await h.controller.sendNow('intent-doc-1')).toEqual({ ok: false, code: 'offline' })
    expect(await h.controller.recheck('intent-doc-1')).toEqual({ ok: false, code: 'offline' })
  })

  it('an online verdict sets lastSyncAt, and a pass with nothing to do changes nothing', async () => {
    const h = wired()
    expect((await h.controller.getSnapshot()).header.lastSyncAt).toBeUndefined()
    await h.notePoll(true)
    const online = await h.controller.getSnapshot()
    expect(online.header.status).toBe('online')
    expect(online.header.lastSyncAt).toBe(NOW_ISO)
    await h.notePoll(false)
    await h.notePoll(undefined)
    expect((await h.controller.getSnapshot()).header.status).toBe('offline')
  })

  it('a real SyncRuntime pass tells its listener, which drives notePoll (the wiring line)', async () => {
    const h = wired()
    const rt = runtimeHarness({
      pages: () => new FeedError({ kind: 'other', error: new UniworkDocError('network') }),
    })
    rt.runtime.onPollVerdict((online) => void h.notePoll(online))
    await rt.runtime.tick()
    await vi.waitFor(async () =>
      expect((await h.controller.getSnapshot()).header.status).toBe('offline'),
    )
    rt.fail = false
    await rt.runtime.tick()
    await vi.waitFor(async () =>
      expect((await h.controller.getSnapshot()).header.status).toBe('online'),
    )
  })

  it('wiring.ts hands the runtime verdict and the feed verdict to the sync center', () => {
    const source = readFileSync(join(__dirname, '..', 'src/main/uniwork-docs/wiring.ts'), 'utf8')
    expect(source).toContain('runtime.onPollVerdict((online) => void syncCenter.notePoll(online))')
    expect(source).toContain('feedVerdict: () => runtime.feedVerdict(),')
    expect(source).toContain('void syncCenter.noteAccount()')
  })
})

describe('BE-2: a store_newer lock is the S11 header on the wired path', () => {
  it('a store_newer lock outranks everything (status store_newer)', async () => {
    const h = wired({ locks: [{ reason: 'store_newer' }], docs: [{ key: 'doc-1' }] })
    await h.notePoll(false)
    expect((await h.controller.getSnapshot()).header.status).toBe('store_newer')
  })

  it('a keystore_locked lock is not store_newer', async () => {
    const h = wired({ locks: [{ reason: 'keystore_locked' }] })
    expect((await h.controller.getSnapshot()).header.status).toBe('online')
  })
})

describe('BE-7: the feed runtime verdict reaches header conditions 7 and 9', () => {
  it('a resync verdict reads resynced, a refused resync reads resync_failed', async () => {
    let verdict: SyncFeedVerdict = { resynced: true, resyncFailed: false }
    const h = wired({ feed: () => verdict })
    expect((await h.controller.getSnapshot()).header.status).toBe('resynced')
    verdict = { resynced: false, resyncFailed: true }
    expect((await h.controller.getSnapshot()).header.status).toBe('resync_failed')
    verdict = { resynced: false, resyncFailed: false }
    expect((await h.controller.getSnapshot()).header.status).toBe('online')
  })

  it('a real SyncRuntime reports resynced after a full resync and resyncFailed past the cap', async () => {
    const rt = runtimeHarness()
    const h = wired({ feed: () => rt.runtime.feedVerdict() })
    // first pass: no cursor yet, so the consumer rebuilds from a snapshot
    await rt.runtime.tick()
    expect(rt.runtime.feedVerdict()).toEqual({ resynced: true, resyncFailed: false })
    expect((await h.controller.getSnapshot()).header.status).toBe('resynced')
    // an incremental pass is not a resync
    await rt.runtime.tick()
    expect(rt.runtime.feedVerdict()).toEqual({ resynced: false, resyncFailed: false })

    // the cursor expired and every resync is refused (410 again)
    rt.expire = true
    for (let i = 0; i < FEED_RESYNC_FAILED_AFTER; i += 1) {
      expect(rt.runtime.feedVerdict().resyncFailed).toBe(false)
      rt.clock.ms += 2 * 60 * 60_000
      await rt.runtime.tick()
    }
    expect(rt.runtime.feedVerdict()).toEqual({ resynced: false, resyncFailed: true })
    expect((await h.controller.getSnapshot()).header.status).toBe('resync_failed')

    // a stop (sign-out, account switch) forgets it
    rt.runtime.stop()
    expect(rt.runtime.feedVerdict()).toEqual({ resynced: false, resyncFailed: false })
  })
})

describe('BE-3: a read-only draft preview never outlives its use', () => {
  async function openOne(h: ReturnType<typeof wired>) {
    await h.cancelSave(h.pathOf('doc-1'), true)
    const snap = await h.controller.getSnapshot()
    const row = snap.tabs.attention.find((r) => r.state === 'kept_draft')!
    expect(await h.controller.openDraft(row.id)).toEqual({ ok: true })
    const [file] = filesUnder(h.previewRoot)
    expect(file).toBeDefined()
    expect(readFileSync(file!)).toEqual(Buffer.from([1, 2, 3, 4, 5]))
    return { row, file: file! }
  }

  it('discarding the draft deletes its preview', async () => {
    const h = wired({ docs: [{ key: 'doc-1' }] })
    const { row, file } = await openOne(h)
    expect(await h.controller.discardDraft(row.id)).toEqual({ ok: true })
    expect(existsSync(file)).toBe(false)
    expect(filesUnder(h.previewRoot)).toEqual([])
  })

  it('a closed preview window is swept on the next poll (after the grace), an open one is kept', async () => {
    const h = wired({ docs: [{ key: 'doc-1' }] })
    const { file } = await openOne(h)
    h.advance(DRAFT_PREVIEW_CLOSE_GRACE_MS + 1)
    await h.notePoll(true)
    expect(existsSync(file)).toBe(true)
    h.openPaths.delete(file)
    await h.notePoll(true)
    expect(existsSync(file)).toBe(false)
  })

  it('a preview whose window has not opened yet survives the grace period', async () => {
    const h = wired({ docs: [{ key: 'doc-1' }] })
    const { file } = await openOne(h)
    h.openPaths.delete(file)
    await h.sweepPreviews()
    expect(existsSync(file)).toBe(true)
  })

  it('sign-out and a switch to another account delete every preview', async () => {
    const h = wired({ docs: [{ key: 'doc-1' }] })
    await h.noteAccount()
    const { file } = await openOne(h)
    // same account again (an org change, a token refresh): nothing goes
    await h.noteAccount()
    expect(existsSync(file)).toBe(true)
    h.setScope(null)
    await h.noteAccount()
    expect(existsSync(file)).toBe(false)

    const other = wired({ docs: [{ key: 'doc-1' }] })
    await other.noteAccount()
    const second = await openOne(other)
    other.setScope({ deploymentId: 'dep-1', accountId: 'acc-2' })
    await other.noteAccount()
    expect(existsSync(second.file)).toBe(false)
  })

  it('startup sweeps the previews a previous run left behind', async () => {
    const stale = join(base, 'userData', 'uniwork-drafts-preview', 'old-session', 'd1')
    mkdirSync(stale, { recursive: true })
    writeFileSync(join(stale, 'Plan.docx'), 'plaintext')
    const h = wired({ docs: [{ key: 'doc-1' }] })
    await openOne(h)
    expect(existsSync(join(stale, 'Plan.docx'))).toBe(false)
    expect(filesUnder(h.previewRoot)).toHaveLength(1)
  })
})

describe("BE-4: cancelSave goes through the service and keeps an open window's work", () => {
  it('an open document: service cancel with closed=false, no kept draft, the chip goes dirty', async () => {
    const h = wired({ docs: [{ key: 'doc-1' }] })
    h.openPaths.add(h.pathOf('doc-1'))
    expect(await h.controller.cancelSave('intent-doc-1')).toEqual({ ok: true })
    expect(h.cancelSave).toHaveBeenCalledWith(h.pathOf('doc-1'), false)
    expect(h.intents.has('doc-1')).toBe(false)
    expect(await h.drafts.list('doc-1')).toEqual([])
    expect(h.bindings.get('doc-1')!.state).toBe('dirty')
  })

  it('a closed document: service cancel with closed=true, the snapshot becomes a kept draft', async () => {
    const h = wired({ docs: [{ key: 'doc-1' }] })
    expect(await h.controller.cancelSave('intent-doc-1')).toEqual({ ok: true })
    expect(h.cancelSave).toHaveBeenCalledWith(h.pathOf('doc-1'), true)
    expect(h.intents.has('doc-1')).toBe(false)
    const kept = await h.drafts.list('doc-1')
    expect(kept).toHaveLength(1)
    expect(kept[0]!.snapshot).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
  })

  it('a closed document at the draft cap is refused draft_cap and the intent stays as it was', async () => {
    const h = wired({ docs: [{ key: 'doc-1' }] })
    for (const id of ['a', 'b', 'c']) {
      await h.drafts.keep('doc-1', new Uint8Array([9]), { id, createdAt: NOW_ISO })
    }
    expect(await h.controller.cancelSave('intent-doc-1')).toEqual({ ok: false, code: 'draft_cap' })
    expect(h.intents.get('doc-1')!.intent.state).toBe('queued')
    expect(await h.drafts.list('doc-1')).toHaveLength(3)
  })

  it('a state that cannot be cancelled is busy, open or closed', async () => {
    const h = wired({ docs: [{ key: 'doc-1', state: 'committing' }] })
    expect(await h.controller.cancelSave('intent-doc-1')).toEqual({ ok: false, code: 'busy' })
    h.openPaths.add(h.pathOf('doc-1'))
    expect(await h.controller.cancelSave('intent-doc-1')).toEqual({ ok: false, code: 'busy' })
    expect(h.intents.get('doc-1')!.intent.state).toBe('committing')
  })
})

describe('BE-5 / BE-6 on the wired path', () => {
  it('a blocked intent without a known cause has no reason and is never discardable', async () => {
    const h = wired({ docs: [{ key: 'doc-1', state: 'blocked' }] })
    const row = (await h.controller.getSnapshot()).tabs.attention[0]!
    expect(row.state).toBe('blocked')
    expect(row.blockedReason).toBeUndefined()
    expect(await h.controller.discardDraft('intent-doc-1')).toEqual({ ok: false, code: 'busy' })
    expect(h.intents.get('doc-1')!.intent.state).toBe('blocked')
  })

  it('a blocked intent the queue filed as forbidden reads permission_revoked (discardable)', async () => {
    const h = wired({ docs: [{ key: 'doc-1', state: 'blocked', lastError: 'forbidden' }] })
    const row = (await h.controller.getSnapshot()).tabs.attention[0]!
    expect(row.blockedReason).toBe('permission_revoked')
  })
})

describe('RES-3: the lease manager produces lease_expired / clock_rollback on the wired path', () => {
  it('a blocked intent whose lease expired reads lease_expired, libraryOff only when offline_library is off', async () => {
    const lease = (id: string) => (id === 'doc-1' ? 'expired' : 'valid')
    const on = wired({ docs: [{ key: 'doc-1', state: 'blocked' }], lease })
    const row = (await on.controller.getSnapshot()).tabs.attention[0]!
    expect(row.blockedReason).toBe('lease_expired')
    expect(row.libraryOff).toBeUndefined()
    const off = wired({ docs: [{ key: 'doc-1', state: 'blocked' }], lease, offlineLibrary: false })
    const offRow = (await off.controller.getSnapshot()).tabs.attention[0]!
    expect(offRow.blockedReason).toBe('lease_expired')
    expect(offRow.libraryOff).toBe(true)
  })

  it('a blocked intent behind a clock rollback reads clock_rollback (never libraryOff)', async () => {
    const h = wired({
      docs: [{ key: 'doc-1', state: 'blocked' }],
      lease: () => 'clock_rollback',
      offlineLibrary: false,
    })
    const row = (await h.controller.getSnapshot()).tabs.attention[0]!
    expect(row.blockedReason).toBe('clock_rollback')
    expect(row.libraryOff).toBeUndefined()
  })

  it("the queue's own known cause wins, a usable lease adds nothing, and a lease never changes the row state", async () => {
    const h = wired({
      docs: [
        { key: 'doc-1', state: 'blocked', lastError: 'forbidden' },
        { key: 'doc-2', state: 'blocked' },
        { key: 'doc-3', state: 'queued' },
      ],
      lease: (id) => (id === 'doc-2' ? 'valid' : 'expired'),
    })
    const snap = await h.controller.getSnapshot()
    const rows = [...snap.tabs.attention, ...snap.tabs.pending]
    expect(rows.find((r) => r.documentId === 'doc-1')!.blockedReason).toBe('permission_revoked')
    expect(rows.find((r) => r.documentId === 'doc-2')!.blockedReason).toBeUndefined()
    const queued = rows.find((r) => r.documentId === 'doc-3')!
    expect(queued.state).toBe('queued')
    expect(queued.blockedReason).toBeUndefined()
  })

  it('wiring.ts hands the runtime lease manager to the sync center', () => {
    const source = readFileSync(join(__dirname, '..', 'src/main/uniwork-docs/wiring.ts'), 'utf8')
    expect(source).toContain(
      'leaseState: (documentId) => runtime.leases.effectiveState(documentId),',
    )
  })
})

/** a real SyncRuntime over a real store layer; the feed client is scripted */
function runtimeHarness(options: { pages?: () => FeedPage | Error } = {}) {
  const safeStorage = createLockableSafeStorage()
  const clock = { ms: 1_700_000_000_000 }
  const layer = createStoreLayer({
    root: join(base, 'records'),
    keys: createSafeStorageKeyProvider({ safeStorage, dir: join(base, 'keys') }),
    budgetBytes: 1 << 20,
    clock: () => clock.ms,
  })
  layer.register(INTENT_STORE_REGISTRATION)
  layer.register(FEED_CURSORS_REGISTRATION)
  layer.register(DOC_INDEX_REGISTRATION)
  const state: {
    fail: boolean
    expire: boolean
    gate?: Promise<void>
    /** requests still to let through before one parks at the gate */
    skip: number
    onHeld?: () => void
  } = { fail: true, expire: false, skip: 0 }
  const client: FeedClient = {
    async listChanges() {
      // the server's answer is decided when the request is made, a held request still gets it
      const refused = state.expire
      if (state.gate) {
        if (state.skip > 0) state.skip -= 1
        else {
          state.onHeld?.()
          await state.gate
        }
      }
      if (refused) throw new FeedError({ kind: 'cursor_expired' })
      const scripted = state.fail ? options.pages?.() : undefined
      if (scripted instanceof Error) throw scripted
      return (
        scripted ?? {
          phase: 'snapshot',
          hasMore: false,
          expiresAt: '2026-10-12T00:00:00Z',
          changes: [],
          nextCursor: `c-${clock.ms}`,
        }
      )
    },
  }
  const runtime = new SyncRuntime({
    store: {
      scope: () => SCOPE,
      open: async () => {
        const open = await layer.open(SCOPE)
        return open.kind === 'ok'
          ? { kind: 'ok', records: (name: string) => open.store.records(name) }
          : open
      },
      forget: () => undefined,
    },
    targets: { orgs: () => ['org-1'], workspaces: async () => ['ws-1'] },
    capability: async () => ({
      kind: 'ok',
      capabilities: { ...NEVER_READ_CAPABILITIES, sync_feed: true },
      source: 'fresh',
    }),
    client: () => client,
    keepDraft: async () => false,
    clock: { now: () => clock.ms },
  } as never)
  return {
    runtime,
    clock,
    set fail(next: boolean) {
      state.fail = next
    },
    set expire(next: boolean) {
      state.expire = next
    },
    /**
     * park the feed request after `skip` others until `release` is called (a pass left in
     * flight); `reached` settles once a request is parked at the gate
     */
    hold(skip = 0): { release: () => void; reached: Promise<void> } {
      state.skip = skip
      let release = () => undefined as void
      state.gate = new Promise<void>((resolve) => {
        release = () => {
          state.gate = undefined
          resolve()
        }
      })
      const reached = new Promise<void>((resolve) => {
        state.onHeld = resolve
      })
      return { release, reached }
    },
  }
}

describe('BE-2n-2: a read-only draft preview is not a recent file', () => {
  it('the path a preview opens through is recognised, a normal document path is not', async () => {
    const h = wired({ docs: [{ key: 'doc-1' }] })
    await h.cancelSave(h.pathOf('doc-1'), true)
    const row = (await h.controller.getSnapshot()).tabs.attention.find(
      (r) => r.state === 'kept_draft',
    )!
    expect(await h.controller.openDraft(row.id)).toEqual({ ok: true })
    const [file] = filesUnder(h.previewRoot)
    expect(file).toBeDefined()
    // the very path the shell was asked to open is the one the recents guard must skip
    expect(h.openPaths.has(file!)).toBe(true)
    expect(isDraftPreviewPath(h.userDataDir, file!)).toBe(true)
    expect(isDraftPreviewPath(h.userDataDir, h.pathOf('doc-1'))).toBe(false)
    expect(isDraftPreviewPath(h.userDataDir, h.previewRoot)).toBe(false)
    expect(
      isDraftPreviewPath(h.userDataDir, join(h.userDataDir, 'uniwork-drafts-preview-x', 'a.docx')),
    ).toBe(false)
  })

  it('every recents write in the shell main process goes through the preview guard', () => {
    const source = readFileSync(join(__dirname, '..', 'src/main/index.ts'), 'utf8')
    expect(source).toContain('recordRecentFile as recordRecentFileRaw,')
    const guard = source.slice(source.indexOf('function recordRecentFile('))
    expect(guard.slice(0, guard.indexOf('function routeDocumentPath('))).toContain(
      "if (isDraftPreviewPath(app.getPath('userData'), filePath)) return",
    )
    // the raw recorder is called from the guard only
    expect(source.match(/recordRecentFileRaw\(/g)).toHaveLength(1)
  })
})

describe('BE-2n-3: no verdict yet is not a synced time', () => {
  it('a signed-in session with no verdict has no sync time, and a no-verdict pass sets none', async () => {
    const h = wired()
    const before = (await h.controller.getSnapshot()).header
    expect(before.lastSyncAt).toBeUndefined()
    expect(before.status).toBe('online')
    await h.notePoll(undefined)
    const after = (await h.controller.getSnapshot()).header
    expect(after.lastSyncAt).toBeUndefined()
    expect(after.status).toBe('online')
  })
})

describe('W10: "Đồng bộ ngay" restarts a feed stopped on refused resyncs, even offline', () => {
  /** a real SyncRuntime driven past the refusal cap, wired to the center like production */
  async function stoppedFeed(pages?: () => FeedPage | Error) {
    const rt = runtimeHarness(pages ? { pages } : {})
    const tick = vi.fn(() => rt.runtime.tick())
    const h = wired({
      feed: () => rt.runtime.feedVerdict(),
      tick,
      resetFeed: () => rt.runtime.resetFeedResync(),
    })
    rt.runtime.onPollVerdict((online) => void h.notePoll(online))
    await rt.runtime.tick()
    rt.expire = true
    for (let i = 0; i < FEED_RESYNC_FAILED_AFTER; i += 1) {
      rt.clock.ms += 2 * 60 * 60_000
      await rt.runtime.tick()
    }
    await vi.waitFor(async () =>
      expect((await h.controller.getSnapshot()).header.online).toBe(false),
    )
    const stopped = (await h.controller.getSnapshot()).header
    // the refused resyncs are reported as offline (deferred to G5-13), and the flag is still set
    expect(stopped.resyncFailed).toBe(true)
    tick.mockClear()
    return { rt, h, tick }
  }

  it('does not refuse as offline: it resets the refusal and backoff and runs a pass that recovers', async () => {
    const { rt, h, tick } = await stoppedFeed()
    // the server answers again, but the consumer is still inside its backoff window
    rt.expire = false
    expect(await h.controller.syncNow()).toEqual({ ok: true })
    expect(tick).toHaveBeenCalledTimes(1)
    const after = (await h.controller.getSnapshot()).header
    expect(rt.runtime.feedVerdict().resyncFailed).toBe(false)
    expect(after.online).toBe(true)
    expect(after.resyncFailed).toBe(false)
    expect(after.status).toBe('online')
  })

  it('a device that is really offline still gets the normal offline answer and line', async () => {
    let down = false
    const { rt, h, tick } = await stoppedFeed(() =>
      down
        ? new FeedError({ kind: 'other', error: new UniworkDocError('network') })
        : (undefined as never),
    )
    rt.expire = false
    down = true
    expect(await h.controller.syncNow()).toEqual({ ok: false, code: 'offline' })
    expect(tick).toHaveBeenCalledTimes(1)
    const after = (await h.controller.getSnapshot()).header
    expect(after.status).toBe('offline')
    expect(after.resyncFailed).toBe(false)
    // no resync is stuck any more, so the next click on plain offline is refused up front
    tick.mockClear()
    expect(await h.controller.syncNow()).toEqual({ ok: false, code: 'offline' })
    expect(tick).not.toHaveBeenCalled()
  })

  it('BE-3n-2: a click while a pass is in flight runs a fresh pass after the reset and ends online', async () => {
    const { rt, h, tick } = await stoppedFeed()
    // a pass is already in flight and will be refused (the server answered before it recovered)
    rt.clock.ms += 2 * 60 * 60_000
    // the pass's first request finds the cursor expired; its resync request is the one held,
    // so the refusal is still to come when the click lands
    const { release, reached } = rt.hold(1)
    const inFlight = rt.runtime.tick()
    await reached
    // the server answers again, but the in-flight pass has its refusal already on the way
    rt.expire = false
    const click = h.controller.syncNow()
    release()
    await inFlight
    expect(await click).toEqual({ ok: true })
    // the click did not join the in-flight pass: it ran its own after the reset
    expect(tick).toHaveBeenCalledTimes(1)
    expect(rt.runtime.feedVerdict().resyncFailed).toBe(false)
    const after = (await h.controller.getSnapshot()).header
    expect(after.online).toBe(true)
    expect(after.resyncFailed).toBe(false)
    expect(after.status).toBe('online')
  })

  it('wiring.ts hands the runtime reset to the sync center', () => {
    const source = readFileSync(join(__dirname, '..', 'src/main/uniwork-docs/wiring.ts'), 'utf8')
    expect(source).toContain('resetFeedResync: () => runtime.resetFeedResync(),')
  })
})

describe('SIZE-be-d1-8: wired Sync Center carries failedReason and maxBytes from a stored failed too_large record', () => {
  it('maps a stored failed record with lastError too_large and maxBytes onto the attention row even when the binding carries no maxBytes', async () => {
    const h = wired({
      docs: [
        {
          key: 'doc-too-large',
          state: 'failed',
          lastError: 'too_large',
          maxBytes: 209_715_200,
        },
      ],
    })
    const snapshot = await h.controller.getSnapshot()
    const row = snapshot.tabs.attention.find((item) => item.documentKey === 'doc-too-large')
    expect(row).toBeDefined()
    expect(row).toMatchObject({
      documentKey: 'doc-too-large',
      state: 'failed',
      failedReason: 'too_large',
      maxBytes: 209_715_200,
    })
  })
})
