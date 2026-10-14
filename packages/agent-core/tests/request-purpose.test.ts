import { describe, expect, it } from 'vitest'
import {
  AgentLoop,
  createAiRunTracker,
  createIpcTransport,
  streamText,
  type AgentMessage,
  type AgentStreamRequest,
  type AgentTransport,
  type IpcStreamStart,
} from '../src'

/**
 * Requests that are not agent turns say so (`purpose`), so a transport whose
 * server keeps the conversation (UniWork AI) can refuse them instead of
 * sending a compaction prompt or a one-shot writer prompt as a question.
 */

function recording(fail = false): AgentTransport & { requests: AgentStreamRequest[] } {
  const requests: AgentStreamRequest[] = []
  return {
    requests,
    stream(request, cb) {
      requests.push(request)
      queueMicrotask(() => {
        if (fail || request.purpose) cb.onError('unsupported')
        else {
          cb.onDelta('ok')
          cb.onDone()
        }
      })
      return { cancel: () => undefined }
    },
  }
}

describe('AgentStreamRequest.purpose', () => {
  it('the context summary is marked summary; a refusal falls back to the mechanical digest', async () => {
    const transport = recording()
    let finished: () => void = () => undefined
    const loop = new AgentLoop({
      transport,
      skill: {
        id: 't',
        systemPrompt: 's',
        tools: [],
        buildContext: () => '',
        executeTool: () => ({ output: 'ok', summary: 'ok' }),
      },
      compaction: { maxBytes: 1000, keepRecentBytes: 100 },
      events: { onDone: () => finished() },
    })
    const history: AgentMessage[] = []
    for (let i = 0; i < 3; i++) {
      history.push({ role: 'user', text: `q${i} ${'x'.repeat(300)}` })
      history.push({ role: 'assistant', text: `a${i}` })
    }
    loop.restore(history)
    await new Promise<void>((resolve) => {
      finished = resolve
      loop.run(`next ${'y'.repeat(400)}`)
    })
    await new Promise<void>((resolve) => {
      finished = resolve
      loop.run('last')
    })
    const summaries = transport.requests.filter((r) => r.purpose === 'summary')
    expect(summaries.length).toBeGreaterThan(0)
    // agent turns carry no purpose
    expect(transport.requests.filter((r) => !r.purpose).length).toBe(2)
    expect(loop.messages[0]).toMatchObject({ role: 'user' })
    expect((loop.messages[0] as { text: string }).text).toMatch(/q0/)
  })

  it('streamText is marked one-shot', async () => {
    const transport = recording(true)
    await streamText({
      transport,
      system: 's',
      user: 'write a page',
      maxChars: 1000,
      extract: (raw) => ({ text: raw }),
    })
    expect(transport.requests.map((r) => r.purpose)).toEqual(['one-shot'])
  })

  it('the IPC transport forwards the purpose to the main process, and none for an agent turn', () => {
    const starts: Array<IpcStreamStart<unknown>> = []
    const transport = createIpcTransport<unknown>({
      onStream: () => () => undefined,
      start: (req) => {
        starts.push(req)
      },
      cancel: () => undefined,
      getSettings: () => ({}),
      unknownErrorText: () => 'unknown',
      aiRun: createAiRunTracker(),
    })
    const cb = {
      onDelta: () => undefined,
      onToolCall: () => undefined,
      onDone: () => undefined,
      onError: () => undefined,
    }
    transport.stream({ system: 's', messages: [], tools: [], purpose: 'summary' }, cb)
    transport.stream({ system: 's', messages: [], tools: [] }, cb)
    expect(starts[0]!.purpose).toBe('summary')
    expect(starts[1]).not.toHaveProperty('purpose')
  })
})
