import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNIWORK_DOC_CHANNELS } from '../src/shared/home-api'

/**
 * UNI-2047 B6: Starred over IPC. The list goes from the renderer's query through the
 * service to `GET /workspaces/{ws}/documents/favorites` (the route reads only the type,
 * the sort and the paging: the editor / date filters and `activity` never leave), an older
 * server's 404 comes back as a typed error, and star / unstar are one IPC call each.
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

interface Seen {
  url: URL
  method: string
}

/** a fake UniWork server for the favorites route and the two star writes */
function stubServer(
  options: {
    favorites?: () => Response
    favorite?: () => Response
    unfavorite?: () => Response
  } = {},
): Seen[] {
  const seen: Seen[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input))
      const method = init?.method ?? 'GET'
      seen.push({ url, method })
      const p = url.pathname
      if (/^\/api\/v1\/workspaces\/ws_1\/documents\/favorites$/.test(p)) {
        return (
          options.favorites?.() ??
          reply(200, {
            documents: [
              {
                id: 'd1',
                kind: 'file',
                workspace_id: 'ws_1',
                title: 'd1.docx',
                updated_at: '2026-10-18T08:00:00Z',
                updated_by: 'u_1',
                favorited_at: '2026-10-20T08:00:00Z',
              },
            ],
            next_cursor: null,
          })
        )
      }
      if (/^\/api\/v1\/workspaces\/ws_1\/members$/.test(p)) {
        return reply(200, { members: [{ user_id: 'u_1', display_name: 'Minh Trần' }] })
      }
      if (p === '/api/v1/documents/d1/favorite' && method === 'POST') {
        return (
          options.favorite?.() ??
          reply(200, {
            favorite: { document_id: 'd1', favorited_at: '2026-10-21T01:00:00Z' },
          })
        )
      }
      if (p === '/api/v1/documents/d1/favorite' && method === 'DELETE') {
        return options.unfavorite?.() ?? reply(200, { status: 'ok' })
      }
      return reply(404, { error: { code: 'not_found', message: 'x' } })
    }),
  )
  return seen
}

const FAV = '/api/v1/workspaces/ws_1/documents/favorites'

describe('UNI-2047 B6: the Starred list over IPC', () => {
  it('has its own channels', () => {
    expect(UNIWORK_DOC_CHANNELS.listFavorites).toBe('uniwork-doc:list-favorites')
    expect(UNIWORK_DOC_CHANNELS.favoriteDocument).toBe('uniwork-doc:favorite-document')
    expect(UNIWORK_DOC_CHANNELS.unfavoriteDocument).toBe('uniwork-doc:unfavorite-document')
  })

  it('lists the stars with favorited_at, and names the last editor from the member list', async () => {
    const call = await setup()
    const seen = stubServer()
    const res = (await call(UNIWORK_DOC_CHANNELS.listFavorites, { workspaceId: 'ws_1' })) as {
      ok: boolean
      value: { documents: Array<Record<string, unknown>>; nextCursor: string | null }
    }
    expect(res.ok).toBe(true)
    expect(res.value.documents).toHaveLength(1)
    expect(res.value.documents[0]).toMatchObject({
      id: 'd1',
      favoritedAt: '2026-10-20T08:00:00Z',
      updatedByName: 'Minh Trần',
    })
    expect(seen.filter((s) => s.url.pathname === FAV)).toHaveLength(1)
  })

  it('forwards the type, the sort and the paging, and drops what the route does not read', async () => {
    const call = await setup()
    const seen = stubServer()
    await call(UNIWORK_DOC_CHANNELS.listFavorites, {
      workspaceId: 'ws_1',
      cursor: 'c9',
      limit: 25,
      types: ['xlsx', 'page', '', 'bogus', 'xlsx'],
      sort: 'starred',
      order: 'desc',
      activity: 'edited',
      updatedBy: 'u_1',
      updatedFrom: '2026-10-01T00:00:00Z',
    })
    const [req] = seen.filter((s) => s.url.pathname === FAV)
    const params = req!.url.searchParams
    expect(params.getAll('type')).toEqual(['page', 'xlsx'])
    expect(params.has('format')).toBe(false)
    expect(params.get('sort')).toBe('starred')
    expect(params.get('order')).toBe('desc')
    expect(params.get('cursor')).toBe('c9')
    expect(params.get('limit')).toBe('25')
    expect(params.get('kind')).toBe('document')
    expect(params.has('activity')).toBe(false)
    expect(params.has('updated_by')).toBe(false)
    expect(params.has('updated_from')).toBe(false)
  })

  it('drops a sort or order outside the vocabulary at the IPC boundary', async () => {
    const call = await setup()
    const seen = stubServer()
    await call(UNIWORK_DOC_CHANNELS.listFavorites, {
      workspaceId: 'ws_1',
      sort: 'size; drop table',
      order: 'sideways',
    })
    const [req] = seen.filter((s) => s.url.pathname === FAV)
    expect(req!.url.searchParams.has('sort')).toBe(false)
    expect(req!.url.searchParams.has('order')).toBe(false)
  })

  it('an older server (404) is an error result, not a crash', async () => {
    const call = await setup()
    stubServer({ favorites: () => reply(404, { error: { code: 'not_found', message: 'x' } }) })
    const res = (await call(UNIWORK_DOC_CHANNELS.listFavorites, { workspaceId: 'ws_1' })) as {
      ok: boolean
      error: string
    }
    expect(res.ok).toBe(false)
    expect(res.error).toBe('not_found')
  })

  it('no workspace in the query is not_found, with no request', async () => {
    const call = await setup()
    const seen = stubServer()
    const res = (await call(UNIWORK_DOC_CHANNELS.listFavorites, {})) as {
      ok: boolean
      error: string
    }
    expect(res).toMatchObject({ ok: false, error: 'not_found' })
    expect(seen).toEqual([])
  })
})

describe('UNI-2047 B6: star and unstar over IPC', () => {
  it('favoriteDocument POSTs once and answers the time of the star', async () => {
    const call = await setup()
    const seen = stubServer()
    const res = await call(UNIWORK_DOC_CHANNELS.favoriteDocument, 'd1')
    expect(res).toEqual({ ok: true, value: { favoritedAt: '2026-10-21T01:00:00Z' } })
    expect(seen.map((s) => `${s.method} ${s.url.pathname}`)).toEqual([
      'POST /api/v1/documents/d1/favorite',
    ])
  })

  it('unfavoriteDocument DELETEs once', async () => {
    const call = await setup()
    const seen = stubServer()
    const res = await call(UNIWORK_DOC_CHANNELS.unfavoriteDocument, 'd1')
    expect(res).toMatchObject({ ok: true })
    expect(seen.map((s) => `${s.method} ${s.url.pathname}`)).toEqual([
      'DELETE /api/v1/documents/d1/favorite',
    ])
  })

  it('a non-id argument is not_found with no request', async () => {
    const call = await setup()
    const seen = stubServer()
    expect(await call(UNIWORK_DOC_CHANNELS.favoriteDocument, undefined)).toMatchObject({
      ok: false,
      error: 'not_found',
    })
    expect(await call(UNIWORK_DOC_CHANNELS.unfavoriteDocument, '')).toMatchObject({
      ok: false,
      error: 'not_found',
    })
    expect(seen).toEqual([])
  })

  it('a refusal comes back typed (the usual 403 mapping)', async () => {
    const call = await setup()
    stubServer({ favorite: () => reply(403, { error: { code: 'forbidden', message: 'x' } }) })
    expect(await call(UNIWORK_DOC_CHANNELS.favoriteDocument, 'd1')).toMatchObject({
      ok: false,
      error: 'permission_revoked',
    })
  })
})
