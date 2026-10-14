/**
 * Fake UniWork AI façade for the adapter tests: a UniworkChatTransport that
 * records every request (route scope, headers, parsed body) and answers from
 * a queue of scripted responses. Synthetic data only, no network.
 *
 * Like the server (app-api-contract §3.6/§3.7) every answer carries the
 * conversation and run id headers unless a script says otherwise (`ids: false`,
 * the responses that come before the server knows the ids).
 */
import type {
  UniworkChatRequest,
  UniworkChatTransport,
  UniworkExtension,
} from '../../src/uniwork/types'

export interface RecordedUniworkRequest {
  scope: UniworkChatRequest['scope']
  headers: Record<string, string>
  body: {
    messages: Array<Record<string, unknown>>
    tools?: Array<{ type: string; function: { name: string } }>
    stream?: boolean
    module?: string
    [key: string]: unknown
  }
}

export interface FakeIds {
  conversation?: string
  run?: string
}

type Script = (request: RecordedUniworkRequest) => Response | Promise<Response>

const encoder = new TextEncoder()

function idHeaders(ids: FakeIds | false): Record<string, string> {
  if (!ids) return {}
  return {
    ...(ids.conversation ? { 'X-UniWork-AI-Conversation': ids.conversation } : {}),
    ...(ids.run ? { 'X-UniWork-AI-Run': ids.run } : {}),
  }
}

function sse(events: unknown[], done = true): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const event of events)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      if (done) controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
}

export interface FakeToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

function toolCallsWire(calls: FakeToolCall[]) {
  return calls.map((c, index) => ({
    index,
    id: c.id,
    type: 'function',
    function: { name: c.name, arguments: JSON.stringify(c.args) },
  }))
}

const DEFAULT_IDS: FakeIds = { conversation: 'conv-1', run: 'run-1' }

/** v1: one complete chat.completion.chunk + [DONE] */
export function oneChunk(
  answer: string,
  opts: { ext?: Partial<UniworkExtension>; toolCalls?: FakeToolCall[]; ids?: FakeIds | false } = {},
): Response {
  const calls = opts.toolCalls ?? []
  const chunk = {
    object: 'chat.completion.chunk',
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          ...(answer ? { content: answer } : {}),
          ...(calls.length ? { tool_calls: toolCallsWire(calls) } : {}),
        },
        finish_reason: calls.length ? 'tool_calls' : 'stop',
      },
    ],
    x_uniwork: { step: 0, limit: 8, ...opts.ext },
  }
  return new Response(sse([chunk]), {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...idHeaders(opts.ids ?? DEFAULT_IDS) },
  })
}

/** v1.1: a real stream of content deltas, tool call fragments, then the finish chunk with x_uniwork */
export function realStream(
  deltas: string[],
  opts: { ext?: Partial<UniworkExtension>; toolCalls?: FakeToolCall[]; ids?: FakeIds | false } = {},
): Response {
  const calls = opts.toolCalls ?? []
  const events: unknown[] = deltas.map((d) => ({ choices: [{ index: 0, delta: { content: d } }] }))
  calls.forEach((c, index) => {
    const args = JSON.stringify(c.args)
    const half = Math.floor(args.length / 2)
    events.push({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              { index, id: c.id, function: { name: c.name, arguments: args.slice(0, half) } },
            ],
          },
        },
      ],
    })
    events.push({
      choices: [
        { index: 0, delta: { tool_calls: [{ index, function: { arguments: args.slice(half) } }] } },
      ],
    })
  })
  events.push({
    choices: [{ index: 0, delta: {}, finish_reason: calls.length ? 'tool_calls' : 'stop' }],
    x_uniwork: { step: 0, limit: 8, ...opts.ext },
  })
  return new Response(sse(events), {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...idHeaders(opts.ids ?? DEFAULT_IDS) },
  })
}

/** stream:false shape (a server answering JSON despite stream:true) */
export function json(
  answer: string,
  opts: { ext?: Partial<UniworkExtension>; toolCalls?: FakeToolCall[]; ids?: FakeIds | false } = {},
): Response {
  const calls = opts.toolCalls ?? []
  return new Response(
    JSON.stringify({
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: answer,
            ...(calls.length
              ? {
                  tool_calls: calls.map((c) => ({
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
      x_uniwork: { step: 0, limit: 8, ...opts.ext },
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json', ...idHeaders(opts.ids ?? DEFAULT_IDS) },
    },
  )
}

/** a façade error: real HTTP status + {code, message, fields?} */
export function error(
  status: number,
  code: string,
  opts: { retryAfter?: string; fields?: Record<string, unknown>; ids?: FakeIds | false } = {},
): Response {
  return new Response(
    JSON.stringify({
      code,
      message: `synthetic ${code}`,
      ...(opts.fields ? { fields: opts.fields } : {}),
    }),
    {
      status,
      headers: {
        'content-type': 'application/json',
        ...(opts.retryAfter !== undefined ? { 'Retry-After': opts.retryAfter } : {}),
        ...idHeaders(opts.ids ?? DEFAULT_IDS),
      },
    },
  )
}

/** the reserved end-of-stream frame: optional content first, then x_uniwork.terminal + [DONE] */
export function terminal(
  code: string,
  opts: { retryAfter?: number; before?: string[]; ids?: FakeIds | false } = {},
): Response {
  const events: unknown[] = (opts.before ?? []).map((d) => ({
    choices: [{ index: 0, delta: { content: d } }],
  }))
  events.push({
    x_uniwork: {
      terminal: {
        code,
        ...(opts.retryAfter !== undefined ? { retry_after: opts.retryAfter } : {}),
      },
    },
  })
  return new Response(sse(events), {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...idHeaders(opts.ids ?? DEFAULT_IDS) },
  })
}

export interface FakeUniworkServer extends UniworkChatTransport {
  requests: RecordedUniworkRequest[]
  /** queue the next answers, in order */
  enqueue(...scripts: Array<Response | Script>): void
}

export function createUniworkFake(): FakeUniworkServer {
  const queue: Array<Response | Script> = []
  const requests: RecordedUniworkRequest[] = []
  return {
    requests,
    enqueue(...scripts) {
      queue.push(...scripts)
    },
    async post(request) {
      const recorded: RecordedUniworkRequest = {
        scope: request.scope,
        headers: { ...request.headers },
        body: JSON.parse(request.body) as RecordedUniworkRequest['body'],
      }
      requests.push(recorded)
      const next = queue.shift()
      if (!next) throw new Error('fake UniWork server: no scripted answer left')
      return typeof next === 'function' ? next(recorded) : next
    },
  }
}

/** a StreamCallbacks recorder that applies the loop's turn-reset semantics (drop this turn's output) */
export function recorder(signal: AbortSignal = new AbortController().signal) {
  const state = {
    text: '',
    toolCalls: [] as Array<{ id: string; name: string; input: unknown }>,
    notices: [] as unknown[],
    resets: 0,
    activity: 0,
  }
  const cb = {
    signal,
    sessionId: 'panel-1',
    onDelta: (t: string) => {
      state.text += t
    },
    onToolCall: (c: { id: string; name: string; input: unknown }) => {
      state.toolCalls.push(c)
    },
    onNotice: (n: unknown) => {
      state.notices.push(n)
    },
    onTurnReset: () => {
      state.resets++
      state.text = ''
      state.toolCalls = []
    },
    onActivity: () => {
      state.activity++
    },
  }
  return { state, cb }
}
