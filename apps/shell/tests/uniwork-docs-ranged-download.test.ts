import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUniworkDocsClient, type FetchLike } from '../src/main/uniwork-docs/client'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'

// UNI-2518: the desktop download walks the file in 8 MiB Range windows

const ORIGIN = 'https://uniwork.example'
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const CHUNK = 8 * 1024 * 1024

/** deterministic, non-repeating-by-chunk bytes so a misplaced window is caught */
function fileOf(size: number): Uint8Array {
  const out = new Uint8Array(size)
  let x = 123456789
  for (let i = 0; i < size; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0
    out[i] = x >>> 24
  }
  return out
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

/** how a download ended: the bytes' arrival or the error that stopped it */
function ending(download: Promise<{ bytes: Uint8Array }>): Promise<string> {
  return download.then(
    () => 'resolved',
    (error: unknown) => (error instanceof UniworkDocError ? error.code : 'other'),
  )
}

const win = (index: number, size: number): string =>
  `bytes=${index * CHUNK}-${Math.min((index + 1) * CHUNK, size) - 1}`

afterEach(() => vi.restoreAllMocks())

describe('downloadStream in Range windows (UNI-2518)', () => {
  const SIZE = 2 * CHUNK + 17

  it('reads a multi-chunk file in sequential windows and returns identical bytes', async () => {
    const file = fileOf(SIZE)
    const fake = server(file)
    const progress: number[] = []
    const totals = new Set<number | null>()
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { bytes } = await api(fake.fetch).downloadStream(DOC, 3, {
      onProgress: (p) => {
        progress.push(p.receivedBytes)
        totals.add(p.totalBytes)
      },
    })
    expect(Buffer.compare(Buffer.from(bytes), Buffer.from(file))).toBe(0)
    expect(fake.ranges).toEqual([win(0, SIZE), win(1, SIZE), win(2, SIZE)])
    expect(progress.at(-1)).toBe(SIZE)
    expect([...progress].sort((a, b) => a - b)).toEqual(progress)
    expect([...totals]).toEqual([SIZE])
    // one diagnostic line: ids and counts only
    expect(log).toHaveBeenCalledTimes(1)
    const line = String(log.mock.calls[0]?.[0])
    expect(line).toContain(`document=${DOC}`)
    expect(line).toContain('version=3')
    expect(line).toContain('requests=3')
    expect(line).toContain('outcome=ok')
    expect(line).not.toContain(ORIGIN)
    expect(line).not.toMatch(/https?:|\.docx|\.pdf|tok/)
  })

  it('re-requests only the chunk that was dropped mid-stream', async () => {
    const file = fileOf(SIZE)
    const fake = server(file, {
      behave: (range, nth) => (range === win(1, SIZE) && nth === 1 ? 'cut' : 'ok'),
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { bytes } = await api(fake.fetch).downloadStream(DOC, undefined)
    expect(Buffer.compare(Buffer.from(bytes), Buffer.from(file))).toBe(0)
    expect(fake.ranges).toEqual([win(0, SIZE), win(1, SIZE), win(1, SIZE), win(2, SIZE)])
  })

  it('fails after 3 tries of one chunk, with the error a cut download had, and asks for nothing later', async () => {
    const file = fileOf(SIZE)
    const fake = server(file, { behave: (range) => (range === win(1, SIZE) ? 'cut' : 'ok') })
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = await api(fake.fetch)
      .downloadStream(DOC, undefined)
      .then(
        () => 'resolved',
        (error: unknown) => (error instanceof UniworkDocError ? error.code : 'other'),
      )
    expect(result).toBe('network')
    expect(fake.ranges).toEqual([win(0, SIZE), win(1, SIZE), win(1, SIZE), win(1, SIZE)])
    expect(String(log.mock.calls.at(-1)?.[0])).toContain('retries=2')
    expect(String(log.mock.calls.at(-1)?.[0])).toContain('outcome=network')
  })

  it('reads a server that ignores Range in one request', async () => {
    const file = fileOf(SIZE)
    const fake = server(file, { noRange: true })
    const { bytes } = await api(fake.fetch).downloadStream(DOC, undefined)
    expect(Buffer.compare(Buffer.from(bytes), Buffer.from(file))).toBe(0)
    expect(fake.ranges).toHaveLength(1)
  })

  it('refuses a file whose total changes between windows, without retrying that window', async () => {
    const file = fileOf(SIZE)
    const fake = server(file, {
      behave: (range) => (range === win(1, SIZE) ? { total: SIZE + 5 } : 'ok'),
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const code = await api(fake.fetch)
      .downloadStream(DOC, undefined)
      .then(
        () => 'resolved',
        (error: unknown) => (error instanceof UniworkDocError ? error.code : 'other'),
      )
    expect(code).toBe('malformed_response')
    expect(fake.ranges).toEqual([win(0, SIZE), win(1, SIZE)])
  })

  it('a file of one chunk or less is one request, and an empty file is read plainly', async () => {
    const small = fileOf(1000)
    const one = server(small)
    const got = await api(one.fetch).downloadStream(DOC, undefined)
    expect(Buffer.compare(Buffer.from(got.bytes), Buffer.from(small))).toBe(0)
    expect(one.ranges).toEqual([`bytes=0-${CHUNK - 1}`])

    const empty = server(new Uint8Array(0))
    const none = await api(empty.fetch).downloadStream(DOC, undefined)
    expect(none.bytes.byteLength).toBe(0)
    expect(empty.ranges).toEqual([`bytes=0-${CHUNK - 1}`, 'plain'])
  })

  it('refuses a window of another version (same size, different checksum) and returns nothing', async () => {
    const file = fileOf(SIZE)
    const fake = server(file, {
      checksum: (range) => (range === win(1, SIZE) ? 'bb'.repeat(32) : 'aa'.repeat(32)),
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const code = await ending(api(fake.fetch).downloadStream(DOC, undefined))
    expect(code).toBe('malformed_response')
    // not retried, no later window
    expect(fake.ranges).toEqual([win(0, SIZE), win(1, SIZE)])
  })

  it('refuses a later window that carries no checksum once the first one did', async () => {
    const file = fileOf(SIZE)
    const fake = server(file, {
      checksum: (range) => (range === win(0, SIZE) ? 'aa'.repeat(32) : undefined),
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await ending(api(fake.fetch).downloadStream(DOC, undefined))).toBe('malformed_response')
    expect(fake.ranges).toEqual([win(0, SIZE), win(1, SIZE)])
  })

  it('reads a file whose windows all carry the same checksum', async () => {
    const file = fileOf(SIZE)
    const fake = server(file, { checksum: () => 'aa'.repeat(32) })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { bytes } = await api(fake.fetch).downloadStream(DOC, undefined)
    expect(Buffer.compare(Buffer.from(bytes), Buffer.from(file))).toBe(0)
  })

  it('keeps the total-only check when the first window has no checksum', async () => {
    const file = fileOf(SIZE)
    const fake = server(file, {
      checksum: (range) => (range === win(0, SIZE) ? undefined : 'bb'.repeat(32)),
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { bytes } = await api(fake.fetch).downloadStream(DOC, undefined)
    expect(Buffer.compare(Buffer.from(bytes), Buffer.from(file))).toBe(0)
  })

  it('stops with timeout, and asks for no more windows, once the shared ceiling has passed', async () => {
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
    const code = await ending(
      api(fake.fetch, { streamCeilingMs: 1000 }).downloadStream(DOC, undefined),
    )
    expect(code).toBe('timeout')
    expect(fake.ranges).toEqual([win(0, SIZE), win(1, SIZE)])
  })

  it('does not retry or ask for another window after the caller aborts mid-walk', async () => {
    const file = fileOf(SIZE)
    const abort = new AbortController()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fake = server(file, {
      behave: (range) => {
        if (range !== win(1, SIZE)) return 'ok'
        abort.abort()
        return 'cut'
      },
    })
    const code = await ending(
      api(fake.fetch).downloadStream(DOC, undefined, { signal: abort.signal }),
    )
    expect(code).not.toBe('resolved')
    expect(fake.ranges).toEqual([win(0, SIZE), win(1, SIZE)])
  })

  it('surfaces a 403 on window 2 at once, without retrying it', async () => {
    const file = fileOf(SIZE)
    const fake = server(file, {
      behave: (range) => (range === win(1, SIZE) ? { status: 403 } : 'ok'),
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = await api(fake.fetch)
      .downloadStream(DOC, undefined)
      .then(
        () => null,
        (caught: unknown) => caught,
      )
    expect(error).toBeInstanceOf(UniworkDocError)
    expect((error as UniworkDocError).status).toBe(403)
    expect(fake.ranges).toEqual([win(0, SIZE), win(1, SIZE)])
  })
})
