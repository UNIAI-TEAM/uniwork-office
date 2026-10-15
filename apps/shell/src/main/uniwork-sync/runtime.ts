import type { CapabilityRead, OfficeCapabilities } from './capability/cache'
import type { FeedChange, FeedClient } from './feed/client'
import { FeedConsumer, type DocCache, type DocCacheCommit } from './feed/consumer'
import { cursorKey, type CursorStore, type FeedScope } from './feed/cursor-store'
import { compareRevision } from './feed/revision'
import {
  LEASE_STORE_REGISTRATION,
  LeaseManager,
  createLeaseClient,
  createLeaseManager,
  createLeaseStore,
  type LeaseClient,
  type LeaseRevokeNotice,
} from './lease'
import type { SyncStoreAccess } from './session-store'
import { APP_STORE_LEVEL } from './store-level'
import type { StoreReadResult, StoreRecords, StoreRegistration, StoreWriteResult } from './store'

export {
  LEASE_STORE_REGISTRATION,
  LeaseManager,
  createLeaseClient,
  createLeaseManager,
  createLeaseStore,
  type LeaseClient,
  type LeaseRevokeNotice,
}

/**
 * The change-feed runtime of the signed-in account. For every (org, workspace)
 * whose org capability says `sync_feed` it keeps one FeedConsumer: the cursor
 * and the document index live in the account's durable store (`feed-cursors`
 * and `doc-index`), so nothing about another account, org or deployment is
 * ever read or moved by this stream. Capabilities come from the per-org cache
 * (401 -> `session_expired`, reported to the session). With `sync_feed` off,
 * or while the store cannot open (a locked keychain), no feed request is made
 * at all. There is no desktop realtime channel today: this polls on a modest
 * interval (60 s by default) and on sign-in.
 */

export const FEED_CURSORS_REGISTRATION: StoreRegistration = {
  name: 'feed-cursors',
  schema: 1,
  minStoreLevel: APP_STORE_LEVEL,
}

export const DOC_INDEX_REGISTRATION: StoreRegistration = {
  name: 'doc-index',
  schema: 1,
  minStoreLevel: APP_STORE_LEVEL,
}

export const FEED_INTERVAL_MS = 60_000

/** the store-backed cursor of one feed stream */
export function createStoreCursorStore(records: StoreRecords): CursorStore {
  return {
    async get(key) {
      const read = await records.read(key)
      return read.kind === 'ok' ? new TextDecoder().decode(read.value) : null
    },
    async set(key, cursor) {
      // a failed write only means the next run replays the page; the cursor
      // never moves past an unapplied page
      await records.write(key, new TextEncoder().encode(cursor))
    },
    async clear(key) {
      await records.delete(key)
    },
  }
}

/** the whole cache of one workspace: its listed ids and each document's row */
interface DocCacheState {
  index: string[]
  docs: Record<string, FeedChange>
}

function cacheKey(scope: FeedScope): string {
  return `${scope.orgId}/${scope.workspaceId}/index`
}

/** the store could not be reached at all: nothing may be committed over it */
const UNAVAILABLE: DocCacheCommit = { kind: 'failed', failure: 'store_unavailable' }

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

function decodeJson<T>(bytes: Uint8Array, fallback: T): T {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } catch {
    return fallback
  }
}

function isFeedChange(value: unknown): value is FeedChange {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.documentId === 'string' &&
    typeof row.kind === 'string' &&
    typeof row.revision === 'string' &&
    typeof row.currentVersion === 'number' &&
    (row.versionId === null || typeof row.versionId === 'string')
  )
}

function decodeState(bytes: Uint8Array): DocCacheState {
  const parsed = decodeJson<unknown>(bytes, null)
  if (Array.isArray(parsed)) {
    // the bare id list of an older layout: the rows are rebuilt by a resync
    return { index: parsed.filter((id): id is string => typeof id === 'string'), docs: {} }
  }
  if (!parsed || typeof parsed !== 'object') return { index: [], docs: {} }
  const record = parsed as { index?: unknown; docs?: unknown }
  const index = Array.isArray(record.index)
    ? record.index.filter((id): id is string => typeof id === 'string')
    : []
  const docs: Record<string, FeedChange> = {}
  if (record.docs && typeof record.docs === 'object' && !Array.isArray(record.docs)) {
    for (const [documentId, value] of Object.entries(record.docs as Record<string, unknown>)) {
      if (isFeedChange(value)) docs[documentId] = value
    }
  }
  return { index, docs }
}

export interface StoreDocCacheOptions {
  records: StoreRecords
  scope: FeedScope
  /** true while the document has local work (a stored intent or a dirty copy) */
  keepDraft?(documentId: string): Promise<boolean>
  /**
   * G5-03a: a full resync dropped this document from the index (it was not in
   * the snapshot and held no local work). Reported only after the reconcile
   * committed, so a refused one (which is replayed) never reports.
   */
  onDropped?(documentId: string): void
}

/**
 * The doc index of one workspace. The whole cache - its listed ids and each
 * document's row - is one record, so a page is committed with a single atomic
 * write: a crash (or a store refusal) shows either the old page and index or
 * the new page and index, never a half page the index does not list, and there
 * is no orphan row a later reconcile could not reach. A replayed page is
 * idempotent by document id and revision. `reconcile` rewrites the same
 * record: every id the snapshot no longer lists loses its row unless it is
 * kept as a draft.
 */
export function createStoreDocCache(options: StoreDocCacheOptions): DocCache {
  const { records, scope } = options
  const key = cacheKey(scope)
  const empty = (): DocCacheState => ({ index: [], docs: {} })

  /** the store could not be read right now: never write over what it holds */
  const unusable = (kind: StoreReadResult['kind']): boolean =>
    kind === 'interrupted' || kind === 'refused'

  const load = async (): Promise<DocCacheState | null> => {
    const read = await records.read(key)
    if (unusable(read.kind)) return null
    // a missing (first run) or corrupt (torn by an older build) record is
    // rebuilt from the feed, which is the cache's only source of truth
    return read.kind === 'ok' ? decodeState(read.value) : empty()
  }

  /** the store's write outcome, as the cache commit the consumer acts on */
  const commitResult = (written: StoreWriteResult): DocCacheCommit =>
    written.kind === 'ok'
      ? { kind: 'ok' }
      : {
          kind: 'failed',
          failure: written.kind === 'store_full' ? 'store_full' : 'store_unavailable',
        }

  const commit = async (state: DocCacheState): Promise<DocCacheCommit> =>
    commitResult(await records.write(key, encodeJson(state)))

  return {
    async applyPage(changes: readonly FeedChange[]) {
      const state = await load()
      if (!state) return UNAVAILABLE
      // one id per document, however many of its changes this page carries: a
      // fast double edit passes the revision comparison twice in one pass, and
      // the notice must still be one per document (R1-7)
      const applied = new Set<string>()
      for (const change of changes) {
        const known = state.docs[change.documentId]
        // an older revision never overwrites a newer one, so a replay is inert
        if (known && compareRevision(change.revision, known.revision) <= 0) continue
        state.docs[change.documentId] = change
        applied.add(change.documentId)
      }
      const listed = new Set(state.index)
      for (const change of changes) listed.add(change.documentId)
      state.index = [...listed]
      return { ...(await commit(state)), applied: [...applied] }
    },

    async reconcile(ids: ReadonlySet<string>, { keepDrafts }) {
      const state = await load()
      if (!state) return UNAVAILABLE
      const kept: string[] = []
      const dropped: string[] = []
      for (const documentId of state.index) {
        if (ids.has(documentId)) {
          kept.push(documentId)
          continue
        }
        if (keepDrafts && options.keepDraft && (await options.keepDraft(documentId))) {
          // local work the snapshot does not list (yet): never thrown away
          kept.push(documentId)
          continue
        }
        dropped.push(documentId)
      }
      const keep = new Set(kept)
      for (const documentId of Object.keys(state.docs)) {
        if (!keep.has(documentId)) delete state.docs[documentId]
      }
      state.index = kept
      const outcome = await commit(state)
      // only a committed reconcile drops for good: a refused one is replayed
      if (outcome.kind === 'ok') {
        for (const documentId of dropped) options.onDropped?.(documentId)
      }
      return outcome
    },
  }
}

export interface SyncRuntimeTargets {
  /** the orgs of the signed-in account (never another account's) */
  orgs(): string[]
  /** the workspaces of one org the account is a member of */
  workspaces(orgId: string): Promise<string[]>
}

export interface SyncRuntimeOptions {
  store: SyncStoreAccess
  targets: SyncRuntimeTargets
  /** the per-org capability cache read (see CapabilityCache.get) */
  capability(orgId: string): Promise<CapabilityRead>
  /** the feed client of the active deployment, or null while none is usable */
  client(): FeedClient | null
  /** true while the document has local work (a stored intent or a dirty copy) */
  keepDraft(documentId: string): Promise<boolean>
  clock: { now(): number }
  /** a capability or feed 401: hand the session its chance to re-evaluate */
  onSessionExpired?(): void
  /**
   * Runs after every pass (sign-in and each interval tick), for the durable
   * save queue the same poll drives. `online` is the pass's connectivity
   * verdict: `false` only when a capability or feed round trip actually failed
   * (a network/timeout error or a consumer backoff), `true` when a request
   * reached the server, and `undefined` when the pass simply had nothing to do
   * (no chosen org, no scope) - a no-op is neither, so it must not park the
   * queue (G506-be-3). It dispatches the pending intents and advances their
   * reconciling clocks. Awaited, so a slow dispatch cannot overlap the next pass.
   */
  onPoll?(online: boolean | undefined): Promise<void>
  /**
   * A page the feed applied and the cache committed. G8-17 S18: a document
   * renamed elsewhere is noticed from here, so its open working copy follows
   * without waiting for its tab to gain focus. Announced only for a page that
   * committed (a refused page is replayed, and would announce twice).
   */
  onFeedChange?(change: FeedChange): void
  /**
   * G5-03a: whether the id belongs to an open, bound working copy of the live
   * session. This is the only filter on the drop report - the runtime never
   * learns a local path or a binding.
   */
  isOpenBound?(documentId: string): boolean | Promise<boolean>
  /**
   * G5-03a: a successful resync no longer lists this open, bound document (its
   * permission may be gone or it was deleted). The owner classifies it with
   * one metadata read; nothing is evicted by the feed for a kept draft.
   */
  onFeedGone?(documentId: string): void
  /**
   * G5-08c: what the runtime's one lease manager needs beyond the store and
   * the clock - the lease client of the active deployment (null while none is
   * usable) and the live session id (a new sign-in resets the boundary).
   * Without it the manager has no client: every grant or renewal is offline.
   */
  lease?: SyncRuntimeLeaseOptions
  intervalMs?: number
  /** test seam: schedule `run` on the interval, return the cancel */
  schedule?(run: () => void): () => void
  log?(message: string): void
}

export interface SyncRuntimeLeaseOptions {
  client(): LeaseClient | null
  /** the live session id of the scope (the device session) */
  session?(): string | null
  /** test seam: the monotonic clock (default `performance.now()`) */
  monotonicNow?(): number
  /** revoke marks the committed cache for deletion (drafts kept) - W2/G5-05 */
  onRevoked?(notice: LeaseRevokeNotice): void
}

export class SyncRuntime {
  /** G5-08c: the offline lease manager of the signed-in session (the only one) */
  readonly leases: LeaseManager
  private readonly options: SyncRuntimeOptions
  private readonly running = new Map<string, FeedConsumer>()
  private readonly capabilities = new Map<string, OfficeCapabilities>()
  private cancel: (() => void) | null = null
  private ticking: Promise<void> | null = null
  /** bumped by stop(): a pass that started before it is no longer current */
  private generation = 0
  /** the last pass's connectivity verdict; false keeps every lease request home */
  private online: boolean | undefined = undefined

  constructor(options: SyncRuntimeOptions) {
    this.options = options
    const lease = options.lease
    this.leases = createLeaseManager({
      store: createLeaseStore(options.store),
      client: () => lease?.client() ?? null,
      clock: {
        wallNow: () => options.clock.now(),
        monotonicNow: () => lease?.monotonicNow?.() ?? Math.trunc(performance.now()),
      },
      scope: () => options.store.scope(),
      ...(lease?.session ? { session: () => lease.session?.() ?? null } : {}),
      isOnline: () => this.online !== false,
      ...(lease?.onRevoked ? { onRevoked: (notice) => lease.onRevoked?.(notice) } : {}),
      ...(options.onSessionExpired ? { onSessionExpired: options.onSessionExpired } : {}),
    })
  }

  /** starts the interval and runs one pass now (sign-in, app ready) */
  start(): void {
    if (this.cancel) return
    const intervalMs = this.options.intervalMs ?? FEED_INTERVAL_MS
    const schedule =
      this.options.schedule ??
      ((run: () => void) => {
        const timer = setInterval(run, intervalMs)
        ;(timer as { unref?: () => void }).unref?.()
        return () => clearInterval(timer)
      })
    this.cancel = schedule(() => {
      void this.tick().catch(() => undefined)
    })
    void this.tick().catch(() => undefined)
  }

  /**
   * Stops the interval and forgets every consumer (sign-out, account switch, a
   * wiped scope, an org change). The generation bump makes any run in flight
   * stop at its next await: it creates no consumer, issues no further request,
   * and cannot write back into the pass a later start owns. The leases are not
   * touched: an org change is a stop()/start() pair of the same account, and
   * the account boundary locks them itself (`leases.lockBoundary`).
   */
  stop(): void {
    this.generation += 1
    this.cancel?.()
    this.cancel = null
    // a start after this must not wait behind the run that was just cancelled
    this.ticking = null
    for (const consumer of this.running.values()) consumer.cancel()
    this.running.clear()
    this.capabilities.clear()
  }

  /** one pass; concurrent calls share it */
  tick(): Promise<void> {
    if (this.ticking) return this.ticking
    const run = this.run().finally(() => {
      // only this pass may clear itself: a stop() already dropped it
      if (this.ticking === run) this.ticking = null
    })
    this.ticking = run
    return run
  }

  /**
   * The org capability read of this runtime (the per-account cache the save
   * queue's lane verdicts share, so a `sync_write` flag is read once per
   * account and cleared on a switch for both callers).
   */
  capabilityRead(orgId: string): Promise<CapabilityRead> {
    return this.options.capability(orgId)
  }

  private async run(): Promise<void> {
    const generation = this.generation
    const current = () => this.generation === generation
    const scope = this.options.store.scope()
    const client = this.options.client()
    if (!scope || !client) {
      if (current()) this.running.clear()
      // no session to reach the server: nothing was attempted, so there is no
      // connectivity verdict to report (G506-be-3)
      await this.options.onPoll?.(undefined)
      return
    }
    const open = await this.options.store.open()
    if (!current()) return
    if (open.kind !== 'ok') {
      // no feed without the store: a cursor cannot move without its record.
      // Nothing was attempted, so there is no verdict either (G506-be-3)
      this.running.clear()
      await this.options.onPoll?.(undefined)
      return
    }
    /** whether any capability or feed round trip was attempted at all */
    let attempted = false
    /** whether an attempted capability or feed round trip failed (network/timeout) */
    let transportFailed = false

    const wanted = new Set<string>()
    let sessionExpired = false
    for (const orgId of this.options.targets.orgs()) {
      if (!current()) return
      const capability = await this.options.capability(orgId)
      if (!current()) return
      attempted = true
      if (capability.kind === 'session_expired') sessionExpired = true
      this.capabilities.set(orgId, capability.capabilities)
      if (!capability.capabilities.sync_feed) continue
      let workspaces: string[]
      try {
        workspaces = await this.options.targets.workspaces(orgId)
      } catch {
        continue
      }
      if (!current()) return
      for (const workspaceId of workspaces) {
        if (!current()) return
        const feedScope: FeedScope = { ...scope, orgId, workspaceId }
        const key = cursorKey(feedScope)
        wanted.add(key)
        const consumer = this.consumerFor(key, feedScope, open.records, client, current)
        const result = await consumer.sync()
        if (!current()) return
        if (result.kind === 'session_expired') sessionExpired = true
        // a failed or backed-off feed round trip is a real transport failure
        if (result.kind === 'failed' || result.kind === 'backoff') transportFailed = true
      }
    }
    if (!current()) return
    for (const key of [...this.running.keys()]) {
      if (!wanted.has(key)) this.running.delete(key)
    }
    if (sessionExpired) this.options.onSessionExpired?.()
    // a real failed round trip marks the queue offline, a reached one marks it
    // online, and a pass with nothing to do (no chosen org) reports neither
    // (G506-be-3)
    const verdict = attempted ? !transportFailed : undefined
    await this.options.onPoll?.(verdict)
    if (!current()) return
    // G5-08c row 2: the same verdict gates the lease renewal pass - an online
    // pass renews the held leases that are due, an offline one sends nothing
    if (verdict !== undefined) this.online = verdict
    await this.leases.onOnlinePass(verdict).catch(() => undefined)
  }

  private consumerFor(
    key: string,
    scope: FeedScope,
    records: (name: string) => StoreRecords,
    client: FeedClient,
    live: () => boolean,
  ): FeedConsumer {
    const existing = this.running.get(key)
    if (existing) return existing
    const consumer = new FeedConsumer({
      scope,
      client,
      cursors: createStoreCursorStore(records(FEED_CURSORS_REGISTRATION.name)),
      cache: this.announcingCache(
        createStoreDocCache({
          records: records(DOC_INDEX_REGISTRATION.name),
          scope,
          keepDraft: (documentId) => this.options.keepDraft(documentId),
          // a resync dropped an id: report it only while this pass is current
          // and the caller still calls it open (G5-03a)
          onDropped: (documentId) => {
            if (live()) void this.reportGone(documentId, live)
          },
        }),
      ),
      clock: this.options.clock,
      // the flags of the capability read of this pass (off -> no request)
      capability: () => ({ sync_feed: this.capabilities.get(scope.orgId)?.sync_feed ?? false }),
      ...(this.options.log ? { log: this.options.log } : {}),
    })
    this.running.set(key, consumer)
    return consumer
  }

  /**
   * A successful resync dropped this id: report it when the owner answers that
   * it belongs to an open, bound working copy. The id is the only thing the
   * runtime learns - no path, no binding - and the report is dropped once the
   * pass it belonged to is no longer current.
   */
  private async reportGone(documentId: string, live: () => boolean): Promise<void> {
    const gone = this.options.onFeedGone
    if (!gone) return
    try {
      if (!(await this.options.isOpenBound?.(documentId))) return
    } catch {
      return
    }
    if (live()) gone(documentId)
  }

  /**
   * The doc cache, plus the S18 change notice: every page the cache committed is
   * handed to `onFeedChange` once, after the commit, so a rename on the web
   * reaches an open desktop working copy. A page the cache refused announces
   * nothing (it is replayed on the next tick).
   */
  private announcingCache(cache: DocCache): DocCache {
    const notify = this.options.onFeedChange
    if (!notify) return cache
    return {
      async applyPage(changes) {
        const commit = await cache.applyPage(changes)
        // only a document whose row this commit changed is announced: a replayed
        // page (a snapshot that lists documents the cache already holds) is inert
        if (commit.kind === 'ok' && commit.applied) {
          const byId = new Map(changes.map((change) => [change.documentId, change]))
          for (const documentId of commit.applied) {
            const change = byId.get(documentId)
            if (change) notify(change)
          }
        }
        return commit
      },
      reconcile: (ids, options) => cache.reconcile(ids, options),
    }
  }
}
