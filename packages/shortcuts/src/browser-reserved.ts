import { chordToString, parseChord } from './chord'
import type { Chord, ShortcutPlatform } from './types'

/**
 * Keys a web page cannot intercept: the browser acts before `keydown` reaches
 * the page, so a web binding on them never fires.
 *
 * Windows/Linux: Chromium `IsReservedCommandOrKey` (close tab/window, new
 * window, new incognito window, new tab, restore tab, next/previous tab, exit)
 * and the key bindings for those commands in `chrome_dll.rc`:
 * https://chromium.googlesource.com/chromium/src.git/+/20e8909e694cab857da21d8fe9d5f1da170eaae2/chrome/browser/ui/browser_command_controller.cc
 * https://chromium.googlesource.com/chromium/src/+/dc26192a317d9511ce983fd4b26b1130fe25761a/chrome/app/chrome_dll.rc
 *
 * macOS: the same commands' keys from https://support.google.com/chrome/answer/157179;
 * that macOS Chrome reserves them is inferred, not yet tested in a browser.
 *
 * Keys the page can intercept but the browser also uses (Ctrl+S, Ctrl+P,
 * F5, F12...) are not listed: the page's `preventDefault` wins there.
 */
export const BROWSER_RESERVED: Readonly<Record<ShortcutPlatform, readonly Chord[]>> = {
  win: [
    'Ctrl+W',
    'Ctrl+F4',
    'Ctrl+Shift+W',
    'Ctrl+N',
    'Ctrl+Shift+N',
    'Ctrl+T',
    'Ctrl+Shift+T',
    'Ctrl+Tab',
    'Ctrl+Shift+Tab',
    'Ctrl+PageDown',
    'Ctrl+PageUp',
    'Alt+F4',
  ],
  mac: [
    'Cmd+W',
    'Shift+Cmd+W',
    'Cmd+N',
    'Shift+Cmd+N',
    'Cmd+T',
    'Shift+Cmd+T',
    'Cmd+Q',
    'Ctrl+Tab',
    'Ctrl+Shift+Tab',
  ],
}

const RESERVED_SETS: Record<ShortcutPlatform, ReadonlySet<Chord>> = {
  win: new Set(BROWSER_RESERVED.win),
  mac: new Set(BROWSER_RESERVED.mac),
}

/** True when the browser keeps this canonical chord on the given platform (web surface). */
export function isBrowserReserved(chord: Chord, platform: ShortcutPlatform): boolean {
  const parsed = parseChord(chord)
  return parsed !== null && RESERVED_SETS[platform].has(chordToString(parsed))
}
