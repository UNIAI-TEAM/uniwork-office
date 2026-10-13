import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkDocStatus } from '../src/shared/home-api'
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
import { SaveCoordinator } from '../src/main/uniwork-docs/save-coordinator'
import { createStoreLayer, type StoreLayer } from '../src/main/uniwork-sync/store'
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
function fakeServer(initial: { bytes: Uint8Array; myLevel?: string }) {
  const state = {
    revision: 41,
    version: 3,
    bytes: initial.bytes,
    myLevel: initial.myLevel ?? 'edit',
    title: 'Q4 plan.docx',
  }
  const calls: Call[] = []
  const faults: Fault[] = []
  const uploads = new Map<string, { id: string; checksum: string; bytes: Uint8Array }>()
  const commits = new Map<string, unknown>()
  let seq = 0

  const docJson = () => ({
    id: DOC,
    organization_id: 'org_a',
    workspace_id: 'ws_1',
    title: state.title,
    kind: 'file',
    revision: String(state.revision),
    current_version: state.version,
    my_level: state.myLevel,
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
    return error(404, 'not_found')
  })

  return { state, calls, faults, fetch, uploads, commits }
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
  layer: StoreLayer
  account: () => string | null
  signOut: () => void
  signInAs: (id: string) => void
  setCapabilityOffline: (value: boolean) => void
}

function setup(
  server: ReturnType<typeof fakeServer>,
  opts: {
    account?: string | null
    /** the capability answer per org (default: sync_write on) */
    capability?: Record<string, boolean>
    /** true = the store cannot be built (the queue's registrations are absent) */
    bareLayer?: boolean
  } = {},
) {
  const statuses: UniworkDocStatus[] = []
  let account: string | null = opts.account === undefined ? 'acc_1' : opts.account
  /** true = the capability read fails (the lane is offline for the next save) */
  let capabilityOffline = false
  const safeStorage: LockableSafeStorage = createLockableSafeStorage()
  const layer: StoreLayer = createStoreLayer({
    root: join(dir, 'uniwork-sync', 'store'),
    keys: createSafeStorageKeyProvider({ safeStorage, dir: join(dir, 'uniwork-sync', 'keys') }),
    budgetBytes: 1 << 20,
    clock: () => 1_700_000_000_000,
  })
  layer.register(INTENT_STORE_REGISTRATION)
  if (!opts.bareLayer) {
    layer.register(DRAFTS_STORE_REGISTRATION)
    layer.register(PAUSE_STORE_REGISTRATION)
  }
  const syncStore = createSyncStoreAccess({
    layer,
    scope: () => (account ? { deploymentId: 'default', accountId: account } : null),
  })
  const ui: ConflictUi = {
    chooseConflict: vi.fn(async () => 'later'),
    confirmDiscard: vi.fn(async () => true),
    pickCopyPath: vi.fn(async (stem: string, format: string) =>
      join(dir, `${stem} (my copy).${format}`),
    ),
    showOpenLatestFailed: vi.fn(),
    showCopyFailed: vi.fn(),
    chooseUnsavedClose: vi.fn(async () => 'cancel' as UnsavedCloseChoice),
  }
  const deps = {
    userDataDir: dir,
    syncStore,
    appVersion: () => '0.0.0',
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
    pushLaunch: vi.fn(),
    reveal: vi.fn(),
    sleep: async () => undefined,
    capability: {
      get: async (orgId: string) => {
        if (capabilityOffline) throw new Error('offline')
        const syncWrite = opts.capability?.[orgId] ?? true
        return {
          kind: 'ok' as const,
          capabilities: { sync_write: syncWrite },
          source: 'fresh' as const,
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

  it('Overwrite supersedes the pending intent before the new one', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    server.state.revision = 45
    writeFileSync(path, 'mine')
    await ctx.service.save(path)
    expect(binding(path)).toMatchObject({ state: 'conflict' })
    const oldKey = commits(server)[0]?.headers['idempotency-key']
    vi.mocked(ctx.ui.chooseConflict).mockResolvedValue('overwrite')
    vi.mocked(ctx.deps.requestModuleSave as () => boolean).mockReturnValue(false)
    const status = await ctx.service.resolveConflict(path)
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

  it('G5-06 fix-C item 4: a stored in-flight record is settled by lookup on the next poll', async () => {
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

    // a stop left the record `uploading` at rest (lost lock / crash). Its lookup
    // answers not_committed: the next poll resolves it to queued with the SAME
    // key (one lookup, no upload/commit), and the poll after that re-sends it
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    await seed(ctx, 'uploading', path, 'key_stuck')
    await ctx.service.pollSaveQueue()
    expect(lookups(server)).toHaveLength(1)
    expect(uploads(server)).toHaveLength(0)
    expect(commits(server)).toHaveLength(0)
    expect((await storedIntent(ctx, path))?.intent).toMatchObject({
      state: 'queued',
      idempotencyKey: 'key_stuck',
    })
    await ctx.service.pollSaveQueue()
    expect(uploads(server)).toHaveLength(1)
    expect(commits(server)).toHaveLength(1)
    expect(commits(server)[0]!.headers['idempotency-key']).toBe('key_stuck')

    // a record left `committing` whose lookup answers committed settles with the
    // receipt: one lookup, no upload, no commit, and the record is cleared
    const second = fakeServer({ bytes: enc('v3') })
    const ctx2 = setup(second)
    const path2 = await openDoc(ctx2)
    writeFileSync(path2, 'v4')
    await ctx2.service.save(path2)
    const doneKey = commits(second)[0]!.headers['idempotency-key']!
    await seed(ctx2, 'committing', path2, doneKey)
    const before = { upload: uploads(second).length, commit: commits(second).length }
    await ctx2.service.pollSaveQueue()
    expect(lookups(second)).toHaveLength(1)
    expect(uploads(second)).toHaveLength(before.upload)
    expect(commits(second)).toHaveLength(before.commit)
    expect(await storedIntent(ctx2, path2)).toBeNull()
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
    // an in-flight record at rest (a lost lock / crash): the poll settles it
    // through the G5-07 lookup with the SAME key
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
        state: 'uploading',
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

  it('G506-be-d1-1: the account-boundary wipe awaits teardownSaveQueue before the wipe', () => {
    // the wiring source pins the order: the in-flight poll/dispatch must unwind
    // before the scope is wiped, so no settle lookup runs into a wiped scope
    const source = readFileSync(join(__dirname, '..', 'src/main/uniwork-docs/wiring.ts'), 'utf8')
    const wipe = source.slice(source.indexOf('wipeStore: async (owner) =>'))
    const awaited = wipe.indexOf('await service.teardownSaveQueue?.()')
    const lockAndWipe = wipe.indexOf('lockAndWipe(')
    expect(awaited).toBeGreaterThan(-1)
    expect(lockAndWipe).toBeGreaterThan(-1)
    expect(awaited).toBeLessThan(lockAndWipe)
    // and it is awaited, not a fire-and-forget call
    expect(wipe).toMatch(/await service\.teardownSaveQueue\?\.\(\)/)
    expect(wipe).not.toMatch(/\n\s+service\.teardownSaveQueue\?\.\(\)\n/)
  })
})
