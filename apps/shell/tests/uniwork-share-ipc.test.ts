import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNIWORK_SHARE_CHANNELS } from '../src/shared/home-api'

/**
 * UNI-2047 SD-A: the share channels end to end on the main side (`uniwork-share:*`
 * registered by the documents wiring, answered by the share service through the
 * real client against a stubbed server) and on the preload side (`window.uniworkShare`,
 * one method per channel, replies checked before the renderer sees them).
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
  dir = mkdtempSync(join(tmpdir(), 'uw-share-ipc-'))
})
afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

const CHANNEL_NAMES = {
  get: 'uniwork-share:get',
  update: 'uniwork-share:update',
  candidates: 'uniwork-share:candidates',
  linkCreate: 'uniwork-share:link-create',
  linkRevoke: 'uniwork-share:link-revoke',
  settings: 'uniwork-share:settings',
  requests: 'uniwork-share:requests',
  requestApprove: 'uniwork-share:request-approve',
  requestDecline: 'uniwork-share:request-decline',
  bulk: 'uniwork-share:bulk',
} as const

describe('the channel table', () => {
  it('has exactly the ten uniwork-share channels', () => {
    expect(UNIWORK_SHARE_CHANNELS).toEqual(CHANNEL_NAMES)
  })
})

async function setup() {
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
  return {
    handlers,
    call: async (channel: string, ...args: unknown[]): Promise<unknown> => {
      const handler = handlers.get(channel)
      expect(handler, `handler for ${channel}`).toBeTypeOf('function')
      return handler!(null, ...args)
    },
  }
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

interface Seen {
  method: string
  path: string
  search: string
  body: unknown
}

function stubServer(answer: (seen: Seen) => Response): Seen[] {
  const seen: Seen[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input))
      const entry: Seen = {
        method: init?.method ?? 'GET',
        path: url.pathname,
        search: url.search,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      }
      seen.push(entry)
      return answer(entry)
    }),
  )
  return seen
}

describe('main: the handlers', () => {
  it('registers a handler for every channel', async () => {
    const { handlers } = await setup()
    for (const channel of Object.values(CHANNEL_NAMES)) expect(handlers.has(channel)).toBe(true)
  })

  it('get -> GET /documents/{id}/shares', async () => {
    const { call } = await setup()
    const seen = stubServer(() => reply(200, { my_level: 'manage', shares: [], links: [] }))
    const res = await call(CHANNEL_NAMES.get, 'doc_1')
    expect(res).toMatchObject({ ok: true, value: { myLevel: 'manage', shares: [], links: [] } })
    expect(seen).toMatchObject([{ method: 'GET', path: '/api/v1/documents/doc_1/shares' }])
  })

  it('update -> PUT /documents/{id}/access with the dry_run flag', async () => {
    const { call } = await setup()
    const seen = stubServer(() =>
      reply(200, { dry_run: true, results: [{ index: 0, status: 'updated' }] }),
    )
    const res = await call(CHANNEL_NAMES.update, {
      documentId: 'doc_1',
      items: [{ principalType: 'user', principalId: 'u_2', level: 'edit' }],
      dryRun: true,
    })
    expect(res).toMatchObject({ ok: true, value: { dryRun: true } })
    expect(seen[0]).toMatchObject({
      method: 'PUT',
      path: '/api/v1/documents/doc_1/access',
      body: {
        items: [{ principal_type: 'user', principal_id: 'u_2', level: 'edit' }],
        dry_run: true,
      },
    })
  })

  it('a rejected item comes back on the failure result', async () => {
    const { call } = await setup()
    stubServer(() =>
      reply(422, {
        error: {
          code: 'document_access_rejected',
          message: 'x',
          fields: {
            rejected: [
              {
                index: 0,
                principal_type: 'user',
                principal_id: 'u_2',
                code: 'duplicate_principal',
              },
            ],
          },
        },
      }),
    )
    const res = await call(CHANNEL_NAMES.update, {
      documentId: 'doc_1',
      items: [{ principalType: 'user', principalId: 'u_2', level: 'edit' }],
    })
    expect(res).toEqual({
      ok: false,
      error: 'document_access_rejected',
      status: 422,
      rejected: [
        { index: 0, principalType: 'user', principalId: 'u_2', code: 'duplicate_principal' },
      ],
    })
  })

  it('candidates, links, requests and settings hit the contract routes', async () => {
    const { call } = await setup()
    const seen = stubServer((s) => {
      if (s.path.endsWith('/share-candidates')) return reply(200, { items: [], next_cursor: '' })
      if (s.path.endsWith('/links') && s.method === 'POST') {
        return reply(201, { link: { id: 'ln_1' }, token: 't', url: 'https://uniwork.example/p/t' })
      }
      if (s.path.endsWith('/access-requests') && s.method === 'GET')
        return reply(200, { requests: [] })
      if (s.path.endsWith('/approve') || s.path.endsWith('/decline')) {
        return reply(200, { id: 'rq_1', status: 'ok' })
      }
      if (s.path.endsWith('/settings')) {
        return reply(200, { organization_id: 'org_a', public_links_enabled: true })
      }
      return reply(204, null)
    })
    await call(CHANNEL_NAMES.candidates, { documentId: 'doc_1', q: 'mi' })
    await call(CHANNEL_NAMES.linkCreate, { documentId: 'doc_1', expiresInDays: 7 })
    await call(CHANNEL_NAMES.linkRevoke, { documentId: 'doc_1', linkId: 'ln_1' })
    await call(CHANNEL_NAMES.settings)
    await call(CHANNEL_NAMES.requests, 'doc_1')
    await call(CHANNEL_NAMES.requestApprove, {
      documentId: 'doc_1',
      requestId: 'rq_1',
      level: 'view',
    })
    await call(CHANNEL_NAMES.requestDecline, { documentId: 'doc_1', requestId: 'rq_1' })
    expect(seen.map((s) => `${s.method} ${s.path.slice('/api/v1'.length)}${s.search}`)).toEqual([
      'GET /documents/doc_1/share-candidates?q=mi',
      'POST /documents/doc_1/links',
      'DELETE /documents/doc_1/links/ln_1',
      'GET /orgs/org_a/documents/settings',
      'GET /documents/doc_1/access-requests',
      'POST /documents/doc_1/access-requests/rq_1/approve',
      'POST /documents/doc_1/access-requests/rq_1/decline',
    ])
  })

  it('bulk shares each document in turn through the same routes', async () => {
    const { call } = await setup()
    const seen = stubServer((s) =>
      s.path.endsWith('/access')
        ? reply(200, { results: [{ index: 0, status: 'granted' }] })
        : reply(201, { link: { id: 'ln' }, token: 't', url: `https://uniwork.example/p${s.path}` }),
    )
    const res = await call(CHANNEL_NAMES.bulk, {
      docs: [
        { id: 'd1', workspaceId: 'ws_a' },
        { id: 'd2', workspaceId: 'ws_b' },
      ],
      people: [{ principalType: 'user', principalId: 'u_2', level: 'view' }],
      onExisting: 'keep',
      workspace: 'keep',
      link: 'create',
      expiresInDays: 7,
    })
    expect(res).toMatchObject({ ok: true, value: { ok: ['d1', 'd2'], failed: [] } })
    expect(seen.map((s) => `${s.method} ${s.path.slice('/api/v1'.length)}`)).toEqual([
      'PUT /documents/d1/access',
      'POST /documents/d1/links',
      'PUT /documents/d2/access',
      'POST /documents/d2/links',
    ])
  })

  it('wrong-shaped input is invalid_request with no request', async () => {
    const { call } = await setup()
    const seen = stubServer(() => reply(200, {}))
    expect(await call(CHANNEL_NAMES.get, 42)).toMatchObject({ ok: false, error: 'invalid_request' })
    expect(await call(CHANNEL_NAMES.update, undefined)).toMatchObject({
      ok: false,
      error: 'invalid_request',
    })
    expect(seen).toEqual([])
  })
})

interface ShareBridge {
  get(documentId: string): Promise<unknown>
  update(input: unknown): Promise<unknown>
  candidates(input: unknown): Promise<unknown>
  linkCreate(input: unknown): Promise<unknown>
  linkRevoke(input: unknown): Promise<unknown>
  settings(): Promise<unknown>
  requests(documentId: string): Promise<unknown>
  requestApprove(input: unknown): Promise<unknown>
  requestDecline(input: unknown): Promise<unknown>
  bulk(plan: unknown): Promise<unknown>
}

async function loadPreload(replyValue: unknown) {
  vi.resetModules()
  const invoked: Array<{ channel: string; args: unknown[] }> = []
  const exposed: Record<string, unknown> = {}
  vi.doMock('electron', () => ({
    contextBridge: {
      exposeInMainWorld: (key: string, value: unknown) => void (exposed[key] = value),
    },
    ipcRenderer: {
      on: () => undefined,
      invoke: async (channel: string, ...args: unknown[]) => {
        invoked.push({ channel, args })
        return replyValue
      },
      send: () => undefined,
      removeListener: () => undefined,
    },
    webUtils: { getPathForFile: () => '' },
  }))
  await import('../src/preload/index')
  return { share: exposed.uniworkShare as ShareBridge | undefined, invoked }
}

describe('preload: window.uniworkShare', () => {
  afterEach(() => {
    vi.doUnmock('electron')
    vi.resetModules()
  })

  it('exposes one method per channel and passes the arguments through', async () => {
    const { share, invoked } = await loadPreload({ ok: true, value: {} })
    expect(share).toBeDefined()
    const input = { documentId: 'doc_1' }
    await share!.get('doc_1')
    await share!.update(input)
    await share!.candidates(input)
    await share!.linkCreate(input)
    await share!.linkRevoke(input)
    await share!.settings()
    await share!.requests('doc_1')
    await share!.requestApprove(input)
    await share!.requestDecline(input)
    await share!.bulk(input)
    expect(invoked.filter((i) => i.channel.startsWith('uniwork-share:'))).toEqual([
      { channel: CHANNEL_NAMES.get, args: ['doc_1'] },
      { channel: CHANNEL_NAMES.update, args: [input] },
      { channel: CHANNEL_NAMES.candidates, args: [input] },
      { channel: CHANNEL_NAMES.linkCreate, args: [input] },
      { channel: CHANNEL_NAMES.linkRevoke, args: [input] },
      { channel: CHANNEL_NAMES.settings, args: [] },
      { channel: CHANNEL_NAMES.requests, args: ['doc_1'] },
      { channel: CHANNEL_NAMES.requestApprove, args: [input] },
      { channel: CHANNEL_NAMES.requestDecline, args: [input] },
      { channel: CHANNEL_NAMES.bulk, args: [input] },
    ])
  })

  it("returns main's result untouched, a null value included (requests on a server without the route)", async () => {
    const { share } = await loadPreload({ ok: true, value: null })
    expect(await share!.requests('doc_1')).toEqual({ ok: true, value: null })
    const failed = await loadPreload({ ok: false, error: 'forbidden', status: 403 })
    expect(await failed.share!.get('doc_1')).toEqual({ ok: false, error: 'forbidden', status: 403 })
  })

  it('a reply of the wrong shape is malformed_response', async () => {
    for (const bad of [
      undefined,
      null,
      'x',
      7,
      { ok: 'yes' },
      { ok: false },
      { ok: false, error: 3 },
    ]) {
      const { share } = await loadPreload(bad)
      expect(await share!.get('doc_1')).toEqual({ ok: false, error: 'malformed_response' })
    }
  })

  it('keeps only the known failure fields', async () => {
    const { share } = await loadPreload({
      ok: false,
      error: 'document_access_rejected',
      status: 422,
      rejected: [{ index: 0, principalType: 'user', principalId: 'u', code: 'level_not_allowed' }],
      retryable: true,
      stack: 'leak',
    })
    expect(await share!.get('doc_1')).toEqual({
      ok: false,
      error: 'document_access_rejected',
      status: 422,
      rejected: [{ index: 0, principalType: 'user', principalId: 'u', code: 'level_not_allowed' }],
      retryable: true,
    })
  })
})
