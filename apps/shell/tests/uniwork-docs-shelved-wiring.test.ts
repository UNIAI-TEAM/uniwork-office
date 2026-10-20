import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNIWORK_DOC_CHANNELS } from '../src/shared/home-api'

/**
 * UNI-1961 slice B (ARCHIVE-01 on the app): the Lưu trữ / Archive view's main
 * half. The shelved list is `GET /workspaces/{ws}/documents?shelved=true`
 * (keyset shelved_at DESC, the flat list's cursor), Bỏ lưu trữ is
 * `POST /documents/{id}/unshelve`, Chuyển vào thùng rác from Archive is the
 * trash route `POST /documents/{id}/archive`. A shelved folder or page must be unshelved
 * and trashed from Archive, so those paths gate on a kind-agnostic manage
 * read; the existing file-only archive keeps refusing non-file rows.
 */

let dir: string
let identity: { accountId: string; deviceSessionId: string; deploymentId: string } | null = null

vi.mock('electron', () => ({
  app: { getPath: () => dir, configureHostResolver: () => undefined },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    showMessageBox: vi.fn(async () => ({ response: 1 })),
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(`ENC1${text}`),
    decryptString: (buf: Buffer) => buf.toString().slice(4),
  },
  session: {
    defaultSession: {
      setSpellCheckerDictionaryDownloadURL: () => undefined,
      getSpellCheckerLanguages: () => ['en-US'],
      setSpellCheckerLanguages: () => undefined,
      isSpellCheckerEnabled: () => true,
      setSpellCheckerEnabled: () => undefined,
    },
  },
}))

vi.mock('../src/main/uniwork-auth', () => ({
  authorizedRequest: <T>(call: (token: string) => Promise<T>) => call('tok'),
  setUniworkSignOutHooks: vi.fn(),
  onUniworkAccountStatus: () => () => undefined,
  uniworkAccount: () => ({
    status: () => ({ state: 'signed-in', org: { id: 'org_a', slug: 'acme' } }),
  }),
  uniworkAppChannel: () => 'stable',
  uniworkDeploymentProfile: () => ({
    deploymentId: 'default',
    apiOrigin: 'https://uniwork.example',
    clientId: 'uniwork-office',
    channel: 'stable',
  }),
  uniworkSessionIdentity: () => identity,
}))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-docs-shelved-wiring-'))
  identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
})
afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

async function setup() {
  // Dynamic import after vi.mock('../src/main/uniwork-auth') so wiring binds the mocked auth module.
  const { createUniworkDocs } = await import('../src/main/uniwork-docs/wiring')
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const openedPaths = new Set<string>()
  const wc = {
    isDestroyed: () => false,
    isLoadingMainFrame: () => false,
    send: () => undefined,
  }
  const handle = createUniworkDocs(
    {
      handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
        handlers.set(channel, fn),
    } as never,
    {
      shellWindow: () => null,
      shellContents: () => wc as never,
      openPath: (path) => {
        openedPaths.add(path)
        return true
      },
      refuseLockedPath: () => false,
      isPathOpen: (path) => openedPaths.has(path),
      requestModuleSave: () => false,
      reloadPath: () => undefined,
      activePath: () => undefined,
      reveal: () => undefined,
      lang: () => 'en',
      defaultSaveDir: () => dir,
      openPaths: () => [...openedPaths],
      closePath: async (path) => {
        openedPaths.delete(path)
        return true
      },
      confirmClosePath: async (path) => {
        openedPaths.delete(path)
        return true
      },
      closePathNow: (path) => {
        openedPaths.delete(path)
      },
      aiHistoryPaths: () => [],
      forgetAiHistory: () => undefined,
      notifyPathRenamed: vi.fn(),
    },
  )
  const call = async (channel: string | undefined, ...args: unknown[]): Promise<unknown> => {
    expect(channel, 'channel name').toBeTypeOf('string')
    const handler = handlers.get(channel!)
    expect(handler, `handler for ${channel}`).toBeTypeOf('function')
    return handler!(null, ...args)
  }
  return { handlers, call, service: handle.service }
}

interface Seen {
  method: string
  url: URL
  idempotencyKey: string
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** a document's own fields, as `GET /documents/{id}` and the lifecycle routes answer them */
const docBody = (id: string, extra: Record<string, unknown>) => ({
  id,
  organization_id: 'org_a',
  workspace_id: 'ws_1',
  revision: '7',
  current_version: 1,
  updated_at: '2026-10-18T09:00:00Z',
  ...extra,
})

const DOCS: Record<string, Record<string, unknown>> = {
  doc_s1: {
    title: 'Plan.docx',
    kind: 'file',
    my_level: 'manage',
    shelved_at: '2026-10-18T09:00:00Z',
    file: {
      file_id: 'f1',
      version_id: 'v1',
      version: 1,
      filename: 'Plan.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size_bytes: 3,
      checksum_sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
    },
  },
  fold_s1: {
    title: 'Board 2025',
    kind: 'folder',
    my_level: 'manage',
    shelved_at: '2026-10-17T09:00:00Z',
  },
  page_s1: {
    title: 'Meeting notes',
    kind: 'page',
    admin_scope: true,
    shelved_at: '2026-10-16T09:00:00Z',
  },
  doc_view: {
    title: 'Read only.docx',
    kind: 'file',
    my_level: 'view',
    shelved_at: '2026-10-15T09:00:00Z',
  },
  page_live: { title: 'Live notes', kind: 'page', my_level: 'manage' },
  doc_live: {
    title: 'Live.docx',
    kind: 'file',
    my_level: 'manage',
    file: {
      file_id: 'f_live',
      version_id: 'v_live',
      version: 1,
      filename: 'Live.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size_bytes: 3,
      checksum_sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
    },
  },
  doc_child: {
    title: 'Child.docx',
    kind: 'file',
    my_level: 'manage',
    file: {
      file_id: 'f_child',
      version_id: 'v_child',
      version: 1,
      filename: 'Child.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size_bytes: 3,
      checksum_sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
    },
  },
}

function stubServer(): Seen[] {
  const seen: Seen[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(String(input))
      const headers = Object.fromEntries(
        Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
          k.toLowerCase(),
          v,
        ]),
      )
      const method = init.method ?? 'GET'
      seen.push({ method, url, idempotencyKey: headers['idempotency-key'] ?? '' })
      if (url.pathname === '/api/v1/workspaces/ws_1/members') {
        return reply(200, { members: [{ user_id: 'u_1', display_name: 'Alice' }] })
      }
      if (url.pathname === '/api/v1/workspaces/ws_1/documents') {
        return reply(200, {
          documents: [
            {
              id: 'doc_s1',
              workspace_id: 'ws_1',
              title: 'Plan.docx',
              kind: 'file',
              updated_at: '2026-10-18T08:00:00Z',
              updated_by: 'u_1',
              visibility: 'workspace',
              my_level: 'manage',
              shelved_at: '2026-10-18T09:00:00Z',
              shelved_by: 'u_1',
            },
            {
              id: 'fold_s1',
              workspace_id: 'ws_1',
              title: 'Board 2025',
              kind: 'folder',
              updated_at: '2026-10-17T08:00:00Z',
              my_level: 'manage',
              shelved_at: '2026-10-17T09:00:00Z',
              shelved_by: 'u_gone',
            },
            {
              id: 'page_s1',
              workspace_id: 'ws_1',
              title: 'Meeting notes',
              kind: 'page',
              updated_at: '2026-10-16T08:00:00Z',
              visibility: 'restricted',
              admin_scope: true,
              shelved_at: '2026-10-16T09:00:00Z',
              shelved_by: null,
            },
            {
              // lenient: odd shelved fields drop, the row stays
              id: 'doc_odd',
              workspace_id: 'ws_1',
              title: 'Odd.xlsx',
              kind: 'file',
              updated_at: '2026-10-15T08:00:00Z',
              shelved_at: 12345,
              shelved_by: { id: 'u_1' },
              admin_scope: 'yes',
            },
          ],
          next_cursor: 'c_next',
        })
      }
      const lifecycle = /^\/api\/v1\/documents\/([^/]+)\/(unshelve|archive|shelve|restore)$/.exec(
        url.pathname,
      )
      if (lifecycle && method === 'POST') {
        const [, id, action] = lifecycle
        const base = DOCS[id!]
        if (!base) return reply(404, { error: { code: 'not_found', message: 'x' } })
        const document =
          action === 'unshelve'
            ? docBody(id!, { ...base, shelved_at: undefined })
            : action === 'archive'
              ? docBody(id!, { ...base, archived_at: '2026-10-19T09:00:00Z' })
              : action === 'restore'
                ? docBody(id!, { ...base, archived_at: undefined })
                : docBody(id!, { ...base, shelved_at: '2026-10-19T09:00:00Z' })
        return reply(200, {
          document,
          batch_id: 'b_1',
          affected: id === 'fold_s1' ? ['fold_s1', 'doc_child'] : [id],
        })
      }
      const adminSummary = /^\/api\/v1\/documents\/([^/]+)\/admin-summary$/.exec(url.pathname)
      if (adminSummary && method === 'GET') {
        const docId = adminSummary[1]!
        const base = DOCS[docId]
        if (!base) return reply(404, { error: { code: 'not_found', message: 'x' } })
        if (base.my_level !== 'manage' && base.admin_scope !== true) {
          return reply(403, { error: { code: 'forbidden', message: 'x' } })
        }
        const { my_level, admin_scope, ...docFields } = base
        return reply(200, {
          document: docBody(docId, docFields),
          my_level: typeof my_level === 'string' ? my_level : '',
          admin_scope: admin_scope === true,
        })
      }
      const download = /^\/api\/v1\/documents\/([^/]+)\/download$/.exec(url.pathname)
      if (download && method === 'GET') {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
      }
      const editLock = /^\/api\/v1\/documents\/([^/]+)\/edit-lock(?:\/([^/]+))?$/.exec(url.pathname)
      if (editLock) {
        const docId = editLock[1]!
        const base = DOCS[docId]
        if (method === 'DELETE') return new Response(null, { status: 204 })
        if (base?.shelved_at) {
          return reply(409, { error: { code: 'document_shelved', message: 'Shelved' } })
        }
        return reply(200, {
          lock_id: 'l_1',
          document_id: docId,
          holder_id: 'u_1',
          client: 'desktop',
          acquired_at: '2026-10-20T00:00:00Z',
          expires_at: '2026-10-20T00:05:00Z',
          heartbeat_interval_ms: 60_000,
          ttl_ms: 300_000,
          server_time: '2026-10-20T00:00:00Z',
        })
      }
      const detail = /^\/api\/v1\/documents\/([^/]+)$/.exec(url.pathname)
      if (detail && method === 'GET') {
        const docId = detail[1]!
        const base = DOCS[docId]
        if (!base) return reply(404, { error: { code: 'not_found', message: 'x' } })
        // Canonical server (decideDocumentContent): an admin_scope caller with
        // no read level receives 403 document_restricted on GET /documents/{id}.
        if (!base.my_level && base.admin_scope === true) {
          return reply(403, {
            error: { code: 'document_restricted', fields: { can_break_glass: true } },
          })
        }
        return reply(200, { document: docBody(docId, base) })
      }
      return reply(404, { error: { code: 'not_found', message: 'x' } })
    }),
  )
  return seen
}

const posts = (seen: Seen[]) => seen.filter((s) => s.method === 'POST').map((s) => s.url.pathname)

describe('UNI-1961 Archive (shelved) IPC: list', () => {
  it('registers the shelved channels', async () => {
    const { handlers } = await setup()
    for (const channel of [
      UNIWORK_DOC_CHANNELS.listShelved,
      UNIWORK_DOC_CHANNELS.unshelveDocument,
      UNIWORK_DOC_CHANNELS.trashShelvedDocument,
    ]) {
      expect(channel).toBeTypeOf('string')
      expect(handlers.has(channel)).toBe(true)
    }
  })

  it('lists the shelf with shelved=true + limit, the cursor and the type filter, never archived or parent_id', async () => {
    const { call } = await setup()
    const seen = stubServer()
    await call(UNIWORK_DOC_CHANNELS.listShelved, { workspaceId: 'ws_1' })
    await call(UNIWORK_DOC_CHANNELS.listShelved, {
      workspaceId: 'ws_1',
      cursor: 'c_next',
      format: 'xlsx',
    })
    const lists = seen.filter((s) => s.url.pathname === '/api/v1/workspaces/ws_1/documents')
    expect(lists).toHaveLength(2)
    const [first, second] = lists.map((s) => s.url.searchParams)
    expect(first!.get('shelved')).toBe('true')
    expect(first!.get('limit')).toBe('50')
    expect(first!.has('cursor')).toBe(false)
    expect(first!.has('format')).toBe(false)
    expect(second!.get('shelved')).toBe('true')
    expect(second!.get('cursor')).toBe('c_next')
    expect(second!.get('format')).toBe('xlsx')
    for (const params of [first!, second!]) {
      expect(params.has('archived')).toBe(false)
      expect(params.has('parent_id')).toBe(false)
      expect(params.has('kind')).toBe(false)
    }
  })

  it('reads every kind with shelved_at / shelved_by / admin_scope leniently and names the shelver from the workspace members', async () => {
    const { call } = await setup()
    stubServer()
    const res = (await call(UNIWORK_DOC_CHANNELS.listShelved, { workspaceId: 'ws_1' })) as {
      ok: boolean
      value: { documents: Array<Record<string, unknown>>; nextCursor: string | null }
    }
    expect(res.ok).toBe(true)
    expect(res.value.nextCursor).toBe('c_next')
    const byId = new Map(res.value.documents.map((d) => [d.id, d]))
    expect([...byId.keys()]).toEqual(['doc_s1', 'fold_s1', 'page_s1', 'doc_odd'])
    expect(byId.get('doc_s1')).toMatchObject({
      kind: 'file',
      shelvedAt: '2026-10-18T09:00:00Z',
      shelvedById: 'u_1',
      shelvedByName: 'Alice',
      updatedByName: 'Alice',
      canManage: true,
    })
    expect(byId.get('doc_s1')!.shelvedByFormer).toBeUndefined()
    // an id the member list does not hold is a former member, never a raw id
    expect(byId.get('fold_s1')).toMatchObject({
      kind: 'folder',
      shelvedById: 'u_gone',
      shelvedByFormer: true,
    })
    expect(byId.get('fold_s1')!.shelvedByName).toBeUndefined()
    // null shelved_by = the system; admin_scope rides along
    expect(byId.get('page_s1')).toMatchObject({
      kind: 'page',
      shelvedAt: '2026-10-16T09:00:00Z',
      adminScope: true,
    })
    expect(byId.get('page_s1')!.shelvedById).toBeUndefined()
    const odd = byId.get('doc_odd')!
    expect(odd.shelvedAt).toBeUndefined()
    expect(odd.shelvedById).toBeUndefined()
    expect(odd.adminScope).toBeUndefined()
  })

  it('answers the result shape for a missing workspace, without a request', async () => {
    const { call } = await setup()
    const seen = stubServer()
    expect(await call(UNIWORK_DOC_CHANNELS.listShelved, {})).toEqual({
      ok: false,
      error: 'not_found',
    })
    expect(seen).toHaveLength(0)
  })
})

describe('UNI-1961 Archive (shelved) IPC: unshelve and trash from Archive', () => {
  it('unshelves a shelved folder after a kind-agnostic manage read, with an Idempotency-Key, and returns the affected ids', async () => {
    const { call } = await setup()
    const seen = stubServer()
    const res = (await call(UNIWORK_DOC_CHANNELS.unshelveDocument, 'fold_s1')) as {
      ok: boolean
      value: { document: Record<string, unknown>; affected: string[] }
    }
    expect(res.ok).toBe(true)
    expect(res.value.document).toMatchObject({ id: 'fold_s1', title: 'Board 2025', kind: 'folder' })
    expect(res.value.affected).toEqual(['fold_s1', 'doc_child'])
    expect(seen.map((s) => `${s.method} ${s.url.pathname}`)).toEqual([
      'GET /api/v1/documents/fold_s1',
      'POST /api/v1/documents/fold_s1/unshelve',
    ])
    expect(seen[1]!.idempotencyKey).not.toBe('')
  })

  it('unshelves and shelves a restricted page the caller administers (admin_scope with 403 document_restricted on detail, R1-2)', async () => {
    const { call } = await setup()
    const seen = stubServer()
    const unshelved = (await call(UNIWORK_DOC_CHANNELS.unshelveDocument, 'page_s1')) as {
      ok: boolean
    }
    expect(unshelved.ok).toBe(true)
    const shelved = (await call(UNIWORK_DOC_CHANNELS.shelveDocument, 'page_s1')) as {
      ok: boolean
    }
    expect(shelved.ok).toBe(true)
    expect(seen.map((s) => `${s.method} ${s.url.pathname}`)).toEqual([
      'GET /api/v1/documents/page_s1',
      'GET /api/v1/documents/page_s1/admin-summary',
      'POST /api/v1/documents/page_s1/unshelve',
      'GET /api/v1/documents/page_s1',
      'GET /api/v1/documents/page_s1/admin-summary',
      'POST /api/v1/documents/page_s1/shelve',
    ])
  })

  it('makes no POST when the administrative read is denied, malformed, or lacks admin_scope (R1-2)', async () => {
    const { call } = await setup()
    for (const [summaryReply, expectedError] of [
      [reply(403, { error: { code: 'forbidden', message: 'x' } }), 'forbidden'],
      [reply(200, { document: { id: 'page_s1' } }), 'malformed_response'],
      [
        reply(200, {
          document: docBody('page_s1', { title: 'Meeting notes', kind: 'page' }),
          my_level: '',
          admin_scope: false,
        }),
        'forbidden',
      ],
    ] as const) {
      const seen: Seen[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string, init: RequestInit = {}) => {
          const url = new URL(String(input))
          seen.push({ method: init.method ?? 'GET', url, idempotencyKey: '' })
          if (url.pathname === '/api/v1/documents/page_s1') {
            return reply(403, {
              error: { code: 'document_restricted', fields: { can_break_glass: true } },
            })
          }
          if (url.pathname === '/api/v1/documents/page_s1/admin-summary') {
            return summaryReply.clone()
          }
          return reply(500, {})
        }),
      )
      expect(await call(UNIWORK_DOC_CHANNELS.unshelveDocument, 'page_s1')).toEqual({
        ok: false,
        error: expectedError,
      })
      expect(posts(seen)).toEqual([])
    }
  })

  it('refuses a below-manage unshelve and trash without any write', async () => {
    const { call } = await setup()
    const seen = stubServer()
    expect(await call(UNIWORK_DOC_CHANNELS.unshelveDocument, 'doc_view')).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(await call(UNIWORK_DOC_CHANNELS.trashShelvedDocument, 'doc_view')).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(posts(seen)).toEqual([])
  })

  it('moves a shelved folder and a shelved page to the trash through the archive route', async () => {
    const { call } = await setup()
    const seen = stubServer()
    const folder = (await call(UNIWORK_DOC_CHANNELS.trashShelvedDocument, 'fold_s1')) as {
      ok: boolean
      value: Record<string, unknown>
    }
    expect(folder.ok).toBe(true)
    expect(folder.value).toMatchObject({ id: 'fold_s1', archived: true })
    const page = (await call(UNIWORK_DOC_CHANNELS.trashShelvedDocument, 'page_s1')) as {
      ok: boolean
    }
    expect(page.ok).toBe(true)
    expect(posts(seen)).toEqual([
      '/api/v1/documents/fold_s1/archive',
      '/api/v1/documents/page_s1/archive',
    ])
    expect(seen.filter((s) => s.method === 'POST').every((s) => s.idempotencyKey !== '')).toBe(true)
  })

  it('keeps archiveDocument file-only while allowing restoreDocument to recover trashed folders and pages (R1-8)', async () => {
    const { call } = await setup()
    const seen = stubServer()
    for (const id of ['fold_s1', 'page_live']) {
      expect(await call(UNIWORK_DOC_CHANNELS.archiveDocument, id)).toEqual({
        ok: false,
        error: 'unsupported_format',
      })
    }
    expect(posts(seen)).toEqual([])

    for (const id of ['fold_s1', 'page_s1']) {
      const restored = (await call(UNIWORK_DOC_CHANNELS.restoreDocument, id)) as {
        ok: boolean
        value: Record<string, unknown>
      }
      expect(restored.ok).toBe(true)
      expect(restored.value).toMatchObject({ id, archived: false })
    }
    expect(posts(seen)).toEqual([
      '/api/v1/documents/fold_s1/restore',
      '/api/v1/documents/page_s1/restore',
    ])
    // a file still archives through archiveDocument
    const archivedFile = (await call(UNIWORK_DOC_CHANNELS.archiveDocument, 'doc_s1')) as {
      ok: boolean
    }
    expect(archivedFile.ok).toBe(true)
  })

  it('rejects a mismatched manage-reference id with malformed_response and makes no lifecycle POST (R1-14)', async () => {
    const { call } = await setup()
    const seen: Seen[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init: RequestInit = {}) => {
        const url = new URL(String(input))
        seen.push({ method: init.method ?? 'GET', url, idempotencyKey: '' })
        return reply(200, {
          document: docBody('wrong_doc', { title: 'Wrong', kind: 'page', my_level: 'manage' }),
        })
      }),
    )
    for (const channel of [
      UNIWORK_DOC_CHANNELS.shelveDocument,
      UNIWORK_DOC_CHANNELS.unshelveDocument,
      UNIWORK_DOC_CHANNELS.trashShelvedDocument,
      UNIWORK_DOC_CHANNELS.restoreDocument,
    ]) {
      expect(await call(channel, 'page_live')).toEqual({
        ok: false,
        error: 'malformed_response',
      })
    }
    expect(posts(seen)).toEqual([])
  })

  it('refuses shelve, unshelve, and trashShelved when the session changes while the manage read is pending (R1-3)', async () => {
    const { call } = await setup()
    for (const channel of [
      UNIWORK_DOC_CHANNELS.shelveDocument,
      UNIWORK_DOC_CHANNELS.unshelveDocument,
      UNIWORK_DOC_CHANNELS.trashShelvedDocument,
    ]) {
      identity = { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }
      const seen: Seen[] = []
      let releaseGet: (res: Response) => void = () => undefined
      vi.stubGlobal(
        'fetch',
        vi.fn((input: string, init: RequestInit = {}) => {
          const url = new URL(String(input))
          const method = init.method ?? 'GET'
          seen.push({ method, url, idempotencyKey: '' })
          if (method === 'GET') {
            return new Promise<Response>((resolve) => {
              releaseGet = resolve
            })
          }
          return Promise.resolve(
            reply(200, {
              document: docBody('fold_s1', DOCS.fold_s1!),
              batch_id: 'b_1',
              affected: ['fold_s1'],
            }),
          )
        }),
      )
      const pending = call(channel, 'fold_s1')
      await vi.waitFor(() => {
        expect(seen).toHaveLength(1)
      })
      identity = { accountId: 'acc_2', deviceSessionId: 'dev_2', deploymentId: 'other' }
      releaseGet(reply(200, { document: docBody('fold_s1', DOCS.fold_s1!) }))
      expect(await pending).toEqual({ ok: false, error: 'not_signed_in' })
      expect(posts(seen)).toEqual([])
    }
  })
})

describe('UNI-1961 preload', () => {
  it('exposes the shelved methods on their channels', () => {
    const source = readFileSync(resolve(__dirname, '../src/preload/index.ts'), 'utf8')
    for (const [method, channel] of [
      ['uniworkListShelved', 'listShelved'],
      ['uniworkUnshelveDocument', 'unshelveDocument'],
      ['uniworkTrashShelvedDocument', 'trashShelvedDocument'],
    ] as const) {
      expect(source).toMatch(
        new RegExp(
          `async ${method}\\([^)]*\\)\\s*\\{[\\s\\S]*?UNIWORK_DOC_CHANNELS\\.${channel}\\b`,
        ),
      )
    }
  })
})

describe('UNI-1961 live-row Lưu trữ (shelve)', () => {
  it('registers the shelve channel and the preload exposes it', async () => {
    const { handlers } = await setup()
    expect(UNIWORK_DOC_CHANNELS.shelveDocument).toBeTypeOf('string')
    expect(handlers.has(UNIWORK_DOC_CHANNELS.shelveDocument)).toBe(true)
    const source = readFileSync(resolve(__dirname, '../src/preload/index.ts'), 'utf8')
    expect(source).toMatch(
      /async uniworkShelveDocument\([^)]*\)\s*\{[\s\S]*?UNIWORK_DOC_CHANNELS\.shelveDocument\b/,
    )
  })

  it('shelves a page the caller manages through POST /shelve with an Idempotency-Key', async () => {
    const { call } = await setup()
    const seen = stubServer()
    const res = (await call(UNIWORK_DOC_CHANNELS.shelveDocument, 'page_live')) as {
      ok: boolean
      value: { document: Record<string, unknown>; affected: string[] }
    }
    expect(res.ok).toBe(true)
    expect(res.value.document).toMatchObject({ id: 'page_live', kind: 'page' })
    expect(res.value.affected).toEqual(['page_live'])
    expect(seen.map((s) => `${s.method} ${s.url.pathname}`)).toEqual([
      'GET /api/v1/documents/page_live',
      'POST /api/v1/documents/page_live/shelve',
    ])
    expect(seen.find((s) => s.method === 'POST')!.idempotencyKey).not.toBe('')
  })

  it('refuses a below-manage shelve without a write', async () => {
    const { call } = await setup()
    const seen = stubServer()
    expect(await call(UNIWORK_DOC_CHANNELS.shelveDocument, 'doc_view')).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(posts(seen)).toEqual([])
  })

  it('opens a shelved file read-only without altering its ACL, and refreshes open copies across shelve and unshelve (R1-7)', async () => {
    const { call, service } = await setup()
    const seen = stubServer()
    try {
      const shelvedOpen = (await call(UNIWORK_DOC_CHANNELS.openDocument, 'doc_s1')) as {
        ok: boolean
        value: { path: string }
      }
      expect(shelvedOpen.ok).toBe(true)
      const shelvedPath = shelvedOpen.value.path
      expect(service.isReadOnly(shelvedPath)).toBe(true)
      expect(await service.docStatus(shelvedPath)).toMatchObject({
        access: 'view',
        commentsLevel: 'view',
      })
      expect(service.commentContext(shelvedPath)).toMatchObject({ level: 'view' })
      expect(service.store.lookup(shelvedPath)?.binding).toMatchObject({
        access: 'view',
        level: 'manage',
        shelved: true,
      })
      expect(seen.some((s) => s.url.pathname === '/api/v1/documents/doc_s1/edit-lock')).toBe(false)

      const liveOpen = (await call(UNIWORK_DOC_CHANNELS.openDocument, 'doc_live')) as {
        ok: boolean
        value: { path: string }
      }
      expect(liveOpen.ok).toBe(true)
      const livePath = liveOpen.value.path
      expect(service.isReadOnly(livePath)).toBe(false)
      expect(await service.docStatus(livePath)).toMatchObject({
        access: 'edit',
        commentsLevel: 'manage',
      })
      expect(service.commentContext(livePath)).toMatchObject({ level: 'manage' })
      expect(service.store.lookup(livePath)?.binding).toMatchObject({
        access: 'edit',
        level: 'manage',
      })

      const shelvedRes = (await call(UNIWORK_DOC_CHANNELS.shelveDocument, 'doc_live')) as {
        ok: boolean
      }
      expect(shelvedRes.ok).toBe(true)
      expect(service.isReadOnly(livePath)).toBe(true)
      expect(await service.docStatus(livePath)).toMatchObject({
        access: 'view',
        commentsLevel: 'view',
      })
      expect(service.commentContext(livePath)).toMatchObject({ level: 'view' })
      expect(service.store.lookup(livePath)?.binding).toMatchObject({
        access: 'view',
        level: 'manage',
        shelved: true,
      })

      const unshelvedRes = (await call(UNIWORK_DOC_CHANNELS.unshelveDocument, 'doc_live')) as {
        ok: boolean
      }
      expect(unshelvedRes.ok).toBe(true)
      expect(service.isReadOnly(livePath)).toBe(false)
      expect(await service.docStatus(livePath)).toMatchObject({
        access: 'edit',
        commentsLevel: 'manage',
      })
      expect(service.commentContext(livePath)).toMatchObject({ level: 'manage' })
      const restoredBinding = service.store.lookup(livePath)?.binding
      expect(restoredBinding).toMatchObject({
        access: 'edit',
        level: 'manage',
      })
      expect(restoredBinding?.shelved).toBeUndefined()
    } finally {
      await service.releaseAllEditLocks()
    }
  })

  it('follows server shelving state changes in both directions on refreshMetadataFor, preserving dirty state, old bindings without shelved, and view-only launches (R1-7 residual)', async () => {
    const { call, service } = await setup()
    const seen = stubServer()
    const origDocLive = { ...DOCS.doc_live }
    const origDocS1 = { ...DOCS.doc_s1 }
    try {
      const liveOpen = (await call(UNIWORK_DOC_CHANNELS.openDocument, 'doc_live')) as {
        ok: boolean
        value: { path: string }
      }
      expect(liveOpen.ok).toBe(true)
      const livePath = liveOpen.value.path
      await vi.waitFor(() => {
        expect(
          seen.some(
            (s) => s.method === 'POST' && s.url.pathname === '/api/v1/documents/doc_live/edit-lock',
          ),
        ).toBe(true)
      })

      // Seed an old stored binding without `shelved` and make the working copy dirty
      writeFileSync(livePath, new Uint8Array([9, 8, 7]))
      await service.refreshPath(livePath)
      const bindingPath = join(dirname(livePath), 'binding.json')
      const diskRaw = JSON.parse(readFileSync(bindingPath, 'utf8')) as Record<string, unknown>
      delete diskRaw.shelved
      writeFileSync(bindingPath, `${JSON.stringify(diskRaw, null, 2)}\n`)
      expect(service.store.lookup(livePath)?.binding.state).toBe('dirty')
      expect(service.isReadOnly(livePath)).toBe(false)

      // Another client shelves doc_live without changing its title
      DOCS.doc_live = { ...origDocLive, shelved_at: '2026-10-20T01:00:00Z' }
      await service.refreshMetadataFor('doc_live')
      expect(service.isReadOnly(livePath)).toBe(true)
      expect(await service.docStatus(livePath)).toMatchObject({
        access: 'view',
        commentsLevel: 'view',
        state: 'dirty',
      })
      expect(service.commentContext(livePath)).toMatchObject({
        level: 'view',
        versionId: 'v_live',
      })
      expect(service.store.lookup(livePath)?.binding).toMatchObject({
        access: 'view',
        level: 'manage',
        shelved: true,
        state: 'dirty',
        baseRevision: '7',
        baseVersion: 1,
      })
      expect([...readFileSync(livePath)]).toEqual([9, 8, 7])
      expect(
        seen.some(
          (s) =>
            s.method === 'DELETE' && s.url.pathname === '/api/v1/documents/doc_live/edit-lock/l_1',
        ),
      ).toBe(true)

      // Also verify an old stored binding without `shelved` (view + manage) unshelves back to edit
      const shelvedDisk = JSON.parse(readFileSync(bindingPath, 'utf8')) as Record<string, unknown>
      delete shelvedDisk.shelved
      writeFileSync(bindingPath, `${JSON.stringify(shelvedDisk, null, 2)}\n`)
      const lockPostsBeforeUnshelve = seen.filter(
        (s) => s.method === 'POST' && s.url.pathname === '/api/v1/documents/doc_live/edit-lock',
      ).length
      DOCS.doc_live = { ...origDocLive }
      await service.refreshMetadataFor('doc_live')
      expect(service.isReadOnly(livePath)).toBe(false)
      expect(await service.docStatus(livePath)).toMatchObject({
        access: 'edit',
        commentsLevel: 'manage',
        state: 'dirty',
      })
      expect(service.commentContext(livePath)).toMatchObject({
        level: 'manage',
        versionId: 'v_live',
      })
      const unshelvedBinding = service.store.lookup(livePath)?.binding
      expect(unshelvedBinding).toMatchObject({
        access: 'edit',
        level: 'manage',
        state: 'dirty',
        baseRevision: '7',
        baseVersion: 1,
      })
      expect(unshelvedBinding?.shelved).toBeUndefined()
      expect([...readFileSync(livePath)]).toEqual([9, 8, 7])
      await vi.waitFor(() => {
        expect(
          seen.filter(
            (s) => s.method === 'POST' && s.url.pathname === '/api/v1/documents/doc_live/edit-lock',
          ).length,
        ).toBeGreaterThan(lockPostsBeforeUnshelve)
      })

      // Explicit view-only launch restriction stays view-only when server unshelves
      const viewLaunched = await service.openFromServer('doc_s1', {
        receiptId: 'r_view',
        redeemedAt: '2026-10-20T00:00:00Z',
        id: 'doc_s1',
        organizationId: 'org_a',
        workspaceId: 'ws_1',
        title: 'Plan.docx',
        operation: 'view',
        version: 0,
        revision: '7',
        downloadPath: '/api/v1/documents/doc_s1/download',
      })
      expect(service.isReadOnly(viewLaunched.path)).toBe(true)
      DOCS.doc_s1 = { ...origDocS1, shelved_at: undefined }
      await service.refreshMetadataFor('doc_s1')
      expect(service.isReadOnly(viewLaunched.path)).toBe(true)
      const viewBinding = service.store.lookup(viewLaunched.path)?.binding
      expect(viewBinding).toMatchObject({ access: 'view', level: 'view' })
      expect(viewBinding?.shelved).toBeUndefined()
      expect(seen.some((s) => s.url.pathname === '/api/v1/documents/doc_s1/edit-lock')).toBe(false)
    } finally {
      DOCS.doc_live = origDocLive
      DOCS.doc_s1 = origDocS1
      await service.releaseAllEditLocks()
    }
  })

  it('preserves a concurrent binding commit during shelve lock release, restores legacy no-level bindings on unshelve, and refreshes affected open children in both directions (R2-1, R2-8, R2-9)', async () => {
    const { call, service } = await setup()
    const seen = stubServer()
    const baseFetch = globalThis.fetch
    let releaseLockDelete: (() => void) | undefined
    let markLockDeleteEntered: () => void = () => undefined
    const lockDeleteEntered = new Promise<void>((resolve) => {
      markLockDeleteEntered = resolve
    })
    let holdLockDelete = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init: RequestInit = {}) => {
        const url = new URL(String(input))
        if (
          holdLockDelete &&
          init.method === 'DELETE' &&
          url.pathname === '/api/v1/documents/doc_live/edit-lock/l_1'
        ) {
          holdLockDelete = false
          markLockDeleteEntered()
          await new Promise<void>((resolve) => {
            releaseLockDelete = resolve
          })
        }
        return baseFetch(input, init)
      }),
    )

    try {
      const liveOpen = (await call(UNIWORK_DOC_CHANNELS.openDocument, 'doc_live')) as {
        ok: boolean
        value: { path: string }
      }
      expect(liveOpen.ok).toBe(true)
      const livePath = liveOpen.value.path
      await vi.waitFor(() => {
        expect(
          seen.some(
            (s) => s.method === 'POST' && s.url.pathname === '/api/v1/documents/doc_live/edit-lock',
          ),
        ).toBe(true)
      })

      // R2-1: hold edit-lock release during shelveDocument, settle a concurrent commitState, then release
      holdLockDelete = true
      const pendingShelve = call(UNIWORK_DOC_CHANNELS.shelveDocument, 'doc_live')
      await lockDeleteEntered

      const beforeCommit = service.store.lookup(livePath)
      expect(beforeCommit).not.toBeNull()
      const committedChecksum = '2'.repeat(64)
      await service.coordinator.commitState(beforeCommit!, {
        ...beforeCommit!.binding,
        baseRevision: '8',
        baseVersion: 2,
        baseChecksum: committedChecksum,
        baseVersionId: 'v_live_2',
        state: 'saved',
      })
      expect(service.store.lookup(livePath)?.binding).toMatchObject({
        baseRevision: '8',
        baseVersion: 2,
        baseChecksum: committedChecksum,
        baseVersionId: 'v_live_2',
        state: 'saved',
      })

      releaseLockDelete!()
      expect((await pendingShelve) as { ok: boolean }).toMatchObject({ ok: true })
      expect(service.isReadOnly(livePath)).toBe(true)
      expect(service.store.lookup(livePath)?.binding).toMatchObject({
        baseRevision: '8',
        baseVersion: 2,
        baseChecksum: committedChecksum,
        baseVersionId: 'v_live_2',
        state: 'saved',
        shelved: true,
        access: 'view',
        level: 'manage',
      })

      // R2-8: legacy editable binding with no stored `level` shelves and unshelves back to edit
      const bindingPath = join(dirname(livePath), 'binding.json')
      const legacyRaw = JSON.parse(readFileSync(bindingPath, 'utf8')) as Record<string, unknown>
      legacyRaw.access = 'edit'
      delete legacyRaw.level
      delete legacyRaw.shelved
      writeFileSync(bindingPath, `${JSON.stringify(legacyRaw, null, 2)}\n`)
      expect(service.store.lookup(livePath)?.binding.level).toBeUndefined()

      expect(
        (await call(UNIWORK_DOC_CHANNELS.shelveDocument, 'doc_live')) as { ok: boolean },
      ).toMatchObject({ ok: true })
      expect(service.isReadOnly(livePath)).toBe(true)
      expect(service.store.lookup(livePath)?.binding).toMatchObject({
        access: 'view',
        shelved: true,
      })

      expect(
        (await call(UNIWORK_DOC_CHANNELS.unshelveDocument, 'doc_live')) as { ok: boolean },
      ).toMatchObject({ ok: true })
      expect(service.isReadOnly(livePath)).toBe(false)
      const restoredLegacy = service.store.lookup(livePath)?.binding
      expect(restoredLegacy?.access).toBe('edit')
      expect(restoredLegacy?.shelved).toBeUndefined()

      // R2-9: open child named in `affected` follows parent shelve/unshelve in both directions
      const childOpen = (await call(UNIWORK_DOC_CHANNELS.openDocument, 'doc_child')) as {
        ok: boolean
        value: { path: string }
      }
      expect(childOpen.ok).toBe(true)
      const childPath = childOpen.value.path
      expect(service.isReadOnly(childPath)).toBe(false)

      expect(
        (await call(UNIWORK_DOC_CHANNELS.shelveDocument, 'fold_s1')) as { ok: boolean },
      ).toMatchObject({ ok: true })
      expect(service.isReadOnly(childPath)).toBe(true)
      expect(await service.docStatus(childPath)).toMatchObject({
        access: 'view',
        commentsLevel: 'view',
      })
      expect(service.commentContext(childPath)).toMatchObject({ level: 'view' })
      expect(service.store.lookup(childPath)?.binding).toMatchObject({
        access: 'view',
        level: 'manage',
        shelved: true,
      })

      expect(
        (await call(UNIWORK_DOC_CHANNELS.unshelveDocument, 'fold_s1')) as { ok: boolean },
      ).toMatchObject({ ok: true })
      expect(service.isReadOnly(childPath)).toBe(false)
      expect(await service.docStatus(childPath)).toMatchObject({
        access: 'edit',
        commentsLevel: 'manage',
      })
      expect(service.commentContext(childPath)).toMatchObject({ level: 'manage' })
      const unshelvedChild = service.store.lookup(childPath)?.binding
      expect(unshelvedChild).toMatchObject({
        access: 'edit',
        level: 'manage',
      })
      expect(unshelvedChild?.shelved).toBeUndefined()
    } finally {
      await service.releaseAllEditLocks()
    }
  })
})
