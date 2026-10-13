import type { CapabilityRead, OfficeCapabilities } from './capability/cache'
import type { FeedChange, FeedClient } from './feed/client'
import { FeedConsumer, type DocCache, type DocCacheCommit } from './feed/consumer'
import { cursorKey, type CursorStore, type FeedScope } from './feed/cursor-store'
import { compareRevision } from './feed/revision'
import type { SyncStoreAccess } from './session-store'
import { APP_STORE_LEVEL } from './store-level'
import type { StoreReadResult, StoreRecords, StoreRegistration, StoreWriteResult } from './store'

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
      for (const change of changes) {
        const known = state.docs[change.documentId]
        // an older revision never overwrites a newer one, so a replay is inert
        if (known && compareRevision(change.revision, known.revision) <= 0) continue
        state.docs[change.documentId] = change
      }
      const listed = new Set(state.index)
      for (const change of changes) listed.add(change.documentId)
      state.index = [...listed]
      return commit(state)
    },

    async reconcile(ids: ReadonlySet<string>, { keepDrafts }) {
      const state = await load()
      if (!state) return UNAVAILABLE
      const kept: string[] = []
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
      }
      const keep = new Set(kept)
      for (const documentId of Object.keys(state.docs)) {
        if (!keep.has(documentId)) delete state.docs[documentId]
      }
      state.index = kept
      return commit(state)
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
  intervalMs?: number
  /** test seam: schedule `run` on the interval, return the cancel */
  schedule?(run: () => void): () => void
  log?(message: string): void
}

export class SyncRuntime {
  private readonly options: SyncRuntimeOptions
  private readonly running = new Map<string, FeedConsumer>()
  private readonly capabilities = new Map<string, OfficeCapabilities>()
  private cancel: (() => void) | null = null
  private ticking: Promise<void> | null = null
  /** bumped by stop(): a pass that started before it is no longer current */
  private generation = 0

  constructor(options: SyncRuntimeOptions) {
    this.options = options
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
   * wiped scope). The generation bump makes any run in flight stop at its next
   * await: it creates no consumer, issues no further request, and cannot write
   * back into the pass a later start owns.
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

  private async run(): Promise<void> {
    const generation = this.generation
    const current = () => this.generation === generation
    const scope = this.options.store.scope()
    const client = this.options.client()
    if (!scope || !client) {
      if (current()) this.running.clear()
      return
    }
    const open = await this.options.store.open()
    if (!current()) return
    if (open.kind !== 'ok') {
      // no feed without the store: a cursor cannot move without its record
      this.running.clear()
      return
    }

    const wanted = new Set<string>()
    let sessionExpired = false
    for (const orgId of this.options.targets.orgs()) {
      if (!current()) return
      const capability = await this.options.capability(orgId)
      if (!current()) return
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
        const consumer = this.consumerFor(key, feedScope, open.records, client)
        const result = await consumer.sync()
        if (!current()) return
        if (result.kind === 'session_expired') sessionExpired = true
      }
    }
    if (!current()) return
    for (const key of [...this.running.keys()]) {
      if (!wanted.has(key)) this.running.delete(key)
    }
    if (sessionExpired) this.options.onSessionExpired?.()
  }

  private consumerFor(
    key: string,
    scope: FeedScope,
    records: (name: string) => StoreRecords,
    client: FeedClient,
  ): FeedConsumer {
    const existing = this.running.get(key)
    if (existing) return existing
    const consumer = new FeedConsumer({
      scope,
      client,
      cursors: createStoreCursorStore(records(FEED_CURSORS_REGISTRATION.name)),
      cache: createStoreDocCache({
        records: records(DOC_INDEX_REGISTRATION.name),
        scope,
        keepDraft: (documentId) => this.options.keepDraft(documentId),
      }),
      clock: this.options.clock,
      // the flags of the capability read of this pass (off -> no request)
      capability: () => ({ sync_feed: this.capabilities.get(scope.orgId)?.sync_feed ?? false }),
      ...(this.options.log ? { log: this.options.log } : {}),
    })
    this.running.set(key, consumer)
    return consumer
  }
}
