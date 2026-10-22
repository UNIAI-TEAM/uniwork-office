import { describe, expect, it, vi } from 'vitest'
import type { FetchLike } from '../src/main/uniwork-docs/client'
import { createDocHistoryClient } from '../src/main/uniwork-docs/doc-history-client'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'

/**
 * UNI-2077: the history client talks to the same routes as the web
 * (`documents-versions.ts`, listDocumentAccessLogs): paths, queries, bodies and
 * the Idempotency-Key are pinned here, rows are read the way the web's zod
 * schemas read them (defaults for absent fields, a broken row fails the page),
 * and the server's refusals reach the caller coded.
 */

const ORIGIN = 'https://uniwork.example'
const API = `${ORIGIN}/api/v1`
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const envelope = (status: number, code: string, fields?: Record<string, unknown>) =>
  json(status, { error: { code, message: 'x', ...(fields ? { fields } : {}) } })

interface Seen {
  url: string
  method: string
  body: unknown
  headers: Record<string, string>
}

function setup(answer: (seen: Seen) => Response) {
  const seen: Seen[] = []
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    const entry: Seen = {
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    }
    seen.push(entry)
    return answer(entry)
  })
  const client = createDocHistoryClient({
    apiOrigin: ORIGIN,
    authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
    isSignedIn: () => true,
    fetch,
  })
  return { client, seen }
}

async function failure(promise: Promise<unknown>): Promise<UniworkDocError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(UniworkDocError)
    return error as UniworkDocError
  }
  throw new Error('expected a failure')
}

const WIRE_VERSION = {
  id: 'ver_3',
  document_id: 'doc_1',
  version: 3,
  kind: 'file',
  reason: 'manual',
  label: 'Gửi khách',
  file_id: 'file_3',
  mime_type: 'application/pdf',
  size_bytes: 2048,
  checksum_sha256: 'abc',
  restored_from: null,
  engine_name: 'x',
  download_url: '/api/v1/documents/doc_1/download?version=3',
  created_by: 'u_1',
  created_by_kind: 'human',
  created_at: '2099-01-01T00:00:00Z',
}

describe('listVersions', () => {
  it('GETs /documents/{id}/versions with cursor and limit, rows newest first as sent', async () => {
    const { client, seen } = setup(() => json(200, { versions: [WIRE_VERSION], next_cursor: 'c2' }))
    const page = await client.listVersions('doc_1', { cursor: 'c1', limit: 50 })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      url: `${API}/documents/doc_1/versions?cursor=c1&limit=50`,
      method: 'GET',
    })
    expect(seen[0]!.headers.Authorization).toBe('Bearer tok')
    expect(page.next_cursor).toBe('c2')
    expect(page.versions).toEqual([
      {
        id: 'ver_3',
        document_id: 'doc_1',
        version: 3,
        kind: 'file',
        reason: 'manual',
        label: 'Gửi khách',
        file_id: 'file_3',
        mime_type: 'application/pdf',
        size_bytes: 2048,
        checksum_sha256: 'abc',
        restored_from: null,
        created_by: 'u_1',
        created_by_kind: 'human',
        created_at: '2099-01-01T00:00:00Z',
      },
    ])
  })

  it('fills the web defaults for absent fields and a null next_cursor', async () => {
    const { client, seen } = setup(() =>
      json(200, { versions: [{ id: 'v', document_id: 'doc_1', version: 1 }] }),
    )
    const page = await client.listVersions('doc_1')
    expect(seen[0]!.url).toBe(`${API}/documents/doc_1/versions?limit=50`)
    expect(page).toEqual({
      next_cursor: null,
      versions: [
        {
          id: 'v',
          document_id: 'doc_1',
          version: 1,
          kind: 'page',
          reason: 'manual',
          label: null,
          file_id: null,
          mime_type: null,
          size_bytes: 0,
          checksum_sha256: null,
          restored_from: null,
          created_by: '',
          created_by_kind: 'human',
          created_at: '',
        },
      ],
    })
  })

  it('clamps the limit to the server cap of 100', async () => {
    const { client, seen } = setup(() => json(200, { versions: [] }))
    await client.listVersions('doc_1', { limit: 1000 })
    expect(seen[0]!.url).toBe(`${API}/documents/doc_1/versions?limit=100`)
  })

  it('a page with a broken row, or no versions array, is malformed_response (never an empty page)', async () => {
    const broken = setup(() => json(200, { versions: [{ id: 'v', version: 'x' }] }))
    expect((await failure(broken.client.listVersions('doc_1'))).code).toBe('malformed_response')
    const missing = setup(() => json(200, { items: [] }))
    expect((await failure(missing.client.listVersions('doc_1'))).code).toBe('malformed_response')
  })

  it('refuses an id that is not an id before any request', async () => {
    const { client, seen } = setup(() => json(200, { versions: [] }))
    expect((await failure(client.listVersions('../x'))).code).toBe('not_found')
    expect(seen).toHaveLength(0)
  })
})

describe('getVersion', () => {
  it('GETs /documents/{id}/versions/{no} and keeps a page version content', async () => {
    const content = { type: 'doc', content: [] }
    const { client, seen } = setup(() =>
      json(200, { version: { id: 'v1', document_id: 'doc_1', version: 1, kind: 'page', content } }),
    )
    const version = await client.getVersion('doc_1', 1)
    expect(seen[0]).toMatchObject({ url: `${API}/documents/doc_1/versions/1`, method: 'GET' })
    expect(version).toMatchObject({ id: 'v1', kind: 'page', content })
  })

  it('an answer for another number is malformed_response', async () => {
    const { client } = setup(() => json(200, { version: { ...WIRE_VERSION, version: 4 } }))
    expect((await failure(client.getVersion('doc_1', 3))).code).toBe('malformed_response')
  })

  it('refuses a version number below 1 or not an integer before any request', async () => {
    const { client, seen } = setup(() => json(200, { version: WIRE_VERSION }))
    expect((await failure(client.getVersion('doc_1', 0))).code).toBe('not_found')
    expect((await failure(client.getVersion('doc_1', 1.5))).code).toBe('not_found')
    expect(seen).toHaveLength(0)
  })
})

describe('getDocumentHead', () => {
  it('reads only the kind and revision of GET /documents/{id} (a page has no file block)', async () => {
    const { client, seen } = setup(() =>
      json(200, { document: { id: 'doc_1', kind: 'page', revision: '41', title: 'P' } }),
    )
    expect(await client.getDocumentHead('doc_1')).toEqual({ kind: 'page', revision: '41' })
    expect(seen[0]).toMatchObject({ url: `${API}/documents/doc_1`, method: 'GET' })
  })

  it('a revision that is not a decimal string is malformed_response', async () => {
    const { client } = setup(() => json(200, { document: { kind: 'file', revision: 41 } }))
    expect((await failure(client.getDocumentHead('doc_1'))).code).toBe('malformed_response')
  })
})

describe('createVersion', () => {
  it('POSTs {label} with the Idempotency-Key and reads the created version', async () => {
    const { client, seen } = setup(() => json(201, { version: WIRE_VERSION }))
    const version = await client.createVersion('doc_1', { label: 'Gửi khách' }, 'key_12345678')
    expect(seen[0]).toMatchObject({
      url: `${API}/documents/doc_1/versions`,
      method: 'POST',
      body: { label: 'Gửi khách' },
    })
    expect(seen[0]!.headers['Idempotency-Key']).toBe('key_12345678')
    expect(version.version).toBe(3)
  })

  it('sends an empty body without a label', async () => {
    const { client, seen } = setup(() => json(201, { version: WIRE_VERSION }))
    await client.createVersion('doc_1', {}, 'key_12345678')
    expect(seen[0]!.body).toEqual({})
  })

  it('409 document_version_unchanged keeps its server code', async () => {
    const { client } = setup(() => envelope(409, 'document_version_unchanged'))
    const error = await failure(client.createVersion('doc_1', {}, 'key_12345678'))
    expect(error.serverCode).toBe('document_version_unchanged')
    expect(error.status).toBe(409)
  })
})

describe('restoreVersion', () => {
  const RESULT = {
    document: { id: 'doc_1', kind: 'file', title: 'Báo cáo', revision: '43', current_version: 4 },
    version: { ...WIRE_VERSION, id: 'ver_4', version: 4, reason: 'restore', restored_from: 2 },
  }

  it('POSTs base_revision + edit_lock_id with the Idempotency-Key and reads document + version', async () => {
    const { client, seen } = setup(() => json(200, RESULT))
    const out = await client.restoreVersion('doc_1', 2, {
      idempotencyKey: 'key_12345678',
      baseRevision: '42',
      editLockId: 'lock_1',
    })
    expect(seen[0]).toMatchObject({
      url: `${API}/documents/doc_1/versions/2/restore`,
      method: 'POST',
      body: { base_revision: '42', edit_lock_id: 'lock_1' },
    })
    expect(seen[0]!.headers['Idempotency-Key']).toBe('key_12345678')
    expect(out.document).toEqual({
      id: 'doc_1',
      kind: 'file',
      title: 'Báo cáo',
      revision: '43',
      current_version: 4,
    })
    expect(out.version).toMatchObject({ id: 'ver_4', reason: 'restore', restored_from: 2 })
  })

  it('a page restore sends no body (the web sends none)', async () => {
    const { client, seen } = setup(() => json(200, RESULT))
    await client.restoreVersion('doc_1', 2, { idempotencyKey: 'key_12345678' })
    expect(seen[0]!.body).toBeUndefined()
  })

  it('an answer without a readable document is malformed_response', async () => {
    const { client } = setup(() => json(200, { version: RESULT.version }))
    const error = await failure(
      client.restoreVersion('doc_1', 2, { idempotencyKey: 'key_12345678' }),
    )
    expect(error.code).toBe('malformed_response')
  })

  it('423 document_locked is edit_locked with the holder, 409 document_version_conflict is conflict', async () => {
    const locked = setup(() =>
      envelope(423, 'document_locked', { holder_name: 'Bình', expires_at: '2099-01-01T00:00:00Z' }),
    )
    const lockError = await failure(
      locked.client.restoreVersion('doc_1', 2, { idempotencyKey: 'key_12345678' }),
    )
    expect(lockError.code).toBe('edit_locked')
    expect(lockError.editLock?.holderName).toBe('Bình')
    const stale = setup(() =>
      envelope(409, 'document_version_conflict', { current_revision: '50' }),
    )
    const conflict = await failure(
      stale.client.restoreVersion('doc_1', 2, {
        idempotencyKey: 'key_12345678',
        baseRevision: '42',
      }),
    )
    expect(conflict.code).toBe('conflict')
    expect(conflict.currentRevision).toBe('50')
  })

  it('refuses a base revision that is not a decimal string before any request', async () => {
    const { client, seen } = setup(() => json(200, RESULT))
    const error = await failure(
      client.restoreVersion('doc_1', 2, { idempotencyKey: 'key_12345678', baseRevision: '4x' }),
    )
    expect(error.serverCode).toBe('invalid_input')
    expect(seen).toHaveLength(0)
  })
})

describe('listAccessLogs', () => {
  const ROW = {
    id: 'log_1',
    action: 'download',
    via: 'link',
    version: 3,
    actor_kind: 'anonymous',
    share_link_id: 'link_1',
    occurred_at: '2099-01-01T00:00:00Z',
  }

  it('GETs /documents/{id}/access-logs with cursor, limit and action', async () => {
    const { client, seen } = setup(() => json(200, { logs: [ROW], next_cursor: null }))
    const page = await client.listAccessLogs('doc_1', {
      cursor: 'c1',
      limit: 50,
      action: 'download',
    })
    expect(seen[0]).toMatchObject({
      url: `${API}/documents/doc_1/access-logs?cursor=c1&limit=50&action=download`,
      method: 'GET',
    })
    expect(page).toEqual({
      next_cursor: null,
      logs: [
        {
          id: 'log_1',
          action: 'download',
          via: 'link',
          version: 3,
          actor_kind: 'anonymous',
          actor_id: null,
          actor: null,
          share_link_id: 'link_1',
          occurred_at: '2099-01-01T00:00:00Z',
        },
      ],
    })
  })

  it('keeps a resolved actor and drops an unreadable one', async () => {
    const { client } = setup(() =>
      json(200, {
        logs: [
          {
            ...ROW,
            actor_kind: 'human',
            actor_id: 'u_1',
            actor: { id: 'u_1', kind: 'human', display_name: 'An', avatar_url: 'https://a/x.png' },
          },
          { ...ROW, id: 'log_2', actor_kind: 'human', actor: { id: 'u_2' } },
        ],
      }),
    )
    const page = await client.listAccessLogs('doc_1')
    expect(page.logs[0]!.actor).toEqual({
      id: 'u_1',
      kind: 'human',
      display_name: 'An',
      avatar_url: 'https://a/x.png',
    })
    expect(page.logs[1]!.actor).toBeNull()
  })

  it('refuses an action outside the four before any request', async () => {
    const { client, seen } = setup(() => json(200, { logs: [] }))
    const error = await failure(
      client.listAccessLogs('doc_1', { action: 'delete' as unknown as 'view' }),
    )
    expect(error.serverCode).toBe('invalid_input')
    expect(seen).toHaveLength(0)
  })

  it('403 is forbidden (manage only) and a page without logs is malformed_response', async () => {
    const denied = setup(() => envelope(403, 'forbidden_level'))
    expect((await failure(denied.client.listAccessLogs('doc_1'))).code).toBe('forbidden')
    const broken = setup(() => json(200, { entries: [] }))
    expect((await failure(broken.client.listAccessLogs('doc_1'))).code).toBe('malformed_response')
  })
})
