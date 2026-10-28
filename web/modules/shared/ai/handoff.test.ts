// UNI-2264: a job the host hands to the AI panel (`ai.start`), followed part by part. Driven end to
// end through the web AI bridge (createWebAi + withWebAi, the real UniWork AI adapter) over a fake
// frame route, with a real run tracker on its production grace and fake timers: as in production
// only the streams begin and end runs, the panel's next stream starts right after the previous one,
// and a slow tool step is a pause longer than the grace (no real-time race under load).
import {
  SELECTION_CLAIM_CORRECTION,
  TOOL_ABORTED_OUTPUT,
  TURN_LIMIT_NOTE,
  type AgentMessage,
} from '@genoffice/agent-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setUniworkAiAvailable } from '../../../../packages/ai-provider/src/providers'
import { uniworkConversations } from '../../../../packages/ai-provider/src/uniwork/conversation'
import { DocsProtocolError } from '../../../docs/protocol/types'
import { webLanguage } from '../../../docs/bridge/browser'
import { AI_RUN_IDLE_GRACE_MS, createAiRunTracker } from '../ai-run'
import { aiWebText } from '../i18n/strings-ai-web'
import { createAiHandoff, type AiPreset } from './handoff'
import { createWebAi, withWebAi } from './web-ai'

const ORIGIN = 'https://app.test'
const ROUTE = `${ORIGIN}/api/v1/office-frame/documents/doc-1/ai/uniwork/chat/completions`
const JOB = 'Draft the approved plan'
const CALL = { id: 'call-1', name: 'edit_doc', args: { at: 0 } }
const GRACE_MS = AI_RUN_IDLE_GRACE_MS

afterEach(() => {
  vi.useRealTimers()
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

/** a request that hangs until the panel's Stop aborts it */
const hangs = (init: RequestInit) =>
  new Promise<Response>((_, reject) =>
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
  )

type Answer = (init: RequestInit) => Response | Promise<Response>

function rig(opts: { caps?: Record<string, boolean>; credentials?: unknown } = {}) {
  const caps = opts.caps ?? { uniworkAi: true }
  // the tracker's grace (and nothing the streams wait on) runs on the test's clock
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
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
  // the idles the tracker reported (a repeated `running` carries the server run id)
  let idles = 0
  const aiRun = createAiRunTracker({
    graceMs: GRACE_MS,
    report: (p) => void (p.state === 'idle' && idles++),
  })
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
  // another provider goes to the streams directly: withWebAi would pick this frame's choice (UniWork AI)
  const stream = (messages: AgentMessage[], provider = 'uniwork') =>
    (provider === 'uniwork' ? api.aiStream : ai.streams.aiStream)({
      requestId: `s${++streams}`,
      sessionId: 'sess-1',
      settings: { provider, providers: {} },
      system: '',
      messages,
      tools: [{ name: 'edit_doc', description: 'edit', inputSchema: { type: 'object' } }],
    } as never)
  /** the tracker's grace runs out: the run is idle (and the continuation microtask ran) */
  const idle = async () => {
    await vi.advanceTimersByTimeAsync(GRACE_MS)
    await Promise.resolve()
  }
  /** the panel's run: its streams back to back, then idle */
  const run = async (body: () => Promise<void>) => {
    await body()
    await idle()
  }
  const question = (words: string): AgentMessage[] => [{ role: 'user', text: words }]
  /** the question, its CALL, and the tool results (`stopped`: what the loop keeps after a Stop) */
  const withResults = (words: string, stopped = false): AgentMessage[] => [
    ...question(words),
    {
      role: 'assistant',
      text: '',
      toolCalls: [{ id: CALL.id, name: CALL.name, input: CALL.args }],
    },
    {
      role: 'tool',
      results: [
        stopped
          ? { id: CALL.id, name: CALL.name, output: TOOL_ABORTED_OUTPUT, isError: true }
          : { id: CALL.id, name: CALL.name, output: 'edited' },
      ],
    },
  ]
  return {
    ai,
    api,
    posts,
    presets,
    idles: () => idles,
    answer: (...a: Answer[]) => queue.push(...a),
    stream,
    run,
    idle,
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

  it('a tool step slower than the grace idles the tracker mid-part; the part still continues', async () => {
    const r = rig()
    r.listen()
    await r.ai.startHandoff({ handoffId: 'h1', text: JOB })
    r.answer(
      () => ok({ calls: [CALL], remaining: 1 }),
      () => ok(),
    )
    await r.stream(r.question(JOB))
    // the tool (a search, an image, a confirm card) outlasts the grace: the tracker goes idle
    await r.idle()
    expect(r.idles()).toBe(1)
    expect(r.presets).toHaveLength(1)
    // its results resume the part in a new run; the part ends with the answer that calls no tool
    await r.run(() => r.stream(r.withResults(JOB)))
    expect(r.idles()).toBe(2)
    const next = continueText()
    expect(r.presets.at(-1)).toEqual({ text: next, displayText: next, autoRun: true })
    r.answer(() => ok({ remaining: 0 }))
    await r.run(() => r.stream(r.question(next)))
    expect(r.posts.map((p) => p.handoff)).toEqual(['h1', null, 'h1'])
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
    // the tool-result request hangs until the panel's Stop aborts it
    if (outcome === 'cancelled') r.answer(hangs)
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
    // the person's own question next: after a Stop the loop's history ends in aborted tool results
    r.answer(() => ok({ remaining: 1 }))
    await r.run(() =>
      r.stream(
        outcome === 'stopped'
          ? [...r.withResults(JOB, true), { role: 'user', text: 'Summarise this page' }]
          : r.question(JOB),
      ),
    )
    expect(r.posts.at(-1)!.handoff).toBeNull()
    expect(r.presets).toHaveLength(1)
    // nothing of the job is left: its own words asked once more carry no id either
    r.answer(() => ok({ remaining: 1 }))
    await r.run(() => r.stream(r.question(JOB)))
    expect(r.posts.at(-1)!.handoff).toBeNull()
    expect(r.presets).toHaveLength(1)
  })

  it.each([
    ['UniWork AI', 'uniwork'],
    ['another provider', 'openai'],
  ] as const)(
    "a Stop while tools ran, then the person's own question on %s, drops the job",
    async (_name, provider) => {
      const r = rig()
      r.listen()
      await r.ai.startHandoff({ handoffId: 'h1', text: JOB })
      r.answer(() => ok({ calls: [CALL], remaining: 1 }))
      await r.run(() => r.stream(r.question(JOB)))
      // Stop: the loop keeps the aborted tool results; the person then asks their own question,
      // which follows tool results in the history and ends cleanly
      if (provider === 'uniwork') r.answer(() => ok())
      await r.run(() =>
        r.stream(
          [...r.withResults(JOB, true), { role: 'user', text: 'Summarise this page' }],
          provider,
        ),
      )
      expect(r.presets).toHaveLength(1)
      expect(r.posts.map((p) => p.handoff)).toEqual(provider === 'uniwork' ? ['h1', null] : ['h1'])
    },
  )

  it.each([
    ['offline', 'offline'],
    ['stopped before any answer', 'aborted'],
    ['a 429 given up', 'gave-up'],
    ['a restarted conversation', 'restarted'],
  ] as const)(
    'a first post with no OK answer (%s) keeps the job: the retry carries the header',
    async (_name, outcome) => {
      const r = rig()
      r.listen()
      await r.ai.startHandoff({ handoffId: 'h1', text: JOB })
      if (outcome === 'offline') {
        r.answer(() => {
          throw new TypeError('Failed to fetch')
        })
      } else if (outcome === 'aborted') {
        r.answer(hangs)
      } else if (outcome === 'gave-up') {
        r.answer(() =>
          json(429, { code: 'ai_rate_limited', message: 'busy' }, { 'Retry-After': '3600' }),
        )
      } else {
        r.answer(() => json(409, { code: 'conversation_expired', message: 'expired' }))
      }
      await r.run(async () => {
        const first = r.stream(r.question(JOB))
        if (outcome === 'aborted') {
          await vi.waitFor(() => expect(r.posts).toHaveLength(1))
          await r.api.aiStreamCancel('s1')
        }
        await first
      })
      // the panel's Retry (or the person sending the kept question again)
      r.answer(() => ok({ remaining: 1 }))
      await r.run(() => r.stream(r.question(JOB)))
      expect(r.posts.map((p) => p.handoff)).toEqual(['h1', 'h1'])
      // the answer took the header: the next part follows
      expect(r.presets.at(-1)!.text).toBe(continueText())
    },
  )

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

  it('a preset whose text the composer rewrote (CRLF, spaces, NFC) still carries the header', async () => {
    const r = rig()
    r.listen()
    // "Soạn" with a decomposed ạ, CRLF and doubled spaces
    await r.ai.startHandoff({ handoffId: 'h1', text: 'Soạn\r\nthe  plan' })
    r.answer(() => ok({ remaining: 0 }))
    await r.run(() => r.stream(r.question('Please: Soạn\nthe plan')))
    expect(r.posts.map((p) => p.handoff)).toEqual(['h1'])
  })

  it("the turn-limit note after tool results keeps the job; the person's question inside the grace drops it", async () => {
    const r = rig()
    r.listen()
    await r.ai.startHandoff({ handoffId: 'h1', text: JOB })
    r.answer(
      () => ok({ calls: [CALL], remaining: 1 }),
      () => ok(),
    )
    await r.run(async () => {
      await r.stream(r.question(JOB))
      // the loop's own follow-up question after the tool results
      await r.stream([...r.withResults(JOB), { role: 'user', text: TURN_LIMIT_NOTE }])
    })
    const next = continueText()
    expect(r.presets.at(-1)!.text).toBe(next)
    r.answer(
      () => ok({ remaining: 1 }),
      () => ok(),
    )
    await r.run(async () => {
      await r.stream(r.question(next))
      // a queued question of the person starts inside the grace: same tracker run
      await r.stream([
        ...r.question(next),
        { role: 'assistant', text: 'Done.' },
        { role: 'user', text: 'Also fix the title' },
      ])
    })
    expect(r.posts.map((p) => p.handoff)).toEqual(['h1', null, 'h1', null])
    expect(r.presets).toHaveLength(2)
  })

  it("the loop's claimed-action correction during a part keeps the job and carries no header", async () => {
    const r = rig()
    r.listen()
    await r.ai.startHandoff({ handoffId: 'h1', text: JOB })
    r.answer(
      () => ok({ remaining: 1 }),
      () => ok(),
    )
    await r.run(async () => {
      await r.stream(r.question(JOB))
      // the skill refused the reply ("I selected ...") and the loop asks once more, after the
      // assistant turn (not after tool results)
      await r.stream([
        ...r.question(JOB),
        { role: 'assistant', text: 'I selected A1 for you.' },
        { role: 'user', text: SELECTION_CLAIM_CORRECTION },
      ])
    })
    const next = continueText()
    expect(r.presets.at(-1)).toEqual({ text: next, displayText: next, autoRun: true })
    r.answer(() => ok({ remaining: 0 }))
    await r.run(() => r.stream(r.question(next)))
    expect(r.posts.map((p) => p.handoff)).toEqual(['h1', null, 'h1'])
  })

  it("the loop's turn-limit note keeps the job and carries no header", async () => {
    const r = rig()
    r.listen()
    await r.ai.startHandoff({ handoffId: 'h1', text: JOB })
    r.answer(
      () => ok({ calls: [CALL], remaining: 1 }),
      () => ok(),
    )
    await r.run(async () => {
      await r.stream(r.question(JOB))
      await r.stream([...r.withResults(JOB), { role: 'user', text: TURN_LIMIT_NOTE }])
    })
    expect(r.posts.map((p) => p.handoff)).toEqual(['h1', null])
    expect(r.presets.at(-1)!.text).toBe(continueText())
    // the note is recognised by its text, wherever the loop puts it; a person's words still drop
    const h = createAiHandoff({ continueText })
    h.start({ handoffId: 'h2', text: JOB })
    expect(h.stream({ words: JOB, uniwork: true })).toBe('h2')
    h.answered('h2', true, '1')
    expect(h.stream({ words: TURN_LIMIT_NOTE, uniwork: true })).toBeNull()
    expect(h.stream({ words: SELECTION_CLAIM_CORRECTION, uniwork: true })).toBeNull()
    h.start({ handoffId: 'h3', text: JOB })
    expect(h.stream({ words: `  ${TURN_LIMIT_NOTE}\r\n`, uniwork: true })).toBeNull()
    expect(h.stream({ words: JOB, uniwork: true })).toBe('h3')
    h.start({ handoffId: 'h4', text: JOB })
    expect(h.stream({ words: 'Fix the title', uniwork: true })).toBeNull()
    expect(h.stream({ words: JOB, uniwork: true })).toBeNull()
  })

  it('a dropped job takes its buffered preset with it', async () => {
    const r = rig()
    // no listener: the preset waits for consumeAiPreset
    await r.ai.startHandoff({ handoffId: 'h1', text: JOB })
    r.answer(() => ok())
    await r.run(() => r.stream(r.question('Something else first')))
    expect(await r.api.consumeAiPreset()).toBeNull()
  })

  it('a question to another provider drops the job', async () => {
    const r = rig()
    r.listen()
    await r.ai.startHandoff({ handoffId: 'h1', text: JOB })
    // no BYOK key: the turn fails at once, but the person asked something else
    await r.run(() => r.stream(r.question('Translate this'), 'openai'))
    r.answer(() => ok())
    await r.run(() => r.stream(r.question(JOB)))
    expect(r.posts.map((p) => p.handoff)).toEqual([null])
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
