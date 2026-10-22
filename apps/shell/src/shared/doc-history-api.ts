/**
 * UNI-2077 APP-DOC-HISTORY-ACCESSLOG: the renderer-facing contract of the
 * Version history sheet and the Access log sheet. One method per
 * `uniwork-doc-history:*` IPC channel; main (`doc-history-service.ts`)
 * implements it, the preload exposes it as `window.uniworkDocHistory`, and the
 * renderer tests use the in-memory fake (`tests/doc-history-fake-bridge.ts`).
 *
 * The rows keep the server's own field names (snake_case, the web's
 * `DocumentVersion` / `DocumentAccessLog` of `packages/core/types/document.ts`),
 * so the sheets port the web's code as it is. Enum-like server strings stay
 * open: a reason, kind or action a newer server adds reads as an unknown label,
 * never as a broken sheet.
 */

/** the web's DOCUMENT_VERSION_REASONS; any other string is shown as unknown */
export const DOC_VERSION_REASONS = ['manual', 'auto', 'restore', 'upload', 'agent'] as const
export type DocVersionReason = (typeof DOC_VERSION_REASONS)[number]

/** the access log's action filter (the server's `?action=`); '' is no filter */
export const DOC_ACCESS_LOG_ACTIONS = ['view', 'download', 'export', 'link_view'] as const
export type DocAccessLogAction = (typeof DOC_ACCESS_LOG_ACTIONS)[number]

/** the web's page sizes (VERSION_PAGE_SIZE, ACCESS_LOG_PAGE_SIZE); the server caps at 100 */
export const DOC_VERSION_PAGE_SIZE = 50
export const DOC_ACCESS_LOG_PAGE_SIZE = 50
/** the server's cap of a version label (`label` <= 200 characters) */
export const DOC_VERSION_LABEL_MAX = 200

/** one version row (`GET /documents/{id}/versions`); `content` only on a page version read one by one */
export interface DocVersion {
  id: string
  document_id: string
  version: number
  /** 'page' | 'file' (open string) */
  kind: string
  /** DocVersionReason (open string) */
  reason: string
  label: string | null
  file_id: string | null
  mime_type: string | null
  size_bytes: number
  checksum_sha256: string | null
  /** the version number a restore version points back to */
  restored_from: number | null
  /** the author's user id ('' when the server sent none); names come from the workspace members */
  created_by: string
  /** 'human' | 'agent' | 'system' (open string) */
  created_by_kind: string
  created_at: string
  /** a page version's ProseMirror JSON, only from `version()`; never on list rows */
  content?: unknown
}

export interface DocVersionPage {
  versions: DocVersion[]
  /** null when this was the last page */
  next_cursor: string | null
}

/** the bumped document of a restore answer: the fields the sheet and the open tab need */
export interface DocHistoryDocument {
  id: string
  kind: string
  title: string
  /** int64 as a decimal string */
  revision: string
  current_version: number
}

export interface DocRestoreResult {
  document: DocHistoryDocument
  /** the new `restore` version row */
  version: DocVersion
}

/** the resolved actor of an access log row (absent for anonymous or deleted actors) */
export interface DocAccessLogActor {
  id: string
  /** 'human' | 'agent' (open string) */
  kind: string
  display_name: string
  avatar_url?: string
}

/** one access log row (`GET /documents/{id}/access-logs`) */
export interface DocAccessLog {
  id: string
  /** DocAccessLogAction (open string) */
  action: string
  /** 'member' | 'share' | 'link' | 'ai_context' | 'break_glass' (open string; '' when not sent) */
  via: string
  version: number | null
  /** 'human' | 'agent' | 'anonymous' (open string) */
  actor_kind: string
  actor_id: string | null
  actor: DocAccessLogActor | null
  share_link_id: string | null
  occurred_at: string
}

export interface DocAccessLogPage {
  logs: DocAccessLog[]
  next_cursor: string | null
}

/**
 * What a call may fail with. The server's verdicts the sheets name keep their
 * own code; the transport / session failures are the app's usual ones.
 */
export type DocHistoryErrorCode =
  | 'not_signed_in'
  | 'session_expired'
  | 'wrong_deployment'
  | 'network'
  | 'timeout'
  | 'server_error'
  | 'malformed_response'
  /** the renderer sent something main will not send (bad id, version number, label, action) */
  | 'invalid_request'
  /** 403: not allowed (the access log is manage-only; a restore needs edit) */
  | 'forbidden'
  /** 404: no such document / version, or not readable by this account */
  | 'not_found'
  /** 410: the document is gone for good */
  | 'deleted'
  /** the document sits in the trash */
  | 'document_deleted'
  /** 403 document_archived: an archived file takes no restore */
  | 'document_archived'
  /** the document sits in Lưu trữ (shelved): history reads, no new or restored version */
  | 'document_shelved'
  /** 409 document_version_unchanged: nothing moved since the newest version (create) */
  | 'version_unchanged'
  /** 409 document_version_conflict: the base the restore named is stale (`currentRevision`) */
  | 'conflict'
  /** 423 document_locked: someone else (or another tab / device) holds the edit lock (`editLock`) */
  | 'edit_locked'
  /** 409 edit_lock_lost: the lock this app held ended before the write */
  | 'edit_lock_lost'
  /** download: the save dialog was canceled (no request was made) */
  | 'dialog_canceled'
  /** download: the chosen target is inside the app's working copies, or a link */
  | 'forbidden_target'
  /** download: the file could not be written to the target */
  | 'write_failed'
  /** download: the version is larger than the app's download cap */
  | 'too_large'
  /** open: this version cannot be opened in the app (a page version, an unsupported format) */
  | 'unsupported_format'

/** the holder of a refused write (423), as the edit-lock UI already shows it */
export interface DocHistoryEditLock {
  holderName: string | null
  since: string | null
  expiresAt: string | null
  heldByMe: boolean
}

export type DocHistoryResult<T> =
  | { ok: true; value: T }
  | {
      ok: false
      error: DocHistoryErrorCode
      /** the HTTP status the server answered, when it did */
      status?: number
      /** a throttle (429 / 503): the same call may be repeated */
      retryable?: boolean
      /** `conflict`: the server's current revision (decimal string) */
      currentRevision?: string
      /** `edit_locked`: who holds the lock */
      editLock?: DocHistoryEditLock
    }

export interface DocVersionsInput {
  documentId: string
  cursor?: string
  /** 1..100 (default DOC_VERSION_PAGE_SIZE) */
  limit?: number
}

export interface DocVersionInput {
  documentId: string
  versionNo: number
}

export interface DocCreateVersionInput {
  documentId: string
  /** trimmed by main; '' or absent = no label; at most DOC_VERSION_LABEL_MAX characters */
  label?: string
  /**
   * one key per intent, like the web: the sheet mints it on the first submit and
   * keeps it for a retry of the same label (a changed label is a new key). Main
   * mints one when absent. 8..128 of [A-Za-z0-9_-].
   */
  idempotencyKey?: string
}

export interface DocRestoreInput {
  documentId: string
  versionNo: number
  /** same rule as `DocCreateVersionInput.idempotencyKey`; drop it after a conflict / lock refusal */
  idempotencyKey?: string
  /**
   * the revision the user saw (file documents; the web sends `doc.revision`).
   * The app's rows carry none, so it is usually absent: main then uses the open
   * tab's base when the document is open here, else the server's current
   * revision (read just before the restore). A page restore sends no base.
   */
  baseRevision?: string
}

export interface DocVersionFileInput {
  documentId: string
  versionNo: number
  /** the save dialog's suggested name (the web uses `doc.file.filename ?? doc.title`) */
  suggestedName?: string
}

export interface DocAccessLogsInput {
  documentId: string
  cursor?: string
  /** 1..100 (default DOC_ACCESS_LOG_PAGE_SIZE) */
  limit?: number
  /** absent or '' = every action */
  action?: DocAccessLogAction | ''
}

/** one method per `uniwork-doc-history:*` channel; every call answers a DocHistoryResult, never throws */
export interface UniworkDocHistoryApi {
  /** `GET /documents/{id}/versions?cursor&limit`: metadata rows, newest first */
  versions(input: DocVersionsInput): Promise<DocHistoryResult<DocVersionPage>>
  /** `GET /documents/{id}/versions/{no}`: one version; a page version carries `content` */
  version(input: DocVersionInput): Promise<DocHistoryResult<DocVersion>>
  /** `POST /documents/{id}/versions`: a named checkpoint of the working copy */
  createVersion(input: DocCreateVersionInput): Promise<DocHistoryResult<DocVersion>>
  /**
   * `POST /documents/{id}/versions/{no}/restore` with the open tab's edit lock
   * (main holds it) and base revision. On success an open tab of the document
   * takes the server's new revision through the usual "newer on the server" flow.
   */
  restore(input: DocRestoreInput): Promise<DocHistoryResult<DocRestoreResult>>
  /**
   * The preview of a file version: opens the read-only `@vN` copy in a tab (the
   * same open as "View in version N"). A page version answers `unsupported_format`
   * (the sheet previews it from `version().content`).
   */
  openVersion(input: DocVersionInput): Promise<DocHistoryResult<{ path: string; title: string }>>
  /** save dialog, then `GET /documents/{id}/download?version=N` streamed to the chosen file */
  downloadVersion(input: DocVersionFileInput): Promise<DocHistoryResult<{ path: string }>>
  /** `GET /documents/{id}/access-logs?cursor&limit&action`: manage-only, newest first */
  accessLogs(input: DocAccessLogsInput): Promise<DocHistoryResult<DocAccessLogPage>>
}

export const DOC_HISTORY_CHANNELS = {
  versions: 'uniwork-doc-history:versions',
  version: 'uniwork-doc-history:version',
  createVersion: 'uniwork-doc-history:create-version',
  restore: 'uniwork-doc-history:restore',
  openVersion: 'uniwork-doc-history:open-version',
  downloadVersion: 'uniwork-doc-history:download-version',
  accessLogs: 'uniwork-doc-history:access-logs',
} as const

const ERROR_CODES: ReadonlySet<string> = new Set<DocHistoryErrorCode>([
  'not_signed_in',
  'session_expired',
  'wrong_deployment',
  'network',
  'timeout',
  'server_error',
  'malformed_response',
  'invalid_request',
  'forbidden',
  'not_found',
  'deleted',
  'document_deleted',
  'document_archived',
  'document_shelved',
  'version_unchanged',
  'conflict',
  'edit_locked',
  'edit_lock_lost',
  'dialog_canceled',
  'forbidden_target',
  'write_failed',
  'too_large',
  'unsupported_format',
])

const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/**
 * The preload's guard of a main answer: a result keeps only its known fields,
 * an unknown error code reads `server_error`, and anything that is not a result
 * at all is `malformed_response`. The value itself is main's own parse.
 */
export function asDocHistoryResult<T>(result: unknown): DocHistoryResult<T> {
  if (!result || typeof result !== 'object') return { ok: false, error: 'malformed_response' }
  const r = result as Record<string, unknown>
  if (r.ok === true) return { ok: true, value: r.value as T }
  if (r.ok !== false || typeof r.error !== 'string')
    return { ok: false, error: 'malformed_response' }
  const lock =
    r.editLock && typeof r.editLock === 'object' ? (r.editLock as Record<string, unknown>) : null
  return {
    ok: false,
    error: ERROR_CODES.has(r.error) ? (r.error as DocHistoryErrorCode) : 'server_error',
    ...(typeof r.status === 'number' ? { status: r.status } : {}),
    ...(r.retryable === true ? { retryable: true } : {}),
    ...(typeof r.currentRevision === 'string' ? { currentRevision: r.currentRevision } : {}),
    ...(lock
      ? {
          editLock: {
            holderName: textOrNull(lock.holderName),
            since: textOrNull(lock.since),
            expiresAt: textOrNull(lock.expiresAt),
            heldByMe: lock.heldByMe === true,
          },
        }
      : {}),
  }
}
