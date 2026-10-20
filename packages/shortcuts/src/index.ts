import type {
  ShortcutAction,
  ShortcutNote,
  ShortcutPlatform,
  ShortcutScope,
  UnmappedShortcut,
} from './types'
import { commonNotes, commonShortcuts, commonUnmapped } from './tables/common'
import { shellNotes, shellShortcuts, shellUnmapped } from './tables/shell'
import { docsNotes, docsShortcuts, docsUnmapped } from './tables/docs'
import { sheetsNotes, sheetsShortcuts, sheetsUnmapped } from './tables/sheets'
import { slidesNotes, slidesShortcuts, slidesUnmapped } from './tables/slides'
import { pdfNotes, pdfShortcuts, pdfUnmapped } from './tables/pdf'
import { htmlNotes, htmlShortcuts, htmlUnmapped } from './tables/html'
import { markdownNotes, markdownShortcuts, markdownUnmapped } from './tables/markdown'

export type {
  Chord,
  PlatformChords,
  ShortcutAction,
  ShortcutGuard,
  ShortcutMatch,
  ShortcutNote,
  ShortcutPlatform,
  ShortcutScope,
  ShortcutSurface,
  UnmappedShortcut,
} from './types'
export { chordToString, isValidChord, keyKind, parseChord, type ParsedChord } from './chord'
export {
  chordsFor,
  createMatcher,
  fromElectronInput,
  isComposingEvent,
  matchChord,
  matchShortcut,
  type ElectronInputLike,
  type ShortcutKeyEvent,
} from './match'
export {
  acceleratorSkipReason,
  chordToElectronAccelerator,
  toElectronAccelerator,
} from './accelerator'
export { formatChord, formatHint, hintParts, type ShortcutHintParts } from './hint'
export { BROWSER_RESERVED, isBrowserReserved } from './browser-reserved'
export { mergeRows } from './table'
export {
  commonShortcuts,
  docsShortcuts,
  htmlShortcuts,
  markdownShortcuts,
  pdfShortcuts,
  sheetsShortcuts,
  shellShortcuts,
  slidesShortcuts,
}

export {
  commonNotes,
  commonUnmapped,
  docsNotes,
  docsUnmapped,
  htmlNotes,
  htmlUnmapped,
  markdownNotes,
  markdownUnmapped,
  pdfNotes,
  pdfUnmapped,
  sheetsNotes,
  sheetsUnmapped,
  shellNotes,
  shellUnmapped,
  slidesNotes,
  slidesUnmapped,
}

export const SHORTCUT_TABLES: Readonly<Record<ShortcutScope, readonly ShortcutAction[]>> = {
  common: commonShortcuts,
  shell: shellShortcuts,
  docs: docsShortcuts,
  sheets: sheetsShortcuts,
  slides: slidesShortcuts,
  pdf: pdfShortcuts,
  html: htmlShortcuts,
  markdown: markdownShortcuts,
}

/** Keys each scope still lacks (per surface and platform): a module slice's
 * `manual` backlog. */
export const SHORTCUT_UNMAPPED: Readonly<Record<ShortcutScope, readonly UnmappedShortcut[]>> = {
  common: commonUnmapped,
  shell: shellUnmapped,
  docs: docsUnmapped,
  sheets: sheetsUnmapped,
  slides: slidesUnmapped,
  pdf: pdfUnmapped,
  html: htmlUnmapped,
  markdown: markdownUnmapped,
}

/** Remarks on mapped rows that are not missing keys. */
export const SHORTCUT_NOTES: Readonly<Record<ShortcutScope, readonly ShortcutNote[]>> = {
  common: commonNotes,
  shell: shellNotes,
  docs: docsNotes,
  sheets: sheetsNotes,
  slides: slidesNotes,
  pdf: pdfNotes,
  html: htmlNotes,
  markdown: markdownNotes,
}

/** The action with this CSV row id in a scope's table, or undefined. */
export function findShortcut(scope: ShortcutScope, id: string): ShortcutAction | undefined {
  return SHORTCUT_TABLES[scope].find((action) => action.id === id)
}

/** `win` for Windows and Linux, `mac` for macOS, from `process.platform` or
 * `navigator.platform` (the same detection `@genoffice/i18n` uses). */
export function currentShortcutPlatform(): ShortcutPlatform {
  const g = globalThis as {
    navigator?: { platform?: string }
    process?: { platform?: string }
  }
  if (g.navigator?.platform) return /mac/i.test(g.navigator.platform) ? 'mac' : 'win'
  return g.process?.platform === 'darwin' ? 'mac' : 'win'
}
