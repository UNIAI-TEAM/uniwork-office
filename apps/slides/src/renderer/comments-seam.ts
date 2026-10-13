/**
 * G8-14: the shape of the shared editor comments seam this app reads (G8-12 lane contract §3.1):
 * `window.uniworkComments.context({path})` and `.onSaved(handler)`.
 *
 * TEMPORARY, the one place that declares it: these types mirror 9963cb1a
 * (`packages/electron-utils/src/comments-ipc.ts`: CommentsContextResult, CommentsSavedPayload,
 * UniworkCommentsApi.context / .onSaved) because this branch is cut from a fork main that does not
 * export them yet. The rebase onto G8-12 replaces this file with the shared exports.
 */
import type { CommentsReply, UniworkCommentsApi } from '@genoffice/electron-utils/comments-ipc'

export interface CommentsContextResult {
  documentId: string
  /** the server version the editor has open or last saved; null only while truly unknown */
  versionId: string | null
  /** the caller's effective level when main knows it; undefined = own-comments-only rule */
  level?: 'view' | 'edit' | 'manage'
  /** the signed-in UniWork user id ("mine" only, never a permission) */
  myUserId?: string
}

export interface CommentsSavedPayload {
  path: string
  versionId: string
}

/** `UniworkCommentsApi` as it is after 9963cb1a */
export interface UniworkCommentsSeamApi extends UniworkCommentsApi {
  context(input: { path: string }): Promise<CommentsReply<CommentsContextResult>>
  /** main pushes after a Save of `path` settled with a commit receipt; returns the unsubscribe */
  onSaved(handler: (payload: CommentsSavedPayload) => void): () => void
}
