import {
  createUniworkSend,
  METADATA_TIMEOUT_MS,
  STREAM_CEILING_MS,
  TRANSFER_TIMEOUT_MS,
  type UniworkDocsClientOptions,
} from '../client'
import { UniworkDocError } from '../errors'
import {
  isZipDocumentId,
  parseZipJob,
  zipCreateRoute,
  zipDownloadRoute,
  zipJobRoute,
  ZIP_MAX_BYTES,
  ZIP_MAX_IDS,
  type ZipJob,
} from './wire'

/**
 * UNI-2068: the three download-job routes of the documents server, through the
 * same hardened `send` every UniWork client uses (bearer only inside it, one 401
 * refresh, fixed `/api/v1` base, no redirect). The zip itself is never buffered:
 * `fetchZip` hands every chunk to the caller's sink and waits for it before it
 * reads the next one, so memory stays one chunk wide whatever the zip's size.
 */

export interface ZipDownloadTarget {
  workspaceId: string
  jobId: string
  /** the job's `download_url`: only this job's own download route is followed */
  downloadUrl: string
}

export interface FetchZipOptions {
  /** ends the request, and the body read once the server answered */
  signal?: AbortSignal
  /** the stream's own cap in bytes (default ~1.25 GiB); passing it throws `too_large` */
  maxBytes?: number
  /** after every received chunk; `totalBytes` is the Content-Length when sent */
  onProgress?(progress: { receivedBytes: number; totalBytes: number | null }): void
}

export interface ZipDownloadClient {
  createJob(workspaceId: string, documentIds: string[], signal?: AbortSignal): Promise<ZipJob>
  getJob(workspaceId: string, jobId: string, signal?: AbortSignal): Promise<ZipJob>
  /** streams the zip into `write`, one chunk at a time; resolves with the byte count */
  fetchZip(
    target: ZipDownloadTarget,
    write: (chunk: Uint8Array) => Promise<void>,
    options?: FetchZipOptions,
  ): Promise<{ bytes: number }>
}

export interface ZipDownloadClientTuning {
  metadataTimeoutMs?: number
  transferTimeoutMs?: number
  streamCeilingMs?: number
}

export function createZipDownloadClient(
  options: UniworkDocsClientOptions,
  tuning: ZipDownloadClientTuning = {},
): ZipDownloadClient {
  const metadataTimeout =
    tuning.metadataTimeoutMs ?? options.metadataTimeoutMs ?? METADATA_TIMEOUT_MS
  const transferTimeout =
    tuning.transferTimeoutMs ?? options.transferTimeoutMs ?? TRANSFER_TIMEOUT_MS
  const streamCeiling = tuning.streamCeilingMs ?? options.streamCeilingMs ?? STREAM_CEILING_MS
  const send = createUniworkSend(options)
  const json = (response: Response): Promise<unknown> => response.json()

  return {
    async createJob(workspaceId, documentIds, signal) {
      if (
        !Array.isArray(documentIds) ||
        documentIds.length < 1 ||
        documentIds.length > ZIP_MAX_IDS ||
        !documentIds.every(isZipDocumentId) ||
        new Set(documentIds).size !== documentIds.length
      ) {
        throw new UniworkDocError('not_found')
      }
      const raw = await send({
        method: 'POST',
        route: zipCreateRoute(workspaceId),
        json: { document_ids: documentIds },
        timeoutMs: metadataTimeout,
        ...(signal ? { signal } : {}),
        read: json,
      })
      return parseZipJob(raw)
    },

    async getJob(workspaceId, jobId, signal) {
      const raw = await send({
        method: 'GET',
        route: zipJobRoute(workspaceId, jobId),
        timeoutMs: metadataTimeout,
        ...(signal ? { signal } : {}),
        read: json,
      })
      const job = parseZipJob(raw)
      if (job.id !== jobId) throw new UniworkDocError('malformed_response')
      return job
    },

    async fetchZip(target, write, fetchOptions = {}) {
      const route = zipDownloadRoute(target.downloadUrl, target.workspaceId, target.jobId)
      if (!route) throw new UniworkDocError('malformed_response')
      const { signal, onProgress } = fetchOptions
      const maxBytes = fetchOptions.maxBytes ?? ZIP_MAX_BYTES
      // `send` turns anything but a UniworkDocError into malformed_response: the
      // sink's own failure (disk full, permission) is kept aside and rethrown as it was
      let sinkFailure: { error: unknown } | null = null
      try {
        return await send({
          method: 'GET',
          route,
          // no chunk for transferTimeout ends it, not the whole transfer
          timeoutMs: transferTimeout,
          idle: { ceilingMs: streamCeiling },
          ...(signal ? { signal } : {}),
          async read(response, progress) {
            const header = response.headers.get('Content-Length')
            const declared = header === null ? NaN : Number(header)
            if (declared > maxBytes) {
              void response.body?.cancel().catch(() => undefined)
              throw new UniworkDocError('too_large')
            }
            const totalBytes = Number.isSafeInteger(declared) && declared >= 0 ? declared : null
            // a 200 with no readable body is refused: there is nothing to stream
            if (!response.body) throw new UniworkDocError('malformed_response')
            const reader = response.body.getReader()
            // `send` detaches the caller's abort once the server answered: the body
            // read listens to it itself, so a cancel ends the stream too
            const stop = () => void reader.cancel().catch(() => undefined)
            signal?.addEventListener('abort', stop, { once: true })
            let receivedBytes = 0
            try {
              for (;;) {
                if (signal?.aborted) throw new UniworkDocError('network')
                let step: ReadableStreamReadResult<Uint8Array>
                try {
                  step = await reader.read()
                } catch {
                  throw new UniworkDocError('network')
                }
                if (signal?.aborted) throw new UniworkDocError('network')
                if (step.done) break
                receivedBytes += step.value.byteLength
                if (receivedBytes > maxBytes) {
                  stop()
                  throw new UniworkDocError('too_large')
                }
                try {
                  await write(step.value)
                } catch (error) {
                  stop()
                  sinkFailure = { error }
                  throw new UniworkDocError('server_error')
                }
                progress?.()
                onProgress?.({ receivedBytes, totalBytes })
              }
            } finally {
              signal?.removeEventListener('abort', stop)
            }
            return { bytes: receivedBytes }
          },
        })
      } catch (error) {
        const failure = sinkFailure as { error: unknown } | null
        if (failure) throw failure.error
        throw error
      }
    },
  }
}
