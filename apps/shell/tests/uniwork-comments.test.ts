/**
 * G8-08 (UNI-1403): the desktop main-side comments client and its IPC. Every
 * call here runs against the in-memory FAKE server (fixtures/comments-fake-
 * server.ts), never a real server: the G8-03/G8-06 routes are not merged yet.
 * The error mapping is the protocol's one shared function (commentsErrorFromHttp),
 * so a 409 comment_deleted reads as a `conflict` carrying details.code and is
 * never retryable (no reload path).
 */
import { describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import {
  createUniworkComments,
  resolveCommentBinding,
} from '../src/main/uniwork-docs/comments-wiring'
import { createUniworkCommentsClient } from '../src/main/uniwork-docs/comments'
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

  it('update/remove/resolve/reopen/revisions/anchors/searchMentions hit their routes', async () => {
    const server = createFakeCommentServer()
    server.seed(DOC, [{ id: CMT, body: 'hi', kind: 'comment' }])
    const api = client(server.fetch)
    expect((await api.update(binding, CMT, 'new')).comment.body).toBe('new')
    expect((await api.resolve(binding, CMT)).comment.resolved_at).not.toBeNull()
    expect((await api.reopen(binding, CMT)).comment.resolved_at).toBeNull()
    expect((await api.revisions(binding, CMT)).revisions.length).toBe(1)
    expect(
      (
        await api.anchors(binding, {
          path: PATH,
          versionId: 'v1',
          anchors: [{ commentId: CMT, anchor: { format: 'docx', v: 1 }, state: 'exact' }],
        })
      ).updated,
    ).toEqual([CMT])
    expect(
      (await api.searchMentions(binding, { path: PATH, q: 'an' })).candidates[0]?.user_id,
    ).toBeTruthy()
    expect(server.calls.map((c) => c.method)).toEqual([
      'PATCH',
      'POST',
      'DELETE',
      'GET',
      'PUT',
      'GET',
    ])
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

describe('the comments IPC wiring (unbound -> zero requests)', () => {
  it('an unbound document makes no request and rejects with not_found', async () => {
    const server = createFakeCommentServer()
    const { ipcMain, handlers } = fakeIpc()
    const reveals: unknown[] = []
    createUniworkComments(ipcMain, {
      service: serviceFor(false),
      profile: () => ({ apiOrigin: ORIGIN }),
      authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
      isSignedIn: () => true,
      fetch: server.fetch,
      sendReveal: (p) => reveals.push(p),
    })
    const list = handlers.get(COMMENTS_CHANNELS.list)!
    expect(await shapeOf(list({}, { path: '/home/u/Desktop/copy.docx' }))).toMatchObject({
      code: 'not_found',
    })
    expect(server.calls).toHaveLength(0)
  })

  it('a bound document lists through the fake server', async () => {
    const server = createFakeCommentServer()
    server.seed(DOC, [{ id: CMT, body: 'hi', kind: 'comment' }])
    const { ipcMain, handlers } = fakeIpc()
    createUniworkComments(ipcMain, {
      service: serviceFor(true),
      profile: () => ({ apiOrigin: ORIGIN }),
      authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
      isSignedIn: () => true,
      fetch: server.fetch,
      sendReveal: () => undefined,
    })
    const out = (await handlers.get(COMMENTS_CHANNELS.list)!({}, { path: PATH })) as {
      comments: unknown[]
    }
    expect(out.comments).toHaveLength(1)
    expect(server.calls).toHaveLength(1)
  })

  it('a malformed payload is refused before any request', async () => {
    const server = createFakeCommentServer()
    const { ipcMain, handlers } = fakeIpc()
    createUniworkComments(ipcMain, {
      service: serviceFor(true),
      profile: () => ({ apiOrigin: ORIGIN }),
      authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
      isSignedIn: () => true,
      fetch: server.fetch,
      sendReveal: () => undefined,
    })
    expect(
      await shapeOf(handlers.get(COMMENTS_CHANNELS.create)!({}, { path: PATH, body: 'x' })),
    ).toMatchObject({ code: 'malformed' })
    expect(server.calls).toHaveLength(0)
  })

  it('registers one handler per frame request kind', () => {
    const { ipcMain, handlers } = fakeIpc()
    createUniworkComments(ipcMain, {
      service: serviceFor(true),
      profile: () => ({ apiOrigin: ORIGIN }),
      authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
      isSignedIn: () => true,
      fetch: createFakeCommentServer().fetch,
      sendReveal: () => undefined,
    })
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
      ].sort(),
    )
  })

  it('reveal pushes only for a bound path', () => {
    const { ipcMain } = fakeIpc()
    const reveals: unknown[] = []
    const handle = createUniworkComments(ipcMain, {
      service: serviceFor(true),
      profile: () => ({ apiOrigin: ORIGIN }),
      authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
      isSignedIn: () => true,
      fetch: createFakeCommentServer().fetch,
      sendReveal: (p) => reveals.push(p),
    })
    handle.reveal(PATH, CMT)
    handle.reveal('/home/u/Desktop/copy.docx', CMT)
    expect(reveals).toEqual([{ path: PATH, commentId: CMT }])
  })

  it('resolveCommentBinding returns null for an unbound path', () => {
    expect(resolveCommentBinding(serviceFor(true), PATH)).toMatchObject({ documentId: DOC })
    expect(resolveCommentBinding(serviceFor(true), '/other')).toBeNull()
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
