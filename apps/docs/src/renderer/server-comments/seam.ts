/**
 * G8-12 (UNI-1407): the seam this module consumes (lane contract §3), in one place.
 *
 * LOCAL FAKE until the seam worker's branch merges: `createUniworkCommentsSource`, `sendAnchorMap` and
 * their types are coded against lane contract §3.2 here; once the kit ships them this file re-exports
 * them from `@genoffice/ui/collab` and the copies below go away. The `window.uniworkComments` shape
 * (§3.1 desktop preload, §3.3 web frame) is declared here as a structural type for the same reason.
 */
import {
  toCollabError,
  type CollabAnchor,
  type CollabKind,
  type CollabSource,
} from '@genoffice/ui/collab'

export type {
  CollabAnchor,
  CollabAnchorAdapter,
  CollabComment,
  CollabHostState,
  CollabKind,
  CollabLevel,
  CollabSource,
} from '@genoffice/ui/collab'

type Reply<T> = { ok: true; value: T } | { ok: false; error: unknown }

/** what the editor reads from `window.uniworkComments` (desktop preload or the web frame bridge) */
export interface ServerCommentsApi {
  list(input: { path: string; kind?: CollabKind; sinceToken?: string }): Promise<Reply<unknown>>
  create(input: {
    path: string
    kind: CollabKind
    parentId?: string
    body: string
    anchor?: Record<string, unknown>
    baseVersionId?: string
  }): Promise<Reply<unknown>>
  update(input: { path: string; commentId: string; body: string }): Promise<Reply<unknown>>
  remove(input: { path: string; commentId: string }): Promise<Reply<unknown>>
  resolve(input: { path: string; commentId: string }): Promise<Reply<unknown>>
  reopen(input: { path: string; commentId: string }): Promise<Reply<unknown>>
  revisions(input: { path: string; commentId: string }): Promise<Reply<unknown>>
  anchors(input: {
    path: string
    versionId: string
    anchors: Array<{ commentId: string; anchor: Record<string, unknown>; state: 'exact' | 'lost' }>
  }): Promise<Reply<unknown>>
  searchMentions(input: { path: string; q: string; limit?: number }): Promise<Reply<unknown>>
  /** desktop: void; web: whether the editor panel owns (and revealed) the id */
  onReveal(
    handler: (payload: { path: string; commentId: string }) => void | boolean | Promise<boolean>,
  ): () => void
  /** §3.1 */
  context(input: { path: string }): Promise<Reply<ServerCommentsContext>>
  /** §3.1: a Save of `path` settled with a commit receipt */
  onSaved(handler: (payload: { path: string; versionId: string }) => void): () => void
}

export interface ServerCommentsContext {
  documentId: string
  versionId: string | null
  level?: 'view' | 'edit' | 'manage'
  myUserId?: string
}

declare global {
  interface Window {
    uniworkComments?: ServerCommentsApi
  }
}

// ---- §3.2 kit additions (fake until the seam merges) ----

export const COLLAB_MAX_ANCHORS = 500

export interface CollabAnchorUpdate {
  comment_id: string
  anchor: CollabAnchor
  state: 'exact' | 'lost'
}

export interface CollabAnchorsResult {
  updated: string[]
  skipped: Array<{ comment_id: string; reason: 'older_version' | 'not_applicable' }>
  list_token: string
}

export type AnchorSyncOutcome =
  | ({ outcome: 'synced' } & CollabAnchorsResult)
  | { outcome: 'retry_next_save' }

export type CollabSourceWithAnchors = CollabSource & {
  anchors?(p: { version_id: string; anchors: CollabAnchorUpdate[] }): Promise<CollabAnchorsResult>
}

function unwrap<T>(reply: Reply<unknown>): T {
  if (reply.ok) return reply.value as T
  throw toCollabError(reply.error)
}

export function createUniworkCommentsSource(
  api: ServerCommentsApi,
  path: string,
  kind: CollabKind,
): CollabSourceWithAnchors {
  const v = <T>(p: Promise<Reply<unknown>>) => p.then((r) => unwrap<T>(r))
  return {
    list: (p) =>
      v(
        api.list({
          path,
          kind: p.kind ?? kind,
          ...(p.since_token ? { sinceToken: p.since_token } : {}),
        }),
      ),
    create: (p) =>
      v(
        api.create({
          path,
          kind: p.kind,
          body: p.body,
          ...(p.parent_id ? { parentId: p.parent_id } : {}),
          ...(p.anchor ? { anchor: p.anchor } : {}),
          ...(p.base_version_id ? { baseVersionId: p.base_version_id } : {}),
        }),
      ),
    update: (p) => v(api.update({ path, commentId: p.comment_id, body: p.body })),
    remove: (p) => v(api.remove({ path, commentId: p.comment_id })),
    resolve: (p) => v(api.resolve({ path, commentId: p.comment_id })),
    reopen: (p) => v(api.reopen({ path, commentId: p.comment_id })),
    revisions: (p) => v(api.revisions({ path, commentId: p.comment_id })),
    searchMentions: (p) =>
      v(api.searchMentions({ path, q: p.q, ...(p.limit !== undefined ? { limit: p.limit } : {}) })),
    anchors: (p) =>
      v(
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

export async function sendAnchorMap(
  source: CollabSourceWithAnchors,
  versionId: string,
  updates: CollabAnchorUpdate[],
): Promise<AnchorSyncOutcome> {
  const merged: CollabAnchorsResult = { updated: [], skipped: [], list_token: '' }
  if (updates.length === 0) return { outcome: 'synced', ...merged }
  if (!source.anchors) throw { code: 'unsupported' }
  for (let i = 0; i < updates.length; i += COLLAB_MAX_ANCHORS) {
    try {
      const r = await source.anchors({
        version_id: versionId,
        anchors: updates.slice(i, i + COLLAB_MAX_ANCHORS),
      })
      merged.updated.push(...r.updated)
      merged.skipped.push(...r.skipped)
      merged.list_token = r.list_token
    } catch (e) {
      const err = toCollabError(e)
      if (err.code === 'anchor_version_invalid' || err.detailsCode === 'anchor_version_invalid') {
        return { outcome: 'retry_next_save' }
      }
      throw err
    }
  }
  return { outcome: 'synced', ...merged }
}
