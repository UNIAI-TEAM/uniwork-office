import { describe, expect, it, vi } from 'vitest'
import { createUniworkDocsClient, type FetchLike } from '../src/main/uniwork-docs/client'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'

/**
 * UNI-2047 B6: Starred (Gắn sao) on the server's SV-2 route,
 * `GET /workspaces/{ws}/documents/favorites`, plus the star / unstar writes
 * (`POST` / `DELETE /documents/{id}/favorite`). The route reads only kind,
 * format, sort / order, cursor and limit, so nothing else is sent; its rows are
 * the usual list rows plus `favorited_at`.
 */

const ORIGIN = 'https://uniwork.example'
const BASE = `${ORIGIN}/api/v1/workspaces/ws_1/documents`
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

interface Seen {
  url: string
  method: string
}

function setup(answer: () => Response = () => json(200, { documents: [], next_cursor: null })) {
  const seen: Seen[] = []
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    seen.push({ url, method: init?.method ?? 'GET' })
    return answer()
  })
  const api = createUniworkDocsClient({
    apiOrigin: ORIGIN,
    authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
    isSignedIn: () => true,
    fetch,
  })
  return { api, seen }
}

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: 'file',
  workspace_id: 'ws_1',
  title: `${id}.docx`,
  updated_at: '2026-10-18T08:00:00Z',
  ...extra,
})

describe('listFavorites: the query string', () => {
  it('asks for files and pages (no folders) in pages of 50, and nothing else when unset', async () => {
    const { api, seen } = setup()
    await api.listFavorites({ workspaceId: 'ws_1' })
    expect(seen).toEqual([{ url: `${BASE}/favorites?limit=50&kind=document`, method: 'GET' }])
  })

  it('carries the cursor, the limit (capped at 100), the type and the starred sort', async () => {
    const { api, seen } = setup()
    await api.listFavorites({
      workspaceId: 'ws_1',
      cursor: 'c1',
      limit: 500,
      format: 'docx',
      sort: 'starred',
      order: 'asc',
    })
    expect(seen[0]!.url).toBe(
      `${BASE}/favorites?cursor=c1&limit=100&kind=document&format=docx&sort=starred&order=asc`,
    )
  })

  it('takes the column keys of the flat list too', async () => {
    const { api, seen } = setup()
    await api.listFavorites({ workspaceId: 'ws_1', sort: 'name', order: 'desc' })
    expect(seen[0]!.url).toBe(`${BASE}/favorites?limit=50&kind=document&sort=name&order=desc`)
  })

  it('never sends a key the route would answer 400 to, nor a filter it ignores', async () => {
    const { api, seen } = setup()
    await api.listFavorites({
      workspaceId: 'ws_1',
      sort: 'activity',
      order: 'desc',
      activity: 'edited',
      updatedBy: 'u_1',
      updatedFrom: '2026-10-01T00:00:00Z',
    })
    await api.listFavorites({ workspaceId: 'ws_1', sort: 'deleted' })
    // an order with no sort is a 400 there as well, so it stays home too
    expect(seen.map((s) => s.url)).toEqual([
      `${BASE}/favorites?limit=50&kind=document`,
      `${BASE}/favorites?limit=50&kind=document`,
    ])
  })

  it('UniNote chip: kind=page, and a format never rides with it', async () => {
    const { api, seen } = setup()
    await api.listFavorites({ workspaceId: 'ws_1', kind: 'page', format: 'docx' })
    expect(seen[0]!.url).toBe(`${BASE}/favorites?limit=50&kind=page`)
  })

  it('refuses a malformed workspace id before any request', async () => {
    const { api, seen } = setup()
    await expect(api.listFavorites({ workspaceId: '../x' })).rejects.toBeInstanceOf(UniworkDocError)
    expect(seen).toEqual([])
  })
})

describe('listFavorites: the answer', () => {
  it('parses the rows with favorited_at, files and pages, and drops a folder', async () => {
    const { api } = setup(() =>
      json(200, {
        documents: [
          row('d1', { favorited_at: '2026-10-20T08:00:00Z' }),
          row('p1', { kind: 'page', favorited_at: '2026-10-19T08:00:00Z' }),
          row('f1', { kind: 'folder', favorited_at: '2026-10-18T08:00:00Z' }),
          row('d2'),
        ],
        next_cursor: 'next-1',
      }),
    )
    const page = await api.listFavorites({ workspaceId: 'ws_1' })
    expect(page.documents.map((d) => d.id)).toEqual(['d1', 'p1', 'd2'])
    expect(page.documents[0]!.favoritedAt).toBe('2026-10-20T08:00:00Z')
    expect(page.documents[1]!.favoritedAt).toBe('2026-10-19T08:00:00Z')
    expect(page.documents[2]!.favoritedAt).toBeUndefined()
    expect(page.nextCursor).toBe('next-1')
  })

  it('an older server answering 404 is a not_found error, not a crash', async () => {
    const { api } = setup(() => json(404, { error: { code: 'not_found', message: 'x' } }))
    await expect(api.listFavorites({ workspaceId: 'ws_1' })).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('a body that is not a list is a malformed_response', async () => {
    const { api } = setup(() => json(200, { favorites: [] }))
    await expect(api.listFavorites({ workspaceId: 'ws_1' })).rejects.toMatchObject({
      code: 'malformed_response',
    })
  })
})

describe('favorite / unfavorite', () => {
  it('POST /documents/{id}/favorite answers the time of the star', async () => {
    const { api, seen } = setup(() =>
      json(200, {
        favorite: {
          document_id: 'doc_1',
          favorite_id: 'fav_1',
          workspace_id: 'ws_1',
          title: 'A',
          kind: 'file',
          favorited_at: '2026-10-21T01:00:00Z',
        },
      }),
    )
    await expect(api.favorite('doc_1')).resolves.toEqual({ favoritedAt: '2026-10-21T01:00:00Z' })
    expect(seen).toEqual([{ url: `${ORIGIN}/api/v1/documents/doc_1/favorite`, method: 'POST' }])
  })

  it('an answer for another document is a malformed_response', async () => {
    const { api } = setup(() =>
      json(200, { favorite: { document_id: 'other', favorited_at: '2026-10-21T01:00:00Z' } }),
    )
    await expect(api.favorite('doc_1')).rejects.toMatchObject({ code: 'malformed_response' })
  })

  it('DELETE /documents/{id}/favorite resolves on the server’s ok', async () => {
    const { api, seen } = setup(() => json(200, { status: 'ok' }))
    await expect(api.unfavorite('doc_1')).resolves.toBeUndefined()
    expect(seen).toEqual([{ url: `${ORIGIN}/api/v1/documents/doc_1/favorite`, method: 'DELETE' }])
  })

  it('a 403 / 404 on either write is the usual typed error (403 reads as permission_revoked)', async () => {
    const forbidden = setup(() => json(403, { error: { code: 'forbidden', message: 'x' } }))
    await expect(forbidden.api.favorite('doc_1')).rejects.toMatchObject({
      code: 'permission_revoked',
    })
    const gone = setup(() => json(404, { error: { code: 'not_found', message: 'x' } }))
    await expect(gone.api.unfavorite('doc_1')).rejects.toMatchObject({ code: 'not_found' })
  })
})
