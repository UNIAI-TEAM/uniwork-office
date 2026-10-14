import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  UniworkConflictReply,
  UniworkConflictView,
  UniworkDocStatus,
} from '../src/shared/home-api'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import {
  UniworkDocsService,
  type ConflictUi,
  type UnsavedCloseChoice,
} from '../src/main/uniwork-docs/service'
import { BINDING_FILE, type Binding } from '../src/main/uniwork-docs/binding-store'
import { INTENT_STORE_REGISTRATION, createIntentStore } from '../src/main/uniwork-sync/intent-store'
import { DRAFTS_STORE_REGISTRATION, createDraftStore } from '../src/main/uniwork-sync/queue/drafts'
import { PAUSE_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/pause'
import { QUEUE_LIMITS } from '../src/main/uniwork-sync/queue/limits'
import type { IntentRecordV2 } from '../src/main/uniwork-sync/queue/record'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import { createSyncStoreAccess } from '../src/main/uniwork-sync/session-store'
import { createStoreLayer, type StoreLayer } from '../src/main/uniwork-sync/store'
import {
  createLockableSafeStorage,
  type LockableSafeStorage,
} from '../src/main/uniwork-sync/test-kit/compliance'

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
  route: 'upload' | 'commit' | 'lookup' | 'detail' | 'download'
  kind: 'network' | number
  code?: string
  fields?: Record<string, unknown>
}

function fakeServer(initial: { bytes: Uint8Array; myLevel?: string; title?: string } = { bytes: enc('v3') }) {
  const state = {
    revision: 41,
    version: 3,
    bytes: initial.bytes,
    myLevel: initial.myLevel ?? 'edit',
    title: initial.title ?? 'Q4 plan.docx',
    updatedAt: '2026-10-10T10:00:00Z',
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
    updated_at: state.updatedAt,
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
      if (fault?.kind === 'network') throw new TypeError('fetch failed')
      if (typeof fault?.kind === 'number') return error(fault.kind, fault.code ?? 'x', fault.fields)
      return json(200, { document: docJson() })
    }
    if (u.pathname === `/api/v1/documents/${DOC}/download`) {
      const fault = take('download')
      if (fault?.kind === 'network') throw new TypeError('fetch failed')
      if (typeof fault?.kind === 'number') return error(fault.kind, fault.code ?? 'x', fault.fields)
      return new Response(state.bytes as BodyInit, { status: 200 })
    }
    if (u.pathname === `/api/v1/documents/${DOC}/uploads`) {
      const file = (init.body as FormData).get('file') as Blob
      const bytes = new Uint8Array(await file.arrayBuffer())
      const fault = take('upload')
      if (fault?.kind === 'network') throw new TypeError('fetch failed')
      if (typeof fault?.kind === 'number') return error(fault.kind, fault.code ?? 'x', fault.fields)
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
      const last = calls.at(-1)
      if (last) last.body = body
      const fault = take('commit')
      if (fault?.kind === 'network') throw new TypeError('fetch failed')
      if (typeof fault?.kind === 'number') return error(fault.kind, fault.code ?? 'x', fault.fields)
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
    return error(404, 'not_found')
  })

  return { state, calls, faults, fetch, uploads, commits }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-conflict-s5-'))
})
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 25))
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

function setup(
  server: ReturnType<typeof fakeServer>,
  opts: {
    budgetBytes?: number
    keystoreLocked?: boolean
    aiRunning?: boolean
  } = {},
) {
  const statuses: UniworkDocStatus[] = []
  const views: UniworkConflictView[] = []
  let account: string | null = 'acc_1'
  let capabilityOffline = false
  let keystoreLocked = opts.keystoreLocked ?? false
  let aiRunning = opts.aiRunning ?? false
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
    layer,
    scope: () => (account ? { deploymentId: 'default', accountId: account } : null),
  })
  const ui: ConflictUi = {
    chooseUnsavedClose: vi.fn(async () => 'cancel' as UnsavedCloseChoice),
  } as unknown as ConflictUi
  const stopAiRun = vi.fn(() => {
    aiRunning = false
  })
  const deps = {
    userDataDir: dir,
    syncStore,
    storeUsage: async () =>
      account ? layer.usage({ deploymentId: 'default', accountId: account }) : null,
    appVersion: () => '0.0.0',
    keystoreLocked: () => keystoreLocked,
    profile: () => profile,
    channel: () => 'stable' as const,
    applyProfile: async () => ({ status: {} as never, changed: false }),
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
    isAiRunning: () => aiRunning,
    stopAiRun,
    pushLaunch: vi.fn(),
    reveal: vi.fn(),
    sleep: async () => undefined,
    capability: {
      get: async () => {
        if (capabilityOffline) throw new Error('offline')
        return {
          kind: 'ok' as const,
          capabilities: { sync_write: true },
          source: 'fresh' as const,
        }
      },
    },
  }
  const service = new UniworkDocsService(deps as never)
  return {
    service: service as UniworkDocsService & {
      conflictAct(sessionId: string, action: unknown): Promise<UniworkConflictReply>
    },
    deps,
    ui,
    statuses,
    views,
    layer,
    safeStorage,
    stopAiRun,
    setCapabilityOffline: (v: boolean) => {
      capabilityOffline = v
    },
    setKeystoreLocked: (v: boolean) => {
      keystoreLocked = v
      if (v) safeStorage.lock()
      else safeStorage.unlock()
    },
    setAiRunning: (v: boolean) => {
      aiRunning = v
    },
  }
}

function binding(path: string): Binding {
  return JSON.parse(readFileSync(join(dirname(path), BINDING_FILE), 'utf8')) as Binding
}

async function openAndConflict(ctx: ReturnType<typeof setup>, server: ReturnType<typeof fakeServer>) {
  const opened = await ctx.service.openDocument(DOC)
  if (!opened.ok) throw new Error(`open failed: ${opened.error}`)
  const path = opened.value.path
  server.state.revision = 45
  server.state.version = 4
  server.state.bytes = enc('server v4')
  writeFileSync(path, 'mine v4')
  await ctx.service.save(path)
  expect(binding(path)).toMatchObject({ state: 'conflict' })
  return path
}

async function storedIntent(ctx: ReturnType<typeof setup>, path: string) {
  const opened = await ctx.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
  if (opened.kind !== 'ok') return null
  return createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name)).read(
    basename(dirname(path)),
    { orgId: 'org_a', workspaceId: 'ws_1', baseVersion: 3, length: 0 },
  )
}

async function keptDrafts(ctx: ReturnType<typeof setup>, path: string) {
  const opened = await ctx.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
  if (opened.kind !== 'ok') return []
  return createDraftStore(opened.store.records(DRAFTS_STORE_REGISTRATION.name)).list(
    basename(dirname(path)),
  )
}

describe('G5-09 desktop conflict dialog S5 session (main)', () => {
  it('AC1: conflict on two devices opens the S5 view (no native box) and cancel closes it', async () => {
    const server = fakeServer()
    const ctx = setup(server, { aiRunning: true })
    const path = await openAndConflict(ctx, server)

    const resolvePromise = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    const view = ctx.views[0]!
    expect(view).toMatchObject({
      path,
      documentId: DOC,
      title: 'Q4 plan.docx',
      module: 'docs',
      mine: { baseVersion: 3 },
      server: { version: 4, savedAt: '2026-10-10T10:00:00Z', by: null },
      canEdit: true,
      online: true,
      headOffline: false,
      intent: 'none',
      keepDraft: 'ok',
      draftCap: QUEUE_LIMITS.draftsPerDocument,
      aiRunning: true,
      locked: 'none',
      notice: null,
      noticeArg: null,
    })

    const reply = await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
    expect(reply).toEqual({ kind: 'closed' })
    expect(await resolvePromise).toMatchObject({ state: 'conflict' })
  })

  it('AC3: overwrite supersedes the old intent and mints a new one on the new base', async () => {
    const server = fakeServer()
    const ctx = setup(server, { aiRunning: true })
    const path = await openAndConflict(ctx, server)
    const oldIntent = await storedIntent(ctx, path)
    expect(oldIntent).not.toBeNull()

    const resolvePromise = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    const view = ctx.views[0]!

    const reply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'overwrite',
      stopAi: true,
    })
    expect(ctx.stopAiRun).toHaveBeenCalledWith(path)
    expect(reply).toEqual({ kind: 'closed' })
    expect(await resolvePromise).toMatchObject({ state: 'saved' })
    expect(binding(path)).toMatchObject({ state: 'saved', baseRevision: '46', baseVersion: 5 })
    const commitCalls = server.calls.filter((c) => c.path.endsWith('/versions/commit') && c.method === 'POST')
    expect(commitCalls.at(-1)?.headers['idempotency-key']).not.toBe(oldIntent?.intent.idempotencyKey)
    expect(commitCalls.at(-1)?.body).toMatchObject({ base_revision: '45' })
  })

  it('AC4: reload keep=draft keeps a draft of the latest local bytes (visible in drafts.list) and replaces the copy', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)
    writeFileSync(path, 'mine N+1 latest')

    const resolvePromise = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    const view = ctx.views[0]!

    const reply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'reload',
      keep: 'draft',
      stopAi: false,
    })
    expect(reply).toEqual({ kind: 'closed' })
    expect(await resolvePromise).toMatchObject({ state: 'saved' })
    expect(readFileSync(path, 'utf8')).toBe('server v4')
    expect(ctx.deps.reloadPath).toHaveBeenCalledWith(path)

    const drafts = await keptDrafts(ctx, path)
    expect(drafts).toHaveLength(1)
    expect(new TextDecoder().decode(drafts[0]!.snapshot)).toBe('mine N+1 latest')
    expect(await storedIntent(ctx, path)).toBeNull()
  })

  it('AC5: lost edit (!canEdit) refuses overwrite and save-copy; save-copy when canEdit replies save_copy_failed (pending G5-12)', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)

    // First verify save-copy when canEdit=true returns view with save_copy_failed
    const firstResolve = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    const v1 = ctx.views[0]!
    const copyReply = await ctx.service.conflictAct(v1.sessionId, {
      kind: 'save-copy',
      stopAi: false,
    })
    expect(copyReply).toMatchObject({
      kind: 'view',
      view: { notice: 'save_copy_failed' },
    })
    await ctx.service.conflictAct(v1.sessionId, { kind: 'cancel' })
    await firstResolve

    // Now downgrade server ACL to view
    server.state.myLevel = 'view'
    const secondResolve = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(2))
    const v2 = ctx.views[1]!
    expect(v2.canEdit).toBe(false)

    const owReply = await ctx.service.conflictAct(v2.sessionId, {
      kind: 'overwrite',
      stopAi: false,
    })
    expect(owReply).toMatchObject({
      kind: 'view',
      view: { canEdit: false },
    })
    const scReply = await ctx.service.conflictAct(v2.sessionId, {
      kind: 'save-copy',
      stopAi: false,
    })
    expect(scReply).toMatchObject({
      kind: 'view',
      view: { canEdit: false, notice: null },
    })
    await ctx.service.conflictAct(v2.sessionId, { kind: 'cancel' })
    await secondResolve
  })

  it('AC6: drafts_full / store_full / keystore_locked -> keepDraft reflects it without mutating drafts, and reload keep=draft is refused while keep=discard succeeds', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)

    // Fill 3 drafts to reach drafts_full
    const opened = await ctx.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
    if (opened.kind !== 'ok') throw new Error('open store failed')
    const draftStore = createDraftStore(opened.store.records(DRAFTS_STORE_REGISTRATION.name))
    const key = basename(dirname(path))
    for (let i = 1; i <= QUEUE_LIMITS.draftsPerDocument; i += 1) {
      expect(
        await draftStore.keep(key, enc(`d${i}`), {
          id: `d${i}`,
          createdAt: '2026-10-10T00:00:00Z',
        }),
      ).toBe('ok')
    }

    const p1 = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    expect(ctx.views[0]!.keepDraft).toBe('drafts_full')
    expect(await keptDrafts(ctx, path)).toHaveLength(3)

    // reload keep=draft is refused, copy not replaced
    const refDraft = await ctx.service.conflictAct(ctx.views[0]!.sessionId, {
      kind: 'reload',
      keep: 'draft',
      stopAi: false,
    })
    expect(refDraft).toMatchObject({
      kind: 'view',
      view: { keepDraft: 'drafts_full' },
    })
    expect(readFileSync(path, 'utf8')).toBe('mine v4')
    await ctx.service.conflictAct(ctx.views[0]!.sessionId, { kind: 'cancel' })
    await p1

    // Lock keystore -> keepDraft is keystore_locked
    ctx.setKeystoreLocked(true)
    const p2 = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(2))
    expect(ctx.views[1]!.keepDraft).toBe('keystore_locked')
    const refLocked = await ctx.service.conflictAct(ctx.views[1]!.sessionId, {
      kind: 'reload',
      keep: 'draft',
      stopAi: false,
    })
    expect(refLocked).toMatchObject({
      kind: 'view',
      view: { keepDraft: 'keystore_locked' },
    })
    expect(readFileSync(path, 'utf8')).toBe('mine v4')

    // Explicit keep=discard succeeds even when keepDraft != 'ok'
    ctx.setKeystoreLocked(false)
    const discardReply = await ctx.service.conflictAct(ctx.views[1]!.sessionId, {
      kind: 'reload',
      keep: 'discard',
      stopAi: false,
    })
    expect(discardReply).toEqual({ kind: 'closed' })
    expect(await p2).toMatchObject({ state: 'saved' })
    expect(readFileSync(path, 'utf8')).toBe('server v4')
  })

  it('AC6 (store_full): keepDraft probes store_full without mutating the store', async () => {
    const server = fakeServer()
    // budget 700 bytes allows the conflict intent (~450B) but cannot fit an additional draft record (~350B)
    const ctx = setup(server, { budgetBytes: 700 })
    const path = await openAndConflict(ctx, server)

    const p = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    expect(ctx.views[0]!.keepDraft).toBe('store_full')
    expect(await keptDrafts(ctx, path)).toHaveLength(0)

    const refFull = await ctx.service.conflictAct(ctx.views[0]!.sessionId, {
      kind: 'reload',
      keep: 'draft',
      stopAi: false,
    })
    expect(refFull).toMatchObject({
      kind: 'view',
      view: { keepDraft: 'store_full' },
    })
    expect(readFileSync(path, 'utf8')).toBe('mine v4')
    await ctx.service.conflictAct(ctx.views[0]!.sessionId, { kind: 'cancel' })
    await p
  })

  it('AC7: offline overwrite queues paused_offline on the known head; offline reload without headOffline is refused', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)

    // Go offline
    ctx.setCapabilityOffline(true)
    server.faults.push({ route: 'detail', kind: 'network' })
    const p = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    const view = ctx.views[0]!
    expect(view.online).toBe(false)
    expect(view.headOffline).toBe(false)

    // Offline reload without headOffline is refused without network download
    const downloadsBefore = server.calls.filter((c) => c.path.endsWith('/download')).length
    const reloadReply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'reload',
      keep: 'discard',
      stopAi: false,
    })
    expect(reloadReply).toMatchObject({
      kind: 'view',
      view: { online: false, headOffline: false },
    })
    expect(server.calls.filter((c) => c.path.endsWith('/download')).length).toBe(downloadsBefore)

    // Offline overwrite mints intent on known head (revision 45) and leaves it paused_offline
    const owReply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'overwrite',
      stopAi: false,
    })
    expect(owReply).toEqual({ kind: 'closed' })
    expect(await p).toMatchObject({ state: 'paused_offline' })
    const intent = await storedIntent(ctx, path)
    expect(intent?.intent).toMatchObject({
      state: 'paused_offline',
      baseRevision: '45',
    })
  })

  it('AC8: intent committing/reconciling refuses every action except cancel', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)

    // Put the stored intent in 'reconciling' state
    const opened = await ctx.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
    if (opened.kind !== 'ok') throw new Error('open store failed')
    const intents = createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name))
    const key = basename(dirname(path))
    const current = await intents.read(key, {
      orgId: 'org_a',
      workspaceId: 'ws_1',
      baseVersion: 3,
      length: 0,
    })
    await intents.put(
      key,
      { ...(current!.intent as IntentRecordV2), state: 'reconciling' },
      current!.payload,
    )

    const p = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    const view = ctx.views[0]!
    expect(view.intent).toBe('reconciling')

    for (const action of [
      { kind: 'overwrite', stopAi: false },
      { kind: 'reload', keep: 'discard', stopAi: false },
      { kind: 'save-copy', stopAi: false },
    ] as const) {
      const reply = await ctx.service.conflictAct(view.sessionId, action)
      expect(reply).toMatchObject({
        kind: 'view',
        view: { intent: 'reconciling' },
      })
    }
    expect(readFileSync(path, 'utf8')).toBe('mine v4')

    const cancelReply = await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
    expect(cancelReply).toEqual({ kind: 'closed' })
    await p
  })

  it('409 on overwrite replies view with notice head_moved and refreshed server version', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)

    const p = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    const view = ctx.views[0]!
    expect(view.server.version).toBe(4)

    // Move server head again before overwrite commits
    server.state.revision = 49
    server.state.version = 6
    server.state.updatedAt = '2026-10-10T12:00:00Z'

    const reply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'overwrite',
      stopAi: false,
    })
    expect(reply).toMatchObject({
      kind: 'view',
      view: {
        notice: 'head_moved',
        noticeArg: '6',
        server: { version: 6, savedAt: '2026-10-10T12:00:00Z' },
      },
    })
    expect(binding(path)).toMatchObject({ state: 'conflict', serverRevision: '49' })

    // A second overwrite now succeeds against revision 49
    const secondReply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'overwrite',
      stopAi: false,
    })
    expect(secondReply).toEqual({ kind: 'closed' })
    expect(await p).toMatchObject({ state: 'saved' })
  })

  it('in-place lock while open: revoked or deleted pushes locked view and refuses every action except cancel', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)

    const p = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    const view = ctx.views[0]!
    expect(view.locked).toBe('none')

    // Feed change triggers metadata refresh where server returns 403 permission_revoked
    server.faults.push({ route: 'detail', kind: 403, code: 'permission_revoked' })
    ctx.service.noteFeedChange(DOC, '46')
    await vi.waitFor(() => expect(ctx.views).toHaveLength(2))
    expect(ctx.views[1]).toMatchObject({ locked: 'revoked', canEdit: false })

    for (const action of [
      { kind: 'overwrite', stopAi: false },
      { kind: 'reload', keep: 'discard', stopAi: false },
      { kind: 'save-copy', stopAi: false },
    ] as const) {
      const reply = await ctx.service.conflictAct(view.sessionId, action)
      expect(reply).toMatchObject({
        kind: 'view',
        view: { locked: 'revoked', canEdit: false },
      })
    }

    const cancelReply = await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
    expect(cancelReply).toEqual({ kind: 'closed' })
    await p
  })
})
