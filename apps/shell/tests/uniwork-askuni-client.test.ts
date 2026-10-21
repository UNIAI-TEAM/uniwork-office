import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAskUniClient } from '../src/main/uniwork-askuni/client'
import type { FetchLike } from '../src/main/uniwork-docs/client'
import { TransportError } from '../src/main/uniwork-auth/transport'
import type { AskUniRequest } from '../src/shared/askuni-api'

/**
 * UNI-2069 s1: the Ask UNI client of the shell main process
 * (`POST /workspaces/{ws}/ai/ask`, one JSON body) against an in-memory fetch.
 */

const ORIGIN = 'https://uniwork.example'
const WS = '01J8X4K2M0N1P2Q3R4S5T6U7V8'
const CONV = '01K4AICONV000000000000001'
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
const envelope = (status: number, code: string, headers: Record<string, string> = {}) =>
  json(status, { error: { code, message: 'x' } }, headers)

const REQ: AskUniRequest = { workspaceId: WS, question: 'task nào quá hạn?', locale: 'vi' }

function answer(message: Record<string, unknown> = {}) {
  return {
    conversation_id: CONV,
    message: {
      id: '01K4AIMSG0000000000000001',
      role: 'assistant',
      content: 'Có 1 việc quá hạn [S1].',
      citations: [],
      created_at: '2026-10-21T08:00:00Z',
      ...message,
    },
    usage: { input_tokens: 10, output_tokens: 5 },
  }
}

function client(
  fetch: FetchLike,
  options: {
    authorized?: <T>(call: (token: string) => Promise<T>) => Promise<T>
    isSignedIn?: () => boolean
  } = {},
) {
  return createAskUniClient({
    apiOrigin: ORIGIN,
    authorized: options.authorized ?? ((call) => call('tok_secret')),
    isSignedIn: options.isSignedIn ?? (() => true),
    fetch,
  })
}

afterEach(() => vi.restoreAllMocks())

describe('request', () => {
  it('posts the question to the workspace route with the device bearer and no model or effort', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, answer()))
    await client(fetch).ask({ ...REQ, conversationId: CONV })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`${ORIGIN}/api/v1/workspaces/${WS}/ai/ask`)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok_secret')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(init.redirect).toBe('error')
    expect(JSON.parse(String(init.body))).toEqual({
      conversation_id: CONV,
      question: 'task nào quá hạn?',
      locale: 'vi',
    })
  })

  it('sends an empty conversation_id for a new conversation', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, answer()))
    await client(fetch).ask({ ...REQ, locale: 'en' })
    expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual({
      conversation_id: '',
      question: 'task nào quá hạn?',
      locale: 'en',
    })
  })

  it('refreshes once on a 401 and answers with the retried result', async () => {
    const tokens: string[] = []
    const fetch = vi.fn<FetchLike>(async (_url, init) => {
      tokens.push((init.headers as Record<string, string>).Authorization)
      return tokens.length === 1 ? envelope(401, 'unauthorized') : json(200, answer())
    })
    // the account manager's contract: one retry with a fresh token on `unauthorized`
    const authorized = async <T>(call: (token: string) => Promise<T>): Promise<T> => {
      try {
        return await call('old')
      } catch (error) {
        if (error instanceof TransportError && error.code === 'unauthorized') return call('new')
        throw error
      }
    }
    const result = await client(fetch, { authorized }).ask(REQ)
    expect(tokens).toEqual(['Bearer old', 'Bearer new'])
    expect(result.ok).toBe(true)
  })

  it('a 401 that survives the refresh is a session error', async () => {
    const fetch = vi.fn<FetchLike>(async () => envelope(401, 'unauthorized'))
    const authorized = async <T>(call: (token: string) => Promise<T>): Promise<T> => {
      try {
        return await call('old')
      } catch (error) {
        if (error instanceof TransportError && error.code === 'unauthorized') return call('new')
        throw error
      }
    }
    expect(await client(fetch, { authorized }).ask(REQ)).toEqual({ ok: false, code: 'session' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('a revoked device or failed refresh is a session error', async () => {
    const fetch = vi.fn<FetchLike>()
    const authorized = async () => {
      throw new TransportError('device_revoked', 401)
    }
    expect(await client(fetch, { authorized }).ask(REQ)).toEqual({ ok: false, code: 'session' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('no account is signed_out and sends nothing', async () => {
    const fetch = vi.fn<FetchLike>()
    expect(await client(fetch, { isSignedIn: () => false }).ask(REQ)).toEqual({
      ok: false,
      code: 'signed_out',
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('error codes', () => {
  const failing = (response: Response) => client(vi.fn<FetchLike>(async () => response)).ask(REQ)

  it('402 ai_quota_exceeded -> quota', async () => {
    expect(await failing(envelope(402, 'ai_quota_exceeded'))).toEqual({ ok: false, code: 'quota' })
  })

  it('429 -> rate_limited with the Retry-After seconds', async () => {
    expect(await failing(envelope(429, 'ai_rate_limited', { 'Retry-After': '17' }))).toEqual({
      ok: false,
      code: 'rate_limited',
      retryAfterSec: 17,
    })
  })

  it('429 without a Retry-After carries no wait', async () => {
    expect(await failing(envelope(429, 'ai_rate_limited'))).toEqual({
      ok: false,
      code: 'rate_limited',
    })
  })

  it('503 ai_disabled -> disabled', async () => {
    expect(await failing(envelope(503, 'ai_disabled'))).toEqual({ ok: false, code: 'disabled' })
  })

  it('a bare 503 (gateway) is an error, not disabled', async () => {
    expect(await failing(new Response('bad gateway', { status: 503 }))).toEqual({
      ok: false,
      code: 'error',
    })
  })

  it('403 ai_context_forbidden -> forbidden', async () => {
    expect(await failing(envelope(403, 'ai_context_forbidden'))).toEqual({
      ok: false,
      code: 'forbidden',
    })
  })

  it('a network failure -> offline', async () => {
    const fetch = vi.fn<FetchLike>(async () => {
      throw new TypeError('fetch failed')
    })
    expect(await client(fetch).ask(REQ)).toEqual({ ok: false, code: 'offline' })
  })

  it('a redirect is refused and reads as an error, not offline', async () => {
    const fetch = vi.fn<FetchLike>(async () => {
      throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') })
    })
    expect(await client(fetch).ask(REQ)).toEqual({ ok: false, code: 'error' })
  })

  it('anything else (500, 400, malformed body) -> error', async () => {
    expect(await failing(envelope(500, 'internal'))).toEqual({ ok: false, code: 'error' })
    expect(await failing(envelope(400, 'validation_failed'))).toEqual({ ok: false, code: 'error' })
    expect(await failing(json(200, { nope: true }))).toEqual({ ok: false, code: 'error' })
    expect(await failing(json(200, answer({ content: 7 })))).toEqual({ ok: false, code: 'error' })
  })
})

describe('response mapping', () => {
  it('maps citations of every kind to camelCase and keeps the notice', async () => {
    const citations = [
      { source_id: 'S1', quote: 'q1', kind: 'document', title: 'Plan', href: '/a/b/documents/d1' },
      { source_id: 'S2', quote: 'q2', kind: 'task', title: 'Spec', href: '/a/b/tasks/t1' },
      { source_id: 'S3', quote: 'q3', kind: 'meeting', title: 'Sync', href: '/a/b/meetings/m1' },
      { source_id: 'S4', quote: 'q4', kind: 'chat', title: '#general', href: '/a/b/chat/r1' },
      { source_id: 'S5', quote: 'q5', kind: 'members', title: 'An', href: '/a/b/members/u1' },
    ]
    const result = await client(
      vi.fn<FetchLike>(async () => json(200, answer({ citations, notice: 'no_sources' }))),
    ).ask(REQ)
    expect(result).toEqual({
      ok: true,
      conversationId: CONV,
      message: {
        id: '01K4AIMSG0000000000000001',
        content: 'Có 1 việc quá hạn [S1].',
        citations: [
          {
            sourceId: 'S1',
            kind: 'document',
            title: 'Plan',
            quote: 'q1',
            href: '/a/b/documents/d1',
          },
          { sourceId: 'S2', kind: 'task', title: 'Spec', quote: 'q2', href: '/a/b/tasks/t1' },
          { sourceId: 'S3', kind: 'meeting', title: 'Sync', quote: 'q3', href: '/a/b/meetings/m1' },
          { sourceId: 'S4', kind: 'chat', title: '#general', quote: 'q4', href: '/a/b/chat/r1' },
          { sourceId: 'S5', kind: 'member', title: 'An', quote: 'q5', href: '/a/b/members/u1' },
        ],
        notice: 'no_sources',
      },
    })
  })

  it('omits the notice when the server sends none or an unknown one, and null citations are empty', async () => {
    const plain = await client(
      vi.fn<FetchLike>(async () => json(200, answer({ citations: null }))),
    ).ask(REQ)
    expect(plain.ok && plain.message).toEqual({
      id: '01K4AIMSG0000000000000001',
      content: 'Có 1 việc quá hạn [S1].',
      citations: [],
    })
    const unknown = await client(
      vi.fn<FetchLike>(async () => json(200, answer({ notice: 'something_new' }))),
    ).ask(REQ)
    expect(unknown.ok && 'notice' in unknown.message).toBe(false)
  })

  it('drops a citation of a kind the app cannot show and keeps the rest', async () => {
    const citations = [
      { source_id: 'S1', quote: '', kind: 'hologram', title: 'x', href: '/x' },
      { source_id: 'S2', quote: 'q', kind: 'task', title: 'Spec', href: '/a/b/tasks/t1' },
    ]
    const result = await client(vi.fn<FetchLike>(async () => json(200, answer({ citations })))).ask(
      REQ,
    )
    expect(result.ok && result.message.citations.map((c) => c.sourceId)).toEqual(['S2'])
  })

  it('an empty_answer notice keeps its empty content', async () => {
    const result = await client(
      vi.fn<FetchLike>(async () => json(200, answer({ content: '', notice: 'empty_answer' }))),
    ).ask(REQ)
    expect(result.ok && result.message).toMatchObject({ content: '', notice: 'empty_answer' })
  })
})

describe('privacy', () => {
  it('logs neither the question, the answer nor the token, on success or failure', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    )
    await client(vi.fn<FetchLike>(async () => json(200, answer()))).ask(REQ)
    await client(vi.fn<FetchLike>(async () => envelope(402, 'ai_quota_exceeded'))).ask(REQ)
    await client(
      vi.fn<FetchLike>(async () => {
        throw new TypeError('fetch failed')
      }),
    ).ask(REQ)
    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls))
    for (const secret of ['task nào quá hạn', 'Có 1 việc quá hạn', 'tok_secret']) {
      expect(logged).not.toContain(secret)
    }
  })
})
