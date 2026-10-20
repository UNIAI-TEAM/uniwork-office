/**
 * Type shim (G8-13): the shared collab kit (`@genoffice/ui/collab`, packages/ui/src/collab) ships as
 * TS source written for the default compiler options and fails sheets' stricter ones
 * (exactOptionalPropertyTypes/noUncheckedIndexedAccess). tsconfig paths point type resolution here;
 * the runtime bundle and the tests still use the real kit. Only the part the server-comment panel
 * uses is declared; keep the signatures in sync with packages/ui/src/collab (types.ts,
 * use-collab-threads.ts, uniwork-source.ts, CollabPanel.tsx, CollabThread.tsx, strings.ts,
 * live-region.ts); `type-checks/ui-collab-shim.ts` fails `npm run typecheck` when they drift.
 */
import type { ReactElement, ReactNode } from 'react'
import type { Lang } from '@genoffice/i18n'

export type CollabLevel = 'view' | 'comment' | 'edit' | 'manage'
export type CollabKind = 'comment' | 'discussion'

export interface CollabAnchor {
  format: string
  v: number
  [k: string]: unknown
}

export interface CollabComment {
  id: string
  document_id: string
  author_id?: string | null | undefined
  parent_id?: string | null | undefined
  body: string
  kind?: string | undefined
  revision?: number | undefined
  anchor?: CollabAnchor | null | undefined
  anchor_state?: string | null | undefined
  anchor_version_id?: string | null | undefined
  /** the ordinal of `anchor_version_id`; null when the version row is gone */
  anchor_version_no?: number | null | undefined
  resolved_at?: string | null | undefined
  deleted_at?: string | null | undefined
  created_at?: string | undefined
  updated_at?: string | undefined
  display_name?: string | undefined
  avatar_url?: string | undefined
  mentions_without_access?: CollabMentionWithoutAccess[] | undefined
  [k: string]: unknown
}

export interface CollabMentionWithoutAccess {
  user_id: string
  display_name?: string
  can_share: boolean
}

export interface CollabMention {
  user_id: string
  display_name?: string | undefined
  avatar_url?: string | undefined
  state: 'ok' | 'unavailable'
}

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
  avatar_url?: string | undefined
  email?: string | undefined
  can_view?: boolean | undefined
}

export interface CollabAnchorUpdate {
  comment_id: string
  anchor: CollabAnchor
  state: 'exact' | 'lost'
}

export interface CollabAnchorSkip {
  comment_id: string
  reason: 'older_version' | 'not_applicable'
}

export interface CollabAnchorsResult {
  updated: string[]
  skipped: CollabAnchorSkip[]
  list_token: string
}

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
  canListMembers?: boolean
  shareView?(p: { user_id: string }): Promise<{ ok: true }>
  anchors?(p: { version_id: string; anchors: CollabAnchorUpdate[] }): Promise<CollabAnchorsResult>
}

export interface CollabAnchorAdapter {
  order(anchor: CollabAnchor): number | string
  locate(anchor: CollabAnchor): boolean
  goTo(anchor: CollabAnchor): void
  activeSheet?(): string | undefined
  sheetName?(sheetId: string): string | undefined
}

export interface CollabHostState {
  documentId: string
  kind: CollabKind
  level: CollabLevel | undefined
  myUserId?: string | undefined
  lang: Lang
  platform: 'mac' | 'other'
  capabilities?: { commentsShareView?: boolean }
  commentsShareView?: boolean
  canListMembers?: boolean
}

export type CollabReply<T> =
  | { ok: true; value: T }
  | {
      ok: false
      error: { code: string; message?: string; retryable?: boolean; details?: unknown }
    }

/** structural `window.uniworkComments` (camelCase + path); only the members the kit calls */
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
    include?: 'no_access'
  }): Promise<CollabReply<{ candidates: CollabCandidate[] }>>
  shareView?(input: { path: string; userId: string }): Promise<CollabReply<{ ok: true }>>
  canListMembers?: boolean
}

export function createUniworkCommentsSource(
  api: UniworkCommentsLike,
  path: string,
  kind: CollabKind,
): CollabSource

export type AnchorSyncOutcome =
  | { outcome: 'synced'; updated: string[]; skipped: CollabAnchorSkip[]; list_token: string }
  | { outcome: 'retry_next_save' }

export function sendAnchorMap(
  source: CollabSource,
  versionId: string,
  updates: readonly CollabAnchorUpdate[],
): Promise<AnchorSyncOutcome>

export const COMMENTS_REVEAL_WAIT_MS: number
/** the window's polite live region (the kit creates it on first use) */
export const COLLAB_LIVE_REGION_ID: string
/** say `text` in the window's polite live region */
export function announcePolite(text: string, doc?: Document): void

export type CollabStrings = Readonly<Record<string, string>>
/** the post-send notice keys the panel requires (G8-18) */
export interface CollabPostSendStrings {
  collabPostSendNoAccess: string
  collabPostSendShareAction: string
  collabPostSendNoRetroNote: string
  collabMentionMixedUnshareable: string
  collabSharingView: string
  collabShareViewFailed: string
  collabDismissNotice: string
}
export type CollabAllStrings = Readonly<Record<string, string>> & CollabPostSendStrings
export function collabStrings(lang: Lang): CollabAllStrings

export type CollabLoadState = 'loading' | 'ready' | 'loadError' | 'noAccess'

export interface CollabThreadView {
  id: string
  root: CollabComment
  replies: CollabComment[]
  resolved: boolean
  deleted: boolean
  anchorState?: 'exact' | 'stale' | 'lost' | undefined
}

export interface CollabNewThread {
  anchor: CollabAnchor
  base_version_id?: string
}

export interface CollabController {
  source: CollabSource
  host: CollabHostState
  state: CollabLoadState
  threads: CollabThreadView[]
  resolved: CollabThreadView[]
  newThread: CollabNewThread | null
  startThread(p: CollabNewThread): void
  cancelThread(): void
  reload(): Promise<void>
  freshComments(): Promise<readonly CollabComment[]>
  reveal(commentId: string): Promise<{ revealed: boolean }>
}

/** the host opens version `versionNo` read-only; `opened: false` (or a throw) shows the unavailable line */
export type CollabViewVersion = (req: {
  commentId: string
  versionNo: number
}) => Promise<{ opened: boolean }> | { opened: boolean } | void

export interface CollabControllerOptions {
  adapter?: CollabAnchorAdapter | undefined
  /** the id of the version the editor shows: a lost comment anchored on it is located like any other */
  openVersionId?: string | undefined
  /** opens version N read-only for a lost comment; absent: no "View in version N" action */
  onViewVersion?: CollabViewVersion | undefined
  strings?: CollabStrings | undefined
}

export function useCollabThreads(
  source: CollabSource,
  host: CollabHostState,
  opts?: CollabControllerOptions,
): CollabController

export interface CollabInFileSlot {
  count: number
  content: ReactNode
}

/** what the panel hands a composer slot; spread it into `CollabComposer` */
export interface CollabComposerSlot {
  host: CollabHostState
  source: CollabSource
  mode: 'root' | 'reply' | 'discussion'
  draftKey: string
  disabledReason?: 'status' | undefined
  statusLineId?: string | undefined
  onSubmit(body: string): Promise<void>
  onCancel(): void
  autoFocus?: boolean | undefined
}

/** `strings`: what `collabStrings(lang)` returns (it carries the composer's keys) */
export function CollabComposer(
  props: CollabComposerSlot & { strings: CollabAllStrings },
): ReactElement

export interface CollabPanelProps {
  controller: CollabController
  strings: CollabStrings & CollabPostSendStrings
  onClose?: (() => void) | undefined
  renderComposer?: ((slot: CollabComposerSlot) => ReactNode) | undefined
  inFile?: CollabInFileSlot | undefined
  className?: string | undefined
}

export function CollabPanel(p: CollabPanelProps): ReactElement

export function formatCollabTime(iso: string | undefined, lang: string, now?: Date): string
