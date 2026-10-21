import type { BatchUploadFailure } from '../../../shared/folder-upload-api'
import type { LocalFileProbePayload } from '../client'
import { UniworkDocError } from '../errors'
import type { FolderUploadRunLimits } from '../limits'
import { readLocalFileProbe } from '../upload-session'
import { openFileBlob } from './file-source'
import type {
  FolderUploadRunnerPort,
  FolderUploadRunOptions,
  FolderUploadRunProgress,
} from './runner-port'
import { runFolderUpload } from './runner'
import { failureCode } from './runner-helpers'
import type {
  FolderUploadHandle,
  FolderUploadProgress,
  FolderUploadReport,
  PlannedBatch,
} from './runner-types'
import type { AppFolderUploadPlan } from './scan'
import { asFolderUploadRefusal, type FolderUploadTransport } from './transport'
import type { PlannedFile } from './types'

/**
 * The FU-B batch runner (`runFolderUpload`, 5 server routes) behind the IPC's
 * `FolderUploadRunnerPort`. It owns what the port promises and the runner does
 * not know about: runs named by id, the bytes of a file read from its absolute
 * path, progress in the port's phases, one terminal event per settled run
 * (done / canceled / failed), and every failure of a single file reported as
 * that file's failure instead of a rejected run.
 */

export interface RunnerAdapterDeps {
  /** the transport of one workspace; may throw (a signed-out app) */
  transportFor(workspaceId: string): FolderUploadTransport
  /** the run knobs of the server's folder_upload block; null = the server has none */
  runLimits(): Promise<FolderUploadRunLimits | null> | FolderUploadRunLimits | null
  /** the lists of a workspace changed (the runner throttles it to one per 2 s plus a final one) */
  onInvalidate?(workspaceId: string): void
  /** a file-backed blob of the file at an absolute path (default: `openFileBlob`) */
  openFile?(absolutePath: string): Promise<Blob>
  /** the plan probe of a file above the chunked threshold (default: `readLocalFileProbe`) */
  probeOf?(absolutePath: string, size: number, filename: string): Promise<LocalFileProbePayload>
}

interface Run {
  plan: AppFolderUploadPlan
  opts: FolderUploadRunOptions
  handle: FolderUploadHandle | null
  canceled: boolean
  /** a report was pushed and nothing is running: retry and dismiss may act */
  settled: boolean
  report: FolderUploadReport | null
  /** files the probe refused: never sent, never retryable */
  refused: BatchUploadFailure[]
  /** the last counters the runner reported, for a terminal event without a report */
  done: number
  failed: number
  sentBytes: number
}

/** the planned files minus the ones that cannot go, with the totals of what is left */
function remainingPlan(plan: AppFolderUploadPlan, files: PlannedFile[]): PlannedBatch {
  return {
    rootName: plan.rootName,
    rootTitle: plan.rootTitle,
    folders: plan.folders,
    files,
    totals: { files: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0) },
  }
}

const probeFailureCode = (error: unknown): string =>
  error instanceof UniworkDocError && error.code === 'unsupported_format'
    ? 'unsupported_format'
    : 'unreadable'

export function createFolderUploadRunnerAdapter(deps: RunnerAdapterDeps): FolderUploadRunnerPort {
  const openFile = deps.openFile ?? openFileBlob
  const probeOf =
    deps.probeOf ?? ((path, size, filename) => readLocalFileProbe({ path }, size, filename))
  const runs = new Map<string, Run>()

  function push(
    run: Run,
    phase: FolderUploadRunProgress['phase'],
    rest: Partial<FolderUploadRunProgress>,
  ) {
    run.opts.onProgress({
      phase,
      done: run.done,
      failed: run.failed,
      total: run.plan.totals.files,
      sentBytes: run.sentBytes,
      totalBytes: run.plan.totals.bytes,
      ...rest,
    })
  }

  /** the runner's counters, in the port's phases; its own end states are reported from the report */
  function onRunnerProgress(run: Run, progress: FolderUploadProgress): void {
    run.done = progress.done
    run.failed = progress.failed + run.refused.length
    run.sentBytes = progress.sentBytes
    let phase: FolderUploadRunProgress['phase']
    if (progress.phase === 'planning' || progress.phase === 'waiting') phase = 'planning'
    else if (progress.phase === 'uploading' || progress.phase === 'retrying') {
      const left = progress.total - progress.done - progress.failed
      phase = progress.stored > 0 && progress.stored === left ? 'finishing' : 'uploading'
    } else return
    push(run, phase, {})
  }

  function settleReport(run: Run, report: FolderUploadReport): void {
    run.report = report
    run.settled = true
    run.done = report.done
    const failures: BatchUploadFailure[] = [
      ...run.refused,
      ...report.failed.map(({ path, code, retryable }) => ({ path, code, retryable })),
    ]
    run.failed = failures.length
    const root = {
      ...(report.root ? { rootTitle: report.root.title } : {}),
      ...(report.root?.id ? { rootFolderId: report.root.id } : {}),
    }
    if (report.expired) {
      runs.delete(run.opts.runId)
      push(run, 'failed', { ...root, error: { code: 'folder_upload_expired' } })
    } else if (report.canceled) {
      runs.delete(run.opts.runId)
      push(run, 'canceled', root)
    } else {
      if (failures.length === 0) runs.delete(run.opts.runId)
      push(run, 'done', { ...root, ...(failures.length > 0 ? { failures } : {}) })
    }
  }

  function settleError(run: Run, error: unknown): void {
    run.settled = true
    runs.delete(run.opts.runId)
    if (run.canceled) return push(run, 'canceled', {})
    const refusal = asFolderUploadRefusal(error)
    const seconds = Number(refusal?.fields.retry_after)
    push(run, 'failed', {
      ...(run.refused.length > 0 ? { failures: run.refused } : {}),
      error: {
        code: refusal?.code ?? failureCode(error),
        ...(refusal && Number.isFinite(seconds) && seconds >= 0
          ? { retryAfterSeconds: seconds }
          : {}),
      },
    })
  }

  /** reads the probe of each large file; a file that cannot be probed is set aside as that file's failure */
  async function probeLargeFiles(
    run: Run,
    threshold: number,
  ): Promise<{ files: PlannedFile[]; probes: Map<number, LocalFileProbePayload> }> {
    const probes = new Map<number, LocalFileProbePayload>()
    const files: PlannedFile[] = []
    for (const file of run.plan.files) {
      if (file.size <= threshold) {
        files.push(file)
        continue
      }
      if (run.canceled) break
      try {
        probes.set(
          file.index,
          await probeOf(run.opts.filePath(file.index), file.size, file.filename),
        )
        files.push(file)
      } catch (error) {
        run.refused.push({ path: file.path, code: probeFailureCode(error), retryable: false })
      }
    }
    return { files, probes }
  }

  async function execute(run: Run): Promise<void> {
    try {
      const limits = await deps.runLimits()
      if (!limits) {
        push(run, 'failed', { error: { code: 'folder_upload_unavailable' } })
        runs.delete(run.opts.runId)
        run.settled = true
        return
      }
      const transport = deps.transportFor(run.opts.workspaceId)
      const threshold = limits.chunkedThresholdBytes
      const probed =
        threshold === undefined
          ? { files: run.plan.files, probes: new Map<number, LocalFileProbePayload>() }
          : await probeLargeFiles(run, threshold)
      run.failed = run.refused.length
      if (run.canceled) return settleError(run, null)
      if (probed.files.length === 0) {
        // nothing is left to send: the server never hears of this run
        return settleReport(run, {
          batchId: null,
          root: null,
          done: 0,
          failed: [],
          total: 0,
          canceled: false,
          expired: false,
          canRetry: false,
        })
      }
      const handle = runFolderUpload({
        transport,
        plan: remainingPlan(run.plan, probed.files),
        file: (index) => openFile(run.opts.filePath(index)),
        parentId: run.opts.parentId,
        shareWithWorkspace: run.opts.shareWithWorkspace,
        limits: {
          parallel: limits.parallel,
          completeBatch: limits.completeBatch,
          ...(threshold !== undefined ? { chunkedThresholdBytes: threshold } : {}),
        },
        onProgress: (progress) => onRunnerProgress(run, progress),
        onInvalidate: () => deps.onInvalidate?.(run.opts.workspaceId),
        buildProbe: async (file) => {
          const probe = probed.probes.get(file.index)
          if (!probe) throw new Error('no probe for a file above the chunked threshold')
          return probe
        },
      })
      run.handle = handle
      // a cancel that landed while the files were being probed
      if (run.canceled) handle.cancel()
      settleReport(run, await handle.done)
    } catch (error) {
      settleError(run, error)
    }
  }

  return {
    start(plan, opts) {
      const run: Run = {
        plan,
        opts,
        handle: null,
        canceled: false,
        settled: false,
        report: null,
        refused: [],
        done: 0,
        failed: 0,
        sentBytes: 0,
      }
      runs.set(opts.runId, run)
      void execute(run)
      return { runId: opts.runId }
    },
    cancel(runId) {
      const run = runs.get(runId)
      if (!run || run.canceled || run.settled) return
      run.canceled = true
      run.handle?.cancel()
    },
    retry(runId) {
      const run = runs.get(runId)
      if (!run?.handle || !run.settled || run.canceled || !run.report?.canRetry) return
      run.settled = false
      run.handle.retryFailed().then(
        (report) => settleReport(run, report),
        (error: unknown) => settleError(run, error),
      )
    },
    dismiss(runId) {
      runs.delete(runId)
    },
  }
}
