import type {
  WorkNotificationDocument,
  WorkNotificationDocumentPage,
} from '../../shared/uniwork-work-api'
import { UniworkDocError } from '../uniwork-docs/errors'

/**
 * Reader for GET /me/notifications/{id}/documents: `{documents, next_cursor}`.
 * Lenient per row (the server skips what the caller can no longer read, and a
 * purged document has no title or kind), strict on the envelope: a reply with
 * no `documents` list is `malformed_response`. Only the documented fields are
 * kept; anything else never reaches the renderer.
 */

/** the longest cursor the client can send back (the server's sealed token is far shorter) */
export const NOTIFICATION_CURSOR_MAX = 4096

function parseDocument(value: unknown): WorkNotificationDocument | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const r = value as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) return null
  return {
    id: r.id,
    title: typeof r.title === 'string' ? r.title : '',
    kind: typeof r.kind === 'string' ? r.kind : '',
    trashed: r.trashed === true,
    shelved: r.shelved === true,
    deleted: r.deleted === true,
  }
}

export function parseNotificationDocumentPage(raw: unknown): WorkNotificationDocumentPage {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new UniworkDocError('malformed_response')
  }
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.documents)) throw new UniworkDocError('malformed_response')
  const documents: WorkNotificationDocument[] = []
  for (const row of r.documents) {
    const doc = parseDocument(row)
    if (doc) documents.push(doc)
  }
  const cursor = r.next_cursor
  return {
    documents,
    // an unusable cursor ends the paging instead of failing the page already read
    next_cursor:
      typeof cursor === 'string' && cursor !== '' && cursor.length <= NOTIFICATION_CURSOR_MAX
        ? cursor
        : null,
  }
}
