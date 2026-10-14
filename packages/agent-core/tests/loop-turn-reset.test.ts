import { describe, expect, it } from 'vitest'
import {
  AgentLoop,
  type AgentSkill,
  type AgentStreamCallbacks,
  type AgentStreamNotice,
  type AgentTransport,
} from '../src'

const skill: AgentSkill = {
  id: 'test',
  systemPrompt: 'system',
  tools: [{ name: 'do_thing', description: 'd', inputSchema: { type: 'object' } }],
  buildContext: () => 'CTX',
  executeTool: () => ({ output: 'ok', summary: 'done', mutated: true }),
}

function transportOf(step: (cb: AgentStreamCallbacks) => void): AgentTransport {
  return {
    stream(_request, cb) {
      queueMicrotask(() => step(cb))
      return { cancel: () => {} }
    },
  }
}

const finished = (loop: AgentLoop, events: { done: unknown[] }) =>
  new Promise<void>((resolve) => {
    const poll = () => (events.done.length > 0 ? resolve() : setTimeout(poll, 0))
    poll()
    void loop
  })

describe('onTurnReset', () => {
  it('clears the turn text and tool calls', async () => {
    const texts: string[] = []
    const done: unknown[] = []
    const transport = transportOf((cb) => {
      cb.onDelta('partial answer')
      cb.onToolCall({ id: 'c1', name: 'do_thing', input: {} })
      // the adapter waited out a Retry-After and resends the same turn
      cb.onTurnReset?.()
      cb.onDelta('final answer')
      cb.onDone()
    })
    const loop = new AgentLoop({
      transport,
      skill,
      events: {
        onText: (text) => texts.push(text),
        onDone: (r) => done.push(r),
      },
    })
    loop.run('hi')
    await finished(loop, { done })
    // the UI is told to redraw from empty, the dropped tool call never ran
    expect(texts).toEqual(['partial answer', '', 'final answer'])
    expect(done).toEqual([{ text: 'final answer', cancelled: false, turnLimit: false }])
  })

  it('a reset on an empty turn draws nothing and a late reset after settle is ignored', async () => {
    const texts: string[] = []
    const done: unknown[] = []
    let late: (() => void) | undefined
    const transport = transportOf((cb) => {
      cb.onTurnReset?.()
      cb.onDelta('x')
      cb.onDone()
      late = () => cb.onTurnReset?.()
    })
    const loop = new AgentLoop({
      transport,
      skill,
      events: { onText: (t) => texts.push(t), onDone: (r) => done.push(r) },
    })
    loop.run('hi')
    await finished(loop, { done })
    late?.()
    expect(texts).toEqual(['x'])
  })
})

describe('events.onTurnReset', () => {
  it('fires on every reset, even when no text had streamed yet', async () => {
    const resets: string[] = []
    const done: unknown[] = []
    const transport = transportOf((cb) => {
      cb.onTurnReset?.()
      cb.onDelta('a')
      cb.onTurnReset?.()
      cb.onDelta('b')
      cb.onDone()
    })
    const loop = new AgentLoop({
      transport,
      skill,
      events: {
        onText: (t) => resets.push(`text:${t}`),
        onTurnReset: () => resets.push('reset'),
        onDone: (r) => done.push(r),
      },
    })
    loop.run('hi')
    await finished(loop, { done })
    expect(resets).toEqual(['reset', 'text:a', 'reset', 'text:', 'text:b'])
  })
})

describe('onNotice', () => {
  it('forwards a transport notice to the loop events, in order, mid-turn', async () => {
    const notices: AgentStreamNotice[] = []
    const done: unknown[] = []
    const transport = transportOf((cb) => {
      cb.onNotice?.({ kind: 'rate-limit-wait', seconds: 120, attempt: 1 })
      cb.onNotice?.({ kind: 'step', step: 1, limit: 12 })
      cb.onDelta('ok')
      cb.onDone()
    })
    const loop = new AgentLoop({
      transport,
      skill,
      events: { onNotice: (n) => notices.push(n), onDone: (r) => done.push(r) },
    })
    loop.run('hi')
    await finished(loop, { done })
    expect(notices).toEqual([
      { kind: 'rate-limit-wait', seconds: 120, attempt: 1 },
      { kind: 'step', step: 1, limit: 12 },
    ])
  })

  it('a throwing notice listener does not break the turn', async () => {
    const done: unknown[] = []
    const transport = transportOf((cb) => {
      cb.onNotice?.({ kind: 'conversation-restarted' })
      cb.onDelta('ok')
      cb.onDone()
    })
    const loop = new AgentLoop({
      transport,
      skill,
      events: {
        onNotice: () => {
          throw new Error('panel gone')
        },
        onDone: (r) => done.push(r),
      },
    })
    loop.run('hi')
    await finished(loop, { done })
    expect(done).toHaveLength(1)
  })
})
