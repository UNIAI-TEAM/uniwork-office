import { describe, expect, it } from 'vitest'
import {
  ASKUNI_DOC_BRIDGE_KEY,
  ASKUNI_DOC_CHANNELS,
  installUniworkAskUniDocBridge,
  type AskUniDocBridge,
} from '../src/shared/askuni-api'

/**
 * UNI-2076 s7b: the editor preload installer of `window.uniworkAskUniDoc`
 * (called by the six editor preloads in S7c/S7d): exactly the contract
 * methods, only contract fields reach `uniwork:askuni-doc:*` (never a
 * workspace, focus or mention), every reply and pushed event is validated.
 */

type Listener = (event: unknown, payload: unknown) => void

function install(reply: unknown) {
  const invoked: Array<{ channel: string; args: unknown[] }> = []
  const listeners = new Map<string, Set<Listener>>()
  const exposed: Record<string, unknown> = {}
  installUniworkAskUniDocBridge({
    contextBridge: { exposeInMainWorld: (key, api) => void (exposed[key] = api) },
    ipcRenderer: {
      invoke: async (channel, ...args) => {
        invoked.push({ channel, args })
        return reply
      },
      on: (channel, fn) => {
        if (!listeners.has(channel)) listeners.set(channel, new Set())
        listeners.get(channel)!.add(fn as Listener)
      },
      removeListener: (channel, fn) => void listeners.get(channel)?.delete(fn as Listener),
    },
  })
  return {
    exposed,
    bridge: exposed[ASKUNI_DOC_BRIDGE_KEY] as AskUniDocBridge,
    invoked,
    push: (payload: unknown) => {
      for (const fn of listeners.get(ASKUNI_DOC_CHANNELS.streamEvent) ?? []) fn({}, payload)
    },
    listenerCount: () => listeners.get(ASKUNI_DOC_CHANNELS.streamEvent)?.size ?? 0,
  }
}

describe('installUniworkAskUniDocBridge', () => {
  it('exposes window.uniworkAskUniDoc with exactly the contract methods', () => {
    const { exposed, bridge } = install(null)
    expect(Object.keys(exposed)).toEqual(['uniworkAskUniDoc'])
    expect(Object.keys(bridge).sort()).toEqual(
      [
        'askUniDocFeedbackClear',
        'askUniDocFeedbackSet',
        'askUniDocFlags',
        'askUniDocMessages',
        'askUniDocStream',
        'askUniDocStreamCancel',
        'onAskUniDocStreamEvent',
      ].sort(),
    )
  })

  it('stream forwards question/locale/model/effort/conversationId only', async () => {
    const { bridge, invoked } = install({ ok: true, requestId: 'req_1' })
    const result = await bridge.askUniDocStream({
      question: 'q',
      locale: 'vi',
      model: 'haiku',
      effort: 'high',
      conversationId: 'c1',
      workspaceId: 'ws_1',
      focus: { kind: 'project', id: 'p1' },
      mentions: [{ kind: 'member', id: 'u1' }],
      token: 'x',
    } as never)
    expect(result).toEqual({ ok: true, requestId: 'req_1' })
    expect(invoked).toEqual([
      {
        channel: ASKUNI_DOC_CHANNELS.stream,
        args: [
          { question: 'q', locale: 'vi', model: 'haiku', effort: 'high', conversationId: 'c1' },
        ],
      },
    ])
  })

  it('cancel, messages, feedback forward contract fields only; flags takes none', async () => {
    const { bridge, invoked } = install({ ok: true })
    await bridge.askUniDocStreamCancel({ requestId: 'r1', x: 1 } as never)
    await bridge.askUniDocMessages({ conversationId: 'c1', workspaceId: 'w' } as never)
    await bridge.askUniDocFeedbackSet({
      conversationId: 'c1',
      messageId: 'm1',
      rating: 'up',
      documentId: 'd',
    } as never)
    await bridge.askUniDocFeedbackClear({ conversationId: 'c1', messageId: 'm1', y: 2 } as never)
    await bridge.askUniDocFlags()
    expect(invoked).toEqual([
      { channel: ASKUNI_DOC_CHANNELS.streamCancel, args: [{ requestId: 'r1' }] },
      { channel: ASKUNI_DOC_CHANNELS.messages, args: [{ conversationId: 'c1' }] },
      {
        channel: ASKUNI_DOC_CHANNELS.feedbackSet,
        args: [{ conversationId: 'c1', messageId: 'm1', rating: 'up' }],
      },
      {
        channel: ASKUNI_DOC_CHANNELS.feedbackClear,
        args: [{ conversationId: 'c1', messageId: 'm1' }],
      },
      { channel: ASKUNI_DOC_CHANNELS.flags, args: [] },
    ])
  })

  it('validates replies: junk becomes an error / flags off', async () => {
    const { bridge } = install({ ok: 'yes', token: 'x' })
    expect(await bridge.askUniDocStream({ question: 'q' })).toEqual({ ok: false, error: 'error' })
    expect(await bridge.askUniDocFlags()).toEqual({ streamEnabled: false, bound: 'signed_out' })
    const flags = install({ streamEnabled: true, bound: 'document', extra: 1 })
    expect(await flags.bridge.askUniDocFlags()).toEqual({ streamEnabled: true, bound: 'document' })
  })

  it('pushed events are validated; the subscription returns its unsubscribe', () => {
    const { bridge, push, listenerCount } = install(null)
    const got: unknown[] = []
    const off = bridge.onAskUniDocStreamEvent((ev) => got.push(ev))
    push({ type: 'delta', requestId: 'r1', text: 'hi' })
    push({ type: 'delta', requestId: 'r1', text: 3 })
    push({ type: 'nope' })
    expect(got).toEqual([{ type: 'delta', requestId: 'r1', text: 'hi' }])
    expect(listenerCount()).toBe(1)
    off()
    expect(listenerCount()).toBe(0)
  })
})
