import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  UniworkConflictChoice,
  UniworkConflictView,
  UniworkDocStatus,
  UniworkLaunchEvent,
} from '../src/shared/home-api'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import {
  CLOSE_SAVE_WAIT_MS,
  UniworkDocsService,
  coreSemver,
  type ConflictUi,
  type UnsavedCloseChoice,
} from '../src/main/uniwork-docs/service'
import {
  BINDING_FILE,
  BindingStore,
  INTENT_PAYLOAD_FILE,
} from '../src/main/uniwork-docs/binding-store'
import { pageRecentPaths } from '../src/main/recent-files'
import {
  INTENT_STORE_REGISTRATION,
  createIntentStore,
  type PendingIntentValue,
} from '../src/main/uniwork-sync/intent-store'
import { DRAFTS_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/drafts'
import { PAUSE_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/pause'
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
  url: string
  path: string
  headers: Record<string, string>
  body?: unknown
}

type Fault = {
  route: 'upload' | 'commit' | 'lookup' | 'download' | 'detail'
  /**
   * 'lost': the commit landed but its answer never arrived; 'dropped': the
   * request never reached the server (no commit row); 'no-checksum': the commit
   * lands but its receipt omits version.checksum_sha256
   */
  kind: 'lost' | 'dropped' | 'network' | 'no-checksum' | number
  code?: string
  /** `fields.reason` of a coded refusal (e.g. `file_claim_expired`) */
  reason?: string
  /** a `lookup` route's answer, when the server must say more than the store does */
  outcome?: 'committed' | 'not_committed' | 'in_flight' | 'unknown'
}

/** a small UniWork documents server: idempotent uploads and commits, revisions, ACL level */
function fakeServer(initial: {
  bytes: Uint8Array
  myLevel?: string
  title?: string
  /** the stored upload name (file.filename); defaults to the title */
  filename?: string
}) {
  const state = {
    revision: 41,
    version: 3,
    bytes: initial.bytes,
    myLevel: initial.myLevel ?? 'edit',
    title: initial.title ?? 'Q4 plan.docx',
    filename: initial.filename ?? initial.title ?? 'Q4 plan.docx',
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
      filename: state.filename,
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size_bytes: state.bytes.byteLength,
      checksum_sha256: hex(state.bytes),
    },
  })
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const error = (status: number, code: string, fields?: Record<string, unknown>) =>
    json(status, { error: { code, message: 'x', ...(fields ? { fields } : {}) } })

  function takeFault(route: Fault['route']): Fault | undefined {
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
    const call: Call = { method: init.method ?? 'GET', url, path: u.pathname, headers }
    calls.push(call)
    const key = headers['idempotency-key'] ?? ''
    if (u.pathname === `/api/v1/documents/${DOC}` && call.method === 'GET') {
      const fault = takeFault('detail')
      if (typeof fault?.kind === 'number') return error(fault.kind, fault.code ?? 'x')
      return json(200, { document: docJson() })
    }
    if (u.pathname === `/api/v1/documents/${DOC}/download`) {
      const fault = takeFault('download')
      if (typeof fault?.kind === 'number') return error(fault.kind, fault.code ?? 'x')
      return new Response(state.bytes as BodyInit, { status: 200 })
    }
    if (u.pathname === `/api/v1/documents/${DOC}/uploads`) {
      const file = (init.body as FormData).get('file') as Blob
      const bytes = new Uint8Array(await file.arrayBuffer())
      call.body = { bytes, name: (file as File).name }
      const fault = takeFault('upload')
      if (fault?.kind === 'network') throw new TypeError('fetch failed')
      if (typeof fault?.kind === 'number') return error(fault.kind, fault.code ?? 'x')
      const known = uploads.get(key)
      if (known && known.checksum !== hex(bytes)) return error(409, 'idempotency_payload_mismatch')
      const upload = known ?? { id: `up_${++seq}`, checksum: hex(bytes), bytes }
      uploads.set(key, upload)
      return json(201, {
        upload_id: upload.id,
        checksum_sha256: upload.checksum,
        size_bytes: bytes.byteLength,
        claim_expires_at: '2026-10-10T00:00:00Z',
      })
    }
    if (u.pathname === `/api/v1/documents/${DOC}/versions/commit` && call.method === 'GET') {
      const fault = takeFault('lookup')
      if (typeof fault?.kind === 'number') return error(fault.kind, fault.code ?? 'x')
      if (fault?.outcome === 'in_flight') return json(200, { outcome: 'in_flight' })
      if (fault?.outcome === 'unknown') return error(410, 'commit_intent_unknown')
      if (fault?.outcome === 'not_committed') return json(200, { outcome: 'not_committed' })
      const stored = commits.get(key)
      if (stored) {
        const result = stored as { version: { id: string; version: number } }
        return json(200, {
          outcome: 'committed',
          version_id: result.version.id,
          version: result.version.version,
          revision: String(state.revision),
        })
      }
      return json(200, { outcome: 'not_committed' })
    }
    if (u.pathname === `/api/v1/documents/${DOC}/versions/commit`) {
      const body = JSON.parse(String(init.body)) as { upload_id: string; base_revision: string }
      call.body = body
      const fault = takeFault('commit')
      if (fault?.kind === 'network' || fault?.kind === 'dropped') {
        throw new TypeError('fetch failed')
      }
      if (typeof fault?.kind === 'number') {
        return error(
          fault.kind,
          fault.code ?? 'x',
          fault.reason ? { reason: fault.reason } : undefined,
        )
      }
      const stored = commits.get(key)
      let result = stored
      if (!result) {
        if (body.base_revision !== String(state.revision)) {
          return error(409, 'document_version_conflict', {
            current_revision: String(state.revision),
          })
        }
        const upload = [...uploads.values()].find((x) => x.id === body.upload_id)
        if (!upload) {
          return error(409, 'document_upload_invalid', {
            ...(fault?.reason ? { reason: fault.reason } : {}),
          })
        }
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
      // the commit landed but its answer never arrived
      if (fault?.kind === 'lost') throw new TypeError('fetch failed')
      if (fault?.kind === 'no-checksum') {
        const r = result as { version: Record<string, unknown> }
        const version = { ...r.version }
        delete version.checksum_sha256
        return json(200, { ...r, version })
      }
      return json(200, result)
    }
    return error(404, 'not_found')
  })

  return { state, calls, faults, fetch, uploads, commits }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-docs-save-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function setup(
  server: ReturnType<typeof fakeServer>,
  opts: {
    signedIn?: boolean
    choice?: UniworkConflictChoice
    closeChoice?: UnsavedCloseChoice
    account?: string
    /** the sync store's budget; a tiny one makes the intent write hit store_full */
    budgetBytes?: number
    /** the build version stamped into bindings (default '0.0.0') */
    appVersion?: string
    /** the auth module reports its keystore-locked state (the S11 lock) */
    keystoreLocked?: boolean
    /** register the queue's drafts + pause stores, so a poll pass can run */
    queueStores?: boolean
  } = {},
) {
  const statuses: UniworkDocStatus[] = []
  const launches: UniworkLaunchEvent[] = []
  const views: UniworkConflictView[] = []
  let account: string | null = (opts.signedIn ?? true) ? (opts.account ?? 'acc_1') : null
  const safeStorage: LockableSafeStorage = createLockableSafeStorage()
  const layer: StoreLayer = createStoreLayer({
    root: join(dir, 'uniwork-sync', 'store'),
    keys: createSafeStorageKeyProvider({ safeStorage, dir: join(dir, 'uniwork-sync', 'keys') }),
    budgetBytes: opts.budgetBytes ?? 1 << 20,
    clock: () => 1_700_000_000_000,
  })
  layer.register(INTENT_STORE_REGISTRATION)
  // the queue's own stores (drafts, pause): only a test that drives the poll
  // pass needs them registered; a bare layer keeps the pre-queue behaviour of
  // the conflict dialog and the size prompts (see the BE-6 case)
  if (opts.queueStores) {
    layer.register(DRAFTS_STORE_REGISTRATION)
    layer.register(PAUSE_STORE_REGISTRATION)
  }
  const syncStore = createSyncStoreAccess({
    layer,
    scope: () => (account ? { deploymentId: 'default', accountId: account } : null),
  })
  const ui: ConflictUi = {
    chooseUnsavedClose: vi.fn(async () => opts.closeChoice ?? 'cancel'),
  }
  const deps = {
    userDataDir: dir,
    syncStore,
    appVersion: () => opts.appVersion ?? '0.0.0',
    keystoreLocked: () => opts.keystoreLocked ?? false,
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
    pushConflict: (v: UniworkConflictView) => {
      views.push(v)
      if (opts.choice) {
        queueMicrotask(() => {
          if (opts.choice === 'overwrite') {
            void service.conflictAct(v.sessionId, { kind: 'overwrite', stopAi: false })
          } else if (opts.choice === 'open-latest') {
            void service.conflictAct(v.sessionId, {
              kind: 'reload',
              keep: 'discard',
              stopAi: false,
            })
          } else if (opts.choice === 'save-local-copy') {
            void service.conflictAct(v.sessionId, { kind: 'save-copy', stopAi: false })
          } else if (opts.choice === 'later') {
            void service.conflictAct(v.sessionId, { kind: 'cancel' })
          }
        })
      }
    },
    pushLaunch: (e: UniworkLaunchEvent) => launches.push(e),
    reveal: vi.fn(),
    sleep: async () => undefined,
  }
  const service = new UniworkDocsService(deps)
  return {
    service,
    deps,
    ui,
    statuses,
    launches,
    views,
    layer,
    safeStorage,
    currentAccount: () => account,
    signOut: () => {
      account = null
    },
    signInAs: (id: string) => {
      account = id
    },
  }
}

/** the intent the durable store holds for the working copy at `path` (acc_1's scope) */
async function intentOf(
  ctx: ReturnType<typeof setup>,
  path: string,
): Promise<PendingIntentValue | null> {
  const opened = await ctx.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
  if (opened.kind !== 'ok') return null
  return createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name)).get(
    basename(dirname(path)),
  )
}

/** every file the store layer keeps on disk (no records = the store was never written to) */
function storeFiles(): string[] {
  const found: string[] = []
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else found.push(full)
    }
  }
  try {
    visit(join(dir, 'uniwork-sync', 'store'))
  } catch {
    return []
  }
  return found
}

async function openDoc(ctx: ReturnType<typeof setup>) {
  const opened = await ctx.service.openDocument(DOC)
  if (!opened.ok) throw new Error(opened.error)
  return opened.value.path
}

const uploads = (server: ReturnType<typeof fakeServer>) =>
  server.calls.filter((c) => c.path.endsWith('/uploads'))
const commits = (server: ReturnType<typeof fakeServer>) =>
  server.calls.filter((c) => c.path.endsWith('/versions/commit') && c.method === 'POST')
const lookups = (server: ReturnType<typeof fakeServer>) =>
  server.calls.filter((c) => c.path.endsWith('/versions/commit') && c.method === 'GET')
const binding = (path: string) => JSON.parse(readFileSync(join(path, '..', BINDING_FILE), 'utf8'))

function allFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const full = join(root, name)
    return statSync(full).isDirectory() ? allFiles(full) : [full]
  })
}

describe('open flow', () => {
  it('downloads into the working copy with a binding and opens it through the module router', async () => {
    const server = fakeServer({ bytes: enc('v3 bytes') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    expect(path).toBe(join(dir, 'uniwork-documents', 'default', 'acc_1', DOC, 'Q4 plan.docx'))
    expect(readFileSync(path, 'utf8')).toBe('v3 bytes')
    expect(binding(path)).toMatchObject({
      schema: 2,
      min_store_level: 2,
      min_app_version: '0.0.0',
      documentId: DOC,
      workspaceId: 'ws_1',
      orgId: 'org_a',
      format: 'docx',
      access: 'edit',
      baseRevision: '41',
      baseVersion: 3,
      baseChecksum: hex(enc('v3 bytes')),
      state: 'ready',
    })
    expect(ctx.deps.openPath).toHaveBeenCalledWith(path)
  })

  it('names the working copy and the tab after the Vietnamese title, byte for byte', async () => {
    const title = 'GO-A9 Báo cáo Trình chiếu.docx'
    const server = fakeServer({ bytes: enc('v3'), title })
    const ctx = setup(server)
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    // the tab is basename(path): it must read the title, not a stand-in
    expect(basename(opened.value.path)).toBe(title)
    expect(binding(opened.value.path)).toMatchObject({ title, filename: title })
    expect(readdirSync(join(opened.value.path, '..'))).toContain(title)
    // saving uploads under the same name as UTF-8 (a File name, not a byte-mangled header)
    writeFileSync(opened.value.path, 'edited')
    await ctx.service.save(opened.value.path)
    expect((uploads(server)[0]?.body as { name: string }).name).toBe(title)
  })

  it('a stored upload name with U+FFFD never reaches the tab: the title names the copy', async () => {
    const title = 'GO-A9 Báo cáo.docx'
    const server = fakeServer({ bytes: enc('v3'), title, filename: 'GO-A9 B\uFFFDo c\uFFFDo.docx' })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    expect(basename(path)).toBe(title)
    expect(binding(path).filename).toBe(title)
  })

  it('a renamed document names the copy after its title, not the original upload name', async () => {
    const title = 'Bảng tính quý 4'
    const server = fakeServer({ bytes: enc('v3'), title, filename: 'upload-1.docx' })
    const ctx = setup(server)
    expect(basename(await openDoc(ctx))).toBe(title + '.docx')
  })

  it('a copy named from a corrupt upload name is renamed when it is downloaded again', async () => {
    const title = 'Báo cáo.docx'
    const server = fakeServer({ bytes: enc('v3'), title })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    const bad = join(path, '..', 'B\uFFFDo c\uFFFDo.docx')
    renameSync(path, bad)
    const b = binding(path)
    writeFileSync(
      join(path, '..', BINDING_FILE),
      JSON.stringify({ ...b, filename: 'B\uFFFDo c\uFFFDo.docx' }),
    )
    server.state.revision = 50
    const again = await openDoc(ctx)
    expect(basename(again)).toBe(title)
    expect(readdirSync(join(again, '..')).filter((n) => n.endsWith('.docx'))).toEqual([title])
  })

  it('view level opens read-only and a pending save reopens the local copy without downloading', async () => {
    const server = fakeServer({ bytes: enc('v3'), myLevel: 'view' })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    expect(ctx.service.isReadOnly(path)).toBe(true)
    server.state.myLevel = 'edit'
    await openDoc(ctx)
    writeFileSync(path, 'local edits')
    server.faults.push({ route: 'upload', kind: 'network' })
    await ctx.service.save(path)
    expect(await intentOf(ctx, path)).not.toBeNull()
    server.state.revision = 50
    const downloadsBefore = server.calls.filter((c) => c.path.endsWith('/download')).length
    await openDoc(ctx)
    expect(server.calls.filter((c) => c.path.endsWith('/download')).length).toBe(downloadsBefore)
    expect(readFileSync(path, 'utf8')).toBe('local edits')
  })

  it('recents hide copies of another account and enrich our own', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    const other = join(dir, 'uniwork-documents', 'default', 'acc_2', DOC, 'Q4 plan.docx')
    const local = join(dir, 'plain.docx')
    writeFileSync(local, 'x')
    const page = pageRecentPaths([path, other, local], {}, new Set(), (p) =>
      ctx.service.recentSource(p),
    )
    expect(page.entries.map((e) => e.path)).toEqual([path, local])
    expect(page.entries[0]?.uniwork).toEqual({
      documentId: DOC,
      workspaceId: 'ws_1',
      title: 'Q4 plan.docx',
      access: 'edit',
    })
    expect(page.entries[1]?.uniwork).toBeUndefined()
    ctx.signOut()
    const hidden = pageRecentPaths([path, local], {}, new Set(), (p) => ctx.service.recentSource(p))
    expect(hidden.entries.map((e) => e.path)).toEqual([local])
  })
})

describe('launch descriptor', () => {
  it("opens with the descriptor's workspace and operation; a historical version is its own view-only copy", async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const base = {
      receiptId: 'r',
      redeemedAt: '2026-09-30T10:01:02Z',
      id: DOC,
      organizationId: 'org_launch',
      workspaceId: 'ws_launch',
      title: 'Q4 plan',
      revision: '41',
      downloadPath: `/api/v1/documents/${DOC}/download`,
    }
    const viewed = await ctx.service.openFromServer(DOC, { ...base, operation: 'view', version: 0 })
    expect(binding(viewed.path)).toMatchObject({
      workspaceId: 'ws_launch',
      orgId: 'org_launch',
      access: 'view',
    })
    const old = await ctx.service.openFromServer(DOC, { ...base, operation: 'edit', version: 2 })
    expect(old.path).toContain(`${DOC}@v2`)
    expect(binding(old.path)).toMatchObject({ access: 'view', baseVersion: 2 })
    expect(server.calls.some((c) => c.url.endsWith('/download?version=2'))).toBe(true)
  })

  const viewTicket = (version: number) => ({
    receiptId: 'r',
    redeemedAt: '2026-09-30T10:01:02Z',
    id: DOC,
    organizationId: 'org_a',
    workspaceId: 'ws_1',
    title: 'Q4 plan',
    operation: 'view' as const,
    version,
    revision: '41',
    downloadPath: `/api/v1/documents/${DOC}/download?version=${version}`,
  })

  it('a version ticket naming the current version is read-only even for an editor', async () => {
    // a ticket is never upgraded to edit by the client: the web omits
    // `version` for an "edit the current version" handoff
    const server = fakeServer({ bytes: enc('v3'), myLevel: 'manage' })
    const ctx = setup(server)
    const opened = await ctx.service.openFromServer(DOC, viewTicket(3))
    expect(binding(opened.path)).toMatchObject({ access: 'view', baseVersion: 3 })
    expect(ctx.deps.openPath).toHaveBeenLastCalledWith(opened.path)
    expect(ctx.statuses.at(-1)).toMatchObject({ access: 'view' })
  })

  it('a current-version view ticket focuses the open tab of the document instead of a duplicate', async () => {
    const server = fakeServer({ bytes: enc('v3'), myLevel: 'manage' })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    ctx.deps.isPathOpen.mockImplementation((p: string) => p === path)
    ctx.deps.openPath.mockClear()
    const downloads = () => server.calls.filter((c) => c.url.includes('/download')).length
    const before = downloads()
    const opened = await ctx.service.openFromServer(DOC, viewTicket(3))
    expect(opened.path).toBe(path)
    expect(opened.path).not.toContain('@v')
    expect(ctx.deps.openPath).toHaveBeenCalledTimes(1)
    expect(ctx.deps.openPath).toHaveBeenCalledWith(path)
    // the open tab is neither downgraded nor reloaded
    expect(binding(path)).toMatchObject({ access: 'edit', baseVersion: 3 })
    expect(downloads()).toBe(before)
  })

  it('a current-version view ticket opens a read-only copy when no tab shows the document', async () => {
    const server = fakeServer({ bytes: enc('v3'), myLevel: 'manage' })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    const opened = await ctx.service.openFromServer(DOC, viewTicket(3))
    expect(opened.path).not.toBe(path)
    expect(opened.path).toContain(`${DOC}@v3`)
    expect(binding(opened.path)).toMatchObject({ access: 'view', baseVersion: 3 })
    expect(binding(path)).toMatchObject({ access: 'edit' })
  })

  it('a ticket without version keeps the live access; operation view is read-only', async () => {
    const server = fakeServer({ bytes: enc('v3'), myLevel: 'manage' })
    const ctx = setup(server)
    const edit = await ctx.service.openFromServer(DOC, { ...viewTicket(0), operation: 'edit' })
    expect(edit.path).not.toContain('@v')
    expect(binding(edit.path)).toMatchObject({ access: 'edit' })
    const view = await ctx.service.openFromServer(DOC, viewTicket(0))
    expect(binding(view.path)).toMatchObject({ access: 'view' })
  })

  it('a current-version view ticket of a view-only document is read-only', async () => {
    const server = fakeServer({ bytes: enc('v3'), myLevel: 'view' })
    const ctx = setup(server)
    const opened = await ctx.service.openFromServer(DOC, viewTicket(3))
    expect(binding(opened.path)).toMatchObject({ access: 'view' })
  })
})

describe('save pipeline', () => {
  it('uploads then commits with one key and moves the base only on a matching receipt', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4 from desktop')
    const status = await ctx.service.save(path)
    expect(status).toMatchObject({ state: 'saved', documentId: DOC })
    expect(uploads(server)).toHaveLength(1)
    expect(commits(server)).toHaveLength(1)
    const key = uploads(server)[0]?.headers['idempotency-key']
    expect(key).toMatch(/^office-key-[0-9a-f-]{36}$/)
    expect(commits(server)[0]?.headers['idempotency-key']).toBe(key)
    expect(commits(server)[0]?.body).toMatchObject({ base_revision: '41' })
    expect(binding(path)).toMatchObject({ baseRevision: '42', baseVersion: 4, state: 'saved' })
    expect(await intentOf(ctx, path)).toBeNull()
    expect(ctx.statuses.map((s) => s.state)).toContain('saving')
  })

  it('persists the intent in the store before the first network call', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    let seen: unknown
    const baseFetch = server.fetch.getMockImplementation()!
    let intercepted = false
    server.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      if (!intercepted && new URL(url).pathname !== '/api/v1/config') {
        intercepted = true
        seen = await intentOf(ctx, path)
        throw new TypeError('fetch failed')
      }
      return baseFetch(url, init)
    })
    await ctx.service.save(path)
    expect((seen as PendingIntentValue | null)?.intent).toMatchObject({
      documentId: DOC,
      baseRevision: '41',
      checksum: hex(enc('v4')),
    })
    expect(typeof (seen as PendingIntentValue | null)?.intent.baseRevision).toBe('string')
  })

  it('two rapid saves make one intent (no queue)', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    const [a, b] = await Promise.all([
      ctx.service.coordinator.save(path),
      ctx.service.coordinator.save(path),
    ])
    expect(uploads(server)).toHaveLength(1)
    expect(commits(server)).toHaveLength(1)
    expect([a?.binding.state, b?.binding.state]).toContain('saved')
  })

  it('a lost commit answer reconciles: one lookup with the SAME key settles it, no second POST', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { queueStores: true })
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    // the commit landed on the server, its answer never arrived
    server.faults.push({ route: 'commit', kind: 'lost' })
    const first = await ctx.service.save(path)
    // B70: a lost answer from the COMMIT leg is never `offline` and never a
    // replay of the POST - the intent reconciles and is looked up
    expect(first).toMatchObject({ state: 'reconciling' })
    const intent = (await intentOf(ctx, path))?.intent
    if (!intent) throw new Error('the intent is missing from the store')
    expect(intent.idempotencyKey).toMatch(/^office-key-/)
    expect(intent.state).toBe('reconciling')
    expect(commits(server)).toHaveLength(1)
    // the poll's tick looks the intent up, once, with the SAME key
    await ctx.service.pollSaveQueue()
    expect(lookups(server).map((c) => c.headers['idempotency-key'])).toEqual([
      intent.idempotencyKey,
    ])
    // the lookup proves the commit: the base moves to the receipt, no second POST
    expect(commits(server)).toHaveLength(1)
    expect(uploads(server)).toHaveLength(1)
    expect(server.state.version).toBe(4)
    expect(new TextDecoder().decode(server.state.bytes)).toBe('v4')
    expect(await intentOf(ctx, path)).toBeNull()
    // the record's settle publishes the binding a beat later (fire-and-forget)
    await vi.waitFor(() =>
      expect(binding(path)).toMatchObject({
        state: 'saved',
        baseRevision: '42',
        baseChecksum: hex(enc('v4')),
      }),
    )
  })

  it('a lookup that proves the commit never landed re-sends the SAME key once', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { queueStores: true })
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    // the request never reached the server (dropped in the network)
    server.faults.push({ route: 'commit', kind: 'dropped' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'reconciling' })
    const intent = (await intentOf(ctx, path))?.intent
    if (!intent) throw new Error('the intent is missing from the store')
    // the lookup answers not_committed: attempt 2, the same commit key
    await ctx.service.pollSaveQueue()
    expect(commits(server)).toHaveLength(2)
    expect(uploads(server)).toHaveLength(2)
    expect(new Set(commits(server).map((c) => c.headers['idempotency-key']))).toEqual(
      new Set([intent.idempotencyKey]),
    )
    expect(await intentOf(ctx, path)).toBeNull()
    expect(server.state.version).toBe(4)
    await vi.waitFor(() =>
      expect(binding(path)).toMatchObject({ state: 'saved', baseRevision: '42' }),
    )
  })

  it('a lookup that cannot say (410) parks the intent stuck and never re-sends it', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { queueStores: true })
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'commit', kind: 'dropped' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'reconciling' })
    // the server holds no intent row for this key: `unknown` is never a resend
    server.faults.push({ route: 'lookup', kind: 410, code: 'commit_intent_unknown' })
    await ctx.service.pollSaveQueue()
    expect(commits(server)).toHaveLength(1)
    expect(uploads(server)).toHaveLength(1)
    expect((await intentOf(ctx, path))?.intent.state).toBe('reconciling-stuck')
    await vi.waitFor(() =>
      expect(binding(path)).toMatchObject({
        state: 'reconciling-stuck',
        error: 'intent_unknown',
      }),
    )
  })

  it('409 conflict keeps the working copy and the base, then refuses every save without network', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    server.state.revision = 45 // someone saved on the web
    writeFileSync(path, 'mine')
    const status = await ctx.service.save(path)
    expect(status).toMatchObject({ state: 'conflict', error: 'conflict' })
    expect(readFileSync(path, 'utf8')).toBe('mine')
    expect(binding(path)).toMatchObject({ baseRevision: '41', serverRevision: '45' })
    // the contract keeps the intent on a base conflict: the same record and
    // key survive (with the queue wired the record reads 'conflict'; the front
    // keeps THIS one, never a second intent)
    const conflicted = await intentOf(ctx, path)
    expect(conflicted?.intent).toMatchObject({
      documentId: DOC,
      baseRevision: '41',
      checksum: hex(enc('mine')),
    })
    expect(conflicted?.intent.idempotencyKey).toBe(commits(server)[0]?.headers['idempotency-key'])
    const calls = server.calls.length
    await ctx.service.save(path)
    await ctx.service.coordinator.save(path)
    expect(server.calls.length).toBe(calls)
  })

  it('also treats 422 revision_conflict as a conflict', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'mine')
    server.faults.push({ route: 'commit', kind: 422, code: 'revision_conflict' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'conflict' })
  })

  it('overwrite saves my version on the server revision; the other stays in history', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { choice: 'overwrite' })
    const path = await openDoc(ctx)
    server.state.revision = 45
    writeFileSync(path, 'mine')
    await ctx.service.save(path)
    const status = await ctx.service.resolveConflict(path)
    expect(status).toMatchObject({ state: 'saved' })
    expect(commits(server).at(-1)?.body).toMatchObject({ base_revision: '45' })
    expect(new TextDecoder().decode(server.state.bytes)).toBe('mine')
  })

  it('open-latest replaces the working copy after confirmation and reloads the tab', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { choice: 'open-latest' })
    const path = await openDoc(ctx)
    server.state.revision = 45
    server.state.bytes = enc('theirs')
    writeFileSync(path, 'mine')
    await ctx.service.save(path)
    const status = await ctx.service.resolveConflict(path)
    expect(ctx.views).toHaveLength(1)
    expect(status).toMatchObject({ state: 'saved' })
    expect(readFileSync(path, 'utf8')).toBe('theirs')
    expect(binding(path)).toMatchObject({ baseRevision: '45' })
    expect(ctx.deps.reloadPath).toHaveBeenCalledWith(path)
  })

  it('save-copy against a server that refuses the copy request replies save_copy_failed and the document stays in conflict', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    server.state.revision = 45
    writeFileSync(path, 'mine')
    await ctx.service.save(path)
    const flow = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    const reply = await ctx.service.conflictAct(ctx.views[0]!.sessionId, {
      kind: 'save-copy',
      stopAi: false,
    })
    // this fake has no copy route (404): the copy is refused, nothing is reported as done
    expect(reply).toEqual({
      kind: 'view',
      view: expect.objectContaining({ notice: 'save_copy_failed' }),
    })
    await ctx.service.conflictAct(ctx.views[0]!.sessionId, { kind: 'cancel' })
    expect(await flow).toMatchObject({ state: 'conflict' })
    expect(readFileSync(path, 'utf8')).toBe('mine')
  })

  it('a payload mismatch drops the intent; the next save mints a new key', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'upload', kind: 409, code: 'idempotency_payload_mismatch' })
    expect(await ctx.service.save(path)).toMatchObject({
      state: 'error',
      error: 'idempotency_mismatch',
    })
    expect(await intentOf(ctx, path)).toBeNull()
    await ctx.service.save(path)
    const keys = uploads(server).map((c) => c.headers['idempotency-key'])
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
  })

  it('idempotency_in_flight retries with a bounded backoff, then goes offline keeping the intent', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    for (let i = 0; i < 4; i += 1)
      server.faults.push({ route: 'upload', kind: 409, code: 'idempotency_in_flight' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'offline' })
    expect(uploads(server)).toHaveLength(4)
    expect(await intentOf(ctx, path)).not.toBeNull()
  })

  it('403 forbidden blocks the save, keeps the file and downgrades access', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'commit', kind: 403, code: 'forbidden' })
    expect(await ctx.service.save(path)).toMatchObject({
      state: 'blocked',
      error: 'permission_revoked',
      access: 'view',
    })
    expect(readFileSync(path, 'utf8')).toBe('v4')
  })

  it('a reopen after a 403 follows the server: still view stays view, edit again unblocks', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'commit', kind: 403, code: 'forbidden' })
    await ctx.service.save(path)
    server.state.myLevel = 'view'
    await openDoc(ctx)
    expect(binding(path)).toMatchObject({ access: 'view', state: 'blocked' })
    expect(readFileSync(path, 'utf8')).toBe('v4')
    server.state.myLevel = 'edit'
    await openDoc(ctx)
    // W4b: the reopen-unblock branch now clears the contract's permission_revoked
    // copy when the server grants edit again, so the local work can be saved
    expect(binding(path)).toMatchObject({ access: 'edit', state: 'dirty' })
    expect(binding(path).error).toBeUndefined()
    const refused = server.calls.length
    expect(await ctx.service.save(path)).toMatchObject({ state: 'saved' })
    expect(server.calls.length).toBeGreaterThan(refused)
    expect(binding(path)).toMatchObject({ baseRevision: '42' })
  })

  it('a view-only document never reaches the network', async () => {
    const server = fakeServer({ bytes: enc('v3'), myLevel: 'view' })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'edited anyway')
    const before = server.calls.length
    await ctx.service.save(path)
    await ctx.service.coordinator.save(path)
    ctx.service.onUserSave(path)
    await new Promise((r) => setTimeout(r, 10))
    expect(server.calls.length).toBe(before)
  })

  it('bytes identical to the base save without any network', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    const before = server.calls.length
    expect(await ctx.service.save(path)).toMatchObject({ state: 'saved' })
    expect(server.calls.length).toBe(before)
  })

  it('signed out: no network, state signed-out', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    ctx.signOut()
    const before = server.calls.length
    await ctx.service.coordinator.save(path)
    expect(server.calls.length).toBe(before)
    expect(binding(path)).toMatchObject({ state: 'signed-out', error: 'not_signed_in' })
  })
})

describe('secrets and egress', () => {
  it('the token is only ever an Authorization header: never in files or pushed payloads', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'commit', kind: 'lost' })
    await ctx.service.save(path)
    await ctx.service.save(path)
    for (const file of allFiles(dir)) expect(readFileSync(file, 'latin1')).not.toContain(TOKEN)
    const payloads = JSON.stringify([
      ctx.statuses,
      ctx.launches,
      await ctx.service.listWorkspaces(),
    ])
    expect(payloads).not.toContain(TOKEN)
    const configCalls = server.calls.filter((call) => call.path === '/api/v1/config')
    const authCalls = server.calls.filter((call) => call.path !== '/api/v1/config')
    expect(configCalls.length).toBeGreaterThan(0)
    expect(authCalls.length).toBeGreaterThan(0)
    for (const call of configCalls) {
      expect(call.headers.authorization).toBeUndefined()
      expect(JSON.stringify(call.headers)).not.toContain(TOKEN)
      expect(call.url).toBe(`${ORIGIN}/api/v1/config`)
      expect(call.url).not.toContain(TOKEN)
    }
    for (const call of authCalls) {
      expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`)
      expect(call.url.startsWith(`${ORIGIN}/api/v1/`)).toBe(true)
      expect(call.url).not.toContain(TOKEN)
    }
    for (const [, init] of server.fetch.mock.calls) {
      expect(init.redirect).toBe('error')
      expect(init.cache).toBe('no-store')
    }
  })
})

// onUserSave starts the save synchronously, so settled() waits for exactly that save (a fixed sleep raced a slow runner)
const flushSaves = (ctx: ReturnType<typeof setup>, path: string) =>
  ctx.service.coordinator.settled(path)

describe('local saves never depend on a live session (review r1 BE-1)', () => {
  it("signed out: the last account's copy stays editable, saves locally and lands in signed-out", async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    ctx.signOut()
    expect(ctx.service.isReadOnly(path)).toBe(false)
    // the module wrote the bytes, then fired the user-save hook
    writeFileSync(path, 'v4 while signed out')
    const before = server.calls.length
    ctx.service.onUserSave(path)
    await flushSaves(ctx, path)
    expect(server.calls.length).toBe(before)
    expect(readFileSync(path, 'utf8')).toBe('v4 while signed out')
    expect(binding(path)).toMatchObject({ state: 'signed-out', error: 'not_signed_in' })
    expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'signed-out' })
    // signed in again, Retry sends it
    ctx.signInAs('acc_1')
    expect(await ctx.service.save(path)).toMatchObject({ state: 'saved' })
  })

  it('reopening a copy left in signed-out by an earlier session reads ready/dirty, not "Sign in again"', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    // an earlier session ended while the copy was saved locally
    ctx.signOut()
    writeFileSync(path, 'v4 while signed out')
    ctx.service.onUserSave(path)
    await flushSaves(ctx, path)
    expect(binding(path)).toMatchObject({ state: 'signed-out' })
    // the session is valid again and the document is opened (the web launch)
    ctx.signInAs('acc_1')
    await ctx.service.openFromServer(DOC)
    expect(binding(path)).toMatchObject({ state: 'dirty' })
    expect(binding(path).error).toBeUndefined()
    expect(ctx.statuses.at(-1)).toMatchObject({ state: 'dirty' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'saved' })

    // a copy whose bytes match UniWork has nothing to send: it reads ready
    ctx.signOut()
    ctx.service.onUserSave(path)
    await flushSaves(ctx, path)
    expect(binding(path)).toMatchObject({ state: 'signed-out' })
    ctx.signInAs('acc_1')
    await ctx.service.openFromServer(DOC)
    expect(binding(path)).toMatchObject({ state: 'ready' })
    expect(ctx.statuses.at(-1)).toMatchObject({ state: 'ready' })
  })

  it('a fresh start with no session yet (restoring) keeps the last account editable; another live account is read-only', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const path = await openDoc(setup(server))
    const restoring = setup(server, { signedIn: false })
    expect(restoring.service.isReadOnly(path)).toBe(false)
    const other = setup(server, { account: 'acc_2' })
    expect(other.service.isReadOnly(path)).toBe(true)
    expect(await other.service.docStatus(path)).toBeNull()
  })
})

describe('review r1 save fixes', () => {
  it('a document blocked as deleted can be saved again after a successful reopen (BE-2)', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    // the contract's document_deleted is terminal for replay: the coordinator
    // stops there and does NOT ask the document (the old flow confirmed with a
    // getDocument), so only the commit fault is needed
    server.faults.push({ route: 'commit', kind: 410, code: 'document_deleted' })
    expect(await ctx.service.save(path)).toMatchObject({
      state: 'blocked',
      error: 'document_deleted',
    })
    // restored from the trash: the reopen answers again. W4b: the reopen-unblock
    // branch now clears the contract's document_deleted copy when the document
    // answers, so the local work can be saved once more
    await openDoc(ctx)
    expect(binding(path)).toMatchObject({ state: 'dirty' })
    expect(binding(path).error).toBeUndefined()
    expect(readFileSync(path, 'utf8')).toBe('v4')
    expect(await ctx.service.save(path)).toMatchObject({ state: 'saved' })
  })

  it('an expired staged upload keeps the intent, looks the SAME commit key up once, and re-stages under a new upload key (B69-lite)', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    // the claim of the staged upload is gone; the intent row is NOT (not_committed)
    server.faults.push({
      route: 'commit',
      kind: 409,
      code: 'document_upload_invalid',
      reason: 'file_claim_expired',
    })
    server.faults.push({ route: 'lookup', outcome: 'not_committed' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'queued' })
    // the intent is KEPT (never dropped, never a fresh key minted behind it)
    const intent = (await intentOf(ctx, path))?.intent
    if (!intent) throw new Error('the intent was dropped')
    expect(intent.attempt).toBe(1)
    expect(intent.state).toBe('queued')
    // exactly ONE lookup, with the COMMIT key
    expect(lookups(server).map((c) => c.headers['idempotency-key'])).toEqual([
      intent.idempotencyKey,
    ])
    // the next save stages the same bytes under a NEW upload key, same commit key
    expect(await ctx.service.save(path)).toMatchObject({ state: 'saved' })
    const uploadKeys = uploads(server).map((c) => c.headers['idempotency-key'])
    expect(uploadKeys).toEqual([intent.idempotencyKey, `${intent.idempotencyKey}:u1`])
    expect(commits(server).map((c) => c.headers['idempotency-key'])).toEqual([
      intent.idempotencyKey,
      intent.idempotencyKey,
    ])
    expect(server.state.version).toBe(4)
  })

  it('R1: a non-user Save over a reconciling record looks the SAME key up, never a second POST', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    // the commit landed on the server, its answer never arrived
    server.faults.push({ route: 'commit', kind: 'lost' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'reconciling' })
    const intent = (await intentOf(ctx, path))?.intent
    if (!intent) throw new Error('the intent is missing from the store')
    expect(commits(server)).toHaveLength(1)
    // the record says the commit may already have been POSTed: the second Save
    // uploads nothing and POSTs nothing, and ONE lookup of the same key decides
    expect(await ctx.service.save(path)).toMatchObject({ state: 'saved' })
    expect(commits(server)).toHaveLength(1)
    expect(uploads(server)).toHaveLength(1)
    expect(lookups(server).map((c) => c.headers['idempotency-key'])).toEqual([
      intent.idempotencyKey,
    ])
    expect(
      server.calls.filter((c) => c.path.endsWith('/versions/commit')).map((c) => c.method),
    ).toEqual(['POST', 'GET'])
    expect(binding(path)).toMatchObject({
      state: 'saved',
      baseRevision: '42',
      baseChecksum: hex(enc('v4')),
    })
    expect(await intentOf(ctx, path)).toBeNull()
    expect(server.state.version).toBe(4)
  })

  it('R1: a non-user Save over a stuck record sends nothing and publishes the stuck state', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { queueStores: true })
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'commit', kind: 'dropped' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'reconciling' })
    // the server holds no intent row for this key: the poll parks it stuck
    server.faults.push({ route: 'lookup', kind: 410, code: 'commit_intent_unknown' })
    await ctx.service.pollSaveQueue()
    await vi.waitFor(() =>
      expect(binding(path)).toMatchObject({ state: 'reconciling-stuck' }),
    )
    const before = {
      uploads: uploads(server).length,
      commits: commits(server).length,
      lookups: lookups(server).length,
    }
    // a record the queue already gave up on is never looked up again inline
    expect(await ctx.service.save(path)).toMatchObject({
      state: 'reconciling-stuck',
      error: 'intent_unknown',
    })
    expect(uploads(server)).toHaveLength(before.uploads)
    expect(commits(server)).toHaveLength(before.commits)
    expect(lookups(server)).toHaveLength(before.lookups)
  })

  it('R3: an inline replay of a parked-offline record requeues it, so the phase sequence reaches committing', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    // no network: the Save parks the intent, nothing is sent
    expect(await ctx.service.coordinator.save(path, { forceOffline: true })).toMatchObject({
      binding: { state: 'paused_offline' },
    })
    const parked = (await intentOf(ctx, path))?.intent
    if (!parked) throw new Error('the intent is missing from the store')
    expect(parked.state).toBe('paused_offline')
    expect(commits(server)).toHaveLength(0)
    // the network is back and the answer to the commit POST is lost: the record
    // must have reached `committing` BEFORE that POST, so the lost answer
    // reconciles. A record left `paused_offline` never took the phase sequence.
    server.faults.push({ route: 'commit', kind: 'lost' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'reconciling' })
    expect((await intentOf(ctx, path))?.intent).toMatchObject({
      state: 'reconciling',
      idempotencyKey: parked.idempotencyKey,
      attempt: 0,
    })
    expect(commits(server).map((c) => c.headers['idempotency-key'])).toEqual([
      parked.idempotencyKey,
    ])
    expect(uploads(server).map((c) => c.headers['idempotency-key'])).toEqual([
      parked.idempotencyKey,
    ])
  })

  it('R7: a failed expiry lookup leaves the record reconciling with an age, never committing', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    // the staged claim expired on the commit leg, and the one lookup that
    // decides cannot be answered (a 5xx): nothing proves either way
    server.faults.push({
      route: 'commit',
      kind: 409,
      code: 'document_upload_invalid',
      reason: 'file_claim_expired',
    })
    server.faults.push({ route: 'lookup', kind: 500, code: 'server_error' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'reconciling' })
    // the durable record must have entered reconciliation BEFORE the lookup:
    // a transient lookup failure leaves `reconciling` with an age to run the
    // stuck clock from, never a `committing` row the tick cannot age
    const intent = (await intentOf(ctx, path))?.intent
    expect(intent?.state).toBe('reconciling')
    expect(intent?.reconcileSince).toBeTruthy()
  })

  it('an expired claim whose lookup proves the commit settles with the receipt, no second POST (B69-lite)', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    // the commit landed, then the staged claim expired before the answer arrived
    server.faults.push({ route: 'commit', kind: 'lost' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'reconciling' })
    const intent = (await intentOf(ctx, path))?.intent
    if (!intent) throw new Error('the intent is missing from the store')
    // R1: a reconciling record is never re-uploaded and never re-POSTed, so the
    // refused replay of B69-lite is not reachable from here: the ONE lookup of
    // the SAME key settles the record with the receipt
    expect(await ctx.service.save(path)).toMatchObject({ state: 'saved' })
    expect(binding(path)).toMatchObject({
      state: 'saved',
      baseRevision: '42',
      baseChecksum: hex(enc('v4')),
    })
    // exactly the lost first attempt, and the lookup answered committed
    expect(commits(server).map((c) => c.headers['idempotency-key'])).toEqual([
      intent.idempotencyKey,
    ])
    expect(uploads(server)).toHaveLength(1)
    expect(lookups(server).map((c) => c.headers['idempotency-key'])).toEqual([
      intent.idempotencyKey,
    ])
    expect(await intentOf(ctx, path)).toBeNull()
    expect(server.state.version).toBe(4)
  })

  it('an expired claim whose lookup says in_flight keeps reconciling (B69-lite)', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({
      route: 'commit',
      kind: 409,
      code: 'document_upload_invalid',
      reason: 'file_claim_expired',
    })
    server.faults.push({ route: 'lookup', outcome: 'in_flight' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'reconciling' })
    const intent = (await intentOf(ctx, path))?.intent
    expect(intent?.state).toBe('reconciling')
    expect(intent?.attempt).toBe(0)
    expect(lookups(server)).toHaveLength(1)
    expect(commits(server)).toHaveLength(1)
    expect(uploads(server)).toHaveLength(1)
  })

  it('an expired claim whose lookup cannot say (410) parks the intent stuck, never a blind resend (B69-lite)', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({
      route: 'commit',
      kind: 409,
      code: 'document_upload_invalid',
      reason: 'file_claim_expired',
    })
    server.faults.push({ route: 'lookup', outcome: 'unknown' })
    expect(await ctx.service.save(path)).toMatchObject({
      state: 'reconciling-stuck',
      error: 'intent_unknown',
    })
    expect((await intentOf(ctx, path))?.intent.state).toBe('reconciling-stuck')
    // never a second upload or POST on an unknown
    expect(uploads(server)).toHaveLength(1)
    expect(commits(server)).toHaveLength(1)
    expect(lookups(server)).toHaveLength(1)
  })

  it('another document_upload_invalid reason keeps today\'s recheck (B69-lite)', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({
      route: 'commit',
      kind: 409,
      code: 'document_upload_invalid',
      reason: 'upload_canceled',
    })
    // not an expiry: the document is checked, its bytes are v3, so the intent is
    // dropped and the copy stays dirty (today's behaviour, unchanged)
    expect(await ctx.service.save(path)).toMatchObject({ state: 'dirty', error: 'server_error' })
    expect(await intentOf(ctx, path)).toBeNull()
    expect(lookups(server)).toHaveLength(0)
  })

  it('a 404 on commit is checked against the document: still there -> dirty, gone -> not_found (A1.2)', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'commit', kind: 404, code: 'not_found' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'dirty', error: 'server_error' })
    server.faults.push({ route: 'commit', kind: 404, code: 'not_found' })
    server.faults.push({ route: 'detail', kind: 404, code: 'not_found' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'blocked', error: 'not_found' })
    expect(await intentOf(ctx, path)).toBeNull()
    expect(readFileSync(path, 'utf8')).toBe('v4')
  })

  it('a Save over a reconciling record whose bytes already committed settles by lookup, no second POST', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'commit', kind: 'lost' })
    // B70: the lost answer reconciles; the bytes are already on the server
    expect(await ctx.service.save(path)).toMatchObject({ state: 'reconciling' })
    const intent = (await intentOf(ctx, path))?.intent
    if (!intent) throw new Error('the intent is missing from the store')
    // R1: the record may already have POSTed, so the second Save looks the SAME
    // key up instead of re-uploading and re-POSTing it: the lookup proves the
    // commit, so these bytes are the current version
    expect(await ctx.service.save(path)).toMatchObject({ state: 'saved' })
    expect(binding(path)).toMatchObject({ baseRevision: '42', baseChecksum: hex(enc('v4')) })
    expect(commits(server)).toHaveLength(1)
    expect(uploads(server)).toHaveLength(1)
    expect(lookups(server).map((c) => c.headers['idempotency-key'])).toEqual([
      intent.idempotencyKey,
    ])
    expect(server.state.version).toBe(4)
  })

  it('an account switch during the upload never commits under the other account (BE-3)', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    const serve = server.fetch.getMockImplementation()!
    server.fetch.mockImplementationOnce(async (url, init) => {
      ctx.signInAs('acc_2')
      return serve(url, init)
    })
    expect(await ctx.service.coordinator.save(path)).toMatchObject({
      binding: { state: 'signed-out' },
    })
    expect(uploads(server)).toHaveLength(1)
    expect(commits(server)).toHaveLength(0)
    expect(await intentOf(ctx, path)).not.toBeNull()
  })

  it('a receipt without a checksum is confirmed against the document instead of failing forever (BE-4)', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'commit', kind: 'no-checksum' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'saved' })
    expect(binding(path)).toMatchObject({ baseRevision: '42', baseVersion: 4 })
    expect(await intentOf(ctx, path)).toBeNull()
  })

  it('save-local-copy reports a copy that could not be written (BE-6)', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    server.state.revision = 45
    writeFileSync(path, 'mine')
    await ctx.service.save(path)
    const flow = ctx.service.resolveConflict(path)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    const reply = await ctx.service.conflictAct(ctx.views[0]!.sessionId, {
      kind: 'reload',
      keep: 'draft',
      stopAi: false,
    })
    expect(reply).toEqual({
      kind: 'view',
      view: expect.objectContaining({ notice: 'reload_failed' }),
    })
    await ctx.service.conflictAct(ctx.views[0]!.sessionId, { kind: 'cancel' })
    await flow
    expect(readFileSync(path, 'utf8')).toBe('mine')
    expect(binding(path)).toMatchObject({ state: 'conflict' })
  })

  it('a file changed while saving settles as dirty, not saved (BE-7)', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    const serve = server.fetch.getMockImplementation()!
    server.fetch.mockImplementationOnce(async (url, init) => {
      writeFileSync(path, 'v5 typed during the upload')
      return serve(url, init)
    })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'dirty' })
    expect(binding(path)).toMatchObject({ baseRevision: '42', baseChecksum: hex(enc('v4')) })
    expect(new TextDecoder().decode(server.state.bytes)).toBe('v4')
  })

  it('bytes written outside the save hook mark a clean copy dirty on status read and activation (A1.3)', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    const before = server.calls.length
    expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'ready' })
    // e.g. Save As onto the working copy's own path, an agent save-to
    writeFileSync(path, 'written by save-to')
    expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'dirty' })
    expect(server.calls.length).toBe(before)
    expect(await ctx.service.save(path)).toMatchObject({ state: 'saved' })
    writeFileSync(path, 'pdf page tool')
    await ctx.service.refreshPath(path)
    expect(binding(path)).toMatchObject({ state: 'dirty' })
    expect(ctx.statuses.at(-1)).toMatchObject({ state: 'dirty' })
  })
})

describe('closing a document with changes not in UniWork (A1.4)', () => {
  it('no prompt for a saved/ready or view-only document', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    expect(ctx.service.isCloseGuarded(path)).toBe(true)
    expect(await ctx.service.confirmClose(path)).toBe(true)
    const viewer = setup(fakeServer({ bytes: enc('v3'), myLevel: 'view' }))
    const viewPath = await openDoc(viewer)
    writeFileSync(viewPath, 'x')
    expect(viewer.service.isCloseGuarded(viewPath)).toBe(false)
    expect(await viewer.service.confirmClose(viewPath)).toBe(true)
    expect(ctx.ui.chooseUnsavedClose).not.toHaveBeenCalled()
    expect(viewer.ui.chooseUnsavedClose).not.toHaveBeenCalled()
  })

  it('cancel keeps it open, close anyway closes and keeps the local copy', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'upload', kind: 'network' })
    await ctx.service.save(path)
    expect(await ctx.service.confirmClose(path)).toBe(false)
    expect(ctx.ui.chooseUnsavedClose).toHaveBeenCalledWith('Q4 plan.docx', 'unsent', 'network')
    vi.mocked(ctx.ui.chooseUnsavedClose).mockResolvedValueOnce('close')
    expect(await ctx.service.confirmClose(path)).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('v4')
    expect(await intentOf(ctx, path)).not.toBeNull()
  })

  it('save to UniWork closes once saved, and keeps the tab open when the save fails', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { closeChoice: 'save' })
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'upload', kind: 'network' })
    expect(await ctx.service.confirmClose(path)).toBe(false)
    expect(binding(path)).toMatchObject({ state: 'offline' })
    expect(await ctx.service.confirmClose(path)).toBe(true)
    expect(binding(path)).toMatchObject({ state: 'saved' })
    expect(new TextDecoder().decode(server.state.bytes)).toBe('v4')
  })

  it('save to UniWork goes through the module Save when a tab shows the document', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { closeChoice: 'save' })
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    vi.mocked(ctx.deps.requestModuleSave).mockImplementation((p: string) => {
      // the module writes the bytes and fires its user-save hook
      setTimeout(() => ctx.service.onUserSave(p), 0)
      return true
    })
    expect(await ctx.service.confirmClose(path)).toBe(true)
    expect(ctx.deps.requestModuleSave).toHaveBeenCalledWith(path, expect.any(Function))
    expect(binding(path)).toMatchObject({ state: 'saved' })
  })
})

describe('review r2 follow-ups', () => {
  it('R2-1: a clean copy does not need a close prompt; edited, unsent or saving ones do', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    // saved/ready, no intent, bytes equal to the base: nothing to protect
    expect(ctx.service.needsClosePrompt(path)).toBe(false)
    expect(ctx.service.needsClosePrompt(path)).toBe(false)
    // bytes written outside the save hook count, even before a status refresh
    writeFileSync(path, 'a longer v4 written by something else')
    expect(ctx.service.needsClosePrompt(path)).toBe(true)
    // an unsent state with a pending intent
    server.faults.push({ route: 'upload', kind: 'network' })
    await ctx.service.save(path)
    expect(ctx.service.needsClosePrompt(path)).toBe(true)
    await ctx.service.save(path)
    expect(binding(path)).toMatchObject({ state: 'saved' })
    expect(ctx.service.needsClosePrompt(path)).toBe(false)
    expect(ctx.service.needsClosePrompt(join(dir, 'unbound.docx'))).toBe(false)
    const viewer = setup(fakeServer({ bytes: enc('v3'), myLevel: 'view' }))
    const viewPath = await openDoc(viewer)
    writeFileSync(viewPath, 'x')
    expect(viewer.service.needsClosePrompt(viewPath)).toBe(false)
  })

  async function conflicted(opts: Parameters<typeof setup>[1] = {}) {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, opts)
    const path = await openDoc(ctx)
    server.state.revision = 45
    writeFileSync(path, 'mine')
    await ctx.service.save(path)
    expect(binding(path)).toMatchObject({ state: 'conflict' })
    return { server, ctx, path }
  }

  it('R2-3: a conflict prompt defaults to the conflict dialog; the close follows only a saved result', async () => {
    const { server, ctx, path } = await conflicted({ choice: 'overwrite' })
    vi.mocked(ctx.ui.chooseUnsavedClose).mockResolvedValue('resolve')
    expect(await ctx.service.confirmClose(path)).toBe(true)
    expect(ctx.ui.chooseUnsavedClose).toHaveBeenCalledWith('Q4 plan.docx', 'conflict', 'conflict')
    expect(ctx.views).toHaveLength(1)
    expect(binding(path)).toMatchObject({ state: 'saved' })
    expect(new TextDecoder().decode(server.state.bytes)).toBe('mine')
  })

  it('R2-3: an overwrite that goes through the module Save closes once the hook has saved', async () => {
    const { ctx, path } = await conflicted({ choice: 'overwrite' })
    vi.mocked(ctx.ui.chooseUnsavedClose).mockResolvedValue('resolve')
    vi.mocked(ctx.deps.requestModuleSave).mockImplementation((p: string) => {
      setTimeout(() => ctx.service.onUserSave(p), 0)
      return true
    })
    expect(await ctx.service.confirmClose(path)).toBe(true)
    expect(binding(path)).toMatchObject({ state: 'saved' })
  })

  it('R2-3: deciding later keeps the prompt; Cancel or Close anyway then ends it', async () => {
    const { ctx, path } = await conflicted({ choice: 'later' })
    vi.mocked(ctx.ui.chooseUnsavedClose)
      .mockResolvedValueOnce('resolve')
      .mockResolvedValueOnce('cancel')
    expect(await ctx.service.confirmClose(path)).toBe(false)
    expect(ctx.ui.chooseUnsavedClose).toHaveBeenCalledTimes(2)
    vi.mocked(ctx.ui.chooseUnsavedClose)
      .mockResolvedValueOnce('resolve')
      .mockResolvedValueOnce('close')
    expect(await ctx.service.confirmClose(path)).toBe(true)
    expect(binding(path)).toMatchObject({ state: 'conflict' })
    expect(readFileSync(path, 'utf8')).toBe('mine')
  })

  it('R2-3: a blocked document has no Save: the prompt carries the reason and a stray save keeps it open', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { closeChoice: 'save' })
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'commit', kind: 410, code: 'document_deleted' })
    server.faults.push({ route: 'detail', kind: 410, code: 'document_deleted' })
    await ctx.service.save(path)
    expect(binding(path)).toMatchObject({ state: 'blocked', error: 'document_deleted' })
    vi.mocked(ctx.deps.requestModuleSave).mockClear()
    expect(await ctx.service.confirmClose(path)).toBe(false)
    expect(ctx.ui.chooseUnsavedClose).toHaveBeenCalledWith(
      'Q4 plan.docx',
      'blocked',
      'document_deleted',
    )
    expect(ctx.deps.requestModuleSave).not.toHaveBeenCalled()
    vi.mocked(ctx.ui.chooseUnsavedClose).mockResolvedValueOnce('close')
    expect(await ctx.service.confirmClose(path)).toBe(true)
  })

  it('R2-4: a module that reports "did not write" ends the close wait at once and shows the chip state', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { closeChoice: 'save' })
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    await ctx.service.refreshPath(path)
    vi.mocked(ctx.deps.requestModuleSave).mockImplementation(
      (_p: string, onNotWritten?: () => void) => {
        setTimeout(() => onNotWritten?.(), 0)
        return true
      },
    )
    const before = ctx.statuses.length
    expect(await ctx.service.confirmClose(path)).toBe(false)
    expect(ctx.statuses.length).toBeGreaterThan(before)
    expect(ctx.statuses.at(-1)).toMatchObject({ path, state: 'dirty' })
  })

  it('R2-4: a module that never reaches the hook is waited for 30 s at most', async () => {
    vi.useFakeTimers()
    try {
      const server = fakeServer({ bytes: enc('v3') })
      const ctx = setup(server, { closeChoice: 'save' })
      const path = await openDoc(ctx)
      writeFileSync(path, 'v4')
      await ctx.service.refreshPath(path)
      vi.mocked(ctx.deps.requestModuleSave).mockReturnValue(true)
      let outcome: boolean | undefined
      void ctx.service.confirmClose(path).then((v) => (outcome = v))
      await vi.advanceTimersByTimeAsync(CLOSE_SAVE_WAIT_MS - 1_000)
      expect(outcome).toBeUndefined()
      await vi.advanceTimersByTimeAsync(2_000)
      // the close first asks the durable store (real fs reads) whether an
      // intent is pending: faked timers stall that lookup until the test drives
      // real I/O again, and the 30 s cap has already expired by then
      for (let round = 0; round < 200 && outcome === undefined; round += 1) {
        await readFile(path, 'utf8')
        await vi.advanceTimersByTimeAsync(0)
      }
      expect(outcome).toBe(false)
      expect(CLOSE_SAVE_WAIT_MS).toBeLessThanOrEqual(30_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('R2-5: the owner is recorded when the session identity changes, without any document call', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const first = setup(server)
    const path = await openDoc(first)
    // another account signs in on a fresh service and never touches a document
    const second = setup(server, { account: 'acc_2' })
    second.service.noteSessionIdentity()
    second.signOut()
    expect(second.service.isReadOnly(path)).toBe(true)
    expect(await second.service.docStatus(path)).toBeNull()
  })
})

describe('Retry replays a pending intent, it does not rewrite the file (F8)', () => {
  /** a module whose Save re-serializes the document into different bytes each time */
  function reserializingModule(ctx: ReturnType<typeof setup>) {
    let writes = 0
    vi.mocked(ctx.deps.requestModuleSave).mockImplementation((p: string) => {
      writes += 1
      writeFileSync(p, `v4 re-serialized #${writes}`)
      setTimeout(() => ctx.service.onUserSave(p), 0)
      return true
    })
    return () => writes
  }

  it('chip Retry with a pending intent replays it without a module Save and ends saved', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'commit', kind: 'lost' })
    // B70: the commit POST may have landed, so the intent reconciles
    expect(await ctx.service.save(path)).toMatchObject({ state: 'reconciling' })
    const intent = (await intentOf(ctx, path))?.intent
    if (!intent) throw new Error('the intent is missing from the store')
    const writes = reserializingModule(ctx)
    vi.mocked(ctx.deps.requestModuleSave).mockClear()

    const retried = await ctx.service.save(path)
    expect(ctx.deps.requestModuleSave).not.toHaveBeenCalled()
    expect(writes()).toBe(0)
    expect(retried).toMatchObject({ state: 'saved' })
    expect(retried?.error).toBeUndefined()
    expect(binding(path)).toMatchObject({ state: 'saved', baseChecksum: hex(enc('v4')) })
    expect(await intentOf(ctx, path)).toBeNull()
    // R1: the reconciling record may already have POSTed: the retry looks the
    // same key up instead of POSTing it a second time
    expect(commits(server)).toHaveLength(1)
    expect(uploads(server)).toHaveLength(1)
    expect(new Set(commits(server).map((c) => c.headers['idempotency-key']))).toEqual(
      new Set([intent.idempotencyKey]),
    )
    expect(lookups(server).map((c) => c.headers['idempotency-key'])).toEqual([
      intent.idempotencyKey,
    ])
    expect(new TextDecoder().decode(server.state.bytes)).toBe('v4')
    expect(readFileSync(path, 'utf8')).toBe('v4')
  })

  it('a Retry with a pending intent still reports dirty when the user really changed the file since', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'commit', kind: 'lost' })
    await ctx.service.save(path)
    writeFileSync(path, 'v5 typed later')
    vi.mocked(ctx.deps.requestModuleSave).mockClear()
    expect(await ctx.service.save(path)).toMatchObject({ state: 'dirty' })
    expect(ctx.deps.requestModuleSave).not.toHaveBeenCalled()
  })

  it('a Retry without an intent still runs the module Save', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    await ctx.service.refreshPath(path)
    expect(binding(path)).toMatchObject({ state: 'dirty' })
    expect(await intentOf(ctx, path)).toBeNull()
    reserializingModule(ctx)
    await ctx.service.save(path)
    expect(ctx.deps.requestModuleSave).toHaveBeenCalledWith(path)
    await vi.waitFor(() => expect(binding(path)).toMatchObject({ state: 'saved' }))
    expect(new TextDecoder().decode(server.state.bytes)).toBe('v4 re-serialized #1')
  })

  it('close prompt "Save to UniWork" with a pending intent replays it without a module Save', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { closeChoice: 'save' })
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    // the UPLOAD leg fails: provably before the commit POST, so the binding is
    // `offline` (an unsent state the close prompt asks about) with the intent kept
    server.faults.push({ route: 'upload', kind: 'network' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'offline' })
    const intent = (await intentOf(ctx, path))?.intent
    if (!intent) throw new Error('the intent is missing from the store')
    const writes = reserializingModule(ctx)
    vi.mocked(ctx.deps.requestModuleSave).mockClear()

    expect(await ctx.service.confirmClose(path)).toBe(true)
    expect(ctx.deps.requestModuleSave).not.toHaveBeenCalled()
    expect(writes()).toBe(0)
    expect(binding(path)).toMatchObject({ state: 'saved', baseChecksum: hex(enc('v4')) })
    expect(new Set(commits(server).map((c) => c.headers['idempotency-key']))).toEqual(
      new Set([intent.idempotencyKey]),
    )
  })

  it('close prompt "Save to UniWork" without an intent still goes through the module Save', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { closeChoice: 'save' })
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    reserializingModule(ctx)
    expect(await ctx.service.confirmClose(path)).toBe(true)
    expect(ctx.deps.requestModuleSave).toHaveBeenCalledWith(path, expect.any(Function))
  })
})

describe('the durable store guards the save (W3b)', () => {
  it('a locked store refuses the save with keystore_locked: no intent, no module save, no request', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    ctx.safeStorage.lock()
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    const before = server.calls.length
    expect(await ctx.service.save(path)).toMatchObject({
      state: 'error',
      error: 'keystore_locked',
    })
    expect(ctx.deps.requestModuleSave).not.toHaveBeenCalled()
    expect(binding(path)).toMatchObject({ state: 'error', error: 'keystore_locked' })
    expect(server.calls.length).toBe(before)
    // the coordinator (a user save with no tab, the close prompt) refuses the same
    expect(await ctx.service.coordinator.save(path)).toMatchObject({
      binding: { state: 'error', error: 'keystore_locked' },
    })
    expect(server.calls.length).toBe(before)
    // the store was never written to (no record file exists)
    expect(storeFiles()).toEqual([])
    // once the keychain opens again the same save goes through
    ctx.safeStorage.unlock()
    expect(await ctx.service.save(path)).toMatchObject({ state: 'saved' })
    expect(await intentOf(ctx, path)).toBeNull()
  })

  it('a store at its budget refuses the save with store_full and leaves no intent', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { budgetBytes: 1 })
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    expect(await ctx.service.save(path)).toMatchObject({ state: 'error', error: 'store_full' })
    expect(binding(path)).toMatchObject({ state: 'error', error: 'store_full' })
    expect(uploads(server)).toHaveLength(0)
    expect(commits(server)).toHaveLength(0)
    expect(storeFiles()).toEqual([])
  })
})

/**
 * R1-be-5: a sweep that could not move a pre-store intent (the store was at
 * its budget) is not complete. The copy keeps its plaintext intent, no save
 * may rewrite its binding into schema 2 (which would drop `pendingIntent`),
 * and the next open - here after the budget frees - migrates it exactly once,
 * with its own idempotency key.
 */
describe('a deferred sweep never erases the pre-store intent (R1-be-5)', () => {
  const LEGACY = {
    intentId: 'office-intent-legacy',
    idempotencyKey: 'office-key-legacy',
    documentId: DOC,
    baseRevision: '41',
    checksum: hex(enc('working copy bytes')),
    createdAt: '2026-10-11T00:00:00.000Z',
  }
  const folder = () => join(dir, 'uniwork-documents', 'default', 'acc_1', DOC)
  const copyPath = (name = 'Plan.docx') => join(folder(), name)
  const payloadPath = () => join(folder(), INTENT_PAYLOAD_FILE)

  /** the pre-store working copy: a schema-1 binding with the intent + its payload */
  function seedLegacy(
    state = 'saving',
    opts: { filename?: string; title?: string; baseRevision?: string; baseChecksum?: string } = {},
  ): void {
    const filename = opts.filename ?? 'Plan.docx'
    mkdirSync(folder(), { recursive: true })
    writeFileSync(copyPath(filename), 'working copy bytes')
    writeFileSync(
      join(folder(), BINDING_FILE),
      JSON.stringify(
        {
          schema: 1,
          documentId: DOC,
          workspaceId: 'ws_1',
          orgId: 'org_a',
          title: opts.title ?? 'Plan.docx',
          filename,
          format: 'docx',
          access: 'edit',
          baseRevision: opts.baseRevision ?? '41',
          baseVersion: 3,
          baseChecksum: opts.baseChecksum ?? 'stale',
          state,
          pendingIntent: LEGACY,
        },
        null,
        2,
      ),
    )
    writeFileSync(payloadPath(), 'working copy bytes')
  }

  /** the intent store of the account's scope, as the layer hands it back */
  async function intentStoreOf(ctx: ReturnType<typeof setup>) {
    const opened = await ctx.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
    if (opened.kind !== 'ok') throw new Error(opened.kind)
    return createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name))
  }

  /** write records until the account's budget refuses the next one */
  async function fillBudget(ctx: ReturnType<typeof setup>): Promise<string[]> {
    const intents = await intentStoreOf(ctx)
    const keys: string[] = []
    for (let i = 0; i < 200; i += 1) {
      const key = `fill-${i}`
      if ((await intents.put(key, LEGACY, new Uint8Array(1))).kind === 'store_full') break
      keys.push(key)
    }
    return keys
  }

  it('keeps the plaintext, refuses every binding rewrite, then migrates once when the budget frees', async () => {
    seedLegacy()
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { budgetBytes: 4096 })
    const fillers = await fillBudget(ctx)
    const before = {
      binding: readFileSync(join(folder(), BINDING_FILE), 'utf8'),
      payload: readFileSync(payloadPath(), 'utf8'),
    }

    // the sweep runs on the open and cannot move the intent: nothing is complete
    expect((await ctx.service.openSyncStore()).kind).toBe('ok')
    expect(binding(copyPath())).toMatchObject({ schema: 1, state: 'saving' })
    expect(binding(copyPath()).pendingIntent).toEqual(LEGACY)

    // a save in that window is refused with the store's reason and must not
    // mint a new intent or rewrite the binding
    expect(await ctx.service.save(copyPath())).toMatchObject({
      state: 'error',
      error: 'store_full',
    })
    expect(ctx.statuses.at(-1)).toMatchObject({ state: 'error', error: 'store_full' })
    expect(readFileSync(join(folder(), BINDING_FILE), 'utf8')).toBe(before.binding)
    expect(readFileSync(payloadPath(), 'utf8')).toBe(before.payload)
    expect(uploads(server)).toHaveLength(0)
    expect(commits(server)).toHaveLength(0)

    // the budget frees: the next open completes the sweep, exactly once
    const intents = await intentStoreOf(ctx)
    for (const key of fillers) await intents.delete(key)
    expect((await ctx.service.openSyncStore()).kind).toBe('ok')
    const migrated = await intentOf(ctx, copyPath())
    expect(migrated?.intent.idempotencyKey).toBe(LEGACY.idempotencyKey)
    expect(Buffer.from(migrated?.payload ?? []).toString()).toBe('working copy bytes')
    expect(binding(copyPath())).toMatchObject({ schema: 2, min_store_level: 2, state: 'dirty' })
    expect(binding(copyPath())).not.toHaveProperty('pendingIntent')
    expect(existsSync(payloadPath())).toBe(false)
    // one record only: the fillers are gone and no second intent was minted
    expect(storeFiles()).toHaveLength(1)
  })

  it('R2-be-5: a status or close check in the deferred window rewrites nothing (docStatus, refreshPath, confirmClose)', async () => {
    // a ready copy whose bytes no longer match its base: `refreshDirty` (the
    // status read, tab activation and the close guard all call it) wants to
    // rewrite the binding as dirty, which would stamp schema 2 and drop the
    // plaintext intent (the review's proving trigger)
    seedLegacy('ready')
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { budgetBytes: 4096 })
    const fillers = await fillBudget(ctx)
    const before = {
      binding: readFileSync(join(folder(), BINDING_FILE), 'utf8'),
      payload: readFileSync(payloadPath(), 'utf8'),
    }

    // the sweep runs on the open and cannot move the intent: every check that
    // follows leaves binding.json and the payload exactly as they are
    expect((await ctx.service.openSyncStore()).kind).toBe('ok')
    expect(await ctx.service.docStatus(copyPath())).toMatchObject({ state: 'ready' })
    await ctx.service.refreshPath(copyPath())
    expect(await ctx.service.confirmClose(copyPath())).toBe(true)
    expect(readFileSync(join(folder(), BINDING_FILE), 'utf8')).toBe(before.binding)
    expect(readFileSync(payloadPath(), 'utf8')).toBe(before.payload)
    expect(binding(copyPath())).toMatchObject({ schema: 1, state: 'ready' })
    expect(binding(copyPath()).pendingIntent).toEqual(LEGACY)
    expect(uploads(server)).toHaveLength(0)

    // the budget frees: the sweep completes and keeps the intent's own key
    const intents = await intentStoreOf(ctx)
    for (const key of fillers) await intents.delete(key)
    expect((await ctx.service.openSyncStore()).kind).toBe('ok')
    const migrated = await intentOf(ctx, copyPath())
    expect(migrated?.intent.idempotencyKey).toBe(LEGACY.idempotencyKey)
    expect(Buffer.from(migrated?.payload ?? []).toString()).toBe('working copy bytes')
    expect(binding(copyPath())).toMatchObject({ schema: 2, min_store_level: 2 })
    expect(binding(copyPath())).not.toHaveProperty('pendingIntent')
    expect(existsSync(payloadPath())).toBe(false)
  })

  it('R3-be-1: the open of a held folder renames nothing and deletes nothing (fresh download)', async () => {
    // the review's trigger: a deferred schema-1 copy named from a corrupt
    // upload name (U+FFFD, so a fresh download would repair the name) with a
    // stale base (so the copy is not kept by the branch above). The open used
    // to write the new file and delete the old one while the binding write was
    // refused: the opened tab named the deleted file and stayed unbound
    const corrupt = 'B\uFFFDo c\uFFFDo.docx'
    const title = 'Báo cáo.docx'
    seedLegacy('ready', {
      filename: corrupt,
      title,
      baseRevision: '40',
      baseChecksum: hex(enc('working copy bytes')),
    })
    const server = fakeServer({ bytes: enc('v3'), title })
    const ctx = setup(server, { budgetBytes: 4096 })
    const fillers = await fillBudget(ctx)
    const snapshot = () => ({
      names: readdirSync(folder()).sort(),
      binding: readFileSync(join(folder(), BINDING_FILE), 'utf8'),
      payload: readFileSync(payloadPath(), 'utf8'),
      copy: readFileSync(copyPath(corrupt), 'utf8'),
    })
    const before = snapshot()

    // the open runs the sweep (deferred: the budget is full), so the folder is
    // held: the copy opens as it is, exactly as when its rewrite is refused
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    expect(opened.value.path).toBe(copyPath(corrupt))
    expect(existsSync(opened.value.path)).toBe(true)
    expect(snapshot()).toEqual(before)
    // the opened copy is the one binding.json names, not an unbound new file
    expect(new BindingStore(join(dir, 'uniwork-documents')).classify(opened.value.path).kind).toBe(
      'bound',
    )
    expect(uploads(server)).toHaveLength(0)
    expect(commits(server)).toHaveLength(0)

    // the budget frees: the sweep completes and keeps the intent's own key
    const intents = await intentStoreOf(ctx)
    for (const key of fillers) await intents.delete(key)
    expect((await ctx.service.openSyncStore()).kind).toBe('ok')
    const migrated = await intentOf(ctx, copyPath(corrupt))
    expect(migrated?.intent.idempotencyKey).toBe(LEGACY.idempotencyKey)
    expect(Buffer.from(migrated?.payload ?? []).toString()).toBe('working copy bytes')
    expect(binding(copyPath(corrupt))).toMatchObject({ schema: 2, min_store_level: 2 })
    expect(binding(copyPath(corrupt))).not.toHaveProperty('pendingIntent')
    expect(existsSync(payloadPath())).toBe(false)
  })

  it('R4-be-1: a held folder with no copy to open reports the lock, not store_full', async () => {
    // binding.json still carries the pre-store pair but the copy it names is
    // gone: the held fresh-download corner has nothing to open and must stop.
    // With the store locked the reason is the lock - never the storage-full
    // sentence, which offers no retry (the split a refused save reports)
    seedLegacy('ready')
    rmSync(copyPath(), { force: true })
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { budgetBytes: 4096, keystoreLocked: true })
    // the sweep cannot move the intent (the budget is full), so the folder is
    // held while the auth module reports the keychain locked
    await fillBudget(ctx)
    const snapshot = () => ({
      names: readdirSync(folder()).sort(),
      binding: readFileSync(join(folder(), BINDING_FILE), 'utf8'),
      payload: readFileSync(payloadPath(), 'utf8'),
    })
    const before = snapshot()
    expect(await ctx.service.openDocument(DOC)).toEqual({ ok: false, error: 'keystore_locked' })
    // the folder stays byte for byte and nothing is sent
    expect(snapshot()).toEqual(before)
    expect(uploads(server)).toHaveLength(0)
    expect(commits(server)).toHaveLength(0)
  })

  it('R4-be-1: the same corner with a budget deferral reports store_full', async () => {
    seedLegacy('ready')
    rmSync(copyPath(), { force: true })
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { budgetBytes: 4096 })
    await fillBudget(ctx)
    const snapshot = () => ({
      names: readdirSync(folder()).sort(),
      binding: readFileSync(join(folder(), BINDING_FILE), 'utf8'),
      payload: readFileSync(payloadPath(), 'utf8'),
    })
    const before = snapshot()
    expect(await ctx.service.openDocument(DOC)).toEqual({ ok: false, error: 'store_full' })
    expect(snapshot()).toEqual(before)
    expect(uploads(server)).toHaveLength(0)
    expect(commits(server)).toHaveLength(0)
  })
})

describe('editor state on the chip (one state source)', () => {
  const last = (ctx: ReturnType<typeof setup>) => ctx.statuses[ctx.statuses.length - 1]

  it('an unsaved edit in the editor reads dirty; the explicit Save then shows saving and saved', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'ready' })

    ctx.service.noteEditorDirty(path, true)
    expect(last(ctx)).toMatchObject({ path, state: 'dirty' })
    expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'dirty' })
    expect(await ctx.service.activeDocStatus()).toBeNull()

    // the module's Save writes the editor's bytes, then reports the user save
    ctx.statuses.length = 0
    writeFileSync(path, 'v4')
    ctx.service.onUserSave(path)
    await vi.waitFor(() => expect(last(ctx)).toMatchObject({ state: 'saved' }))
    expect(ctx.statuses.map((s) => s.state)).toEqual(['saving', 'saved'])
    expect(commits(server)).toHaveLength(1)
    // the editor's clean report after the save changes nothing
    ctx.service.noteEditorDirty(path, false)
    expect(ctx.statuses.map((s) => s.state)).toEqual(['saving', 'saved'])
  })

  it('a poll answer from a pass that began before the Save does not flash dirty again', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    ctx.service.noteEditorDirty(path, true)
    const mark = ctx.service.saveMark() // a pass starts here, still sees the edits
    writeFileSync(path, 'v4')
    ctx.service.onUserSave(path)
    await vi.waitFor(() => expect(last(ctx)).toMatchObject({ state: 'saved' }))
    ctx.statuses.length = 0
    ctx.service.noteEditorDirty(path, true, mark) // the stale answer arrives
    expect(ctx.statuses).toHaveLength(0)
    expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'saved' })
    // a pass that began after the Save is believed
    ctx.service.noteEditorDirty(path, true, ctx.service.saveMark())
    expect(last(ctx)).toMatchObject({ state: 'dirty' })
  })

  it('reports only changes, and never hides a conflict, offline or signed-out state', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    ctx.statuses.length = 0
    ctx.service.noteEditorDirty(path, false)
    expect(ctx.statuses).toHaveLength(0)
    ctx.service.noteEditorDirty(path, true)
    ctx.service.noteEditorDirty(path, true)
    expect(ctx.statuses.map((s) => s.state)).toEqual(['dirty'])

    writeFileSync(path, 'v4')
    server.faults.push({ route: 'upload', kind: 'network' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'offline' })
    ctx.service.noteEditorDirty(path, true)
    expect(last(ctx)).toMatchObject({ state: 'offline' })
    expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'offline' })
  })

  it('a view-only copy and a plain local file ignore editor reports', async () => {
    const server = fakeServer({ bytes: enc('v3'), myLevel: 'view' })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    ctx.statuses.length = 0
    ctx.service.noteEditorDirty(path, true)
    ctx.service.noteEditorDirty(join(dir, 'plain.docx'), true)
    expect(ctx.statuses).toHaveLength(0)
    expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'ready', access: 'view' })
  })

  it('offline Retry that lands is pushed as saved', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'upload', kind: 'network' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'offline' })
    ctx.statuses.length = 0
    expect(await ctx.service.save(path)).toMatchObject({ state: 'saved' })
    expect(ctx.statuses.map((s) => s.state)).toEqual(['saving', 'saved'])
  })
})

describe('the conflict dialog belongs to the document that hit the conflict (GOA9-r2-01/07)', () => {
  const SHEET = '01J8X4SHEET1P2Q3R4S5T6U7V'

  /** a docx and an xlsx of the same account, both in conflict */
  async function twoConflicts(opts: Parameters<typeof setup>[1] = {}) {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, opts)
    const docx = await openDoc(ctx)
    server.state.revision = 45
    writeFileSync(docx, 'my docx')
    await ctx.service.save(docx)
    expect(binding(docx)).toMatchObject({ state: 'conflict' })
    const sheetDir = join(docx, '..', '..', SHEET)
    const xlsx = join(sheetDir, 'Budget.xlsx')
    await ctx.service.store.writeWorkingCopy(sheetDir, 'Budget.xlsx', enc('my xlsx'))
    await ctx.service.store.write(sheetDir, {
      schema: 2,
      documentId: SHEET,
      workspaceId: 'ws_1',
      orgId: 'org_a',
      title: 'Budget.xlsx',
      filename: 'Budget.xlsx',
      format: 'xlsx',
      access: 'edit',
      baseRevision: '7',
      baseVersion: 2,
      baseChecksum: hex(enc('base xlsx')),
      state: 'conflict',
      error: 'conflict',
      serverRevision: '8',
      minStoreLevel: 2,
      minAppVersion: '0.0.0',
    })
    return { server, ctx, docx, xlsx }
  }

  it('a conflict on the non-focused xlsx names the xlsx and targets the xlsx', async () => {
    const { ctx, xlsx } = await twoConflicts()
    const flow = ctx.service.resolveConflict(xlsx)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    expect(ctx.views[0]).toMatchObject({
      path: xlsx,
      documentId: SHEET,
      title: 'Budget.xlsx',
      module: 'sheets',
    })
    await ctx.service.conflictAct(ctx.views[0]!.sessionId, { kind: 'cancel' })
    expect(await flow).toMatchObject({
      path: xlsx,
      state: 'conflict',
    })
  })

  it('a docx dialog still open closes as "Decide later" before the xlsx dialog opens', async () => {
    const { ctx, docx, xlsx } = await twoConflicts()
    const docxFlow = ctx.service.resolveConflict(docx)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    const docxSessionId = ctx.views[0]!.sessionId
    const xlsxFlow = ctx.service.resolveConflict(xlsx)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(2))
    expect(await docxFlow).toMatchObject({ path: docx, state: 'conflict' })
    // the docx dialog answers after it was closed: too late to count
    expect(
      await ctx.service.conflictAct(docxSessionId, { kind: 'overwrite', stopAi: false }),
    ).toEqual({ kind: 'closed' })
    await ctx.service.conflictAct(ctx.views[1]!.sessionId, { kind: 'cancel' })
    expect(await xlsxFlow).toMatchObject({ path: xlsx, state: 'conflict' })
    expect(ctx.views.map((v) => v.title)).toEqual(['Q4 plan.docx', 'Budget.xlsx'])
    expect(binding(docx)).toMatchObject({ state: 'conflict' })
  })

  it('leaving the tab closes its chip dialog; the close prompt dialog stays', async () => {
    const { ctx, docx } = await twoConflicts()
    const flow = ctx.service.resolveConflict(docx)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    const chipSessionId = ctx.views[0]!.sessionId
    ctx.service.noteActivePath(docx.toUpperCase())
    ctx.service.noteActivePath(undefined)
    expect(await flow).toMatchObject({ state: 'conflict' })
    expect(await ctx.service.conflictAct(chipSessionId, { kind: 'cancel' })).toEqual({
      kind: 'closed',
    })
    expect(binding(docx)).toMatchObject({ state: 'conflict' })

    vi.mocked(ctx.ui.chooseUnsavedClose).mockResolvedValueOnce('resolve').mockResolvedValue('close')
    const closing = ctx.service.confirmClose(docx)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(2))
    const closeSessionId = ctx.views[1]!.sessionId
    ctx.service.noteActivePath(undefined)
    await ctx.service.conflictAct(closeSessionId, { kind: 'cancel' })
    expect(await closing).toBe(true)
  })

  it('a second Resolve of the same document does not open a second dialog', async () => {
    const { ctx, xlsx } = await twoConflicts()
    const first = ctx.service.resolveConflict(xlsx)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    expect(await ctx.service.resolveConflict(xlsx)).toMatchObject({ state: 'conflict' })
    expect(ctx.views).toHaveLength(1)
    await ctx.service.conflictAct(ctx.views[0]!.sessionId, { kind: 'cancel' })
    await first
  })

  it('a choice made after the document left conflict is not applied', async () => {
    const { server, ctx, docx } = await twoConflicts()
    const flow = ctx.service.resolveConflict(docx)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    // resolved elsewhere meanwhile (e.g. the close prompt's discard)
    writeFileSync(
      join(docx, '..', BINDING_FILE),
      JSON.stringify({ ...binding(docx), state: 'saved', error: undefined }),
    )
    const before = commits(server).length
    const moduleSaves = ctx.deps.requestModuleSave.mock.calls.length
    await ctx.service.conflictAct(ctx.views[0]!.sessionId, { kind: 'overwrite', stopAi: false })
    expect(await flow).toMatchObject({ state: 'saved' })
    expect(commits(server).length).toBe(before)
    expect(ctx.deps.requestModuleSave).toHaveBeenCalledTimes(moduleSaves)
  })

  it('closing the conflict prompt aborts the open session without modifying the working copy', async () => {
    const { ctx, xlsx } = await twoConflicts()
    const flow = ctx.service.resolveConflict(xlsx)
    await vi.waitFor(() => expect(ctx.views).toHaveLength(1))
    expect(ctx.views[0]).toMatchObject({ title: 'Budget.xlsx', path: xlsx })
    ctx.service.closeConflictPrompt()
    expect(await flow).toMatchObject({ path: xlsx, state: 'conflict' })
    expect(readFileSync(xlsx, 'utf8')).toBe('my xlsx')
    expect(ctx.deps.reloadPath).not.toHaveBeenCalled()
  })
})

/**
 * R1-be-12 (OQ-P4): `min_app_version` is display metadata and carries the core
 * semver - a beta/dev build must not stamp its prerelease tail.
 */
describe('min_app_version is the core semver (R1-be-12)', () => {
  it('a prerelease build stamps the core version into every new binding', async () => {
    const server = fakeServer({ bytes: enc('v3 bytes') })
    const ctx = setup(server, { appVersion: '0.11.0-dev.3' })
    const path = await openDoc(ctx)
    expect(binding(path)).toMatchObject({ schema: 2, min_app_version: '0.11.0' })
  })

  it('a 1.0.0-beta.2 build stamps the core 1.0.0 (beta.2 upgrade path)', async () => {
    const server = fakeServer({ bytes: enc('v3 bytes') })
    const ctx = setup(server, { appVersion: '1.0.0-beta.2' })
    const path = await openDoc(ctx)
    expect(binding(path)).toMatchObject({ schema: 2, min_app_version: '1.0.0' })
  })

  it('strips the prerelease and build metadata, and keeps anything else verbatim', () => {
    expect(coreSemver('0.11.0-beta.9')).toBe('0.11.0')
    expect(coreSemver('0.11.0-dev.3')).toBe('0.11.0')
    expect(coreSemver('1.0.0-beta.2')).toBe('1.0.0')
    expect(coreSemver('1.0.0')).toBe('1.0.0')
    expect(coreSemver('1.2.3+build.7')).toBe('1.2.3')
    expect(coreSemver(' 0.11.0 ')).toBe('0.11.0')
    expect(coreSemver('dev')).toBe('dev')
  })
})

describe('the comments context of a bound copy (G8-12 §3.1)', () => {
  /** the service reads `notifySaved` from its deps at push time */
  function withSavedSpy(ctx: ReturnType<typeof setup>) {
    const notifySaved = vi.fn()
    ;(ctx.deps as Record<string, unknown>).notifySaved = notifySaved
    return notifySaved
  }

  it('a fresh open records the open version id, the level and the signed-in id', async () => {
    const server = fakeServer({ bytes: enc('v3'), myLevel: 'manage' })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    expect(ctx.service.commentContext(path)).toEqual({
      documentId: DOC,
      versionId: 'v3',
      level: 'manage',
      myUserId: 'acc_1',
    })
    expect(binding(path)).toMatchObject({ baseVersionId: 'v3' })
  })

  it('an unbound path, or another account copy, has no context', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    expect(ctx.service.commentContext(join(dir, 'elsewhere.docx'))).toBeNull()
    ctx.signInAs('acc_2')
    expect(ctx.service.commentContext(path)).toBeNull()
  })

  it('switching account and reading commentContext persists last-account.json synchronously with no late write after teardown (EL-1(b) fix8)', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    ctx.signInAs('acc_2')
    expect(ctx.service.commentContext(path)).toBeNull()
    // The new owner must already be persisted synchronously when commentContext returns,
    // and removing the directory immediately must not be raced by a late async write.
    expect(ctx.service.store.readLastOwner()).toEqual({
      accountId: 'acc_2',
      deploymentId: 'default',
    })
    const lastOwnerPath = join(dir, 'uniwork-documents', 'last-account.json')
    rmSync(lastOwnerPath, { force: true })
    for (let i = 0; i < 30; i += 1) {
      await readFile(path)
    }
    expect(existsSync(lastOwnerPath)).toBe(false)
  })

  it('a failed last-account.json write is retried on a later identity observation, not cached as persisted (EL1B-BE-R3-8)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const server = fakeServer({ bytes: enc('v3') })
      const ctx = setup(server)
      const path = await openDoc(ctx)
      const store = ctx.service.store
      const real = store.writeLastOwner.bind(store)
      const write = vi.spyOn(store, 'writeLastOwner').mockImplementationOnce(() => false)
      ctx.signInAs('acc_2')
      expect(ctx.service.commentContext(path)).toBeNull()
      expect(write).toHaveBeenCalledTimes(1)
      expect(store.readLastOwner()).not.toEqual({ accountId: 'acc_2', deploymentId: 'default' })

      // right after the failure nothing hammers the disk again ...
      ctx.service.commentContext(path)
      expect(write).toHaveBeenCalledTimes(1)
      // ... but the next observation after the back-off retries it and persists
      vi.advanceTimersByTime(5_000)
      write.mockImplementation(real)
      ctx.service.commentContext(path)
      expect(write).toHaveBeenCalledTimes(2)
      expect(store.readLastOwner()).toEqual({ accountId: 'acc_2', deploymentId: 'default' })
      // persisted: no further writes for the same owner
      vi.advanceTimersByTime(5_000)
      ctx.service.commentContext(path)
      expect(write).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('the failed-write back-off belongs to the owner that failed: a different owner on a recovered disk is written at once (EL1B-BE-R3C-8)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const server = fakeServer({ bytes: enc('v3') })
      const ctx = setup(server)
      const path = await openDoc(ctx)
      const store = ctx.service.store
      const real = store.writeLastOwner.bind(store)
      const write = vi.spyOn(store, 'writeLastOwner').mockImplementationOnce(() => false)
      ctx.signInAs('acc_2')
      ctx.service.commentContext(path)
      expect(write).toHaveBeenCalledTimes(1)
      expect(store.readLastOwner()).not.toEqual({ accountId: 'acc_2', deploymentId: 'default' })

      // the same failing owner stays throttled ...
      ctx.service.commentContext(path)
      expect(write).toHaveBeenCalledTimes(1)
      // ... but owner C, observed inside B's window on a recovered disk, is not
      write.mockImplementation(real)
      vi.advanceTimersByTime(500)
      ctx.signInAs('acc_3')
      ctx.service.commentContext(path)
      expect(write).toHaveBeenCalledTimes(2)
      expect(store.readLastOwner()).toEqual({ accountId: 'acc_3', deploymentId: 'default' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('a settled Save moves the version id to the receipt and pushes it once', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    const notifySaved = withSavedSpy(ctx)
    writeFileSync(path, 'v4 from desktop')
    expect(await ctx.service.save(path)).toMatchObject({ state: 'saved' })
    expect(ctx.service.commentContext(path)).toMatchObject({ versionId: 'ver_4' })
    expect(notifySaved.mock.calls).toEqual([[path, 'ver_4']])
  })

  it('a receipt settled through the document read takes the document version id', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    const notifySaved = withSavedSpy(ctx)
    writeFileSync(path, 'v4')
    // the receipt omits its checksum: the document itself proves the commit
    server.faults.push({ route: 'commit', kind: 'no-checksum' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'saved' })
    expect(notifySaved.mock.calls).toEqual([[path, 'v4']])
    expect(ctx.service.commentContext(path)).toMatchObject({ versionId: 'v4' })
  })

  it('a 403 save downgrades the level to view, also for a binding written before levels existed', async () => {
    const server = fakeServer({ bytes: enc('v3'), myLevel: 'manage' })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    // an old binding: no `level` field
    const file = join(path, '..', BINDING_FILE)
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    delete raw.level
    writeFileSync(file, JSON.stringify(raw))
    expect(binding(path).level).toBeUndefined()
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'commit', kind: 403, code: 'forbidden' })
    await ctx.service.save(path)
    expect(binding(path)).toMatchObject({ access: 'view', level: 'view' })
    expect(ctx.service.commentContext(path)).toMatchObject({ level: 'view' })
  })

  it('a view-ticket copy caps the comments level at view', async () => {
    const server = fakeServer({ bytes: enc('v3'), myLevel: 'manage' })
    const ctx = setup(server)
    const opened = await ctx.service.openFromServer(DOC, {
      organizationId: 'org_launch',
      workspaceId: 'ws_launch',
      title: 'Q4 plan',
      operation: 'view' as const,
      version: 3,
      revision: '41',
      downloadPath: `/api/v1/documents/${DOC}/download?version=3`,
    } as never)
    expect(binding(opened.path)).toMatchObject({ access: 'view', level: 'view' })
    expect(ctx.service.commentContext(opened.path)).toMatchObject({ level: 'view' })
  })

  it('a view launch without a version caps the comments level at view', async () => {
    const server = fakeServer({ bytes: enc('v3'), myLevel: 'manage' })
    const ctx = setup(server)
    const opened = await ctx.service.openFromServer(DOC, {
      organizationId: 'org_launch',
      workspaceId: 'ws_launch',
      title: 'Q4 plan',
      operation: 'view' as const,
      version: 0,
      revision: '41',
      downloadPath: `/api/v1/documents/${DOC}/download`,
    } as never)
    expect(binding(opened.path)).toMatchObject({ access: 'view', level: 'view' })
    expect(ctx.service.commentContext(opened.path)).toMatchObject({ level: 'view' })
  })

  it('a conflicted or failed Save pushes nothing and keeps the open version', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    const notifySaved = withSavedSpy(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'upload', kind: 'network' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'offline' })
    // someone else saved meanwhile: the replay hits a conflict
    server.state.revision += 1
    expect(await ctx.service.save(path)).toMatchObject({ state: 'conflict' })
    expect(notifySaved).not.toHaveBeenCalled()
    expect(ctx.service.commentContext(path)).toMatchObject({ versionId: 'v3' })
  })

  it('a Save that needs no upload (bytes equal the base) pushes nothing', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    const notifySaved = withSavedSpy(ctx)
    await ctx.service.save(path)
    expect(notifySaved).not.toHaveBeenCalled()
  })
})
