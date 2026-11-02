import { describe, expect, it } from 'vitest'
import type { AgentToolCall } from '@genoffice/agent-core'
import { consumeOpenAiCompatibleResponse } from '../src/protocols/openai-sse'
import type { AiTokenUsage } from '../src/types'
import { jsonResponse, okResponse, sseStream } from './test-utils'

function collector() {
  const deltas: string[] = []
  const usages: AiTokenUsage[] = []
  return {
    deltas,
    usages,
    cb: {
      signal: new AbortController().signal,
      onDelta: (text: string) => deltas.push(text),
      onToolCall: (_call: AgentToolCall) => undefined,
      onUsage: (usage: AiTokenUsage) => usages.push(usage),
    },
  }
}

async function run(response: Response, c: ReturnType<typeof collector>) {
  await consumeOpenAiCompatibleResponse(response, c.cb, () => {})
}

describe('chat-completions usage', () => {
  it('reports the usage chunk (empty choices)', async () => {
    const c = collector()
    await run(
      okResponse(
        sseStream([
          'data: {"choices":[{"delta":{"content":"hi"}}]}',
          'data: {"choices":[],"usage":{"prompt_tokens":123,"completion_tokens":45}}',
          'data: [DONE]',
          '',
        ]),
      ),
      c,
    )
    expect(c.deltas.join('')).toBe('hi')
    expect(c.usages).toEqual([{ inputTokens: 123, outputTokens: 45 }])
  })

  it('accepts usage on the final chunk with empty delta (DeepSeek-style)', async () => {
    const c = collector()
    await run(
      okResponse(
        sseStream([
          'data: {"choices":[{"delta":{"content":"hi"}}]}',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":"7","completion_tokens":"3"}}',
          'data: [DONE]',
          '',
        ]),
      ),
      c,
    )
    expect(c.usages).toEqual([{ inputTokens: 7, outputTokens: 3 }])
  })

  it('reports usage from a non-streaming JSON body', async () => {
    const c = collector()
    await run(
      jsonResponse({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 11, completion_tokens: 4 },
      }),
      c,
    )
    expect(c.usages).toEqual([{ inputTokens: 11, outputTokens: 4 }])
  })
})
