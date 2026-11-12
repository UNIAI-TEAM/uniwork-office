import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import v8 from 'node:v8'
import vm from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_DOWNLOAD_BYTES,
  createUniworkDocsClient,
  type FetchLike,
} from '../src/main/uniwork-docs/client'
import { docHistoryErrorOf } from '../src/main/uniwork-docs/doc-history-service'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { downloadInChunks } from '../src/main/uniwork-docs/ranged-download'
import { zipErrorOf } from '../src/main/uniwork-docs/zip-download/runner'

const renameHook = vi.hoisted(() => ({
  onRename: null as ((src: string, dest: string) => void) | null,
  onBeforeWrite: null as ((buf: Uint8Array, length: number) => void) | null,
  onAfterWrite: null as ((bytesWritten: number) => void) | null,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<{
    open: (path: string, flags?: string | number, mode?: number) => Promise<FileHandle>
    rename: (src: string, dest: string) => Promise<void>
  }>()
  return {
    ...actual,
    open: async (path: string, flags?: string | number, mode?: number) => {
      const handle = await actual.open(path, flags, mode)
      const realWrite = handle.write.bind(handle)
      handle.write = (async (
        buf: Uint8Array,
        offset?: number | null,
        length?: number | null,
        position?: number | null,
      ) => {
        const writeLen = typeof length === 'number' ? length : buf.byteLength
        renameHook.onBeforeWrite?.(buf, writeLen)
        const res = await realWrite(buf, offset, length, position)
        renameHook.onAfterWrite?.(res.bytesWritten)
        return res
      }) as typeof handle.write
      return handle
    },
    rename: async (src: string, dest: string) => {
      if (renameHook.onRename) {
        renameHook.onRename(String(src), String(dest))
      }
      return actual.rename(src, dest)
    },
  }
})
// UNI-2518 / UNI-2525: the desktop download walks the file in 8 MiB Range windows
// and streams each verified window to a sibling temp file (fsync + atomic rename)
const ORIGIN = 'https://uniwork.example'
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const CHUNK = 8 * 1024 * 1024

/** deterministic byte at offset `i` so any window can be generated or checked without a full-file buffer */
function byteAt(i: number): number {
  return (Math.imul(i + 1, 2654435761) >>> 24) & 0xff
}

function sliceOf(start: number, endInclusive: number): Uint8Array {
  const len = endInclusive - start + 1
  const out = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    out[i] = byteAt(start + i)
  }
  return out
}

function fileOf(size: number): Uint8Array {
  return size === 0 ? new Uint8Array(0) : sliceOf(0, size - 1)
}

interface FakeServer {
  fetch: FetchLike
  /** the Range header of every request, in order (`plain` when none) */
  ranges: string[]
}

interface FakeOptions {
  /** ignores Range and answers 200 with the whole file */
  noRange?: boolean
  /** called per request; 'cut' ends that body half way with a stream error, a status answers that status */
  behave?: (range: string, nth: number) => 'cut' | 'ok' | { total: number } | { status: number }
  /** the X-Checksum-Sha256 of a window (none when it returns undefined) */
  checksum?: (range: string, nth: number) => string | undefined
}

function server(file: Uint8Array, options: FakeOptions = {}): FakeServer {
  const ranges: string[] = []
  const seen = new Map<string, number>()
  const fetchImpl: FetchLike = async (_url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    const range = headers.Range ?? 'plain'
    ranges.push(range)
    const nth = (seen.get(range) ?? 0) + 1
    seen.set(range, nth)
    const match = /^bytes=(\d+)-(\d+)$/.exec(range)
    if (!match || options.noRange) {
      return new Response(file as BlobPart, {
        status: 200,
        headers: { 'Content-Length': String(file.byteLength) },
      })
    }
    const start = Number(match[1])
    if (file.byteLength === 0 || start >= file.byteLength) {
      return new Response('{}', { status: 416, headers: { 'Content-Type': 'application/json' } })
    }
    const end = Math.min(Number(match[2]), file.byteLength - 1)
    const body = file.subarray(start, end + 1)
    const verdict = options.behave?.(range, nth) ?? 'ok'
    if (typeof verdict === 'object' && 'status' in verdict) {
      return new Response('{}', {
        status: verdict.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const total = typeof verdict === 'object' ? verdict.total : file.byteLength
    const checksum = options.checksum?.(range, nth)
    const responseHeaders: Record<string, string> = {
      'Content-Length': String(body.byteLength),
      'Content-Range': `bytes ${start}-${end}/${total}`,
      ...(checksum === undefined ? {} : { 'X-Checksum-Sha256': checksum }),
    }
    if (verdict === 'cut') {
      const half = body.subarray(0, Math.floor(body.byteLength / 2))
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(half)
          controller.error(new Error('connection reset'))
        },
      })
      return new Response(stream, { status: 206, headers: responseHeaders })
    }
    return new Response(body as BlobPart, { status: 206, headers: responseHeaders })
  }
  return { fetch: fetchImpl, ranges }
}

function api(fetch: FetchLike, extra: { streamCeilingMs?: number } = {}) {
  return createUniworkDocsClient({
    apiOrigin: ORIGIN,
    authorized: <T>(call: (token: string) => Promise<T>) => call('tok'),
    isSignedIn: () => true,
    fetch,
    ...extra,
  })
}

/** how a download ended: arrival or the error code that stopped it */
function ending(download: Promise<unknown>): Promise<string> {
  return download.then(
    () => 'resolved',
    (error: unknown) => (error instanceof UniworkDocError ? error.code : 'other'),
  )
}

const win = (index: number, size: number): string =>
  `bytes=${index * CHUNK}-${Math.min((index + 1) * CHUNK, size) - 1}`

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-ranged-dl-'))
})

afterEach(() => {
  renameHook.onRename = null
  renameHook.onBeforeWrite = null
  renameHook.onAfterWrite = null
  vi.restoreAllMocks()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('downloadStream in Range windows to disk (UNI-2518 / UNI-2525)', () => {
  const SIZE = 2 * CHUNK + 17

  it('streams a multi-chunk file to a sibling temp file, fsyncs + renames, and writes identical bytes on disk', async () => {
    const file = fileOf(SIZE)
    const fake = server(file)
    const dest = join(dir, 'report.pdf')
    const progress: number[] = []
    const totals = new Set<number | null>()
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = await api(fake.fetch).downloadStream(DOC, 3, {
      destinationPath: dest,
      onProgress: (p) => {
        progress.push(p.receivedBytes)
        totals.add(p.totalBytes)
      },
    })
    expect(result).toEqual({ path: dest, bytes: SIZE })
    expect(Buffer.compare(readFileSync(dest), Buffer.from(file))).toBe(0)
    expect(readdirSync(dir)).toEqual(['report.pdf'])
    expect(fake.ranges).toEqual([win(0, SIZE), win(1, SIZE), win(2, SIZE)])
    expect(progress.at(-1)).toBe(SIZE)
    expect([...progress].sort((a, b) => a - b)).toEqual(progress)
    expect([...totals]).toEqual([SIZE])
    // one diagnostic line: ids and counts only, never the destination path or URL
    expect(log).toHaveBeenCalledTimes(1)
    const line = String(log.mock.calls[0]?.[0])
    expect(line).toContain(`document=${DOC}`)
    expect(line).toContain('version=3')
    expect(line).toContain('requests=3')
    expect(line).toContain('outcome=ok')
    expect(line).not.toContain(ORIGIN)
    expect(line).not.toContain(dir)
    expect(line).not.toContain('report.pdf')
    expect(line).not.toMatch(/https?:|\.docx|\.pdf|tok/)
  })

  it('keeps memory bounded to one chunk through the real client.ts multi-part stream reader across N=2 vs N=6 windows (T1-1)', async () => {
    v8.setFlagsFromString('--expose_gc')
    const gc = vm.runInNewContext('gc') as () => void
    const subChunkBytes = Math.floor(CHUNK / 4)

    async function measureWalk(fullWindows: number): Promise<{
      peakBufferedBytes: number
      peakWriteBufferBytes: number
      peakRetainedFromPriorWindows: number
      windowsServed: number
    }> {
      const totalSize = fullWindows * CHUNK + 19
      const dest = join(dir, `bounded-${fullWindows}.bin`)
      let bufferedBytes = 0
      let peakBufferedBytes = 0
      let peakWriteBufferBytes = 0
      let peakRetainedFromPriorWindows = 0
      let windowsServed = 0
      const liveBuffers: Array<WeakRef<Uint8Array>> = []

      renameHook.onBeforeWrite = (buf, writeLen) => {
        liveBuffers.push(new WeakRef(buf))
        if (buf.byteLength > peakWriteBufferBytes) peakWriteBufferBytes = buf.byteLength
        if (writeLen > peakWriteBufferBytes) peakWriteBufferBytes = writeLen
        if (bufferedBytes > peakBufferedBytes) peakBufferedBytes = bufferedBytes
      }
      renameHook.onAfterWrite = (bytesWritten) => {
        bufferedBytes -= bytesWritten
      }

      const fetch: FetchLike = async (_url, init) => {
        const headers = (init?.headers ?? {}) as Record<string, string>
        const match = /^bytes=(\d+)-(\d+)$/.exec(headers.Range ?? '')
        if (!match) throw new Error(`expected Range header, got ${String(headers.Range)}`)
        if (windowsServed > 0) {
          // Yield a macrotask turn so V8 clears WeakRef keptObjects, then force GC to prove
          // prior window sub-chunks and joined Uint8Array buffers are not retained in memory
          await new Promise<void>((resolve) => setImmediate(resolve))
          gc()
          const retained = liveBuffers.reduce((sum, ref) => sum + (ref.deref()?.byteLength ?? 0), 0)
          if (retained > peakRetainedFromPriorWindows) {
            peakRetainedFromPriorWindows = retained
          }
        }
        windowsServed += 1
        const start = Number(match[1])
        const end = Math.min(Number(match[2]), totalSize - 1)
        const windowLen = end - start + 1
        let cursor = start
        const stream = new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              if (cursor > end) {
                controller.close()
                return
              }
              const subEnd = Math.min(cursor + subChunkBytes - 1, end)
              const sub = sliceOf(cursor, subEnd)
              cursor = subEnd + 1
              liveBuffers.push(new WeakRef(sub))
              bufferedBytes += sub.byteLength
              if (bufferedBytes > peakBufferedBytes) peakBufferedBytes = bufferedBytes
              controller.enqueue(sub)
            },
          },
          { highWaterMark: 0 },
        )
        return new Response(stream, {
          status: 206,
          headers: {
            'Content-Length': String(windowLen),
            'Content-Range': `bytes ${start}-${end}/${totalSize}`,
            'X-Checksum-Sha256': 'cc'.repeat(32),
          },
        })
      }

      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      try {
        const out = await api(fetch).downloadStream(DOC, 1, { destinationPath: dest })
        expect(out).toEqual({ path: dest, bytes: totalSize })
      } finally {
        renameHook.onBeforeWrite = null
        renameHook.onAfterWrite = null
      }

      expect(bufferedBytes).toBe(0)
      const disk = readFileSync(dest)
      expect(disk.byteLength).toBe(totalSize)
      for (let offset = 0; offset < totalSize; offset += CHUNK) {
        const end = Math.min(offset + CHUNK, totalSize) - 1
        expect(
          Buffer.compare(disk.subarray(offset, end + 1), Buffer.from(sliceOf(offset, end))),
        ).toBe(0)
      }
      unlinkSync(dest)
      return {
        peakBufferedBytes,
        peakWriteBufferBytes,
        peakRetainedFromPriorWindows,
        windowsServed,
      }
    }

    const twoChunk = await measureWalk(2)
    const sixChunk = await measureWalk(6)
    expect(twoChunk.windowsServed).toBe(3)
    expect(sixChunk.windowsServed).toBe(7)
    // Stream-to-disk buffered bytes peak at exactly one 8 MiB chunk for both N=2 and N=6
    expect(twoChunk.peakBufferedBytes).toBe(CHUNK)
    expect(sixChunk.peakBufferedBytes).toBe(CHUNK)
    expect(twoChunk.peakWriteBufferBytes).toBe(CHUNK)
    expect(sixChunk.peakWriteBufferBytes).toBe(CHUNK)
    // Prior windows' sub-chunks and joined window buffers are unreachable once written to disk
    expect(twoChunk.peakRetainedFromPriorWindows).toBe(0)
    expect(sixChunk.peakRetainedFromPriorWindows).toBe(0)
  })

  it('re-requests only the chunk that was dropped mid-stream', async () => {
    const file = fileOf(SIZE)
    const fake = server(file, {
      behave: (range, nth) => (range === win(1, SIZE) && nth === 1 ? 'cut' : 'ok'),
    })
    const dest = join(dir, 'retried.bin')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = await api(fake.fetch).downloadStream(DOC, undefined, {
      destinationPath: dest,
    })
    expect(result).toEqual({ path: dest, bytes: SIZE })
    expect(Buffer.compare(readFileSync(dest), Buffer.from(file))).toBe(0)
    expect(readdirSync(dir)).toEqual(['retried.bin'])
    expect(fake.ranges).toEqual([win(0, SIZE), win(1, SIZE), win(1, SIZE), win(2, SIZE)])
  })

  it('fails after 3 tries of one chunk, removes the temp file, leaves no destination file, and asks for nothing later', async () => {
    const file = fileOf(SIZE)
    let tempSeenMidWalk = false
    const fake = server(file, {
      behave: (range) => {
        if (range === win(1, SIZE)) {
          tempSeenMidWalk ||= readdirSync(dir).some((name) => name.startsWith('.uw-dl-'))
          return 'cut'
        }
        return 'ok'
      },
    })
    const dest = join(dir, 'failed.bin')
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = await ending(
      api(fake.fetch).downloadStream(DOC, undefined, { destinationPath: dest }),
    )
    expect(result).toBe('network')
    expect(tempSeenMidWalk).toBe(true)
    expect(existsSync(dest)).toBe(false)
    expect(readdirSync(dir)).toEqual([])
    expect(fake.ranges).toEqual([win(0, SIZE), win(1, SIZE), win(1, SIZE), win(1, SIZE)])
    expect(String(log.mock.calls.at(-1)?.[0])).toContain('retries=2')
    expect(String(log.mock.calls.at(-1)?.[0])).toContain('outcome=network')
  })

  it('reads a server that ignores Range in one request and writes the file atomically', async () => {
    const file = fileOf(SIZE)
    const fake = server(file, { noRange: true })
    const dest = join(dir, 'whole.bin')
    const result = await api(fake.fetch).downloadStream(DOC, undefined, {
      destinationPath: dest,
    })
    expect(result).toEqual({ path: dest, bytes: SIZE })
    expect(Buffer.compare(readFileSync(dest), Buffer.from(file))).toBe(0)
    expect(readdirSync(dir)).toEqual(['whole.bin'])
    expect(fake.ranges).toHaveLength(1)
  })

  it('refuses a file whose total changes between windows, removes the temp file, and leaves nothing at the destination', async () => {
    const file = fileOf(SIZE)
    const fake = server(file, {
      behave: (range) => (range === win(1, SIZE) ? { total: SIZE + 5 } : 'ok'),
    })
    const dest = join(dir, 'mismatch.bin')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const code = await ending(
      api(fake.fetch).downloadStream(DOC, undefined, { destinationPath: dest }),
    )
    expect(code).toBe('malformed_response')
    expect(existsSync(dest)).toBe(false)
    expect(readdirSync(dir)).toEqual([])
    expect(fake.ranges).toEqual([win(0, SIZE), win(1, SIZE)])
  })

  it('a file of one chunk or less is one request, and an empty file is written plainly', async () => {
    const small = fileOf(1000)
    const one = server(small)
    const smallDest = join(dir, 'small.bin')
    const got = await api(one.fetch).downloadStream(DOC, undefined, {
      destinationPath: smallDest,
    })
    expect(got).toEqual({ path: smallDest, bytes: 1000 })
    expect(Buffer.compare(readFileSync(smallDest), Buffer.from(small))).toBe(0)
    expect(one.ranges).toEqual([`bytes=0-${CHUNK - 1}`])

    const empty = server(new Uint8Array(0))
    const emptyDest = join(dir, 'empty.bin')
    const none = await api(empty.fetch).downloadStream(DOC, undefined, {
      destinationPath: emptyDest,
    })
    expect(none).toEqual({ path: emptyDest, bytes: 0 })
    expect(readFileSync(emptyDest).byteLength).toBe(0)
    expect(empty.ranges).toEqual([`bytes=0-${CHUNK - 1}`, 'plain'])
    expect(readdirSync(dir).sort()).toEqual(['empty.bin', 'small.bin'])
  })

  it('refuses a window of another version (same size, different checksum) and leaves no temp or destination file', async () => {
    const file = fileOf(SIZE)
    const fake = server(file, {
      checksum: (range) => (range === win(1, SIZE) ? 'bb'.repeat(32) : 'aa'.repeat(32)),
    })
    const dest = join(dir, 'version-skew.bin')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const code = await ending(
      api(fake.fetch).downloadStream(DOC, undefined, { destinationPath: dest }),
    )
    expect(code).toBe('malformed_response')
    expect(existsSync(dest)).toBe(false)
    expect(readdirSync(dir)).toEqual([])
    // not retried, no later window
    expect(fake.ranges).toEqual([win(0, SIZE), win(1, SIZE)])
  })

  it('refuses a later window that carries no checksum once the first one did and cleans up the temp file', async () => {
    const file = fileOf(SIZE)
    const fake = server(file, {
      checksum: (range) => (range === win(0, SIZE) ? 'aa'.repeat(32) : undefined),
    })
    const dest = join(dir, 'missing-checksum.bin')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(
      await ending(api(fake.fetch).downloadStream(DOC, undefined, { destinationPath: dest })),
    ).toBe('malformed_response')
    expect(readdirSync(dir)).toEqual([])
    expect(fake.ranges).toEqual([win(0, SIZE), win(1, SIZE)])
  })

  it('reads a file whose windows all carry the same checksum', async () => {
    const file = fileOf(SIZE)
    const fake = server(file, { checksum: () => 'aa'.repeat(32) })
    const dest = join(dir, 'pinned.bin')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = await api(fake.fetch).downloadStream(DOC, undefined, {
      destinationPath: dest,
    })
    expect(result).toEqual({ path: dest, bytes: SIZE })
    expect(Buffer.compare(readFileSync(dest), Buffer.from(file))).toBe(0)
    expect(readdirSync(dir)).toEqual(['pinned.bin'])
  })

  it('keeps the total-only check when the first window has no checksum', async () => {
    const file = fileOf(SIZE)
    const fake = server(file, {
      checksum: (range) => (range === win(0, SIZE) ? undefined : 'bb'.repeat(32)),
    })
    const dest = join(dir, 'no-checksum.bin')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = await api(fake.fetch).downloadStream(DOC, undefined, {
      destinationPath: dest,
    })
    expect(result).toEqual({ path: dest, bytes: SIZE })
    expect(Buffer.compare(readFileSync(dest), Buffer.from(file))).toBe(0)
  })

  it('stops with timeout, removes the temp file, and asks for no more windows once the shared ceiling has passed', async () => {
    const file = fileOf(SIZE)
    let clock = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fake = server(file, {
      behave: (range) => {
        if (range !== win(1, SIZE)) return 'ok'
        // the ceiling (1 s) passes while window 1 is being read, and the body is cut
        clock += 2000
        return 'cut'
      },
    })
    const dest = join(dir, 'ceiling.bin')
    const code = await ending(
      api(fake.fetch, { streamCeilingMs: 1000 }).downloadStream(DOC, undefined, {
        destinationPath: dest,
      }),
    )
    expect(code).toBe('timeout')
    expect(readdirSync(dir)).toEqual([])
    expect(fake.ranges).toEqual([win(0, SIZE), win(1, SIZE)])
  })

  it('does not retry or ask for another window after the caller aborts mid-walk, and removes the temp file', async () => {
    const file = fileOf(SIZE)
    const abort = new AbortController()
    let tempSeenMidWalk = false
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fake = server(file, {
      behave: (range) => {
        if (range !== win(1, SIZE)) return 'ok'
        tempSeenMidWalk = readdirSync(dir).some((name) => name.startsWith('.uw-dl-'))
        abort.abort()
        return 'cut'
      },
    })
    const dest = join(dir, 'aborted.bin')
    const code = await ending(
      api(fake.fetch).downloadStream(DOC, undefined, {
        destinationPath: dest,
        signal: abort.signal,
      }),
    )
    expect(code).toBe('network')
    expect(tempSeenMidWalk).toBe(true)
    expect(existsSync(dest)).toBe(false)
    expect(readdirSync(dir)).toEqual([])
    expect(fake.ranges).toEqual([win(0, SIZE), win(1, SIZE)])
  })

  it('surfaces a 403 on window 2 at once, without retrying it, and removes the temp file', async () => {
    const file = fileOf(SIZE)
    const fake = server(file, {
      behave: (range) => (range === win(1, SIZE) ? { status: 403 } : 'ok'),
    })
    const dest = join(dir, 'forbidden.bin')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = await api(fake.fetch)
      .downloadStream(DOC, undefined, { destinationPath: dest })
      .then(
        () => null,
        (caught: unknown) => caught,
      )
    expect(error).toBeInstanceOf(UniworkDocError)
    expect((error as UniworkDocError).status).toBe(403)
    expect(readdirSync(dir)).toEqual([])
    expect(fake.ranges).toEqual([win(0, SIZE), win(1, SIZE)])
  })

  it('removes the temp file, leaves the destination untouched, and surfaces today error when rename fails', async () => {
    const file = fileOf(SIZE)
    const fake = server(file)
    const dest = join(dir, 'existing.bin')
    writeFileSync(dest, new Uint8Array([1, 2, 3, 4]))
    let stagedSizeAtRename = 0
    let stagedName = ''
    renameHook.onRename = (src) => {
      stagedName = basename(src)
      stagedSizeAtRename = readFileSync(src).byteLength
      throw Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' })
    }
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const caught = await api(fake.fetch)
      .downloadStream(DOC, undefined, { destinationPath: dest })
      .then(
        () => null,
        (error: unknown) => error,
      )
    expect(caught).toBeInstanceOf(Error)
    expect((caught as NodeJS.ErrnoException).code).toBe('EXDEV')
    expect(stagedName).toMatch(/^\.uw-dl-[0-9a-f]{16}\.tmp$/)
    expect(stagedSizeAtRename).toBe(SIZE)
    // today's error surfaces for document/version downloads (`write_failed`)
    expect(zipErrorOf(caught)).toEqual({ code: 'write_failed' })
    expect(docHistoryErrorOf(caught)).toEqual({ ok: false, error: 'server_error' })
    // temp file removed and existing destination untouched
    expect(readdirSync(dir)).toEqual(['existing.bin'])
    expect([...readFileSync(dest)]).toEqual([1, 2, 3, 4])
    // diagnostic log still contains only ids/counts, never the path
    const line = String(log.mock.calls.at(-1)?.[0])
    expect(line).toContain('outcome=error')
    expect(line).not.toContain(dir)
    expect(line).not.toContain('existing.bin')
  })

  it('retries transient EPERM/EACCES/EBUSY on rename and removes the temp file when retries exhaust (R1-7)', async () => {
    const file = fileOf(1024)
    const dest = join(dir, 'transient-eperm.bin')
    writeFileSync(dest, new Uint8Array([1, 2, 3, 4]))
    let attempts = 0
    renameHook.onRename = () => {
      attempts += 1
      if (attempts <= 2) {
        throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' })
      }
    }
    const out = await downloadInChunks({
      destinationPath: dest,
      label: `document=${DOC} version=live`,
      backoffMs: () => 0,
      async readChunk() {
        return { kind: 'whole', bytes: file }
      },
    })
    expect(out).toEqual({ path: dest, bytes: file.byteLength })
    expect(attempts).toBe(3)
    expect(Buffer.compare(readFileSync(dest), Buffer.from(file))).toBe(0)
    expect(readdirSync(dir)).toEqual(['transient-eperm.bin'])

    // When transient EPERM persists past all 4 retries (5 attempts total), temp is removed and dest kept
    writeFileSync(dest, new Uint8Array([9, 9, 9]))
    let exhaustedAttempts = 0
    renameHook.onRename = () => {
      exhaustedAttempts += 1
      throw Object.assign(new Error('EPERM: locked by AV'), { code: 'EPERM' })
    }
    const caught = await downloadInChunks({
      destinationPath: dest,
      label: `document=${DOC} version=live`,
      backoffMs: () => 0,
      async readChunk() {
        return { kind: 'whole', bytes: file }
      },
    }).then(
      () => null,
      (error: unknown) => error,
    )
    expect((caught as NodeJS.ErrnoException)?.code).toBe('EPERM')
    expect(exhaustedAttempts).toBe(5)
    expect(readdirSync(dir)).toEqual(['transient-eperm.bin'])
    expect([...readFileSync(dest)]).toEqual([9, 9, 9])
  })

  it('enforces MAX_DOWNLOAD_BYTES (256 MiB) on the single-GET in-memory download() path and accepts > 50 MiB up to the cap', async () => {
    const payload = new Uint8Array([1, 2, 3, 4])
    for (const declared of [50 * 1024 * 1024 + 1, 200 * 1024 * 1024, MAX_DOWNLOAD_BYTES]) {
      const okFetch = vi.fn<FetchLike>(
        async () =>
          new Response(payload, {
            status: 200,
            headers: { 'Content-Length': String(declared) },
          }),
      )
      expect(await api(okFetch).download(DOC, 1)).toEqual({ bytes: payload })
    }
    const overFetch = vi.fn<FetchLike>(
      async () =>
        new Response(payload, {
          status: 200,
          headers: { 'Content-Length': String(MAX_DOWNLOAD_BYTES + 1) },
        }),
    )
    expect(await ending(api(overFetch).download(DOC, 1))).toBe('too_large')
  })

  it('streamed-to-disk path accepts a declared total above MAX_DOWNLOAD_BYTES (256 MiB) while the bytes path refuses cap + 1', async () => {
    const overCap = MAX_DOWNLOAD_BYTES + 1
    const payload = new Uint8Array([9, 8, 7, 6])

    // 1. Streamed path (destinationPath set) accepts declared Content-Range total > 256 MiB on 206
    //    (writes window 0 and proceeds to request window 1 without throwing too_large)
    const abortAfterFirstWindow = new AbortController()
    const seenRanges: string[] = []
    const seenTotals: Array<number | null> = []
    const rangedOverCapFetch = vi.fn<FetchLike>(async (_url, init) => {
      const range = ((init?.headers ?? {}) as Record<string, string>).Range ?? 'plain'
      seenRanges.push(range)
      if (seenRanges.length === 1) {
        return new Response(payload, {
          status: 206,
          headers: {
            'Content-Length': String(payload.byteLength),
            'Content-Range': `bytes 0-${payload.byteLength - 1}/${overCap}`,
          },
        })
      }
      abortAfterFirstWindow.abort()
      throw new Error('stopped after verifying window 0 accepted')
    })
    const rangedDest = join(dir, 'over-cap-ranged.bin')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(
      await ending(
        api(rangedOverCapFetch).downloadStream(DOC, 1, {
          destinationPath: rangedDest,
          signal: abortAfterFirstWindow.signal,
          onProgress: (p) => seenTotals.push(p.totalBytes),
        }),
      ),
    ).toBe('network')
    expect(seenRanges).toEqual([`bytes=0-${CHUNK - 1}`, `bytes=4-${4 + CHUNK - 1}`])
    expect(seenTotals).toContain(overCap)

    // 2. Streamed path also accepts declared Content-Length > 256 MiB on 200 fallback and commits
    const wholeDest = join(dir, 'over-cap-whole.bin')
    const wholeOverCapFetch = vi.fn<FetchLike>(
      async () =>
        new Response(payload, {
          status: 200,
          headers: { 'Content-Length': String(overCap) },
        }),
    )
    expect(
      await api(wholeOverCapFetch).downloadStream(DOC, 1, { destinationPath: wholeDest }),
    ).toEqual({
      path: wholeDest,
      bytes: payload.byteLength,
    })
    expect([...readFileSync(wholeDest)]).toEqual([9, 8, 7, 6])

    // 3. Bytes path (no destinationPath) refuses MAX_DOWNLOAD_BYTES + 1 on both 206 and 200
    const bytes206Fetch = vi.fn<FetchLike>(
      async () =>
        new Response(payload, {
          status: 206,
          headers: {
            'Content-Length': String(payload.byteLength),
            'Content-Range': `bytes 0-${payload.byteLength - 1}/${overCap}`,
          },
        }),
    )
    expect(await ending(api(bytes206Fetch).downloadStream(DOC, 1))).toBe('too_large')
    expect(await ending(api(wholeOverCapFetch).downloadStream(DOC, 1))).toBe('too_large')
  })
})

describe('downloadSource in Range windows to disk (UNI-2518 / UNI-2525)', () => {
  const SIZE = 2 * CHUNK + 17

  it('streams a multi-window source to disk with identical bytes, one window dropped and retried alone', async () => {
    const file = fileOf(SIZE)
    const urls: string[] = []
    const fake = server(file, {
      behave: (range, nth) => (range === win(1, SIZE) && nth === 1 ? 'cut' : 'ok'),
    })
    const dest = join(dir, 'source.docx')
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = await api(async (url, init) => {
      urls.push(String(url))
      return fake.fetch(url, init)
    }).downloadSource('ws_1', 'chat:att_1', { destinationPath: dest })
    expect(result).toEqual({ path: dest, bytes: SIZE })
    expect(Buffer.compare(readFileSync(dest), Buffer.from(file))).toBe(0)
    expect(readdirSync(dir)).toEqual(['source.docx'])
    expect(fake.ranges).toEqual([win(0, SIZE), win(1, SIZE), win(1, SIZE), win(2, SIZE)])
    expect(new Set(urls)).toEqual(
      new Set([`${ORIGIN}/api/v1/workspaces/ws_1/documents/sources/chat%3Aatt_1/download`]),
    )
    // ids only: the source id, no workspace, path, origin or token
    const line = String(log.mock.calls.at(-1)?.[0])
    expect(line).toContain('source=chat%3Aatt_1')
    expect(line).toContain('retries=1')
    expect(line).not.toContain(dir)
    expect(line).not.toContain('source.docx')
    expect(line).not.toMatch(/ws_1|https?:|tok/)
  })

  it('writes a source route that answers 200 without Range in one request', async () => {
    const file = fileOf(SIZE)
    const fake = server(file, { noRange: true })
    const dest = join(dir, 'source-200.docx')
    const result = await api(fake.fetch).downloadSource('ws_1', 'task:att_1', {
      destinationPath: dest,
    })
    expect(result).toEqual({ path: dest, bytes: SIZE })
    expect(Buffer.compare(readFileSync(dest), Buffer.from(file))).toBe(0)
    expect(readdirSync(dir)).toEqual(['source-200.docx'])
    expect(fake.ranges).toHaveLength(1)
  })

  it('gives the error a cut single GET had when one window keeps failing and leaves no temp or destination file', async () => {
    const file = fileOf(SIZE)
    const fake = server(file, { behave: (range) => (range === win(1, SIZE) ? 'cut' : 'ok') })
    const dest = join(dir, 'source-fail.docx')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(
      await ending(
        api(fake.fetch).downloadSource('ws_1', 'email:att_1', { destinationPath: dest }),
      ),
    ).toBe('network')
    expect(readdirSync(dir)).toEqual([])
    expect(fake.ranges).toEqual([win(0, SIZE), win(1, SIZE), win(1, SIZE), win(1, SIZE)])
  })
})
