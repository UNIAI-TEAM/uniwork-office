import { describe, expect, it, vi } from 'vitest'
import type { UniworkDocErrorCode } from '../src/shared/home-api'
import { workErrorOfDocCode } from '../src/shared/uniwork-work-api'
import type { FetchLike } from '../src/main/uniwork-docs/client'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { createUniworkWorkClient } from '../src/main/uniwork-work/client'
import { parseHome } from '../src/main/uniwork-work/parse'
import { parseNotificationDocumentPage } from '../src/main/uniwork-work/parse-notification-documents'

const ORIGIN = 'https://uniwork.example'
const TOKEN = 'secret-token-2067'
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const envelope = (status: number, code: string) => json(status, { error: { code, message: 'x' } })

const CHANGED = {
  id: 'n_9',
  kind: 'document_changed',
  workspace_id: 'ws_1',
  resource_type: 'document',
  resource_id: 'd_1',
  actor_kind: 'human',
  title_key: 'notifications.kind.document_changed',
  params: {
    actor: 'Ada',
    verb: 'renamed',
    document_count: '5',
    sample_document_ids: 'd_1,d_2,d_3',
  },
  count: 5,
  sample_documents: [
    { id: 'd_1', title: 'Budget' },
    { id: 'd_2', title: 'Plan' },
    { id: 'd_3', title: 'Notes' },
  ],
  created_at: '2026-10-21T07:00:00Z',
  updated_at: '2026-10-21T07:01:00Z',
}

const home = (inbox: unknown[]) => ({
  today: '2026-10-21',
  timezone: 'UTC',
  counts: { open: 0, overdue: 0, due_today: 0, meetings_today: 0, unread: inbox.length },
  my_work: [],
  upcoming_meetings: [],
  inbox,
  partial: [],
  generated_at: '',
})
const inboxOf = (...rows: unknown[]) => parseHome(home(rows)).inbox

describe('notification rows: the document-change fields (G1)', () => {
  it('reads count, updated_at and sample_documents of a document_changed row', () => {
    const [row] = inboxOf(CHANGED)
    expect(row).toMatchObject({
      id: 'n_9',
      kind: 'document_changed',
      count: 5,
      updated_at: '2026-10-21T07:01:00Z',
      sample_documents: [
        { id: 'd_1', title: 'Budget' },
        { id: 'd_2', title: 'Plan' },
        { id: 'd_3', title: 'Notes' },
      ],
    })
  })

  it('reads the three state flags when they are booleans', () => {
    const [row] = inboxOf({
      ...CHANGED,
      kind: 'document_comment_resolved',
      count: undefined,
      resource_deleted: true,
      resource_access_lost: false,
      comment_deleted: true,
    })
    expect(row).toMatchObject({
      resource_deleted: true,
      resource_access_lost: false,
      comment_deleted: true,
    })
  })

  it('leaves every new field out of an older row (absent -> undefined)', () => {
    const [row] = inboxOf({
      id: 'n_1',
      kind: 'task_assigned',
      resource_type: 'task',
      resource_id: 't_1',
      title_key: 'notifications.kind.task_assigned',
      created_at: '2026-10-13T07:00:00Z',
    })
    for (const key of [
      'count',
      'updated_at',
      'resource_deleted',
      'resource_access_lost',
      'comment_deleted',
      'sample_documents',
    ]) {
      expect(row).not.toHaveProperty(key)
    }
  })

  it('a drifted scalar reads as undefined and never fails the row', () => {
    const parsed = parseHome(
      home([
        {
          ...CHANGED,
          count: 'many',
          updated_at: 42,
          resource_deleted: 'yes',
          resource_access_lost: 1,
          comment_deleted: null,
        },
        { ...CHANGED, id: 'n_10', count: -3 },
        { ...CHANGED, id: 'n_11', count: 1.5 },
      ]),
    )
    expect(parsed.partial).toEqual([])
    expect(parsed.inbox).toHaveLength(3)
    const [a, b, c] = parsed.inbox
    expect(a!.count).toBeUndefined()
    expect(a!.updated_at).toBeUndefined()
    expect(a!.resource_deleted).toBeUndefined()
    expect(a!.resource_access_lost).toBeUndefined()
    expect(a!.comment_deleted).toBeUndefined()
    expect(b!.count).toBeUndefined()
    expect(c!.count).toBeUndefined()
  })

  it('a bad sample_documents reads as [] and never fails the row', () => {
    for (const bad of ['Budget', 7, {}, true, [null, 3, 'x']]) {
      const parsed = parseHome(home([{ ...CHANGED, sample_documents: bad }]))
      expect(parsed.partial).toEqual([])
      expect(parsed.inbox[0]!.sample_documents).toEqual([])
    }
  })

  it('drops the sample rows with no id, keeps the rest (a bad title reads as empty)', () => {
    const [row] = inboxOf({
      ...CHANGED,
      sample_documents: [
        { id: 'd_1', title: 'Budget' },
        { id: '', title: 'no id' },
        { title: 'no id either' },
        { id: 'd_3', title: 42 },
        { id: 'd_4' },
        'junk',
      ],
    })
    expect(row!.sample_documents).toEqual([
      { id: 'd_1', title: 'Budget' },
      { id: 'd_3', title: '' },
      { id: 'd_4', title: '' },
    ])
  })

  it('an empty sample_documents stays [] (the row still stands)', () => {
    const [row] = inboxOf({ ...CHANGED, sample_documents: [] })
    expect(row!.sample_documents).toEqual([])
    expect(row!.id).toBe('n_9')
  })

  it('a null sample_documents is absent', () => {
    const [row] = inboxOf({ ...CHANGED, sample_documents: null })
    expect(row).not.toHaveProperty('sample_documents')
  })
})

describe('parseNotificationDocumentPage (G2)', () => {
  const doc = (over: Record<string, unknown> = {}) => ({
    id: 'd_1',
    title: 'Budget',
    kind: 'docx',
    trashed: false,
    shelved: false,
    deleted: false,
    ...over,
  })

  it('reads documents and next_cursor', () => {
    expect(
      parseNotificationDocumentPage({
        documents: [doc(), doc({ id: 'd_2', title: 'Plan', kind: 'xlsx', shelved: true })],
        next_cursor: 'ndc1.abc.def',
      }),
    ).toEqual({
      documents: [
        {
          id: 'd_1',
          title: 'Budget',
          kind: 'docx',
          trashed: false,
          shelved: false,
          deleted: false,
        },
        { id: 'd_2', title: 'Plan', kind: 'xlsx', trashed: false, shelved: true, deleted: false },
      ],
      next_cursor: 'ndc1.abc.def',
    })
  })

  it('a null, absent, empty or drifted next_cursor ends the paging', () => {
    for (const next_cursor of [null, undefined, '', 7, {}]) {
      expect(
        parseNotificationDocumentPage({ documents: [doc()], next_cursor }).next_cursor,
      ).toBeNull()
    }
    expect(parseNotificationDocumentPage({ documents: [] }).next_cursor).toBeNull()
  })

  it('a cursor over 4096 chars is not carried (it could never be sent back)', () => {
    expect(
      parseNotificationDocumentPage({ documents: [doc()], next_cursor: 'x'.repeat(4097) })
        .next_cursor,
    ).toBeNull()
    expect(
      parseNotificationDocumentPage({ documents: [doc()], next_cursor: 'x'.repeat(4096) })
        .next_cursor,
    ).toBe('x'.repeat(4096))
  })

  it('a purged document has no title or kind: both read as empty text', () => {
    const [row] = parseNotificationDocumentPage({
      documents: [{ id: 'd_9', trashed: false, shelved: false, deleted: true }],
      next_cursor: null,
    }).documents
    expect(row).toEqual({
      id: 'd_9',
      title: '',
      kind: '',
      trashed: false,
      shelved: false,
      deleted: true,
    })
  })

  it('a drifted flag reads as false, a drifted title or kind as empty text', () => {
    const [row] = parseNotificationDocumentPage({
      documents: [{ id: 'd_1', title: 5, kind: null, trashed: 'yes', shelved: 1, deleted: {} }],
    }).documents
    expect(row).toEqual({
      id: 'd_1',
      title: '',
      kind: '',
      trashed: false,
      shelved: false,
      deleted: false,
    })
  })

  it('drops an unreadable row and keeps the rest, in order', () => {
    const page = parseNotificationDocumentPage({
      documents: [
        doc({ id: 'd_1' }),
        null,
        'x',
        {},
        doc({ id: '' }),
        { id: 9 },
        [],
        doc({ id: 'd_2' }),
      ],
      next_cursor: 'c',
    })
    expect(page.documents.map((d) => d.id)).toEqual(['d_1', 'd_2'])
    expect(page.next_cursor).toBe('c')
  })

  it('an empty page is valid', () => {
    expect(parseNotificationDocumentPage({ documents: [], next_cursor: null })).toEqual({
      documents: [],
      next_cursor: null,
    })
  })

  it('a reply that is not an object with a documents list is malformed', () => {
    for (const raw of [null, undefined, 'x', 7, [], {}, { documents: null }, { documents: {} }]) {
      expect(() => parseNotificationDocumentPage(raw)).toThrow(UniworkDocError)
      try {
        parseNotificationDocumentPage(raw)
      } catch (error) {
        expect((error as UniworkDocError).code).toBe('malformed_response')
      }
    }
  })

  it('reads only the documented fields (an echoed token never passes through)', () => {
    const page = parseNotificationDocumentPage({
      documents: [{ ...doc(), echo: TOKEN, workspace_id: 'ws_1' }],
      next_cursor: null,
      echo: TOKEN,
    })
    expect(JSON.stringify(page)).not.toContain(TOKEN)
    expect(Object.keys(page.documents[0]!).sort()).toEqual(
      ['deleted', 'id', 'kind', 'shelved', 'title', 'trashed'].sort(),
    )
  })
})

function client(fetch: FetchLike) {
  return createUniworkWorkClient({
    apiOrigin: ORIGIN,
    authorized: <T>(call: (token: string) => Promise<T>) => call(TOKEN),
    isSignedIn: () => true,
    fetch,
  })
}
const codeOf = async (promise: Promise<unknown>): Promise<UniworkDocErrorCode | null> => {
  try {
    await promise
    return null
  } catch (error) {
    return error instanceof UniworkDocError ? error.code : null
  }
}
const PAGE = {
  documents: [
    { id: 'd_1', title: 'Budget', kind: 'docx', trashed: false, shelved: false, deleted: false },
  ],
  next_cursor: 'ndc1.next.mac',
}
const okServer = () => vi.fn<FetchLike>(async () => json(200, PAGE))
const queryOf = (fetch: ReturnType<typeof okServer>, call = 0) =>
  new URL(fetch.mock.calls[call]![0]).searchParams

describe('client.notificationDocuments (G2)', () => {
  it('GETs /me/notifications/{id}/documents and parses the page', async () => {
    const fetch = okServer()
    expect(await client(fetch).notificationDocuments('n_9')).toEqual(PAGE)
    const [url, init] = fetch.mock.calls[0]!
    expect(init.method).toBe('GET')
    expect(new URL(url).pathname).toBe('/api/v1/me/notifications/n_9/documents')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('sends limit=50 when none is given and no cursor', async () => {
    const fetch = okServer()
    await client(fetch).notificationDocuments('n_9')
    const query = queryOf(fetch)
    expect(query.get('limit')).toBe('50')
    expect(query.has('cursor')).toBe(false)
  })

  it('passes the cursor through verbatim (no re-encoding, no trimming)', async () => {
    const fetch = okServer()
    const cursor = 'ndc1.a-b_c+d/e=.mac with space'
    await client(fetch).notificationDocuments('n_9', { cursor })
    expect(queryOf(fetch).get('cursor')).toBe(cursor)
  })

  it('accepts a cursor of exactly 4096 chars and refuses a longer one without a request', async () => {
    const fetch = okServer()
    await client(fetch).notificationDocuments('n_9', { cursor: 'x'.repeat(4096) })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(
      await codeOf(client(fetch).notificationDocuments('n_9', { cursor: 'x'.repeat(4097) })),
    ).toBe('server_error')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('an empty cursor is a first page (the key is left out)', async () => {
    const fetch = okServer()
    await client(fetch).notificationDocuments('n_9', { cursor: '' })
    expect(queryOf(fetch).has('cursor')).toBe(false)
  })

  it('clamps limit to 1-100 and falls back to 50 for a non-number', async () => {
    const fetch = okServer()
    const c = client(fetch)
    for (const limit of [1, 25, 100, 0, -4, 101, 5000, 7.9, Number.NaN, Infinity]) {
      await c.notificationDocuments('n_9', { limit })
    }
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => queryOf(fetch, i).get('limit'))).toEqual([
      '1',
      '25',
      '100',
      '1',
      '1',
      '100',
      '100',
      '7',
      '50',
      '100',
    ])
  })

  it('refuses a cursor that is not a string without a request', async () => {
    const fetch = okServer()
    const bad = { cursor: 7 as unknown as string }
    expect(await codeOf(client(fetch).notificationDocuments('n_9', bad))).toBe('server_error')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('validates the id like the other routes: a bad id never reaches the network', async () => {
    const fetch = okServer()
    for (const bad of ['', '../x', 'n 1', 'n/1', '?a=b', 5 as unknown as string]) {
      expect(await codeOf(client(fetch).notificationDocuments(bad))).toBe('not_found')
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('maps 404 to forbidden (another person’s or an unknown notification)', async () => {
    const code = await codeOf(
      client(async () => envelope(404, 'not_found')).notificationDocuments('n_9'),
    )
    expect(code).toBe('not_found')
    expect(workErrorOfDocCode(code!)).toBe('forbidden')
  })

  it('maps a coded 403 to forbidden', async () => {
    const code = await codeOf(
      client(async () => envelope(403, 'forbidden')).notificationDocuments('n_9'),
    )
    expect(workErrorOfDocCode(code!)).toBe('forbidden')
  })

  it('maps a 400 invalid_request (a forged or foreign cursor) to a server error', async () => {
    const code = await codeOf(
      client(async () => envelope(400, 'invalid_request')).notificationDocuments('n_9', {
        cursor: 'ndc1.forged.mac',
      }),
    )
    expect(code).toBe('server_error')
    expect(workErrorOfDocCode(code!)).toBe('server')
  })

  it('a reply without a documents list is malformed_response', async () => {
    const code = await codeOf(
      client(async () => json(200, { next_cursor: null })).notificationDocuments('n_9'),
    )
    expect(code).toBe('malformed_response')
  })

  it('a short page with a non-null cursor is returned as is (unreadable ones were skipped)', async () => {
    const page = await client(async () =>
      json(200, { documents: [], next_cursor: 'ndc1.more.mac' }),
    ).notificationDocuments('n_9')
    expect(page).toEqual({ documents: [], next_cursor: 'ndc1.more.mac' })
  })
})
