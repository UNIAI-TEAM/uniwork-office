// The UniWork AI writer route (UNI-2276, Ask UNI × Office plan 5): a one-shot writer of a running
// turn posts {kind, lang, input} to <ai mount>/uniwork/write with the turn's conversation and run
// headers and streams the reply back as deltas. Runs against a recorded fetch behind the real
// frame client. The format contract of the route is writer-contract.test.ts.
import { describe, expect, it, vi } from 'vitest'
import type { WriterCall } from '@genoffice/agent-core'
import type { AiStreamChunk } from '../../../../packages/ai-provider/src/types'
import { UniworkConversations } from '../../../../packages/ai-provider/src/uniwork/conversation'
import { createAiWebClient } from './client'
import { runUniworkWriter, writerLang } from './writer'

const ORIGIN = 'https://app.test'
const ROUTE = `${ORIGIN}/api/v1/office-frame/documents/doc-1/ai/uniwork/write`
const WRITER: WriterCall = {
  kind: 'docs.write_document',
  input: { plan: 'intro, body', context: 'founded 1999' },
}

interface Call {
  url: string
  init: RequestInit
}

function sse(events: unknown[], headers: Record<string, string> = {}): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`))
      c.enqueue(enc.encode('data: [DONE]\n\n'))
      c.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...headers },
  })
}

const delta = (content: string) => ({ model: '', choices: [{ index: 0, delta: { content } }] })
const finish = {
  choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 3 },
}

function writerRig(
  answer: () => Response,
  ids: { conversationId?: string; runId?: string } = { conversationId: 'c1', runId: 'r1' },
) {
  const calls: Call[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init })
    return answer()
  }) as unknown as typeof globalThis.fetch
  const client = createAiWebClient({
    documentId: 'doc-1',
    apiBase: '/api/v1',
    tokens: { getToken: async () => 'tok-1', refreshToken: async () => 'tok-2' },
    origin: ORIGIN,
    fetch,
  })
  const conversations = new UniworkConversations()
  conversations.update('sess-1', ids)
  const chunks: AiStreamChunk[] = []
  const run = (writer: WriterCall = WRITER, lang = 'vi') =>
    runUniworkWriter(
      {
        write: client.uniworkWrite,
        lang: () => lang,
        describeFailure: (f) => `uniwork:${f.code}`,
        signal: new AbortController().signal,
        conversations,
      },
      {
        requestId: 'w1',
        sessionId: 'sess-1',
        settings: { provider: 'uniwork', providers: {} } as never,
        system: 'the BYOK prompt',
        messages: [{ role: 'user', text: 'the BYOK user text' }],
        purpose: 'one-shot',
        writer,
      },
      (c) => chunks.push(c),
    )
  return { calls, chunks, run }
}

const header = (call: Call, name: string) => new Headers(call.init.headers).get(name)

describe('runUniworkWriter', () => {
  it('posts {kind, lang, input} with the run and conversation headers and streams the deltas in order', async () => {
    const r = writerRig(() =>
      sse([delta('<h1>T</h1>'), delta('<p>a</p>'), delta('<p>b</p>'), finish]),
    )
    await r.run()
    expect(r.calls).toHaveLength(1)
    const call = r.calls[0]!
    expect(call.url).toBe(ROUTE)
    expect(call.init.method).toBe('POST')
    expect(header(call, 'authorization')).toBe('Bearer tok-1')
    expect(header(call, 'x-uniwork-ai-run')).toBe('r1')
    expect(header(call, 'x-uniwork-ai-conversation')).toBe('c1')
    expect(header(call, 'content-type')).toBe('application/json')
    // only the writer's inputs go out: the server holds the prompt, never the client's text
    expect(JSON.parse(String(call.init.body))).toEqual({
      kind: 'docs.write_document',
      lang: 'vi',
      input: { plan: 'intro, body', context: 'founded 1999' },
    })
    expect(r.chunks).toEqual([
      { requestId: 'w1', type: 'delta', text: '<h1>T</h1>' },
      { requestId: 'w1', type: 'delta', text: '<p>a</p>' },
      { requestId: 'w1', type: 'delta', text: '<p>b</p>' },
      { requestId: 'w1', type: 'done' },
    ])
  })

  it('without the run of an open turn it refuses with unsupported and sends nothing', async () => {
    const r = writerRig(() => sse([finish]), { conversationId: 'c1' })
    await r.run()
    expect(r.calls).toHaveLength(0)
    expect(r.chunks).toEqual([
      { requestId: 'w1', type: 'error', error: 'uniwork:unsupported', uniworkCode: 'unsupported' },
    ])
  })

  it('a terminal frame after a delta ends the write as an error after that delta (partial)', async () => {
    const r = writerRig(() =>
      sse([delta('<p>half'), { x_uniwork: { terminal: { code: 'ai_provider_error' } } }]),
    )
    await r.run()
    expect(r.chunks).toEqual([
      { requestId: 'w1', type: 'delta', text: '<p>half' },
      {
        requestId: 'w1',
        type: 'error',
        error: 'uniwork:ai_provider_error',
        uniworkCode: 'ai_provider_error',
      },
    ])
  })

  it.each(['ai_provider_timeout', 'ai_cancelled'])(
    'the terminal code %s is carried as it came',
    async (code) => {
      const r = writerRig(() => sse([delta('x'), { x_uniwork: { terminal: { code } } }]))
      await r.run()
      expect(r.chunks.at(-1)).toMatchObject({ type: 'error', uniworkCode: code })
    },
  )

  it('an HTTP failure carries the server code (409 run_limit_reached)', async () => {
    const r = writerRig(
      () =>
        new Response(JSON.stringify({ code: 'run_limit_reached', fields: { limit: 8 } }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
    )
    await r.run()
    expect(r.calls).toHaveLength(1)
    expect(r.chunks).toEqual([
      {
        requestId: 'w1',
        type: 'error',
        error: 'uniwork:run_limit_reached',
        uniworkCode: 'run_limit_reached',
      },
    ])
  })

  it('sends the UI language as vi or en', async () => {
    expect(writerLang('vi')).toBe('vi')
    expect(writerLang('vi-VN')).toBe('vi')
    expect(writerLang('en')).toBe('en')
    expect(writerLang('zh')).toBe('en')
    const r = writerRig(() => sse([delta('x'), finish]))
    await r.run(WRITER, 'fr')
    expect(JSON.parse(String(r.calls[0]!.init.body)).lang).toBe('en')
  })
})
