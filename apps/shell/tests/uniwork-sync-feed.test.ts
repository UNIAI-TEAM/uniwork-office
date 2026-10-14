import { describe, expect, it, vi } from 'vitest'
import { TransportError } from '../src/main/uniwork-auth/transport'
import type { FetchLike } from '../src/main/uniwork-docs/client'
import { errorFromResponse } from '../src/main/uniwork-docs/errors'
import {
  createFeedClient,
  parseFeedPage,
  type FeedChange,
} from '../src/main/uniwork-sync/feed/client'
import {
  FeedConsumer,
  type DocCache,
  type DocCacheCommit,
} from '../src/main/uniwork-sync/feed/consumer'
import {
  createMemoryCursorStore,
  cursorKey,
  type CursorStore,
  type FeedScope,
} from '../src/main/uniwork-sync/feed/cursor-store'
import { FeedError, parseFeedError } from '../src/main/uniwork-sync/feed/errors'
import { compareRevision } from '../src/main/uniwork-sync/feed/revision'

const ORIGIN = 'https://uniwork.example'
const WS = 'ws_1'
const SCOPE: FeedScope = {
  deploymentId: 'dep_1',
  accountId: 'acc_a',
  orgId: 'org_1',
  workspaceId: WS,
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const envelope = (status: number, code: string) => json(status, { error: { code, message: 'x' } })
const row = (id: string, revision: string | number) =>
  `{"document_id":"${id}","kind":"file","revision":${revision},"current_version":1,"version_id":null}`
const feedRow = (
  id: string,
  revision: string | number,
  version: number,
  versionId: string | null,
) =>
  `{"document_id":"${id}","change_kind":"upsert","kind":"file","revision":${revision},` +
  `"current_version":${version},"version_id":${versionId === null ? 'null' : `"${versionId}"`},` +
  `"archived":false,"removal":""}`
const removalRow = (id: string, revision: string | number) =>
  `{"document_id":"${id}","change_kind":"removal","kind":"","revision":${revision},` +
  `"current_version":0,"version_id":null,"archived":false,"removal":"permission_revoked"}`
const feedPage = (rows: string, options: { hasMore?: boolean; next?: string } = {}) =>
  `{"phase":"feed","changes":[],"feed":[${rows}],"has_more":${options.hasMore ?? false},` +
  `"next_cursor":"${options.next ?? 'feed:1'}","expires_at":"2026-10-20T00:00:00Z"}`

/**
 * A fake G5-01a server. No cursor opens a snapshot of the workspace's rows
 * (`snap:<offset>` cursors, `pageSize` rows a page); the last snapshot page
 * hands out `feed:0`; `feed:<k>` serves the k-th queued incremental page.
 * `script` answers the next requests verbatim (errors, odd phases).
 */
function fakeServer(options: { pageSize?: number } = {}) {
  const pageSize = options.pageSize ?? 2
  const rows = new Map<string, Array<[string, string]>>()
  const incremental: Array<Array<[string, string]>> = []
  const script: Array<() => Response> = []
  const requests: URL[] = []
  const page = (body: {
    phase: string
    changes: Array<[string, string]>
    hasMore: boolean
    next: string
  }) =>
    new Response(
      `{"phase":"${body.phase}","changes":[${body.changes.map(([id, rev]) => row(id, rev)).join(',')}],` +
        `"has_more":${body.hasMore},"next_cursor":"${body.next}","expires_at":"2026-10-13T10:15:00Z"}`,
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  const fetch: FetchLike = async (input) => {
    const url = new URL(input)
    requests.push(url)
    const scripted = script.shift()
    if (scripted) return scripted()
    const ws = /\/api\/v1\/workspaces\/([^/]+)\/documents\/changes$/.exec(url.pathname)?.[1]
    if (!ws) return envelope(404, 'not_found')
    const cursor = url.searchParams.get('cursor')
    if (!cursor || cursor.startsWith('snap:')) {
      const all = rows.get(ws) ?? []
      const offset = cursor ? Number(cursor.slice(5)) : 0
      const changes = all.slice(offset, offset + pageSize)
      const hasMore = offset + pageSize < all.length
      return page({
        phase: 'snapshot',
        changes,
        hasMore,
        next: hasMore ? `snap:${offset + pageSize}` : 'feed:0',
      })
    }
    const k = Number(cursor.slice(5))
    const changes = incremental[k] ?? []
    return page({
      phase: 'changes',
      changes,
      hasMore: k + 1 < incremental.length,
      next: `feed:${Math.min(k + 1, incremental.length)}`,
    })
  }
  return { fetch, rows, incremental, script, requests }
}

/** a cache whose `effects` counts real changes, so a replay with no effect is visible */
function memoryCache() {
  const entries = new Map<string, string>()
  const drafts = new Set<string>()
  let effects = 0
  let refusedPage: DocCacheCommit | null = null
  let refusedReconcile: DocCacheCommit | null = null
  const cache: DocCache = {
    async applyPage(changes: readonly FeedChange[]) {
      if (refusedPage) return refusedPage
      for (const change of changes) {
        const current = entries.get(change.documentId)
        if (current === undefined || compareRevision(change.revision, current) > 0) {
          entries.set(change.documentId, change.revision)
          effects += 1
        }
      }
      return { kind: 'ok' }
    },
    async reconcile(ids, options) {
      if (refusedReconcile) return refusedReconcile
      for (const id of [...entries.keys()]) {
        if (!ids.has(id) && !(options.keepDrafts && drafts.has(id))) entries.delete(id)
      }
      return { kind: 'ok' }
    },
  }
  return {
    cache,
    entries,
    drafts,
    get effects() {
      return effects
    },
    /** the next page applies fail with this commit, as a full store would */
    refusePage: (commit: DocCacheCommit | null) => {
      refusedPage = commit
    },
    /** the next full-resync reconcile fails with this commit */
    refuseReconcile: (commit: DocCacheCommit | null) => {
      refusedReconcile = commit
    },
  }
}

function fakeClock(start = 1_000_000) {
  let now = start
  return {
    now: () => now,
    advance(ms: number) {
      now += ms
    },
  }
}

function setup(
  options: {
    scope?: FeedScope
    cursors?: CursorStore
    server?: ReturnType<typeof fakeServer>
    syncFeed?: () => boolean
    clock?: ReturnType<typeof fakeClock>
  } = {},
) {
  const server = options.server ?? fakeServer()
  const cursors = options.cursors ?? createMemoryCursorStore()
  const cache = memoryCache()
  const clock = options.clock ?? fakeClock()
  const log = vi.fn()
  const consumer = new FeedConsumer({
    scope: options.scope ?? SCOPE,
    client: createFeedClient({
      apiOrigin: ORIGIN,
      authorized: (call) => call('tok'),
      isSignedIn: () => true,
      fetch: server.fetch,
    }),
    cursors,
    cache: cache.cache,
    clock,
    capability: () => ({ sync_feed: options.syncFeed?.() ?? true }),
    backoffBaseMs: 1000,
    backoffMaxMs: 8000,
    log,
  })
  return { server, cursors, cache, clock, consumer, log }
}

const snapshotStarts = (requests: URL[]) =>
  requests.filter((url) => !url.searchParams.has('cursor')).length

describe('feed errors', () => {
  it('410 change_cursor_expired is a cursor verdict, never deleted (also through errorFromResponse)', () => {
    const body = { error: { code: 'change_cursor_expired', message: 'x' } }
    expect(parseFeedError(410, body)).toEqual({ kind: 'cursor_expired' })
    expect(errorFromResponse(410, body).code).not.toBe('deleted')
  })

  it('400 change_cursor_invalid is a cursor verdict, never deleted', () => {
    const body = { error: { code: 'change_cursor_invalid', message: 'x' } }
    expect(parseFeedError(400, body)).toEqual({ kind: 'cursor_invalid' })
    expect(errorFromResponse(400, body).code).not.toBe('deleted')
  })

  it('401 -> session_expired; anything else -> the documents mapping', () => {
    expect(parseFeedError(401, undefined)).toEqual({ kind: 'session_expired' })
    const other = parseFeedError(410, { error: { code: 'document_deleted', message: 'x' } })
    // the contract's tombstone code is document_deleted (the feed passes the
    // documents mapping through unchanged)
    expect(other.kind === 'other' && other.error.code).toBe('document_deleted')
    const bare = parseFeedError(502, undefined)
    expect(bare.kind === 'other' && bare.error.code).toBe('server_error')
  })

  it('501 unsupported_operation is the feed cursor verdict (errChangeFeedPending), never deleted', () => {
    const body = { error: { code: 'unsupported_operation', message: 'x' } }
    const failure = parseFeedError(501, body)
    if (failure.kind !== 'feed_cursor_unsupported') {
      throw new Error(`expected the feed cursor verdict, got ${failure.kind}`)
    }
    // it still carries the documents mapping, with the server's own code
    expect(failure.error.serverCode).toBe('unsupported_operation')
    expect(failure.error.code).not.toBe('deleted')
    // a 501 without that code (a gateway page) and the code on another status
    // are not the verdict
    expect(parseFeedError(501, undefined).kind).toBe('other')
    expect(parseFeedError(502, body).kind).toBe('other')
  })
})

describe('feed client', () => {
  it('keeps an int64 revision exact (past 2^53) and compares it as bigint', () => {
    const page = parseFeedPage(
      `{"phase":"snapshot","changes":[${row('d1', '9223372036854775807')},${row('d2', '9007199254740993')}],` +
        `"has_more":false,"next_cursor":"feed:0","expires_at":""}`,
    )
    expect(page.changes.map((c) => c.revision)).toEqual(['9223372036854775807', '9007199254740993'])
    expect(compareRevision('9007199254740993', '9007199254740992')).toBe(1)
    expect(compareRevision('9223372036854775807', '9223372036854775806')).toBe(1)
  })

  it('a malformed page is malformed_response', () => {
    const bad = () => parseFeedPage('{"phase":"snapshot","changes":[{"document_id":"d1"}]}')
    expect(bad).toThrow(FeedError)
    try {
      bad()
    } catch (error) {
      const failure = (error as FeedError).failure
      expect(failure.kind === 'other' && failure.error.code).toBe('malformed_response')
    }
  })

  it('reads a G5-01b feed page from `feed` (its `changes` is empty), revision exact', () => {
    const page = parseFeedPage(feedPage(feedRow('d1', '9007199254740993', 7, 'v7')))
    expect(page.phase).toBe('feed')
    expect(page.changes).toEqual([
      {
        documentId: 'd1',
        kind: 'file',
        revision: '9007199254740993',
        currentVersion: 7,
        versionId: 'v7',
      },
    ])
  })

  it('a feed removal never enters the change stream as a document state', () => {
    const page = parseFeedPage(feedPage(`${removalRow('d1', '9')},${feedRow('d2', '10', 2, 'v2')}`))
    expect(page.changes.map((change) => change.documentId)).toEqual(['d2'])
  })

  it('a feed page without its `feed` array is malformed, never silently empty', () => {
    const bad = () =>
      parseFeedPage(
        '{"phase":"feed","changes":[],"has_more":false,"next_cursor":"feed:1","expires_at":""}',
      )
    expect(bad).toThrow(FeedError)
    try {
      bad()
    } catch (error) {
      const failure = (error as FeedError).failure
      expect(failure.kind === 'other' && failure.error.code).toBe('malformed_response')
    }
  })

  it('sends the cursor in the query only, clamps the limit, and maps the final 401 to session_expired', async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response('', { status: 401 }))
    let attempts = 0
    const client = createFeedClient({
      apiOrigin: ORIGIN,
      // the auth module refreshes once on 401, then gives up
      authorized: async (call) => {
        try {
          attempts += 1
          return await call('tok')
        } catch (error) {
          if (error instanceof TransportError && error.code === 'unauthorized') {
            attempts += 1
            return await call('tok2')
          }
          throw error
        }
      },
      isSignedIn: () => true,
      fetch,
    })
    const failure = await client.listChanges(WS, 'c/1', 9999).catch((e: FeedError) => e.failure)
    expect(failure).toEqual({ kind: 'session_expired' })
    expect(attempts).toBe(2)
    const [input, init] = fetch.mock.calls[0]!
    const url = new URL(input)
    expect(url.pathname).toBe(`/api/v1/workspaces/${WS}/documents/changes`)
    expect(url.searchParams.get('cursor')).toBe('c/1')
    expect(url.searchParams.get('limit')).toBe('500')
    expect(init.body).toBeUndefined()
    expect(init.redirect).toBe('error')
  })
})

describe('feed consumer', () => {
  it('cold start: full snapshot, then the feed cursor is saved', async () => {
    const t = setup()
    t.server.rows.set(WS, [
      ['d1', '1'],
      ['d2', '2'],
      ['d3', '3'],
    ])
    expect(await t.consumer.sync()).toEqual({ kind: 'synced', pages: 2, resynced: true })
    expect([...t.cache.entries]).toEqual([
      ['d1', '1'],
      ['d2', '2'],
      ['d3', '3'],
    ])
    expect(await t.cursors.get(cursorKey(SCOPE))).toBe('feed:0')
  })

  it('a G5-01b feed page delivers its upserts to the cache and moves the cursor', async () => {
    const t = setup({ cursors: createMemoryCursorStore([[cursorKey(SCOPE), 'feed:0']]) })
    t.server.script.push(
      () => new Response(feedPage(feedRow('d1', '42', 2, 'v2')), { status: 200 }),
      () => new Response(feedPage(removalRow('d1', '43'), { next: 'feed:2' }), { status: 200 }),
    )
    expect(await t.consumer.sync()).toEqual({ kind: 'synced', pages: 1, resynced: false })
    expect([...t.cache.entries]).toEqual([['d1', '42']])
    expect(await t.cursors.get(cursorKey(SCOPE))).toBe('feed:1')
    // the removal has no state to apply: the page commits nothing and is not a failure
    expect(await t.consumer.sync()).toEqual({ kind: 'synced', pages: 1, resynced: false })
    expect([...t.cache.entries]).toEqual([['d1', '42']])
    expect(t.log).not.toHaveBeenCalled()
  })

  it('crash between page apply and cursor save -> the same page replays, one effect', async () => {
    const memory = createMemoryCursorStore([[cursorKey(SCOPE), 'feed:0']])
    let failNextSet = true
    const cursors: CursorStore = {
      get: (key) => memory.get(key),
      clear: (key) => memory.clear(key),
      async set(key, cursor) {
        if (failNextSet) {
          failNextSet = false
          throw new Error('crash')
        }
        await memory.set(key, cursor)
      },
    }
    const t = setup({ cursors })
    t.server.incremental.push([['d1', '5']])
    await expect(t.consumer.sync()).rejects.toThrow('crash')
    expect(t.cache.effects).toBe(1)
    expect(await memory.get(cursorKey(SCOPE))).toBe('feed:0')

    expect(await t.consumer.sync()).toEqual({ kind: 'synced', pages: 1, resynced: false })
    expect(t.server.requests.map((url) => url.searchParams.get('cursor'))).toEqual([
      'feed:0',
      'feed:0',
    ])
    expect(t.cache.effects).toBe(1)
    expect([...t.cache.entries]).toEqual([['d1', '5']])
    expect(await memory.get(cursorKey(SCOPE))).toBe('feed:1')
  })

  it('a page the store refused keeps the cursor, surfaces the error and is retried (G504-be-1)', async () => {
    const t = setup({ cursors: createMemoryCursorStore([[cursorKey(SCOPE), 'feed:0']]) })
    t.server.incremental.push([
      ['d1', '5'],
      ['d2', '6'],
    ])
    t.cache.refusePage({ kind: 'failed', failure: 'store_full' })
    const refused = await t.consumer.sync()
    if (refused.kind !== 'cache_refused') throw new Error(`expected a refusal, got ${refused.kind}`)
    expect(refused.failure).toBe('store_full')
    // nothing of the page is cached, and the cursor is still on it
    expect(t.cache.effects).toBe(0)
    expect(await t.cursors.get(cursorKey(SCOPE))).toBe('feed:0')
    // the same page comes back on the next tick; once it commits, the cursor moves with it
    t.cache.refusePage(null)
    expect(await t.consumer.sync()).toEqual({ kind: 'synced', pages: 1, resynced: false })
    expect(t.server.requests.map((url) => url.searchParams.get('cursor'))).toEqual([
      'feed:0',
      'feed:0',
    ])
    expect([...t.cache.entries]).toEqual([
      ['d1', '5'],
      ['d2', '6'],
    ])
    expect(await t.cursors.get(cursorKey(SCOPE))).toBe('feed:1')
  })

  it('a refused commit keeps store_unavailable its own code, never keystore_locked (R2-be-2)', async () => {
    // the scope was wiped (lockAndWipe) while the page was in flight: the cache
    // reports an interrupted scope, which is not a keychain lock
    const t = setup({ cursors: createMemoryCursorStore([[cursorKey(SCOPE), 'feed:0']]) })
    t.server.incremental.push([['d1', '5']])
    t.cache.refusePage({ kind: 'failed', failure: 'store_unavailable' })
    expect(await t.consumer.sync()).toEqual({ kind: 'cache_refused', failure: 'store_unavailable' })
    expect(t.cache.effects).toBe(0)
    expect(await t.cursors.get(cursorKey(SCOPE))).toBe('feed:0')

    // the resync's reconcile carries the same verdict: no cursor is saved
    const resync = setup()
    resync.server.rows.set(WS, [['d1', '1']])
    resync.cache.refuseReconcile({ kind: 'failed', failure: 'store_unavailable' })
    expect(await resync.consumer.sync()).toEqual({
      kind: 'cache_refused',
      failure: 'store_unavailable',
    })
    expect(await resync.cursors.get(cursorKey(SCOPE))).toBeNull()
  })

  it('a cancelled run stops before the next request and moves no cursor (G504-be-7)', async () => {
    const t = setup({ cursors: createMemoryCursorStore([[cursorKey(SCOPE), 'feed:0']]) })
    t.server.incremental.push([['d1', '5']], [['d2', '6']])
    const realApply = t.cache.cache.applyPage.bind(t.cache.cache)
    // the runtime stops right as the first page is being committed
    t.cache.cache.applyPage = async (changes) => {
      t.consumer.cancel()
      return realApply(changes)
    }
    expect(await t.consumer.sync()).toEqual({ kind: 'cancelled' })
    // no second request goes out and the cursor still points at the page, so
    // the next run replays it (idempotently) instead of skipping it
    expect(t.server.requests).toHaveLength(1)
    expect(await t.cursors.get(cursorKey(SCOPE))).toBe('feed:0')
  })

  it('a replayed page is idempotent, and an older revision never overwrites a newer one', async () => {
    const t = setup()
    const page: FeedChange[] = [
      {
        documentId: 'd1',
        kind: 'file',
        revision: '9007199254740993',
        currentVersion: 2,
        versionId: 'v',
      },
    ]
    await t.cache.cache.applyPage(page)
    await t.cache.cache.applyPage(page)
    await t.cache.cache.applyPage([{ ...page[0]!, revision: '9007199254740992' }])
    expect(t.cache.effects).toBe(1)
    expect(t.cache.entries.get('d1')).toBe('9007199254740993')
  })

  it('crash mid-resync saves no cursor; the next run starts the snapshot over', async () => {
    const t = setup()
    t.server.rows.set(WS, [
      ['d1', '1'],
      ['d2', '2'],
      ['d3', '3'],
    ])
    const realApply = t.cache.cache.applyPage.bind(t.cache.cache)
    let pagesApplied = 0
    t.cache.cache.applyPage = async (changes) => {
      pagesApplied += 1
      if (pagesApplied === 2) throw new Error('crash')
      return realApply(changes)
    }
    await expect(t.consumer.sync()).rejects.toThrow('crash')
    expect(await t.cursors.get(cursorKey(SCOPE))).toBeNull()
    expect(await t.consumer.sync()).toMatchObject({ kind: 'synced', resynced: true })
    expect(snapshotStarts(t.server.requests)).toBe(2)
    expect(t.cache.entries.size).toBe(3)
  })

  it('A -> B and a deployment switch never touch the other scope cursor or cache', async () => {
    const server = fakeServer()
    server.rows.set(WS, [['d1', '1']])
    const cursors = createMemoryCursorStore()
    const a = setup({ server, cursors })
    await a.consumer.sync()
    const aCursor = await cursors.get(cursorKey(SCOPE))
    const aEntries = [...a.cache.entries]

    server.rows.set(WS, [['d9', '9']])
    const bScope = { ...SCOPE, accountId: 'acc_b' }
    const b = setup({ server, cursors, scope: bScope })
    await b.consumer.sync()
    const otherDeployment = { ...SCOPE, deploymentId: 'dep_2' }
    const c = setup({ server, cursors, scope: otherDeployment })
    await c.consumer.sync()

    expect(new Set([cursorKey(SCOPE), cursorKey(bScope), cursorKey(otherDeployment)]).size).toBe(3)
    expect(await cursors.get(cursorKey(SCOPE))).toBe(aCursor)
    expect([...a.cache.entries]).toEqual(aEntries)
    expect([...b.cache.entries]).toEqual([['d9', '9']])
    expect([...c.cache.entries]).toEqual([['d9', '9']])
    // B's sign-in cold-started its own snapshot instead of reusing A's cursor
    expect(server.requests.filter((url) => !url.searchParams.has('cursor'))).toHaveLength(3)
  })

  it('410 change_cursor_expired -> full resync, nothing marked deleted', async () => {
    const t = setup({ cursors: createMemoryCursorStore([[cursorKey(SCOPE), 'feed:7']]) })
    t.server.rows.set(WS, [
      ['d1', '1'],
      ['d2', '2'],
    ])
    await t.cache.cache.applyPage([
      { documentId: 'd1', kind: 'file', revision: '1', currentVersion: 1, versionId: null },
    ])
    t.server.script.push(() => envelope(410, 'change_cursor_expired'))
    expect(await t.consumer.sync()).toEqual({ kind: 'synced', pages: 1, resynced: true })
    expect([...t.cache.entries]).toEqual([
      ['d1', '1'],
      ['d2', '2'],
    ])
    expect(await t.cursors.get(cursorKey(SCOPE))).toBe('feed:0')
  })

  it('400 change_cursor_invalid -> cursor cleared, exactly one full resync, nothing deleted', async () => {
    const memory = createMemoryCursorStore([[cursorKey(SCOPE), 'garbage']])
    const clear = vi.spyOn(memory, 'clear')
    const t = setup({ cursors: memory })
    t.server.rows.set(WS, [['d1', '1']])
    await t.cache.cache.applyPage([
      { documentId: 'd1', kind: 'file', revision: '1', currentVersion: 1, versionId: null },
    ])
    t.server.script.push(() => envelope(400, 'change_cursor_invalid'))
    expect(await t.consumer.sync()).toEqual({ kind: 'synced', pages: 1, resynced: true })
    expect(clear).toHaveBeenCalledWith(cursorKey(SCOPE))
    expect(snapshotStarts(t.server.requests)).toBe(1)
    expect([...t.cache.entries]).toEqual([['d1', '1']])
  })

  it('an invalid cursor whose resync is refused again backs off instead of a second resync', async () => {
    const t = setup({ cursors: createMemoryCursorStore([[cursorKey(SCOPE), 'garbage']]) })
    t.server.script.push(
      () => envelope(400, 'change_cursor_invalid'),
      () => envelope(400, 'change_cursor_invalid'),
    )
    expect(await t.consumer.sync()).toEqual({ kind: 'backoff', retryAt: t.clock.now() + 1000 })
    expect(snapshotStarts(t.server.requests)).toBe(1)
    expect(await t.cursors.get(cursorKey(SCOPE))).toBeNull()
  })

  it('501 on a saved feed cursor clears it and resyncs once in the same pass (G5-01a)', async () => {
    const memory = createMemoryCursorStore([[cursorKey(SCOPE), 'feed:0']])
    const clear = vi.spyOn(memory, 'clear')
    const t = setup({ cursors: memory })
    t.server.rows.set(WS, [
      ['d1', '1'],
      ['d2', '2'],
      ['d3', '3'],
    ])
    // a row the snapshot will list again and a local draft it will not: the
    // fallback reconciles by id, so neither is lost and neither is deleted
    await t.cache.cache.applyPage([
      { documentId: 'd1', kind: 'file', revision: '1', currentVersion: 1, versionId: null },
      { documentId: 'draft', kind: 'file', revision: '1', currentVersion: 1, versionId: null },
    ])
    t.cache.drafts.add('draft')
    const effectsBefore = t.cache.effects
    t.server.script.push(() => envelope(501, 'unsupported_operation'))

    expect(await t.consumer.sync()).toEqual({ kind: 'synced', pages: 2, resynced: true })
    expect(clear).toHaveBeenCalledWith(cursorKey(SCOPE))
    expect(t.server.requests.map((url) => url.searchParams.get('cursor'))).toEqual([
      'feed:0',
      null,
      'snap:2',
    ])
    expect(snapshotStarts(t.server.requests)).toBe(1)
    expect([...t.cache.entries].sort()).toEqual([
      ['d1', '1'],
      ['d2', '2'],
      ['d3', '3'],
      ['draft', '1'],
    ])
    // only the two rows the old stream did not hold are real writes
    expect(t.cache.effects).toBe(effectsBefore + 2)
    expect(await t.cursors.get(cursorKey(SCOPE))).toBe('feed:0')
  })

  it('501 on a later incremental page earns exactly one fallback, never a loop', async () => {
    const t = setup({ cursors: createMemoryCursorStore([[cursorKey(SCOPE), 'feed:0']]) })
    t.server.rows.set(WS, [
      ['d1', '6'],
      ['d2', '2'],
    ])
    // the first incremental page lands, the one after it is refused
    const changesPage = (changes: Array<[string, string]>, next: string) => () =>
      new Response(
        `{"phase":"changes","changes":[${changes.map(([id, rev]) => row(id, rev)).join(',')}],` +
          `"has_more":true,"next_cursor":"${next}","expires_at":""}`,
        { status: 200 },
      )
    t.server.script.push(changesPage([['d1', '5']], 'feed:1'), () =>
      envelope(501, 'unsupported_operation'),
    )

    expect(await t.consumer.sync()).toEqual({ kind: 'synced', pages: 1, resynced: true })
    expect(t.server.requests.map((url) => url.searchParams.get('cursor'))).toEqual([
      'feed:0',
      'feed:1',
      null,
    ])
    expect(snapshotStarts(t.server.requests)).toBe(1)
    // the page that did land stays applied; the snapshot's newer revision wins
    expect([...t.cache.entries]).toEqual([
      ['d1', '6'],
      ['d2', '2'],
    ])
    expect(await t.cursors.get(cursorKey(SCOPE))).toBe('feed:0')
  })

  it('501 during the fallback is a failure, not a second resync', async () => {
    const t = setup({ cursors: createMemoryCursorStore([[cursorKey(SCOPE), 'feed:0']]) })
    t.server.script.push(
      () => envelope(501, 'unsupported_operation'),
      () => envelope(501, 'unsupported_operation'),
    )
    const result = await t.consumer.sync()
    if (result.kind !== 'failed') throw new Error(`expected a failure, got ${result.kind}`)
    expect(result.error.serverCode).toBe('unsupported_operation')
    expect(t.server.requests).toHaveLength(2)
    expect(snapshotStarts(t.server.requests)).toBe(1)
    expect(await t.cursors.get(cursorKey(SCOPE))).toBeNull()
    expect(t.cache.effects).toBe(0)
  })

  it('501 on a cursorless snapshot request stays a failure', async () => {
    const t = setup()
    t.server.script.push(() => envelope(501, 'unsupported_operation'))
    const result = await t.consumer.sync()
    if (result.kind !== 'failed') throw new Error(`expected a failure, got ${result.kind}`)
    expect(result.error.serverCode).toBe('unsupported_operation')
    expect(t.server.requests).toHaveLength(1)
    expect(snapshotStarts(t.server.requests)).toBe(1)
    expect(await t.cursors.get(cursorKey(SCOPE))).toBeNull()
    expect(t.cache.effects).toBe(0)
  })

  it('full resync evicts lost-permission cache entries and keeps drafts', async () => {
    const t = setup()
    await t.cache.cache.applyPage(
      ['gone', 'draft', 'kept'].map((id) => ({
        documentId: id,
        kind: 'file',
        revision: '1',
        currentVersion: 1,
        versionId: null,
      })),
    )
    t.cache.drafts.add('draft')
    t.server.rows.set(WS, [['kept', '2']])
    await t.consumer.sync()
    expect([...t.cache.entries].sort()).toEqual([
      ['draft', '1'],
      ['kept', '2'],
    ])
  })

  it('resync hitting 410 again -> capped exponential backoff on the clock', async () => {
    const t = setup({ server: fakeServer({ pageSize: 1 }) })
    t.server.rows.set(WS, [
      ['d1', '1'],
      ['d2', '2'],
    ])
    const expire = () => envelope(410, 'change_cursor_expired')
    const delays: number[] = []
    for (let round = 0; round < 6; round += 1) {
      // first snapshot page fine, the second one's snapshot cursor expired
      t.server.script.push(() => json(200, firstSnapshotPage()), expire)
      const before = t.clock.now()
      const result = await t.consumer.sync()
      expect(result.kind).toBe('backoff')
      const retryAt = (result as { retryAt: number }).retryAt
      delays.push(retryAt - before)
      // inside the window: no request at all
      const count = t.server.requests.length
      t.clock.advance(retryAt - before - 1)
      expect(await t.consumer.sync()).toEqual({ kind: 'backoff', retryAt })
      expect(t.server.requests).toHaveLength(count)
      t.clock.advance(1)
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 8000, 8000])
    // a clean resync resets the backoff
    expect(await t.consumer.sync()).toMatchObject({ kind: 'synced', resynced: true })
    expect(t.cache.entries.size).toBe(2)
  })

  it('sync_feed off -> no feed request', async () => {
    const t = setup({ syncFeed: () => false })
    expect(await t.consumer.sync()).toEqual({ kind: 'disabled' })
    expect(t.server.requests).toHaveLength(0)
  })

  it('an unknown phase is applied as changes and logged once', async () => {
    const t = setup({ cursors: createMemoryCursorStore([[cursorKey(SCOPE), 'feed:0']]) })
    const odd = (next: string, more: boolean, id: string) => () =>
      new Response(
        `{"phase":"delta_v2","changes":[${row(id, '4')}],"has_more":${more},"next_cursor":"${next}","expires_at":""}`,
        { status: 200 },
      )
    t.server.script.push(odd('feed:1', true, 'd1'), odd('feed:2', false, 'd2'))
    expect(await t.consumer.sync()).toEqual({ kind: 'synced', pages: 2, resynced: false })
    expect([...t.cache.entries]).toEqual([
      ['d1', '4'],
      ['d2', '4'],
    ])
    expect(t.log).toHaveBeenCalledTimes(1)
    expect(await t.cursors.get(cursorKey(SCOPE))).toBe('feed:2')
  })

  it('401 -> session_expired, cursor and cache untouched', async () => {
    const t = setup({ cursors: createMemoryCursorStore([[cursorKey(SCOPE), 'feed:0']]) })
    t.server.script.push(() => new Response('', { status: 401 }))
    expect(await t.consumer.sync()).toEqual({ kind: 'session_expired' })
    expect(await t.cursors.get(cursorKey(SCOPE))).toBe('feed:0')
    expect(t.cache.effects).toBe(0)
  })
})

function firstSnapshotPage() {
  return {
    phase: 'snapshot',
    changes: [
      { document_id: 'd1', kind: 'file', revision: 1, current_version: 1, version_id: null },
    ],
    has_more: true,
    next_cursor: 'snap:1',
    expires_at: '',
  }
}
