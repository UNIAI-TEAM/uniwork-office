// Reading an OK chat-completions answer (SSE or a complete JSON body) into the stream callbacks:
// the shared reader of the UniWork AI adapter and the web frame's writer.
import { describe, expect, it, vi } from 'vitest'
import type { AgentToolCall } from '@genoffice/agent-core'
import { consumeOpenAiCompatibleResponse } from '../src/protocols/openai-sse'
import { MAX_RESPONSE_BODY_BYTES } from '../src/protocols/shared'
import type { StreamCallbacks } from '../src/protocols/shared'
import { jsonResponse, okResponse, sseStream } from './test-utils'

function collector() {
  const deltas: string[] = []
  const reasoning: string[] = []
  const toolCalls: AgentToolCall[] = []
  const stopReasons: string[] = []
  const cb: StreamCallbacks = {
    signal: new AbortController().signal,
    onDelta: (text) => deltas.push(text),
    onReasoningDelta: (text) => reasoning.push(text),
    onToolCall: (call) => toolCalls.push(call),
    onStopReason: (reason) => stopReasons.push(reason),
  }
  return { deltas, reasoning, toolCalls, stopReasons, cb }
}

const consume = (response: Response, cb: StreamCallbacks) =>
  consumeOpenAiCompatibleResponse(response, cb, () => {})

function streamingToolArguments(fragmentLength: number, maxFragments: number) {
  let fragments = 0
  const encoder = new TextEncoder()
  const line = (fragment: string) =>
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: 'c1', function: { name: 'do_thing', arguments: fragment } },
            ],
          },
        },
      ],
    })}\n`
  return {
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        while ((controller.desiredSize ?? 0) > 0 && fragments < maxFragments) {
          controller.enqueue(encoder.encode(line('x'.repeat(fragmentLength))))
          fragments += 1
        }
        if (fragments >= maxFragments) controller.close()
      },
    }),
    get fragments() {
      return fragments
    },
  }
}

describe('consumeOpenAiCompatibleResponse: SSE', () => {
  it('flattens a content array into text (streamed and JSON body)', async () => {
    const parts = [
      { type: 'text', text: 'Here is ' },
      { type: 'text', text: 'the change.' },
    ]
    const streamed = collector()
    await consume(
      okResponse(
        sseStream([
          `data: {"choices":[{"delta":{"content":${JSON.stringify(parts)}}}]}`,
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
          'data: [DONE]',
        ]),
      ),
      streamed.cb,
    )
    expect(streamed.deltas.join('')).toBe('Here is the change.')

    const complete = collector()
    await consume(
      jsonResponse({ choices: [{ message: { content: parts }, finish_reason: 'stop' }] }),
      complete.cb,
    )
    expect(complete.deltas.join('')).toBe('Here is the change.')
  })

  it('reassembles fragmented tool call arguments and flushes on finish_reason', async () => {
    const { deltas, toolCalls, cb } = collector()
    await consume(
      okResponse(
        sseStream([
          'data: {"choices":[{"delta":{"content":"partial "}}]}',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"replace"}}]}}]}',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"x\\":1}"}}]}}]}',
          'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
          'data: [DONE]',
        ]),
      ),
      cb,
    )
    expect(deltas.join('')).toBe('partial ')
    expect(toolCalls).toEqual([{ id: 'c1', name: 'replace', input: { x: 1 } }])
  })

  it('turns non-object tool arguments into inputError instead of executing them (genoffice#1106)', async () => {
    const { toolCalls, cb } = collector()
    await consume(
      okResponse(
        sseStream([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"replace","arguments":"null"}}]}}]}',
          'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
          'data: [DONE]',
        ]),
      ),
      cb,
    )
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]!.input).toEqual({})
    expect(toolCalls[0]!.inputError).toMatch(/must be a JSON object/)
  })

  it('aborts when streamed tool arguments exceed the per-tool buffer limit', async () => {
    const stream = streamingToolArguments(1024, 10_000)
    const onDelta = vi.fn()
    const onToolCall = vi.fn()
    const { cb } = collector()
    await expect(consume(okResponse(stream.body), { ...cb, onDelta, onToolCall })).rejects.toThrow(
      /Tool call arguments exceeded the .* buffer limit/,
    )
    expect(stream.fragments).toBeLessThan(10_000)
    expect(onDelta).not.toHaveBeenCalled()
    expect(onToolCall).not.toHaveBeenCalled()
  })

  it('aborts when a turn starts more tool calls than the count cap', async () => {
    const starts = Array.from(
      { length: 150 },
      (_, i) =>
        `data: ${JSON.stringify({
          choices: [
            { delta: { tool_calls: [{ index: i, id: `c${i}`, function: { name: 'do_thing' } }] } },
          ],
        })}`,
    )
    await expect(consume(okResponse(sseStream(starts)), collector().cb)).rejects.toThrow(
      /Too many streamed tool calls/,
    )
  })

  it('tolerates servers that resend the full tool name on every delta', async () => {
    const { toolCalls, cb } = collector()
    await consume(
      okResponse(
        sseStream([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"replace","arguments":"{\\"x\\":"}}]}}]}',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"replace","arguments":"1}"}}]}}]}',
          'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
          'data: [DONE]',
        ]),
      ),
      cb,
    )
    expect(toolCalls).toEqual([{ id: 'c1', name: 'replace', input: { x: 1 } }])
  })

  it('still assembles a tool name streamed in fragments', async () => {
    const { toolCalls, cb } = collector()
    await consume(
      okResponse(
        sseStream([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"rep"}}]}}]}',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"lace","arguments":"{\\"x\\":1}"}}]}}]}',
          'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
          'data: [DONE]',
        ]),
      ),
      cb,
    )
    expect(toolCalls).toEqual([{ id: 'c1', name: 'replace', input: { x: 1 } }])
  })

  it("finish_reason 'length' normalizes to max_tokens and flags the cut-off tool call", async () => {
    const { toolCalls, stopReasons, cb } = collector()
    await consume(
      okResponse(
        sseStream([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"replace","arguments":"{\\"x\\": \\"trunc"}}]}}]}',
          'data: {"choices":[{"delta":{},"finish_reason":"length"}]}',
          'data: [DONE]',
        ]),
      ),
      cb,
    )
    expect(stopReasons).toEqual(['max_tokens'])
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]!.truncated).toBe(true)
    expect(toolCalls[0]!.inputError).toBeDefined()
  })

  it('surfaces reasoning deltas (reasoning_content or reasoning) before the text', async () => {
    const { deltas, reasoning, cb } = collector()
    await consume(
      okResponse(
        sseStream([
          'data: {"choices":[{"delta":{"reasoning_content":"hmm "}}]}',
          'data: {"choices":[{"delta":{"reasoning":"ok"}}]}',
          'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}',
        ]),
      ),
      cb,
    )
    expect(reasoning.join('')).toBe('hmm ok')
    expect(deltas.join('')).toBe('hi')
  })

  it('throws on a gateway error event instead of finishing an empty turn', async () => {
    await expect(
      consume(
        okResponse(
          sseStream([
            'data: {"error":{"message":"You exceeded your current quota"}}',
            'data: [DONE]',
          ]),
        ),
        collector().cb,
      ),
    ).rejects.toThrow('You exceeded your current quota')
  })

  it('throws when a content_filter finish produced no content', async () => {
    await expect(
      consume(
        okResponse(
          sseStream([
            'data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}',
            'data: [DONE]',
          ]),
        ),
        collector().cb,
      ),
    ).rejects.toThrow(/no content \(finish_reason=content_filter\)/)
  })

  it('keeps partial content when content_filter cuts off after some text', async () => {
    const { deltas, cb } = collector()
    await consume(
      okResponse(
        sseStream([
          'data: {"choices":[{"delta":{"content":"partial "}}]}',
          'data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}',
          'data: [DONE]',
        ]),
      ),
      cb,
    )
    expect(deltas.join('')).toBe('partial ')
  })

  it('rejects an empty stream, and still accepts a genuine empty closing turn', async () => {
    await expect(consume(okResponse(sseStream([])), collector().cb)).rejects.toThrow(
      /The model returned no content/,
    )
    await expect(
      consume(
        okResponse(
          sseStream(['data: {"choices":[{"delta":{},"finish_reason":"stop"}]}', 'data: [DONE]']),
        ),
        collector().cb,
      ),
    ).resolves.toBeUndefined()
  })

  it('rejects partial text or reasoning without terminal framing', async () => {
    for (const line of [
      'data: {"choices":[{"delta":{"content":"partial"}}]}',
      'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}',
    ]) {
      await expect(consume(okResponse(sseStream([line])), collector().cb)).rejects.toThrow(
        /model stream ended before a finish_reason or \[DONE\] marker/,
      )
    }
  })

  it('half-received tool arguments with no finish reject as a dropped connection', async () => {
    const { cb, toolCalls } = collector()
    const run = consume(
      okResponse(
        sseStream([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"write_html","arguments":"{\\"html\\":"}}]}}]}',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"<!doctype"}}]}}]}',
        ]),
      ),
      cb,
    )
    await expect(run).rejects.toThrow(/connection was dropped/)
    await expect(run).rejects.not.toThrow(/empty stream/)
    expect(toolCalls).toEqual([])
  })

  it('complete arguments with [DONE] still flush as a tool call', async () => {
    const { cb, toolCalls } = collector()
    await consume(
      okResponse(
        sseStream([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"ping","arguments":"{\\"a\\":1}"}}]}}]}',
          'data: [DONE]',
        ]),
      ),
      cb,
    )
    expect(toolCalls.map((c) => [c.name, c.input])).toEqual([['ping', { a: 1 }]])
  })
})

describe('consumeOpenAiCompatibleResponse: a complete JSON body instead of SSE', () => {
  it('emits content and tool calls', async () => {
    const { deltas, toolCalls, cb } = collector()
    await consume(
      jsonResponse({
        choices: [
          {
            message: {
              content: 'Here is the change.',
              tool_calls: [{ id: 'c1', function: { name: 'replace', arguments: '{"x":1}' } }],
            },
            finish_reason: 'stop',
          },
        ],
      }),
      cb,
    )
    expect(deltas.join('')).toBe('Here is the change.')
    expect(toolCalls).toEqual([
      { id: 'c1', name: 'replace', input: { x: 1 }, inputError: undefined },
    ])
  })

  it("flags the last tool call of a finish_reason 'length' body as truncated", async () => {
    const { toolCalls, stopReasons, cb } = collector()
    await consume(
      jsonResponse({
        choices: [
          {
            message: {
              tool_calls: [{ id: 'c1', function: { name: 'replace', arguments: '{"x": "tru' } }],
            },
            finish_reason: 'length',
          },
        ],
      }),
      cb,
    )
    expect(toolCalls[0]!.truncated).toBe(true)
    expect(toolCalls[0]!.inputError).toBeDefined()
    expect(stopReasons).toEqual(['max_tokens'])
  })

  it('emits a credits-style notice as the reply text: credits are reported by status and code only', async () => {
    const { deltas, cb } = collector()
    await consume(
      jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'Insufficient credits remaining.' } }],
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      }),
      cb,
    )
    expect(deltas.join('')).toBe('Insufficient credits remaining.')
  })

  it('stops a body over the per-turn tool-call budget at the same cap as SSE', async () => {
    const { toolCalls, cb } = collector()
    await expect(
      consume(
        jsonResponse({
          choices: [
            {
              message: {
                tool_calls: Array.from({ length: 150 }, (_, i) => ({
                  id: `c${i}`,
                  function: { name: 'do_thing', arguments: `{"index":${i}}` },
                })),
              },
              finish_reason: 'tool_calls',
            },
          ],
        }),
        cb,
      ),
    ).rejects.toThrow(/Too many streamed tool calls/)
    expect(toolCalls).toHaveLength(0)
  })

  it('throws on an empty body, with a body summary', async () => {
    await expect(
      consume(jsonResponse({ choices: [{ message: {} }] }), collector().cb),
    ).rejects.toThrow(/The model returned no content/)
    await expect(consume(jsonResponse({ choices: [] }), collector().cb)).rejects.toThrow(
      /The model returned no content: \{"choices":\[\]\}/,
    )
  })

  it('caps an oversized JSON body and cancels the read', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_RESPONSE_BODY_BYTES + 1))
      },
      cancel() {
        cancelled = true
      },
    })
    await expect(
      consume(
        new Response(body, { headers: { 'content-type': 'application/json' } }),
        collector().cb,
      ),
    ).rejects.toThrow(/Response body exceeded/)
    expect(cancelled).toBe(true)
  })
})
