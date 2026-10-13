import { UniworkDocError } from '../../uniwork-docs/errors'
import type { FeedChange, FeedClient, FeedPage } from './client'
import { cursorKey, type CursorStore, type FeedScope } from './cursor-store'
import { FeedError } from './errors'

/**
 * Pulls one workspace's change feed into the local document cache.
 *
 * - With a saved cursor every page is applied, then its next cursor is saved:
 *   the cursor only moves after `applyPage` committed the page, so a crash
 *   between the two replays the same page (DocCache.applyPage is idempotent by
 *   id + revision) and a refused page never moves the cursor at all.
 * - Without one (cold start, `change_cursor_expired`, `change_cursor_invalid`)
 *   it runs a full resync: every snapshot page is applied, the cache is
 *   reconciled to exactly the ids seen (drafts kept, lost-permission entries
 *   evicted), and only then is the final cursor saved. A crash mid-resync
 *   leaves no cursor, so the next run starts the snapshot over.
 * - An invalid cursor is cleared and earns exactly one resync per run; a feed
 *   cursor the server answers with 501 `unsupported_operation` (G5-01a's
 *   `errChangeFeedPending`: genuine cursor, no incremental feed yet) is
 *   treated the same - cleared, rebuilt from a snapshot in the same pass,
 *   never surfaced as a failure and never as a deletion. A resync refused
 *   again by a cursor verdict backs off exponentially (capped) on the
 *   injected clock instead of looping, and a 501 inside a resync is a
 *   failure, so a server stuck on 501 cannot loop either.
 * - `sync_feed` off -> no feed request at all.
 *
 * One consumer per scope; the cursor key is
 * `${deploymentId}/${accountId}/${orgId}/${workspaceId}`, so another account,
 * org or deployment never reads or moves this stream's cursor or cache.
 */

/** why a cache commit failed; the cursor must not move past a page that failed */
export type DocCacheCommitFailure = 'store_full' | 'store_unavailable'

/**
 * The outcome of one cache commit: `failed` means nothing of it is on disk.
 * `applied` (ok only) names the documents whose row this commit actually
 * changed — a replayed page reports none, so a change notice never repeats for
 * a document the cache already held.
 */
export type DocCacheCommit =
  { kind: 'ok'; applied?: readonly string[] } | { kind: 'failed'; failure: DocCacheCommitFailure }

export interface DocCache {
  /** upsert the page's rows as one atomic step; a replayed page has no further effect */
  applyPage(changes: readonly FeedChange[]): Promise<DocCacheCommit>
  /** full resync: keep exactly `ids` (plus local drafts), evict every other cached entry */
  reconcile(ids: ReadonlySet<string>, options: { keepDrafts: true }): Promise<DocCacheCommit>
}

export interface FeedClock {
  now(): number
}

export interface FeedCapability {
  sync_feed: boolean
}

export interface FeedConsumerOptions {
  scope: FeedScope
  client: FeedClient
  cursors: CursorStore
  cache: DocCache
  clock: FeedClock
  capability: () => FeedCapability
  pageLimit?: number
  /** first resync backoff (default 30 s), doubled per refusal up to `backoffMaxMs` (default 30 min) */
  backoffBaseMs?: number
  backoffMaxMs?: number
  log?: (message: string) => void
}

export type FeedSyncResult =
  | { kind: 'disabled' }
  | { kind: 'synced'; pages: number; resynced: boolean }
  | { kind: 'backoff'; retryAt: number }
  | { kind: 'session_expired' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; error: UniworkDocError }
  /**
   * The cache refused the page's commit: nothing of the page is on disk, the
   * cursor stays on it and the cache's own failure rides along. `store_full` is
   * the budget; `store_unavailable` is an interrupted (or wiped) scope - an
   * account-boundary interruption, never a keychain lock.
   */
  | { kind: 'cache_refused'; failure: DocCacheCommitFailure }

export const FEED_BACKOFF_BASE_MS = 30_000
export const FEED_BACKOFF_MAX_MS = 30 * 60_000
const KNOWN_PHASES = new Set(['snapshot', 'changes'])

/** a commit that did not land: the page stays unapplied and the cache's own verdict is carried */
function commitFailed(commit: DocCacheCommit & { kind: 'failed' }): FeedSyncResult {
  return { kind: 'cache_refused', failure: commit.failure }
}

type PageRun =
  | { kind: 'done'; pages: number }
  | { kind: 'cursor_expired' }
  | { kind: 'cursor_invalid' }
  /** G5-01a answered a feed cursor with 501 unsupported_operation (errChangeFeedPending) */
  | { kind: 'feed_cursor_unsupported'; error: UniworkDocError }
  | { kind: 'stopped'; result: FeedSyncResult }

type FetchOutcome = ({ kind: 'page' } & FeedPage) | Exclude<PageRun, { kind: 'done' }>

export class FeedConsumer {
  private readonly options: FeedConsumerOptions
  private readonly key: string
  private running: Promise<FeedSyncResult> | null = null
  private resyncRefusals = 0
  private retryAt = 0
  private loggedPhases = new Set<string>()
  private cancelled = false

  constructor(options: FeedConsumerOptions) {
    this.options = options
    this.key = cursorKey(options.scope)
  }

  /** one run at a time; a call while one is in flight joins it */
  sync(): Promise<FeedSyncResult> {
    this.running ??= this.run().finally(() => {
      this.running = null
    })
    return this.running
  }

  /**
   * The owning runtime stopped (sign-out, account switch, a wiped scope): the
   * run ends at its next await, issues no further request and moves no cursor.
   */
  cancel(): void {
    this.cancelled = true
  }

  private enabled(): boolean {
    return this.options.capability().sync_feed === true
  }

  /** the run must not go on: cancelled, or the capability turned off */
  private stopReason(): FeedSyncResult | null {
    if (this.cancelled) return { kind: 'cancelled' }
    if (!this.enabled()) return { kind: 'disabled' }
    return null
  }

  private async run(): Promise<FeedSyncResult> {
    const stopped = this.stopReason()
    if (stopped) return stopped
    if (this.options.clock.now() < this.retryAt) return { kind: 'backoff', retryAt: this.retryAt }
    const cursor = await this.options.cursors.get(this.key)
    const cancelled = this.stopReason()
    if (cancelled) return cancelled
    if (cursor) {
      const run = await this.incremental(cursor)
      if (run.kind === 'stopped') return run.result
      if (run.kind === 'done') return { kind: 'synced', pages: run.pages, resynced: false }
      // Drop a cursor the server refused: 400 is a cursor of another scope (or
      // a tamper), 501 is G5-01a's errChangeFeedPending - the feed cursor is
      // genuine, the incremental feed is simply not there yet. Either way the
      // pass rebuilds from a snapshot below, once: resync is entered a single
      // time here, and a 501 answered inside it is a failure (see resync), so
      // a server stuck on 501 cannot loop.
      if (run.kind === 'cursor_invalid' || run.kind === 'feed_cursor_unsupported') {
        if (run.kind === 'feed_cursor_unsupported') {
          this.options.log?.(
            'uniwork feed: the incremental feed is not available; rebuilding from a snapshot',
          )
        }
        await this.options.cursors.clear(this.key)
      }
    }
    return this.resync()
  }

  private async incremental(start: string): Promise<PageRun> {
    let cursor = start
    let pages = 0
    for (;;) {
      const stopped = this.stopReason()
      if (stopped) return { kind: 'stopped', result: stopped }
      const page = await this.fetch(cursor)
      const afterFetch = this.stopReason()
      if (afterFetch) return { kind: 'stopped', result: afterFetch }
      if (page.kind !== 'page') return page
      const applied = await this.options.cache.applyPage(page.changes)
      // a page the store refused is never skipped: no cursor move, the page
      // comes back on the next tick
      if (applied.kind !== 'ok') return { kind: 'stopped', result: commitFailed(applied) }
      const beforeCommit = this.stopReason()
      if (beforeCommit) return { kind: 'stopped', result: beforeCommit }
      await this.options.cursors.set(this.key, page.nextCursor)
      pages += 1
      // a server that hands back the same cursor would loop forever
      if (!page.hasMore || page.nextCursor === cursor) return { kind: 'done', pages }
      cursor = page.nextCursor
    }
  }

  private async resync(): Promise<FeedSyncResult> {
    const seen = new Set<string>()
    let cursor: string | undefined
    let pages = 0
    for (;;) {
      const stopped = this.stopReason()
      if (stopped) return stopped
      const page = await this.fetch(cursor)
      const afterFetch = this.stopReason()
      if (afterFetch) return afterFetch
      if (page.kind === 'stopped') return page.result
      // a 501 to a resync request (the first one carries no cursor at all): the
      // server cannot serve this feed, and a fallback of a fallback would loop
      if (page.kind === 'feed_cursor_unsupported') return { kind: 'failed', error: page.error }
      if (page.kind !== 'page') return this.backOff()
      const applied = await this.options.cache.applyPage(page.changes)
      if (applied.kind !== 'ok') return commitFailed(applied)
      for (const change of page.changes) seen.add(change.documentId)
      pages += 1
      const done = !page.hasMore || page.nextCursor === cursor
      cursor = page.nextCursor
      if (done) break
    }
    const reconciled = await this.options.cache.reconcile(seen, { keepDrafts: true })
    // an unfinished resync keeps no cursor at all, so the next run starts over
    if (reconciled.kind !== 'ok') return commitFailed(reconciled)
    const stopped = this.stopReason()
    if (stopped) return stopped
    // the loop ran at least once, so cursor is the final page's next cursor
    if (cursor) await this.options.cursors.set(this.key, cursor)
    this.resyncRefusals = 0
    this.retryAt = 0
    return { kind: 'synced', pages, resynced: true }
  }

  private backOff(): FeedSyncResult {
    this.resyncRefusals += 1
    const base = this.options.backoffBaseMs ?? FEED_BACKOFF_BASE_MS
    const max = this.options.backoffMaxMs ?? FEED_BACKOFF_MAX_MS
    const delay = Math.min(max, base * 2 ** Math.min(this.resyncRefusals - 1, 30))
    this.retryAt = this.options.clock.now() + delay
    return { kind: 'backoff', retryAt: this.retryAt }
  }

  private async fetch(cursor: string | undefined): Promise<FetchOutcome> {
    try {
      const page = await this.options.client.listChanges(
        this.options.scope.workspaceId,
        cursor,
        this.options.pageLimit,
      )
      if (!KNOWN_PHASES.has(page.phase) && !this.loggedPhases.has(page.phase)) {
        this.loggedPhases.add(page.phase)
        this.options.log?.(`uniwork feed: unknown phase, applied as changes`)
      }
      return { kind: 'page', ...page }
    } catch (error) {
      if (!(error instanceof FeedError)) throw error
      const failure = error.failure
      if (failure.kind === 'cursor_expired' || failure.kind === 'cursor_invalid') {
        return { kind: failure.kind }
      }
      if (failure.kind === 'feed_cursor_unsupported') {
        return { kind: 'feed_cursor_unsupported', error: failure.error }
      }
      if (failure.kind === 'session_expired') {
        return { kind: 'stopped', result: { kind: 'session_expired' } }
      }
      return { kind: 'stopped', result: { kind: 'failed', error: failure.error } }
    }
  }
}
