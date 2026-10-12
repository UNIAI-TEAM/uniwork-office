import type { UniworkDocError } from '../../uniwork-docs/errors'
import type { FeedChange, FeedClient, FeedPage } from './client'
import { cursorKey, type CursorStore, type FeedScope } from './cursor-store'
import { FeedError } from './errors'

/**
 * Pulls one workspace's change feed into the local document cache.
 *
 * - With a saved cursor every page is applied, then its next cursor is saved:
 *   the cursor only moves after `applyPage` resolved, so a crash between the
 *   two replays the same page (DocCache.applyPage is idempotent by id +
 *   revision).
 * - Without one (cold start, `change_cursor_expired`, `change_cursor_invalid`)
 *   it runs a full resync: every snapshot page is applied, the cache is
 *   reconciled to exactly the ids seen (drafts kept, lost-permission entries
 *   evicted), and only then is the final cursor saved. A crash mid-resync
 *   leaves no cursor, so the next run starts the snapshot over.
 * - An invalid cursor is cleared and earns exactly one resync per run; a
 *   resync refused again by a cursor verdict backs off exponentially (capped)
 *   on the injected clock instead of looping.
 * - `sync_feed` off -> no feed request at all.
 *
 * One consumer per scope; the cursor key is
 * `${deploymentId}/${accountId}/${orgId}/${workspaceId}`, so another account,
 * org or deployment never reads or moves this stream's cursor or cache.
 */

export interface DocCache {
  /** upsert the page's rows as one atomic step; a replayed page has no further effect */
  applyPage(changes: readonly FeedChange[]): Promise<void>
  /** full resync: keep exactly `ids` (plus local drafts), evict every other cached entry */
  reconcile(ids: ReadonlySet<string>, options: { keepDrafts: true }): Promise<void>
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
  | { kind: 'failed'; error: UniworkDocError }

export const FEED_BACKOFF_BASE_MS = 30_000
export const FEED_BACKOFF_MAX_MS = 30 * 60_000
const KNOWN_PHASES = new Set(['snapshot', 'changes'])

type PageRun =
  | { kind: 'done'; pages: number }
  | { kind: 'cursor_expired' }
  | { kind: 'cursor_invalid' }
  | { kind: 'stopped'; result: FeedSyncResult }

type FetchOutcome = ({ kind: 'page' } & FeedPage) | Exclude<PageRun, { kind: 'done' }>

export class FeedConsumer {
  private readonly options: FeedConsumerOptions
  private readonly key: string
  private running: Promise<FeedSyncResult> | null = null
  private resyncRefusals = 0
  private retryAt = 0
  private loggedPhases = new Set<string>()

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

  private enabled(): boolean {
    return this.options.capability().sync_feed === true
  }

  private async run(): Promise<FeedSyncResult> {
    if (!this.enabled()) return { kind: 'disabled' }
    if (this.options.clock.now() < this.retryAt) return { kind: 'backoff', retryAt: this.retryAt }
    const cursor = await this.options.cursors.get(this.key)
    if (cursor) {
      const run = await this.incremental(cursor)
      if (run.kind === 'stopped') return run.result
      if (run.kind === 'done') return { kind: 'synced', pages: run.pages, resynced: false }
      if (run.kind === 'cursor_invalid') await this.options.cursors.clear(this.key)
    }
    return this.resync()
  }

  private async incremental(start: string): Promise<PageRun> {
    let cursor = start
    let pages = 0
    for (;;) {
      if (!this.enabled()) return { kind: 'stopped', result: { kind: 'disabled' } }
      const page = await this.fetch(cursor)
      if (page.kind !== 'page') return page
      await this.options.cache.applyPage(page.changes)
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
      if (!this.enabled()) return { kind: 'disabled' }
      const page = await this.fetch(cursor)
      if (page.kind === 'stopped') return page.result
      if (page.kind !== 'page') return this.backOff()
      await this.options.cache.applyPage(page.changes)
      for (const change of page.changes) seen.add(change.documentId)
      pages += 1
      const done = !page.hasMore || page.nextCursor === cursor
      cursor = page.nextCursor
      if (done) break
    }
    await this.options.cache.reconcile(seen, { keepDrafts: true })
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
      if (failure.kind === 'session_expired') {
        return { kind: 'stopped', result: { kind: 'session_expired' } }
      }
      return { kind: 'stopped', result: { kind: 'failed', error: failure.error } }
    }
  }
}
