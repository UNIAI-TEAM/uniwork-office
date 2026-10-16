/**
 * G8-15 (UNI-1410): the PDF editor's side of the UniWork comments seam that is not in the
 * shared kit (`@genoffice/ui/collab`).
 *
 * The source over `window.uniworkComments` (`createUniworkCommentsSource`) and the post-Save
 * anchor sender (`sendAnchorMap`) come from the kit, as in Docs and Sheets; this module only
 * holds what the PDF editor needs around them:
 *
 * - `pdfCommentsBridge()` reads `window.uniworkComments` (installed by the pdf preload, G8-08);
 *   null in a build or harness without it.
 * - `loadPdfCommentsContext()` asks `window.uniworkComments.context({ path })` (the shared G8-12
 *   seam, contract §3.1) for what the server mode needs beyond the comments themselves: the
 *   document id, the version the editor has open or just saved (null while unknown), the access
 *   level and the UniWork user id. `followPdfUniworkSaves()` listens to
 *   `window.uniworkComments.onSaved`, filtered to this document's path. An error or an unbound
 *   path is the fallback (no server context): no new anchored thread, own-comment edits hidden,
 *   no anchor re-send.
 */
import type { CollabLevel } from '@genoffice/ui/collab'
import { unwrapCommentsReply } from '@genoffice/electron-utils/comments-reply'
import {
  COMMENTS_BRIDGE_KEY,
  type CommentsContextResult,
  type CommentsReply,
  type UniworkCommentsApi,
} from '@genoffice/electron-utils/comments-ipc'

export function pdfCommentsBridge(): UniworkCommentsApi | null {
  const bridge = (window as unknown as Record<string, UniworkCommentsApi | undefined>)[
    COMMENTS_BRIDGE_KEY
  ]
  return bridge ?? null
}

const value = <T>(reply: Promise<CommentsReply<T>>): Promise<T> =>
  reply.then((r) => unwrapCommentsReply(r))

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

const LEVELS: ReadonlySet<string> = new Set(['view', 'comment', 'edit', 'manage'])

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
  bridge: Pick<UniworkCommentsApi, 'context'> | null,
  path: string,
  readOnly: boolean,
): Promise<PdfCommentsContext> {
  const fallback = fallbackPdfCommentsContext(path, readOnly)
  let raw: CommentsContextResult | null = null
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
  bridge: Pick<UniworkCommentsApi, 'onSaved'>,
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
