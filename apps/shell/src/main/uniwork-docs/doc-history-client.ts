import type {
  DocAccessLogAction,
  DocAccessLogPage,
  DocRestoreResult,
  DocVersion,
  DocVersionPage,
} from '../../shared/doc-history-api'

/**
 * UNI-2077: the version and access-log routes of the documents server, the same
 * routes, queries and bodies the web calls (`documents-versions.ts`,
 * `documents-sharing.ts` listDocumentAccessLogs).
 */
export interface DocHistoryClient {
  /** `GET /documents/{id}/versions?cursor&limit` */
  listVersions(
    documentId: string,
    opts?: { cursor?: string; limit?: number },
  ): Promise<DocVersionPage>
  /** `GET /documents/{id}`: only the kind and revision a restore names as its base */
  getDocumentHead(documentId: string): Promise<{ kind: string; revision: string }>
  /** `GET /documents/{id}/versions/{no}` */
  getVersion(documentId: string, versionNo: number): Promise<DocVersion>
  /** `POST /documents/{id}/versions` with `{label?}` and an Idempotency-Key */
  createVersion(
    documentId: string,
    body: { label?: string },
    idempotencyKey: string,
  ): Promise<DocVersion>
  /** `POST /documents/{id}/versions/{no}/restore` with `{base_revision?, edit_lock_id?}` */
  restoreVersion(
    documentId: string,
    versionNo: number,
    opts: { idempotencyKey: string; baseRevision?: string; editLockId?: string },
  ): Promise<DocRestoreResult>
  /** `GET /documents/{id}/access-logs?cursor&limit&action` */
  listAccessLogs(
    documentId: string,
    opts?: { cursor?: string; limit?: number; action?: DocAccessLogAction },
  ): Promise<DocAccessLogPage>
}
