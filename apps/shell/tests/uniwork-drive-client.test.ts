import { describe, expect, it, vi } from 'vitest'
import { TransportError } from '../src/main/uniwork-auth/transport'
import type { FetchLike, UniworkDocsClientOptions } from '../src/main/uniwork-docs/client'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { createUniworkDriveClient } from '../src/main/uniwork-drive/client'
import {
  driveErrorOfDocError,
  type DriveConnection,
  type DriveFile,
  type DriveHistoryEvent,
} from '../src/shared/uniwork-drive-api'

const ORIGIN = 'https://uniwork.example'
const TOKEN = 'secret-drive-token-9b2e'
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const envelope = (status: number, code: string) => json(status, { error: { code, message: 'x' } })

const WIRE_CONNECTION = {
  id: '01J8X4DRVCONN0N1P2Q3R4S5T6',
  provider: 'google',
  google_email: 'uni-work1@gmail.com',
  status: 'active',
  needs_reconnect: false,
  linked_file_count: 3,
  connected_at: '2026-10-26T08:00:00Z',
  updated_at: '2026-10-26T08:00:00Z',
}

const PARSED_CONNECTION: DriveConnection = {
  id: '01J8X4DRVCONN0N1P2Q3R4S5T6',
  provider: 'google',
  googleEmail: 'uni-work1@gmail.com',
  status: 'active',
  needsReconnect: false,
  linkedFileCount: 3,
  connectedAt: '2026-10-26T08:00:00Z',
  updatedAt: '2026-10-26T08:00:00Z',
}

const WIRE_FILE = {
  id: '01J8X4DRVFILE0N1P2Q3R4S5T6',
  organization_id: '01J8X4ORGN1P2Q3R4S5T6U7V8',
  workspace_id: 'ws_1',
  external_file_id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
  drive_id: '0AJ8X4SHAREDDRV001',
  name: 'Kế hoạch ra mắt Q4',
  mime_type: 'application/vnd.google-apps.document',
  icon_kind: 'google_doc',
  web_view_link:
    'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
  open_url:
    'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?authuser=uni-work1%40gmail.com',
  owner_display: 'Lan',
  drive_modified_at: '2026-10-26T07:30:00Z',
  drive_modified_by_display: 'Lan',
  sharing_state: 'private',
  shared_user_count: 4,
  connection_id: '01J8X4DRVCONN0N1P2Q3R4S5T6',
  bound_account_email: 'uni-work1@gmail.com',
  bound_connection_lost: false,
  access_lost_at: '2026-10-26T09:00:00Z',
  bound_by_id: '01J8X4USER0N1P2Q3R4S5T6U7V',
  bound_by_name: 'Minh Nguyễn',
  created_by: '01J8X4USER0N1P2Q3R4S5T6U7V',
  created_by_kind: 'human',
  created_by_name: 'Minh Nguyễn',
  created_at: '2026-10-26T08:15:00Z',
  updated_at: '2026-10-26T08:15:00Z',
  metadata_refreshed_at: '2026-10-26T08:15:00Z',
  viewer_access: 'granted',
  viewer_connection_id: '01J8X4DRVCONN0N1P2Q3R4S5T6',
  viewer_account_email: 'uni-work1@gmail.com',
  can_unlink: true,
  can_rebind: true,
  can_propose: true,
  can_ask: true,
  used_in_count: 1,
  used_in_tasks: [
    {
      task_id: '01J8X4TASKN1P2Q3R4S5T6U7V8',
      identifier: 'UNI-1042',
      title: 'Chuẩn bị kế hoạch ra mắt Q4',
      status: 'todo',
    },
  ],
  tasks_created: {
    count: 4,
    last_created_at: '2026-10-26T09:58:00Z',
    last_created_by_name: 'Minh Nguyễn',
  },
  drive_folder: { id: '1FoLdErIdAbCdEfGhIjK', name: 'Ra mắt Q4' },
  task_creations: [
    {
      proposal_id: '01J8X4PROP0N1P2Q3R4S5T6U7V',
      created_at: '2026-10-26T09:58:00Z',
      created_by_id: '01J8X4USER0N1P2Q3R4S5T6U7V',
      created_by_name: 'Minh Nguyễn',
      tasks: [
        {
          task_id: '01J8X4TASKN1P2Q3R4S5T6U7V8',
          identifier: 'UNI-1042',
          title: 'Chuẩn bị kế hoạch ra mắt Q4',
          status: 'todo',
        },
      ],
    },
  ],
}

const PARSED_FILE: DriveFile = {
  id: '01J8X4DRVFILE0N1P2Q3R4S5T6',
  organizationId: '01J8X4ORGN1P2Q3R4S5T6U7V8',
  workspaceId: 'ws_1',
  externalFileId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
  driveId: '0AJ8X4SHAREDDRV001',
  name: 'Kế hoạch ra mắt Q4',
  mimeType: 'application/vnd.google-apps.document',
  iconKind: 'google_doc',
  webViewLink:
    'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit',
  openUrl:
    'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?authuser=uni-work1%40gmail.com',
  ownerDisplay: 'Lan',
  driveModifiedAt: '2026-10-26T07:30:00Z',
  driveModifiedByDisplay: 'Lan',
  sharingState: 'private',
  sharedUserCount: 4,
  connectionId: '01J8X4DRVCONN0N1P2Q3R4S5T6',
  boundAccountEmail: 'uni-work1@gmail.com',
  boundConnectionLost: false,
  accessLostAt: '2026-10-26T09:00:00Z',
  boundById: '01J8X4USER0N1P2Q3R4S5T6U7V',
  boundByName: 'Minh Nguyễn',
  createdBy: '01J8X4USER0N1P2Q3R4S5T6U7V',
  createdByKind: 'human',
  createdByName: 'Minh Nguyễn',
  createdAt: '2026-10-26T08:15:00Z',
  updatedAt: '2026-10-26T08:15:00Z',
  metadataRefreshedAt: '2026-10-26T08:15:00Z',
  viewerAccess: 'granted',
  viewerConnectionId: '01J8X4DRVCONN0N1P2Q3R4S5T6',
  viewerAccountEmail: 'uni-work1@gmail.com',
  canUnlink: true,
  canRebind: true,
  canPropose: true,
  canAsk: true,
  usedInCount: 1,
  usedInTasks: [
    {
      taskId: '01J8X4TASKN1P2Q3R4S5T6U7V8',
      identifier: 'UNI-1042',
      title: 'Chuẩn bị kế hoạch ra mắt Q4',
      status: 'todo',
    },
  ],
  tasksCreated: {
    count: 4,
    lastCreatedAt: '2026-10-26T09:58:00Z',
    lastCreatedByName: 'Minh Nguyễn',
  },
  driveFolder: { id: '1FoLdErIdAbCdEfGhIjK', name: 'Ra mắt Q4' },
  taskCreations: [
    {
      proposalId: '01J8X4PROP0N1P2Q3R4S5T6U7V',
      createdAt: '2026-10-26T09:58:00Z',
      createdById: '01J8X4USER0N1P2Q3R4S5T6U7V',
      createdByName: 'Minh Nguyễn',
      tasks: [
        {
          taskId: '01J8X4TASKN1P2Q3R4S5T6U7V8',
          identifier: 'UNI-1042',
          title: 'Chuẩn bị kế hoạch ra mắt Q4',
          status: 'todo',
        },
      ],
    },
  ],
}

const WIRE_AUDIT_EVENT = {
  id: '01J8X4AUDIT0N1P2Q3R4S5T6',
  organization_id: '01J8X4ORG0N1P2Q3R4S5T6U7',
  workspace_id: 'ws_1',
  actor_kind: 'human',
  actor_id: '01J8X4USER0N1P2Q3R4S5T6U7V',
  action: 'drive_file.linked',
  resource_type: 'drive_file',
  resource_id: '01J8X4DRVFILE0N1P2Q3R4S5T6',
  changes: {},
  metadata: { google_email: 'uni-work1@gmail.com' },
  correlation_id: '01J8X4CORR0N1P2Q3R4S5T6',
  occurred_at: '2026-10-26T08:15:00Z',
}

const PARSED_AUDIT_EVENT: DriveHistoryEvent = {
  id: '01J8X4AUDIT0N1P2Q3R4S5T6',
  organizationId: '01J8X4ORG0N1P2Q3R4S5T6U7',
  workspaceId: 'ws_1',
  actorKind: 'human',
  actorId: '01J8X4USER0N1P2Q3R4S5T6U7V',
  action: 'drive_file.linked',
  resourceType: 'drive_file',
  resourceID: '01J8X4DRVFILE0N1P2Q3R4S5T6',
  resourceId: '01J8X4DRVFILE0N1P2Q3R4S5T6',
  changes: {},
  metadata: { google_email: 'uni-work1@gmail.com' },
  correlationId: '01J8X4CORR0N1P2Q3R4S5T6',
  occurredAt: '2026-10-26T08:15:00Z',
}

function server(overrides: Record<string, () => Response> = {}) {
  return vi.fn<FetchLike>(async (url, init) => {
    const path = new URL(url).pathname.replace('/api/v1', '')
    const key = `${init.method ?? 'GET'} ${path}`
    const override = overrides[key] ?? overrides[path]
    if (override) return override()
    const bodies: Record<string, unknown> = {
      'GET /workspaces/ws_1/drive-connections': { connections: [WIRE_CONNECTION] },
      'GET /workspaces/ws_1/drive-files': {
        files: [WIRE_FILE],
        total_count: 1,
        next_cursor: null,
      },
      'GET /workspaces/ws_1/drive-files/df_1': { file: WIRE_FILE },
      'DELETE /workspaces/ws_1/drive-files/df_1': { status: 'ok' },
      'GET /workspaces/ws_1/resources/drive_file/df_1/history': {
        events: [WIRE_AUDIT_EVENT],
      },
    }
    return key in bodies ? json(200, bodies[key]) : envelope(404, 'not_found')
  })
}

function client(fetch: FetchLike, extra: Partial<UniworkDocsClientOptions> = {}) {
  return createUniworkDriveClient({
    apiOrigin: ORIGIN,
    authorized: <T>(call: (token: string) => Promise<T>) => call(TOKEN),
    isSignedIn: () => true,
    fetch,
    ...extra,
  })
}

async function errorOf(promise: Promise<unknown>): Promise<{ code: string; serverCode?: string }> {
  try {
    await promise
  } catch (error) {
    if (error instanceof UniworkDocError) {
      return {
        code: error.code,
        ...(error.serverCode ? { serverCode: error.serverCode } : {}),
      }
    }
    return { code: `other:${String(error)}` }
  }
  return { code: 'resolved' }
}

describe('uniwork drive client: routes and query formatting', () => {
  it('calls fixed /api/v1 routes with redirect=error, cache=no-store, and Bearer token', async () => {
    const fetch = server()
    const api = client(fetch)
    await api.listConnections('ws_1')
    await api.listFiles({
      workspaceId: 'ws_1',
      connectionId: 'conn_1',
      cursor: 'cur_abc',
      limit: 25,
    })
    await api.getFile({ workspaceId: 'ws_1', driveFileId: 'df_1' })
    await api.unlink({ workspaceId: 'ws_1', driveFileId: 'df_1' })
    await api.getHistory({ workspaceId: 'ws_1', driveFileId: 'df_1' })

    expect(fetch.mock.calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      `GET ${ORIGIN}/api/v1/workspaces/ws_1/drive-connections`,
      `GET ${ORIGIN}/api/v1/workspaces/ws_1/drive-files?connection_id=conn_1&cursor=cur_abc&limit=25`,
      `GET ${ORIGIN}/api/v1/workspaces/ws_1/drive-files/df_1`,
      `DELETE ${ORIGIN}/api/v1/workspaces/ws_1/drive-files/df_1`,
      `GET ${ORIGIN}/api/v1/workspaces/ws_1/resources/drive_file/df_1/history`,
    ])
    for (const [, init] of fetch.mock.calls) {
      expect(init.redirect).toBe('error')
      expect(init.cache).toBe('no-store')
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
    }
  })

  it('defaults limit to 50 and clamps limit > 100 to 100 when optional filters are omitted', async () => {
    const fetch = server()
    const api = client(fetch)
    await api.listFiles({ workspaceId: 'ws_1' })
    await api.listFiles({ workspaceId: 'ws_1', limit: 250 })
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${ORIGIN}/api/v1/workspaces/ws_1/drive-files?limit=50`,
      `${ORIGIN}/api/v1/workspaces/ws_1/drive-files?limit=100`,
    ])
  })

  it('sends the folder filter as drive_folder_id: a Google folder id or none, with the other filters and the cursor', async () => {
    const fetch = server()
    const api = client(fetch)
    await api.listFiles({
      workspaceId: 'ws_1',
      connectionId: 'conn_1',
      driveFolderId: '1AbCdEfGhIjK_lmn-OP',
      cursor: 'cur_abc',
      limit: 25,
    })
    await api.listFiles({ workspaceId: 'ws_1', driveFolderId: 'none' })
    // absent, null and empty mean no filter
    await api.listFiles({ workspaceId: 'ws_1', driveFolderId: undefined })
    await api.listFiles({ workspaceId: 'ws_1', driveFolderId: '' })
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${ORIGIN}/api/v1/workspaces/ws_1/drive-files?connection_id=conn_1&drive_folder_id=1AbCdEfGhIjK_lmn-OP&cursor=cur_abc&limit=25`,
      `${ORIGIN}/api/v1/workspaces/ws_1/drive-files?drive_folder_id=none&limit=50`,
      `${ORIGIN}/api/v1/workspaces/ws_1/drive-files?limit=50`,
      `${ORIGIN}/api/v1/workspaces/ws_1/drive-files?limit=50`,
    ])
  })

  it('refuses a folder filter that is neither none nor shaped like a Google id, before any request', async () => {
    const fetch = server()
    const api = client(fetch)
    for (const driveFolderId of [
      'short',
      'has space in id',
      'a/b/c/d/e/f/g/h',
      'x'.repeat(257),
      'NONE',
      'none ',
      42,
      {},
    ]) {
      await expect(
        api.listFiles({ workspaceId: 'ws_1', driveFolderId } as never),
      ).rejects.toMatchObject({ code: 'server_error' })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses invalid IDs or bad query arguments before making any network request', async () => {
    const fetch = server()
    const api = client(fetch)
    await expect(api.listConnections('../etc')).rejects.toMatchObject({ code: 'not_found' })
    await expect(api.listConnections('')).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      api.listFiles({ workspaceId: 'ws_1', connectionId: 'bad/id' }),
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      api.listFiles({ workspaceId: 'ws_1', cursor: 'x'.repeat(600) }),
    ).rejects.toMatchObject({ code: 'server_error' })
    await expect(api.listFiles({ workspaceId: 'ws_1', limit: 0 })).rejects.toMatchObject({
      code: 'server_error',
    })
    await expect(api.getFile({ workspaceId: 'ws_1', driveFileId: 'bad id' })).rejects.toMatchObject(
      { code: 'not_found' },
    )
    await expect(api.unlink({ workspaceId: '../ws', driveFileId: 'df_1' })).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(api.getHistory({ workspaceId: 'ws_1', driveFileId: '' })).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('uniwork drive client: parsing', () => {
  it('parses full connection, file list, file detail, unlink status, and history events', async () => {
    const api = client(server())
    expect(await api.listConnections('ws_1')).toEqual([PARSED_CONNECTION])
    expect(await api.listFiles({ workspaceId: 'ws_1' })).toEqual({
      files: [PARSED_FILE],
      totalCount: 1,
      nextCursor: null,
    })
    expect(await api.getFile({ workspaceId: 'ws_1', driveFileId: 'df_1' })).toEqual(PARSED_FILE)
    expect(await api.unlink({ workspaceId: 'ws_1', driveFileId: 'df_1' })).toBeNull()
    expect(await api.getHistory({ workspaceId: 'ws_1', driveFileId: 'df_1' })).toEqual([
      PARSED_AUDIT_EVENT,
    ])
  })

  it('parses responses when optional keys are absent (omitempty) and handles next_cursor string or null', async () => {
    const minimalConnection = {
      id: 'c_min',
      provider: 'google',
      google_email: 'min@example.com',
      status: 'needs_reconnect',
      needs_reconnect: true,
      linked_file_count: 0,
      connected_at: '2026-10-26T08:00:00Z',
      updated_at: '2026-10-26T08:00:00Z',
    }
    const minimalFile = {
      id: 'df_min',
      organization_id: 'org_1',
      workspace_id: 'ws_1',
      external_file_id: 'ext_1',
      name: 'Minimal Doc',
      mime_type: 'text/plain',
      icon_kind: 'future_icon_kind',
      web_view_link: 'https://drive.google.com/file/d/ext_1/view',
      open_url: 'https://drive.google.com/file/d/ext_1/view',
      owner_display: 'Minh',
      sharing_state: 'future_sharing_state',
      connection_id: 'c_min',
      bound_account_email: 'min@example.com',
      bound_connection_lost: true,
      bound_by_id: 'u_1',
      bound_by_name: 'Minh',
      created_by: 'u_1',
      created_by_kind: 'human',
      created_by_name: 'Minh',
      created_at: '2026-10-26T08:00:00Z',
      updated_at: '2026-10-26T08:00:00Z',
      viewer_access: 'future_viewer_access',
      can_unlink: false,
      can_rebind: false,
      can_propose: false,
      can_ask: false,
      used_in_count: 0,
      used_in_tasks: [],
      tasks_created: { count: 0 },
    }
    const fetch = server({
      'GET /workspaces/ws_1/drive-connections': () =>
        json(200, { connections: [minimalConnection] }),
      'GET /workspaces/ws_1/drive-files': () =>
        json(200, {
          files: [minimalFile],
          total_count: 1,
          next_cursor: 'cursor_page_2',
        }),
    })
    const api = client(fetch)
    const connections = await api.listConnections('ws_1')
    expect(connections[0]).toEqual({
      id: 'c_min',
      provider: 'google',
      googleEmail: 'min@example.com',
      status: 'needs_reconnect',
      needsReconnect: true,
      linkedFileCount: 0,
      connectedAt: '2026-10-26T08:00:00Z',
      updatedAt: '2026-10-26T08:00:00Z',
    })
    expect('authFailedAt' in connections[0]!).toBe(false)

    const page = await api.listFiles({ workspaceId: 'ws_1' })
    expect(page.nextCursor).toBe('cursor_page_2')
    expect(page.files[0]?.iconKind).toBe('future_icon_kind')
    expect(page.files[0]?.sharingState).toBe('future_sharing_state')
    expect(page.files[0]?.viewerAccess).toBe('future_viewer_access')
    expect(page.files[0]?.tasksCreated).toEqual({ count: 0 })
    expect('driveId' in page.files[0]!).toBe(false)
    expect('taskCreations' in page.files[0]!).toBe(false)
    // an older server that does not send drive_folder reads as "parent unknown"
    expect(page.files[0]?.driveFolder).toBeNull()
  })

  it('reads drive_folder leniently: named, unnamed, absent and malformed values never throw', async () => {
    const row = (driveFolder: unknown) => ({
      ...WIRE_FILE,
      ...(driveFolder === undefined ? { drive_folder: undefined } : { drive_folder: driveFolder }),
    })
    const cases: Array<[unknown, unknown]> = [
      [
        { id: 'f_a', name: 'Hợp đồng' },
        { id: 'f_a', name: 'Hợp đồng' },
      ],
      [
        { id: 'f_b', name: null },
        { id: 'f_b', name: null },
      ],
      [{ id: 'f_c' }, { id: 'f_c', name: null }],
      [
        { id: 'f_t', name: '  Báo giá  ' },
        { id: 'f_t', name: 'Báo giá' },
      ],
      [
        { id: 'f_d', name: '   ' },
        { id: 'f_d', name: null },
      ],
      [
        { id: 'f_e', name: 42 },
        { id: 'f_e', name: null },
      ],
      [undefined, null],
      [null, null],
      ['f_a', null],
      [['f_a'], null],
      [{ id: '', name: 'x' }, null],
      [{ id: 7, name: 'x' }, null],
      [{ name: 'only a name' }, null],
    ]
    const fetch = server({
      'GET /workspaces/ws_1/drive-files': () =>
        json(200, {
          files: cases.map(([wire]) => row(wire)),
          total_count: cases.length,
          next_cursor: null,
        }),
    })
    const page = await client(fetch).listFiles({ workspaceId: 'ws_1' })
    expect(page.files.map((f) => f.driveFolder)).toEqual(cases.map(([, parsed]) => parsed))
  })

  it('reads the drive_folder_id echo: a string or null as sent, anything else as absent (an old server)', async () => {
    const echoOf = async (body: Record<string, unknown>) => {
      const fetch = server({
        'GET /workspaces/ws_1/drive-files': () =>
          json(200, { files: [], total_count: 0, next_cursor: null, ...body }),
      })
      return client(fetch).listFiles({ workspaceId: 'ws_1' })
    }
    expect((await echoOf({ drive_folder_id: 'f_abcdefghij' })).driveFolderId).toBe('f_abcdefghij')
    expect((await echoOf({ drive_folder_id: 'none' })).driveFolderId).toBe('none')
    // null = the server applied no filter: kept apart from "key absent"
    const none = await echoOf({ drive_folder_id: null })
    expect(none.driveFolderId).toBeNull()
    expect('driveFolderId' in none).toBe(true)
    // absent, and values that cannot be an echo, never throw and read as absent
    for (const drive_folder_id of [undefined, '', 7, true, {}, ['none']]) {
      const page = await echoOf(drive_folder_id === undefined ? {} : { drive_folder_id })
      expect('driveFolderId' in page).toBe(false)
    }
  })

  it('turns malformed / partial JSON bodies into malformed_response (mapped to server_error)', async () => {
    const malformedBodies: unknown[] = [
      null,
      'not-an-object',
      {},
      { connections: 'not-an-array' },
      { connections: [{ id: 'c_1' }] },
    ]
    for (const body of malformedBodies) {
      const fetch = server({
        'GET /workspaces/ws_1/drive-connections': () => json(200, body),
      })
      const err = await errorOf(client(fetch).listConnections('ws_1'))
      expect(err.code).toBe('malformed_response')
      expect(driveErrorOfDocError(err.code as never, err.serverCode)).toBe('server_error')
    }

    const malformedFileBodies: unknown[] = [
      {},
      { files: null, total_count: 0, next_cursor: null },
      { files: [{ id: 'df_1', name: 123 }], total_count: 1, next_cursor: null },
    ]
    for (const body of malformedFileBodies) {
      const fetch = server({
        'GET /workspaces/ws_1/drive-files': () => json(200, body),
      })
      const err = await errorOf(client(fetch).listFiles({ workspaceId: 'ws_1' }))
      expect(err.code).toBe('malformed_response')
    }

    const badStatusFetch = server({
      'DELETE /workspaces/ws_1/drive-files/df_1': () => json(200, { status: 'failed' }),
    })
    expect(
      (await errorOf(client(badStatusFetch).unlink({ workspaceId: 'ws_1', driveFileId: 'df_1' })))
        .code,
    ).toBe('malformed_response')
  })
})

describe('uniwork drive client: folder list (UNI-2223 v3)', () => {
  it('asks GET drive-folders for one connection and reads the counts', async () => {
    const fetch = server({
      'GET /workspaces/ws_1/drive-folders': () =>
        json(200, {
          folders: [
            { id: 'f_a', name: 'Hợp đồng', file_count: 4 },
            { id: 'f_b', name: null, file_count: 2 },
            { id: null, name: null, file_count: 1 },
          ],
        }),
    })
    const folders = await client(fetch).listFolders({ workspaceId: 'ws_1', connectionId: 'conn_1' })
    expect(fetch.mock.calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      `GET ${ORIGIN}/api/v1/workspaces/ws_1/drive-folders?drive_connection_id=conn_1`,
    ])
    expect(folders).toEqual([
      { id: 'f_a', name: 'Hợp đồng', fileCount: 4 },
      { id: 'f_b', name: null, fileCount: 2 },
      { id: null, name: null, fileCount: 1 },
    ])
  })

  it('reads the list leniently: bad entries are dropped, no list at all is null', async () => {
    const answer = (body: unknown) =>
      client(server({ 'GET /workspaces/ws_1/drive-folders': () => json(200, body) })).listFolders({
        workspaceId: 'ws_1',
        connectionId: 'conn_1',
      })
    expect(
      await answer({
        folders: [
          { id: 'f_ok', name: '  Báo giá ', file_count: 3 },
          { id: 'f_blank', name: '   ', file_count: 0 },
          { id: 'f_num', name: 7, file_count: 1 },
          { id: 'f_nocount', name: 'x' },
          { id: 'f_neg', name: 'x', file_count: -1 },
          { id: 'f_frac', name: 'x', file_count: 1.5 },
          { id: 'f_str', name: 'x', file_count: '3' },
          { id: '', name: 'x', file_count: 1 },
          { id: 9, name: 'x', file_count: 1 },
          { name: 'no id key', file_count: 5 },
          'f_a',
          null,
          ['f_a'],
        ],
      }),
    ).toEqual([
      { id: 'f_ok', name: 'Báo giá', fileCount: 3 },
      { id: 'f_blank', name: null, fileCount: 0 },
      { id: 'f_num', name: null, fileCount: 1 },
      // an entry without an id key is the no-folder group, like an explicit null
      { id: null, name: 'no id key', fileCount: 5 },
    ])
    expect(await answer({ folders: [] })).toEqual([])
    for (const body of [{}, { folders: null }, { folders: 'x' }, { folders: { a: 1 } }, [], null]) {
      expect(await answer(body)).toBeNull()
    }
  })

  it('an old server (404) comes back as not_found; a missing or bad connection is refused locally', async () => {
    const err = await errorOf(
      client(server()).listFolders({ workspaceId: 'ws_1', connectionId: 'conn_1' }),
    )
    expect(driveErrorOfDocError(err.code as never, err.serverCode)).toBe('not_found')

    const fetch = server()
    const api = client(fetch)
    await expect(api.listFolders({ workspaceId: 'ws_1', connectionId: '' })).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(
      api.listFolders({ workspaceId: 'ws_1', connectionId: 'bad/id' }),
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      api.listFolders({ workspaceId: '../ws', connectionId: 'conn_1' }),
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(api.listFolders({ workspaceId: 'ws_1' } as never)).rejects.toMatchObject({
      code: 'server_error',
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('uniwork drive client: errors and driveErrorOfDocError', () => {
  it('maps network, not_signed_in, session_expired, not_found, forbidden, feature_disabled, auth_failed, and server_error', async () => {
    // network failure
    const netErr = await errorOf(
      client(async () => {
        throw new TypeError('fetch failed')
      }).listConnections('ws_1'),
    )
    expect(driveErrorOfDocError(netErr.code as never, netErr.serverCode)).toBe('network')

    // not signed in
    const unsignedErr = await errorOf(
      client(server(), { isSignedIn: () => false }).listConnections('ws_1'),
    )
    expect(driveErrorOfDocError(unsignedErr.code as never, unsignedErr.serverCode)).toBe(
      'not_signed_in',
    )

    // 401 session expired after refresh retry
    const fetch401 = vi.fn<FetchLike>(async () => envelope(401, 'unauthorized'))
    const authorized = async <T>(call: (token: string) => Promise<T>): Promise<T> => {
      try {
        return await call('tok-1')
      } catch (error) {
        if (!(error instanceof TransportError) || error.code !== 'unauthorized') throw error
        return call('tok-2')
      }
    }
    const expErr = await errorOf(client(fetch401, { authorized }).listConnections('ws_1'))
    expect(fetch401).toHaveBeenCalledTimes(2)
    expect(driveErrorOfDocError(expErr.code as never, expErr.serverCode)).toBe('session_expired')

    // 404 not_found
    const notFoundErr = await errorOf(
      client(async () => envelope(404, 'not_found')).getFile({
        workspaceId: 'ws_1',
        driveFileId: 'df_1',
      }),
    )
    expect(driveErrorOfDocError(notFoundErr.code as never, notFoundErr.serverCode)).toBe(
      'not_found',
    )

    // 404 feature_disabled
    const featDisabledErr = await errorOf(
      client(async () => envelope(404, 'feature_disabled')).listConnections('ws_1'),
    )
    expect(featDisabledErr.serverCode).toBe('feature_disabled')
    expect(driveErrorOfDocError(featDisabledErr.code as never, featDisabledErr.serverCode)).toBe(
      'feature_disabled',
    )

    // 409 auth_failed
    const authFailedErr = await errorOf(
      client(async () => envelope(409, 'auth_failed')).getFile({
        workspaceId: 'ws_1',
        driveFileId: 'df_1',
      }),
    )
    expect(authFailedErr.serverCode).toBe('auth_failed')
    expect(driveErrorOfDocError(authFailedErr.code as never, authFailedErr.serverCode)).toBe(
      'auth_failed',
    )

    // 403 forbidden
    const forbiddenErr = await errorOf(
      client(async () => envelope(403, 'forbidden')).listConnections('ws_1'),
    )
    expect(driveErrorOfDocError(forbiddenErr.code as never, forbiddenErr.serverCode)).toBe(
      'forbidden',
    )

    // 500 server_error
    const serverErr = await errorOf(
      client(async () => json(500, { error: { code: 'internal_error' } })).listConnections('ws_1'),
    )
    expect(driveErrorOfDocError(serverErr.code as never, serverErr.serverCode)).toBe('server_error')
  })
})
