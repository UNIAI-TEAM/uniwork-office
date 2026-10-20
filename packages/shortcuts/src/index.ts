import type { ShortcutAction, ShortcutPlatform, ShortcutScope } from './types'
import { commonShortcuts } from './tables/common'
import { shellShortcuts } from './tables/shell'
import { docsShortcuts } from './tables/docs'
import { sheetsShortcuts } from './tables/sheets'
import { slidesShortcuts } from './tables/slides'
import { pdfShortcuts } from './tables/pdf'
import { htmlShortcuts } from './tables/html'
import { markdownShortcuts } from './tables/markdown'

export type {
  Chord,
  PlatformChords,
  ShortcutAction,
  ShortcutGuard,
  ShortcutMatch,
  ShortcutPlatform,
  ShortcutScope,
  ShortcutSurface,
  UnmappedShortcut,
} from './types'
export { chordToString, isValidChord, keyKind, parseChord, type ParsedChord } from './chord'
export {
  chordsFor,
  createMatcher,
  isComposingEvent,
  matchChord,
  matchShortcut,
  type ShortcutKeyEvent,
} from './match'
export { chordToElectronAccelerator, toElectronAccelerator } from './accelerator'
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
export { commonUnmapped } from './tables/common'
export { shellUnmapped } from './tables/shell'
export { docsUnmapped } from './tables/docs'
export { sheetsUnmapped } from './tables/sheets'
export { slidesUnmapped } from './tables/slides'
export { pdfUnmapped } from './tables/pdf'
export { htmlUnmapped } from './tables/html'
export { markdownUnmapped } from './tables/markdown'

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
