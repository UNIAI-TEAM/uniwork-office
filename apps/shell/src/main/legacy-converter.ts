import { spawn, type ChildProcess } from 'node:child_process'
import { constants as fsConstants, existsSync, readFileSync, type Stats } from 'node:fs'
import { cp, mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { inflateRawSync } from 'node:zlib'
import { killProcessTree, type KillProcessTreeDeps } from './pdf-convert/convert-host'

export type OdfSourceFormat = 'odt' | 'ott' | 'ods' | 'ots' | 'odp' | 'otp'
export type LegacySourceFormat = 'doc' | 'xls' | 'ppt' | OdfSourceFormat
export type LegacyTargetFormat = 'docx' | 'xlsx' | 'pptx'

const ODF_SOURCE_FORMATS: Readonly<Record<string, true>> = {
  odt: true,
  ott: true,
  ods: true,
  ots: true,
  odp: true,
  otp: true,
}

export function isOdfFormat(format: string): format is OdfSourceFormat {
  return Object.hasOwn(ODF_SOURCE_FORMATS, format)
}

export type LegacyConvertErrorCode =
  'encrypted' | 'corrupt' | 'unsupported' | 'timeout' | 'converter_missing' | 'cancelled' | 'failed'

export class LegacyConvertError extends Error {
  readonly code: LegacyConvertErrorCode
  readonly format?: LegacySourceFormat
  readonly detail?: string

  constructor(
    code: LegacyConvertErrorCode,
    message: string,
    opts?: { format?: LegacySourceFormat; detail?: string; cause?: unknown },
  ) {
    super(message, opts?.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'LegacyConvertError'
    this.code = code
    if (opts?.format) this.format = opts.format
    if (opts?.detail) this.detail = opts.detail
  }
}

export const LEGACY_TARGET_FOR_SOURCE: Readonly<Record<LegacySourceFormat, LegacyTargetFormat>> = {
  doc: 'docx',
  odt: 'docx',
  ott: 'docx',
  xls: 'xlsx',
  ods: 'xlsx',
  ots: 'xlsx',
  ppt: 'pptx',
  odp: 'pptx',
  otp: 'pptx',
}

export const LEGACY_INFILTER_FOR_SOURCE: Readonly<Record<LegacySourceFormat, string>> = {
  doc: 'MS Word 97',
  odt: 'writer8',
  ott: 'writer8',
  xls: 'MS Excel 97',
  ods: 'calc8',
  ots: 'calc8',
  ppt: 'MS PowerPoint 97',
  odp: 'impress8',
  otp: 'impress8',
}

export const OOXML_REQUIRED_MAIN_PART: Readonly<Record<LegacyTargetFormat, string>> = {
  docx: 'word/document.xml',
  xlsx: 'xl/workbook.xml',
  pptx: 'ppt/presentation.xml',
}

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_CONCURRENCY = 2
/** Largest legacy input read into memory; anything bigger is refused before reading. */
const MAX_LEGACY_INPUT_BYTES = 200 * 1024 * 1024

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04] as const
const ENDOFCHAIN = 0xfffffffe
const FREESECT = 0xffffffff
const MAXREGSECT = 0xfffffffa
const SECTOR_SHIFTS = new Set([9, 12])
const MINI_SECTOR_SHIFT = 6
const MINI_STREAM_CUTOFF = 4096

const PPT_ENCRYPTED_HDR_TOKEN = 0xf3d1c4df
const PPT_CRYPT_SESSION_RECORD = 0x2f14
const XLS_BOF = 0x0809
const XLS_FILEPASS = 0x002f
const MAX_BIFF_SCAN_RECORDS = 500_000

export function legacyFormatForPath(filePath: string): LegacySourceFormat | null {
  const ext = extname(filePath).slice(1).toLowerCase()
  if (ext === 'doc' || ext === 'xls' || ext === 'ppt' || isOdfFormat(ext)) return ext
  return null
}

export function targetFormatForLegacy(source: LegacySourceFormat): LegacyTargetFormat {
  return LEGACY_TARGET_FOR_SOURCE[source]
}

export function suggestedOoxmlPathForLegacy(filePath: string): string {
  const source = legacyFormatForPath(filePath)
  if (!source) return filePath
  const target = LEGACY_TARGET_FOR_SOURCE[source]
  return filePath.replace(/\.[^.]+$/, `.${target}`)
}

// ---- CFB (OLE2) container reader + pre-check ----

interface CfbDirectoryEntry {
  readonly id: number
  readonly name: string
  readonly type: number
  readonly left: number
  readonly right: number
  readonly child: number
  readonly start: number
  readonly size: number
}

const CFB_NOSTREAM = 0xffffffff

function dirView(bytes: Uint8Array, at: number): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset + at)
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}

function walkChain(
  start: number,
  count: number,
  next: (sector: number) => number,
  table: string,
  claimed: Set<number>,
): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  let sector = start
  while (sector < MAXREGSECT) {
    if (sector >= count) {
      throw new LegacyConvertError('corrupt', `${table} chain names sector ${sector} past the file`)
    }
    if (seen.has(sector)) {
      throw new LegacyConvertError('corrupt', `${table} chain loops at sector ${sector}`)
    }
    if (claimed.has(sector)) {
      throw new LegacyConvertError('corrupt', `${table} chain overlaps at sector ${sector}`)
    }
    seen.add(sector)
    claimed.add(sector)
    out.push(sector)
    sector = next(sector)
  }
  if (sector !== ENDOFCHAIN) {
    throw new LegacyConvertError('corrupt', `${table} chain ends on a reserved marker`)
  }
  return out
}

function readCfbFat(view: DataView, sectorSize: number, sectorCount: number): Uint32Array {
  const fatSectors: number[] = []
  const addFatSector = (sector: number): void => {
    if (sector >= MAXREGSECT) return
    if (sector >= sectorCount) {
      throw new LegacyConvertError('corrupt', `FAT sector ${sector} is past the file`)
    }
    if (fatSectors.length >= sectorCount) {
      throw new LegacyConvertError('corrupt', 'more FAT sectors than the file holds')
    }
    fatSectors.push(sector)
  }
  for (let i = 0; i < 109; i++) addFatSector(view.getUint32(76 + i * 4, true))
  let difat = view.getUint32(68, true)
  const difatCount = view.getUint32(72, true)
  if (difatCount > sectorCount) {
    throw new LegacyConvertError('corrupt', 'more DIFAT sectors than the file holds')
  }
  const perSector = sectorSize / 4 - 1
  const seen = new Set<number>()
  for (let i = 0; i < difatCount && difat < MAXREGSECT; i++) {
    if (difat >= sectorCount) {
      throw new LegacyConvertError('corrupt', `DIFAT sector ${difat} is past the file`)
    }
    if (seen.has(difat)) {
      throw new LegacyConvertError('corrupt', `DIFAT chain loops at sector ${difat}`)
    }
    seen.add(difat)
    const dview = new DataView(view.buffer, view.byteOffset + (difat + 1) * sectorSize, sectorSize)
    for (let j = 0; j < perSector; j++) addFatSector(dview.getUint32(j * 4, true))
    difat = dview.getUint32(perSector * 4, true)
  }
  const fat = new Uint32Array(fatSectors.length * (sectorSize / 4))
  fatSectors.forEach((sector, index) => {
    const sview = new DataView(view.buffer, view.byteOffset + (sector + 1) * sectorSize, sectorSize)
    for (let i = 0; i < sectorSize / 4; i++) {
      fat[index * (sectorSize / 4) + i] = sview.getUint32(i * 4, true)
    }
  })
  if (fat.length === 0) throw new LegacyConvertError('corrupt', 'no FAT sectors')
  return fat
}

/**
 * Read every stream of a compound file. Keys are the stream's path from the root
 * storage: a root-level stream is its bare name (`WordDocument`), a nested one
 * carries its storage path (`ObjectPool/_1/EncryptionInfo`), so format and
 * encryption checks can tell the document's own streams from embedded objects'.
 * Every chain is still walked and bounds-checked, nested or not.
 */
export function readCfbStreams(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.byteLength < 512) {
    throw new LegacyConvertError('corrupt', 'shorter than a compound file header')
  }
  for (let i = 0; i < CFB_SIGNATURE.length; i++) {
    if (bytes[i] !== CFB_SIGNATURE[i]) {
      throw new LegacyConvertError('corrupt', 'bad compound file signature')
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sectorShift = view.getUint16(30, true)
  const miniShift = view.getUint16(32, true)
  if (!SECTOR_SHIFTS.has(sectorShift) || miniShift !== MINI_SECTOR_SHIFT) {
    throw new LegacyConvertError('corrupt', 'implausible sector size')
  }
  const sectorSize = 1 << sectorShift
  const miniSectorSize = 1 << miniShift
  const firstDirSector = view.getUint32(48, true)
  if (view.getUint32(56, true) !== MINI_STREAM_CUTOFF) {
    throw new LegacyConvertError('corrupt', 'implausible mini-stream cutoff')
  }
  const firstMiniFat = view.getUint32(60, true)
  const sectorCount = Math.floor(bytes.byteLength / sectorSize) - 1
  if (sectorCount <= 0) {
    throw new LegacyConvertError('corrupt', 'compound file has no body sectors')
  }

  const fat = readCfbFat(view, sectorSize, sectorCount)
  const claimedRegular = new Set<number>()
  const chain = (start: number): number[] =>
    walkChain(start, sectorCount, (sector) => fat[sector] ?? ENDOFCHAIN, 'FAT', claimedRegular)
  const sectorBytes = (sector: number): Uint8Array => {
    const at = (sector + 1) * sectorSize
    return bytes.subarray(at, at + sectorSize)
  }

  const directory = concatBytes(chain(firstDirSector).map(sectorBytes))
  const entries: CfbDirectoryEntry[] = []
  const entryById = new Map<number, CfbDirectoryEntry>()
  for (let at = 0; at + 128 <= directory.byteLength; at += 128) {
    const nameLen = dirView(directory, at).getUint16(64, true)
    if (nameLen < 2 || nameLen > 64) continue
    const entry: CfbDirectoryEntry = {
      id: at / 128,
      name: new TextDecoder('utf-16le').decode(directory.subarray(at, at + nameLen - 2)),
      type: directory[at + 66] ?? 0,
      left: dirView(directory, at).getUint32(68, true),
      right: dirView(directory, at).getUint32(72, true),
      child: dirView(directory, at).getUint32(76, true),
      start: dirView(directory, at).getUint32(116, true),
      size: Number(dirView(directory, at).getBigUint64(120, true)),
    }
    entries.push(entry)
    entryById.set(entry.id, entry)
  }
  const root = entries.find((e) => e.type === 5)
  if (!root) throw new LegacyConvertError('corrupt', 'no root directory entry')

  // Path of each entry below the root storage, walking the red-black sibling trees
  // and descending into storages; entries the walk never reaches are not the
  // document's own and get a key no root-level check can match.
  const pathById = new Map<number, string>()
  const walk: Array<[number, string]> = [[root.child, '']]
  for (let step = walk.pop(); step; step = walk.pop()) {
    const [id, prefix] = step
    const entry = id === CFB_NOSTREAM || pathById.has(id) ? undefined : entryById.get(id)
    if (!entry || entry.type === 5) continue
    const path = `${prefix}${entry.name}`
    pathById.set(id, path)
    walk.push([entry.left, prefix], [entry.right, prefix])
    if (entry.type === 1) walk.push([entry.child, `${path}/`])
  }

  const miniFat =
    firstMiniFat === ENDOFCHAIN || firstMiniFat === FREESECT
      ? new Uint8Array(0)
      : concatBytes(chain(firstMiniFat).map(sectorBytes))
  const miniStreamSectors =
    root.start === ENDOFCHAIN || root.start === FREESECT ? [] : chain(root.start)
  const miniStreamLen = Math.min(miniStreamSectors.length * sectorSize, root.size, bytes.byteLength)
  const miniCount = Math.min(
    Math.floor(miniStreamLen / miniSectorSize),
    Math.floor(miniFat.byteLength / 4),
  )
  const claimedMini = new Set<number>()
  const miniChain = (start: number): number[] =>
    walkChain(
      start,
      miniCount,
      (sector) => dirView(miniFat, sector * 4).getUint32(0, true),
      'mini FAT',
      claimedMini,
    )

  const miniStream =
    miniStreamSectors.length === 0
      ? new Uint8Array(0)
      : concatBytes(miniStreamSectors.map(sectorBytes)).subarray(
          0,
          Math.min(root.size, bytes.byteLength),
        )

  const out = new Map<string, Uint8Array>()
  for (const entry of entries) {
    if (entry.type !== 2 || entry.name === '' || entry.size === 0) continue
    const key = pathById.get(entry.id) ?? `<unreachable>/${entry.id}/${entry.name}`
    if (entry.size < MINI_STREAM_CUTOFF && miniStream.byteLength > 0) {
      if (entry.size > miniStream.byteLength) {
        throw new LegacyConvertError(
          'corrupt',
          `stream ${entry.name} is larger than the mini-stream`,
        )
      }
      const buf = new Uint8Array(entry.size)
      let at = 0
      for (const sector of miniChain(entry.start)) {
        const from = sector * miniSectorSize
        const take = Math.min(miniSectorSize, entry.size - at)
        buf.set(miniStream.subarray(from, from + take), at)
        at += take
        if (at >= entry.size) break
      }
      if (at < entry.size) {
        throw new LegacyConvertError(
          'corrupt',
          `stream ${entry.name} is shorter than its declared size`,
        )
      }
      out.set(key, buf)
    } else {
      if (entry.size > bytes.byteLength) {
        throw new LegacyConvertError('corrupt', `stream ${entry.name} is larger than the file`)
      }
      const body = concatBytes(chain(entry.start).map(sectorBytes))
      if (body.byteLength < entry.size) {
        throw new LegacyConvertError(
          'corrupt',
          `stream ${entry.name} is shorter than its declared size`,
        )
      }
      out.set(key, body.subarray(0, entry.size))
    }
  }
  return out
}

const ZIP_LOCAL_SIG = 0x04034b50
const ZIP_CENTRAL_SIG = 0x02014b50
const ZIP_EOCD_SIG = 0x06054b50
const ZIP_ZIP64_LOCATOR_SIG = 0x07064b50
const ZIP_EXTRA_ZIP64 = 0x0001
const ZIP_FLAG_ENCRYPTED = 1
function isZipSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false
  for (let i = 0; i < ZIP_SIGNATURE.length; i++) {
    if (bytes[i] !== ZIP_SIGNATURE[i]) return false
  }
  return true
}

interface ZipEntry {
  readonly name: string
  readonly method: number
  readonly compressedSize: number
  readonly size: number
  readonly localOffset: number
}

/**
 * List the entries of an in-memory ZIP archive from its central directory only.
 * No part is ever inflated, so the cost is bounded by the directory size
 * whatever the archive claims to contain.
 */
function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = bytes.byteLength - 22
  if (end < 0) throw new Error('zip: end of central directory not found')
  let eocd = -1
  for (let i = end; i >= Math.max(0, end - 0xffff); i--) {
    if (view.getUint32(i, true) === ZIP_EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('zip: end of central directory not found')
  const diskNum = view.getUint16(eocd + 4, true)
  const cdDisk = view.getUint16(eocd + 6, true)
  const diskCount = view.getUint16(eocd + 8, true)
  const count = view.getUint16(eocd + 10, true)
  const cdSize = view.getUint32(eocd + 12, true)
  const cdOffset = view.getUint32(eocd + 16, true)
  const eocdCommentLen = view.getUint16(eocd + 20, true)
  if (
    diskNum !== 0 ||
    cdDisk !== 0 ||
    diskCount !== count ||
    count === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff ||
    (eocd >= 20 && view.getUint32(eocd - 20, true) === ZIP_ZIP64_LOCATOR_SIG)
  ) {
    throw new Error('zip: unsupported multi-disk or ZIP64 archive')
  }
  if (
    cdOffset > eocd ||
    cdSize > eocd - cdOffset ||
    eocd + 22 + eocdCommentLen > bytes.byteLength
  ) {
    throw new Error('zip: corrupt central directory')
  }
  const cdEnd = cdOffset + cdSize
  const entries: ZipEntry[] = []
  let pos = cdOffset
  const decoder = new TextDecoder('utf-8')
  while (pos < cdEnd) {
    if (pos + 46 > cdEnd || view.getUint32(pos, true) !== ZIP_CENTRAL_SIG) {
      throw new Error('zip: corrupt central directory')
    }
    if ((view.getUint16(pos + 8, true) & ZIP_FLAG_ENCRYPTED) !== 0) {
      throw new Error('zip: encrypted entries are not supported')
    }
    const method = view.getUint16(pos + 10, true)
    const compressedSize = view.getUint32(pos + 20, true)
    const size = view.getUint32(pos + 24, true)
    const nameLen = view.getUint16(pos + 28, true)
    const extraLen = view.getUint16(pos + 30, true)
    const commentLen = view.getUint16(pos + 32, true)
    const diskStart = view.getUint16(pos + 34, true)
    const localOffset = view.getUint32(pos + 42, true)
    if (
      diskStart !== 0 ||
      compressedSize === 0xffffffff ||
      size === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      throw new Error('zip: unsupported multi-disk or ZIP64 entry')
    }
    const nameStart = pos + 46
    const extraStart = nameStart + nameLen
    const extraEnd = extraStart + extraLen
    const recordEnd = extraEnd + commentLen
    if (recordEnd > cdEnd) {
      throw new Error('zip: corrupt central directory')
    }
    let extraPos = extraStart
    while (extraPos < extraEnd) {
      if (extraPos + 4 > extraEnd) {
        throw new Error('zip: corrupt central directory extra field')
      }
      const headerId = view.getUint16(extraPos, true)
      const dataSize = view.getUint16(extraPos + 2, true)
      if (headerId === ZIP_EXTRA_ZIP64) {
        throw new Error('zip: ZIP64 extra field is not supported')
      }
      if (extraPos + 4 + dataSize > extraEnd) {
        throw new Error('zip: corrupt central directory extra field')
      }
      extraPos += 4 + dataSize
    }
    entries.push({
      name: decoder.decode(bytes.subarray(nameStart, nameStart + nameLen)).replace(/\\/g, '/'),
      method,
      compressedSize,
      size,
      localOffset,
    })
    pos = recordEnd
  }
  if (pos !== cdEnd || entries.length !== count) {
    throw new Error('zip: corrupt central directory')
  }
  return entries
}

/**
 * True when `name` is present, non-empty and its local header (the only bytes of
 * the part that are read) points at in-bounds stored or deflated data.
 */
function hasUsableZipPart(bytes: Uint8Array, entries: readonly ZipEntry[], name: string): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return entries.some((entry) => {
    if (entry.name !== name || entry.size === 0 || (entry.method !== 0 && entry.method !== 8)) {
      return false
    }
    if (entry.method === 0 && entry.compressedSize !== entry.size) {
      return false
    }
    if (
      entry.localOffset + 30 > bytes.byteLength ||
      view.getUint32(entry.localOffset, true) !== ZIP_LOCAL_SIG
    ) {
      return false
    }
    const dataStart =
      entry.localOffset +
      30 +
      view.getUint16(entry.localOffset + 26, true) +
      view.getUint16(entry.localOffset + 28, true)
    return dataStart <= bytes.byteLength && entry.compressedSize <= bytes.byteLength - dataStart
  })
}
/** Largest uncompressed part size allowed in an ODF ZIP package (64 MiB). */
export const MAX_ODF_PART_BYTES = 64 * 1024 * 1024

/**
 * Read and decompress one entry from an in-memory ZIP archive after checking its
 * declared uncompressed size against `MAX_ODF_PART_BYTES`.
 */
function readZipEntryBytes(bytes: Uint8Array, entry: ZipEntry): Uint8Array | null {
  if (entry.size > MAX_ODF_PART_BYTES || entry.compressedSize > MAX_ODF_PART_BYTES) return null
  if (entry.method !== 0 && entry.method !== 8) return null
  if (entry.method === 0 && entry.compressedSize !== entry.size) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (
    entry.localOffset + 30 > bytes.byteLength ||
    view.getUint32(entry.localOffset, true) !== ZIP_LOCAL_SIG
  ) {
    return null
  }
  if ((view.getUint16(entry.localOffset + 6, true) & ZIP_FLAG_ENCRYPTED) !== 0) {
    return null
  }
  if (view.getUint16(entry.localOffset + 8, true) !== entry.method) {
    return null
  }
  const dataStart =
    entry.localOffset +
    30 +
    view.getUint16(entry.localOffset + 26, true) +
    view.getUint16(entry.localOffset + 28, true)
  if (dataStart > bytes.byteLength || entry.compressedSize > bytes.byteLength - dataStart) {
    return null
  }
  const raw = bytes.subarray(dataStart, dataStart + entry.compressedSize)
  if (entry.method === 0) {
    return raw.byteLength === entry.size && raw.byteLength <= MAX_ODF_PART_BYTES ? raw : null
  }
  try {
    const inflated = new Uint8Array(inflateRawSync(raw, { maxOutputLength: MAX_ODF_PART_BYTES }))
    if (inflated.byteLength !== entry.size || inflated.byteLength > MAX_ODF_PART_BYTES) {
      return null
    }
    return inflated
  } catch {
    return null
  }
}

/**
 * Inspect a ZIP buffer to determine whether it is a valid OOXML package and which
 * format (`docx` | `xlsx` | `pptx`) it contains. Reads the central directory only.
 */
export function detectOoxmlKindFromZipBytes(bytes: Uint8Array): LegacyTargetFormat | null {
  if (!isZipSignature(bytes)) return null
  try {
    const entries = listZipEntries(bytes)
    if (!hasUsableZipPart(bytes, entries, '[Content_Types].xml')) return null
    for (const [kind, mainPart] of Object.entries(OOXML_REQUIRED_MAIN_PART) as Array<
      [LegacyTargetFormat, string]
    >) {
      if (hasUsableZipPart(bytes, entries, mainPart)) return kind
    }
    return null
  } catch {
    return null
  }
}

/**
 * Validate that a converted OOXML file is a ZIP whose central directory lists
 * `[Content_Types].xml` and the expected main part for `expectedKind`, each with
 * a sound local header. The parts themselves are not inflated.
 */
export function validateOoxmlOutputBytes(
  bytes: Uint8Array,
  expectedKind: LegacyTargetFormat,
  sourceFormat?: LegacySourceFormat,
): void {
  if (!isZipSignature(bytes)) {
    throw new LegacyConvertError('failed', `Converted output is not a valid ZIP archive`, {
      format: sourceFormat,
    })
  }
  const mainPart = OOXML_REQUIRED_MAIN_PART[expectedKind]
  try {
    const entries = listZipEntries(bytes)
    if (
      !hasUsableZipPart(bytes, entries, '[Content_Types].xml') ||
      !hasUsableZipPart(bytes, entries, mainPart)
    ) {
      throw new LegacyConvertError(
        'failed',
        `Converted ${expectedKind} is missing required OOXML parts (${mainPart})`,
        { format: sourceFormat },
      )
    }
  } catch (err) {
    if (err instanceof LegacyConvertError) throw err
    throw new LegacyConvertError(
      'failed',
      `Converted ${expectedKind} failed OOXML ZIP validation: ${err instanceof Error ? err.message : String(err)}`,
      { format: sourceFormat, cause: err },
    )
  }
}

export type LegacyPreflightResult =
  | { kind: 'legacy'; sourceFormat: LegacySourceFormat; targetFormat: LegacyTargetFormat }
  | {
      kind: 'ooxml_misnamed'
      sourceFormat: LegacySourceFormat
      detectedFormat: LegacyTargetFormat
    }

function checkDocStreams(streams: Map<string, Uint8Array>): void {
  const wordDoc = streams.get('WordDocument')
  if (!wordDoc || wordDoc.byteLength < 0x10) {
    throw new LegacyConvertError('corrupt', 'Missing or truncated WordDocument stream', {
      format: 'doc',
    })
  }
  const view = new DataView(wordDoc.buffer, wordDoc.byteOffset, wordDoc.byteLength)
  // FibBase.flags at offset 0x0A: bit 0x0100 is fEncrypted (covers both Binary RC4 and CryptoAPI)
  const flags = view.getUint16(0x0a, true)
  if ((flags & 0x0100) !== 0) {
    throw new LegacyConvertError('encrypted', 'Password-protected Word 97-2003 document (.doc)', {
      format: 'doc',
    })
  }
}

function checkXlsStreams(streams: Map<string, Uint8Array>): void {
  const workbook = streams.get('Workbook') ?? streams.get('Book')
  if (!workbook || workbook.byteLength < 8) {
    throw new LegacyConvertError('corrupt', 'Missing or truncated Workbook stream', {
      format: 'xls',
    })
  }
  const view = new DataView(workbook.buffer, workbook.byteOffset, workbook.byteLength)
  const firstType = view.getUint16(0, true)
  if (firstType !== XLS_BOF) {
    throw new LegacyConvertError('corrupt', 'Workbook stream does not start with a BOF record', {
      format: 'xls',
    })
  }
  let at = 0
  let count = 0
  while (at + 4 <= workbook.byteLength && count < MAX_BIFF_SCAN_RECORDS) {
    const type = view.getUint16(at, true)
    const length = view.getUint16(at + 2, true)
    if (at + 4 + length > workbook.byteLength) {
      throw new LegacyConvertError('corrupt', 'BIFF record runs past the Workbook stream', {
        format: 'xls',
      })
    }
    if (type === XLS_FILEPASS) {
      throw new LegacyConvertError(
        'encrypted',
        'Password-protected Excel 97-2003 workbook (.xls)',
        {
          format: 'xls',
        },
      )
    }
    at += 4 + length
    count++
    if (type === 0 && length === 0) break
  }
}

function checkPptStreams(streams: Map<string, Uint8Array>): void {
  const currentUser = streams.get('Current User')
  if (currentUser && currentUser.byteLength >= 16) {
    const view = new DataView(currentUser.buffer, currentUser.byteOffset, currentUser.byteLength)
    // MS-PPT §2.3.2: CurrentUserAtom hdrToken at offset 12 is 0xF3D1C4DF when encrypted
    const hdrToken = view.getUint32(12, true)
    if (hdrToken === PPT_ENCRYPTED_HDR_TOKEN) {
      throw new LegacyConvertError(
        'encrypted',
        'Password-protected PowerPoint 97-2003 presentation (.ppt)',
        { format: 'ppt' },
      )
    }
  }
  const pptDoc = streams.get('PowerPoint Document')
  if (!pptDoc || pptDoc.byteLength < 8) {
    throw new LegacyConvertError('corrupt', 'Missing or truncated PowerPoint Document stream', {
      format: 'ppt',
    })
  }
  // Walk top-level records in PowerPoint Document to also catch RT_CryptSession10Container (0x2F14)
  const docView = new DataView(pptDoc.buffer, pptDoc.byteOffset, pptDoc.byteLength)
  let at = 0
  let count = 0
  while (at + 8 <= pptDoc.byteLength && count < MAX_BIFF_SCAN_RECORDS) {
    const recVerInstance = docView.getUint16(at, true)
    const recVer = recVerInstance & 0x0f
    const recType = docView.getUint16(at + 2, true)
    const recLen = docView.getUint32(at + 4, true)
    if (recType === PPT_CRYPT_SESSION_RECORD) {
      throw new LegacyConvertError(
        'encrypted',
        'Password-protected PowerPoint 97-2003 presentation (.ppt)',
        { format: 'ppt' },
      )
    }
    if (at + 8 + recLen > pptDoc.byteLength) break
    // Container records (recVer === 0x0F) hold nested records; leaf records skip recLen
    at += recVer === 0x0f ? 8 : 8 + recLen
    count++
  }
}

/**
 * Pure TypeScript preflight check on OpenDocument (`.odt`/`.ott`/`.ods`/`.ots`/`.odp`/`.otp`)
 * bytes before spawning `soffice.bin`:
 * - Rejects empty or non-ZIP files as `corrupt`.
 * - Rejects any ZIP entry whose central directory declares an uncompressed size > 64 MiB as `corrupt`.
 * - Reads `META-INF/manifest.xml` (or `mimetype`) via the ZIP reader, detects
 *   `manifest:encryption-data` as `encrypted`, and requires `content.xml` or `styles.xml`.
 * - Detects OOXML files misnamed with an ODF extension as `ooxml_misnamed`.
 */
export function preflightOdfBytes(
  bytes: Uint8Array,
  sourceFormat: OdfSourceFormat,
): LegacyPreflightResult {
  if (bytes.byteLength === 0) {
    throw new LegacyConvertError('corrupt', 'File is empty (0 bytes)', { format: sourceFormat })
  }
  if (!isZipSignature(bytes)) {
    throw new LegacyConvertError('corrupt', `File is not a valid OpenDocument ZIP archive`, {
      format: sourceFormat,
    })
  }
  const detectedOoxml = detectOoxmlKindFromZipBytes(bytes)
  if (detectedOoxml) {
    return {
      kind: 'ooxml_misnamed',
      sourceFormat,
      detectedFormat: detectedOoxml,
    }
  }
  let entries: ZipEntry[]
  try {
    entries = listZipEntries(bytes)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/encrypted/i.test(msg)) {
      throw new LegacyConvertError(
        'encrypted',
        `Password-protected OpenDocument (.${sourceFormat})`,
        {
          format: sourceFormat,
          cause: err,
        },
      )
    }
    throw new LegacyConvertError('corrupt', `Invalid OpenDocument ZIP container: ${msg}`, {
      format: sourceFormat,
      cause: err,
    })
  }
  for (const entry of entries) {
    if (entry.method === 0 && entry.compressedSize !== entry.size) {
      throw new LegacyConvertError(
        'corrupt',
        `OpenDocument stored part "${entry.name}" has mismatched compressed and uncompressed sizes`,
        { format: sourceFormat },
      )
    }
    if (entry.size > MAX_ODF_PART_BYTES) {
      throw new LegacyConvertError(
        'corrupt',
        `OpenDocument part "${entry.name}" exceeds the ${MAX_ODF_PART_BYTES / (1024 * 1024)} MiB size limit`,
        { format: sourceFormat },
      )
    }
  }
  const manifestEntry = entries.find((e) => e.name === 'META-INF/manifest.xml')
  const mimetypeEntry = entries.find((e) => e.name === 'mimetype')
  if (!manifestEntry && !mimetypeEntry) {
    throw new LegacyConvertError(
      'corrupt',
      'OpenDocument archive is missing META-INF/manifest.xml and mimetype',
      { format: sourceFormat },
    )
  }
  if (manifestEntry) {
    const manifestBytes = readZipEntryBytes(bytes, manifestEntry)
    if (!manifestBytes) {
      throw new LegacyConvertError('corrupt', 'OpenDocument META-INF/manifest.xml is unreadable', {
        format: sourceFormat,
      })
    }
    const manifestXml = new TextDecoder('utf-8').decode(manifestBytes)
    if (/<\s*(?:[A-Za-z0-9_-]+:)?encryption-data\b/.test(manifestXml)) {
      throw new LegacyConvertError(
        'encrypted',
        `Password-protected OpenDocument (.${sourceFormat})`,
        { format: sourceFormat },
      )
    }
  }
  if (mimetypeEntry && mimetypeEntry.size > 0) {
    const mimetypeBytes = readZipEntryBytes(bytes, mimetypeEntry)
    if (!mimetypeBytes) {
      throw new LegacyConvertError('corrupt', 'OpenDocument mimetype entry is unreadable', {
        format: sourceFormat,
      })
    }
  }
  if (
    !hasUsableZipPart(bytes, entries, 'content.xml') &&
    !hasUsableZipPart(bytes, entries, 'styles.xml')
  ) {
    throw new LegacyConvertError(
      'corrupt',
      'OpenDocument archive is missing content.xml and styles.xml',
      { format: sourceFormat },
    )
  }
  return {
    kind: 'legacy',
    sourceFormat,
    targetFormat: LEGACY_TARGET_FOR_SOURCE[sourceFormat],
  }
}

/**
 * Pure TypeScript preflight check on legacy `.doc`/`.xls`/`.ppt` bytes before
 * spawning `soffice.bin`.
 *
 * - Detects ZIP/OOXML files misnamed with a `.doc`/`.xls`/`.ppt` extension so
 *   the caller can open them directly as OOXML without spawning LibreOffice.
 * - Validates CFB header, DIFAT/FAT/MiniFAT chains, and stream bounds (< 1 ms).
 * - Detects password-protected files (`EncryptedPackage`, `.doc` `Fib.fEncrypted`,
 *   `.xls` `FILEPASS` `0x002F`, `.ppt` `Current User` `hdrToken === 0xF3D1C4DF`)
 *   and throws `LegacyConvertError('encrypted')` without spawning LibreOffice.
 */
export function preflightLegacyBytes(
  bytes: Uint8Array,
  sourceFormat: LegacySourceFormat,
): LegacyPreflightResult {
  if (isOdfFormat(sourceFormat)) {
    return preflightOdfBytes(bytes, sourceFormat)
  }
  if (bytes.byteLength === 0) {
    throw new LegacyConvertError('corrupt', 'File is empty (0 bytes)', { format: sourceFormat })
  }
  if (isZipSignature(bytes)) {
    const detected = detectOoxmlKindFromZipBytes(bytes)
    if (detected) {
      return {
        kind: 'ooxml_misnamed',
        sourceFormat,
        detectedFormat: detected,
      }
    }
    throw new LegacyConvertError(
      'corrupt',
      'File has a ZIP header but is not a valid OOXML document',
      { format: sourceFormat },
    )
  }

  let streams: Map<string, Uint8Array>
  try {
    streams = readCfbStreams(bytes)
  } catch (err) {
    if (err instanceof LegacyConvertError) {
      throw new LegacyConvertError(err.code, err.message, {
        format: sourceFormat,
        detail: err.detail,
        cause: err,
      })
    }
    throw new LegacyConvertError(
      'corrupt',
      err instanceof Error ? err.message : 'Invalid Compound File Binary container',
      { format: sourceFormat, cause: err },
    )
  }

  // ECMA-376 Agile/Standard encrypted OOXML stored in a CFB container (misnamed as .doc/.xls/.ppt)
  if (streams.has('EncryptedPackage') || streams.has('EncryptionInfo')) {
    throw new LegacyConvertError('encrypted', 'Password-protected Office document', {
      format: sourceFormat,
    })
  }

  if (sourceFormat === 'doc') {
    checkDocStreams(streams)
  } else if (sourceFormat === 'xls') {
    checkXlsStreams(streams)
  } else if (sourceFormat === 'ppt') {
    checkPptStreams(streams)
  }

  return {
    kind: 'legacy',
    sourceFormat,
    targetFormat: LEGACY_TARGET_FOR_SOURCE[sourceFormat],
  }
}

export function preflightLegacyFile(
  filePath: string,
  explicitFormat?: LegacySourceFormat,
): LegacyPreflightResult {
  const sourceFormat = explicitFormat ?? legacyFormatForPath(filePath)
  if (!sourceFormat) {
    throw new LegacyConvertError('unsupported', `Unsupported legacy file extension: ${filePath}`)
  }
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(readFileSync(filePath))
  } catch (err) {
    throw new LegacyConvertError(
      'corrupt',
      `Could not read file: ${err instanceof Error ? err.message : String(err)}`,
      { format: sourceFormat, cause: err },
    )
  }
  return preflightLegacyBytes(bytes, sourceFormat)
}

// ---- Bundled LibreOffice location + template-profile resolution ----

export interface LibreOfficePaths {
  /** Root of the trimmed LibreOffice pack (`<resourcesPath>/libreoffice` or `GENOFFICE_LO_DIR`) */
  readonly rootDir: string
  /** Platform-specific executable (`program/soffice.bin`, `program/soffice.exe`, or `LibreOffice.app/Contents/MacOS/soffice`) */
  readonly sofficeBinary: string
  /** Pre-initialised template profile directory (`<rootDir>/template-profile`), or null if absent */
  readonly templateProfileDir: string | null
}

export interface ResolveLibreOfficeOptions {
  platform?: NodeJS.Platform
  arch?: string
  envDir?: string
  resourcesPath?: string
  isPackaged?: boolean
  devCacheRoot?: string
}

export function sofficeRelativePathForPlatform(
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'darwin') return join('LibreOffice.app', 'Contents', 'MacOS', 'soffice')
  if (platform === 'win32') return join('program', 'soffice.exe')
  return join('program', 'soffice.bin')
}

function probeLibreOfficeRoot(
  candidateRoot: string,
  platform: NodeJS.Platform,
): LibreOfficePaths | null {
  if (!candidateRoot || !existsSync(candidateRoot)) return null
  const rel = sofficeRelativePathForPlatform(platform)
  const directBin = join(candidateRoot, rel)
  let sofficeBinary: string | null = null
  if (existsSync(directBin)) {
    sofficeBinary = directBin
  } else if (platform === 'darwin') {
    // Allow pointing GENOFFICE_LO_DIR directly at LibreOffice.app or a parent with trimmed-LibreOffice.app
    const directAppBin = join(candidateRoot, 'Contents', 'MacOS', 'soffice')
    const trimmedAppBin = join(
      candidateRoot,
      'trimmed-LibreOffice.app',
      'Contents',
      'MacOS',
      'soffice',
    )
    if (existsSync(directAppBin)) sofficeBinary = directAppBin
    else if (existsSync(trimmedAppBin)) sofficeBinary = trimmedAppBin
  } else if (platform !== 'win32') {
    const fallbackScript = join(candidateRoot, 'program', 'soffice')
    if (existsSync(fallbackScript)) sofficeBinary = fallbackScript
  }
  if (!sofficeBinary) return null
  const templateDir = join(candidateRoot, 'template-profile')
  return {
    rootDir: candidateRoot,
    sofficeBinary,
    templateProfileDir: existsSync(templateDir) ? templateDir : null,
  }
}

/**
 * Resolve the bundled trimmed LibreOffice 26.8.2.2 directory and `soffice` binary:
 * 1. `opts.envDir` or `process.env.GENOFFICE_LO_DIR` (dev/test override).
 * 2. `<resourcesPath>/libreoffice` when packaged (or when present).
 * 3. Dev build cache fallback `apps/shell/build/.cache/libreoffice-26.8.2.2/<platform>-<arch>/libreoffice`
 *    when `envDir` is not explicitly set.
 */
export function resolveLibreOfficePaths(
  opts: ResolveLibreOfficeOptions = {},
): LibreOfficePaths | null {
  const platform = opts.platform ?? process.platform
  const arch = opts.arch ?? process.arch
  const hasExplicitEnv = 'envDir' in opts
  const envDir = hasExplicitEnv ? opts.envDir : process.env.GENOFFICE_LO_DIR

  if (typeof envDir === 'string') {
    const trimmed = envDir.trim()
    if (!trimmed) return null
    return probeLibreOfficeRoot(resolve(trimmed), platform)
  }

  const procResources =
    'resourcesPath' in process && typeof process.resourcesPath === 'string'
      ? process.resourcesPath
      : ''
  const resourcesPath = opts.resourcesPath ?? procResources
  if (resourcesPath) {
    const bundled = probeLibreOfficeRoot(join(resourcesPath, 'libreoffice'), platform)
    if (bundled) return bundled
  }

  if (!opts.isPackaged && opts.devCacheRoot) {
    const cached = probeLibreOfficeRoot(
      join(opts.devCacheRoot, `${platform}-${arch}`, 'libreoffice'),
      platform,
    )
    if (cached) return cached
  }

  return null
}

/**
 * Build a minimal isolated UserInstallation profile with MacroSecurityLevel=3
 * (Very High) and external link updates disabled when `template-profile/` is
 * absent in a custom `GENOFFICE_LO_DIR` tree.
 */
export async function ensureJobProfileDir(
  jobProfileDir: string,
  templateProfileDir: string | null,
  loRootDir?: string,
): Promise<void> {
  if (templateProfileDir && existsSync(templateProfileDir)) {
    await cp(templateProfileDir, jobProfileDir, { recursive: true })
    return
  }
  await mkdir(join(jobProfileDir, 'user'), { recursive: true })
  let buildId = '26.8.2.2'
  if (loRootDir) {
    for (const rel of [
      join('program', 'versionrc'),
      join('program', 'version.ini'),
      join('LibreOffice.app', 'Contents', 'Resources', 'versionrc'),
    ]) {
      const p = join(loRootDir, rel)
      if (existsSync(p)) {
        try {
          const text = await readFile(p, 'utf8')
          const m = /^buildid=(.+)$/m.exec(text)
          if (m?.[1]) buildId = m[1].trim()
        } catch {
          // ignore
        }
        break
      }
    }
  }
  const extRoot = join(jobProfileDir, 'user', 'extensions')
  await mkdir(extRoot, { recursive: true })
  const xcu = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>',
    '<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>',
    '<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="UseSystemFileDialog" oor:op="fuse"><value>false</value></prop></item>',
    '<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item>',
    '<item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>',
    '<item oor:path="/org.openoffice.Setup/L10N"><prop oor:name="ooLocale" oor:op="fuse"><value>en-US</value></prop></item>',
    `<item oor:path="/org.openoffice.Setup/Office"><prop oor:name="LastCompatibilityCheckID" oor:op="fuse"><value>${buildId}</value></prop></item>`,
    '<item oor:path="/org.openoffice.Setup/Office"><prop oor:name="OfficeRestartInProgress" oor:op="fuse"><value>false</value></prop></item>',
    '<item oor:path="/org.openoffice.Setup/Office"><prop oor:name="ooSetupInstCompleted" oor:op="fuse"><value>true</value></prop></item>',
    '</oor:items>',
    '',
  ].join('\n')
  await writeFile(join(jobProfileDir, 'user', 'registrymodifications.xcu'), xcu, 'utf8')
  await writeFile(join(extRoot, 'buildid'), buildId, 'utf8')
}

/**
 * Build the hardened environment for `soffice.bin`:
 * - Blocks all outbound network access via proxy env vars pointed at `http://127.0.0.1:0`.
 * - Disables crash reporting, recovery, OpenCL, and Java.
 * - Sets `LD_LIBRARY_PATH` on Linux to include `<loRoot>/program`.
 */
export function buildSofficeEnv(
  loPaths: LibreOfficePaths,
  baseEnv: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const progDir = dirname(loPaths.sofficeBinary)
  const ldExisting = baseEnv.LD_LIBRARY_PATH ? `:${baseEnv.LD_LIBRARY_PATH}` : ''
  return {
    ...baseEnv,
    SAL_USE_VCLPLUGIN: 'svp',
    SAL_DISABLE_OPENCL: '1',
    SAL_DISABLE_SYNCHRONOUS_PRINTER_DETECTION: '1',
    OOO_DISABLE_RECOVERY: '1',
    LIBO_FLATPAK: '1',
    http_proxy: 'http://127.0.0.1:0',
    https_proxy: 'http://127.0.0.1:0',
    HTTP_PROXY: 'http://127.0.0.1:0',
    HTTPS_PROXY: 'http://127.0.0.1:0',
    ftp_proxy: 'http://127.0.0.1:0',
    FTP_PROXY: 'http://127.0.0.1:0',
    all_proxy: 'http://127.0.0.1:0',
    ALL_PROXY: 'http://127.0.0.1:0',
    no_proxy: '',
    NO_PROXY: '',
    ...(platform === 'linux' ? { LD_LIBRARY_PATH: `${progDir}${ldExisting}` } : {}),
  }
}

export function buildSofficeArgs(opts: {
  profileDir: string
  sourceFormat: LegacySourceFormat
  targetFormat: LegacyTargetFormat
  outDir: string
  inputPath: string
}): string[] {
  const userInstallUrl = pathToFileURL(resolve(opts.profileDir)).href
  const infilter = LEGACY_INFILTER_FOR_SOURCE[opts.sourceFormat]
  return [
    `-env:UserInstallation=${userInstallUrl}`,
    '--headless',
    '--norestore',
    '--nologo',
    '--nodefault',
    '--nolockcheck',
    '--nofirststartwizard',
    `--infilter=${infilter}`,
    '--convert-to',
    opts.targetFormat,
    '--outdir',
    opts.outDir,
    opts.inputPath,
  ]
}

// ---- Subprocess spawn, timeout, cancellation & concurrency queue ----

export type SpawnSofficeFn = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; cwd: string },
) => ChildProcess

// On POSIX soffice leads its own process group so the whole group can be killed
// once it exits, timeouts or is cancelled (LibreOffice helpers outlive the parent).
const defaultSpawnSoffice: SpawnSofficeFn = (command, args, options) =>
  spawn(command, args, {
    env: options.env,
    cwd: options.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  })

export interface LegacyKillDeps extends KillProcessTreeDeps {
  /** POSIX: kill the whole process group led by `pid` (default `process.kill(-pid, 'SIGKILL')`). */
  killGroup?: (pid: number) => void
}

function killLegacyProcessTree(
  pid: number,
  rootAlreadyExited: boolean,
  deps: LegacyKillDeps = {},
): void {
  if ((deps.platform ?? process.platform) === 'win32') {
    killProcessTree(pid, rootAlreadyExited, deps)
    return
  }
  const killGroup = deps.killGroup ?? ((target) => process.kill(-target, 'SIGKILL'))
  try {
    killGroup(pid)
  } catch {
    // group already gone
  }
}

export interface ConvertLegacyOptions {
  /** Override input format (defaults to extension of `inputPath`). */
  sourceFormat?: LegacySourceFormat
  /** Per-job timeout in ms (default 60_000). */
  timeoutMs?: number
  /** AbortSignal for user cancellation. */
  signal?: AbortSignal
  /** Custom LibreOffice resolution options (or test injection). */
  loOptions?: ResolveLibreOfficeOptions
  /** Custom temp root directory (defaults to `os.tmpdir()`). */
  tempRoot?: string
  /** Optional process spawn override for unit tests. */
  spawnFn?: SpawnSofficeFn
  /** Optional process-tree killer deps for unit tests. */
  killTreeDeps?: LegacyKillDeps
}

export type ConvertLegacyResult =
  | {
      kind: 'converted'
      sourceFormat: LegacySourceFormat
      targetFormat: LegacyTargetFormat
      bytes: Uint8Array
      suggestedSaveAsPath: string
    }
  | {
      kind: 'ooxml_misnamed'
      sourceFormat: LegacySourceFormat
      targetFormat: LegacyTargetFormat
      bytes: Uint8Array
      suggestedSaveAsPath: string
    }

/** Promise.withResolvers is outside this target's lib (ES2022): the executor form is equivalent */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const activeSofficePids = new Set<number>()

/** Kill every in-flight `soffice.bin` process tree (test teardown; quit uses `disposeLegacyConverter`). */
export function killAllActiveLegacyConversions(deps?: LegacyKillDeps): void {
  for (const pid of [...activeSofficePids]) {
    activeSofficePids.delete(pid)
    killLegacyProcessTree(pid, false, deps)
  }
}

/**
 * Shut the converter down: queued jobs are rejected as cancelled, no new job is
 * accepted or spawned, then every in-flight `soffice` tree is killed. Call on quit.
 */
export function disposeLegacyConverter(deps?: LegacyKillDeps): void {
  defaultQueue.close()
  killAllActiveLegacyConversions(deps)
}

function cancelledError(format?: LegacySourceFormat): LegacyConvertError {
  return new LegacyConvertError('cancelled', 'Legacy conversion was cancelled', { format })
}

class ConcurrencyQueue {
  private active = 0
  private closed = false
  private readonly waiters: Array<{
    run: () => void
    reject: (err: unknown) => void
    signal?: AbortSignal
    onAbort?: () => void
  }> = []

  constructor(private readonly maxConcurrency: number) {}

  get isClosed(): boolean {
    return this.closed
  }

  /** Reject every waiter and refuse further jobs; running jobs are left to the caller to kill. */
  close(): void {
    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.onAbort && waiter.signal)
        waiter.signal.removeEventListener('abort', waiter.onAbort)
      waiter.reject(new LegacyConvertError('cancelled', 'Legacy conversion was cancelled'))
    }
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted || this.closed) {
      throw new LegacyConvertError('cancelled', 'Legacy conversion was cancelled')
    }
    if (this.active < this.maxConcurrency) {
      this.active++
      let released = false
      return () => {
        if (released) return
        released = true
        this.active--
        this.pump()
      }
    }
    const { promise, resolve: resolveAcquire, reject } = deferred<() => void>()
    const entry: (typeof this.waiters)[number] = {
      run: () => {
        if (entry.onAbort && signal) signal.removeEventListener('abort', entry.onAbort)
        let released = false
        resolveAcquire(() => {
          if (released) return
          released = true
          this.active--
          this.pump()
        })
      },
      reject,
      signal,
    }
    if (signal) {
      const onAbort = () => {
        const idx = this.waiters.indexOf(entry)
        if (idx !== -1) this.waiters.splice(idx, 1)
        reject(new LegacyConvertError('cancelled', 'Legacy conversion was cancelled'))
      }
      entry.onAbort = onAbort
      signal.addEventListener('abort', onAbort, { once: true })
    }
    this.waiters.push(entry)
    return promise
  }

  private pump(): void {
    while (this.active < this.maxConcurrency && this.waiters.length > 0) {
      const next = this.waiters.shift()!
      if (next.signal?.aborted) {
        next.reject(new LegacyConvertError('cancelled', 'Legacy conversion was cancelled'))
        continue
      }
      this.active++
      next.run()
    }
  }
}

const defaultQueue = new ConcurrencyQueue(DEFAULT_MAX_CONCURRENCY)

async function runSingleSofficeJob(opts: {
  loPaths: LibreOfficePaths
  /** The validated bytes of the source, converted from a private copy. */
  inputBytes: Uint8Array
  /** Base name of the source (kept so the output name and LibreOffice title match it). */
  inputName: string
  sourceFormat: LegacySourceFormat
  targetFormat: LegacyTargetFormat
  timeoutMs: number
  signal?: AbortSignal
  tempRoot: string
  spawnFn: SpawnSofficeFn
  killTreeDeps?: LegacyKillDeps
  allowExit81Retry: boolean
}): Promise<Uint8Array> {
  const {
    loPaths,
    inputBytes,
    inputName,
    sourceFormat,
    targetFormat,
    timeoutMs,
    signal,
    tempRoot,
    spawnFn,
    killTreeDeps,
    allowExit81Retry,
  } = opts

  if (signal?.aborted || defaultQueue.isClosed) throw cancelledError(sourceFormat)

  // Owner-only: mkdtemp creates the job dir 0700 under a 0700 parent, so the staged
  // input and the converted output are unreadable by other local users.
  const jobsRoot = join(tempRoot, 'genoffice-lo-jobs')
  await mkdir(jobsRoot, { recursive: true, mode: 0o700 })
  const jobDir = await mkdtemp(join(jobsRoot, 'job-'))

  try {
    const profileDir = join(jobDir, 'profile')
    const inDir = join(jobDir, 'in')
    const outDir = join(jobDir, 'out')
    await mkdir(inDir, { mode: 0o700 })
    await mkdir(outDir, { mode: 0o700 })
    const inputPath = join(inDir, inputName)
    await writeFile(inputPath, inputBytes, { mode: 0o600 })
    await ensureJobProfileDir(profileDir, loPaths.templateProfileDir, loPaths.rootDir)

    // One deadline for the whole job: the exit-81 retry only gets what is left.
    const deadline = Date.now() + timeoutMs

    const runOnce = (): Promise<{ code: number | null; stderr: string }> => {
      const {
        promise,
        resolve: resolveRun,
        reject: rejectRun,
      } = deferred<{ code: number | null; stderr: string }>()
      if (signal?.aborted || defaultQueue.isClosed) {
        rejectRun(cancelledError(sourceFormat))
        return promise
      }
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) {
        rejectRun(timeoutError())
        return promise
      }

      const args = buildSofficeArgs({
        profileDir,
        sourceFormat,
        targetFormat,
        outDir,
        inputPath,
      })
      const env = buildSofficeEnv(loPaths)

      let child: ChildProcess
      try {
        child = spawnFn(loPaths.sofficeBinary, args, { env, cwd: jobDir })
      } catch (err) {
        rejectRun(
          new LegacyConvertError(
            'failed',
            `Failed to spawn LibreOffice converter: ${err instanceof Error ? err.message : String(err)}`,
            { format: sourceFormat, cause: err },
          ),
        )
        return promise
      }

      const pid = child.pid
      if (typeof pid === 'number' && pid > 0) {
        activeSofficePids.add(pid)
      }

      let stderr = ''
      child.stderr?.on('data', (chunk: Buffer | string) => {
        if (stderr.length < 16_384) stderr += chunk.toString()
      })
      child.stdout?.on('data', (chunk: Buffer | string) => {
        if (stderr.length < 16_384) stderr += chunk.toString()
      })

      let settled = false
      let timedOut = false
      let cancelled = false

      const cleanupListeners = () => {
        clearTimeout(timer)
        if (signal && onAbort) signal.removeEventListener('abort', onAbort)
        if (typeof pid === 'number' && pid > 0) {
          activeSofficePids.delete(pid)
        }
      }

      const terminateChild = (rootAlreadyExited: boolean) => {
        if (typeof pid === 'number' && pid > 0) {
          killLegacyProcessTree(pid, rootAlreadyExited, killTreeDeps)
        } else {
          try {
            child.kill('SIGKILL')
          } catch {
            // ignore
          }
        }
      }

      const timer = setTimeout(() => {
        if (settled) return
        timedOut = true
        settled = true
        cleanupListeners()
        terminateChild(false)
        rejectRun(timeoutError())
      }, remainingMs)

      const onAbort = () => {
        if (settled) return
        cancelled = true
        settled = true
        cleanupListeners()
        terminateChild(false)
        rejectRun(cancelledError(sourceFormat))
      }

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true })
      }

      child.on('error', (err) => {
        if (settled) return
        settled = true
        cleanupListeners()
        terminateChild(false)
        rejectRun(
          new LegacyConvertError('failed', `LibreOffice converter process error: ${err.message}`, {
            format: sourceFormat,
            cause: err,
          }),
        )
      })

      child.on('exit', (code) => {
        if (settled || timedOut || cancelled) return
        settled = true
        cleanupListeners()
        terminateChild(true)
        resolveRun({ code, stderr: stderr.trim() })
      })
      return promise
    }

    const timeoutError = (): LegacyConvertError =>
      new LegacyConvertError(
        'timeout',
        `Legacy ${sourceFormat} conversion timed out after ${timeoutMs} ms`,
        { format: sourceFormat },
      )

    let outcome = await runOnce()
    // Exit 81 is LibreOffice's first-start profile registration restart signal when
    // a cold profile is used; re-running once against the now-initialised job profile succeeds.
    if (outcome.code === 81 && allowExit81Retry) {
      outcome = await runOnce()
    }

    const stem = basename(inputName, extname(inputName))
    const expectedOutPath = join(outDir, `${stem}.${targetFormat}`)
    let outStat: Stats | null
    try {
      outStat = await stat(expectedOutPath)
    } catch {
      outStat = null
    }
    if (!outStat) {
      const detail = outcome.stderr || `exit code ${outcome.code ?? 'unknown'}`
      // If soffice reported a load failure on the source file, surface as corrupt
      if (/source file could not be loaded|general input\/output error|corrupt/i.test(detail)) {
        throw new LegacyConvertError(
          'corrupt',
          `Legacy ${sourceFormat} file could not be loaded by LibreOffice`,
          { format: sourceFormat, detail },
        )
      }
      throw new LegacyConvertError(
        'failed',
        `LibreOffice did not produce ${targetFormat} output (${detail})`,
        { format: sourceFormat, detail },
      )
    }

    if (outStat.size <= 0) {
      throw new LegacyConvertError('failed', `LibreOffice produced an empty ${targetFormat} file`, {
        format: sourceFormat,
      })
    }

    const outBytes = new Uint8Array(await readFile(expectedOutPath))
    validateOoxmlOutputBytes(outBytes, targetFormat, sourceFormat)
    return outBytes
  } finally {
    try {
      await rm(jobDir, { recursive: true, force: true })
    } catch {
      // best-effort temp cleanup
    }
  }
}

/**
 * Read a legacy input into memory without blocking the main thread or a pipe:
 * open non-blocking, fstat the handle, refuse anything that is not a regular
 * file or exceeds the size cap, then read exactly that many bytes.
 */
async function readLegacyInput(path: string, format: LegacySourceFormat): Promise<Uint8Array> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0))
    const info = await handle.stat()
    if (!info.isFile()) {
      throw new LegacyConvertError('unsupported', 'Input is not a regular file', { format })
    }
    if (info.size > MAX_LEGACY_INPUT_BYTES) {
      throw new LegacyConvertError(
        'unsupported',
        `Input is larger than the ${MAX_LEGACY_INPUT_BYTES / (1024 * 1024)} MiB conversion limit`,
        { format },
      )
    }
    const buf = Buffer.allocUnsafeSlow(info.size)
    let total = 0
    while (total < buf.length) {
      const { bytesRead } = await handle.read(buf, total, buf.length - total, total)
      if (bytesRead === 0) break
      total += bytesRead
    }
    return new Uint8Array(buf.buffer, buf.byteOffset, total)
  } catch (err) {
    if (err instanceof LegacyConvertError) throw err
    throw new LegacyConvertError(
      'corrupt',
      `Could not read input file: ${err instanceof Error ? err.message : String(err)}`,
      { format, cause: err },
    )
  } finally {
    await handle?.close().catch(() => {})
  }
}

/**
 * Convert a local legacy `.doc`, `.xls`, or `.ppt` file to `.docx`, `.xlsx`, or `.pptx`.
 *
 * 1. Resolves the path once and reads the file off the main thread (regular files
 *    only, 200 MiB cap), then runs `preflightLegacyBytes` in TypeScript to reject
 *    corrupt CFB containers and password-protected files without spawning
 *    LibreOffice, and detects OOXML files misnamed with a legacy extension.
 * 2. Resolves the bundled LibreOffice 26.8.2.2 converter (`GENOFFICE_LO_DIR` or
 *    `<resourcesPath>/libreoffice`). Throws `converter_missing` if absent.
 * 3. Queues the job (max 2 concurrent `soffice.bin` processes), writes the inspected
 *    bytes into a private (0700) per-job dir and converts that copy, never the
 *    original, with the pre-initialised `template-profile`, explicit `--infilter`,
 *    network blocked, and one 60 s deadline (killing the process group on exit,
 *    timeout or cancel).
 * 4. Validates the output ZIP and required OOXML main part before returning bytes.
 */
export async function convertLegacyFile(
  inputPath: string,
  options: ConvertLegacyOptions = {},
): Promise<ConvertLegacyResult> {
  const sourceFormat = options.sourceFormat ?? legacyFormatForPath(inputPath)
  if (!sourceFormat) {
    throw new LegacyConvertError('unsupported', `Unsupported legacy file extension: ${inputPath}`)
  }

  if (options.signal?.aborted || defaultQueue.isClosed) throw cancelledError(sourceFormat)

  const resolvedPath = resolve(inputPath)
  const inputBytes = await readLegacyInput(resolvedPath, sourceFormat)

  const preflight = preflightLegacyBytes(inputBytes, sourceFormat)
  if (preflight.kind === 'ooxml_misnamed') {
    const suggestedSaveAsPath = resolvedPath.replace(/\.[^.]+$/, `.${preflight.detectedFormat}`)
    return {
      kind: 'ooxml_misnamed',
      sourceFormat,
      targetFormat: preflight.detectedFormat,
      bytes: inputBytes,
      suggestedSaveAsPath,
    }
  }

  const loPaths = resolveLibreOfficePaths(options.loOptions)
  if (!loPaths) {
    throw new LegacyConvertError(
      'converter_missing',
      'Bundled LibreOffice converter is not available',
      { format: sourceFormat },
    )
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const tempRoot = options.tempRoot ?? tmpdir()
  const spawnFn = options.spawnFn ?? defaultSpawnSoffice
  const targetFormat = preflight.targetFormat

  const release = await defaultQueue.acquire(options.signal)
  try {
    const bytes = await runSingleSofficeJob({
      loPaths,
      inputBytes,
      inputName: basename(resolvedPath),
      sourceFormat,
      targetFormat,
      timeoutMs,
      signal: options.signal,
      tempRoot,
      spawnFn,
      killTreeDeps: options.killTreeDeps,
      allowExit81Retry: true,
    })
    return {
      kind: 'converted',
      sourceFormat,
      targetFormat,
      bytes,
      suggestedSaveAsPath: suggestedOoxmlPathForLegacy(resolvedPath),
    }
  } finally {
    release()
  }
}
