import { readCfbStreams } from '../legacy-converter'
import type { LegacyFrom, LegacyTo } from './legacy-cloud'

/**
 * Reading what a downloaded cloud file really is. The live version's metadata says what the
 * document IS today, but a version opened from history can be an older legacy file under a
 * document whose head is already OOXML, so the bytes get the last word on whether the
 * converter is needed.
 */

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

/** the bytes start with the compound-file signature every .doc/.xls/.ppt (and encrypted OOXML) has */
export function isCfbBytes(bytes: Uint8Array): boolean {
  return bytes.byteLength >= CFB_SIGNATURE.length && CFB_SIGNATURE.every((b, i) => bytes[i] === b)
}

/**
 * Which legacy format a compound file is, from its root streams (WordDocument, Workbook / Book,
 * PowerPoint Document). Null when it is none of them or cannot be read; the converter's own
 * preflight then reports it as corrupt.
 */
export function legacyOfCfbBytes(bytes: Uint8Array): LegacyFrom | null {
  try {
    const streams = readCfbStreams(bytes)
    if (streams.has('WordDocument')) return 'doc'
    if (streams.has('Workbook') || streams.has('Book')) return 'xls'
    if (streams.has('PowerPoint Document')) return 'ppt'
  } catch {
    // an unreadable container is left for the converter's preflight to name
  }
  return null
}

/** what the app's converter answers for one downloaded legacy file */
export type CloudConvertOutcome =
  { ok: true; bytes: Uint8Array; to: LegacyTo } | { ok: false; reason: 'cancelled' | 'failed' }

export interface CloudLegacyConvertInput {
  bytes: Uint8Array
  from: LegacyFrom
  /** the name the progress box and the typed notices show */
  name: string
}
