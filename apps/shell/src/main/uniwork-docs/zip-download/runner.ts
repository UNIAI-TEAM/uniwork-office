import type {
  ZipDownloadErrorCode,
  ZipDownloadProgress,
  ZipDownloadSkip,
} from '../../../shared/zip-download-api'
import { UniworkDocError } from '../errors'
import { sleep as abortableSleep } from '../folder-upload/runner-helpers'
import type { ZipDownloadClient } from './client'
import {
  ZIP_MAX_BYTES,
  ZIP_MAX_POLLS,
  ZIP_POLL_INTERVAL_MS,
  zipDownloadRoute,
  type ZipJob,
} from './wire'

/**
 * UNI-2068: one zip download, end to end, over an injected client and sink:
 * open the destination, create the job, poll it every 2 s (at most 90 times),
 * stream the zip into the sink and commit it. Whatever ends the run short - an
 * error, a cancel, a sign-out - aborts the sink, so no half file is ever left.
 * Electron-free: the dialog and the temp file are the service's.
 */

/** the bytes' destination: a temp file next to the target, renamed on commit */
export interface ZipSink {
  write(chunk: Uint8Array): Promise<void>
  /** renames the temp file onto the target; resolves with the final path */
  commit(): Promise<string>
  /** removes the temp file; safe to call after a failed commit */
  abort(): Promise<void>
}

/** a failure the sink or the service names itself (the run reports its code as it is) */
export class ZipRunError extends Error {
  readonly code: ZipDownloadErrorCode
  constructor(code: ZipDownloadErrorCode) {
    super(`zip download failed: ${code}`)
    this.name = 'ZipRunError'
    this.code = code
  }
}

export type ZipProgressPatch = Omit<ZipDownloadProgress, 'runId'>

export interface ZipRunnerDeps {
  client: ZipDownloadClient
  /** opens the destination (a temp file) before any job exists; throws ZipRunError */
  openSink(): Promise<ZipSink>
  sleep?(ms: number, signal: AbortSignal): Promise<void>
  now?(): number
  pollIntervalMs?: number
  maxPolls?: number
  maxBytes?: number
  /** at most one byte-progress event per this many ms (default 200) */
  progressEveryMs?: number
}

export interface ZipRunInput {
  workspaceId: string
  documentIds: string[]
}

const BUSY_RETRY_DEFAULT_S = 30

/** an error of any layer as the code the renderer is told */
export function zipErrorOf(
  error: unknown,
  at: 'create' | 'other' = 'other',
): { code: ZipDownloadErrorCode; retryAfterSeconds?: number } {
  if (error instanceof ZipRunError) return { code: error.code }
  if (error instanceof UniworkDocError) {
    if (error.zip === 'zip_busy') {
      return {
        code: 'zip_busy',
        retryAfterSeconds:
          error.retryAfterMs !== undefined
            ? Math.max(1, Math.ceil(error.retryAfterMs / 1000))
            : BUSY_RETRY_DEFAULT_S,
      }
    }
    if (error.zip) return { code: error.zip }
    // an older server has no such route: 404 / 501 on the create call
    if (at === 'create' && (error.status === 404 || error.status === 501)) {
      return { code: 'zip_unavailable' }
    }
    if (error.code === 'too_large') return { code: 'too_large' }
    if (error.code === 'not_signed_in' || error.code === 'session_expired') {
      return { code: 'signed_out' }
    }
    if (error.code === 'network' || error.code === 'timeout') return { code: 'network' }
    return { code: 'server_error' }
  }
  // anything else came out of the sink: the disk said no
  return { code: 'write_failed' }
}

export async function runZipDownload(
  input: ZipRunInput,
  deps: ZipRunnerDeps,
  signal: AbortSignal,
  emit: (event: ZipProgressPatch) => void,
): Promise<ZipProgressPatch> {
  const sleep = deps.sleep ?? abortableSleep
  const now = deps.now ?? Date.now
  const interval = deps.pollIntervalMs ?? ZIP_POLL_INTERVAL_MS
  const maxPolls = deps.maxPolls ?? ZIP_MAX_POLLS
  const maxBytes = deps.maxBytes ?? ZIP_MAX_BYTES
  const progressEvery = deps.progressEveryMs ?? 200

  let skipped: ZipDownloadSkip[] = []
  let fileCount: number | null = null
  let bytes = 0
  let totalBytes: number | null = null
  let sink: ZipSink | null = null

  const patch = (phase: ZipProgressPatch['phase']): ZipProgressPatch => ({
    phase,
    bytes,
    totalBytes,
    fileCount,
    skipped,
    path: null,
    error: null,
  })
  const push = (phase: ZipProgressPatch['phase']) => emit(patch(phase))
  const finish = (event: ZipProgressPatch): ZipProgressPatch => {
    emit(event)
    return event
  }
  const failed = (error: { code: ZipDownloadErrorCode; retryAfterSeconds?: number }) =>
    finish({ ...patch('failed'), error })
  /** the outcome of an abort: a sign-out is a failure the user is told, anything else a cancel */
  const aborted = () =>
    signal.reason === 'signed_out' ? failed({ code: 'signed_out' }) : finish(patch('canceled'))

  const settle = (job: ZipJob) => {
    skipped = job.skipped
    fileCount = job.fileCount
  }

  try {
    // a quit / sign-out between start and here must not create a temp file nobody removes
    if (signal.aborted) return aborted()
    push('saving')
    try {
      sink = await deps.openSink()
    } catch (error) {
      return signal.aborted ? aborted() : failed(zipErrorOf(error))
    }
    if (signal.aborted) return aborted()

    let job: ZipJob
    try {
      job = await deps.client.createJob(input.workspaceId, input.documentIds, signal)
    } catch (error) {
      return signal.aborted ? aborted() : failed(zipErrorOf(error, 'create'))
    }
    settle(job)
    push('building')

    for (let polls = 0; job.status === 'queued' || job.status === 'running';) {
      if (polls >= maxPolls) return failed({ code: 'zip_timeout' })
      try {
        await sleep(interval, signal)
        polls++
        job = await deps.client.getJob(input.workspaceId, job.id, signal)
      } catch (error) {
        return signal.aborted ? aborted() : failed(zipErrorOf(error))
      }
      settle(job)
      push('building')
    }
    if (signal.aborted) return aborted()
    if (job.status === 'expired') return failed({ code: 'zip_expired' })
    if (job.status !== 'ready' || !job.downloadUrl) return failed({ code: 'zip_failed' })
    if (!zipDownloadRoute(job.downloadUrl, input.workspaceId, job.id)) {
      return failed({ code: 'zip_failed' })
    }

    push('downloading')
    let lastEmit = Number.NEGATIVE_INFINITY
    const target = sink
    try {
      const streamed = await deps.client.fetchZip(
        { workspaceId: input.workspaceId, jobId: job.id, downloadUrl: job.downloadUrl },
        (chunk) => target.write(chunk),
        {
          signal,
          maxBytes,
          onProgress: (progress) => {
            bytes = progress.receivedBytes
            totalBytes = progress.totalBytes
            const at = now()
            if (at - lastEmit < progressEvery) return
            lastEmit = at
            push('downloading')
          },
        },
      )
      bytes = streamed.bytes
    } catch (error) {
      return signal.aborted ? aborted() : failed(zipErrorOf(error))
    }
    if (signal.aborted) return aborted()

    let path: string
    try {
      path = await sink.commit()
    } catch (error) {
      return failed(zipErrorOf(error))
    }
    // committed: the file is the user's now, nothing left to abort
    sink = null
    totalBytes = bytes
    return finish({ ...patch('done'), path })
  } finally {
    if (sink) await sink.abort().catch(() => undefined)
  }
}
