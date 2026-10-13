import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkDocSummary, UniworkDocStatus } from '../src/shared/home-api'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'
import { BINDING_FILE } from '../src/main/uniwork-docs/binding-store'
import type { FetchLike } from '../src/main/uniwork-docs/client'

/**
 * G8-17 S18: create a blank document, upload a file, rename, archive / restore
 * — the main-process half. The D routes are the ones contract-G8-17-ipc.md §4
 * cites; these tests drive the real HTTP client against a small fake server and
 * assert the calls, the one-document rule, the `my_level` gate and the name
 * errors the renderer shows at the field.
 */

const ORIGIN = 'https://uniwork.example'
const profile: DeploymentProfile = {
  deploymentId: 'default',
  apiOrigin: ORIGIN,
  clientId: 'uniwork-office',
  channel: 'stable',
}
const TOKEN = 'tok'
const WS = 'ws_1'
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const envelope = (status: number, code: string) => json(status, { error: { code, message: 'x' } })
const enc = (text: string) => new TextEncoder().encode(text)

interface Call {
  method: string
  path: string
  query: string
  idempotencyKey: string
  body?: unknown
}

/** a small UniWork documents server: create blank/upload, rename, archive/restore, folders */
function fakeServer(
  options: {
    myLevel?: string
    bytes?: Uint8Array
    title?: string
    /** a conflict on create/rename: the name is taken */
    nameTaken?: boolean
    /** a conflict on archive/restore */
    lifecycleConflict?: boolean
  } = {},
) {
  const state = {
    id: DOC,
    title: options.title ?? 'Q4 plan.docx',
    myLevel: options.myLevel ?? 'manage',
    bytes: options.bytes ?? enc('v1 bytes'),
    archived: false,
    revision: 41,
    /** every document the server now holds, by id */
    documents: new Map<string, { title: string; bytes: Uint8Array }>(),
  }
  const calls: Call[] = []
  let seq = 0

  const docJson = (id: string) => ({
    id,
    organization_id: 'org_a',
    workspace_id: WS,
    title: id === DOC ? state.title : (state.documents.get(id)?.title ?? 'new.docx'),
    kind: 'file',
    revision: String(state.revision),
    current_version: 1,
    my_level: state.myLevel,
    ...(state.archived && id === DOC ? { archived_at: '2026-10-13T09:00:00Z' } : {}),
    file: {
      file_id: `f_${id}`,
      version_id: `v_${id}`,
      version: 1,
      filename: state.title,
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size_bytes: (id === DOC ? state.bytes : (state.documents.get(id)?.bytes ?? enc('x')))
        .byteLength,
      checksum_sha256: hex(id === DOC ? state.bytes : (state.documents.get(id)?.bytes ?? enc('x'))),
    },
  })

  const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    const u = new URL(url)
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    )
    const call: Call = {
      method: init.method ?? 'GET',
      path: u.pathname,
      query: u.search,
      idempotencyKey: headers['idempotency-key'] ?? '',
    }
    calls.push(call)

    // create blank
    if (u.pathname === `/api/v1/workspaces/${WS}/documents/files/blank`) {
      call.body = JSON.parse(String(init.body))
      if (options.nameTaken) return envelope(409, 'conflict')
      const id = `new_${++seq}`
      const title = (call.body as { title: string }).title
      state.documents.set(id, { title, bytes: enc('blank') })
      return json(201, { document: { ...docJson(id), title } })
    }
    // upload (multipart)
    if (u.pathname === `/api/v1/workspaces/${WS}/documents/files`) {
      const form = init.body as FormData
      const file = form.get('file') as File
      const bytes = new Uint8Array(await file.arrayBuffer())
      call.body = {
        title: form.get('title'),
        parent_id: form.get('parent_id'),
        name: file.name,
        bytes,
      }
      const id = `up_${++seq}`
      state.documents.set(id, { title: file.name, bytes })
      return json(201, { document: { ...docJson(id), title: file.name } })
    }
    // recent (the flat library list without a search query)
    if (u.pathname === `/api/v1/workspaces/${WS}/documents/recent`) {
      return json(200, {
        documents: [
          {
            id: DOC,
            kind: 'file',
            title: state.title,
            workspace_id: WS,
            updated_at: '2026-10-13T09:00:00Z',
            my_level: state.myLevel,
          },
        ],
        next_cursor: null,
      })
    }
    // folders
    if (u.pathname === `/api/v1/workspaces/${WS}/documents`) {
      return json(200, {
        documents: [
          { id: 'fold_1', kind: 'folder', title: 'Contracts' },
          { id: 'doc_x', kind: 'file', title: 'ignored.docx' },
        ],
        next_cursor: null,
      })
    }
    // archive / restore
    if (u.pathname === `/api/v1/documents/${DOC}/archive`) {
      if (options.lifecycleConflict) return envelope(409, 'conflict')
      state.archived = true
      return json(200, { document: docJson(DOC), affected: [DOC] })
    }
    if (u.pathname === `/api/v1/documents/${DOC}/restore`) {
      state.archived = false
      return json(200, { document: docJson(DOC), affected: [DOC] })
    }
    // rename (PATCH)
    if (u.pathname === `/api/v1/documents/${DOC}` && call.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as { revision: string; title: string }
      call.body = body
      if (options.nameTaken) return envelope(409, 'conflict')
      if (body.revision !== String(state.revision)) {
        return json(422, {
          error: {
            code: 'revision_conflict',
            message: 'x',
            fields: { current_revision: String(state.revision) },
          },
        })
      }
      state.title = body.title
      state.revision += 1
      return json(200, { document: docJson(DOC) })
    }
    // detail: any document the server holds. D's decideDocumentAccess hides an
    // archived row from anyone below manage (404), while a manager still reads
    // it with its archived_at.
    const detail = /^\/api\/v1\/documents\/([A-Za-z0-9_-]+)$/.exec(u.pathname)
    if (detail && call.method === 'GET') {
      const id = detail[1]!
      if (id !== DOC && !state.documents.has(id)) return envelope(404, 'not_found')
      if (state.archived && id === DOC && state.myLevel !== 'manage') {
        return envelope(404, 'not_found')
      }
      return json(200, { document: docJson(id) })
    }
    // download (the open flow): the bytes of the requested document
    const download = /^\/api\/v1\/documents\/([A-Za-z0-9_-]+)\/download$/.exec(u.pathname)
    if (download) {
      const id = download[1]!
      const bytes = id === DOC ? state.bytes : (state.documents.get(id)?.bytes ?? enc('x'))
      return new Response(bytes as BodyInit, { status: 200 })
    }
    return envelope(404, 'not_found')
  })

  return { state, calls, fetch: fetch as unknown as FetchLike }
}

/** the server reports sha256 hex; the client compares it against the bytes it downloaded */
function hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-docs-actions-'))
})
afterEach(() => {
  // a fire-and-forget atomic write from a test can still be landing when the
  // temp dir is removed (the write's temp file appears between the recursive
  // walk and the rmdir): retry instead of racing it (F4)
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

function setup(server: ReturnType<typeof fakeServer>, options: { pathOpen?: boolean } = {}) {
  const statuses: UniworkDocStatus[] = []
  const renamed: Array<{ documentId: string; title: string }> = []
  const progress: Array<{ path: string; loaded: number; total: number }> = []
  const pathRenames: Array<{ oldPath: string; newPath: string }> = []
  const titleRenames: Array<{ path: string; title: string }> = []
  const uploadFile = join(dir, 'Q3 report.docx')
  writeFileSync(uploadFile, 'uploaded bytes')
  const ui: ConflictUi = {
    chooseConflict: vi.fn(async () => 'later'),
    confirmDiscard: vi.fn(async () => false),
    pickCopyPath: vi.fn(async () => null),
    showOpenLatestFailed: vi.fn(),
    showCopyFailed: vi.fn(),
    chooseUnsavedClose: vi.fn(async () => 'cancel'),
  }
  const service = new UniworkDocsService({
    userDataDir: dir,
    appVersion: () => '0.0.0',
    profile: () => profile,
    channel: () => 'stable',
    applyProfile: async () => 'unchanged',
    identity: () => ({ accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }),
    keystoreLocked: () => false,
    selectedOrg: () => ({ id: 'org_a', slug: 'acme' }),
    authorized: <T>(call: (token: string) => Promise<T>) => call(TOKEN),
    fetch: server.fetch,
    openPath: () => true,
    isPathOpen: () => options.pathOpen === true,
    requestModuleSave: () => false,
    reloadPath: () => undefined,
    activePath: () => undefined,
    pickUploadFile: async () => ({ path: uploadFile, name: basename(uploadFile) }),
    pushUploadProgress: (event) => progress.push(event),
    pushDocRenamed: (event) => renamed.push(event),
    notifyPathRenamed: (oldPath, newPath) => pathRenames.push({ oldPath, newPath }),
    notifyTitleRenamed: (path, title) => titleRenames.push({ path, title }),
    ui,
    pushStatus: (s) => statuses.push(s),
    pushLaunch: () => undefined,
    reveal: () => undefined,
  })
  return { service, statuses, renamed, progress, pathRenames, titleRenames, uploadFile }
}

const docDir = (documentId: string): string =>
  join(dir, 'uniwork-documents', 'default', 'acc_1', documentId)

/** the document files of one working-copy folder (binding.json excluded) */
const copiesIn = (documentId: string): string[] =>
  readdirSync(docDir(documentId)).filter((name) => name !== BINDING_FILE)

const binding = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(path, '..', BINDING_FILE), 'utf8')) as Record<string, unknown>

describe('create a blank document', () => {
  it('creates one document and opens it by id, with one local copy bound to that same file', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const created = await ctx.service.createDocument({
      workspaceId: WS,
      folderId: null,
      name: 'Q4 plan',
      format: 'docx',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const id = created.value.id
    expect(created.value.title).toBe('Q4 plan')
    // exactly the blank route, with the name and no parent
    const blank = server.calls.find((c) => c.path.endsWith('/documents/files/blank'))!
    expect(blank.method).toBe('POST')
    expect(blank.body).toMatchObject({ format: 'docx', title: 'Q4 plan' })
    expect(blank.idempotencyKey).not.toBe('')

    // the library opens the new document by its id through the one open flow
    const opened = await ctx.service.openDocument(id)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    // one document, one local copy: the binding points at the file just downloaded
    const copies = copiesIn(id)
    expect(copies).toHaveLength(1)
    expect(opened.value.path).toBe(join(docDir(id), copies[0]!))
    expect(binding(opened.value.path)).toMatchObject({ documentId: id, state: 'ready' })
  })

  it('refuses an empty (trimmed) name before any request', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const result = await ctx.service.createDocument({
      workspaceId: WS,
      folderId: null,
      name: '   ',
      format: 'docx',
    })
    expect(result).toEqual({ ok: false, error: 'name_empty' })
    expect(server.calls).toHaveLength(0)
  })

  it('maps a server conflict on the name to name_taken', async () => {
    const server = fakeServer({ nameTaken: true })
    const ctx = setup(server)
    const result = await ctx.service.createDocument({
      workspaceId: WS,
      folderId: null,
      name: 'Q4 plan',
      format: 'docx',
    })
    expect(result).toEqual({ ok: false, error: 'name_taken' })
  })
})

describe('upload a file', () => {
  it('uploads the local bytes as one document, then opens it by id (no second copy)', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const picked = await ctx.service.pickUploadFile()
    expect(picked).toEqual({ path: ctx.uploadFile, name: 'Q3 report.docx' })

    const uploaded = await ctx.service.uploadDocument({
      workspaceId: WS,
      folderId: 'fold_1',
      path: picked!.path,
    })
    expect(uploaded.ok).toBe(true)
    if (!uploaded.ok) return
    const id = uploaded.value.id
    const call = server.calls.find((c) => c.path.endsWith('/documents/files'))!
    expect(call.method).toBe('POST')
    const body = call.body as { title: string; parent_id: string; name: string }
    expect(body.title).toBe('Q3 report.docx')
    expect(body.parent_id).toBe('fold_1')
    expect(body.name).toBe('Q3 report.docx')

    const opened = await ctx.service.openDocument(id)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(copiesIn(id)).toHaveLength(1)
    expect(binding(opened.value.path)).toMatchObject({ documentId: id })
    // progress: a start event and a final one, both for the picked path
    expect(ctx.progress[0]).toMatchObject({ path: ctx.uploadFile, loaded: 0 })
    expect(ctx.progress[0]!.total).toBe(enc('uploaded bytes').byteLength)
    expect(ctx.progress.at(-1)).toMatchObject({ path: ctx.uploadFile })
    expect(ctx.progress.at(-1)!.loaded).toBe(enc('uploaded bytes').byteLength)
  })
})

describe('folders', () => {
  it('lists only the folder rows of the workspace', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const folders = await ctx.service.listFolders(WS)
    expect(folders).toEqual({ ok: true, value: [{ id: 'fold_1', title: 'Contracts' }] })
    const call = server.calls.find((c) => c.path === `/api/v1/workspaces/${WS}/documents`)!
    expect(call.query).toContain('kind=folder')
  })
})

describe('rename, archive and restore', () => {
  it('renames with the current revision and follows the working copy on disk', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    const before = opened.value.path

    const renamed = await ctx.service.renameDocument(DOC, 'Q4 plan v2.docx')
    expect(renamed.ok).toBe(true)
    const call = server.calls.find((c) => c.method === 'PATCH')!
    expect(call.body).toEqual({ revision: '41', title: 'Q4 plan v2.docx' })
    // the open copy followed: its binding and its file name carry the new title
    const after = join(docDir(DOC), 'Q4 plan v2.docx')
    expect(binding(after)).toMatchObject({ title: 'Q4 plan v2.docx', filename: 'Q4 plan v2.docx' })
    expect(copiesIn(DOC)).toEqual(['Q4 plan v2.docx'])
    expect(ctx.pathRenames).toContainEqual({ oldPath: before, newPath: after })
    // a rename this service made is not re-announced to the renderer
    expect(ctx.renamed).toHaveLength(0)
  })

  it('refuses an empty name before any request', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const result = await ctx.service.renameDocument(DOC, '  ')
    expect(result).toEqual({ ok: false, error: 'name_empty' })
    expect(server.calls).toHaveLength(0)
  })

  it('maps a server conflict on the new name to name_taken', async () => {
    const server = fakeServer({ nameTaken: true })
    const ctx = setup(server)
    const result = await ctx.service.renameDocument(DOC, 'Taken.docx')
    expect(result).toEqual({ ok: false, error: 'name_taken' })
  })

  it('archives and restores through the lifecycle routes, never a delete', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const archived = await ctx.service.archiveDocument(DOC)
    expect(archived.ok).toBe(true)
    const restore = await ctx.service.restoreDocument(DOC)
    expect(restore.ok).toBe(true)
    expect(server.calls.map((c) => c.path)).toEqual([
      `/api/v1/documents/${DOC}`,
      `/api/v1/documents/${DOC}/archive`,
      `/api/v1/documents/${DOC}`,
      `/api/v1/documents/${DOC}/restore`,
    ])
    // no DELETE ever leaves main
    expect(server.calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  // F6: restore reads GET /documents/{id} first. D answers a manager 200 with
  // the archived row (only a below-manage caller gets 404), so the restore of a
  // manager's own archived document works; this pins that against the mirror.
  it('restores a manager own archived document, whose GET still answers 200', async () => {
    const server = fakeServer({ myLevel: 'manage' })
    const ctx = setup(server)
    expect((await ctx.service.archiveDocument(DOC)).ok).toBe(true)
    const restore = await ctx.service.restoreDocument(DOC)
    expect(restore.ok).toBe(true)
    if (!restore.ok) return
    expect(restore.value.archived).toBe(false)
    expect(server.calls.map((c) => c.path)).toEqual([
      `/api/v1/documents/${DOC}`,
      `/api/v1/documents/${DOC}/archive`,
      `/api/v1/documents/${DOC}`,
      `/api/v1/documents/${DOC}/restore`,
    ])
  })

  // the below-manage case D hides with a 404: the restore stops at the detail
  // read, so no lifecycle write ever leaves main
  it('refuses a restore when the archived document reads not_found for the caller', async () => {
    const server = fakeServer({ myLevel: 'edit' })
    const ctx = setup(server)
    server.state.archived = true
    const restore = await ctx.service.restoreDocument(DOC)
    expect(restore).toEqual({ ok: false, error: 'not_found' })
    expect(server.calls.map((c) => c.path)).toEqual([`/api/v1/documents/${DOC}`])
    expect(server.calls.some((c) => c.path.endsWith('/restore'))).toBe(false)
  })
})

describe('my_level gating', () => {
  it('refuses every action on a view-only document without a write request', async () => {
    const server = fakeServer({ myLevel: 'view' })
    const ctx = setup(server)
    expect(await ctx.service.renameDocument(DOC, 'Nope.docx')).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(await ctx.service.archiveDocument(DOC)).toEqual({ ok: false, error: 'forbidden' })
    expect(await ctx.service.restoreDocument(DOC)).toEqual({ ok: false, error: 'forbidden' })
    // only the detail reads that decide the level; no PATCH/archive/restore
    expect(server.calls.every((c) => c.method === 'GET')).toBe(true)
  })

  it('lets an edit-level row rename but not archive', async () => {
    const server = fakeServer({ myLevel: 'edit' })
    const ctx = setup(server)
    expect((await ctx.service.renameDocument(DOC, 'Q4 v2.docx')).ok).toBe(true)
    expect(await ctx.service.archiveDocument(DOC)).toEqual({ ok: false, error: 'forbidden' })
  })

  it('carries the row action flags on every list row', async () => {
    const server = fakeServer({ myLevel: 'edit' })
    const ctx = setup(server)
    const page = await ctx.service.listDocuments({ workspaceId: WS })
    expect(page.ok).toBe(true)
    if (!page.ok) return
    const row: UniworkDocSummary = page.value.documents[0]!
    expect(row.canEdit).toBe(true)
    expect(row.canManage).toBe(false)
    expect(row.archived).toBe(false)
  })
})

/**
 * Renamed elsewhere (S18). Two shapes: the document is NOT open (no tab holds
 * it), so the working copy is renamed on disk and the shell re-keys; and the
 * document IS open (F1), so the copy keeps its name and the tab is re-titled by
 * path. Each shape's tests pin one of them, so a fix for the open case cannot
 * quietly break the closed one.
 */
describe('renamed elsewhere', () => {
  it('a feed change for a closed document follows the title, renames the file and announces it', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    const before = opened.value.path

    // the web renamed it; the server now answers the new title
    server.state.title = 'Renamed on web.docx'
    ctx.service.noteFeedChange(DOC)
    await vi.waitFor(() => expect(ctx.renamed).toHaveLength(1))

    expect(ctx.renamed[0]).toEqual({ documentId: DOC, title: 'Renamed on web.docx' })
    const after = join(docDir(DOC), 'Renamed on web.docx')
    expect(binding(after)).toMatchObject({ title: 'Renamed on web.docx' })
    expect(ctx.pathRenames).toContainEqual({ oldPath: before, newPath: after })
    // the status push carries the new title
    expect(ctx.statuses.at(-1)).toMatchObject({ title: 'Renamed on web.docx' })
  })

  it('a rename this service made itself is not re-announced when the feed echoes it', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    await ctx.service.openDocument(DOC)
    await ctx.service.renameDocument(DOC, 'Mine.docx')
    ctx.service.noteFeedChange(DOC)
    // the feed echo is skipped: no second announce for our own rename
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(ctx.renamed).toHaveLength(0)
  })

  it('leaves a document with local work alone', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    // the person edited the copy: it is dirty, so a rename elsewhere must not touch it
    writeFileSync(opened.value.path, 'local edits not saved')
    await ctx.service.refreshPath(opened.value.path)
    server.state.title = 'Renamed on web.docx'
    await ctx.service.refreshMetadataFor(DOC)
    expect(binding(opened.value.path)).toMatchObject({ title: 'Q4 plan.docx' })
    expect(ctx.renamed).toHaveLength(0)
  })

  it('focus refresh picks up a title change without the feed (closed document)', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    server.state.title = 'Renamed on web.docx'
    await ctx.service.refreshPath(opened.value.path)
    await vi.waitFor(() => expect(ctx.renamed).toHaveLength(1))
    expect(ctx.renamed[0]!.title).toBe('Renamed on web.docx')
  })

  // F1: the document is OPEN in a tab, so its working copy keeps its file name
  // (Windows refuses a rename under an open handle). The tab title and the
  // editor must still follow the rename; today neither does.
  it('a feed change re-titles an open tab without moving its file', async () => {
    const server = fakeServer()
    const ctx = setup(server, { pathOpen: true })
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    const before = opened.value.path

    server.state.title = 'Renamed on web.docx'
    ctx.service.noteFeedChange(DOC)
    await vi.waitFor(() => expect(ctx.renamed).toHaveLength(1))

    // the tab/window is re-titled by path, and the editor is told (file.renamed)
    expect(ctx.titleRenames).toContainEqual({ path: before, title: 'Renamed on web.docx' })
    expect(ctx.renamed[0]).toEqual({ documentId: DOC, title: 'Renamed on web.docx' })
    // the file is NOT moved under the open editor: it keeps its name on disk
    expect(copiesIn(DOC)).toEqual(['Q4 plan.docx'])
    expect(binding(before)).toMatchObject({
      title: 'Renamed on web.docx',
      filename: 'Q4 plan.docx',
    })
    expect(ctx.pathRenames).toHaveLength(0)
    // the status push carries the new title
    expect(ctx.statuses.at(-1)).toMatchObject({ title: 'Renamed on web.docx' })
  })

  it('focus refresh re-titles an open tab without the feed', async () => {
    const server = fakeServer()
    const ctx = setup(server, { pathOpen: true })
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    const before = opened.value.path

    server.state.title = 'Renamed on web.docx'
    await ctx.service.refreshPath(before)
    await vi.waitFor(() => expect(ctx.titleRenames).toHaveLength(1))

    expect(ctx.titleRenames[0]).toEqual({ path: before, title: 'Renamed on web.docx' })
    expect(copiesIn(DOC)).toEqual(['Q4 plan.docx'])
    expect(ctx.pathRenames).toHaveLength(0)
  })
})
