import type { CapabilityRead, OfficeCapabilities } from './capability/cache'
import type { FeedChange, FeedClient } from './feed/client'
import { FeedConsumer, type DocCache } from './feed/consumer'
import { cursorKey, type CursorStore, type FeedScope } from './feed/cursor-store'
import type { SyncStoreAccess } from './session-store'
import { APP_STORE_LEVEL } from './store-level'
import type { StoreRecords, StoreRegistration } from './store'

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

/** the doc ids the index knows for one workspace */
function indexKey(scope: FeedScope): string {
  return `${scope.orgId}/${scope.workspaceId}/index`
}

function docKey(scope: FeedScope, documentId: string): string {
  return `${scope.orgId}/${scope.workspaceId}/${documentId}`
}

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

export interface StoreDocCacheOptions {
  records: StoreRecords
  scope: FeedScope
  /** true while the document has local work (a stored intent or a dirty copy) */
  keepDraft?(documentId: string): Promise<boolean>
}

/**
 * The doc index of one workspace: one record per listed document plus one
 * inventory record naming the ids the index holds. `applyPage` writes the
 * page's rows first and the inventory last, so a crash leaves either the old
 * inventory or the complete page (a replay is idempotent by document id);
 * the consumer saves the stream's cursor only after this resolved. `reconcile`
 * walks the inventory: every id the snapshot no longer lists loses its record
 * unless it is kept as a draft. Documents the snapshot still lists keep
 * theirs.
 */
export function createStoreDocCache(options: StoreDocCacheOptions): DocCache {
  const { records, scope } = options
  const keyOf = (documentId: string) => docKey(scope, documentId)
  const loadIndex = async (): Promise<string[]> => {
    const read = await records.read(indexKey(scope))
    return read.kind === 'ok' ? decodeJson<string[]>(read.value, []) : []
  }
  const saveIndex = async (ids: readonly string[]): Promise<void> => {
    await records.write(indexKey(scope), encodeJson([...ids]))
  }

  return {
    async applyPage(changes: readonly FeedChange[]) {
      for (const change of changes) {
        const written = await records.write(keyOf(change.documentId), encodeJson(change))
        if (written.kind !== 'ok') return
      }
      const known = new Set(await loadIndex())
      for (const change of changes) known.add(change.documentId)
      await saveIndex([...known])
    },

    async reconcile(ids: ReadonlySet<string>, { keepDrafts }) {
      const kept: string[] = []
      for (const documentId of await loadIndex()) {
        if (ids.has(documentId)) {
          kept.push(documentId)
          continue
        }
        if (keepDrafts && options.keepDraft && (await options.keepDraft(documentId))) {
          // local work the snapshot does not list (yet): never thrown away
          kept.push(documentId)
          continue
        }
        await records.delete(keyOf(documentId))
      }
      await saveIndex(kept)
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
    this.cancel = schedule(() => void this.tick())
    void this.tick()
  }

  /** stops the interval and forgets every consumer (sign-out, account switch, a wiped scope) */
  stop(): void {
    this.cancel?.()
    this.cancel = null
    this.running.clear()
  }

  /** one pass; concurrent calls share it */
  tick(): Promise<void> {
    this.ticking ??= this.run().finally(() => {
      this.ticking = null
    })
    return this.ticking
  }

  private async run(): Promise<void> {
    const scope = this.options.store.scope()
    const client = this.options.client()
    if (!scope || !client) {
      this.running.clear()
      return
    }
    const open = await this.options.store.open()
    if (open.kind !== 'ok') {
      // no feed without the store: a cursor cannot move without its record
      this.running.clear()
      return
    }

    const wanted = new Set<string>()
    let sessionExpired = false
    for (const orgId of this.options.targets.orgs()) {
      const capability = await this.options.capability(orgId)
      if (capability.kind === 'session_expired') sessionExpired = true
      this.capabilities.set(orgId, capability.capabilities)
      if (!capability.capabilities.sync_feed) continue
      let workspaces: string[]
      try {
        workspaces = await this.options.targets.workspaces(orgId)
      } catch {
        continue
      }
      for (const workspaceId of workspaces) {
        const feedScope: FeedScope = { ...scope, orgId, workspaceId }
        const key = cursorKey(feedScope)
        wanted.add(key)
        const consumer = this.consumerFor(key, feedScope, open.records, client)
        const result = await consumer.sync()
        if (result.kind === 'session_expired') sessionExpired = true
      }
    }
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
