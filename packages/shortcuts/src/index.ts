import type {
  ShortcutAction,
  ShortcutNote,
  ShortcutPlatform,
  ShortcutScope,
  UnmappedShortcut,
} from './types'
import {
  commonManualNotes,
  commonManualUnmapped,
  commonNotes,
  commonShortcuts,
  commonUnmapped,
} from './tables/common'
import {
  shellManualNotes,
  shellManualUnmapped,
  shellNotes,
  shellShortcuts,
  shellUnmapped,
} from './tables/shell'
import {
  docsManualNotes,
  docsManualUnmapped,
  docsNotes,
  docsShortcuts,
  docsUnmapped,
} from './tables/docs'
import {
  sheetsManualNotes,
  sheetsManualUnmapped,
  sheetsNotes,
  sheetsShortcuts,
  sheetsUnmapped,
} from './tables/sheets'
import {
  slidesManualNotes,
  slidesManualUnmapped,
  slidesNotes,
  slidesShortcuts,
  slidesUnmapped,
} from './tables/slides'
import {
  pdfManualNotes,
  pdfManualUnmapped,
  pdfNotes,
  pdfShortcuts,
  pdfUnmapped,
} from './tables/pdf'
import {
  htmlManualNotes,
  htmlManualUnmapped,
  htmlNotes,
  htmlShortcuts,
  htmlUnmapped,
} from './tables/html'
import {
  markdownManualNotes,
  markdownManualUnmapped,
  markdownNotes,
  markdownShortcuts,
  markdownUnmapped,
} from './tables/markdown'

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
export {
  accessibleShortcutProblems,
  ariaKeyshortcuts,
  containsDisplayChord,
  findDisplayChord,
  formatAriaChord,
  formatAriaChords,
  keyHintAfterName,
  type AccessibleShortcutControl,
} from './aria'
export { BROWSER_RESERVED, isBrowserReserved } from './browser-reserved'
import { mergeNotes, mergeUnmapped } from './table'
export { mergeNotes, mergeRows, mergeUnmapped, pruneUnmapped } from './table'
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

/** Keys each scope still lacks (per surface and platform): the generator's
 * list (a module slice's `manual` backlog) without the parts a manual row has
 * since given a chord, with the module's own entries for its manual rows
 * (`<module>ManualUnmapped`) substituted for the generated entry of the same id
 * and part (see `mergeUnmapped`). */
export const SHORTCUT_UNMAPPED: Readonly<Record<ShortcutScope, readonly UnmappedShortcut[]>> = {
  common: mergeUnmapped(commonUnmapped, commonShortcuts, commonManualUnmapped),
  shell: mergeUnmapped(shellUnmapped, shellShortcuts, shellManualUnmapped),
  docs: mergeUnmapped(docsUnmapped, docsShortcuts, docsManualUnmapped),
  sheets: mergeUnmapped(sheetsUnmapped, sheetsShortcuts, sheetsManualUnmapped),
  slides: mergeUnmapped(slidesUnmapped, slidesShortcuts, slidesManualUnmapped),
  pdf: mergeUnmapped(pdfUnmapped, pdfShortcuts, pdfManualUnmapped),
  html: mergeUnmapped(htmlUnmapped, htmlShortcuts, htmlManualUnmapped),
  markdown: mergeUnmapped(markdownUnmapped, markdownShortcuts, markdownManualUnmapped),
}

/** Remarks on mapped rows that are not missing keys: generated (minus those a
 * manual unmapped entry now covers), then the module's own (`<module>ManualNotes`). */
export const SHORTCUT_NOTES: Readonly<Record<ShortcutScope, readonly ShortcutNote[]>> = {
  common: mergeNotes(commonNotes, commonManualNotes, commonManualUnmapped),
  shell: mergeNotes(shellNotes, shellManualNotes, shellManualUnmapped),
  docs: mergeNotes(docsNotes, docsManualNotes, docsManualUnmapped),
  sheets: mergeNotes(sheetsNotes, sheetsManualNotes, sheetsManualUnmapped),
  slides: mergeNotes(slidesNotes, slidesManualNotes, slidesManualUnmapped),
  pdf: mergeNotes(pdfNotes, pdfManualNotes, pdfManualUnmapped),
  html: mergeNotes(htmlNotes, htmlManualNotes, htmlManualUnmapped),
  markdown: mergeNotes(markdownNotes, markdownManualNotes, markdownManualUnmapped),
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
