/**
 * UNI-2052: the renderer's view of the folder / multi-file upload bridge.
 *
 * A renderer-local mirror of CONTRACT-app section 5 (the seven channels and the
 * two payload shapes). The renderer reads it from `window.uniworkFolderUpload`;
 * an older main without the bridge leaves it absent and the feature stays
 * hidden. The absolute paths of a pre-flight stay in main (keyed by
 * `preflightId`): the renderer only ever sees relative paths.
 */

/** A run of one picked or dropped folder, or of loose files straight into the destination */
export type FolderUploadMode = 'folder' | 'files'

/** Why a file is not in the run: the web's five reasons plus the three only the desktop app can see */
export type FolderUploadSkipReason =
  | 'hidden'
  | 'unsupported_format'
  | 'too_large'
  | 'name_too_long'
  | 'invalid_path'
  | 'link'
  | 'unreadable'
  | 'not_a_file'

export interface PreflightSDO {
  preflightId: string
  mode: FolderUploadMode
  /** folder mode: the picked folder's own name */
  rootName?: string
  /** folder mode: the title the folder will get when the name is taken ("Name (1)"); absent when it keeps its name */
  rootNamePreview?: string
  target: {
    workspaceId: string
    folderId: string | null
    /** the destination as main names it ("My Folder", a folder title) */
    label: string
  }
  totals: { files: number; bytes: number }
  skipped: { path: string; reason: string }[]
  /** a whole-run refusal: the run cannot start */
  refusal: null | { code: string; limit?: number; actual?: number }
}

export type FolderUploadPhase =
  'planning' | 'uploading' | 'finishing' | 'done' | 'canceled' | 'failed'

export interface FolderUploadFailure {
  path: string
  code: string
  retryable: boolean
}

export interface FolderUploadProgressEvent {
  runId: string
  phase: FolderUploadPhase
  done: number
  failed: number
  total: number
  sentBytes: number
  totalBytes: number
  /** the folder's real title, as the server answered (after any "(n)") */
  rootTitle?: string
  rootFolderId?: string
  failures?: FolderUploadFailure[]
}

export interface FolderUploadBridge {
  /** the picker (folder, or files with multiple selection) + its pre-flight; null = the picker was canceled */
  pick(input: {
    workspaceId: string
    folderId: string | null
    mode: FolderUploadMode
  }): Promise<PreflightSDO | null>
  /** dropped absolute paths: one files pre-flight for the loose files, then one per folder, in that order */
  preflight(input: {
    workspaceId: string
    folderId: string | null
    paths: string[]
  }): Promise<PreflightSDO[]>
  start(input: { preflightId: string; shareWithWorkspace: boolean }): Promise<{ runId: string }>
  cancel(input: { runId: string }): Promise<void>
  retry(input: { runId: string }): Promise<void>
  dismiss(input: { runId: string }): Promise<void>
  /** progress pushed by main; the returned function unsubscribes */
  onProgress(cb: (event: FolderUploadProgressEvent) => void): () => void
  /**
   * Renderer-side addition to the contract: false when the server has no
   * `folder_upload` limits block ("Tải lên thư mục" is then hidden and a dropped
   * folder is not taken). Absent = folders are offered.
   */
  foldersAvailable?(): Promise<boolean>
}

declare global {
  interface Window {
    uniworkFolderUpload?: FolderUploadBridge
  }
}

/** The bridge, or null when this main does not have it (the feature is then hidden) */
export function getFolderUploadBridge(): FolderUploadBridge | null {
  if (typeof window === 'undefined') return null
  const bridge = window.uniworkFolderUpload
  return bridge && typeof bridge.pick === 'function' ? bridge : null
}
