import { describe, expect, it, vi } from 'vitest'
import { createUniworkEditLockClient } from '../src/main/uniwork-edit-lock/client'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import type { FetchLike } from '../src/main/uniwork-docs/client'

const ORIGIN = 'https://uniwork.example'
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const LOCK = '01J8X4LOCK0N1P2Q3R4S5T6U7V'
const EDITOR = '01J8X4ED1T0R0000000000000A'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const envelope = (status: number, code: string, fields?: Record<string, unknown>) =>
  json(status, { error: { code, message: 'x', ...(fields ? { fields } : {}) } })

function client(fetch: FetchLike) {
  return createUniworkEditLockClient({
    apiOrigin: ORIGIN,
    authorized: (call) => call('tok'),
    isSignedIn: () => true,
    fetch,
  })
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return error instanceof UniworkDocError ? error.code : `other:${String(error)}`
  }
  return 'resolved'
}

const TENURE = {
  lock_id: LOCK,
  document_id: DOC,
  holder_id: '01J8X4USR0N1P2Q3R4S5T6U7',
  client: 'desktop',
  acquired_at: '2026-10-15T03:12:00Z',
  expires_at: '2026-10-15T03:14:00Z',
  granted_via: 'acquire',
  heartbeat_interval_ms: 30_000,
  ttl_ms: 120_000,
  server_time: '2026-10-15T03:12:00Z',
}

describe('uniwork-edit-lock client (R1-R4)', () => {
  it('R1 GET /documents/{id}/edit-lock parses a free lock', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, {
        lock: null,
        my_request: null,
        pending_requests: [],
        can_take_over: false,
        can_request: true,
        server_time: '2026-10-15T03:12:00Z',
      }),
    )
    const state = await client(fetch).getState(DOC)
    expect(state).toEqual({
      lock: null,
      serverTime: '2026-10-15T03:12:00Z',
    })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(`${ORIGIN}/api/v1/documents/${DOC}/edit-lock`)
    expect(init.method).toBe('GET')
    expect(init.redirect).toBe('error')
    expect(init.cache).toBe('no-store')
  })

  it('R1 parses a held lock summary (no lock_id required)', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, {
        lock: {
          holder_id: 'u1',
          holder_name: 'Nguyễn Văn A',
          since: '2026-10-15T03:12:00Z',
          expires_at: '2026-10-15T03:14:00Z',
          held_by_me: false,
          reserved: false,
          offline_hold_until: '2026-10-15T11:12:00Z',
        },
        server_time: '2026-10-15T03:12:00Z',
      }),
    )
    expect(await client(fetch).getState(DOC)).toEqual({
      lock: {
        holderName: 'Nguyễn Văn A',
        since: '2026-10-15T03:12:00Z',
        expiresAt: '2026-10-15T03:14:00Z',
        heldByMe: false,
        offlineHoldUntil: '2026-10-15T11:12:00Z',
      },
      serverTime: '2026-10-15T03:12:00Z',
    })
  })

  it('R2 POST acquire sends client desktop and editor_id; 201 parses LockSDO', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(201, TENURE))
    const lock = await client(fetch).acquire({ documentId: DOC, editorId: EDITOR })
    expect(lock).toEqual({
      lockId: LOCK,
      documentId: DOC,
      holderId: TENURE.holder_id,
      client: 'desktop',
      acquiredAt: TENURE.acquired_at,
      expiresAt: TENURE.expires_at,
      heartbeatIntervalMs: 30_000,
      ttlMs: 120_000,
      serverTime: TENURE.server_time,
    })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(`${ORIGIN}/api/v1/documents/${DOC}/edit-lock`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      editor_id: EDITOR,
      client: 'desktop',
    })
  })

  it('R2 200 idempotent parses the same LockSDO; move_from_self is sent only when asked', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, TENURE))
    await client(fetch).acquire({ documentId: DOC, editorId: EDITOR, moveFromSelf: true })
    expect(JSON.parse(String(fetch.mock.calls[0]![1].body))).toEqual({
      editor_id: EDITOR,
      client: 'desktop',
      move_from_self: true,
    })
  })

  it('R2 423 document_locked is edit_locked with holder fields', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      envelope(423, 'document_locked', {
        holder_id: 'u1',
        holder_name: 'Lan',
        since: '2026-10-15T03:12:00Z',
        expires_at: '2026-10-15T03:14:00Z',
        held_by_me: true,
      }),
    )
    try {
      await client(fetch).acquire({ documentId: DOC, editorId: EDITOR })
      expect.fail('expected throw')
    } catch (error) {
      expect(error).toBeInstanceOf(UniworkDocError)
      const err = error as UniworkDocError
      expect(err.code).toBe('edit_locked')
      expect(err.status).toBe(423)
      expect(err.editLock).toEqual({
        holderName: 'Lan',
        since: '2026-10-15T03:12:00Z',
        expiresAt: '2026-10-15T03:14:00Z',
        heldByMe: true,
      })
    }
  })

  it('R2 403 forbidden is permission_revoked (no session / view path)', async () => {
    const fetch = vi.fn<FetchLike>(async () => envelope(403, 'forbidden'))
    expect(await codeOf(client(fetch).acquire({ documentId: DOC, editorId: EDITOR }))).toBe(
      'permission_revoked',
    )
  })

  it('R3 POST heartbeat parses expires_at; 409 edit_lock_lost keeps reason and by_name', async () => {
    const ok = vi.fn<FetchLike>(async () =>
      json(200, {
        lock_id: LOCK,
        expires_at: '2026-10-15T03:16:00Z',
        server_time: '2026-10-15T03:14:00Z',
      }),
    )
    const beat = await client(ok).heartbeat({ documentId: DOC, lockId: LOCK })
    expect(beat).toEqual({
      lockId: LOCK,
      expiresAt: '2026-10-15T03:16:00Z',
      serverTime: '2026-10-15T03:14:00Z',
    })
    expect(ok.mock.calls[0]![0]).toBe(
      `${ORIGIN}/api/v1/documents/${DOC}/edit-lock/${LOCK}/heartbeat`,
    )
    expect(ok.mock.calls[0]![1].method).toBe('POST')

    const lost = vi.fn<FetchLike>(async () =>
      envelope(409, 'edit_lock_lost', { reason: 'taken_over', by_id: 'u2', by_name: 'Minh' }),
    )
    try {
      await client(lost).heartbeat({ documentId: DOC, lockId: LOCK })
      expect.fail('expected throw')
    } catch (error) {
      const err = error as UniworkDocError
      expect(err.status).toBe(409)
      expect(err.serverCode).toBe('edit_lock_lost')
      expect(err.lostReason).toBe('taken_over')
      expect(err.byName).toBe('Minh')
    }
  })

  it('R4 DELETE sends the lock id and treats 204 as success', async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response(null, { status: 204 }))
    await client(fetch).release({ documentId: DOC, lockId: LOCK })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(`${ORIGIN}/api/v1/documents/${DOC}/edit-lock/${LOCK}`)
    expect(init.method).toBe('DELETE')
  })

  it('refuses an id that would leave the route', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, {}))
    expect(await codeOf(client(fetch).getState('../../evil'))).toBe('not_found')
    expect(fetch).not.toHaveBeenCalled()
  })
})
