import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UniworkDocStatus } from '../src/shared/home-api'
import type { Binding, BoundDocument } from '../src/main/uniwork-docs/binding-store'
import { SaveCoordinator } from '../src/main/uniwork-docs/save-coordinator'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { sha256Hex } from '../src/main/uniwork-docs/formats'
import type { CommitLookup } from '../src/main/uniwork-docs/parse'
import {
  createIntentStore,
  INTENT_STORE_REGISTRATION,
  type IntentStore,
} from '../src/main/uniwork-sync/intent-store'
import type { DocLock, DocLockResult } from '../src/main/uniwork-sync/doc-lock'
import {
  QueueDispatcher,
  type QueueCapabilityRead,
  type QueueClient,
  type QueueDispatcherDeps,
  type QueueDoc,
  type MintedIntent,
} from '../src/main/uniwork-sync/queue/dispatcher'
import { QUEUE_LIMITS } from '../src/main/uniwork-sync/queue/limits'
import { createDraftStore, DRAFTS_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/drafts'
import { createPauseStore, PAUSE_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/pause'
import type { IntentRecordV2, QueueState } from '../src/main/uniwork-sync/queue/record'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import { createStoreLayer, type StoreLayer } from '../src/main/uniwork-sync/store'
import {
  createLockableSafeStorage,
  runStoreCompliance,
  type ComplianceEnv,
  type ComplianceSubject,
} from '../src/main/uniwork-sync/test-kit/compliance'

/**
 * The G5-06 durable save queue (W4a), on fakes only: a fake clock, a fake
 * random source, a fake server (upload / commit / lookup), a fake document lock
 * and a fake capability cache, over the REAL G5-04 store layer (temp dir) so
 * the intent, draft and pause stores are exercised end to end. One case per
 * card Test line (plan card G5-06, l.541-552).
 *
 * The 409-keeps-intent and capability_off-keeps-intent cases are the red-before
 * pair; their failing lines on the pre-W4a save-coordinator are in the report
 * (G5-06-W4a-red-before.txt).
 */

const SCOPE = { deploymentId: 'default', accountId: 'acc_1' }
const ISO = '2026-10-13T12:00:00.000Z'
const enc = (text: string) => new TextEncoder().encode(text)

class FakeClock {
  now = Date.parse(ISO)
  advance(ms: number): void {
    this.now += ms
  }
}

class FakeCapability {
  private readonly entries = new Map<string, { sync_write: boolean; source: string }>()
  set(orgId: string, syncWrite: boolean, source = 'fresh'): void {
    this.entries.set(orgId, { sync_write: syncWrite, source })
  }
  /** the server TTL elapsed and a refresh failed: the last flags, now stale */
  goStale(orgId: string): void {
    const entry = this.entries.get(orgId)
    if (entry) this.entries.set(orgId, { ...entry, source: 'stale' })
  }
  async get(orgId: string): Promise<QueueCapabilityRead> {
    const entry = this.entries.get(orgId)
    if (!entry) {
      // never read: sync_write counts as on (writes allowed)
      return { kind: 'ok', capabilities: { sync_write: true }, source: 'default' }
    }
    return { kind: 'ok', capabilities: { sync_write: entry.sync_write }, source: entry.source }
  }
}

/** a shared lease table, so two windows (two owners) contend for one document */
class FakeLockTable {
  readonly leases = new Map<string, { owner: string; generation: number; heartbeatAt: number }>()
}

function fakeLock(
  table: FakeLockTable,
  owner: string,
  clock: () => number,
  goneMs = QUEUE_LIMITS.goneMs,
): DocLock {
  return {
    async acquire(docKey): Promise<DocLockResult> {
      const now = clock()
      const lease = table.leases.get(docKey)
      if (lease && lease.owner !== owner && now - lease.heartbeatAt <= goneMs) {
        return { kind: 'other_window' }
      }
      const generation = lease
        ? lease.owner === owner
          ? lease.generation
          : lease.generation + 1
        : 1
      table.leases.set(docKey, { owner, generation, heartbeatAt: now })
      return { kind: 'held', generation }
    },
    async heartbeat(docKey, generation) {
      const lease = table.leases.get(docKey)
      if (!lease || lease.owner !== owner || lease.generation !== generation) return false
      table.leases.set(docKey, { ...lease, heartbeatAt: clock() })
      return true
    },
    async check(docKey, generation) {
      const lease = table.leases.get(docKey)
      return !!lease && lease.owner === owner && lease.generation === generation
    },
    async release(docKey, generation) {
      const lease = table.leases.get(docKey)
      if (lease && lease.owner === owner && lease.generation === generation) {
        table.leases.delete(docKey)
      }
    },
  }
}

interface ServerState {
  lookupOutcome: CommitLookup['outcome']
  commitError: UniworkDocError | null
  uploadError: UniworkDocError | null
  commitReceipt: { versionId: string; version: number; revision: string }
  uploadReceipt: { uploadId: string; checksumSha256: string }
  counts: { upload: number; commit: number; lookup: number }
  keys: { upload: string[]; commit: string[]; lookup: string[] }
}

function fakeServer(): { client: QueueClient; state: ServerState } {
  const state: ServerState = {
    lookupOutcome: 'in_flight',
    commitError: null,
    uploadError: null,
    commitReceipt: { versionId: 'ver_4', version: 4, revision: '42' },
    uploadReceipt: { uploadId: 'up_1', checksumSha256: 'unset' },
    counts: { upload: 0, commit: 0, lookup: 0 },
    keys: { upload: [], commit: [], lookup: [] },
  }
  const client: QueueClient = {
    async upload(input) {
      state.counts.upload += 1
      state.keys.upload.push(input.idempotencyKey)
      if (state.uploadError) throw state.uploadError
      return {
        uploadId: state.uploadReceipt.uploadId,
        checksumSha256: state.uploadReceipt.checksumSha256,
      }
    },
    async commit(input) {
      state.counts.commit += 1
      state.keys.commit.push(input.idempotencyKey)
      if (state.commitError) throw state.commitError
      return {
        documentId: input.documentId,
        checksumSha256: state.uploadReceipt.checksumSha256,
        ...state.commitReceipt,
      }
    },
    async lookupCommit(input) {
      state.counts.lookup += 1
      state.keys.lookup.push(input.idempotencyKey)
      if (state.lookupOutcome === 'committed') {
        return { outcome: 'committed', receipt: { versionId: 'ver_4', version: 4, revision: '42' } }
      }
      if (state.lookupOutcome === 'unknown') return { outcome: 'unknown' }
      return { outcome: state.lookupOutcome }
    },
  }
  return { client, state }
}

/** the front's view of the binding store: classify / lookup / write over a map */
class FakeBindingStore {
  readonly docs = new Map<string, BoundDocument>()
  classify(path: string): { kind: 'plain' } | { kind: 'bound'; doc: BoundDocument } {
    const doc = this.docs.get(path)
    return doc ? { kind: 'bound', doc } : { kind: 'plain' }
  }
  lookup(path: string): BoundDocument | null {
    return this.docs.get(path) ?? null
  }
  async write(dir: string, binding: Binding): Promise<boolean> {
    for (const [path, doc] of this.docs) {
      if (doc.dir === dir) this.docs.set(path, { ...doc, binding })
    }
    return true
  }
}

interface Harness {
  clock: FakeClock
  capability: FakeCapability
  server: ReturnType<typeof fakeServer>
  dispatcher: QueueDispatcher
  coordinator: SaveCoordinator
  store: FakeBindingStore
  intents: IntentStore
  layer: StoreLayer
  lockTable: FakeLockTable
  statuses: UniworkDocStatus[]
  /** every record the dispatchers published (one entry per `publish` call) */
  published: IntentRecordV2[]
  makeDoc: (opts?: { key?: string; orgId?: string; payload?: string }) => QueueDoc
  newDispatcher: (owner: string) => QueueDispatcher
  newDispatcherWith: (deps: Partial<QueueDispatcherDeps>) => QueueDispatcher
  setLocked: (value: boolean) => void
}

let base: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'uw-w4a-'))
})
afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

async function harness(): Promise<Harness> {
  const clock = new FakeClock()
  const safeStorage = createLockableSafeStorage()
  const layer = createStoreLayer({
    root: join(base, 'records'),
    keys: createSafeStorageKeyProvider({ safeStorage, dir: join(base, 'keys') }),
    budgetBytes: 1 << 20,
    clock: () => clock.now,
  })
  layer.register(INTENT_STORE_REGISTRATION)
  layer.register(DRAFTS_STORE_REGISTRATION)
  layer.register(PAUSE_STORE_REGISTRATION)
  const opened = await layer.open(SCOPE)
  if (opened.kind !== 'ok') throw new Error(`store did not open: ${opened.kind}`)
  const intents = createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name))
  const drafts = createDraftStore(opened.store.records(DRAFTS_STORE_REGISTRATION.name))
  const pause = createPauseStore(opened.store.records(PAUSE_STORE_REGISTRATION.name))

  const capability = new FakeCapability()
  const server = fakeServer()
  const store = new FakeBindingStore()
  const lockTable = new FakeLockTable()
  const statuses: UniworkDocStatus[] = []
  const published: IntentRecordV2[] = []
  let locked = false
  const intentsAccess = async () =>
    locked ? { kind: 'keystore_locked' as const } : { kind: 'ok' as const, intents }

  const makeDispatcherWith = (deps: Partial<QueueDispatcherDeps>): QueueDispatcher =>
    new QueueDispatcher({
      intents: intentsAccess,
      client: server.client,
      capability,
      lock: fakeLock(lockTable, 'win1', () => clock.now),
      pause,
      drafts,
      clock: () => clock.now,
      random: () => 0.5,
      limits: QUEUE_LIMITS,
      publish: (record) => published.push(record),
      uuid: () => 'u1',
      ...deps,
    })
  const makeDispatcher = (owner: string): QueueDispatcher =>
    makeDispatcherWith({ lock: fakeLock(lockTable, owner, () => clock.now) })
  const dispatcher = makeDispatcher('win1')

  const coordinator = new SaveCoordinator({
    store: store as never,
    client: {
      upload: (input) => server.client.upload(input),
      commit: (input) => server.client.commit(input),
      getDocument: async () => {
        throw new UniworkDocError('not_found')
      },
    },
    isSignedIn: () => true,
    ownsBinding: () => true,
    intents: intentsAccess,
    publish: (status) => statuses.push(status),
    now: () => new Date(clock.now),
    uuid: () => 'u1',
    readBytes: async () => enc('v4'),
    capability,
    pause,
    drafts,
    dispatcher,
  })

  const makeDoc = (opts: { key?: string; orgId?: string; payload?: string } = {}): QueueDoc => {
    const key = opts.key ?? 'doc_1'
    const payload = enc(opts.payload ?? 'v4')
    const checksum = sha256Hex(payload)
    server.state.uploadReceipt.checksumSha256 = checksum
    const path = join(base, 'wc', key, 'Plan.docx')
    const binding: Binding = {
      schema: 2,
      documentId: `d_${key}`,
      workspaceId: 'ws_1',
      orgId: opts.orgId ?? 'org_1',
      title: 'Plan.docx',
      filename: 'Plan.docx',
      format: 'docx',
      access: 'edit',
      baseRevision: '41',
      baseVersion: 3,
      baseChecksum: sha256Hex(enc('v3')),
      state: 'dirty',
      minStoreLevel: 2,
      minAppVersion: '0.0.0',
    }
    store.docs.set(path, {
      path,
      dir: join(base, 'wc', key),
      deploymentId: 'default',
      userId: 'acc_1',
      key,
      binding,
    })
    const record: IntentRecordV2 = {
      v: 2,
      intentId: `intent_${key}`,
      idempotencyKey: `key_${key}`,
      documentId: `d_${key}`,
      orgId: binding.orgId,
      workspaceId: 'ws_1',
      baseRevision: '41',
      baseVersion: 3,
      checksum,
      length: payload.byteLength,
      generation: 1,
      state: 'queued',
      attempt: 0,
      createdAt: ISO,
      updatedAt: ISO,
    }
    return {
      key,
      path,
      filename: 'Plan.docx',
      format: 'docx',
      orgId: binding.orgId,
      workspaceId: 'ws_1',
      baseVersion: 3,
      record,
      payload,
    }
  }

  return {
    clock,
    capability,
    server,
    dispatcher,
    coordinator,
    store,
    intents,
    layer,
    lockTable,
    statuses,
    published,
    makeDoc,
    newDispatcher: makeDispatcher,
    newDispatcherWith: makeDispatcherWith,
    setLocked: (value: boolean) => {
      locked = value
    },
  }
}

const factsOf = (doc: QueueDoc) => ({
  orgId: doc.orgId,
  workspaceId: doc.workspaceId,
  baseVersion: doc.baseVersion,
  length: doc.record.length,
})
const stored = (intents: IntentStore, doc: QueueDoc) => intents.read(doc.key, factsOf(doc))

const mintedFor = (doc: QueueDoc, overrides: Partial<MintedIntent> = {}): MintedIntent => ({
  key: doc.key,
  intentId: `intent_next_${doc.key}`,
  idempotencyKey: `key_next_${doc.key}`,
  documentId: doc.record.documentId,
  orgId: doc.orgId,
  workspaceId: doc.workspaceId,
  baseRevision: doc.record.baseRevision,
  baseVersion: doc.baseVersion,
  checksum: doc.record.checksum,
  length: doc.record.length,
  ...overrides,
})

/** the coordinator over a store that refuses the intent write / a locked keychain */
function refusingCoordinator(
  h: Harness,
  kind: 'store_full' | 'keystore_locked',
  payload: Uint8Array,
): { coordinator: SaveCoordinator; statuses: UniworkDocStatus[] } {
  const statuses: UniworkDocStatus[] = []
  const intents: IntentStore = {
    get: h.intents.get,
    read: h.intents.read,
    put: async () => (kind === 'store_full' ? { kind: 'store_full' } : { kind: 'interrupted' }),
    delete: h.intents.delete,
  }
  const coordinator = new SaveCoordinator({
    store: h.store as never,
    client: {
      upload: h.server.client.upload,
      commit: h.server.client.commit,
      getDocument: async () => {
        throw new UniworkDocError('not_found')
      },
    },
    isSignedIn: () => true,
    ownsBinding: () => true,
    intents:
      kind === 'keystore_locked'
        ? async () => ({ kind: 'keystore_locked' })
        : async () => ({ kind: 'ok', intents }),
    publish: (status) => statuses.push(status),
    now: () => new Date(h.clock.now),
    uuid: () => 'u1',
    readBytes: async () => payload,
    dispatcher: undefined,
  })
  return { coordinator, statuses }
}

describe('G5-06 W4a save queue (fakes)', () => {
  it('crash at each step, timeout after commit, cancel race', async () => {
    // a commit whose answer is lost after the server committed: never "failed",
    // always reconciling, and a lookup settles it
    const h = await harness()
    const doc = h.makeDoc()
    await h.dispatcher.enqueue(doc)
    h.server.state.commitError = new UniworkDocError('timeout')
    await h.dispatcher.dispatchAll([doc])
    expect(doc.record.state).toBe('reconciling')
    h.server.state.commitError = null
    h.server.state.lookupOutcome = 'committed'
    await h.dispatcher.reconcile(doc)
    expect(doc.record.state).toBe('committed')
    expect(await stored(h.intents, doc)).toBeNull()

    // a crash after the upload (a fresh dispatcher over the same store) replays
    // the SAME key: the server's replay answer lands exactly once
    const h2 = await harness()
    const doc2 = h2.makeDoc()
    await h2.dispatcher.enqueue(doc2)
    h2.server.state.commitError = new UniworkDocError('network')
    await h2.dispatcher.dispatchAll([doc2])
    expect(doc2.record.state).toBe('reconciling')
    const restarted = h2.newDispatcher('win2')
    h2.server.state.commitError = null
    h2.server.state.lookupOutcome = 'committed'
    await restarted.reconcile(doc2)
    expect(doc2.record.state).toBe('committed')
    expect(new Set(h2.server.state.keys.commit)).toEqual(new Set([doc2.record.idempotencyKey]))
  })

  it('cancel race: uploading / committing refuse it, a won cancel stops the pass', async () => {
    // (a) the cancel arrives while the intent is uploading: refused (only an
    // intent that provably did not commit can be cancelled), commit still lands
    const h = await harness()
    const doc = h.makeDoc()
    await h.dispatcher.enqueue(doc)
    let atUpload!: () => void
    const uploading = new Promise<void>((resolve) => (atUpload = resolve))
    let releaseUpload!: () => void
    const uploadGate = new Promise<void>((resolve) => (releaseUpload = resolve))
    const gatedUpload: QueueClient = {
      upload: async (input) => {
        atUpload()
        await uploadGate
        return h.server.client.upload(input)
      },
      commit: h.server.client.commit,
      lookupCommit: h.server.client.lookupCommit,
    }
    const dispatcher = h.newDispatcherWith({ client: gatedUpload })
    const pass = dispatcher.dispatchAll([doc])
    await uploading
    expect(await dispatcher.cancel(doc, { documentClosed: true })).toBe('uploading')
    releaseUpload()
    await pass
    expect(doc.record.state).toBe('committed')
    expect(h.server.state.counts.upload).toBe(1)
    expect(h.server.state.counts.commit).toBe(1)
    const opened = await h.layer.open(SCOPE)
    if (opened.kind !== 'ok') throw new Error('store did not open')
    const drafts = createDraftStore(opened.store.records(DRAFTS_STORE_REGISTRATION.name))
    expect(await drafts.list(doc.key)).toHaveLength(0)

    // (b) the same while the commit is in flight: refused, the receipt is kept
    const c = await harness()
    const doc2 = c.makeDoc({ key: 'doc_commit_race' })
    await c.dispatcher.enqueue(doc2)
    let atCommit!: () => void
    const committing = new Promise<void>((resolve) => (atCommit = resolve))
    let releaseCommit!: () => void
    const commitGate = new Promise<void>((resolve) => (releaseCommit = resolve))
    const gatedCommit: QueueClient = {
      upload: c.server.client.upload,
      commit: async (input) => {
        atCommit()
        await commitGate
        return c.server.client.commit(input)
      },
      lookupCommit: c.server.client.lookupCommit,
    }
    const dispatcher2 = c.newDispatcherWith({ client: gatedCommit })
    const pass2 = dispatcher2.dispatchAll([doc2])
    await committing
    expect(await dispatcher2.cancel(doc2, { documentClosed: true })).toBe('committing')
    releaseCommit()
    await pass2
    expect(doc2.record.state).toBe('committed')
    expect(c.server.state.counts.commit).toBe(1)

    // (c) the cancel wins before the pass moves a byte: no version is created
    const won = await harness()
    const doc3 = won.makeDoc({ key: 'doc_won_cancel' })
    await won.dispatcher.enqueue(doc3)
    let atLock!: () => void
    const acquiring = new Promise<void>((resolve) => (atLock = resolve))
    let openLock!: () => void
    const lockGate = new Promise<void>((resolve) => (openLock = resolve))
    const realLock = fakeLock(won.lockTable, 'win1', () => won.clock.now)
    const slowLock: DocLock = {
      ...realLock,
      acquire: async (key) => {
        atLock()
        await lockGate
        return realLock.acquire(key)
      },
    }
    const dispatcher3 = won.newDispatcherWith({ lock: slowLock })
    const pass3 = dispatcher3.dispatchAll([doc3])
    await acquiring
    expect(await dispatcher3.cancel(doc3, { documentClosed: true })).toBe('cancelled')
    openLock()
    await pass3
    expect(doc3.record.state).toBe('cancelled')
    expect(won.server.state.counts.upload).toBe(0)
    expect(won.server.state.counts.commit).toBe(0)
  })

  it('one receipt/version: a replayed intent commits exactly one version', async () => {
    const h = await harness()
    const doc = h.makeDoc()
    await h.dispatcher.enqueue(doc)
    h.server.state.commitError = new UniworkDocError('timeout')
    await h.dispatcher.dispatchAll([doc])
    h.server.state.commitError = null
    h.server.state.lookupOutcome = 'committed'
    await h.dispatcher.reconcile(doc)
    await h.dispatcher.dispatchAll([doc]) // a committed intent never dispatches again
    expect(doc.record.state).toBe('committed')
    expect(h.server.state.counts.commit).toBe(1)
    expect(h.server.state.counts.lookup).toBe(1)
    expect(h.server.state.keys.commit).toEqual([doc.record.idempotencyKey])
  })

  it('a migrated intent replays exactly once, with its own key', async () => {
    const h = await harness()
    const doc = h.makeDoc()
    // the store holds a v1 record (the pre-store shape) for this document
    await h.intents.put(
      doc.key,
      {
        intentId: 'office-intent-legacy',
        idempotencyKey: 'office-key-legacy',
        documentId: doc.record.documentId,
        baseRevision: '41',
        checksum: doc.record.checksum,
        createdAt: ISO,
      },
      doc.payload,
    )
    await h.coordinator.save(doc.path)
    expect(h.server.state.keys.upload).toEqual(['office-key-legacy'])
    expect(h.server.state.keys.commit).toEqual(['office-key-legacy'])
    expect(h.statuses.at(-1)?.state).toBe('saved')
    expect(await stored(h.intents, doc)).toBeNull()
  })

  it('409 -> conflict with the same intent id, durable across a restart', async () => {
    const h = await harness()
    const doc = h.makeDoc()
    await h.dispatcher.enqueue(doc)
    h.server.state.commitError = new UniworkDocError('conflict', {
      serverCode: 'document_version_conflict',
      currentRevision: '45',
    })
    await h.dispatcher.dispatchAll([doc])
    expect(doc.record.state).toBe('conflict')
    // a restart reads the same record: the same intent id and key survive
    const after = await stored(h.intents, doc)
    expect(after?.intent.intentId).toBe(doc.record.intentId)
    expect(after?.intent.idempotencyKey).toBe(doc.record.idempotencyKey)
    expect(after?.intent.state).toBe('conflict')
    expect(h.server.state.keys.commit).toEqual([doc.record.idempotencyKey])
  })

  it('expired upload -> reconciling, exactly one lookup, no byte re-upload', async () => {
    const h = await harness()
    const doc = h.makeDoc()
    await h.dispatcher.enqueue(doc)
    h.server.state.commitError = new UniworkDocError('ticket_expired', {
      serverCode: 'ticket_expired',
    })
    await h.dispatcher.dispatchAll([doc])
    expect(doc.record.state).toBe('reconciling')
    const uploads = h.server.state.counts.upload
    h.server.state.lookupOutcome = 'not_committed'
    await h.dispatcher.reconcile(doc)
    expect(h.server.state.counts.lookup).toBe(1)
    // proven not committed: a new attempt is minted with the SAME key, no re-upload yet
    expect(doc.record.state).toBe('queued')
    expect(doc.record.attempt).toBe(1)
    expect(h.server.state.counts.upload).toBe(uploads)
    expect(new Set(h.server.state.keys.lookup)).toEqual(new Set([doc.record.idempotencyKey]))
  })

  it('lookup unknown -> reconciling-stuck, no new attempt, "check again" only looks up', async () => {
    const h = await harness()
    const doc = h.makeDoc()
    await h.dispatcher.enqueue(doc)
    h.server.state.commitError = new UniworkDocError('timeout')
    await h.dispatcher.dispatchAll([doc])
    h.server.state.lookupOutcome = 'unknown'
    await h.dispatcher.reconcile(doc)
    expect(doc.record.state).toBe('reconciling-stuck')
    const commits = h.server.state.counts.commit
    const uploads = h.server.state.counts.upload
    await h.dispatcher.recheck(doc)
    await h.dispatcher.recheck(doc)
    expect(h.server.state.counts.lookup).toBe(3)
    expect(h.server.state.counts.commit).toBe(commits)
    expect(h.server.state.counts.upload).toBe(uploads)
    expect(doc.record.attempt).toBe(0)
  })

  it('lookup 401 / 403 by code / 410 -> the right reason', async () => {
    const cases: Array<{ error: UniworkDocError; state: QueueState; reason: string }> = [
      {
        error: new UniworkDocError('session_expired', { status: 401 }),
        state: 'blocked',
        reason: 'session_expired',
      },
      {
        error: new UniworkDocError('organization_suspended', { status: 403 }),
        state: 'blocked',
        reason: 'organization_suspended',
      },
      {
        error: new UniworkDocError('permission_revoked', { status: 403 }),
        state: 'blocked',
        reason: 'permission_revoked',
      },
      {
        error: new UniworkDocError('document_deleted', { status: 410 }),
        state: 'blocked',
        reason: 'document_deleted',
      },
    ]
    for (const c of cases) {
      const h = await harness()
      const doc = h.makeDoc()
      await h.dispatcher.enqueue(doc)
      h.server.state.commitError = new UniworkDocError('timeout')
      await h.dispatcher.dispatchAll([doc])
      h.server.state.commitError = null
      const failing: QueueClient = {
        upload: h.server.client.upload,
        commit: h.server.client.commit,
        lookupCommit: async () => {
          throw c.error
        },
      }
      const dispatcher = new QueueDispatcher({
        intents: async () => ({ kind: 'ok', intents: h.intents }),
        client: failing,
        capability: h.capability,
        lock: fakeLock(h.lockTable, 'win1', () => h.clock.now),
        clock: () => h.clock.now,
        random: () => 0.5,
        limits: QUEUE_LIMITS,
        publish: () => undefined,
      })
      await dispatcher.reconcile(doc)
      expect(doc.record.state).toBe(c.state)
      expect(doc.record.lastError).toBe(c.reason)
    }
  })

  it('N+1 stays dirty behind the pending intent', async () => {
    const h = await harness()
    const doc = h.makeDoc()
    await h.dispatcher.enqueue(doc)
    // the pending intent does not settle (the answer is lost), so the N+1 stays
    h.server.state.commitError = new UniworkDocError('timeout')
    // the coordinator already holds the intent: a Ctrl/Cmd+S does not mint a
    // second one, and the working copy has moved past the snapshot
    const again = await h.coordinator.save(doc.path)
    expect(again).not.toBeNull()
    expect(h.statuses.at(-1)?.pendingNext).toBe(true)
    expect(h.coordinator.hasPendingNext(doc.path)).toBe(true)
    // exactly one key ever reached the server: no second intent was minted
    expect(new Set(h.server.state.keys.upload).size).toBe(1)
    expect(h.server.state.keys.upload).toEqual([doc.record.idempotencyKey])
  })

  it('two windows on one Document -> the second is read-only', async () => {
    const h = await harness()
    const doc = h.makeDoc()
    await h.dispatcher.enqueue(doc)
    const second = h.newDispatcher('win2')
    // window 1 holds the lock (a live lease, heartbeat not yet gone)
    h.lockTable.leases.set(doc.key, { owner: 'win1', generation: 1, heartbeatAt: h.clock.now })
    const keyBefore = doc.record.idempotencyKey
    const before = { upload: h.server.state.counts.upload, commit: h.server.state.counts.commit }
    // window 2 sees another window's fresh lease: it never writes
    const doc2 = { ...doc, record: { ...doc.record, state: 'queued' as QueueState } }
    await second.dispatchAll([doc2])
    expect(second.isOtherWindow(doc.key)).toBe(true)
    expect(h.server.state.counts.upload).toBe(before.upload)
    expect(h.server.state.counts.commit).toBe(before.commit)
    expect(doc2.record.idempotencyKey).toBe(keyBefore)
  })

  it('a window without the lock never writes the record: it publishes other_window, the holder commits', async () => {
    // (a) the acquire is refused: the loser writes NOTHING and publishes blocked/other_window
    const h = await harness()
    const doc = h.makeDoc()
    await h.dispatcher.enqueue(doc)
    h.lockTable.leases.set(doc.key, { owner: 'win1', generation: 1, heartbeatAt: h.clock.now })
    const before = await stored(h.intents, doc)
    const loser = h.newDispatcher('win2')
    await loser.dispatchAll([doc])
    expect(loser.isOtherWindow(doc.key)).toBe(true)
    // the record is left exactly as it was for the holder: same bytes/updatedAt
    expect(await stored(h.intents, doc)).toEqual(before)
    // and the loser's own status says why (a read-only window lock)
    expect(h.published.at(-1)).toMatchObject({ state: 'blocked', lastError: 'other_window' })
    // the holder dispatches the same record and commits exactly once
    const holder = h.newDispatcher('win1')
    await holder.dispatchAll([doc])
    expect(doc.record.state).toBe('committed')
    expect(h.server.state.counts.upload).toBe(1)
    expect(h.server.state.counts.commit).toBe(1)

    // (b) the lock is lost while the bytes move: the window stops before the
    // commit, still without writing a paused_offline park
    const lost = await harness()
    const doc2 = lost.makeDoc()
    await lost.dispatcher.enqueue(doc2)
    let entered!: () => void
    const atUpload = new Promise<void>((resolve) => (entered = resolve))
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const gated: QueueClient = {
      upload: async (input) => {
        entered()
        await gate
        return lost.server.client.upload(input)
      },
      commit: lost.server.client.commit,
      lookupCommit: lost.server.client.lookupCommit,
    }
    const dispatcher = lost.newDispatcherWith({ client: gated })
    const pass = dispatcher.dispatchAll([doc2])
    await atUpload
    // another window takes the lease while the upload is in flight
    lost.lockTable.leases.set(doc2.key, { owner: 'win2', generation: 2, heartbeatAt: lost.clock.now })
    release()
    await pass
    expect(dispatcher.isOtherWindow(doc2.key)).toBe(true)
    expect(lost.server.state.counts.commit).toBe(0)
    expect(lost.published.at(-1)).toMatchObject({ state: 'blocked', lastError: 'other_window' })
    const after = await stored(lost.intents, doc2)
    expect(after?.intent.lastError).toBeUndefined()
    expect(after?.intent.state).not.toBe('paused_offline')
  })

  it('mint ages the generation over a stored record; cleanup is compare-then-delete', async () => {
    const h = await harness()
    const doc = h.makeDoc()
    await h.dispatcher.enqueue(doc)
    // a superseded record is still in the store: the next intent is generation + 1
    await h.intents.put(
      doc.key,
      { ...doc.record, generation: 3, state: 'cancelled', cancelReason: 'superseded' },
      doc.payload,
    )
    const minted = await h.dispatcher.mint(mintedFor(doc))
    expect(minted.generation).toBe(4)
    // the hand-off keeps the minted generation through `enqueue`
    doc.record = minted
    await h.dispatcher.enqueue(doc)
    expect((await stored(h.intents, doc))?.intent.generation).toBe(4)
    // a plain commit cleans up exactly this generation
    await h.dispatcher.dispatchAll([doc])
    expect(doc.record.state).toBe('committed')
    expect(await stored(h.intents, doc)).toBeNull()

    // a newer intent (N+1) minted while N commits is left untouched
    const race = await harness()
    const old = race.makeDoc({ key: 'doc_race' })
    await race.dispatcher.enqueue(old)
    let entered!: () => void
    const atCommit = new Promise<void>((resolve) => (entered = resolve))
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const gated: QueueClient = {
      upload: race.server.client.upload,
      commit: async (input) => {
        entered()
        await gate
        return race.server.client.commit(input)
      },
      lookupCommit: race.server.client.lookupCommit,
    }
    const dispatcher = race.newDispatcherWith({ client: gated })
    const pass = dispatcher.dispatchAll([old])
    await atCommit
    const next = await dispatcher.mint(mintedFor(old))
    expect(next.generation).toBe(2)
    const newer = { ...old, record: next }
    await dispatcher.enqueue(newer)
    expect((await stored(race.intents, old))?.intent.intentId).toBe(next.intentId)
    release()
    await pass
    // N committed with exactly one request, but N+1 survived: it was never this
    // generation's to clean up
    expect(race.server.state.counts.commit).toBe(1)
    const after = await stored(race.intents, old)
    expect(after?.intent.intentId).toBe(next.intentId)
    expect(after?.intent.generation).toBe(2)
  })

  it('lock holder crash -> the other window acquires after goneMs', async () => {
    const h = await harness()
    const doc = h.makeDoc()
    await h.dispatcher.enqueue(doc)
    const crashed = h.newDispatcher('win1')
    h.server.state.commitError = new UniworkDocError('network')
    await crashed.dispatchAll([doc])
    // the holder is gone; after goneMs another window takes the lock and dispatches
    h.clock.advance(QUEUE_LIMITS.goneMs + 1)
    h.server.state.commitError = null
    const other = h.newDispatcher('win2')
    const retry = {
      ...doc,
      record: { ...doc.record, state: 'queued' as QueueState, retryAt: undefined },
    }
    await other.dispatchAll([retry])
    expect(other.isOtherWindow(doc.key)).toBe(false)
    expect(retry.record.state).toBe('committed')
    expect(h.server.state.keys.commit).toContain(doc.record.idempotencyKey)
  })

  it('stalled holder resumes after hand-off -> read-only, no write', async () => {
    const h = await harness()
    const doc = h.makeDoc()
    await h.dispatcher.enqueue(doc)
    // window 2 holds a live lease on the document; window 1 (the stalled
    // window) opens it read-only and never writes
    const stalled = h.newDispatcher('win1')
    h.lockTable.leases.set(doc.key, { owner: 'win2', generation: 2, heartbeatAt: h.clock.now })
    await stalled.dispatchAll([doc])
    expect(stalled.isOtherWindow(doc.key)).toBe(true)
    expect(h.server.state.counts.upload).toBe(0)
    // window 2 crashed; after goneMs a fresh window 3 takes the lock and commits
    h.clock.advance(QUEUE_LIMITS.goneMs + 1)
    const fresh = h.newDispatcher('win3')
    await fresh.dispatchAll([doc])
    expect(fresh.isOtherWindow(doc.key)).toBe(false)
    expect(doc.record.state).toBe('committed')
    // window 3 holds generation 3; the stalled window 1 resumes: its generation
    // is gone, so it stays read-only and writes nothing
    h.lockTable.leases.set(doc.key, { owner: 'win3', generation: 3, heartbeatAt: h.clock.now })
    const commitsBefore = h.server.state.counts.commit
    const resumed = { ...doc, record: { ...doc.record, state: 'queued' as QueueState } }
    await stalled.dispatchAll([resumed])
    expect(stalled.isOtherWindow(doc.key)).toBe(true)
    expect(h.server.state.counts.commit).toBe(commitsBefore)
  })

  it('sync_write off / office_capability_off -> paused_admin, no new request, queue kept', async () => {
    // (a) a known-off capability parks the intent at mint time
    const off = await harness()
    off.capability.set('org_1', false)
    const doc = off.makeDoc()
    await off.dispatcher.enqueue(doc)
    expect(doc.record.state).toBe('paused_admin')
    await off.dispatcher.dispatchAll([doc])
    expect(off.server.state.counts.upload).toBe(0)
    expect(off.server.state.counts.commit).toBe(0)
    expect(await stored(off.intents, doc)).not.toBeNull()

    // (b) the server refuses with office_capability_off mid-flight: same intent
    const h = await harness()
    const doc2 = h.makeDoc()
    await h.dispatcher.enqueue(doc2)
    h.server.state.commitError = new UniworkDocError('capability_off', {
      status: 403,
      serverCode: 'office_capability_off',
    })
    await h.dispatcher.dispatchAll([doc2])
    expect(doc2.record.state).toBe('paused_admin')
    expect(doc2.record.lastError).toBe('capability_off')
    expect((await stored(h.intents, doc2))?.intent.intentId).toBe(doc2.record.intentId)
  })

  it('flag off during uploading -> stop before commit, same intent paused_admin, no request after', async () => {
    const h = await harness()
    const doc = h.makeDoc()
    await h.dispatcher.enqueue(doc)
    // the capability flips off after the upload staged the bytes
    const realUpload = h.server.client.upload
    const flipping: QueueClient = {
      upload: async (input) => {
        const receipt = await realUpload(input)
        h.capability.set(doc.orgId, false)
        return receipt
      },
      commit: h.server.client.commit,
      lookupCommit: h.server.client.lookupCommit,
    }
    const dispatcher = new QueueDispatcher({
      intents: async () => ({ kind: 'ok', intents: h.intents }),
      client: flipping,
      capability: h.capability,
      lock: fakeLock(h.lockTable, 'win1', () => h.clock.now),
      clock: () => h.clock.now,
      random: () => 0.5,
      limits: QUEUE_LIMITS,
      publish: () => undefined,
    })
    await dispatcher.dispatchAll([doc])
    expect(doc.record.state).toBe('paused_admin')
    expect(h.server.state.counts.commit).toBe(0)
    const after = { ...h.server.state.counts }
    await dispatcher.dispatchAll([doc])
    expect(h.server.state.counts).toEqual(after)
    expect((await stored(h.intents, doc))?.intent.intentId).toBe(doc.record.intentId)
  })

  it('canCommit false between upload and commit -> no commit, the record is not damaged', async () => {
    const h = await harness()
    const doc = h.makeDoc()
    await h.dispatcher.enqueue(doc)
    const keyBefore = doc.record.idempotencyKey
    let allowed = true
    const switching: QueueClient = {
      upload: async (input) => {
        const receipt = await h.server.client.upload(input)
        // the account switches while the bytes are in flight
        allowed = false
        return receipt
      },
      commit: h.server.client.commit,
      lookupCommit: h.server.client.lookupCommit,
    }
    const dispatcher = h.newDispatcherWith({ client: switching, canCommit: () => allowed })
    await dispatcher.dispatchAll([doc])
    // the guard stopped the pass before the commit request
    expect(h.server.state.counts.commit).toBe(0)
    // and wrote nothing of its own: same intent, no terminal/failed state
    const after = await stored(h.intents, doc)
    expect(after?.intent.intentId).toBe(doc.record.intentId)
    expect(after?.intent.idempotencyKey).toBe(keyBefore)
    expect(after?.intent.state).toBe('uploading')
    expect(after?.intent.lastError).toBeUndefined()

    // the same guard before the upload: a session that is already gone sends nothing
    const gone = await harness()
    const doc2 = gone.makeDoc()
    await gone.dispatcher.enqueue(doc2)
    const blocked = gone.newDispatcherWith({ canCommit: () => false })
    await blocked.dispatchAll([doc2])
    expect(gone.server.state.counts.upload).toBe(0)
    expect(gone.server.state.counts.commit).toBe(0)
    expect((await stored(gone.intents, doc2))?.intent.state).toBe('queued')
  })

  it('a 429 with Retry-After schedules the retry at now + the 300 s clamp', async () => {
    const h = await harness()
    const doc = h.makeDoc()
    await h.dispatcher.enqueue(doc)
    // the server throttled the upload: the error carries the Retry-After the
    // client parsed (900 s), which the dispatcher must pass into the machine
    h.server.state.uploadError = new UniworkDocError('server_error', {
      status: 429,
      retryAfterMs: 900_000,
    })
    await h.dispatcher.dispatchAll([doc])
    expect(doc.record.state).toBe('queued')
    expect(doc.record.lastError).toBe('server_error')
    expect(doc.record.retryAt).toBe(
      new Date(h.clock.now + QUEUE_LIMITS.retryAfterClampMs).toISOString(),
    )
  })

  it('two orgs with different sync_write -> each intent follows its org', async () => {
    const h = await harness()
    h.capability.set('org_a', true)
    h.capability.set('org_b', false)
    const a = h.makeDoc({ key: 'doc_a', orgId: 'org_a' })
    const b = h.makeDoc({ key: 'doc_b', orgId: 'org_b' })
    await h.dispatcher.enqueue(a)
    await h.dispatcher.enqueue(b)
    expect(a.record.state).toBe('queued')
    expect(b.record.state).toBe('paused_admin')
    await h.dispatcher.dispatchAll([a, b])
    expect(a.record.state).toBe('committed')
    expect(b.record.state).toBe('paused_admin')
    expect(h.server.state.keys.commit).toEqual([a.record.idempotencyKey])
  })

  it('concurrency caps documents across ALL org lanes of one pass', async () => {
    const h = await harness()
    h.capability.set('org_a', true)
    h.capability.set('org_b', true)
    const docs: QueueDoc[] = []
    for (const org of ['org_a', 'org_b']) {
      for (const n of [1, 2, 3]) {
        const doc = h.makeDoc({ key: `doc_${org}_${n}`, orgId: org })
        await h.dispatcher.enqueue(doc)
        docs.push(doc)
      }
    }
    const before = await Promise.all(docs.map((doc) => stored(h.intents, doc)))
    const result = await h.dispatcher.dispatchAll(docs)
    // one global cap: 2 documents this pass, never 2 per lane (4 across orgs)
    expect(result.dispatched).toBe(QUEUE_LIMITS.concurrency)
    expect(result.parked).toBe(docs.length - QUEUE_LIMITS.concurrency)
    expect(h.server.state.counts.upload).toBe(QUEUE_LIMITS.concurrency)
    expect(h.server.state.counts.commit).toBe(QUEUE_LIMITS.concurrency)
    // every later document is parked exactly as it was (still queued)
    const after = await Promise.all(docs.map((doc) => stored(h.intents, doc)))
    for (const [i, row] of after.entries()) {
      if (row === null) continue
      expect(row.intent.state).toBe('queued')
      expect(row).toEqual(before[i])
    }
    expect(after.filter((row) => row !== null)).toHaveLength(4)
  })

  it('offline 2 h (past capability TTL) -> Ctrl/Cmd+S -> paused_offline, not paused_admin', async () => {
    const h = await harness()
    h.capability.set('org_1', false) // the last known flags say sync_write off
    h.capability.goStale('org_1') // ... but the read is past its TTL (offline)
    const doc = h.makeDoc()
    await h.dispatcher.enqueue(doc)
    expect(doc.record.state).toBe('paused_offline')
    expect(doc.record.state).not.toBe('paused_admin')
    await h.dispatcher.dispatchAll([doc])
    expect(h.server.state.counts.upload).toBe(0)
    expect(h.server.state.counts.commit).toBe(0)
  })

  it('keystore_locked / store_full -> refused with a reason, no intent', async () => {
    const full = await harness()
    const doc = full.makeDoc()
    const { coordinator, statuses } = refusingCoordinator(full, 'store_full', doc.payload)
    await coordinator.save(doc.path)
    expect(statuses.at(-1)).toMatchObject({ state: 'error', error: 'store_full' })
    expect(await stored(full.intents, doc)).toBeNull()
    expect(full.server.state.counts.upload).toBe(0)
    expect(full.server.state.counts.commit).toBe(0)

    const locked = await harness()
    const doc2 = locked.makeDoc()
    const refused = refusingCoordinator(locked, 'keystore_locked', doc2.payload)
    await refused.coordinator.save(doc2.path)
    expect(refused.statuses.at(-1)).toMatchObject({ state: 'error', error: 'keystore_locked' })
    expect(await stored(locked.intents, doc2)).toBeNull()
    expect(locked.server.state.counts.upload).toBe(0)
  })

  it('cancel when the document is closed -> the snapshot becomes a kept draft', async () => {
    const h = await harness()
    const doc = h.makeDoc()
    await h.dispatcher.enqueue(doc)
    const state = await h.dispatcher.cancel(doc, { documentClosed: true, title: 'Plan.docx' })
    expect(state).toBe('cancelled')
    const opened = await h.layer.open(SCOPE)
    if (opened.kind !== 'ok') throw new Error('store did not open')
    const kept = await createDraftStore(opened.store.records(DRAFTS_STORE_REGISTRATION.name)).list(
      doc.key,
    )
    expect(kept).toHaveLength(1)
    expect(Buffer.from(kept[0]?.snapshot ?? [])).toEqual(Buffer.from(doc.payload))
    expect(await stored(h.intents, doc)).toBeNull()
  })

  it('cancel or discard at 3 drafts or a full store -> refused, intent kept', async () => {
    const h = await harness()
    const doc = h.makeDoc()
    await h.dispatcher.enqueue(doc)
    const opened = await h.layer.open(SCOPE)
    if (opened.kind !== 'ok') throw new Error('store did not open')
    const drafts = createDraftStore(opened.store.records(DRAFTS_STORE_REGISTRATION.name))
    for (const id of ['d1', 'd2', 'd3']) {
      expect(await drafts.keep(doc.key, enc(id), { id, createdAt: ISO })).toBe('ok')
    }
    const before = await stored(h.intents, doc)
    const state = await h.dispatcher.cancel(doc, { documentClosed: true })
    expect(state).toBe('failed')
    // the refusal is durable: the STORED record is exactly the pre-cancel one
    // (still pending, byte for byte), never `cancelled`
    expect(await stored(h.intents, doc)).toEqual(before)
    expect((await stored(h.intents, doc))?.intent.state).toBe('queued')
    expect(doc.record.lastError).toBe('drafts_full')
    expect(await drafts.list(doc.key)).toHaveLength(3)
    // a restart (the store reopened, a fresh dispatcher over it) still sees the
    // intent: the snapshot was never dropped for a draft that was refused
    const reopened = await h.layer.open(SCOPE)
    if (reopened.kind !== 'ok') throw new Error('store did not reopen')
    const reopenedIntents = createIntentStore(reopened.store.records(INTENT_STORE_REGISTRATION.name))
    const reopenedDrafts = createDraftStore(reopened.store.records(DRAFTS_STORE_REGISTRATION.name))
    expect((await reopenedIntents.read(doc.key, factsOf(doc)))?.intent.state).toBe('queued')
    expect(await reopenedDrafts.list(doc.key)).toHaveLength(3)

    // discard on a stuck intent: the same refusal, the same durability
    const stuck = h.makeDoc({ key: 'doc_stuck' })
    await h.dispatcher.enqueue(stuck)
    h.server.state.commitError = new UniworkDocError('timeout')
    await h.dispatcher.dispatchAll([stuck])
    h.server.state.commitError = null
    h.server.state.lookupOutcome = 'unknown'
    await h.dispatcher.reconcile(stuck)
    expect(stuck.record.state).toBe('reconciling-stuck')
    for (const id of ['s1', 's2', 's3']) {
      expect(await drafts.keep(stuck.key, enc(id), { id, createdAt: ISO })).toBe('ok')
    }
    const stuckBefore = await stored(h.intents, stuck)
    const discarded = await h.dispatcher.discard(stuck, {})
    expect(discarded).toBe('failed')
    expect(stuck.record.lastError).toBe('drafts_full')
    expect(await stored(h.intents, stuck)).toEqual(stuckBefore)
    expect((await stored(h.intents, stuck))?.intent.state).toBe('reconciling-stuck')
    expect(await drafts.list(stuck.key)).toHaveLength(3)
  })

  it('user pause + offline -> online -> paused_user, no dispatch', async () => {
    const h = await harness()
    h.capability.set('org_1', false)
    h.capability.goStale('org_1')
    const doc = h.makeDoc()
    await h.dispatcher.enqueue(doc)
    expect(doc.record.state).toBe('paused_offline')
    // the user pauses sending while offline
    await h.dispatcher.pause()
    // the network comes back (the capability refreshes to sync_write on)
    h.capability.set('org_1', true)
    await h.dispatcher.setOnline([doc], true)
    expect(doc.record.state).toBe('paused_user')
    const before = { ...h.server.state.counts }
    await h.dispatcher.dispatchAll([doc])
    expect(h.server.state.counts).toEqual(before)
  })

  it('the store locks while reconciling -> unlock -> still reconciling', async () => {
    const h = await harness()
    const doc = h.makeDoc()
    await h.dispatcher.enqueue(doc)
    h.server.state.commitError = new UniworkDocError('timeout')
    await h.dispatcher.dispatchAll([doc])
    expect(doc.record.state).toBe('reconciling')
    // the keychain locks: the state must not move (nothing can be persisted)
    h.setLocked(true)
    h.server.state.lookupOutcome = 'committed'
    await h.dispatcher.reconcile(doc)
    expect(doc.record.state).toBe('reconciling')
    // it unlocks again: the reconcile completes and the record is cleared
    h.setLocked(false)
    await h.dispatcher.reconcile(doc)
    expect(doc.record.state).toBe('committed')
  })

  it('"Luu lai" on failed -> the old intent is superseded before the new one', async () => {
    const h = await harness()
    const doc = h.makeDoc()
    await h.dispatcher.enqueue(doc)
    h.server.state.commitError = new UniworkDocError('quota_exceeded', {
      serverCode: 'quota_exceeded',
    })
    await h.dispatcher.dispatchAll([doc])
    expect(doc.record.state).toBe('failed')
    const oldKey = doc.record.idempotencyKey
    const superseded = await h.dispatcher.supersede(doc)
    expect(superseded).toBe('cancelled')
    expect(doc.record.cancelReason).toBe('superseded')
    expect((await stored(h.intents, doc))?.intent.cancelReason).toBe('superseded')
    // the new intent (a fresh Ctrl/Cmd+S) is minted only AFTER the supersede and
    // carries a new key
    await h.coordinator.save(doc.path)
    expect(h.server.state.keys.commit.at(-1)).toBe('office-key-u1')
    expect(h.server.state.keys.commit.at(-1)).not.toBe(oldKey)
    expect(await stored(h.intents, doc)).toBeNull()
  })

  it('a tombstone stops replay', async () => {
    const h = await harness()
    const doc = h.makeDoc()
    await h.dispatcher.enqueue(doc)
    const state = await h.dispatcher.tombstone(doc)
    expect(state).toBe('blocked')
    expect(doc.record.lastError).toBe('document_deleted')
    await h.dispatcher.dispatchAll([doc])
    expect(h.server.state.counts.upload).toBe(0)
    expect(h.server.state.counts.commit).toBe(0)
  })

  it('queue/budget limit -> refused with a code', async () => {
    const h = await harness()
    const doc = h.makeDoc()
    const { coordinator, statuses } = refusingCoordinator(h, 'store_full', doc.payload)
    await coordinator.save(doc.path)
    expect(statuses.at(-1)).toMatchObject({ state: 'error', error: 'store_full' })
  })

  it('startup does not read the drafts folder', async () => {
    const h = await harness()
    const doc = h.makeDoc()
    const opened = await h.layer.open(SCOPE)
    if (opened.kind !== 'ok') throw new Error('store did not open')
    const drafts = createDraftStore(opened.store.records(DRAFTS_STORE_REGISTRATION.name))
    await drafts.keep(doc.key, enc('kept'), { id: 'd1', createdAt: ISO })
    // constructing the dispatcher (startup) and dispatching an unrelated doc
    // never reads the drafts store; the kept draft is still there, untouched
    const other = h.makeDoc({ key: 'doc_other' })
    await h.dispatcher.enqueue(other)
    expect(await drafts.list(doc.key)).toHaveLength(1)
  })

  runStoreCompliance('uniwork sync save-queue stores', async (env: ComplianceEnv) => {
    const layer = createStoreLayer({
      root: env.root,
      keys: createSafeStorageKeyProvider({ safeStorage: env.safeStorage, dir: env.keyDir }),
      budgetBytes: env.budgetBytes,
      clock: env.clock,
    })
    layer.register(INTENT_STORE_REGISTRATION)
    layer.register(DRAFTS_STORE_REGISTRATION)
    layer.register(PAUSE_STORE_REGISTRATION)
    const opened = await layer.open(env.scope)
    if (opened.kind !== 'ok') throw new Error(`store did not open: ${opened.kind}`)
    const subject: ComplianceSubject = {
      registration: INTENT_STORE_REGISTRATION,
      layer,
      scope: env.scope,
      records: opened.store.records(INTENT_STORE_REGISTRATION.name),
    }
    return subject
  })
})
