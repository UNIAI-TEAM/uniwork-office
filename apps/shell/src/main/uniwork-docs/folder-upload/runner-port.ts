import type { BatchUploadFailure, BatchUploadPhase } from '../../../shared/folder-upload-api'
import type { AppFolderUploadPlan } from './scan'

/**
 * The seam between the folder-upload IPC (this slice) and a runner. FU-B's batch
 * runner (5 server routes, parallel PUTs) and the app-only sequential fallback
 * both sit behind it; the service never knows which one it talks to. Shapes follow
 * the web runner-types.ts @ 7da10ccea, with the phases and the failure list the
 * desktop contract (section 5) pushes to the renderer.
 */

/** What a runner reports; the service adds the run id and forwards it as a push. */
export interface FolderUploadRunProgress {
  phase: BatchUploadPhase
  done: number
  failed: number
  total: number
  sentBytes: number
  totalBytes: number
  /** folder mode: the server's final root title ("Name (1)") */
  rootTitle?: string
  rootFolderId?: string
  failures?: BatchUploadFailure[]
  /** the run as a whole failed (folder_uploads_busy with its Retry-After, plan refused by the server...) */
  error?: { code: string; retryAfterSeconds?: number }
}

export interface FolderUploadRunOptions {
  /** minted by the service; every later call and every progress event names the run by it */
  runId: string
  workspaceId: string
  /** the destination folder (never null: a workspace root became the caller's My Folder) */
  parentId: string
  /** applies to every file of the run; a runner without the flag ignores it */
  shareWithWorkspace: boolean
  /** the absolute path of a planned file, by `PlannedFile.index`; stays in main */
  filePath(index: number): string
  onProgress(progress: FolderUploadRunProgress): void
}

export interface FolderUploadRunHandle {
  runId: string
}

export interface FolderUploadRunnerPort {
  /** starts a run for a plan without refusal; progress arrives through `opts.onProgress` */
  start(plan: AppFolderUploadPlan, opts: FolderUploadRunOptions): FolderUploadRunHandle
  /** abort what is in flight; what already landed stays */
  cancel(runId: string): void
  /** run again only the files that failed retryably */
  retry(runId: string): void
  /** the person closed the report without retrying: let the run go */
  dismiss(runId: string): void
}
