import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WriterCall } from '@genoffice/agent-core'
import type { AiStreamChunk, AiStreamRequest, UniworkScope } from '@genoffice/ai-provider'
import { defaultAiSettings, uniworkConversations } from '@genoffice/ai-provider'
import { setUiLang } from '@genoffice/i18n'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import type { FetchLike } from '../src/main/uniwork-auth/transport'
import {
  createUniworkAiChatTransport,
  createUniworkAiStreams,
  type UniworkAiStreamDeps,
} from '../src/main/uniwork-auth/ai-chat'

/**
 * UNI-2326 (ADR 0052): a one-shot writer on the desktop runs on the writer route of the tab's
 * scope, inside the turn's run: R3 `/documents/{id}/ai/uniwork/write` for a bound document, R1
 * `/orgs/{id}/ai/uniwork/write` for a local file. Same body and SSE as the web frame route; the
 * device bearer is added in main only. The real transport runs over a recorded fetch.
 */

const ORIGIN = 'https://uniwork.example'
const profile: DeploymentProfile = {
  deploymentId: 'default',
  apiOrigin: ORIGIN,
  clientId: 'uniwork-office',
  channel: 'stable',
}
const TOKEN = 'at_secret_one'
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const ORG = '01J8X4ORG0N1P2Q3R4S5T6U7'
const docScope: UniworkScope = { kind: 'document', documentId: DOC, format: 'html' }
const orgScope: UniworkScope = { kind: 'org', orgId: ORG, format: 'html' }
const WRITER: WriterCall = { kind: 'html.page', input: { plan: 'hero, pricing' } }

const delta = (content: string) => ({ choices: [{ index: 0, delta: { content } }] })
const finish = {
  choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 3 },
}

function sse(events: unknown[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function rig(
  answer: (signal: AbortSignal) => Response | Promise<Response>,
  over: Partial<UniworkAiStreamDeps> = {},
) {
  const calls: Array<{ url: string; init: RequestInit; headers: Record<string, string> }> = []
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    )
    calls.push({ url, init, headers })
    return answer(init.signal!)
  }) satisfies FetchLike
  const transport = createUniworkAiChatTransport({
    profile: () => profile,
    authorized: async (call) => call(TOKEN),
    fetch,
  })
  const streams = createUniworkAiStreams({
    transport: () => transport,
    scope: () => ({ ok: true, scope: docScope, orgId: ORG }),
    available: async () => true,
    toolPolicy: () => ({ cloudTools: false }),
    ...over,
  })
  const chunks: AiStreamChunk[] = []
  const write = (request: Partial<AiStreamRequest> = {}) =>
    streams.run({
      senderId: 7,
      request: {
        requestId: 'w1',
        sessionId: 'sess-1',
        settings: { ...defaultAiSettings(), provider: 'uniwork' },
        system: 'the client prompt',
        messages: [{ role: 'user', text: 'the client text' }],
        tools: [],
        purpose: 'one-shot',
        writer: WRITER,
        ...request,
      },
      send: (c) => chunks.push(c),
      signal: new AbortController().signal,
    })
  return { calls, chunks, write, streams }
}

afterEach(() => {
  uniworkConversations.clear()
  setUiLang('en')
})

describe('ai:stream uniwork runner: one-shot writers on the writer route', () => {
  it('R3: a bound document writes on its document route with the run, conversation and bearer', async () => {
    uniworkConversations.update('sess-1', { conversationId: 'c1', runId: 'r1' })
    setUiLang('vi')
    const r = rig(() => sse([delta('<h1>T</h1>'), delta('<p>a</p>'), finish]))
    await r.write()
    expect(r.calls).toHaveLength(1)
    const call = r.calls[0]!
    expect(call.url).toBe(`${ORIGIN}/api/v1/documents/${DOC}/ai/uniwork/write`)
    expect(call.init.method).toBe('POST')
    expect(call.init.redirect).toBe('error')
    expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(call.headers['x-uniwork-ai-run']).toBe('r1')
    expect(call.headers['x-uniwork-ai-conversation']).toBe('c1')
    // only the writer's inputs go out: the server holds the prompt, never the client's text
    expect(JSON.parse(String(call.init.body))).toEqual({
      kind: 'html.page',
      lang: 'vi',
      input: { plan: 'hero, pricing' },
    })
    expect(r.chunks.filter((c) => c.type !== 'ping')).toEqual([
      { requestId: 'w1', type: 'delta', text: '<h1>T</h1>' },
      { requestId: 'w1', type: 'delta', text: '<p>a</p>' },
      { requestId: 'w1', type: 'done' },
    ])
  })

  it('R1: a local file writes on the organization route; any other UI language asks for en', async () => {
    uniworkConversations.update('sess-1', { conversationId: 'c1', runId: 'r1' })
    setUiLang('fr')
    const r = rig(() => sse([delta('x'), finish]), {
      scope: () => ({ ok: true, scope: orgScope, orgId: ORG }),
    })
    await r.write()
    expect(r.calls[0]!.url).toBe(`${ORIGIN}/api/v1/orgs/${ORG}/ai/uniwork/write`)
    expect(JSON.parse(String(r.calls[0]!.init.body)).lang).toBe('en')
    expect(r.chunks.at(-1)).toMatchObject({ type: 'done' })
  })

  it('without the run of an open turn it refuses with unsupported and sends nothing', async () => {
    uniworkConversations.update('sess-1', { conversationId: 'c1' })
    const r = rig(() => sse([finish]))
    await r.write()
    expect(r.calls).toHaveLength(0)
    expect(r.chunks).toEqual([
      expect.objectContaining({ requestId: 'w1', type: 'error', uniworkCode: 'unsupported' }),
    ])
  })

  it('a summary, or a one-shot without a writer, still never goes out', async () => {
    uniworkConversations.update('sess-1', { conversationId: 'c1', runId: 'r1' })
    for (const request of [
      { purpose: 'summary' as const },
      { purpose: 'one-shot' as const, writer: undefined },
    ]) {
      const r = rig(() => sse([finish]))
      await r.write(request)
      expect(r.calls).toHaveLength(0)
      expect(r.chunks).toEqual([expect.objectContaining({ uniworkCode: 'unsupported' })])
    }
  })

  it('a terminal frame after a delta ends the write as an error after that delta', async () => {
    uniworkConversations.update('sess-1', { conversationId: 'c1', runId: 'r1' })
    const r = rig(() =>
      sse([delta('<p>half'), { x_uniwork: { terminal: { code: 'ai_cancelled' } } }]),
    )
    await r.write()
    expect(r.chunks.filter((c) => c.type !== 'ping')).toEqual([
      { requestId: 'w1', type: 'delta', text: '<p>half' },
      expect.objectContaining({ requestId: 'w1', type: 'error', uniworkCode: 'ai_cancelled' }),
    ])
    expect(r.chunks.at(-1)).not.toHaveProperty('errorCode')
  })

  it('an HTTP failure carries the server code (409 conversation_expired)', async () => {
    uniworkConversations.update('sess-1', { conversationId: 'c1', runId: 'r1' })
    const r = rig(
      () =>
        new Response(JSON.stringify({ code: 'conversation_expired' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    await r.write()
    expect(r.chunks).toEqual([
      expect.objectContaining({ type: 'error', uniworkCode: 'conversation_expired' }),
    ])
  })

  it('a lost session (401 after the refresh) forgets every conversation', async () => {
    uniworkConversations.update('sess-1', { conversationId: 'c1', runId: 'r1' })
    const r = rig(() => new Response(null, { status: 401 }))
    await r.write()
    expect(r.chunks.at(-1)).toMatchObject({ type: 'error', uniworkCode: 'session_expired' })
    expect(uniworkConversations.ids('sess-1')).toEqual({})
  })

  it('a connection that breaks mid-request is a disconnect, never an overload', async () => {
    uniworkConversations.update('sess-1', { conversationId: 'c1', runId: 'r1' })
    const r = rig(() => {
      throw new TypeError('fetch failed')
    })
    await r.write()
    expect(r.chunks).toEqual([
      expect.objectContaining({ type: 'error', uniworkCode: 'disconnected' }),
    ])
  })

  it('UniWork AI off for the format: the note, no request', async () => {
    uniworkConversations.update('sess-1', { conversationId: 'c1', runId: 'r1' })
    const r = rig(() => sse([finish]), { available: async () => false })
    await r.write()
    expect(r.calls).toHaveLength(0)
    expect(r.chunks.map((c) => c.type)).toEqual(['notice', 'done'])
  })

  it('sign-out ends a running write with a session error', async () => {
    uniworkConversations.update('sess-1', { conversationId: 'c1', runId: 'r1' })
    const r = rig(
      (signal) =>
        new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            {
              once: true,
            },
          )
        }),
    )
    const done = r.write()
    await vi.waitFor(() => expect(r.calls).toHaveLength(1))
    expect(r.streams.active()).toBe(1)
    expect(r.streams.cancelAll()).toBe(1)
    await done
    expect(r.chunks.at(-1)).toMatchObject({ type: 'error', uniworkCode: 'session_expired' })
    expect(r.streams.active()).toBe(0)
  })
})
