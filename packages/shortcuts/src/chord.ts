import type { Chord, ShortcutPlatform } from './types'

export interface ParsedChord {
  readonly ctrl: boolean
  readonly alt: boolean
  readonly shift: boolean
  /** Command on macOS; never set on `win`. */
  readonly cmd: boolean
  readonly key: string
}

export type KeyKind = 'letter' | 'digit' | 'punctuation' | 'named'

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Cmd'] as const

export const NAMED_KEYS: ReadonlySet<string> = new Set([
  'Enter',
  'Escape',
  'Tab',
  'Space',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Up',
  'Down',
  'Left',
  'Right',
  'ContextMenu',
  // Keypad keys, matched by position only (zoom aliases: Ctrl+NumpadAdd...).
  'NumpadAdd',
  'NumpadSubtract',
  'Numpad0',
])

/** Punctuation key (US-layout `KeyboardEvent.code`) → the unshifted character. */
export const PUNCTUATION_KEYS: Readonly<Record<string, string>> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
}

/** Punctuation key → the US character it types with Shift. A `Shift+` chord on
 * a punctuation key names this character (`Ctrl+Shift+Period` is Ctrl+">"). */
export const SHIFTED_PUNCTUATION_KEYS: Readonly<Record<string, string>> = {
  Minus: '_',
  Equal: '+',
  BracketLeft: '{',
  BracketRight: '}',
  Semicolon: ':',
  Quote: '"',
  Backquote: '~',
  Comma: '<',
  Period: '>',
  Slash: '?',
  Backslash: '|',
}

export function keyKind(key: string): KeyKind | null {
  if (/^[A-Z]$/.test(key)) return 'letter'
  if (/^[0-9]$/.test(key)) return 'digit'
  if (key in PUNCTUATION_KEYS) return 'punctuation'
  if (NAMED_KEYS.has(key) || /^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return 'named'
  return null
}

/** Parses a canonical chord; returns null for anything outside the format. */
export function parseChord(chord: Chord): ParsedChord | null {
  const parts = chord.split('+')
  const key = parts.pop()
  if (!key || keyKind(key) === null) return null
  const seen = new Set<string>()
  let last = -1
  for (const part of parts) {
    const index = (MODIFIERS as readonly string[]).indexOf(part)
    if (index <= last) return null // unknown, repeated or out of canonical order
    last = index
    seen.add(part)
  }
  return {
    ctrl: seen.has('Ctrl'),
    alt: seen.has('Alt'),
    shift: seen.has('Shift'),
    cmd: seen.has('Cmd'),
    key,
  }
}

export function chordToString(parsed: ParsedChord): Chord {
  const parts: string[] = []
  if (parsed.ctrl) parts.push('Ctrl')
  if (parsed.alt) parts.push('Alt')
  if (parsed.shift) parts.push('Shift')
  if (parsed.cmd) parts.push('Cmd')
  parts.push(parsed.key)
  return parts.join('+')
}

/** A chord is valid for a platform when it parses and, on `win`, has no Cmd. */
export function isValidChord(chord: Chord, platform: ShortcutPlatform): boolean {
  const parsed = parseChord(chord)
  return parsed !== null && !(platform === 'win' && parsed.cmd) && chordToString(parsed) === chord
}
