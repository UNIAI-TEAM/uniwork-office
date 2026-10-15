import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkDocStatus, UniworkQueuePopoverRequest } from '../src/shared/home-api'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import {
  UniworkDocsService,
  type ConflictUi,
  type UnsavedCloseChoice,
} from '../src/main/uniwork-docs/service'
import { BINDING_FILE } from '../src/main/uniwork-docs/binding-store'
import { INTENT_STORE_REGISTRATION, createIntentStore } from '../src/main/uniwork-sync/intent-store'
import { DRAFTS_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/drafts'
import { PAUSE_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/pause'
import type { IntentRecordV2, QueueState } from '../src/main/uniwork-sync/queue/record'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import { createSyncStoreAccess } from '../src/main/uniwork-sync/session-store'
import { createStoreLayer, type StoreLayer } from '../src/main/uniwork-sync/store'
import { createLockableSafeStorage } from '../src/main/uniwork-sync/test-kit/compliance'

/**
 * G5-06u T9 (contract §1.3, §4; AC G5-A05): Ctrl/Cmd+S on a document that
 * already has a pending save intent never mints a second intent, never sends
 * the newer bytes (N+1 is not sent with N) and never replays a paused intent
 * inline. It marks the unsent N+1 (`pendingNext`), publishes the status and
 * asks the shell renderer to open the queue popover once. A dirty copy without
 * an intent still mints one, as before.
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
}

/** a small UniWork server: detail, download, idempotent upload + commit */
function fakeServer(initial: { bytes: Uint8Array }) {
  const state = { revision: 41, version: 3, bytes: initial.bytes, title: 'Q4 plan.docx' }
  const calls: Call[] = []
  const uploads = new Map<string, { id: string; checksum: string; bytes: Uint8Array }>()
  let seq = 0
  const docJson = () => ({
    id: DOC,
    organization_id: 'org_a',
    workspace_id: 'ws_1',
    title: state.title,
    kind: 'file',
    revision: String(state.revision),
    current_version: state.version,
    my_level: 'edit',
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

  const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    const u = new URL(url)
    const method = init.method ?? 'GET'
    calls.push({ method, path: u.pathname })
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    )
    const key = headers['idempotency-key'] ?? ''
    if (u.pathname === `/api/v1/documents/${DOC}` && method === 'GET') {
      return json(200, { document: docJson() })
    }
    if (u.pathname === `/api/v1/documents/${DOC}/download`) {
      return new Response(state.bytes as BodyInit, { status: 200 })
    }
    if (u.pathname === `/api/v1/documents/${DOC}/uploads`) {
      const file = (init.body as FormData).get('file') as Blob
      const bytes = new Uint8Array(await file.arrayBuffer())
      const upload = uploads.get(key) ?? { id: `up_${++seq}`, checksum: hex(bytes), bytes }
      uploads.set(key, upload)
      return json(201, {
        upload_id: upload.id,
        checksum_sha256: upload.checksum,
        size_bytes: bytes.byteLength,
        claim_expires_at: '2026-10-10T00:00:00Z',
      })
    }
    if (u.pathname === `/api/v1/documents/${DOC}/versions/commit` && method === 'POST') {
      const body = JSON.parse(String(init.body)) as { upload_id: string; base_revision: string }
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
      return json(200, {
        document: docJson(),
        version: {
          id: `ver_${state.version}`,
          document_id: DOC,
          version: state.version,
          kind: 'file',
          checksum_sha256: upload.checksum,
          size_bytes: upload.bytes.byteLength,
        },
      })
    }
    return error(404, 'not_found')
  })
  return { state, calls, fetch }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-ctrl-s-intent-'))
})
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 25))
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

function setup(
  server: ReturnType<typeof fakeServer>,
  opts: {
    capability?: Record<string, boolean>
    budgetBytes?: number
    isShellTab?: (path: string) => boolean
  } = {},
) {
  const statuses: UniworkDocStatus[] = []
  const popovers: UniworkQueuePopoverRequest[] = []
  const safeStorage = createLockableSafeStorage()
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
    layer,
    scope: () => ({ deploymentId: 'default', accountId: 'acc_1' }),
  })
  const ui: ConflictUi = {
    chooseUnsavedClose: vi.fn(async () => 'cancel' as UnsavedCloseChoice),
  }
  const service = new UniworkDocsService({
    userDataDir: dir,
    syncStore,
    appVersion: () => '0.0.0',
    profile: () => profile,
    identity: () => ({ accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }),
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
    pushConflict: vi.fn(),
    pushQueuePopover: (request: UniworkQueuePopoverRequest) => popovers.push(request),
    ...(opts.isShellTab ? { isShellTab: opts.isShellTab } : {}),
    pushLaunch: vi.fn(),
    reveal: vi.fn(),
    sleep: async () => undefined,
    capability: {
      get: async (orgId: string) => ({
        kind: 'ok' as const,
        capabilities: { sync_write: opts.capability?.[orgId] ?? true },
        source: 'fresh' as const,
      }),
    },
  })
  return { service, statuses, popovers, layer, safeStorage }
}

type Ctx = ReturnType<typeof setup>

async function openDoc(ctx: Ctx): Promise<string> {
  const opened = await ctx.service.openDocument(DOC)
  if (!opened.ok) throw new Error(opened.error)
  return opened.value.path
}

const binding = (path: string) => JSON.parse(readFileSync(join(path, '..', BINDING_FILE), 'utf8'))
const sent = (server: ReturnType<typeof fakeServer>) =>
  server.calls.filter(
    (c) =>
      c.path.endsWith('/uploads') || (c.path.endsWith('/versions/commit') && c.method === 'POST'),
  )

async function intents(ctx: Ctx) {
  const opened = await ctx.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
  if (opened.kind !== 'ok') throw new Error(opened.kind)
  return createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name))
}

async function storedIntent(ctx: Ctx, path: string) {
  return (await intents(ctx)).get(basename(dirname(path)))
}

/** rewrites the stored record's state (a record the queue left at rest) */
async function setStoredState(ctx: Ctx, path: string, state: QueueState): Promise<void> {
  const store = await intents(ctx)
  const key = basename(dirname(path))
  const stored = await store.get(key)
  if (!stored) throw new Error('no stored intent')
  const record = { ...(stored.intent as unknown as IntentRecordV2), state }
  expect((await store.put(key, record, stored.payload)).kind).toBe('ok')
}

/** a parked (paused_user) intent holding the v4 bytes; the user then edits on to v5 */
async function parkedIntent(server: ReturnType<typeof fakeServer>) {
  const ctx = setup(server)
  const path = await openDoc(ctx)
  await ctx.service.pauseSending()
  writeFileSync(path, 'v4')
  await ctx.service.save(path)
  expect(binding(path)).toMatchObject({ state: 'paused_user' })
  return { ctx, path }
}

/** the Ctrl/Cmd+S hook the module fires after it wrote the working copy */
async function userSave(ctx: Ctx, path: string): Promise<void> {
  ctx.service.onUserSave(path)
  await ctx.service.coordinator.settled(path)
  // let any fire-and-forget publish land
  await new Promise((resolve) => setTimeout(resolve, 10))
}

async function expectNoSecondIntent(
  ctx: Ctx,
  path: string,
  server: ReturnType<typeof fakeServer>,
  before: { intentId: string; idempotencyKey: string; generation: number; state: QueueState },
): Promise<void> {
  // nothing reached the server: N+1 is not sent with N, N is not replayed
  expect(sent(server)).toHaveLength(0)
  // the same record, same key, same bytes (v4): no second intent was minted
  const after = await storedIntent(ctx, path)
  const record = after?.intent as unknown as IntentRecordV2
  expect(record).toMatchObject(before)
  expect(new TextDecoder().decode(after?.payload)).toBe('v4')
  // the unsent N+1 is marked and published; the renderer is asked once
  expect(ctx.service.coordinator.hasPendingNext(path)).toBe(true)
  expect(ctx.statuses.at(-1)).toMatchObject({ path, pendingNext: true })
  expect(ctx.popovers).toEqual([{ path }])
}

function recordFacts(record: IntentRecordV2) {
  return {
    intentId: record.intentId,
    idempotencyKey: record.idempotencyKey,
    generation: record.generation,
    state: record.state,
  }
}

describe('G5-06u T9: Ctrl/Cmd+S with a pending intent opens the queue popover', () => {
  it.each<QueueState>(['paused_user', 'queued', 'failed'])(
    'a stored %s intent: no save, no new intent, pendingNext, one popover push',
    async (state) => {
      const server = fakeServer({ bytes: enc('v3') })
      const { ctx, path } = await parkedIntent(server)
      if (state !== 'paused_user') await setStoredState(ctx, path, state)
      const before = recordFacts(
        (await storedIntent(ctx, path))?.intent as unknown as IntentRecordV2,
      )
      expect(before.state).toBe(state)
      writeFileSync(path, 'v5')
      ctx.statuses.length = 0
      await userSave(ctx, path)
      await expectNoSecondIntent(ctx, path, server, before)
    },
  )

  it('a paused_admin intent (sync_write off) is not replayed inline', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { capability: { org_a: false } })
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    await ctx.service.save(path)
    expect(binding(path)).toMatchObject({ state: 'paused_admin' })
    const before = recordFacts((await storedIntent(ctx, path))?.intent as unknown as IntentRecordV2)
    writeFileSync(path, 'v5')
    ctx.statuses.length = 0
    await userSave(ctx, path)
    await expectNoSecondIntent(ctx, path, server, before)
  })

  it('a conflict copy: no save, one popover push (the renderer opens S5)', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    // another device committed meanwhile: the inline save lands in conflict
    server.state.revision = 50
    writeFileSync(path, 'v4')
    await ctx.service.save(path)
    expect(binding(path)).toMatchObject({ state: 'conflict' })
    const before = sent(server).length
    writeFileSync(path, 'v5')
    await userSave(ctx, path)
    expect(sent(server)).toHaveLength(before)
    expect(ctx.popovers).toEqual([{ path }])
  })

  it('a dirty copy without an intent still mints one and saves; no popover', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    await userSave(ctx, path)
    expect(sent(server).length).toBeGreaterThan(0)
    expect(binding(path)).toMatchObject({ state: 'saved' })
    expect(ctx.popovers).toEqual([])
    expect(ctx.service.coordinator.hasPendingNext(path)).toBe(false)
  })

  it('a refused save (store_full, no intent) also asks for the popover', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { budgetBytes: 64 })
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4 '.repeat(200))
    await userSave(ctx, path)
    expect(binding(path)).toMatchObject({ state: 'error', error: 'store_full' })
    expect(sent(server)).toHaveLength(0)
    expect(ctx.popovers).toEqual([{ path }])
  })

  it('the Retry path (service.save) still replays the pending intent and never pushes', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const { ctx, path } = await parkedIntent(server)
    await setStoredState(ctx, path, 'failed')
    await ctx.service.save(path)
    expect(sent(server).length).toBeGreaterThan(0)
    expect(ctx.popovers).toEqual([])
  })
})

/** the private seams the queue poll drives (dispatcher in flight, a record change) */
interface QueueSeams {
  queueInFlight: Set<string>
  applyRecord(record: IntentRecordV2): Promise<void>
}
const seams = (ctx: Ctx) => ctx.service as unknown as QueueSeams
const keyOf = (path: string) => basename(dirname(path))

/** rewrites binding.json the way another writer (the dispatcher's commitState) would */
function rewriteBinding(path: string, patch: Record<string, unknown>): void {
  const file = join(path, '..', BINDING_FILE)
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), ...patch }))
}

describe('G5-06u T9: branches and BE review r1 fixes', () => {
  it('the dispatcher runs the key: no save, no new intent, pendingNext for a newer copy, one push', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const { ctx, path } = await parkedIntent(server)
    const before = recordFacts((await storedIntent(ctx, path))?.intent as unknown as IntentRecordV2)
    seams(ctx).queueInFlight.add(keyOf(path))
    writeFileSync(path, 'v5')
    ctx.statuses.length = 0
    await userSave(ctx, path)
    await expectNoSecondIntent(ctx, path, server, before)
  })

  it('the dispatcher runs the key and the copy has no new edits: no pendingNext, one push', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const { ctx, path } = await parkedIntent(server)
    seams(ctx).queueInFlight.add(keyOf(path))
    await userSave(ctx, path)
    expect(sent(server)).toHaveLength(0)
    expect(ctx.service.coordinator.hasPendingNext(path)).toBe(false)
    expect(ctx.statuses.some((s) => s.pendingNext)).toBe(false)
    expect(ctx.popovers).toEqual([{ path }])
  })

  it('RBE6u-01: the status published for the popover is the binding as it is now, not the stale read', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const { ctx, path } = await parkedIntent(server)
    seams(ctx).queueInFlight.add(keyOf(path))
    // the dispatcher rewrites the binding after save() classified the copy
    // (here: while the store is opened for the intent read)
    const deps = (
      ctx.service.coordinator as unknown as { deps: { intents: () => Promise<unknown> } }
    ).deps
    const intentsOf = deps.intents
    deps.intents = async () => {
      rewriteBinding(path, { state: 'queued' })
      return intentsOf()
    }
    writeFileSync(path, 'v5')
    ctx.statuses.length = 0
    await userSave(ctx, path)
    expect(ctx.statuses.at(-1)).toMatchObject({ path, state: 'queued', pendingNext: true })
    expect(ctx.popovers).toEqual([{ path }])
  })

  it('RBE6u-01: the stored-intent branch also publishes the binding as it is now', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const { ctx, path } = await parkedIntent(server)
    // the queue moves the binding (paused_user -> queued) after classify read it
    const deps = (
      ctx.service.coordinator as unknown as { deps: { intents: () => Promise<unknown> } }
    ).deps
    const intentsOf = deps.intents
    deps.intents = async () => {
      rewriteBinding(path, { state: 'queued' })
      return intentsOf()
    }
    writeFileSync(path, 'v5')
    ctx.statuses.length = 0
    await userSave(ctx, path)
    expect(sent(server)).toHaveLength(0)
    expect(ctx.statuses.at(-1)).toMatchObject({ path, state: 'queued', pendingNext: true })
    expect(ctx.popovers).toEqual([{ path }])
  })

  it('RBE6u-02: Ctrl/S on a paused intent without new edits sets no pendingNext', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const { ctx, path } = await parkedIntent(server)
    ctx.statuses.length = 0
    await userSave(ctx, path)
    expect(sent(server)).toHaveLength(0)
    expect(ctx.service.coordinator.hasPendingNext(path)).toBe(false)
    expect(ctx.statuses.some((s) => s.pendingNext)).toBe(false)
    expect(ctx.popovers).toEqual([{ path }])
  })

  it('RBE6u-02: a dispatcher commit of the intent clears pendingNext', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const { ctx, path } = await parkedIntent(server)
    writeFileSync(path, 'v5')
    await userSave(ctx, path)
    expect(ctx.service.coordinator.hasPendingNext(path)).toBe(true)
    const record = (await storedIntent(ctx, path))?.intent as unknown as IntentRecordV2
    ctx.statuses.length = 0
    await seams(ctx).applyRecord({
      ...record,
      state: 'committed',
      receipt: { revision: '42', version: 4, versionId: 'ver_4' },
    } as IntentRecordV2)
    expect(ctx.service.coordinator.hasPendingNext(path)).toBe(false)
    expect(binding(path)).toMatchObject({ state: 'dirty', baseRevision: '42' })
    expect(ctx.statuses.at(-1)?.pendingNext).toBeUndefined()
  })

  it('RBE6u-02: a cancelled record clears pendingNext', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const { ctx, path } = await parkedIntent(server)
    writeFileSync(path, 'v5')
    await userSave(ctx, path)
    expect(ctx.service.coordinator.hasPendingNext(path)).toBe(true)
    const record = (await storedIntent(ctx, path))?.intent as unknown as IntentRecordV2
    await seams(ctx).applyRecord({ ...record, state: 'cancelled' })
    expect(ctx.service.coordinator.hasPendingNext(path)).toBe(false)
  })

  it('RBE6u-03: a path that is not a shell tab (detached window) keeps the inline replay, no push', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { isShellTab: () => false })
    const path = await openDoc(ctx)
    await ctx.service.pauseSending()
    writeFileSync(path, 'v4')
    await ctx.service.save(path)
    await setStoredState(ctx, path, 'failed')
    await userSave(ctx, path)
    expect(sent(server).length).toBeGreaterThan(0)
    expect(ctx.popovers).toEqual([])
  })

  it('a shell tab path (predicate true) gets the popover, no replay', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { isShellTab: () => true })
    const path = await openDoc(ctx)
    await ctx.service.pauseSending()
    writeFileSync(path, 'v4')
    await ctx.service.save(path)
    await setStoredState(ctx, path, 'failed')
    await userSave(ctx, path)
    expect(sent(server)).toHaveLength(0)
    expect(ctx.popovers).toEqual([{ path }])
  })

  it('a locked keystore refuses the save and asks for the popover once', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    ctx.safeStorage.lock()
    await userSave(ctx, path)
    expect(binding(path)).toMatchObject({ state: 'error', error: 'keystore_locked' })
    expect(sent(server)).toHaveLength(0)
    expect(ctx.service.coordinator.hasPendingNext(path)).toBe(false)
    expect(ctx.popovers).toEqual([{ path }])
  })

  it('a blocked (permission_revoked) copy: no save, no pendingNext, one push', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    rewriteBinding(path, { state: 'blocked', error: 'permission_revoked' })
    writeFileSync(path, 'v4')
    await userSave(ctx, path)
    expect(sent(server)).toHaveLength(0)
    expect(ctx.service.coordinator.hasPendingNext(path)).toBe(false)
    expect(binding(path)).toMatchObject({ state: 'blocked', error: 'permission_revoked' })
    expect(ctx.popovers).toEqual([{ path }])
  })
})

type CoordinatorDeps = { deps: { intents: () => Promise<unknown> } }
const coordinatorDeps = (ctx: Ctx) => (ctx.service.coordinator as unknown as CoordinatorDeps).deps

/**
 * holds the inline upload of the first save on the wire: the path stays in the
 * coordinator's `saving` set (with its intent stored) until `release()`
 */
function holdUploads(server: ReturnType<typeof fakeServer>) {
  const original = server.fetch.getMockImplementation()
  if (!original) throw new Error('fake server has no implementation')
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const reached = { uploads: 0 }
  server.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    if (new URL(url).pathname.endsWith('/uploads')) {
      reached.uploads += 1
      await gate
    }
    return original(url, init)
  })
  return { release, reached }
}

/** starts an inline save of 'v4' and waits until its upload is in flight */
async function inlineSaveInFlight(ctx: Ctx, server: ReturnType<typeof fakeServer>) {
  const hold = holdUploads(server)
  const path = await openDoc(ctx)
  writeFileSync(path, 'v4')
  const first = ctx.service.save(path)
  await vi.waitFor(() => expect(hold.reached.uploads).toBe(1))
  expect(ctx.service.coordinator.isSaving(path)).toBe(true)
  return { path, first, ...hold }
}

/**
 * runs the pending microtasks (a rejected or refused intent read has no I/O
 * left after the stub was called, only its own continuation)
 */
const flushMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve))

const unavailableAccess: Array<[string, () => Promise<unknown>]> = [
  ['not ready (unavailable)', async () => ({ kind: 'unavailable' })],
  [
    'throws',
    async () => {
      throw new Error('store failed to open')
    },
  ],
]

describe('G5-06u T9: RBE6u2 fix round', () => {
  it('RBE6u2-02 (a): a quota-blocked copy with a stored intent: no save, pendingNext for a newer copy, one push', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const { ctx, path } = await parkedIntent(server)
    const before = recordFacts((await storedIntent(ctx, path))?.intent as unknown as IntentRecordV2)
    rewriteBinding(path, { state: 'blocked', error: 'quota_exceeded' })
    writeFileSync(path, 'v5')
    ctx.statuses.length = 0
    await userSave(ctx, path)
    await expectNoSecondIntent(ctx, path, server, before)
    expect(binding(path)).toMatchObject({ state: 'blocked', error: 'quota_exceeded' })
  })

  it('RBE6u2-02 (a): quota-blocked with a stored intent and no new edits: no pendingNext, one push', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const { ctx, path } = await parkedIntent(server)
    rewriteBinding(path, { state: 'blocked', error: 'quota_exceeded' })
    ctx.statuses.length = 0
    await userSave(ctx, path)
    expect(sent(server)).toHaveLength(0)
    expect(ctx.service.coordinator.hasPendingNext(path)).toBe(false)
    expect(ctx.statuses.some((s) => s.pendingNext)).toBe(false)
    expect(ctx.popovers).toEqual([{ path }])
  })

  it('RBE6u2-01/02 (b): Ctrl/S while the inline save is in flight, with new edits: one push, pendingNext, nothing disturbed', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const { path, first, release, reached } = await inlineSaveInFlight(ctx, server)
    const before = recordFacts((await storedIntent(ctx, path))?.intent as unknown as IntentRecordV2)
    writeFileSync(path, 'v5')
    ctx.statuses.length = 0
    ctx.service.onUserSave(path)
    await vi.waitFor(() => expect(ctx.popovers).toEqual([{ path }]))
    // the running writer is not touched: no second upload, same record, still saving
    expect(reached.uploads).toBe(1)
    expect(ctx.service.coordinator.isSaving(path)).toBe(true)
    expect(ctx.service.coordinator.hasPendingNext(path)).toBe(true)
    expect(ctx.statuses.at(-1)).toMatchObject({ path, pendingNext: true })
    const after = (await storedIntent(ctx, path))?.intent as unknown as IntentRecordV2
    expect(recordFacts(after)).toEqual(before)
    release()
    await first
    expect(ctx.popovers).toEqual([{ path }])
    // the inline save settled the v4 intent and left the v5 copy dirty
    expect(binding(path)).toMatchObject({ state: 'dirty' })
  })

  it('RBE6u2-01/02 (b): Ctrl/S while the inline save is in flight, no new edits: one push, no pendingNext', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const { path, first, release, reached } = await inlineSaveInFlight(ctx, server)
    ctx.statuses.length = 0
    ctx.service.onUserSave(path)
    await vi.waitFor(() => expect(ctx.popovers).toEqual([{ path }]))
    expect(reached.uploads).toBe(1)
    expect(ctx.service.coordinator.hasPendingNext(path)).toBe(false)
    expect(ctx.statuses.some((s) => s.pendingNext)).toBe(false)
    release()
    await first
    expect(ctx.popovers).toEqual([{ path }])
    expect(binding(path)).toMatchObject({ state: 'saved' })
  })

  it('RBE6u2-01: a non-user save (Retry, close guard) during the in-flight save still returns at once, no push', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const { path, first, release, reached } = await inlineSaveInFlight(ctx, server)
    writeFileSync(path, 'v5')
    await ctx.service.save(path)
    expect(reached.uploads).toBe(1)
    expect(ctx.popovers).toEqual([])
    expect(ctx.service.coordinator.hasPendingNext(path)).toBe(false)
    release()
    await first
  })

  it('RBE6u2-01: Ctrl/S while the first save has no stored intent yet keeps the early return, no push', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    // the first save is between save() and its intent write (the intent store
    // opens late): a second Ctrl/S finds the path saving and no intent
    const deps = coordinatorDeps(ctx)
    const intentsOf = deps.intents
    let open: () => void = () => undefined
    const opened = new Promise<void>((resolve) => {
      open = resolve
    })
    let calls = 0
    deps.intents = async () => {
      calls += 1
      if (calls === 1) await opened
      return intentsOf()
    }
    const first = ctx.service.save(path)
    await vi.waitFor(() => expect(ctx.service.coordinator.isSaving(path)).toBe(true))
    ctx.service.onUserSave(path)
    // the second press reached the stubbed intents() (call 1 is the first save's)
    await vi.waitFor(() => expect(calls).toBeGreaterThan(1))
    await flushMicrotasks()
    expect(ctx.popovers).toEqual([])
    open()
    await first
    expect(binding(path)).toMatchObject({ state: 'saved' })
    expect(ctx.popovers).toEqual([])
  })

  it.each(unavailableAccess)(
    'RBE6u2-02 (c): intent access %s: no crash, server_error, no push, nothing sent',
    async (_name, access) => {
      const server = fakeServer({ bytes: enc('v3') })
      const ctx = setup(server)
      const path = await openDoc(ctx)
      writeFileSync(path, 'v4')
      coordinatorDeps(ctx).intents = access
      await userSave(ctx, path)
      expect(binding(path)).toMatchObject({ state: 'error', error: 'server_error' })
      expect(sent(server)).toHaveLength(0)
      expect(ctx.service.coordinator.hasPendingNext(path)).toBe(false)
      expect(ctx.popovers).toEqual([])
    },
  )

  it.each(unavailableAccess)(
    'RBE6u2-02 (c): intent access %s during the in-flight save: no crash, no push, the writer settles',
    async (_name, access) => {
      const server = fakeServer({ bytes: enc('v3') })
      const ctx = setup(server)
      const { path, first, release, reached } = await inlineSaveInFlight(ctx, server)
      // the stub counts its calls: the first save already passed intents(), so
      // any call is the second press reaching the branch under test
      let reachedByPress = 0
      coordinatorDeps(ctx).intents = async () => {
        reachedByPress += 1
        return access()
      }
      writeFileSync(path, 'v5')
      ctx.service.onUserSave(path)
      await vi.waitFor(() => expect(reachedByPress).toBe(1))
      await flushMicrotasks()
      expect(ctx.popovers).toEqual([])
      expect(ctx.service.coordinator.hasPendingNext(path)).toBe(false)
      expect(reached.uploads).toBe(1)
      release()
      await first
      expect(binding(path)).toMatchObject({ state: 'dirty' })
    },
  )
})

/**
 * holds the NEXT intents() call (the second press's own read) until
 * `release()`: the press has read the working copy and is parked just before
 * its intent read, so the running save can settle underneath it
 */
function holdNextIntentsRead(ctx: Ctx) {
  const deps = coordinatorDeps(ctx)
  const original = deps.intents
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const state = { parked: false }
  let armed = true
  deps.intents = async () => {
    if (armed) {
      armed = false
      state.parked = true
      await gate
    }
    return original()
  }
  return { release, state }
}

describe('G5-06u T9: RBE6u3-01 the intent read lands after the running save settled', () => {
  it('a still-dirty copy: one push, pendingNext, nothing written by the press', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const { path, first, release, reached } = await inlineSaveInFlight(ctx, server)
    writeFileSync(path, 'v5')
    const press = holdNextIntentsRead(ctx)
    ctx.statuses.length = 0
    // the coordinator's own call, so the press itself can be awaited
    const pressed = ctx.service.coordinator.save(path, { userSave: true })
    await vi.waitFor(() => expect(press.state.parked).toBe(true))
    // the running save settles (record deleted, pendingNext cleared) before
    // the press's intent read resolves
    release()
    await first
    expect(await storedIntent(ctx, path)).toBeNull()
    expect(ctx.service.coordinator.hasPendingNext(path)).toBe(false)
    expect(binding(path)).toMatchObject({ state: 'dirty' })
    press.release()
    await pressed
    expect(ctx.popovers).toEqual([{ path }])
    expect(ctx.service.coordinator.hasPendingNext(path)).toBe(true)
    expect(ctx.statuses.at(-1)).toMatchObject({ path, pendingNext: true })
    // read only: no second upload, no second intent, the copy stays dirty
    expect(reached.uploads).toBe(1)
    expect(await storedIntent(ctx, path)).toBeNull()
    expect(binding(path)).toMatchObject({ state: 'dirty' })
    expect(sent(server)).toHaveLength(2)
  })

  it('a clean copy (no new edits): the early return stays, no push, no pendingNext', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const { path, first, release } = await inlineSaveInFlight(ctx, server)
    const press = holdNextIntentsRead(ctx)
    ctx.statuses.length = 0
    // the coordinator's own call, so the press itself can be awaited
    const pressed = ctx.service.coordinator.save(path, { userSave: true })
    await vi.waitFor(() => expect(press.state.parked).toBe(true))
    release()
    await first
    expect(binding(path)).toMatchObject({ state: 'saved' })
    press.release()
    await pressed
    expect(ctx.popovers).toEqual([])
    expect(ctx.service.coordinator.hasPendingNext(path)).toBe(false)
    expect(ctx.statuses.some((s) => s.pendingNext)).toBe(false)
    expect(sent(server)).toHaveLength(2)
  })
})
