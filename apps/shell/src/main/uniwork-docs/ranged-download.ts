import { randomBytes } from 'node:crypto'
import { lstat, open, rename, unlink, type FileHandle } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { UniworkDocError } from './errors'

/**
 * UNI-2518 / UNI-2525: a document download as sequential Range requests, so a
 * connection that drops mid-body costs one chunk instead of the whole file, and
 * verified chunks stream directly to a sibling temp file (fsync + atomic rename)
 * so peak memory is one chunk. The transport (auth, timeouts, error mapping)
 * stays with the caller: it hands in `readChunk`, one request-and-read, and this
 * module owns the chunk walk, the per-chunk retry, the integrity checks and the
 * temp-file lifecycle.
 */

/** bytes per Range request */
export const RANGE_CHUNK_BYTES = 8 * 1024 * 1024
/** tries per chunk (the first one included) */
export const RANGE_CHUNK_ATTEMPTS = 3
const RETRY_BASE_MS = 250
/** default 256 MiB cap for callers that keep the assembled payload in memory */
export const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024
const RETRYABLE_RENAME_CODES: Record<string, true> = {
  EPERM: true,
  EACCES: true,
  EBUSY: true,
}
const RENAME_RETRIES = 4
const RENAME_BACKOFF_BASE_MS = 50
// cloud-sync folders, AV locks and fsync-less filesystems may refuse fsync after a write
const TOLERATED_SYNC_CODES: Record<string, true> = {
  EPERM: true,
  EACCES: true,
  EBUSY: true,
  EINVAL: true,
  ENOSYS: true,
}
export interface ContentRange {
  start: number
  end: number
  total: number
}

const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+)$/

/** `bytes 0-8388607/20971520`, or null when the header is absent or not that shape */
export function parseContentRange(header: string | null): ContentRange | null {
  const match = CONTENT_RANGE.exec(header ?? '')
  if (!match) return null
  const [start, end, total] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (![start, end, total].every(Number.isSafeInteger)) return null
  return { start, end, total }
}

/**
 * what one request delivered: a 200 body (the whole file) or a 206 window of it. A window
 * carries the server's whole-file `X-Checksum-Sha256` (null when it sent none), the
 * only marker that tells two same-size versions apart.
 */
export type RangedChunk =
  | { kind: 'whole'; bytes: Uint8Array }
  | ({ kind: 'partial'; bytes: Uint8Array; checksum: string | null } & ContentRange)

export interface ChunkProgress {
  receivedBytes: number
  totalBytes: number | null
}

export interface RangedDownloadInput {
  /**
   * One request and the read of its body; `range` undefined is a plain GET. A failure
   * throws a UniworkDocError; the walk decides whether to try it again.
   */
  readChunk(
    range: { start: number; end: number } | undefined,
    onProgress: (progress: ChunkProgress) => void,
  ): Promise<RangedChunk>
  /** a file whose Content-Range total passes this is refused as too_large */
  maxBytes?: number
  signal?: AbortSignal
  onProgress?: (progress: ChunkProgress) => void
  /** one line per download that used more than one request or failed; ids only */
  log?: (line: string) => void
  /** names the download in that line (document id and version, never a title or URL) */
  label: string
  chunkBytes?: number
  /** epoch ms after which no window is requested or retried (the transfer's shared ceiling) */
  deadline?: number
  /** test seam: the wait before try n+1 (n >= 1) */
  backoffMs?: (failedAttempt: number) => number
}

export interface RangedFileDownloadInput extends RangedDownloadInput {
  /**
   * UNI-2525: destination file path. Each verified chunk is written to a sibling
   * `.uw-dl-*.tmp` in `dirname(resolve(destinationPath))` (same volume), fsynced
   * and atomically renamed onto the destination; any failure removes the temp
   * file and leaves nothing at the destination.
   */
  destinationPath: string
  /** optional guard run before creating the sibling temp file */
  beforeOpen?: () => Promise<void>
  /** optional guard run after flushing/closing the temp file, immediately before rename */
  beforeRename?: () => Promise<void>
}

function transient(error: unknown): boolean {
  if (!(error instanceof UniworkDocError)) return false
  if (error.code === 'network' || error.code === 'timeout') return true
  return (
    error.code === 'server_error' &&
    (error.status === undefined || error.status >= 500 || error.status === 429)
  )
}

// Promise.withResolvers is outside this target's lib (ES2022): the executor form is equivalent
function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UniworkDocError('network'))
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new UniworkDocError('network'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

interface ChunkSink<T> {
  write(bytes: Uint8Array, totalBytes: number): Promise<void>
  commit(totalBytes: number): Promise<T>
  abort(): Promise<void>
}

function createFileSink(
  input: RangedFileDownloadInput,
): ChunkSink<{ path: string; bytes: number }> {
  const { destinationPath, signal } = input
  const resolvedTarget = resolve(destinationPath)
  const tmp = join(dirname(resolvedTarget), `.uw-dl-${randomBytes(8).toString('hex')}.tmp`)
  let handle: FileHandle | null = null
  let createdTmp = false
  let targetMode = 0o600

  const ensureOpen = async (): Promise<FileHandle> => {
    if (handle) return handle
    await input.beforeOpen?.()
    if (signal?.aborted) throw new UniworkDocError('network')
    const existingStat = await lstat(resolvedTarget).catch(() => null)
    targetMode = existingStat?.isFile() ? existingStat.mode & 0o777 : 0o600
    handle = await open(tmp, 'wx', 0o600)
    createdTmp = true
    if (signal?.aborted) throw new UniworkDocError('network')
    return handle
  }

  return {
    async write(bytes) {
      const fd = await ensureOpen()
      let offset = 0
      while (offset < bytes.byteLength) {
        if (signal?.aborted) throw new UniworkDocError('network')
        const { bytesWritten } = await fd.write(bytes, offset, bytes.byteLength - offset)
        if (bytesWritten <= 0) throw new Error('short write')
        offset += bytesWritten
      }
    },
    async commit(totalBytes) {
      const fd = await ensureOpen()
      await fd.chmod(targetMode)
      try {
        await fd.sync()
      } catch (error) {
        if (!TOLERATED_SYNC_CODES[(error as NodeJS.ErrnoException | null)?.code ?? '']) {
          throw error
        }
      }
      handle = null
      await fd.close()
      if (signal?.aborted) throw new UniworkDocError('network')
      await input.beforeRename?.()
      if (signal?.aborted) throw new UniworkDocError('network')
      const renameBackoff =
        input.backoffMs ?? ((n: number) => RENAME_BACKOFF_BASE_MS * 2 ** (n - 1))
      for (let attempt = 0; ; attempt += 1) {
        try {
          await rename(tmp, resolvedTarget)
          break
        } catch (error) {
          const code = (error as NodeJS.ErrnoException | null)?.code ?? ''
          if (!RETRYABLE_RENAME_CODES[code] || attempt >= RENAME_RETRIES) throw error
          await wait(renameBackoff(attempt + 1), signal)
        }
      }
      createdTmp = false
      return { path: destinationPath, bytes: totalBytes }
    },
    async abort() {
      if (handle) {
        const fd = handle
        handle = null
        await fd.close().catch(() => undefined)
      }
      if (createdTmp) {
        createdTmp = false
        await unlink(tmp).catch(() => undefined)
      }
    },
  }
}

function createBytesSink(): ChunkSink<{ bytes: Uint8Array }> {
  let buffer: Uint8Array | null = null
  let offset = 0
  return {
    async write(bytes, totalBytes) {
      if (bytes.byteLength === totalBytes && offset === 0) {
        buffer = bytes
        offset = bytes.byteLength
        return
      }
      if (!buffer) buffer = new Uint8Array(totalBytes)
      buffer.set(bytes, offset)
      offset += bytes.byteLength
    },
    async commit(totalBytes) {
      if (!buffer) return { bytes: new Uint8Array(0) }
      return { bytes: offset === totalBytes ? buffer : buffer.subarray(0, totalBytes) }
    },
    async abort() {
      buffer = null
    },
  }
}

/**
 * Reads the whole file in sequential Range windows. When `destinationPath` is
 * given, each verified window is written directly to a sibling `.uw-dl-*.tmp`
 * file, fsynced and atomically renamed onto `destinationPath` (peak memory = one
 * chunk, with no default size cap unless `maxBytes` is given). Otherwise,
 * assembles `{ bytes }` under `maxBytes` (default `MAX_DOWNLOAD_BYTES`). One
 * request when the file fits a chunk; a server
 * that answers 200 to the Range request is written in that one piece; otherwise
 * each next window is a request of its own, retried alone. The assembled length
 * must equal the Content-Range total, else `malformed_response` (temp file
 * removed, nothing left at the destination).
 */
export function downloadInChunks(
  input: RangedFileDownloadInput,
): Promise<{ path: string; bytes: number }>
export function downloadInChunks(input: RangedDownloadInput): Promise<{ bytes: Uint8Array }>
export async function downloadInChunks(
  input: RangedDownloadInput | RangedFileDownloadInput,
): Promise<{ path: string; bytes: number } | { bytes: Uint8Array }> {
  const chunkBytes = input.chunkBytes ?? RANGE_CHUNK_BYTES
  const toDisk = 'destinationPath' in input && typeof input.destinationPath === 'string'
  const maxBytes = input.maxBytes ?? (toDisk ? Infinity : MAX_DOWNLOAD_BYTES)
  const backoff = input.backoffMs ?? ((n: number) => RETRY_BASE_MS * 2 ** (n - 1))
  const { signal } = input
  const sink: ChunkSink<{ path: string; bytes: number } | { bytes: Uint8Array }> = toDisk
    ? createFileSink(input)
    : createBytesSink()
  let requests = 0
  let retries = 0
  let high = 0
  let done = 0
  // the whole-file checksum of the first window; every later window must carry the same one
  let pinned: string | null = null

  const report = (chunkReceived: number, totalBytes: number | null): void => {
    high = Math.max(high, done + chunkReceived)
    input.onProgress?.({ receivedBytes: high, totalBytes })
  }

  /** one window, tried up to RANGE_CHUNK_ATTEMPTS times; only this window is repeated */
  const attempt = async (
    range: { start: number; end: number } | undefined,
    knownTotal: number | null,
  ): Promise<RangedChunk> => {
    for (let n = 1; ; n++) {
      // the shared ceiling passed: another window could only time out at once
      if (input.deadline !== undefined && Date.now() >= input.deadline) {
        throw new UniworkDocError('timeout')
      }
      requests++
      try {
        const chunk = await input.readChunk(range, (p) =>
          report(p.receivedBytes, knownTotal ?? p.totalBytes),
        )
        if (chunk.kind === 'partial' && range) {
          const { start, end, total } = chunk
          const declared = end - start + 1
          if (
            start !== range.start ||
            end < start ||
            end > range.end ||
            end >= total ||
            (knownTotal !== null && total !== knownTotal) ||
            chunk.bytes.byteLength > declared
          ) {
            // the file changed under the download, or the wrong window came back
            throw new UniworkDocError('malformed_response')
          }
          // another version answered this window (same size, different checksum, or none)
          if (pinned !== null && chunk.checksum !== pinned) {
            throw new UniworkDocError('malformed_response')
          }
          // a body shorter than its declared window is a cut, not a verdict
          if (chunk.bytes.byteLength < declared) throw new UniworkDocError('network')
        }
        return chunk
      } catch (error) {
        if (signal?.aborted || !transient(error) || n >= RANGE_CHUNK_ATTEMPTS) throw error
        retries++
        await wait(backoff(n), signal)
      }
    }
  }

  let outcome = 'ok'
  let chunks = 0
  let size = 0
  try {
    let total = 0
    let got = 0
    {
      let first: RangedChunk
      try {
        first = await attempt({ start: 0, end: chunkBytes - 1 }, null)
      } catch (error) {
        // an empty file has no satisfiable range: it is read plainly
        if (!(error instanceof UniworkDocError && error.status === 416)) throw error
        first = await attempt(undefined, null)
      }
      chunks = 1
      if (first.kind === 'whole') {
        size = first.bytes.byteLength
        if (size > maxBytes) throw new UniworkDocError('too_large')
        await sink.write(first.bytes, size)
        return await sink.commit(size)
      }
      total = first.total
      pinned = first.checksum
      if (total > maxBytes) throw new UniworkDocError('too_large')
      size = total
      got = first.bytes.byteLength
      await sink.write(first.bytes, total)
      done = got
    }
    if (got === total) return await sink.commit(total)
    while (got < total) {
      const range = { start: got, end: Math.min(got + chunkBytes, total) - 1 }
      const next = await attempt(range, total)
      // a plain 200 in the middle of a ranged walk cannot be placed in the file
      if (next.kind !== 'partial') throw new UniworkDocError('malformed_response')
      chunks++
      await sink.write(next.bytes, total)
      got += next.bytes.byteLength
      done = got
      report(0, total)
    }
    if (got !== total) throw new UniworkDocError('malformed_response')
    return await sink.commit(total)
  } catch (error) {
    outcome = error instanceof UniworkDocError ? error.code : 'error'
    await sink.abort()
    throw error
  } finally {
    if (chunks > 1 || retries > 0 || outcome !== 'ok') {
      input.log?.(
        `uniwork docs: ranged download ${input.label} requests=${requests} chunks=${chunks} retries=${retries} bytes=${size} outcome=${outcome}`,
      )
    }
  }
}
