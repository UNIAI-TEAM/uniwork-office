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
  breakGlassGrant: 'uniwork-share:break-glass-grant',
  breakGlassRevoke: 'uniwork-share:break-glass-revoke',
  members: 'uniwork-share:members',
  ownerCandidates: 'uniwork-share:owner-candidates',
  transferOwner: 'uniwork-share:owner-transfer',
} as const

describe('the channel table', () => {
  it('has exactly the fifteen uniwork-share channels', () => {
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

  it('break-glass grant / revoke and one members page hit the web routes', async () => {
    const { call } = await setup()
    const seen = stubServer((s) => {
      if (s.path.endsWith('/break-glass') && s.method === 'POST') {
        return reply(201, {
          grant: {
            id: 'bg_1',
            document_id: 'doc_1',
            actor_id: 'u_a',
            granted_at: '2026-10-21T01:00:00Z',
            expires_at: '2026-10-22T01:00:00Z',
          },
        })
      }
      if (s.path.includes('/break-glass/')) return reply(200, { status: 'ok' })
      return reply(200, { members: [{ user_id: 'u_1', display_name: 'Minh' }], next_cursor: 'c2' })
    })
    const granted = await call(CHANNEL_NAMES.breakGlassGrant, {
      documentId: 'doc_1',
      reason: 'Audit of the Q3 file',
    })
    expect(granted).toMatchObject({ ok: true, value: { id: 'bg_1' } })
    expect(
      await call(CHANNEL_NAMES.breakGlassRevoke, { documentId: 'doc_1', grantId: 'bg_1' }),
    ).toEqual({
      ok: true,
      value: { documentId: 'doc_1', grantId: 'bg_1' },
    })
    expect(await call(CHANNEL_NAMES.members, { cursor: 'c1' })).toEqual({
      ok: true,
      value: { members: [{ userId: 'u_1', displayName: 'Minh' }], nextCursor: 'c2' },
    })
    expect(seen.map((s) => `${s.method} ${s.path.slice('/api/v1'.length)}${s.search}`)).toEqual([
      'POST /documents/doc_1/break-glass',
      'DELETE /documents/doc_1/break-glass/bg_1',
      'GET /orgs/acme/members?limit=100&cursor=c1',
    ])
    expect(seen[0]!.body).toEqual({ reason: 'Audit of the Q3 file' })
  })

  it('UNI-2078 owner transfer: candidates read the gate and members, transfer re-reads the gate then PUTs', async () => {
    const { call } = await setup()
    const seen = stubServer((s) => {
      const path = s.path.slice('/api/v1'.length)
      if (path === '/documents/doc_1/shares') {
        return reply(200, {
          my_level: 'manage',
          acl_owner: { user_id: 'u_owner', level: 'manage', via: 'member' },
        })
      }
      if (path === '/documents/doc_1') {
        return reply(200, {
          document: { id: 'doc_1', workspace_id: 'ws_1', visibility: 'workspace' },
        })
      }
      if (path === '/workspaces/ws_1/members') {
        return reply(200, {
          members: [{ user_id: 'u_owner' }, { user_id: 'u_an' }, { user_id: 'u_gone' }],
        })
      }
      if (path === '/orgs/acme/members') {
        return reply(200, {
          members: [
            { user_id: 'u_owner', display_name: 'Hoa', email: 'h@acme.test', status: 'active' },
            { user_id: 'u_an', display_name: 'An Lê', email: 'an@acme.test', status: 'active' },
            {
              user_id: 'u_gone',
              display_name: 'Gone',
              email: 'g@acme.test',
              status: 'deactivated',
            },
          ],
          next_cursor: '',
        })
      }
      return reply(200, {
        document_id: 'doc_1',
        acl_owner_id: 'u_an',
        previous_owner_id: 'u_owner',
        previous_owner_share_id: 'sh_9',
      })
    })
    expect(await call(CHANNEL_NAMES.ownerCandidates, 'doc_1')).toEqual({
      ok: true,
      value: [{ userId: 'u_an', name: 'An Lê', email: 'an@acme.test' }],
    })
    expect(
      await call(CHANNEL_NAMES.transferOwner, {
        documentId: 'doc_1',
        userId: 'u_an',
        previousOwnerLevel: 'none',
      }),
    ).toMatchObject({ ok: true, value: { aclOwnerId: 'u_an', previousOwnerShareId: 'sh_9' } })
    const put = seen.find((s) => s.method === 'PUT')
    expect(put).toMatchObject({
      path: '/api/v1/documents/doc_1/owner',
      body: { user_id: 'u_an', previous_owner_level: 'none' },
    })
    // the PUT comes after main read the gate again
    const routes = seen.map((s) => `${s.method} ${s.path.slice('/api/v1'.length)}`)
    expect(routes.slice(-3)).toEqual([
      'GET /documents/doc_1/shares',
      'GET /documents/doc_1',
      'PUT /documents/doc_1/owner',
    ])
    expect(seen.find((s) => s.path.endsWith('/orgs/acme/members'))?.search).toContain(
      'status=active',
    )
  })

  it('UNI-2078: a server without the owner route answers endpointMissing', async () => {
    const { call } = await setup()
    stubServer((s) => {
      if (s.path.endsWith('/shares'))
        return reply(200, { my_level: 'manage', acl_owner: { user_id: 'u_owner' } })
      if (s.method === 'GET') return reply(200, { document: { id: 'doc_1', workspace_id: 'ws_1' } })
      return new Response('404 page not found', { status: 404 })
    })
    expect(
      await call(CHANNEL_NAMES.transferOwner, { documentId: 'doc_1', userId: 'u_an' }),
    ).toMatchObject({ ok: false, endpointMissing: true, status: 404 })
  })

  it('a refused reason comes back as break_glass_reason_invalid (the 422 verdict)', async () => {
    const { call } = await setup()
    stubServer(() => reply(422, { error: { code: 'break_glass_reason_invalid', message: 'x' } }))
    expect(
      await call(CHANNEL_NAMES.breakGlassGrant, {
        documentId: 'doc_1',
        reason: 'long enough reason',
      }),
    ).toEqual({ ok: false, error: 'break_glass_reason_invalid', status: 422 })
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
  breakGlassGrant(input: unknown): Promise<unknown>
  breakGlassRevoke(input: unknown): Promise<unknown>
  members(input: unknown): Promise<unknown>
  ownerCandidates(documentId: string): Promise<unknown>
  transferOwner(input: unknown): Promise<unknown>
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
    await share!.breakGlassGrant(input)
    await share!.breakGlassRevoke(input)
    await share!.members(input)
    await share!.ownerCandidates('doc_1')
    await share!.transferOwner(input)
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
      { channel: CHANNEL_NAMES.breakGlassGrant, args: [input] },
      { channel: CHANNEL_NAMES.breakGlassRevoke, args: [input] },
      { channel: CHANNEL_NAMES.members, args: [input] },
      { channel: CHANNEL_NAMES.ownerCandidates, args: ['doc_1'] },
      { channel: CHANNEL_NAMES.transferOwner, args: [input] },
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

  it('UNI-2078: keeps endpointMissing on a failure, only when it is true', async () => {
    const { share } = await loadPreload({
      ok: false,
      error: 'not_found',
      status: 404,
      endpointMissing: true,
    })
    expect(await share!.transferOwner({ documentId: 'doc_1', userId: 'u_an' })).toEqual({
      ok: false,
      error: 'not_found',
      status: 404,
      endpointMissing: true,
    })
    const odd = await loadPreload({ ok: false, error: 'not_found', endpointMissing: 'yes' })
    expect(await odd.share!.transferOwner({ documentId: 'doc_1', userId: 'u_an' })).toEqual({
      ok: false,
      error: 'not_found',
    })
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
