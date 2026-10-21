/**
 * UNI-2052 folder / multi-file upload: the shapes that cross the IPC between the
 * shell renderer and main (CONTRACT-app section 5). Main reads the disk, plans
 * and uploads; the renderer only draws a pre-flight and progress, so nothing
 * here carries an absolute path or file bytes.
 */

/** `folder`: one directory with its tree; `files`: loose files straight into the destination. */
export type BatchUploadMode = 'folder' | 'files'

/** Refusals only the desktop app can raise, next to the planner's own codes. */
export type BatchUploadAppRefusalCode =
  /** the server has no folder_upload block (an older deployment): folder mode is off */
  | 'folder_upload_unavailable'
  /** the destination could not be resolved (folder gone, My Folder not created, no network) */
  | 'target_unavailable'

export type BatchUploadRefusalCode =
  | 'too_many_files'
  | 'too_many_folders'
  | 'too_large_total'
  | 'too_deep'
  | 'nothing_to_upload'
  | 'segment_too_long'
  | 'multiple_roots'
  | BatchUploadAppRefusalCode

export type BatchUploadSkipReason =
  | 'hidden'
  | 'unsupported_format'
  | 'too_large'
  | 'name_too_long'
  | 'invalid_path'
  /** a symlink / junction: never followed */
  | 'link'
  /** the entry could not be read (permissions, vanished) */
  | 'unreadable'
  /** a directory in files mode, a socket or a device */
  | 'not_a_file'

export interface BatchUploadSkip {
  /** relative path, root folder first (files mode: the file name) */
  path: string
  reason: BatchUploadSkipReason
}

export interface BatchUploadRefusal {
  code: BatchUploadRefusalCode
  limit?: number
  actual?: number
}

/** What a pick or a drop resolved to, before anything is sent. */
export interface PreflightSDO {
  /** main keeps the absolute paths under this id (TTL); start names the preflight by it */
  preflightId: string
  mode: BatchUploadMode
  /** folder mode: the folder's own name */
  rootName?: string
  /** folder mode, only when the name is taken at the destination: the name it will get ("Name (1)") */
  rootNamePreview?: string
  target: { workspaceId: string; folderId: string | null; label: string }
  totals: { files: number; bytes: number }
  skipped: BatchUploadSkip[]
  /** null = ready to start; a refusal blocks Upload and names the limit */
  refusal: BatchUploadRefusal | null
  /**
   * Whether the "share with workspace" choice reaches the server. False on the
   * sequential fallback (a server without folder_upload), which has no such flag.
   */
  shareAvailable: boolean
}

/** `uniwork-doc:batch-upload-pick` */
export interface BatchUploadPickInput {
  workspaceId: string
  /** null = the workspace root, which means the caller's My Folder */
  folderId: string | null
  mode: BatchUploadMode
}

/** `uniwork-doc:batch-upload-preflight`: absolute paths from a drop (`webUtils.getPathForFile`) */
export interface BatchUploadPreflightInput {
  workspaceId: string
  folderId: string | null
  paths: string[]
}

/** `uniwork-doc:batch-upload-start` */
export interface BatchUploadStartInput {
  preflightId: string
  shareWithWorkspace: boolean
}

export type BatchUploadStartError =
  /** the input was not shaped right */
  | 'invalid_input'
  /** the preflight expired or was never made: pick or drop again */
  | 'unknown_preflight'
  /** the preflight carries a refusal */
  | 'refused'

export type BatchUploadStartResult =
  { ok: true; runId: string } | { ok: false; error: BatchUploadStartError }

export type BatchUploadPhase =
  'planning' | 'uploading' | 'finishing' | 'done' | 'canceled' | 'failed'

export interface BatchUploadFailure {
  /** relative path, root folder first (files mode: the file name) */
  path: string
  code: string
  /** true = "Retry failed files" may try this one again */
  retryable: boolean
}

/** `uniwork-doc:batch-upload-progress` (pushed) */
export interface BatchUploadProgress {
  runId: string
  phase: BatchUploadPhase
  done: number
  failed: number
  total: number
  sentBytes: number
  totalBytes: number
  /** folder mode: the root folder's final title ("Name (1)") */
  rootTitle?: string
  rootFolderId?: string
  failures?: BatchUploadFailure[]
  /** the run as a whole failed (for example folder_uploads_busy with its Retry-After) */
  error?: { code: string; retryAfterSeconds?: number }
}

/**
 * `window.uniworkFolderUpload`: what the renderer reads. The preload builds it
 * from the `uniworkBatchUpload*` methods of the aiOffice bridge, so the
 * renderer never touches an IPC channel or a path.
 */
export interface FolderUploadBridge {
  /** the picker (folder, or files with multiple selection) + its pre-flight; null = cancelled */
  pick(input: BatchUploadPickInput): Promise<PreflightSDO | null>
  /** dropped absolute paths: one files pre-flight for the loose files, then one per folder, in that order */
  preflight(input: BatchUploadPreflightInput): Promise<PreflightSDO[]>
  start(input: BatchUploadStartInput): Promise<BatchUploadStartResult>
  cancel(input: { runId: string }): Promise<void>
  retry(input: { runId: string }): Promise<void>
  dismiss(input: { runId: string }): Promise<void>
  /** false when the server has no folder_upload limits block: "Tải lên thư mục" is hidden */
  foldersAvailable(): Promise<boolean>
  /** progress pushed by main; the returned function unsubscribes */
  onProgress(cb: (event: BatchUploadProgress) => void): () => void
}
