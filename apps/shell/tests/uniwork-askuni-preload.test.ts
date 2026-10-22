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

  it('s4: uniworkAskUniOpenCitation sends only {kind, href} to its channel', async () => {
    const { bridge, invoked } = await loadPreload({ ok: true })
    const sent = { kind: 'document' as const, href: '/o/w/documents/1' }
    expect(await bridge.uniworkAskUniOpenCitation(sent)).toEqual({ ok: true })
    expect(invoked()).toEqual([{ channel: ASKUNI_CHANNELS.openCitation, args: [sent] }])
    const extra = await loadPreload({ ok: true })
    await extra.bridge.uniworkAskUniOpenCitation({
      kind: 'task',
      href: '/o/w/tasks/2',
      url: 'https://evil.example',
    } as never)
    expect(extra.invoked()).toEqual([
      { channel: ASKUNI_CHANNELS.openCitation, args: [{ kind: 'task', href: '/o/w/tasks/2' }] },
    ])
  })

  it('s4: keeps the error code of a refused open', async () => {
    const { bridge } = await loadPreload({ ok: false, code: 'offline' })
    expect(await bridge.uniworkAskUniOpenCitation({ kind: 'task', href: '/o/w/tasks/2' })).toEqual({
      ok: false,
      code: 'offline',
    })
  })

  it.each([undefined, null, 'x', 7, {}, { ok: 1 }, { ok: false }, { ok: false, code: 'nope' }])(
    's4: a malformed open reply %j becomes an error result',
    async (reply) => {
      const { bridge } = await loadPreload(reply)
      expect(
        await bridge.uniworkAskUniOpenCitation({ kind: 'task', href: '/o/w/tasks/2' }),
      ).toEqual({ ok: false, code: 'error' })
    },
  )

  /**
   * UNI-2076 s8-guard. The shell bridge (window.aiOffice Ask UNI, `uniwork:askuni:*`) is shell-only.
   * Since S7c/S7d the six editor preloads install window.uniworkAskUniDoc (`uniwork:askuni-doc:*`,
   * contract E4) through the shared installer, and nothing else Ask UNI.
   */
  describe('which preloads carry which Ask UNI bridge', () => {
    const EDITORS = ['docs', 'sheets', 'slides', 'pdf', 'markdown', 'html']
    const INSTALL_IMPORT =
      /import\s*\{\s*installUniworkAskUniDocBridge\s*\}\s*from\s*['"]@genoffice\/ai-provider\/askuni['"]\s*;?/g
    const INSTALL_CALL =
      /installUniworkAskUniDocBridge\(\s*\{\s*contextBridge,\s*ipcRenderer\s*\}\s*\)\s*;?/g

    async function preloadsOutsideShell() {
      const { readFileSync, readdirSync } = await import('node:fs')
      const { join } = await import('node:path')
      const apps = join(__dirname, '../../')
      return readdirSync(apps, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== 'shell')
        .flatMap((d) => {
          try {
            return readdirSync(join(apps, d.name, 'src/preload'))
              .filter((f) => f.endsWith('.ts'))
              .map((f) => ({
                app: d.name,
                file: `${d.name}/src/preload/${f}`,
                text: readFileSync(join(apps, d.name, 'src/preload', f), 'utf8'),
              }))
          } catch {
            return []
          }
        })
    }
    const withoutComments = (text: string) =>
      text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

    it('no editor preload carries the shell bridge or anything Ask UNI beyond the doc installer', async () => {
      const offenders = (await preloadsOutsideShell())
        .filter((p) => {
          const rest = withoutComments(p.text).replace(INSTALL_IMPORT, '').replace(INSTALL_CALL, '')
          return /uniworkAskUni|askuni/i.test(rest)
        })
        .map((p) => p.file)
      expect(offenders).toEqual([])
    })

    it('each of the six editor preloads installs the doc bridge exactly once, through the shared installer', async () => {
      const preloads = await preloadsOutsideShell()
      for (const app of EDITORS) {
        const index = preloads.find((p) => p.file === `${app}/src/preload/index.ts`)
        expect(index, app).toBeDefined()
        const code = withoutComments(index!.text)
        expect(code.match(INSTALL_IMPORT), `${app}: import`).toHaveLength(1)
        expect(code.match(INSTALL_CALL), `${app}: call`).toHaveLength(1)
      }
      // and no other app preload installs it
      const installers = preloads
        .filter((p) => /installUniworkAskUniDocBridge/.test(withoutComments(p.text)))
        .map((p) => p.app)
      expect(installers.sort()).toEqual([...EDITORS].sort())
    })

    it('the shell preload exposes the shell bridge and never the editor doc bridge', async () => {
      const { readFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      const shell = withoutComments(
        readFileSync(join(__dirname, '../src/preload/index.ts'), 'utf8'),
      )
      expect(shell).toContain('ASKUNI_CHANNELS.ask')
      expect(shell).not.toMatch(
        /installUniworkAskUniDocBridge|ASKUNI_DOC_CHANNELS|askuni-doc|uniworkAskUniDoc/i,
      )
    })
  })
})
