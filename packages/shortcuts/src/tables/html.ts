// html shortcut table. The block between the @generated markers is written
// by scripts/gen-tables.mjs from tests/fixtures/shortcuts.csv: change the CSV and
// regenerate, or put hand-maintained rows in `manual` below.
import { mergeRows } from '../table'
import type { ShortcutAction, ShortcutNote, UnmappedShortcut } from '../types'

// @generated-begin
const generated: readonly ShortcutAction[] = [
  // Open
  {
    id: 'html-001',
    scope: 'html',
    win: ['Ctrl+O'],
    mac: ['Cmd+O'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Save
  {
    id: 'html-002',
    scope: 'html',
    win: ['Ctrl+S'],
    mac: ['Cmd+S'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Save As
  {
    id: 'html-003',
    scope: 'html',
    win: ['F12'],
    mac: ['Shift+Cmd+S'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Print
  {
    id: 'html-004',
    scope: 'html',
    win: ['Ctrl+P'],
    mac: ['Cmd+P'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Close document
  {
    id: 'html-005',
    scope: 'html',
    win: ['Ctrl+W'],
    mac: [],
    web: { win: [], mac: [] },
    webAlt: { win: 'Alt+Shift+W' },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Undo
  {
    id: 'html-006',
    scope: 'html',
    win: ['Ctrl+Z'],
    mac: ['Cmd+Z'],
    match: 'key',
    guard: {},
  },
  // Redo
  {
    id: 'html-007',
    scope: 'html',
    win: ['Ctrl+Y'],
    mac: ['Cmd+Y'],
    match: 'key',
    guard: {},
  },
  // Cut
  {
    id: 'html-008',
    scope: 'html',
    win: ['Ctrl+X'],
    mac: ['Cmd+X'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Copy
  {
    id: 'html-009',
    scope: 'html',
    win: ['Ctrl+C'],
    mac: ['Cmd+C'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Paste
  {
    id: 'html-010',
    scope: 'html',
    win: ['Ctrl+V'],
    mac: ['Cmd+V'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Select all
  {
    id: 'html-011',
    scope: 'html',
    win: ['Ctrl+A'],
    mac: ['Cmd+A'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Find
  {
    id: 'html-012',
    scope: 'html',
    win: ['Ctrl+F'],
    mac: ['Cmd+F'],
    web: { win: ['Ctrl+F', 'Ctrl+G'], mac: ['Cmd+F'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Find next / repeat Find
  {
    id: 'html-013',
    scope: 'html',
    win: ['Shift+F4'],
    mac: ['Shift+F4'],
    match: 'key',
    guard: {},
  },
  // Replace
  {
    id: 'html-014',
    scope: 'html',
    win: ['Ctrl+H'],
    mac: [],
    web: { win: ['Ctrl+H'], mac: ['Ctrl+H'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Bold (preview selection)
  {
    id: 'html-015',
    scope: 'html',
    win: ['Ctrl+B'],
    mac: ['Cmd+B'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Italic (preview selection)
  {
    id: 'html-016',
    scope: 'html',
    win: ['Ctrl+I'],
    mac: ['Cmd+I'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Underline
  {
    id: 'html-017',
    scope: 'html',
    win: [],
    mac: [],
    web: { win: ['Ctrl+U'], mac: ['Cmd+U'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Insert hyperlink
  {
    id: 'html-018',
    scope: 'html',
    win: [],
    mac: [],
    web: { win: ['Ctrl+K'], mac: ['Cmd+K'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Zoom in
  {
    id: 'html-019',
    scope: 'html',
    win: ['Ctrl+Equal', 'Ctrl+Shift+Equal', 'Ctrl+NumpadAdd'],
    mac: ['Cmd+Equal', 'Shift+Cmd+Equal', 'Cmd+NumpadAdd'],
    match: 'key',
    guard: {},
  },
  // Zoom out
  {
    id: 'html-020',
    scope: 'html',
    win: ['Ctrl+Minus', 'Ctrl+NumpadSubtract'],
    mac: ['Cmd+Minus', 'Cmd+NumpadSubtract'],
    match: 'key',
    guard: {},
  },
  // Zoom 100%
  {
    id: 'html-021',
    scope: 'html',
    win: ['Ctrl+0', 'Ctrl+Numpad0'],
    mac: ['Cmd+0', 'Cmd+Numpad0'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Expand or collapse the ribbon
  {
    id: 'html-023',
    scope: 'html',
    win: ['Ctrl+F1'],
    mac: ['Alt+Cmd+R'],
    web: { win: [], mac: [] },
    webAlt: { win: 'Ctrl+F3' },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Cycle view mode (source / split / preview)
  {
    id: 'html-025',
    scope: 'html',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Backslash'], mac: ['Cmd+Backslash'] },
    match: 'key',
    guard: {},
  },
]

export const htmlUnmapped: readonly UnmappedShortcut[] = [
  {
    id: 'html-001',
    part: 'web.win',
    reason:
      'proposal has prose: "Ctrl+O / Cmd+O handled in the frame where UniWork has an Open action (capability-gated); MS Word web says Ctrl+O applies to the browser and prints no alternative or override setting, so the MS desktop key is kept ( where there is no Open action the browser keeps it"',
  },
  {
    id: 'html-001',
    part: 'web.mac',
    reason:
      'proposal has prose: "Ctrl+O / Cmd+O handled in the frame where UniWork has an Open action (capability-gated); MS Word web says Ctrl+O applies to the browser and prints no alternative or override setting, so the MS desktop key is kept ( where there is no Open action the browser keeps it"',
  },
  {
    id: 'html-005',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'html-014',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'html-017',
    part: 'desktop.win',
    reason: 'proposal has prose: "same"',
  },
  {
    id: 'html-017',
    part: 'desktop.mac',
    reason: 'proposal has prose: "same"',
  },
  {
    id: 'html-018',
    part: 'desktop.win',
    reason: 'proposal has prose: "same"',
  },
  {
    id: 'html-018',
    part: 'desktop.mac',
    reason: 'proposal has prose: "same"',
  },
  {
    id: 'html-022',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "Ctrl+Scroll / Cmd+Scroll"',
  },
  {
    id: 'html-024',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "Esc / Esc"',
  },
  {
    id: 'html-025',
    part: 'desktop.win',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'html-025',
    part: 'desktop.mac',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'html-026',
    part: 'row',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'html-027',
    part: 'row',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'html-028',
    part: 'row',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
]

export const htmlNotes: readonly ShortcutNote[] = [
  {
    id: 'html-001',
    part: 'web',
    detail:
      'ALT-PROPOSED without a single chord: ", not Chromium-reserved); where there is no Open action the"',
  },
  {
    id: 'html-005',
    part: 'web.mac',
    detail: 'no web chord (not documented)',
  },
  {
    id: 'html-023',
    part: 'web.mac',
    detail: 'no web chord (not documented)',
  },
]
// @generated-end

/** Hand-maintained rows: an entry with a generated id replaces that row. */
const manual: readonly ShortcutAction[] = []

export const htmlShortcuts: readonly ShortcutAction[] = mergeRows(generated, manual)

/** Why a manual row has no chord on a surface or platform, and remarks on manual rows:
 * merged after the generated lists into `SHORTCUT_UNMAPPED` / `SHORTCUT_NOTES`. */
export const htmlManualUnmapped: readonly UnmappedShortcut[] = []
export const htmlManualNotes: readonly ShortcutNote[] = []
