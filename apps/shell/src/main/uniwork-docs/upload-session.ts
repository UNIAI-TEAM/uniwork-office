import { open, type FileHandle } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { UniworkDocErrorCode, UniworkDocSummary } from '../../shared/home-api'
import type { LocalFileProbePayload, UniworkDocsClient } from './client'
import { UniworkDocError } from './errors'
import { formatForName } from './formats'
import type { DocumentLimits } from './limits'
import type { UploadReceipt, UploadSessionStatus } from './parse'

/**
 * BIGUP-A1: the desktop half of the large-upload flow. A file above
 * `documents.limits.chunked_upload_threshold_bytes` is not sent as one
 * multipart POST (which the edge caps, and which main would have to buffer
 * whole): a session is opened, the parts go straight to the storage's
 * presigned URLs four at a time, and `complete` makes the server assemble and
 * validate the object. This module owns the wire work; `service.ts` owns the
 * two callers (a new document, a first save) and the resume store.
 *
 * Nothing here reads the whole file: the probe reads a bounded head plus the
 * ZIP tail, and each part is read on demand through `readRange`, so peak RAM
 * is `PART_CONCURRENCY` parts (32 MiB at the server's 8 MiB part size).
 */

/** how many parts are in flight at once (contract §7.2; 4 x 8 MiB = 32 MiB) */
export const PART_CONCURRENCY = 4
/** the retry delays of one part, in order: 1 s, 2 s, 4 s (three retries) */
const PART_RETRY_DELAYS_MS = [1_000, 2_000, 4_000]
/** how long before a part URL's own expiry the client refreshes it instead */
const PART_URL_EXPIRY_MARGIN_MS = 30_000
/**
 * how many times one part may be re-signed before the client gives up: the
 * server hands out `parts` only while a session is `open`, so a session that
 * keeps answering without the URL we need is one we cannot finish - a bounded
 * loop, never a spin.
 */
const PART_URL_REFRESH_LIMIT = 3
/** the probe head the server demands exactly: `min(size, 64 KiB)` */
const PROBE_HEAD_BYTES = 65_536
/** the largest ZIP central directory the probe will carry (server limit) */
const PROBE_CENTRAL_DIR_MAX_BYTES = 1 << 20
/** the tail read that has to hold the EOCD: 64 KiB comment + EOCD + ZIP64 locator */
const PROBE_TAIL_BYTES = 70 * 1024
/** the package-safety bounds the server applies (document.FileLimits) */
const MAX_ZIP_ENTRIES = 10_000
const MAX_ZIP_UNCOMPRESSED_BYTES = 512 << 20
const MAX_ZIP_ENTRY_RATIO = 200
const MAX_ZIP_ENTRY_NAME_BYTES = 1024

/** the part of `client.ts` this module uses (the real types, never `unknown`) */
export type UploadSessionClient = Pick<
  UniworkDocsClient,
  | 'createWorkspaceUploadSession'
  | 'createDocumentUploadSession'
  | 'getUploadSession'
  | 'completeUploadSession'
  | 'deleteUploadSession'
  | 'putUploadPart'
>

/** the probe of a local file, camelCase as the rest of main spells it */
export interface LocalFileProbe {
  head_b64: string
  central_dir_b64: string
  cd_offset: number | null
  cd_size: number | null
}

/** where a chunked upload creates its document (mirrors the one-request target) */
export type UploadSessionTarget =
  | {
      kind: 'workspace'
      workspaceId: string
      parentId?: string | null
      title?: string
      visibility?: string | null
    }
  | { kind: 'document'; documentId: string }

/** what a caller persists so a later run can resume instead of re-uploading */
export interface SavedUploadSession {
  sessionId: string
  partSize: number
  totalParts: number
  completedParts: Array<{ partNumber: number; etag: string }>
  expiresAt: string
}

/** the two UI phases of a chunked upload; `checking` is the server's own validation */
export type ChunkedUploadPhase = 'uploading' | 'checking'

export interface ChunkedUploadInput {
  target: UploadSessionTarget
  filename: string
  size: number
  /** reads `[offset, offset+length)`; never the whole file (a handle read, or a subarray) */
  readRange(offset: number, length: number): Promise<Uint8Array>
  probe: LocalFileProbe
  idempotencyKey: string
  resume?: SavedUploadSession
  signal?: AbortSignal
  onProgress?(loaded: number, total: number): void
  onPhase?(phase: ChunkedUploadPhase): void
  /** called after create and after every finished part, so the caller can persist resume state */
  onSessionState?(state: SavedUploadSession): void | Promise<void>
}

export type ChunkedUploadResult =
  { kind: 'document'; document: UniworkDocSummary } | { kind: 'upload'; upload: UploadReceipt }

/** `limits.chunked_upload_threshold_bytes` present and `size` above it */
export function shouldUseChunkedUpload(size: number, limits: DocumentLimits): boolean {
  const threshold = limits.chunked_upload_threshold_bytes
  return typeof threshold === 'number' && Number.isSafeInteger(threshold) && size > threshold
}

/** one entry of a ZIP central directory, as the safety rules read it */
interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
}

const utf8 = new TextDecoder('utf-8', { fatal: false })

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

/**
 * The local pre-check of one file, bounded: the first `min(size, 64 KiB)` and,
 * for a ZIP container, the central directory located from the file's tail. The
 * rules mirror the server's (`document.ValidateUploadProbe`): a package must
 * be a ZIP, carry `[Content_Types].xml` and its own main folder, hold no
 * `vbaProject.bin`, and stay inside the entry-count / declared-size / ratio /
 * name bounds. A file that fails is refused here, before any byte is sent, as
 * `unsupported_format` - the server would answer the same 415 later.
 *
 * A non-ZIP format (PDF, plain text) needs only the head: the server's probe
 * check for those reads the head alone.
 */
export async function readLocalFileProbe(
  source: { path: string } | { bytes: Uint8Array },
  size: number,
  filename: string,
): Promise<LocalFileProbe> {
  const format = formatForName(filename)
  if (!format) throw new UniworkDocError('unsupported_format')
  if (!Number.isSafeInteger(size) || size <= 0) throw new UniworkDocError('unsupported_format')

  const headLength = Math.min(size, PROBE_HEAD_BYTES)
  const zipFormat = format === 'docx' || format === 'xlsx' || format === 'pptx'
  const reader = await rangeReaderOf(source)
  try {
    const head = await reader.read(0, headLength)
    if (!zipFormat) {
      checkHeadRules(format, head, size)
      return { head_b64: base64(head), central_dir_b64: '', cd_offset: null, cd_size: null }
    }
    if (
      head.length < 4 ||
      !(head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)
    ) {
      throw new UniworkDocError('unsupported_format', { serverCode: 'zip_unreadable' })
    }
    // the central directory is located from the tail: the EOCD, or the ZIP64
    // EOCD its locator points at (a package near the size cap can be ZIP64)
    const tailLength = Math.min(size, PROBE_TAIL_BYTES)
    const tail = await reader.read(size - tailLength, tailLength)
    const located = locateCentralDirectory(tail, size - tailLength, size)
    if (!located) {
      throw new UniworkDocError('unsupported_format', { serverCode: 'zip_unreadable' })
    }
    if (located.size > PROBE_CENTRAL_DIR_MAX_BYTES) {
      throw new UniworkDocError('unsupported_format', { serverCode: 'zip_unreadable' })
    }
    const centralDir = await reader.read(located.offset, located.size)
    checkZipRules(centralDir, format)
    return {
      head_b64: base64(head),
      central_dir_b64: base64(centralDir),
      cd_offset: located.offset,
      cd_size: located.size,
    }
  } finally {
    await reader.close()
  }
}

/** a `[offset, offset+length)` reader over one of the two probe sources */
interface ProbeRangeReader {
  read(offset: number, length: number): Promise<Uint8Array>
  close(): Promise<void>
}

/**
 * The bounded reads the probe makes: a file handle for a path (so a 200 MiB
 * pick is never buffered), a copy of the slice for a payload the caller
 * already holds (the first-save path's bytes). Both answer exactly `length`
 * bytes or throw - a short read means the file changed under us.
 */
async function rangeReaderOf(
  source: { path: string } | { bytes: Uint8Array },
): Promise<ProbeRangeReader> {
  if ('bytes' in source) {
    const bytes = source.bytes
    return {
      read: async (offset, length) => bytes.slice(offset, offset + length),
      close: async () => undefined,
    }
  }
  const file = await open(source.path, 'r')
  return {
    read: (offset, length) => readExactly(file, offset, length),
    close: async () => {
      await file.close().catch(() => undefined)
    },
  }
}

/** a file handle read that must return every byte asked for, or the file changed */
async function readExactly(file: FileHandle, offset: number, length: number): Promise<Uint8Array> {
  if (length <= 0) return new Uint8Array(0)
  const buffer = new Uint8Array(length)
  let done = 0
  while (done < length) {
    const step = await file.read(buffer, done, length - done, offset + done)
    if (step.bytesRead <= 0) {
      throw new UniworkDocError('unsupported_format', { serverCode: 'probe_head_too_short' })
    }
    done += step.bytesRead
  }
  return buffer
}

/** the non-ZIP head rules: a PDF header, or text that carries no NUL byte */
function checkHeadRules(format: string, head: Uint8Array, size: number): void {
  if (head.length === 0) {
    throw new UniworkDocError('unsupported_format', { serverCode: 'empty' })
  }
  if (format === 'pdf') {
    const prefix = utf8.decode(head.subarray(0, 8))
    if (!prefix.startsWith('%PDF-1.') && !prefix.startsWith('%PDF-2.')) {
      throw new UniworkDocError('unsupported_format', { serverCode: 'pdf_header' })
    }
    return
  }
  if (head.includes(0)) {
    throw new UniworkDocError('unsupported_format', { serverCode: 'text_binary' })
  }
  if (size > head.length && !validUtf8Cut(head)) {
    throw new UniworkDocError('unsupported_format', { serverCode: 'text_not_utf8' })
  }
  if (size === head.length && !isValidUtf8(head)) {
    throw new UniworkDocError('unsupported_format', { serverCode: 'text_not_utf8' })
  }
}

function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

/** a truncated multi-byte tail is legal on a cut; any other invalid byte is not */
function validUtf8Cut(head: Uint8Array): boolean {
  if (isValidUtf8(head)) return true
  for (let cut = 1; cut < 4 && cut < head.length; cut += 1) {
    const rest = head.subarray(0, head.length - cut)
    if (!isValidUtf8(rest)) continue
    // the removed bytes must be ONE rune the buffer cut short: a lead byte
    // that needs more bytes than were cut, followed only by continuations
    const lead = head[rest.length]!
    const need = lead < 0xc2 ? 1 : lead <= 0xdf ? 2 : lead <= 0xef ? 3 : lead <= 0xf4 ? 4 : 0
    if (need <= cut) continue
    let continuations = true
    for (let at = rest.length + 1; at < head.length; at += 1) {
      const byte = head[at]!
      if (byte < 0x80 || byte > 0xbf) continuations = false
    }
    if (continuations) return true
  }
  return false
}

/**
 * The central directory of a ZIP, located from the tail. The probe the server
 * demands is `[cd_offset, size_bytes)`: the directory itself plus the EOCD (and
 * any comment) that ends the file - `ValidateUploadProbe` requires
 * `len(central_dir) == cd_size` and `cd_offset + cd_size <= size_bytes`, and its
 * sparse reader places the tail at `cd_offset + len(centralDir)`, so the span
 * has to run to the end of the file. The ZIP64 EOCD's own `offset`/`size` are
 * used when the 32-bit fields saturate at `0xffffffff` (the locator preceding
 * the EOCD points at it). Null when the tail holds no readable EOCD - the file
 * is not a package.
 */
function locateCentralDirectory(
  tail: Uint8Array,
  tailStart: number,
  size: number,
): { offset: number; size: number } | null {
  const eocd = lastIndexOf(tail, [0x50, 0x4b, 0x05, 0x06])
  if (eocd < 0 || eocd + 22 > tail.length) return null
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
  const entries = view.getUint16(eocd + 10, true)
  const cdSize = view.getUint32(eocd + 12, true)
  const cdOffset = view.getUint32(eocd + 16, true)
  const needsZip64 = entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff
  if (!needsZip64) {
    if (cdSize === 0 || cdOffset + cdSize > size) return null
    return { offset: cdOffset, size: size - cdOffset }
  }
  // the ZIP64 EOCD locator sits immediately before the EOCD
  const locator = eocd - 20
  if (locator < 0 || !matchesAt(tail, locator, [0x50, 0x4b, 0x06, 0x07])) return null
  const zip64Offset = readUint64(view, locator + 8)
  const at = zip64Offset - tailStart
  if (at < 0 || at + 56 > tail.length || !matchesAt(tail, at, [0x50, 0x4b, 0x06, 0x06])) {
    return null
  }
  const zip64Size = readUint64(view, at + 40)
  const zip64CdOffset = readUint64(view, at + 48)
  if (zip64Size === 0 || zip64CdOffset + zip64Size > size) return null
  return { offset: zip64CdOffset, size: size - zip64CdOffset }
}

/** a ZIP64 8-byte field: exact while it fits a JS number (files are bounded by the cap) */
function readUint64(view: DataView, offset: number): number {
  const low = view.getUint32(offset, true)
  const high = view.getUint32(offset + 4, true)
  return high * 0x1_0000_0000 + low
}

function matchesAt(bytes: Uint8Array, at: number, signature: number[]): boolean {
  if (at < 0 || at + signature.length > bytes.length) return false
  return signature.every((byte, index) => bytes[at + index] === byte)
}

function lastIndexOf(haystack: Uint8Array, needle: number[]): number {
  for (let at = haystack.length - needle.length; at >= 0; at -= 1) {
    if (matchesAt(haystack, at, needle)) return at
  }
  return -1
}

/**
 * The package safety rules, on the central directory alone (the same ones the
 * server runs): entry count, names, the declared inflation total and per-entry
 * ratio, and no macro part. Every entry's name is what the server's
 * `checkZipParts` reads, so a package refused here is refused there too.
 */
function checkZipRules(centralDir: Uint8Array, format: string): void {
  const entries: ZipEntry[] = []
  let total = 0
  const view = new DataView(centralDir.buffer, centralDir.byteOffset, centralDir.byteLength)
  let at = 0
  while (at + 46 <= centralDir.length && matchesAt(centralDir, at, [0x50, 0x4b, 0x01, 0x02])) {
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const nameStart = at + 46
    if (nameStart + nameLength > centralDir.length) {
      throw new UniworkDocError('unsupported_format', { serverCode: 'zip_unreadable' })
    }
    const name = utf8.decode(centralDir.subarray(nameStart, nameStart + nameLength))
    const entry: ZipEntry = {
      name,
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      uncompressedSize: view.getUint32(at + 24, true),
    }
    entries.push(entry)
    at = nameStart + nameLength + extraLength + commentLength
  }
  if (entries.length === 0) {
    throw new UniworkDocError('unsupported_format', { serverCode: 'zip_unreadable' })
  }
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new UniworkDocError('unsupported_format', { serverCode: 'zip_too_many_entries' })
  }
  const seen = new Set<string>()
  for (const entry of entries) {
    checkEntryName(entry.name)
    const lower = entry.name.toLowerCase()
    if (seen.has(lower)) {
      throw new UniworkDocError('unsupported_format', { serverCode: 'zip_unsafe_path' })
    }
    seen.add(lower)
    if (lower.split('/').pop() === 'vbaproject.bin') {
      throw new UniworkDocError('unsupported_format', { serverCode: 'zip_macro_part' })
    }
    total += entry.uncompressedSize
    if (total > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new UniworkDocError('unsupported_format', { serverCode: 'zip_uncompressed_too_large' })
    }
    if (
      entry.uncompressedSize > 0 &&
      entry.method !== 0 &&
      (entry.compressedSize === 0 ||
        entry.uncompressedSize / entry.compressedSize > MAX_ZIP_ENTRY_RATIO)
    ) {
      throw new UniworkDocError('unsupported_format', { serverCode: 'zip_compression_ratio' })
    }
  }
  const required = format === 'docx' ? 'word/' : format === 'xlsx' ? 'xl/' : 'ppt/'
  if (!seen.has('[content_types].xml')) {
    throw new UniworkDocError('unsupported_format', { serverCode: 'ooxml_missing_part' })
  }
  if (!entries.some((entry) => entry.name.toLowerCase().startsWith(required))) {
    throw new UniworkDocError('unsupported_format', { serverCode: 'ooxml_missing_part' })
  }
}

/** the server's `checkEntryName`: relative, forward slashes, no control bytes, bounded */
function checkEntryName(name: string): void {
  const bytes = Buffer.byteLength(name, 'utf8')
  const leaves = (seg: string) => seg === '..' || seg === '.'
  const unsafe =
    name === '' ||
    bytes > MAX_ZIP_ENTRY_NAME_BYTES ||
    name.startsWith('/') ||
    name.includes('\\') ||
    (name.length >= 2 && name[1] === ':') ||
    // eslint-disable-next-line no-control-regex -- the rule itself: a control byte is what is refused
    /[\u0000-\u001f\u007f]/.test(name) ||
    name.split('/').some(leaves)
  if (unsafe) {
    throw new UniworkDocError('unsupported_format', { serverCode: 'zip_unsafe_path' })
  }
}

/**
 * One chunked upload: create (or resume) a session, PUT the missing parts four
 * at a time with a per-part retry, refresh expired URLs, then `complete`. The
 * whole error table of the contract is here - a session the server no longer
 * knows restarts from part 1, a busy `complete` waits and re-reads, and a part
 * whose URL expired is re-signed without touching the parts already stored.
 */
export async function runChunkedUpload(
  client: UploadSessionClient,
  input: ChunkedUploadInput,
): Promise<ChunkedUploadResult> {
  let session = await openOrResumeSession(client, input)
  let completed = new Map(session.completedParts.map((part) => [part.partNumber, part.etag]))
  let urls = new Map(session.parts.map((part) => [part.partNumber, part]))
  const total = input.size
  let loaded = sumPartBytes(completed, session.partSize, total)

  const publish = async (): Promise<void> => {
    await input.onSessionState?.({
      sessionId: session.sessionId,
      partSize: session.partSize,
      totalParts: session.totalParts,
      completedParts: [...completed].map(([partNumber, etag]) => ({ partNumber, etag })),
      expiresAt: session.expiresAt,
    })
  }
  await publish()
  // a resumed upload reports the bytes it already holds before the first PUT,
  // so the progress bar starts where the previous attempt left off
  input.onProgress?.(loaded, total)

  const refreshUrls = async (): Promise<void> => {
    const fresh = await client.getUploadSession(session.sessionId)
    session = fresh
    urls = new Map(fresh.parts.map((part) => [part.partNumber, part]))
    // the server's ListParts is the authority on what the storage holds, so a
    // part it names is recorded with ITS etag (ours was refused as mismatched)
    for (const part of fresh.completedParts) completed.set(part.partNumber, part.etag)
    loaded = sumPartBytes(completed, session.partSize, total)
    input.onProgress?.(loaded, total)
  }

  /**
   * After `422 upload_parts_invalid` the server's `completed_parts` REPLACES
   * ours: a part it does not name was never stored (whatever we believed), and
   * one it names with another ETag is the one the next `complete` must send.
   */
  const resyncCompleted = async (): Promise<void> => {
    await refreshUrls()
    const authoritative = new Map<number, string>()
    for (const part of session.completedParts) {
      if (part.partNumber >= 1 && part.partNumber <= session.totalParts) {
        authoritative.set(part.partNumber, part.etag)
      }
    }
    completed = authoritative
    loaded = sumPartBytes(completed, session.partSize, total)
    input.onProgress?.(loaded, total)
  }

  const missing = (): number[] => {
    const numbers: number[] = []
    for (let partNumber = 1; partNumber <= session.totalParts; partNumber += 1) {
      if (!completed.has(partNumber)) numbers.push(partNumber)
    }
    return numbers
  }

  const uploadPart = async (partNumber: number): Promise<void> => {
    let refreshes = 0
    for (let attempt = 0; ; attempt += 1) {
      throwIfAborted(input.signal)
      const part = urls.get(partNumber)
      if (!part || Date.parse(part.expiresAt) - Date.now() <= PART_URL_EXPIRY_MARGIN_MS) {
        // a URL is missing or about to expire: re-sign before sending, never
        // after a 403. The session answers `parts` only while it is `open`, so
        // a third empty answer means it is not ours to finish any more.
        if (refreshes >= PART_URL_REFRESH_LIMIT) {
          throw new UniworkDocError('server_error', { serverCode: 'upload_part_url_missing' })
        }
        refreshes += 1
        await refreshUrls()
        continue
      }
      const offset = (partNumber - 1) * session.partSize
      const length = Math.min(session.partSize, total - offset)
      const bytes = await input.readRange(offset, length)
      try {
        const answer = await client.putUploadPart({
          partNumber,
          url: part.url,
          headers: part.headers,
          bytes,
          ...(input.signal ? { signal: input.signal } : {}),
        })
        completed.set(partNumber, answer.etag)
        loaded += bytes.byteLength
        input.onProgress?.(loaded, total)
        await publish()
        return
      } catch (error) {
        if (input.signal?.aborted) throw abortedError()
        // an expired presigned URL is not a failed attempt: re-sign and retry
        if (error instanceof UniworkDocError && error.status === 403) {
          if (refreshes >= PART_URL_REFRESH_LIMIT) throw error
          refreshes += 1
          await refreshUrls()
          continue
        }
        if (!isRetryablePartFailure(error) || attempt >= PART_RETRY_DELAYS_MS.length) throw error
        await sleep(PART_RETRY_DELAYS_MS[attempt]!, input.signal)
      }
    }
  }

  // The upload/complete pair runs at most twice: a `422 upload_parts_invalid`
  // means the storage's own ListParts disagreed with the ETags we sent, so the
  // session is re-read (fresh URLs and the authoritative completed parts), the
  // missing or mismatched parts go again, and `complete` runs once more. A
  // second verdict is the answer.
  for (let attempt = 0; ; attempt += 1) {
    // A resumed session the server is already validating has every part it
    // needs: it is not `open`, so it hands out no URLs, and the next `complete`
    // answers the stored result (idempotent). Uploading would be impossible.
    if (session.status !== 'validating') {
      await runPool(missing(), PART_CONCURRENCY, uploadPart)
      throwIfAborted(input.signal)
    }

    // the server validates the assembled object (size, probe, full file check):
    // this is the "Đang kiểm tra tệp…" phase, which can take a while on 200 MiB
    input.onPhase?.('checking')
    try {
      const result = await completeWithBusyRetry(client, session, completed, input.signal)
      input.onProgress?.(total, total)
      return result
    } catch (error) {
      const partsInvalid =
        attempt === 0 &&
        error instanceof UniworkDocError &&
        error.serverCode === 'upload_parts_invalid'
      if (!partsInvalid) throw error
      await resyncCompleted()
      input.onPhase?.('uploading')
    }
  }
}

/** the session to work with: the caller's saved one, or a fresh create */
async function openOrResumeSession(
  client: UploadSessionClient,
  input: ChunkedUploadInput,
): Promise<UploadSessionForRun> {
  if (input.resume) {
    try {
      const state = await client.getUploadSession(input.resume.sessionId)
      // A session the server is already validating (or has completed) has all
      // its parts: the run skips straight to `complete`, which answers the
      // stored result for a finished one. `validating` on the GET is therefore
      // NOT a restart - the parts are there, and a fresh session would throw
      // 200 MiB of upload away.
      return {
        sessionId: state.sessionId,
        status: state.status,
        partSize: state.partSize || input.resume.partSize,
        totalParts: state.totalParts || input.resume.totalParts,
        completedParts: state.completedParts.length
          ? state.completedParts.map((part) => ({ partNumber: part.partNumber, etag: part.etag }))
          : input.resume.completedParts,
        parts: state.parts,
        expiresAt: state.expiresAt,
      }
    } catch (error) {
      // 404 / 410: the saved session is gone - start over from part 1
      if (!isSessionGone(error)) throw error
    }
  }
  return createSession(client, input)
}

interface UploadSessionForRun {
  sessionId: string
  /** null until a GET reports it: a fresh create answer carries no status */
  status: UploadSessionStatus | null
  partSize: number
  totalParts: number
  completedParts: Array<{ partNumber: number; etag: string }>
  parts: Array<{
    partNumber: number
    method: string
    url: string
    headers: Record<string, string>
    expiresAt: string
  }>
  expiresAt: string
}

async function createSession(
  client: UploadSessionClient,
  input: ChunkedUploadInput,
): Promise<UploadSessionForRun> {
  const probe: LocalFileProbePayload = {
    head_b64: input.probe.head_b64,
    central_dir_b64: input.probe.central_dir_b64,
    cd_offset: input.probe.cd_offset,
    cd_size: input.probe.cd_size,
  }
  const target = input.target
  const state =
    target.kind === 'workspace'
      ? await client.createWorkspaceUploadSession({
          workspaceId: target.workspaceId,
          filename: input.filename,
          sizeBytes: input.size,
          probe,
          idempotencyKey: input.idempotencyKey,
          ...(target.parentId !== undefined ? { parentId: target.parentId } : {}),
          ...(target.title !== undefined ? { title: target.title } : {}),
          ...(target.visibility !== undefined ? { visibility: target.visibility } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
        })
      : await client.createDocumentUploadSession({
          documentId: target.documentId,
          filename: input.filename,
          sizeBytes: input.size,
          probe,
          idempotencyKey: input.idempotencyKey,
          ...(input.signal ? { signal: input.signal } : {}),
        })
  return { ...state, status: state.status ?? 'open' }
}

/**
 * `complete`, honouring a busy session: a 409 `upload_session_busy` means
 * another validation holds the lease. The client waits the server's own
 * `retry_after`, then reads the status: `validating` is the other call still
 * working, so it waits again rather than sending a request that could only be
 * refused again; `completed` and `open` both mean this call may go - a repeat
 * of `complete` on a finished session answers the same result (idempotent), and
 * an `open` one was released without finishing, so it is run again.
 */
async function completeWithBusyRetry(
  client: UploadSessionClient,
  session: UploadSessionForRun,
  completed: Map<number, string>,
  signal?: AbortSignal,
): Promise<ChunkedUploadResult> {
  const parts = [...completed].map(([partNumber, etag]) => ({ partNumber, etag }))
  for (let attempt = 0; ; attempt += 1) {
    throwIfAborted(signal)
    try {
      const answer = await client.completeUploadSession({ sessionId: session.sessionId, parts })
      return answer.kind === 'document'
        ? { kind: 'document', document: answer.document }
        : { kind: 'upload', upload: answer.upload }
    } catch (error) {
      if (signal?.aborted) throw abortedError()
      const busy = error instanceof UniworkDocError && error.serverCode === 'upload_session_busy'
      if (!busy || attempt >= COMPLETE_BUSY_ATTEMPTS) throw error
      const delay = error.retryAfterMs ?? COMPLETE_BUSY_DEFAULT_DELAY_MS
      for (let waited = 0; waited <= COMPLETE_BUSY_WAIT_LIMIT; waited += 1) {
        await sleep(delay, signal)
        const status = await readSessionStatus(client, session.sessionId)
        // a session the server no longer has is not ours to finish: the caller
        // drops its saved session and its next attempt starts a fresh one
        if (status === null) throw error
        if (status !== 'validating') break
      }
    }
  }
}

/** how many `complete` calls one run makes before a busy verdict is the answer */
const COMPLETE_BUSY_ATTEMPTS = 3
/** the server's own delay for a busy session, when it sent none */
const COMPLETE_BUSY_DEFAULT_DELAY_MS = 5_000
/** how many times one run waits out another call's validation */
const COMPLETE_BUSY_WAIT_LIMIT = 60

/** the session's status, or null when the server no longer knows the session */
async function readSessionStatus(
  client: UploadSessionClient,
  sessionId: string,
): Promise<UploadSessionStatus | null> {
  try {
    return (await client.getUploadSession(sessionId)).status
  } catch (error) {
    if (isSessionGone(error)) return null
    throw error
  }
}

/** the parts the server holds of a saved session, as bytes already sent */
function sumPartBytes(completed: Map<number, string>, partSize: number, total: number): number {
  let loaded = 0
  for (const partNumber of completed.keys()) {
    const offset = (partNumber - 1) * partSize
    loaded += Math.min(partSize, Math.max(0, total - offset))
  }
  return loaded
}

/** a bounded worker pool: at most `limit` tasks run at once, first failure wins */
async function runPool(
  items: number[],
  limit: number,
  run: (item: number) => Promise<void>,
): Promise<void> {
  let next = 0
  let failure: unknown = null
  const worker = async (): Promise<void> => {
    while (failure === null) {
      const index = next
      next += 1
      if (index >= items.length) return
      try {
        await run(items[index]!)
      } catch (error) {
        if (failure === null) failure = error
        return
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker)
  await Promise.all(workers)
  if (failure !== null) throw failure
}

/** a part PUT retries on a network failure, a timeout, a throttle or a 5xx */
function isRetryablePartFailure(error: unknown): boolean {
  if (!(error instanceof UniworkDocError)) return false
  if (error.code === 'network' || error.code === 'timeout') return true
  if (error.status === undefined) return false
  return error.status === 429 || error.status >= 500
}

/** the session is gone: drop the saved state and start a new one */
function isSessionGone(error: unknown): boolean {
  if (!(error instanceof UniworkDocError)) return false
  if (error.code === 'not_found') return true
  return error.serverCode === 'upload_session_too_small'
}

function abortedError(): UniworkDocError {
  return new UniworkDocError('upload_cancelled' as UniworkDocErrorCode)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortedError()
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  // Promise.withResolvers is outside this target's lib (ES2022), so the
  // executor form is what the repo uses for a timed wait
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedError())
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(abortedError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Cancels one session: the `DELETE` aborts the storage's multipart upload and
 * releases the quota the server reserved. A session that is already gone (404)
 * or already expired/aborted (410) is the same answer - nothing left to free -
 * so it is swallowed; anything else propagates, because a caller that cannot
 * free its session should not pretend it did.
 */
export async function abortUploadSession(
  client: UploadSessionClient,
  sessionId: string,
): Promise<void> {
  try {
    await client.deleteUploadSession(sessionId)
  } catch (error) {
    if (isSessionGone(error)) return
    throw error
  }
}

/**
 * The sha256 of a local file, streamed through a read handle: the first-save
 * path needs the working copy's checksum, and a 200 MiB file must never be
 * buffered to get it. One pass, 1 MiB at a time.
 */
export async function sha256File(path: string, signal?: AbortSignal): Promise<string> {
  const file = await open(path, 'r')
  const hash = createHash('sha256')
  const buffer = new Uint8Array(1 << 20)
  try {
    for (;;) {
      throwIfAborted(signal)
      const step = await file.read(buffer, 0, buffer.byteLength, null)
      if (step.bytesRead <= 0) break
      hash.update(buffer.subarray(0, step.bytesRead))
    }
  } finally {
    await file.close().catch(() => undefined)
  }
  return hash.digest('hex')
}
