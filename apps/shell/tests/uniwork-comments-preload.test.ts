/**
 * G8-08 (UNI-1403): every editor preload exposes the same `window.uniworkComments`
 * surface (contract §10: six apps -> IPC `uniwork:comments:*` -> main). The
 * surface forwards each call to its channel and RESOLVES to the main process's
 * `CommentsReply<T>` envelope unchanged: Electron's contextBridge deep-clones
 * every value crossing it and keeps only `message` of a thrown Error (R1-1), so
 * the protocol error is rehydrated in the RENDERER realm by unwrapCommentsReply
 * and never thrown from the preload. It also pulls the held reveal on subscribe
 * (R1-2), drops a pull answer that a newer push superseded (D1-2) or that
 * resolves after the unsubscribe (D1-3), and drops a malformed push.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import { COMMENTS_CHANNELS } from '@genoffice/electron-utils/comments-ipc'
import { unwrapCommentsReply } from '@genoffice/electron-utils/comments-reply'
import { createUniworkComments } from '../src/main/uniwork-docs/comments-wiring'
import { DocsProtocolError } from '../../../web/docs/protocol/types'
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
  'context',
  'onSaved',
] as const

const ORIGIN = 'https://uniwork.example'
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const CMT = '01J8X4CMTN0000000000000001'
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

/**
 * The contextBridge-like boundary (R1-1, VG-1): Electron structured-clones every
 * value an exposed function resolves with and reduces a thrown Error to its
 * message. The mocked contextBridge stores the raw object, so an assertion on it
 * never crosses the boundary that strips those fields; every R1-1 test reads the
 * API through this helper instead - exactly what the renderer receives.
 */
function throughContextBridge(api: Api): Api {
  const clone = (value: unknown): unknown => {
    try {
      return structuredClone(value)
    } catch {
      return value
    }
  }
  const exposed: Record<string, unknown> = {}
  for (const [name, method] of Object.entries(api)) {
    exposed[name] =
      typeof method === 'function'
        ? (...args: unknown[]) =>
            Promise.resolve((method as (...rest: unknown[]) => unknown)(...args)).then(
              (value) => clone(value),
              (error: unknown) => {
                // contextBridge keeps only the message of a thrown Error
                throw new Error(error instanceof Error ? error.message : String(error))
              },
            )
        : method
  }
  return exposed as unknown as Api
}

/** the preload API as the renderer receives it, over the contextBridge clone */
async function rendererApi(): Promise<Api> {
  return throughContextBridge(await preloadApi())
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
    sendReveal: () => 'delivered',
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
  it('the same twelve-method surface per app', async () => {
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

describe('the protocol error survives the contextBridge as an envelope (R1-1)', () => {
  /** the renderer-side unwrap; returns the thrown error so a test can assert on it */
  const unwrapOrThrow = (reply: unknown): unknown => {
    try {
      return unwrapCommentsReply(reply as never)
    } catch (error) {
      return error
    }
  }

  it('a create 409 comment_deleted reaches the renderer as data, and unwrap throws in its realm', async () => {
    const server = createFakeCommentServer()
    server.seed(DOC, [
      { id: 'thread', body: '', kind: 'comment', deleted_at: '2026-10-13T10:00:00Z' },
    ])
    const handlers = mainHandlers(server)
    bridge.reply = structuredClone(
      await handlers.get(COMMENTS_CHANNELS.create)!(
        {},
        {
          path: PATH,
          kind: 'comment',
          parentId: 'thread',
          body: 'draft',
        },
      ),
    )
    const api = await rendererApi()
    const reply = await api.create({
      path: PATH,
      kind: 'comment',
      parentId: 'thread',
      body: 'draft',
    })
    // nothing threw across the bridge: the renderer gets plain data, not an
    // Error that lost its fields
    expect(reply).not.toBeInstanceOf(Error)
    expect(reply).toEqual({
      ok: false,
      error: {
        code: 'conflict',
        message: 'comments: HTTP 409 comment_deleted',
        status: 409,
        retryable: false,
        details: { code: 'comment_deleted' },
      },
    })
    const error = unwrapOrThrow(reply)
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
    'a list %i reaches the renderer as %s (retryable %s)',
    async (status, code, retryable) => {
      const server = createFakeCommentServer()
      server.fail(status)
      const handlers = mainHandlers(server)
      bridge.reply = structuredClone(
        await handlers.get(COMMENTS_CHANNELS.list)!({}, { path: PATH }),
      )
      const api = await rendererApi()
      const reply = await api.list({ path: PATH })
      expect(reply).toEqual({
        ok: false,
        error: { code, message: `comments: HTTP ${status}`, status, retryable },
      })
      const error = unwrapOrThrow(reply)
      expect(error).toBeInstanceOf(DocsProtocolError)
      expect(error).toMatchObject({ code, status, retryable })
    },
  )

  it('a success resolves to { ok: true, value } through the bridge', async () => {
    const server = createFakeCommentServer()
    server.seed(DOC, [{ id: CMT, body: 'hi', kind: 'comment' }])
    const handlers = mainHandlers(server)
    bridge.reply = structuredClone(await handlers.get(COMMENTS_CHANNELS.list)!({}, { path: PATH }))
    const api = await rendererApi()
    const reply = await api.list({ path: PATH })
    expect(reply).toMatchObject({ ok: true })
    const value = unwrapCommentsReply(reply as never) as { comments: unknown[] }
    expect(value.comments).toHaveLength(1)
  })
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

describe('the held reveal pull races with a push (D1-2/D1-3, VG-2)', () => {
  it('a push that supersedes the pending pull drops its older answer (D1-2)', async () => {
    let release!: (reply: unknown) => void
    bridge.invokeImpl = () =>
      new Promise((resolve) => {
        release = resolve
      })
    const api = await preloadApi()
    const heard: unknown[] = []
    api.onReveal((p) => heard.push(p))
    // a newer reveal reaches the subscribed editor while the pull is in flight
    bridge.listeners.get('uniwork:comments:reveal')!(
      {},
      { path: '/w/Plan.docx', commentId: 'c-new' },
    )
    expect(heard).toEqual([{ path: '/w/Plan.docx', commentId: 'c-new' }])
    // the held reveal is the superseded one: it must not be restored on top
    release({ path: '/w/Plan.docx', commentId: 'c-old' })
    await flush()
    expect(heard).toEqual([{ path: '/w/Plan.docx', commentId: 'c-new' }])
  })

  it('a pull that resolves after the unsubscribe delivers nothing (D1-3)', async () => {
    let release!: (reply: unknown) => void
    bridge.invokeImpl = () =>
      new Promise((resolve) => {
        release = resolve
      })
    const api = await preloadApi()
    const heard: unknown[] = []
    const off = api.onReveal((p) => heard.push(p))
    off()
    release({ path: '/w/Plan.docx', commentId: 'c1' })
    await flush()
    expect(heard).toEqual([])
  })
})

describe('context + onSaved (G8-12 §3.1)', () => {
  interface SeamApi {
    context(input: unknown): Promise<unknown>
    onSaved(handler: (payload: unknown) => void): () => void
  }
  const seam = async () => (await preloadApi()) as unknown as SeamApi

  it('context forwards { path } to its channel and resolves the envelope unchanged', async () => {
    bridge.reply = { ok: true, value: { documentId: DOC, versionId: 'v3' } }
    const api = await seam()
    expect(await api.context({ path: PATH })).toEqual({
      ok: true,
      value: { documentId: DOC, versionId: 'v3' },
    })
    expect(bridge.invoked).toEqual([{ channel: COMMENTS_CHANNELS.context, args: [{ path: PATH }] }])
  })

  it('onSaved hands well-formed pushes to the handler and drops malformed ones', async () => {
    const api = await seam()
    const heard: unknown[] = []
    const off = api.onSaved((p) => heard.push(p))
    const push = bridge.listeners.get(COMMENTS_CHANNELS.saved)!
    push({}, { path: PATH, versionId: 'ver_4' })
    push({}, { path: PATH })
    push({}, { path: PATH, versionId: 7 })
    push({}, 'ver_5')
    push({}, null)
    expect(heard).toEqual([{ path: PATH, versionId: 'ver_4' }])
    // subscribing pulls nothing: the saved push is not held
    expect(bridge.invoked).toEqual([])
    off()
    expect(bridge.listeners.has(COMMENTS_CHANNELS.saved)).toBe(false)
  })
})
