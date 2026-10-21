/**
 * UNI-2068 bulk "Download" as one zip: the shapes that cross the IPC between the
 * shell renderer and main (CONTRACT-app-2068 section 2). Main opens the save
 * dialog, creates and polls the server job and streams the zip to disk; the
 * renderer only draws progress and the result, so no bytes cross the IPC.
 */

export type ZipDownloadErrorCode =
  /** 422 download_too_large: the selected files add up to more than the server's 1 GiB cap */
  | 'zip_too_large'
  /** 410 document_download_expired: the one-hour download window closed */
  | 'zip_expired'
  /** 429 download_jobs_busy: two zips are already being prepared; fail fast, no auto-wait */
  | 'zip_busy'
  /** the job ended failed (nothing_to_download, build_failed) or ready without a link */
  | 'zip_failed'
  /** the poll cap was reached while the job was still queued or running */
  | 'zip_timeout'
  /** 404 / 501 on create: an older server without the download-jobs routes */
  | 'zip_unavailable'
  /** the chosen target is the app's own working-copy root, or a link */
  | 'forbidden_target'
  /** the temp file could not be written or renamed onto the target */
  | 'write_failed'
  | 'canceled'
  /** the stream passed the app's own size cap */
  | 'too_large'
  | 'server_error'
  | 'network'
  | 'signed_out'

export type ZipSkipReason =
  'not_found' | 'not_a_file' | 'too_large' | 'zip_limit' | 'other_workspace'

/** 2..100 ids (the renderer cuts the rest and lists them as `zip_limit`). */
export interface ZipDownloadStartInput {
  workspaceId: string
  documentIds: string[]
  /** suggested file name for the save dialog; main falls back to documents-<local datetime>.zip */
  suggestedName?: string
}

export interface ZipDownloadSkip {
  documentId: string
  reason: ZipSkipReason
}

export type ZipDownloadPhase =
  'saving' | 'building' | 'downloading' | 'done' | 'canceled' | 'failed'

export interface ZipDownloadProgress {
  runId: string
  phase: ZipDownloadPhase
  bytes: number
  totalBytes: number | null
  fileCount: number | null
  skipped: ZipDownloadSkip[]
  /** the saved zip, once `phase` is `done` */
  path: string | null
  error: { code: ZipDownloadErrorCode; retryAfterSeconds?: number } | null
}

export type ZipDownloadStartResult =
  { ok: true; runId: string } | { ok: false; code: 'dialog_canceled' | ZipDownloadErrorCode }

export interface FileDownloadResult {
  ok: boolean
  path: string | null
  code?: ZipDownloadErrorCode | 'dialog_canceled'
}

export interface ZipDownloadBridge {
  /** opens the save dialog first; a canceled dialog creates no job */
  start(input: ZipDownloadStartInput): Promise<ZipDownloadStartResult>
  cancel(runId: string): Promise<void>
  onProgress(listener: (p: ZipDownloadProgress) => void): () => void
  /** exactly one downloadable file: a plain download, no job (D4) */
  downloadFile(input: {
    workspaceId: string
    documentId: string
    suggestedName: string
  }): Promise<FileDownloadResult>
}

export const ZIP_DOWNLOAD_CHANNELS = {
  start: 'uniwork-doc:zip-download-start',
  cancel: 'uniwork-doc:zip-download-cancel',
  progress: 'uniwork-doc:zip-download-progress',
  downloadFile: 'uniwork-doc:download-file',
} as const
