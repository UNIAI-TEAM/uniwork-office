/**
 * Renderer side of the slides shortcut table (UNI-2011): the window keydown
 * handler, the slide-show views and the ribbon tooltips match and print keys
 * through here, so a chord changes in one place (packages/shortcuts). The
 * application menu reads the same rows through shared/slides-shortcuts.ts.
 */
import {
  ariaKeyshortcuts,
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

/** Format Painter's key text: copy format / paste format, each only where the surface has a key. */
export function brushTipKbd(): string | undefined {
  return [slidesHint('slides-11'), slidesHint('slides-12')].filter(Boolean).join(' / ') || undefined
}

/** `data-tip-kbd` value: the hint, or undefined so an action without a key shows none. */
export function slidesTipKbd(id: string): string | undefined {
  return slidesHint(id) || undefined
}

/**
 * `aria-keyshortcuts` value (`Control+S`, `Meta+S`) for one or more table rows on this platform and
 * surface (several rows: space-joined, as Format Painter's copy and paste keys); '' when none has a key.
 */
export function slidesAria(
  ids: string | readonly string[],
  platform: ShortcutPlatform = shortcutPlatform(),
): string {
  return (typeof ids === 'string' ? [ids] : ids)
    .map((id) => ariaKeyshortcuts(slidesShortcut(id), platform, shortcutSurface()))
    .filter(Boolean)
    .join(' ')
}

/** `aria-keyshortcuts` attribute value: undefined (no attribute) when the rows have no key here. */
export function slidesAriaProp(ids: string | readonly string[]): string | undefined {
  return slidesAria(ids) || undefined
}

/** a trailing "(⌘S)" / "（⌘X）" / "(Ctrl+S)" of a translated label: the old hand-written hint */
const TRAILING_HINT = /\s*[(（][^()（）]*(?:⌘|⌃|⌥|⇧|Ctrl|Cmd|Alt\b|Shift)[^()（）]*[)）]\s*$/

/** an accessible name: the label without its hand-written hint, never a chord (that is `slidesAria`) */
export function slidesPlainLabel(label: string): string {
  return label.replace(TRAILING_HINT, '')
}
