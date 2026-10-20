import { keyKind, parseChord, type ParsedChord } from './chord'
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
  readonly repeat?: boolean
  readonly isComposing?: boolean
  readonly keyCode?: number
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

function keyMatches(parsed: ParsedChord, event: ShortcutKeyEvent, match: ShortcutMatch): boolean {
  const { key } = parsed
  switch (keyKind(key)) {
    case 'letter': {
      const code = `Key${key}`
      if (match === 'code') return event.code === code
      const typed = event.key.length === 1 ? event.key.toLowerCase() : ''
      // Non-Latin layouts and macOS Option dead keys produce no a-z letter:
      // fall back to the physical key so the chord still works.
      if (!/^[a-z]$/.test(typed)) return event.code === code
      return typed === key.toLowerCase()
    }
    case 'digit':
      return event.code === `Digit${key}`
    case 'punctuation':
      return event.code === key
    case 'named': {
      if (key === 'Space') return event.code === 'Space' || event.key === ' '
      const names = NAMED_EVENT_KEYS[key] ?? [key]
      return names.includes(event.key) || (match === 'code' && event.code === key)
    }
    default:
      return false
  }
}

/** Exact modifier match: every modifier of the chord is held, no other one is. */
function modifiersMatch(
  parsed: ParsedChord,
  event: ShortcutKeyEvent,
  platform: ShortcutPlatform,
): boolean {
  if (platform === 'win' && parsed.cmd) return false
  return (
    event.ctrlKey === parsed.ctrl &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift &&
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
  return modifiersMatch(parsed, event, platform) && keyMatches(parsed, event, match)
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
 * ties. Only rows of `context` take part (rows without a context when it is
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
  for (const action of table) {
    if (action.context !== context) continue
    if (action.guard.noRepeat && event.repeat) continue
    for (const chord of chordsFor(action, platform, surface)) {
      if (matchChord(chord, event, platform, action.match)) return action
    }
  }
  return null
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
