import { UniworkDocError } from './errors'

/**
 * UNI-2518: a document download as sequential Range requests, so a connection that
 * drops mid-body costs one chunk instead of the whole file. The transport (auth,
 * timeouts, error mapping) stays with the caller: it hands in `readChunk`, one
 * request-and-read, and this module owns the chunk walk, the per-chunk retry and the
 * integrity checks. Only the documents client uses it; the offline library reaches it
 * through `downloadStream`.
 */

/** bytes per Range request */
export const RANGE_CHUNK_BYTES = 8 * 1024 * 1024
/** tries per chunk (the first one included) */
export const RANGE_CHUNK_ATTEMPTS = 3
const RETRY_BASE_MS = 250

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
  maxBytes: number
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

/**
 * Reads the whole file. One request when the file fits a chunk; a server that answers
 * 200 to the Range request is read in that one piece; otherwise each next window is a
 * request of its own, retried alone. The assembled length must equal the Content-Range
 * total, else `malformed_response` (nothing partial is returned). The last error of an
 * exhausted chunk is thrown as it came, so the user-facing copy is the one a cut
 * download had before chunking.
 */
export async function downloadInChunks(input: RangedDownloadInput): Promise<{ bytes: Uint8Array }> {
  const chunkBytes = input.chunkBytes ?? RANGE_CHUNK_BYTES
  const backoff = input.backoffMs ?? ((n: number) => RETRY_BASE_MS * 2 ** (n - 1))
  const { signal } = input
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
      if (size > input.maxBytes) throw new UniworkDocError('too_large')
      return { bytes: first.bytes }
    }
    const { total } = first
    pinned = first.checksum
    if (total > input.maxBytes) throw new UniworkDocError('too_large')
    size = total
    if (first.bytes.byteLength === total) return { bytes: first.bytes }
    // one buffer of the file's size, filled window by window: the chunk arrays are never
    // kept side by side with a joined copy
    const bytes = new Uint8Array(total)
    bytes.set(first.bytes, 0)
    let got = first.bytes.byteLength
    done = got
    while (got < total) {
      const range = { start: got, end: Math.min(got + chunkBytes, total) - 1 }
      const next = await attempt(range, total)
      // a plain 200 in the middle of a ranged walk cannot be placed in the file
      if (next.kind !== 'partial') throw new UniworkDocError('malformed_response')
      chunks++
      bytes.set(next.bytes, got)
      got += next.bytes.byteLength
      done = got
      report(0, total)
    }
    if (got !== total) throw new UniworkDocError('malformed_response')
    return { bytes }
  } catch (error) {
    outcome = error instanceof UniworkDocError ? error.code : 'error'
    throw error
  } finally {
    if (chunks > 1 || retries > 0 || outcome !== 'ok') {
      input.log?.(
        `uniwork docs: ranged download ${input.label} requests=${requests} chunks=${chunks} retries=${retries} bytes=${size} outcome=${outcome}`,
      )
    }
  }
}
