import { spawn, type ChildProcess } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { killProcessTree, type KillProcessTreeDeps } from './pdf-convert/convert-host'

export type LegacySourceFormat = 'doc' | 'xls' | 'ppt'
export type LegacyTargetFormat = 'docx' | 'xlsx' | 'pptx'

export type LegacyConvertErrorCode =
  | 'encrypted'
  | 'corrupt'
  | 'unsupported'
  | 'timeout'
  | 'converter_missing'
  | 'cancelled'
  | 'failed'

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
  xls: 'xlsx',
  ppt: 'pptx',
}

export const LEGACY_INFILTER_FOR_SOURCE: Readonly<Record<LegacySourceFormat, string>> = {
  doc: 'MS Word 97',
  xls: 'MS Excel 97',
  ppt: 'MS PowerPoint 97',
}

export const OOXML_REQUIRED_MAIN_PART: Readonly<Record<LegacyTargetFormat, string>> = {
  docx: 'word/document.xml',
  xlsx: 'xl/workbook.xml',
  pptx: 'ppt/presentation.xml',
}

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_CONCURRENCY = 2

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
  if (ext === 'doc' || ext === 'xls' || ext === 'ppt') return ext
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
  readonly name: string
  readonly type: number
  readonly start: number
  readonly size: number
}

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
  for (let at = 0; at + 128 <= directory.byteLength; at += 128) {
    const nameLen = dirView(directory, at).getUint16(64, true)
    if (nameLen < 2 || nameLen > 64) continue
    entries.push({
      name: new TextDecoder('utf-16le').decode(directory.subarray(at, at + nameLen - 2)),
      type: directory[at + 66] ?? 0,
      start: dirView(directory, at).getUint32(116, true),
      size: Number(dirView(directory, at).getBigUint64(120, true)),
    })
  }
  const root = entries.find((e) => e.type === 5)
  if (!root) throw new LegacyConvertError('corrupt', 'no root directory entry')

  const miniFat =
    firstMiniFat === ENDOFCHAIN || firstMiniFat === FREESECT
      ? new Uint8Array(0)
      : concatBytes(chain(firstMiniFat).map(sectorBytes))
  const miniStreamSectors =
    root.start === ENDOFCHAIN || root.start === FREESECT ? [] : chain(root.start)
  const miniStreamLen = Math.min(
    miniStreamSectors.length * sectorSize,
    root.size,
    bytes.byteLength,
  )
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
      out.set(entry.name, buf)
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
      out.set(entry.name, body.subarray(0, entry.size))
    }
  }
  return out
}

const ZIP_LOCAL_SIG = 0x04034b50
const ZIP_CENTRAL_SIG = 0x02014b50
const ZIP_EOCD_SIG = 0x06054b50
const ZIP_FLAG_ENCRYPTED = 1
const MAX_SELECTIVE_ZIP_PART_BYTES = 128 * 1024 * 1024

function isZipSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false
  for (let i = 0; i < ZIP_SIGNATURE.length; i++) {
    if (bytes[i] !== ZIP_SIGNATURE[i]) return false
  }
  return true
}

/**
 * Read named parts from an in-memory ZIP archive (central directory scan +
 * bounded `inflateRawSync` for method 8 or direct slice for method 0).
 */
export function readSelectiveZipParts(
  bytes: Uint8Array,
  wantedNames: readonly string[],
): Map<string, Uint8Array> {
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
  const count = view.getUint16(eocd + 10, true)
  const cdSize = view.getUint32(eocd + 12, true)
  const cdOffset = view.getUint32(eocd + 16, true)
  if (cdOffset > bytes.byteLength || cdSize > bytes.byteLength - cdOffset) {
    throw new Error('zip: corrupt central directory')
  }
  const wanted = new Set(wantedNames)
  const out = new Map<string, Uint8Array>()
  let pos = cdOffset
  const decoder = new TextDecoder('utf-8')
  for (let i = 0; i < count; i++) {
    if (pos + 46 > cdOffset + cdSize || view.getUint32(pos, true) !== ZIP_CENTRAL_SIG) {
      throw new Error('zip: corrupt central directory')
    }
    const flags = view.getUint16(pos + 8, true)
    if ((flags & ZIP_FLAG_ENCRYPTED) !== 0) {
      throw new Error('zip: encrypted entries are not supported')
    }
    const method = view.getUint16(pos + 10, true)
    const csize = view.getUint32(pos + 20, true)
    const usize = view.getUint32(pos + 24, true)
    const nameLen = view.getUint16(pos + 28, true)
    const extraLen = view.getUint16(pos + 30, true)
    const commentLen = view.getUint16(pos + 32, true)
    const localOffset = view.getUint32(pos + 42, true)
    const nameStart = pos + 46
    if (nameStart + nameLen > cdOffset + cdSize) {
      throw new Error('zip: corrupt central directory')
    }
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLen)).replace(/\\/g, '/')
    pos = nameStart + nameLen + extraLen + commentLen
    if (!wanted.has(name)) continue
    if (usize > MAX_SELECTIVE_ZIP_PART_BYTES) {
      throw new Error(`zip: part ${name} exceeds size limit`)
    }
    if (localOffset + 30 > bytes.byteLength || view.getUint32(localOffset, true) !== ZIP_LOCAL_SIG) {
      throw new Error(`zip: corrupt local header for ${name}`)
    }
    const localNameLen = view.getUint16(localOffset + 26, true)
    const localExtraLen = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    if (dataStart > bytes.byteLength || csize > bytes.byteLength - dataStart) {
      throw new Error(`zip: entry ${name} data out of bounds`)
    }
    const raw = bytes.subarray(dataStart, dataStart + csize)
    if (method === 0) {
      out.set(name, raw)
    } else if (method === 8) {
      const inflated = inflateRawSync(raw, { maxOutputLength: MAX_SELECTIVE_ZIP_PART_BYTES })
      out.set(name, new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength))
    } else {
      throw new Error(`zip: unsupported compression method ${method} for ${name}`)
    }
  }
  return out
}

/**
 * Inspect a ZIP buffer to determine whether it is a valid OOXML package and which
 * format (`docx` | `xlsx` | `pptx`) it contains.
 */
export function detectOoxmlKindFromZipBytes(bytes: Uint8Array): LegacyTargetFormat | null {
  if (!isZipSignature(bytes)) return null
  try {
    const parts = readSelectiveZipParts(bytes, [
      '[Content_Types].xml',
      OOXML_REQUIRED_MAIN_PART.docx,
      OOXML_REQUIRED_MAIN_PART.xlsx,
      OOXML_REQUIRED_MAIN_PART.pptx,
    ])
    const ct = parts.get('[Content_Types].xml')
    if (!ct || ct.byteLength === 0) return null
    for (const [kind, mainPart] of Object.entries(OOXML_REQUIRED_MAIN_PART) as Array<
      [LegacyTargetFormat, string]
    >) {
      const partBytes = parts.get(mainPart)
      if (partBytes && partBytes.byteLength > 0) return kind
    }
    return null
  } catch {
    return null
  }
}

/**
 * Validate that a converted OOXML file exists on disk and is a valid ZIP
 * containing `[Content_Types].xml` and the expected main part for `expectedKind`.
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
    const parts = readSelectiveZipParts(bytes, ['[Content_Types].xml', mainPart])
    const ct = parts.get('[Content_Types].xml')
    const main = parts.get(mainPart)
    if (!ct || ct.byteLength === 0 || !main || main.byteLength === 0) {
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
      throw new LegacyConvertError('encrypted', 'Password-protected Excel 97-2003 workbook (.xls)', {
        format: 'xls',
      })
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
export function ensureJobProfileDir(
  jobProfileDir: string,
  templateProfileDir: string | null,
  loRootDir?: string,
): void {
  if (templateProfileDir && existsSync(templateProfileDir)) {
    cpSync(templateProfileDir, jobProfileDir, { recursive: true })
    return
  }
  mkdirSync(join(jobProfileDir, 'user'), { recursive: true })
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
          const text = readFileSync(p, 'utf8')
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
  mkdirSync(extRoot, { recursive: true })
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
  mkdirSync(join(jobProfileDir, 'user'), { recursive: true })
  rmSync(join(jobProfileDir, 'user', 'registrymodifications.xcu'), { force: true })
  // writeFileSync imported at top
  writeFileSync(join(jobProfileDir, 'user', 'registrymodifications.xcu'), xcu, 'utf8')
  writeFileSync(join(extRoot, 'buildid'), buildId, 'utf8')
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

const defaultSpawnSoffice: SpawnSofficeFn = (command, args, options) =>
  spawn(command, args, {
    env: options.env,
    cwd: options.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

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
  killTreeDeps?: KillProcessTreeDeps
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

const activeSofficePids = new Set<number>()

/** Kill every in-flight `soffice.bin` process tree (called on `before-quit` and test teardown). */
export function killAllActiveLegacyConversions(deps?: KillProcessTreeDeps): void {
  for (const pid of [...activeSofficePids]) {
    activeSofficePids.delete(pid)
    killProcessTree(pid, false, deps)
  }
}

class ConcurrencyQueue {
  private active = 0
  private readonly waiters: Array<{
    run: () => void
    reject: (err: unknown) => void
    signal?: AbortSignal
    onAbort?: () => void
  }> = []

  constructor(private readonly maxConcurrency: number) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
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
    const { promise, resolve: resolveAcquire, reject } = Promise.withResolvers<() => void>()
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
  inputPath: string
  sourceFormat: LegacySourceFormat
  targetFormat: LegacyTargetFormat
  timeoutMs: number
  signal?: AbortSignal
  tempRoot: string
  spawnFn: SpawnSofficeFn
  killTreeDeps?: KillProcessTreeDeps
  allowExit81Retry: boolean
}): Promise<Uint8Array> {
  const {
    loPaths,
    inputPath,
    sourceFormat,
    targetFormat,
    timeoutMs,
    signal,
    tempRoot,
    spawnFn,
    killTreeDeps,
    allowExit81Retry,
  } = opts

  if (signal?.aborted) {
    throw new LegacyConvertError('cancelled', 'Legacy conversion was cancelled', {
      format: sourceFormat,
    })
  }

  const jobDir = join(tempRoot, 'genoffice-lo-jobs', randomUUID())
  const profileDir = join(jobDir, 'profile')
  const outDir = join(jobDir, 'out')
  mkdirSync(outDir, { recursive: true })

  try {
    ensureJobProfileDir(profileDir, loPaths.templateProfileDir, loPaths.rootDir)

    const runOnce = (): Promise<{ code: number | null; stderr: string }> => {
      const {
        promise,
        resolve: resolveRun,
        reject: rejectRun,
      } = Promise.withResolvers<{ code: number | null; stderr: string }>()
      if (signal?.aborted) {
        rejectRun(
          new LegacyConvertError('cancelled', 'Legacy conversion was cancelled', {
            format: sourceFormat,
          }),
        )
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
          killProcessTree(pid, rootAlreadyExited, killTreeDeps)
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
        rejectRun(
          new LegacyConvertError(
            'timeout',
            `Legacy ${sourceFormat} conversion timed out after ${timeoutMs} ms`,
            { format: sourceFormat },
          ),
        )
      }, timeoutMs)

      const onAbort = () => {
        if (settled) return
        cancelled = true
        settled = true
        cleanupListeners()
        terminateChild(false)
        rejectRun(
          new LegacyConvertError('cancelled', 'Legacy conversion was cancelled', {
            format: sourceFormat,
          }),
        )
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
          new LegacyConvertError(
            'failed',
            `LibreOffice converter process error: ${err.message}`,
            { format: sourceFormat, cause: err },
          ),
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

    let outcome = await runOnce()
    // Exit 81 is LibreOffice's first-start profile registration restart signal when
    // a cold profile is used; re-running once against the now-initialised job profile succeeds.
    if (outcome.code === 81 && allowExit81Retry) {
      outcome = await runOnce()
    }

    const stem = basename(inputPath, extname(inputPath))
    const expectedOutPath = join(outDir, `${stem}.${targetFormat}`)
    if (!existsSync(expectedOutPath)) {
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

    const stat = statSync(expectedOutPath)
    if (stat.size <= 0) {
      throw new LegacyConvertError('failed', `LibreOffice produced an empty ${targetFormat} file`, {
        format: sourceFormat,
      })
    }

    const outBytes = new Uint8Array(readFileSync(expectedOutPath))
    validateOoxmlOutputBytes(outBytes, targetFormat, sourceFormat)
    return outBytes
  } finally {
    try {
      rmSync(jobDir, { recursive: true, force: true })
    } catch {
      // best-effort temp cleanup
    }
  }
}

/**
 * Convert a local legacy `.doc`, `.xls`, or `.ppt` file to `.docx`, `.xlsx`, or `.pptx`.
 *
 * 1. Runs `preflightLegacyBytes` in TypeScript (< 1 ms) to reject corrupt CFB containers
 *    and password-protected files without spawning LibreOffice, and detects OOXML files
 *    misnamed with a legacy extension.
 * 2. Resolves the bundled LibreOffice 26.8.2.2 converter (`GENOFFICE_LO_DIR` or
 *    `<resourcesPath>/libreoffice`). Throws `converter_missing` if absent.
 * 3. Queues the job (max 2 concurrent `soffice.bin` processes), copies the pre-initialised
 *    `template-profile` into a per-job temp dir, runs `soffice` with explicit `--infilter`,
 *    network blocked, and a 60 s timeout (killing the process tree on timeout/cancel/exit).
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

  if (options.signal?.aborted) {
    throw new LegacyConvertError('cancelled', 'Legacy conversion was cancelled', {
      format: sourceFormat,
    })
  }

  let inputBytes: Uint8Array
  try {
    inputBytes = new Uint8Array(readFileSync(inputPath))
  } catch (err) {
    throw new LegacyConvertError(
      'corrupt',
      `Could not read input file: ${err instanceof Error ? err.message : String(err)}`,
      { format: sourceFormat, cause: err },
    )
  }

  const preflight = preflightLegacyBytes(inputBytes, sourceFormat)
  if (preflight.kind === 'ooxml_misnamed') {
    const suggestedSaveAsPath = inputPath.replace(/\.[^.]+$/, `.${preflight.detectedFormat}`)
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
      inputPath,
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
      suggestedSaveAsPath: suggestedOoxmlPathForLegacy(inputPath),
    }
  } finally {
    release()
  }
}
