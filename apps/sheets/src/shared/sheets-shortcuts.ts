/**
 * Sheets keys come from the `@genoffice/shortcuts` sheets table (UNI-2011): Excel's
 * Windows chords on Windows/Linux, Excel for Mac's on macOS, Excel for the web's
 * in the web frame. The application menu takes its accelerators from here; the
 * renderer's handlers, Univer registrations and tooltips read the same rows
 * through renderer/sheets-keymap.ts. No chord is written out by hand.
 */
import {
  findShortcut,
  toElectronAccelerator,
  type ShortcutAction,
  type ShortcutPlatform,
} from '@genoffice/shortcuts'

/** The sheets table row with this `shortcuts.csv` id; a missing row is a programming error. */
export function sheetsShortcut(id: string): ShortcutAction {
  const action = findShortcut('sheets', id)
  if (!action) throw new Error(`no sheets shortcut row ${id}`)
  return action
}

/** Menu items that carry an accelerator → their table row. */
export const SHEETS_MENU_SHORTCUTS = {
  open: 'sheets-02',
  save: 'sheets-03',
  saveAs: 'sheets-04',
  print: 'sheets-05',
  close: 'sheets-06',
  undo: 'sheets-07',
  redo: 'sheets-08',
} as const

export type SheetsMenuShortcut = keyof typeof SHEETS_MENU_SHORTCUTS

/** The Electron accelerator of a menu item on this platform, or undefined when it has none. */
export function sheetsMenuAccelerator(
  item: SheetsMenuShortcut,
  platform: ShortcutPlatform,
): string | undefined {
  return toElectronAccelerator(sheetsShortcut(SHEETS_MENU_SHORTCUTS[item]), platform) ?? undefined
}
