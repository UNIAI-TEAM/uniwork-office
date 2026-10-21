/**
 * G8-08 (UNI-1403): the desktop main-side comments client and its IPC. Every
 * call here runs against the in-memory FAKE server (fixtures/comments-fake-
 * server.ts), never a real server: the G8-03/G8-06 routes are not merged yet.
 * The transport maps every non-ok answer through `mapCommentsError`, which adds
 * a 405 -> `unsupported` branch and otherwise delegates to the protocol's shared
 * `commentsErrorFromHttp`, so a 409 comment_deleted reads as a `conflict`
 * carrying details.code and is never retryable (no reload path).
 */
import { describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import {
  createUniworkComments,
  resolveCommentBinding,
} from '../src/main/uniwork-docs/comments-wiring'
import {
  createUniworkCommentsClient,
  parseCommentsAnchors,
  parseCommentsRevisions,
} from '../src/main/uniwork-docs/comments'
import { COMMENTS_CHANNELS } from '@genoffice/electron-utils/comments-ipc'
import { createFakeCommentServer } from './fixtures/comments-fake-server'

const ORIGIN = 'https://uniwork.example'
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const PATH = '/home/u/UniWork/Plan.docx'
const CMT = '01J8X4CMTN0000000000000001'

function client(fetch: ReturnType<typeof createFakeCommentServer>['fetch']) {
  return createUniworkCommentsClient({
    apiOrigin: ORIGIN,
    authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
    isSignedIn: () => true,
    fetch,
    idempotencyKey: () => 'key-1',
  })
}

const binding = { documentId: DOC, workspaceId: 'ws-1', orgId: 'org-1', access: 'edit' as const }

async function shapeOf(promise: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await promise
    return { resolved: true }
  } catch (error) {
    const e = error as {
      name?: string
      code?: string
      status?: number
      retryable?: boolean
      details?: unknown
    }
    return {
      name: e.name,
      code: e.code,
      status: e.status,
      retryable: e.retryable,
      details: e.details,
    }
  }
}

describe('the comments client routes every call to the contract §2 path', () => {
  it('list carries kind and since_token; unchanged is returned as-is', async () => {
    const server = createFakeCommentServer()
    server.seed(DOC, [{ id: CMT, body: 'hi', kind: 'comment' }])
    const api = client(server.fetch)
    const first = await api.list(binding, { kind: 'comment' })
    expect(first.unchanged).toBe(false)
    expect(first.comments[0]?.id).toBe(CMT)
    const again = await api.list(binding, { sinceToken: first.list_token })
    expect(again).toEqual({
      comments: [],
      mentions: [],
      list_token: first.list_token,
      unchanged: true,
    })
    expect(server.calls[0]?.url).toContain(`/api/v1/documents/${DOC}/comments?kind=comment`)
    expect(server.calls[1]?.url).toContain(`since_token=${encodeURIComponent(first.list_token)}`)
  })

  it('create sends one Idempotency-Key and the snake_case body', async () => {
    const server = createFakeCommentServer()
    const api = client(server.fetch)
    const created = await api.create(binding, {
      kind: 'discussion',
      body: 'hello',
      parentId: undefined,
    })
    expect(created.comment.body).toBe('hello')
    expect(server.lastCall()?.idempotencyKey).toBe('key-1')
    expect(server.lastCall()?.body).toEqual({ kind: 'discussion', body: 'hello' })
  })

  it('update/remove/resolve/reopen/revisions/searchMentions hit their routes', async () => {
    const server = createFakeCommentServer()
    server.seed(DOC, [{ id: CMT, body: 'hi', kind: 'comment' }])
    const api = client(server.fetch)
    expect((await api.update(binding, CMT, 'new')).comment.body).toBe('new')
    expect((await api.resolve(binding, CMT)).comment.resolved_at).not.toBeNull()
    expect((await api.reopen(binding, CMT)).comment.resolved_at).toBeNull()
    expect((await api.revisions(binding, CMT)).revisions.length).toBe(1)
    expect(
      (await api.searchMentions(binding, { path: PATH, q: 'an' })).candidates[0]?.user_id,
    ).toBeTruthy()
    expect(server.calls.map((c) => c.method)).toEqual(['PATCH', 'POST', 'DELETE', 'GET', 'GET'])
  })

  it('anchors on the route G8-04 has not merged (405) reads `unsupported`, never `internal`', async () => {
    const server = createFakeCommentServer()
    server.seed(DOC, [{ id: CMT, body: 'hi', kind: 'comment' }])
    const api = client(server.fetch)
    const out = await shapeOf(
      api.anchors(binding, {
        path: PATH,
        versionId: 'v1',
        anchors: [{ commentId: CMT, anchor: { format: 'docx', v: 1 }, state: 'exact' }],
      }),
    )
    // the client still sends the real route once; it just never crashes and
    // never invents an anchors route of its own
    expect(server.lastCall()?.method).toBe('PUT')
    expect(server.lastCall()?.url).toContain(`/api/v1/documents/${DOC}/comments/anchors`)
    expect(out).toMatchObject({
      name: 'DocsProtocolError',
      code: 'unsupported',
      status: 405,
      retryable: false,
    })
  })

  it('a hard-deleted thread disappears on the next full list', async () => {
    const server = createFakeCommentServer()
    server.seed(DOC, [{ id: CMT, body: 'solo' }])
    const api = client(server.fetch)
    const first = await api.list(binding, {})
    expect(first.comments).toHaveLength(1)
    await api.remove(binding, CMT)
    const next = await api.list(binding, { sinceToken: first.list_token })
    expect(next.unchanged).toBe(false)
    expect(next.comments).toHaveLength(0)
  })
})

describe('the §9 error table, through the fake server', () => {
  it.each([
    [401, 'unauthorized', false],
    [403, 'forbidden', false],
    [404, 'not_found', false],
    [500, 'internal', true],
    [503, 'internal', true],
  ] as const)('%i -> %s (retryable %s)', async (status, code, retryable) => {
    const server = createFakeCommentServer()
    server.fail(status)
    const api = client(server.fetch)
    expect(await shapeOf(api.list(binding, {}))).toMatchObject({
      name: 'DocsProtocolError',
      code,
      status,
      retryable,
    })
  })

  it('409 comment_deleted -> conflict + details.code, not retryable (no reload)', async () => {
    const server = createFakeCommentServer()
    server.seed(DOC, [{ id: CMT, body: '', deleted_at: '2026-10-13T10:00:00Z' }])
    const api = client(server.fetch)
    const out = await shapeOf(api.update(binding, CMT, 'draft'))
    expect(out).toMatchObject({
      name: 'DocsProtocolError',
      code: 'conflict',
      status: 409,
      retryable: false,
      details: { code: 'comment_deleted' },
    })
  })

  it('400 anchor_version_invalid -> malformed + details.code', async () => {
    const server = createFakeCommentServer()
    server.seed(DOC, [{ id: CMT, body: 'x', kind: 'comment' }])
    server.fail(400, { error: { code: 'anchor_version_invalid' } }, { method: 'PUT' })
    const api = client(server.fetch)
    const out = await shapeOf(
      api.anchors(binding, {
        path: PATH,
        versionId: 'v1',
        anchors: [{ commentId: CMT, anchor: { format: 'docx', v: 1 }, state: 'exact' }],
      }),
    )
    expect(out).toMatchObject({
      code: 'malformed',
      status: 400,
      retryable: false,
      details: { code: 'anchor_version_invalid' },
    })
  })

  it('an unreachable server reads network (never internal)', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const api = client(fetch)
    expect(await shapeOf(api.list(binding, {}))).toMatchObject({ code: 'network', retryable: true })
  })

  it('a deadline abort during the body read reads network, retryable (D2-4)', async () => {
    const fetch = async (_url: string, init: RequestInit): Promise<Response> =>
      ({
        status: 200,
        ok: true,
        redirected: false,
        json: () =>
          new Promise((_resolve, reject) => {
            const signal = init.signal
            const abort = () => {
              const error = new Error('aborted')
              error.name = 'AbortError'
              reject(error)
            }
            if (signal?.aborted) abort()
            else signal?.addEventListener('abort', abort)
          }),
      }) as unknown as Response
    const api = createUniworkCommentsClient({
      apiOrigin: ORIGIN,
      authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
      isSignedIn: () => true,
      timeoutMs: 20,
      fetch,
    })
    // the 30 s deadline aborts while the 200 body is still being read: the
    // server never delivered it, so the editor must get §9's network + retry
    expect(await shapeOf(api.list(binding, {}))).toMatchObject({
      name: 'DocsProtocolError',
      code: 'network',
      retryable: true,
    })
  })

  it('a bad JSON body stays malformed, not retryable', async () => {
    const fetch = async (): Promise<Response> =>
      ({
        status: 200,
        ok: true,
        redirected: false,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0')
        },
      }) as unknown as Response
    const api = createUniworkCommentsClient({
      apiOrigin: ORIGIN,
      authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
      isSignedIn: () => true,
      fetch,
    })
    expect(await shapeOf(api.list(binding, {}))).toMatchObject({
      name: 'DocsProtocolError',
      code: 'malformed',
      retryable: false,
    })
  })

  it('a signed-out session reads unauthorized, no request made', async () => {
    const server = createFakeCommentServer()
    const api = createUniworkCommentsClient({
      apiOrigin: ORIGIN,
      authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
      isSignedIn: () => false,
      fetch: server.fetch,
    })
    expect(await shapeOf(api.list(binding, {}))).toMatchObject({
      code: 'unauthorized',
      status: 401,
    })
    expect(server.calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------- IPC + binding

function fakeIpc(): {
  ipcMain: IpcMain
  handlers: Map<string, (event: unknown, payload: unknown) => Promise<unknown>>
} {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
  const ipcMain = {
    handle: (channel: string, fn: (event: unknown, payload: unknown) => Promise<unknown>) => {
      handlers.set(channel, fn)
    },
  } as unknown as IpcMain
  return { ipcMain, handlers }
}

function serviceFor(bound: boolean) {
  return {
    recentSource: (path: string) =>
      bound && path === PATH
        ? { documentId: DOC, workspaceId: 'ws-1', title: 'Plan', access: 'edit' as const }
        : null,
  } as unknown as Parameters<typeof createUniworkComments>[1]['service']
}

/**
 * The revealPending sender is the editor webContents: `shownPath` reads its id
 * and the handler watches its realm events (D2-2); these tests pull from a
 * realm that never reloads, so a no-op emitter is enough.
 */
function editorSender(id: number) {
  const noop = () => undefined
  return { id, on: noop, removeListener: noop }
}

type RevealOutcome = 'delivered' | 'deferred' | 'none'

/** mount the wiring over a fake server; returns the handler map and the reveal spy */
function mount(
  options: {
    server?: ReturnType<typeof createFakeCommentServer>
    bound?: boolean
    /** the path the invoking editor window shows (R1-2 pull scope) */
    shownPath?: (sender: { id: number }) => string | null
    /** what the push reports back (D1-1/D1-4); default: handed to a live editor */
    sendReveal?: (
      payload: { path: string; commentId: string },
      stillWanted: () => boolean,
    ) => RevealOutcome
  } = {},
) {
  const { ipcMain, handlers } = fakeIpc()
  const server = options.server ?? createFakeCommentServer()
  const reveals: Array<{ path: string; commentId: string }> = []
  const handle = createUniworkComments(ipcMain, {
    service: serviceFor(options.bound ?? true),
    profile: () => ({ apiOrigin: ORIGIN }),
    authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
    isSignedIn: () => true,
    fetch: server.fetch,
    sendReveal:
      options.sendReveal ??
      ((payload) => {
        reveals.push(payload)
        return 'delivered'
      }),
    ...(options.shownPath ? { shownPath: options.shownPath } : {}),
  })
  return { handle, handlers, server, reveals }
}

type Handler = (event: unknown, payload: unknown) => Promise<unknown>

describe('the comments IPC wiring (unbound -> zero requests)', () => {
  it('an unbound document makes no request and answers the not_found reply', async () => {
    const { handlers, server } = mount({ bound: false })
    expect(
      await handlers.get(COMMENTS_CHANNELS.list)!({}, { path: '/home/u/Desktop/copy.docx' }),
    ).toEqual({
      ok: false,
      error: {
        code: 'not_found',
        message: 'comments: document is not bound to UniWork',
        retryable: false,
      },
    })
    expect(server.calls).toHaveLength(0)
  })

  it('a bound document answers { ok: true, value }', async () => {
    const server = createFakeCommentServer()
    server.seed(DOC, [{ id: CMT, body: 'hi', kind: 'comment' }])
    const { handlers } = mount({ server })
    const reply = (await handlers.get(COMMENTS_CHANNELS.list)!({}, { path: PATH })) as {
      ok: boolean
      value: { comments: unknown[] }
    }
    expect(reply.ok).toBe(true)
    expect(reply.value.comments).toHaveLength(1)
    expect(server.calls).toHaveLength(1)
  })

  it('a malformed payload is refused before any request', async () => {
    const { handlers, server } = mount()
    expect(await handlers.get(COMMENTS_CHANNELS.create)!({}, { path: PATH, body: 'x' })).toEqual({
      ok: false,
      error: { code: 'malformed', message: 'comments: invalid request', retryable: false },
    })
    expect(server.calls).toHaveLength(0)
  })

  it('registers one handler per frame request kind plus the pending-reveal pull', () => {
    const { handlers } = mount()
    expect([...handlers.keys()].sort()).toEqual(
      [
        COMMENTS_CHANNELS.list,
        COMMENTS_CHANNELS.create,
        COMMENTS_CHANNELS.update,
        COMMENTS_CHANNELS.remove,
        COMMENTS_CHANNELS.resolve,
        COMMENTS_CHANNELS.reopen,
        COMMENTS_CHANNELS.revisions,
        COMMENTS_CHANNELS.anchors,
        COMMENTS_CHANNELS.searchMentions,
        COMMENTS_CHANNELS.revealPending,
        COMMENTS_CHANNELS.context,
        COMMENTS_CHANNELS.openVersion,
      ].sort(),
    )
  })

  it('reveal pushes only for a bound path', () => {
    const { handle, reveals } = mount()
    handle.reveal(PATH, CMT)
    handle.reveal('/home/u/Desktop/copy.docx', CMT)
    expect(reveals).toEqual([{ path: PATH, commentId: CMT }])
  })

  it('resolveCommentBinding returns null for an unbound path', () => {
    expect(resolveCommentBinding(serviceFor(true), PATH)).toMatchObject({ documentId: DOC })
    expect(resolveCommentBinding(serviceFor(true), '/other')).toBeNull()
  })
})

describe('protocol errors cross the IPC boundary as data (R1-1)', () => {
  it('a create 409 comment_deleted survives structuredClone as conflict + details.code', async () => {
    const server = createFakeCommentServer()
    server.seed(DOC, [
      { id: 'thread', body: '', kind: 'comment', deleted_at: '2026-10-13T10:00:00Z' },
    ])
    const { handlers } = mount({ server })
    const reply = await handlers.get(COMMENTS_CHANNELS.create)!(
      {},
      {
        path: PATH,
        kind: 'comment',
        parentId: 'thread',
        body: 'draft',
      },
    )
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
    // Electron's ipcMain.handle serialises the reply; nothing richer than plain data may travel
    expect(structuredClone(reply)).toEqual(reply)
  })

  it.each([
    [401, 'unauthorized', false],
    [404, 'not_found', false],
    [500, 'internal', true],
    [503, 'internal', true],
  ] as const)(
    'a list %i survives structuredClone as %s (retryable %s)',
    async (status, code, retryable) => {
      const server = createFakeCommentServer()
      server.fail(status)
      const { handlers } = mount({ server })
      const reply = await handlers.get(COMMENTS_CHANNELS.list)!({}, { path: PATH })
      expect(reply).toEqual({
        ok: false,
        error: { code, message: `comments: HTTP ${status}`, status, retryable },
      })
      expect(structuredClone(reply)).toEqual(reply)
    },
  )

  it('a successful reply travels as { ok: true, value } through structuredClone', async () => {
    const server = createFakeCommentServer()
    server.seed(DOC, [{ id: CMT, body: 'hi', kind: 'comment' }])
    const { handlers } = mount({ server })
    const reply = await handlers.get(COMMENTS_CHANNELS.list)!({}, { path: PATH })
    expect(structuredClone(reply)).toEqual(reply)
    expect((reply as { ok: boolean }).ok).toBe(true)
  })
})

/** The shared body fixture (contract §3; copy of web/docs/protocol/test/comments.test.ts): a mention token + every Markdown-subset part. */
const BODY_FIXTURE =
  'Xem lại [@Nguyễn \\[An\\]](mention://member/01J8X4USR0AAAAAAAAAAAAAAAA) giúp nhé:\n' +
  '**đậm**, *nghiêng*, `code [@x](mention://member/01J8X4USR0BBBBBBBBBBBBBBBB)`,\n' +
  '[liên kết](https://example.com/a?b=1&c=2)  \nxuống dòng — <b>không HTML</b> ✓'

describe('the shared body fixture round-trips over the desktop IPC (card T1)', () => {
  type Reply<T> = { ok: true; value: T }

  it('create then list returns the body byte-identical; an update stays byte-identical too', async () => {
    const server = createFakeCommentServer()
    const { handlers } = mount({ server })

    const created = (await handlers.get(COMMENTS_CHANNELS.create)!(
      {},
      { path: PATH, kind: 'discussion', body: BODY_FIXTURE },
    )) as Reply<{ comment: { id: string; body: string } }>
    expect(created.ok).toBe(true)
    expect(created.value.comment.body).toBe(BODY_FIXTURE)
    // what reached the server is the very same string
    expect(server.lastCall()?.body).toEqual({ kind: 'discussion', body: BODY_FIXTURE })

    const listed = (await handlers.get(COMMENTS_CHANNELS.list)!({}, { path: PATH })) as Reply<{
      comments: Array<{ id: string; body: string }>
    }>
    expect(listed.ok).toBe(true)
    const found = listed.value.comments.find((c) => c.id === created.value.comment.id)
    expect(found?.body).toBe(BODY_FIXTURE)

    const edited = `${BODY_FIXTURE}\n**sửa** [@Nguyễn \\[An\\]](mention://member/01J8X4USR0AAAAAAAAAAAAAAAA)`
    const updated = (await handlers.get(COMMENTS_CHANNELS.update)!(
      {},
      { path: PATH, commentId: created.value.comment.id, body: edited },
    )) as Reply<{ comment: { body: string } }>
    expect(updated.ok).toBe(true)
    expect(updated.value.comment.body).toBe(edited)
    expect(server.lastCall()?.body).toEqual({ body: edited })

    const relisted = (await handlers.get(COMMENTS_CHANNELS.list)!({}, { path: PATH })) as Reply<{
      comments: Array<{ id: string; body: string }>
    }>
    expect(relisted.value.comments.find((c) => c.id === created.value.comment.id)?.body).toBe(
      edited,
    )
  })
})

describe('the launch reveal is held until the editor subscribes (R1-2)', () => {
  const pull = (handlers: Map<string, Handler>, senderId: number) =>
    handlers.get(COMMENTS_CHANNELS.revealPending)!({ sender: editorSender(senderId) }, undefined)

  it('a reveal decided before the editor subscribes is pulled once, then cleared', async () => {
    const { handle, handlers } = mount({ shownPath: (sender) => (sender.id === 7 ? PATH : null) })
    handle.reveal(PATH, CMT)
    expect(await pull(handlers, 7)).toEqual({ path: PATH, commentId: CMT })
    expect(await pull(handlers, 7)).toBeNull()
  })

  it('a pull reaches only the sender’s own path', async () => {
    const { handle, handlers } = mount({ shownPath: (sender) => (sender.id === 7 ? PATH : null) })
    handle.reveal(PATH, CMT)
    expect(await pull(handlers, 8)).toBeNull()
    expect(await pull(handlers, 7)).toEqual({ path: PATH, commentId: CMT })
  })

  it('a later reveal still pushes to the subscribed editor', async () => {
    const { handle, handlers, reveals } = mount({
      shownPath: (sender) => (sender.id === 7 ? PATH : null),
    })
    await pull(handlers, 7)
    handle.reveal(PATH, 'c2')
    expect(reveals).toEqual([{ path: PATH, commentId: 'c2' }])
  })
})

describe('a delivered reveal is not replayed on the next subscribe (D1-1)', () => {
  const pull = (handlers: Map<string, Handler>, senderId: number) =>
    handlers.get(COMMENTS_CHANNELS.revealPending)!({ sender: editorSender(senderId) }, undefined)

  it('a push handed to a subscribed editor ends the hold', async () => {
    const { handle, handlers } = mount({ shownPath: (sender) => (sender.id === 7 ? PATH : null) })
    expect(await pull(handlers, 7)).toBeNull() // the first subscribe holds nothing
    handle.reveal(PATH, CMT) // handed to the armed listener, not held
    expect(await pull(handlers, 7)).toBeNull() // a resubscribe must not replay it
  })

  it('a deferred push stays held until the editor pulls it', async () => {
    const { handle, handlers } = mount({
      shownPath: (sender) => (sender.id === 7 ? PATH : null),
      sendReveal: () => 'deferred',
    })
    handle.reveal(PATH, CMT)
    expect(await pull(handlers, 7)).toEqual({ path: PATH, commentId: CMT })
    expect(await pull(handlers, 7)).toBeNull()
  })

  it('a deferred push handed to a subscribed editor still ends the hold', async () => {
    let stillWanted: (() => boolean) | null = null
    const { handle, handlers } = mount({
      shownPath: (sender) => (sender.id === 7 ? PATH : null),
      sendReveal: (_payload, wanted) => {
        stillWanted = wanted
        return 'deferred'
      },
    })
    expect(await pull(handlers, 7)).toBeNull()
    handle.reveal(PATH, CMT)
    // the editor pulled before the reveal was decided, so the deferred push
    // lands in its listener once the page loads and the hold ends there
    expect(stillWanted!()).toBe(true)
    expect(await pull(handlers, 7)).toBeNull()
  })
})

describe('a pull that lands before the deferred push delivers once (D1-4)', () => {
  it('the deferred copy is dropped once the pull delivered the reveal', async () => {
    let stillWanted: (() => boolean) | null = null
    const { handle, handlers } = mount({
      shownPath: (sender) => (sender.id === 7 ? PATH : null),
      sendReveal: (_payload, wanted) => {
        stillWanted = wanted
        return 'deferred'
      },
    })
    handle.reveal(PATH, CMT)
    expect(stillWanted!()).toBe(true) // still held: the push owes the renderer the reveal
    expect(
      await handlers.get(COMMENTS_CHANNELS.revealPending)!({ sender: editorSender(7) }, undefined),
    ).toEqual({ path: PATH, commentId: CMT })
    expect(stillWanted!()).toBe(false) // the pull delivered it: the push must not
  })
})

describe('the desktop DTO parsers match the frame types (R1-4)', () => {
  it('a revision with created_by_id: null keeps null (a system author)', () => {
    const out = parseCommentsRevisions({
      revisions: [
        {
          id: '01J8X4REV0000000000000001',
          revision: 2,
          body: 'trimmed by the system',
          created_by_id: null,
          created_by_kind: 'system',
          created_at: '2026-10-13T10:00:00Z',
        },
      ],
    })
    expect(out.revisions[0]?.created_by_id).toBeNull()
  })

  it('parseCommentsAnchors keeps updated, skipped (with reasons) and list_token', () => {
    expect(
      parseCommentsAnchors({
        updated: ['c1', 'c2'],
        skipped: [{ comment_id: 'c3', reason: 'older_version' }],
        list_token: 'lt1:07',
      }),
    ).toEqual({
      updated: ['c1', 'c2'],
      skipped: [{ comment_id: 'c3', reason: 'older_version' }],
      list_token: 'lt1:07',
    })
  })

  it('parseCommentsAnchors refuses an unknown skip reason and a missing list_token', () => {
    expect(() =>
      parseCommentsAnchors({
        updated: [],
        skipped: [{ comment_id: 'c3', reason: 'because' }],
        list_token: 'lt1:07',
      }),
    ).toThrow()
    expect(() => parseCommentsAnchors({ updated: [], skipped: [] })).toThrow()
  })
})

describe('reload while composing a reply to a deleted thread (§9 rule 2)', () => {
  it('the draft is never touched, the list reloads and comment_deleted is surfaced', async () => {
    const server = createFakeCommentServer()
    server.seed(DOC, [
      { id: 'thread', body: 'root', kind: 'comment' },
      { id: 'reply', body: 'a reply', kind: 'comment', parent_id: 'thread' },
    ])
    const api = client(server.fetch)
    const first = await api.list(binding, {})
    expect(first.comments).toHaveLength(2)

    // the composer holds a draft (this module never sees it); the user is
    // replying to the thread, which is hard-deleted elsewhere
    const draft = 'my unsent reply'
    // the thread has a reply, so deleting it leaves a tombstone (a frame stays)
    const removal = await api.remove(binding, 'thread')
    expect(removal.outcome).toBe('tombstoned')
    const reloaded = await api.list(binding, { sinceToken: first.list_token })
    expect(reloaded.unchanged).toBe(false)
    const thread = reloaded.comments.find((c) => c.id === 'thread')!
    expect(thread.deleted_at).not.toBeNull() // the thread reads as deleted, no body
    expect(thread.body).toBe('')

    // sending the reply now fails with the §9 conflict + details.code, which is
    // never retryable: the renderer keeps the draft and shows "deleted"
    const out = await shapeOf(
      api.create(binding, { path: PATH, kind: 'comment', parentId: 'thread', body: draft }),
    )
    expect(out).toMatchObject({
      code: 'conflict',
      status: 409,
      retryable: false,
      details: { code: 'comment_deleted' },
    })
    expect(draft).toBe('my unsent reply')
  })
})

describe('the comments context + saved push (G8-12 §3.1)', () => {
  const OTHER = '/home/u/UniWork/Other.docx'
  const context = {
    documentId: DOC,
    versionId: 'ver_7',
    level: 'edit' as const,
    myUserId: 'acc_1',
  }

  function mountContext(options: { bound?: boolean } = {}) {
    const { ipcMain, handlers } = fakeIpc()
    const server = createFakeCommentServer()
    const saved: Array<{ path: string; versionId: string }> = []
    const bound = options.bound ?? true
    const service = {
      recentSource: (path: string) =>
        bound && path === PATH
          ? { documentId: DOC, workspaceId: 'ws-1', title: 'Plan', access: 'edit' as const }
          : null,
      commentContext: (path: string) => (bound && path === PATH ? context : null),
    } as unknown as Parameters<typeof createUniworkComments>[1]['service']
    const handle = createUniworkComments(ipcMain, {
      service,
      profile: () => ({ apiOrigin: ORIGIN }),
      authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
      isSignedIn: () => true,
      fetch: server.fetch,
      sendReveal: () => 'delivered',
      // editor 1 shows PATH, editor 2 shows OTHER
      shownPath: (sender) => (sender.id === 1 ? PATH : sender.id === 2 ? OTHER : null),
      sendSaved: (payload) => void saved.push(payload),
    })
    return { handle, handlers, server, saved }
  }

  it('answers documentId + versionId (+ level, my id) for the sender own bound path, no request', async () => {
    const { handlers, server } = mountContext()
    expect(
      await handlers.get(COMMENTS_CHANNELS.context)!({ sender: { id: 1 } }, { path: PATH }),
    ).toEqual({ ok: true, value: context })
    expect(server.calls).toHaveLength(0)
  })

  it('ignores a renderer-supplied document or version id', async () => {
    const { handlers } = mountContext()
    const reply = await handlers.get(COMMENTS_CHANNELS.context)!(
      { sender: { id: 1 } },
      { path: PATH, documentId: 'evil', versionId: 'evil' },
    )
    expect(reply).toEqual({ ok: true, value: context })
  })

  it('an unbound path answers not_found and makes no request', async () => {
    const { handlers, server } = mountContext({ bound: false })
    expect(
      await handlers.get(COMMENTS_CHANNELS.context)!({ sender: { id: 1 } }, { path: PATH }),
    ).toEqual({
      ok: false,
      error: {
        code: 'not_found',
        message: 'comments: document is not bound to UniWork',
        retryable: false,
      },
    })
    expect(server.calls).toHaveLength(0)
  })

  it('a sender that does not show the path is refused', async () => {
    const { handlers } = mountContext()
    for (const id of [2, 3]) {
      const reply = (await handlers.get(COMMENTS_CHANNELS.context)!(
        { sender: { id } },
        { path: PATH },
      )) as { ok: boolean; error?: { code: string } }
      expect(reply).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    }
  })

  it('a malformed request is refused', async () => {
    const { handlers } = mountContext()
    expect(await handlers.get(COMMENTS_CHANNELS.context)!({ sender: { id: 1 } }, {})).toMatchObject(
      {
        ok: false,
        error: { code: 'malformed' },
      },
    )
  })

  it('saved pushes once to the editor owning a bound path, nothing for an unbound one', () => {
    const { handle, saved } = mountContext()
    handle.saved(PATH, 'ver_8')
    handle.saved(OTHER, 'ver_9')
    expect(saved).toEqual([{ path: PATH, versionId: 'ver_8' }])
  })
})

// UNI-2033: "View in version N" from a lost comment: the editor asks main to open it
describe('comments.openVersion (UNI-2033)', () => {
  const OTHER = '/home/u/UniWork/Other.docx'
  const FOREIGN = '/home/u/UniWork/Foreign.docx'
  const call = (handlers: Map<string, Handler>, senderId: number, payload: unknown) =>
    handlers.get(COMMENTS_CHANNELS.openVersion)!({ sender: { id: senderId } }, payload)

  function mountOpen(
    options: {
      server?: ReturnType<typeof createFakeCommentServer>
      openVersionView?: (
        documentId: string,
        versionNo: number,
        commentId: string,
      ) => Promise<unknown>
    } = {},
  ) {
    const { ipcMain, handlers } = fakeIpc()
    const server = options.server ?? createFakeCommentServer()
    if (!options.server) server.seed(DOC, [{ id: CMT, body: 'hi', kind: 'comment' }])
    const openVersionView = vi.fn(
      options.openVersionView ?? (async () => ({ path: '/w/doc@v2/Plan.docx', title: 'Plan' })),
    )
    const service = {
      recentSource: (path: string) =>
        path === PATH || path === OTHER
          ? { documentId: DOC, workspaceId: 'ws-1', title: 'Plan', access: 'edit' as const }
          : path === FOREIGN
            ? ('hidden' as const)
            : null,
      openVersionView,
    } as unknown as Parameters<typeof createUniworkComments>[1]['service']
    createUniworkComments(ipcMain, {
      service,
      profile: () => ({ apiOrigin: ORIGIN }),
      authorized: <T>(c: (t: string) => Promise<T>) => c('tok'),
      isSignedIn: () => true,
      fetch: server.fetch,
      sendReveal: () => 'delivered',
      // sender 7 shows PATH, sender 8 shows FOREIGN, sender 9 shows OTHER
      shownPath: (sender) =>
        sender.id === 7 ? PATH : sender.id === 8 ? FOREIGN : sender.id === 9 ? OTHER : null,
    })
    return { handlers, server, openVersionView }
  }

  it('a good request opens the version view once and answers opened:true', async () => {
    const { handlers, openVersionView } = mountOpen()
    expect(await call(handlers, 7, { path: PATH, commentId: CMT, versionNo: 2 })).toEqual({
      opened: true,
    })
    expect(openVersionView.mock.calls).toEqual([[DOC, 2, CMT]])
  })

  it('confirms the comment with one list of the document, no other request', async () => {
    const { handlers, server } = mountOpen()
    await call(handlers, 7, { path: PATH, commentId: CMT, versionNo: 2 })
    expect(server.calls).toHaveLength(1)
    expect(server.calls[0]?.method).toBe('GET')
    expect(server.calls[0]?.url).toContain(`/api/v1/documents/${DOC}/comments`)
  })

  it('a malformed request answers opened:false and touches nothing', async () => {
    const { handlers, server, openVersionView } = mountOpen()
    const bad: unknown[] = [
      undefined,
      null,
      'x',
      { path: '', commentId: CMT, versionNo: 2 },
      { path: PATH, commentId: '', versionNo: 2 },
      { path: PATH, commentId: CMT, versionNo: 0 },
      { path: PATH, commentId: CMT, versionNo: -1 },
      { path: PATH, commentId: CMT, versionNo: 1.5 },
      { path: PATH, commentId: CMT, versionNo: '2' },
      { path: PATH, commentId: CMT },
    ]
    for (const payload of bad) {
      expect(await call(handlers, 7, payload), JSON.stringify(payload)).toEqual({ opened: false })
    }
    expect(server.calls).toHaveLength(0)
    expect(openVersionView).not.toHaveBeenCalled()
  })

  it('an unbound path, another account’s copy, or a sender that does not show the path is refused', async () => {
    const { handlers, server, openVersionView } = mountOpen()
    const input = (path: string) => ({ path, commentId: CMT, versionNo: 2 })
    // not a UniWork copy at all
    expect(await call(handlers, 7, input('/home/u/Desktop/copy.docx'))).toEqual({ opened: false })
    // another account / deployment's copy (recentSource says 'hidden')
    expect(await call(handlers, 8, input(FOREIGN))).toEqual({ opened: false })
    // the sender shows another document than the one it names
    expect(await call(handlers, 9, input(PATH))).toEqual({ opened: false })
    // an unknown sender (the shell, another window)
    expect(await call(handlers, 99, input(PATH))).toEqual({ opened: false })
    expect(server.calls).toHaveLength(0)
    expect(openVersionView).not.toHaveBeenCalled()
  })

  it('a comment that is not one of this document’s comments is refused', async () => {
    const { handlers, openVersionView } = mountOpen()
    expect(
      await call(handlers, 7, { path: PATH, commentId: 'not-a-comment', versionNo: 2 }),
    ).toEqual({ opened: false })
    expect(openVersionView).not.toHaveBeenCalled()
  })

  it('a discussion post is not a comment to view a version for', async () => {
    const server = createFakeCommentServer()
    server.seed(DOC, [{ id: CMT, body: 'talk', kind: 'discussion' }])
    const { handlers, openVersionView } = mountOpen({ server })
    expect(await call(handlers, 7, { path: PATH, commentId: CMT, versionNo: 2 })).toEqual({
      opened: false,
    })
    expect(openVersionView).not.toHaveBeenCalled()
  })

  it('a server error on the list, or a failed open, answers opened:false and never throws', async () => {
    const failing = createFakeCommentServer()
    failing.seed(DOC, [{ id: CMT, body: 'hi', kind: 'comment' }])
    failing.fail(500)
    const a = mountOpen({ server: failing })
    expect(await call(a.handlers, 7, { path: PATH, commentId: CMT, versionNo: 2 })).toEqual({
      opened: false,
    })
    expect(a.openVersionView).not.toHaveBeenCalled()

    const b = mountOpen({
      openVersionView: async () => {
        throw new Error('not_found')
      },
    })
    expect(await call(b.handlers, 7, { path: PATH, commentId: CMT, versionNo: 2 })).toEqual({
      opened: false,
    })
    expect(b.openVersionView).toHaveBeenCalledTimes(1)
  })
})
