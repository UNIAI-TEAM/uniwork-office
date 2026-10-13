import { UniworkDocError } from '../../uniwork-docs/errors'
import { FeedError, parseFeedError } from './errors'
import { ID, createAuthorizedGet, jsonOrUndefined, type AuthorizedGetOptions } from './http'
import { REVISION } from './revision'

/**
 * Client for `GET /api/v1/workspaces/{workspaceID}/documents/changes`
 * (G5-01a `DocumentChangeListSDO`). The cursor is opaque and travels in the
 * query only. Every failure rejects with a FeedError, classified by
 * parseFeedError so a cursor verdict is never a deleted document.
 */

export interface FeedChange {
  documentId: string
  /** page | file | folder today; kept verbatim */
  kind: string
  /** int64 as a decimal string; compare with compareRevision */
  revision: string
  currentVersion: number
  versionId: string | null
}

export interface FeedPage {
  /** `snapshot` today; G5-01b adds an incremental phase, any other value is read as changes */
  phase: string
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

export function parseFeedPage(text: string): FeedPage {
  let raw: unknown
  try {
    raw = parseKeepingRevisions(text)
  } catch {
    malformed()
  }
  if (!raw || typeof raw !== 'object') malformed()
  const page = raw as Record<string, unknown>
  const { phase, changes, has_more: hasMore, next_cursor: nextCursor } = page
  const expiresAt = page.expires_at ?? ''
  if (typeof phase !== 'string' || !phase) malformed()
  if (!Array.isArray(changes)) malformed()
  if (typeof hasMore !== 'boolean') malformed()
  if (typeof nextCursor !== 'string' || !nextCursor || nextCursor.length > MAX_CURSOR_CHARS) {
    malformed()
  }
  if (typeof expiresAt !== 'string') malformed()
  return { phase, changes: changes.map(parseChange), hasMore, nextCursor, expiresAt }
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
