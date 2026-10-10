import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  UniworkConflictChoice,
  UniworkDocStatus,
  UniworkLaunchEvent,
} from '../src/shared/home-api'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import {
  CLOSE_SAVE_WAIT_MS,
  UniworkDocsService,
  type ConflictUi,
  type UnsavedCloseChoice,
} from '../src/main/uniwork-docs/service'
import { BINDING_FILE } from '../src/main/uniwork-docs/binding-store'
import { pageRecentPaths } from '../src/main/recent-files'

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
  route: 'upload' | 'commit' | 'download' | 'detail'
  /** 'no-checksum': the commit lands but its receipt omits version.checksum_sha256 */
  kind: 'lost' | 'network' | 'no-checksum' | number
  code?: string
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
    if (u.pathname === `/api/v1/documents/${DOC}/versions/commit`) {
      const body = JSON.parse(String(init.body)) as { upload_id: string; base_revision: string }
      call.body = body
      const fault = takeFault('commit')
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
  } = {},
) {
  const statuses: UniworkDocStatus[] = []
  const launches: UniworkLaunchEvent[] = []
  let account: string | null = (opts.signedIn ?? true) ? (opts.account ?? 'acc_1') : null
  const ui: ConflictUi = {
    chooseConflict: vi.fn(async () => opts.choice ?? 'later'),
    confirmDiscard: vi.fn(async () => true),
    pickCopyPath: vi.fn(async (stem: string, format: string) =>
      join(dir, `${stem} (my copy).${format}`),
    ),
    showOpenLatestFailed: vi.fn(),
    showCopyFailed: vi.fn(),
    chooseUnsavedClose: vi.fn(async () => opts.closeChoice ?? 'cancel'),
  }
  const deps = {
    userDataDir: dir,
    profile: () => profile,
    identity: () =>
      account ? { accountId: account, deviceSessionId: 'dev_1', deploymentId: 'default' } : null,
    selectedOrgId: () => 'org_a',
    authorized: <T>(call: (token: string) => Promise<T>) => call(TOKEN),
    fetch: server.fetch,
    openPath: vi.fn(() => true),
    isPathOpen: vi.fn(() => false),
    requestModuleSave: vi.fn(() => false),
    reloadPath: vi.fn(),
    activePath: () => undefined,
    ui,
    pushStatus: (s: UniworkDocStatus) => statuses.push(s),
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
    signOut: () => {
      account = null
    },
    signInAs: (id: string) => {
      account = id
    },
  }
}

async function openDoc(ctx: ReturnType<typeof setup>) {
  const opened = await ctx.service.openDocument(DOC)
  if (!opened.ok) throw new Error(opened.error)
  return opened.value.path
}

const uploads = (server: ReturnType<typeof fakeServer>) =>
  server.calls.filter((c) => c.path.endsWith('/uploads'))
const commits = (server: ReturnType<typeof fakeServer>) =>
  server.calls.filter((c) => c.path.endsWith('/versions/commit'))
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
      schema: 1,
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
    expect(binding(path).pendingIntent).toBeTruthy()
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
    expect(binding(path).pendingIntent).toBeUndefined()
    expect(ctx.statuses.map((s) => s.state)).toContain('saving')
  })

  it('persists the intent before the first network call', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    let seen: unknown
    server.fetch.mockImplementationOnce(async () => {
      seen = binding(path).pendingIntent
      throw new TypeError('fetch failed')
    })
    await ctx.service.save(path)
    expect(seen).toMatchObject({ documentId: DOC, baseRevision: '41', checksum: hex(enc('v4')) })
    expect(typeof (seen as { baseRevision: unknown }).baseRevision).toBe('string')
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

  it('a lost commit answer keeps the intent; the next save replays the SAME key and lands once', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'commit', kind: 'lost' })
    const first = await ctx.service.save(path)
    expect(first).toMatchObject({ state: 'offline', error: 'network' })
    const intent = binding(path).pendingIntent
    expect(intent.idempotencyKey).toMatch(/^office-key-/)
    // edits after the failure do not change the replayed payload
    writeFileSync(path, 'v5 typed later')
    const second = await ctx.service.save(path)
    expect(new Set(commits(server).map((c) => c.headers['idempotency-key']))).toEqual(
      new Set([intent.idempotencyKey]),
    )
    expect(server.state.version).toBe(4)
    expect(new TextDecoder().decode(server.state.bytes)).toBe('v4')
    // the file moved on during the failure: saved base, but not "saved"
    expect(second).toMatchObject({ state: 'dirty' })
    expect(binding(path)).toMatchObject({ baseRevision: '42', baseChecksum: hex(enc('v4')) })
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
    expect(binding(path).pendingIntent).toBeUndefined()
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
    expect(ctx.ui.confirmDiscard).toHaveBeenCalled()
    expect(status).toMatchObject({ state: 'saved' })
    expect(readFileSync(path, 'utf8')).toBe('theirs')
    expect(binding(path)).toMatchObject({ baseRevision: '45' })
    expect(ctx.deps.reloadPath).toHaveBeenCalledWith(path)
  })

  it('save-local-copy writes a plain copy and the document stays in conflict', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { choice: 'save-local-copy' })
    const path = await openDoc(ctx)
    server.state.revision = 45
    writeFileSync(path, 'mine')
    await ctx.service.save(path)
    expect(await ctx.service.resolveConflict(path)).toMatchObject({ state: 'conflict' })
    expect(ctx.ui.pickCopyPath).toHaveBeenCalledWith('Q4 plan', 'docx')
    expect(readFileSync(join(dir, 'Q4 plan (my copy).docx'), 'utf8')).toBe('mine')
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
    expect(binding(path).pendingIntent).toBeUndefined()
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
    expect(binding(path).pendingIntent).toBeTruthy()
  })

  it('403 forbidden blocks the save, keeps the file and downgrades access', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'commit', kind: 403, code: 'forbidden' })
    expect(await ctx.service.save(path)).toMatchObject({
      state: 'blocked',
      error: 'forbidden',
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
    expect(binding(path)).toMatchObject({ access: 'edit', state: 'dirty' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'saved' })
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
    for (const call of server.calls) {
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

const flushSaves = () => new Promise((r) => setTimeout(r, 20))

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
    await flushSaves()
    expect(server.calls.length).toBe(before)
    expect(readFileSync(path, 'utf8')).toBe('v4 while signed out')
    expect(binding(path)).toMatchObject({ state: 'signed-out', error: 'not_signed_in' })
    expect(await ctx.service.docStatus(path)).toMatchObject({ state: 'signed-out' })
    // signed in again, Retry sends it
    ctx.signInAs('acc_1')
    expect(await ctx.service.save(path)).toMatchObject({ state: 'saved' })
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
    server.faults.push({ route: 'commit', kind: 410, code: 'document_deleted' })
    server.faults.push({ route: 'detail', kind: 410, code: 'document_deleted' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'blocked', error: 'deleted' })
    // restored from the trash: the reopen answers again
    await openDoc(ctx)
    expect(binding(path)).toMatchObject({ state: 'dirty' })
    expect(binding(path).error).toBeUndefined()
    expect(readFileSync(path, 'utf8')).toBe('v4')
    expect(await ctx.service.save(path)).toMatchObject({ state: 'saved' })
  })

  it('an expired staged upload drops the intent, stays dirty, and the next save mints a new key on the same base (A1.2)', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'commit', kind: 409, code: 'document_upload_invalid' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'dirty', error: 'server_error' })
    expect(binding(path).pendingIntent).toBeUndefined()
    const firstKey = uploads(server)[0]?.headers['idempotency-key']
    expect(await ctx.service.save(path)).toMatchObject({ state: 'saved' })
    const lastCommit = commits(server).at(-1)
    expect(lastCommit?.headers['idempotency-key']).not.toBe(firstKey)
    expect(lastCommit?.body).toMatchObject({ base_revision: '41' })
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
    expect(binding(path).pendingIntent).toBeUndefined()
    expect(readFileSync(path, 'utf8')).toBe('v4')
  })

  it('a replay whose upload is gone settles when an earlier attempt already committed the bytes', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'commit', kind: 'lost' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'offline' })
    server.faults.push({ route: 'commit', kind: 409, code: 'upload_missing' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'saved' })
    expect(binding(path)).toMatchObject({ baseRevision: '42', baseChecksum: hex(enc('v4')) })
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
    expect(binding(path).pendingIntent).toBeTruthy()
  })

  it('a receipt without a checksum is confirmed against the document instead of failing forever (BE-4)', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server)
    const path = await openDoc(ctx)
    writeFileSync(path, 'v4')
    server.faults.push({ route: 'commit', kind: 'no-checksum' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'saved' })
    expect(binding(path)).toMatchObject({ baseRevision: '42', baseVersion: 4 })
    expect(binding(path).pendingIntent).toBeUndefined()
  })

  it('save-local-copy reports a copy that could not be written (BE-6)', async () => {
    const server = fakeServer({ bytes: enc('v3') })
    const ctx = setup(server, { choice: 'save-local-copy' })
    const path = await openDoc(ctx)
    server.state.revision = 45
    writeFileSync(path, 'mine')
    await ctx.service.save(path)
    vi.mocked(ctx.ui.pickCopyPath).mockResolvedValueOnce(join(dir, 'missing-dir', 'copy.docx'))
    await ctx.service.resolveConflict(path)
    expect(ctx.ui.showCopyFailed).toHaveBeenCalledTimes(1)
    // the working copy itself is never a "copy on this computer"
    vi.mocked(ctx.ui.pickCopyPath).mockResolvedValueOnce(path)
    await ctx.service.resolveConflict(path)
    expect(ctx.ui.showCopyFailed).toHaveBeenCalledTimes(2)
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
    expect(binding(path).pendingIntent).toBeTruthy()
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
    expect(ctx.ui.chooseConflict).toHaveBeenCalledTimes(1)
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
    expect(binding(path)).toMatchObject({ state: 'blocked', error: 'deleted' })
    vi.mocked(ctx.deps.requestModuleSave).mockClear()
    expect(await ctx.service.confirmClose(path)).toBe(false)
    expect(ctx.ui.chooseUnsavedClose).toHaveBeenCalledWith('Q4 plan.docx', 'blocked', 'deleted')
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
    expect(await ctx.service.save(path)).toMatchObject({ state: 'offline' })
    const intent = binding(path).pendingIntent
    const writes = reserializingModule(ctx)
    vi.mocked(ctx.deps.requestModuleSave).mockClear()

    const retried = await ctx.service.save(path)
    expect(ctx.deps.requestModuleSave).not.toHaveBeenCalled()
    expect(writes()).toBe(0)
    expect(retried).toMatchObject({ state: 'saved' })
    expect(retried?.error).toBeUndefined()
    expect(binding(path)).toMatchObject({ state: 'saved', baseChecksum: hex(enc('v4')) })
    expect(binding(path).pendingIntent).toBeUndefined()
    expect(new Set(commits(server).map((c) => c.headers['idempotency-key']))).toEqual(
      new Set([intent.idempotencyKey]),
    )
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
    expect(binding(path).pendingIntent).toBeUndefined()
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
    server.faults.push({ route: 'commit', kind: 'lost' })
    expect(await ctx.service.save(path)).toMatchObject({ state: 'offline' })
    const intent = binding(path).pendingIntent
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
