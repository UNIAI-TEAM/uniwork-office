/**
 * Docs keys come from the `@genoffice/shortcuts` docs table (UNI-2011): Word's
 * Windows chords on Windows/Linux, Word for Mac's on macOS, Microsoft 365 for
 * the web's in the web frame. The application menu takes its accelerators from
 * here; the renderer's handlers, tooltips and Keyboard Shortcuts sheet read the
 * same rows through renderer/shortcuts.ts. No chord is written out by hand.
 */
import {
  findShortcut,
  toElectronAccelerator,
  type ShortcutAction,
  type ShortcutPlatform,
} from '@genoffice/shortcuts'

/** The docs table row with this `shortcuts.csv` id; a missing row is a programming error. */
export function docsShortcut(id: string): ShortcutAction {
  const action = findShortcut('docs', id)
  if (!action) throw new Error(`no docs shortcut row ${id}`)
  return action
}

/**
 * Menu items that carry an accelerator → their table row. Ctrl+Alt chords stay
 * off the menu (insert comment, headings...): on Windows a menu accelerator
 * would also catch AltGr and eat the character it types, while the renderer's
 * handler can reject AltGraph.
 */
export const DOCS_MENU_SHORTCUTS = {
  new: 'docs-001',
  open: 'docs-003',
  close: 'docs-008',
  save: 'docs-004',
  saveAs: 'docs-005',
  print: 'docs-006',
  undo: 'docs-010',
  redo: 'docs-011',
  pasteAndMatchStyle: 'docs-016',
  find: 'docs-018',
  goto: 'docs-021',
  zoomIn: 'docs-082',
  zoomOut: 'docs-083',
  zoom100: 'docs-084',
  link: 'docs-071',
  bold: 'docs-022',
  italic: 'docs-023',
  underline: 'docs-024',
  font: 'docs-033',
  shortcuts: 'docs-094',
} as const

export type DocsMenuShortcut = keyof typeof DOCS_MENU_SHORTCUTS

/** The Electron accelerator of a menu item on this platform, or undefined when it has none. */
export function docsMenuAccelerator(
  item: DocsMenuShortcut,
  platform: ShortcutPlatform,
): string | undefined {
  return toElectronAccelerator(docsShortcut(DOCS_MENU_SHORTCUTS[item]), platform) ?? undefined
}
