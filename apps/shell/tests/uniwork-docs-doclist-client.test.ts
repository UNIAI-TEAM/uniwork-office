import { describe, expect, it, vi } from 'vitest'
import { createUniworkDocsClient, type FetchLike } from '../src/main/uniwork-docs/client'

/**
 * UNI-2047 A1: the list calls may send `sort` / `order` / `activity` (and, on
 * shared-with-me and the shelf, the same filters the other lists already
 * take). Nothing is sent when they are unset, so today's requests stay
 * byte-identical; a value outside the server's vocabulary never leaves.
 */

const ORIGIN = 'https://uniwork.example'
const BASE = `${ORIGIN}/api/v1/workspaces/ws_1/documents`
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function setup() {
  const seen: string[] = []
  const fetch = vi.fn<FetchLike>(async (url) => {
    seen.push(url)
    return json(200, { documents: [], next_cursor: null })
  })
  const api = createUniworkDocsClient({
    apiOrigin: ORIGIN,
    authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
    isSignedIn: () => true,
    fetch,
  })
  return { api, seen }
}

describe('list calls with no sort / order / activity (today’s requests, pinned)', () => {
  it('every list route keeps its exact query string', async () => {
    const { api, seen } = setup()
    await api.listDocuments({ workspaceId: 'ws_1' })
    await api.listDocuments({ workspaceId: 'ws_1', query: 'plan', includePages: true })
    await api.listChildren({ workspaceId: 'ws_1', parentId: null })
    await api.listChildren({ workspaceId: 'ws_1', parentId: 'fold_1', types: ['docx'] })
    await api.listSharedWithMe({ workspaceId: 'ws_1' })
    await api.listSharedByMe({ workspaceId: 'ws_1' })
    await api.listTrash({ workspaceId: 'ws_1', limit: 25, cursor: 'c1' })
    await api.listShelved({ workspaceId: 'ws_1', types: ['pdf'] })
    expect(seen).toEqual([
      `${BASE}/recent?limit=50&kind=file`,
      `${BASE}?q=plan&limit=50&kind=document`,
      `${BASE}?parent_id=&limit=50`,
      `${BASE}?parent_id=fold_1&limit=50&type=docx`,
      `${BASE}/shared-with-me?limit=50`,
      `${BASE}?shared_by_me=true&limit=50`,
      `${BASE}?archived=1&limit=25&cursor=c1`,
      `${BASE}?shelved=true&limit=50&type=pdf`,
    ])
  })
})

describe('sort / order / activity are sent only when set', () => {
  it('listDocuments (recent): sort=activity with an activity filter stays on /recent', async () => {
    const { api, seen } = setup()
    await api.listDocuments({
      workspaceId: 'ws_1',
      sort: 'activity',
      order: 'desc',
      activity: 'opened',
    })
    await api.listDocuments({ workspaceId: 'ws_1', activity: 'edited' })
    await api.listDocuments({ workspaceId: 'ws_1', sort: 'name', order: 'asc' })
    expect(seen).toEqual([
      `${BASE}/recent?limit=50&kind=file&sort=activity&order=desc&activity=opened`,
      `${BASE}/recent?limit=50&kind=file&activity=edited`,
      `${BASE}/recent?limit=50&kind=file&sort=name&order=asc`,
    ])
  })

  it('listDocuments: the params follow the existing filters on the flat route', async () => {
    const { api, seen } = setup()
    await api.listDocuments({
      workspaceId: 'ws_1',
      types: ['docx'],
      updatedBy: 'u_1',
      updatedFrom: '2026-10-01T00:00:00Z',
      sort: 'updated',
      order: 'desc',
    })
    expect(seen).toEqual([
      `${BASE}?limit=50&kind=file&type=docx&updated_by=u_1&updated_from=2026-10-01T00%3A00%3A00Z&sort=updated&order=desc`,
    ])
  })

  // A-FIX4 M2: the flat /documents route takes sort = updated|name|size|editor and has no activity
  // param; sort=activity there is a 400, and an activity filter would be ignored silently
  it('listDocuments: the flat route drops activity and a sort it does not know', async () => {
    const { api, seen } = setup()
    const flat = { workspaceId: 'ws_1', updatedBy: 'u_1', activity: 'edited' } as const
    await api.listDocuments({ ...flat, sort: 'activity', order: 'desc' })
    await api.listDocuments({ ...flat, sort: 'shared', order: 'asc' })
    await api.listDocuments({ ...flat, sort: 'size', order: 'asc' })
    // a title search is the other thing that moves Recent onto the flat route
    await api.listDocuments({
      workspaceId: 'ws_1',
      query: 'budget',
      activity: 'opened',
      sort: 'activity',
    })
    expect(seen).toEqual([
      `${BASE}?limit=50&kind=file&updated_by=u_1`,
      `${BASE}?limit=50&kind=file&updated_by=u_1`,
      `${BASE}?limit=50&kind=file&updated_by=u_1&sort=size&order=asc`,
      `${BASE}?q=budget&limit=50&kind=file`,
    ])
  })

  // R-FE3 L2: an order with no sort is a 400 on the flat route, so it goes with the sort it belonged to
  it('listDocuments: a title search under sort=activity drops the order with the sort', async () => {
    const { api, seen } = setup()
    await api.listDocuments({
      workspaceId: 'ws_1',
      query: 'budget',
      sort: 'activity',
      order: 'desc',
    })
    await api.listDocuments({
      workspaceId: 'ws_1',
      query: 'budget',
      sort: 'name',
      order: 'asc',
    })
    expect(seen).toEqual([
      `${BASE}?q=budget&limit=50&kind=file`,
      `${BASE}?q=budget&limit=50&kind=file&sort=name&order=asc`,
    ])
  })

  it('listChildren, listSharedByMe and listTrash take sort and order', async () => {
    const { api, seen } = setup()
    await api.listChildren({ workspaceId: 'ws_1', parentId: 'fold_1', sort: 'size', order: 'desc' })
    await api.listSharedByMe({ workspaceId: 'ws_1', sort: 'shared', order: 'desc' })
    await api.listTrash({ workspaceId: 'ws_1', sort: 'deleted', order: 'asc' })
    expect(seen).toEqual([
      `${BASE}?parent_id=fold_1&limit=50&sort=size&order=desc`,
      `${BASE}?shared_by_me=true&limit=50&sort=shared&order=desc`,
      `${BASE}?archived=1&limit=50&sort=deleted&order=asc`,
    ])
  })

  it('listShelved takes the type filter plus sort and order', async () => {
    const { api, seen } = setup()
    await api.listShelved({ workspaceId: 'ws_1', types: ['xlsx'], sort: 'shelved', order: 'desc' })
    await api.listShelved({ workspaceId: 'ws_1', sort: 'editor' })
    expect(seen).toEqual([
      `${BASE}?shelved=true&limit=50&type=xlsx&sort=shelved&order=desc`,
      `${BASE}?shelved=true&limit=50&sort=editor`,
    ])
  })

  it('listSharedWithMe takes the shared-with-me filters and sort', async () => {
    const { api, seen } = setup()
    await api.listSharedWithMe({
      workspaceId: 'ws_1',
      cursor: 'c9',
      limit: 20,
      includePages: true,
      types: ['pptx'],
      updatedBy: 'u_2',
      updatedFrom: '2026-10-10T00:00:00Z',
      sort: 'shared',
      order: 'desc',
    })
    await api.listSharedWithMe({ workspaceId: 'ws_1', updatedBy: 'u_3' })
    expect(seen).toEqual([
      `${BASE}/shared-with-me?cursor=c9&limit=20&type=pptx&updated_by=u_2&updated_from=2026-10-10T00%3A00%3A00Z&sort=shared&order=desc`,
      `${BASE}/shared-with-me?limit=50&updated_by=u_3`,
    ])
  })
})

describe('values outside the server vocabulary never leave', () => {
  it('drops an unknown sort, order or activity (and never trusts a cast)', async () => {
    const { api, seen } = setup()
    const bad = { sort: 'bogus', order: 'sideways', activity: 'deleted' } as never
    await api.listDocuments({ workspaceId: 'ws_1', ...(bad as object) })
    await api.listChildren({ workspaceId: 'ws_1', parentId: null, ...(bad as object) })
    await api.listSharedWithMe({ workspaceId: 'ws_1', ...(bad as object) })
    await api.listShelved({ workspaceId: 'ws_1', ...(bad as object) })
    await api.listDocuments({
      workspaceId: 'ws_1',
      sort: 42,
      order: null,
      activity: {},
    } as never)
    expect(seen).toEqual([
      `${BASE}/recent?limit=50&kind=file`,
      `${BASE}?parent_id=&limit=50`,
      `${BASE}/shared-with-me?limit=50`,
      `${BASE}?shelved=true&limit=50`,
      `${BASE}/recent?limit=50&kind=file`,
    ])
  })
})

/**
 * UNI-2113: the Documents home Type multi-select. One `type=` per pick on every list route (the
 * server ORs them and ANDs them with the route's own `kind`), in menu order, de-duplicated; the
 * type filter no longer rides on `format=` or `kind=page`, so a `page` pick works beside the
 * route's own kind (Recent's `kind=document` on the home, favorites' `kind=document`).
 */
describe('Type picks: one type= per pick (UNI-2113)', () => {
  it('every list route sends the picks in menu order after its own kind', async () => {
    const { api, seen } = setup()
    const types = ['xlsx', 'page', 'docx'] as const
    await api.listDocuments({ workspaceId: 'ws_1', includePages: true, types: [...types] })
    await api.listChildren({ workspaceId: 'ws_1', parentId: 'fold_1', types: [...types] })
    await api.listChildren({ workspaceId: 'ws_1', parentId: null, types: [...types] })
    await api.listSharedWithMe({ workspaceId: 'ws_1', includePages: true, types: [...types] })
    await api.listSharedByMe({ workspaceId: 'ws_1', types: [...types] })
    await api.listTrash({ workspaceId: 'ws_1', types: [...types] })
    await api.listShelved({ workspaceId: 'ws_1', types: [...types] })
    const q = 'type=page&type=docx&type=xlsx'
    expect(seen).toEqual([
      `${BASE}/recent?limit=50&kind=document&${q}`,
      `${BASE}?parent_id=fold_1&limit=50&${q}`,
      `${BASE}?parent_id=&limit=50&${q}`,
      `${BASE}/shared-with-me?limit=50&${q}`,
      `${BASE}?shared_by_me=true&limit=50&${q}`,
      `${BASE}?archived=1&limit=50&${q}`,
      `${BASE}?shelved=true&limit=50&${q}`,
    ])
  })

  it('a page pick never turns into kind=page or format= (it would AND the other picks away)', async () => {
    const { api, seen } = setup()
    await api.listDocuments({ workspaceId: 'ws_1', includePages: true, types: ['page'] })
    await api.listDocuments({ workspaceId: 'ws_1', includePages: true, types: ['page', 'pdf'] })
    await api.listChildren({ workspaceId: 'ws_1', parentId: null, types: ['page'] })
    expect(seen).toEqual([
      `${BASE}/recent?limit=50&kind=document&type=page`,
      `${BASE}/recent?limit=50&kind=document&type=page&type=pdf`,
      `${BASE}?parent_id=&limit=50&type=page`,
    ])
    for (const url of seen) {
      expect(url).not.toContain('format=')
      expect(url).not.toContain('kind=page')
    }
  })

  it('the old single format / kind=page filter no longer reaches the server', async () => {
    const { api, seen } = setup()
    await api.listChildren({
      workspaceId: 'ws_1',
      parentId: null,
      format: 'docx',
      kind: 'page',
    } as never)
    await api.listShelved({ workspaceId: 'ws_1', format: 'pdf', kind: 'page' } as never)
    expect(seen).toEqual([`${BASE}?parent_id=&limit=50`, `${BASE}?shelved=true&limit=50`])
  })

  it('a pick with the flat-route filters keeps the type after the kind', async () => {
    const { api, seen } = setup()
    await api.listDocuments({
      workspaceId: 'ws_1',
      includePages: true,
      query: 'plan',
      updatedBy: 'u_1',
      types: ['page', 'docx'],
    })
    expect(seen).toEqual([
      `${BASE}?q=plan&limit=50&kind=document&type=page&type=docx&updated_by=u_1`,
    ])
  })

  it('de-duplicates, drops values outside the vocabulary and an empty list sends nothing', async () => {
    const { api, seen } = setup()
    await api.listChildren({
      workspaceId: 'ws_1',
      parentId: null,
      types: ['docx', 'docx', '', 'DOCX', 'exe', 42, null, 'txt'] as never,
    })
    await api.listChildren({ workspaceId: 'ws_1', parentId: null, types: [] })
    await api.listChildren({ workspaceId: 'ws_1', parentId: null, types: 'docx' as never })
    expect(seen).toEqual([
      `${BASE}?parent_id=&limit=50&type=docx&type=txt`,
      `${BASE}?parent_id=&limit=50`,
      `${BASE}?parent_id=&limit=50`,
    ])
  })

  it('sends at most 8 picks (the vocabulary size) even if more arrive', async () => {
    const { api, seen } = setup()
    const many = ['page', 'docx', 'xlsx', 'pptx', 'pdf', 'md', 'html', 'txt', 'docx', 'page']
    await api.listChildren({ workspaceId: 'ws_1', parentId: null, types: many as never })
    expect(seen[0]!.match(/type=/g)).toHaveLength(8)
  })
})

/**
 * UNI-2113 fix1 (T-R1-1): the title search carries the Type picks too, the same `type=` loop as
 * the list routes (the server's `/documents` list takes `match=title&q=` and `type=` together).
 */
describe('Type picks on the title search (UNI-2113 fix1)', () => {
  it('sends one type= per pick after the query, in menu order, de-duplicated', async () => {
    const { api, seen } = setup()
    await api.searchDocuments({
      workspaceId: 'ws_1',
      query: 'plan',
      kind: 'all',
      types: ['xlsx', 'page', 'docx', 'page'],
    })
    expect(seen).toEqual([`${BASE}?match=title&q=plan&limit=50&type=page&type=docx&type=xlsx`])
  })

  it('keeps today’s request when no pick is set, and drops values outside the vocabulary', async () => {
    const { api, seen } = setup()
    await api.searchDocuments({ workspaceId: 'ws_1', query: 'plan', kind: 'all' })
    await api.searchDocuments({ workspaceId: 'ws_1', query: 'plan', kind: 'all', types: [] })
    await api.searchDocuments({
      workspaceId: 'ws_1',
      query: 'plan',
      kind: 'all',
      types: ['', 'PDF', 'exe', 'pdf'] as never,
    })
    await api.searchDocuments({
      workspaceId: 'ws_1',
      query: 'plan',
      kind: 'all',
      types: 'docx' as never,
    })
    expect(seen).toEqual([
      `${BASE}?match=title&q=plan&limit=50`,
      `${BASE}?match=title&q=plan&limit=50`,
      `${BASE}?match=title&q=plan&limit=50&type=pdf`,
      `${BASE}?match=title&q=plan&limit=50`,
    ])
  })

  it('a page pick never becomes kind=page or format= on the search either', async () => {
    const { api, seen } = setup()
    await api.searchDocuments({
      workspaceId: 'ws_1',
      query: 'plan',
      kind: 'document',
      cursor: 'c1',
      types: ['page'],
    })
    expect(seen).toEqual([`${BASE}?match=title&q=plan&kind=document&limit=50&cursor=c1&type=page`])
    expect(seen[0]).not.toContain('format=')
    expect(seen[0]).not.toContain('kind=page')
  })
})
