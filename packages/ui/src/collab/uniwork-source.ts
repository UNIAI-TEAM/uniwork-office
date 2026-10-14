/**
 * G8-12 (UNI-1407): the `CollabSource` over an editor's `window.uniworkComments` and the post-Save
 * anchor map sender. The desktop preload and the web frame bridge expose the same camelCase API whose
 * calls resolve to a reply envelope; the kit declares that API structurally here (no import from
 * electron-utils or the protocol) and turns an error envelope into a thrown `CollabError`.
 */
import type {
  CollabAnchorSkip,
  CollabAnchorUpdate,
  CollabAnchorsResult,
  CollabCandidate,
  CollabComment,
  CollabError,
  CollabKind,
  CollabListResult,
  CollabRevision,
  CollabSource,
} from './types'
import { toCollabError } from './types'

/** protocol `COMMENTS_MAX_ANCHORS`: the most anchors one `comments.anchors` call may carry */
export const COLLAB_MAX_ANCHORS = 500

/** what every `window.uniworkComments` call resolves to */
export type CollabReply<T> =
  | { ok: true; value: T }
  | {
      ok: false
      error: { code: string; message?: string; retryable?: boolean; details?: unknown }
    }

/** the slice of `window.uniworkComments` (electron-utils `UniworkCommentsApi`) a source needs */
export interface UniworkCommentsLike {
  list(input: {
    path: string
    kind?: CollabKind
    sinceToken?: string
  }): Promise<CollabReply<CollabListResult>>
  create(input: {
    path: string
    kind: CollabKind
    parentId?: string
    body: string
    anchor?: Record<string, unknown>
    baseVersionId?: string
  }): Promise<CollabReply<{ comment: CollabComment }>>
  update(input: {
    path: string
    commentId: string
    body: string
  }): Promise<CollabReply<{ comment: CollabComment }>>
  remove(input: {
    path: string
    commentId: string
  }): Promise<CollabReply<{ outcome: 'tombstoned' | 'removed' }>>
  resolve(input: {
    path: string
    commentId: string
  }): Promise<CollabReply<{ comment: CollabComment }>>
  reopen(input: {
    path: string
    commentId: string
  }): Promise<CollabReply<{ comment: CollabComment }>>
  revisions(input: {
    path: string
    commentId: string
  }): Promise<CollabReply<{ revisions: CollabRevision[] }>>
  anchors(input: {
    path: string
    versionId: string
    anchors: Array<{ commentId: string; anchor: Record<string, unknown>; state: 'exact' | 'lost' }>
  }): Promise<CollabReply<CollabAnchorsResult>>
  searchMentions(input: {
    path: string
    q: string
    limit?: number
  }): Promise<CollabReply<{ candidates: CollabCandidate[] }>>
}

/** the error a source call rejects with: an `Error` carrying the `CollabError` fields */
class CollabSourceError extends Error implements CollabError {
  readonly code: string
  readonly detailsCode?: string
  readonly retryable?: boolean

  constructor(error: CollabError) {
    super(`comments: ${error.code}`)
    this.name = 'CollabSourceError'
    this.code = error.code
    if (error.detailsCode !== undefined) this.detailsCode = error.detailsCode
    if (error.retryable !== undefined) this.retryable = error.retryable
  }
}

async function unwrap<T>(call: () => Promise<CollabReply<T>>): Promise<T> {
  let reply: CollabReply<T> | null | undefined
  try {
    reply = await call()
  } catch {
    // the bridge itself failed (a gone IPC, a closed port): nothing the server said
    throw new CollabSourceError({ code: 'internal' })
  }
  if (reply && typeof reply === 'object' && reply.ok === true) return reply.value
  const error =
    reply && typeof reply === 'object' ? (reply as { error?: unknown }).error : undefined
  throw new CollabSourceError(error === undefined ? { code: 'internal' } : toCollabError(error))
}

/**
 * A `CollabSource` for the document at `path` over `api` (`window.uniworkComments`). `kind` is the
 * list filter when the caller names none. Every call resolves to the reply value or rejects with a
 * `CollabError` (`code`, `detailsCode` = `details.code`, `retryable`).
 */
export function createUniworkCommentsSource(
  api: UniworkCommentsLike,
  path: string,
  kind: CollabKind,
): CollabSource {
  return {
    list: (p) =>
      unwrap(() =>
        api.list({
          path,
          kind: p.kind ?? kind,
          ...(p.since_token !== undefined ? { sinceToken: p.since_token } : {}),
        }),
      ),
    create: (p) =>
      unwrap(() =>
        api.create({
          path,
          kind: p.kind,
          ...(p.parent_id !== undefined ? { parentId: p.parent_id } : {}),
          body: p.body,
          ...(p.anchor !== undefined ? { anchor: p.anchor } : {}),
          ...(p.base_version_id !== undefined ? { baseVersionId: p.base_version_id } : {}),
        }),
      ),
    update: (p) => unwrap(() => api.update({ path, commentId: p.comment_id, body: p.body })),
    remove: (p) => unwrap(() => api.remove({ path, commentId: p.comment_id })),
    resolve: (p) => unwrap(() => api.resolve({ path, commentId: p.comment_id })),
    reopen: (p) => unwrap(() => api.reopen({ path, commentId: p.comment_id })),
    revisions: (p) => unwrap(() => api.revisions({ path, commentId: p.comment_id })),
    searchMentions: (p) =>
      unwrap(() =>
        api.searchMentions({ path, q: p.q, ...(p.limit !== undefined ? { limit: p.limit } : {}) }),
      ),
    anchors: (p) =>
      unwrap(() =>
        api.anchors({
          path,
          versionId: p.version_id,
          anchors: p.anchors.map((a) => ({
            commentId: a.comment_id,
            anchor: a.anchor,
            state: a.state,
          })),
        }),
      ),
  }
}

/** what one post-Save anchor map round did */
export type AnchorSyncOutcome =
  | { outcome: 'synced'; updated: string[]; skipped: CollabAnchorSkip[]; list_token: string }
  /** the server does not know `versionId` (400 `anchor_version_invalid`): keep the anchors shown as stale and send again after the next Save */
  | { outcome: 'retry_next_save' }

function isVersionInvalid(error: CollabError): boolean {
  return error.code === 'anchor_version_invalid' || error.detailsCode === 'anchor_version_invalid'
}

/**
 * Sends the editor's anchor map for `versionId` (a Save receipt's version) in chunks of
 * `COLLAB_MAX_ANCHORS`, one after the other, and merges the answers (`list_token` = the last one).
 * `anchor_version_invalid` resolves to `retry_next_save`; any other failure rejects with a
 * `CollabError`. An empty map sends nothing.
 */
export async function sendAnchorMap(
  source: CollabSource,
  versionId: string,
  updates: readonly CollabAnchorUpdate[],
): Promise<AnchorSyncOutcome> {
  const synced: AnchorSyncOutcome = { outcome: 'synced', updated: [], skipped: [], list_token: '' }
  if (updates.length === 0) return synced
  if (!source.anchors) throw new CollabSourceError({ code: 'unsupported', retryable: false })
  for (let start = 0; start < updates.length; start += COLLAB_MAX_ANCHORS) {
    let result: CollabAnchorsResult
    try {
      result = await source.anchors({
        version_id: versionId,
        anchors: updates.slice(start, start + COLLAB_MAX_ANCHORS),
      })
    } catch (raw) {
      const error = toCollabError(raw)
      if (isVersionInvalid(error)) return { outcome: 'retry_next_save' }
      throw raw instanceof CollabSourceError ? raw : new CollabSourceError(error)
    }
    synced.updated.push(...result.updated)
    synced.skipped.push(...result.skipped)
    synced.list_token = result.list_token
  }
  return synced
}
