/**
 * G8-08 (UNI-1403): every editor preload exposes the same `window.uniworkComments`
 * surface (contract §10: six apps -> IPC `uniwork:comments:*` -> main). The
 * surface forwards each call to its channel, unwraps the main process's reply
 * envelope back into a `DocsProtocolError` (R1-1: a protocol error thrown across
 * Electron would keep only its message), pulls the held reveal on subscribe
 * (R1-2) and hands the main process's reveal pushes to the editor, dropping a
 * malformed one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import { COMMENTS_CHANNELS } from '@genoffice/electron-utils/comments-ipc'
import { createUniworkComments } from '../src/main/uniwork-docs/comments-wiring'
import { createFakeCommentServer } from './fixtures/comments-fake-server'

const bridge = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  invoked: [] as Array<{ channel: string; args: unknown[] }>,
  listeners: new Map<string, (event: unknown, payload: unknown) => void>(),
  /** what every invoke resolves with; a test may swap invokeImpl for a deferred one */
  reply: undefined as unknown,
  invokeImpl: undefined as undefined | ((channel: string, args: unknown[]) => Promise<unknown>),
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, value: unknown) => void bridge.exposed.set(name, value),
  },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      bridge.invoked.push({ channel, args })
      return bridge.invokeImpl ? bridge.invokeImpl(channel, args) : Promise.resolve(bridge.reply)
    },
    on: (channel: string, listener: (event: unknown, payload: unknown) => void) =>
      void bridge.listeners.set(channel, listener),
    send: () => undefined,
    removeListener: (channel: string, listener: (event: unknown, payload: unknown) => void) => {
      if (bridge.listeners.get(channel) === listener) bridge.listeners.delete(channel)
    },
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

const ORIGIN = 'https://uniwork.example'
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const PATH = '/home/u/UniWork/Plan.docx'

interface Api {
  list(input: unknown): Promise<unknown>
  create(input: unknown): Promise<unknown>
  remove(input: unknown): Promise<unknown>
  searchMentions(input: unknown): Promise<unknown>
  onReveal(handler: (payload: unknown) => void): () => void
}

/** the editor preload under test (the docs one; all six share the bridge) */
async function preloadApi(): Promise<Api> {
  bridge.exposed.clear()
  vi.resetModules()
  await import('../../docs/src/preload/index')
  return bridge.exposed.get('uniworkComments') as Api
}

/** the main-process handlers, over the same fake server the main tests use */
function mainHandlers(server: ReturnType<typeof createFakeCommentServer>) {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
  const ipcMain = {
    handle: (channel: string, fn: (event: unknown, payload: unknown) => Promise<unknown>) => {
      handlers.set(channel, fn)
    },
  } as unknown as IpcMain
  createUniworkComments(ipcMain, {
    service: {
      recentSource: (path: string) =>
        path === PATH
          ? { documentId: DOC, workspaceId: 'ws-1', title: 'Plan', access: 'edit' as const }
          : null,
    } as unknown as Parameters<typeof createUniworkComments>[1]['service'],
    profile: () => ({ apiOrigin: ORIGIN }),
    authorized: <T>(call: (token: string) => Promise<T>) => call('tok'),
    isSignedIn: () => true,
    fetch: server.fetch,
    sendReveal: () => undefined,
  })
  return handlers
}

const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  bridge.exposed.clear()
  bridge.invoked.length = 0
  bridge.listeners.clear()
  bridge.reply = { ok: true, value: undefined }
  bridge.invokeImpl = undefined
})

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
    const api = await preloadApi()
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
    const api = await preloadApi()
    const heard: unknown[] = []
    const off = api.onReveal((p) => heard.push(p))
    const listener = bridge.listeners.get('uniwork:comments:reveal')!
    listener({}, { path: '/w/Plan.docx', commentId: 'c1' })
    listener({}, { path: '', commentId: 'c1' })
    await flush()
    expect(heard).toEqual([{ path: '/w/Plan.docx', commentId: 'c1' }])
    off()
  })
})

describe('protocol errors are rehydrated across the IPC boundary (R1-1)', () => {
  it('a create 409 comment_deleted reaches the handler as a DocsProtocolError', async () => {
    const server = createFakeCommentServer()
    server.seed(DOC, [
      { id: 'thread', body: '', kind: 'comment', deleted_at: '2026-10-13T10:00:00Z' },
    ])
    const handlers = mainHandlers(server)
    const reply = await handlers.get(COMMENTS_CHANNELS.create)!(
      {},
      {
        path: PATH,
        kind: 'comment',
        parentId: 'thread',
        body: 'draft',
      },
    )
    // only structured data crosses Electron's IPC boundary: clone the handler's result
    bridge.reply = structuredClone(reply)
    const api = await preloadApi()
    const error = await api
      .create({ path: PATH, kind: 'comment', parentId: 'thread', body: 'draft' })
      .catch((e: unknown) => e)
    // resetModules gives the preload a fresh module graph; importing the same
    // way proves it throws the very class the frame uses, not a look-alike
    const { DocsProtocolError } = await import('../../../web/docs/protocol/types')
    expect(error).toBeInstanceOf(DocsProtocolError)
    expect(error).toMatchObject({
      name: 'DocsProtocolError',
      code: 'conflict',
      status: 409,
      retryable: false,
      details: { code: 'comment_deleted' },
    })
  })

  it.each([
    [401, 'unauthorized', false],
    [404, 'not_found', false],
    [500, 'internal', true],
  ] as const)(
    'a list %i reaches the handler as %s (retryable %s)',
    async (status, code, retryable) => {
      const server = createFakeCommentServer()
      server.fail(status)
      const handlers = mainHandlers(server)
      bridge.reply = structuredClone(
        await handlers.get(COMMENTS_CHANNELS.list)!({}, { path: PATH }),
      )
      const api = await preloadApi()
      const error = await api.list({ path: PATH }).catch((e: unknown) => e)
      const { DocsProtocolError } = await import('../../../web/docs/protocol/types')
      expect(error).toBeInstanceOf(DocsProtocolError)
      expect(error).toMatchObject({ code, status, retryable })
    },
  )
})

describe('onReveal pulls a reveal held before the editor subscribed (R1-2)', () => {
  it('delivers the held reveal once, then keeps listening for pushes', async () => {
    bridge.reply = { path: '/w/Plan.docx', commentId: 'c-old' }
    const api = await preloadApi()
    const heard: unknown[] = []
    const off = api.onReveal((p) => heard.push(p))
    await flush()
    expect(heard).toEqual([{ path: '/w/Plan.docx', commentId: 'c-old' }])
    bridge.listeners.get('uniwork:comments:reveal')!(
      {},
      { path: '/w/Plan.docx', commentId: 'c-new' },
    )
    expect(heard).toEqual([
      { path: '/w/Plan.docx', commentId: 'c-old' },
      { path: '/w/Plan.docx', commentId: 'c-new' },
    ])
    off()
  })

  it('asks for the pending reveal on the pending channel and drops a malformed answer', async () => {
    bridge.reply = { path: '', commentId: 'c1' }
    const api = await preloadApi()
    const heard: unknown[] = []
    api.onReveal((p) => heard.push(p))
    await flush()
    expect(heard).toEqual([])
    expect(bridge.invoked.map((c) => c.channel)).toEqual(['uniwork:comments:reveal:pending'])
  })

  it('a push that lands while the pull is in flight is not replayed twice', async () => {
    let release!: (reply: unknown) => void
    bridge.invokeImpl = () =>
      new Promise((resolve) => {
        release = resolve
      })
    const api = await preloadApi()
    const heard: unknown[] = []
    api.onReveal((p) => heard.push(p))
    bridge.listeners.get('uniwork:comments:reveal')!({}, { path: '/w/Plan.docx', commentId: 'c1' })
    expect(heard).toHaveLength(1)
    release({ path: '/w/Plan.docx', commentId: 'c1' })
    await flush()
    expect(heard).toHaveLength(1)
  })
})
