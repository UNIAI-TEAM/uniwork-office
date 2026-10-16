import { describe, expect, it, vi } from 'vitest'
import { createUniworkDocsClient, type FetchLike } from '../src/main/uniwork-docs/client'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { formatForMime } from '../src/main/uniwork-docs/formats'

/**
 * FD-11 (UNI-1809): the folder-tree routes and their strict readers. The child
 * routes are the ones a mistake is silent on - an empty `parent_id` means the
 * workspace root while an absent one answers the workspace's whole list, and
 * `folders_only` decides whether the tree answers folders or everything - so
 * each URL and body is asserted exactly.
 */

const ORIGIN = 'https://uniwork.example'
const WS = 'ws_1'
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const envelope = (status: number, code: string, fields?: Record<string, unknown>) =>
  json(status, { error: { code, message: 'x', ...(fields ? { fields } : {}) } })

function client(fetch: FetchLike) {
  return createUniworkDocsClient({
    apiOrigin: ORIGIN,
    authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
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

describe('the folder tree', () => {
  it('reads the whole tree with folders_only=true and keeps parent, position and children', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, {
        documents: [
          {
            id: 'fold_1',
            kind: 'folder',
            title: 'Contracts',
            position: 0,
            children: [
              {
                id: 'fold_2',
                kind: 'folder',
                title: '2026',
                parent_id: 'fold_1',
                position: 2,
                children: [],
              },
            ],
          },
          {
            id: 'fold_3',
            kind: 'folder',
            title: 'Archive',
            parent_id: null,
            position: 1,
            children: [],
          },
        ],
      }),
    )
    const api = client(fetch)

    expect(await api.folderTree(WS)).toEqual([
      {
        id: 'fold_1',
        parentId: null,
        title: 'Contracts',
        position: 0,
        children: [{ id: 'fold_2', parentId: 'fold_1', title: '2026', position: 2, children: [] }],
      },
      { id: 'fold_3', parentId: null, title: 'Archive', position: 1, children: [] },
    ])
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(`${ORIGIN}/api/v1/workspaces/${WS}/documents/tree?folders_only=true`)
    expect(init.method).toBe('GET')
    expect(init.redirect).toBe('error')
  })

  it('refuses a tree that is not folders, past the depth cap or missing its children', async () => {
    const bad = (documents: unknown) =>
      client(vi.fn<FetchLike>(async () => json(200, { documents })))
    expect(
      await codeOf(
        bad([{ id: 'x', kind: 'file', title: 'a.docx', position: 0, children: [] }]).folderTree(WS),
      ),
    ).toBe('malformed_response')
    expect(
      await codeOf(bad([{ id: 'x', kind: 'folder', title: 'a', position: 0 }]).folderTree(WS)),
    ).toBe('malformed_response')
    // 21 levels: the server's own cap is 20, so the 21st node is not a tree
    let node: Record<string, unknown> = { id: 'leaf', kind: 'folder', title: 'leaf', children: [] }
    for (let depth = 0; depth < 21; depth += 1) {
      node = { id: `n_${depth}`, kind: 'folder', title: `n${depth}`, position: 0, children: [node] }
    }
    expect(await codeOf(bad([node]).folderTree(WS))).toBe('malformed_response')
  })
})

describe("a folder's children", () => {
  it('asks the root with an EMPTY parent_id and a folder with its id', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, { documents: [], next_cursor: null }))
    const api = client(fetch)

    await api.listChildren({ workspaceId: WS, parentId: null })
    await api.listChildren({ workspaceId: WS, parentId: 'fold_1', cursor: 'c2', limit: 25 })

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${ORIGIN}/api/v1/workspaces/${WS}/documents?parent_id=&limit=50`,
      `${ORIGIN}/api/v1/workspaces/${WS}/documents?parent_id=fold_1&limit=25&cursor=c2`,
    ])
  })

  it('keeps folders, files and pages, with their kind and parent', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, {
        documents: [
          {
            id: 'fold_1',
            kind: 'folder',
            title: 'Contracts.docx',
            parent_id: null,
            updated_at: '2026-10-13T09:00:00Z',
            my_level: 'manage',
          },
          {
            id: 'doc_1',
            kind: 'file',
            title: 'Q4 plan.docx',
            parent_id: 'fold_1',
            updated_at: '2026-10-13T09:00:00Z',
            file: { filename: 'Q4 plan.docx', mime_type: 'application/pdf' },
          },
          {
            id: 'page_1',
            kind: 'page',
            title: 'Notes',
            parent_id: 'fold_1',
            updated_at: '2026-10-13T09:00:00Z',
          },
          { id: 'doc_2', kind: 'mystery', title: 'ignored', updated_at: '2026-10-13T09:00:00Z' },
        ],
        next_cursor: 'c2',
      }),
    )
    const api = client(fetch)

    const page = await api.listChildren({ workspaceId: WS, parentId: 'fold_1' })
    expect(page.nextCursor).toBe('c2')
    expect(
      page.documents.map((doc) => [doc.id, doc.kind, doc.parentId, doc.format, doc.canManage]),
    ).toEqual([
      // a folder has no document format, whatever its title ends in
      ['fold_1', 'folder', null, null, true],
      ['doc_1', 'file', 'fold_1', 'pdf', false],
      ['page_1', 'page', 'fold_1', null, false],
    ])
  })

  it('refuses a row whose parent_id is not an id', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, {
        documents: [
          {
            id: 'doc_1',
            kind: 'file',
            title: 'a.docx',
            parent_id: 'x'.repeat(200),
            updated_at: '2026-10-13T09:00:00Z',
          },
        ],
      }),
    )
    expect(await codeOf(client(fetch).listChildren({ workspaceId: WS, parentId: null }))).toBe(
      'malformed_response',
    )
  })

  it('keeps the library list files only', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, {
        documents: [
          { id: 'fold_1', kind: 'folder', title: 'Contracts', updated_at: '2026-10-13T09:00:00Z' },
          { id: 'doc_1', kind: 'file', title: 'Q4 plan.docx', updated_at: '2026-10-13T09:00:00Z' },
        ],
        next_cursor: null,
      }),
    )
    const page = await client(fetch).listDocuments({ workspaceId: WS })
    expect(page.documents.map((doc) => doc.id)).toEqual(['doc_1'])
  })
})

describe('the title search', () => {
  it("sends match=title and the query, and parses every hit's path", async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, {
        documents: [
          {
            id: 'doc_1',
            kind: 'file',
            title: 'Q4 plan.docx',
            updated_at: '2026-10-13T09:00:00Z',
            path: [
              { id: 'fold_1', title: 'Contracts' },
              { id: 'fold_2', title: '2026' },
            ],
          },
        ],
        next_cursor: null,
      }),
    )
    const api = client(fetch)

    const page = await api.searchDocuments({ workspaceId: WS, query: 'plan', kind: 'all' })
    expect(page.documents[0]!.path).toEqual([
      { id: 'fold_1', title: 'Contracts' },
      { id: 'fold_2', title: '2026' },
    ])
    expect(fetch.mock.calls[0]![0]).toBe(
      `${ORIGIN}/api/v1/workspaces/${WS}/documents?match=title&q=plan&limit=50`,
    )
  })

  it('sends the chip as the kind filter, and none for all', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, { documents: [], next_cursor: null }))
    const api = client(fetch)

    await api.searchDocuments({ workspaceId: WS, query: 'p', kind: 'folder' })
    await api.searchDocuments({ workspaceId: WS, query: 'p', kind: 'document', cursor: 'c1' })

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${ORIGIN}/api/v1/workspaces/${WS}/documents?match=title&q=p&kind=folder&limit=50`,
      `${ORIGIN}/api/v1/workspaces/${WS}/documents?match=title&q=p&kind=document&limit=50&cursor=c1`,
    ])
  })

  it('refuses a path that is not a list of id + title', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, {
        documents: [
          {
            id: 'doc_1',
            kind: 'file',
            title: 'a.docx',
            updated_at: '2026-10-13T09:00:00Z',
            path: [{ id: 'fold_1' }],
          },
        ],
      }),
    )
    expect(
      await codeOf(client(fetch).searchDocuments({ workspaceId: WS, query: 'a', kind: 'all' })),
    ).toBe('malformed_response')
  })
})

describe('creating a folder', () => {
  it('posts the folder kind, the title and the parent id under an idempotency key', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(201, {
        document: {
          id: 'fold_9',
          kind: 'folder',
          workspace_id: WS,
          title: 'Contracts',
          revision: '7',
          my_level: 'manage',
        },
      }),
    )
    const api = client(fetch)

    expect(
      await api.createFolder({
        workspaceId: WS,
        parentId: 'fold_1',
        title: 'Contracts',
        idempotencyKey: 'k1',
      }),
    ).toMatchObject({ id: 'fold_9', kind: 'folder', title: 'Contracts', canManage: true })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(`${ORIGIN}/api/v1/workspaces/${WS}/documents`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      kind: 'folder',
      title: 'Contracts',
      parent_id: 'fold_1',
    })
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('k1')
  })

  it('omits parent_id at the root', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(201, {
        document: {
          id: 'fold_9',
          kind: 'folder',
          workspace_id: WS,
          title: 'Contracts',
          revision: '7',
        },
      }),
    )
    await client(fetch).createFolder({
      workspaceId: WS,
      parentId: null,
      title: 'Contracts',
      idempotencyKey: 'k1',
    })
    expect(JSON.parse(String(fetch.mock.calls[0]![1].body))).toEqual({
      kind: 'folder',
      title: 'Contracts',
    })
  })
})

describe('moving a document', () => {
  const ref = (over: Record<string, unknown> = {}) => ({
    document: {
      id: DOC,
      kind: 'file',
      workspace_id: WS,
      title: 'Q4 plan.docx',
      revision: '41',
      my_level: 'manage',
      parent_id: null,
      ...over,
    },
  })

  it('reads the revision first, posts the target as null for the root, and reports no rename', async () => {
    const fetch = vi.fn<FetchLike>(async (url, init) => {
      if (init.method === 'GET') return json(200, ref())
      return json(200, {
        document: { ...ref().document, revision: '42', parent_id: 'fold_1' },
      })
    })
    const api = client(fetch)

    const moved = await api.moveDocument({
      documentId: DOC,
      parentId: 'fold_1',
      idempotencyKey: 'move_k1',
    })
    expect(moved.renamedTo).toBeNull()
    expect(moved.summary).toMatchObject({ id: DOC, parentId: 'fold_1' })
    expect(fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      [`${ORIGIN}/api/v1/documents/${DOC}`, 'GET'],
      [`${ORIGIN}/api/v1/documents/${DOC}/move`, 'POST'],
    ])
    expect(JSON.parse(String(fetch.mock.calls[1]![1].body))).toEqual({
      parent_id: 'fold_1',
      revision: '41',
    })
    expect((fetch.mock.calls[1]![1].headers as Record<string, string>)['Idempotency-Key']).toBe(
      'move_k1',
    )
  })

  it('moves a folder to the root and reports the title the server gave it', async () => {
    const fetch = vi.fn<FetchLike>(async (_url, init) => {
      if (init.method === 'GET') return json(200, ref({ kind: 'folder', title: 'Contracts' }))
      return json(200, {
        document: { ...ref().document, kind: 'folder', title: 'Contracts (2)', revision: '42' },
      })
    })
    const api = client(fetch)

    const moved = await api.moveDocument({
      documentId: DOC,
      parentId: null,
      idempotencyKey: 'move_k2',
    })
    expect(moved.renamedTo).toBe('Contracts (2)')
    expect(JSON.parse(String(fetch.mock.calls[1]![1].body))).toEqual({
      parent_id: null,
      revision: '41',
    })
  })

  it('re-reads the revision and retries once after a revision_conflict with the same Idempotency-Key', async () => {
    let moves = 0
    const fetch = vi.fn<FetchLike>(async (_url, init) => {
      if (init.method === 'GET') {
        return json(200, ref({ revision: moves === 0 ? '41' : '43' }))
      }
      moves += 1
      if (moves === 1) return envelope(409, 'revision_conflict', { current_revision: '43' })
      return json(200, { document: { ...ref().document, revision: '44', parent_id: 'fold_1' } })
    })
    const api = client(fetch)

    const moved = await api.moveDocument({
      documentId: DOC,
      parentId: 'fold_1',
      idempotencyKey: 'move_retry_k',
    })
    expect(moved.summary.parentId).toBe('fold_1')
    expect(JSON.parse(String(fetch.mock.calls[3]![1].body))).toEqual({
      parent_id: 'fold_1',
      revision: '43',
    })
    expect((fetch.mock.calls[1]![1].headers as Record<string, string>)['Idempotency-Key']).toBe(
      'move_retry_k',
    )
    expect((fetch.mock.calls[3]![1].headers as Record<string, string>)['Idempotency-Key']).toBe(
      'move_retry_k',
    )
  })

  it('gives up after one retry, and never retries a refusal that is not a conflict', async () => {
    let moves = 0
    const alwaysConflicting = vi.fn<FetchLike>(async (_url, init) => {
      if (init.method === 'GET') return json(200, ref())
      moves += 1
      return envelope(409, 'revision_conflict', { current_revision: '43' })
    })
    expect(
      await codeOf(
        client(alwaysConflicting).moveDocument({
          documentId: DOC,
          parentId: null,
          idempotencyKey: 'k_conf',
        }),
      ),
    ).toBe('conflict')
    expect(moves).toBe(2)

    let refused = 0
    const cycle = vi.fn<FetchLike>(async (_url, init) => {
      if (init.method === 'GET') return json(200, ref({ kind: 'folder' }))
      refused += 1
      return envelope(422, 'document_cycle')
    })
    expect(
      await codeOf(
        client(cycle).moveDocument({
          documentId: DOC,
          parentId: 'fold_1',
          idempotencyKey: 'k_cyc',
        }),
      ),
    ).toBe('document_cycle')
    expect(refused).toBe(1)
  })
})

// FD-11: the four refusals the folder tree added. Each keeps its own code - a
// 409/422 used to fall through to server_error, which the renderer can only
// show as a generic failure.
describe('the folder refusals', () => {
  it('maps every code to itself, and preserves folder_name_taken on serverCode', async () => {
    const cases: Array<[number, string, string]> = [
      [422, 'document_cycle', 'document_cycle'],
      [422, 'document_parent_kind', 'document_parent_kind'],
    ]
    for (const [status, serverCode, expected] of cases) {
      const api = client(async () => envelope(status, serverCode))
      expect(
        await codeOf(
          api.createFolder({ workspaceId: WS, parentId: null, title: 'x', idempotencyKey: 'k' }),
        ),
      ).toBe(expected)
    }
    // B-R1-09: folder_name_taken is not cast into UniworkDocErrorCode; it stays
    // server_error on code with serverCode: 'folder_name_taken' for actionErrorOf
    const taken = client(async () => envelope(409, 'folder_name_taken'))
    let caught: unknown
    try {
      await taken.createFolder({ workspaceId: WS, parentId: null, title: 'x', idempotencyKey: 'k' })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(UniworkDocError)
    expect(caught).toMatchObject({ code: 'server_error', serverCode: 'folder_name_taken' })
  })

  it('carries the depth cap 20 on a too-deep tree refusal', async () => {
    const depthOf = async (fields?: Record<string, unknown>): Promise<unknown> => {
      const api = client(async () =>
        json(422, {
          error: { code: 'document_too_deep', message: 'x', ...(fields ? { fields } : {}) },
        }),
      )
      try {
        await api.createFolder({ workspaceId: WS, parentId: null, title: 'x', idempotencyKey: 'k' })
        return 'resolved'
      } catch (error) {
        return error instanceof UniworkDocError ? error.maxDepth : `other:${String(error)}`
      }
    }
    // B-R1-08: the D server emits no fields on errDocumentTooDeep; maxDepth is
    // always the app's documented 20 constant
    expect(await depthOf()).toBe(20)
    expect(await depthOf({ max: 0 })).toBe(20)
  })

  it('F11-L5: formatForMime returns null for Object.prototype property names', () => {
    expect(formatForMime('constructor')).toBeNull()
    expect(formatForMime('__proto__')).toBeNull()
    expect(formatForMime('toString')).toBeNull()
  })
})
