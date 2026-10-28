// UNI-2264: a job the host hands to the AI panel (`ai.start`), followed part by part. Driven end to
// end through the web AI bridge (createWebAi + withWebAi, the real UniWork AI adapter) over a fake
// frame route: the panel is played by hand (its run = the tracker's run, its streams = aiStream).
import type { AgentMessage } from '@genoffice/agent-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setUniworkAiAvailable } from '../../../../packages/ai-provider/src/providers'
import { uniworkConversations } from '../../../../packages/ai-provider/src/uniwork/conversation'
import { DocsProtocolError } from '../../../docs/protocol/types'
import { webLanguage } from '../../../docs/bridge/browser'
import { createAiRunTracker } from '../ai-run'
import { aiWebText } from '../i18n/strings-ai-web'
import type { AiPreset } from './handoff'
import { createWebAi, withWebAi } from './web-ai'

const ORIGIN = 'https://app.test'
const ROUTE = `${ORIGIN}/api/v1/office-frame/documents/doc-1/ai/uniwork/chat/completions`
const JOB = 'Draft the approved plan'
const CALL = { id: 'call-1', name: 'edit_doc', args: { at: 0 } }

afterEach(() => {
  setUniworkAiAvailable(false)
  uniworkConversations.clear()
})

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

/** one SSE answer of the frame route; `remaining` = the handoff header (absent when not given) */
function ok(opts: { calls?: Array<typeof CALL>; remaining?: number } = {}): Response {
  const calls = opts.calls ?? []
  const chunk = {
    choices: [
      {
        index: 0,
        delta: {
          content: calls.length ? '' : 'Done.',
          ...(calls.length
            ? {
                tool_calls: calls.map((c, index) => ({
                  index,
                  id: c.id,
                  type: 'function',
                  function: { name: c.name, arguments: JSON.stringify(c.args) },
                })),
              }
            : {}),
        },
        finish_reason: calls.length ? 'tool_calls' : 'stop',
      },
    ],
    x_uniwork: { step: 0, limit: 8 },
  }
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'X-UniWork-AI-Conversation': 'conv-1',
      'X-UniWork-AI-Run': 'run-1',
      ...(opts.remaining !== undefined
        ? { 'X-UniWork-AI-Handoff-Remaining': String(opts.remaining) }
        : {}),
    },
  })
}

type Answer = (init: RequestInit) => Response | Promise<Response>

function rig(opts: { caps?: Record<string, boolean>; credentials?: unknown } = {}) {
  const caps = opts.caps ?? { uniworkAi: true }
  const queue: Answer[] = []
  const posts: Array<{ handoff: string | null; body: { messages: unknown[] } }> = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    if (url === ROUTE) {
      posts.push({
        handoff: new Headers(init.headers).get('X-UniWork-AI-Handoff'),
        body: JSON.parse(String(init.body)) as { messages: unknown[] },
      })
      const next = queue.shift()
      if (!next) throw new Error('no scripted answer')
      return next(init)
    }
    if (url.endsWith('/credentials')) return json(200, opts.credentials)
    return json(200, {
      enabled: true,
      tools: {},
      credits: { unit: 'ai.tokens', used: 0, limit: null, remaining: null, period_end: null },
    })
  }) as unknown as typeof globalThis.fetch
  const aiRun = createAiRunTracker({ graceMs: 0 })
  const ai = createWebAi({
    port: {
      whenInitialized: async () => ({
        documentId: 'doc-1',
        apiBase: 'https://app.test/api/v1',
        capabilities: caps,
      }),
      getToken: async () => 'tok-1',
      refreshToken: async () => 'tok-2',
    },
    capabilities: { ...caps, ai: true },
    aiRun,
    fetch,
    origin: ORIGIN,
  })
  const api = withWebAi({}, ai) as unknown as {
    aiStream(request: unknown): Promise<void>
    aiStreamCancel(id: string): Promise<void>
    consumeAiPreset(): Promise<AiPreset | null>
    onAiPreset(handler: (preset: AiPreset) => void): () => void
  }
  const presets: AiPreset[] = []
  let streams = 0
  const stream = (messages: AgentMessage[]) =>
    api.aiStream({
      requestId: `s${++streams}`,
      sessionId: 'sess-1',
      settings: { provider: 'uniwork', providers: {} },
      system: '',
      messages,
      tools: [{ name: 'edit_doc', description: 'edit', inputSchema: { type: 'object' } }],
    })
  /** the panel's run: its streams, then idle (and the continuation microtask) */
  const run = async (body: () => Promise<void>) => {
    aiRun.begin('panel')
    await body()
    aiRun.end('panel')
    await Promise.resolve()
  }
  const question = (words: string): AgentMessage[] => [{ role: 'user', text: words }]
  /** the question, then the tool results of CALL */
  const withResults = (words: string): AgentMessage[] => [
    ...question(words),
    {
      role: 'assistant',
      text: '',
      toolCalls: [{ id: CALL.id, name: CALL.name, input: CALL.args }],
    },
    { role: 'tool', results: [{ id: CALL.id, name: CALL.name, output: 'edited' }] },
  ]
  return {
    ai,
    api,
    posts,
    presets,
    answer: (...a: Answer[]) => queue.push(...a),
    stream,
    run,
    question,
    withResults,
    listen: () => api.onAiPreset((p) => presets.push(p)),
  }
}

const continueText = () => aiWebText(webLanguage(), 'aiHandoffContinue')

describe('ai.start handoff (UNI-2264)', () => {
  it('ai.start queues a preset and the first UniWork question carries X-UniWork-AI-Handoff', async () => {
    const r = rig()
    r.listen()
    await expect(
      r.ai.startHandoff({ handoffId: 'h1', text: JOB, displayText: 'Soạn theo kế hoạch' }),
    ).resolves.toEqual({ queued: true })
    expect(r.presets).toEqual([{ text: JOB, displayText: 'Soạn theo kế hoạch', autoRun: true }])
    // the question is asked again once after run_expired: the resend carries the same id
    r.answer(
      () => json(409, { code: 'run_expired', message: 'gone' }),
      () => ok({ remaining: 0 }),
    )
    await r.run(() => r.stream(r.question(JOB)))
    expect(r.posts.map((p) => p.handoff)).toEqual(['h1', 'h1'])
  })

  it('the header is not sent on tool-result requests nor on a later question the person types', async () => {
    const r = rig()
    r.listen()
    await r.ai.startHandoff({ handoffId: 'h1', text: JOB })
    r.answer(
      () => ok({ calls: [CALL], remaining: 0 }),
      () => ok(),
      () => ok(),
    )
    await r.run(async () => {
      await r.stream(r.question(JOB))
      await r.stream(r.withResults(JOB))
    })
    await r.run(() => r.stream(r.question('What is left?')))
    expect(r.posts.map((p) => p.handoff)).toEqual(['h1', null, null])
    expect(r.posts[1]!.body.messages).toEqual([
      { role: 'tool', tool_call_id: 'call-1', content: 'edited' },
    ])
  })

  it('a preset that arrives before any listener is returned once by consumeAiPreset', async () => {
    const r = rig()
    await r.ai.startHandoff({ handoffId: 'h1', text: JOB })
    expect(await r.api.consumeAiPreset()).toEqual({ text: JOB, displayText: JOB, autoRun: true })
    expect(await r.api.consumeAiPreset()).toBeNull()
    // a listener that comes later does not get it again
    r.listen()
    await Promise.resolve()
    expect(r.presets).toEqual([])
  })

  it("ai.start is refused unsupported when the panel's provider is not UniWork AI", async () => {
    const r = rig({
      caps: { ai: true },
      credentials: {
        items: [
          {
            provider: 'openai',
            label: '',
            base_url: '',
            key_hint: '…abcd',
            created_at: '2026-10-09T00:00:00Z',
            updated_at: '2026-10-09T00:00:00Z',
            model: 'gpt-x',
            model_updated_at: '2026-10-09T00:00:00Z',
          },
        ],
        providers: [
          {
            id: 'openai',
            protocol: 'openai-compatible',
            requires_base_url: false,
            default_base_url: '',
          },
        ],
      },
    })
    r.listen()
    const refused = await r.ai.startHandoff({ handoffId: 'h1', text: JOB }).catch((e) => e)
    expect(refused).toBeInstanceOf(DocsProtocolError)
    expect((refused as DocsProtocolError).code).toBe('unsupported')
    expect(r.presets).toEqual([])
    expect(await r.api.consumeAiPreset()).toBeNull()
  })

  it('after an idle run with remaining 1 a continuation preset goes out and its question carries the header', async () => {
    const r = rig()
    r.listen()
    await r.ai.startHandoff({ handoffId: 'h1', text: JOB })
    r.answer(
      () => ok({ calls: [CALL], remaining: 1 }),
      () => ok(),
    )
    await r.run(async () => {
      await r.stream(r.question(JOB))
      await r.stream(r.withResults(JOB))
    })
    const next = continueText()
    expect(next.trim()).not.toBe('')
    expect(r.presets.at(-1)).toEqual({ text: next, displayText: next, autoRun: true })
    r.answer(() => ok({ remaining: 0 }))
    await r.run(() => r.stream(r.question(next)))
    expect(r.posts.map((p) => p.handoff)).toEqual(['h1', null, 'h1'])
    // the last part is done: nothing else goes out
    expect(r.presets).toHaveLength(2)
  })

  it.each([
    ['a cancelled run', 'cancelled'],
    ['a failed run', 'failed'],
    ['a run stopped while its tools ran', 'stopped'],
    ['remaining 0', 'zero'],
    ['no remaining header', 'none'],
  ] as const)('no continuation after %s, and the job is dropped', async (_name, outcome) => {
    const r = rig()
    r.listen()
    await r.ai.startHandoff({ handoffId: 'h1', text: JOB })
    if (outcome === 'zero') r.answer(() => ok({ remaining: 0 }))
    else if (outcome === 'none') r.answer(() => ok())
    else r.answer(() => ok({ calls: [CALL], remaining: 1 }))
    if (outcome === 'failed') {
      r.answer(() => json(502, { code: 'ai_provider_error', message: 'upstream' }))
    }
    if (outcome === 'cancelled') {
      // the tool-result request hangs until the panel's Stop aborts it
      r.answer(
        (init) =>
          new Promise<Response>((_, reject) =>
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            ),
          ),
      )
    }
    await r.run(async () => {
      await r.stream(r.question(JOB))
      if (outcome === 'failed') await r.stream(r.withResults(JOB))
      if (outcome === 'cancelled') {
        const pending = r.stream(r.withResults(JOB))
        await vi.waitFor(() => expect(r.posts).toHaveLength(2))
        await r.api.aiStreamCancel('s2')
        await pending
      }
      // 'stopped': the panel never sends the tool results
    })
    expect(r.presets).toHaveLength(1)
    // dropped: the same words asked again carry no id
    r.answer(() => ok())
    await r.run(() => r.stream(r.question(JOB)))
    expect(r.posts.at(-1)!.handoff).toBeNull()
    expect(r.presets).toHaveLength(1)
  })

  it('a run the person starts drops the handoff', async () => {
    const r = rig()
    r.listen()
    // the preset could not run (it waits in the composer); the person asks something else
    await r.ai.startHandoff({ handoffId: 'h1', text: JOB })
    r.answer(
      () => ok({ remaining: 1 }),
      () => ok({ remaining: 1 }),
    )
    await r.run(() => r.stream(r.question('Summarise this page')))
    await r.run(() => r.stream(r.question(JOB)))
    expect(r.posts.map((p) => p.handoff)).toEqual([null, null])
    expect(r.presets).toHaveLength(1)
  })

  it('a module frame answers the host ai.start and its global hands the preset over', async () => {
    const { installModuleBridge } = await import('../../../docs/bridge/module-bridge')
    const { createMockPort } = await import('../../../docs/bridge/testing/mock-port')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, { enabled: true, tools: {}, credits: {} })),
    )
    try {
      const mock = createMockPort({ documentId: 'doc-1' })
      const target: Record<string, unknown> = {}
      installModuleBridge({
        module: 'markdown',
        frameCapabilities: { save: true },
        client: { ...mock.port, getToken: async () => 't1', refreshToken: async () => 't2' },
        target,
        globals: { markdownApi: () => ({ aiStream: async () => {} }) },
      })
      mock.init({ apiBase: '/api/v1', capabilities: { uniworkAi: true, aiStart: true } })
      await expect(mock.host['ai.start']({ handoffId: 'h1', text: JOB })).resolves.toEqual({
        queued: true,
      })
      const api = target.markdownApi as { consumeAiPreset(): Promise<AiPreset | null> }
      expect(await api.consumeAiPreset()).toEqual({ text: JOB, displayText: JOB, autoRun: true })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
