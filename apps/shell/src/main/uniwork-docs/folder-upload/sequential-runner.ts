import type { BatchUploadFailure } from '../../../shared/folder-upload-api'
import type { UniworkDocActionResult, UniworkUploadDocInput } from '../../../shared/home-api'
import type {
  FolderUploadRunnerPort,
  FolderUploadRunOptions,
  FolderUploadRunProgress,
} from './runner-port'
import type { AppFolderUploadPlan } from './scan'
import type { PlannedFile } from './types'

/**
 * The runner for a server without the folder_upload block (CONTRACT-app Q1 A):
 * the planned files go one after the other through the existing single-file
 * upload, behind the same port and with the same progress shape as the batch
 * runner. There is no batch on the server, so no share flag reaches it and no
 * folder is created (files mode only).
 */

export interface SequentialRunnerDeps {
  /** the existing single upload (`UniworkDocsService.uploadDocument`) */
  uploadOne(input: UniworkUploadDocInput): Promise<UniworkDocActionResult<unknown>>
  /** aborts one running single upload by its id */
  cancelOne(uploadId: string): void
  newUploadId(): string
}

/** a failure that may pass on a second try: the network or the server, never the file itself */
const RETRYABLE_CODES = new Set(['network', 'timeout', 'server_error'])

interface Run {
  plan: AppFolderUploadPlan
  opts: FolderUploadRunOptions
  done: number
  sentBytes: number
  failures: Array<{ file: PlannedFile; code: string; retryable: boolean }>
  running: boolean
  canceled: boolean
  currentUploadId: string | null
}

export function createSequentialRunner(deps: SequentialRunnerDeps): FolderUploadRunnerPort {
  const runs = new Map<string, Run>()

  function report(run: Run, phase: FolderUploadRunProgress['phase']): void {
    const failures: BatchUploadFailure[] = run.failures.map(({ file, code, retryable }) => ({
      path: file.path,
      code,
      retryable,
    }))
    run.opts.onProgress({
      phase,
      done: run.done,
      failed: run.failures.length,
      total: run.plan.totals.files,
      sentBytes: run.sentBytes,
      totalBytes: run.plan.totals.bytes,
      ...(failures.length > 0 ? { failures } : {}),
    })
  }

  async function uploadAll(run: Run, files: readonly PlannedFile[]): Promise<void> {
    run.running = true
    report(run, 'uploading')
    for (const [position, file] of files.entries()) {
      if (run.canceled) break
      const uploadId = deps.newUploadId()
      run.currentUploadId = uploadId
      const outcome = await deps
        .uploadOne({
          workspaceId: run.opts.workspaceId,
          folderId: run.opts.parentId,
          path: run.opts.filePath(file.index),
          uploadId,
        })
        .catch((): UniworkDocActionResult<unknown> => ({ ok: false, error: 'server_error' }))
      run.currentUploadId = null
      if (outcome.ok) {
        run.done += 1
        run.sentBytes += file.size
      } else if (!(run.canceled && outcome.error === 'upload_cancelled')) {
        const code = String(outcome.error)
        run.failures.push({
          file,
          code,
          retryable: outcome.retryable === true || RETRYABLE_CODES.has(code),
        })
      }
      if (!run.canceled && position < files.length - 1) report(run, 'uploading')
    }
    run.running = false
    // nothing to retry or dismiss afterwards: let the run go
    if (run.canceled || run.failures.length === 0) runs.delete(run.opts.runId)
    report(run, run.canceled ? 'canceled' : 'done')
  }

  return {
    start(plan, opts) {
      const run: Run = {
        plan,
        opts,
        done: 0,
        sentBytes: 0,
        failures: [],
        running: false,
        canceled: false,
        currentUploadId: null,
      }
      runs.set(opts.runId, run)
      void uploadAll(run, plan.files)
      return { runId: opts.runId }
    },
    cancel(runId) {
      const run = runs.get(runId)
      if (!run || run.canceled) return
      run.canceled = true
      if (run.currentUploadId) deps.cancelOne(run.currentUploadId)
      // between a finished run and its report there is nothing to abort
      else if (!run.running) report(run, 'canceled')
    },
    retry(runId) {
      const run = runs.get(runId)
      if (!run || run.running || run.canceled) return
      const again = run.failures
        .filter((failure) => failure.retryable)
        .map((failure) => failure.file)
      if (again.length === 0) return
      run.failures = run.failures.filter((failure) => !failure.retryable)
      void uploadAll(run, again)
    },
    dismiss(runId) {
      runs.delete(runId)
    },
  }
}
