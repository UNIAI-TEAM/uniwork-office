/**
 * G8-12 (UNI-1407) lane contract §3.2: the kit's adapter from the editor's
 * `window.uniworkComments` (camelCase, reply envelopes) to a `CollabSource`
 * (protocol snake_case, thrown `CollabError`s), and the post-Save anchor map
 * sender (chunks of 500; `anchor_version_invalid` -> retry on the next Save).
 */
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { CommentAnchorUpdate, CommentsAnchorsResult } from '../../../web/docs/protocol/types'
import type { UniworkCommentsApi } from '../../electron-utils/src/comments-ipc'
import {
  COLLAB_MAX_ANCHORS,
  createUniworkCommentsSource,
  sendAnchorMap,
  toCollabError,
  type CollabAnchorUpdate,
  type CollabAnchorsResult,
  type CollabSource,
  type UniworkCommentsLike,
} from '../src/collab'

const PATH = '/w/Plan.docx'
const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value })

function fakeApi(overrides: Partial<Record<keyof UniworkCommentsLike, unknown>> = {}) {
  const calls: Array<{ method: string; input: unknown }> = []
  const record =
    (method: string, value: unknown) =>
    (input: unknown): Promise<unknown> => {
      calls.push({ method, input })
      const override = overrides[method as keyof UniworkCommentsLike]
      return typeof override === 'function'
        ? (override as (i: unknown) => Promise<unknown>)(input)
        : ok(value)
    }
  const comment = { id: 'c1', document_id: 'd1', body: 'hi' }
  const api = {
    list: record('list', { comments: [], mentions: [], list_token: 't1', unchanged: false }),
    create: record('create', { comment }),
    update: record('update', { comment }),
    remove: record('remove', { outcome: 'removed' }),
    resolve: record('resolve', { comment }),
    reopen: record('reopen', { comment }),
    revisions: record('revisions', { revisions: [] }),
    anchors: record('anchors', { updated: [], skipped: [], list_token: 'lt' }),
    searchMentions: record('searchMentions', { candidates: [] }),
  } as unknown as UniworkCommentsLike
  return { api, calls }
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected a rejection')
}

describe('the structural types match the desktop API and the protocol', () => {
  it('window.uniworkComments is a UniworkCommentsLike; anchor DTOs follow the protocol', () => {
    expectTypeOf<UniworkCommentsApi>().toMatchTypeOf<UniworkCommentsLike>()
    expectTypeOf<CommentsAnchorsResult>().toMatchTypeOf<CollabAnchorsResult>()
    expectTypeOf<CollabAnchorUpdate>().toMatchTypeOf<CommentAnchorUpdate>()
    expect(COLLAB_MAX_ANCHORS).toBe(500)
  })
})

describe('createUniworkCommentsSource (§3.2)', () => {
  it('maps every call to camelCase with the path, and returns the reply value', async () => {
    const { api, calls } = fakeApi()
    const source = createUniworkCommentsSource(api, PATH, 'comment')
    const anchor = { format: 'docx', v: 1, path: [0], start: 0, end: 2 }
    expect(await source.list({ since_token: 'tok' })).toMatchObject({ list_token: 't1' })
    await source.list({ kind: 'discussion' })
    await source.create({ kind: 'comment', body: 'b', anchor, base_version_id: 'v3' })
    await source.create({ kind: 'comment', parent_id: 'p1', body: 'r' })
    await source.update({ comment_id: 'c1', body: 'e' })
    expect(await source.remove({ comment_id: 'c1' })).toEqual({ outcome: 'removed' })
    await source.resolve({ comment_id: 'c1' })
    await source.reopen({ comment_id: 'c1' })
    await source.revisions({ comment_id: 'c1' })
    await source.searchMentions({ q: 'an', limit: 5 })
    await source.anchors!({
      version_id: 'v4',
      anchors: [{ comment_id: 'c1', anchor, state: 'exact' }],
    })
    expect(calls).toEqual([
      { method: 'list', input: { path: PATH, kind: 'comment', sinceToken: 'tok' } },
      { method: 'list', input: { path: PATH, kind: 'discussion' } },
      {
        method: 'create',
        input: { path: PATH, kind: 'comment', body: 'b', anchor, baseVersionId: 'v3' },
      },
      { method: 'create', input: { path: PATH, kind: 'comment', parentId: 'p1', body: 'r' } },
      { method: 'update', input: { path: PATH, commentId: 'c1', body: 'e' } },
      { method: 'remove', input: { path: PATH, commentId: 'c1' } },
      { method: 'resolve', input: { path: PATH, commentId: 'c1' } },
      { method: 'reopen', input: { path: PATH, commentId: 'c1' } },
      { method: 'revisions', input: { path: PATH, commentId: 'c1' } },
      { method: 'searchMentions', input: { path: PATH, q: 'an', limit: 5 } },
      {
        method: 'anchors',
        input: {
          path: PATH,
          versionId: 'v4',
          anchors: [{ commentId: 'c1', anchor, state: 'exact' }],
        },
      },
    ])
  })

  it('an error envelope rejects with the CollabError the kit reads (code, details.code, retryable)', async () => {
    const { api } = fakeApi({
      create: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: 'conflict',
            message: 'x',
            retryable: false,
            details: { code: 'comment_deleted' },
          },
        }),
      list: () =>
        Promise.resolve({ ok: false, error: { code: 'network', message: 'x', retryable: true } }),
    })
    const source = createUniworkCommentsSource(api, PATH, 'comment')
    const created = await rejection(source.create({ kind: 'comment', parent_id: 'p', body: 'b' }))
    expect(toCollabError(created)).toEqual({
      code: 'conflict',
      detailsCode: 'comment_deleted',
      retryable: false,
    })
    expect(toCollabError(await rejection(source.list({})))).toEqual({
      code: 'network',
      retryable: true,
    })
  })

  it('a malformed reply or a rejected call reads as internal', async () => {
    const { api } = fakeApi({
      update: () => Promise.resolve(undefined),
      resolve: () => Promise.resolve({ ok: false }),
      reopen: () => Promise.reject(new Error('ipc gone')),
    })
    const source = createUniworkCommentsSource(api, PATH, 'comment')
    for (const call of [
      source.update({ comment_id: 'c', body: 'b' }),
      source.resolve({ comment_id: 'c' }),
      source.reopen({ comment_id: 'c' }),
    ]) {
      expect(toCollabError(await rejection(call))).toEqual({ code: 'internal' })
    }
  })

  it('forwards include=no_access in searchMentions, canListMembers, and shareView when provided (G8-18)', async () => {
    const { api, calls } = fakeApi()
    const shareViewFn = vi.fn(() => ok({ ok: true as const }))
    const apiWithShare: UniworkCommentsLike = {
      ...api,
      canListMembers: true,
      shareView: shareViewFn,
    }
    const source = createUniworkCommentsSource(apiWithShare, PATH, 'comment')
    expect(source.canListMembers).toBe(true)
    await source.searchMentions({ q: 'an', limit: 20, include: 'no_access' })
    expect(await source.shareView!({ user_id: 'u-99' })).toEqual({ ok: true })
    expect(calls).toEqual([
      {
        method: 'searchMentions',
        input: { path: PATH, q: 'an', limit: 20, include: 'no_access' },
      },
    ])
    expect(shareViewFn).toHaveBeenCalledWith({ path: PATH, userId: 'u-99' })
  })
})

describe('sendAnchorMap (§3.2)', () => {
  const anchor = { format: 'xlsx', v: 1, sheet: 's1', range: 'A1' }
  const updates = (n: number): CollabAnchorUpdate[] =>
    Array.from({ length: n }, (_, i) => ({ comment_id: `c${i}`, anchor, state: 'exact' as const }))

  it('501 updates go in 2 calls of 500 + 1, results merged, last list_token kept', async () => {
    let round = 0
    const anchors = vi.fn(async (p: { version_id: string; anchors: CollabAnchorUpdate[] }) => {
      round += 1
      return {
        updated: p.anchors.slice(0, 1).map((a) => a.comment_id),
        skipped: [{ comment_id: `s${round}`, reason: 'older_version' as const }],
        list_token: `lt${round}`,
      }
    })
    const source = { anchors } as unknown as CollabSource
    const outcome = await sendAnchorMap(source, 'v9', updates(501))
    expect(anchors).toHaveBeenCalledTimes(2)
    expect(anchors.mock.calls[0]![0].anchors).toHaveLength(500)
    expect(anchors.mock.calls[1]![0].anchors).toHaveLength(1)
    expect(anchors.mock.calls.every(([p]) => p.version_id === 'v9')).toBe(true)
    expect(outcome).toEqual({
      outcome: 'synced',
      updated: ['c0', 'c500'],
      skipped: [
        { comment_id: 's1', reason: 'older_version' },
        { comment_id: 's2', reason: 'older_version' },
      ],
      list_token: 'lt2',
    })
  })

  it('400 anchor_version_invalid reads retry_next_save and never throws', async () => {
    // the desktop envelope: code malformed + details.code
    const desktop = createUniworkCommentsSource(
      fakeApi({
        anchors: () =>
          Promise.resolve({
            ok: false,
            error: {
              code: 'malformed',
              message: 'x',
              retryable: false,
              details: { code: 'anchor_version_invalid' },
            },
          }),
      }).api,
      PATH,
      'comment',
    )
    expect(await sendAnchorMap(desktop, 'v9', updates(2))).toEqual({
      outcome: 'retry_next_save',
    })
    // a host that throws the server code itself
    const raw = {
      anchors: () => Promise.reject({ code: 'anchor_version_invalid' }),
    } as unknown as CollabSource
    expect(await sendAnchorMap(raw, 'v9', updates(1))).toEqual({ outcome: 'retry_next_save' })
  })

  it('any other error rejects as a CollabError; nothing to send makes no call', async () => {
    const failing = {
      anchors: () => Promise.reject({ code: 'forbidden', retryable: false }),
    } as unknown as CollabSource
    expect(toCollabError(await rejection(sendAnchorMap(failing, 'v9', updates(1))))).toEqual({
      code: 'forbidden',
      retryable: false,
    })
    const anchors = vi.fn()
    expect(await sendAnchorMap({ anchors } as unknown as CollabSource, 'v9', [])).toEqual({
      outcome: 'synced',
      updated: [],
      skipped: [],
      list_token: '',
    })
    expect(anchors).not.toHaveBeenCalled()
    // a source without the anchors call cannot sync
    expect(
      toCollabError(await rejection(sendAnchorMap({} as CollabSource, 'v9', updates(1)))),
    ).toMatchObject({ code: 'unsupported' })
  })
})
