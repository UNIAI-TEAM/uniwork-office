import { keyKind, parseChord, PUNCTUATION_KEYS, SHIFTED_PUNCTUATION_KEYS } from './chord'
import { chordsFor } from './match'
import type { Chord, ShortcutAction, ShortcutPlatform, ShortcutSurface } from './types'

/** Chord key → its UI Events `key` value where the chord name differs. */
const ARIA_KEY_NAMES: Readonly<Record<string, string>> = {
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  NumpadAdd: 'Plus',
  NumpadSubtract: '-',
  Numpad0: '0',
}

function ariaKey(key: string, shift: boolean): string {
  if (keyKind(key) === 'punctuation') {
    // a Shift chord names the shifted character (`Ctrl+Shift+Period` is Ctrl+">")
    const char = (shift ? SHIFTED_PUNCTUATION_KEYS[key] : PUNCTUATION_KEYS[key]) ?? key
    // ARIA spells the "+" key `Plus`, since "+" separates the parts
    return char === '+' ? 'Plus' : char
  }
  return ARIA_KEY_NAMES[key] ?? key
}

/**
 * One chord in `aria-keyshortcuts` notation: `Control+Shift+S` on
 * Windows/Linux, `Shift+Meta+S` on macOS (Command is `Meta`, Option is `Alt`).
 * Empty for a chord that does not parse or names Cmd on `win`.
 */
export function formatAriaChord(chord: Chord, platform: ShortcutPlatform): string {
  const parsed = parseChord(chord)
  if (!parsed || (platform === 'win' && parsed.cmd)) return ''
  const parts: string[] = []
  if (parsed.ctrl) parts.push('Control')
  if (parsed.alt) parts.push('Alt')
  if (parsed.shift) parts.push('Shift')
  if (parsed.cmd) parts.push('Meta')
  parts.push(ariaKey(parsed.key, parsed.shift))
  return parts.join('+')
}

/** Several chords as one `aria-keyshortcuts` value (space-separated, primary first,
 * duplicates dropped), or an empty string when none formats. */
export function formatAriaChords(chords: readonly Chord[], platform: ShortcutPlatform): string {
  const out: string[] = []
  for (const chord of chords) {
    const aria = formatAriaChord(chord, platform)
    if (aria && !out.includes(aria)) out.push(aria)
  }
  return out.join(' ')
}

/**
 * The `aria-keyshortcuts` value for an action: every chord it answers to on
 * this platform and surface (the same `chordsFor` list the matcher reads, so
 * on web it includes the `webAlt` the hint shows), or an empty string when it
 * has none there. Put it on the control whose accessible name is the plain
 * command name; the chord never goes into the name itself.
 */
export function ariaKeyshortcuts(
  action: ShortcutAction,
  platform: ShortcutPlatform,
  surface: ShortcutSurface,
): string {
  return formatAriaChords(chordsFor(action, platform, surface), platform)
}

/** Display-notation chords, as `formatChord` writes them and as hand-written tips spell them. */
const DISPLAY_CHORD_PATTERNS: readonly RegExp[] = [
  // a modifier word joined to a key: Ctrl+E, Alt+Shift+W, Cmd+K, Control+E, Option+R, Ctrl+.
  /\b(?:Ctrl|Control|Alt|Shift|Cmd|Command|Option|Opt|Meta|Win|AltGr)\s*\+\s*\S/i,
  // the translated modifiers the locale strings spell: Strg (de), Maj (fr), Mayús (es), Maiusc (it),
  // Umschalt (de). Joined to the key with no space (Maj+Entrée), so prose such as
  // "ligne de commande + skill" and words such as "Maj de la page" stay plain
  /\b(?:Strg|Maj|Mayús|Maiusc|Umschalt)\+\S/i,
  // macOS glyph notation: ⌘E, ⌥⌘R, ⌃⇧F, ⇧F5
  /[⌘⌥⌃]|⇧\s*\S/,
  // a bare key in a parenthesised hint: (F12), (Esc), (Del), and the translated key names
  // the locale strings use: (Échap), (Entrée), (Entrar), (Invio), (Eingabetaste), (Suppr), (Entf)
  /\(\s*(?:F(?:[1-9]|1[0-9]|2[0-4])|Esc|Escape|Échap|Echap|Del|Delete|Suppr|Supr|Entf|Tab|Enter|Entrée|Entrar|Intro|Invio|Eingabetaste|Return|PgUp|PgDn)\s*\)/,
]

/**
 * The first keyboard chord written in display notation inside `text` (an
 * accessible name, a label), or null. Lock tests use it to fail any name that
 * carries a chord: the chord belongs in `aria-keyshortcuts` and the tooltip.
 */
export function findDisplayChord(text: string): string | null {
  for (const pattern of DISPLAY_CHORD_PATTERNS) {
    const match = pattern.exec(text)
    if (match) return match[0]
  }
  return null
}

/** Whether `text` contains a keyboard chord in display notation; see `findDisplayChord`. */
export function containsDisplayChord(text: string): boolean {
  return findDisplayChord(text) !== null
}

/**
 * The key hint a visible label carries after its plain name: `'(Esc)'` for the label
 * `'Exit (Esc)'` and the name `'Exit'`. Empty when the label is not the name plus a hint.
 * Render the name as the control's text and this as an `aria-hidden` span, so the visible
 * label stays whole while the accessible name stays plain.
 */
export function keyHintAfterName(label: string, name: string): string {
  return label.startsWith(name) ? label.slice(name.length).trim() : ''
}

/** One rendered control as a lock test sees it. */
export interface AccessibleShortcutControl {
  /** The accessible name: `aria-label`, else the text content. */
  readonly name: string
  /** The control's `aria-keyshortcuts` attribute (null or '' when absent). */
  readonly keyshortcuts: string | null | undefined
}

/**
 * What is wrong with a control bound to `action`, as messages (empty when
 * nothing is): its name carries a chord, or its `aria-keyshortcuts` is not
 * this platform's `ariaKeyshortcuts` (absent when the action has no chord here).
 */
export function accessibleShortcutProblems(
  control: AccessibleShortcutControl,
  action: ShortcutAction,
  platform: ShortcutPlatform,
  surface: ShortcutSurface,
): string[] {
  const problems: string[] = []
  const chord = findDisplayChord(control.name)
  if (chord) problems.push(`${action.id}: name "${control.name}" carries the chord "${chord}"`)
  const want = ariaKeyshortcuts(action, platform, surface)
  const have = control.keyshortcuts ?? ''
  if (have !== want) {
    problems.push(
      `${action.id}: aria-keyshortcuts is "${have}", want "${want}" (${platform}, ${surface})`,
    )
  }
  return problems
}
