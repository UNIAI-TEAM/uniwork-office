/**
 * UNI-1993 (UW-SOURCE-RO): opening a Workspace "source" file (a document
 * attached in chat, a task, a meeting or email) as a view-only tab.
 *
 * Pure types and channel names, shared by main, preload and renderer. No
 * Electron import. `home-api.ts` re-exports these once UNI-1961 has landed.
 */

export const SOURCE_VIEW_CHANNELS = {
  /** invoke `OpenSourceInput` -> `SourceViewResult<OpenSourceValue>` */
  openSource: 'uniwork-doc:open-source',
  /** invoke `(path)` -> `SourceViewState | null` (the tab chip) */
  sourceViewState: 'uniwork-doc:source-view-state',
  /** main -> renderer event `SourceViewHint`: an explicit Save hit a source view path */
  hint: 'uniwork-doc:source-view-hint',
} as const

/**
 * the payload of the `hint` event: which source view the Save was pressed in.
 * `copy` is set when Save As, export or print was refused instead: the hint then
 * also says where to get a copy.
 */
export interface SourceViewHint {
  path: string
  copy?: true
}

/** what the renderer sends for one source row (the row's own fields, never an id of a document) */
export interface OpenSourceInput {
  workspaceId: string
  sourceId: string
  /** the row's file name; only its last segment is used for the temp file */
  name: string
  /** raw extension without the dot, as the server sent it */
  extension: string
  mimeType: string
  sizeBytes: number
  /** the row's `updatedAt`: part of the reuse key, so a changed file downloads again */
  updatedAt: string
  /** the module the file is attached in (`chat` | `task` | `meeting` | `email`; kept as sent) */
  origin: string
  /** the attaching parent (a chat, a task...): only its kind and title are shown */
  parent: { kind: string; title: string }
}

export interface OpenSourceValue {
  /** the temp file the editor tab shows */
  path: string
  /** an already open tab of the same file was focused, nothing was downloaded */
  reused: boolean
}

/** what the tab chip shows for a view-only source path; null for any other path */
export interface SourceViewState {
  name: string
  origin: string
  /** the attaching parent's title; '' when it has none */
  parentTitle: string
}

/**
 * The failure codes of an open. A subset of the documents error codes (the
 * renderer maps them onto the same notices), plus `open_failed` for a local
 * write or open that failed and `unsupported_format` for an extension no editor
 * module reads.
 */
export type SourceViewErrorCode =
  | 'not_signed_in'
  | 'session_expired'
  | 'wrong_deployment'
  | 'keystore_locked'
  | 'forbidden'
  | 'not_found'
  | 'deleted'
  | 'too_large'
  | 'network'
  | 'timeout'
  | 'server_error'
  | 'unsupported_format'
  | 'open_failed'

export type SourceViewResult<T> = { ok: true; value: T } | { ok: false; error: SourceViewErrorCode }
