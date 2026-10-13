/**
 * G8-08 (UNI-1403): the UniWork comments IPC contract shared by the shell main
 * process, the six editor preloads and their tests. Pure (no Electron import),
 * like ./ai-run: the channel names, the renderer -> main request payloads
 * (camelCase, as every other shell IPC uses) and the reveal push the main
 * process sends after a launch ticket named a comment.
 *
 * The response shapes are the frame protocol's own comment DTOs
 * (web/docs/protocol/types.ts, the one source of truth vendored into D): the
 * main process forwards the UniWork API bodies unchanged, so a comment body
 * (Markdown subset + mention tokens) reaches the editor byte for byte. Only the
 * types are imported, never the runtime module.
 */
import type {
  CommentsAnchorsResult,
  CommentsDeleteResult,
  CommentsListResult,
  CommentsRevisionsResult,
  CommentResult,
  MentionsSearchResult,
} from '../../../web/docs/protocol/types'

/** one request kind of the frame protocol §10, plus the host -> editor reveal */
export const COMMENTS_CHANNELS = {
  list: 'uniwork:comments:list',
  create: 'uniwork:comments:create',
  update: 'uniwork:comments:update',
  remove: 'uniwork:comments:delete',
  resolve: 'uniwork:comments:resolve',
  reopen: 'uniwork:comments:reopen',
  revisions: 'uniwork:comments:revisions',
  anchors: 'uniwork:comments:anchors',
  searchMentions: 'uniwork:comments:search-mentions',
  /** main -> editor renderer: reveal a thread (deep link with comment_id) */
  reveal: 'uniwork:comments:reveal',
} as const

export type CommentKind = 'comment' | 'discussion'

/**
 * Every request names the working-copy `path` the editor shows (the same seam
 * `uniworkState(path)` / `getCommentAuthor(path)` use). The main process
 * resolves the binding from it; an unbound path makes no request at all.
 */
export interface CommentsDocRef {
  path: string
}

export interface CommentsListInput extends CommentsDocRef {
  kind?: CommentKind
  /** the `list_token` of the list the editor holds */
  sinceToken?: string
}

export interface CommentsCreateInput extends CommentsDocRef {
  kind: CommentKind
  parentId?: string
  body: string
  /** root `comment` threads only; the main process sends `base_version_id` with it */
  anchor?: Record<string, unknown>
  baseVersionId?: string
}

export interface CommentsUpdateInput extends CommentsDocRef {
  commentId: string
  body: string
}

export interface CommentsIdInput extends CommentsDocRef {
  commentId: string
}

export interface CommentsAnchorsInput extends CommentsDocRef {
  versionId: string
  anchors: Array<{ commentId: string; anchor: Record<string, unknown>; state: 'exact' | 'lost' }>
}

export interface MentionsSearchInput extends CommentsDocRef {
  q: string
  limit?: number
}

/** what the main process pushes to the editor after a launch ticket named a comment */
export interface CommentsRevealPayload {
  path: string
  commentId: string
}

/** the API the six editor preloads expose as `window.uniworkComments` */
export interface UniworkCommentsApi {
  list(input: CommentsListInput): Promise<CommentsListResult>
  create(input: CommentsCreateInput): Promise<CommentResult>
  update(input: CommentsUpdateInput): Promise<CommentResult>
  remove(input: CommentsIdInput): Promise<CommentsDeleteResult>
  resolve(input: CommentsIdInput): Promise<CommentResult>
  reopen(input: CommentsIdInput): Promise<CommentResult>
  revisions(input: CommentsIdInput): Promise<CommentsRevisionsResult>
  anchors(input: CommentsAnchorsInput): Promise<CommentsAnchorsResult>
  searchMentions(input: MentionsSearchInput): Promise<MentionsSearchResult>
  /** the shell asks the editor to reveal a thread; returns the unsubscribe */
  onReveal(handler: (payload: CommentsRevealPayload) => void): () => void
}

/** the global the six editor preloads expose the API under */
export const COMMENTS_BRIDGE_KEY = 'uniworkComments'

const ID_MAX = 128

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= ID_MAX
}

function isKind(value: unknown): value is CommentKind {
  return value === 'comment' || value === 'discussion'
}

/** the launch-ticket deep link carries a comment id (contract §2.9): a plain ULID-shaped string */
export function isCommentId(value: unknown): value is string {
  return isId(value)
}

/**
 * A validated reveal push, or null when the payload is malformed (main only
 * ever sends a well-formed one; the preload re-checks anyway).
 */
export function parseCommentsReveal(payload: unknown): CommentsRevealPayload | null {
  if (!isRecord(payload)) return null
  const { path, commentId } = payload
  if (typeof path !== 'string' || path.length === 0 || path.length > 4096) return null
  if (!isCommentId(commentId)) return null
  return { path, commentId }
}

/**
 * The path every request must carry, or null when the payload is malformed. The
 * main process validates each request again before it touches the store, so a
 * renderer cannot smuggle a shape through.
 */
export function readCommentsPath(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  const { path } = payload
  if (typeof path !== 'string' || path.length === 0 || path.length > 4096) return null
  return path
}

/** `comments.list`: kind is optional, sinceToken a bounded opaque token */
export function parseCommentsListInput(
  payload: unknown,
): (CommentsListInput & { path: string }) | null {
  if (!isRecord(payload)) return null
  const path = readCommentsPath(payload)
  if (!path) return null
  const { kind, sinceToken } = payload
  if (kind !== undefined && !isKind(kind)) return null
  if (sinceToken !== undefined && (typeof sinceToken !== 'string' || sinceToken.length > 512)) {
    return null
  }
  return {
    path,
    ...(kind !== undefined ? { kind } : {}),
    ...(sinceToken !== undefined ? { sinceToken } : {}),
  }
}

/** `comments.create`: kind + non-empty body, optional parent/anchor/base version */
export function parseCommentsCreateInput(payload: unknown): CommentsCreateInput | null {
  if (!isRecord(payload)) return null
  const path = readCommentsPath(payload)
  if (!path) return null
  const { kind, parentId, body, anchor, baseVersionId } = payload
  if (!isKind(kind)) return null
  if (typeof body !== 'string' || body.length === 0) return null
  if (parentId !== undefined && !isId(parentId)) return null
  if (baseVersionId !== undefined && !isId(baseVersionId)) return null
  if (anchor !== undefined && !isRecord(anchor)) return null
  return {
    path,
    kind,
    body,
    ...(parentId !== undefined ? { parentId } : {}),
    ...(anchor !== undefined ? { anchor } : {}),
    ...(baseVersionId !== undefined ? { baseVersionId } : {}),
  }
}

export function parseCommentsUpdateInput(payload: unknown): CommentsUpdateInput | null {
  if (!isRecord(payload)) return null
  const path = readCommentsPath(payload)
  if (!path) return null
  const { commentId, body } = payload
  if (!isId(commentId)) return null
  if (typeof body !== 'string' || body.length === 0) return null
  return { path, commentId, body }
}

export function parseCommentsIdInput(payload: unknown): CommentsIdInput | null {
  if (!isRecord(payload)) return null
  const path = readCommentsPath(payload)
  if (!path) return null
  const { commentId } = payload
  if (!isId(commentId)) return null
  return { path, commentId }
}

export function parseCommentsAnchorsInput(payload: unknown): CommentsAnchorsInput | null {
  if (!isRecord(payload)) return null
  const path = readCommentsPath(payload)
  if (!path) return null
  const { versionId, anchors } = payload
  if (!isId(versionId)) return null
  if (!Array.isArray(anchors) || anchors.length === 0 || anchors.length > 500) return null
  const items: CommentsAnchorsInput['anchors'] = []
  for (const entry of anchors) {
    if (!isRecord(entry)) return null
    const { commentId, anchor, state } = entry
    if (!isId(commentId)) return null
    if (!isRecord(anchor)) return null
    if (state !== 'exact' && state !== 'lost') return null
    items.push({ commentId, anchor, state })
  }
  return { path, versionId, anchors: items }
}

export function parseMentionsSearchInput(payload: unknown): MentionsSearchInput | null {
  if (!isRecord(payload)) return null
  const path = readCommentsPath(payload)
  if (!path) return null
  const { q, limit } = payload
  if (typeof q !== 'string' || q.length > 200) return null
  if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit))) return null
  return { path, q, ...(limit !== undefined ? { limit } : {}) }
}
