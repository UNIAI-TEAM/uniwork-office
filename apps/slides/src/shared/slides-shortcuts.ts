/**
 * Slides keys come from the `@genoffice/shortcuts` slides table (UNI-2011):
 * PowerPoint's Windows chords on Windows/Linux, PowerPoint for Mac's on macOS,
 * PowerPoint for the web's in the web frame. The application menu takes its
 * accelerators from here; the renderer's handlers and tooltips read the same
 * rows through renderer/shortcuts.ts.
 */
import {
  findShortcut,
  toElectronAccelerator,
  type ShortcutAction,
  type ShortcutPlatform,
} from '@genoffice/shortcuts'

/** The slides table row with this `shortcuts.csv` id; a missing row is a programming error. */
export function slidesShortcut(id: string): ShortcutAction {
  const action = findShortcut('slides', id)
  if (!action) throw new Error(`no slides shortcut row ${id}`)
  return action
}

/**
 * Menu items that carry an accelerator → their table row. Cut / Copy / Paste
 * and the zoom items keep Electron's own chords: their CSV rows (slides-09,
 * slides-67) name several commands at once and hold no single chord.
 */
export const SLIDES_MENU_SHORTCUTS = {
  open: 'slides-02',
  save: 'slides-03',
  saveAs: 'slides-04',
  print: 'slides-05',
  close: 'slides-06',
  undo: 'slides-07',
  redo: 'slides-08',
} as const

export type SlidesMenuShortcut = keyof typeof SLIDES_MENU_SHORTCUTS

/** The Electron accelerator of a menu item on this platform, or undefined when it has none. */
export function slidesMenuAccelerator(
  item: SlidesMenuShortcut,
  platform: ShortcutPlatform,
): string | undefined {
  return toElectronAccelerator(slidesShortcut(SLIDES_MENU_SHORTCUTS[item]), platform) ?? undefined
}
