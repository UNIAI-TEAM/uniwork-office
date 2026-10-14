import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AiStreamChunk,
  AiStreamRequest,
  StreamCallbacks,
  UniworkChatRequest,
  UniworkChatTransport,
  UniworkScope,
  UniworkTurnRequest,
} from '@genoffice/ai-provider'
import { UniworkError, defaultAiSettings } from '@genoffice/ai-provider'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { TransportError, type FetchLike } from '../src/main/uniwork-auth/transport'
import {
  createUniworkAiChatTransport,
  createUniworkAiStreams,
  resolveUniworkAiScope,
  uniworkFormatOfTab,
  type UniworkAiScopeDeps,
  type UniworkAiStreamDeps,
} from '../src/main/uniwork-auth/ai-chat'

/**
 * G6-05 slice B: the desktop half of UniWork AI in the shell main process -
 * the transport the adapter posts through (route by binding, device bearer,
 * organization), the webContents -> scope resolver, and the `ai:stream`
 * runner (pings while a Retry-After wait runs, sign-out cancel, error codes
 * that never reach the overload classifier). The adapter itself is a fake.
 */

const ORIGIN = 'https://uniwork.example'
const profile: DeploymentProfile = {
  deploymentId: 'default',
  apiOrigin: ORIGIN,
  clientId: 'uniwork-office',
  channel: 'stable',
}
const TOKEN_1 = 'at_secret_one'
const TOKEN_2 = 'at_secret_two'
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const ORG = '01J8X4ORG0N1P2Q3R4S5T6U7'

const docScope: UniworkScope = { kind: 'document', documentId: DOC, format: 'docx' }
const orgScope: UniworkScope = { kind: 'org', orgId: ORG, format: 'xlsx' }

function chatRequest(
  scope: UniworkScope,
  headers: Record<string, string> = {},
): UniworkChatRequest {
  return {
    scope,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], stream: true }),
    signal: new AbortController().signal,
  }
}

/** account manager double: one refresh + one retry after TransportError('unauthorized') */
function authorizedDouble(signedIn = true) {
  const tokens = [TOKEN_1, TOKEN_2]
  return vi.fn(async <T>(call: (token: string) => Promise<T>): Promise<T> => {
    if (!signedIn) throw new TransportError('unauthorized')
    try {
      return await call(tokens[0]!)
    } catch (error) {
      if (error instanceof TransportError && error.code === 'unauthorized') {
        return call(tokens[1]!)
      }
      throw error
    }
  })
}

function recordingFetch(answer: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit; headers: Record<string, string> }> = []
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    )
    calls.push({ url, init, headers })
    return answer(url, init)
  }) satisfies FetchLike
  return { fetch, calls }
}

const sse = () =>
  new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'X-UniWork-AI-Conversation': 'c1' },
  })

describe('UniWork AI chat transport (shell main)', () => {
  it('a bound document posts to the document route with the device bearer', async () => {
    const { fetch, calls } = recordingFetch(() => sse())
    const transport = createUniworkAiChatTransport({
      profile: () => profile,
      authorized: authorizedDouble(),
      fetch,
    })
    const response = await transport.post(
      chatRequest(docScope, { 'X-UniWork-AI-Conversation': 'c1', 'X-UniWork-AI-Run': 'r1' }),
    )
    expect(response.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(`${ORIGIN}/api/v1/documents/${DOC}/ai/uniwork/chat/completions`)
    expect(calls[0]!.init.method).toBe('POST')
    expect(calls[0]!.init.redirect).toBe('error')
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${TOKEN_1}`)
    expect(calls[0]!.headers['x-uniwork-ai-conversation']).toBe('c1')
    expect(calls[0]!.headers['x-uniwork-ai-run']).toBe('r1')
    expect(calls[0]!.init.body).toBe(chatRequest(docScope).body)
  })

  it('a local file posts to the organization route', async () => {
    const { fetch, calls } = recordingFetch(() => sse())
    const transport = createUniworkAiChatTransport({
      profile: () => profile,
      authorized: authorizedDouble(),
      fetch,
    })
    await transport.post(chatRequest(orgScope))
    expect(calls[0]!.url).toBe(`${ORIGIN}/api/v1/orgs/${ORG}/ai/uniwork/chat/completions`)
  })

  it('an Authorization header from the request never replaces the device bearer', async () => {
    const { fetch, calls } = recordingFetch(() => sse())
    const transport = createUniworkAiChatTransport({
      profile: () => profile,
      authorized: authorizedDouble(),
      fetch,
    })
    await transport.post(chatRequest(orgScope, { authorization: 'Bearer forged' }))
    const auth = Object.entries(calls[0]!.init.headers as Record<string, string>).filter(
      ([k]) => k.toLowerCase() === 'authorization',
    )
    expect(auth).toEqual([['Authorization', `Bearer ${TOKEN_1}`]])
  })

  it('a 401 refreshes once and resends; a second 401 comes back as the raw response', async () => {
    let n = 0
    const { fetch, calls } = recordingFetch(
      () =>
        new Response(JSON.stringify({ code: 'unauthorized', n: ++n }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    const transport = createUniworkAiChatTransport({
      profile: () => profile,
      authorized: authorizedDouble(),
      fetch,
    })
    const response = await transport.post(chatRequest(docScope))
    expect(calls.map((c) => c.headers.authorization)).toEqual([
      `Bearer ${TOKEN_1}`,
      `Bearer ${TOKEN_2}`,
    ])
    expect(response.status).toBe(401)
    // the adapter can still read the body of the last answer
    expect(await response.json()).toMatchObject({ n: 2 })
  })

  it('non-2xx answers resolve raw (429 with Retry-After reaches the adapter)', async () => {
    const { fetch } = recordingFetch(
      () =>
        new Response(JSON.stringify({ code: 'ai_uniwork_busy' }), {
          status: 429,
          headers: { 'Retry-After': '5', 'X-UniWork-AI-Run': 'r9' },
        }),
    )
    const transport = createUniworkAiChatTransport({
      profile: () => profile,
      authorized: authorizedDouble(),
      fetch,
    })
    const response = await transport.post(chatRequest(docScope))
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('5')
  })

  it('signed out or no deployment: a 401 answer without any request', async () => {
    const { fetch, calls } = recordingFetch(() => sse())
    const signedOut = createUniworkAiChatTransport({
      profile: () => profile,
      authorized: authorizedDouble(false),
      fetch,
    })
    expect((await signedOut.post(chatRequest(docScope))).status).toBe(401)
    const noProfile = createUniworkAiChatTransport({
      profile: () => null,
      authorized: authorizedDouble(),
      fetch,
    })
    expect((await noProfile.post(chatRequest(docScope))).status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('refuses the frame scope, invalid ids and a plain-http non-loopback origin', async () => {
    const { fetch, calls } = recordingFetch(() => sse())
    const transport = createUniworkAiChatTransport({
      profile: () => profile,
      authorized: authorizedDouble(),
      fetch,
    })
    await expect(
      transport.post(chatRequest({ kind: 'frame', documentId: DOC, format: 'docx' })),
    ).rejects.toThrow()
    await expect(
      transport.post(chatRequest({ kind: 'document', documentId: '../x', format: 'docx' })),
    ).rejects.toThrow()
    const http = createUniworkAiChatTransport({
      profile: () => ({ ...profile, apiOrigin: 'http://uniwork.example' }),
      authorized: authorizedDouble(),
      fetch,
    })
    await expect(http.post(chatRequest(docScope))).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })

  it('a network failure rejects (the adapter reads it as no answer)', async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError('fetch failed')
    }
    const transport = createUniworkAiChatTransport({
      profile: () => profile,
      authorized: authorizedDouble(),
      fetch,
    })
    await expect(transport.post(chatRequest(docScope))).rejects.toThrow()
  })
})

describe('webContents -> UniWork AI scope (OQ-P2)', () => {
  const deps = (over: Partial<UniworkAiScopeDeps> = {}): UniworkAiScopeDeps => ({
    describe: () => ({ kind: 'docs', filePath: '/w/a.docx' }),
    binding: () => null,
    orgId: () => ORG,
    ...over,
  })

  it('a tab showing a bound document goes to the document route with its org', () => {
    const result = resolveUniworkAiScope(
      7,
      deps({ binding: () => ({ documentId: DOC, orgId: 'org-b' }) }),
    )
    expect(result).toEqual({
      ok: true,
      scope: { kind: 'document', documentId: DOC, format: 'docx' },
      orgId: 'org-b',
    })
  })

  it('a local file goes to the selected organization with the module format', () => {
    expect(
      resolveUniworkAiScope(
        7,
        deps({ describe: () => ({ kind: 'slides', filePath: '/x/p.pptx' }) }),
      ),
    ).toEqual({ ok: true, scope: { kind: 'org', orgId: ORG, format: 'pptx' }, orgId: ORG })
    expect(
      resolveUniworkAiScope(
        7,
        deps({ describe: () => ({ kind: 'markdown', filePath: '/x/n.md' }) }),
      ),
    ).toMatchObject({ ok: true, scope: { format: 'markdown' } })
  })

  it('an untitled tab takes the format of its module', () => {
    expect(resolveUniworkAiScope(7, deps({ describe: () => ({ kind: 'sheets' }) }))).toMatchObject({
      ok: true,
      scope: { kind: 'org', format: 'xlsx' },
    })
  })

  it('refusals carry a server-style code, never a route', () => {
    // another account's copy in the UniWork store
    expect(resolveUniworkAiScope(7, deps({ binding: () => 'hidden' }))).toEqual({
      ok: false,
      code: 'access_revoked',
    })
    // a format outside the six (odt in the docs module)
    expect(
      resolveUniworkAiScope(7, deps({ describe: () => ({ kind: 'docs', filePath: '/x/a.odt' }) })),
    ).toEqual({ ok: false, code: 'office_capability_off' })
    // no organization chosen (signed out, or the picker is up)
    expect(resolveUniworkAiScope(7, deps({ orgId: () => null }))).toEqual({
      ok: false,
      code: 'session_expired',
    })
    // not an editor (Home, a stray window)
    expect(resolveUniworkAiScope(7, deps({ describe: () => null }))).toEqual({
      ok: false,
      code: 'ai_disabled',
    })
    expect(resolveUniworkAiScope(7, deps({ describe: () => ({ kind: 'home' }) }))).toEqual({
      ok: false,
      code: 'ai_disabled',
    })
  })

  it('maps the six formats and nothing else', () => {
    expect(uniworkFormatOfTab({ kind: 'docs', filePath: '/a/b.DOCX' })).toBe('docx')
    expect(uniworkFormatOfTab({ kind: 'html', filePath: '/a/b.htm' })).toBe('html')
    expect(uniworkFormatOfTab({ kind: 'pdf' })).toBe('pdf')
    expect(uniworkFormatOfTab({ kind: 'sheets', filePath: '/a/b.csv' })).toBeNull()
  })
})

// ── ai:stream runner ───────────────────────────────────────────────

type FakeStream = (
  transport: UniworkChatTransport,
  request: UniworkTurnRequest,
  cb: StreamCallbacks,
) => Promise<void>

const nullTransport: UniworkChatTransport = { post: async () => sse() }

function streamRequest(over: Partial<AiStreamRequest> = {}): AiStreamRequest {
  return {
    requestId: 'req-1',
    sessionId: 'sess-1',
    settings: { ...defaultAiSettings(), provider: 'uniwork' },
    system: 'sys',
    messages: [{ role: 'user', content: 'make it bold' }],
    tools: [{ name: 'format_text', description: 'd', inputSchema: { type: 'object' } }],
    ...over,
  }
}

function runner(stream: FakeStream, over: Partial<UniworkAiStreamDeps> = {}) {
  const deps: UniworkAiStreamDeps = {
    transport: () => nullTransport,
    scope: () => ({ ok: true, scope: docScope, orgId: ORG }),
    available: async () => true,
    toolPolicy: () => ({ cloudTools: false }),
    stream,
    ...over,
  }
  return createUniworkAiStreams(deps)
}

function run(
  streams: ReturnType<typeof createUniworkAiStreams>,
  request = streamRequest(),
  signal = new AbortController().signal,
) {
  const chunks: AiStreamChunk[] = []
  const done = streams.run({ senderId: 7, request, send: (c) => chunks.push(c), signal })
  return { chunks, done }
}

const terminal = (chunks: AiStreamChunk[]) =>
  chunks.filter((c) => c.type === 'done' || c.type === 'error')

afterEach(() => {
  vi.useRealTimers()
})

describe('ai:stream uniwork runner', () => {
  it('hands the adapter the scope, the full history, the tools, the policy and the session', async () => {
    let seen: { request: UniworkTurnRequest; sessionId?: string } | null = null
    const streams = runner(async (_t, request, cb) => {
      seen = { request, ...(cb.sessionId ? { sessionId: cb.sessionId } : {}) }
      cb.onDelta('Done.')
      cb.onToolCall({ id: 'call_1', name: 'format_text', input: { bold: true } })
    })
    const { chunks, done } = run(streams)
    await done
    expect(seen).toEqual({
      request: {
        scope: docScope,
        messages: [{ role: 'user', content: 'make it bold' }],
        tools: [{ name: 'format_text', description: 'd', inputSchema: { type: 'object' } }],
        toolPolicy: { cloudTools: false },
      },
      sessionId: 'sess-1',
    })
    expect(chunks.map((c) => c.type)).toEqual(['delta', 'tool-call', 'done'])
    expect(chunks.every((c) => c.requestId === 'req-1')).toBe(true)
  })

  it('forwards notices and a turn reset as their own chunks', async () => {
    const streams = runner(async (_t, _r, cb) => {
      cb.onNotice?.({ kind: 'step', step: 1, limit: 20 })
      cb.onNotice?.({
        kind: 'dropped-tool-calls',
        calls: [{ index: 0, name: 'delete_all', reason: 'view_only' }],
      })
      cb.onTurnReset?.()
    })
    const { chunks, done } = run(streams)
    await done
    expect(chunks).toEqual([
      { requestId: 'req-1', type: 'notice', notice: { kind: 'step', step: 1, limit: 20 } },
      {
        requestId: 'req-1',
        type: 'notice',
        notice: {
          kind: 'dropped-tool-calls',
          calls: [{ index: 0, name: 'delete_all', reason: 'view_only' }],
        },
      },
      { requestId: 'req-1', type: 'reset' },
      { requestId: 'req-1', type: 'done' },
    ])
  })

  it('pings at least every 5 s through a Retry-After wait, and stops on the resend', async () => {
    vi.useFakeTimers()
    let release!: () => void
    const streams = runner(async (_t, _r, cb) => {
      cb.onNotice?.({ kind: 'rate-limit-wait', seconds: 120, attempt: 1 })
      await new Promise<void>((resolve) => {
        release = resolve
      })
      cb.onTurnReset?.()
      cb.onDelta('answer')
    })
    const { chunks, done } = run(streams)
    await vi.advanceTimersByTimeAsync(0)
    expect(chunks.map((c) => c.type)).toEqual(['notice', 'ping'])
    await vi.advanceTimersByTimeAsync(120_000)
    const pings = chunks.filter((c) => c.type === 'ping').length
    // 240 s silence watchdog: a 120 s wait is covered with room to spare
    expect(pings).toBeGreaterThanOrEqual(24)
    // never an error (no Retry button) while waiting
    expect(chunks.some((c) => c.type === 'error')).toBe(false)
    release()
    await done
    await vi.advanceTimersByTimeAsync(30_000)
    expect(chunks.filter((c) => c.type === 'ping').length).toBe(pings)
    expect(chunks.slice(-3).map((c) => c.type)).toEqual(['reset', 'delta', 'done'])
  })

  it('a failure carries the server code and never an overload errorCode', async () => {
    const failure = Object.assign(new Error('UniWork AI is unavailable right now.'), {
      name: 'UniworkError',
      code: 'run_limit_reached',
      status: 409,
      retryAfterSec: undefined,
    })
    const streams = runner(async () => {
      throw failure
    })
    const { chunks, done } = run(streams)
    await done
    expect(terminal(chunks)).toHaveLength(1)
    const [error] = terminal(chunks)
    expect(error).toMatchObject({ type: 'error', uniworkCode: 'run_limit_reached' })
    expect(error!.errorCode).toBeUndefined()
    expect(error!.error).not.toContain('run_limit_reached')
  })

  it("the adapter's UniworkError maps through aiStreamErrorFields: code + Retry-After, no code in the text", async () => {
    const streams = runner(async () => {
      throw new UniworkError('ai_uniwork_busy', { status: 429, retryAfterSec: 5 })
    })
    const { chunks, done } = run(streams)
    await done
    const [error] = terminal(chunks)
    expect(error).toMatchObject({ type: 'error', uniworkCode: 'ai_uniwork_busy', retryAfterSec: 5 })
    expect(error!.errorCode).toBeUndefined()
    expect(error!.error).not.toContain('ai_uniwork_busy')
  })

  it('a 429 give-up carries its Retry-After seconds', async () => {
    const streams = runner(async () => {
      throw Object.assign(new Error('busy'), {
        name: 'UniworkError',
        code: 'ai_rate_limited',
        status: 429,
        retryAfterSec: 301,
      })
    })
    const { chunks, done } = run(streams)
    await done
    expect(terminal(chunks)[0]).toMatchObject({
      type: 'error',
      uniworkCode: 'ai_rate_limited',
      retryAfterSec: 301,
    })
  })

  it('an error without a server code is an unavailable turn, not overloaded', async () => {
    const streams = runner(async () => {
      throw new Error('HTTP 503: upstream overloaded, too many requests')
    })
    const { chunks, done } = run(streams)
    await done
    const [error] = terminal(chunks)
    expect(error).toMatchObject({ type: 'error', uniworkCode: 'ai_provider_error' })
    expect(error!.errorCode).toBeUndefined()
  })

  it('Stop ends the turn with done, once', async () => {
    const stop = new AbortController()
    const streams = runner(async (_t, _r, cb) => {
      await new Promise<void>((_resolve, reject) => {
        cb.signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    })
    const { chunks, done } = run(streams, streamRequest(), stop.signal)
    await Promise.resolve()
    stop.abort()
    await done
    expect(terminal(chunks)).toEqual([{ requestId: 'req-1', type: 'done' }])
  })

  it('sign-out cancels every running UniWork AI turn with a session error, once each', async () => {
    const streams = runner(async (_t, _r, cb) => {
      cb.onNotice?.({ kind: 'rate-limit-wait', seconds: 60, attempt: 1 })
      await new Promise<void>((_resolve, reject) => {
        cb.signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    })
    const a = run(streams, streamRequest({ requestId: 'a' }))
    const b = run(streams, streamRequest({ requestId: 'b' }))
    await Promise.resolve()
    expect(streams.active()).toBe(2)
    expect(streams.cancelAll()).toBe(2)
    await Promise.all([a.done, b.done])
    for (const { chunks } of [a, b]) {
      expect(terminal(chunks)).toHaveLength(1)
      expect(terminal(chunks)[0]).toMatchObject({ type: 'error', uniworkCode: 'session_expired' })
    }
    expect(streams.active()).toBe(0)
  })

  it('a refused scope answers with its code and never calls the adapter', async () => {
    const stream = vi.fn<FakeStream>(async () => undefined)
    const streams = runner(stream, { scope: () => ({ ok: false, code: 'access_revoked' }) })
    const { chunks, done } = run(streams)
    await done
    expect(stream).not.toHaveBeenCalled()
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ type: 'error', uniworkCode: 'access_revoked' })
  })

  it('UniWork AI off for the org or format: a uniwork-off notice, then a quiet done (no error chunk)', async () => {
    const stream = vi.fn<FakeStream>(async () => undefined)
    const available = vi.fn(async () => false)
    const streams = runner(stream, { available })
    const { chunks, done } = run(streams)
    await done
    expect(available).toHaveBeenCalledWith(docScope, ORG)
    expect(stream).not.toHaveBeenCalled()
    expect(chunks.map((c) => c.type)).toEqual(['notice', 'done'])
    expect(chunks[0]!.notice).toEqual({ kind: 'uniwork-off' })
  })

  it('a format outside the six (scope refusal off): the same quiet notice + done', async () => {
    const stream = vi.fn<FakeStream>(async () => undefined)
    const streams = runner(stream, { scope: () => ({ ok: false, code: 'office_capability_off' }) })
    const { chunks, done } = run(streams)
    await done
    expect(stream).not.toHaveBeenCalled()
    expect(chunks.map((c) => c.type)).toEqual(['notice', 'done'])
    expect(chunks[0]!.notice).toEqual({ kind: 'uniwork-off' })
  })

  it('the server 403 office_capability_off before a run id (notice already sent): ends with done, no error', async () => {
    const streams = runner(async (_t, _r, cb) => {
      cb.onNotice?.({ kind: 'uniwork-off' })
      throw new UniworkError('office_capability_off', { status: 403 })
    })
    const { chunks, done } = run(streams)
    await done
    expect(chunks.map((c) => c.type)).toEqual(['notice', 'done'])
  })

  it('office_capability_off in the middle of a run (no off notice) stays a visible error', async () => {
    const streams = runner(async () => {
      throw new UniworkError('office_capability_off', { status: 403 })
    })
    const { chunks, done } = run(streams)
    await done
    expect(terminal(chunks)).toMatchObject([
      { type: 'error', uniworkCode: 'office_capability_off' },
    ])
  })

  it('no transport installed (signed out): a session error', async () => {
    const stream = vi.fn<FakeStream>(async () => undefined)
    const streams = runner(stream, { transport: () => null })
    const { chunks, done } = run(streams)
    await done
    expect(stream).not.toHaveBeenCalled()
    expect(chunks).toEqual([
      expect.objectContaining({ type: 'error', uniworkCode: 'session_expired' }),
    ])
  })

  it('cloud tools go out only while office.ai_cloud is on', async () => {
    const policies: unknown[] = []
    let cloud = false
    const streams = runner(
      async (_t, request) => {
        policies.push(request.toolPolicy)
      },
      { toolPolicy: () => ({ cloudTools: cloud }) },
    )
    await run(streams).done
    cloud = true
    await run(streams).done
    expect(policies).toEqual([{ cloudTools: false }, { cloudTools: true }])
  })
})
