import { afterEach, describe, expect, it, vi } from 'vitest'
import { ASKUNI_V2_CHANNELS, type AskUniV2Bridge } from '../src/shared/askuni-api'

/**
 * UNI-2076 s1: the v2 stream methods of `window.aiOffice` in the SHELL preload:
 * only contract fields cross, every reply and pushed event is validated, and
 * the event subscription returns its unsubscribe.
 */

type Listener = (event: unknown, payload: unknown) => void

async function loadPreload(replyValue: unknown) {
  vi.resetModules()
  const invoked: Array<{ channel: string; args: unknown[] }> = []
  const listeners = new Map<string, Set<Listener>>()
  const exposed: Record<string, unknown> = {}
  vi.doMock('electron', () => ({
    contextBridge: {
      exposeInMainWorld: (key: string, value: unknown) => void (exposed[key] = value),
    },
    ipcRenderer: {
      on: (channel: string, fn: Listener) => {
        if (!listeners.has(channel)) listeners.set(channel, new Set())
        listeners.get(channel)!.add(fn)
      },
      removeListener: (channel: string, fn: Listener) => void listeners.get(channel)?.delete(fn),
      invoke: async (channel: string, ...args: unknown[]) => {
        invoked.push({ channel, args })
        return replyValue
      },
      send: () => undefined,
    },
    webUtils: { getPathForFile: () => '' },
  }))
  await import('../src/preload/index')
  const push = (payload: unknown) => {
    for (const fn of listeners.get(ASKUNI_V2_CHANNELS.streamEvent) ?? []) fn({}, payload)
  }
  const ours = () => invoked.filter((c) => c.channel.startsWith('uniwork:askuni:'))
  return {
    bridge: exposed.aiOffice as AskUniV2Bridge,
    invoked: ours,
    push,
    listenerCount: () => listeners.get(ASKUNI_V2_CHANNELS.streamEvent)?.size ?? 0,
  }
}

afterEach(() => {
  vi.doUnmock('electron')
  vi.resetModules()
})

describe('preload: Ask UNI v2 stream bridge', () => {
  it('askUniStream forwards only the contract fields', async () => {
    const { bridge, invoked } = await loadPreload({ ok: true, requestId: 'req_1' })
    const result = await bridge.askUniStream({
      workspaceId: 'ws_1',
      conversationId: 'c1',
      question: 'q',
      locale: 'vi',
      focus: { kind: 'document', id: 'd1', extra: 'x' } as never,
      mentions: [{ kind: 'member', id: 'u1', href: 'https://x' } as never],
      model: 'haiku',
      effort: 'low',
      token: 'leak',
    } as never)
    expect(result).toEqual({ ok: true, requestId: 'req_1' })
    expect(invoked()).toEqual([
      {
        channel: ASKUNI_V2_CHANNELS.stream,
        args: [
          {
            workspaceId: 'ws_1',
            conversationId: 'c1',
            question: 'q',
            locale: 'vi',
            focus: { kind: 'document', id: 'd1' },
            mentions: [{ kind: 'member', id: 'u1' }],
            model: 'haiku',
            effort: 'low',
          },
        ],
      },
    ])
  })

  it('askUniStream leaves absent optional fields out', async () => {
    const { bridge, invoked } = await loadPreload({ ok: true, requestId: 'req_1' })
    await bridge.askUniStream({ workspaceId: 'ws_1', question: 'q', locale: 'en' })
    expect(invoked()[0].args).toEqual([{ workspaceId: 'ws_1', question: 'q', locale: 'en' }])
  })

  it('a reply of the wrong shape is an error result', async () => {
    const { bridge } = await loadPreload({ ok: true })
    expect(await bridge.askUniStream({ workspaceId: 'w', question: 'q', locale: 'en' })).toEqual({
      ok: false,
      error: 'error',
    })
    const refused = await loadPreload({ ok: false, error: 'rate_limited', retryAfterSeconds: 9e9 })
    expect(
      await refused.bridge.askUniStream({ workspaceId: 'w', question: 'q', locale: 'en' }),
    ).toEqual({ ok: false, error: 'rate_limited', retryAfterSeconds: 3600 })
  })

  it('askUniStreamCancel sends only the requestId', async () => {
    const { bridge, invoked } = await loadPreload({ ok: true })
    expect(await bridge.askUniStreamCancel({ requestId: 'req_1', x: 1 } as never)).toEqual({
      ok: true,
    })
    expect(invoked()).toEqual([
      { channel: ASKUNI_V2_CHANNELS.streamCancel, args: [{ requestId: 'req_1' }] },
    ])
  })

  it('askUniFlags is streamEnabled only for a true reply', async () => {
    expect(await (await loadPreload({ streamEnabled: true })).bridge.askUniFlags()).toEqual({
      streamEnabled: true,
    })
    expect(await (await loadPreload({ streamEnabled: 'yes' })).bridge.askUniFlags()).toEqual({
      streamEnabled: false,
    })
    const { bridge, invoked } = await loadPreload({ ok: false, error: 'forbidden' })
    expect(await bridge.askUniFlags()).toEqual({ streamEnabled: false })
    expect(invoked()).toEqual([{ channel: ASKUNI_V2_CHANNELS.flags, args: [] }])
  })

  it('onAskUniStreamEvent delivers validated events, drops bad ones, and unsubscribes', async () => {
    const { bridge, push, listenerCount } = await loadPreload(null)
    const got: unknown[] = []
    const off = bridge.onAskUniStreamEvent((ev) => got.push(ev))
    expect(listenerCount()).toBe(1)
    push({ type: 'delta', requestId: 'req_1', text: 'hi', extra: 'x' })
    push({ type: 'delta', requestId: 'req_1', text: 5 })
    push({ type: 'weird', requestId: 'req_1' })
    push({ type: 'delta', text: 'no request id' })
    push({ type: 'error', requestId: 'req_1', code: 'something_new' })
    expect(got).toEqual([
      { type: 'delta', requestId: 'req_1', text: 'hi' },
      { type: 'error', requestId: 'req_1', code: 'error' },
    ])
    off()
    expect(listenerCount()).toBe(0)
    push({ type: 'delta', requestId: 'req_1', text: 'after' })
    expect(got).toHaveLength(2)
  })
})
