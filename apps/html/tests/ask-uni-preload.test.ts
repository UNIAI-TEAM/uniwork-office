/**
 * UNI-2076 S7d (html preload): the shared installUniworkAskUniDocBridge runs once and exposes only
 * window.uniworkAskUniDoc (the seven contract methods); the renderer's request reaches
 * uniwork:askuni-doc:stream with the question fields only.
 */
import { describe, expect, it, vi } from 'vitest'
import { ASKUNI_DOC_BRIDGE_KEY, ASKUNI_DOC_CHANNELS } from '@genoffice/ai-provider/askuni'

const capture = vi.hoisted(() => ({
  exposed: [] as Array<{ key: string; api: unknown }>,
  invoked: [] as Array<{ channel: string; args: unknown[] }>,
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, api: unknown) => capture.exposed.push({ key, api }),
  },
  ipcRenderer: {
    invoke: async (channel: string, ...args: unknown[]) => {
      capture.invoked.push({ channel, args })
      return { ok: true, requestId: 'r1' }
    },
    on: () => undefined,
    once: () => undefined,
    send: () => undefined,
    sendSync: () => undefined,
    removeListener: () => undefined,
    removeAllListeners: () => undefined,
  },
  webUtils: { getPathForFile: () => '' },
}))

describe('html preload Ask UNI editor bridge', () => {
  it('installs window.uniworkAskUniDoc once, with the contract methods only', async () => {
    await import('../src/preload/index')
    const mine = capture.exposed.filter((e) => e.key === ASKUNI_DOC_BRIDGE_KEY)
    expect(mine).toHaveLength(1)
    expect(Object.keys(mine[0]!.api as object).sort()).toEqual(
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
    // nothing else of the Ask UNI family leaks next to it (no shell channels, no workspace API)
    expect(capture.exposed.filter((e) => /askuni/i.test(e.key)).map((e) => e.key)).toEqual([
      ASKUNI_DOC_BRIDGE_KEY,
    ])
  })

  it('sends only the question fields to the editor channel', async () => {
    await import('../src/preload/index')
    const api = capture.exposed.find((e) => e.key === ASKUNI_DOC_BRIDGE_KEY)!.api as {
      askUniDocStream(req: unknown): Promise<unknown>
    }
    await api.askUniDocStream({
      question: 'q',
      workspaceId: 'w1',
      focus: { kind: 'document', id: 'd1' },
    })
    const call = capture.invoked.find((c) => c.channel === ASKUNI_DOC_CHANNELS.stream)!
    expect(call.args).toEqual([{ question: 'q' }])
  })
})
