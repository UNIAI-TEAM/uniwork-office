import { afterEach, describe, expect, it, vi } from 'vitest'
import { ASKUNI_CHANNELS, type AskUniBridge } from '../src/shared/askuni-api'

/**
 * UNI-2069 s1: `window.aiOffice.uniworkAskUni` / `uniworkAskUniContext` in the
 * SHELL preload only - each forwards to its channel and a reply of the wrong
 * shape reaches the renderer as an error result, never as data.
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
      invoke: async (channel: string, ...args: unknown[]) => {
        invoked.push({ channel, args })
        return replyValue
      },
      send: () => undefined,
      removeListener: () => undefined,
    },
    webUtils: { getPathForFile: () => '' },
  }))
  await import('../src/preload/index')
  // the preload also asks for other channels at start-up: only Ask UNI's are of interest
  const askUniCalls = () => invoked.filter((call) => call.channel.startsWith('uniwork:askuni:'))
  return { bridge: exposed.aiOffice as AskUniBridge, exposed, invoked: askUniCalls }
}

const REQ = { workspaceId: 'ws_1', question: 'q', locale: 'en' as const }

describe('preload: window.aiOffice Ask UNI bridge', () => {
  afterEach(() => {
    vi.doUnmock('electron')
    vi.resetModules()
  })

  it('forwards the request and the context call to their channels', async () => {
    const ok = {
      ok: true,
      conversationId: 'c1',
      message: { id: 'm1', content: 'a', citations: [] },
    }
    const { bridge, invoked } = await loadPreload(ok)
    expect(await bridge.uniworkAskUni(REQ)).toEqual(ok)
    expect(invoked()).toEqual([{ channel: ASKUNI_CHANNELS.ask, args: [REQ] }])
    const ctx = {
      workspaces: [{ id: 'ws_1', name: 'Team' }],
      currentWorkspaceId: 'ws_1',
      signedIn: true,
    }
    const second = await loadPreload(ctx)
    expect(await second.bridge.uniworkAskUniContext()).toEqual(ctx)
    expect(second.invoked()).toEqual([{ channel: ASKUNI_CHANNELS.context, args: [] }])
  })

  it('keeps the error code and the retry wait of a failed answer', async () => {
    const { bridge } = await loadPreload({ ok: false, code: 'rate_limited', retryAfterSec: 9 })
    expect(await bridge.uniworkAskUni(REQ)).toEqual({
      ok: false,
      code: 'rate_limited',
      retryAfterSec: 9,
    })
  })

  it.each([undefined, null, 'x', 7, {}, { ok: true }, { ok: false, code: 'nope' }])(
    'a malformed answer %j becomes an error result',
    async (reply) => {
      const { bridge } = await loadPreload(reply)
      expect(await bridge.uniworkAskUni(REQ)).toEqual({ ok: false, code: 'error' })
    },
  )

  it('a malformed context becomes a signed-out empty one', async () => {
    const { bridge } = await loadPreload({ workspaces: 'x' })
    expect(await bridge.uniworkAskUniContext()).toEqual({
      workspaces: [],
      currentWorkspaceId: null,
      signedIn: false,
    })
  })

  it('drops citations of an unknown kind or with the wrong field types', async () => {
    const { bridge } = await loadPreload({
      ok: true,
      conversationId: 'c1',
      message: {
        id: 'm1',
        content: 'a',
        citations: [
          { sourceId: 'S1', kind: 'hologram', title: 't', quote: 'q', href: '/x' },
          { sourceId: 'S2', kind: 'task', title: 5, quote: 'q', href: '/x' },
          { sourceId: 'S3', kind: 'task', title: 't', quote: 'q', href: '/x' },
        ],
      },
    })
    const result = await bridge.uniworkAskUni(REQ)
    expect(result.ok && result.message.citations.map((c) => c.sourceId)).toEqual(['S3'])
  })

  it('RB-1: keeps a citation of the additive kind other', async () => {
    const { bridge } = await loadPreload({
      ok: true,
      conversationId: 'c1',
      message: {
        id: 'm1',
        content: 'a',
        citations: [{ sourceId: 'S1', kind: 'other', title: 't', quote: 'q', href: '' }],
      },
    })
    const result = await bridge.uniworkAskUni(REQ)
    expect(result.ok && result.message.citations.map((c) => c.kind)).toEqual(['other'])
  })

  it('RB-5: clamps a huge retryAfterSec to one hour', async () => {
    const { bridge } = await loadPreload({ ok: false, code: 'rate_limited', retryAfterSec: 1e12 })
    expect(await bridge.uniworkAskUni(REQ)).toEqual({
      ok: false,
      code: 'rate_limited',
      retryAfterSec: 3600,
    })
  })

  it('is exposed on the shell preload only', async () => {
    const { readFileSync, readdirSync } = await import('node:fs')
    const { join } = await import('node:path')
    const preloads = join(__dirname, '../../')
    const offenders = readdirSync(preloads, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== 'shell')
      .flatMap((d) => {
        try {
          return readdirSync(join(preloads, d.name, 'src/preload')).map((f) =>
            join(preloads, d.name, 'src/preload', f),
          )
        } catch {
          return []
        }
      })
      .filter(
        (file) => file.endsWith('.ts') && /uniworkAskUni|askuni/i.test(readFileSync(file, 'utf8')),
      )
    expect(offenders).toEqual([])
  })
})
