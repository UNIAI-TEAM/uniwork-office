/**
 * Shared collab (server comments + Discussion) types.
 *
 * The collab module never imports from `web/docs/protocol` or an app: these are structural copies of the
 * `comments.*` DTOs (`web/docs/protocol/types.ts`), and a host passes its own `comments.*` client in as a
 * `CollabSource`. `tests/collab-protocol-shape.test.ts` keeps the copies assignable from the protocol.
 */
import type { Lang } from '@genoffice/i18n'

export type CollabLevel = 'view' | 'comment' | 'edit' | 'manage'
export type CollabKind = 'comment' | 'discussion'
export type CollabAnchorState = 'exact' | 'stale' | 'lost'

/** a position in the document: `format` + `v`, then the per-format keys (server-owned schema) */
export interface CollabAnchor {
  format: string
  v: number
  [k: string]: unknown
}

/** G8-18: one mentioned user who could not view the document when the comment was saved */
export interface CollabMentionWithoutAccess {
  user_id: string
  display_name?: string
  can_share: boolean
}

/** one comment or discussion post (protocol `DocumentComment`) */
export interface CollabComment {
  id: string
  document_id: string
  /** null: a system / AI author without an id (never "mine") */
  author_id?: string | null
  parent_id?: string | null
  /** '' for a tombstone */
  body: string
  kind?: string
  revision?: number
  anchor?: CollabAnchor | null
  anchor_state?: string | null
  resolved_at?: string | null
  /** set = a tombstone ("the content was deleted") */
  deleted_at?: string | null
  created_at?: string
  updated_at?: string
  display_name?: string
  avatar_url?: string
  /** G8-18: mentioned people without view access on create/update response */
  mentions_without_access?: CollabMentionWithoutAccess[]
  [k: string]: unknown
}

/** the current name of an id used in a mention token */
export interface CollabMention {
  user_id: string
  display_name?: string
  avatar_url?: string
  /** 'unavailable': show the token label, no link */
  state: 'ok' | 'unavailable'
}

/** `unchanged: true`: keep what is held; otherwise replace the whole list */
export interface CollabListResult {
  comments: CollabComment[]
  mentions: CollabMention[]
  list_token: string
  unchanged: boolean
}

export interface CollabRevision {
  id: string
  revision: number
  body: string
  created_by_id: string | null
  created_at: string
}

export interface CollabCandidate {
  user_id: string
  display_name: string
  avatar_url?: string
  email?: string
  /** G8-18: false when returned by `include: 'no_access'` and the candidate cannot view the document */
  can_view?: boolean
  /** G8-18: whether the caller may grant View access to this candidate (defaults to true when omitted) */
  can_share?: boolean
}

/** the error every source call rejects with: `code` = protocol error code, `detailsCode` = `details.code` */
export interface CollabError {
  code:
    | 'conflict'
    | 'malformed'
    | 'invalid_arg'
    | 'unauthorized'
    | 'forbidden'
    | 'not_found'
    | 'too_large'
    | 'network'
    | 'internal'
    | 'unsupported'
    | 'not_ready'
    | (string & Record<never, never>)
  detailsCode?: string
  retryable?: boolean
}

/** Reads `{code, details?.code, retryable}` from whatever a source threw; anything else is `internal`. */
export function toCollabError(e: unknown): CollabError {
  if (e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'string') {
    const err = e as { code: string; details?: unknown; detailsCode?: unknown; retryable?: unknown }
    const details = err.details
    const fromDetails =
      details &&
      typeof details === 'object' &&
      typeof (details as { code?: unknown }).code === 'string'
        ? (details as { code: string }).code
        : undefined
    const detailsCode = typeof err.detailsCode === 'string' ? err.detailsCode : fromDetails
    const out: CollabError = { code: err.code }
    if (detailsCode !== undefined) out.detailsCode = detailsCode
    if (typeof err.retryable === 'boolean') out.retryable = err.retryable
    return out
  }
  return { code: 'internal' }
}

/** the host's `comments.*` client (the frame client on the web, `window.uniworkComments` on desktop) */
export interface CollabSource {
  list(p: { kind?: CollabKind; since_token?: string }): Promise<CollabListResult>
  create(p: {
    kind: CollabKind
    parent_id?: string
    body: string
    anchor?: CollabAnchor
    base_version_id?: string
  }): Promise<{ comment: CollabComment }>
  update(p: { comment_id: string; body: string }): Promise<{ comment: CollabComment }>
  remove(p: { comment_id: string }): Promise<{ outcome: 'tombstoned' | 'removed' }>
  resolve(p: { comment_id: string }): Promise<{ comment: CollabComment }>
  reopen(p: { comment_id: string }): Promise<{ comment: CollabComment }>
  revisions(p: { comment_id: string }): Promise<{ revisions: CollabRevision[] }>
  searchMentions(p: {
    q: string
    limit?: number
    include?: 'no_access'
  }): Promise<{ candidates: CollabCandidate[] }>
  /** G8-18: true when the caller may list workspace members so `searchMentions` passes `include: 'no_access'` */
  canListMembers?: boolean
  /** G8-18: grant View access to a mentioned user (protocol `comments.shareView`) */
  shareView?(p: { user_id: string }): Promise<{ ok: true }>
  /**
   * G8-12: re-anchor root comments to `version_id` after a Save receipt (protocol `comments.anchors`).
   * Optional: a Discussion source never has it. Send through `sendAnchorMap`, which chunks and maps
   * `anchor_version_invalid`.
   */
  anchors?(p: { version_id: string; anchors: CollabAnchorUpdate[] }): Promise<CollabAnchorsResult>
}

/** one re-anchored root comment; the editor reports found (`exact`) or not found (`lost`), never `stale` */
export interface CollabAnchorUpdate {
  comment_id: string
  anchor: CollabAnchor
  state: 'exact' | 'lost'
}

/** a comment the server did not re-anchor, and why */
export interface CollabAnchorSkip {
  comment_id: string
  reason: 'older_version' | 'not_applicable'
}

/** protocol `CommentsAnchorsResult`: `list_token` is never a since_token - reload when `updated` is not empty */
export interface CollabAnchorsResult {
  updated: string[]
  skipped: CollabAnchorSkip[]
  list_token: string
}

/**
 * what an editor plugs in for anchored comments; absent for Discussion.
 * Pass a stable object (e.g. `useMemo`): a new adapter on every render recomputes the thread views
 * and re-renders lists that did not change.
 */
export interface CollabAnchorAdapter {
  /** sort key for the open list (doc order / sheet,row,col / slide_index / page,top) */
  order(anchor: CollabAnchor): number | string
  /** true when the editor can locate the anchor in the open model (`stale` shows only when false) */
  locate(anchor: CollabAnchor): boolean
  /** move the editor to the anchor without stealing focus from the panel item that asked */
  goTo(anchor: CollabAnchor): void
  /** the active sheet name for xlsx labels; undefined otherwise */
  activeSheet?(): string | undefined
  /** the display name of a sheet id in an xlsx anchor; undefined when the workbook has no such sheet */
  sheetName?(sheetId: string): string | undefined
}

/** what the host knows about the document and the user */
export interface CollabHostState {
  documentId: string
  kind: CollabKind
  /** undefined: actions on own comments only */
  level: CollabLevel | undefined
  myUserId?: string
  lang: Lang
  /** picks the Send shortcut text */
  platform: 'mac' | 'other'
  /** G8-18: host capability flags from `InitPayload.capabilities` */
  capabilities?: {
    commentsShareView?: boolean
  }
  /** G8-18: convenience alias for `capabilities.commentsShareView` */
  commentsShareView?: boolean
  /** G8-18: true when the caller may list workspace members (`include: 'no_access'`) */
  canListMembers?: boolean
}
