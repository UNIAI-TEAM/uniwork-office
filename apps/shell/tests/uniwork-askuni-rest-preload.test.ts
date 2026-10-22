import { afterEach, describe, expect, it, vi } from 'vitest'
import { ASKUNI_V2_CHANNELS, type AskUniV2Bridge } from '../src/shared/askuni-api'

/**
 * UNI-2076 s2: the REST methods of `window.aiOffice` in the SHELL preload:
 * only contract fields cross and every reply is validated.
 */

async function loadPreload(replyValue: unknown) {
  vi.resetModules()
  const invoked: Array<{ channel: string; args: unknown[] }> = []
  const exposed: Record<string, unknown> = {}
  vi.doMock('electron', () => ({
    contextBridge: {
      exposeInMainWorld: (key: string, value: unknown) => void (exposed[key] = value),
    },
    ipcRenderer: {
      on: () => undefined,
      removeListener: () => undefined,
      invoke: async (channel: string, ...args: unknown[]) => {
        invoked.push({ channel, args })
        return replyValue
      },
      send: () => undefined,
    },
    webUtils: { getPathForFile: () => '' },
  }))
  await import('../src/preload/index')
  return {
    bridge: exposed.aiOffice as AskUniV2Bridge,
    invoked: () => invoked.filter((c) => c.channel.startsWith('uniwork:askuni:')),
  }
}

afterEach(() => {
  vi.doUnmock('electron')
  vi.resetModules()
})

const X = { leak: 'token' }

describe('preload: Ask UNI v2 REST bridge', () => {
  it.each([
    [
      'askUniCapabilities',
      ASKUNI_V2_CHANNELS.capabilities,
      { workspaceId: 'ws_1', ...X },
      { workspaceId: 'ws_1' },
    ],
    [
      'askUniConversations',
      ASKUNI_V2_CHANNELS.conversations,
      { workspaceId: 'ws_1', ...X },
      { workspaceId: 'ws_1' },
    ],
    [
      'askUniMessages',
      ASKUNI_V2_CHANNELS.messages,
      { conversationId: 'c1', ...X },
      { conversationId: 'c1' },
    ],
    [
      'askUniRename',
      ASKUNI_V2_CHANNELS.rename,
      { conversationId: 'c1', title: 'T', ...X },
      { conversationId: 'c1', title: 'T' },
    ],
    [
      'askUniDelete',
      ASKUNI_V2_CHANNELS.delete,
      { conversationId: 'c1', ...X },
      { conversationId: 'c1' },
    ],
    [
      'askUniFeedbackSet',
      ASKUNI_V2_CHANNELS.feedbackSet,
      { conversationId: 'c1', messageId: 'm1', rating: 'down', reason: 'other', note: 'n', ...X },
      { conversationId: 'c1', messageId: 'm1', rating: 'down', reason: 'other', note: 'n' },
    ],
    [
      'askUniFeedbackClear',
      ASKUNI_V2_CHANNELS.feedbackClear,
      { conversationId: 'c1', messageId: 'm1', ...X },
      { conversationId: 'c1', messageId: 'm1' },
    ],
    [
      'askUniLookup',
      ASKUNI_V2_CHANNELS.lookup,
      { workspaceId: 'ws_1', kind: 'task', query: 'q', ...X },
      { workspaceId: 'ws_1', kind: 'task', query: 'q' },
    ],
  ] as const)('%s forwards only contract fields', async (method, channel, input, forwarded) => {
    const { bridge, invoked } = await loadPreload({ ok: false, error: 'forbidden' })
    const call = bridge[method] as (req: unknown) => Promise<unknown>
    expect(await call(input)).toEqual({ ok: false, error: 'forbidden' })
    expect(invoked()).toEqual([{ channel, args: [forwarded] }])
  })

  it('feedback leaves absent optional fields out', async () => {
    const { bridge, invoked } = await loadPreload({ ok: true })
    await bridge.askUniFeedbackSet({ conversationId: 'c1', messageId: 'm1', rating: 'up' })
    expect(invoked()[0].args).toEqual([{ conversationId: 'c1', messageId: 'm1', rating: 'up' }])
  })

  it('keeps every notice the server stores on a message and drops an unknown one', async () => {
    const m = (id: string, notice: string) => ({
      id,
      role: 'assistant',
      content: 'half an answ',
      citations: [],
      notice,
      createdAt: 'a',
    })
    const notices = ['stopped', 'interrupted', 'agent_failed', 'refused']
    const { bridge } = await loadPreload({
      ok: true,
      messages: [...notices.map((n) => m(`m-${n}`, n)), m('m-odd', 'weird')],
    })
    const res = await bridge.askUniMessages({ conversationId: 'c1' })
    expect(res.ok && res.messages.map((x) => [x.id, x.notice])).toEqual([
      ...notices.map((n) => [`m-${n}`, n]),
      ['m-odd', undefined],
    ])
  })

  it('validates each reply shape', async () => {
    const conv = { id: 'c1', title: 'T', createdAt: 'a', updatedAt: 'b' }
    const list = await loadPreload({ ok: true, conversations: [conv, { id: 5 }] })
    expect(await list.bridge.askUniConversations({ workspaceId: 'w' })).toEqual({
      ok: true,
      conversations: [conv],
    })
    const caps = await loadPreload({
      ok: true,
      enabled: true,
      models: [{ key: 'gpt', speed: 1, intelligence: 1, cost: 1, enabled: true }],
      autoModel: 'sonnet',
    })
    expect(await caps.bridge.askUniCapabilities({ workspaceId: 'w' })).toEqual({
      ok: true,
      enabled: true,
      models: [],
      autoModel: 'sonnet',
    })
    const items = Array.from({ length: 25 }, (_, i) => ({ kind: 'task', id: `t${i}`, title: 'x' }))
    const found = await loadPreload({ ok: true, items })
    const result = await found.bridge.askUniLookup({ workspaceId: 'w', kind: 'task', query: '' })
    expect(result.ok && result.items).toHaveLength(20)
    const junk = await loadPreload('junk')
    expect(await junk.bridge.askUniMessages({ conversationId: 'c1' })).toEqual({
      ok: false,
      error: 'error',
    })
    expect(await junk.bridge.askUniRename({ conversationId: 'c1', title: 'x' })).toEqual({
      ok: false,
      error: 'error',
    })
  })
})
