import { describe, expect, it, vi } from 'vitest'
import { createAskUniLookupClient, foldForMatch } from '../src/main/uniwork-askuni/lookup-client'
import { createAskUniRestClient } from '../src/main/uniwork-askuni/rest-client'
import type { FetchLike } from '../src/main/uniwork-docs/client'

/**
 * UNI-2076 s2: the Ask UNI v2 REST client (capabilities, conversations,
 * messages, rename, delete, feedback) and the picker lookup client of the
 * shell main process, against an in-memory fetch.
 */

const ORIGIN = 'https://uniwork.example'
const BASE = `${ORIGIN}/api/v1`
const WS = '01J8X4K2M0N1P2Q3R4S5T6U7V8'
const CONV = '01K4AICONV000000000000001'
const MSG = '01K4AIMSG0000000000000001'

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
const envelope = (status: number, code: string, headers: Record<string, string> = {}) =>
  json(status, { error: { code, message: 'x' } }, headers)
const noContent = () => new Response(null, { status: 204 })

function options(fetch: FetchLike) {
  return {
    apiOrigin: ORIGIN,
    authorized: <T>(call: (token: string) => Promise<T>) => call('tok_secret'),
    isSignedIn: () => true,
    fetch,
  }
}
const rest = (fetch: FetchLike) => createAskUniRestClient(options(fetch))
const lookup = (fetch: FetchLike) => createAskUniLookupClient(options(fetch))

const bodyOf = async (init: RequestInit) =>
  init.body === undefined ? undefined : JSON.parse(String(init.body))

describe('capabilities', () => {
  it('GETs the workspace capabilities and keeps only the known model keys', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, {
        enabled: true,
        ask_uni: true,
        quota: { used_tokens: 1, limit_tokens: null },
        models: [
          { key: 'haiku', speed: 5, intelligence: 3, cost: 1, enabled: true },
          { key: 'sonnet', speed: 4, intelligence: 4, cost: 3, enabled: true },
          { key: 'gpt', speed: 5, intelligence: 5, cost: 5, enabled: true },
          { key: 'opus', speed: 2, intelligence: 5, cost: 5, enabled: false },
          { key: 'haiku', speed: 'fast' },
        ],
        auto_model: 'sonnet',
      }),
    )
    expect(await rest(fetch).capabilities(WS)).toEqual({
      ok: true,
      enabled: true,
      models: [
        { key: 'haiku', speed: 5, intelligence: 3, cost: 1, enabled: true },
        { key: 'sonnet', speed: 4, intelligence: 4, cost: 3, enabled: true },
        { key: 'opus', speed: 2, intelligence: 5, cost: 5, enabled: false },
      ],
      autoModel: 'sonnet',
    })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`${BASE}/workspaces/${WS}/ai/capabilities`)
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok_secret')
  })

  it('an unknown auto model reads as none; a malformed body is an error', async () => {
    const odd = await rest(async () =>
      json(200, { enabled: false, models: [], auto_model: 'gpt-9' }),
    ).capabilities(WS)
    expect(odd).toEqual({ ok: true, enabled: false, models: [], autoModel: '' })
    expect(await rest(async () => json(200, { models: 'x' })).capabilities(WS)).toEqual({
      ok: false,
      error: 'error',
    })
  })
})

describe('conversations and messages', () => {
  it('lists conversations with titles bounded to 80 and bad rows dropped', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, {
        conversations: [
          {
            id: CONV,
            title: 't'.repeat(120),
            created_at: '2026-10-21T08:00:00Z',
            updated_at: '2026-10-21T08:05:00Z',
          },
          { id: '../x', title: 'bad', created_at: '', updated_at: '' },
          { id: 'c2' },
        ],
      }),
    )
    const result = await rest(fetch).conversations(WS)
    expect(fetch.mock.calls[0][0]).toBe(`${BASE}/workspaces/${WS}/ai/conversations`)
    expect(result).toEqual({
      ok: true,
      conversations: [
        {
          id: CONV,
          title: 't'.repeat(80),
          createdAt: '2026-10-21T08:00:00Z',
          updatedAt: '2026-10-21T08:05:00Z',
        },
      ],
    })
  })

  it('reads messages bounded like the stream done message', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, {
        messages: [
          {
            id: 'm_user',
            role: 'user',
            content: 'task nào quá hạn?',
            citations: [],
            created_at: '2026-10-21T08:00:00Z',
          },
          {
            id: MSG,
            role: 'assistant',
            content: 'x'.repeat(25_000),
            citations: [
              { source_id: 'S1', kind: 'project', title: 'P', quote: 'q', href: 'javascript:x' },
            ],
            notice: 'stopped',
            created_at: '2026-10-21T08:00:01Z',
          },
          { id: 'bad id', role: 'assistant', content: 'x', citations: [], created_at: '' },
        ],
      }),
    )
    const result = await rest(fetch).messages(CONV)
    expect(fetch.mock.calls[0][0]).toBe(`${BASE}/ai/conversations/${CONV}/messages`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]).toEqual({
      id: 'm_user',
      role: 'user',
      content: 'task nào quá hạn?',
      citations: [],
      createdAt: '2026-10-21T08:00:00Z',
    })
    expect(result.messages[1].content).toHaveLength(20_000)
    expect(result.messages[1].notice).toBe('stopped')
    expect(result.messages[1].citations).toEqual([
      { sourceId: 'S1', kind: 'other', title: 'P', quote: 'q', href: '' },
    ])
  })

  it('a conversation of someone else (404) is an error, offline is offline', async () => {
    expect(await rest(async () => envelope(404, 'not_found')).messages(CONV)).toEqual({
      ok: false,
      error: 'error',
    })
    expect(
      await rest(async () => {
        throw new TypeError('fetch failed')
      }).messages(CONV),
    ).toEqual({ ok: false, error: 'offline' })
  })
})

describe('rename, delete, feedback', () => {
  it('PATCHes the trimmed title and answers ok', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, { id: CONV, title: 'Việc', created_at: '', updated_at: '' }),
    )
    expect(await rest(fetch).rename(CONV, 'Việc')).toEqual({ ok: true })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`${BASE}/ai/conversations/${CONV}`)
    expect(init.method).toBe('PATCH')
    expect(await bodyOf(init)).toEqual({ title: 'Việc' })
  })

  it('DELETEs a conversation', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, { status: 'ok' }))
    expect(await rest(fetch).remove(CONV)).toEqual({ ok: true })
    expect(fetch.mock.calls[0][0]).toBe(`${BASE}/ai/conversations/${CONV}`)
    expect(fetch.mock.calls[0][1].method).toBe('DELETE')
  })

  it('PUTs feedback (204 -> ok) with only the given fields', async () => {
    const fetch = vi.fn<FetchLike>(async () => noContent())
    expect(
      await rest(fetch).feedbackSet({
        conversationId: CONV,
        messageId: MSG,
        rating: 'down',
        reason: 'wrong_facts',
        note: 'Sai ngày',
      }),
    ).toEqual({ ok: true })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`${BASE}/ai/conversations/${CONV}/messages/${MSG}/feedback`)
    expect(init.method).toBe('PUT')
    expect(await bodyOf(init)).toEqual({ rating: 'down', reason: 'wrong_facts', note: 'Sai ngày' })
    await rest(fetch).feedbackSet({ conversationId: CONV, messageId: MSG, rating: 'up' })
    expect(await bodyOf(fetch.mock.calls[1][1])).toEqual({ rating: 'up' })
  })

  it('DELETEs feedback (204 -> ok)', async () => {
    const fetch = vi.fn<FetchLike>(async () => noContent())
    expect(await rest(fetch).feedbackClear(CONV, MSG)).toEqual({ ok: true })
    expect(fetch.mock.calls[0][0]).toBe(`${BASE}/ai/conversations/${CONV}/messages/${MSG}/feedback`)
    expect(fetch.mock.calls[0][1].method).toBe('DELETE')
  })

  it.each([
    [402, 'ai_quota_exceeded', {}, { ok: false, error: 'quota' }],
    [503, 'ai_disabled', {}, { ok: false, error: 'disabled' }],
    [403, 'forbidden', {}, { ok: false, error: 'forbidden' }],
    [
      429,
      'ai_rate_limited',
      { 'Retry-After': '99999' },
      { ok: false, error: 'rate_limited', retryAfterSeconds: 3600 },
    ],
    [500, 'internal', {}, { ok: false, error: 'error' }],
  ])('maps %i %s', async (status, code, headers, expected) => {
    expect(await rest(async () => envelope(status, code, headers)).remove(CONV)).toEqual(expected)
  })
})

describe('foldForMatch', () => {
  it('drops Vietnamese diacritics and case, đ included', () => {
    expect(foldForMatch('Nguyễn Văn Đức')).toBe('nguyen van duc')
    expect(foldForMatch('Họp GIAO BAN')).toBe('hop giao ban')
  })
})

describe('lookup', () => {
  it('task: POSTs the table rows search the web uses; an empty query asks nothing', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, {
        rows: [
          { task: { id: 'task_1', title: 'Viết spec F-09' } },
          { task: { id: '../bad', title: 'x' } },
        ],
      }),
    )
    expect(await lookup(fetch).lookup({ workspaceId: WS, kind: 'task', query: ' spec ' })).toEqual({
      ok: true,
      items: [{ kind: 'task', id: 'task_1', title: 'Viết spec F-09' }],
    })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`${BASE}/workspaces/${WS}/tasks/table/rows`)
    expect(init.method).toBe('POST')
    expect(await bodyOf(init)).toEqual({
      query: { search: 'spec' },
      group_by: 'none',
      group_key: null,
      hierarchy: false,
      parent_id: null,
      cursor: null,
      limit: 20,
    })
    expect(await lookup(fetch).lookup({ workspaceId: WS, kind: 'task', query: '  ' })).toEqual({
      ok: true,
      items: [],
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('meeting: GETs the meetings list with q and limit, start time as subtitle', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, {
        meetings: [{ id: 'mtg_1', title: 'Họp giao ban', starts_at: '2026-10-22T02:00:00Z' }],
        total: 1,
      }),
    )
    expect(await lookup(fetch).lookup({ workspaceId: WS, kind: 'meeting', query: 'giao' })).toEqual(
      {
        ok: true,
        items: [
          { kind: 'meeting', id: 'mtg_1', title: 'Họp giao ban', subtitle: '2026-10-22T02:00:00Z' },
        ],
      },
    )
    expect(fetch.mock.calls[0][0]).toBe(`${BASE}/workspaces/${WS}/meetings?q=giao&limit=20`)
  })

  it('document: the title search of the documents list (kind=document)', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, {
        documents: [
          {
            id: 'doc_1',
            workspace_id: WS,
            title: 'Kế hoạch ngân sách',
            format: 'docx',
            updated_at: '2026-10-21T08:00:00Z',
            revision: 1,
          },
        ],
        next_cursor: null,
      }),
    )
    const result = await lookup(fetch).lookup({ workspaceId: WS, kind: 'document', query: 'ngân' })
    expect(result).toEqual({
      ok: true,
      items: [{ kind: 'document', id: 'doc_1', title: 'Kế hoạch ngân sách' }],
    })
    const url = new URL(fetch.mock.calls[0][0])
    expect(url.pathname).toBe(`/api/v1/workspaces/${WS}/documents`)
    expect(url.searchParams.get('q')).toBe('ngân')
    expect(url.searchParams.get('kind')).toBe('document')
    expect(url.searchParams.get('limit')).toBe('20')
  })

  it('project: search with q, the plain list without', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, { projects: [{ id: 'prj_1', title: 'Dự án Alpha' }], total: 1 }),
    )
    await lookup(fetch).lookup({ workspaceId: WS, kind: 'project', query: 'alpha' })
    expect(fetch.mock.calls[0][0]).toBe(`${BASE}/workspaces/${WS}/projects/search?q=alpha&limit=20`)
    const all = await lookup(fetch).lookup({ workspaceId: WS, kind: 'project', query: '' })
    expect(fetch.mock.calls[1][0]).toBe(`${BASE}/workspaces/${WS}/projects`)
    expect(all).toEqual({
      ok: true,
      items: [{ kind: 'project', id: 'prj_1', title: 'Dự án Alpha' }],
    })
  })

  it('member: the workspace members, filtered in main without accents', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, {
        members: [
          { user_id: 'usr_1', display_name: 'Nguyễn Văn Đức', email: 'duc@x' },
          { user_id: 'usr_2', display_name: 'Trần Thị Mai', email: 'mai@x' },
        ],
      }),
    )
    expect(await lookup(fetch).lookup({ workspaceId: WS, kind: 'member', query: 'duc' })).toEqual({
      ok: true,
      items: [{ kind: 'member', id: 'usr_1', title: 'Nguyễn Văn Đức' }],
    })
    expect(fetch.mock.calls[0][0]).toBe(`${BASE}/workspaces/${WS}/members`)
  })

  it('room: the chat rooms, filtered in main, unnamed rooms dropped', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, {
        rooms: [
          { id: 'room_1', name: 'Phòng Kế toán' },
          { id: 'room_2', name: '' },
          { id: 'room_3', name: 'General' },
        ],
      }),
    )
    expect(await lookup(fetch).lookup({ workspaceId: WS, kind: 'room', query: 'ke toan' })).toEqual(
      {
        ok: true,
        items: [{ kind: 'room', id: 'room_1', title: 'Phòng Kế toán' }],
      },
    )
    expect(fetch.mock.calls[0][0]).toBe(`${BASE}/workspaces/${WS}/chat/rooms`)
  })

  it('returns at most 20 items with titles bounded to 300', async () => {
    const rooms = Array.from({ length: 30 }, (_, i) => ({ id: `room_${i}`, name: 'r'.repeat(400) }))
    const result = await lookup(async () => json(200, { rooms })).lookup({
      workspaceId: WS,
      kind: 'room',
      query: '',
    })
    expect(result.ok && result.items).toHaveLength(20)
    expect(result.ok && result.items[0].title).toHaveLength(300)
  })

  it('a kind with no picker list (email_thread) is an error with no request', async () => {
    const fetch = vi.fn<FetchLike>()
    expect(
      await lookup(fetch).lookup({ workspaceId: WS, kind: 'email_thread', query: 'x' }),
    ).toEqual({ ok: false, error: 'error' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('maps a failed list like the other routes', async () => {
    expect(
      await lookup(async () => envelope(403, 'forbidden')).lookup({
        workspaceId: WS,
        kind: 'room',
        query: '',
      }),
    ).toEqual({ ok: false, error: 'forbidden' })
  })
})
