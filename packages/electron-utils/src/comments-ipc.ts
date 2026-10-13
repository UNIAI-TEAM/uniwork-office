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
  ProtocolErrorShape,
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
  /**
   * editor -> main (R1-2): pull the reveal main held for the sender's path; the
   * answer is the held `CommentsRevealPayload` or null, and the hold is cleared
   */
  revealPending: 'uniwork:comments:reveal:pending',
  /**
   * G8-12 (UNI-1407): editor -> main (invoke `{ path }`): the server context of
   * the bound document the sender shows (`CommentsContextResult`)
   */
  context: 'uniwork:comments:context',
  /** G8-12: main -> editor renderer: a Save of `path` settled with a commit receipt */
  saved: 'uniwork:comments:saved',
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

/** the caller's effective level on the document (contract-collab §10) */
export type CommentsLevel = 'view' | 'edit' | 'manage'

/**
 * G8-12 (UNI-1407): what `context` answers for a bound document. Main resolves
 * every field from the binding and the session; the renderer never supplies a
 * document or version id.
 */
export interface CommentsContextResult {
  documentId: string
  /** the server version the editor has open or last saved; null only while truly unknown */
  versionId: string | null
  /** the caller's effective level when main knows it; undefined = own-comments-only rule (contract-collab §10) */
  level?: CommentsLevel
  /** the signed-in UniWork user id ("mine" only, never a permission) */
  myUserId?: string
}

/** main pushes this after a Save of `path` settled with a commit receipt */
export interface CommentsSavedPayload {
  path: string
  versionId: string
}

/**
 * What every `uniwork:comments:*` handler answers (R1-1). Electron forwards
 * only an `Error`'s `message` across `ipcMain.handle` -> `ipcRenderer.invoke`,
 * so a thrown `DocsProtocolError` would lose `code`, `retryable` and `details`:
 * the handler answers the protocol error's serializable shape as data, the
 * preload forwards the envelope unchanged (an Error rehydrated there would lose
 * those fields again on the contextBridge) and the renderer rehydrates it in its
 * own realm (see ./comments-reply).
 */
export type CommentsReply<T> = { ok: true; value: T } | { ok: false; error: ProtocolErrorShape }

/**
 * the API the six editor preloads expose as `window.uniworkComments`: every call
 * resolves to the `CommentsReply` envelope, never rejects with a protocol error
 */
export interface UniworkCommentsApi {
  list(input: CommentsListInput): Promise<CommentsReply<CommentsListResult>>
  create(input: CommentsCreateInput): Promise<CommentsReply<CommentResult>>
  update(input: CommentsUpdateInput): Promise<CommentsReply<CommentResult>>
  remove(input: CommentsIdInput): Promise<CommentsReply<CommentsDeleteResult>>
  resolve(input: CommentsIdInput): Promise<CommentsReply<CommentResult>>
  reopen(input: CommentsIdInput): Promise<CommentsReply<CommentResult>>
  revisions(input: CommentsIdInput): Promise<CommentsReply<CommentsRevisionsResult>>
  anchors(input: CommentsAnchorsInput): Promise<CommentsReply<CommentsAnchorsResult>>
  searchMentions(input: MentionsSearchInput): Promise<CommentsReply<MentionsSearchResult>>
  /**
   * the shell asks the editor to reveal a thread; returns the unsubscribe.
   * The first subscribe also pulls the reveal main held for this window (R1-2),
   * so a cold-start reveal decided before the editor mounted is not lost.
   */
  onReveal(handler: (payload: CommentsRevealPayload) => void): () => void
  /** G8-12: the server context (document id, open version, level, my id) of the bound document */
  context(input: CommentsDocRef): Promise<CommentsReply<CommentsContextResult>>
  /** main pushes after a Save of `path` settled with a commit receipt; returns the unsubscribe */
  onSaved(handler: (payload: CommentsSavedPayload) => void): () => void
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

/**
 * the launch-ticket deep link carries a comment id (contract §2.9): a bounded
 * opaque id (1..128); the server validates the shape
 */
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

/**
 * `context`: only the path is read; a document or version id the renderer adds
 * is dropped (main resolves both from the binding)
 */
export function parseCommentsContextInput(payload: unknown): CommentsDocRef | null {
  const path = readCommentsPath(payload)
  return path ? { path } : null
}

/** A validated saved push, or null when the payload is malformed. */
export function parseCommentsSaved(payload: unknown): CommentsSavedPayload | null {
  const path = readCommentsPath(payload)
  if (!path) return null
  const { versionId } = payload as Record<string, unknown>
  if (!isId(versionId)) return null
  return { path, versionId }
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

/** `comments.create`: kind + non-empty body, optional parent/anchor/base version (OQ-C2 shape rules) */
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
  // OQ-C2: root comment = anchor + base version; reply = neither; discussion = no anchor
  if (anchor !== undefined && baseVersionId === undefined) return null
  if (parentId !== undefined) {
    if (anchor !== undefined || baseVersionId !== undefined) return null
  } else if (kind === 'discussion') {
    if (anchor !== undefined) return null
  } else if (anchor === undefined) {
    return null
  }
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
  // an empty round is a server no-op (contract §2.6 asks for the field, not for
  // a non-empty one); the 500 anchor cap stays
  if (!Array.isArray(anchors) || anchors.length > 500) return null
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

/**
 * G8-11 (UNI-1406): the shell's Discussion panel bridge. The panel lives in the
 * shell renderer (one panel for every editor), so it gets its own channels:
 * main accepts them only from the shell webContents of a window, only for a
 * path that is an open tab of that window AND bound, and forces
 * `kind: 'discussion'` on list/create. The editor preloads never see these.
 */
export const DISCUSSION_CHANNELS = {
  list: 'uniwork:discussion:list',
  create: 'uniwork:discussion:create',
  update: 'uniwork:discussion:update',
  remove: 'uniwork:discussion:delete',
  resolve: 'uniwork:discussion:resolve',
  reopen: 'uniwork:discussion:reopen',
  revisions: 'uniwork:discussion:revisions',
  searchMentions: 'uniwork:discussion:search-mentions',
  /** main -> shell renderer: a launch ticket named a comment of `path` */
  reveal: 'uniwork:discussion:reveal',
  /**
   * shell -> main (invoke `{ path }`): arm the shell listener for `path` and
   * pull the reveal held for it; answers the held payload or null
   */
  revealPending: 'uniwork:discussion:reveal:pending',
  /** shell -> main (send `{ path }`): the listener for `path` is gone */
  revealRelease: 'uniwork:discussion:reveal:release',
  /** shell -> main (send `{ open, width }`): narrow / restore the active editor view */
  panel: 'uniwork:discussion:panel',
} as const

/** the global the shell preload exposes the discussion bridge under */
export const DISCUSSION_BRIDGE_KEY = 'uniworkDiscussion'

export interface DiscussionListInput extends CommentsDocRef {
  sinceToken?: string
}

/** a discussion post or reply: never an anchor, never a base version */
export interface DiscussionCreateInput extends CommentsDocRef {
  parentId?: string
  body: string
}

export interface DiscussionPanelInput {
  open: boolean
  /** the width (CSS px) the shell draws the panel at */
  width: number
}

/**
 * `window.uniworkDiscussion` (shell preload only). Every call resolves to the
 * `CommentsReply` envelope, like `UniworkCommentsApi`.
 */
export interface UniworkDiscussionApi {
  list(input: DiscussionListInput): Promise<CommentsReply<CommentsListResult>>
  create(input: DiscussionCreateInput): Promise<CommentsReply<CommentResult>>
  update(input: CommentsUpdateInput): Promise<CommentsReply<CommentResult>>
  remove(input: CommentsIdInput): Promise<CommentsReply<CommentsDeleteResult>>
  resolve(input: CommentsIdInput): Promise<CommentsReply<CommentResult>>
  reopen(input: CommentsIdInput): Promise<CommentsReply<CommentResult>>
  revisions(input: CommentsIdInput): Promise<CommentsReply<CommentsRevisionsResult>>
  searchMentions(input: MentionsSearchInput): Promise<CommentsReply<MentionsSearchResult>>
  /**
   * Reveals of `path` (the comment id). Subscribing arms main's push for that
   * path and pulls the reveal main held for it (delivered once); returns the
   * unsubscribe, which disarms the push again.
   */
  onReveal(path: string, handler: (commentId: string) => void): () => void
  /** main narrows the active editor view by the (clamped) panel width */
  setPanel(input: DiscussionPanelInput): void
}

/** `comments.list` for the Discussion panel: the kind is forced, never read */
export function parseDiscussionListInput(payload: unknown): CommentsListInput | null {
  if (!isRecord(payload)) return null
  const path = readCommentsPath(payload)
  if (!path) return null
  const { kind, sinceToken } = payload
  if (kind !== undefined && kind !== 'discussion') return null
  if (sinceToken !== undefined && (typeof sinceToken !== 'string' || sinceToken.length > 512)) {
    return null
  }
  return { path, kind: 'discussion', ...(sinceToken !== undefined ? { sinceToken } : {}) }
}

/**
 * `comments.create` for the Discussion panel: kind forced to 'discussion'; an
 * anchor, a base version or another kind is refused (OQ-C2: a discussion post
 * has no anchor)
 */
export function parseDiscussionCreateInput(payload: unknown): CommentsCreateInput | null {
  if (!isRecord(payload)) return null
  const path = readCommentsPath(payload)
  if (!path) return null
  const { kind, parentId, body, anchor, baseVersionId } = payload
  if (kind !== undefined && kind !== 'discussion') return null
  if (anchor !== undefined || baseVersionId !== undefined) return null
  if (typeof body !== 'string' || body.length === 0) return null
  if (parentId !== undefined && !isId(parentId)) return null
  return { path, kind: 'discussion', body, ...(parentId !== undefined ? { parentId } : {}) }
}

/** the `{ path }` of a reveal pull / release, or null when malformed */
export function parseDiscussionRevealRequest(payload: unknown): { path: string } | null {
  const path = readCommentsPath(payload)
  return path ? { path } : null
}

export function parseDiscussionPanelInput(payload: unknown): DiscussionPanelInput | null {
  if (!isRecord(payload)) return null
  const { open, width } = payload
  if (typeof open !== 'boolean') return null
  if (typeof width !== 'number' || !Number.isFinite(width)) return null
  return { open, width }
}

/** the panel never goes narrower / wider than this, and leaves the editor this much */
export const DISCUSSION_PANEL_LIMITS = { min: 280, max: 560, editorMin: 360 } as const

/**
 * The width main takes off the active editor view for an open panel: the
 * request clamped to [min, max], then capped so the editor keeps `editorMin`
 * (a narrow window shrinks the panel below `min`; 0 when even the editor does
 * not fit). The shell draws the panel at the same
 * width, so both sides use this one function.
 */
export function clampDiscussionPanelWidth(requested: number, contentWidth: number): number {
  if (!Number.isFinite(requested) || !Number.isFinite(contentWidth)) return 0
  const { min, max, editorMin } = DISCUSSION_PANEL_LIMITS
  const wanted = Math.round(Math.min(max, Math.max(min, requested)))
  return Math.max(0, Math.min(wanted, Math.floor(contentWidth) - editorMin))
}
