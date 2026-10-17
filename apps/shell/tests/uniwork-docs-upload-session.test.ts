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
      const cd = Buffer.alloc(46)
      cd.writeUInt32LE(0x02014b50, 0)
      cd.writeUInt16LE(20, 4)
      cd.writeUInt16LE(20, 6)
      cd.writeUInt16LE(stored ? 0 : 8, 10)
      cd.writeUInt32LE(crc, 16)
      cd.writeUInt32LE(body?.length ?? size, 20)
      cd.writeUInt32LE(size, 24)
      cd.writeUInt16LE(name.length, 28)
      cd.writeUInt32LE(localOffset, 42)
      central.push(cd, name)
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
    async getUploadSession() {
      if (options.getFault) throw options.getFault
      calls.refreshes += 1
      generation += 1
      return state()
    },
    async completeUploadSession(input) {
      calls.completes.push(input.parts)
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
