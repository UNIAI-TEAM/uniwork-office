/**
 * @vitest-environment jsdom
 */
/**
 * UNI-1993 (UW-SOURCE-RO) slice C1: the preload bridge of the source view. The
 * renderer dereferences the open result and the chip state directly, so a reply
 * of the wrong shape becomes an error result / null before it gets there, and the
 * hint push is validated like the other main -> renderer pushes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SOURCE_VIEW_CHANNELS } from '../src/shared/source-view'

interface SourceBridge {
  uniworkOpenSource(input: unknown): Promise<unknown>
  uniworkSourceViewState(path: string): Promise<unknown>
  onUniworkSourceViewHint(cb: (payload: { path: string }) => void): () => void
}

async function loadBridge(reply: unknown) {
  vi.resetModules()
  const handlers = new Map<string, (event: unknown, raw: unknown) => void>()
  const invoked: Array<{ channel: string; args: unknown[] }> = []
  const exposed: Record<string, unknown> = {}
  vi.doMock('electron', () => ({
    contextBridge: {
      exposeInMainWorld: (key: string, value: unknown) => void (exposed[key] = value),
    },
    ipcRenderer: {
      on: (channel: string, cb: (event: unknown, raw: unknown) => void) => {
        handlers.set(channel, cb)
      },
      invoke: async (channel: string, ...args: unknown[]) => {
        invoked.push({ channel, args })
        return reply
      },
      send: () => undefined,
      removeListener: (channel: string, cb: unknown) => {
        if (handlers.get(channel) === cb) handlers.delete(channel)
      },
    },
    webUtils: { getPathForFile: () => '' },
  }))
  await import('../src/preload/index')
  return { bridge: exposed.aiOffice as unknown as SourceBridge, invoked, handlers }
}

afterEach(() => {
  vi.doUnmock('electron')
  vi.resetModules()
})

describe('uniworkOpenSource', () => {
  it('invokes the open-source channel with the input and passes a well-formed result through', async () => {
    const reply = { ok: true, value: { path: '/x/a.docx', reused: false } }
    const { bridge, invoked } = await loadBridge(reply)
    const input = { workspaceId: 'ws_1', sourceId: 'chat:m1' }
    expect(await bridge.uniworkOpenSource(input)).toEqual(reply)
    expect(invoked).toEqual([{ channel: SOURCE_VIEW_CHANNELS.openSource, args: [input] }])
    const failed = await loadBridge({ ok: false, error: 'not_found' })
    expect(await failed.bridge.uniworkOpenSource({})).toEqual({ ok: false, error: 'not_found' })
  })

  it('turns a reply of the wrong shape into an error result the renderer can map', async () => {
    for (const bad of [
      undefined,
      null,
      'x',
      7,
      {},
      { ok: true },
      { ok: true, value: {} },
      { ok: true, value: { path: 5, reused: false } },
      { ok: false },
      { ok: false, error: 7 },
    ]) {
      const { bridge } = await loadBridge(bad)
      expect(await bridge.uniworkOpenSource({})).toEqual({ ok: false, error: 'server_error' })
    }
  })
})

describe('uniworkSourceViewState', () => {
  it('invokes the state channel with the path and returns the chip state', async () => {
    const state = { name: 'Plan.docx', origin: 'chat', parentTitle: 'Launch' }
    const { bridge, invoked } = await loadBridge(state)
    expect(await bridge.uniworkSourceViewState('/x/a.docx')).toEqual(state)
    expect(invoked).toEqual([
      { channel: SOURCE_VIEW_CHANNELS.sourceViewState, args: ['/x/a.docx'] },
    ])
  })

  it('answers null for null and for anything that is not a state (an unknown origin string is fine)', async () => {
    for (const bad of [
      undefined,
      null,
      'x',
      3,
      {},
      { name: 'a' },
      { name: 1, origin: 'chat', parentTitle: '' },
    ]) {
      const { bridge } = await loadBridge(bad)
      expect(await bridge.uniworkSourceViewState('/x/a.docx')).toBeNull()
    }
    const other = { name: 'a.docx', origin: 'doc', parentTitle: '' }
    const { bridge } = await loadBridge(other)
    expect(await bridge.uniworkSourceViewState('/x/a.docx')).toEqual(other)
  })
})

describe('onUniworkSourceViewHint', () => {
  it('delivers { path } for a push on the hint channel and unsubscribes', async () => {
    const { bridge, handlers } = await loadBridge(null)
    const seen: Array<{ path: string }> = []
    const off = bridge.onUniworkSourceViewHint((payload) => seen.push(payload))
    const push = handlers.get(SOURCE_VIEW_CHANNELS.hint)
    expect(push).toBeTypeOf('function')
    push?.({}, { path: '/x/a.docx', extra: 'dropped' })
    expect(seen).toEqual([{ path: '/x/a.docx' }])
    off()
    expect(handlers.has(SOURCE_VIEW_CHANNELS.hint)).toBe(false)
  })

  it('drops a push without a usable path', async () => {
    const { bridge, handlers } = await loadBridge(null)
    const seen: unknown[] = []
    bridge.onUniworkSourceViewHint((payload) => seen.push(payload))
    for (const bad of [undefined, null, 'x', {}, { path: '' }, { path: 5 }]) {
      handlers.get(SOURCE_VIEW_CHANNELS.hint)?.({}, bad)
    }
    expect(seen).toEqual([])
  })
})
