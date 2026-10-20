/**
 * The user-facing Docs keyboard commands.
 *
 * Every command names its row in the `@genoffice/shortcuts` docs table, which
 * holds the chords (Word's Windows column on Windows/Linux, Word for Mac's on
 * macOS, Microsoft 365 for the web's in the web frame). App.tsx's window
 * handler, the editor keymap, the ribbon tooltips and the Keyboard Shortcuts
 * sheet all read the table through here, and the menu accelerators come from
 * the same rows (shared/docs-shortcuts.ts), so a key changes in one place.
 */
import {
  chordsFor,
  currentShortcutPlatform,
  formatChord,
  formatHint,
  matchShortcut,
  type Chord,
  type PlatformChords,
  type ShortcutAction,
  type ShortcutKeyEvent,
  type ShortcutPlatform,
  type ShortcutSurface,
} from '@genoffice/shortcuts'
import { docsShortcut } from '../shared/docs-shortcuts'
import { isWebFrame } from './capabilities'
import type { StringKey } from './i18n/locale'

export type ShortcutGroupId = 'file' | 'edit' | 'text' | 'para' | 'insert' | 'review' | 'view'

export interface ShortcutDef {
  id: string
  group: ShortcutGroupId
  /** row label; reuses the command's existing translation wherever one exists */
  labelKey: StringKey
  /** appended verbatim to the label (line-spacing values and the like) */
  labelSuffix?: string
  /** the docs table row (`shortcuts.csv` id) the command answers to */
  action?: string
  /** editor-native keys that have no single table row (list level, moving a paragraph) */
  native?: PlatformChords
  /** the host or the browser owns the command in the web frame, so the sheet leaves it out there */
  desktopOnly?: boolean
}

export const SHORTCUT_GROUPS: readonly { id: ShortcutGroupId; labelKey: StringKey }[] = [
  { id: 'file', labelKey: 'appScGroupFile' },
  { id: 'edit', labelKey: 'appScGroupEdit' },
  { id: 'text', labelKey: 'appScGroupText' },
  { id: 'para', labelKey: 'appScGroupPara' },
  { id: 'insert', labelKey: 'appScGroupInsert' },
  { id: 'review', labelKey: 'appScGroupReview' },
  { id: 'view', labelKey: 'appScGroupView' },
]

export const SHORTCUTS: readonly ShortcutDef[] = [
  // ---- File ----
  { id: 'new', group: 'file', labelKey: 'appNew', action: 'docs-001' },
  { id: 'open', group: 'file', labelKey: 'ribbonOpen', action: 'docs-003' },
  { id: 'save', group: 'file', labelKey: 'appSave', action: 'docs-004' },
  { id: 'save-as', group: 'file', labelKey: 'ribbonSaveAs', action: 'docs-005' },
  { id: 'print', group: 'file', labelKey: 'appPrintTitle', action: 'docs-006' },
  { id: 'print-preview', group: 'file', labelKey: 'ribbonPagePreview', action: 'docs-007' },
  // web: the host's tab closes the document, the frame binds no key
  { id: 'close', group: 'file', labelKey: 'appClose', action: 'docs-008', desktopOnly: true },

  // ---- Edit ----
  { id: 'undo', group: 'edit', labelKey: 'appUndo', action: 'docs-010' },
  { id: 'redo', group: 'edit', labelKey: 'appRedo', action: 'docs-011' },
  { id: 'cut', group: 'edit', labelKey: 'appCut', action: 'docs-013' },
  { id: 'copy', group: 'edit', labelKey: 'appCopy', action: 'docs-014' },
  { id: 'paste', group: 'edit', labelKey: 'appPaste', action: 'docs-015' },
  { id: 'paste-plain', group: 'edit', labelKey: 'appPastePlain', action: 'docs-016' },
  { id: 'select-all', group: 'edit', labelKey: 'appScSelectAll', action: 'docs-017' },
  { id: 'find', group: 'edit', labelKey: 'appFindPlaceholder', action: 'docs-018' },
  { id: 'replace', group: 'edit', labelKey: 'appReplace', action: 'docs-020' },
  { id: 'goto', group: 'edit', labelKey: 'appGoToTitle', action: 'docs-021' },
  { id: 'shortcuts', group: 'edit', labelKey: 'appScTitle', action: 'docs-094' },

  // ---- Text formatting ----
  { id: 'bold', group: 'text', labelKey: 'appFontBold', action: 'docs-022' },
  { id: 'italic', group: 'text', labelKey: 'appFontItalic', action: 'docs-023' },
  { id: 'underline', group: 'text', labelKey: 'appUnderline', action: 'docs-024' },
  { id: 'strike', group: 'text', labelKey: 'ribbonStrikethrough', action: 'docs-026' },
  { id: 'font-dialog', group: 'text', labelKey: 'appFontDialogTitle', action: 'docs-033' },
  { id: 'grow-font', group: 'text', labelKey: 'ribbonGrowFont', action: 'docs-029' },
  { id: 'shrink-font', group: 'text', labelKey: 'ribbonShrinkFont', action: 'docs-030' },
  { id: 'grow-font-1pt', group: 'text', labelKey: 'appScGrowFont1', action: 'docs-031' },
  { id: 'shrink-font-1pt', group: 'text', labelKey: 'appScShrinkFont1', action: 'docs-032' },
  { id: 'superscript', group: 'text', labelKey: 'ribbonSuperscript', action: 'docs-028' },
  { id: 'subscript', group: 'text', labelKey: 'ribbonSubscript', action: 'docs-027' },
  { id: 'change-case', group: 'text', labelKey: 'ribbonChangeCase', action: 'docs-034' },
  { id: 'all-caps', group: 'text', labelKey: 'appAllCaps', action: 'docs-035' },
  { id: 'small-caps', group: 'text', labelKey: 'appSmallCaps', action: 'docs-036' },
  { id: 'copy-format', group: 'text', labelKey: 'ribbonCopyFormat', action: 'docs-040' },
  { id: 'paste-format', group: 'text', labelKey: 'ribbonPasteFormat', action: 'docs-041' },
  {
    id: 'clear-formatting',
    group: 'text',
    labelKey: 'ribbonClearFormatting',
    action: 'docs-039',
  },

  // ---- Paragraph formatting ----
  { id: 'align-left', group: 'para', labelKey: 'appScAlignLeft', action: 'docs-043' },
  { id: 'align-center', group: 'para', labelKey: 'appScAlignCenter', action: 'docs-044' },
  { id: 'align-right', group: 'para', labelKey: 'appScAlignRight', action: 'docs-045' },
  { id: 'align-justify', group: 'para', labelKey: 'appScJustify', action: 'docs-046' },
  {
    id: 'spacing-1',
    group: 'para',
    labelKey: 'ribbonLineSpacing',
    labelSuffix: ' 1.0',
    action: 'docs-047',
  },
  {
    id: 'spacing-15',
    group: 'para',
    labelKey: 'ribbonLineSpacing',
    labelSuffix: ' 1.5',
    action: 'docs-049',
  },
  {
    id: 'spacing-2',
    group: 'para',
    labelKey: 'ribbonLineSpacing',
    labelSuffix: ' 2.0',
    action: 'docs-048',
  },
  { id: 'indent', group: 'para', labelKey: 'ribbonIncreaseIndent', action: 'docs-050' },
  { id: 'outdent', group: 'para', labelKey: 'ribbonDecreaseIndent', action: 'docs-051' },
  { id: 'hanging-indent', group: 'para', labelKey: 'appScHangingIndent', action: 'docs-052' },
  {
    id: 'hanging-indent-off',
    group: 'para',
    labelKey: 'appScHangingIndentOff',
    action: 'docs-053',
  },
  { id: 'clear-para', group: 'para', labelKey: 'appScClearPara', action: 'docs-054' },
  { id: 'style-normal', group: 'para', labelKey: 'ribbonStyleNormal', action: 'docs-055' },
  { id: 'style-h1', group: 'para', labelKey: 'ribbonStyleHeading1', action: 'docs-056' },
  { id: 'style-h2', group: 'para', labelKey: 'ribbonStyleHeading2', action: 'docs-057' },
  { id: 'style-h3', group: 'para', labelKey: 'ribbonStyleHeading3', action: 'docs-058' },
  { id: 'bullets', group: 'para', labelKey: 'ribbonBullets', action: 'docs-060' },
  { id: 'numbering', group: 'para', labelKey: 'ribbonNumbering', action: 'docs-061' },
  // docs-064 covers both directions; Word for Mac's Control+Shift+Up/Down is Mission Control's
  {
    id: 'move-up',
    group: 'para',
    labelKey: 'appScMoveUp',
    native: { win: ['Alt+Shift+Up'], mac: ['Alt+Shift+Up'] },
  },
  {
    id: 'move-down',
    group: 'para',
    labelKey: 'appScMoveDown',
    native: { win: ['Alt+Shift+Down'], mac: ['Alt+Shift+Down'] },
  },
  // docs-062: the editor's list keymap
  {
    id: 'list-demote',
    group: 'para',
    labelKey: 'appScListDemote',
    native: { win: ['Tab'], mac: ['Tab'] },
  },
  {
    id: 'list-promote',
    group: 'para',
    labelKey: 'appScListPromote',
    native: { win: ['Shift+Tab'], mac: ['Shift+Tab'] },
  },

  // ---- Insert ----
  { id: 'page-break', group: 'insert', labelKey: 'ribbonPageBreak', action: 'docs-066' },
  { id: 'column-break', group: 'insert', labelKey: 'appScColumnBreak', action: 'docs-067' },
  { id: 'line-break', group: 'insert', labelKey: 'appScLineBreak', action: 'docs-065' },
  { id: 'link', group: 'insert', labelKey: 'ribbonLink', action: 'docs-071' },
  { id: 'comment', group: 'insert', labelKey: 'ribbonNewComment', action: 'docs-072' },
  { id: 'footnote', group: 'insert', labelKey: 'ribbonFootnote', action: 'docs-073' },
  { id: 'endnote', group: 'insert', labelKey: 'ribbonEndnote', action: 'docs-074' },
  { id: 'field-date', group: 'insert', labelKey: 'ribbonFieldDate', action: 'docs-075' },
  { id: 'field-time', group: 'insert', labelKey: 'ribbonFieldTime', action: 'docs-076' },
  { id: 'nbsp', group: 'insert', labelKey: 'appScNbsp', action: 'docs-068' },
  { id: 'nb-hyphen', group: 'insert', labelKey: 'appScNbHyphen', action: 'docs-069' },
  { id: 'opt-hyphen', group: 'insert', labelKey: 'appScOptHyphen', action: 'docs-070' },

  // ---- Review & tools ----
  { id: 'track-changes', group: 'review', labelKey: 'ribbonTrackChanges', action: 'docs-079' },
  { id: 'word-count', group: 'review', labelKey: 'appWordCountTitle', action: 'docs-081' },
  { id: 'proofread', group: 'review', labelKey: 'appScProofread', action: 'docs-080' },
  { id: 'update-fields', group: 'review', labelKey: 'appUpdateField', action: 'docs-077' },
  {
    id: 'toggle-field-codes',
    group: 'review',
    labelKey: 'appToggleFieldCodes',
    action: 'docs-078',
  },

  // ---- View ----
  // web: the browser zooms the page with these keys and the frame does not intercept them
  {
    id: 'zoom-in',
    group: 'view',
    labelKey: 'ribbonZoomIn',
    action: 'docs-082',
    desktopOnly: true,
  },
  {
    id: 'zoom-out',
    group: 'view',
    labelKey: 'ribbonZoomOut',
    action: 'docs-083',
    desktopOnly: true,
  },
  {
    id: 'zoom-100',
    group: 'view',
    labelKey: 'ribbonZoom100Tip',
    action: 'docs-084',
    desktopOnly: true,
  },
  { id: 'formatting-marks', group: 'view', labelKey: 'ribbonShowMarks', action: 'docs-042' },
  { id: 'ribbon-toggle', group: 'view', labelKey: 'ribbonCollapse', action: 'docs-086' },
  { id: 'ribbon-compact', group: 'view', labelKey: 'ribbonCompact', action: 'docs-087' },
]

const BY_ID = new Map(SHORTCUTS.map((def) => [def.id, def]))

/** This machine's key set: Windows/Linux (Ctrl) or macOS (Cmd). */
export const SHORTCUT_PLATFORM: ShortcutPlatform = currentShortcutPlatform()

/** The web frame answers to Microsoft 365 for the web's keys, the desktop app to Word's. */
export function shortcutSurface(): ShortcutSurface {
  return isWebFrame() ? 'web' : 'desktop'
}

/** The chords a command answers to on one platform and surface (primary first). */
export function shortcutChords(
  def: ShortcutDef,
  platform: ShortcutPlatform = SHORTCUT_PLATFORM,
  surface: ShortcutSurface = shortcutSurface(),
): readonly Chord[] {
  if (def.native) return def.native[platform]
  return def.action ? chordsFor(docsShortcut(def.action), platform, surface) : []
}

/** the chords as this platform's user sees them, alternates as 'A / B'; '' when there is none */
export function shortcutKeys(
  def: ShortcutDef,
  platform: ShortcutPlatform = SHORTCUT_PLATFORM,
  surface: ShortcutSurface = shortcutSurface(),
): string {
  return shortcutChords(def, platform, surface)
    .map((chord) => formatChord(chord, platform))
    .join(' / ')
}

/** The sheet's rows on this platform and surface: commands without a key there are left out. */
export function visibleShortcuts(
  platform: ShortcutPlatform = SHORTCUT_PLATFORM,
  surface: ShortcutSurface = shortcutSurface(),
): readonly ShortcutDef[] {
  return SHORTCUTS.filter(
    (def) =>
      !(surface === 'web' && def.desktopOnly) && shortcutChords(def, platform, surface).length > 0,
  )
}

/** Tooltip / menu text of a command's primary key (`Ctrl+B`, `⌘B`), or '' without one. */
export function shortcutHint(
  id: string,
  platform: ShortcutPlatform = SHORTCUT_PLATFORM,
  surface: ShortcutSurface = shortcutSurface(),
): string {
  const def = BY_ID.get(id)
  if (!def) throw new Error(`unknown docs shortcut ${id}`)
  if (def.native)
    return def.native[platform][0] ? formatChord(def.native[platform][0], platform) : ''
  return def.action ? formatHint(docsShortcut(def.action), platform, surface) : ''
}

/** A tooltip's label with the command's primary key appended: `Redo (Ctrl+Y)`; the bare label without one. */
export function shortcutTip(
  label: string,
  id: string,
  platform: ShortcutPlatform = SHORTCUT_PLATFORM,
  surface: ShortcutSurface = shortcutSurface(),
): string {
  const hint = shortcutHint(id, platform, surface)
  return hint ? `${label} (${hint})` : label
}

/**
 * Runs a command that exists only where the host grants it, and says whether
 * the key was consumed: a key the command did not act on must reach the
 * browser (F12 opens DevTools when Save As is withheld).
 */
export function consumeWhen(available: boolean, act: () => void): boolean {
  if (!available) return false
  act()
  return true
}

/**
 * A matcher over the given commands: maps a keydown to the command id it
 * fires, or null. IME composition, AltGr on Ctrl+Alt chords and the exact
 * modifier set are checked by the table's matcher.
 */
export function createShortcutMatcher(ids: readonly string[]) {
  const rows: ShortcutAction[] = []
  const commandOf = new Map<string, string>()
  for (const id of ids) {
    const action = BY_ID.get(id)?.action
    if (!action) throw new Error(`docs shortcut ${id} has no table row`)
    rows.push(docsShortcut(action))
    commandOf.set(action, id)
  }
  return (
    event: ShortcutKeyEvent,
    platform: ShortcutPlatform = SHORTCUT_PLATFORM,
    surface: ShortcutSurface = shortcutSurface(),
  ): string | null => {
    const hit = matchShortcut(event, rows, platform, surface)
    return hit ? (commandOf.get(hit.id) ?? null) : null
  }
}
