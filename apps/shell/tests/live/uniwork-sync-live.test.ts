/**
 * AC-5 of G5-04 (UNI-1349): the fork's real change-feed and capability code
 * against a real D server (G5-01a). The suite skips unless UNIWORK_LIVE_ORIGIN
 * names the deployment origin, so the normal shell suite is unchanged.
 *
 * Cloud run (Linux VM, D repo root):
 *   HARNESS_SKIP_APP=1 bash scripts/office/g5g6g7/harness/start.sh
 *   source .harness-run/ports.env   # API_ORIGIN is the origin
 *   cd <fork clone> && UNIWORK_LIVE_ORIGIN=$API_ORIGIN npx vitest run --root apps/shell tests/live --reporter=verbose
 *   bash scripts/office/g5g6g7/harness/stop.sh
 *
 * Step 6 (410 change_cursor_expired) additionally needs the server started
 * with OFFICE_CHANGE_SNAPSHOT_TTL=2s; without it that step skips with the
 * reason printed. Step 8 (sync_feed off) needs FF_OFFICE_SYNC_FEED=false, which
 * is server-wide and therefore cannot share a run with steps 2-6; without it
 * step 8 skips with the reason printed.
 */

import { beforeAll, describe, expect, it, type TestContext } from 'vitest'
import {
  CapabilityCache,
  NEVER_READ_CAPABILITIES,
  type OfficeCapabilities,
} from '../../src/main/uniwork-sync/capability/cache'
import { createCapabilityFetch } from '../../src/main/uniwork-sync/capability/client'
import { createFeedClient } from '../../src/main/uniwork-sync/feed/client'
import { FeedConsumer } from '../../src/main/uniwork-sync/feed/consumer'
import { cursorKey, type FeedScope } from '../../src/main/uniwork-sync/feed/cursor-store'
import { FeedError } from '../../src/main/uniwork-sync/feed/errors'
import { compareRevision } from '../../src/main/uniwork-sync/feed/revision'
import type { AuthorizedGetOptions } from '../../src/main/uniwork-sync/feed/http'
import {
  LIVE,
  LIVE_ORIGIN,
  countedFetch,
  createLiveApi,
  createRecordingCache,
  createRecordingCursorStore,
  envelopeCode,
  observeFeedClient,
  seedLiveRun,
  sleep,
  stringAt,
  tamperCursor,
  tokenAuthorized,
  type CountedFetch,
  type LiveApi,
  type LiveSeed,
  type ObservedFeedClient,
  type RecordingCache,
  type RecordingCursorStore,
} from './live-harness'

interface LiveState {
  origin: string
  api: LiveApi
  seed: LiveSeed
  http: CountedFetch
  authorized: AuthorizedGetOptions['authorized']
  client: ObservedFeedClient
  cursors: RecordingCursorStore
  cache: RecordingCache
  scope: FeedScope
  consumer: FeedConsumer
  capabilities: OfficeCapabilities
}

let liveState: LiveState | null = null

function live(): LiveState {
  if (!liveState) throw new Error('the live suite has no seeded context')
  return liveState
}

function feedPath(): string {
  return `/api/v1/workspaces/${encodeURIComponent(live().seed.workspaceId)}/documents/changes`
}

function cursorQuery(cursor: string): string {
  return `${feedPath()}?cursor=${encodeURIComponent(cursor)}`
}

function skipStep(context: TestContext, reason: string): void {
  context.skip(reason)
}

describe.skipIf(!LIVE)('G5-04 AC-5 live: real D server against the fork feed/capability', () => {
  beforeAll(async () => {
    const origin = LIVE_ORIGIN
    const api = createLiveApi(origin)
    const seed = await seedLiveRun(api)
    const http = countedFetch()
    const authorized = tokenAuthorized(seed.token)
    const client = observeFeedClient(
      createFeedClient({
        apiOrigin: origin,
        authorized,
        isSignedIn: () => true,
        fetch: http.fetch,
      }),
    )
    const cache = createRecordingCache()
    const cursors = createRecordingCursorStore(cache.state.events)
    const scope: FeedScope = {
      deploymentId: 'g5-04-live',
      accountId: seed.userId,
      orgId: seed.orgId,
      workspaceId: seed.workspaceId,
    }
    const consumer = new FeedConsumer({
      scope,
      client: client.client,
      cursors: cursors.store,
      cache,
      clock: { now: () => Date.now() },
      capability: () => ({ sync_feed: true }),
    })
    liveState = {
      origin,
      api,
      seed,
      http,
      authorized,
      client,
      cursors,
      cache,
      scope,
      consumer,
      capabilities: { ...NEVER_READ_CAPABILITIES },
    }
  }, 120_000)

  it('1. capability: every field parses and the fork cache reads the org once', async () => {
    const s = live()
    const path = `/api/v1/orgs/${encodeURIComponent(s.seed.orgId)}/office/capabilities`
    const raw = await s.api.ok('1.capability:read', 'GET', path, { token: s.seed.token })
    const body = raw.body as Record<string, unknown>
    for (const flag of ['sync_feed', 'sync_write', 'offline_library', 'ai_uniwork']) {
      expect(typeof body[flag], `1.capability:read: ${flag} must be a boolean`).toBe('boolean')
    }
    expect(Array.isArray(body.ai_uniwork_formats), 'ai_uniwork_formats must be an array').toBe(true)
    expect(typeof body.ttl_seconds, 'ttl_seconds must be a number').toBe('number')
    expect(body.ttl_seconds as number, 'ttl_seconds must be positive').toBeGreaterThan(0)

    let requests = 0
    const capabilityFetch = createCapabilityFetch({
      apiOrigin: s.origin,
      authorized: s.authorized,
      isSignedIn: () => true,
      fetch: s.http.fetch,
    })
    const cache = new CapabilityCache({
      fetch: (orgId) => {
        requests += 1
        return capabilityFetch(orgId)
      },
      clock: { now: () => Date.now() },
    })
    const first = await cache.get(s.seed.orgId)
    expect(first.kind, '1: a member must read its org capability').toBe('ok')
    if (first.kind !== 'ok') return
    s.capabilities = first.capabilities
    expect(first.source, '1: the first read must be fresh').toBe('fresh')
    expect(
      first.capabilities.sync_feed,
      '1: office_sync_feed defaults to true (D keys.go); a false here means the run was started with an override',
    ).toBe(true)
    expect(first.capabilities.sync_write).toBe(body.sync_write as boolean)
    expect(first.capabilities.offline_library).toBe(body.offline_library as boolean)
    expect(first.capabilities.ai_uniwork).toBe(body.ai_uniwork as boolean)
    expect(first.capabilities.ai_uniwork_formats).toEqual(body.ai_uniwork_formats)

    const second = await cache.get(s.seed.orgId)
    expect(second.source, '1: a second read inside the TTL must answer from the cache').toBe(
      'cached',
    )
    expect(requests, '1: the cache must issue exactly one request inside the TTL').toBe(1)
  }, 30_000)

  it('2. snapshot: FeedConsumer applies every seeded id and moves the cursor after the commit', async () => {
    const s = live()
    const result = await s.consumer.sync()
    expect(result, '2: a cold start with sync_feed on must sync the snapshot').toEqual({
      kind: 'synced',
      pages: 1,
      resynced: true,
    })
    const pages = s.client.pages
    expect(pages.length, '2: the snapshot must be one page').toBe(1)
    expect(['snapshot', 'changes'], '2: G5-01a pages carry the snapshot phase').toContain(
      pages[0].phase,
    )
    expect(pages[0].hasMore, '2: 3 documents fit one page').toBe(false)

    const applied = [...s.cache.state.docs.keys()].sort()
    expect(applied, '2: every seeded id must be applied, no more and no less').toEqual(
      [...s.seed.documentIds].sort(),
    )
    for (const documentId of s.seed.documentIds) {
      const change = s.cache.state.docs.get(documentId)
      expect(change, `2: ${documentId} must be in the cache`).toBeTruthy()
      if (!change) continue
      expect(change.kind, '2: a page document carries kind page').toBe('page')
      expect(change.revision, '2: a revision is a decimal int64 string').toMatch(/^\d{1,19}$/)
      expect(
        compareRevision(change.revision, BigInt(change.revision).toString()),
        '2: the revision must survive bigint arithmetic',
      ).toBe(0)
      expect(Number.isSafeInteger(change.currentVersion)).toBe(true)
      expect(change.versionId === null || typeof change.versionId === 'string').toBe(true)
    }

    const key = cursorKey(s.scope)
    expect(
      s.cursors.memory.entries.get(key),
      '2: the consumer must save the last page cursor',
    ).toBe(pages[0].nextCursor)
    const events = s.cache.state.events
    const appliedAt = events.lastIndexOf(`cache:apply:${s.seed.documentIds.length}`)
    const movedAt = events.lastIndexOf('cursor:set')
    expect(appliedAt, '2: the page must have been committed').toBeGreaterThanOrEqual(0)
    expect(movedAt > appliedAt, '2: the cursor must only move after the page commit landed').toBe(
      true,
    )
  }, 30_000)

  it('3. paging: limit=1 chains every page by next_cursor and lists each id once', async () => {
    const s = live()
    s.client.pages.length = 0
    s.client.requests.length = 0
    const cache = createRecordingCache()
    const cursors = createRecordingCursorStore(cache.state.events)
    const consumer = new FeedConsumer({
      scope: s.scope,
      client: s.client.client,
      cursors: cursors.store,
      cache,
      clock: { now: () => Date.now() },
      capability: () => ({ sync_feed: true }),
      pageLimit: 1,
    })
    const result = await consumer.sync()
    expect(result, '3: the paged snapshot must finish').toEqual({
      kind: 'synced',
      pages: s.seed.documentIds.length,
      resynced: true,
    })
    const pages = s.client.pages
    expect(pages.map((page) => page.changes.length)).toEqual([1, 1, 1])
    expect(pages.map((page) => page.hasMore)).toEqual([true, true, false])
    expect(
      s.client.requests.map((request) => request.cursor),
      '3: page two and three must be requested with the previous next_cursor',
    ).toEqual([undefined, pages[0].nextCursor, pages[1].nextCursor])
    expect(s.client.requests.map((request) => request.limit)).toEqual([1, 1, 1])

    const seen = pages.flatMap((page) => page.changes.map((change) => change.documentId))
    expect(new Set(seen).size, '3: no id may repeat across pages').toBe(seen.length)
    expect([...seen].sort(), '3: every seeded id must appear exactly once').toEqual(
      [...s.seed.documentIds].sort(),
    )
    expect(
      cursors.memory.entries.get(cursorKey(s.scope)),
      '3: the resync must save the final page cursor',
    ).toBe(pages[pages.length - 1].nextCursor)
    expect(
      cache.state.events,
      '3: all three pages commit before the single final cursor move',
    ).toEqual([
      'cache:apply:1',
      'cache:apply:1',
      'cache:apply:1',
      `cache:reconcile:${s.seed.documentIds.length}`,
      'cursor:set',
    ])
  }, 30_000)

  it('4. replay: a second run from the saved cursor is idempotent and deletes nothing', async () => {
    const s = live()
    const key = cursorKey(s.scope)
    const saved = s.cursors.memory.entries.get(key)
    const effectsBefore = s.cache.state.effects
    const first = await s.consumer.sync()
    let note = ''
    if (first.kind === 'synced') {
      expect(first.resynced, '4: a saved cursor must be followed incrementally').toBe(false)
      note = `the server served the saved cursor incrementally (${first.pages} page(s)); the replay wrote nothing`
    } else if (first.kind === 'failed' && first.error.code === 'unsupported_operation') {
      note =
        'G5-01a answers 501 unsupported_operation for a feed cursor (the incremental feed is G5-01b); the fork reports it as failed, moves no cursor and deletes nothing'
      expect(
        s.cursors.memory.entries.get(key),
        '4: a refused replay must not move the cursor',
      ).toBe(saved)
    } else {
      throw new Error(`4: replay from the saved cursor answered ${JSON.stringify(first)}`)
    }
    expect(s.cache.state.effects, '4: an idempotent replay writes no row').toBe(effectsBefore)
    expect([...s.cache.state.docs.keys()].sort(), '4: nothing may be deleted').toEqual(
      [...s.seed.documentIds].sort(),
    )
    expect(s.cache.state.evicted, '4: no cache entry may be evicted').toEqual([])

    // the same guarantee over the path this server does support: a fresh
    // cold snapshot reconciles to exactly the seeded ids
    await s.cursors.store.clear(key)
    const second = await s.consumer.sync()
    expect(second, '4: the second cold snapshot must finish').toEqual({
      kind: 'synced',
      pages: 1,
      resynced: true,
    })
    expect(s.cache.state.effects, '4: a replayed snapshot writes no row').toBe(effectsBefore)
    expect(s.cache.state.evicted, '4: a replayed snapshot evicts nothing').toEqual([])
    console.log(`step 4: ${note}`)
  }, 30_000)

  it('5. tampered cursor: 400 change_cursor_invalid, one full resync, nothing deleted', async () => {
    const s = live()
    const key = cursorKey(s.scope)
    const probe = await s.client.client.listChanges(s.seed.workspaceId, undefined, 1)
    expect(probe.hasMore, '5: 3 documents with limit=1 must leave a snapshot cursor').toBe(true)
    const tampered = tamperCursor(probe.nextCursor)
    expect(tampered, '5: the tamper must change the cursor').not.toBe(probe.nextCursor)

    const raw = await s.api.request('5.tampered:read', 'GET', cursorQuery(tampered), {
      token: s.seed.token,
    })
    expect(raw.status, `5.tampered:read: GET ${feedPath()} must answer 400`).toBe(400)
    expect(
      envelopeCode(raw.body),
      '5.tampered:read: the 400 must carry change_cursor_invalid',
    ).toBe('change_cursor_invalid')

    let failure: unknown
    try {
      await s.client.client.listChanges(s.seed.workspaceId, tampered)
    } catch (error) {
      failure = error
    }
    expect(failure, '5: the fork client must reject the 400').toBeInstanceOf(FeedError)
    expect(
      (failure as FeedError).failure.kind,
      '5: parseFeedError must classify the tamper as cursor_invalid',
    ).toBe('cursor_invalid')

    const cursors = createRecordingCursorStore(s.cache.state.events)
    await cursors.store.set(key, tampered)
    const opensBefore = s.client.snapshotOpens()
    const pagesBefore = s.client.pages.length
    const consumer = new FeedConsumer({
      scope: s.scope,
      client: s.client.client,
      cursors: cursors.store,
      cache: s.cache,
      clock: { now: () => Date.now() },
      capability: () => ({ sync_feed: true }),
    })
    const result = await consumer.sync()
    expect(result, '5: an invalid cursor must be cleared and the run resynced').toEqual({
      kind: 'synced',
      pages: 1,
      resynced: true,
    })
    expect(
      s.client.snapshotOpens() - opensBefore,
      '5: the run must open exactly one full resync',
    ).toBe(1)
    expect(
      s.client.pages.length - pagesBefore,
      '5: no further page request may follow the single resync',
    ).toBe(1)
    expect(s.cache.state.evicted, '5: nothing may be marked deleted').toEqual([])
    expect([...s.cache.state.docs.keys()].sort()).toEqual([...s.seed.documentIds].sort())
    expect(s.cache.state.events, '5: the tampered cursor must be cleared').toContain('cursor:clear')
    expect(cursors.memory.entries.get(key), '5: the resync must leave its own final cursor').toBe(
      s.client.pages[s.client.pages.length - 1].nextCursor,
    )

    const secondPath = `/api/v1/workspaces/${encodeURIComponent(s.seed.secondWorkspaceId)}/documents/changes`
    const other = await s.api.ok('5.cross-workspace:open', 'GET', secondPath, {
      token: s.seed.token,
    })
    const otherCursor = stringAt('5.cross-workspace:open', other.body, 'next_cursor')
    const cross = await s.api.request('5.cross-workspace:reuse', 'GET', cursorQuery(otherCursor), {
      token: s.seed.token,
    })
    expect(cross.status, `5.cross-workspace:reuse: GET ${feedPath()} must answer 400`).toBe(400)
    expect(
      envelopeCode(cross.body),
      '5.cross-workspace:reuse: another workspace cursor must be change_cursor_invalid',
    ).toBe('change_cursor_invalid')
  }, 60_000)

  it('6. expired cursor: 410 change_cursor_expired clears into one full resync', async (context) => {
    const s = live()
    const key = cursorKey(s.scope)
    const probe = await s.client.client.listChanges(s.seed.workspaceId, undefined, 1)
    expect(probe.hasMore, '6: 3 documents with limit=1 must leave a snapshot cursor').toBe(true)
    const remainingMs = Date.parse(probe.expiresAt) - Date.now()
    if (!Number.isFinite(remainingMs) || remainingMs > 20_000) {
      skipStep(
        context,
        `6: the snapshot expires in ${Number.isFinite(remainingMs) ? `${Math.round(remainingMs / 1000)}s` : 'an unparseable expires_at'}; ` +
          'start the harness server with OFFICE_CHANGE_SNAPSHOT_TTL=2s to ground this step (the service default is 15m)',
      )
      return
    }
    if (remainingMs > 0) await sleep(remainingMs + 1_500)

    const raw = await s.api.request('6.expired:read', 'GET', cursorQuery(probe.nextCursor), {
      token: s.seed.token,
    })
    expect(raw.status, `6.expired:read: GET ${feedPath()} must answer 410`).toBe(410)
    expect(envelopeCode(raw.body), '6.expired:read: the 410 must carry change_cursor_expired').toBe(
      'change_cursor_expired',
    )

    let failure: unknown
    try {
      await s.client.client.listChanges(s.seed.workspaceId, probe.nextCursor)
    } catch (error) {
      failure = error
    }
    expect(failure, '6: the fork client must reject the 410').toBeInstanceOf(FeedError)
    expect(
      (failure as FeedError).failure.kind,
      '6: parseFeedError must classify the expiry as cursor_expired, never deleted',
    ).toBe('cursor_expired')

    const cursors = createRecordingCursorStore(s.cache.state.events)
    await cursors.store.set(key, probe.nextCursor)
    const opensBefore = s.client.snapshotOpens()
    const consumer = new FeedConsumer({
      scope: s.scope,
      client: s.client.client,
      cursors: cursors.store,
      cache: s.cache,
      clock: { now: () => Date.now() },
      capability: () => ({ sync_feed: true }),
    })
    const result = await consumer.sync()
    expect(result, '6: an expired cursor must resync in the same run').toEqual({
      kind: 'synced',
      pages: 1,
      resynced: true,
    })
    expect(
      s.client.snapshotOpens() - opensBefore,
      '6: the run must open exactly one full resync',
    ).toBe(1)
    expect(s.cache.state.evicted, '6: nothing may be marked deleted').toEqual([])
    expect([...s.cache.state.docs.keys()].sort()).toEqual([...s.seed.documentIds].sort())
  }, 60_000)

  it('7. capability and feed with a bad token: 401 maps to session_expired', async () => {
    const s = live()
    const path = `/api/v1/orgs/${encodeURIComponent(s.seed.orgId)}/office/capabilities`
    const raw = await s.api.request('7.bad-token:read', 'GET', path, {
      token: 'not-a-live-token',
    })
    expect(raw.status, `7.bad-token:read: GET ${path} must answer 401`).toBe(401)

    const badToken = 'not-a-live-token'
    const capability = new CapabilityCache({
      fetch: createCapabilityFetch({
        apiOrigin: s.origin,
        authorized: tokenAuthorized(badToken),
        isSignedIn: () => true,
        fetch: s.http.fetch,
      }),
      clock: { now: () => Date.now() },
    })
    const read = await capability.get(s.seed.orgId)
    expect(read.kind, '7: a 401 must read as session_expired').toBe('session_expired')
    expect(read.source, '7: nothing was cached for this org').toBe('default')
    expect(read.capabilities).toEqual(NEVER_READ_CAPABILITIES)

    const badFeed = createFeedClient({
      apiOrigin: s.origin,
      authorized: tokenAuthorized(badToken),
      isSignedIn: () => true,
      fetch: s.http.fetch,
    })
    let failure: unknown
    try {
      await badFeed.listChanges(s.seed.workspaceId)
    } catch (error) {
      failure = error
    }
    expect(failure, '7: the feed client must reject the 401').toBeInstanceOf(FeedError)
    expect(
      (failure as FeedError).failure.kind,
      '7: the feed 401 must read as session_expired, never deleted',
    ).toBe('session_expired')
  }, 30_000)

  it('8. sync_feed off: 403 office_capability_off and no feed request at all', async (context) => {
    const s = live()
    if (s.capabilities.sync_feed) {
      skipStep(
        context,
        '8: office_sync_feed is on for the seeded org (D keys.go default true), so this run cannot prove the off path; ' +
          'ground it by starting the harness server with FF_OFFICE_SYNC_FEED=false (server-wide env override - the per-org override row is platform-console/DB only), ' +
          'and do not reuse that origin for steps 2-6',
      )
      return
    }
    const raw = await s.api.request('8.flag-off:read', 'GET', feedPath(), { token: s.seed.token })
    expect(raw.status, `8.flag-off:read: GET ${feedPath()} must answer 403`).toBe(403)
    expect(
      envelopeCode(raw.body),
      '8.flag-off:read: the 403 must carry office_capability_off',
    ).toBe('office_capability_off')

    const cache = createRecordingCache()
    const cursors = createRecordingCursorStore(cache.state.events)
    const opensBefore = s.client.snapshotOpens()
    const consumer = new FeedConsumer({
      scope: s.scope,
      client: s.client.client,
      cursors: cursors.store,
      cache,
      clock: { now: () => Date.now() },
      capability: () => ({ sync_feed: false }),
    })
    const result = await consumer.sync()
    expect(result, '8: a disabled capability must report disabled').toEqual({ kind: 'disabled' })
    expect(
      s.client.snapshotOpens() - opensBefore,
      '8: a disabled capability must issue no feed request',
    ).toBe(0)
    expect(cache.state.evicted, '8: nothing may be marked deleted').toEqual([])
    expect(cache.state.docs.size, '8: nothing may be applied').toBe(0)
    expect(cursors.memory.entries.size, '8: no cursor may move').toBe(0)
  }, 30_000)
})
