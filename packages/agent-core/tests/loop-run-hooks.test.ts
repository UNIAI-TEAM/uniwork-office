import { describe, expect, it, vi } from 'vitest'
import {
  AgentLoop,
  type AgentMessage,
  type AgentRunResult,
  type AgentSkill,
  type AgentStreamCallbacks,
  type AgentToolCall,
  type AgentTransport,
  type ToolExecution,
} from '../src'

/** transport scripted turn by turn; a turn without a script step never answers */
function scriptedTransport(script: Array<(cb: AgentStreamCallbacks) => void>): AgentTransport {
  let turn = 0
  return {
    stream(_request: { system: string; messages: AgentMessage[]; tools: unknown[] }, cb) {
      const step = script[turn++]
      if (step) queueMicrotask(() => step(cb))
      return { cancel: () => queueMicrotask(() => cb.onDone()) }
    },
  }
}

function makeSkill(execute?: AgentSkill['executeTool']): AgentSkill {
  return {
    id: 'test',
    systemPrompt: 'system',
    tools: [{ name: 'do_thing', description: 'd', inputSchema: { type: 'object' } }],
    buildContext: () => 'CTX',
    executeTool: execute ?? (() => ({ output: 'ok', summary: 'done', mutated: true })),
  }
}

const call = (id: string): AgentToolCall => ({ id, name: 'do_thing', input: {} })
const flush = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  for (let i = 0; i < 10; i++) await flush()
}

/** events that log every hook in order */
function recorder(log: string[]) {
  return {
    onRunStart: (id: string) => log.push(`start:${id}`),
    onRunEnd: (id: string, end: { mutated: boolean; outcome: string }) =>
      log.push(`end:${id}:${end.mutated}:${end.outcome}`),
    onToolStart: (c: AgentToolCall) => log.push(`tool:${c.id}`),
    onDone: () => log.push('done'),
    onError: () => log.push('error'),
  }
}

/** asserts exactly one start/end pair with the same id and returns that id */
function onePair(log: string[]): string {
  const starts = log.filter((l) => l.startsWith('start:'))
  const ends = log.filter((l) => l.startsWith('end:'))
  expect(starts).toHaveLength(1)
  expect(ends).toHaveLength(1)
  const id = starts[0]!.slice('start:'.length)
  expect(id).not.toBe('')
  expect(ends[0]!.startsWith(`end:${id}:`)).toBe(true)
  return id
}

describe('AgentLoop run hooks', () => {
  it('a run with two mutating tools: start < tools < end(mutated) < onDone', async () => {
    const log: string[] = []
    const transport = scriptedTransport([
      (cb) => {
        cb.onToolCall(call('a'))
        cb.onToolCall(call('b'))
        cb.onDone()
      },
      (cb) => {
        cb.onDelta('ok')
        cb.onDone()
      },
    ])
    const loop = new AgentLoop({ transport, skill: makeSkill(), events: recorder(log) })
    loop.run('go')
    await settle()
    const id = onePair(log)
    expect(log).toEqual([`start:${id}`, 'tool:a', 'tool:b', `end:${id}:true:done`, 'done'])
  })

  it('fires onRunStart before the first captureSnapshot and model request', async () => {
    const log: string[] = []
    const transport: AgentTransport = {
      stream(_req, cb) {
        log.push('request')
        queueMicrotask(() => cb.onDone())
        return { cancel: () => {} }
      },
    }
    const loop = new AgentLoop({
      transport,
      skill: makeSkill(),
      captureSnapshot: () => log.push('snapshot'),
      events: { onRunStart: () => log.push('start') },
    })
    loop.run('go')
    await settle()
    expect(log[0]).toBe('start')
    expect(log).toContain('request')
  })

  it('a read-only run ends with mutated=false', async () => {
    const log: string[] = []
    const transport = scriptedTransport([
      (cb) => {
        cb.onToolCall(call('a'))
        cb.onDone()
      },
      (cb) => cb.onDone(),
    ])
    const skill = makeSkill(() => ({ output: 'read', summary: 'read' }))
    const loop = new AgentLoop({ transport, skill, events: recorder(log) })
    loop.run('go')
    await settle()
    const id = onePair(log)
    expect(log.at(-2)).toBe(`end:${id}:false:done`)
  })

  it('a transport error ends the run with outcome error, before onError', async () => {
    const log: string[] = []
    const transport = scriptedTransport([
      (cb) => {
        cb.onToolCall(call('a'))
        cb.onDone()
      },
      (cb) => cb.onError('boom'),
    ])
    const loop = new AgentLoop({ transport, skill: makeSkill(), events: recorder(log) })
    loop.run('go')
    await settle()
    const id = onePair(log)
    expect(log.slice(-2)).toEqual([`end:${id}:true:error`, 'error'])
  })

  it('a transport that throws on stream() still pairs the hooks', async () => {
    const log: string[] = []
    const transport: AgentTransport = {
      stream() {
        throw new Error('no route')
      },
    }
    const loop = new AgentLoop({ transport, skill: makeSkill(), events: recorder(log) })
    loop.run('go')
    await settle()
    const id = onePair(log)
    expect(log.slice(-2)).toEqual([`end:${id}:false:error`, 'error'])
  })

  it('a throwing buildContext still pairs the hooks', async () => {
    const log: string[] = []
    const skill = makeSkill()
    skill.buildContext = () => {
      throw new Error('doc mid-transition')
    }
    const loop = new AgentLoop({
      transport: scriptedTransport([]),
      skill,
      events: recorder(log),
    })
    loop.run('go')
    await settle()
    const id = onePair(log)
    expect(log.at(-2)).toBe(`end:${id}:false:error`)
  })

  it('the unusable-input cap ends the run with outcome error, before onError', async () => {
    const log: string[] = []
    const transport = scriptedTransport(
      Array.from({ length: 3 }, (_, n) => (cb: AgentStreamCallbacks) => {
        cb.onToolCall({ id: `e${n}`, name: 'apply_ops', input: {} })
        cb.onDone()
      }),
    )
    const skill = makeSkill()
    skill.tools = [
      {
        name: 'apply_ops',
        description: 'd',
        inputSchema: { type: 'object', properties: {}, required: ['ops'] },
      },
    ]
    const loop = new AgentLoop({ transport, skill, events: recorder(log) })
    loop.run('go')
    await settle()
    const id = onePair(log)
    expect(log.slice(-2)).toEqual([`end:${id}:false:error`, 'error'])
  })

  it('the every-tool-failed cap ends the run with outcome error, before onError', async () => {
    const log: string[] = []
    const transport = scriptedTransport(
      Array.from({ length: 8 }, (_, n) => (cb: AgentStreamCallbacks) => {
        // vary the input so the identical-turn guard does not trip first
        cb.onToolCall({ id: `t${n}`, name: 'do_thing', input: { n } })
        cb.onDone()
      }),
    )
    const skill = makeSkill(() => ({
      output: 'Unknown tool: nope',
      isError: true,
      summary: 'nope',
    }))
    const loop = new AgentLoop({ transport, skill, events: recorder(log) })
    loop.run('go')
    await settle()
    const id = onePair(log)
    expect(log.slice(-2)).toEqual([`end:${id}:false:error`, 'error'])
  })

  it('the identical-turn cap ends the run with outcome error, before onError', async () => {
    const log: string[] = []
    const sameTurn = (cb: AgentStreamCallbacks) => {
      cb.onToolCall(call('same'))
      cb.onDone()
    }
    const transport = scriptedTransport(Array.from({ length: 4 }, () => sameTurn))
    // read-only tool: identical output every time, nothing mutated
    const skill = makeSkill(() => ({ output: 'attachment body', summary: 'read' }))
    const loop = new AgentLoop({ transport, skill, events: recorder(log) })
    loop.run('go')
    await settle()
    const id = onePair(log)
    expect(log.slice(-2)).toEqual([`end:${id}:false:error`, 'error'])
  })

  it('abort mid-tool ends the run with outcome aborted, paired', async () => {
    const log: string[] = []
    const transport = scriptedTransport([
      (cb) => {
        cb.onToolCall(call('a'))
        cb.onToolCall(call('b'))
        cb.onDone()
      },
    ])
    const skill = makeSkill((c) => {
      // the user hits stop while the first tool runs; it still finishes its edit
      if (c.id === 'a') loop.cancel()
      return { output: 'ok', summary: 'done', mutated: true }
    })
    const loop = new AgentLoop({ transport, skill, events: recorder(log) })
    loop.run('go')
    await settle()
    const id = onePair(log)
    expect(log.slice(-2)).toEqual([`end:${id}:true:aborted`, 'done'])
  })

  it('a stop while a tool never resolves ends the run as aborted and may-have-mutated', async () => {
    const log: string[] = []
    const transport = scriptedTransport([
      (cb) => {
        cb.onToolCall(call('a'))
        cb.onDone()
      },
    ])
    const skill = makeSkill(() => new Promise<ToolExecution>(() => {}))
    const loop = new AgentLoop({ transport, skill, events: recorder(log) })
    loop.run('go')
    await settle()
    loop.cancel()
    await settle()
    const id = onePair(log)
    // the cut-off tool may already have edited the document: keep its undo step
    expect(log.slice(-2)).toEqual([`end:${id}:true:aborted`, 'done'])
  })

  it('a stop while the model is streaming ends the run as aborted', async () => {
    const log: string[] = []
    const transport = scriptedTransport([(cb) => cb.onDelta('thinking')])
    const loop = new AgentLoop({ transport, skill: makeSkill(), events: recorder(log) })
    loop.run('go')
    await settle()
    loop.cancel()
    await settle()
    const id = onePair(log)
    expect(log.slice(-2)).toEqual([`end:${id}:false:aborted`, 'done'])
  })

  it('cancel() during a retry backoff ends the run as aborted, before onDone', async () => {
    const log: string[] = []
    const done: AgentRunResult[] = []
    const transport = scriptedTransport([
      (cb) => cb.onError('Claude returned no content (empty stream)'),
    ])
    const loop = new AgentLoop({
      transport,
      skill: makeSkill(),
      events: {
        ...recorder(log),
        onDone: (result) => {
          log.push('done')
          done.push(result)
        },
      },
    })
    loop.run('go')
    await settle() // the empty-stream retry now waits on its 1s timer
    loop.cancel()
    await settle()
    const id = onePair(log)
    expect(log.slice(-2)).toEqual([`end:${id}:false:aborted`, 'done'])
    // the turn produced nothing: the run rolls back and reports a plain cancel
    expect(done).toEqual([{ text: '', cancelled: true, turnLimit: false }])
  })

  it('reset() during a run closes the open run as aborted', async () => {
    const log: string[] = []
    const transport = scriptedTransport([(cb) => cb.onDelta('thinking')])
    const loop = new AgentLoop({ transport, skill: makeSkill(), events: recorder(log) })
    loop.run('go')
    await settle()
    loop.reset()
    await settle()
    const id = onePair(log)
    expect(log.at(-1)).toBe(`end:${id}:false:aborted`)
  })

  it('reset() while a tool is in flight ends the run as aborted and may-have-mutated', async () => {
    const log: string[] = []
    const partial: string[] = []
    const transport = scriptedTransport([
      (cb) => {
        cb.onToolCall(call('a'))
        cb.onDone()
      },
    ])
    const skill = makeSkill(() => {
      partial.push('half the edit applied') // the tool wrote part of its edit...
      return new Promise<ToolExecution>(() => {}) // ...then awaits something that never finishes
    })
    const loop = new AgentLoop({ transport, skill, events: recorder(log) })
    loop.run('go')
    await settle()
    loop.reset()
    await settle()
    const id = onePair(log)
    expect(partial).toEqual(['half the edit applied'])
    // the run is dropped with the tool mid-execution: its partial edit must stay
    // undoable, so the run reports may-have-mutated like a mid-tool stop
    expect(log.at(-1)).toBe(`end:${id}:true:aborted`)
  })

  it('a tool left behind by reset() does not mark a later run as mutated', async () => {
    const log: string[] = []
    let release: () => void = () => {}
    const hung = new Promise<ToolExecution>((resolve) => {
      release = () => resolve({ output: 'late', summary: 'late', mutated: true })
    })
    const transport = scriptedTransport([
      (cb) => {
        cb.onToolCall(call('a'))
        cb.onDone()
      },
      (cb) => {
        cb.onDelta('answer')
        cb.onDone()
      },
    ])
    const loop = new AgentLoop({ transport, skill: makeSkill(() => hung), events: recorder(log) })
    loop.run('one')
    await settle()
    loop.reset()
    loop.run('two')
    await settle()
    const starts = log.filter((l) => l.startsWith('start:')).map((l) => l.slice('start:'.length))
    const ends = () => log.filter((l) => l.startsWith('end:'))
    expect(ends()).toEqual([`end:${starts[0]}:true:aborted`, `end:${starts[1]}:false:done`])
    release() // the abandoned tool finally returns, after the second run ended
    await settle()
    // no late close, and the second run's verdict stands
    expect(ends()).toEqual([`end:${starts[0]}:true:aborted`, `end:${starts[1]}:false:done`])
  })

  it('the turn limit still pairs the hooks with outcome done', async () => {
    const log: string[] = []
    const toolTurn = (cb: AgentStreamCallbacks) => {
      cb.onToolCall(call(`c${log.length}`))
      cb.onDone()
    }
    const transport = scriptedTransport([
      toolTurn,
      toolTurn,
      (cb) => {
        cb.onDelta('partial')
        cb.onDone()
      },
    ])
    const loop = new AgentLoop({
      transport,
      skill: makeSkill(),
      maxTurns: 2,
      events: recorder(log),
    })
    loop.run('go')
    await settle()
    const id = onePair(log)
    expect(log.slice(-2)).toEqual([`end:${id}:true:done`, 'done'])
  })

  it('a Retry-After reset keeps the same run id (one pair)', async () => {
    const log: string[] = []
    const transport = scriptedTransport([
      (cb) => {
        cb.onDelta('partial')
        cb.onTurnReset?.()
        cb.onToolCall(call('a'))
        cb.onDone()
      },
      (cb) => {
        cb.onTurnReset?.()
        cb.onDelta('done')
        cb.onDone()
      },
    ])
    const loop = new AgentLoop({
      transport,
      skill: makeSkill(),
      events: { ...recorder(log), onTurnReset: () => log.push('reset') },
    })
    loop.run('go')
    await settle()
    const id = onePair(log)
    expect(log.filter((l) => l === 'reset')).toHaveLength(2)
    expect(log.slice(-2)).toEqual([`end:${id}:true:done`, 'done'])
  })

  it('two consecutive runs get different ids, each paired', async () => {
    const log: string[] = []
    const transport = scriptedTransport([
      (cb) => cb.onDone(),
      (cb) => {
        cb.onToolCall(call('a'))
        cb.onDone()
      },
      (cb) => cb.onDone(),
    ])
    const loop = new AgentLoop({ transport, skill: makeSkill(), events: recorder(log) })
    loop.run('one')
    await settle()
    loop.run('two')
    await settle()
    const starts = log.filter((l) => l.startsWith('start:')).map((l) => l.slice(6))
    expect(starts).toHaveLength(2)
    expect(starts[0]).not.toBe(starts[1])
    expect(log.filter((l) => l.startsWith('end:'))).toEqual([
      `end:${starts[0]}:false:done`,
      `end:${starts[1]}:true:done`,
    ])
  })

  it('a second run() while one is active is ignored and fires no hooks', async () => {
    const log: string[] = []
    const transport = scriptedTransport([
      (cb) => {
        cb.onDelta('x')
        cb.onDone()
      },
    ])
    const loop = new AgentLoop({ transport, skill: makeSkill(), events: recorder(log) })
    loop.run('one')
    loop.run('two')
    await settle()
    onePair(log)
  })

  it('throwing hooks do not stop the run', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const done: unknown[] = []
    const executed: string[] = []
    const transport = scriptedTransport([
      (cb) => {
        cb.onToolCall(call('a'))
        cb.onDone()
      },
      (cb) => {
        cb.onDelta('fine')
        cb.onDone()
      },
    ])
    const skill = makeSkill((c) => {
      executed.push(c.id)
      return { output: 'ok', summary: 'done', mutated: true }
    })
    const loop = new AgentLoop({
      transport,
      skill,
      events: {
        onRunStart: () => {
          throw new Error('start hook')
        },
        onRunEnd: () => {
          throw new Error('end hook')
        },
        onDone: (r) => done.push(r),
      },
    })
    loop.run('go')
    await settle()
    expect(executed).toEqual(['a'])
    expect(done).toEqual([{ text: 'fine', cancelled: false, turnLimit: false }])
    expect(loop.busy).toBe(false)
    warn.mockRestore()
  })
})
