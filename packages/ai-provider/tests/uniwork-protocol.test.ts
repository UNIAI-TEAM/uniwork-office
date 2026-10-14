import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentMessage, AgentToolDef } from '@genoffice/agent-core'
import { streamForProvider } from '../src/stream'
import { UniworkConversations } from '../src/uniwork/conversation'
import { UniworkError, uniworkErrorKey } from '../src/uniwork/errors'
import { streamUniwork, type UniworkTurnRequest } from '../src/uniwork/protocol'
import { setUniworkChatTransport } from '../src/uniwork/transport'
import type { UniworkScope } from '../src/uniwork/types'
import { okResponse, sseStream } from './test-utils'
import { createUniworkFake, error, json, oneChunk, realStream, recorder, terminal } from './fixtures/uniwork-fake'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setUniworkChatTransport(null)
})

const scope: UniworkScope = { kind: 'org', orgId: 'org-1', format: 'docx' }

const tool = (name: string): AgentToolDef => ({
  name,
  description: `${name} tool`,
  inputSchema: { type: 'object', properties: {} },
})

const moduleTools = [tool('read_document'), tool('format_text'), tool('web_search'), tool('generate_image')]

function turn(messages: AgentMessage[], over: Partial<UniworkTurnRequest> = {}): UniworkTurnRequest {
  return { scope, messages, tools: moduleTools, toolPolicy: { cloudTools: false }, ...over }
}

const q = (text: string): AgentMessage[] => [{ role: 'user', text }]

const calls = [
  { id: 'srv-call-1', name: 'format_text', args: { bold: true } },
  { id: 'srv-call-2', name: 'read_document', args: { from: 0 } },
]

describe('streamUniwork: wire', () => {
  it('streams a one-chunk SSE answer with tool calls', async () => {
    const fake = createUniworkFake()
    fake.enqueue(oneChunk('Done.', { toolCalls: calls, ext: { step: 1, limit: 8 } }))
    const rec = recorder()
    await streamUniwork(fake, turn(q('bold it')), rec.cb, { conversations: new UniworkConversations() })
    expect(rec.state.text).toBe('Done.')
    expect(rec.state.toolCalls).toEqual([
      expect.objectContaining({ id: 'srv-call-1', name: 'format_text', input: { bold: true } }),
      expect.objectContaining({ id: 'srv-call-2', name: 'read_document', input: { from: 0 } }),
    ])
    expect(rec.state.notices).toContainEqual({ kind: 'step', step: 1, limit: 8 })
    const body = fake.requests[0]!.body
    expect(body.stream).toBe(true)
    expect(body.module).toBe('docx')
    expect(body).not.toHaveProperty('model')
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('max_tokens')
    expect(fake.requests[0]!.scope).toEqual(scope)
  })

  it('streams a real multi-delta answer identically', async () => {
    const one = createUniworkFake()
    one.enqueue(oneChunk('Hello world.', { toolCalls: calls }))
    const many = createUniworkFake()
    many.enqueue(realStream(['Hel', 'lo ', 'world.'], { toolCalls: calls }))
    const a = recorder()
    const b = recorder()
    await streamUniwork(one, turn(q('x')), a.cb, { conversations: new UniworkConversations() })
    await streamUniwork(many, turn(q('x')), b.cb, { conversations: new UniworkConversations() })
    expect(b.state.text).toBe(a.state.text)
    expect(b.state.toolCalls).toEqual(a.state.toolCalls)
    expect(b.state.notices).toEqual(a.state.notices)
  })

  it('reads a JSON answer', async () => {
    const fake = createUniworkFake()
    fake.enqueue(json('Plain JSON answer.', { toolCalls: [calls[0]!], ext: { step: 2, limit: 8 } }))
    const rec = recorder()
    await streamUniwork(fake, turn(q('x')), rec.cb, { conversations: new UniworkConversations() })
    expect(rec.state.text).toBe('Plain JSON answer.')
    expect(rec.state.toolCalls).toEqual([expect.objectContaining({ id: 'srv-call-1', name: 'format_text' })])
    expect(rec.state.notices).toContainEqual({ kind: 'step', step: 2, limit: 8 })
  })

  it('a JSON answer that mentions credits is not a credits error', async () => {
    const fake = createUniworkFake()
    fake.enqueue(json('Your Genspark credits have been exhausted is a phrase in the document.'))
    const rec = recorder()
    await streamUniwork(fake, turn(q('x')), rec.cb, { conversations: new UniworkConversations() })
    expect(rec.state.text).toMatch(/credits/)
  })

  it('second request carries only the tool results and both ids, never an assistant turn', async () => {
    const conversations = new UniworkConversations()
    const fake = createUniworkFake()
    fake.enqueue(oneChunk('Working on it.', { toolCalls: calls, ids: { conversation: 'conv-7', run: 'run-7' } }))
    fake.enqueue(oneChunk('All done.', { ids: { conversation: 'conv-7', run: 'run-7' }, ext: { step: 1, limit: 8 } }))
    const history: AgentMessage[] = [{ role: 'user', text: 'bold the title and read it back' }]
    await streamUniwork(fake, turn(history), recorder().cb, { conversations })
    history.push(
      {
        role: 'assistant',
        text: 'Working on it.',
        toolCalls: calls.map((c) => ({ id: c.id, name: c.name, input: c.args })),
      },
      {
        role: 'tool',
        results: [
          { id: 'srv-call-1', name: 'format_text', output: 'bolded' },
          { id: 'srv-call-2', name: 'read_document', output: 'Title' },
        ],
      },
    )
    await streamUniwork(fake, turn(history), recorder().cb, { conversations })
    const second = fake.requests[1]!
    expect(second.headers['X-UniWork-AI-Conversation']).toBe('conv-7')
    expect(second.headers['X-UniWork-AI-Run']).toBe('run-7')
    expect(second.body.messages).toEqual([
      { role: 'tool', tool_call_id: 'srv-call-1', content: 'bolded' },
      { role: 'tool', tool_call_id: 'srv-call-2', content: 'Title' },
    ])
    expect(second.body.messages.some((m) => m.role === 'assistant' || m.role === 'system')).toBe(false)
    expect(second.body.module).toBe('docx')
  })

  it('sends only the module tools, cloud tools only with office.ai_cloud', async () => {
    const fake = createUniworkFake()
    fake.enqueue(oneChunk('a'), oneChunk('b'))
    const withMcp = [...moduleTools, tool('mcp__files__read'), tool('transcribe'), tool('analyze_media')]
    await streamUniwork(fake, turn(q('x'), { tools: withMcp }), recorder().cb, { conversations: new UniworkConversations() })
    await streamUniwork(fake, turn(q('x'), { tools: withMcp, toolPolicy: { cloudTools: true } }), recorder().cb, {
      conversations: new UniworkConversations(),
    })
    const names = (i: number) => (fake.requests[i]!.body.tools ?? []).map((t) => t.function.name)
    expect(names(0)).toEqual(['read_document', 'format_text'])
    expect(names(1)).toEqual(['read_document', 'format_text', 'web_search', 'generate_image', 'transcribe', 'analyze_media'])
    for (const i of [0, 1]) {
      expect(names(i).every((n) => withMcp.some((t) => t.name === n))).toBe(true)
      expect(names(i).some((n) => n.startsWith('mcp'))).toBe(false)
      expect(names(i)).not.toContain('chat')
    }
    expect(fake.requests[0]!.body.tools![0]).toEqual({
      type: 'function',
      function: { name: 'read_document', description: 'read_document tool', parameters: { type: 'object', properties: {} } },
    })
  })

  it('dropped_tool_calls reach onNotice with view_only / not_allowlisted', async () => {
    const fake = createUniworkFake()
    const dropped = [
      { index: 1, name: 'format_text', reason: 'view_only' as const },
      { index: 2, name: 'delete_sheet', reason: 'not_allowlisted' as const },
    ]
    fake.enqueue(oneChunk('I could only read it.', { ext: { dropped_tool_calls: dropped, step: 1, limit: 8 } }))
    const rec = recorder()
    await streamUniwork(fake, turn(q('x')), rec.cb, { conversations: new UniworkConversations() })
    expect(rec.state.notices).toContainEqual({ kind: 'dropped-tool-calls', calls: dropped })
  })

  it('a tool-result turn without a known run id is not sent', async () => {
    const fake = createUniworkFake()
    const history: AgentMessage[] = [
      { role: 'user', text: 'x' },
      { role: 'assistant', text: '', toolCalls: [{ id: 'c', name: 'format_text', input: {} }] },
      { role: 'tool', results: [{ id: 'c', name: 'format_text', output: 'ok' }] },
    ]
    const err = await streamUniwork(fake, turn(history), recorder().cb, { conversations: new UniworkConversations() }).catch((e) => e)
    expect(err).toBeInstanceOf(UniworkError)
    expect(fake.requests).toHaveLength(0)
  })
})

describe('streamUniwork: Retry-After (429 rule)', () => {
  it('429 keeps the run id on the retry', async () => {
    vi.useFakeTimers()
    const conversations = new UniworkConversations()
    const fake = createUniworkFake()
    fake.enqueue(oneChunk('', { toolCalls: [calls[0]!], ids: { conversation: 'conv-1', run: 'run-1' } }))
    fake.enqueue(error(429, 'ai_rate_limited', { retryAfter: '2', ids: false }))
    fake.enqueue(oneChunk('ok', { ids: { conversation: 'conv-1', run: 'run-1' } }))
    await streamUniwork(fake, turn(q('x')), recorder().cb, { conversations })
    const history: AgentMessage[] = [
      { role: 'user', text: 'x' },
      { role: 'assistant', text: '', toolCalls: [{ id: 'srv-call-1', name: 'format_text', input: {} }] },
      { role: 'tool', results: [{ id: 'srv-call-1', name: 'format_text', output: 'ok' }] },
    ]
    const rec = recorder()
    const run = streamUniwork(fake, turn(history), rec.cb, { conversations })
    await vi.advanceTimersByTimeAsync(2_000)
    await run
    expect(fake.requests).toHaveLength(3)
    expect(fake.requests[1]!.headers['X-UniWork-AI-Run']).toBe('run-1')
    expect(fake.requests[2]!.headers['X-UniWork-AI-Run']).toBe('run-1')
    expect(fake.requests[2]!.headers['X-UniWork-AI-Conversation']).toBe('conv-1')
    expect(rec.state.text).toBe('ok')
  })

  it('a wait emits rate-limit-wait notices, never an error', async () => {
    vi.useFakeTimers()
    const fake = createUniworkFake()
    fake.enqueue(error(429, 'ai_uniwork_busy', { retryAfter: '120' }))
    fake.enqueue(oneChunk('after the wait'))
    const rec = recorder()
    let settled = false
    const run = streamUniwork(fake, turn(q('x')), rec.cb, { conversations: new UniworkConversations() }).finally(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(119_000)
    expect(settled).toBe(false)
    expect(fake.requests).toHaveLength(1)
    expect(rec.state.notices).toEqual([{ kind: 'rate-limit-wait', seconds: 120, attempt: 1 }])
    // the host watchdog (240 s) is pinged through the wait
    expect(rec.state.activity).toBeGreaterThanOrEqual(20)
    await vi.advanceTimersByTimeAsync(1_000)
    await run
    expect(fake.requests).toHaveLength(2)
    expect(rec.state.text).toBe('after the wait')
  })

  it('Retry-After 0 resends at once', async () => {
    vi.useFakeTimers()
    const fake = createUniworkFake()
    fake.enqueue(error(429, 'rate_limited', { retryAfter: '0' }), oneChunk('now'))
    const rec = recorder()
    const run = streamUniwork(fake, turn(q('x')), rec.cb, { conversations: new UniworkConversations() })
    await vi.advanceTimersByTimeAsync(0)
    await run
    expect(rec.state.text).toBe('now')
    expect(rec.state.notices).toContainEqual({ kind: 'rate-limit-wait', seconds: 0, attempt: 1 })
  })

  it('Retry-After 301 or missing gives up at once with the no-wait message', async () => {
    for (const retryAfter of ['301', undefined]) {
      const fake = createUniworkFake()
      fake.enqueue(error(429, 'ai_rate_limited', retryAfter === undefined ? {} : { retryAfter }))
      const rec = recorder()
      const err = await streamUniwork(fake, turn(q('x')), rec.cb, { conversations: new UniworkConversations() }).catch((e) => e)
      expect(err).toBeInstanceOf(UniworkError)
      expect((err as UniworkError).code).toBe('ai_rate_limited')
      expect(uniworkErrorKey((err as UniworkError).code)).toBe('aiErrRateLimitedNoWait')
      expect(fake.requests).toHaveLength(1)
      expect(rec.state.notices).toEqual([])
    }
  })

  it('after three waits the fourth 429 gives up', async () => {
    vi.useFakeTimers()
    const fake = createUniworkFake()
    for (let i = 0; i < 4; i++) fake.enqueue(error(429, 'ai_rate_limited', { retryAfter: '1' }))
    const rec = recorder()
    const run = streamUniwork(fake, turn(q('x')), rec.cb, { conversations: new UniworkConversations() }).catch((e) => e)
    await vi.advanceTimersByTimeAsync(5_000)
    const err = await run
    expect((err as UniworkError).code).toBe('ai_rate_limited')
    expect(fake.requests).toHaveLength(4)
    expect(rec.state.notices.filter((n) => (n as { kind: string }).kind === 'rate-limit-wait')).toHaveLength(3)
  })

  it('Stop during a wait ends the turn at once without a resend', async () => {
    vi.useFakeTimers()
    const fake = createUniworkFake()
    fake.enqueue(error(429, 'ai_rate_limited', { retryAfter: '120' }), oneChunk('never'))
    const ctl = new AbortController()
    const rec = recorder(ctl.signal)
    const run = streamUniwork(fake, turn(q('x')), rec.cb, { conversations: new UniworkConversations() }).catch((e) => e)
    await vi.advanceTimersByTimeAsync(10_000)
    ctl.abort()
    await vi.advanceTimersByTimeAsync(0)
    const err = await run
    expect(err).toBeDefined()
    expect(err).not.toBeInstanceOf(UniworkError)
    expect(fake.requests).toHaveLength(1)
  })

  it('terminal ai_rate_limited after a content chunk resets the turn and resends with the same run id, no partial text kept', async () => {
    vi.useFakeTimers()
    const conversations = new UniworkConversations()
    const fake = createUniworkFake()
    fake.enqueue(terminal('ai_rate_limited', { retryAfter: 3, before: ['partial an'], ids: { conversation: 'conv-1', run: 'run-1' } }))
    fake.enqueue(oneChunk('The full answer.', { ids: { conversation: 'conv-1', run: 'run-1' } }))
    const rec = recorder()
    const run = streamUniwork(fake, turn(q('x')), rec.cb, { conversations })
    await vi.advanceTimersByTimeAsync(3_000)
    await run
    expect(rec.state.resets).toBe(1)
    expect(rec.state.text).toBe('The full answer.')
    expect(fake.requests).toHaveLength(2)
    expect(fake.requests[1]!.headers['X-UniWork-AI-Run']).toBe('run-1')
    expect(fake.requests[1]!.body.messages).toEqual(fake.requests[0]!.body.messages)
  })

  it('terminal ai_provider_error right after the header is an error, no empty-stream resend', async () => {
    const fake = createUniworkFake()
    fake.enqueue(terminal('ai_provider_error'))
    const rec = recorder()
    const err = await streamUniwork(fake, turn(q('x')), rec.cb, { conversations: new UniworkConversations() }).catch((e) => e)
    expect(err).toBeInstanceOf(UniworkError)
    expect((err as UniworkError).code).toBe('ai_provider_error')
    expect((err as Error).message).not.toContain('(empty stream)')
    expect(fake.requests).toHaveLength(1)
  })
})

describe('streamUniwork: run limits and errors', () => {
  it('run_limit_reached ends the run with aiErrRunLimit, next question opens a new run in the same conversation', async () => {
    const conversations = new UniworkConversations()
    const fake = createUniworkFake()
    fake.enqueue(oneChunk('', { toolCalls: [calls[0]!], ids: { conversation: 'conv-1', run: 'run-1' } }))
    fake.enqueue(error(409, 'run_limit_reached', { fields: { limit: 'tool_rounds' }, ids: { conversation: 'conv-1', run: 'run-1' } }))
    fake.enqueue(oneChunk('fresh', { ids: { conversation: 'conv-1', run: 'run-2' } }))
    await streamUniwork(fake, turn(q('x')), recorder().cb, { conversations })
    const history: AgentMessage[] = [
      { role: 'user', text: 'x' },
      { role: 'assistant', text: '', toolCalls: [{ id: 'srv-call-1', name: 'format_text', input: {} }] },
      { role: 'tool', results: [{ id: 'srv-call-1', name: 'format_text', output: 'ok' }] },
    ]
    const err = await streamUniwork(fake, turn(history), recorder().cb, { conversations }).catch((e) => e)
    expect(err).toBeInstanceOf(UniworkError)
    expect((err as UniworkError).code).toBe('run_limit_reached')
    expect((err as UniworkError).fields).toEqual({ limit: 'tool_rounds' })
    expect((err as UniworkError).retryAfterSec).toBeUndefined()
    expect(uniworkErrorKey('run_limit_reached')).toBe('aiErrRunLimit')
    expect(fake.requests).toHaveLength(2)

    await streamUniwork(fake, turn([...history, { role: 'assistant', text: '' }, { role: 'user', text: 'continue' }]), recorder().cb, {
      conversations,
    })
    expect(fake.requests[2]!.headers['X-UniWork-AI-Conversation']).toBe('conv-1')
    expect(fake.requests[2]!.headers['X-UniWork-AI-Run']).toBeUndefined()
  })

  it('office_capability_off before any run id reports uniwork-off', async () => {
    const fake = createUniworkFake()
    fake.enqueue(error(403, 'office_capability_off', { fields: { capability: 'ai_uniwork_docx' }, ids: false }))
    const rec = recorder()
    const err = await streamUniwork(fake, turn(q('x')), rec.cb, { conversations: new UniworkConversations() }).catch((e) => e)
    expect((err as UniworkError).code).toBe('office_capability_off')
    expect(rec.state.notices).toContainEqual({ kind: 'uniwork-off' })
  })

  it('a transport that never answers mid-turn is a disconnect, not overloaded', async () => {
    const rec = recorder()
    const transport = { post: () => Promise.reject(new TypeError('fetch failed')) }
    const err = await streamUniwork(transport, turn(q('x')), rec.cb, { conversations: new UniworkConversations() }).catch((e) => e)
    expect((err as UniworkError).code).toBe('disconnected')
  })

  it('a 503 leaves no state that breaks the next BYOK turn', async () => {
    const fake = createUniworkFake()
    fake.enqueue(error(503, 'ai_disabled', { ids: false }))
    setUniworkChatTransport(fake)
    const first = recorder()
    const err = await streamForProvider('uniwork', { apiKey: '', model: '' }, 'system', q('x'), moduleTools, 4096, first.cb, {
      scope,
      toolPolicy: { cloudTools: false },
    }).catch((e) => e)
    expect((err as UniworkError).code).toBe('ai_disabled')
    expect(uniworkErrorKey('ai_disabled')).toBe('aiErrUnavailable')

    const fetchMock = vi.fn(async () =>
      okResponse(
        sseStream([
          'data: {"choices":[{"delta":{"content":"BYOK answer"}}]}',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
          'data: [DONE]',
        ]),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const second = recorder()
    await streamForProvider('openai', { apiKey: 'sk-test', model: 'gpt-test' }, 'system', q('y'), moduleTools, 4096, second.cb)
    expect(second.state.text).toBe('BYOK answer')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('streamForProvider routes uniwork to the adapter, never a BYOK endpoint', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const fake = createUniworkFake()
    fake.enqueue(oneChunk('via adapter'))
    setUniworkChatTransport(fake)
    const rec = recorder()
    await streamForProvider('uniwork', { apiKey: '', model: '' }, 'system prompt', q('x'), moduleTools, 4096, rec.cb, {
      scope,
      toolPolicy: { cloudTools: false },
    })
    expect(rec.state.text).toBe('via adapter')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(JSON.stringify(fake.requests[0]!.body)).not.toContain('system prompt')
  })

  it('streamForProvider without a session transport or a scope fails with a UniWork code', async () => {
    const rec = recorder()
    const noTransport = await streamForProvider('uniwork', { apiKey: '', model: '' }, 's', q('x'), [], 4096, rec.cb, {
      scope,
      toolPolicy: { cloudTools: false },
    }).catch((e) => e)
    expect((noTransport as UniworkError).code).toBe('session_expired')
    setUniworkChatTransport(createUniworkFake())
    const noScope = await streamForProvider('uniwork', { apiKey: '', model: '' }, 's', q('x'), [], 4096, rec.cb).catch((e) => e)
    expect(noScope).toBeInstanceOf(UniworkError)
  })
})
