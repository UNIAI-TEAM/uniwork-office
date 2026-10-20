/**
 * Renderer side of the slides shortcut table (UNI-2011): the window keydown
 * handler, the slide-show views and the ribbon tooltips match and print keys
 * through here, so a chord changes in one place (packages/shortcuts). The
 * application menu reads the same rows through shared/slides-shortcuts.ts.
 */
import {
  formatHint,
  matchShortcut,
  slidesShortcuts,
  type ShortcutKeyEvent,
  type ShortcutPlatform,
  type ShortcutSurface,
} from '@genoffice/shortcuts'
import { slidesShortcut } from '../shared/slides-shortcuts'
import { isWeb } from './capabilities'

/** `win` or `mac` from a `navigator.platform` string (tests pass their own). */
export function shortcutPlatform(platform: string = navigator.platform): ShortcutPlatform {
  return /mac/i.test(platform) ? 'mac' : 'win'
}

/** PowerPoint for the web's keys in the web frame, the desktop app's elsewhere. */
export function shortcutSurface(): ShortcutSurface {
  return isWeb() ? 'web' : 'desktop'
}

/** The `shortcuts.csv` id of the slides action this keydown triggers, or null. */
export function matchSlidesKey(
  e: ShortcutKeyEvent,
  platform: ShortcutPlatform = shortcutPlatform(),
  context?: string,
): string | null {
  return matchShortcut(e, slidesShortcuts, platform, shortcutSurface(), context)?.id ?? null
}

/** Tooltip / menu text for an action on this platform and surface ('' when it has no key). */
export function slidesHint(id: string, platform: ShortcutPlatform = shortcutPlatform()): string {
  return formatHint(slidesShortcut(id), platform, shortcutSurface())
}

/**
 * Hint for a key the web frame answers itself (File > Open: Ctrl+O is a browser key, so the table
 * has no web chord, but the frame maps it onto the Open command whenever the host grants `open`).
 * Only call it where that grant is a precondition of showing the item; the desktop chord is printed.
 */
export function slidesFrameHint(
  id: string,
  platform: ShortcutPlatform = shortcutPlatform(),
): string {
  return formatHint(slidesShortcut(id), platform, 'desktop')
}

/** Format Painter's key text: copy format / paste format, each only where the surface has a key. */
export function brushTipKbd(): string | undefined {
  return [slidesHint('slides-11'), slidesHint('slides-12')].filter(Boolean).join(' / ') || undefined
}

/** `data-tip-kbd` value: the hint, or undefined so an action without a key shows none. */
export function slidesTipKbd(id: string): string | undefined {
  return slidesHint(id) || undefined
}
