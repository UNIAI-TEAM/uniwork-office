/**
 * G8-12 (UNI-1407): the seam this module consumes (lane contract §3), in one place: the kit source
 * adapter + anchor sender (§3.2, `@genoffice/ui/collab`) and the shape of `window.uniworkComments`
 * the editor reads (desktop preload §3.1, or the web frame bridge §3.3).
 */
import type { UniworkCommentsLike } from '@genoffice/ui/collab'

export {
  COLLAB_MAX_ANCHORS,
  createUniworkCommentsSource,
  sendAnchorMap,
  type AnchorSyncOutcome,
  type CollabAnchor,
  type CollabAnchorAdapter,
  type CollabAnchorUpdate,
  type CollabAnchorsResult,
  type CollabComment,
  type CollabHostState,
  type CollabKind,
  type CollabLevel,
  type CollabSource,
} from '@genoffice/ui/collab'

export interface ServerCommentsContext {
  documentId: string
  /** null: the open version is unknown (no new root comment can be anchored) */
  versionId: string | null
  level?: 'view' | 'edit' | 'manage'
  myUserId?: string
}

type Reply<T> = { ok: true; value: T } | { ok: false; error: unknown }

/** `window.uniworkComments` as the editor uses it (electron-utils `UniworkCommentsApi` / the frame port) */
export interface ServerCommentsApi extends UniworkCommentsLike {
  /** desktop: the return value is ignored; web: `true` only when this editor owns (and revealed) the id */
  onReveal(
    handler: (payload: { path: string; commentId: string }) => void | boolean | Promise<boolean>,
  ): () => void
  context(input: { path: string }): Promise<Reply<ServerCommentsContext>>
  /** a Save of `path` settled with a commit receipt */
  onSaved(handler: (payload: { path: string; versionId: string }) => void): () => void
}

declare global {
  interface Window {
    uniworkComments?: ServerCommentsApi
    /** web frame: settles once the frame comments API is installed (or found not granted) */
    uniworkCommentsReady?: Promise<unknown>
  }
}
