import {
  closeSync,
  ftruncateSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import { createUniworkDocsClient, type FetchLike } from '../src/main/uniwork-docs/client'
import { parseDocumentLimits, type DocumentLimits } from '../src/main/uniwork-docs/limits'
import type { UploadSessionState, UploadSessionStatus } from '../src/main/uniwork-docs/parse'
import {
  PART_CONCURRENCY,
  abortUploadSession,
  readLocalFileProbe,
  runChunkedUpload,
  shouldUseChunkedUpload,
  type SavedUploadSession,
  type UploadSessionClient,
} from '../src/main/uniwork-docs/upload-session'

/**
 * The bytes every file handle is asked for, so a probe test can assert it is
 * bounded. `open` is the only wrapped function and it delegates to the real
 * one; the counter is armed only while a test asks for it.
 */
const readCount = vi.hoisted(() => ({ bytes: 0, active: false }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      const realRead = handle.read.bind(handle)
      handle.read = (async (...readArgs: unknown[]) => {
        if (readCount.active) readCount.bytes += Number(readArgs[2] ?? 0)
        return (realRead as (...inner: unknown[]) => unknown)(...readArgs)
      }) as typeof handle.read
      return handle
    },
  }
})

/**
 * BIGUP-A1 (UNI-1864): the desktop chunked-upload core. The probe reads a
 * bounded head plus the ZIP tail of a 45 MiB package (never the whole file),
 * refuses a macro package locally before any request, and `runChunkedUpload`
 * uploads six parts four at a time, retrying only the part that failed and
 * re-signing expired URLs without re-sending the parts already stored.
 */

const MB = 1024 * 1024
const PART_SIZE = 8 * MB
/** the size the card-3 case names: 45 MiB -> 6 parts (5 x 8 MiB + 5 MiB) */
const BIG_FILE_BYTES = 45 * MB
const NO_THRESHOLD: DocumentLimits = parseDocumentLimits(undefined)

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-upload-session-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

/**
 * Counts every byte a file handle is asked for while `run` executes, so a test
 * can assert the probe is bounded. The handle is the real one; only `open` is
 * wrapped, and only while a count is active (the ZIP builder uses `openSync`,
 * which is untouched).
 */
async function countingHandleReads<T>(run: () => Promise<T>): Promise<{ value: T; bytes: number }> {
  readCount.bytes = 0
  readCount.active = true
  try {
    return { value: await run(), bytes: readCount.bytes }
  } finally {
    readCount.active = false
  }
}

// ---- a real ZIP on disk, with one huge entry left as a sparse hole ----------

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

interface EntrySpec {
  name: string
  /** deflated when given; `storedSize` writes a sparse all-zero STORE entry instead */
  data?: Uint8Array
  storedSize?: number
  /**
   * R1-BE-07: write the central-directory sizes the ZIP64 way - the 32-bit
   * fields saturate at `0xffffffff` and the real sizes ride in the entry's
   * extra field (id 0x0001). `truncate` cuts the record short (the declared
   * size is longer than the payload), `noRecord` writes no ZIP64 record at all.
   */
  zip64?: { compressed?: number; uncompressed?: number; truncate?: boolean; noRecord?: boolean }
}

/** the ZIP64 extra record (id 0x0001): uncompressed then compressed, 8 bytes each when present */
function zip64Extra(spec: NonNullable<EntrySpec['zip64']>): Buffer {
  if (spec.noRecord) return Buffer.alloc(0)
  const fields: Buffer[] = []
  if (spec.uncompressed !== undefined) {
    const b = Buffer.alloc(8)
    b.writeBigUInt64LE(BigInt(spec.uncompressed), 0)
    fields.push(b)
  }
  if (spec.compressed !== undefined) {
    const b = Buffer.alloc(8)
    b.writeBigUInt64LE(BigInt(spec.compressed), 0)
    fields.push(b)
  }
  const payload = Buffer.concat(fields)
  const header = Buffer.alloc(4)
  header.writeUInt16LE(0x0001, 0)
  // the declared record size is what the probe trusts: a truncated one lies
  header.writeUInt16LE(payload.length, 2)
  return Buffer.concat([header, spec.truncate ? payload.subarray(0, 8) : payload])
}

/** builds a ZIP whose local data, central directory and EOCD are all real */
function buildZip(path: string, entries: EntrySpec[]): { size: number; cdOffset: number } {
  const fd = openSync(path, 'w')
  const central: Buffer[] = []
  let offset = 0
  try {
    for (const entry of entries) {
      const name = Buffer.from(entry.name, 'utf8')
      const stored = entry.storedSize !== undefined
      const data = entry.data ?? new Uint8Array(0)
      const crc = stored ? crc32(new Uint8Array(entry.storedSize!)) : crc32(data)
      const body = stored ? null : deflateRawSync(data)
      const size = stored ? entry.storedSize! : data.length
      const header = Buffer.alloc(30)
      header.writeUInt32LE(0x04034b50, 0)
      header.writeUInt16LE(20, 4)
      header.writeUInt16LE(stored ? 0 : 8, 8)
      header.writeUInt32LE(crc, 14)
      header.writeUInt32LE(body?.length ?? size, 18)
      header.writeUInt32LE(size, 22)
      header.writeUInt16LE(name.length, 26)
      const localOffset = offset
      writeSync(fd, header, 0, header.length, offset)
      offset += header.length
      writeSync(fd, name, 0, name.length, offset)
      offset += name.length
      if (body) {
        writeSync(fd, body, 0, body.length, offset)
        offset += body.length
      } else {
        // the entry's own bytes are zeros: extend the file and leave a hole
        ftruncateSync(fd, offset + size)
        offset += size
      }
      const extra = entry.zip64 ? zip64Extra(entry.zip64) : Buffer.alloc(0)
      const cd = Buffer.alloc(46)
      cd.writeUInt32LE(0x02014b50, 0)
      cd.writeUInt16LE(20, 4)
      cd.writeUInt16LE(20, 6)
      cd.writeUInt16LE(stored ? 0 : 8, 10)
      cd.writeUInt32LE(crc, 16)
      cd.writeUInt32LE(
        entry.zip64?.compressed !== undefined ? 0xffffffff : (body?.length ?? size),
        20,
      )
      cd.writeUInt32LE(entry.zip64?.uncompressed !== undefined ? 0xffffffff : size, 24)
      cd.writeUInt16LE(name.length, 28)
      cd.writeUInt16LE(extra.length, 30)
      cd.writeUInt32LE(localOffset, 42)
      central.push(cd, name, extra)
    }
    const cdOffset = offset
    const cdBuffer = Buffer.concat(central)
    writeSync(fd, cdBuffer, 0, cdBuffer.length, offset)
    offset += cdBuffer.length
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(entries.length, 8)
    eocd.writeUInt16LE(entries.length, 10)
    eocd.writeUInt32LE(cdBuffer.length, 12)
    eocd.writeUInt32LE(cdOffset, 16)
    writeSync(fd, eocd, 0, eocd.length, offset)
    return { size: offset + eocd.length, cdOffset }
  } finally {
    closeSync(fd)
  }
}

/** a valid 45 MiB DOCX whose first entry is a ~45 MiB stored image */
function buildBigDocx(path: string): { size: number; cdOffset: number } {
  const entries = (imageSize: number): EntrySpec[] => [
    { name: 'word/media/image1.png', storedSize: imageSize },
    { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
    { name: 'word/document.xml', data: Buffer.from('<w:document/>') },
  ]
  // the headers, the directory and the EOCD are a fixed cost, so the image's
  // own size is what makes the whole file exactly BIG_FILE_BYTES
  const overhead = buildZip(path, entries(0)).size
  const built = buildZip(path, entries(BIG_FILE_BYTES - overhead))
  expect(built.size).toBe(BIG_FILE_BYTES)
  return built
}

// ---- the fake session server ------------------------------------------------

interface FakeOptions {
  size?: number
  partSize?: number
  /** the parts the storage already holds when the session is first read */
  completedParts?: Array<{ partNumber: number; etag: string }>
  /** part-number -> a fault the PUT answers with, for `times` attempts */
  putFaults?: Record<number, { error: UniworkDocError; times: number }>
  /** errors `complete` throws, in order (the last answer succeeds) */
  completeFaults?: UniworkDocError[]
  /** `getUploadSession` answers this instead of a session */
  getFault?: UniworkDocError
  /** R1-BE-02: holds a GET (resume/refresh) until it settles or the signal aborts */
  getGate?: () => Promise<void>
  /** R1-BE-02: holds `complete` until it settles or the signal aborts */
  completeGate?: () => Promise<void>
  /** part 1's URL is already inside the 30 s refresh margin */
  nearExpiry?: boolean
  status?: UploadSessionStatus
}

interface FakeCalls {
  creates: Array<Record<string, unknown>>
  partPuts: number[]
  partUrls: Array<{ partNumber: number; url: string }>
  refreshes: number
  completes: Array<Array<{ partNumber: number; etag: string }>>
  deletes: string[]
  maxInFlight: number
}

function fakeSessions(options: FakeOptions = {}) {
  const size = options.size ?? BIG_FILE_BYTES
  const partSize = options.partSize ?? PART_SIZE
  const totalParts = Math.ceil(size / partSize)
  const completed = new Map((options.completedParts ?? []).map((p) => [p.partNumber, p.etag]))
  const calls: FakeCalls = {
    creates: [],
    partPuts: [],
    partUrls: [],
    refreshes: 0,
    completes: [],
    deletes: [],
    maxInFlight: 0,
  }
  const faults = new Map(Object.entries(options.putFaults ?? {}).map(([k, v]) => [Number(k), v]))
  const completeFaults = [...(options.completeFaults ?? [])]
  let inFlight = 0
  let generation = 0
  let sessionId = 'ups_1'
  /** a fresh-URL read counts as a refresh only after the first create */
  const partsFor = (): UploadSessionState['parts'] => {
    const rows: UploadSessionState['parts'] = []
    for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
      if (completed.has(partNumber)) continue
      rows.push({
        partNumber,
        method: 'PUT',
        url: `https://storage.example/part/${partNumber}?g=${generation}`,
        headers: {},
        expiresAt: new Date(
          // only the FIRST generation hands out a nearly-expired URL: the
          // refreshed one is valid, so the client is expected to send to it
          Date.now() +
            (options.nearExpiry && partNumber === 1 && generation <= 1 ? 10_000 : 3_600_000),
        ).toISOString(),
      })
    }
    return rows
  }
  const state = (): UploadSessionState => ({
    sessionId,
    status: options.status ?? 'open',
    partSize,
    totalParts,
    completedParts: [...completed].map(([partNumber, etag]) => ({
      partNumber,
      etag,
      size: Math.min(partSize, size - (partNumber - 1) * partSize),
    })),
    parts: partsFor(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  })
  const client: UploadSessionClient = {
    async createWorkspaceUploadSession(input) {
      calls.creates.push({ ...input, kind: 'workspace' })
      generation += 1
      sessionId = `ups_${generation}`
      return state()
    },
    async createDocumentUploadSession(input) {
      calls.creates.push({ ...input, kind: 'document' })
      generation += 1
      sessionId = `ups_${generation}`
      return state()
    },
    async getUploadSession(_sessionId, signal) {
      if (options.getFault) throw options.getFault
      if (options.getGate) {
        // a real GET is a request: an abort rejects it before it settles
        await holdOn(options.getGate, signal)
      }
      calls.refreshes += 1
      generation += 1
      return state()
    },
    async completeUploadSession(input) {
      calls.completes.push(input.parts)
      if (options.completeGate) {
        await holdOn(options.completeGate, input.signal)
      }
      const fault = completeFaults.shift()
      if (fault) throw fault
      return {
        kind: 'document',
        document: {
          id: 'doc_created',
          workspaceId: 'ws_1',
          title: 'big.docx',
          format: 'docx',
          updatedAt: '2026-10-18T00:00:00Z',
        },
      }
    },
    async deleteUploadSession(id) {
      calls.deletes.push(id)
    },
    async putUploadPart(input) {
      calls.partPuts.push(input.partNumber)
      calls.partUrls.push({ partNumber: input.partNumber, url: input.url })
      inFlight += 1
      calls.maxInFlight = Math.max(calls.maxInFlight, inFlight)
      try {
        // a real PUT takes time: the yield is what lets the pool's other
        // workers be observed in flight at the same moment
        await new Promise((resolve) => setImmediate(resolve))
        const fault = faults.get(input.partNumber)
        if (fault && fault.times > 0) {
          fault.times -= 1
          throw fault.error
        }
        return { etag: `etag-${input.partNumber}` }
      } finally {
        inFlight -= 1
      }
    },
  }
  return { client, calls }
}

/** R1-BE-02: a promise a test resolves when it wants a held request to finish */
function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

/**
 * R1-BE-02: a request held open until its gate settles - an abort of the
 * caller's signal rejects it first, exactly as a real fetch does.
 */
async function holdOn(gate: () => Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await gate()
    return
  }
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      const error = new Error('The operation was aborted.')
      error.name = 'AbortError'
      reject(error)
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    gate().then(resolve, reject)
  })
}

/** the file-handle reader a chunked upload is given: exactly `[offset, offset+length)` */
function fileReader(path: string) {
  const handle = openSync(path, 'r')
  return {
    readRange: async (offset: number, length: number): Promise<Uint8Array> => {
      const buffer = Buffer.alloc(length)
      readSync(handle, buffer, 0, length, offset)
      return new Uint8Array(buffer)
    },
    close: (): void => closeSync(handle),
  }
}

describe('shouldUseChunkedUpload', () => {
  const withThreshold = (threshold: number): DocumentLimits => ({
    ...NO_THRESHOLD,
    chunked_upload_threshold_bytes: threshold,
  })

  it('is on only above a present threshold', () => {
    expect(shouldUseChunkedUpload(20 * MB + 1, withThreshold(20 * MB))).toBe(true)
    expect(shouldUseChunkedUpload(20 * MB, withThreshold(20 * MB))).toBe(false)
    expect(shouldUseChunkedUpload(200 * MB, NO_THRESHOLD)).toBe(false)
  })

  it('reads the threshold from documents.limits, and only when it is a safe positive integer', () => {
    expect(
      parseDocumentLimits({ limits: { chunked_upload_threshold_bytes: 20 * MB } })
        .chunked_upload_threshold_bytes,
    ).toBe(20 * MB)
    for (const raw of [0, -1, 1.5, '20971520', null, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        parseDocumentLimits({ limits: { chunked_upload_threshold_bytes: raw } })
          .chunked_upload_threshold_bytes,
      ).toBeUndefined()
    }
  })
})

describe('readLocalFileProbe', () => {
  it('reads only the head and the ZIP tail of a 45 MiB package', async () => {
    const path = join(dir, 'big.docx')
    const built = buildBigDocx(path)
    expect(built.size).toBeGreaterThan(40 * MB)

    const { value: probe, bytes } = await countingHandleReads(() =>
      readLocalFileProbe({ path }, built.size, 'big.docx'),
    )

    // the head (64 KiB) + the tail read + the central directory slice: under
    // 200 KiB of a 45 MiB file, never the whole package
    expect(bytes).toBeLessThan(200 * 1024)
    expect(bytes).toBeGreaterThanOrEqual(64 * 1024)
    expect(probe.cd_offset).toBe(built.cdOffset)
    expect(probe.cd_size).toBe(built.size - built.cdOffset)
    expect(Buffer.from(probe.head_b64, 'base64')).toHaveLength(64 * 1024)
    expect(Buffer.from(probe.central_dir_b64, 'base64')).toHaveLength(probe.cd_size!)
  })

  it('refuses a macro package locally, with no request and no full read', async () => {
    const path = join(dir, 'macro.docx')
    const built = buildZip(path, [
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
      { name: 'word/document.xml', data: Buffer.from('<w:document/>') },
      { name: 'word/vbaProject.bin', data: Buffer.from('macro') },
    ])

    const { value: error, bytes } = await countingHandleReads(() =>
      readLocalFileProbe({ path }, built.size, 'macro.docx').catch((e: unknown) => e),
    )

    expect(error).toBeInstanceOf(UniworkDocError)
    expect((error as UniworkDocError).code).toBe('unsupported_format')
    expect((error as UniworkDocError).serverCode).toBe('zip_macro_part')
    expect(bytes).toBeLessThan(200 * 1024)
  })

  it('refuses a package without its main folder, and an unknown extension', async () => {
    const path = join(dir, 'flat.docx')
    const built = buildZip(path, [{ name: '[Content_Types].xml', data: Buffer.from('<Types/>') }])
    const missing = await readLocalFileProbe({ path }, built.size, 'flat.docx').catch((e) => e)
    expect((missing as UniworkDocError).serverCode).toBe('ooxml_missing_part')
    const unknown = await readLocalFileProbe({ path }, built.size, 'notes.rtf').catch((e) => e)
    expect((unknown as UniworkDocError).code).toBe('unsupported_format')
  })

  it('needs only the head for a 45 MiB PDF', async () => {
    const path = join(dir, 'big.pdf')
    const handle = openSync(path, 'w')
    writeSync(handle, Buffer.from('%PDF-1.7\n'), 0, 9, 0)
    ftruncateSync(handle, BIG_FILE_BYTES)
    closeSync(handle)

    const { value: probe, bytes } = await countingHandleReads(() =>
      readLocalFileProbe({ path }, BIG_FILE_BYTES, 'big.pdf'),
    )

    expect(probe.cd_offset).toBeNull()
    expect(probe.central_dir_b64).toBe('')
    expect(bytes).toBe(64 * 1024)
  })

  it('reads a probe from bytes already in memory without a handle', async () => {
    const path = join(dir, 'mem.docx')
    const built = buildBigDocx(path)
    const bytes = new Uint8Array(readFileSync(path))
    const fromFile = await readLocalFileProbe({ path }, built.size, 'mem.docx')
    const fromMemory = await readLocalFileProbe({ bytes }, built.size, 'mem.docx')
    expect(fromMemory).toEqual(fromFile)
  })
})

describe('runChunkedUpload', () => {
  it('uploads 45 MiB in 6 parts, at most 4 in flight, and reports progress', async () => {
    const path = join(dir, 'big.docx')
    const built = buildBigDocx(path)
    const probe = await readLocalFileProbe({ path }, built.size, 'big.docx')
    const { client, calls } = fakeSessions({ size: built.size })
    const reader = fileReader(path)
    const progress: Array<{ loaded: number; total: number }> = []
    const states: SavedUploadSession[] = []
    const phases: string[] = []
    try {
      const result = await runChunkedUpload(client, {
        target: { kind: 'workspace', workspaceId: 'ws_1', parentId: null, title: 'big.docx' },
        filename: 'big.docx',
        size: built.size,
        probe,
        idempotencyKey: 'idem-1',
        readRange: reader.readRange,
        onProgress: (loaded, total) => progress.push({ loaded, total }),
        onPhase: (phase) => phases.push(phase),
        onSessionState: (state) => {
          states.push(state)
        },
      })

      expect(result.kind).toBe('document')
      expect([...calls.partPuts].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
      expect(calls.maxInFlight).toBeLessThanOrEqual(PART_CONCURRENCY)
      expect(calls.maxInFlight).toBeGreaterThan(1)
      expect(calls.completes).toHaveLength(1)
      expect(calls.completes[0]).toHaveLength(6)
      expect(progress.at(-1)).toEqual({ loaded: built.size, total: built.size })
      expect(phases).toEqual(['checking'])
      // the caller can persist resume state from the first publish on
      expect(states[0]?.completedParts).toEqual([])
      expect(states.at(-1)?.completedParts).toHaveLength(6)
    } finally {
      reader.close()
    }
  })

  it('retries only the part that answered 503', async () => {
    const path = join(dir, 'big.docx')
    const built = buildBigDocx(path)
    const probe = await readLocalFileProbe({ path }, built.size, 'big.docx')
    const { client, calls } = fakeSessions({
      size: built.size,
      putFaults: { 3: { error: new UniworkDocError('server_error', { status: 503 }), times: 1 } },
    })
    const reader = fileReader(path)
    try {
      await runChunkedUpload(client, {
        target: { kind: 'workspace', workspaceId: 'ws_1' },
        filename: 'big.docx',
        size: built.size,
        probe,
        idempotencyKey: 'idem-2',
        readRange: reader.readRange,
      })
      const counts = new Map<number, number>()
      for (const part of calls.partPuts) counts.set(part, (counts.get(part) ?? 0) + 1)
      expect(counts.get(3)).toBe(2)
      for (const part of [1, 2, 4, 5, 6]) expect(counts.get(part)).toBe(1)
      expect(calls.completes[0]).toHaveLength(6)
    } finally {
      reader.close()
    }
  })

  it('re-signs an expired URL and completes without re-uploading the parts already stored', async () => {
    const path = join(dir, 'big.docx')
    const built = buildBigDocx(path)
    const probe = await readLocalFileProbe({ path }, built.size, 'big.docx')
    const { client, calls } = fakeSessions({
      size: built.size,
      putFaults: {
        5: { error: new UniworkDocError('forbidden', { status: 403 }), times: 1 },
      },
    })
    const reader = fileReader(path)
    try {
      await runChunkedUpload(client, {
        target: { kind: 'workspace', workspaceId: 'ws_1' },
        filename: 'big.docx',
        size: built.size,
        probe,
        idempotencyKey: 'idem-3',
        readRange: reader.readRange,
      })
      expect(calls.refreshes).toBeGreaterThanOrEqual(1)
      const counts = new Map<number, number>()
      for (const part of calls.partPuts) counts.set(part, (counts.get(part) ?? 0) + 1)
      for (const part of [1, 2, 3, 4]) expect(counts.get(part)).toBe(1)
      expect(counts.get(5)).toBe(2)
      // the retry used the refreshed URL, never the expired one
      const fifth = calls.partUrls.filter((row) => row.partNumber === 5)
      expect(fifth[0]!.url).not.toBe(fifth.at(-1)!.url)
      expect(calls.completes[0]).toHaveLength(6)
    } finally {
      reader.close()
    }
  })

  it('refreshes before sending a part whose URL is inside the expiry margin', async () => {
    const path = join(dir, 'big.docx')
    const built = buildBigDocx(path)
    const probe = await readLocalFileProbe({ path }, built.size, 'big.docx')
    const { client, calls } = fakeSessions({ size: built.size, nearExpiry: true })
    const reader = fileReader(path)
    try {
      await runChunkedUpload(client, {
        target: { kind: 'workspace', workspaceId: 'ws_1' },
        filename: 'big.docx',
        size: built.size,
        probe,
        idempotencyKey: 'idem-3b',
        readRange: reader.readRange,
      })
      expect(calls.refreshes).toBeGreaterThanOrEqual(1)
      // part 1 was never sent to the nearly-expired URL
      const first = calls.partUrls.filter((row) => row.partNumber === 1)
      expect(first).toHaveLength(1)
      expect(first[0]!.url).toContain('g=2')
    } finally {
      reader.close()
    }
  })

  it('waits out a busy complete and finishes on the retry', async () => {
    const path = join(dir, 'big.docx')
    const built = buildBigDocx(path)
    const probe = await readLocalFileProbe({ path }, built.size, 'big.docx')
    const { client, calls } = fakeSessions({
      size: built.size,
      completeFaults: [
        new UniworkDocError('server_error', {
          status: 409,
          serverCode: 'upload_session_busy',
          retryAfterMs: 0,
        }),
      ],
    })
    const reader = fileReader(path)
    try {
      const result = await runChunkedUpload(client, {
        target: { kind: 'workspace', workspaceId: 'ws_1' },
        filename: 'big.docx',
        size: built.size,
        probe,
        idempotencyKey: 'idem-4',
        readRange: reader.readRange,
      })
      expect(result.kind).toBe('document')
      expect(calls.completes).toHaveLength(2)
      expect(calls.refreshes).toBeGreaterThanOrEqual(1)
    } finally {
      reader.close()
    }
  })

  it('re-reads the session and completes again on upload_parts_invalid', async () => {
    const path = join(dir, 'big.docx')
    const built = buildBigDocx(path)
    const probe = await readLocalFileProbe({ path }, built.size, 'big.docx')
    const { client, calls } = fakeSessions({
      size: built.size,
      completeFaults: [
        new UniworkDocError('server_error', { status: 422, serverCode: 'upload_parts_invalid' }),
      ],
    })
    const reader = fileReader(path)
    try {
      const result = await runChunkedUpload(client, {
        target: { kind: 'workspace', workspaceId: 'ws_1' },
        filename: 'big.docx',
        size: built.size,
        probe,
        idempotencyKey: 'idem-4b',
        readRange: reader.readRange,
      })
      expect(result.kind).toBe('document')
      expect(calls.completes).toHaveLength(2)
      // the second complete names every part again
      expect(calls.completes[1]).toHaveLength(6)
    } finally {
      reader.close()
    }
  })

  it('starts a fresh session when the saved one is gone, and uploads from part 1', async () => {
    const path = join(dir, 'big.docx')
    const built = buildBigDocx(path)
    const probe = await readLocalFileProbe({ path }, built.size, 'big.docx')
    const { client, calls } = fakeSessions({
      size: built.size,
      getFault: new UniworkDocError('not_found', {
        status: 410,
        serverCode: 'upload_session_expired',
      }),
    })
    const reader = fileReader(path)
    try {
      await runChunkedUpload(client, {
        target: { kind: 'workspace', workspaceId: 'ws_1' },
        filename: 'big.docx',
        size: built.size,
        probe,
        idempotencyKey: 'idem-5',
        // R1-BE-09: the dead session's key is never replayed - the restart
        // creates under a fresh one (the server dedups a key to its session)
        freshIdempotencyKey: () => 'fresh-5',
        resume: {
          sessionId: 'ups_gone',
          partSize: PART_SIZE,
          totalParts: 6,
          completedParts: [
            { partNumber: 1, etag: 'e1' },
            { partNumber: 2, etag: 'e2' },
            { partNumber: 3, etag: 'e3' },
          ],
          expiresAt: '2026-10-18T00:00:00Z',
        },
        readRange: reader.readRange,
      })
      expect(calls.creates).toHaveLength(1)
      expect(calls.creates[0]!.idempotencyKey).toBe('fresh-5')
      expect([...calls.partPuts].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
    } finally {
      reader.close()
    }
  })

  it('resumes from the parts the storage already holds', async () => {
    const path = join(dir, 'big.docx')
    const built = buildBigDocx(path)
    const probe = await readLocalFileProbe({ path }, built.size, 'big.docx')
    const { client, calls } = fakeSessions({
      size: built.size,
      completedParts: [
        { partNumber: 1, etag: 'e1' },
        { partNumber: 2, etag: 'e2' },
        { partNumber: 3, etag: 'e3' },
      ],
    })
    const reader = fileReader(path)
    const progress: number[] = []
    try {
      await runChunkedUpload(client, {
        target: { kind: 'workspace', workspaceId: 'ws_1' },
        filename: 'big.docx',
        size: built.size,
        probe,
        idempotencyKey: 'idem-6',
        resume: {
          sessionId: 'ups_1',
          partSize: PART_SIZE,
          totalParts: 6,
          completedParts: [],
          expiresAt: '2026-10-18T00:00:00Z',
        },
        readRange: reader.readRange,
        onProgress: (loaded) => progress.push(loaded),
      })
      expect(calls.creates).toEqual([])
      expect([...calls.partPuts].sort((a, b) => a - b)).toEqual([4, 5, 6])
      expect(progress[0]).toBe(24 * MB)
      expect(calls.completes[0]).toHaveLength(6)
    } finally {
      reader.close()
    }
  })

  it('skips straight to complete when the resumed session is already validating', async () => {
    const path = join(dir, 'big.docx')
    const built = buildBigDocx(path)
    const probe = await readLocalFileProbe({ path }, built.size, 'big.docx')
    const { client, calls } = fakeSessions({
      size: built.size,
      status: 'validating',
      completedParts: [1, 2, 3, 4, 5, 6].map((partNumber) => ({
        partNumber,
        etag: `etag-${partNumber}`,
      })),
    })
    const reader = fileReader(path)
    try {
      const result = await runChunkedUpload(client, {
        target: { kind: 'workspace', workspaceId: 'ws_1' },
        filename: 'big.docx',
        size: built.size,
        probe,
        idempotencyKey: 'idem-6b',
        resume: {
          sessionId: 'ups_1',
          partSize: PART_SIZE,
          totalParts: 6,
          completedParts: [],
          expiresAt: '2026-10-18T00:00:00Z',
        },
        readRange: reader.readRange,
      })
      expect(result.kind).toBe('document')
      expect(calls.partPuts).toEqual([])
      expect(calls.completes[0]).toHaveLength(6)
    } finally {
      reader.close()
    }
  })

  it('surfaces the threshold-drift verdict as the fallback signal', async () => {
    const path = join(dir, 'small.docx')
    const built = buildZip(path, [
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
      { name: 'word/document.xml', data: Buffer.from('<w:document/>') },
    ])
    const probe = await readLocalFileProbe({ path }, built.size, 'small.docx')
    const { client } = fakeSessions({ size: built.size })
    const failing: UploadSessionClient = {
      ...client,
      async createWorkspaceUploadSession() {
        throw new UniworkDocError('server_error', {
          status: 422,
          serverCode: 'upload_session_too_small',
        })
      },
    }
    const error = await runChunkedUpload(failing, {
      target: { kind: 'workspace', workspaceId: 'ws_1' },
      filename: 'small.docx',
      size: built.size,
      probe,
      idempotencyKey: 'idem-7',
      readRange: async (offset, length) => new Uint8Array(length),
    }).catch((e) => e)
    expect((error as UniworkDocError).serverCode).toBe('upload_session_too_small')
  })

  it('stops on a part failure after three retries', async () => {
    const path = join(dir, 'big.docx')
    const built = buildBigDocx(path)
    const probe = await readLocalFileProbe({ path }, built.size, 'big.docx')
    const { client, calls } = fakeSessions({
      size: built.size,
      putFaults: { 1: { error: new UniworkDocError('network'), times: 99 } },
    })
    const reader = fileReader(path)
    try {
      const error = await runChunkedUpload(client, {
        target: { kind: 'workspace', workspaceId: 'ws_1' },
        filename: 'big.docx',
        size: built.size,
        probe,
        idempotencyKey: 'idem-8',
        readRange: reader.readRange,
      }).catch((e) => e)
      expect((error as UniworkDocError).code).toBe('network')
      // one attempt plus three retries
      expect(calls.partPuts.filter((part) => part === 1)).toHaveLength(4)
    } finally {
      reader.close()
    }
  })

  it('answers a cancel as upload_cancelled before any part is sent', async () => {
    const path = join(dir, 'big.docx')
    const built = buildBigDocx(path)
    const probe = await readLocalFileProbe({ path }, built.size, 'big.docx')
    const { client, calls } = fakeSessions({ size: built.size })
    const reader = fileReader(path)
    const controller = new AbortController()
    controller.abort()
    try {
      const error = await runChunkedUpload(client, {
        target: { kind: 'workspace', workspaceId: 'ws_1' },
        filename: 'big.docx',
        size: built.size,
        probe,
        idempotencyKey: 'idem-9',
        readRange: reader.readRange,
        signal: controller.signal,
      }).catch((e) => e)
      expect((error as UniworkDocError).code).toBe('upload_cancelled')
      expect(calls.partPuts).toEqual([])
    } finally {
      reader.close()
    }
  })
})

describe('abortUploadSession', () => {
  it('deletes the session, and a session already gone is not an error', async () => {
    const { client, calls } = fakeSessions()
    await abortUploadSession(client, 'ups_1')
    expect(calls.deletes).toEqual(['ups_1'])

    const gone: UploadSessionClient = {
      ...client,
      async deleteUploadSession() {
        throw new UniworkDocError('not_found', { status: 404, serverCode: 'not_found' })
      },
    }
    await expect(abortUploadSession(gone, 'ups_2')).resolves.toBeUndefined()

    const refused: UploadSessionClient = {
      ...client,
      async deleteUploadSession() {
        throw new UniworkDocError('server_error', { status: 500 })
      },
    }
    await expect(abortUploadSession(refused, 'ups_3')).rejects.toBeInstanceOf(UniworkDocError)
  })
})

// ---- R1-BE-02: cancel reaches a held GET and a held complete ---------------

describe('R1-BE-02: a cancel interrupts metadata and complete', () => {
  it('a cancel during a held resume GET ends the run as upload_cancelled', async () => {
    const path = join(dir, 'big.docx')
    const built = buildBigDocx(path)
    const probe = await readLocalFileProbe({ path }, built.size, 'big.docx')
    const gate = deferred()
    let entered: () => void = () => undefined
    const reached = new Promise<void>((resolve) => {
      entered = resolve
    })
    const { client, calls } = fakeSessions({
      size: built.size,
      getGate: () => {
        entered()
        return gate.promise
      },
    })
    const reader = fileReader(path)
    const controller = new AbortController()
    try {
      const pending = runChunkedUpload(client, {
        target: { kind: 'workspace', workspaceId: 'ws_1' },
        filename: 'big.docx',
        size: built.size,
        probe,
        idempotencyKey: 'idem-r1-02a',
        resume: {
          sessionId: 'ups_1',
          partSize: PART_SIZE,
          totalParts: 6,
          completedParts: [],
          expiresAt: '2026-10-18T00:00:00Z',
        },
        readRange: reader.readRange,
        signal: controller.signal,
      }).catch((e) => e)
      // the GET is genuinely in flight when the person cancels
      await reached
      controller.abort()
      gate.resolve()
      const error = await pending
      expect((error as UniworkDocError).code).toBe('upload_cancelled')
      expect(calls.partPuts).toEqual([])
      expect(calls.completes).toEqual([])
    } finally {
      reader.close()
    }
  })

  it('a cancel during a held complete wins: no document is returned', async () => {
    const path = join(dir, 'big.docx')
    const built = buildBigDocx(path)
    const probe = await readLocalFileProbe({ path }, built.size, 'big.docx')
    const gate = deferred()
    const { client, calls } = fakeSessions({ size: built.size, completeGate: () => gate.promise })
    const reader = fileReader(path)
    const controller = new AbortController()
    try {
      const pending = runChunkedUpload(client, {
        target: { kind: 'workspace', workspaceId: 'ws_1' },
        filename: 'big.docx',
        size: built.size,
        probe,
        idempotencyKey: 'idem-r1-02b',
        readRange: reader.readRange,
        signal: controller.signal,
      }).catch((e) => e)
      // wait until complete is in flight (all parts stored, checking started)
      await vi.waitFor(() => {
        expect(calls.completes).toHaveLength(1)
      })
      controller.abort()
      gate.resolve()
      const error = await pending
      expect((error as UniworkDocError).code).toBe('upload_cancelled')
    } finally {
      reader.close()
    }
  })
})

// ---- R1-BE-01: the real part transport is typed and has a deadline ---------

describe('R1-BE-01: the real putUploadPart is typed and deadline-bounded', () => {
  /**
   * The session lifecycle of the fake, but the REAL `putUploadPart` - the one
   * that bypasses `send()` and so must normalize its own transport failures and
   * carry its own deadline.
   */
  function realPartClient(
    fetch: FetchLike,
    transferTimeoutMs: number,
  ): { client: UploadSessionClient; calls: FakeCalls } {
    const { client, calls } = fakeSessions({ size: BIG_FILE_BYTES })
    const real = createUniworkDocsClient({
      apiOrigin: 'https://uniwork.example',
      authorized: (call) => call('tok'),
      isSignedIn: () => true,
      fetch,
      transferTimeoutMs,
    })
    return { client: { ...client, putUploadPart: real.putUploadPart.bind(real) }, calls }
  }

  it('retries a part whose fetch rejects with a TypeError (a real network failure)', async () => {
    const path = join(dir, 'big.docx')
    const built = buildBigDocx(path)
    const probe = await readLocalFileProbe({ path }, built.size, 'big.docx')
    let firstForPart1 = true
    const putCounts = new Map<number, number>()
    const fetch: FetchLike = async (url) => {
      const part = Number(new URL(url).pathname.split('/').pop())
      putCounts.set(part, (putCounts.get(part) ?? 0) + 1)
      if (part === 1 && firstForPart1) {
        firstForPart1 = false
        // what native fetch does on a connection reset / DNS failure
        throw new TypeError('fetch failed')
      }
      return new Response(null, { status: 200, headers: { ETag: `"e${part}"` } })
    }
    const { client, calls } = realPartClient(fetch, 3_600_000)
    const reader = fileReader(path)
    try {
      const result = await runChunkedUpload(client, {
        target: { kind: 'workspace', workspaceId: 'ws_1' },
        filename: 'big.docx',
        size: built.size,
        probe,
        idempotencyKey: 'idem-r1-01a',
        readRange: reader.readRange,
      })
      expect(result.kind).toBe('document')
      // the TypeError was normalized to a retryable network failure: part 1
      // went twice, not once, and the run completed
      expect(putCounts.get(1)).toBe(2)
      expect(calls.completes).toHaveLength(1)
      expect(calls.completes[0]).toHaveLength(6)
    } finally {
      reader.close()
    }
  })

  it('deadline-aborts a part whose fetch never settles, then retries it', async () => {
    const path = join(dir, 'big.docx')
    const built = buildBigDocx(path)
    const probe = await readLocalFileProbe({ path }, built.size, 'big.docx')
    let firstForPart1 = true
    const putCounts = new Map<number, number>()
    const fetch: FetchLike = async (url, init) => {
      const part = Number(new URL(url).pathname.split('/').pop())
      putCounts.set(part, (putCounts.get(part) ?? 0) + 1)
      if (part === 1 && firstForPart1) {
        firstForPart1 = false
        // a stalled PUT: it settles only when the deadline aborts it
        return await new Promise<Response>((_resolve, reject) => {
          const abort = () => {
            const error = new Error('The operation was aborted.')
            error.name = 'AbortError'
            reject(error)
          }
          if (init?.signal?.aborted) abort()
          else init?.signal?.addEventListener('abort', abort, { once: true })
        })
      }
      return new Response(null, { status: 200, headers: { ETag: `"e${part}"` } })
    }
    const { client, calls } = realPartClient(fetch, 5)
    const reader = fileReader(path)
    try {
      const result = await runChunkedUpload(client, {
        target: { kind: 'workspace', workspaceId: 'ws_1' },
        filename: 'big.docx',
        size: built.size,
        probe,
        idempotencyKey: 'idem-r1-01b',
        readRange: reader.readRange,
      })
      expect(result.kind).toBe('document')
      // the deadline turned the stall into a typed timeout, which is retryable
      expect(putCounts.get(1)).toBe(2)
      expect(calls.completes).toHaveLength(1)
    } finally {
      reader.close()
    }
  })
})

// ---- R1-BE-06: the exact OOXML main part ------------------------------------

describe('R1-BE-06: the probe demands the format main part, not just its folder', () => {
  it('refuses a media-only DOCX, and accepts the same package with its main part', async () => {
    const mediaOnly = join(dir, 'media-only.docx')
    const built = buildZip(mediaOnly, [
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
      { name: 'word/media/image1.png', data: Buffer.from('png') },
    ])
    const refused = await readLocalFileProbe(
      { path: mediaOnly },
      built.size,
      'media-only.docx',
    ).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(UniworkDocError)
    expect((refused as UniworkDocError).serverCode).toBe('ooxml_missing_part')

    // the same package with the exact main part is a DOCX
    const complete = join(dir, 'complete.docx')
    const withMain = buildZip(complete, [
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
      { name: 'word/media/image1.png', data: Buffer.from('png') },
      { name: 'word/document.xml', data: Buffer.from('<w:document/>') },
    ])
    await expect(
      readLocalFileProbe({ path: complete }, withMain.size, 'complete.docx'),
    ).resolves.toBeTruthy()
  })

  it('demands each format’s own main part, case-folded', async () => {
    const cases: Array<[string, string]> = [
      ['a.xlsx', 'xl/workbook.xml'],
      ['a.pptx', 'ppt/presentation.xml'],
    ]
    for (const [filename, mainPart] of cases) {
      const path = join(dir, filename)
      const without = buildZip(path, [
        { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
        { name: mainPart.replace(/[^/]+$/, 'other.xml'), data: Buffer.from('<x/>') },
      ])
      const refused = await readLocalFileProbe({ path }, without.size, filename).catch((e) => e)
      expect((refused as UniworkDocError).serverCode).toBe('ooxml_missing_part')

      // the main part's case never matters: the server case-folds it too
      const upper = join(dir, `upper-${filename}`)
      const withMain = buildZip(upper, [
        { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
        { name: mainPart.toUpperCase(), data: Buffer.from('<x/>') },
      ])
      await expect(
        readLocalFileProbe({ path: upper }, withMain.size, filename),
      ).resolves.toBeTruthy()
    }
  })
})

// ---- R1-BE-07: ZIP64 entry sizes -------------------------------------------

describe('R1-BE-07: a ZIP64 entry size is read from its extra field', () => {
  it('accepts a valid ZIP64-entry package with tiny real sizes', async () => {
    const path = join(dir, 'zip64.docx')
    const built = buildZip(path, [
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
      { name: 'word/document.xml', data: Buffer.from('<w:document/>') },
      // both 32-bit sizes saturate; the real sizes (4 and 2 bytes) ride the
      // ZIP64 extra record. Reading the sentinel as a number refused this as
      // a >512 MiB zip bomb
      {
        name: 'word/media/tiny.bin',
        data: Buffer.from('abcd'),
        zip64: { compressed: 2, uncompressed: 4 },
      },
    ])
    const probe = await readLocalFileProbe({ path }, built.size, 'zip64.docx')
    expect(probe.cd_offset).toBe(built.cdOffset)
  })

  it('refuses a saturated size with a truncated ZIP64 record, and with none at all', async () => {
    const truncated = join(dir, 'zip64-truncated.docx')
    const cut = buildZip(truncated, [
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
      { name: 'word/document.xml', data: Buffer.from('<w:document/>') },
      {
        name: 'word/media/tiny.bin',
        data: Buffer.from('abcd'),
        zip64: { compressed: 2, uncompressed: 4, truncate: true },
      },
    ])
    const refused = await readLocalFileProbe(
      { path: truncated },
      cut.size,
      'zip64-truncated.docx',
    ).catch((error: unknown) => error)
    expect((refused as UniworkDocError).serverCode).toBe('zip_unreadable')

    const missing = join(dir, 'zip64-missing.docx')
    const none = buildZip(missing, [
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
      { name: 'word/document.xml', data: Buffer.from('<w:document/>') },
      {
        name: 'word/media/tiny.bin',
        data: Buffer.from('abcd'),
        zip64: { compressed: 2, uncompressed: 4, noRecord: true },
      },
    ])
    const without = await readLocalFileProbe(
      { path: missing },
      none.size,
      'zip64-missing.docx',
    ).catch((error: unknown) => error)
    expect((without as UniworkDocError).serverCode).toBe('zip_unreadable')
  })

  it('R2-BE-05: accepts an asymmetric ZIP64 entry where only the compressed size is saturated', async () => {
    const path = join(dir, 'zip64-asymmetric.docx')
    const built = buildZip(path, [
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
      { name: 'word/document.xml', data: Buffer.from('<w:document/>') },
      {
        name: 'word/media/tiny.bin',
        data: Buffer.from('abcd'),
        zip64: { compressed: 2 },
      },
    ])
    const probe = await readLocalFileProbe({ path }, built.size, 'zip64-asymmetric.docx')
    expect(probe.cd_offset).toBe(built.cdOffset)
  })
})

// ---- R1-BE-05: the retry ladder is independent of URL refreshes ------------

describe('R1-BE-05: a re-sign never consumes a transient retry', () => {
  it('re-signs on three 403s and still retries the next 503 at the first 1 s delay', async () => {
    const path = join(dir, 'big.docx')
    const built = buildBigDocx(path)
    const probe = await readLocalFileProbe({ path }, built.size, 'big.docx')
    const { client, calls } = fakeSessions({
      size: built.size,
      // part 1: after the re-signs, one 503 that must still get a 1 s retry
      putFaults: { 1: { error: new UniworkDocError('server_error', { status: 503 }), times: 1 } },
    })
    let forbids = 3
    let part1Attempts = 0
    const originalPut = client.putUploadPart.bind(client)
    client.putUploadPart = async (input) => {
      if (input.partNumber === 1) part1Attempts += 1
      if (input.partNumber === 1 && forbids > 0) {
        forbids -= 1
        throw new UniworkDocError('forbidden', { status: 403 })
      }
      return await originalPut(input)
    }
    // capture the retry delays without faking time, so the real 1 s sleep still
    // runs and its exact value is asserted (the spy calls through)
    const timerSpy = vi.spyOn(globalThis, 'setTimeout')
    const reader = fileReader(path)
    try {
      const result = await runChunkedUpload(client, {
        target: { kind: 'workspace', workspaceId: 'ws_1' },
        filename: 'big.docx',
        size: built.size,
        probe,
        idempotencyKey: 'idem-r1-05',
        readRange: reader.readRange,
      })
      expect(result.kind).toBe('document')
      // three 403 attempts, one fresh-URL attempt, one 503, one retry: five
      // PUTs. A shared counter would have thrown on the 503 (attempt 4)
      expect(part1Attempts).toBe(5)
      expect(calls.refreshes).toBeGreaterThanOrEqual(3)
      // the re-signs consumed no retry, so the first transient retry is 1 s
      const delays = timerSpy.mock.calls
        .map((call) => call[1])
        .filter((ms) => ms === 1_000 || ms === 2_000 || ms === 4_000)
      expect(delays[0]).toBe(1_000)
    } finally {
      reader.close()
    }
  })
})

// ---- R1-BE-08: a create idempotency mismatch restarts under a fresh key ----

describe('R1-BE-08: a rejected create key is replaced once', () => {
  it('retries the create under a fresh key on 409 idempotency_payload_mismatch', async () => {
    const path = join(dir, 'big.docx')
    const built = buildBigDocx(path)
    const probe = await readLocalFileProbe({ path }, built.size, 'big.docx')
    const { client, calls } = fakeSessions({ size: built.size })
    const createKeys: string[] = []
    let first = true
    const original = client.createWorkspaceUploadSession.bind(client)
    client.createWorkspaceUploadSession = async (input) => {
      createKeys.push(input.idempotencyKey)
      if (first) {
        first = false
        throw new UniworkDocError('idempotency_mismatch', {
          status: 409,
          serverCode: 'idempotency_payload_mismatch',
        })
      }
      return await original(input)
    }
    const keys: string[] = []
    const reader = fileReader(path)
    try {
      const result = await runChunkedUpload(client, {
        target: { kind: 'workspace', workspaceId: 'ws_1' },
        filename: 'big.docx',
        size: built.size,
        probe,
        idempotencyKey: 'rejected-key',
        freshIdempotencyKey: () => 'fresh-key',
        onIdempotencyKey: (key) => keys.push(key),
        readRange: reader.readRange,
      })
      expect(result.kind).toBe('document')
      // the retry never replayed the rejected key
      expect(createKeys).toEqual(['rejected-key', 'fresh-key'])
      expect(keys).toEqual(['fresh-key'])
      expect(calls.completes).toHaveLength(1)
    } finally {
      reader.close()
    }
  })

  it('does not retry a second mismatch: the verdict is the answer', async () => {
    const path = join(dir, 'big.docx')
    const built = buildBigDocx(path)
    const probe = await readLocalFileProbe({ path }, built.size, 'big.docx')
    const { client } = fakeSessions({ size: built.size })
    let creates = 0
    client.createWorkspaceUploadSession = async () => {
      creates += 1
      throw new UniworkDocError('idempotency_mismatch', {
        status: 409,
        serverCode: 'idempotency_payload_mismatch',
      })
    }
    const error = await runChunkedUpload(client, {
      target: { kind: 'workspace', workspaceId: 'ws_1' },
      filename: 'big.docx',
      size: built.size,
      probe,
      idempotencyKey: 'rejected-key',
      freshIdempotencyKey: () => 'fresh-key',
      readRange: async (offset, length) => new Uint8Array(length),
    }).catch((e) => e)
    expect((error as UniworkDocError).code).toBe('idempotency_mismatch')
    // the first attempt plus exactly one restart under the fresh key
    expect(creates).toBe(2)
  })
})

// ---- R1-BE-09: a session gone mid-run restarts once, real verdict kept -----

describe('R1-BE-09: a session gone at refresh, complete or the busy poll restarts once', () => {
  const resume: SavedUploadSession = {
    sessionId: 'ups_1',
    partSize: PART_SIZE,
    totalParts: 6,
    completedParts: [{ partNumber: 1, etag: 'e1' }],
    expiresAt: '2026-10-18T00:00:00Z',
  }

  it('restarts from part 1 when a URL refresh answers 410', async () => {
    const path = join(dir, 'big.docx')
    const built = buildBigDocx(path)
    const probe = await readLocalFileProbe({ path }, built.size, 'big.docx')
    // no parts stored: part 1's URL is present, so the pool uploads first and
    // only a later refresh can 410 (the refresh happens on the NEXT publish
    // cycle). To force a refresh deterministically, part 1's URL is missing.
    const { client, calls } = fakeSessions({ size: built.size, nearExpiry: true })
    // the FIRST get (the resume) succeeds; every later refresh 410s once
    let gets = 0
    const originalGet = client.getUploadSession.bind(client)
    client.getUploadSession = async (sessionId, signal) => {
      gets += 1
      if (gets === 2) {
        throw new UniworkDocError('not_found', {
          status: 410,
          serverCode: 'upload_session_expired',
        })
      }
      return await originalGet(sessionId, signal)
    }
    const keys: string[] = []
    const reader = fileReader(path)
    try {
      const result = await runChunkedUpload(client, {
        target: { kind: 'workspace', workspaceId: 'ws_1' },
        filename: 'big.docx',
        size: built.size,
        probe,
        idempotencyKey: 'idem-r1-09a',
        // no part stored yet: part 1 is the pool's first PUT, and its
        // near-expiry URL forces the refresh that 410s
        resume: { ...resume, completedParts: [] },
        freshIdempotencyKey: () => 'fresh-r1-09a',
        onIdempotencyKey: (key) => keys.push(key),
        readRange: reader.readRange,
      })
      expect(result.kind).toBe('document')
      // a restart created a fresh session under the fresh key (the dead
      // session's key is never replayed), and every part went again (the pool
      // may have had a few parts in flight when the refresh 410'd, so a part
      // can appear twice - what matters is that all six go at least once)
      expect(keys).toEqual(['fresh-r1-09a'])
      expect(calls.creates).toHaveLength(1)
      expect(calls.creates[0]!.idempotencyKey).toBe('fresh-r1-09a')
      expect([...new Set(calls.partPuts)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
    } finally {
      reader.close()
    }
  })

  it('restarts when complete answers 410, and reports that verdict not an earlier one', async () => {
    const path = join(dir, 'big.docx')
    const built = buildBigDocx(path)
    const probe = await readLocalFileProbe({ path }, built.size, 'big.docx')
    const { client, calls } = fakeSessions({
      size: built.size,
      completeFaults: [
        new UniworkDocError('not_found', { status: 410, serverCode: 'upload_session_expired' }),
      ],
    })
    const keys: string[] = []
    const reader = fileReader(path)
    try {
      const result = await runChunkedUpload(client, {
        target: { kind: 'workspace', workspaceId: 'ws_1' },
        filename: 'big.docx',
        size: built.size,
        probe,
        idempotencyKey: 'idem-r1-09b',
        resume,
        freshIdempotencyKey: () => 'fresh-r1-09b',
        onIdempotencyKey: (key) => keys.push(key),
        readRange: reader.readRange,
      })
      expect(result.kind).toBe('document')
      expect(keys).toEqual(['fresh-r1-09b'])
      // one restart create under the fresh key, then a second complete that
      // succeeds; the restart re-sends the parts from part 1 (the resumed
      // session's parts are not carried into the new one)
      expect(calls.creates).toHaveLength(1)
      expect(calls.creates[0]!.idempotencyKey).toBe('fresh-r1-09b')
      expect(calls.completes).toHaveLength(2)
      expect([...new Set(calls.partPuts)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
    } finally {
      reader.close()
    }
  })

  it('a gone session found by the busy poll ends the run with its own verdict', async () => {
    const path = join(dir, 'big.docx')
    const built = buildBigDocx(path)
    const probe = await readLocalFileProbe({ path }, built.size, 'big.docx')
    const { client } = fakeSessions({
      size: built.size,
      completeFaults: [
        new UniworkDocError('server_error', {
          status: 409,
          serverCode: 'upload_session_busy',
          retryAfterMs: 0,
        }),
      ],
    })
    // the poll after the busy verdict finds the session gone
    let gets = 0
    const originalGet = client.getUploadSession.bind(client)
    client.getUploadSession = async (sessionId, signal) => {
      gets += 1
      if (gets === 1) {
        throw new UniworkDocError('not_found', { status: 404, serverCode: 'not_found' })
      }
      return await originalGet(sessionId, signal)
    }
    // no fresh-key source: the gone verdict must surface, never the busy error
    const error = await runChunkedUpload(client, {
      target: { kind: 'workspace', workspaceId: 'ws_1' },
      filename: 'big.docx',
      size: built.size,
      probe,
      idempotencyKey: 'idem-r1-09c',
      readRange: async (offset, length) => new Uint8Array(length),
    }).catch((e) => e)
    expect((error as UniworkDocError).code).toBe('not_found')
    expect((error as UniworkDocError).serverCode).toBe('not_found')
  })
})
