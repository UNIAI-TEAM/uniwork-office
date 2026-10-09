import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import type { UniworkDocFormat } from '../../shared/home-api'

/**
 * The six document formats UniWork Office opens from UniWork, their upload
 * MIME types, and the file-name rules for working copies. A format comes from
 * the file name's extension (a list row carries only the title, which is the
 * upload file name) and, for the detail read, from the file's MIME type.
 */

const BY_EXTENSION: Record<string, UniworkDocFormat> = {
  docx: 'docx',
  xlsx: 'xlsx',
  pptx: 'pptx',
  pdf: 'pdf',
  md: 'md',
  markdown: 'md',
  html: 'html',
  htm: 'html',
}

const MIME: Record<UniworkDocFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  md: 'text/markdown',
  html: 'text/html',
}

const BY_MIME: Record<string, UniworkDocFormat> = Object.fromEntries(
  Object.entries(MIME).map(([format, mime]) => [mime, format as UniworkDocFormat]),
)

export function formatForName(name: string): UniworkDocFormat | null {
  const ext = extname(name.trim()).slice(1).toLowerCase()
  return BY_EXTENSION[ext] ?? null
}

export function formatForMime(mime: string): UniworkDocFormat | null {
  return BY_MIME[mime.split(';', 1)[0]?.trim().toLowerCase() ?? ''] ?? null
}

export function mimeForFormat(format: UniworkDocFormat): string {
  return MIME[format]
}

const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)$/i
const MAX_BASENAME = 120

/**
 * A server-supplied name made safe as one path segment on every platform: no
 * separators, control or reserved characters, no trailing dot/space, no
 * Windows device names, bounded length, and always the format's extension.
 */
export function sanitizeFilename(name: string, format: UniworkDocFormat): string {
  let base = name.trim()
  if (formatForName(base) === format) base = base.slice(0, base.length - extname(base).length)
  base = base
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .replace(/^[. ]+/g, '')
    .slice(0, MAX_BASENAME)
    .trim()
  if (!base || RESERVED_WINDOWS_NAMES.test(base)) base = base ? `_${base}` : 'document'
  return `${base}.${format}`
}

/** sha256 hex of the bytes: the form the server reports as checksum_sha256 */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** revisions are decimal strings that may exceed 2^53; never parsed as numbers */
export function isDecimalString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,30}$/.test(value)
}
