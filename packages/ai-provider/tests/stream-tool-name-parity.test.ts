import { describe, expect, it, vi } from 'vitest'
import type { AgentToolCall } from '@genoffice/agent-core'
import { consumeOpenAiCompatibleResponse } from '../src/protocols/openai-sse'
import { okResponse, sseStream } from './test-utils'

async function toolCallsOf(lines: string[]): Promise<AgentToolCall[]> {
  const toolCalls: AgentToolCall[] = []
  await consumeOpenAiCompatibleResponse(
    okResponse(sseStream(lines)),
    {
      signal: new AbortController().signal,
      onDelta: vi.fn(),
      onToolCall: (call) => toolCalls.push(call),
      onStopReason: vi.fn(),
    },
    () => {},
  )
  return toolCalls
}

describe('chat-completions tool names', () => {
  it('drops a tool call whose name fragments to empty', async () => {
    expect(
      await toolCallsOf([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":""}}]}}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
        'data: [DONE]',
      ]),
    ).toEqual([])
  })

  it('still emits a named tool call', async () => {
    expect(
      await toolCallsOf([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read"}}]}}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
        'data: [DONE]',
      ]),
    ).toEqual([{ id: 'c1', name: 'read', input: {} }])
  })
})
