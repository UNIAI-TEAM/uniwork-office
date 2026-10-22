import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AskUniStreamClient,
  AskUniStreamPayload,
  AskUniStreamTerminal,
} from '../src/main/uniwork-askuni/stream-client'
import {
  createAskUniFlags,
  createAskUniStreamService,
  parseStreamRequest,
  type AskUniStreamSender,
  type AskUniStreamServiceDeps,
} from '../src/main/uniwork-askuni/stream-service'
import {
  ASKUNI_V2_CHANNELS,
  type AskUniStreamEvent,
  type AskUniStreamRequest,
} from '../src/shared/askuni-api'

/**
 * UNI-2076 s1: the Ask UNI v2 stream service behind `uniwork:askuni:stream*`:
 * request validation, the workspace check, events to the asking sender only,
 * cancel / sender destroyed / sign-out, one stream per sender, exactly one
 * terminal event per request, and the `ask_uni_stream` flag read.
 */

const WS = '01J8X4K2M0N1P2Q3R4S5T6U7V8'
const CONV = '01K4AICONV000000000000001'

const DONE: AskUniStreamTerminal = {
  type: 'done',
  message: {
    id: 'm1',
    role: 'assistant',
    content: 'hi',
    citations: [],
    createdAt: '2026-10-21T08:00:00Z',
  },
}

/** a stream client the test drives: each call waits until the test ends it */
function controlledClient() {
  const calls: Array<{
    req: AskUniStreamRequest
    signal: AbortSignal
    emit(ev: AskUniStreamPayload): void
    end(t: AskUniStreamTerminal): void
  }> = []
  const client: AskUniStreamClient = {
    stream: (req, { signal, onEvent }) =>
      new Promise<AskUniStreamTerminal>((resolve) => {
        const call = { req, signal, emit: onEvent, end: resolve }
        calls.push(call)
        // a real client returns cancelled once its signal fires
        signal.addEventListener('abort', () => resolve({ type: 'error', code: 'cancelled' }), {
          once: true,
        })
      }),
  }
  return { client, calls }
}

function sender(id: number) {
  const sent: AskUniStreamEvent[] = []
  const channels: string[] = []
  const listeners = new Set<() => void>()
  let destroyed = false
  const s: AskUniStreamSender & { sent: AskUniStreamEvent[]; channels: string[]; destroy(): void } =
    {
      id,
      sent,
      channels,
      isDestroyed: () => destroyed,
      send: (channel: string, ev: AskUniStreamEvent) => {
        channels.push(channel)
        sent.push(ev)
      },
      once: (_name: 'destroyed', fn: () => void) => {
        listeners.add(fn)
      },
      removeListener: (_name: 'destroyed', fn: () => void) => {
        listeners.delete(fn)
      },
      destroy() {
        destroyed = true
        for (const fn of [...listeners]) fn()
      },
    }
  return s
}

const tick = () => new Promise((r) => setTimeout(r, 0))
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await tick()
}

function setup(over: Partial<AskUniStreamServiceDeps> = {}) {
  const { client, calls } = controlledClient()
  let scope: string | null = 'acc_1:org_a'
  let n = 0
  const checkWorkspace = vi.fn(async (id: string) => (id === WS ? null : ('error' as const)))
  const deps: AskUniStreamServiceDeps = {
    isSignedIn: () => scope !== null,
    scopeKey: () => scope,
    checkWorkspace,
    client,
    newRequestId: () => `req_${++n}`,
    scopeCheckMs: 10,
    ...over,
  }
  const service = createAskUniStreamService(deps)
  return {
    service,
    calls,
    checkWorkspace,
    setScope: (s: string | null) => void (scope = s),
  }
}

const valid = (over: Record<string, unknown> = {}) => ({
  workspaceId: WS,
  question: '  task nào quá hạn?  ',
  locale: 'vi',
  ...over,
})

afterEach(() => vi.useRealTimers())

describe('parseStreamRequest', () => {
  it('keeps the contract fields only, trims the question', () => {
    expect(
      parseStreamRequest(
        valid({
          conversationId: CONV,
          focus: { kind: 'room', id: 'room_1', extra: 1 },
          mentions: [{ kind: 'member', id: 'usr_1' }],
          model: 'opus',
          effort: 'low',
          token: 'x',
        }),
      ),
    ).toEqual({
      workspaceId: WS,
      conversationId: CONV,
      question: 'task nào quá hạn?',
      locale: 'vi',
      focus: { kind: 'room', id: 'room_1' },
      mentions: [{ kind: 'member', id: 'usr_1' }],
      model: 'opus',
      effort: 'low',
    })
  })

  it.each([
    ['no question', { question: '   ' }],
    ['a too long question', { question: 'x'.repeat(2001) }],
    ['a bad locale', { locale: 'fr' }],
    ['a bad workspace id', { workspaceId: '../x' }],
    ['a bad conversation id', { conversationId: 'a b' }],
    ['a focus kind the server does not accept', { focus: { kind: 'member', id: 'u1' } }],
    ['a focus with a bad id', { focus: { kind: 'task', id: '../1' } }],
    ['a mention kind the server does not accept', { mentions: [{ kind: 'room', id: 'r1' }] }],
    [
      'six mentions',
      { mentions: Array.from({ length: 6 }, (_, i) => ({ kind: 'task', id: `t${i}` })) },
    ],
    ['mentions not an array', { mentions: { kind: 'task', id: 't1' } }],
    ['a bad model', { model: 'gpt' }],
    ['a bad effort', { effort: 'max' }],
  ])('refuses %s', (_name, over) => {
    expect(parseStreamRequest(valid(over))).toBeNull()
  })

  it('accepts the Auto model and refuses a non-object', () => {
    expect(parseStreamRequest(valid({ model: '' }))).toMatchObject({ model: '' })
    expect(parseStreamRequest(null)).toBeNull()
    expect(parseStreamRequest([])).toBeNull()
  })
})

describe('start', () => {
  it('refuses a bad request, signed out and an unknown workspace without calling the client', async () => {
    const { service, calls, setScope } = setup()
    const s = sender(1)
    expect(await service.start(s, valid({ locale: 'xx' }))).toEqual({ ok: false, error: 'error' })
    expect(await service.start(s, valid({ workspaceId: 'ws_other' }))).toEqual({
      ok: false,
      error: 'error',
    })
    setScope(null)
    expect(await service.start(s, valid())).toEqual({ ok: false, error: 'signed_out' })
    await flush()
    expect(calls).toHaveLength(0)
  })

  it('a workspace list failure maps to its code', async () => {
    const { service } = setup({ checkWorkspace: async () => 'offline' })
    expect(await service.start(sender(1), valid())).toEqual({ ok: false, error: 'offline' })
  })

  it('returns a requestId and pushes every event, then one terminal, to that sender only', async () => {
    const { service, calls } = setup()
    const a = sender(1)
    const b = sender(2)
    expect(await service.start(a, valid())).toEqual({ ok: true, requestId: 'req_1' })
    await flush()
    expect(calls[0].req.question).toBe('task nào quá hạn?')
    calls[0].emit({ type: 'run', runId: 'r1', conversationId: CONV })
    calls[0].emit({ type: 'delta', text: 'hi' })
    calls[0].end(DONE)
    await flush()
    expect(a.channels.every((c) => c === ASKUNI_V2_CHANNELS.streamEvent)).toBe(true)
    expect(a.sent).toEqual([
      { type: 'run', requestId: 'req_1', runId: 'r1', conversationId: CONV },
      { type: 'delta', requestId: 'req_1', text: 'hi' },
      { ...DONE, requestId: 'req_1' },
    ])
    expect(b.sent).toEqual([])
    expect(service.active()).toBe(0)
  })

  it('never forwards a terminal the client emitted as an event, nor anything after the terminal', async () => {
    const { service, calls } = setup()
    const a = sender(1)
    await service.start(a, valid())
    await flush()
    calls[0].emit(DONE as AskUniStreamPayload)
    calls[0].end({ type: 'error', code: 'stream_ended' })
    await flush()
    calls[0].emit({ type: 'delta', text: 'late' })
    expect(a.sent).toEqual([{ type: 'error', requestId: 'req_1', code: 'stream_ended' }])
  })

  it('a client that throws still ends with exactly one error event', async () => {
    const a = sender(1)
    const { service } = setup({
      client: {
        stream: async () => {
          throw new Error('boom')
        },
      },
    })
    await service.start(a, valid())
    await flush()
    expect(a.sent).toEqual([{ type: 'error', requestId: 'req_1', code: 'error' }])
  })

  it('a new stream of the same sender cancels the older one; other senders keep theirs', async () => {
    const { service, calls } = setup()
    const a = sender(1)
    const b = sender(2)
    await service.start(a, valid())
    await service.start(b, valid())
    await flush()
    await service.start(a, valid())
    await flush()
    expect(calls[0].signal.aborted).toBe(true)
    expect(calls[1].signal.aborted).toBe(false)
    expect(a.sent).toEqual([{ type: 'error', requestId: 'req_1', code: 'cancelled' }])
    expect(service.active()).toBe(2)
  })
})

describe('cancel', () => {
  it('the asking sender cancels its own request: one cancelled terminal', async () => {
    const { service, calls } = setup()
    const a = sender(1)
    await service.start(a, valid())
    await flush()
    calls[0].emit({ type: 'delta', text: 'x' })
    expect(service.cancel(a, { requestId: 'req_1' })).toEqual({ ok: true })
    await flush()
    expect(calls[0].signal.aborted).toBe(true)
    expect(a.sent.filter((e) => e.type === 'error')).toEqual([
      { type: 'error', requestId: 'req_1', code: 'cancelled' },
    ])
    expect(service.active()).toBe(0)
  })

  it('a cancel from another sender is refused and changes nothing', async () => {
    const { service, calls } = setup()
    const a = sender(1)
    await service.start(a, valid())
    await flush()
    expect(service.cancel(sender(2), { requestId: 'req_1' })).toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(calls[0].signal.aborted).toBe(false)
    expect(service.active()).toBe(1)
  })

  it('an unknown or finished request is a no-op ok; a bad input is error', async () => {
    const { service } = setup()
    expect(service.cancel(sender(1), { requestId: 'req_9' })).toEqual({ ok: true })
    expect(service.cancel(sender(1), { requestId: 5 })).toEqual({ ok: false, error: 'error' })
    expect(service.cancel(sender(1), null)).toEqual({ ok: false, error: 'error' })
  })

  it('a destroyed sender aborts its stream and gets nothing', async () => {
    const { service, calls } = setup()
    const a = sender(1)
    await service.start(a, valid())
    await flush()
    a.destroy()
    await flush()
    expect(calls[0].signal.aborted).toBe(true)
    expect(a.sent).toEqual([])
    expect(service.active()).toBe(0)
  })

  it('a sign-out or account switch aborts every stream with cancelled', async () => {
    const { service, calls, setScope } = setup()
    const a = sender(1)
    const b = sender(2)
    await service.start(a, valid())
    await service.start(b, valid())
    await flush()
    setScope('acc_2:org_a')
    await new Promise((r) => setTimeout(r, 30))
    await flush()
    expect(calls.every((c) => c.signal.aborted)).toBe(true)
    expect(a.sent).toEqual([{ type: 'error', requestId: 'req_1', code: 'cancelled' }])
    expect(b.sent).toEqual([{ type: 'error', requestId: 'req_2', code: 'cancelled' }])
  })

  it('an event that arrives after the scope changed is not forwarded', async () => {
    const { service, calls, setScope } = setup({ scopeCheckMs: 60_000 })
    const a = sender(1)
    await service.start(a, valid())
    await flush()
    setScope(null)
    calls[0].emit({ type: 'delta', text: 'other account' })
    await flush()
    expect(a.sent).toEqual([{ type: 'error', requestId: 'req_1', code: 'cancelled' }])
  })

  it('abortAll cancels every stream', async () => {
    const { service, calls } = setup()
    const a = sender(1)
    await service.start(a, valid())
    await flush()
    service.abortAll()
    await flush()
    expect(calls[0].signal.aborted).toBe(true)
    expect(a.sent).toEqual([{ type: 'error', requestId: 'req_1', code: 'cancelled' }])
  })
})

describe('createAskUniFlags', () => {
  it('reads the flag once per scope within the TTL', async () => {
    let now = 1_000
    const read = vi.fn(async () => true)
    const flags = createAskUniFlags({
      isSignedIn: () => true,
      scopeKey: () => 'acc_1:org_a',
      read,
      now: () => now,
    })
    expect(await flags.flags()).toEqual({ streamEnabled: true })
    expect(await flags.flags()).toEqual({ streamEnabled: true })
    expect(read).toHaveBeenCalledTimes(1)
    now += 61_000
    await flags.flags()
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('a scope change reads again', async () => {
    let scope = 'acc_1:org_a'
    const read = vi.fn(async () => scope === 'acc_1:org_a')
    const flags = createAskUniFlags({ isSignedIn: () => true, scopeKey: () => scope, read })
    expect(await flags.flags()).toEqual({ streamEnabled: true })
    scope = 'acc_1:org_b'
    expect(await flags.flags()).toEqual({ streamEnabled: false })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('is false when signed out (no read) or the read fails', async () => {
    const read = vi.fn(async (): Promise<boolean> => {
      throw new Error('offline')
    })
    const out = createAskUniFlags({ isSignedIn: () => false, scopeKey: () => null, read })
    expect(await out.flags()).toEqual({ streamEnabled: false })
    expect(read).not.toHaveBeenCalled()
    const failing = createAskUniFlags({ isSignedIn: () => true, scopeKey: () => 's', read })
    expect(await failing.flags()).toEqual({ streamEnabled: false })
  })
})
