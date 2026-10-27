import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNIWORK_DOC_CHANNELS } from '../src/shared/home-api'

/**
 * UNI-2047 A1b: the doclist query vocabulary (sort / order / activity and the
 * format / updated_by / updated_from filters) must travel from the renderer's
 * IPC query through the service to the HTTP client, for every list route, and
 * `archived_by` is named from the workspace member list like `shelved_by`.
 * An unset query stays byte-identical to today's request; a value outside the
 * server's vocabulary is dropped at the IPC boundary and never leaves.
 */

let dir: string

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
  uniworkSessionIdentity: () => ({
    accountId: 'acc_1',
    deviceSessionId: 'dev_1',
    deploymentId: 'default',
  }),
}))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-docs-doclist-ipc-'))
})
afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

async function setup() {
  // dynamic import after vi.mock('../src/main/uniwork-auth') so wiring binds the mocked auth module
  const { createUniworkDocs } = await import('../src/main/uniwork-docs/wiring')
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  createUniworkDocs(
    {
      handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
        handlers.set(channel, fn),
    } as never,
    {
      shellWindow: () => null,
      shellContents: () =>
        ({
          isDestroyed: () => false,
          isLoadingMainFrame: () => false,
          send: () => undefined,
        }) as never,
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
  return async (channel: string | undefined, ...args: unknown[]): Promise<unknown> => {
    expect(channel, 'channel name').toBeTypeOf('string')
    const handler = handlers.get(channel!)
    expect(handler, `handler for ${channel}`).toBeTypeOf('function')
    return handler!(null, ...args)
  }
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const row = (id: string, ws: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: 'file',
  workspace_id: ws,
  title: `${id}.docx`,
  updated_at: '2026-10-18T08:00:00Z',
  ...extra,
})

interface Server {
  /** every request the client made, in order */
  seen: URL[]
  /** the requests to one path */
  at: (pathname: string) => URL[]
  /** the list requests of workspace 1, whichever documents route carried them */
  lists: () => URL[]
}

/** a fake UniWork server: two workspaces, one member list, canned lists per route */
function stubServer(
  options: {
    shared?: Record<string, unknown[]>
    list?: unknown[]
    members?: Array<{ user_id: string; display_name: string }>
  } = {},
): Server {
  const seen: URL[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(String(input))
      seen.push(url)
      const p = url.pathname
      if (p === '/api/v1/orgs/org_a/workspaces') {
        return reply(200, {
          workspaces: [
            { id: 'ws_1', name: 'Team' },
            { id: 'ws_2', name: 'Sales' },
          ],
        })
      }
      const shared = /^\/api\/v1\/workspaces\/([^/]+)\/documents\/shared-with-me$/.exec(p)
      if (shared) {
        return reply(200, { documents: options.shared?.[shared[1]!] ?? [], next_cursor: null })
      }
      if (/^\/api\/v1\/workspaces\/[^/]+\/members$/.test(p)) {
        return reply(200, { members: options.members ?? [] })
      }
      if (/^\/api\/v1\/workspaces\/[^/]+\/documents$/.test(p)) {
        return reply(200, { documents: options.list ?? [], next_cursor: null })
      }
      return reply(404, { error: { code: 'not_found', message: 'x' } })
    }),
  )
  return {
    seen,
    at: (pathname) => seen.filter((u) => u.pathname === pathname),
    lists: () => seen.filter((u) => u.pathname.startsWith(WS1_DOCS)),
  }
}

const WS1_DOCS = '/api/v1/workspaces/ws_1/documents'
const SHARED_1 = '/api/v1/workspaces/ws_1/documents/shared-with-me'
const SHARED_2 = '/api/v1/workspaces/ws_2/documents/shared-with-me'

describe('UNI-2047 A1b: the flat / folder / shared-by-me / trash lists forward sort, order and activity', () => {
  const full = {
    workspaceId: 'ws_1',
    types: ['docx'],
    updatedBy: 'u_1',
    updatedFrom: '2026-10-01T00:00:00Z',
    sort: 'name',
    order: 'desc',
    activity: 'edited',
  }

  it.each([
    ['listDocuments', UNIWORK_DOC_CHANNELS.listDocuments, {}],
    ['listChildren', UNIWORK_DOC_CHANNELS.listChildren, { parentId: 'fold_1' }],
    ['listSharedByMe', UNIWORK_DOC_CHANNELS.listSharedByMe, {}],
    ['listTrash', UNIWORK_DOC_CHANNELS.listTrash, {}],
  ])(
    '%s passes sort, order and activity next to the old filters',
    async (_name, channel, extra) => {
      const call = await setup()
      const server = stubServer()
      await call(channel, { ...full, ...extra })
      const [req] = server.lists()
      expect(req, 'a list request').toBeDefined()
      const params = req!.searchParams
      expect(params.get('sort')).toBe('name')
      expect(params.get('order')).toBe('desc')
      // A-FIX4 M2: updated_by / updated_from put Recent on the flat route, which has no activity
      expect(params.get('activity')).toBe(
        channel === UNIWORK_DOC_CHANNELS.listDocuments ? null : 'edited',
      )
      expect(params.getAll('type')).toEqual(['docx'])
      expect(params.has('format')).toBe(false)
      expect(params.get('updated_by')).toBe('u_1')
      expect(params.get('updated_from')).toBe('2026-10-01T00:00:00Z')
    },
  )

  it.each([
    ['listDocuments', UNIWORK_DOC_CHANNELS.listDocuments],
    ['listSharedByMe', UNIWORK_DOC_CHANNELS.listSharedByMe],
    ['listTrash', UNIWORK_DOC_CHANNELS.listTrash],
  ])(
    '%s drops a sort, order or activity outside the vocabulary at the IPC boundary',
    async (_name, channel) => {
      const call = await setup()
      const server = stubServer()
      await call(channel, {
        workspaceId: 'ws_1',
        sort: 'size; drop table',
        order: 'sideways',
        activity: 'deleted',
      })
      await call(channel, { workspaceId: 'ws_1', sort: 7, order: true, activity: { x: 1 } })
      const reqs = server.lists()
      expect(reqs).toHaveLength(2)
      for (const req of reqs) {
        expect(req.searchParams.has('sort')).toBe(false)
        expect(req.searchParams.has('order')).toBe(false)
        expect(req.searchParams.has('activity')).toBe(false)
      }
    },
  )

  it("an unset query sends exactly today's request (no sort, order or activity)", async () => {
    const call = await setup()
    const server = stubServer()
    await call(UNIWORK_DOC_CHANNELS.listDocuments, { workspaceId: 'ws_1' })
    await call(UNIWORK_DOC_CHANNELS.listTrash, { workspaceId: 'ws_1' })
    const [recent, trash] = server.lists()
    expect(recent!.pathname).toBe(`${WS1_DOCS}/recent`)
    expect(recent!.search).toBe('?limit=50&kind=file')
    expect(trash!.search).toBe('?archived=1&limit=50')
  })
})

describe('UNI-2113: the Type picks at the IPC boundary', () => {
  const routes = [
    ['listDocuments', UNIWORK_DOC_CHANNELS.listDocuments, {}],
    ['listChildren', UNIWORK_DOC_CHANNELS.listChildren, { parentId: 'fold_1' }],
    ['listSharedByMe', UNIWORK_DOC_CHANNELS.listSharedByMe, {}],
    ['listTrash', UNIWORK_DOC_CHANNELS.listTrash, {}],
    ['listShelved', UNIWORK_DOC_CHANNELS.listShelved, {}],
  ] as const

  it.each(routes)('%s sends one type= per pick in menu order', async (_name, channel, extra) => {
    const call = await setup()
    const server = stubServer()
    await call(channel, { workspaceId: 'ws_1', types: ['txt', 'page', 'docx'], ...extra })
    const [req] = server.lists()
    expect(req, 'a list request').toBeDefined()
    expect(req!.searchParams.getAll('type')).toEqual(['page', 'docx', 'txt'])
    expect(req!.searchParams.has('format')).toBe(false)
    expect(req!.searchParams.has('kind') ? req!.searchParams.get('kind') : null).not.toBe('page')
  })

  // main never trusts the renderer: only the server's vocabulary leaves, once each, never empty
  it.each(routes)('%s drops unknown, empty and repeated picks', async (_name, channel, extra) => {
    const call = await setup()
    const server = stubServer()
    await call(channel, {
      workspaceId: 'ws_1',
      types: ['pdf', 'pdf', '', 'PDF', 'exe', 7, null, 'md'],
      ...extra,
    })
    await call(channel, { workspaceId: 'ws_1', types: [], ...extra })
    await call(channel, { workspaceId: 'ws_1', types: 'docx', ...extra })
    await call(channel, { workspaceId: 'ws_1', types: [''], ...extra })
    const [odd, ...plain] = server.lists()
    expect(odd!.searchParams.getAll('type')).toEqual(['pdf', 'md'])
    expect(plain).toHaveLength(3)
    for (const req of plain) expect(req.searchParams.has('type')).toBe(false)
  })

  it.each(routes)('%s forwards at most 8 picks', async (_name, channel, extra) => {
    const call = await setup()
    const server = stubServer()
    await call(channel, {
      workspaceId: 'ws_1',
      types: ['page', 'docx', 'xlsx', 'pptx', 'pdf', 'md', 'html', 'txt', 'docx', 'page'],
      ...extra,
    })
    const [req] = server.lists()
    expect(req!.searchParams.getAll('type')).toEqual([
      'page',
      'docx',
      'xlsx',
      'pptx',
      'pdf',
      'md',
      'html',
      'txt',
    ])
  })

  // the single-format / kind=page filter the picks replace never leaves
  it.each(routes)('%s no longer forwards format or kind', async (_name, channel, extra) => {
    const call = await setup()
    const server = stubServer()
    await call(channel, { workspaceId: 'ws_1', kind: 'page', format: 'docx', ...extra })
    await call(channel, { workspaceId: 'ws_1', kind: 'folder', ...extra })
    for (const req of server.lists()) {
      expect(req.searchParams.has('format')).toBe(false)
      expect(req.searchParams.get('kind')).not.toBe('page')
      expect(req.searchParams.get('kind')).not.toBe('folder')
    }
  })

  it('shared with me forwards the picks to every workspace', async () => {
    const call = await setup()
    const server = stubServer()
    await call(UNIWORK_DOC_CHANNELS.listSharedWithMe, { types: ['xlsx', 'page', '', 'bogus'] })
    for (const path of [SHARED_1, SHARED_2]) {
      const [req] = server.at(path)
      expect(req!.searchParams.getAll('type'), path).toEqual(['page', 'xlsx'])
      expect(req!.searchParams.has('kind'), path).toBe(false)
    }
  })

  it('sources: the picks (txt and page included) go in menu order, junk dropped', async () => {
    const call = await setup()
    const server = stubServer()
    const sources = `${WS1_DOCS}/sources`
    await call(UNIWORK_DOC_CHANNELS.listSources, {
      workspaceId: 'ws_1',
      types: ['txt', 'docx', 'docx', '', 'bogus', 'page'],
    })
    await call(UNIWORK_DOC_CHANNELS.listSources, { workspaceId: 'ws_1', types: [''] })
    await call(UNIWORK_DOC_CHANNELS.listSources, { workspaceId: 'ws_1', type: 'docx' })
    const [picked, empty, legacy] = server.at(sources)
    expect(picked!.searchParams.getAll('type')).toEqual(['page', 'docx', 'txt'])
    expect(empty!.searchParams.has('type')).toBe(false)
    // the old single `type` field is gone from the wire
    expect(legacy!.searchParams.has('type')).toBe(false)
  })
})

describe('UNI-2047 A1b: shared with me', () => {
  it('forwards types, updated_by, updated_from, sort and order to every workspace', async () => {
    const call = await setup()
    const server = stubServer()
    await call(UNIWORK_DOC_CHANNELS.listSharedWithMe, {
      types: ['xlsx'],
      updatedBy: 'u_2',
      updatedFrom: '2026-10-05T00:00:00Z',
      sort: 'name',
      order: 'asc',
    })
    for (const path of [SHARED_1, SHARED_2]) {
      const [req] = server.at(path)
      expect(req, path).toBeDefined()
      const params = req!.searchParams
      expect(params.getAll('type')).toEqual(['xlsx'])
      expect(params.has('format')).toBe(false)
      expect(params.get('updated_by')).toBe('u_2')
      expect(params.get('updated_from')).toBe('2026-10-05T00:00:00Z')
      expect(params.get('sort')).toBe('name')
      expect(params.get('order')).toBe('asc')
      expect(params.has('activity')).toBe(false)
    }
  })

  it('drops unknown values and never forwards activity', async () => {
    const call = await setup()
    const server = stubServer()
    await call(UNIWORK_DOC_CHANNELS.listSharedWithMe, {
      sort: 'bogus',
      order: 'up',
      activity: 'edited',
      types: 42,
      updatedBy: ['u_1'],
    })
    for (const path of [SHARED_1, SHARED_2]) {
      const [req] = server.at(path)
      expect(req!.search, path).toBe('?limit=50')
    }
  })

  it("an unset query is today's call unchanged: limit only, newest first", async () => {
    const call = await setup()
    const server = stubServer({
      shared: {
        ws_1: [row('a', 'ws_1', { updated_at: '2026-10-01T00:00:00Z' })],
        ws_2: [row('b', 'ws_2', { updated_at: '2026-10-09T00:00:00Z' })],
      },
    })
    const res = (await call(UNIWORK_DOC_CHANNELS.listSharedWithMe)) as {
      ok: boolean
      value: { documents: Array<{ id: string }> }
    }
    expect(res.ok).toBe(true)
    expect(res.value.documents.map((d) => d.id)).toEqual(['b', 'a'])
    expect(server.at(SHARED_1)[0]!.search).toBe('?limit=50')
    expect(server.at(SHARED_2)[0]!.search).toBe('?limit=50')
  })

  it('merges the workspaces in the requested sort order, not only newest first', async () => {
    const shared = {
      ws_1: [
        row('a', 'ws_1', { title: 'Bravo.docx', updated_at: '2026-10-01T00:00:00Z' }),
        row('c', 'ws_1', { title: 'Delta.docx', updated_at: '2026-10-03T00:00:00Z' }),
      ],
      ws_2: [
        row('b', 'ws_2', { title: 'Alpha.docx', updated_at: '2026-10-09T00:00:00Z' }),
        row('d', 'ws_2', { title: 'Charlie.docx', updated_at: '2026-10-02T00:00:00Z' }),
      ],
    }
    const call = await setup()
    stubServer({ shared })
    const ids = async (query: unknown): Promise<string[]> => {
      const res = (await call(UNIWORK_DOC_CHANNELS.listSharedWithMe, query)) as {
        value: { documents: Array<{ id: string }> }
      }
      return res.value.documents.map((d) => d.id)
    }
    // name: the key's own default is ascending
    expect(await ids({ sort: 'name' })).toEqual(['b', 'a', 'd', 'c'])
    expect(await ids({ sort: 'name', order: 'desc' })).toEqual(['c', 'd', 'a', 'b'])
    // updated: the key's own default is newest first; asc flips it
    expect(await ids({ sort: 'updated' })).toEqual(['b', 'c', 'd', 'a'])
    expect(await ids({ sort: 'updated', order: 'asc' })).toEqual(['a', 'd', 'c', 'b'])
  })
})

describe('UNI-2047 A1b: the shelf', () => {
  it('forwards types, sort and order, and nothing else', async () => {
    const call = await setup()
    const server = stubServer()
    await call(UNIWORK_DOC_CHANNELS.listShelved, {
      workspaceId: 'ws_1',
      types: ['pdf'],
      sort: 'shelved',
      order: 'asc',
      activity: 'edited',
      updatedBy: 'u_1',
      updatedFrom: '2026-10-01T00:00:00Z',
    })
    const [req] = server.lists()
    const params = req!.searchParams
    expect(params.get('shelved')).toBe('true')
    expect(params.getAll('type')).toEqual(['pdf'])
    expect(params.has('format')).toBe(false)
    expect(params.get('sort')).toBe('shelved')
    expect(params.get('order')).toBe('asc')
    expect(params.has('activity')).toBe(false)
    expect(params.has('updated_by')).toBe(false)
    expect(params.has('updated_from')).toBe(false)
  })

  it("drops an unknown sort or order; unset stays today's request", async () => {
    const call = await setup()
    const server = stubServer()
    await call(UNIWORK_DOC_CHANNELS.listShelved, { workspaceId: 'ws_1', sort: 'zzz', order: 'up' })
    await call(UNIWORK_DOC_CHANNELS.listShelved, { workspaceId: 'ws_1' })
    const [odd, plain] = server.lists()
    expect(odd!.search).toBe('?shelved=true&limit=50')
    expect(plain!.search).toBe('?shelved=true&limit=50')
  })
})

describe('UNI-2047 A1b: archivedByName', () => {
  const trashed = [
    row('t1', 'ws_1', { archived_at: '2026-10-19T09:00:00Z', archived_by: 'u_1' }),
    row('t2', 'ws_1', { archived_at: '2026-10-19T08:00:00Z', archived_by: 'u_gone' }),
    row('t3', 'ws_1', { archived_at: '2026-10-19T07:00:00Z' }),
  ]

  it('names the person who trashed a row from the workspace members', async () => {
    const call = await setup()
    stubServer({ list: trashed, members: [{ user_id: 'u_1', display_name: ' Alice ' }] })
    const res = (await call(UNIWORK_DOC_CHANNELS.listTrash, { workspaceId: 'ws_1' })) as {
      ok: boolean
      value: { documents: Array<Record<string, unknown>> }
    }
    expect(res.ok).toBe(true)
    const byId = new Map(res.value.documents.map((d) => [d.id, d]))
    expect(byId.get('t1')).toMatchObject({ archivedById: 'u_1', archivedByName: 'Alice' })
    // a former member and a row with no archived_by stay unnamed: no raw id, no guess
    expect(byId.get('t2')!.archivedById).toBe('u_gone')
    expect(byId.get('t2')!.archivedByName).toBeUndefined()
    expect(byId.get('t3')!.archivedByName).toBeUndefined()
  })

  it('leaves the rows untouched when the member list is empty or unreadable', async () => {
    const call = await setup()
    stubServer({ list: trashed, members: [] })
    const res = (await call(UNIWORK_DOC_CHANNELS.listTrash, { workspaceId: 'ws_1' })) as {
      value: { documents: Array<Record<string, unknown>> }
    }
    for (const doc of res.value.documents) expect(doc.archivedByName).toBeUndefined()
  })
})

describe('UNI-2113 fix1: the Type picks on the title search at the IPC boundary', () => {
  it('searchDocuments sends one type= per pick in menu order beside match=title', async () => {
    const call = await setup()
    const server = stubServer()
    await call(UNIWORK_DOC_CHANNELS.searchDocuments, {
      workspaceId: 'ws_1',
      query: 'plan',
      kind: 'all',
      types: ['txt', 'page', 'docx'],
    })
    const [req] = server.lists()
    expect(req, 'a search request').toBeDefined()
    expect(req!.searchParams.get('match')).toBe('title')
    expect(req!.searchParams.get('q')).toBe('plan')
    expect(req!.searchParams.getAll('type')).toEqual(['page', 'docx', 'txt'])
  })

  it('searchDocuments drops unknown, empty and repeated picks and sends nothing for no pick', async () => {
    const call = await setup()
    const server = stubServer()
    const base = { workspaceId: 'ws_1', query: 'plan', kind: 'all' }
    await call(UNIWORK_DOC_CHANNELS.searchDocuments, {
      ...base,
      types: ['pdf', 'pdf', '', 'PDF', 'exe', 7, null, 'md'],
    })
    await call(UNIWORK_DOC_CHANNELS.searchDocuments, { ...base, types: [] })
    await call(UNIWORK_DOC_CHANNELS.searchDocuments, { ...base, types: 'docx' })
    await call(UNIWORK_DOC_CHANNELS.searchDocuments, base)
    const [odd, ...plain] = server.lists()
    expect(odd!.searchParams.getAll('type')).toEqual(['pdf', 'md'])
    expect(plain).toHaveLength(3)
    for (const req of plain) expect(req.searchParams.has('type')).toBe(false)
  })

  it('searchDocuments forwards at most 8 picks and never format or kind=page', async () => {
    const call = await setup()
    const server = stubServer()
    await call(UNIWORK_DOC_CHANNELS.searchDocuments, {
      workspaceId: 'ws_1',
      query: 'plan',
      kind: 'all',
      format: 'docx',
      types: ['page', 'docx', 'xlsx', 'pptx', 'pdf', 'md', 'html', 'txt', 'docx', 'page'],
    })
    const [req] = server.lists()
    expect(req!.searchParams.getAll('type')).toHaveLength(8)
    expect(req!.searchParams.has('format')).toBe(false)
    expect(req!.searchParams.get('kind')).not.toBe('page')
  })
})

describe('UNI-2205 fix6: the Archive search at the IPC boundary', () => {
  it('sends shelved=true beside match=title and q only for a real true', async () => {
    const call = await setup()
    const server = stubServer()
    const base = { workspaceId: 'ws_1', query: 'plan', kind: 'all' }
    await call(UNIWORK_DOC_CHANNELS.searchDocuments, { ...base, shelved: true })
    await call(UNIWORK_DOC_CHANNELS.searchDocuments, { ...base, shelved: 'true' })
    await call(UNIWORK_DOC_CHANNELS.searchDocuments, { ...base, shelved: false })
    await call(UNIWORK_DOC_CHANNELS.searchDocuments, base)
    const [shelf, ...plain] = server.lists()
    expect(shelf!.searchParams.get('match')).toBe('title')
    expect(shelf!.searchParams.get('q')).toBe('plan')
    expect(shelf!.searchParams.get('shelved')).toBe('true')
    expect(shelf!.searchParams.has('archived')).toBe(false)
    expect(plain).toHaveLength(3)
    for (const req of plain) expect(req.searchParams.has('shelved')).toBe(false)
  })

  it('names the shelver of a shelved hit from the workspace members, like a shelf row', async () => {
    const call = await setup()
    stubServer({
      list: [
        row('d1', 'ws_1', { shelved_at: '2026-10-01T00:00:00Z', shelved_by: 'u_a' }),
        row('d2', 'ws_1', { shelved_at: '2026-10-01T00:00:00Z', shelved_by: 'u_gone' }),
      ],
      members: [{ user_id: 'u_a', display_name: ' Ada Lovelace ' }],
    })
    const res = (await call(UNIWORK_DOC_CHANNELS.searchDocuments, {
      workspaceId: 'ws_1',
      query: 'plan',
      kind: 'all',
      shelved: true,
    })) as { value: { items: Array<Record<string, unknown>> } }
    const byId = new Map(res.value.items.map((d) => [d.id, d]))
    expect(byId.get('d1')!.shelvedByName).toBe('Ada Lovelace')
    expect(byId.get('d2')!.shelvedByFormer).toBe(true)
  })
})
