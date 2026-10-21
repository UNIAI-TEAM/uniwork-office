import {
  keyKind,
  parseChord,
  PUNCTUATION_KEYS,
  SHIFTED_PUNCTUATION_KEYS,
  type ParsedChord,
} from './chord'
import type {
  Chord,
  ShortcutAction,
  ShortcutMatch,
  ShortcutPlatform,
  ShortcutSurface,
} from './types'

/** The `KeyboardEvent` fields the matcher reads (DOM-free, so tests and
 * workers can pass plain objects). */
export interface ShortcutKeyEvent {
  readonly key: string
  readonly code: string
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly metaKey: boolean
  readonly repeat?: boolean | undefined
  readonly isComposing?: boolean | undefined
  readonly keyCode?: number | undefined
  getModifierState?(key: string): boolean
}

/** Named chord keys whose `event.key` differs from the chord name. */
const NAMED_EVENT_KEYS: Readonly<Record<string, readonly string[]>> = {
  Escape: ['Escape', 'Esc'],
  Space: [' ', 'Spacebar'],
  Up: ['ArrowUp', 'Up'],
  Down: ['ArrowDown', 'Down'],
  Left: ['ArrowLeft', 'Left'],
  Right: ['ArrowRight', 'Right'],
  Delete: ['Delete', 'Del'],
  ContextMenu: ['ContextMenu', 'Apps'],
}

/** The `Input` fields of Electron's `before-input-event` (main process). */
export interface ElectronInputLike {
  readonly key: string
  readonly code: string
  readonly control: boolean
  readonly alt: boolean
  readonly shift: boolean
  readonly meta: boolean
  readonly isAutoRepeat?: boolean
  readonly isComposing?: boolean
}

/** An Electron `before-input-event` input as a matcher event. Electron gives
 * no AltGraph state, so on Windows every Ctrl+Alt chord is treated as AltGr
 * there and never matches (see `matchChord`). */
export function fromElectronInput(input: ElectronInputLike): ShortcutKeyEvent {
  return {
    key: input.key,
    code: input.code,
    ctrlKey: input.control,
    altKey: input.alt,
    shiftKey: input.shift,
    metaKey: input.meta,
    repeat: input.isAutoRepeat,
    isComposing: input.isComposing,
  }
}

/** Composition in progress (Telex/VNI/IME): no shortcut may fire. */
export function isComposingEvent(event: ShortcutKeyEvent): boolean {
  return event.isComposing === true || event.keyCode === 229
}

/** A key that types one printable ASCII character (not a dead key, not a
 * non-Latin letter, not a macOS Option glyph). */
function typesAscii(event: ShortcutKeyEvent): boolean {
  return /^[!-~]$/.test(event.key)
}

/** The character a punctuation chord names: its key's US character, shifted
 * when the chord holds Shift. */
function punctuationChar(parsed: ParsedChord): string | undefined {
  return (parsed.shift ? SHIFTED_PUNCTUATION_KEYS : PUNCTUATION_KEYS)[parsed.key]
}

/** True when the key matches and Shift must match too; see `ShortcutMatch`. */
function keyMatches(
  parsed: ParsedChord,
  event: ShortcutKeyEvent,
  match: ShortcutMatch,
): { key: boolean; shift: boolean } {
  const { key } = parsed
  const exact = (ok: boolean) => ({ key: ok, shift: true })
  switch (keyKind(key)) {
    case 'letter': {
      const code = `Key${key}`
      // Non-Latin layouts and macOS Option dead keys type no ASCII character:
      // fall back to the physical key so the chord still works.
      if (match === 'code' || !typesAscii(event)) return exact(event.code === code)
      return exact(event.key.toLowerCase() === key.toLowerCase())
    }
    case 'digit':
      return exact(event.code === `Digit${key}`)
    case 'punctuation': {
      if (match === 'code' || !typesAscii(event)) return exact(event.code === key)
      // By character: the layout decides whether it needs Shift.
      if (event.code.startsWith('Numpad')) return exact(false)
      return { key: event.key === punctuationChar(parsed), shift: false }
    }
    case 'named': {
      if (key === 'Space') return exact(event.code === 'Space' || event.key === ' ')
      if (key.startsWith('Numpad')) return exact(event.code === key)
      const names = NAMED_EVENT_KEYS[key] ?? [key]
      return exact(names.includes(event.key) || (match === 'code' && event.code === key))
    }
    default:
      return exact(false)
  }
}

/** Every modifier of the chord is held and no other one is (Shift only when
 * `shift` says the key comparison leaves it to the chord). */
function modifiersMatch(
  parsed: ParsedChord,
  event: ShortcutKeyEvent,
  platform: ShortcutPlatform,
  shift: boolean,
): boolean {
  if (platform === 'win' && parsed.cmd) return false
  return (
    event.ctrlKey === parsed.ctrl &&
    event.altKey === parsed.alt &&
    (!shift || event.shiftKey === parsed.shift) &&
    event.metaKey === parsed.cmd
  )
}

/** Matches one chord against an event; composition and AltGr guards included. */
export function matchChord(
  chord: Chord,
  event: ShortcutKeyEvent,
  platform: ShortcutPlatform,
  match: ShortcutMatch = 'key',
): boolean {
  if (isComposingEvent(event)) return false
  const parsed = parseChord(chord)
  if (!parsed) return false
  // AltGr arrives as Ctrl+Alt on Windows: a Ctrl+Alt chord must not fire
  // while the user types an AltGr character. An event that cannot report
  // AltGraph (Electron input, synthetic events) is assumed to be AltGr.
  if (platform === 'win' && parsed.ctrl && parsed.alt) {
    const altGraph = event.getModifierState
      ? event.getModifierState('AltGraph')
      : event.ctrlKey && event.altKey
    if (altGraph) return false
  }
  const keyed = keyMatches(parsed, event, match)
  return keyed.key && modifiersMatch(parsed, event, platform, keyed.shift)
}

/** A chord compared by character on a punctuation key (it yields to a digit
 * chord on the same keydown). */
function isSymbolChord(chord: Chord, match: ShortcutMatch): boolean {
  const parsed = parseChord(chord)
  return match === 'key' && parsed !== null && keyKind(parsed.key) === 'punctuation'
}

/** The chords an action answers to on one platform and surface. */
export function chordsFor(
  action: ShortcutAction,
  platform: ShortcutPlatform,
  surface: ShortcutSurface,
): readonly Chord[] {
  if (surface === 'desktop') return action[platform]
  const web = action.web ? action.web[platform] : action[platform]
  const alt = action.webAlt?.[platform]
  return alt ? [...web, alt] : web
}

/**
 * First action whose chord matches the event, or null. Table order breaks
 * ties, except that a punctuation chord matched by character yields to any
 * other match (a digit chord on the key that typed it: French Ctrl+6 types
 * "-"). Only rows of `context` take part (rows without a context when it is
 * omitted), so slide-show keys never shadow editing keys and vice versa.
 */
export function matchShortcut(
  event: ShortcutKeyEvent,
  table: readonly ShortcutAction[],
  platform: ShortcutPlatform,
  surface: ShortcutSurface,
  context?: string,
): ShortcutAction | null {
  if (isComposingEvent(event)) return null
  let bySymbol: ShortcutAction | null = null
  for (const action of table) {
    if (action.context !== context) continue
    if (action.guard.noRepeat && event.repeat) continue
    for (const chord of chordsFor(action, platform, surface)) {
      if (!matchChord(chord, event, platform, action.match)) continue
      if (!isSymbolChord(chord, action.match)) return action
      bySymbol ??= action
    }
  }
  return bySymbol
}

/** Binds a table once; the returned function maps an event to its action. */
export function createMatcher(table: readonly ShortcutAction[]) {
  return (
    event: ShortcutKeyEvent,
    platform: ShortcutPlatform,
    surface: ShortcutSurface,
    context?: string,
  ): ShortcutAction | null => matchShortcut(event, table, platform, surface, context)
}
