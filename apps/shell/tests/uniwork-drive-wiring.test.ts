import type { IpcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import type { FetchLike } from '../src/main/uniwork-docs/client'
import {
  registerUniworkDrive,
  safeGoogleDriveOpenUrl,
  type UniworkDriveDeps,
} from '../src/main/uniwork-drive/wiring'
import {
  NEVER_READ_CAPABILITIES,
  type CapabilityRead,
} from '../src/main/uniwork-sync/capability/cache'
import { UNIWORK_DRIVE_CHANNELS as C } from '../src/shared/uniwork-drive-api'

const PROFILE: DeploymentProfile = {
  deploymentId: 'default',
  apiOrigin: 'https://uniwork.example',
  clientId: 'uniwork-office',
  channel: 'stable',
}
const TOKEN = 'secret-drive-token-7a1c'
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const WIRE_CONNECTION = {
  id: 'conn_1',
  provider: 'google',
  google_email: 'uni-work1@gmail.com',
  status: 'active',
  needs_reconnect: false,
  linked_file_count: 2,
  connected_at: '2026-10-26T08:00:00Z',
  updated_at: '2026-10-26T08:00:00Z',
}

function makeWireFile(openUrl: string) {
  return {
    id: 'df_1',
    organization_id: 'org_1',
    workspace_id: 'ws_1',
    external_file_id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
    name: 'Kế hoạch Q4',
    mime_type: 'application/vnd.google-apps.document',
    icon_kind: 'google_doc',
    web_view_link:
      'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
    open_url: openUrl,
    owner_display: 'Lan',
    sharing_state: 'private',
    connection_id: 'conn_1',
    bound_account_email: 'uni-work1@gmail.com',
    bound_connection_lost: false,
    bound_by_id: 'u_1',
    bound_by_name: 'Minh',
    created_by: 'u_1',
    created_by_kind: 'human',
    created_by_name: 'Minh',
    created_at: '2026-10-26T08:15:00Z',
    updated_at: '2026-10-26T08:15:00Z',
    viewer_access: 'granted',
    viewer_account_email: 'uni-work1@gmail.com',
    can_unlink: true,
    can_rebind: true,
    can_propose: true,
    can_ask: true,
    used_in_count: 0,
    used_in_tasks: [],
    tasks_created: { count: 0 },
  }
}

type Handler = (event: unknown, ...args: unknown[]) => unknown

function shellEvent() {
  const mainFrame = { url: 'app://shell' }
  return { sender: { isDestroyed: () => false, mainFrame }, senderFrame: mainFrame }
}

function setup(
  over: Partial<UniworkDriveDeps> = {},
  fetch: FetchLike = vi.fn<FetchLike>(async (url, init) => {
    const path = new URL(url).pathname.replace('/api/v1', '')
    const method = init.method ?? 'GET'
    if (method === 'GET' && path === '/workspaces/ws_1/drive-connections') {
      return json(200, { connections: [WIRE_CONNECTION] })
    }
    if (method === 'GET' && path === '/workspaces/ws_1/drive-files') {
      return json(200, {
        files: [
          makeWireFile(
            'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?authuser=uni-work1%40gmail.com',
          ),
        ],
        total_count: 1,
        next_cursor: null,
      })
    }
    if (method === 'GET' && path === '/workspaces/ws_1/drive-folders') {
      return json(200, {
        folders: [
          { id: 'f_a', name: 'Hợp đồng', file_count: 2 },
          { id: null, name: null, file_count: 1 },
        ],
      })
    }
    if (method === 'GET' && path === '/workspaces/ws_1/drive-files/df_1') {
      return json(200, {
        file: makeWireFile(
          'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?authuser=uni-work1%40gmail.com',
        ),
      })
    }
    if (method === 'DELETE' && path === '/workspaces/ws_1/drive-files/df_1') {
      return json(200, { status: 'ok' })
    }
    if (method === 'GET' && path === '/workspaces/ws_1/resources/drive_file/df_1/history') {
      return json(200, { events: [] })
    }
    return json(404, { error: { code: 'not_found', message: 'not found' } })
  }),
) {
  const handlers = new Map<string, Handler>()
  const ipc = { handle: (channel: string, fn: Handler) => handlers.set(channel, fn) }
  const openExternal = vi.fn(async (_url: string) => undefined)
  registerUniworkDrive(ipc as unknown as IpcMain, {
    profile: () => PROFILE,
    identity: () => ({ accountId: 'acc_1' }),
    org: () => ({ id: 'org_1', slug: 'acme' }),
    authorized: (call) => call(TOKEN),
    openExternal,
    capability: async (): Promise<CapabilityRead> => ({
      kind: 'ok',
      capabilities: { ...NEVER_READ_CAPABILITIES, drive_connector: true },
      source: 'cached',
    }),
    fetch,
    ...over,
  })
  const call = (channel: string, ...args: unknown[]) =>
    Promise.resolve(handlers.get(channel)!(shellEvent(), ...args))
  return { handlers, call, openExternal, fetch }
}

describe('uniwork-drive IPC wiring', () => {
  it('registers one handler per UNIWORK_DRIVE_CHANNELS entry', () => {
    const { handlers } = setup()
    expect([...handlers.keys()].sort()).toEqual(Object.values(C).sort())
  })

  it('answers is-available from the capability cache with no sync engine involved, and never throws', async () => {
    const capability = vi.fn(async (_orgId: string): Promise<CapabilityRead> => ({
      kind: 'ok',
      capabilities: { ...NEVER_READ_CAPABILITIES, drive_connector: true },
      source: 'fresh',
    }))
    const { call, fetch } = setup({ capability })
    expect(await call(C.isAvailable)).toBe(true)
    expect(capability).toHaveBeenCalledWith('org_1')
    expect(fetch).not.toHaveBeenCalled()

    expect(await setup({ org: () => null }).call(C.isAvailable)).toBe(false)
    expect(await setup({ profile: () => null }).call(C.isAvailable)).toBe(false)
    expect(await setup({ identity: () => null }).call(C.isAvailable)).toBe(false)
    expect(
      await setup({
        capability: async () => ({
          kind: 'ok',
          capabilities: { ...NEVER_READ_CAPABILITIES, drive_connector: false },
          source: 'cached',
        }),
      }).call(C.isAvailable),
    ).toBe(false)
    expect(
      await setup({
        capability: async () => {
          throw new Error('capability cache failure')
        },
      }).call(C.isAvailable),
    ).toBe(false)
  })

  it('answers { ok: true, value } and never leaks the session token', async () => {
    const { call } = setup()
    const connections = await call(C.listConnections, 'ws_1')
    expect(connections).toMatchObject({
      ok: true,
      value: [{ id: 'conn_1', googleEmail: 'uni-work1@gmail.com' }],
    })
    expect(JSON.stringify(connections)).not.toContain(TOKEN)

    const files = await call(C.listFiles, { workspaceId: 'ws_1' })
    expect(files).toMatchObject({
      ok: true,
      value: { totalCount: 1, nextCursor: null },
    })

    const folders = await call(C.listFolders, { workspaceId: 'ws_1', connectionId: 'conn_1' })
    expect(folders).toEqual({
      ok: true,
      value: [
        { id: 'f_a', name: 'Hợp đồng', fileCount: 2 },
        { id: null, name: null, fileCount: 1 },
      ],
    })

    const detail = await call(C.getFile, { workspaceId: 'ws_1', driveFileId: 'df_1' })
    expect(detail).toMatchObject({
      ok: true,
      value: { id: 'df_1', name: 'Kế hoạch Q4' },
    })

    const unlinked = await call(C.unlink, { workspaceId: 'ws_1', driveFileId: 'df_1' })
    expect(unlinked).toEqual({ ok: true, value: null })

    const history = await call(C.getHistory, { workspaceId: 'ws_1', driveFileId: 'df_1' })
    expect(history).toEqual({ ok: true, value: [] })
  })

  describe('get-history actor names', () => {
    const wireEvent = (id: string, kind: string, actor: string) => ({
      id,
      organization_id: 'org_1',
      workspace_id: 'ws_1',
      actor_kind: kind,
      actor_id: actor,
      action: 'drive_file.linked',
      resource_type: 'drive_file',
      resource_id: 'df_1',
      changes: {},
      metadata: {},
      correlation_id: 'c_1',
      occurred_at: '2026-10-26T08:15:00Z',
    })
    const historyFetch = () =>
      vi.fn<FetchLike>(async () =>
        json(200, {
          events: [
            wireEvent('e_1', 'human', 'u_1'),
            wireEvent('e_2', 'human', 'u_gone'),
            wireEvent('e_3', 'agent', 'u_1'),
          ],
        }),
      )
    const target = { workspaceId: 'ws_1', driveFileId: 'df_1' }

    it('attaches the member name for a known person and omits it otherwise', async () => {
      const memberNames = vi.fn(async () => new Map([['u_1', ' Minh ']]))
      const { call } = setup({ memberNames }, historyFetch())
      const res = (await call(C.getHistory, target)) as {
        ok: boolean
        value: Array<{ id: string; actorName?: string }>
      }
      expect(res.ok).toBe(true)
      expect(memberNames).toHaveBeenCalledWith('ws_1')
      expect(res.value.map((e) => e.actorName)).toEqual(['Minh', undefined, undefined])
      expect('actorName' in res.value[1]!).toBe(false)
      expect('actorName' in res.value[2]!).toBe(false)
    })

    it('still answers ok when the member lookup fails', async () => {
      const memberNames = vi.fn(async () => {
        throw new Error('members unreadable')
      })
      const { call } = setup({ memberNames }, historyFetch())
      const res = (await call(C.getHistory, target)) as {
        ok: boolean
        value: Array<{ actorName?: string }>
      }
      expect(res.ok).toBe(true)
      expect(res.value).toHaveLength(3)
      expect(res.value.some((e) => 'actorName' in e)).toBe(false)
    })

    it('still answers ok when the member lookup throws synchronously', async () => {
      const memberNames = vi.fn((): Promise<Map<string, string>> => {
        throw new Error('members unreadable')
      })
      const { call } = setup({ memberNames }, historyFetch())
      const res = (await call(C.getHistory, target)) as {
        ok: boolean
        value: Array<{ actorName?: string }>
      }
      expect(res.ok).toBe(true)
      expect(res.value).toHaveLength(3)
      expect(res.value.some((e) => 'actorName' in e)).toBe(false)
    })
  })

  it('refuses invalid renderer arguments before making any network request', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, {}))
    const { call, openExternal } = setup({}, fetch)

    for (const badWs of [null, undefined, 42, '', '../ws', 'ws/1', { workspaceId: 'ws_1' }]) {
      expect(await call(C.listConnections, badWs)).toEqual({ ok: false, error: 'server_error' })
    }

    for (const badQuery of [
      null,
      'ws_1',
      [],
      {},
      { workspaceId: '../ws' },
      { workspaceId: 'ws_1', connectionId: 'bad/id' },
      { workspaceId: 'ws_1', cursor: 123 },
      { workspaceId: 'ws_1', limit: '50' },
    ]) {
      expect(await call(C.listFiles, badQuery)).toEqual({ ok: false, error: 'server_error' })
    }

    // the folder list is per account: a missing or bad connection never reaches the server
    for (const badQuery of [
      null,
      'ws_1',
      [],
      {},
      { workspaceId: 'ws_1' },
      { workspaceId: 'ws_1', connectionId: '' },
      { workspaceId: 'ws_1', connectionId: 'bad/id' },
      { workspaceId: '../ws', connectionId: 'conn_1' },
      { connectionId: 'conn_1' },
    ]) {
      expect(await call(C.listFolders, badQuery)).toEqual({ ok: false, error: 'server_error' })
    }

    for (const badTarget of [
      null,
      'https://docs.google.com/document/d/1',
      {},
      { workspaceId: 'ws_1' },
      { driveFileId: 'df_1' },
      { workspaceId: '../ws', driveFileId: 'df_1' },
      { workspaceId: 'ws_1', driveFileId: 'df/1' },
      { workspaceId: 'ws_1', driveFileId: '' },
    ]) {
      expect(await call(C.getFile, badTarget)).toEqual({ ok: false, error: 'server_error' })
      expect(await call(C.unlink, badTarget)).toEqual({ ok: false, error: 'server_error' })
      expect(await call(C.openOnGoogle, badTarget)).toEqual({ ok: false, error: 'server_error' })
      expect(await call(C.getHistory, badTarget)).toEqual({ ok: false, error: 'server_error' })
    }

    expect(fetch).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('maps signed-out, session_expired, not_found, forbidden, feature_disabled, auth_failed, network, and server_error without throwing', async () => {
    expect(await setup({ profile: () => null }).call(C.listConnections, 'ws_1')).toEqual({
      ok: false,
      error: 'not_signed_in',
    })
    expect(await setup({ identity: () => null }).call(C.listConnections, 'ws_1')).toEqual({
      ok: false,
      error: 'not_signed_in',
    })
    expect(
      await setup({}, async () => json(401, { error: { code: 'unauthorized' } })).call(
        C.listConnections,
        'ws_1',
      ),
    ).toEqual({
      ok: false,
      error: 'session_expired',
    })
    expect(
      await setup({}, async () => json(404, { error: { code: 'not_found' } })).call(C.getFile, {
        workspaceId: 'ws_1',
        driveFileId: 'df_1',
      }),
    ).toEqual({
      ok: false,
      error: 'not_found',
    })
    // an old server has no folder route: the renderer reads not_found and derives the folders itself
    expect(
      await setup({}, async () => json(404, { error: { code: 'not_found' } })).call(C.listFolders, {
        workspaceId: 'ws_1',
        connectionId: 'conn_1',
      }),
    ).toEqual({ ok: false, error: 'not_found' })
    expect(
      await setup({}, async () => json(200, { ok: true })).call(C.listFolders, {
        workspaceId: 'ws_1',
        connectionId: 'conn_1',
      }),
    ).toEqual({ ok: true, value: null })
    expect(
      await setup({}, async () => json(404, { error: { code: 'feature_disabled' } })).call(
        C.listConnections,
        'ws_1',
      ),
    ).toEqual({
      ok: false,
      error: 'feature_disabled',
    })
    expect(
      await setup({}, async () => json(409, { error: { code: 'auth_failed' } })).call(
        C.listConnections,
        'ws_1',
      ),
    ).toEqual({
      ok: false,
      error: 'auth_failed',
    })
    expect(
      await setup({}, async () => json(403, { error: { code: 'forbidden' } })).call(
        C.listConnections,
        'ws_1',
      ),
    ).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(
      await setup({}, async () => {
        throw new TypeError('network down')
      }).call(C.listConnections, 'ws_1'),
    ).toEqual({
      ok: false,
      error: 'network',
    })
    expect(
      await setup({}, async () => json(200, { invalid: true })).call(C.listConnections, 'ws_1'),
    ).toEqual({
      ok: false,
      error: 'server_error',
    })
  })
})

describe('uniwork-drive IPC: open-on-google host and URL validation', () => {
  it('opens valid https://docs.google.com and https://drive.google.com URLs from the server response', async () => {
    const acceptedUrls = [
      {
        raw: 'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?authuser=uni-work1%40gmail.com',
        canonical:
          'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?authuser=uni-work1%40gmail.com',
      },
      {
        raw: 'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/view?authuser=uni-work1%40gmail.com',
        canonical:
          'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/view?authuser=uni-work1%40gmail.com',
      },
      {
        raw: 'https://DOCS.GOOGLE.COM/document/d/1/edit',
        canonical: 'https://docs.google.com/document/d/1/edit',
      },
    ]

    for (const { raw, canonical } of acceptedUrls) {
      expect(safeGoogleDriveOpenUrl(raw)).toBe(canonical)
      const fetch = vi.fn<FetchLike>(async () => json(200, { file: makeWireFile(raw) }))
      const { call, openExternal } = setup({}, fetch)
      expect(await call(C.openOnGoogle, { workspaceId: 'ws_1', driveFileId: 'df_1' })).toEqual({
        ok: true,
        value: null,
      })
      expect(openExternal).toHaveBeenCalledTimes(1)
      expect(openExternal).toHaveBeenCalledWith(canonical)
    }
  })

  it('refuses http:, foreign hosts, lookalike hosts, userinfo, custom ports, and javascript: without calling openExternal', async () => {
    const refusedUrls = [
      'http://docs.google.com/document/d/1/edit',
      'http://drive.google.com/file/d/1/view',
      'https://evil.com/document/d/1/edit',
      'https://docs.google.com.evil.com/document/d/1/edit',
      'https://sub.evil.docs.google.com.x/document/d/1/edit',
      'https://sub.docs.google.com/document/d/1/edit',
      'https://evildocs.google.com/document/d/1/edit',
      'https://docs.google.com./document/d/1/edit',
      'https://%64ocs.google.com/document/d/1/edit',
      'https://xn--docs-1ga.google.com/document/d/1/edit',
      'https://docs.google.com\\@evil.com/document/d/1/edit',
      'https://user@docs.google.com/document/d/1/edit',
      'https://user:pass@drive.google.com/file/d/1/view',
      'https://docs.google.com@evil.com/document/d/1/edit',
      'https://docs.google.com:8443/document/d/1/edit',
      'https://drive.google.com:443/file/d/1/view',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,<script>alert(1)</script>',
      '',
      'not a url',
    ]

    for (const badUrl of refusedUrls) {
      expect(safeGoogleDriveOpenUrl(badUrl), `safeGoogleDriveOpenUrl(${badUrl})`).toBeNull()
      const fetch = vi.fn<FetchLike>(async () => json(200, { file: makeWireFile(badUrl) }))
      const { call, openExternal } = setup({}, fetch)
      const result = await call(C.openOnGoogle, { workspaceId: 'ws_1', driveFileId: 'df_1' })
      expect(result, `openOnGoogle for ${badUrl}`).toEqual({
        ok: false,
        error: 'server_error',
      })
      expect(openExternal).not.toHaveBeenCalled()
    }
  })
})
