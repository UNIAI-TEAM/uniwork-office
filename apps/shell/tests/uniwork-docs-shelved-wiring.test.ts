import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
  const { createUniworkDocs } = await import('../src/main/uniwork-docs/wiring')
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const wc = {
    isDestroyed: () => false,
    isLoadingMainFrame: () => false,
    send: () => undefined,
  }
  createUniworkDocs(
    {
      handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
        handlers.set(channel, fn),
    } as never,
    {
      shellWindow: () => null,
      shellContents: () => wc as never,
      openPath: () => true,
      refuseLockedPath: () => false,
      isPathOpen: () => false,
      requestModuleSave: () => false,
      reloadPath: () => undefined,
      activePath: () => undefined,
      reveal: () => undefined,
      lang: () => 'en',
      defaultSaveDir: () => dir,
      openPaths: () => [],
      closePath: async () => true,
      confirmClosePath: async () => true,
      closePathNow: () => undefined,
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
  return { handlers, call }
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
      checksum_sha256: 'a'.repeat(64),
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
      const lifecycle = /^\/api\/v1\/documents\/([^/]+)\/(unshelve|archive|shelve)$/.exec(
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
              : docBody(id!, { ...base, shelved_at: '2026-10-19T09:00:00Z' })
        return reply(200, {
          document,
          batch_id: 'b_1',
          affected: action === 'unshelve' && id === 'fold_s1' ? ['fold_s1', 'doc_child'] : [id],
        })
      }
      const detail = /^\/api\/v1\/documents\/([^/]+)$/.exec(url.pathname)
      if (detail && method === 'GET') {
        const base = DOCS[detail[1]!]
        if (!base) return reply(404, { error: { code: 'not_found', message: 'x' } })
        return reply(200, { document: docBody(detail[1]!, base) })
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

  it('unshelves a page the caller administers (admin_scope, no my_level)', async () => {
    const { call } = await setup()
    const seen = stubServer()
    const res = (await call(UNIWORK_DOC_CHANNELS.unshelveDocument, 'page_s1')) as { ok: boolean }
    expect(res.ok).toBe(true)
    expect(posts(seen)).toEqual(['/api/v1/documents/page_s1/unshelve'])
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

  it('leaves the existing file-only archive / restore refusing a folder and a page exactly as before', async () => {
    const { call } = await setup()
    const seen = stubServer()
    for (const id of ['fold_s1', 'page_s1']) {
      expect(await call(UNIWORK_DOC_CHANNELS.archiveDocument, id)).toEqual({
        ok: false,
        error: 'unsupported_format',
      })
      expect(await call(UNIWORK_DOC_CHANNELS.restoreDocument, id)).toEqual({
        ok: false,
        error: 'unsupported_format',
      })
    }
    expect(posts(seen)).toEqual([])
    // a file still archives through it
    expect(
      ((await call(UNIWORK_DOC_CHANNELS.archiveDocument, 'doc_s1')) as { ok: boolean }).ok,
    ).toBe(true)
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
