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
  CLOSE_SAVE_WAIT_MS,
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

const COPY = '01J8X4CPY0N1P2Q3R4S5T6U7'
const FOLDER = '01J8X4FLD0N1P2Q3R4S5T6U7'

type Fault = {
  route:
    | 'upload'
    | 'commit'
    | 'lookup'
    | 'detail'
    | 'download'
    | 'copy'
    | 'copyUpload'
    | 'copyCommit'
    | 'archive'
  /** 'lost' (copyCommit only): the server applies the commit, the answer never arrives */
  kind: 'network' | 'lost' | 'bad_checksum' | number
  code?: string
  fields?: Record<string, unknown>
}

function fakeServer(
  initial: { bytes: Uint8Array; myLevel?: string; title?: string } = { bytes: enc('v3') },
) {
  const state = {
    revision: 41,
    version: 3,
    bytes: initial.bytes,
    myLevel: initial.myLevel ?? 'edit',
    title: initial.title ?? 'Q4 plan.docx',
    updatedAt: '2026-10-10T10:00:00Z',
    // G5-12: the source's parent folder (null = root) and the copy the fake made, if any
    parentId: null as string | null,
    copy: null as null | {
      title: string
      parentId: string | null
      revision: number
      bytes: Uint8Array | null
      archived: boolean
      staged: Map<string, Uint8Array>
      /** commit keys the server applied, with their stored answer (idempotent replay) */
      applied: Map<string, Response>
    },
    /** BE-12F-01: what the next lookups of the copy's commit answer (default: derived) */
    copyLookupScript: [] as Array<
      'in_flight' | 'not_committed' | 'unknown' | 'committed' | 'network'
    >,
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
    parent_id: state.parentId,
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
  const copyJson = () => ({
    id: COPY,
    organization_id: 'org_a',
    workspace_id: 'ws_1',
    title: state.copy!.title,
    kind: 'file',
    parent_id: state.copy!.parentId,
    revision: String(state.copy!.revision),
    current_version: state.copy!.revision,
    my_level: 'edit',
    updated_at: state.updatedAt,
    file: {
      file_id: 'fc',
      version_id: `cv${state.copy!.revision}`,
      version: state.copy!.revision,
      filename: state.copy!.title,
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size_bytes: state.copy!.bytes?.byteLength ?? 0,
      checksum_sha256: hex(state.copy!.bytes ?? new Uint8Array()),
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
    if (u.pathname === `/api/v1/documents/${DOC}/copies` && init.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { title: string; parent_id?: string | null }
      calls.at(-1)!.body = body
      const fault = take('copy')
      if (fault?.kind === 'network') throw new TypeError('fetch failed')
      if (typeof fault?.kind === 'number') return error(fault.kind, fault.code ?? 'x', fault.fields)
      // the copy starts as the source's head bytes (version 1, revision 1)
      state.copy = {
        title: body.title,
        parentId: body.parent_id ?? null,
        revision: 1,
        bytes: state.bytes,
        archived: false,
        staged: new Map(),
        applied: new Map(),
      }
      return json(201, { document: copyJson() })
    }
    if (u.pathname === `/api/v1/documents/${COPY}/uploads`) {
      const file = (init.body as FormData).get('file') as Blob
      const bytes = new Uint8Array(await file.arrayBuffer())
      const fault = take('copyUpload')
      if (fault?.kind === 'network') throw new TypeError('fetch failed')
      if (typeof fault?.kind === 'number') return error(fault.kind, fault.code ?? 'x', fault.fields)
      state.copy!.staged.set(`up_copy_${state.copy!.staged.size + 1}`, bytes)
      const id = `up_copy_${state.copy!.staged.size}`
      return json(201, {
        upload_id: id,
        // BE-12F-05: a receipt whose checksum is not the uploaded bytes'
        checksum_sha256: fault?.kind === 'bad_checksum' ? hex(enc('other bytes')) : hex(bytes),
        size_bytes: bytes.byteLength,
        claim_expires_at: '2026-10-10T00:00:00Z',
      })
    }
    if (
      u.pathname === `/api/v1/documents/${COPY}/versions/commit` &&
      (init.method ?? 'GET') === 'GET'
    ) {
      // BE-12F-01: the commit-intent lookup of the copy
      const copy = state.copy!
      const scripted = state.copyLookupScript.shift()
      const outcome = scripted ?? (copy.applied.has(key) ? 'committed' : 'not_committed')
      if (outcome === 'network') throw new TypeError('fetch failed')
      if (outcome === 'unknown') return error(410, 'commit_intent_unknown')
      if (outcome === 'committed') {
        return json(200, { outcome, version_id: 'ver_copy_2', version: 2, revision: '2' })
      }
      return json(200, { outcome })
    }
    if (u.pathname === `/api/v1/documents/${COPY}/versions/commit`) {
      const body = JSON.parse(String(init.body)) as { upload_id: string; base_revision: string }
      calls.at(-1)!.body = body
      const fault = take('copyCommit')
      if (fault?.kind === 'network') throw new TypeError('fetch failed')
      if (typeof fault?.kind === 'number') return error(fault.kind, fault.code ?? 'x', fault.fields)
      const copy = state.copy!
      // the same key replays the stored answer, like the real server
      const replay = copy.applied.get(key)
      if (replay) {
        if (fault?.kind === 'lost') throw new TypeError('fetch failed')
        return replay.clone()
      }
      if (body.base_revision !== String(copy.revision))
        return error(409, 'document_version_conflict')
      const bytes = copy.staged.get(body.upload_id)
      if (!bytes) return error(409, 'document_upload_invalid')
      copy.revision += 1
      copy.bytes = bytes
      const answer = json(200, {
        document: copyJson(),
        version: {
          id: 'ver_copy_2',
          document_id: COPY,
          version: 2,
          kind: 'file',
          checksum_sha256: hex(bytes),
          size_bytes: bytes.byteLength,
        },
      })
      copy.applied.set(key, answer.clone())
      if (fault?.kind === 'lost') throw new TypeError('fetch failed')
      return answer
    }
    if (u.pathname === `/api/v1/documents/${COPY}/archive` && init.method === 'POST') {
      const fault = take('archive')
      if (fault?.kind === 'network') throw new TypeError('fetch failed')
      if (typeof fault?.kind === 'number') return error(fault.kind, fault.code ?? 'x', fault.fields)
      // BE-12F-03: like the server's pristineCopyCleanup, only a copy still at version 1 can be
      // archived by its creator with edit access; once the person's bytes landed it is refused
      if (state.copy!.revision > 1) return error(403, 'forbidden')
      state.copy!.archived = true
      return json(200, { document: { ...copyJson(), archived_at: '2026-10-10T10:05:00Z' } })
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
    editorDirty?: boolean
    lang?: string
  } = {},
) {
  const statuses: UniworkDocStatus[] = []
  const views: UniworkConflictView[] = []
  const closedSessions: string[] = []
  const account: string | null = 'acc_1'
  let capabilityOffline = false
  let keystoreLocked = opts.keystoreLocked ?? false
  let aiRunning = opts.aiRunning ?? false
  let editorDirty: boolean | null = opts.editorDirty ?? null
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
    editorStateOf: vi.fn(async () => ({ dirty: editorDirty, aiRunning, aiEpoch: 0 })),
    activePath: () => undefined,
    lang: () => opts.lang ?? 'en',
    // G5-12 W-F2: the OS save dialog (null = the person cancelled)
    pickDownloadPath: vi.fn(async (_defaultName: string) => null as string | null),
    ui,
    pushStatus: (s: UniworkDocStatus) => statuses.push(s),
    pushConflict: (v: UniworkConflictView) => views.push(v),
    pushConflictClosed: (sessionId: string) => closedSessions.push(sessionId),
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
    closedSessions,
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
    setEditorDirty: (v: boolean | null) => {
      editorDirty = v
    },
  }
}

function binding(path: string): Binding {
  return JSON.parse(readFileSync(join(dirname(path), BINDING_FILE), 'utf8')) as Binding
}

async function openAndConflict(
  ctx: ReturnType<typeof setup>,
  server: ReturnType<typeof fakeServer>,
) {
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
    const commitCalls = server.calls.filter(
      (c) => c.path.endsWith('/versions/commit') && c.method === 'POST',
    )
    expect(commitCalls.at(-1)?.headers['idempotency-key']).not.toBe(
      oldIntent?.intent.idempotencyKey,
    )
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

  it('AC5: lost edit (!canEdit) refuses overwrite and save-copy (no copy is created); save-copy when canEdit runs the G5-12 flow', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)

    // First verify save-copy when canEdit=true creates the copy (G5-12)
    const firstResolve = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    const v1 = ctx.views[0]!
    const copyReply = await ctx.service.conflictAct(v1.sessionId, {
      kind: 'save-copy',
      stopAi: false,
    })
    expect(copyReply).toMatchObject({
      kind: 'view',
      view: { notice: 'save_copy_done' },
    })
    await ctx.service.conflictAct(v1.sessionId, { kind: 'cancel' })
    await firstResolve
    const copiesBefore = server.calls.filter((c) => c.path.endsWith('/copies')).length

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
    expect(server.calls.filter((c) => c.path.endsWith('/copies'))).toHaveLength(copiesBefore)
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

  it('FE-02: tab switch while open pushes conflictClosed once with the session id; an action answered after that returns {kind: "closed"}', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)

    const p1 = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    const sessionId1 = ctx.views[0]!.sessionId

    // Same path keeps the session open
    ctx.service.noteActivePath(path)
    expect(ctx.closedSessions).toEqual([])

    // Tab switch (or home tab / document closed -> different active path) ends the session and pushes close once
    ctx.service.noteActivePath(undefined)
    ctx.service.noteActivePath(undefined)
    expect(ctx.closedSessions).toEqual([sessionId1])
    expect(await p1).toMatchObject({ state: 'conflict' })
    expect(await ctx.service.conflictAct(sessionId1, { kind: 'overwrite', stopAi: false })).toEqual(
      { kind: 'closed' },
    )

    // Language switch (closeConflictPrompt) also pushes close once with the session id
    const p2 = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(2))
    const sessionId2 = ctx.views[1]!.sessionId
    ctx.service.closeConflictPrompt()
    ctx.service.closeConflictPrompt()
    expect(ctx.closedSessions).toEqual([sessionId1, sessionId2])
    expect(await p2).toMatchObject({ state: 'conflict' })
    expect(
      await ctx.service.conflictAct(sessionId2, { kind: 'reload', keep: 'discard', stopAi: false }),
    ).toEqual({ kind: 'closed' })
  })

  it('BE-01a: cancelSave(path, true) (tab closed -> kept draft) ends the open session and pushes conflictClosed once with the session id', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)

    const resolvePromise = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    const sessionId = ctx.views[0]!.sessionId

    // cancelSave(path, false) does not close the document or the open conflict session
    await ctx.service.cancelSave(path, false)
    expect(ctx.closedSessions).toEqual([])

    // Re-conflict and test cancelSave(path, true) while S5 is open
    writeFileSync(path, 'mine v4 again')
    await ctx.service.save(path)
    await ctx.service.cancelSave(path, true)
    expect(ctx.closedSessions).toEqual([sessionId])
    expect(await resolvePromise).toMatchObject({ state: 'conflict' })
    expect(await ctx.service.conflictAct(sessionId, { kind: 'overwrite', stopAi: false })).toEqual({
      kind: 'closed',
    })
  })

  it('BE-01b: confirmClose choosing "close" ends the open session and pushes conflictClosed once with the session id', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)

    const resolvePromise = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    const sessionId = ctx.views[0]!.sessionId

    vi.mocked(ctx.ui.chooseUnsavedClose).mockResolvedValueOnce('close')
    expect(await ctx.service.confirmClose(path)).toBe(true)
    expect(ctx.closedSessions).toEqual([sessionId])
    expect(await resolvePromise).toMatchObject({ state: 'conflict' })
    expect(await ctx.service.conflictAct(sessionId, { kind: 'overwrite', stopAi: false })).toEqual({
      kind: 'closed',
    })
  })

  it('BE-04: does not push conflictClosed when the session is ended before conflictOpen is delivered', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)

    let releaseDetail: () => void = () => undefined
    const detailGate = new Promise<void>((resolve) => {
      releaseDetail = resolve
    })
    const origFetch = server.fetch.getMockImplementation()!
    server.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      const u = new URL(url)
      if (u.pathname === `/api/v1/documents/${DOC}` && (init.method ?? 'GET') === 'GET') {
        await detailGate
      }
      return origFetch(url, init)
    })

    const resolvePromise = ctx.service.resolveConflict(path)
    // Active path changes while the initial buildConflictView is awaiting getDocument
    ctx.service.noteActivePath(undefined)
    releaseDetail()

    expect(await resolvePromise).toMatchObject({ state: 'conflict' })
    expect(ctx.views).toEqual([])
    expect(ctx.closedSessions).toEqual([])
  })

  it('BE-02/BE-302: reload keep=draft awaits the dirty module flush before keeping the draft or replacing the copy, without uploading', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)

    // The user typed in the editor after the conflict appeared without pressing Save:
    // the file on disk still holds 'mine v4', while the editor holds newer bytes.
    ctx.setEditorDirty(true)
    const events: string[] = []
    const origFetch = server.fetch.getMockImplementation()!
    server.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      const u = new URL(url)
      if (u.pathname === `/api/v1/documents/${DOC}/download`) {
        events.push(`download:${readFileSync(path, 'utf8')}`)
      }
      return origFetch(url, init)
    })
    vi.mocked(ctx.deps.reloadPath).mockImplementation(() => {
      events.push(`reloadPath:${readFileSync(path, 'utf8')}`)
    })
    vi.mocked(ctx.deps.requestModuleSave).mockImplementation((targetPath: string) => {
      events.push('flush:start')
      setTimeout(() => {
        writeFileSync(targetPath, 'mine v4 + unsaved editor keystrokes')
        events.push('flush:written')
        ctx.setEditorDirty(false)
        ctx.service.onUserSave(targetPath)
      }, 15)
      return true
    })

    const resolvePromise = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    const view = ctx.views[0]!
    const uploadsBefore = server.calls.filter((c) => c.path.endsWith('/uploads')).length
    const commitsBefore = server.calls.filter((c) => c.path.endsWith('/versions/commit')).length

    const reply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'reload',
      keep: 'draft',
      stopAi: false,
    })
    expect(reply).toEqual({ kind: 'closed' })
    expect(await resolvePromise).toMatchObject({ state: 'saved' })

    // Ordering proof: the module flush completed and wrote the editor bytes
    // before replaceWithLatest downloaded the server head or reloaded the tab,
    // and onUserSave did not start an upload.
    expect(events).toEqual([
      'flush:start',
      'flush:written',
      'download:mine v4 + unsaved editor keystrokes',
      'reloadPath:server v4',
    ])
    expect(server.calls.filter((c) => c.path.endsWith('/uploads')).length).toBe(uploadsBefore)
    expect(server.calls.filter((c) => c.path.endsWith('/versions/commit')).length).toBe(
      commitsBefore,
    )
    expect(readFileSync(path, 'utf8')).toBe('server v4')

    const drafts = await keptDrafts(ctx, path)
    expect(drafts).toHaveLength(1)
    expect(new TextDecoder().decode(drafts[0]!.snapshot)).toBe(
      'mine v4 + unsaved editor keystrokes',
    )
  })

  it('BE-02/BE-302: reload keep=draft refuses with reload_failed when a dirty module does not write; keep=discard stays as-is without flushing', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)

    // Poll-marked dirty editor whose module Save reports onNotWritten -> refused with reload_failed, no stale draft kept
    ctx.service.noteEditorDirty(path, true)
    vi.mocked(ctx.deps.requestModuleSave).mockImplementation(
      (_targetPath: string, onNotWritten?: () => void) => {
        setTimeout(() => onNotWritten?.(), 0)
        return true
      },
    )

    const resolvePromise = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    const view = ctx.views[0]!

    const failedDraftReply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'reload',
      keep: 'draft',
      stopAi: false,
    })
    expect(failedDraftReply).toMatchObject({
      kind: 'view',
      view: { notice: 'reload_failed' },
    })
    expect(readFileSync(path, 'utf8')).toBe('mine v4')
    expect(await keptDrafts(ctx, path)).toHaveLength(0)

    // keep=discard stays as-is: does not ask the module to save and replaces the copy with the server head
    vi.mocked(ctx.deps.requestModuleSave).mockClear()
    const discardReply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'reload',
      keep: 'discard',
      stopAi: false,
    })
    expect(discardReply).toEqual({ kind: 'closed' })
    expect(await resolvePromise).toMatchObject({ state: 'saved' })
    expect(ctx.deps.requestModuleSave).not.toHaveBeenCalled()
    expect(readFileSync(path, 'utf8')).toBe('server v4')
    expect(await keptDrafts(ctx, path)).toHaveLength(0)
  })

  describe('W17: hardened keep-draft flush (BE-401/402/403)', () => {
    type Internals = {
      draftFlushWaiters: Map<string, unknown>
      store: { lookup(path: string): unknown }
      openConflictSession(doc: unknown, opts: unknown): Promise<unknown>
      queueEngine(): Promise<{
        kind: string
        drafts: { keep: (...args: unknown[]) => Promise<string> }
      }>
    }
    const internals = (ctx: ReturnType<typeof setup>) => ctx.service as unknown as Internals
    const commits = (server: ReturnType<typeof fakeServer>) =>
      server.calls.filter((c) => c.path.endsWith('/versions/commit') && c.method === 'POST').length

    /** S6 origin: a bound copy that reads ready (binding not in conflict) with unsaved editor bytes */
    async function openNewerDirty(
      ctx: ReturnType<typeof setup>,
      server: ReturnType<typeof fakeServer>,
    ) {
      const opened = await ctx.service.openDocument(DOC)
      if (!opened.ok) throw new Error(`open failed: ${opened.error}`)
      const path = opened.value.path
      server.state.revision = 45
      server.state.version = 4
      server.state.bytes = enc('server v4')
      ctx.setEditorDirty(true)
      ctx.service.noteEditorDirty(path, true)
      const flow = internals(ctx).openConflictSession(internals(ctx).store.lookup(path), {
        remoteNotice: { documentId: DOC, revision: '45', version: 4, versionId: 'v4' },
      })
      await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
      return { path, flow, view: ctx.views[0]! }
    }

    it('BE-402: the flush times out when the module never answers -> reload_failed, no upload, waiter cleared, a late hook takes the normal path', async () => {
      const server = fakeServer()
      const ctx = setup(server)
      const { path, view } = await openNewerDirty(ctx, server)
      vi.mocked(ctx.deps.requestModuleSave).mockImplementation(() => true)
      const before = commits(server)

      // hold back only the flush's own 30 s timer and fire it by hand; every other timer stays real
      const realSetTimeout = globalThis.setTimeout
      let fireFlushTimeout: (() => void) | undefined
      const timers = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
        fn: () => void,
        ms?: number,
        ...rest: unknown[]
      ) => {
        if (ms === CLOSE_SAVE_WAIT_MS) {
          fireFlushTimeout = fn
          const inert = realSetTimeout(() => undefined, 60_000)
          inert.unref()
          return inert
        }
        return realSetTimeout(fn, ms, ...rest)
      }) as unknown as typeof setTimeout)
      try {
        const act = ctx.service.conflictAct(view.sessionId, {
          kind: 'reload',
          keep: 'draft',
          stopAi: false,
        })
        await vi.waitFor(() => expect(fireFlushTimeout).toBeDefined())
        fireFlushTimeout!()
        expect(await act).toMatchObject({ kind: 'view', view: { notice: 'reload_failed' } })
      } finally {
        timers.mockRestore()
      }
      expect(internals(ctx).draftFlushWaiters.size).toBe(0)
      expect(commits(server)).toBe(before)
      expect(await keptDrafts(ctx, path)).toHaveLength(0)
      expect(ctx.deps.reloadPath).not.toHaveBeenCalled()

      // the module answers after the refusal: no waiter is left, so this is a normal Save
      writeFileSync(path, 'late save bytes')
      ctx.service.onUserSave(path)
      await vi.waitFor(() => expect(commits(server)).toBe(before + 1))
    })

    it('BE-402: Cancel while the flush waits -> closed, no draft kept, no reload, waiter cleared', async () => {
      const server = fakeServer()
      const ctx = setup(server)
      const path = await openAndConflict(ctx, server)
      ctx.setEditorDirty(true)
      vi.mocked(ctx.deps.requestModuleSave).mockImplementation(() => true)

      const resolvePromise = ctx.service.resolveConflict(path)
      await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
      const act = ctx.service.conflictAct(ctx.views[0]!.sessionId, {
        kind: 'reload',
        keep: 'draft',
        stopAi: false,
      })
      await vi.waitFor(() => expect(internals(ctx).draftFlushWaiters.size).toBe(1))
      ctx.service.closeConflictPrompt()

      expect(await act).toEqual({ kind: 'closed' })
      expect(await resolvePromise).toMatchObject({ state: 'conflict' })
      expect(internals(ctx).draftFlushWaiters.size).toBe(0)
      expect(await keptDrafts(ctx, path)).toHaveLength(0)
      expect(ctx.deps.reloadPath).not.toHaveBeenCalled()
      expect(readFileSync(path, 'utf8')).toBe('mine v4')
    })

    it('BE-402: S6 newer-dirty origin: flush ok keeps the editor bytes as the draft and reloads the server head', async () => {
      const server = fakeServer()
      const ctx = setup(server)
      const { path, flow, view } = await openNewerDirty(ctx, server)
      const before = commits(server)
      vi.mocked(ctx.deps.requestModuleSave).mockImplementation((targetPath: string) => {
        setTimeout(() => {
          writeFileSync(targetPath, 'editor bytes from the S6 copy')
          ctx.setEditorDirty(false)
          ctx.service.onUserSave(targetPath)
        }, 10)
        return true
      })

      expect(
        await ctx.service.conflictAct(view.sessionId, {
          kind: 'reload',
          keep: 'draft',
          stopAi: false,
        }),
      ).toEqual({ kind: 'closed' })
      await flow
      expect(commits(server)).toBe(before)
      expect(readFileSync(path, 'utf8')).toBe('server v4')
      const drafts = await keptDrafts(ctx, path)
      expect(drafts).toHaveLength(1)
      expect(new TextDecoder().decode(drafts[0]!.snapshot)).toBe('editor bytes from the S6 copy')
    })

    it('BE-401: a user Save consumed as the flush leaves the chip honest when the dialog ends right after (no "saved" for an un-uploaded copy)', async () => {
      const server = fakeServer()
      const ctx = setup(server)
      const { path, flow, view } = await openNewerDirty(ctx, server)
      expect(binding(path)).toMatchObject({ state: 'ready' })
      vi.mocked(ctx.deps.requestModuleSave).mockImplementation((targetPath: string) => {
        setTimeout(() => {
          // the user's own Ctrl+S lands in the flush window: the same hook the flush waits on
          writeFileSync(targetPath, 'user saved while the dialog was open')
          ctx.setEditorDirty(false)
          ctx.service.onUserSave(targetPath)
          ctx.service.closeConflictPrompt()
        }, 10)
        return true
      })

      expect(
        await ctx.service.conflictAct(view.sessionId, {
          kind: 'reload',
          keep: 'draft',
          stopAi: false,
        }),
      ).toEqual({ kind: 'closed' })
      await flow
      // the bytes differ from the base and nothing was uploaded: the binding says so
      await vi.waitFor(() => expect(binding(path)).toMatchObject({ state: 'dirty' }))
      expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'dirty' })
      expect(readFileSync(path, 'utf8')).toBe('user saved while the dialog was open')
      expect(ctx.deps.reloadPath).not.toHaveBeenCalled()
    })

    it('BE-401: the waiter is one-shot: a second hook for the same path after the flush runs the normal save', async () => {
      const server = fakeServer()
      const ctx = setup(server)
      const { flow, view } = await openNewerDirty(ctx, server)
      const before = commits(server)
      let hooks = 0
      vi.mocked(ctx.deps.requestModuleSave).mockImplementation((targetPath: string) => {
        setTimeout(() => {
          writeFileSync(targetPath, 'flushed bytes')
          ctx.setEditorDirty(false)
          ctx.service.onUserSave(targetPath)
          hooks += 1
          // a second Save of the same path (user pressed Ctrl+S too): it is not the flush
          ctx.service.onUserSave(targetPath)
          hooks += 1
        }, 10)
        return true
      })
      await ctx.service.conflictAct(view.sessionId, {
        kind: 'reload',
        keep: 'draft',
        stopAi: false,
      })
      await flow
      expect(hooks).toBe(2)
      await vi.waitFor(() => expect(commits(server)).toBeGreaterThan(before))
    })

    it('BE-403: a dialog aborted while drafts.keep runs does not reload the tab; the kept draft stays', async () => {
      const server = fakeServer()
      const ctx = setup(server)
      const path = await openAndConflict(ctx, server)
      writeFileSync(path, 'mine, to keep')
      const resolvePromise = ctx.service.resolveConflict(path)
      await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
      const engine = internals(ctx)
      const realQueueEngine = engine.queueEngine.bind(engine)
      vi.spyOn(engine, 'queueEngine').mockImplementation(async () => {
        const access = await realQueueEngine()
        const keep = access.drafts.keep.bind(access.drafts)
        access.drafts.keep = async (...args: unknown[]) => {
          const kept = await keep(...args)
          ctx.service.closeConflictPrompt()
          return kept
        }
        return access
      })

      expect(
        await ctx.service.conflictAct(ctx.views[0]!.sessionId, {
          kind: 'reload',
          keep: 'draft',
          stopAi: false,
        }),
      ).toEqual({ kind: 'closed' })
      expect(await resolvePromise).toMatchObject({ state: 'conflict' })
      expect(readFileSync(path, 'utf8')).toBe('mine, to keep')
      expect(ctx.deps.reloadPath).not.toHaveBeenCalled()
      expect(await keptDrafts(ctx, path)).toHaveLength(1)
    })
  })
})

describe('G5-12 Save as a copy (main)', () => {
  async function openDialog(ctx: ReturnType<typeof setup>, path: string) {
    const flow = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    return { flow, view: ctx.views[0]! }
  }
  const callsTo = (server: ReturnType<typeof fakeServer>, suffix: string) =>
    server.calls.filter((c) => c.path.endsWith(suffix))

  it('AC1: creates the copy with the source parent + a per-action key, commits the LOCAL bytes as version 2 of the copy, and leaves the source, its intent and the dialog alone', async () => {
    const server = fakeServer()
    server.state.parentId = FOLDER
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)
    const intentBefore = await storedIntent(ctx, path)
    expect(intentBefore).not.toBeNull()
    const { flow, view } = await openDialog(ctx, path)
    // the source's own sub-routes (uploads, commit, ...): the copy request is the one allowed call
    const sourceCalls = () =>
      server.calls.filter(
        (c) => c.path.includes(`/documents/${DOC}/`) && !c.path.endsWith('/copies'),
      )
    const sourceCallsBefore = sourceCalls()

    const reply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'save-copy',
      stopAi: false,
    })

    expect(reply).toMatchObject({
      kind: 'view',
      view: { notice: 'save_copy_done', noticeArg: 'Q4 plan (my version).docx', canEdit: true },
    })
    const [copy] = callsTo(server, '/copies')
    expect(copy).toMatchObject({ method: 'POST', body: { consent: 'copy', parent_id: FOLDER } })
    expect(copy!.body).toMatchObject({ title: 'Q4 plan (my version).docx' })
    expect(copy!.headers['idempotency-key']).toBeTruthy()
    // the copy's version 2 carries the local bytes, based on the copy's version 1
    expect(new TextDecoder().decode(server.state.copy!.bytes!)).toBe('mine v4')
    expect(callsTo(server, `${COPY}/versions/commit`)[0]!.body).toMatchObject({
      base_revision: '1',
    })
    // the source document: no upload, no commit, still in conflict, same intent, same local file
    expect(sourceCalls()).toEqual(sourceCallsBefore)
    expect(binding(path)).toMatchObject({ state: 'conflict', documentId: DOC })
    expect(await storedIntent(ctx, path)).toEqual(intentBefore)
    expect(readFileSync(path, 'utf8')).toBe('mine v4')
    expect(ctx.deps.reloadPath).not.toHaveBeenCalled()
    // the dialog stays open: nothing closed it
    expect(ctx.closedSessions).toEqual([])
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
    expect(await flow).toMatchObject({ state: 'conflict' })
  })

  it('AC1: a source at the root sends no parent_id; the title follows the app language (vi)', async () => {
    const server = fakeServer({ bytes: enc('v3'), title: 'Kế hoạch' })
    const ctx = setup(server, { lang: 'vi' })
    const path = await openAndConflict(ctx, server)
    const { view } = await openDialog(ctx, path)

    const reply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'save-copy',
      stopAi: false,
    })

    expect(reply).toMatchObject({
      kind: 'view',
      view: { notice: 'save_copy_done', noticeArg: 'Kế hoạch (bản của tôi)' },
    })
    expect((callsTo(server, '/copies')[0]!.body as Record<string, unknown>).parent_id).toBeFalsy()
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
  })

  it('AC1: a dirty module is flushed first (no upload of the source), and the flushed bytes are what the copy gets', async () => {
    const server = fakeServer()
    const ctx = setup(server, { editorDirty: true })
    const path = await openAndConflict(ctx, server)
    const { view } = await openDialog(ctx, path)
    vi.mocked(ctx.deps.requestModuleSave).mockImplementation((targetPath: string) => {
      setTimeout(() => {
        writeFileSync(targetPath, 'mine v4 + unsaved keystrokes')
        ctx.setEditorDirty(false)
        ctx.service.onUserSave(targetPath)
      }, 10)
      return true
    })
    const uploadsBefore = callsTo(server, `${DOC}/uploads`).length

    const reply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'save-copy',
      stopAi: false,
    })

    expect(reply).toMatchObject({ kind: 'view', view: { notice: 'save_copy_done' } })
    expect(new TextDecoder().decode(server.state.copy!.bytes!)).toBe('mine v4 + unsaved keystrokes')
    expect(callsTo(server, `${DOC}/uploads`)).toHaveLength(uploadsBefore)
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
  })

  it('AC1: stopAi stops the AI turn first', async () => {
    const server = fakeServer()
    const ctx = setup(server, { aiRunning: true })
    const path = await openAndConflict(ctx, server)
    const { view } = await openDialog(ctx, path)
    expect(view.aiRunning).toBe(true)

    await ctx.service.conflictAct(view.sessionId, { kind: 'save-copy', stopAi: true })

    expect(ctx.stopAiRun).toHaveBeenCalledWith(path)
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
  })

  it('AC1: OS-illegal characters in the title become _ and the name keeps its extension', async () => {
    const server = fakeServer({ bytes: enc('v3'), title: 'a:b*c?"d<e>f|g\\h/i.docx' })
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)
    const { view } = await openDialog(ctx, path)

    await ctx.service.conflictAct(view.sessionId, { kind: 'save-copy', stopAi: false })

    expect((callsTo(server, '/copies')[0]!.body as { title: string }).title).toBe(
      'a_b_c__d_e_f_g_h_i (my version).docx',
    )
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
  })

  it('AC4: one failed commit is retried once in the same action and the copy is kept', async () => {
    const server = fakeServer()
    server.faults.push({ route: 'copyCommit', kind: 503, code: 'unavailable' })
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)
    const { view } = await openDialog(ctx, path)

    const reply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'save-copy',
      stopAi: false,
    })

    expect(reply).toMatchObject({ kind: 'view', view: { notice: 'save_copy_done' } })
    expect(callsTo(server, `${COPY}/versions/commit`)).toHaveLength(2)
    expect(server.state.copy!.archived).toBe(false)
    expect(new TextDecoder().decode(server.state.copy!.bytes!)).toBe('mine v4')
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
  })

  it('AC4: a commit that fails twice archives the copy (never server bytes as "your version"), replies save_copy_failed and leaves the source and its intent untouched', async () => {
    const server = fakeServer()
    server.faults.push(
      { route: 'copyCommit', kind: 503, code: 'unavailable' },
      { route: 'copyCommit', kind: 503, code: 'unavailable' },
    )
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)
    const intentBefore = await storedIntent(ctx, path)
    const { flow, view } = await openDialog(ctx, path)

    const reply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'save-copy',
      stopAi: false,
    })

    expect(reply).toMatchObject({
      kind: 'view',
      view: { notice: 'save_copy_failed', noticeArg: null },
    })
    expect(callsTo(server, `${COPY}/archive`)).toHaveLength(1)
    expect(server.state.copy!.archived).toBe(true)
    expect(binding(path)).toMatchObject({ state: 'conflict' })
    expect(await storedIntent(ctx, path)).toEqual(intentBefore)
    expect(readFileSync(path, 'utf8')).toBe('mine v4')
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
    expect(await flow).toMatchObject({ state: 'conflict' })
  })

  it('AC4: a failed upload also archives the copy; when the archive fails too it is logged and the copy is never reported as done', async () => {
    const server = fakeServer()
    server.faults.push(
      { route: 'copyUpload', kind: 'network' },
      { route: 'copyUpload', kind: 'network' },
      { route: 'archive', kind: 500, code: 'x' },
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)
    const { view } = await openDialog(ctx, path)

    const reply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'save-copy',
      stopAi: false,
    })

    expect(reply).toMatchObject({ kind: 'view', view: { notice: 'save_copy_failed' } })
    expect(callsTo(server, `${COPY}/archive`)).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(COPY), expect.anything())
    warn.mockRestore()
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
  })

  it('AC4: a refused copy request (step 1) replies save_copy_failed and uploads nothing', async () => {
    const server = fakeServer()
    server.faults.push({ route: 'copy', kind: 409, code: 'owner_requires_copy' })
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)
    const { view } = await openDialog(ctx, path)

    const reply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'save-copy',
      stopAi: false,
    })

    expect(reply).toMatchObject({ kind: 'view', view: { notice: 'save_copy_failed' } })
    expect(callsTo(server, `${COPY}/uploads`)).toHaveLength(0)
    expect(callsTo(server, `${COPY}/archive`)).toHaveLength(0)
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
  })

  it('W-F2: a 403 from the copy route (not a member of the source workspace) replies save_copy_no_seat without locking the dialog', async () => {
    const server = fakeServer()
    server.faults.push({ route: 'copy', kind: 403, code: 'forbidden' })
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)
    const { view } = await openDialog(ctx, path)

    const reply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'save-copy',
      stopAi: false,
    })

    expect(reply).toMatchObject({
      kind: 'view',
      view: { notice: 'save_copy_no_seat', noticeArg: null, locked: 'none', canEdit: true },
    })
    expect(callsTo(server, `${COPY}/archive`)).toHaveLength(0)
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
  })

  it('W-F2: any plain 403 is no_seat; a deactivated member / suspended org, 5xx and network errors stay save_copy_failed', async () => {
    const cases: Array<[Fault, string]> = [
      [{ route: 'copy', kind: 403, code: 'some_other_refusal' }, 'save_copy_no_seat'],
      [{ route: 'copy', kind: 403, code: 'member_deactivated' }, 'save_copy_failed'],
      [{ route: 'copy', kind: 403, code: 'organization_suspended' }, 'save_copy_failed'],
      [{ route: 'copy', kind: 500, code: 'x' }, 'save_copy_failed'],
      [{ route: 'copy', kind: 'network' }, 'save_copy_failed'],
    ]
    for (const [fault, notice] of cases) {
      const server = fakeServer()
      server.faults.push(fault)
      const ctx = setup(server)
      const path = await openAndConflict(ctx, server)
      const { view } = await openDialog(ctx, path)
      const reply = await ctx.service.conflictAct(view.sessionId, {
        kind: 'save-copy',
        stopAi: false,
      })
      expect(reply).toMatchObject({ kind: 'view', view: { notice, locked: 'none' } })
      await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
    }
  })

  it('AC3: offline refuses the action before any request (no copy is created)', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)
    const { view } = await openDialog(ctx, path)
    ctx.setCapabilityOffline(true)

    const reply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'save-copy',
      stopAi: false,
    })

    expect(reply).toMatchObject({ kind: 'view', view: { online: false } })
    expect((reply as { view: UniworkConflictView }).view.notice).toBeNull()
    expect(callsTo(server, '/copies')).toHaveLength(0)
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
  })

  it('BE-12F-01: a commit that landed but lost its answer twice is found by the lookup: the copy is kept, no archive request, done notice', async () => {
    const server = fakeServer()
    server.faults.push({ route: 'copyCommit', kind: 'lost' }, { route: 'copyCommit', kind: 'lost' })
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)
    const intentBefore = await storedIntent(ctx, path)
    const { flow, view } = await openDialog(ctx, path)

    const reply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'save-copy',
      stopAi: false,
    })

    expect(reply).toMatchObject({
      kind: 'view',
      view: { notice: 'save_copy_done', noticeArg: 'Q4 plan (my version).docx' },
    })
    expect(callsTo(server, `${COPY}/archive`)).toHaveLength(0)
    expect(server.state.copy!.archived).toBe(false)
    expect(new TextDecoder().decode(server.state.copy!.bytes!)).toBe('mine v4')
    // the lookup asked for the commit's own key (the one the two commits used)
    const commitKeys = callsTo(server, `${COPY}/versions/commit`)
      .filter((c) => c.method === 'POST')
      .map((c) => c.headers['idempotency-key'])
    const lookups = callsTo(server, `${COPY}/versions/commit`).filter((c) => c.method === 'GET')
    expect(commitKeys).toHaveLength(2)
    expect(lookups).toHaveLength(1)
    expect(lookups[0]!.headers['idempotency-key']).toBe(commitKeys[0])
    expect(await storedIntent(ctx, path)).toEqual(intentBefore)
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
    expect(await flow).toMatchObject({ state: 'conflict' })
  })

  it('BE-12F-01: an in-flight commit gets one bounded wait, then the lookup is asked again (committed -> kept, done)', async () => {
    const server = fakeServer()
    server.faults.push({ route: 'copyCommit', kind: 'lost' }, { route: 'copyCommit', kind: 'lost' })
    server.state.copyLookupScript.push('in_flight', 'committed')
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)
    const { view } = await openDialog(ctx, path)
    const sleep = vi.spyOn(ctx.deps, 'sleep')

    const reply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'save-copy',
      stopAi: false,
    })

    expect(reply).toMatchObject({ kind: 'view', view: { notice: 'save_copy_done' } })
    expect(
      callsTo(server, `${COPY}/versions/commit`).filter((c) => c.method === 'GET'),
    ).toHaveLength(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(callsTo(server, `${COPY}/archive`)).toHaveLength(0)
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
  })

  it('BE-12F-01: still in flight after the wait -> no archive (it could land any moment), logged, never reported done', async () => {
    const server = fakeServer()
    server.faults.push({ route: 'copyCommit', kind: 'lost' }, { route: 'copyCommit', kind: 'lost' })
    server.state.copyLookupScript.push('in_flight', 'in_flight')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)
    const { view } = await openDialog(ctx, path)

    const reply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'save-copy',
      stopAi: false,
    })

    expect(reply).toMatchObject({ kind: 'view', view: { notice: 'save_copy_failed' } })
    expect(callsTo(server, `${COPY}/archive`)).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(COPY))
    warn.mockRestore()
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
  })

  it('BE-12F-01: not_committed / unknown / an unreachable lookup still archive the pristine copy', async () => {
    for (const outcome of ['not_committed', 'unknown', 'network'] as const) {
      const server = fakeServer()
      server.faults.push(
        { route: 'copyCommit', kind: 503, code: 'unavailable' },
        { route: 'copyCommit', kind: 503, code: 'unavailable' },
      )
      server.state.copyLookupScript.push(outcome)
      const ctx = setup(server)
      const path = await openAndConflict(ctx, server)
      const { view } = await openDialog(ctx, path)

      const reply = await ctx.service.conflictAct(view.sessionId, {
        kind: 'save-copy',
        stopAi: false,
      })

      expect(reply).toMatchObject({ kind: 'view', view: { notice: 'save_copy_failed' } })
      expect(callsTo(server, `${COPY}/archive`)).toHaveLength(1)
      expect(server.state.copy!.archived).toBe(true)
      await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
    }
  })

  it('BE-12F-02: an account switch between the upload and the commit sends nothing under the new account (no lookup, no archive) and logs the switch', async () => {
    const server = fakeServer()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)
    const { view } = await openDialog(ctx, path)
    const origFetch = server.fetch.getMockImplementation()!
    server.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      const response = await origFetch(url, init)
      // the other account signs in right after the copy's upload answered
      if (new URL(url).pathname.endsWith(`${COPY}/uploads`)) {
        ctx.deps.identity = () => ({
          accountId: 'acc_2',
          deviceSessionId: 'dev_2',
          deploymentId: 'default',
        })
      }
      return response
    })
    await ctx.service.conflictAct(view.sessionId, { kind: 'save-copy', stopAi: false })

    // upload happened under acc_1, then nothing at all reached the copy
    expect(callsTo(server, `${COPY}/archive`)).toHaveLength(0)
    expect(callsTo(server, `${COPY}/versions/commit`)).toHaveLength(0)
    // the copy saw exactly its upload (under the first account), nothing after the switch
    expect(server.calls.filter((c) => c.path.includes(COPY))).toHaveLength(1)
    expect(server.state.copy!.archived).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`${COPY}.*account`)))
    warn.mockRestore()
    ctx.service.closeConflictPrompt()
  })

  it('BE-12F-05: an upload receipt whose checksum is not the local bytes is never committed; the copy is archived and the reply is save_copy_failed', async () => {
    const server = fakeServer()
    server.faults.push(
      { route: 'copyUpload', kind: 'bad_checksum' },
      { route: 'copyUpload', kind: 'bad_checksum' },
    )
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)
    const { view } = await openDialog(ctx, path)

    const reply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'save-copy',
      stopAi: false,
    })

    expect(reply).toMatchObject({ kind: 'view', view: { notice: 'save_copy_failed' } })
    expect(
      callsTo(server, `${COPY}/versions/commit`).filter((c) => c.method === 'POST'),
    ).toHaveLength(0)
    expect(server.state.copy!.archived).toBe(true)
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
  })

  it('BE-12F-05: the source read before the copy locks the dialog on a revoked grant and is a plain failure on a network error; no copy is made either way', async () => {
    for (const [fault, expected] of [
      [
        { route: 'detail', kind: 403, code: 'forbidden' },
        { notice: null, locked: 'revoked' },
      ],
      [
        { route: 'detail', kind: 'network' },
        { notice: 'save_copy_failed', locked: 'none' },
      ],
    ] as Array<[Fault, Record<string, unknown>]>) {
      const server = fakeServer()
      const ctx = setup(server)
      const path = await openAndConflict(ctx, server)
      const { view } = await openDialog(ctx, path)
      server.faults.push(fault)

      const reply = await ctx.service.conflictAct(view.sessionId, {
        kind: 'save-copy',
        stopAi: false,
      })

      expect(reply).toMatchObject({ kind: 'view', view: expected })
      expect(callsTo(server, '/copies')).toHaveLength(0)
      await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
    }
  })

  it('BE-12F-05: an unreadable working copy is a plain failure and nothing reaches the server', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)
    const { view } = await openDialog(ctx, path)
    await rm(path)
    const callsBefore = server.calls.length

    const reply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'save-copy',
      stopAi: false,
    })

    expect(reply).toMatchObject({ kind: 'view', view: { notice: 'save_copy_failed' } })
    expect(server.calls).toHaveLength(callsBefore)
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
  })

  it('abort-safety: the dialog closed while the copy exists archives it, logs it and shows no notice', async () => {
    const server = fakeServer()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)
    const { flow, view } = await openDialog(ctx, path)
    const origFetch = server.fetch.getMockImplementation()!
    server.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      const response = await origFetch(url, init)
      // "Decide later" lands right after the copy was created
      if (new URL(url).pathname.endsWith('/copies')) ctx.service.closeConflictPrompt()
      return response
    })

    const reply = await ctx.service.conflictAct(view.sessionId, {
      kind: 'save-copy',
      stopAi: false,
    })

    expect(reply).toEqual({ kind: 'closed' })
    expect(await flow).toMatchObject({ state: 'conflict' })
    expect(callsTo(server, `${COPY}/archive`)).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(COPY))
    expect(binding(path)).toMatchObject({ state: 'conflict' })
    warn.mockRestore()
  })
})

describe('G5-12 W-F2 "Download my version" (main)', () => {
  async function openDialog(ctx: ReturnType<typeof setup>, path: string) {
    const flow = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    return { flow, view: ctx.views[0]! }
  }
  const pick = (ctx: ReturnType<typeof setup>) => vi.mocked(ctx.deps.pickDownloadPath)
  const download = (ctx: ReturnType<typeof setup>, sessionId: string, stopAi = false) =>
    ctx.service.conflictAct(sessionId, { kind: 'download-mine', stopAi })
  const outDir = () => mkdtempSync(join(tmpdir(), 'uw-dl-'))

  it('saves the LOCAL bytes to the picked path under the default name, goes back with download_done, and touches neither the server nor the source', async () => {
    const server = fakeServer({ bytes: enc('v3'), title: 'Q4 plan.docx' })
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)
    const intentBefore = await storedIntent(ctx, path)
    const { flow, view } = await openDialog(ctx, path)
    const target = join(outDir(), 'Q4 plan (my version).docx')
    pick(ctx).mockResolvedValue(target)
    const callsBefore = server.calls.length

    const reply = await download(ctx, view.sessionId)

    expect(pick(ctx)).toHaveBeenCalledWith('Q4 plan (my version).docx')
    expect(reply).toMatchObject({
      kind: 'view',
      view: { notice: 'download_done', noticeArg: 'Q4 plan (my version).docx', canEdit: true },
    })
    expect(readFileSync(target, 'utf8')).toBe('mine v4')
    // no server call, no intent, the binding / local file / editor are as they were
    expect(server.calls).toHaveLength(callsBefore)
    expect(binding(path)).toMatchObject({ state: 'conflict', documentId: DOC })
    expect(await storedIntent(ctx, path)).toEqual(intentBefore)
    expect(readFileSync(path, 'utf8')).toBe('mine v4')
    expect(ctx.deps.reloadPath).not.toHaveBeenCalled()
    expect(ctx.closedSessions).toEqual([])
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
    expect(await flow).toMatchObject({ state: 'conflict' })
  })

  it('the file name noticeArg is the picked file (not the suggestion) and a title without an extension gets the format extension', async () => {
    const server = fakeServer({ bytes: enc('v3'), title: 'a:b*c' })
    const ctx = setup(server, { lang: 'vi' })
    const path = await openAndConflict(ctx, server)
    const { view } = await openDialog(ctx, path)
    const target = join(outDir(), 'my own name.docx')
    pick(ctx).mockResolvedValue(target)

    const reply = await download(ctx, view.sessionId)

    expect(pick(ctx)).toHaveBeenCalledWith('a_b_c (bản của tôi).docx')
    expect(reply).toMatchObject({
      kind: 'view',
      view: { notice: 'download_done', noticeArg: 'my own name.docx' },
    })
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
  })

  it('a dirty module is flushed first (no upload) and the flushed bytes are what is written', async () => {
    const server = fakeServer()
    const ctx = setup(server, { editorDirty: true })
    const path = await openAndConflict(ctx, server)
    const { view } = await openDialog(ctx, path)
    vi.mocked(ctx.deps.requestModuleSave).mockImplementation((targetPath: string) => {
      setTimeout(() => {
        writeFileSync(targetPath, 'mine v4 + unsaved keystrokes')
        ctx.setEditorDirty(false)
        ctx.service.onUserSave(targetPath)
      }, 10)
      return true
    })
    const target = join(outDir(), 'out.docx')
    pick(ctx).mockResolvedValue(target)
    const uploadsBefore = server.calls.filter((c) => c.path.endsWith(`${DOC}/uploads`)).length

    const reply = await download(ctx, view.sessionId)

    expect(reply).toMatchObject({ kind: 'view', view: { notice: 'download_done' } })
    expect(readFileSync(target, 'utf8')).toBe('mine v4 + unsaved keystrokes')
    expect(server.calls.filter((c) => c.path.endsWith(`${DOC}/uploads`))).toHaveLength(
      uploadsBefore,
    )
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
  })

  it('a failed flush writes nothing and stays on step 2 with download_failed', async () => {
    const server = fakeServer()
    const ctx = setup(server, { editorDirty: true })
    const path = await openAndConflict(ctx, server)
    const { view } = await openDialog(ctx, path)
    vi.mocked(ctx.deps.requestModuleSave).mockImplementation(() => false)
    const target = join(outDir(), 'out.docx')
    pick(ctx).mockResolvedValue(target)

    const reply = await download(ctx, view.sessionId)

    expect(reply).toMatchObject({ kind: 'view', view: { notice: 'download_failed' } })
    expect(pick(ctx)).not.toHaveBeenCalled()
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
  })

  it('the person cancelling the OS dialog changes nothing: the step-2 notice that opened it stays, nothing is written', async () => {
    const server = fakeServer()
    server.faults.push({ route: 'copy', kind: 403, code: 'forbidden' })
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)
    const { view } = await openDialog(ctx, path)
    const first = await ctx.service.conflictAct(view.sessionId, {
      kind: 'save-copy',
      stopAi: false,
    })
    expect(first).toMatchObject({ kind: 'view', view: { notice: 'save_copy_no_seat' } })
    const callsBefore = server.calls.length
    pick(ctx).mockResolvedValue(null)

    const reply = await download(ctx, view.sessionId)

    expect(pick(ctx)).toHaveBeenCalledTimes(1)
    expect(reply).toMatchObject({
      kind: 'view',
      view: { notice: 'save_copy_no_seat', noticeArg: null, locked: 'none', canEdit: true },
    })
    expect(server.calls).toHaveLength(callsBefore)
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
  })

  it('a write error stays on step 2 with download_failed (and a cancel after it keeps download_failed); the source is untouched', async () => {
    const server = fakeServer()
    server.faults.push({ route: 'copy', kind: 403, code: 'forbidden' })
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)
    const intentBefore = await storedIntent(ctx, path)
    const { flow, view } = await openDialog(ctx, path)
    await ctx.service.conflictAct(view.sessionId, { kind: 'save-copy', stopAi: false })
    // a folder that does not exist: the write fails
    pick(ctx).mockResolvedValue(join(outDir(), 'missing-folder', 'out.docx'))

    const reply = await download(ctx, view.sessionId)

    expect(reply).toMatchObject({
      kind: 'view',
      view: { notice: 'download_failed', noticeArg: null, locked: 'none' },
    })
    pick(ctx).mockResolvedValue(null)
    expect(await download(ctx, view.sessionId)).toMatchObject({
      kind: 'view',
      view: { notice: 'download_failed' },
    })
    expect(binding(path)).toMatchObject({ state: 'conflict' })
    expect(await storedIntent(ctx, path)).toEqual(intentBefore)
    expect(readFileSync(path, 'utf8')).toBe('mine v4')
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
    expect(await flow).toMatchObject({ state: 'conflict' })
  })

  it('works offline (it is local) and stopAi stops the AI turn first', async () => {
    const server = fakeServer()
    const ctx = setup(server, { aiRunning: true })
    const path = await openAndConflict(ctx, server)
    const { view } = await openDialog(ctx, path)
    ctx.setCapabilityOffline(true)
    const target = join(outDir(), 'offline.docx')
    pick(ctx).mockResolvedValue(target)
    const callsBefore = server.calls.length

    const reply = await download(ctx, view.sessionId, true)

    expect(ctx.stopAiRun).toHaveBeenCalledWith(path)
    expect(reply).toMatchObject({
      kind: 'view',
      view: { online: false, notice: 'download_done' },
    })
    expect(readFileSync(target, 'utf8')).toBe('mine v4')
    expect(server.calls).toHaveLength(callsBefore)
    await ctx.service.conflictAct(view.sessionId, { kind: 'cancel' })
  })

  it('a dialog closed while the OS dialog is open writes nothing and shows no notice', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const path = await openAndConflict(ctx, server)
    const { flow, view } = await openDialog(ctx, path)
    const target = join(outDir(), 'late.docx')
    pick(ctx).mockImplementation(async () => {
      ctx.service.closeConflictPrompt()
      return target
    })

    const reply = await download(ctx, view.sessionId)

    expect(reply).toEqual({ kind: 'closed' })
    expect(await flow).toMatchObject({ state: 'conflict' })
    expect(() => readFileSync(target)).toThrow()
  })
})
