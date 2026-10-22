import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ASKUNI_STREAM_IDLE_MS,
  askUniV2CodeOfError,
  createAskUniStreamClient,
  createSseParser,
  type AskUniStreamPayload,
} from '../src/main/uniwork-askuni/stream-client'
import type { FetchLike } from '../src/main/uniwork-docs/client'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { TransportError } from '../src/main/uniwork-auth/transport'
import type { AskUniStreamRequest } from '../src/shared/askuni-api'

/**
 * UNI-2076 s1: the Ask UNI v2 stream client of the shell main process
 * (`POST /workspaces/{ws}/ai/ask/stream`, SSE) against an in-memory fetch:
 * the SSE parser, the per-frame bounds, the error map and the idle deadline.
 */

const ORIGIN = 'https://uniwork.example'
const WS = '01J8X4K2M0N1P2Q3R4S5T6U7V8'
const CONV = '01K4AICONV000000000000001'
const REQ: AskUniStreamRequest = { workspaceId: WS, question: 'task nào quá hạn?', locale: 'vi' }
const enc = new TextEncoder()

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
const DONE = {
  message: {
    id: '01K4AIMSG0000000000000001',
    role: 'assistant',
    content: 'Có 1 việc quá hạn [S1].',
    citations: [],
    created_at: '2026-10-21T08:00:00Z',
  },
  usage: { input_tokens: 10, output_tokens: 5, cache_read_tokens: 1, cache_write_tokens: 2 },
}

/** an SSE response whose body is the given chunks (strings or bytes), then closes */
function sse(chunks: Array<string | Uint8Array>, status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === 'string' ? enc.encode(c) : c)
      controller.close()
    },
  })
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } })
}

/** an SSE response that stays open until the test pushes / closes it */
function openSse() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c
    },
  })
  return {
    response: new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    push: (s: string) => ctrl.enqueue(enc.encode(s)),
    close: () => ctrl.close(),
  }
}

const envelope = (status: number, code: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { code, message: 'x' } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

function client(
  fetch: FetchLike,
  over: { authorized?: <T>(c: (t: string) => Promise<T>) => Promise<T> } = {},
) {
  return createAskUniStreamClient({
    apiOrigin: ORIGIN,
    authorized: over.authorized ?? ((call) => call('tok_secret')),
    isSignedIn: () => true,
    fetch,
  })
}

async function run(
  fetch: FetchLike,
  req: AskUniStreamRequest = REQ,
  signal: AbortSignal = new AbortController().signal,
) {
  const events: AskUniStreamPayload[] = []
  const terminal = await client(fetch).stream(req, { signal, onEvent: (e) => events.push(e) })
  return { events, terminal }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createSseParser', () => {
  const collect = () => {
    const frames: Array<[string, string]> = []
    const parser = createSseParser((name, data) => frames.push([name, data]))
    return { frames, parser }
  }

  it('splits frames on a blank line, reads event/data and ignores comments', () => {
    const { frames, parser } = collect()
    parser.push(enc.encode(': ping\n\nevent: delta\ndata: {"text":"a"}\n\n: ping\n\n'))
    expect(frames).toEqual([['delta', '{"text":"a"}']])
  })

  it('joins multi-line data with a newline and strips one leading space', () => {
    const { frames, parser } = collect()
    parser.push(enc.encode('event: delta\ndata: {"text":\ndata:  "x"}\n\n'))
    expect(frames).toEqual([['delta', '{"text":\n "x"}']])
  })

  it('keeps a partial frame across reads and accepts CRLF line ends split between reads', () => {
    const { frames, parser } = collect()
    parser.push(enc.encode('event: del'))
    parser.push(enc.encode('ta\r'))
    parser.push(enc.encode('\ndata: {"text":"b"}\r\n'))
    expect(frames).toEqual([])
    parser.push(enc.encode('\r\n'))
    expect(frames).toEqual([['delta', '{"text":"b"}']])
  })

  it('decodes a UTF-8 character split across chunks', () => {
    const { frames, parser } = collect()
    const bytes = enc.encode('event: delta\ndata: {"text":"Việc"}\n\n')
    // cut inside the 3-byte "ệ"
    const cut = bytes.indexOf(0xe1) + 1
    parser.push(bytes.slice(0, cut))
    parser.push(bytes.slice(cut))
    expect(frames).toEqual([['delta', '{"text":"Việc"}']])
  })

  it('drops a frame with no event name or no data, and an unterminated tail at end', () => {
    const { frames, parser } = collect()
    parser.push(
      enc.encode('data: {"text":"a"}\n\nevent: delta\n\nevent: delta\ndata: {"text":"z"}'),
    )
    parser.end()
    expect(frames).toEqual([])
  })
})

describe('askUniStream: request', () => {
  it('POSTs the server field names with the bearer and Accept text/event-stream', async () => {
    const fetch = vi.fn<FetchLike>(async () => sse([frame('done', DONE)]))
    await run(fetch, {
      ...REQ,
      conversationId: CONV,
      focus: { kind: 'document', id: 'doc_1' },
      mentions: [{ kind: 'member', id: 'usr_1' }],
      model: 'sonnet',
      effort: 'high',
    })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`${ORIGIN}/api/v1/workspaces/${WS}/ai/ask/stream`)
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok_secret')
    expect(headers.Accept).toBe('text/event-stream')
    expect(headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(await new Response(init.body as Blob).text())
    expect(body).toEqual({
      conversation_id: CONV,
      question: 'task nào quá hạn?',
      locale: 'vi',
      focus: { kind: 'document', id: 'doc_1' },
      mentions: [{ kind: 'member', id: 'usr_1' }],
      model: 'sonnet',
      effort: 'high',
    })
  })

  it('omits the optional fields it was not given', async () => {
    const fetch = vi.fn<FetchLike>(async () => sse([frame('done', DONE)]))
    await run(fetch)
    const body = JSON.parse(await new Response(fetch.mock.calls[0][1].body as Blob).text())
    expect(body).toEqual({ conversation_id: '', question: 'task nào quá hạn?', locale: 'vi' })
  })
})

describe('askUniStream: events', () => {
  it('maps every server event and ends on done', async () => {
    const citation = {
      source_id: 'S1',
      kind: 'task',
      title: 'Viết spec',
      quote: 'Hạn 5/9',
      href: '/acme/team/tasks/01J8X4K2M0N1P2Q3R4S5T6U7VA',
    }
    const { events, terminal } = await run(async () =>
      sse([
        frame('run', { run_id: '01K4AIRUN000000000000001', conversation_id: CONV }),
        frame('step', { round: 1, phase: 'tool', tool: 'search_tasks', counts: { task: 3 } }),
        frame('delta', { text: 'Có 1 ' }),
        frame('delta', { text: 'việc' }),
        frame('citations', { citations: [citation] }),
        frame('done', { ...DONE, message: { ...DONE.message, citations: [citation] } }),
      ]),
    )
    expect(events).toEqual([
      { type: 'run', runId: '01K4AIRUN000000000000001', conversationId: CONV },
      { type: 'step', round: 1, phase: 'tool', tool: 'search_tasks', counts: { task: 3 } },
      { type: 'delta', text: 'Có 1 ' },
      { type: 'delta', text: 'việc' },
      {
        type: 'citations',
        citations: [
          {
            sourceId: 'S1',
            kind: 'task',
            title: 'Viết spec',
            quote: 'Hạn 5/9',
            href: '/acme/team/tasks/01J8X4K2M0N1P2Q3R4S5T6U7VA',
          },
        ],
      },
    ])
    expect(terminal).toMatchObject({
      type: 'done',
      message: {
        id: DONE.message.id,
        role: 'assistant',
        content: DONE.message.content,
        createdAt: '2026-10-21T08:00:00Z',
        citations: [{ sourceId: 'S1', kind: 'task' }],
      },
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 1, cacheWriteTokens: 2 },
    })
  })

  it('drops unknown event names, malformed JSON and frames of the wrong shape', async () => {
    const { events, terminal } = await run(async () =>
      sse([
        frame('thinking', { text: 'x' }),
        'event: delta\ndata: {not json\n\n',
        frame('delta', { text: 5 }),
        frame('run', { run_id: '', conversation_id: '../etc' }),
        frame('step', { round: 1, phase: 'dance', tool: 't', counts: {} }),
        frame('delta', { text: 'ok' }),
        frame('done', DONE),
      ]),
    )
    expect(events).toEqual([{ type: 'delta', text: 'ok' }])
    expect(terminal.type).toBe('done')
  })

  it('bounds citations like P1: title 300, quote 1000, unsafe href emptied, unknown kind -> other', async () => {
    const { events } = await run(async () =>
      sse([
        frame('citations', {
          citations: [
            {
              source_id: 'S1',
              kind: 'project',
              title: 't'.repeat(400),
              quote: 'q'.repeat(1500),
              href: 'https://evil.example/x',
            },
            { source_id: 'S2', kind: 'members', title: 'An', quote: '', href: '//evil/x' },
            { kind: 'task' },
          ],
        }),
        frame('done', DONE),
      ]),
    )
    const cits = (events[0] as Extract<AskUniStreamPayload, { type: 'citations' }>).citations
    expect(cits).toHaveLength(2)
    expect(cits[0]).toMatchObject({ kind: 'other', href: '' })
    expect(cits[0].title).toHaveLength(300)
    expect(cits[0].quote).toHaveLength(1000)
    expect(cits[1]).toMatchObject({ kind: 'member', href: '' })
  })

  it('bounds the streamed text to 20k in total and the done content to 20k', async () => {
    const { events, terminal } = await run(async () =>
      sse([
        frame('delta', { text: 'a'.repeat(15_000) }),
        frame('delta', { text: 'b'.repeat(10_000) }),
        frame('delta', { text: 'c' }),
        frame('done', { ...DONE, message: { ...DONE.message, content: 'x'.repeat(25_000) } }),
      ]),
    )
    const texts = events.map((e) => (e.type === 'delta' ? e.text : ''))
    expect(texts.join('')).toHaveLength(20_000)
    expect(events).toHaveLength(2)
    expect(terminal.type === 'done' && terminal.message.content).toHaveLength(20_000)
  })

  it('bounds step tool names and count keys, drops non-numeric counts', async () => {
    const counts: Record<string, unknown> = { task: 2, bad: 'x', neg: -1 }
    for (let i = 0; i < 40; i += 1) counts[`k${i}`] = 1
    const { events } = await run(async () =>
      sse([
        frame('step', { round: 2, phase: 'retry', tool: 'x'.repeat(500), counts }),
        frame('done', DONE),
      ]),
    )
    const step = events[0] as Extract<AskUniStreamPayload, { type: 'step' }>
    expect(step.phase).toBe('retry')
    expect(step.tool.length).toBeLessThanOrEqual(64)
    expect(step.counts.task).toBe(2)
    expect(step.counts).not.toHaveProperty('bad')
    expect(step.counts).not.toHaveProperty('neg')
    expect(Object.keys(step.counts).length).toBeLessThanOrEqual(20)
  })

  it('keeps the stopped notice and drops an unknown notice on done', async () => {
    const stopped = await run(async () =>
      sse([frame('done', { ...DONE, message: { ...DONE.message, notice: 'stopped' } })]),
    )
    expect(stopped.terminal).toMatchObject({ type: 'done', message: { notice: 'stopped' } })
    const odd = await run(async () =>
      sse([frame('done', { ...DONE, message: { ...DONE.message, notice: 'weird' } })]),
    )
    expect(odd.terminal.type === 'done' && odd.terminal.message).not.toHaveProperty('notice')
  })

  it('a done with a bad message id is dropped and the stream then ends as stream_ended', async () => {
    const { terminal } = await run(async () =>
      sse([frame('done', { ...DONE, message: { ...DONE.message, id: 'a b' } })]),
    )
    expect(terminal).toEqual({ type: 'error', code: 'stream_ended' })
  })

  it('a body that ends without done is stream_ended', async () => {
    const { events, terminal } = await run(async () => sse([frame('delta', { text: 'half' })]))
    expect(events).toEqual([{ type: 'delta', text: 'half' }])
    expect(terminal).toEqual({ type: 'error', code: 'stream_ended' })
  })

  it('maps a mid-stream error event code and stops reading', async () => {
    const { events, terminal } = await run(async () =>
      sse([
        frame('error', { code: 'ai_provider_error' }),
        frame('delta', { text: 'late' }),
        frame('done', DONE),
      ]),
    )
    expect(events).toEqual([])
    expect(terminal).toEqual({ type: 'error', code: 'provider_error' })
    const unknown = await run(async () => sse([frame('error', { code: 'ai_new_thing' })]))
    expect(unknown.terminal).toEqual({ type: 'error', code: 'error' })
  })

  it('a 2xx that is not an event stream is an error', async () => {
    const { terminal } = await run(
      async () =>
        new Response('{"ok":true}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    expect(terminal).toEqual({ type: 'error', code: 'error' })
  })
})

describe('askUniStream: errors before the first event', () => {
  it.each([
    [402, 'ai_quota_exceeded', 'quota'],
    [503, 'ai_disabled', 'disabled'],
    [403, 'ai_context_forbidden', 'forbidden'],
    [403, 'ai_tool_not_allowed', 'tool_not_allowed'],
    [502, 'ai_provider_error', 'provider_error'],
    [504, 'ai_provider_timeout', 'provider_timeout'],
    [408, 'ai_cancelled', 'cancelled'],
    [502, 'ai_output_invalid', 'output_invalid'],
    [422, 'ai_refused', 'refused'],
    [500, 'internal', 'error'],
  ])('%i %s -> %s', async (status, code, expected) => {
    const { terminal } = await run(async () => envelope(status, code))
    expect(terminal).toEqual({ type: 'error', code: expected })
  })

  it('a 429 carries Retry-After in seconds, clamped to one hour', async () => {
    const short = await run(async () => envelope(429, 'ai_rate_limited', { 'Retry-After': '30' }))
    expect(short.terminal).toEqual({ type: 'error', code: 'rate_limited', retryAfterSeconds: 30 })
    const long = await run(async () =>
      envelope(429, 'ai_rate_limited', { 'Retry-After': '999999' }),
    )
    expect(long.terminal).toEqual({
      type: 'error',
      code: 'rate_limited',
      retryAfterSeconds: 3600,
    })
  })

  it('no network is offline; a refresh that fails is session', async () => {
    const offline = await run(async () => {
      throw new TypeError('fetch failed')
    })
    expect(offline.terminal).toEqual({ type: 'error', code: 'offline' })
    const events: AskUniStreamPayload[] = []
    const terminal = await client(async () => sse([]), {
      authorized: async () => {
        throw new TransportError('unauthorized', 401)
      },
    }).stream(REQ, { signal: new AbortController().signal, onEvent: (e) => events.push(e) })
    expect(terminal).toEqual({ type: 'error', code: 'session' })
  })

  it('askUniV2CodeOfError keeps the P1 codes', () => {
    expect(askUniV2CodeOfError(new UniworkDocError('not_signed_in'))).toBe('signed_out')
    expect(askUniV2CodeOfError(new UniworkDocError('network'))).toBe('offline')
    // RB-6: a REST / lookup timeout is no provider timeout (only the stream's own idle deadline is)
    expect(askUniV2CodeOfError(new UniworkDocError('timeout'))).toBe('error')
    expect(askUniV2CodeOfError(new Error('x'))).toBe('error')
  })
})

describe('askUniStream: idle deadline and cancel', () => {
  it('45 s without a byte is provider_timeout; a ping restarts the deadline', async () => {
    vi.useFakeTimers()
    const open = openSse()
    const events: AskUniStreamPayload[] = []
    const done = client(async () => open.response).stream(REQ, {
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    })
    await vi.advanceTimersByTimeAsync(ASKUNI_STREAM_IDLE_MS - 1_000)
    open.push(': ping\n\n')
    await vi.advanceTimersByTimeAsync(ASKUNI_STREAM_IDLE_MS - 1_000)
    open.push(frame('delta', { text: 'still here' }))
    await vi.advanceTimersByTimeAsync(ASKUNI_STREAM_IDLE_MS + 1_000)
    expect(await done).toEqual({ type: 'error', code: 'provider_timeout' })
    expect(events).toEqual([{ type: 'delta', text: 'still here' }])
    expect(ASKUNI_STREAM_IDLE_MS).toBe(45_000)
  })

  it('an abort mid-stream ends as cancelled and delivers nothing after it', async () => {
    const open = openSse()
    const controller = new AbortController()
    const events: AskUniStreamPayload[] = []
    const done = client(async () => open.response).stream(REQ, {
      signal: controller.signal,
      onEvent: (e) => {
        events.push(e)
        if (e.type === 'delta') controller.abort()
      },
    })
    open.push(frame('delta', { text: 'one' }) + frame('delta', { text: 'two' }))
    expect(await done).toEqual({ type: 'error', code: 'cancelled' })
    expect(events).toEqual([{ type: 'delta', text: 'one' }])
  })

  it('an abort before the response is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const { terminal } = await run(async () => sse([frame('done', DONE)]), REQ, controller.signal)
    expect(terminal).toEqual({ type: 'error', code: 'cancelled' })
  })
})

describe('s1f (reviewer_be r1)', () => {
  it('RB-5: at most 50 citations per message or citations event, sourceId must be S<digits> up to 16 chars', async () => {
    const cit = (source_id: string) => ({
      source_id,
      kind: 'task',
      title: 't',
      quote: 'q',
      href: '/a/b/tasks/1',
    })
    const many = Array.from({ length: 80 }, (_, i) => cit(`S${i + 1}`))
    const mixed = [
      cit('S1'),
      cit('s2'),
      cit('x'.repeat(2000)),
      cit('S'.repeat(17)),
      cit('S12'),
      cit('S123456789012345'),
      cit('S12345678901234567'),
    ]
    const { events, terminal } = await run(async () =>
      sse([
        frame('citations', { citations: many }),
        frame('citations', { citations: mixed }),
        frame('done', { ...DONE, message: { ...DONE.message, citations: many } }),
      ]),
    )
    const cits = (i: number) =>
      (events[i] as Extract<AskUniStreamPayload, { type: 'citations' }>).citations
    expect(cits(0)).toHaveLength(50)
    expect(cits(0)[49].sourceId).toBe('S50')
    expect(cits(1).map((c) => c.sourceId)).toEqual(['S1', 'S12', 'S123456789012345'])
    expect(terminal.type === 'done' && terminal.message.citations).toHaveLength(50)
  })

  it('RB-6: the stream client keeps provider_timeout for its own send deadline', async () => {
    vi.useFakeTimers()
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))
      })
    const done = client(fetch).stream(REQ, {
      signal: new AbortController().signal,
      onEvent: () => undefined,
    })
    await vi.advanceTimersByTimeAsync(ASKUNI_STREAM_IDLE_MS + 1_000)
    expect(await done).toEqual({ type: 'error', code: 'provider_timeout' })
  })

  it('RB-7: an abort while the first read is pending ends as cancelled at once, no timer advance', async () => {
    vi.useFakeTimers()
    const open = openSse()
    const controller = new AbortController()
    const done = client(async () => open.response).stream(REQ, {
      signal: controller.signal,
      onEvent: () => undefined,
    })
    await vi.advanceTimersByTimeAsync(1_000)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(await done).toEqual({ type: 'error', code: 'cancelled' })
  })

  it('RB-7: an abort while the fetch is still pending ends as cancelled and aborts the fetch', async () => {
    vi.useFakeTimers()
    let fetchSignal: AbortSignal | undefined
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        fetchSignal = init.signal ?? undefined
        init.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))
      })
    const controller = new AbortController()
    const done = client(fetch).stream(REQ, { signal: controller.signal, onEvent: () => undefined })
    await vi.advanceTimersByTimeAsync(1_000)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(await done).toEqual({ type: 'error', code: 'cancelled' })
    expect(fetchSignal?.aborted).toBe(true)
  })

  it('RB-7: more than 1 MB without a frame break is an error, not an endless buffer', async () => {
    const chunk = 'x'.repeat(250_000)
    const { terminal } = await run(async () => sse([chunk, chunk, chunk, chunk, chunk]))
    expect(terminal).toEqual({ type: 'error', code: 'error' })
  })

  it('RB-7: a fetch that never answers is provider_timeout after 45 s', async () => {
    vi.useFakeTimers()
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))
      })
    let settled = false
    const done = client(fetch)
      .stream(REQ, { signal: new AbortController().signal, onEvent: () => undefined })
      .finally(() => void (settled = true))
    await vi.advanceTimersByTimeAsync(ASKUNI_STREAM_IDLE_MS - 1_000)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await done).toEqual({ type: 'error', code: 'provider_timeout' })
  })
})
