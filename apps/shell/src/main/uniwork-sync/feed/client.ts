import { UniworkDocError } from '../../uniwork-docs/errors'
import { FeedError, parseFeedError } from './errors'
import { ID, createAuthorizedGet, jsonOrUndefined, type AuthorizedGetOptions } from './http'
import { REVISION } from './revision'

/**
 * Client for `GET /api/v1/workspaces/{workspaceID}/documents/changes`
 * (G5-01a `DocumentChangeListSDO`, G5-01b `DocumentChangeFeedSDO`). The cursor
 * is opaque and travels in the query only. Every failure rejects with a
 * FeedError, classified by parseFeedError so a cursor verdict is never a
 * deleted document.
 *
 * Two page shapes, one row stream: a snapshot page fills `changes`, an
 * incremental feed page (`phase` feed) fills `feed` and leaves `changes` empty
 * (the D handler's own contract). Both are read into `changes`, so the
 * consumer applies one stream. A feed removal (`change_kind` removal) carries
 * no version pointer and is not a document state; the fork has no removal path
 * yet, so only its upserts enter the stream - never a removal read as a newer
 * version.
 */

export interface FeedChange {
  documentId: string
  /** page | file | folder today; kept verbatim */
  kind: string
  /** int64 as a decimal string; compare with compareRevision */
  revision: string
  currentVersion: number
  versionId: string | null
  /**
   * R5BE-1b: a feed (G5-01b) upsert's `archived` flag. An archive does not
   * bump the revision; absent on a snapshot row, which carries no flag.
   */
  archived?: boolean
}

export interface FeedPage {
  /** `snapshot` | `feed` today; any other value is read as changes (G5-01a) */
  phase: string
  /** the page's rows: a snapshot page's `changes`, or a feed page's upserts */
  changes: FeedChange[]
  hasMore: boolean
  nextCursor: string
  expiresAt: string
}

export interface FeedClient {
  listChanges(workspaceId: string, cursor?: string, limit?: number): Promise<FeedPage>
}

export const FEED_PAGE_LIMIT_MAX = 500
const MAX_CURSOR_CHARS = 4096

/**
 * JSON.parse that keeps `revision` exact: the reviver reads the number's
 * source text where the runtime offers it, and otherwise accepts only a safe
 * integer (an unsafe one without its source is dropped -> malformed, never
 * rounded).
 */
function parseKeepingRevisions(text: string): unknown {
  return JSON.parse(text, function (key, value: unknown, context?: { source?: string }) {
    if (key !== 'revision' || typeof value !== 'number') return value
    if (typeof context?.source === 'string') return context.source
    return Number.isSafeInteger(value) ? String(value) : undefined
  }) as unknown
}

function malformed(): never {
  throw new FeedError({ kind: 'other', error: new UniworkDocError('malformed_response') })
}

/** the incremental feed page's phase (G5-01b); its rows travel in `feed` */
const FEED_PHASE = 'feed'
/** the feed row kind that carries a document state; the other kind is a removal */
const FEED_CHANGE_UPSERT = 'upsert'

function parseChange(raw: unknown): FeedChange {
  if (!raw || typeof raw !== 'object') malformed()
  const row = raw as Record<string, unknown>
  const documentId = row.document_id
  const kind = row.kind
  const revision = row.revision
  const currentVersion = row.current_version
  const versionId = row.version_id ?? null
  if (typeof documentId !== 'string' || !ID.test(documentId)) malformed()
  if (typeof kind !== 'string' || !kind) malformed()
  if (typeof revision !== 'string' || !REVISION.test(revision)) malformed()
  if (typeof currentVersion !== 'number' || !Number.isSafeInteger(currentVersion)) malformed()
  if (currentVersion < 0) malformed()
  if (versionId !== null && (typeof versionId !== 'string' || !versionId)) malformed()
  return { documentId, kind, revision, currentVersion, versionId }
}

/**
 * One `feed` row (G5-01b): an upsert is the same row a snapshot page carries
 * (ids, kind, revision, version pointer) and is read by the same parser; a
 * removal is ids-only with no document state, so it is not part of the row
 * stream this consumer applies - dropping it is deliberate, never a removal
 * mistaken for a newer version.
 */
function parseFeedChange(raw: unknown): FeedChange | null {
  if (!raw || typeof raw !== 'object') malformed()
  if ((raw as Record<string, unknown>).change_kind !== FEED_CHANGE_UPSERT) return null
  const change = parseChange(raw)
  const archived = (raw as Record<string, unknown>).archived
  return typeof archived === 'boolean' ? { ...change, archived } : change
}

export function parseFeedPage(text: string): FeedPage {
  let raw: unknown
  try {
    raw = parseKeepingRevisions(text)
  } catch {
    malformed()
  }
  if (!raw || typeof raw !== 'object') malformed()
  const page = raw as Record<string, unknown>
  const { phase, changes, feed, has_more: hasMore, next_cursor: nextCursor } = page
  const expiresAt = page.expires_at ?? ''
  if (typeof phase !== 'string' || !phase) malformed()
  if (!Array.isArray(changes)) malformed()
  if (typeof hasMore !== 'boolean') malformed()
  if (typeof nextCursor !== 'string' || !nextCursor || nextCursor.length > MAX_CURSOR_CHARS) {
    malformed()
  }
  if (typeof expiresAt !== 'string') malformed()
  // a feed page (G5-01b) carries its rows in `feed` and leaves `changes` empty:
  // reading only `changes` would silently drop every committed change the
  // snapshot did not see (G5-03a live I1-I5)
  let rows: FeedChange[]
  if (phase === FEED_PHASE) {
    if (!Array.isArray(feed)) malformed()
    rows = feed.map(parseFeedChange).filter((change): change is FeedChange => change !== null)
  } else {
    rows = changes.map(parseChange)
  }
  return { phase, changes: rows, hasMore, nextCursor, expiresAt }
}

export function createFeedClient(options: AuthorizedGetOptions): FeedClient {
  const get = createAuthorizedGet(options)
  return {
    async listChanges(workspaceId, cursor, limit) {
      if (!ID.test(workspaceId)) {
        throw new FeedError({ kind: 'other', error: new UniworkDocError('not_found') })
      }
      const query = new URLSearchParams()
      if (cursor) query.set('cursor', cursor)
      if (limit !== undefined) {
        query.set('limit', String(Math.min(FEED_PAGE_LIMIT_MAX, Math.max(1, Math.floor(limit)))))
      }
      const outcome = await get(
        `/workspaces/${encodeURIComponent(workspaceId)}/documents/changes`,
        query,
      )
      if (outcome.kind === 'session_expired') throw new FeedError({ kind: 'session_expired' })
      if (outcome.kind === 'failed') throw new FeedError({ kind: 'other', error: outcome.error })
      if (outcome.status < 200 || outcome.status >= 300) {
        throw new FeedError(parseFeedError(outcome.status, jsonOrUndefined(outcome.text)))
      }
      return parseFeedPage(outcome.text)
    },
  }
}
