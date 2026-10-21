import { keyKind, parseChord, PUNCTUATION_KEYS } from './chord'
import { chordsFor } from './match'
import type { Chord, ShortcutAction, ShortcutPlatform, ShortcutSurface } from './types'

const WIN_KEY_NAMES: Readonly<Record<string, string>> = {
  Escape: 'Esc',
  Delete: 'Del',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  ContextMenu: 'Menu',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  Numpad0: 'Num 0',
}

const MAC_KEY_NAMES: Readonly<Record<string, string>> = {
  Enter: '↩',
  Escape: '⎋',
  Tab: '⇥',
  Space: 'Space',
  Backspace: '⌫',
  Delete: '⌦',
  Home: '↖',
  End: '↘',
  PageUp: '⇞',
  PageDown: '⇟',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  Numpad0: 'Num 0',
}

function displayKey(key: string, platform: ShortcutPlatform): string {
  if (keyKind(key) === 'punctuation') return PUNCTUATION_KEYS[key] ?? key
  const names = platform === 'mac' ? MAC_KEY_NAMES : WIN_KEY_NAMES
  return names[key] ?? key
}

/**
 * One chord as menu/tooltip text: `Ctrl+Shift+S` on Windows/Linux, Apple's
 * glyph order `⌃⌥⇧⌘S` on macOS (the notation `@genoffice/i18n`'s
 * `macShortcutsToWin` reads back). Key names are not localized: Office shows
 * `Ctrl` in every UI language this suite ships.
 */
export function formatChord(chord: Chord, platform: ShortcutPlatform): string {
  const parsed = parseChord(chord)
  if (!parsed) return chord
  const key = displayKey(parsed.key, platform)
  if (platform === 'mac') {
    return (
      (parsed.ctrl ? '⌃' : '') +
      (parsed.alt ? '⌥' : '') +
      (parsed.shift ? '⇧' : '') +
      (parsed.cmd ? '⌘' : '') +
      key
    )
  }
  const parts: string[] = []
  if (parsed.ctrl) parts.push('Ctrl')
  if (parsed.alt) parts.push('Alt')
  if (parsed.shift) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

export interface ShortcutHintParts {
  /** The chord the user presses on this surface (the web alternative when the
   * browser keeps the desktop key), or null when the action has none. */
  readonly primary: string | null
  /** On web, when `primary` is a `webAlt`: the desktop chord it stands in for,
   * so the caller can add its localized "(Ctrl+N on desktop)" note. */
  readonly desktop: string | null
}

/** Hint pieces for an action; see `formatHint` for the plain string. */
export function hintParts(
  action: ShortcutAction,
  platform: ShortcutPlatform,
  surface: ShortcutSurface,
): ShortcutHintParts {
  const chords = chordsFor(action, platform, surface)
  const alt = surface === 'web' ? action.webAlt?.[platform] : undefined
  const first = chords[0]
  const usesAlt = alt !== undefined && first === alt
  const desktop = usesAlt ? action[platform][0] : undefined
  return {
    primary: first ? formatChord(first, platform) : null,
    desktop: desktop ? formatChord(desktop, platform) : null,
  }
}

/**
 * The menu/tooltip shortcut string for an action (`Ctrl+Shift+S`, `⇧⌘S`), or
 * an empty string when it has no chord on this platform and surface. Locale
 * is not a parameter: key names are not translated, and the web "(on
 * desktop)" note is the caller's i18n string around `hintParts().desktop`.
 */
export function formatHint(
  action: ShortcutAction,
  platform: ShortcutPlatform,
  surface: ShortcutSurface,
): string {
  return hintParts(action, platform, surface).primary ?? ''
}
