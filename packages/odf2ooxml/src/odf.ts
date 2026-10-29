/**
 * ODF package loading: the zip container, its two XML parts, and the body
 * lookup both converters share. A file is accepted by the shape of its
 * `office:body` (the mimetype entry lies too often to be trusted), and any
 * structural surprise — missing part, malformed XML, an entry too large to
 * inflate — returns null so the caller reports an unreadable file instead of
 * converting half of one.
 */

import JSZip from 'jszip'
import type { JSZipObject } from 'jszip'
import { XNode, firstChild, nodeChildren, nodeName, parseOdfXml } from './xml'

/** why a conversion gave up; the app maps every code to a message */
export class OdfConvertError extends Error {
  constructor(public readonly code: 'unreadable' | 'not-a-text-document' | 'not-a-presentation') {
    super(code)
    this.name = 'OdfConvertError'
  }
}

/**
 * The largest a single zip entry may inflate to. 64 MiB is the bound the rest
 * of the repo puts on decompression; a part past it is refused on the size the
 * archive declares, so a bomb costs a lookup rather than the heap.
 */
export const MAX_ODF_PART_BYTES = 64 * 1024 * 1024

/**
 * Total uncompressed bytes a single ODF conversion may inflate across
 * `content.xml`, `styles.xml`, and every referenced media read combined.
 */
export const MAX_ODF_TOTAL_BYTES = 64 * 1024 * 1024

/**
 * Maximum central-directory entries allowed in an ODF archive, matching
 * `DEFAULT_ZIP_LIMITS.maxParts` (10,000) in `@genoffice/zip-gate`. Checked
 * from the ZIP End-of-Central-Directory record before JSZip materializes per-entry
 * objects so a 30,000-entry archive is refused in O(1) before loading.
 */
export const MAX_ODF_ENTRIES = 10_000

const EOCD_SIG = 0x06054b50
const ZIP64_LOCATOR_SIG = 0x07064b50
const ZIP64_EOCD_SIG = 0x06064b50

/**
 * Check the archive's EOCD entry count before JSZip parses the central
 * directory. Returns false when no valid EOCD is found or when the declared
 * entry count exceeds `MAX_ODF_ENTRIES`.
 */
function hasValidEntryCount(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 22) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const stop = Math.max(0, bytes.byteLength - 22 - 0xffff)
  let eocd = -1
  for (let index = bytes.byteLength - 22; index >= stop; index--) {
    if (view.getUint32(index, true) === EOCD_SIG) {
      eocd = index
      break
    }
  }
  if (eocd < 0) return false
  let count = view.getUint16(eocd + 10, true)
  const cdSize = view.getUint32(eocd + 12, true)
  const cdOffset = view.getUint32(eocd + 16, true)
  const overflowed =
    view.getUint16(eocd + 4, true) === 0xffff ||
    view.getUint16(eocd + 6, true) === 0xffff ||
    view.getUint16(eocd + 8, true) === 0xffff ||
    count === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff
  if (overflowed) {
    if (eocd < 20 || view.getUint32(eocd - 20, true) !== ZIP64_LOCATOR_SIG) return false
    const eocd64Offset = Number(view.getBigUint64(eocd - 12, true))
    if (
      !Number.isSafeInteger(eocd64Offset) ||
      eocd64Offset < 0 ||
      eocd64Offset + 56 > bytes.byteLength ||
      view.getUint32(eocd64Offset, true) !== ZIP64_EOCD_SIG
    ) {
      return false
    }
    count = Number(view.getBigUint64(eocd64Offset + 32, true))
  }
  return Number.isSafeInteger(count) && count >= 0 && count <= MAX_ODF_ENTRIES
}

interface InflationBudget {
  inflatedBytes: number
}

/** JSZip keeps the central-directory size on the entry's lazy compressed data */
interface JSZipEntryInternal extends JSZipObject {
  _data?: { uncompressedSize?: number }
  internalStream(type: 'uint8array'): ChunkStream
}

function declaredSize(entry: JSZipObject): number {
  const internal: JSZipEntryInternal = entry as JSZipEntryInternal
  return internal._data?.uncompressedSize ?? 0
}

function exceedsCap(entry: JSZipObject, budget: InflationBudget): boolean {
  const size = declaredSize(entry)
  return size > MAX_ODF_PART_BYTES || budget.inflatedBytes + size > MAX_ODF_TOTAL_BYTES
}

/**
 * Inflate an entry while counting what actually comes out: a local header can
 * declare less than the stream yields, so the declared-size gate alone would
 * let a mislabelled part through.
 */
interface ChunkStream {
  on(event: 'data', fn: (chunk: Uint8Array) => void): ChunkStream
  on(event: 'error', fn: (err: Error) => void): ChunkStream
  on(event: 'end', fn: () => void): ChunkStream
  pause(): ChunkStream
  resume(): ChunkStream
}

function inflateCapped(entry: JSZipObject, budget: InflationBudget): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let total = 0
    // JSZip's typings stop at async(); internalStream is the public chunked API
    const internal: JSZipEntryInternal = entry as JSZipEntryInternal
    const stream = internal.internalStream('uint8array')
    stream.on('data', (chunk) => {
      total += chunk.length
      budget.inflatedBytes += chunk.length
      if (total > MAX_ODF_PART_BYTES || budget.inflatedBytes > MAX_ODF_TOTAL_BYTES) {
        stream.pause()
        reject(new OdfConvertError('unreadable'))
        return
      }
      chunks.push(chunk)
    })
    stream.on('error', (err) => reject(err))
    stream.on('end', () => {
      const out = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        out.set(chunk, offset)
        offset += chunk.length
      }
      resolve(out)
    })
    stream.resume()
  })
}

async function inflateText(entry: JSZipObject, budget: InflationBudget): Promise<string | null> {
  if (exceedsCap(entry, budget)) return null
  try {
    return new TextDecoder().decode(await inflateCapped(entry, budget))
  } catch {
    return null
  }
}

export interface OdfPackage {
  contentRoots: XNode[]
  stylesRoots: XNode[] | null
  /** read one zip entry by its path as spelled in xlink:href */
  read: (path: string) => Promise<Uint8Array | null>
}

export async function loadOdfPackage(bytes: Uint8Array): Promise<OdfPackage | null> {
  if (!hasValidEntryCount(bytes)) return null
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    return null
  }
  if (Object.keys(zip.files).length > MAX_ODF_ENTRIES) return null
  const budget: InflationBudget = { inflatedBytes: 0 }
  const contentEntry = zip.file('content.xml')
  if (!contentEntry) return null
  const content = await inflateText(contentEntry, budget)
  if (!content) return null
  const contentRoots = parseOdfXml(content)
  if (!contentRoots) return null
  const stylesEntry = zip.file('styles.xml')
  let stylesXml: string | null = null
  if (stylesEntry) {
    stylesXml = await inflateText(stylesEntry, budget)
    if (stylesXml === null) return null
  }
  const stylesRoots = stylesXml ? parseOdfXml(stylesXml) : null
  return {
    contentRoots,
    stylesRoots,
    read: async (path: string) => {
      const clean = path.replace(/^\.\//, '')
      const entry = zip.file(clean) ?? zip.file(decodeURIComponent(clean))
      if (!entry) return null
      if (exceedsCap(entry, budget)) {
        // Unlike a missing entry, which only costs the caller this one image, a
        // part this large is a file the app cannot convert: say so instead of
        // inflating it or silently handing back a document with holes in it.
        throw new OdfConvertError('unreadable')
      }
      try {
        return await inflateCapped(entry, budget)
      } catch (err) {
        if (err instanceof OdfConvertError) throw err
        return null
      }
    },
  }
}

/** the office:text / office:presentation element under office:body, or null */
export function odfBody(
  pack: OdfPackage,
  kind: 'office:text' | 'office:presentation',
): XNode | null {
  for (const root of pack.contentRoots) {
    const body = firstChild(root, 'office:body')
    if (!body) continue
    const element = firstChild(body, kind)
    if (element) return element
  }
  return null
}

/** the office:automatic-styles element of a document part (content.xml or styles.xml) */
export function automaticStyles(pack: OdfPackage): XNode[] {
  const out: XNode[] = []
  for (const root of [...pack.contentRoots, ...(pack.stylesRoots ?? [])]) {
    const node = firstChild(root, 'office:automatic-styles')
    if (node) out.push(node)
  }
  return out
}

/** element children only, with their names — the body walkers' main iteration */
export function childElements(node: XNode): Array<{ name: string; node: XNode }> {
  const out: Array<{ name: string; node: XNode }> = []
  for (const child of nodeChildren(node)) {
    const name = nodeName(child)
    if (name && name !== '#comment') out.push({ name, node: child })
  }
  return out
}
