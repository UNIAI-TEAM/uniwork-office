import { extname } from 'node:path'
import type { UniworkDocFormat } from '../../shared/home-api'

/**
 * Cloud .doc / .xls / .ppt documents. The desktop app converts them to OOXML
 * locally and saves that OOXML as the NEXT version of the same document; the
 * wire contract (`versions/commit` with `conversion`) allows exactly these three
 * pairs. Pure: no I/O, so the open flow, the save queue and the client share one
 * table.
 */

export type LegacyFrom = 'doc' | 'xls' | 'ppt'
export type LegacyTo = 'docx' | 'xlsx' | 'pptx'

/** the `conversion` a version commit declares (the server checks it against the live version) */
export interface LegacyConversion {
  from: LegacyFrom
  to: LegacyTo
}

const TARGET: Readonly<Record<LegacyFrom, LegacyTo>> = { doc: 'docx', xls: 'xlsx', ppt: 'pptx' }

const MIME_TO_SOURCE: Readonly<Record<string, LegacyFrom>> = {
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
}

export function isLegacyFrom(value: unknown): value is LegacyFrom {
  return value === 'doc' || value === 'xls' || value === 'ppt'
}

/** the OOXML format a legacy format converts to */
export function legacyTarget(from: LegacyFrom): LegacyTo {
  return TARGET[from]
}

/** the editor format of a converted copy (the working copy is bound as this format) */
export function legacyTargetFormat(from: LegacyFrom): UniworkDocFormat {
  return TARGET[from]
}

export function conversionFor(from: LegacyFrom): LegacyConversion {
  return { from, to: TARGET[from] }
}

/** a binding / wire value that names a real pair (never a cross-family one) */
export function isLegacyConversion(value: unknown): value is LegacyConversion {
  if (!value || typeof value !== 'object') return false
  const { from, to } = value as Record<string, unknown>
  return isLegacyFrom(from) && TARGET[from] === to
}

export function legacyOfMime(mime: string): LegacyFrom | null {
  const key = mime.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return Object.hasOwn(MIME_TO_SOURCE, key) ? (MIME_TO_SOURCE[key] ?? null) : null
}

export function legacyOfName(name: string): LegacyFrom | null {
  const ext = extname(name.trim()).slice(1).toLowerCase()
  return isLegacyFrom(ext) ? ext : null
}

/**
 * The title the server gives the document after a conversion commit: only a
 * suffix equal (case-insensitively) to the legacy extension becomes the OOXML
 * one, in lowercase; any other title is unchanged (wire contract section 3).
 */
export function convertedTitle(title: string, from: LegacyFrom): string {
  const suffix = `.${from}`
  return title.toLowerCase().endsWith(suffix)
    ? `${title.slice(0, title.length - suffix.length)}.${TARGET[from]}`
    : title
}
