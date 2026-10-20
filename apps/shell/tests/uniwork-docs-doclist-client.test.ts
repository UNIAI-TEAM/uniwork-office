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
    await api.listChildren({ workspaceId: 'ws_1', parentId: 'fold_1', format: 'docx' })
    await api.listSharedWithMe({ workspaceId: 'ws_1' })
    await api.listSharedByMe({ workspaceId: 'ws_1' })
    await api.listTrash({ workspaceId: 'ws_1', limit: 25, cursor: 'c1' })
    await api.listShelved({ workspaceId: 'ws_1', format: 'pdf' })
    expect(seen).toEqual([
      `${BASE}/recent?limit=50&kind=file`,
      `${BASE}?q=plan&limit=50&kind=document`,
      `${BASE}?parent_id=&limit=50`,
      `${BASE}?parent_id=fold_1&limit=50&format=docx`,
      `${BASE}/shared-with-me?limit=50`,
      `${BASE}?shared_by_me=true&limit=50`,
      `${BASE}?archived=1&limit=25&cursor=c1`,
      `${BASE}?shelved=true&limit=50&format=pdf`,
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
      format: 'docx',
      updatedBy: 'u_1',
      updatedFrom: '2026-10-01T00:00:00Z',
      sort: 'updated',
      order: 'desc',
    })
    expect(seen).toEqual([
      `${BASE}?limit=50&kind=file&format=docx&updated_by=u_1&updated_from=2026-10-01T00%3A00%3A00Z&sort=updated&order=desc`,
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
    await api.listShelved({ workspaceId: 'ws_1', format: 'xlsx', sort: 'shelved', order: 'desc' })
    await api.listShelved({ workspaceId: 'ws_1', sort: 'editor' })
    expect(seen).toEqual([
      `${BASE}?shelved=true&limit=50&format=xlsx&sort=shelved&order=desc`,
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
      format: 'pptx',
      updatedBy: 'u_2',
      updatedFrom: '2026-10-10T00:00:00Z',
      sort: 'shared',
      order: 'desc',
    })
    await api.listSharedWithMe({ workspaceId: 'ws_1', updatedBy: 'u_3' })
    expect(seen).toEqual([
      `${BASE}/shared-with-me?cursor=c9&limit=20&format=pptx&updated_by=u_2&updated_from=2026-10-10T00%3A00%3A00Z&sort=shared&order=desc`,
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
