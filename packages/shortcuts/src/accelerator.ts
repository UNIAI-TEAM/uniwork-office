import { keyKind, parseChord, PUNCTUATION_KEYS, type ParsedChord } from './chord'
import type { Chord, ShortcutAction, ShortcutPlatform } from './types'

/** Chord key → Electron key code. Letters, digits, F-keys and the named keys
 * already use Electron's names; punctuation is written as its character. */
function electronKey(key: string): string | null {
  const kind = keyKind(key)
  if (kind === 'punctuation') return PUNCTUATION_KEYS[key] ?? null
  if (key === 'ContextMenu') return null // Electron has no accelerator for the menu key
  return kind ? key : null
}

function modifierParts(parsed: ParsedChord, platform: ShortcutPlatform, cmdOrCtrl: boolean) {
  const parts: string[] = []
  if (cmdOrCtrl) parts.push('CmdOrCtrl')
  else if (parsed.ctrl) parts.push('Ctrl')
  if (parsed.alt) parts.push('Alt')
  if (parsed.shift) parts.push('Shift')
  if (parsed.cmd && !cmdOrCtrl && platform === 'mac') parts.push('Command')
  return parts
}

/** The same chord with Ctrl on Windows and Cmd on macOS (and nothing else differing). */
function isCmdOrCtrlPair(win: ParsedChord, mac: ParsedChord): boolean {
  return (
    win.ctrl &&
    !win.cmd &&
    mac.cmd &&
    !mac.ctrl &&
    win.alt === mac.alt &&
    win.shift === mac.shift &&
    win.key === mac.key
  )
}

/** One chord as an Electron accelerator string for the given platform. */
export function chordToElectronAccelerator(
  chord: Chord,
  platform: ShortcutPlatform,
): string | null {
  const parsed = parseChord(chord)
  if (!parsed || (platform === 'win' && parsed.cmd)) return null
  const key = electronKey(parsed.key)
  return key ? [...modifierParts(parsed, platform, false), key].join('+') : null
}

/**
 * The desktop menu accelerator for an action's primary chord. When the
 * Windows and macOS chords differ only by Ctrl/Cmd the portable `CmdOrCtrl`
 * form is returned (`CmdOrCtrl+Shift+S`), otherwise the platform's own chord
 * (`Alt+Command+I`, `F12`). Null when the platform has no chord.
 */
export function toElectronAccelerator(
  action: ShortcutAction,
  platform: ShortcutPlatform,
): string | null {
  const own = action[platform][0]
  if (!own) return null
  const win = action.win[0] ? parseChord(action.win[0]) : null
  const mac = action.mac[0] ? parseChord(action.mac[0]) : null
  if (win && mac && isCmdOrCtrlPair(win, mac)) {
    const key = electronKey(win.key)
    return key ? [...modifierParts(win, platform, true), key].join('+') : null
  }
  return chordToElectronAccelerator(own, platform)
}
