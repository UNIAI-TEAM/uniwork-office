import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkConflictView, UniworkDocStatus } from '../src/shared/home-api'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import {
  UniworkDocsService,
  type ConflictUi,
  type UnsavedCloseChoice,
} from '../src/main/uniwork-docs/service'
import { BINDING_FILE } from '../src/main/uniwork-docs/binding-store'
import { INTENT_STORE_REGISTRATION, createIntentStore } from '../src/main/uniwork-sync/intent-store'
import { DRAFTS_STORE_REGISTRATION, createDraftStore } from '../src/main/uniwork-sync/queue/drafts'
import { PAUSE_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/pause'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import { createSyncStoreAccess } from '../src/main/uniwork-sync/session-store'
import { createDocLock } from '../src/main/uniwork-sync/doc-lock'
import { DEFAULT_DOCUMENT_LIMITS, type DocumentLimits } from '../src/main/uniwork-docs/limits'
import type { CapabilitySource } from '../src/main/uniwork-sync/capability/cache'
import { SaveCoordinator } from '../src/main/uniwork-docs/save-coordinator'
import { uploadKeyFor } from '../src/main/uniwork-sync/version-upload'
import {
  createStoreLayer,
  type StoreLayer,
  type StoreRecords,
} from '../src/main/uniwork-sync/store'
import {
  createLockableSafeStorage,
  type LockableSafeStorage,
} from '../src/main/uniwork-sync/test-kit/compliance'

/**
 * G5-06 W4b: the durable save queue wired into the service (production path, no
 * electron). The service builds one QueueDispatcher per signed-in session over
 * the REAL store layer (temp dir): the three queue stores are registered, a
 * stored intent replays exactly once at startup without reading the drafts
 * folder, sign-out tears the queue down, two windows contend through the real
 * doc-lock, a user pause survives a restart, and the EXPERIENCE actions
 * (cancel/discard/supersede/recheck) run through the service surface.
 */

const TOKEN = 'secret-access-token-0123456789'
const ORIGIN = 'https://uniwork.example'
const profile: DeploymentProfile = {
  deploymentId: 'default',
  apiOrigin: ORIGIN,
  clientId: 'uniwork-office',
  channel: 'stable',
}
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const enc = (text: string) => new TextEncoder().encode(text)
const hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

interface Call {
  method: string
  path: string
  headers: Record<string, string>
  body?: unknown
}

type Fault = {
  route: 'upload' | 'commit' | 'lookup' | 'detail'
  kind: 'network' | number
  code?: string
}

/** a small UniWork server: idempotent uploads, commits, lookup, revisions, ACL */
function fakeServer(initial: {
  bytes: Uint8Array
  myLevel?: string
  partFailsOnceAt?: number
  sessionGetGate?: (signal?: AbortSignal | null) => Promise<void>
}) {
  const state = {
    revision: 41,
    version: 3,
    bytes: initial.bytes,
    myLevel: initial.myLevel ?? 'edit',
    /** a document in the trash; the write refuses until it is restored */
    archivedAt: null as string | null,
    title: 'Q4 plan.docx',
  }
  const calls: Call[] = []
  const faults: Fault[] = []
  const uploads = new Map<string, { id: string; checksum: string; bytes: Uint8Array }>()
  const commits = new Map<string, unknown>()
  let seq = 0
  /** BIGUP-A1: the new-version upload sessions this server opened */
  const sessions = new Map<
    string,
    { partSize: number; totalParts: number; size: number; parts: Map<number, Uint8Array> }
  >()
  let sessionSeq = 0
  /** the part size the session advertises (BIGUP-A1; 128 KiB keeps tests cheap) */
  const sessionPartSize = 128 * 1024

  const docJson = () => ({
    id: DOC,
    organization_id: 'org_a',
    workspace_id: 'ws_1',
    title: state.title,
    kind: 'file',
    revision: String(state.revision),
    current_version: state.version,
    my_level: state.myLevel,
    archived_at: state.archivedAt,
    file: {
      file_id: 'f',
      version_id: `v${state.version}`,
      version: state.version,
      filename: state.title,
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size_bytes: state.bytes.byteLength,
      checksum_sha256: hex(state.bytes),
    },
  })
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const error = (status: number, code: string, fields?: Record<string, unknown>) =>
    json(status, { error: { code, message: 'x', ...(fields ? { fields } : {}) } })
  const take = (route: Fault['route']): Fault | undefined => {
    const index = faults.findIndex((f) => f.route === route)
    return index >= 0 ? faults.splice(index, 1)[0] : undefined
  }

  const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    const u = new URL(url)
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    )
    calls.push({ method: init.method ?? 'GET', path: u.pathname, headers })
    const key = headers['idempotency-key'] ?? ''
    if (u.pathname === `/api/v1/documents/${DOC}` && (init.method ?? 'GET') === 'GET') {
      const fault = take('detail')
      if (typeof fault?.kind === 'number') return error(fault.kind, fault.code ?? 'x')
      return json(200, { document: docJson() })
    }
    if (u.pathname === `/api/v1/documents/${DOC}/download`) {
      return new Response(state.bytes as BodyInit, { status: 200 })
    }
    if (u.pathname === `/api/v1/documents/${DOC}/uploads`) {
      const file = (init.body as FormData).get('file') as Blob
      const bytes = new Uint8Array(await file.arrayBuffer())
      const fault = take('upload')
      if (fault?.kind === 'network') throw new TypeError('fetch failed')
      if (typeof fault?.kind === 'number') return error(fault.kind, fault.code ?? 'x')
      const upload = uploads.get(key) ?? { id: `up_${++seq}`, checksum: hex(bytes), bytes }
      uploads.set(key, upload)
      return json(201, {
        upload_id: upload.id,
        checksum_sha256: upload.checksum,
        size_bytes: bytes.byteLength,
        claim_expires_at: '2026-10-10T00:00:00Z',
      })
    }
    if (
      u.pathname === `/api/v1/documents/${DOC}/versions/commit` &&
      (init.method ?? 'POST') === 'POST'
    ) {
      const body = JSON.parse(String(init.body)) as { upload_id: string; base_revision: string }
      const fault = take('commit')
      if (fault?.kind === 'network') throw new TypeError('fetch failed')
      if (typeof fault?.kind === 'number') return error(fault.kind, fault.code ?? 'x')
      const stored = commits.get(key)
      let result = stored
      if (!result) {
        if (body.base_revision !== String(state.revision)) {
          return error(409, 'document_version_conflict', {
            current_revision: String(state.revision),
          })
        }
        const upload = [...uploads.values()].find((x) => x.id === body.upload_id)
        if (!upload) return error(409, 'document_upload_invalid')
        state.revision += 1
        state.version += 1
        state.bytes = upload.bytes
        result = {
          document: docJson(),
          version: {
            id: `ver_${state.version}`,
            document_id: DOC,
            version: state.version,
            kind: 'file',
            checksum_sha256: upload.checksum,
            size_bytes: upload.bytes.byteLength,
          },
        }
        commits.set(key, result)
      }
      return json(200, result)
    }
    if (u.pathname === `/api/v1/documents/${DOC}/versions/commit` && init.method === 'GET') {
      const fault = take('lookup')
      if (typeof fault?.kind === 'number') return error(fault.kind, fault.code ?? 'x')
      const stored = commits.get(key) as
        { version: { version: number; revision?: string } } | undefined
      if (stored) {
        return json(200, {
          outcome: 'committed',
          version_id: `ver_${stored.version.version}`,
          version: stored.version.version,
          revision: String(state.revision),
        })
      }
      return json(200, { outcome: 'not_committed' })
    }
    // ---- BIGUP-A1: the new-version upload session (create / status / complete / abort)
    const missingParts = (id: string): unknown[] => {
      const s = sessions.get(id)!
      const out: unknown[] = []
      for (let n = 1; n <= s.totalParts; n += 1) {
        if (s.parts.has(n)) continue
        out.push({
          part_number: n,
          method: 'PUT',
          url: `${ORIGIN}/storage/part/${id}/${n}`,
          headers: {},
          expires_at: '2099-01-01T00:00:00Z',
        })
      }
      return out
    }
    if (
      u.pathname === `/api/v1/documents/${DOC}/upload-sessions` &&
      (init.method ?? 'POST') === 'POST'
    ) {
      const body = JSON.parse(String(init.body)) as { size_bytes: number }
      const id = `us_${++sessionSeq}`
      sessions.set(id, {
        partSize: sessionPartSize,
        totalParts: Math.max(1, Math.ceil(body.size_bytes / sessionPartSize)),
        size: body.size_bytes,
        parts: new Map(),
      })
      return json(201, {
        session_id: id,
        part_size: sessionPartSize,
        total_parts: sessions.get(id)!.totalParts,
        expires_at: '2099-01-01T00:00:00Z',
        parts: missingParts(id),
      })
    }
    const sessionId = u.pathname.match(/^\/api\/v1\/upload-sessions\/([^/]+)$/)?.[1]
    if (sessionId && (init.method ?? 'GET') === 'GET') {
      if (initial.sessionGetGate) await initial.sessionGetGate(init.signal)
      const s = sessions.get(sessionId)
      if (!s) return error(404, 'not_found')
      return json(200, {
        session_id: sessionId,
        status: 'open',
        part_size: s.partSize,
        total_parts: s.totalParts,
        completed_parts: [...s.parts.keys()].map((n) => ({
          part_number: n,
          etag: `"e${n}"`,
          size: s.parts.get(n)!.byteLength,
        })),
        parts: missingParts(sessionId),
        expires_at: '2099-01-01T00:00:00Z',
      })
    }
    if (sessionId && init.method === 'DELETE') {
      if (!sessions.delete(sessionId)) return error(404, 'not_found')
      return new Response(null, { status: 204 })
    }
    const completeId = u.pathname.match(/^\/api\/v1\/upload-sessions\/([^/]+)\/complete$/)?.[1]
    if (completeId && (init.method ?? 'POST') === 'POST') {
      const s = sessions.get(completeId)
      if (!s) return error(404, 'not_found')
      const assembled = Buffer.concat(
        [...s.parts.entries()].sort((a, b) => a[0] - b[0]).map(([, part]) => Buffer.from(part)),
      )
      const bytes = new Uint8Array(assembled)
      const upload = { id: `up_sess_${completeId}`, checksum: hex(bytes), bytes }
      uploads.set(`session:${completeId}`, upload)
      return json(200, {
        upload_id: upload.id,
        checksum_sha256: upload.checksum,
        size_bytes: bytes.byteLength,
        claim_expires_at: '2099-01-01T00:00:00Z',
      })
    }
    const partId = u.pathname.match(/^\/storage\/part\/([^/]+)\/(\d+)$/)
    if (partId && init.method === 'PUT') {
      const s = sessions.get(partId[1]!)
      if (!s) return error(404, 'not_found')
      const num = Number(partId[2])
      if (initial.partFailsOnceAt === num) {
        initial.partFailsOnceAt = undefined
        return new Response(null, { status: 400 })
      }
      const raw = init.body as Uint8Array
      s.parts.set(num, raw.slice ? raw.slice() : new Uint8Array(raw))
      return new Response(null, { status: 200, headers: { ETag: `"e${partId[2]}"` } })
    }
    return error(404, 'not_found')
  })

  return { state, calls, faults, fetch, uploads, commits, sessions, sessionPartSize }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-save-queue-wiring-'))
})
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 25))
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

interface Ctx {
  service: UniworkDocsService
  deps: Record<string, unknown>
  ui: ConflictUi
  statuses: UniworkDocStatus[]
  views: UniworkConflictView[]
  layer: StoreLayer
  account: () => string | null
  signOut: () => void
  signInAs: (id: string) => void
  setCapabilityOffline: (value: boolean) => void
  /** true = the capability read answers `session_expired` (the session is still gone) */
  setCapabilityExpired: (value: boolean) => void
  /** the `source` an `ok` capability read answers with (default: `fresh`) */
  setCapabilitySource: (source: CapabilitySource) => void
  /** move the service clock (the blocked re-probe's backoff is wall-clock) */
  advanceClock: (ms: number) => void
}

function setup(
  server: ReturnType<typeof fakeServer>,
  opts: {
    account?: string | null
    /** the capability answer per org (default: sync_write on) */
    capability?: Record<string, boolean>
    /** SIZE-F1/BIGUP-A1: the `documents.limits` the service reads (defaults when absent) */
    limits?: () => DocumentLimits | Promise<DocumentLimits>
    /** the per-account store budget (default 1 MiB; a chunked test needs more) */
    budgetBytes?: number
    /**
     * R1-2 (UNI-1362): wraps the records the SERVICE opens, so a test can make
     * one store unable to answer (a refused/interrupted read). The stores are
     * all registered, as production registers them.
     */
    wrapRecords?: (name: string, records: StoreRecords) => StoreRecords
  } = {},
) {
  const statuses: UniworkDocStatus[] = []
  const views: UniworkConflictView[] = []
  let account: string | null = opts.account === undefined ? 'acc_1' : opts.account
  /** true = the capability read fails (the lane is offline for the next save) */
  let capabilityOffline = false
  /** true = the capability read answers the session is gone (still `session_expired`) */
  let capabilityExpired = false
  /** how real the `ok` capability answer is: only `fresh` proves the refusals lifted */
  let capabilitySource: CapabilitySource = 'fresh'
  let clock = Date.now()
  const safeStorage: LockableSafeStorage = createLockableSafeStorage()
  const layer: StoreLayer = createStoreLayer({
    root: join(dir, 'uniwork-sync', 'store'),
    keys: createSafeStorageKeyProvider({ safeStorage, dir: join(dir, 'uniwork-sync', 'keys') }),
    budgetBytes: opts.budgetBytes ?? 1 << 20,
    clock: () => 1_700_000_000_000,
  })
  layer.register(INTENT_STORE_REGISTRATION)
  layer.register(DRAFTS_STORE_REGISTRATION)
  layer.register(PAUSE_STORE_REGISTRATION)
  const syncStore = createSyncStoreAccess({
    layer: opts.wrapRecords
      ? {
          ...layer,
          async open(scope) {
            const opened = await layer.open(scope)
            if (opened.kind !== 'ok') return opened
            return {
              kind: 'ok',
              store: {
                scope: opened.store.scope,
                records: (name: string) => opts.wrapRecords!(name, opened.store.records(name)),
              },
            }
          },
        }
      : layer,
    scope: () => (account ? { deploymentId: 'default', accountId: account } : null),
  })
  const ui: ConflictUi = {
    chooseUnsavedClose: vi.fn(async () => 'cancel' as UnsavedCloseChoice),
  }
  const deps = {
    userDataDir: dir,
    syncStore,
    appVersion: () => '0.0.0',
    now: () => clock,
    ...(opts.limits ? { limits: opts.limits } : {}),
    profile: () => profile,
    identity: () =>
      account ? { accountId: account, deviceSessionId: 'dev_1', deploymentId: 'default' } : null,
    selectedOrg: () => ({ id: 'org_a', slug: 'acme' }),
    authorized: <T>(call: (token: string) => Promise<T>) => call(TOKEN),
    fetch: server.fetch,
    openPath: vi.fn(() => true),
    isPathOpen: vi.fn(() => false),
    requestModuleSave: vi.fn(() => false),
    reloadPath: vi.fn(),
    activePath: () => undefined,
    ui,
    pushStatus: (s: UniworkDocStatus) => statuses.push(s),
    pushConflict: (v: UniworkConflictView) => views.push(v),
    pushLaunch: vi.fn(),
    reveal: vi.fn(),
    sleep: async () => undefined,
    capability: {
      get: async (orgId: string) => {
        if (capabilityOffline) throw new Error('offline')
        if (capabilityExpired) {
          return {
            kind: 'session_expired' as const,
            capabilities: { sync_write: true },
            source: 'fresh' as const,
          }
        }
        const syncWrite = opts.capability?.[orgId] ?? true
        return {
          kind: 'ok' as const,
          capabilities: { sync_write: syncWrite },
          source: capabilitySource,
        }
      },
    },
  }
  const service = new UniworkDocsService(deps)
  return {
    service,
    deps,
    ui,
    statuses,
    views,
    layer,
    account: () => account,
    signOut: () => {
      account = null
    },
    signInAs: (id: string) => {
      account = id
    },
    setCapabilityOffline: (value: boolean) => {
      capabilityOffline = value
    },
    setCapabilityExpired: (value: boolean) => {
      capabilityExpired = value
    },
    setCapabilitySource: (source: CapabilitySource) => {
      capabilitySource = source
    },
    advanceClock: (ms: number) => {
      clock += ms
    },
  }
}

async function openDoc(ctx: Ctx): Promise<string> {
  const opened = await ctx.service.openDocument(DOC)
  if (!opened.ok) throw new Error(opened.error)
  return opened.value.path
}

const binding = (path: string) => JSON.parse(readFileSync(join(path, '..', BINDING_FILE), 'utf8'))
const uploads = (server: ReturnType<typeof fakeServer>) =>
  server.calls.filter((c) => c.path.endsWith('/uploads'))
const commits = (server: ReturnType<typeof fakeServer>) =>
  server.calls.filter((c) => c.path.endsWith('/versions/commit') && c.method === 'POST')

/** the intent record the durable store holds for the working copy at `path` */
async function storedIntent(ctx: Ctx, path: string, account = 'acc_1') {
  const opened = await ctx.layer.open({ deploymentId: 'default', accountId: account })
  if (opened.kind !== 'ok') return null
  return createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name)).get(
    basename(dirname(path)),
  )
}

describe('G5-06 W4b save queue wiring', () => {
  it('the production wiring registers the 3 queue stores and dispatches on the poll', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    // no network: the Ctrl/Cmd+S parks the intent `paused_offline`, nothing sent
    ctx.setCapabilityOffline(true)
    await ctx.service.save(path)
    expect(await storedIntent(ctx, path)).not.toBeNull()
    expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'paused_offline' })
    // the drafts + pause stores are reachable through the same layer
    const opened = await ctx.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
    if (opened.kind !== 'ok') throw new Error('store did not open')
    expect(() => opened.store.records(DRAFTS_STORE_REGISTRATION.name)).not.toThrow()
    expect(() => opened.store.records(PAUSE_STORE_REGISTRATION.name)).not.toThrow()
    // the poll dispatches the parked intent, exactly once, and clears it
    ctx.setCapabilityOffline(false)
    await ctx.service.pollSaveQueue()
    await vi.waitFor(async () =>
      expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'saved' }),
    )
    expect(await storedIntent(ctx, path)).toBeNull()
    expect(commits(server)).toHaveLength(1)
    // a second poll is inert: nothing left to dispatch
    const before = server.calls.length
    await ctx.service.pollSaveQueue()
    expect(server.calls.length).toBe(before)
  })

  it('startup replays a stored intent exactly once and never lists the drafts folder', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    // the save is parked offline: the intent is stored, no byte has moved
    ctx.setCapabilityOffline(true)
    await ctx.service.save(path)
    expect(await storedIntent(ctx, path)).not.toBeNull()
    expect(uploads(server)).toHaveLength(0)
    // a kept draft for the same document must never be touched by a poll
    const opened = await ctx.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
    if (opened.kind !== 'ok') throw new Error('store did not open')
    const drafts = createDraftStore(opened.store.records(DRAFTS_STORE_REGISTRATION.name))
    const key = basename(dirname(path))
    await drafts.keep(key, enc('kept'), { id: 'd1', createdAt: '2026-10-13T00:00:00.000Z' })

    // the poll (the wiring's startup/sign-in pass) replays the stored intent
    // exactly once: one upload, one commit, and the SAME key the intent carries
    ctx.setCapabilityOffline(false)
    await ctx.service.pollSaveQueue()
    expect(uploads(server)).toHaveLength(1)
    expect(commits(server)).toHaveLength(1)
    expect(commits(server)[0]!.headers['idempotency-key']).toBe(
      (await storedIntent(ctx, path))?.intent.idempotencyKey ??
        commits(server)[0]!.headers['idempotency-key'],
    )
    // a second poll has nothing left to replay
    await ctx.service.pollSaveQueue()
    expect(commits(server)).toHaveLength(1)
    // the kept draft is untouched: startup never read the drafts folder
    expect(await drafts.list(key)).toHaveLength(1)
  })

  it('sign-out stops dispatch (no request after) and releases the lock', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    // an intent parked offline: it will not be dispatched until the poll runs
    server.faults.push({ route: 'upload', kind: 'network' })
    await ctx.service.save(path)
    ctx.signOut()
    ctx.service.teardownSaveQueue()
    const before = server.calls.length
    await ctx.service.pollSaveQueue()
    expect(server.calls.length).toBe(before)
    // the lock of the torn-down window is gone: another window can take it
    const locks = join(dir, 'uniwork-sync', 'store', 'default', 'acc_1', 'doc-locks')
    expect(existsSync(locks) ? readdirSync(locks).filter((n) => n.endsWith('.lock')) : []).toEqual(
      [],
    )
  })

  it('two windows of the same document -> the second is read-only through the service', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const first = setup(server)
    const second = setup(server)
    const path = await openDoc(first)
    await openDoc(second)
    // window 2 parks an intent offline (no lock is held yet)
    writeFileSync(path, 'v4')
    second.setCapabilityOffline(true)
    await second.service.save(path)
    expect(await second.service.docStatus(path)).toMatchObject({ state: 'paused_offline' })
    second.setCapabilityOffline(false)
    // window 1 acquires the document lock (a live lease with a fresh heartbeat)
    const key = basename(dirname(path))
    const opener = createDocLock({
      root: join(dir, 'uniwork-documents'),
      scope: { deploymentId: 'default', accountId: 'acc_1' },
      clock: () => Date.now(),
      owner: 'win1',
    })
    expect((await opener.acquire(key)).kind).toBe('held')
    // window 2's poll tries to dispatch its parked intent, sees window 1's fresh
    // lease and goes read-only: no byte moves
    const before = { upload: uploads(server).length, commit: commits(server).length }
    await second.service.pollSaveQueue()
    expect(second.service.isReadOnly(path)).toBe(true)
    expect(second.service.isOtherWindow(path)).toBe(true)
    writeFileSync(path, 'v5 in window 2')
    await second.service.save(path)
    expect(uploads(server)).toHaveLength(before.upload)
    expect(commits(server)).toHaveLength(before.commit)
    // window 1 releases: window 2 can dispatch again
    await opener.release(key, 1)
  })

  it('a user pause survives a service restart (durable per account)', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const first = setup(server)
    const path = await openDoc(first)
    await first.service.pauseSending()
    // a new service (a restart) over the same store: the flag is still set
    const second = setup(server)
    await second.service.openDocument(DOC)
    writeFileSync(path, 'v4')
    await second.service.save(path)
    expect(await second.service.docStatus(path)).toMatchObject({ state: 'paused_user' })
    expect(commits(server)).toHaveLength(0)
    // "Tiếp tục gửi" clears the flag and moves the intent to queued; the poll
    // is what dispatches it (the same interval that drives the feed)
    await second.service.resumeSending()
    await second.service.pollSaveQueue()
    expect(commits(server).length).toBeGreaterThan(0)
    await vi.waitFor(async () =>
      expect(await second.service.docStatus(path)).toMatchObject({ state: 'saved' }),
    )
  })

  it('cancel on a closed tab -> the snapshot becomes a kept draft', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'upload', kind: 'network' })
    await ctx.service.save(path)
    await ctx.service.cancelSave(path, true)
    expect(await storedIntent(ctx, path)).toBeNull()
    const opened = await ctx.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
    if (opened.kind !== 'ok') throw new Error('store did not open')
    const key = basename(dirname(path))
    const kept = await createDraftStore(opened.store.records(DRAFTS_STORE_REGISTRATION.name)).list(
      key,
    )
    expect(kept).toHaveLength(1)
    expect(Buffer.from(kept[0]!.snapshot)).toEqual(Buffer.from(enc('v4')))
  })

  // B34 (UNI-1362): the drafts store is a store of its own, so a closed document
  // whose only local work is a kept draft answered "no local work" - and the
  // library asks exactly this before an unpin deletes the committed copy.
  it('a kept draft of a clean, intent-less copy is local work', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    const key = basename(dirname(path))
    // clean on disk, no intent: nothing local to lose yet
    expect(binding(path).state).not.toBe('dirty')
    expect(await storedIntent(ctx, path)).toBeNull()
    expect(await ctx.service.hasLocalDraft(DOC)).toBe(false)

    const opened = await ctx.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
    if (opened.kind !== 'ok') throw new Error('store did not open')
    const drafts = createDraftStore(opened.store.records(DRAFTS_STORE_REGISTRATION.name))
    expect(
      await drafts.keep(key, enc('kept snapshot'), {
        id: 'draft_1',
        createdAt: '2026-04-17T00:00:00.000Z',
      }),
    ).toBe('ok')

    // the kept draft alone makes the copy local work, and the draft is untouched
    expect(await ctx.service.hasLocalDraft(DOC)).toBe(true)
    const kept = await drafts.list(key)
    expect(kept).toHaveLength(1)
    expect(Buffer.from(kept[0]!.snapshot)).toEqual(Buffer.from(enc('kept snapshot')))
  })

  // R1-1 (UNI-1362): the presence check must not sit behind the binding read.
  // A clean copy is never parked at sign-out, so its plaintext folder - binding
  // included - is deleted while its kept draft survives in the sync store. On
  // the next sign-in only parked copies come back: the copy has no binding, and
  // "no binding" must not mean "nothing local".
  it('R1-1: a kept draft is local work even when the copy has no binding left', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    const opened = await ctx.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
    if (opened.kind !== 'ok') throw new Error('store did not open')
    const drafts = createDraftStore(opened.store.records(DRAFTS_STORE_REGISTRATION.name))
    expect(
      await drafts.keep(basename(dirname(path)), enc('kept snapshot'), {
        id: 'draft_1',
        createdAt: '2026-04-17T00:00:00.000Z',
      }),
    ).toBe('ok')
    // the sign-out deleted the clean copy's plaintext folder: binding and bytes gone
    await rm(dirname(path), { recursive: true, force: true })
    expect(await ctx.service.hasLocalDraft(DOC)).toBe(true)
  })

  // R1-2 (UNI-1362): `list` maps a refused/interrupted read to an empty list, so
  // a store that cannot answer looked like "no draft". The presence check fails
  // CLOSED instead: only a readable record with no entries proves there is none.
  it('R1-2: a drafts store that cannot answer counts as local work', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const refuse = setup(server, {
      wrapRecords: (name, records) =>
        name === DRAFTS_STORE_REGISTRATION.name
          ? { ...records, read: async () => ({ kind: 'refused' as const }) }
          : records,
    })
    await openDoc(refuse)
    expect(await refuse.service.hasLocalDraft(DOC)).toBe(true)

    const fail = setup(server, {
      wrapRecords: (name, records) =>
        name === DRAFTS_STORE_REGISTRATION.name
          ? {
              ...records,
              read: async () => {
                throw new Error('EIO: the drafts record cannot be read')
              },
            }
          : records,
    })
    await openDoc(fail)
    expect(await fail.service.hasLocalDraft(DOC)).toBe(true)
  })

  describe("G5-11 d6-3: a switch during cancel/discard keeps nothing in the next account's drafts", () => {
    /** the drafts the store of `account` keeps for the document at `path` */
    const draftsOf = async (ctx: Ctx, path: string, account: string) => {
      const opened = await ctx.layer.open({ deploymentId: 'default', accountId: account })
      if (opened.kind !== 'ok') throw new Error(opened.kind)
      return createDraftStore(opened.store.records(DRAFTS_STORE_REGISTRATION.name)).list(
        basename(dirname(path)),
      )
    }
    const pendingSave = async (server: ReturnType<typeof fakeServer>, ctx: Ctx) => {
      const path = await openDoc(ctx)
      writeFileSync(path, 'v4 of acc_1')
      server.faults.push({ route: 'upload', kind: 'network' })
      await ctx.service.save(path)
      expect(await storedIntent(ctx, path)).not.toBeNull()
      return path
    }
    type Coordinated = { coordinator: SaveCoordinator }
    /** "Bỏ lần lưu..." only applies to a stuck reconcile: move A's intent there */
    const markStuck = async (ctx: Ctx, path: string) => {
      const opened = await ctx.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
      if (opened.kind !== 'ok') throw new Error(opened.kind)
      const intents = createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name))
      const key = basename(dirname(path))
      const stored = await intents.read(key, {
        orgId: 'org_a',
        workspaceId: 'ws_1',
        baseVersion: 3,
        length: 0,
      })
      if (!stored) throw new Error('no intent')
      await intents.put(key, { ...stored.intent, state: 'reconciling-stuck' }, stored.payload)
    }

    it('cancel on a closed tab: B signs in right after the intent was read', async () => {
      const server = fakeServer({ bytes: enc('v3') })
      const ctx = setup(server)
      const path = await pendingSave(server, ctx)
      const service = ctx.service as unknown as {
        queueDocFromStore(doc: unknown): Promise<unknown>
      }
      const read = service.queueDocFromStore.bind(ctx.service)
      vi.spyOn(service, 'queueDocFromStore').mockImplementation(async (doc) => {
        const found = await read(doc)
        ctx.signInAs('acc_2')
        return found
      })
      await ctx.service.cancelSave(path, true)
      expect(await draftsOf(ctx, path, 'acc_2')).toEqual([])
      // A's intent is left exactly as it was, in A's own store
      expect(await storedIntent(ctx, path)).not.toBeNull()
    })

    it.each(['cancel', 'discard'] as const)(
      '%s: B signs in after the ownership check, before the queue engine is reached',
      async (action) => {
        const server = fakeServer({ bytes: enc('v3') })
        const ctx = setup(server)
        const path = await pendingSave(server, ctx)
        if (action === 'discard') await markStuck(ctx, path)
        const { coordinator } = ctx.service as unknown as Coordinated
        const original = coordinator[action].bind(coordinator) as (
          ...args: unknown[]
        ) => Promise<void>
        vi.spyOn(coordinator, action).mockImplementation(async (...args: unknown[]) => {
          ctx.signInAs('acc_2')
          await original(...args)
        })
        if (action === 'cancel') await ctx.service.cancelSave(path, true)
        else await ctx.service.discardSave(path)
        expect(coordinator[action]).toHaveBeenCalledTimes(1)
        expect(await draftsOf(ctx, path, 'acc_2')).toEqual([])
        expect(await storedIntent(ctx, path)).not.toBeNull()
      },
    )
  })

  it('Overwrite supersedes the pending intent before the new one', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    server.state.revision = 45
    writeFileSync(path, 'mine')
    await ctx.service.save(path)
    expect(binding(path)).toMatchObject({ state: 'conflict' })
    const oldKey = commits(server)[0]?.headers['idempotency-key']
    vi.mocked(ctx.deps.requestModuleSave as () => boolean).mockReturnValue(false)
    const resolving = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    await ctx.service.conflictAct(ctx.views[0]!.sessionId, { kind: 'overwrite', stopAi: false })
    const status = await resolving
    expect(status).toMatchObject({ state: 'saved' })
    const lastKey = commits(server).at(-1)?.headers['idempotency-key']
    expect(lastKey).not.toBe(oldKey)
    expect(await storedIntent(ctx, path)).toBeNull()
  })

  it('reopen with edit again clears a permission_revoked copy', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'commit', kind: 403, code: 'forbidden' })
    expect(await ctx.service.save(path)).toMatchObject({
      state: 'blocked',
      error: 'permission_revoked',
    })
    server.state.myLevel = 'edit'
    await ctx.service.openDocument(DOC)
    expect(binding(path)).toMatchObject({ state: 'dirty' })
    expect(binding(path).error).toBeUndefined()
  })

  it('a connectivity change wakes a parked intent (setOnline) on the next poll', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    // no network: the save parks `paused_offline`
    ctx.setCapabilityOffline(true)
    await ctx.service.save(path)
    expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'paused_offline' })
    // the network comes back: the service's connectivity hook wakes the intent
    ctx.setCapabilityOffline(false)
    await ctx.service.setQueueOnline(true)
    // the record change pushes the chip asynchronously (the publish is a sync
    // callback that resolves the document's binding), so wait for it
    await vi.waitFor(async () =>
      expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'queued' }),
    )
    // the next poll dispatches it
    await ctx.service.pollSaveQueue()
    await vi.waitFor(async () =>
      expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'saved' }),
    )
  })

  it('sync_write off -> paused_admin through the service', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { capability: { org_a: false } })
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    await ctx.service.save(path)
    expect(await ctx.service.docStatus(path)).toMatchObject({
      state: 'paused_admin',
      error: 'capability_off',
    })
    expect(uploads(server)).toHaveLength(0)
    expect(commits(server)).toHaveLength(0)
  })

  describe('G5-11f OQ-F12: a blocked intent goes back to queued when its condition lifts', () => {
    /** an intent parked offline, then dispatched into `blocked` by one server fault */
    const blockedSave = async (
      ctx: Ctx,
      server: ReturnType<typeof fakeServer>,
      fault: Fault,
    ): Promise<string> => {
      const path = await openDoc(ctx)
      writeFileSync(path, 'v4')
      ctx.setCapabilityOffline(true)
      await ctx.service.save(path)
      ctx.setCapabilityOffline(false)
      server.faults.push(fault)
      await ctx.service.pollSaveQueue()
      return path
    }
    const committedKeys = (server: ReturnType<typeof fakeServer>) =>
      commits(server).map((call) => call.headers['idempotency-key'])

    it('a session signed in again lifts a session_expired block and commits the SAME intent', async () => {
      const server = fakeServer({ bytes: enc('v3') })
      const ctx = setup(server)
      const path = await blockedSave(ctx, server, { route: 'commit', kind: 401 })
      const blocked = await storedIntent(ctx, path)
      expect(blocked?.intent).toMatchObject({ state: 'blocked', lastError: 'session_expired' })
      expect(commits(server)).toHaveLength(1)
      // the same account and deployment answers again: the pass reads the
      // capability, lifts the block and re-sends the SAME idempotency key
      await ctx.service.pollSaveQueue()
      await vi.waitFor(async () =>
        expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'saved' }),
      )
      expect(await storedIntent(ctx, path)).toBeNull()
      expect(committedKeys(server)).toEqual([
        blocked!.intent.idempotencyKey,
        blocked!.intent.idempotencyKey,
      ])
    })

    it('a lift leaves no refusal code in the binding while the user pause holds it', async () => {
      const server = fakeServer({ bytes: enc('v3') })
      const ctx = setup(server)
      const path = await blockedSave(ctx, server, { route: 'commit', kind: 401 })
      expect((await storedIntent(ctx, path))?.intent).toMatchObject({
        state: 'blocked',
        lastError: 'session_expired',
      })
      await vi.waitFor(() =>
        expect(binding(path)).toMatchObject({ state: 'blocked', error: 'session_expired' }),
      )
      // the user's own pause is in front of the queue, so the lift leaves the
      // intent waiting: the binding patch is durable and observable
      await ctx.service.pauseSending()
      await ctx.service.pollSaveQueue()
      expect((await storedIntent(ctx, path))?.intent).toMatchObject({ state: 'paused_user' })
      // the chip patch rides the record's own, asynchronous publish: wait for
      // the waiting state to land and read exactly what it wrote
      await vi.waitFor(() => {
        const written = binding(path)
        expect(written).toMatchObject({ state: 'paused_user' })
        // the code the block was parked with must not survive the lift
        expect(written.error).toBeUndefined()
      })
      expect(commits(server)).toHaveLength(1)
    })

    it('the queued chip a lift publishes carries no refusal code before the commit lands', async () => {
      const server = fakeServer({ bytes: enc('v3') })
      const ctx = setup(server)
      const path = await blockedSave(ctx, server, { route: 'commit', kind: 401 })
      expect((await storedIntent(ctx, path))?.intent).toMatchObject({
        state: 'blocked',
        lastError: 'session_expired',
      })
      // one pass lifts and commits: the queued patch the lift publishes (the
      // chip the user reads before the receipt) is what must be clean
      await ctx.service.pollSaveQueue()
      await vi.waitFor(async () =>
        expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'saved' }),
      )
      await vi.waitFor(() =>
        expect(
          ctx.statuses.some((status) => status.path === path && status.state === 'queued'),
        ).toBe(true),
      )
      const queued = ctx.statuses.filter(
        (status) => status.path === path && status.state === 'queued',
      )
      expect(queued.map((status) => status.error)).toEqual(queued.map(() => undefined))
      // and it is published BEFORE the receipt: the pre-commit chip the user
      // reads is that clean queued status, never one that lands after `saved`
      const firstQueued = ctx.statuses.findIndex(
        (status) => status.path === path && status.state === 'queued',
      )
      const firstSaved = ctx.statuses.findIndex(
        (status) => status.path === path && status.state === 'saved',
      )
      expect(firstQueued).toBeGreaterThanOrEqual(0)
      expect(firstSaved).toBeGreaterThan(firstQueued)
    })

    it.each(['member_deactivated', 'organization_suspended'] as const)(
      'the org/member active again lifts a %s block',
      async (code) => {
        const server = fakeServer({ bytes: enc('v3') })
        const ctx = setup(server)
        const path = await blockedSave(ctx, server, { route: 'commit', kind: 403, code })
        const blocked = await storedIntent(ctx, path)
        expect(blocked?.intent).toMatchObject({ state: 'blocked', lastError: code })
        await ctx.service.pollSaveQueue()
        await vi.waitFor(async () =>
          expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'saved' }),
        )
        expect(await storedIntent(ctx, path)).toBeNull()
        expect(committedKeys(server)).toEqual([
          blocked!.intent.idempotencyKey,
          blocked!.intent.idempotencyKey,
        ])
      },
    )

    it.each(['cached', 'default'] as const)(
      'a %s capability answer never lifts a session_expired block',
      async (source) => {
        const server = fakeServer({ bytes: enc('v3') })
        const ctx = setup(server)
        const path = await blockedSave(ctx, server, { route: 'commit', kind: 401 })
        const blocked = await storedIntent(ctx, path)
        expect(blocked?.intent).toMatchObject({ state: 'blocked', lastError: 'session_expired' })
        // the org answers "writes allowed", but not from a real read: a cached or
        // never-read answer may predate the refusal, so it proves nothing about
        // the session. The block stands, no attempt moves, nothing is sent
        ctx.setCapabilitySource(source)
        const before = { commits: commits(server).length, uploads: uploads(server).length }
        await ctx.service.pollSaveQueue()
        expect((await storedIntent(ctx, path))?.intent).toMatchObject({
          state: 'blocked',
          lastError: 'session_expired',
          attempt: blocked!.intent.attempt,
        })
        expect(commits(server)).toHaveLength(before.commits)
        expect(uploads(server)).toHaveLength(before.uploads)
      },
    )

    it('the document answering for writing again lifts a permission_revoked block', async () => {
      const server = fakeServer({ bytes: enc('v3') })
      const ctx = setup(server)
      const path = await blockedSave(ctx, server, { route: 'commit', kind: 403, code: 'forbidden' })
      const blocked = await storedIntent(ctx, path)
      expect(blocked?.intent).toMatchObject({ state: 'blocked', lastError: 'permission_revoked' })
      expect(ctx.service.isReadOnly(path)).toBe(true)
      // the access check still reports view-only: the block stands and no
      // request is sent (only the metadata read the probe makes)
      server.state.myLevel = 'view'
      const attempts = commits(server).length
      await ctx.service.pollSaveQueue()
      expect((await storedIntent(ctx, path))?.intent.state).toBe('blocked')
      expect(commits(server)).toHaveLength(attempts)
      // edit access is back and the probe's wait has passed: the SAME intent
      // goes back to the queue, commits, and its read-only lock is spent
      server.state.myLevel = 'edit'
      ctx.advanceClock(60_000)
      await ctx.service.pollSaveQueue()
      await vi.waitFor(async () =>
        expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'saved' }),
      )
      expect(await storedIntent(ctx, path)).toBeNull()
      expect(ctx.service.isReadOnly(path)).toBe(false)
      expect(committedKeys(server)).toEqual([
        blocked!.intent.idempotencyKey,
        blocked!.intent.idempotencyKey,
      ])
    })

    it('a restored document lifts a document_deleted block; an archived one keeps it', async () => {
      const server = fakeServer({ bytes: enc('v3') })
      const ctx = setup(server)
      const path = await blockedSave(ctx, server, {
        route: 'commit',
        kind: 410,
        code: 'document_deleted',
      })
      const blocked = await storedIntent(ctx, path)
      expect(blocked?.intent).toMatchObject({ state: 'blocked', lastError: 'document_deleted' })
      // still in the trash, and not the capability's to lift: a fresh capability
      // answer leaves the block exactly where it is
      server.state.archivedAt = '2026-10-01T00:00:00.000Z'
      const attempts = commits(server).length
      await ctx.service.pollSaveQueue()
      expect((await storedIntent(ctx, path))?.intent.state).toBe('blocked')
      expect(commits(server)).toHaveLength(attempts)
      // restored: the SAME intent goes back to the queue and commits
      server.state.archivedAt = null
      ctx.advanceClock(60_000)
      await ctx.service.pollSaveQueue()
      await vi.waitFor(async () =>
        expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'saved' }),
      )
      expect(await storedIntent(ctx, path)).toBeNull()
      expect(committedKeys(server)).toEqual([
        blocked!.intent.idempotencyKey,
        blocked!.intent.idempotencyKey,
      ])
    })

    it('a 403 document_archived parks the intent as an archived block - never a failure, never deleted', async () => {
      const server = fakeServer({ bytes: enc('v3') })
      const ctx = setup(server)
      const path = await blockedSave(ctx, server, {
        route: 'commit',
        kind: 403,
        code: 'document_archived',
      })
      const blocked = await storedIntent(ctx, path)
      // Q1=b: the archive is not the trash - the record and the binding say
      // archived (the chip is patched asynchronously), and the local copy is
      // not parked as a deleted document
      expect(blocked?.intent).toMatchObject({ state: 'blocked', lastError: 'document_archived' })
      await vi.waitFor(() =>
        expect(binding(path)).toMatchObject({ state: 'blocked', error: 'document_archived' }),
      )
      expect(ctx.service.isReadOnly(path)).toBe(false)
      // the document is out of the archive: the block lifts and the same intent commits
      await ctx.service.pollSaveQueue()
      await vi.waitFor(async () =>
        expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'saved' }),
      )
      expect(await storedIntent(ctx, path)).toBeNull()
      expect(committedKeys(server)).toEqual([
        blocked!.intent.idempotencyKey,
        blocked!.intent.idempotencyKey,
      ])
    })

    it('an inline archived refusal keeps its intent, and the probe lifts that SAME record', async () => {
      const server = fakeServer({ bytes: enc('v3') })
      const ctx = setup(server)
      const path = await openDoc(ctx)
      writeFileSync(path, 'v4')
      // the inline Save meets the archive: the commit is refused with the
      // document's own code, and the document stays in the archive afterwards
      server.state.archivedAt = '2026-10-01T00:00:00.000Z'
      server.faults.push({ route: 'commit', kind: 403, code: 'document_archived' })
      expect(await ctx.service.save(path)).toMatchObject({
        state: 'blocked',
        error: 'document_archived',
      })
      // the lead's d1a-2 decision: the intent is KEPT, never dropped like the
      // terminal document_deleted - the queue still owns the record, so a
      // sync-center row, the bounded probe and "Kiểm tra lại" exist for this copy
      const kept = await storedIntent(ctx, path)
      expect(kept, 'an archived refusal must keep its intent record').not.toBeNull()
      // OQ-F12-be-d2-2: the refusal parks the RECORD in the same call as the
      // chip, so the durable row reads blocked/document_archived at the refusal
      // itself - never a queued pending row the pill already calls blocked
      expect(kept?.intent).toMatchObject({ state: 'blocked', lastError: 'document_archived' })
      expect(commits(server)).toHaveLength(1)
      // and the next poll spends nothing on the bytes the server already
      // refused: the record is blocked (not dispatchable), the probe still sees
      // the archive, so no second upload or commit is sent
      await ctx.service.pollSaveQueue()
      expect((await storedIntent(ctx, path))?.intent).toMatchObject({
        state: 'blocked',
        lastError: 'document_archived',
      })
      expect(commits(server)).toHaveLength(1)
      expect((await storedIntent(ctx, path))?.intent.intentId).toBe(kept?.intent.intentId)
      // out of the archive: the probe ("Kiểm tra lại") reads the document
      // writable and active, lifts that SAME record back to the queue and it
      // commits under the SAME idempotency key it was refused with
      server.state.archivedAt = null
      expect(await ctx.service.recheckBlockedSave(path)).toBe(true)
      await vi.waitFor(async () =>
        expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'saved' }),
      )
      expect(await storedIntent(ctx, path)).toBeNull()
      expect(committedKeys(server)).toEqual([
        kept!.intent.idempotencyKey,
        kept!.intent.idempotencyKey,
      ])
    })

    it('a reopen clears an archived block only once the read proves the archive lifted AND edit access', async () => {
      const server = fakeServer({ bytes: enc('v3') })
      const ctx = setup(server)
      const path = await openDoc(ctx)
      writeFileSync(path, 'v4')
      // the copy is blocked `document_archived` with no record left (the user
      // dropped the draft from the sync center): the binding is the only thing
      // that remembers the block, and a reopen is its only way back
      writeFileSync(
        join(dirname(path), BINDING_FILE),
        JSON.stringify({ ...binding(path), state: 'blocked', error: 'document_archived' }),
      )
      // still archived: the reopen answers the archive, so the block stays and a
      // Save stays refused - nothing is sent
      server.state.archivedAt = '2026-10-01T00:00:00.000Z'
      await openDoc(ctx)
      expect(binding(path)).toMatchObject({ state: 'blocked', error: 'document_archived' })
      await ctx.service.save(path)
      expect(commits(server)).toHaveLength(0)
      expect(binding(path)).toMatchObject({ state: 'blocked', error: 'document_archived' })
      // out of the archive but the caller's level reads `view`: the write is
      // still refused, so the block stays - the same `canEdit` fact the queue's
      // probe reads (a view ticket / a dropped level is not a lift)
      server.state.archivedAt = null
      server.state.myLevel = 'view'
      await openDoc(ctx)
      expect(binding(path)).toMatchObject({ state: 'blocked', error: 'document_archived' })
      await ctx.service.save(path)
      expect(commits(server)).toHaveLength(0)
      expect(binding(path)).toMatchObject({ state: 'blocked', error: 'document_archived' })
      // out of the archive: the read proves the archive lifted, the reopen clears
      // the block and the local work can be saved again
      server.state.myLevel = 'edit'
      await openDoc(ctx)
      expect(binding(path)).toMatchObject({ state: 'dirty' })
      expect(binding(path).error).toBeUndefined()
      await ctx.service.save(path)
      await vi.waitFor(() => expect(binding(path).state).toBe('saved'))
      expect(commits(server)).toHaveLength(1)
    })

    it("never lifts a block of another account's intent", async () => {
      const server = fakeServer({ bytes: enc('v3') })
      const ctx = setup(server)
      const path = await blockedSave(ctx, server, { route: 'commit', kind: 401 })
      expect((await storedIntent(ctx, path, 'acc_1'))?.intent.state).toBe('blocked')
      // account A signs out and B signs in on the same machine: B's pass never
      // touches A's record, and no request is sent for it
      ctx.signOut()
      await ctx.service.teardownSaveQueue()
      ctx.signInAs('acc_2')
      const before = commits(server).length
      await ctx.service.pollSaveQueue()
      expect((await storedIntent(ctx, path, 'acc_1'))?.intent).toMatchObject({
        state: 'blocked',
        lastError: 'session_expired',
      })
      expect(commits(server)).toHaveLength(before)
    })

    describe('OQ-F12b: "Kiểm tra lại" on a blocked row re-probes access instead of looking the commit up', () => {
      it('a condition that still stands leaves the row blocked: no lookup, no new attempt', async () => {
        const server = fakeServer({ bytes: enc('v3') })
        const ctx = setup(server)
        const path = await blockedSave(ctx, server, {
          route: 'commit',
          kind: 403,
          code: 'forbidden',
        })
        const blocked = await storedIntent(ctx, path)
        expect(blocked?.intent).toMatchObject({ state: 'blocked', lastError: 'permission_revoked' })
        // the access check still reports view-only: the click proves the block
        // and answers a refusal - nothing about the record may move
        server.state.myLevel = 'view'
        const before = { lookups: lookups(server).length, commits: commits(server).length }
        expect(await ctx.service.recheckBlockedSave(path)).toBe(true)
        expect((await storedIntent(ctx, path))?.intent).toMatchObject({
          state: 'blocked',
          lastError: 'permission_revoked',
          attempt: blocked!.intent.attempt,
        })
        expect(lookups(server)).toHaveLength(before.lookups)
        expect(commits(server)).toHaveLength(before.commits)
      })

      it('a session that is still expired keeps the block, without a lookup', async () => {
        const server = fakeServer({ bytes: enc('v3') })
        const ctx = setup(server)
        const path = await blockedSave(ctx, server, { route: 'commit', kind: 401 })
        const blocked = await storedIntent(ctx, path)
        expect(blocked?.intent).toMatchObject({ state: 'blocked', lastError: 'session_expired' })
        // the forced capability read answers the same 401: the block stands
        ctx.setCapabilityExpired(true)
        const before = { lookups: lookups(server).length, commits: commits(server).length }
        expect(await ctx.service.recheckBlockedSave(path)).toBe(true)
        expect((await storedIntent(ctx, path))?.intent).toMatchObject({
          state: 'blocked',
          lastError: 'session_expired',
          attempt: blocked!.intent.attempt,
        })
        expect(lookups(server)).toHaveLength(before.lookups)
        expect(commits(server)).toHaveLength(before.commits)
      })

      it.each(['session_expired', 'member_deactivated', 'organization_suspended'] as const)(
        'the %s condition lifted: the row goes back to queued and the SAME intent commits',
        async (code) => {
          const fault: Fault =
            code === 'session_expired'
              ? { route: 'commit', kind: 401 }
              : { route: 'commit', kind: 403, code }
          const server = fakeServer({ bytes: enc('v3') })
          const ctx = setup(server)
          const path = await blockedSave(ctx, server, fault)
          const blocked = await storedIntent(ctx, path)
          expect(blocked?.intent).toMatchObject({ state: 'blocked', lastError: code })
          // no clock advance: the click re-probes NOW, not at the poll's backoff
          expect(await ctx.service.recheckBlockedSave(path)).toBe(true)
          await vi.waitFor(async () =>
            expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'saved' }),
          )
          expect(await storedIntent(ctx, path)).toBeNull()
          expect(committedKeys(server)).toEqual([
            blocked!.intent.idempotencyKey,
            blocked!.intent.idempotencyKey,
          ])
        },
      )

      it('permission back: the probe lifts the block right away and the SAME intent commits', async () => {
        const server = fakeServer({ bytes: enc('v3') })
        const ctx = setup(server)
        const path = await blockedSave(ctx, server, {
          route: 'commit',
          kind: 403,
          code: 'forbidden',
        })
        const blocked = await storedIntent(ctx, path)
        expect(blocked?.intent).toMatchObject({ state: 'blocked', lastError: 'permission_revoked' })
        expect(ctx.service.isReadOnly(path)).toBe(true)
        server.state.myLevel = 'edit'
        expect(await ctx.service.recheckBlockedSave(path)).toBe(true)
        await vi.waitFor(async () =>
          expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'saved' }),
        )
        expect(await storedIntent(ctx, path)).toBeNull()
        expect(committedKeys(server)).toEqual([
          blocked!.intent.idempotencyKey,
          blocked!.intent.idempotencyKey,
        ])
        // the lock verdict the refusal put up is spent with the block
        expect(ctx.service.isReadOnly(path)).toBe(false)
      })

      it('a document still in the trash keeps the block; restored, the SAME intent commits', async () => {
        const server = fakeServer({ bytes: enc('v3') })
        const ctx = setup(server)
        const path = await blockedSave(ctx, server, {
          route: 'commit',
          kind: 410,
          code: 'document_deleted',
        })
        const blocked = await storedIntent(ctx, path)
        expect(blocked?.intent).toMatchObject({ state: 'blocked', lastError: 'document_deleted' })
        // archived: the metadata read answers, and still refuses the write
        server.state.archivedAt = '2026-10-01T00:00:00.000Z'
        const before = commits(server).length
        expect(await ctx.service.recheckBlockedSave(path)).toBe(true)
        expect((await storedIntent(ctx, path))?.intent).toMatchObject({
          state: 'blocked',
          lastError: 'document_deleted',
        })
        expect(commits(server)).toHaveLength(before)
        // restored: the click lifts the block and the normal path commits it
        server.state.archivedAt = null
        expect(await ctx.service.recheckBlockedSave(path)).toBe(true)
        await vi.waitFor(async () =>
          expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'saved' }),
        )
        expect(await storedIntent(ctx, path)).toBeNull()
        expect(committedKeys(server)).toEqual([
          blocked!.intent.idempotencyKey,
          blocked!.intent.idempotencyKey,
        ])
      })

      it('the archive is not the trash: a document_deleted block keeps its deleted reason', async () => {
        const server = fakeServer({ bytes: enc('v3') })
        const ctx = setup(server)
        const path = await blockedSave(ctx, server, {
          route: 'commit',
          kind: 410,
          code: 'document_deleted',
        })
        expect((await storedIntent(ctx, path))?.intent).toMatchObject({
          state: 'blocked',
          lastError: 'document_deleted',
        })
        // the deleted block keeps the deleted reason on the chip too (patched
        // asynchronously by the record's own publish)
        await vi.waitFor(() =>
          expect(binding(path)).toMatchObject({ state: 'blocked', error: 'document_deleted' }),
        )
      })

      it('an archived block stays archived on a probe that still sees the archive, and lifts on the unarchive', async () => {
        const server = fakeServer({ bytes: enc('v3') })
        const ctx = setup(server)
        const path = await blockedSave(ctx, server, {
          route: 'commit',
          kind: 403,
          code: 'document_archived',
        })
        const blocked = await storedIntent(ctx, path)
        expect(blocked?.intent).toMatchObject({ state: 'blocked', lastError: 'document_archived' })
        // still in the archive: the click answers the archive, not a deletion -
        // the read sees the document and keeps the block exactly where it was
        server.state.archivedAt = '2026-10-01T00:00:00.000Z'
        const before = { commits: commits(server).length, lookups: lookups(server).length }
        expect(await ctx.service.recheckBlockedSave(path)).toBe(true)
        expect((await storedIntent(ctx, path))?.intent).toMatchObject({
          state: 'blocked',
          lastError: 'document_archived',
          attempt: blocked!.intent.attempt,
        })
        expect(commits(server)).toHaveLength(before.commits)
        expect(lookups(server)).toHaveLength(before.lookups)
        // out of the archive: the click lifts the block and the same intent commits
        server.state.archivedAt = null
        expect(await ctx.service.recheckBlockedSave(path)).toBe(true)
        await vi.waitFor(async () =>
          expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'saved' }),
        )
        expect(await storedIntent(ctx, path)).toBeNull()
        expect(committedKeys(server)).toEqual([
          blocked!.intent.idempotencyKey,
          blocked!.intent.idempotencyKey,
        ])
      })

      it('refuses a row that is not blocked, so the reconciling lookup path stands', async () => {
        const server = fakeServer({ bytes: enc('v3') })
        const ctx = setup(server)
        const path = await openDoc(ctx)
        writeFileSync(path, 'v4')
        // parked offline, never committed: a queued intent, not a blocked one
        ctx.setCapabilityOffline(true)
        await ctx.service.save(path)
        ctx.setCapabilityOffline(false)
        expect((await storedIntent(ctx, path))?.intent.state).toBe('paused_offline')
        expect(await ctx.service.recheckBlockedSave(path)).toBe(false)
        expect((await storedIntent(ctx, path))?.intent.state).toBe('paused_offline')
      })
      it("never re-probes another account's blocked row", async () => {
        const server = fakeServer({ bytes: enc('v3') })
        const ctx = setup(server)
        const path = await blockedSave(ctx, server, { route: 'commit', kind: 401 })
        expect((await storedIntent(ctx, path, 'acc_1'))?.intent.state).toBe('blocked')
        ctx.signOut()
        await ctx.service.teardownSaveQueue()
        ctx.signInAs('acc_2')
        const before = commits(server).length
        // B's click on A's row must not probe, lift or send anything
        expect(await ctx.service.recheckBlockedSave(path)).toBe(false)
        expect((await storedIntent(ctx, path, 'acc_1'))?.intent).toMatchObject({
          state: 'blocked',
          lastError: 'session_expired',
        })
        expect(commits(server)).toHaveLength(before)
      })
    })
  })

  it('G506-be-1: an inline 409 conflict leaves the record non-dispatchable (poll sends nothing)', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    // someone saved on the web: the inline commit meets a base conflict
    server.state.revision = 45
    writeFileSync(path, 'mine')
    expect(await ctx.service.save(path)).toMatchObject({ state: 'conflict', error: 'conflict' })
    // the durable record must end 'conflict' (the intent is kept), never 'queued'
    expect((await storedIntent(ctx, path))?.intent).toMatchObject({
      state: 'conflict',
      documentId: DOC,
      baseRevision: '41',
    })
    // the poll must not replay the conflicted save: no upload, no commit
    const before = { upload: uploads(server).length, commit: commits(server).length }
    await ctx.service.pollSaveQueue()
    expect(uploads(server)).toHaveLength(before.upload)
    expect(commits(server)).toHaveLength(before.commit)
    expect((await storedIntent(ctx, path))?.intent.state).toBe('conflict')
  })

  const seed = async (
    ctx: Ctx,
    state: 'uploading' | 'committing',
    path: string,
    idempotencyKey: string,
  ) => {
    const key = basename(dirname(path))
    const opened = await ctx.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
    if (opened.kind !== 'ok') throw new Error('store did not open')
    const intents = createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name))
    await intents.put(
      key,
      {
        v: 2,
        intentId: `intent_${key}`,
        idempotencyKey,
        documentId: DOC,
        orgId: 'org_a',
        workspaceId: 'ws_1',
        baseRevision: '41',
        baseVersion: 3,
        checksum: hex(enc('v4')),
        length: enc('v4').byteLength,
        generation: 1,
        state,
        attempt: 1,
        createdAt: '2026-10-13T00:00:00.000Z',
        updatedAt: '2026-10-13T00:00:00.000Z',
      },
      enc('v4'),
    )
  }
  const lookups = (server: ReturnType<typeof fakeServer>) =>
    server.calls.filter((c) => c.path.endsWith('/versions/commit') && c.method === 'GET')

  it('G5-06 fix-C item 4 / AC-4: uploading at rest re-sends the same key, no lookup', async () => {
    // a stop left the record `uploading` at rest (lost lock / crash). The commit
    // POST was never sent, so a lookup would answer 410 commit_intent_unknown
    // for a save the server never saw (AC-4): the poll re-sends the SAME key
    // instead - ZERO lookups, one upload, one commit, in that one poll
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    await seed(ctx, 'uploading', path, 'key_stuck')
    await ctx.service.pollSaveQueue()
    expect(lookups(server)).toHaveLength(0)
    expect(uploads(server)).toHaveLength(1)
    expect(commits(server)).toHaveLength(1)
    // the requeued record is attempt 2: the bytes stage under that attempt's
    // upload key while the COMMIT key is unchanged (UNI-1918 B69-lite)
    expect(uploads(server)[0]!.headers['idempotency-key']).toBe(uploadKeyFor('key_stuck', 2))
    expect(commits(server)[0]!.headers['idempotency-key']).toBe('key_stuck')
    expect(await storedIntent(ctx, path)).toBeNull()
  })

  it('G5-06 fix-C item 4 / AC-4: committing at rest is settled by lookup', async () => {
    // a record left `committing` (the commit POST may have been sent) whose
    // lookup answers committed settles with the receipt: one lookup, no upload,
    // no commit, and the record is cleared
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    await ctx.service.save(path)
    await vi.waitFor(async () =>
      expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'saved' }),
    )
    expect(commits(server)).toHaveLength(1)
    expect(await storedIntent(ctx, path)).toBeNull()
    const doneKey = commits(server)[0]!.headers['idempotency-key']!
    await seed(ctx, 'committing', path, doneKey)
    const before = { upload: uploads(server).length, commit: commits(server).length }
    await ctx.service.pollSaveQueue()
    expect(lookups(server)).toHaveLength(1)
    expect(uploads(server)).toHaveLength(before.upload)
    expect(commits(server)).toHaveLength(before.commit)
    expect(await storedIntent(ctx, path)).toBeNull()
  })

  it('EL1A-BE-4: a queue-settled save drops the editLock the 423 left on the binding', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    await ctx.service.save(path)
    await vi.waitFor(async () =>
      expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'saved' }),
    )
    const doneKey = commits(server)[0]!.headers['idempotency-key']!
    await seed(ctx, 'committing', path, doneKey)
    // a 423 left the holder on the binding; the queue-settled commit clears it
    const lock = {
      holderName: 'Minh Trần',
      since: '2026-04-17T03:00:00Z',
      expiresAt: '2026-04-17T03:02:00Z',
      heldByMe: false,
    }
    const file = join(dirname(path), BINDING_FILE)
    writeFileSync(
      file,
      `${JSON.stringify({ ...binding(path), state: 'edit_locked', error: 'edit_locked', editLock: lock })}\n`,
    )
    await ctx.service.pollSaveQueue()
    // the record publish is fire-and-forget: the settle's binding write lands a beat later
    await vi.waitFor(() => expect(binding(path).state).toBe('saved'))
    const after = binding(path)
    expect(after).not.toHaveProperty('editLock')
    expect(after).not.toHaveProperty('error')
    expect(await storedIntent(ctx, path)).toBeNull()
  })

  it('EL1A-BE-4: a cancelled save drops the editLock too', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    // the commit is refused by someone else's lock: the binding parks edit_locked
    server.faults.push({ route: 'commit', kind: 423, code: 'document_locked' })
    await ctx.service.save(path)
    expect(binding(path)).toMatchObject({ state: 'edit_locked', error: 'edit_locked' })
    expect(binding(path)).toHaveProperty('editLock')
    await ctx.service.cancelSave(path)
    const after = binding(path)
    expect(after.state).toBe('dirty')
    expect(after).not.toHaveProperty('error')
    expect(after).not.toHaveProperty('editLock')
  })

  it('EL1A-R2-3: a real queue publish of a parked edit_locked intent keeps the holder the binding carries', async () => {
    // EL1A-R2-3 (reviewer_fe r2): BE-2 was pinned only by direct `queueBindingPatch` calls, so a
    // revert of the call site's `doc.binding` argument stayed green. This drives the SAME record
    // through the REAL path - the store, the poll, the dispatcher's publish and applyRecordToChip -
    // and asserts the holder the binding carries is still there after the chip is rewritten.
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    // someone else holds the server edit lock: the commit is refused 423 and the intent parks
    // `failed` with `lastError: 'edit_locked'` (the chip parks `edit_locked` beside it)
    server.faults.push({ route: 'commit', kind: 423, code: 'document_locked' })
    await ctx.service.save(path)
    expect(binding(path)).toMatchObject({ state: 'edit_locked', error: 'edit_locked' })
    expect((await storedIntent(ctx, path))?.intent).toMatchObject({
      state: 'failed',
      lastError: 'edit_locked',
    })
    // the 423 carried no holder fields here, so write a real holder onto the parked binding: the
    // record itself has no editLock (IntentRecordV2 has none), so it can only come from the binding.
    // A stale `error` proves the publish really rewrote the chip: the patch must overwrite it.
    const lock = {
      holderName: 'Minh Trần',
      since: '2026-04-17T03:00:00Z',
      expiresAt: '2026-04-17T03:02:00Z',
      heldByMe: false,
    }
    const file = join(dirname(path), BINDING_FILE)
    writeFileSync(
      file,
      `${JSON.stringify({ ...binding(path), error: 'server_error', editLock: lock })}\n`,
    )
    // an offline lane makes the poll publish the stored record (a no-op on the record's state, but
    // the real publish still rewrites the chip from it: dispatcher apply -> service.publishRecord)
    ctx.setCapabilityOffline(true)
    await ctx.service.pollSaveQueue()
    ctx.setCapabilityOffline(false)
    // the publish is fire-and-forget: the chip rewrite lands a beat later. The stale error is gone
    // (the record's `edit_locked` won), which proves the binding really was rewritten from the record
    await vi.waitFor(() => expect(binding(path).error).toBe('edit_locked'))
    expect(binding(path)).toMatchObject({ state: 'edit_locked', error: 'edit_locked' })
    expect(binding(path).editLock).toEqual(lock)
    // the record is still parked: a publish never re-dispatches a failed intent
    expect((await storedIntent(ctx, path))?.intent).toMatchObject({
      state: 'failed',
      lastError: 'edit_locked',
    })
  })

  it('G506-be-4: teardownSaveQueue awaits the in-flight poll and nothing lands after it resolves', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    // park a queued intent, then let the poll dispatch it
    ctx.setCapabilityOffline(true)
    await ctx.service.save(path)
    ctx.setCapabilityOffline(false)
    // gate the upload so the poll is mid-dispatch when teardown lands
    const realFetch = server.fetch.getMockImplementation()!
    let releaseUpload!: () => void
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve
    })
    let enteredUpload!: () => void
    const inUpload = new Promise<void>((resolve) => {
      enteredUpload = resolve
    })
    server.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/uploads')) {
        enteredUpload()
        await uploadGate
      }
      return realFetch(url, init)
    })
    const polling = ctx.service.pollSaveQueue()
    await inUpload
    // the account switches mid-upload: teardown must stop the pass before it commits
    ctx.signInAs('acc_2')
    let resolved = false
    const teardown = ctx.service.teardownSaveQueue().then(() => {
      resolved = true
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    // teardown waits for the in-flight pass, it does not return early
    expect(resolved).toBe(false)
    releaseUpload()
    await teardown
    const after = server.calls.length
    await polling
    // no request landed after teardown resolved
    expect(server.calls.length).toBe(after)
  })

  it('G506-be-7: binding writes for one document serialize, so the later state wins', async () => {
    // a store whose FIRST write is slow: without serialization the second write
    // lands first and the slow one then overwrites it (the wrong state wins)
    const order: string[] = []
    const delays: Record<string, number> = { first: 30, second: 0 }
    const store = {
      write: async (_dir: string, binding: { state: string }) => {
        await new Promise((resolve) => setTimeout(resolve, delays[binding.state] ?? 0))
        order.push(binding.state)
        return true
      },
    }
    const coordinator = new SaveCoordinator({
      store: store as never,
      client: {} as never,
      isSignedIn: () => true,
      ownsBinding: () => true,
      intents: async () => ({ kind: 'unavailable' }),
      publish: () => undefined,
    })
    const doc = {
      path: '/doc',
      dir: '/doc',
      deploymentId: 'd',
      userId: 'u',
      key: 'k',
      binding: { state: 'saving' },
    } as never
    const first = coordinator.commitState(doc, { state: 'first' } as never)
    const second = coordinator.commitState(doc, { state: 'second' } as never)
    await Promise.all([first, second])
    expect(order).toEqual(['first', 'second'])
  })

  it('G506-be-1: a poll during an in-flight inline save does not upload the same key twice', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    // gate the commit so the inline save is in flight while the poll runs
    const realFetch = server.fetch.getMockImplementation()!
    let releaseCommit!: () => void
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve
    })
    let enteredCommit!: () => void
    const inCommit = new Promise<void>((resolve) => {
      enteredCommit = resolve
    })
    server.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes('/versions/commit') && (init.method ?? 'POST') === 'POST') {
        enteredCommit()
        await commitGate
      }
      return realFetch(url, init)
    })
    const saving = ctx.service.coordinator.save(path)
    await inCommit
    // the inline save holds the key: the poll enumerates the stored intent but
    // must skip it (one writer per intent). Run it concurrently - a poll that
    // wrongly dispatches would block on the same commit gate
    const polling = ctx.service.pollSaveQueue()
    await new Promise((resolve) => setTimeout(resolve, 50))
    releaseCommit()
    await polling
    await saving
    expect(uploads(server)).toHaveLength(1)
    expect(commits(server)).toHaveLength(1)
  })

  it('G506-be-d1-1: a settle left in flight is not sent after teardown resolves', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    const key = basename(dirname(path))
    // a record at rest in `committing` (a lost lock / crash after the commit
    // POST may have been sent): the poll settles it through the G5-07 lookup
    // with the SAME key
    const opened = await ctx.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
    if (opened.kind !== 'ok') throw new Error('store did not open')
    await createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name)).put(
      key,
      {
        v: 2,
        intentId: `intent_${key}`,
        idempotencyKey: 'key_stuck',
        documentId: DOC,
        orgId: 'org_a',
        workspaceId: 'ws_1',
        baseRevision: '41',
        baseVersion: 3,
        checksum: hex(enc('v4')),
        length: enc('v4').byteLength,
        generation: 1,
        state: 'committing',
        attempt: 1,
        createdAt: '2026-10-13T00:00:00.000Z',
        updatedAt: '2026-10-13T00:00:00.000Z',
      },
      enc('v4'),
    )
    // gate the settle lookup so the poll is mid-settle when teardown lands
    const realFetch = server.fetch.getMockImplementation()!
    let releaseLookup!: () => void
    const lookupGate = new Promise<void>((resolve) => {
      releaseLookup = resolve
    })
    let enteredLookup!: () => void
    const inLookup = new Promise<void>((resolve) => {
      enteredLookup = resolve
    })
    server.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/versions/commit') && (init.method ?? 'GET') === 'GET') {
        enteredLookup()
        await lookupGate
      }
      return realFetch(url, init)
    })
    const polling = ctx.service.pollSaveQueue()
    await inLookup
    // the account switches mid-settle: teardown must await the in-flight pass
    ctx.signInAs('acc_2')
    let resolved = false
    const teardown = ctx.service.teardownSaveQueue().then(() => {
      resolved = true
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(resolved).toBe(false)
    releaseLookup()
    await teardown
    const after = server.calls.length
    await polling
    // no lookup/record write landed after teardown resolved
    expect(server.calls.length).toBe(after)
  })

  it("G506-be-d1-2: a read-only window status does not rewrite the holder's binding.json", async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const first = setup(server)
    const second = setup(server)
    const path = await openDoc(first)
    await openDoc(second)
    const key = basename(dirname(path))
    // a stored pending intent for window 2 (no save: no binding write yet)
    const opened = await second.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
    if (opened.kind !== 'ok') throw new Error('store did not open')
    await createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name)).put(
      key,
      {
        v: 2,
        intentId: `intent_${key}`,
        idempotencyKey: 'key_pending',
        documentId: DOC,
        orgId: 'org_a',
        workspaceId: 'ws_1',
        baseRevision: '41',
        baseVersion: 3,
        checksum: hex(enc('v4')),
        length: enc('v4').byteLength,
        generation: 1,
        state: 'queued',
        attempt: 0,
        createdAt: '2026-10-13T00:00:00.000Z',
        updatedAt: '2026-10-13T00:00:00.000Z',
      },
      enc('v4'),
    )
    // window 1 takes a fresh lease (a live holder)
    const opener = createDocLock({
      root: join(dir, 'uniwork-documents'),
      scope: { deploymentId: 'default', accountId: 'acc_1' },
      clock: () => Date.now(),
      owner: 'win1',
    })
    expect((await opener.acquire(key)).kind).toBe('held')
    const before = readFileSync(join(path, '..', BINDING_FILE))
    // window 2's poll sees window 1's fresh lease and goes read-only, pushing
    // blocked/other_window to ITSELF only (never the shared binding.json)
    await second.service.pollSaveQueue()
    expect(second.service.isOtherWindow(path)).toBe(true)
    // window 2's own status reads blocked/other_window
    await vi.waitFor(async () =>
      expect(await second.service.docStatus(path)).toMatchObject({
        state: 'blocked',
        error: 'other_window',
      }),
    )
    // window 1's binding.json is byte-for-byte unchanged, and its own status is
    // still the holder's (never the loser's other_window)
    expect(readFileSync(join(path, '..', BINDING_FILE))).toEqual(before)
    expect(await first.service.docStatus(path)).not.toMatchObject({ error: 'other_window' })
    // A32 (UNI-1362): the holder releases the lock and no queue record of this
    // document ever moves again. A status read revalidates the window-local
    // overlay against the durable lease, so the read-only chip clears instead of
    // being re-applied forever
    await opener.release(key, 1)
    expect(await second.service.docStatus(path)).not.toMatchObject({ error: 'other_window' })
    // and a lock still held keeps the overlay (the same read, the other verdict)
    expect((await opener.acquire(key)).kind).toBe('held')
    await second.service.pollSaveQueue()
    expect(await second.service.docStatus(path)).toMatchObject({
      state: 'blocked',
      error: 'other_window',
    })
    await opener.release(key, 1)
  })

  it("G506-be-d1-3: an inline Save during the poll's tick is excluded (one writer)", async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    const key = basename(dirname(path))
    // a stored `reconciling` record: the poll's tick looks it up
    const opened = await ctx.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
    if (opened.kind !== 'ok') throw new Error('store did not open')
    await createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name)).put(
      key,
      {
        v: 2,
        intentId: `intent_${key}`,
        idempotencyKey: 'key_reconcile',
        documentId: DOC,
        orgId: 'org_a',
        workspaceId: 'ws_1',
        baseRevision: '41',
        baseVersion: 3,
        checksum: hex(enc('v3')),
        length: enc('v3').byteLength,
        generation: 1,
        state: 'reconciling-stuck',
        attempt: 1,
        reconcileSince: '2026-10-13T00:00:00.000Z',
        createdAt: '2026-10-13T00:00:00.000Z',
        updatedAt: '2026-10-13T00:00:00.000Z',
      },
      enc('v3'),
    )
    // gate the tick's lookup so the poll is inside tick when the Save starts
    const realFetch = server.fetch.getMockImplementation()!
    let releaseLookup!: () => void
    const lookupGate = new Promise<void>((resolve) => {
      releaseLookup = resolve
    })
    let enteredLookup!: () => void
    const inLookup = new Promise<void>((resolve) => {
      enteredLookup = resolve
    })
    server.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/versions/commit') && (init.method ?? 'GET') === 'GET') {
        enteredLookup()
        await lookupGate
      }
      return realFetch(url, init)
    })
    const polling = ctx.service.pollSaveQueue()
    await inLookup
    // an inline Save of the same document starts while the poll is inside tick:
    // the key is already marked in flight, so the inline pipeline is excluded
    // (it never starts its own upload of the same intent)
    writeFileSync(path, 'v4 inline')
    const inline = ctx.service.coordinator.save(path)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(uploads(server)).toHaveLength(0)
    releaseLookup()
    await polling
    await inline
    // one writer: the poll's tick lookup settled the record, and only the poll
    // dispatched it - never a second upload from the inline save
    expect(
      server.calls.filter((c) => c.path.endsWith('/versions/commit') && c.method === 'GET'),
    ).toHaveLength(1)
    expect(uploads(server)).toHaveLength(1)
    // the lookup's not_committed minted attempt 2: the bytes stage under that
    // attempt's upload key, the COMMIT key is the record's own (UNI-1918 B69-lite)
    expect(uploads(server)[0]!.headers['idempotency-key']).toBe(uploadKeyFor('key_reconcile', 2))
    expect(commits(server)).toHaveLength(1)
    expect(commits(server)[0]!.headers['idempotency-key']).toBe('key_reconcile')
  })

  it('G506-be-d1-1 / G5-11: the account-boundary lock stops runtime and awaits lockSession', () => {
    // the wiring source pins the order: the feed pass stops before
    // service.lockSession (which waits for in-flight saves, parks N+1, and locks
    // the store without wiping). The behavioural pin - an account switch stops
    // the runtime and runs lockSession - lives in uniwork-docs-lock-wiring.
    const source = readFileSync(join(__dirname, '..', 'src/main/uniwork-docs/wiring.ts'), 'utf8')
    const lockIdx = source.indexOf('lockStore: async (owner')
    expect(lockIdx).toBeGreaterThan(-1)
    const lockBlock = source.slice(lockIdx)
    const stopIdx = lockBlock.indexOf('stopFeed()')
    const sessionIdx = lockBlock.indexOf('await service.lockSession(')
    expect(stopIdx).toBeGreaterThan(-1)
    expect(sessionIdx).toBeGreaterThan(-1)
    expect(stopIdx).toBeLessThan(sessionIdx)
    // the sync store is never wiped at the boundary; the only wipe is the
    // pinned offline library (G5-05), after lockSession, its lock before stopFeed
    const wipes = source.split('lockAndWipe(').length - 1
    expect(wipes).toBe(source.split('libraryLayerFor().lockAndWipe(').length - 1)
    const libLockIdx = lockBlock.indexOf('runtime.library?.lockBoundary()')
    expect(libLockIdx).toBeGreaterThan(-1)
    expect(libLockIdx).toBeLessThan(stopIdx)
    expect(lockBlock.indexOf('libraryLayerFor().lockAndWipe(')).toBeGreaterThan(sessionIdx)
  })
})

/**
 * G8-12 x G5-06: a Save the queue settles (a parked intent dispatched by a
 * later poll, or a record left `committing` at rest that a lookup finds
 * committed) moves the comments anchor base to the receipt's version id and
 * pushes `comments.saved` exactly once, exactly as the inline settle does.
 */
describe('G8-12 comments seam on queue-settled saves', () => {
  /** the service reads `notifySaved` from its deps at push time */
  const withSavedSpy = (ctx: Ctx) => {
    const notifySaved = vi.fn()
    ctx.deps.notifySaved = notifySaved
    return notifySaved
  }

  it('a parked Save that a later poll commits moves baseVersionId and pushes saved once', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    expect(binding(path).baseVersionId).toBe('v3')
    const notifySaved = withSavedSpy(ctx)
    writeFileSync(path, 'v4')
    ctx.setCapabilityOffline(true)
    await ctx.service.save(path)
    expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'paused_offline' })
    // nothing settled yet: no push, the base still names the opened version
    expect(notifySaved).not.toHaveBeenCalled()
    expect(binding(path).baseVersionId).toBe('v3')
    ctx.setCapabilityOffline(false)
    await ctx.service.setQueueOnline(true)
    await vi.waitFor(async () =>
      expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'queued' }),
    )
    await ctx.service.pollSaveQueue()
    await vi.waitFor(async () =>
      expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'saved' }),
    )
    await vi.waitFor(() => expect(notifySaved).toHaveBeenCalled())
    expect(binding(path).baseVersion).toBe(4)
    expect(binding(path).baseVersionId).toBe('ver_4')
    // a later poll with nothing pending pushes nothing more
    await ctx.service.pollSaveQueue()
    expect(notifySaved.mock.calls).toEqual([[path, 'ver_4']])
  })

  it('a record left committing at rest that a lookup finds committed pushes saved once', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    const key = basename(dirname(path))
    // the commit landed on the server but the copy never heard the receipt
    // (a crash after the POST): the record sits `committing` at rest
    writeFileSync(path, 'v4')
    const notifySaved = withSavedSpy(ctx)
    await ctx.service.save(path)
    const doneKey = commits(server)[0]!.headers['idempotency-key']!
    notifySaved.mockClear()
    const opened = await ctx.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
    if (opened.kind !== 'ok') throw new Error('store did not open')
    const intents = createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name))
    await intents.put(
      key,
      {
        v: 2,
        intentId: `intent_${key}`,
        idempotencyKey: doneKey,
        documentId: DOC,
        orgId: 'org_a',
        workspaceId: 'ws_1',
        baseRevision: '41',
        baseVersion: 3,
        checksum: hex(enc('v4')),
        length: enc('v4').byteLength,
        generation: 1,
        state: 'committing',
        attempt: 1,
        createdAt: '2026-10-13T00:00:00.000Z',
        updatedAt: '2026-10-13T00:00:00.000Z',
      },
      enc('v4'),
    )
    // the copy still believes the old base (the receipt was lost)
    const stale = { ...binding(path), baseRevision: '41', baseVersion: 3, baseVersionId: 'v3' }
    writeFileSync(join(dirname(path), BINDING_FILE), JSON.stringify(stale))
    await ctx.service.pollSaveQueue()
    await vi.waitFor(() => expect(notifySaved).toHaveBeenCalled())
    expect(binding(path).baseVersion).toBe(4)
    expect(binding(path).baseVersionId).toBe('ver_4')
    expect(notifySaved.mock.calls).toEqual([[path, 'ver_4']])
    expect(await storedIntent(ctx, path)).toBeNull()
  })

  it('a dispatched Save refused with 403 pushes nothing and caps the level at view', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    expect(binding(path).level).toBe('edit')
    const notifySaved = withSavedSpy(ctx)
    writeFileSync(path, 'v4')
    ctx.setCapabilityOffline(true)
    await ctx.service.save(path)
    ctx.setCapabilityOffline(false)
    await ctx.service.setQueueOnline(true)
    await vi.waitFor(async () =>
      expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'queued' }),
    )
    server.faults.push({ route: 'commit', kind: 403, code: 'forbidden' })
    await ctx.service.pollSaveQueue()
    await vi.waitFor(() => expect(binding(path).state).toBe('blocked'))
    expect(binding(path).error).toBe('permission_revoked')
    expect(binding(path).level).toBe('view')
    expect(binding(path).baseVersionId).toBe('v3')
    expect(notifySaved).not.toHaveBeenCalled()
  })
})

/**
 * BIGUP-A1: the production wiring of the chunked new-version path. The service
 * builds both the SaveCoordinator and the QueueDispatcher over the REAL client
 * (the same `api()` the rest of the service uses), so this suite drives a real
 * Ctrl/Cmd+S of a payload above `documents.limits.chunked_upload_threshold_bytes`
 * through the fake server's session routes: create -> part PUTs -> complete ->
 * versions/commit, never the one-shot multipart POST.
 */
describe('BIGUP-A1: the service wires the chunked version path', () => {
  /** a valid DOCX of `totalBytes`, built in memory (real ZIP local + central + EOCD) */
  function docxBytes(totalBytes: number): Uint8Array {
    const entries = (
      imageSize: number,
    ): Array<{ name: string; storedSize?: number; data?: Buffer }> => [
      { name: 'word/media/image1.png', storedSize: imageSize },
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
      { name: 'word/document.xml', data: Buffer.from('<w:document/>') },
    ]
    const build = (list: ReturnType<typeof entries>): Uint8Array => {
      const chunks: Buffer[] = []
      const central: Buffer[] = []
      let offset = 0
      for (const entry of list) {
        const name = Buffer.from(entry.name, 'utf8')
        const stored = entry.storedSize !== undefined
        const data = entry.data ?? Buffer.alloc(0)
        const body = stored ? null : deflateRawSync(data)
        const size = stored ? entry.storedSize! : data.length
        const header = Buffer.alloc(30)
        header.writeUInt32LE(0x04034b50, 0)
        header.writeUInt16LE(20, 4)
        header.writeUInt16LE(stored ? 0 : 8, 8)
        header.writeUInt32LE(body?.length ?? size, 18)
        header.writeUInt32LE(size, 22)
        header.writeUInt16LE(name.length, 26)
        const localOffset = offset
        chunks.push(header, name)
        offset += header.length + name.length
        if (body) {
          chunks.push(body)
          offset += body.length
        } else {
          chunks.push(Buffer.alloc(size))
          offset += size
        }
        const cd = Buffer.alloc(46)
        cd.writeUInt32LE(0x02014b50, 0)
        cd.writeUInt16LE(20, 4)
        cd.writeUInt16LE(20, 6)
        cd.writeUInt16LE(stored ? 0 : 8, 10)
        cd.writeUInt32LE(body?.length ?? size, 20)
        cd.writeUInt32LE(size, 24)
        cd.writeUInt16LE(name.length, 28)
        cd.writeUInt32LE(localOffset, 42)
        central.push(cd, name)
      }
      const cdBuffer = Buffer.concat(central)
      const eocd = Buffer.alloc(22)
      eocd.writeUInt32LE(0x06054b50, 0)
      eocd.writeUInt16LE(list.length, 8)
      eocd.writeUInt16LE(list.length, 10)
      eocd.writeUInt32LE(cdBuffer.length, 12)
      eocd.writeUInt32LE(offset, 16)
      return new Uint8Array(Buffer.concat([...chunks, cdBuffer, eocd]))
    }
    const overhead = build(entries(0)).byteLength
    return build(entries(totalBytes - overhead))
  }

  const MB = 1024 * 1024
  const THRESHOLD = 64 * 1024
  const BIG = 512 * 1024
  const limits = (): DocumentLimits => ({
    ...DEFAULT_DOCUMENT_LIMITS,
    max_bytes: 200 * MB,
    warn_bytes: 180 * MB,
    chunked_upload_threshold_bytes: THRESHOLD,
  })
  /** the store budget the layer needs to hold a `BIG` intent snapshot */
  const budgetBytes = 8 * MB
  const sessionCalls = (server: ReturnType<typeof fakeServer>, suffix: string) =>
    server.calls.filter((c) => c.path.endsWith(suffix))
  const sessionCreates = (server: ReturnType<typeof fakeServer>) =>
    server.calls.filter((c) => c.path.endsWith('/upload-sessions') && c.method === 'POST')
  const partPuts = (server: ReturnType<typeof fakeServer>) =>
    server.calls.filter((c) => c.path.startsWith('/storage/part/') && c.method === 'PUT')

  it('an inline Save above the threshold goes create -> parts -> complete -> commit (no one-shot POST)', async () => {
    const big = docxBytes(BIG)
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { limits, budgetBytes })
    const path = await openDoc(ctx)
    writeFileSync(path, big)

    const status = await ctx.service.save(path)
    expect(status).toMatchObject({ state: 'saved' })

    // the session path ran, and the single-request upload POST never did
    expect(sessionCreates(server)).toHaveLength(1)
    expect(sessionCalls(server, '/complete')).toHaveLength(1)
    expect(partPuts(server).length).toBeGreaterThan(1)
    expect(uploads(server)).toHaveLength(0)
    expect(commits(server)).toHaveLength(1)
    // every part landed under the session the create answered, and the bytes
    // the server assembled are exactly the file's
    const assembled = server.uploads.get(`session:${[...server.sessions.keys()][0]}`)
    expect(assembled?.bytes).toEqual(big)
    expect(commits(server)[0]!.headers['idempotency-key']).toBeTruthy()
    expect(binding(path).state).toBe('saved')
  })

  it('a replayed (dispatched) intent above the threshold takes the same session path', async () => {
    const big = docxBytes(BIG)
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { limits, budgetBytes })
    const path = await openDoc(ctx)
    writeFileSync(path, big)
    // park the intent offline: the coordinator writes it but sends nothing
    ctx.setCapabilityOffline(true)
    await ctx.service.save(path)
    expect(await storedIntent(ctx, path)).not.toBeNull()
    expect(sessionCreates(server)).toHaveLength(0)

    // the poll dispatches it through the QueueDispatcher, whose deps carry the
    // same session routes and the limits cache
    ctx.setCapabilityOffline(false)
    await ctx.service.pollSaveQueue()
    await vi.waitFor(async () =>
      expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'saved' }),
    )
    expect(sessionCreates(server)).toHaveLength(1)
    expect(sessionCalls(server, '/complete')).toHaveLength(1)
    expect(partPuts(server).length).toBeGreaterThan(1)
    expect(uploads(server)).toHaveLength(0)
    expect(await storedIntent(ctx, path)).toBeNull()
  })

  it('R2-BE-01: a cancel during a held resume GET through the real wiring ends promptly', async () => {
    let getEntered!: () => void
    const reachedGet = new Promise<void>((resolve) => {
      getEntered = resolve
    })
    let signalAborted = false
    const big = docxBytes(BIG)
    const server = fakeServer({
      bytes: enc('v3'),
      partFailsOnceAt: 2,
      sessionGetGate: (signal) =>
        new Promise<void>((_resolve, reject) => {
          getEntered()
          if (signal?.aborted) {
            signalAborted = true
            reject(new DOMException('aborted', 'AbortError'))
            return
          }
          signal?.addEventListener(
            'abort',
            () => {
              signalAborted = true
              reject(new DOMException('aborted', 'AbortError'))
            },
            { once: true },
          )
        }),
    })
    const ctx = setup(server, { limits, budgetBytes })
    const path = await openDoc(ctx)
    writeFileSync(path, big)

    // First save fails on part 2 (400, non-retryable), leaving a persisted uploadSession
    await ctx.service.save(path)
    const parked = await storedIntent(ctx, path)
    const sessionId = parked?.intent.uploadSession?.sessionId
    expect(sessionId).toBeTruthy()

    // Second save resumes the persisted session via GET, which is held
    const resuming = ctx.service.save(path)
    await reachedGet

    // Cancel while the resume GET is held: the adapter forwards the signal so it aborts promptly
    await ctx.service.cancelSave(path, false)
    await resuming
    expect(signalAborted).toBe(true)
    expect(
      server.calls.some(
        (c) => c.method === 'DELETE' && c.path === `/api/v1/upload-sessions/${sessionId}`,
      ),
    ).toBe(true)
  })
})
