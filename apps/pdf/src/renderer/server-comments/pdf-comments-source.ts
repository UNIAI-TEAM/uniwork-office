/**
 * G8-15 (UNI-1410): the PDF editor's side of the UniWork comments seam.
 *
 * - `pdfCommentsBridge()` reads `window.uniworkComments` (installed by the pdf
 *   preload, G8-08); null in a build or harness without it.
 * - `createPdfCommentsSource()` is the kit's `CollabSource` over that bridge for
 *   one working-copy path (snake_case kit <-> camelCase IPC); every reply is
 *   unwrapped in this realm, so a failure rejects with the protocol error
 *   (`code`, `details.code`, `retryable`) the kit maps (R1-1).
 * - `loadPdfCommentsContext()` asks `window.uniworkComments.context({ path })`
 *   (the shared G8-12 seam, contract §3.1) for what the server mode needs beyond
 *   the comments themselves: the document id, the version the editor has open or
 *   just saved (null while unknown), the access level and the UniWork user id.
 *   `followPdfUniworkSaves()` listens to `window.uniworkComments.onSaved`, filtered
 *   to this document's path. An error or an unbound path is the fallback (no
 *   server context): no new anchored thread, own-comment edits hidden, no anchor
 *   re-send.
 * - `sendPdfAnchorMap()` is the post-Save anchor sender, with the behaviour of the
 *   kit's `sendAnchorMap` (chunks of 500, merged answer, `anchor_version_invalid`
 *   -> `retry_next_save`, never a throw for that code).
 */
import type { CollabLevel, CollabSource } from '@genoffice/ui/collab'
import { unwrapCommentsReply } from '@genoffice/electron-utils/comments-reply'
import {
  COMMENTS_BRIDGE_KEY,
  type CommentsAnchorsInput,
  type CommentsReply,
  type UniworkCommentsApi,
} from '@genoffice/electron-utils/comments-ipc'

/** the `comments.anchors` answer (`{updated, skipped, list_token}`) */
export type PdfAnchorsResult = Extract<
  Awaited<ReturnType<UniworkCommentsApi['anchors']>>,
  { ok: true }
>['value']

/** what one post-Save anchor map round did (the shape of the kit's `AnchorSyncOutcome`) */
export type PdfAnchorSyncOutcome =
  | {
      outcome: 'synced'
      updated: string[]
      skipped: PdfAnchorsResult['skipped']
      list_token: string
    }
  /** the server does not know the version (400 `anchor_version_invalid`): anchors stay shown as stale, send again after the next Save */
  | { outcome: 'retry_next_save' }

/**
 * TEMPORARY local structural type for the G8-12 context / saved seam (names and fields
 * identical to `comments-ipc.ts` `CommentsContextResult` / `CommentsSavedPayload` and
 * `UniworkCommentsApi.context` / `onSaved`, commit 9963cb1a). This branch is still on fork
 * main, which lacks those exports: after the rebase onto G8-12 delete this block and import
 * `UniworkCommentsApi` (with both methods) and `CommentsContextResult` from electron-utils.
 */
export interface PdfCommentsContextResult {
  documentId: string
  /** the server version the editor has open or last saved; null only while truly unknown */
  versionId: string | null
  /** the caller's effective level when main knows it */
  level?: CollabLevel
  /** the signed-in UniWork user id ("mine" only, never a permission) */
  myUserId?: string
}
export interface PdfCommentsSavedPayload {
  path: string
  versionId: string
}
export interface PdfCommentsBridge extends UniworkCommentsApi {
  context(input: { path: string }): Promise<CommentsReply<PdfCommentsContextResult>>
  /** main pushes after a Save of `path` settled with a commit receipt; returns the unsubscribe */
  onSaved(handler: (payload: PdfCommentsSavedPayload) => void): () => void
}

export function pdfCommentsBridge(): PdfCommentsBridge | null {
  const bridge = (window as unknown as Record<string, PdfCommentsBridge | undefined>)[
    COMMENTS_BRIDGE_KEY
  ]
  return bridge ?? null
}

const value = <T>(reply: Promise<CommentsReply<T>>): Promise<T> =>
  reply.then((r) => unwrapCommentsReply(r))

export function createPdfCommentsSource(bridge: UniworkCommentsApi, path: string): CollabSource {
  return {
    list: (p) =>
      value(
        bridge.list({
          path,
          ...(p.kind ? { kind: p.kind } : {}),
          ...(p.since_token ? { sinceToken: p.since_token } : {}),
        }),
      ),
    create: (p) =>
      value(
        bridge.create({
          path,
          kind: p.kind,
          body: p.body,
          ...(p.parent_id ? { parentId: p.parent_id } : {}),
          ...(p.anchor ? { anchor: p.anchor } : {}),
          ...(p.base_version_id ? { baseVersionId: p.base_version_id } : {}),
        }),
      ),
    update: (p) => value(bridge.update({ path, commentId: p.comment_id, body: p.body })),
    remove: (p) => value(bridge.remove({ path, commentId: p.comment_id })),
    resolve: (p) => value(bridge.resolve({ path, commentId: p.comment_id })),
    reopen: (p) => value(bridge.reopen({ path, commentId: p.comment_id })),
    revisions: (p) => value(bridge.revisions({ path, commentId: p.comment_id })),
    searchMentions: (p) =>
      value(
        bridge.searchMentions({
          path,
          q: p.q,
          ...(p.limit !== undefined ? { limit: p.limit } : {}),
        }),
      ),
  }
}

/** protocol `COMMENTS_MAX_ANCHORS`: the most anchors one `comments.anchors` call may carry */
export const PDF_MAX_ANCHORS = 500

function isVersionInvalid(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: unknown; details?: { code?: unknown } | null }
  return e.code === 'anchor_version_invalid' || e.details?.code === 'anchor_version_invalid'
}

/**
 * Sends the anchor map for `versionId` (a Save receipt's version) in chunks of 500, one after
 * the other, and merges the answers (`list_token` = the last one). `anchor_version_invalid`
 * resolves to `retry_next_save` and never throws; any other failure rejects with the protocol
 * error. Same behaviour as the kit's `sendAnchorMap`, which replaces this after the G8-12 rebase.
 */
export async function sendPdfAnchorMap(
  bridge: UniworkCommentsApi,
  path: string,
  versionId: string,
  anchors: CommentsAnchorsInput['anchors'],
): Promise<PdfAnchorSyncOutcome> {
  const synced: PdfAnchorSyncOutcome = {
    outcome: 'synced',
    updated: [],
    skipped: [],
    list_token: '',
  }
  for (let i = 0; i < anchors.length; i += PDF_MAX_ANCHORS) {
    let result: PdfAnchorsResult
    try {
      result = await value(
        bridge.anchors({ path, versionId, anchors: anchors.slice(i, i + PDF_MAX_ANCHORS) }),
      )
    } catch (error) {
      if (isVersionInvalid(error)) return { outcome: 'retry_next_save' }
      throw error
    }
    synced.updated.push(...result.updated)
    synced.skipped.push(...result.skipped)
    synced.list_token = result.list_token
  }
  return synced
}

/**
 * What the editor needs to know about a bound document. `versionId` is the version the editor
 * has open (or just saved) and is required to start a new anchored thread (`base_version_id`);
 * null = unknown, so no new root until a Save receipt. `myUserId` only recognises "mine";
 * `level` is the caller's document level (a display hint, the server gates).
 */
export interface PdfCommentsContext {
  documentId: string
  versionId: string | null
  myUserId?: string
  level?: CollabLevel
}

const LEVELS: ReadonlySet<string> = new Set(['view', 'edit', 'manage'])

function boundedId(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 && v.length <= 128 ? v : undefined
}

/** the fallback without a server context: the path keys drafts, a read-only copy reads `view` */
export function fallbackPdfCommentsContext(path: string, readOnly: boolean): PdfCommentsContext {
  return { documentId: path, versionId: null, level: readOnly ? 'view' : 'edit' }
}

/**
 * The context of the bound document at `path`, every field validated. A missing bridge, an
 * error envelope (unbound included), a failed call or an answer without a document id is the
 * fallback; a read-only copy never writes, whatever the answer says.
 */
export async function loadPdfCommentsContext(
  bridge: Pick<PdfCommentsBridge, 'context'> | null,
  path: string,
  readOnly: boolean,
): Promise<PdfCommentsContext> {
  const fallback = fallbackPdfCommentsContext(path, readOnly)
  let raw: PdfCommentsContextResult | null = null
  try {
    if (bridge) raw = await value(bridge.context({ path }))
  } catch {
    raw = null
  }
  if (!raw || typeof raw !== 'object') return fallback
  const documentId = boundedId(raw.documentId)
  if (!documentId) return fallback
  const myUserId = boundedId(raw.myUserId)
  const level =
    typeof raw.level === 'string' && LEVELS.has(raw.level) ? raw.level : ('edit' as const)
  return {
    documentId,
    versionId: boundedId(raw.versionId) ?? null,
    ...(myUserId ? { myUserId } : {}),
    level: readOnly ? 'view' : level,
  }
}

/** subscribe to this document's save receipts; a no-op unsubscribe when the bridge has no such event */
export function followPdfUniworkSaves(
  bridge: Pick<PdfCommentsBridge, 'onSaved'>,
  path: string,
  handler: (versionId: string) => void,
): () => void {
  const off = bridge.onSaved?.((payload) => {
    if (payload?.path !== path) return
    const versionId = boundedId(payload.versionId)
    if (versionId) handler(versionId)
  })
  return off ?? (() => undefined)
}
