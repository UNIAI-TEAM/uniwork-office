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
// U+FFFD marks bytes some earlier hop failed to decode as UTF-8; it is never a
// real character of a name, so it is replaced like the reserved characters.
// C0 controls and DEL, then the characters Windows reserves in a file name.
// Built from the code points so the class carries no literal control escapes.
const UNSAFE_FILENAME_CHAR = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}\uFFFD<>:"/\\\\|?*]`,
  'g',
)
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
    .replace(UNSAFE_FILENAME_CHAR, '_')
    .replace(/[. ]+$/g, '')
    .replace(/^[. ]+/g, '')
    .slice(0, MAX_BASENAME)
    .trim()
  if (!base || RESERVED_WINDOWS_NAMES.test(base)) base = base ? `_${base}` : 'document'
  return `${base}.${format}`
}

/** the text carries U+FFFD: it was decoded from bytes that were not UTF-8 */
export function hasReplacementChar(text: string): boolean {
  return text.includes('\uFFFD')
}

/**
 * The working-copy file name, which is also the tab title (the tab shows the
 * path's basename). The document title is the name UniWork shows everywhere
 * (web list, picker, recents) and the only one that can be renamed;
 * file.filename is the name of the first upload and never changes. So the
 * title names the copy, and the stored upload name is the fallback when the
 * title is empty or was corrupted on the way in.
 */
export function workingCopyName(
  title: string,
  uploadName: string,
  format: UniworkDocFormat,
): string {
  const usable = (name: string) => name.trim() !== '' && !hasReplacementChar(name)
  const source = [title, uploadName].find(usable) ?? (title.trim() || uploadName)
  return sanitizeFilename(source, format)
}

/** sha256 hex of the bytes: the form the server reports as checksum_sha256 */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** revisions are decimal strings that may exceed 2^53; never parsed as numbers */
export function isDecimalString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,30}$/.test(value)
}
