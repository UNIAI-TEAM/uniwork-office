import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkDocSummary, UniworkDocStatus } from '../src/shared/home-api'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'
import { BINDING_FILE, LAST_OWNER_FILE } from '../src/main/uniwork-docs/binding-store'
import type { FetchLike } from '../src/main/uniwork-docs/client'
import { UPLOAD_EXTENSIONS } from '../src/main/uniwork-docs/formats'

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

/**
 * R2-1: an upload must be cancellable while its file is still being stat'ed, so
 * the service registers the upload's AbortController before that await. The
 * test below holds `stat` open to land the Cancel inside it; with the gate
 * unset this mock is the real module.
 */
const statGate = vi.hoisted(() => ({
  held: null as Promise<void> | null,
  entered: null as (() => void) | null,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    stat: vi.fn(async (...args: Parameters<typeof actual.stat>) => {
      statGate.entered?.()
      if (statGate.held) await statGate.held
      return actual.stat(...args)
    }),
    readFile: vi.fn(async (...args: Parameters<typeof actual.readFile>) =>
      actual.readFile(...args),
    ),
  }
})

/** a one-shot latch: `reached` fires when the code hits it, `release` opens it */
function latch() {
  let release: () => void = () => undefined
  let entered: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const reached = new Promise<void>((resolve) => {
    entered = resolve
  })
  return { held, release, reached, entered }
}

afterEach(() => {
  statGate.held = null
  statGate.entered = null
})

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
    /** a 409 `conflict` on create/rename (never a name error: duplicate names are allowed) */
    nameTaken?: boolean
    /** D's bare 400 `invalid_request` for a title over 500 runes, on create/rename */
    nameRefused?: boolean
    /** a conflict on archive/restore */
    lifecycleConflict?: boolean
    /** D's `my_level` is omitempty: absent on a row the caller may not edit (default view) */
    omitMyLevel?: boolean
    /** an older row without the `file` block (omitempty): the title extension decides */
    omitListFile?: boolean
    /**
     * holds the upload POST open until it settles, so a test can cancel a
     * request already in flight (the abort rejects it, as real fetch does)
     */
    uploadGate?: () => Promise<void>
    /** FD-11: the kind the document rows answer with (a folder has no file block in spirit) */
    kind?: 'file' | 'folder' | 'page'
    /** FD-11: D's 409 `folder_name_taken` on create/rename of a folder */
    folderNameTaken?: boolean
    /**
     * FD-11: D's 422 `document_too_deep` on a folder create; a number/string is
     * the envelope's `max`, null omits it (the app then uses the server default)
     */
    deepMax?: number | string | null
    /** FD-11: a move whose target already holds the name renames the entry "Name (2)" */
    moveRenames?: boolean
  } = {},
) {
  const state = {
    id: DOC,
    title: options.title ?? 'Q4 plan.docx',
    kind: options.kind ?? 'file',
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
    kind: state.kind,
    revision: String(state.revision),
    current_version: 1,
    ...(options.omitMyLevel ? {} : { my_level: state.myLevel }),
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
      if (options.nameRefused) return envelope(400, 'invalid_request')
      const id = `new_${++seq}`
      const title = (call.body as { title: string }).title
      state.documents.set(id, { title, bytes: enc('blank') })
      // D stores the title verbatim while the first version's file is
      // untitled.<format>, so a name without an extension must not decide the row
      return json(201, {
        document: {
          ...docJson(id),
          title,
          file: { ...docJson(id).file, filename: 'untitled.docx' },
        },
      })
    }
    // upload (multipart)
    if (u.pathname === `/api/v1/workspaces/${WS}/documents/files`) {
      // an in-flight request a test cancels mid-POST: fetch rejects an aborted
      // signal, the body never being read here
      if (options.uploadGate) {
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            const error = new Error('The operation was aborted.')
            error.name = 'AbortError'
            reject(error)
          }
          if (init.signal?.aborted) abort()
          else init.signal?.addEventListener('abort', abort, { once: true })
          options.uploadGate!().then(resolve, reject)
        })
      }
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
            // D's DocumentDTO carries the file block on every kind=file row
            ...(options.omitListFile ? {} : { file: docJson(DOC).file }),
          },
        ],
        next_cursor: null,
      })
    }
    // folders
    if (u.pathname === `/api/v1/workspaces/${WS}/documents`) {
      // FD-11: create one folder (or refuse it with the server's own code)
      if (call.method === 'POST') {
        const body = JSON.parse(String(init.body)) as {
          kind?: string
          title?: string
          parent_id?: string
        }
        call.body = body
        if (options.folderNameTaken) return envelope(409, 'folder_name_taken')
        if (options.deepMax !== undefined) {
          return json(422, {
            error: {
              code: 'document_too_deep',
              message: 'x',
              ...(options.deepMax === null ? {} : { fields: { max: options.deepMax } }),
            },
          })
        }
        const id = `fold_${++seq}`
        state.documents.set(id, { title: body.title ?? 'folder', bytes: enc('') })
        return json(201, {
          document: {
            ...docJson(id),
            kind: 'folder',
            title: body.title ?? 'folder',
            parent_id: body.parent_id ?? null,
          },
        })
      }
      return json(200, {
        documents: [
          {
            id: 'fold_1',
            kind: 'folder',
            title: 'Contracts',
            updated_at: '2026-10-13T09:00:00Z',
          },
          {
            id: 'doc_x',
            kind: 'file',
            title: 'ignored.docx',
            updated_at: '2026-10-13T09:00:00Z',
          },
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
      if (options.nameRefused) return envelope(400, 'invalid_request')
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
    // FD-11: move a document or folder (the client reads its revision first)
    const move = /^\/api\/v1\/documents\/([A-Za-z0-9_-]+)\/move$/.exec(u.pathname)
    if (move) {
      const id = move[1]!
      // the fake trusts its own caller's body, like every other route here
      const body: { parent_id: string | null; revision: string } = JSON.parse(String(init.body))
      call.body = body
      if (options.folderNameTaken) return envelope(409, 'folder_name_taken')
      const title = id === DOC ? state.title : (state.documents.get(id)?.title ?? 'new.docx')
      // a name already taken in the target folder is auto-renamed by the server
      const renamed = options.moveRenames ? `${title} (2)` : title
      if (id === DOC) state.title = renamed
      state.revision += 1
      return json(200, {
        document: { ...docJson(id), title: renamed, parent_id: body.parent_id },
      })
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
  // The service remembers the live session's account with a fire-and-forget
  // atomic write of last-account.json (`liveIdentity`). Seeding it as the
  // session already having been remembered removes that background write
  // entirely, so nothing can recreate the fixture directory while it is being
  // removed (R1-13) - the write raced the recursive walk and its rmdir.
  mkdirSync(join(dir, 'uniwork-documents'), { recursive: true })
  writeFileSync(
    join(dir, 'uniwork-documents', LAST_OWNER_FILE),
    JSON.stringify({ accountId: 'acc_1', deploymentId: 'default' }),
  )
})
afterEach(async () => {
  // No fixture write is outstanding by design (see above); the retry still
  // absorbs a late atomic write from a service call the test did not await
  // (a feed notice, a focus refresh), whose temp file could otherwise appear
  // between the recursive walk and the rmdir (F4's race, R1-13)
  for (let attempt = 0; ; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt >= 20) throw error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
})

function setup(server: ReturnType<typeof fakeServer>, options: { pathOpen?: boolean } = {}) {
  const statuses: UniworkDocStatus[] = []
  const renamed: Array<{ documentId: string; title: string }> = []
  const progress: Array<{ path: string; loaded: number; total: number }> = []
  const pathRenames: Array<{ oldPath: string; newPath: string }> = []
  const titleRenames: Array<{ path: string; title: string }> = []
  /** FD-11: the tree-changed notices main pushed while the test ran */
  const treeChanged: Array<{ workspaceId: string }> = []
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
  let currentIdentity: {
    accountId: string
    deviceSessionId: string
    deploymentId: string
  } | null = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
  const service = new UniworkDocsService({
    userDataDir: dir,
    appVersion: () => '0.0.0',
    profile: () => profile,
    channel: () => 'stable',
    applyProfile: async () => 'unchanged',
    identity: () => currentIdentity,
    keystoreLocked: () => false,
    selectedOrg: () => ({ id: 'org_a', slug: 'acme' }),
    authorized: <T>(call: (token: string) => Promise<T>) => call(TOKEN),
    fetch: (url, init) => server.fetch(url, init),
    openPath: () => true,
    isPathOpen: () => options.pathOpen === true,
    requestModuleSave: () => false,
    reloadPath: () => undefined,
    activePath: () => undefined,
    pickUploadFile: async () => ({ path: uploadFile, name: basename(uploadFile) }),
    pushUploadProgress: (event) => progress.push(event),
    pushDocRenamed: (event) => renamed.push(event),
    pushTreeChanged: (event) => treeChanged.push(event),
    notifyPathRenamed: (oldPath, newPath) => pathRenames.push({ oldPath, newPath }),
    notifyTitleRenamed: (path, title) => titleRenames.push({ path, title }),
    ui,
    pushStatus: (s) => statuses.push(s),
    pushLaunch: () => undefined,
    reveal: () => undefined,
  })
  return {
    service,
    statuses,
    renamed,
    progress,
    pathRenames,
    titleRenames,
    uploadFile,
    treeChanged,
    setIdentity: (next: typeof currentIdentity) => {
      currentIdentity = next
    },
  }
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

  // R1-2: D keeps the typed title verbatim and its list rows carry only that
  // title, so an extensionless name must not decide the format: the row renders
  // as unsupported and the created document cannot be opened. The file block of
  // the create answer is the name that always carries the extension.
  it('derives the created format from the file block, not an extensionless title', async () => {
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
    expect(created.value.title).toBe('Q4 plan')
    expect(created.value.format).toBe('docx')
    expect(created.value.canEdit).toBe(true)
    expect(created.value.canManage).toBe(true)

    // the library row for the same document is openable (format !== null)
    const page = await ctx.service.listDocuments({ workspaceId: WS })
    expect(page.ok).toBe(true)
    if (!page.ok) return
    expect(page.value.documents[0]!.format).toBe('docx')
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

  it('sends a duplicate name: duplicates are allowed, no name error', async () => {
    const server = fakeServer({ title: 'Q4 plan.docx' })
    const ctx = setup(server)
    const input = { workspaceId: WS, folderId: null, name: 'Q4 plan.docx', format: 'docx' } as const
    const first = await ctx.service.createDocument(input)
    const second = await ctx.service.createDocument(input)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    const blanks = server.calls.filter((c) => c.path.endsWith('/documents/files/blank'))
    expect(blanks).toHaveLength(2)
    expect(blanks[1]!.body).toMatchObject({ title: 'Q4 plan.docx' })
  })

  it('refuses a name over 500 runes before any request, counting runes not UTF-16 units', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const create = (name: string) =>
      ctx.service.createDocument({ workspaceId: WS, folderId: null, name, format: 'docx' })
    // 501 astral characters are 1002 UTF-16 units, 500 of them are still allowed
    expect(await create('😀'.repeat(501))).toEqual({ ok: false, error: 'name_too_long' })
    expect(server.calls).toHaveLength(0)
    expect((await create('😀'.repeat(500))).ok).toBe(true)
    expect(await create('a'.repeat(501))).toEqual({ ok: false, error: 'name_too_long' })
  })

  it("maps D's 400 for a refused title to name_too_long", async () => {
    const server = fakeServer({ nameRefused: true })
    const ctx = setup(server)
    const result = await ctx.service.createDocument({
      workspaceId: WS,
      folderId: null,
      name: 'Q4 plan',
      format: 'docx',
    })
    expect(result).toEqual({ ok: false, error: 'name_too_long' })
  })

  it('treats a server 409 on create as an ordinary failure, not a name error', async () => {
    const server = fakeServer({ nameTaken: true })
    const ctx = setup(server)
    const result = await ctx.service.createDocument({
      workspaceId: WS,
      folderId: null,
      name: 'Q4 plan',
      format: 'docx',
    })
    expect(result).toEqual({ ok: false, error: 'server_error' })
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
      uploadId: 'up-1',
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
    // progress: a start event and a final one, both for the picked path and the
    // upload they belong to (the dialog filters by uploadId)
    expect(ctx.progress[0]).toMatchObject({ uploadId: 'up-1', path: ctx.uploadFile, loaded: 0 })
    expect(ctx.progress[0]!.total).toBe(enc('uploaded bytes').byteLength)
    expect(ctx.progress.at(-1)).toMatchObject({ uploadId: 'up-1', path: ctx.uploadFile })
    expect(ctx.progress.at(-1)!.loaded).toBe(enc('uploaded bytes').byteLength)
  })

  // R1-10: D stages at most 50 MiB, so a bigger pick is refused before main
  // reads it (a multi-GB file must not be buffered only to be told too_large).
  it('refuses a pick past the server 50 MiB stage limit without reading it', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    // the name must resolve in the formats table, or the upload is refused as
    // unsupported_format even before the (unread) size check this test pins
    const huge = join(dir, 'huge.docx')
    writeFileSync(huge, '')
    truncateSync(huge, 50 * 1024 * 1024 + 1)
    const result = await ctx.service.uploadDocument({
      workspaceId: WS,
      folderId: null,
      path: huge,
      uploadId: 'up-big',
    })
    expect(result).toEqual({ ok: false, error: 'too_large' })
    expect(server.calls).toHaveLength(0)
    expect(ctx.progress).toHaveLength(0)
  })

  // FX10: the dialog's Cancel aborts the request already in flight; the upload
  // call answers upload_cancelled rather than the network failure the abort
  // surfaces as, and no document is created from it.
  it('cancels a running upload through its uploadId', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const server = fakeServer({ uploadGate: () => gate })
    const ctx = setup(server)
    const started = ctx.service.uploadDocument({
      workspaceId: WS,
      folderId: null,
      path: ctx.uploadFile,
      uploadId: 'up-cancel',
    })
    // the POST is in flight (the server holds it open)
    await vi.waitFor(() =>
      expect(server.calls.some((c) => c.path.endsWith('/documents/files'))).toBe(true),
    )
    ctx.service.cancelUpload('up-cancel')
    release()
    await expect(started).resolves.toEqual({ ok: false, error: 'upload_cancelled' })
    // cancelling again (the upload already settled) is a no-op, never a throw
    ctx.service.cancelUpload('up-cancel')
    ctx.service.cancelUpload('never-started')
  })

  it('keeps the created document when the cancel lands after D answered', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const uploaded = await ctx.service.uploadDocument({
      workspaceId: WS,
      folderId: null,
      path: ctx.uploadFile,
      uploadId: 'up-late',
    })
    expect(uploaded.ok).toBe(true)
    // the dialog's late Cancel names an upload main no longer holds (never a
    // hidden delete of the document D already created)
    ctx.service.cancelUpload('up-late')
    expect(server.calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  // R2-1 (reviewer probe "cancel during initial stat prevents a later POST"):
  // the controller is registered before the stat, so a Cancel that lands while
  // main is still stat'ing the file is not dropped: nothing is read, no POST
  // starts and the call answers upload_cancelled.
  it('cancels an upload whose Cancel lands during the stat, before any read or POST', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const stat = latch()
    statGate.held = stat.held
    statGate.entered = stat.entered
    const started = ctx.service.uploadDocument({
      workspaceId: WS,
      folderId: null,
      path: ctx.uploadFile,
      uploadId: 'up-stat-cancel',
    })
    await stat.reached
    ctx.service.cancelUpload('up-stat-cancel')
    stat.release()
    await expect(started).resolves.toEqual({ ok: false, error: 'upload_cancelled' })
    // nothing left main and no progress was reported for a refused upload
    expect(server.calls).toHaveLength(0)
    expect(ctx.progress).toHaveLength(0)
    // the try/finally lifetime starts with the registration: the settled upload
    // is no longer held
    expect((ctx.service as unknown as { uploads: Map<string, AbortController> }).uploads.size).toBe(
      0,
    )
  })

  // R2-2 (reviewer probe "2xx headers before cancellation preserve the created
  // document"): D accepted the upload before the Cancel landed, so the created
  // document is returned as usual - the caller's abort is detached from the
  // body read and no hidden delete follows.
  it('returns the created document when the Cancel lands after the 201 was accepted', async () => {
    const server = fakeServer()
    const original = server.fetch
    const atBody = latch()
    const bodyHeld = latch()
    server.fetch = (async (url: string, init: RequestInit) => {
      const response = await original(url, init)
      if (!String(url).endsWith('/documents/files')) return response
      // the 201's headers are in, its body is held open: the Cancel lands
      // between the accepted answer and the read of the created document
      const raw = await response.text()
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const onAbort = () =>
            controller.error(new DOMException('The operation was aborted.', 'AbortError'))
          init.signal?.addEventListener('abort', onAbort, { once: true })
          bodyHeld.held.then(() => {
            if (!init.signal?.aborted) {
              controller.enqueue(new TextEncoder().encode(raw))
              controller.close()
            }
            init.signal?.removeEventListener('abort', onAbort)
          })
        },
      })
      const accepted = new Response(stream, {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
      const readJson = accepted.json.bind(accepted)
      accepted.json = () => {
        atBody.entered()
        return readJson()
      }
      return accepted
    }) as typeof server.fetch

    const ctx = setup(server)
    const uploading = ctx.service.uploadDocument({
      workspaceId: WS,
      folderId: null,
      path: ctx.uploadFile,
      uploadId: 'up-201-cancel',
    })
    await atBody.reached
    ctx.service.cancelUpload('up-201-cancel')
    bodyHeld.release()
    const result = await uploading
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.id).toBe('up_1')
    // the document D created before the abort is real and was never deleted
    expect(server.state.documents.has('up_1')).toBe(true)
    expect(server.calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  // R1-1 / R1-2 / N-1 / N-3: the upload IPC carries a renderer-supplied path, so
  // the native filter is not a contract. A basename the formats table does not
  // resolve (photo.png, a nonexistent missing.png, or a prototype key like
  // photo.constructor) must be refused with unsupported_format before stat,
  // readFile and any POST: otherwise the created document could never be opened.
  it('refuses a basename outside the formats table before any stat, read or POST', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const photo = join(dir, 'photo.png')
    writeFileSync(photo, 'not a document')
    const proto = join(dir, 'photo.constructor')
    writeFileSync(proto, 'not a document')
    vi.mocked(stat).mockClear()
    vi.mocked(readFile).mockClear()

    const result = await ctx.service.uploadDocument({
      workspaceId: WS,
      folderId: null,
      path: photo,
      uploadId: 'up-png',
    })
    expect(result).toEqual({ ok: false, error: 'unsupported_format' })
    expect(vi.mocked(stat)).toHaveBeenCalledTimes(0)
    expect(vi.mocked(readFile)).toHaveBeenCalledTimes(0)

    const missing = await ctx.service.uploadDocument({
      workspaceId: WS,
      folderId: null,
      path: join(dir, 'missing.png'),
      uploadId: 'up-missing-png',
    })
    expect(missing).toEqual({ ok: false, error: 'unsupported_format' })
    expect(vi.mocked(stat)).toHaveBeenCalledTimes(0)
    expect(vi.mocked(readFile)).toHaveBeenCalledTimes(0)

    const protoResult = await ctx.service.uploadDocument({
      workspaceId: WS,
      folderId: null,
      path: proto,
      uploadId: 'up-constructor',
    })
    expect(protoResult).toEqual({ ok: false, error: 'unsupported_format' })
    expect(vi.mocked(stat)).toHaveBeenCalledTimes(0)
    expect(vi.mocked(readFile)).toHaveBeenCalledTimes(0)
    expect(server.calls).toHaveLength(0)
    expect(ctx.progress).toHaveLength(0)
  })

  // R1-2: every extension the picker offers is one the service accepts, so the
  // offer and the resolver cannot drift apart unnoticed.
  it('uploads one document per extension the picker offers', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    for (const [index, ext] of UPLOAD_EXTENSIONS.entries()) {
      const file = join(dir, `report ${index}.${ext}`)
      writeFileSync(file, `bytes of ${ext}`)
      const uploaded = await ctx.service.uploadDocument({
        workspaceId: WS,
        folderId: null,
        path: file,
        uploadId: `up-${ext}`,
      })
      expect(uploaded.ok, ext).toBe(true)
    }
    const posts = server.calls.filter((c) => c.path.endsWith('/documents/files'))
    expect(posts).toHaveLength(UPLOAD_EXTENSIONS.length)
    expect(ctx.progress.filter((event) => event.loaded === 0)).toHaveLength(
      UPLOAD_EXTENSIONS.length,
    )
  })
})

describe('folders', () => {
  // FD-11: a folder is created with the folder kind, in the chosen folder, and
  // follows the folder name rule (trim + NFC, 1..255 runes - tighter than the
  // 500 a document name gets)
  it('creates a folder in a folder with the folder name rule', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const created = await ctx.service.createFolder({
      workspaceId: WS,
      parentId: 'fold_1',
      title: '  Contracts  ',
    })
    expect(created).toMatchObject({
      ok: true,
      value: { title: 'Contracts', kind: 'folder', parentId: 'fold_1' },
    })
    const post = server.calls.find(
      (c) => c.method === 'POST' && c.path === `/api/v1/workspaces/${WS}/documents`,
    )!
    expect(post.body).toEqual({ kind: 'folder', title: 'Contracts', parent_id: 'fold_1' })
    expect(post.idempotencyKey).toBeTruthy()
  })

  it('refuses an empty folder name and one over 255 runes before any request, and normalizes NFC', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    expect(
      await ctx.service.createFolder({ workspaceId: WS, parentId: null, title: '  ' }),
    ).toEqual({ ok: false, error: 'name_empty' })
    expect(
      await ctx.service.createFolder({ workspaceId: WS, parentId: null, title: 'a'.repeat(256) }),
    ).toEqual({ ok: false, error: 'name_too_long' })
    expect(server.calls).toHaveLength(0)
    // 255 decomposed `é` (e + a combining accent) are 255 runes once normalized
    const decomposed = 'e\u0301'.repeat(255)
    expect(
      await ctx.service.createFolder({ workspaceId: WS, parentId: null, title: decomposed }),
    ).toMatchObject({ ok: true })
    const post = server.calls.find((c) => c.method === 'POST')!
    expect((post.body as { title: string }).title).toBe('é'.repeat(255))
  })

  // FD-11: only folders collide on a name, so the server's 409 stays a field
  // error the renderer shows under the name (never a generic server_error)
  it('answers a taken folder name as a field error on create, and as move_name_taken on move (B-R1-03)', async () => {
    const server = fakeServer({ folderNameTaken: true })
    const ctx = setup(server)
    expect(
      await ctx.service.createFolder({ workspaceId: WS, parentId: 'fold_1', title: 'Contracts' }),
    ).toEqual({ ok: false, error: 'folder_name_taken' })
    expect(await ctx.service.moveDocument({ documentId: DOC, parentId: 'fold_1' })).toEqual({
      ok: false,
      error: 'move_name_taken',
    })
  })

  // FD-11 / B-R1-08: the tree's depth cap (20) rides the failure
  it('carries the depth cap 20 on a too-deep refusal', async () => {
    const unnamed = setup(fakeServer({ deepMax: null }))
    expect(
      await unnamed.service.createFolder({ workspaceId: WS, parentId: 'fold_1', title: 'Deep' }),
    ).toEqual({ ok: false, error: 'document_too_deep', max: 20 })
  })

  // B-R1-07: service.moveDocument mints an Idempotency-Key and passes it to the move POST
  it('sends an Idempotency-Key header on moveDocument', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const moved = await ctx.service.moveDocument({ documentId: DOC, parentId: 'fold_1' })
    expect(moved.ok).toBe(true)
    const post = server.calls.find(
      (c) => c.method === 'POST' && c.path === `/api/v1/documents/${DOC}/move`,
    )!
    expect(post.idempotencyKey).toBeTruthy()
  })

  // FD11-B-R1-06 / B-R1-01: service-level tests driving listChildren and
  // searchDocuments through the fake server and asserting `{ items, nextCursor }`
  it('lists root children with parent_id= and answers value.items', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const root = await ctx.service.listChildren({ workspaceId: WS, parentId: null })
    expect(root.ok).toBe(true)
    if (!root.ok) return
    expect(root.value).toEqual({
      items: [
        {
          id: 'fold_1',
          kind: 'folder',
          title: 'Contracts',
          workspaceId: WS,
          format: null,
          updatedAt: '2026-10-13T09:00:00Z',
          canEdit: false,
          canManage: false,
          archived: false,
          parentId: null,
        },
        {
          id: 'doc_x',
          kind: 'file',
          title: 'ignored.docx',
          workspaceId: WS,
          format: 'docx',
          updatedAt: '2026-10-13T09:00:00Z',
          canEdit: false,
          canManage: false,
          archived: false,
          parentId: null,
        },
      ],
      nextCursor: null,
    })
    const call = server.calls.find((c) => c.path === `/api/v1/workspaces/${WS}/documents`)!
    expect(call.query).toContain('parent_id=')
    expect(call.query).not.toContain('parent_id=null')
  })

  it('searches documents with match=title, maps unknown kind to all, and answers value.items', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const found = await ctx.service.searchDocuments({
      workspaceId: WS,
      query: 'Contracts',
      kind: 'unknown' as 'all',
    })
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.value.items.map((row) => row.id)).toEqual(['fold_1', 'doc_x'])
    expect(found.value.nextCursor).toBeNull()
    const call = server.calls.find((c) => c.path === `/api/v1/workspaces/${WS}/documents`)!
    expect(call.query).toContain('match=title')
    expect(call.query).toContain('q=Contracts')
    expect(call.query).not.toContain('kind=')
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

  it('renames to a name another document already has: the PATCH goes out', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const result = await ctx.service.renameDocument(DOC, 'Q4 plan v2.docx')
    expect(result.ok).toBe(true)
    expect(server.calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      revision: '41',
      title: 'Q4 plan v2.docx',
    })
  })

  it('refuses a rename over 500 runes before any request', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const result = await ctx.service.renameDocument(DOC, `${'a'.repeat(496)}.docx`)
    expect(result).toEqual({ ok: false, error: 'name_too_long' })
    expect(server.calls).toHaveLength(0)
  })

  it("maps D's 400 for a refused title on rename to name_too_long", async () => {
    const server = fakeServer({ nameRefused: true })
    const ctx = setup(server)
    const result = await ctx.service.renameDocument(DOC, 'Other.docx')
    expect(result).toEqual({ ok: false, error: 'name_too_long' })
  })

  // FD-11: a folder's name cap is 255 runes, a page/file's 500. The tighter cap
  // needs the document's own kind, so the read happens before the refusal.
  it('caps a folder rename at 255 runes and leaves the 500 cap for a file', async () => {
    const folderServer = fakeServer({ kind: 'folder' })
    const folder = setup(folderServer)
    expect(await folder.service.renameDocument(DOC, 'a'.repeat(256))).toEqual({
      ok: false,
      error: 'name_too_long',
    })
    expect(folderServer.calls.filter((c) => c.method === 'PATCH')).toHaveLength(0)
    expect(folderServer.calls.filter((c) => c.method === 'GET')).toHaveLength(1)

    const fileServer = fakeServer()
    const file = setup(fileServer)
    const long = `${'a'.repeat(252)}.docx`
    expect(await file.service.renameDocument(DOC, long)).toMatchObject({ ok: true })
    expect(fileServer.calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({
      title: long,
    })
  })

  it('treats a server 409 on rename as an ordinary failure, not a name error', async () => {
    const server = fakeServer({ nameTaken: true })
    const ctx = setup(server)
    const result = await ctx.service.renameDocument(DOC, 'Taken.docx')
    expect(result).toEqual({ ok: false, error: 'server_error' })
  })

  // R1-12: a rename to the title the document already has answers the detail's
  // own row (no second read, no write) - so its flags must come from that
  // detail, not from a fixed "canEdit, no manage, not archived".
  it('answers a no-op rename with the flags of the detail it read', async () => {
    const server = fakeServer({ myLevel: 'manage' })
    const ctx = setup(server)
    server.state.archived = true
    const result = await ctx.service.renameDocument(DOC, 'Q4 plan.docx')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({
      title: 'Q4 plan.docx',
      canEdit: true,
      canManage: true,
      archived: true,
    })
    // nothing was written: the title did not change
    expect(server.calls.every((c) => c.method === 'GET')).toBe(true)
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

  // R1-1: D's `my_level` is omitempty and its documented default is view, so a
  // detail without the field must fail closed exactly like a 'view' row; the
  // list rows already read it that way (`canEdit` false). No PATCH may leave
  // main for a level main cannot prove is edit or manage.
  it('refuses a rename when the detail carries no my_level, before any PATCH', async () => {
    const server = fakeServer({ omitMyLevel: true })
    const ctx = setup(server)
    expect(await ctx.service.renameDocument(DOC, 'Q4 v2.docx')).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(server.calls.map((c) => c.method)).toEqual(['GET'])
  })

  it('refuses a rename on an unknown my_level, before any PATCH', async () => {
    const server = fakeServer({ myLevel: 'owner' })
    const ctx = setup(server)
    expect(await ctx.service.renameDocument(DOC, 'Q4 v2.docx')).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(server.calls.map((c) => c.method)).toEqual(['GET'])
  })

  it('lets an edit-level row rename but not archive', async () => {
    const server = fakeServer({ myLevel: 'edit' })
    const ctx = setup(server)
    expect((await ctx.service.renameDocument(DOC, 'Q4 v2.docx')).ok).toBe(true)
    expect(await ctx.service.archiveDocument(DOC)).toEqual({ ok: false, error: 'forbidden' })
  })

  // R1-2 on the read path: the file block decides the format of a library row,
  // and a row that omits it (an older server, `omitempty`) falls back to the
  // title's extension - never the other way around.
  it('derives a list row format from the file block, title extension only without one', async () => {
    const withFile = setup(fakeServer({ title: 'Q4 plan' }))
    const row = await withFile.service.listDocuments({ workspaceId: WS })
    expect(row.ok).toBe(true)
    if (!row.ok) return
    expect(row.value.documents[0]!.format).toBe('docx')

    const withoutFile = setup(fakeServer({ title: 'Q4 plan', omitListFile: true }))
    const bare = await withoutFile.service.listDocuments({ workspaceId: WS })
    expect(bare.ok).toBe(true)
    if (!bare.ok) return
    expect(bare.value.documents[0]!.format).toBeNull()
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

  // R1-3 (reviewer probe "own rename preserves the working copy while legacy
  // migration holds binding writes"): while the schema 1 -> 2 sweep owns the
  // folder, every binding write is refused - so the file must not move either,
  // or binding.json would name a file that no longer exists and the copy would
  // be unreachable by lookup. The pre-store intent pair stays untouched.
  it('a rename while the migration holds the folder keeps the file and the intent', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    // a copy from an earlier build: schema 1 + pendingIntent, its bytes still
    // beside it, and the sweep cannot move them (no store in this test)
    const dir = docDir(DOC)
    const legacy = binding(opened.value.path)
    writeFileSync(
      join(dir, BINDING_FILE),
      JSON.stringify({ ...legacy, schema: 1, pendingIntent: { idempotencyKey: 'legacy' } }),
    )
    writeFileSync(join(dir, 'pending-upload.bin'), 'pending bytes')

    const renamed = await ctx.service.renameDocument(DOC, 'Other.docx')
    expect(renamed.ok).toBe(true)
    // the binding still names a file that is really there, and the file kept
    // its name (the title could not be written: the store refused it)
    const written = binding(opened.value.path)
    expect(copiesIn(DOC)).toContain(written.filename)
    expect(written).toMatchObject({ title: 'Q4 plan.docx', filename: 'Q4 plan.docx' })
    expect(copiesIn(DOC).sort()).toEqual(['Q4 plan.docx', 'pending-upload.bin'])
    expect(ctx.pathRenames).toHaveLength(0)
  })

  // R1-4 (reviewer probe "a metadata response must preserve a dirty state
  // written during its request"): the metadata GET is async, so the binding is
  // re-read when it resolves - a copy that turned dirty meanwhile keeps its
  // state and its old title instead of being reverted to the pre-await read.
  it('a metadata response never overwrites a state written while it was pending', async () => {
    const server = fakeServer()
    const original = server.fetch
    let release: () => void = () => undefined
    let entered: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const seen = new Promise<void>((resolve) => {
      entered = resolve
    })
    let paused = false
    server.fetch = (async (url: string, init: RequestInit) => {
      const response = await original(url, init)
      if (paused && String(url).endsWith(`/documents/${DOC}`)) {
        entered()
        await gate
      }
      return response
    }) as typeof server.fetch

    const ctx = setup(server, { pathOpen: true })
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    server.state.title = 'Renamed on web.docx'
    paused = true
    const refresh = ctx.service.refreshMetadataFor(DOC)
    await seen
    // the editor made the copy dirty while the GET was in flight
    writeFileSync(
      join(docDir(DOC), BINDING_FILE),
      JSON.stringify({ ...binding(opened.value.path), state: 'dirty' }),
    )
    writeFileSync(opened.value.path, 'unsaved local work')
    release()
    await refresh

    expect(binding(opened.value.path)).toMatchObject({ state: 'dirty', title: 'Q4 plan.docx' })
    expect(ctx.renamed).toHaveLength(0)
  })

  // R1-6: the feed is off, so the echo of this service's own rename never
  // arrives; a later, genuine remote rename must not be swallowed by the
  // suppression the own rename left behind. Only the revision it produced is
  // treated as its own echo.
  it('a genuine remote rename is followed even when no echo of our own arrived', async () => {
    const server = fakeServer()
    const ctx = setup(server)
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    const renamed = await ctx.service.renameDocument(DOC, 'Mine.docx')
    expect(renamed.ok).toBe(true)
    // the feed never echoed our own rename; the web renames it again (a newer
    // revision) and the single change that arrives carries that newer revision
    server.state.title = 'Theirs.docx'
    server.state.revision += 1
    ctx.service.noteFeedChange(DOC, String(server.state.revision))
    await vi.waitFor(() => expect(ctx.renamed).toHaveLength(1))
    expect(ctx.renamed[0]).toEqual({ documentId: DOC, title: 'Theirs.docx' })
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

// FD-11: a folder action the app makes itself must reach the other views of the
// workspace without waiting for the 60 s feed - main pushes the workspace id,
// coalesced (see the coalescer's own test).
describe('the FD-11 tree-changed push', () => {
  it('names the workspace after a new document, an upload, a folder, a rename and a move', async () => {
    const server = fakeServer({ moveRenames: true })
    const ctx = setup(server)
    const ws = { workspaceId: WS }

    await ctx.service.createDocument({
      workspaceId: WS,
      folderId: 'fold_1',
      name: 'Plan.docx',
      format: 'docx',
    })
    await ctx.service.uploadDocument({
      workspaceId: WS,
      folderId: null,
      path: ctx.uploadFile,
      uploadId: 'up_1',
    })
    await ctx.service.createFolder({ workspaceId: WS, parentId: null, title: 'Contracts' })
    await ctx.service.renameDocument(DOC, 'Q4 plan v2.docx')
    const moved = await ctx.service.moveDocument({ documentId: DOC, parentId: 'fold_1' })

    expect(ctx.treeChanged).toEqual([ws, ws, ws, ws, ws])
    // the move's own answer still reports the server's auto-rename
    expect(moved).toMatchObject({ ok: true, value: { renamedTo: 'Q4 plan v2.docx (2)' } })
  })

  it('says nothing when an action wrote nothing', async () => {
    const server = fakeServer()
    const ctx = setup(server)

    // a rename to the title the document already has, and a folder name the
    // service refuses itself: neither changed the tree
    await ctx.service.renameDocument(DOC, 'Q4 plan.docx')
    await ctx.service.createFolder({ workspaceId: WS, parentId: null, title: 'a'.repeat(256) })
    expect(ctx.treeChanged).toEqual([])
  })

  it('FD11-C-R1-04: suppresses pushTreeChanged when an own folder action resolves after sign-out or account switch', async () => {
    const server = fakeServer()
    const origFetch = server.fetch
    const ctx = setup(server)
    server.fetch = (async (url: string, init: RequestInit) => {
      const response = await origFetch(url, init)
      if (
        new URL(url).pathname === `/api/v1/workspaces/${WS}/documents` &&
        init.method === 'POST'
      ) {
        ctx.setIdentity(null)
      }
      return response
    }) as typeof server.fetch

    const created = await ctx.service.createFolder({
      workspaceId: WS,
      parentId: null,
      title: 'Late folder',
    })
    expect(created.ok).toBe(true)
    expect(ctx.treeChanged).toEqual([])
  })
})
