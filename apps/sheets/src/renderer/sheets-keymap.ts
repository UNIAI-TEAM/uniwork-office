/**
 * The renderer side of the sheets shortcut table (`@genoffice/shortcuts`, UNI-2011):
 * which chord of a row a keydown matched, the same chords as Univer bindings, the
 * IME / AltGr guard in front of Univer's dispatcher, and tooltip hints.
 *
 * Surface: the web frame (capability platform `web`) answers to the table's web
 * chords (Excel for the web, minus the keys the browser keeps); Electron to the
 * desktop ones. Platform: Excel for Mac's column on macOS, Excel's Windows column
 * elsewhere.
 */
import {
  chordsFor,
  currentShortcutPlatform,
  formatHint,
  isComposingEvent,
  matchChord,
  parseChord,
  type Chord,
  type ParsedChord,
  type ShortcutAction,
  type ShortcutKeyEvent,
  type ShortcutPlatform,
  type ShortcutSurface,
} from '@genoffice/shortcuts'
import { MetaKeys } from '@univerjs/ui'
import { sheetsShortcut } from '../shared/sheets-shortcuts'
import { platform as capabilityPlatform } from './capabilities'

export interface SheetsKeyTarget {
  readonly platform: ShortcutPlatform
  readonly surface: ShortcutSurface
}

export function shortcutSurface(): ShortcutSurface {
  return capabilityPlatform() === 'web' ? 'web' : 'desktop'
}

export function sheetsKeyTarget(): SheetsKeyTarget {
  return { platform: currentShortcutPlatform(), surface: shortcutSurface() }
}

/** Tooltip / menu text for a row on this platform and surface (`Ctrl+1`, `⌘1`). */
export function sheetsHint(id: string, target: SheetsKeyTarget = sheetsKeyTarget()): string {
  return formatHint(sheetsShortcut(id), target.platform, target.surface)
}

/**
 * The chord of `action` this keydown matched, or null. Composition (Telex/VNI,
 * `isComposing` / keyCode 229), AltGr on a Windows Ctrl+Alt chord and auto-repeat
 * of a `noRepeat` row never match. `skip` leaves chords out (the menu's own).
 */
export function matchedChord(
  action: ShortcutAction,
  event: ShortcutKeyEvent,
  target: SheetsKeyTarget,
  skip: (chord: Chord) => boolean = () => false,
): ParsedChord | null {
  if (isComposingEvent(event) || (action.guard.noRepeat && event.repeat)) return null
  for (const chord of chordsFor(action, target.platform, target.surface)) {
    if (!skip(chord) && matchChord(chord, event, target.platform, action.match)) {
      return parseChord(chord)
    }
  }
  return null
}

/**
 * Rows that name two sub-actions keep both chords in one row (a row id is a
 * `shortcuts.csv` id). The second sub-action of each pair, by its chord:
 * - hide / unhide (sheets-22, sheets-23): Ctrl (Control) together with Shift
 *   unhides; Excel for Mac's Cmd+( / Cmd+) hide like Control+9 / Control+0
 * - Home / End (sheets-33): End
 * - Page down / up (sheets-38): Page up
 * - precedents / dependents (sheets-56): `]`
 * - font size up / down (sheets-67): `<` (Comma)
 * - outline / no border (sheets-75): Minus
 * - group / ungroup (sheets-91): Left arrow, or Cmd+Shift+J on a Mac
 */
export function isSecondSubAction(id: string, chord: ParsedChord): boolean {
  switch (id) {
    case 'sheets-22':
    case 'sheets-23':
      return chord.ctrl && chord.shift
    case 'sheets-33':
      return chord.key === 'End'
    case 'sheets-38':
      return chord.key === 'PageUp'
    case 'sheets-56':
      return chord.key === 'BracketRight'
    case 'sheets-67':
      return chord.key === 'Comma'
    case 'sheets-75':
      return chord.key === 'Minus'
    case 'sheets-91':
      return chord.key === 'Left' || chord.key === 'J'
    default:
      return false
  }
}

// Browser `keyCode` values, the field Univer's dispatcher matches on.
const NAMED_KEY_CODES: Readonly<Record<string, number>> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Escape: 27,
  Space: 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  Left: 37,
  Up: 38,
  Right: 39,
  Down: 40,
  Insert: 45,
  Delete: 46,
  ContextMenu: 93,
}

const PUNCTUATION_KEY_CODES: Readonly<Record<string, number>> = {
  Semicolon: 186,
  Equal: 187,
  Comma: 188,
  Minus: 189,
  Period: 190,
  Slash: 191,
  Backquote: 192,
  BracketLeft: 219,
  Backslash: 220,
  BracketRight: 221,
  Quote: 222,
}

function keyCodeOf(key: string): number | null {
  if (/^[A-Z]$/.test(key)) return key.charCodeAt(0)
  if (/^[0-9]$/.test(key)) return key.charCodeAt(0)
  const fKey = /^F([1-9]|1[0-9]|2[0-4])$/.exec(key)
  if (fKey) return 111 + Number(fKey[1])
  return NAMED_KEY_CODES[key] ?? PUNCTUATION_KEY_CODES[key] ?? null
}

/**
 * A table chord as a Univer shortcut binding for one platform: Univer's
 * CTRL_COMMAND is Cmd on macOS and Ctrl elsewhere, MAC_CTRL the macOS Control
 * key. Null when the chord cannot exist there (Cmd on Windows).
 */
export function chordToUniverBinding(chord: Chord, platform: ShortcutPlatform): number | null {
  const parsed = parseChord(chord)
  const keyCode = parsed ? keyCodeOf(parsed.key) : null
  if (!parsed || keyCode === null || (platform === 'win' && parsed.cmd)) return null
  let binding = keyCode
  if (parsed.shift) binding |= MetaKeys.SHIFT
  if (parsed.alt) binding |= MetaKeys.ALT
  if (platform === 'mac') {
    if (parsed.cmd) binding |= MetaKeys.CTRL_COMMAND
    if (parsed.ctrl) binding |= MetaKeys.MAC_CTRL
  } else if (parsed.ctrl) {
    binding |= MetaKeys.CTRL_COMMAND
  }
  return binding
}

/**
 * Univer's dispatcher matches the raw `keyCode` and modifiers, so on its own it
 * fires while an IME composes and on AltGr (Ctrl+Alt on Windows). True when the
 * event must not reach any Univer shortcut.
 */
export function blocksUniverShortcut(event: ShortcutKeyEvent, platform: ShortcutPlatform): boolean {
  if (isComposingEvent(event)) return true
  return (
    platform === 'win' &&
    event.ctrlKey &&
    event.altKey &&
    event.getModifierState?.('AltGraph') === true
  )
}

interface DispatchingShortcutService {
  dispatch(event: KeyboardEvent): unknown
}

/** Puts `blocksUniverShortcut` in front of every Univer shortcut, its own included. */
export function guardUniverDispatch(
  shortcutService: DispatchingShortcutService,
  platform: ShortcutPlatform,
): void {
  const dispatch = shortcutService.dispatch.bind(shortcutService)
  shortcutService.dispatch = (event) =>
    blocksUniverShortcut(event, platform) ? undefined : dispatch(event)
}
