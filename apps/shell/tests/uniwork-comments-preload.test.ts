/**
 * G8-08 (UNI-1403): every editor preload exposes the same `window.uniworkComments`
 * surface (contract §10: six apps -> IPC `uniwork:comments:*` -> main). The
 * surface forwards each call to its channel and hands the main process's reveal
 * pushes to the editor, dropping a malformed one.
 */
import { describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  invoked: [] as Array<{ channel: string; args: unknown[] }>,
  listeners: new Map<string, (event: unknown, payload: unknown) => void>(),
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, value: unknown) => void bridge.exposed.set(name, value),
  },
  ipcRenderer: {
    invoke: async (channel: string, ...args: unknown[]) => {
      bridge.invoked.push({ channel, args })
      return undefined
    },
    on: (channel: string, listener: (event: unknown, payload: unknown) => void) =>
      void bridge.listeners.set(channel, listener),
    send: () => undefined,
    removeListener: () => undefined,
  },
  webUtils: { getPathForFile: () => '' },
}))
vi.mock('@genoffice/electron-utils/drop-open', () => ({ installDropOpenBridge: () => undefined }))

const APPS = ['docs', 'sheets', 'slides', 'pdf', 'markdown', 'html'] as const

// static importers: a template-literal specifier does not resolve under vitest
const LOADERS: Record<(typeof APPS)[number], () => Promise<unknown>> = {
  docs: () => import('../../docs/src/preload/index'),
  sheets: () => import('../../sheets/src/preload/index'),
  slides: () => import('../../slides/src/preload/index'),
  pdf: () => import('../../pdf/src/preload/index'),
  markdown: () => import('../../markdown/src/preload/index'),
  html: () => import('../../html/src/preload/index'),
}
const METHODS = [
  'list',
  'create',
  'update',
  'remove',
  'resolve',
  'reopen',
  'revisions',
  'anchors',
  'searchMentions',
  'onReveal',
] as const

describe('every editor preload exposes window.uniworkComments', () => {
  it('the same ten-method surface per app', async () => {
    for (const app of APPS) {
      bridge.exposed.clear()
      vi.resetModules()
      await LOADERS[app]()
      const api = bridge.exposed.get('uniworkComments') as Record<string, unknown> | undefined
      expect(api, `${app} preload exposes uniworkComments`).toBeDefined()
      expect(Object.keys(api!).sort(), app).toEqual([...METHODS].sort())
    }
  })

  it('forwards each call to its uniwork:comments:* channel', async () => {
    bridge.exposed.clear()
    bridge.invoked.length = 0
    vi.resetModules()
    await import('../../docs/src/preload/index')
    const api = bridge.exposed.get('uniworkComments') as {
      list: (i: unknown) => Promise<unknown>
      remove: (i: unknown) => Promise<unknown>
      searchMentions: (i: unknown) => Promise<unknown>
    }
    await api.list({ path: 'p' })
    await api.remove({ path: 'p', commentId: 'c1' })
    await api.searchMentions({ path: 'p', q: 'an' })
    expect(bridge.invoked.map((c) => c.channel)).toEqual([
      'uniwork:comments:list',
      'uniwork:comments:delete',
      'uniwork:comments:search-mentions',
    ])
  })

  it('onReveal delivers a well-formed push and drops a malformed one', async () => {
    bridge.exposed.clear()
    bridge.listeners.clear()
    vi.resetModules()
    await import('../../docs/src/preload/index')
    const api = bridge.exposed.get('uniworkComments') as {
      onReveal: (h: (p: unknown) => void) => () => void
    }
    const heard: unknown[] = []
    const off = api.onReveal((p) => heard.push(p))
    const listener = bridge.listeners.get('uniwork:comments:reveal')!
    listener({}, { path: '/w/Plan.docx', commentId: 'c1' })
    listener({}, { path: '', commentId: 'c1' })
    expect(heard).toEqual([{ path: '/w/Plan.docx', commentId: 'c1' }])
    off()
  })
})
