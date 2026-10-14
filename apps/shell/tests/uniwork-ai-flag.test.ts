// The availability flag travels main -> preload bridge -> renderer (G6-05 S2 gap 2): main answers a
// pull and broadcasts every change to all webContents; each editor preload exposes
// window.uniworkAiFlag; the renderer mirrors it into its own AI_PROVIDERS.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AI_PROVIDERS, setUniworkAiAvailable } from '@genoffice/ai-provider'
import { mirrorUniworkAiFlag } from '@genoffice/ai-provider/browser'
import {
  UNIWORK_AI_FLAG_BRIDGE_KEY,
  UNIWORK_AI_FLAG_CHANGED,
  UNIWORK_AI_FLAG_GET,
  parseUniworkAiFlag,
} from '@genoffice/electron-utils/uniwork-ai-flag'
import { createUniworkAiFlagBridge } from '@genoffice/electron-utils/uniwork-ai-flag-bridge'
import { broadcastUniworkAiFlag, registerUniworkAiFlagIpc } from '../src/main/uniwork-ai-flag'

const listed = () => AI_PROVIDERS.some((m) => m.id === 'uniwork')
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** main + one renderer wired through a fake ipc: the preload bridge on one side, the handlers on the other */
function wire(initial: boolean) {
  let flag = initial
  const handlers = new Map<string, () => unknown>()
  const listeners = new Set<(event: unknown, payload: unknown) => void>()
  registerUniworkAiFlagIpc({ handle: (channel, fn) => handlers.set(channel, fn) }, () => flag)
  const bridge = createUniworkAiFlagBridge({
    invoke: async (channel) => handlers.get(channel)?.(),
    on: (channel, listener) => {
      if (channel === UNIWORK_AI_FLAG_CHANGED) listeners.add(listener)
    },
    off: (channel, listener) => {
      if (channel === UNIWORK_AI_FLAG_CHANGED) listeners.delete(listener)
    },
  })
  const wc = {
    isDestroyed: () => false,
    send: (channel: string, payload: unknown) =>
      channel === UNIWORK_AI_FLAG_CHANGED && listeners.forEach((l) => l({}, payload)),
  }
  return {
    bridge,
    change(next: boolean) {
      flag = next
      broadcastUniworkAiFlag(next, [wc as never])
    },
  }
}

describe('UniWork AI availability flag in the renderer', () => {
  afterEach(() => setUniworkAiAvailable(false))

  it('flag true -> the uniwork entry is in the renderer list', async () => {
    const { bridge } = wire(true)
    mirrorUniworkAiFlag(bridge)
    await settle()
    expect(listed()).toBe(true)
  })

  it('flag false -> the entry is absent; a later main-side change adds then removes it', async () => {
    const { bridge, change } = wire(false)
    mirrorUniworkAiFlag(bridge)
    await settle()
    expect(listed()).toBe(false)
    change(true)
    expect(listed()).toBe(true)
    change(false)
    expect(listed()).toBe(false)
  })

  it('broadcast skips a destroyed webContents and reaches every other one', () => {
    const sent: unknown[] = []
    broadcastUniworkAiFlag(true, [
      { isDestroyed: () => true, send: () => sent.push('destroyed') },
      { isDestroyed: () => false, send: (c: string, p: unknown) => sent.push([c, p]) },
    ] as never)
    expect(sent).toEqual([[UNIWORK_AI_FLAG_CHANGED, true]])
  })

  it('the pull channel answers a boolean; the parser rejects anything else', () => {
    expect(parseUniworkAiFlag(true)).toBe(true)
    expect(parseUniworkAiFlag(false)).toBe(false)
    for (const bad of ['true', 1, null, undefined, {}]) expect(parseUniworkAiFlag(bad)).toBe(false)
    expect(UNIWORK_AI_FLAG_GET).toMatch(/uniwork/)
    expect(UNIWORK_AI_FLAG_BRIDGE_KEY).toBe('uniworkAiFlag')
  })

  it('every editor preload and the shell preload install the bridge', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const root = resolve(__dirname, '../..')
    for (const app of ['docs', 'sheets', 'slides', 'pdf', 'markdown', 'html', 'shell']) {
      const src = readFileSync(resolve(root, app, 'src/preload/index.ts'), 'utf8')
      expect(src, `${app} preload`).toContain('installUniworkAiFlagBridge()')
      const main = readFileSync(
        resolve(root, app, app === 'shell' ? 'src/renderer/src/main.tsx' : 'src/renderer/main.tsx'),
        'utf8',
      )
      expect(main, `${app} renderer`).toContain('mirrorUniworkAiFlag()')
    }
    void vi
  })
})
