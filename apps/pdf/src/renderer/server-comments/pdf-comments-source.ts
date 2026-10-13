/**
 * G8-15 (UNI-1410): the PDF editor's side of the UniWork comments seam.
 *
 * - `pdfCommentsBridge()` reads `window.uniworkComments` (installed by the pdf
 *   preload, G8-08); null in a build or harness without it.
 * - `createPdfCommentsSource()` is the kit's `CollabSource` over that bridge for
 *   one working-copy path (snake_case kit <-> camelCase IPC); every reply is
 *   unwrapped in this realm, so a failure rejects with the protocol error
 *   (`code`, `details.code`, `retryable`) the kit maps (R1-1).
 * - `loadPdfCommentsContext()` asks for what the server mode needs beyond the
 *   comments themselves: the document id, the version the editor has open or
 *   just saved, the access level and the UniWork user id. The pdf preload does
 *   not expose these yet (residual R1 of the W15 report): the optional
 *   `window.pdfApi.uniworkCommentsContext()` / `onUniworkSaved()` pair is the
 *   contract a later shell piece fills, the same shape as the slides editor's
 *   `SlidesCommentsContextApi` so one main-process handler can serve every app.
 *   Like `getUsername()` it takes no path: main answers for the file the
 *   calling view shows. Until it exists the panel runs its documented fallback
 *   (no new anchored thread, own-comment edits hidden, no anchor re-send).
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

export function pdfCommentsBridge(): UniworkCommentsApi | null {
  const bridge = (window as unknown as Record<string, UniworkCommentsApi | undefined>)[
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

/** `comments.anchors` for one path; rejects with the protocol error like the source calls */
export function sendPdfAnchors(
  bridge: UniworkCommentsApi,
  input: CommentsAnchorsInput,
): Promise<PdfAnchorsResult> {
  return value(bridge.anchors(input))
}

/**
 * What the editor needs to know about a bound document. `versionId` is the
 * version the editor has open (or just saved) and is required to start a new
 * anchored thread (`base_version_id`); `userId` only recognises "mine";
 * `level` is the caller's document level (a display hint, the server gates).
 */
export interface PdfCommentsContext {
  documentId: string
  versionId?: string
  userId?: string
  level?: CollabLevel
}

/** the optional preload surface (absent until the shell serves it); `onUniworkSaved` fires after a Save's commit receipt */
export interface PdfCommentsContextApi {
  uniworkCommentsContext?(): Promise<PdfCommentsContext | null>
  onUniworkSaved?(handler: (receipt: { versionId: string }) => void): () => void
}

const LEVELS: ReadonlySet<string> = new Set(['view', 'edit', 'manage'])

function boundedId(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 && v.length <= 128 ? v : undefined
}

/** the fallback without the shell's answer: the path keys drafts, a read-only copy reads `view` */
export function fallbackPdfCommentsContext(path: string, readOnly: boolean): PdfCommentsContext {
  return { documentId: path, level: readOnly ? 'view' : 'edit' }
}

/**
 * The context of the bound document at `path`, every field validated. A missing
 * method, a failed call or an answer without a document id is the fallback; a
 * read-only copy never writes, whatever the answer says.
 */
export async function loadPdfCommentsContext(
  api: PdfCommentsContextApi | undefined,
  path: string,
  readOnly: boolean,
): Promise<PdfCommentsContext> {
  const fallback = fallbackPdfCommentsContext(path, readOnly)
  let raw: PdfCommentsContext | null
  try {
    raw = (await api?.uniworkCommentsContext?.()) ?? null
  } catch {
    raw = null
  }
  if (!raw || typeof raw !== 'object') return fallback
  const documentId = boundedId(raw.documentId)
  if (!documentId) return fallback
  const versionId = boundedId(raw.versionId)
  const userId = boundedId(raw.userId)
  const level =
    typeof raw.level === 'string' && LEVELS.has(raw.level) ? raw.level : ('edit' as const)
  return {
    documentId,
    ...(versionId ? { versionId } : {}),
    ...(userId ? { userId } : {}),
    level: readOnly ? 'view' : level,
  }
}

/** subscribe to save receipts; a no-op unsubscribe when the preload has no such event */
export function followPdfUniworkSaves(
  api: PdfCommentsContextApi | undefined,
  handler: (versionId: string) => void,
): () => void {
  const off = api?.onUniworkSaved?.((receipt) => {
    const versionId = boundedId(receipt?.versionId)
    if (versionId) handler(versionId)
  })
  return off ?? (() => undefined)
}
