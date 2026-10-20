// html shortcut table. The block between the @generated markers is written
// by scripts/gen-tables.mjs from tests/fixtures/shortcuts.csv: change the CSV and
// regenerate, or put hand-maintained rows in `manual` below.
import { mergeRows } from '../table'
import type { ShortcutAction, UnmappedShortcut } from '../types'

// @generated-begin
const generated: readonly ShortcutAction[] = [
  // Open
  {
    id: 'html-001',
    scope: 'html',
    win: ['Ctrl+O'],
    mac: ['Cmd+O'],
    match: 'key',
    guard: {},
  },
  // Save
  {
    id: 'html-002',
    scope: 'html',
    win: ['Ctrl+S'],
    mac: ['Cmd+S'],
    match: 'key',
    guard: {},
  },
  // Save As
  {
    id: 'html-003',
    scope: 'html',
    win: ['F12'],
    mac: ['Shift+Cmd+S'],
    match: 'key',
    guard: {},
  },
  // Print
  {
    id: 'html-004',
    scope: 'html',
    win: ['Ctrl+P'],
    mac: ['Cmd+P'],
    match: 'key',
    guard: {},
  },
  // Close document
  {
    id: 'html-005',
    scope: 'html',
    win: [],
    mac: [],
    webAlt: { win: 'Alt+Shift+W' },
    match: 'key',
    guard: {},
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
    guard: {},
  },
  // Copy
  {
    id: 'html-009',
    scope: 'html',
    win: ['Ctrl+C'],
    mac: ['Cmd+C'],
    match: 'key',
    guard: {},
  },
  // Paste
  {
    id: 'html-010',
    scope: 'html',
    win: ['Ctrl+V'],
    mac: ['Cmd+V'],
    match: 'key',
    guard: {},
  },
  // Select all
  {
    id: 'html-011',
    scope: 'html',
    win: ['Ctrl+A'],
    mac: ['Cmd+A'],
    match: 'key',
    guard: {},
  },
  // Find
  {
    id: 'html-012',
    scope: 'html',
    win: ['Ctrl+F'],
    mac: ['Cmd+F'],
    web: { win: ['Ctrl+F', 'Ctrl+G'], mac: ['Cmd+F'] },
    match: 'key',
    guard: {},
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
    win: [],
    mac: [],
    web: { win: ['Ctrl+H'], mac: ['Ctrl+H'] },
    match: 'key',
    guard: {},
  },
  // Bold (preview selection)
  {
    id: 'html-015',
    scope: 'html',
    win: ['Ctrl+B'],
    mac: ['Cmd+B'],
    match: 'key',
    guard: {},
  },
  // Italic (preview selection)
  {
    id: 'html-016',
    scope: 'html',
    win: ['Ctrl+I'],
    mac: ['Cmd+I'],
    match: 'key',
    guard: {},
  },
  // Underline
  {
    id: 'html-017',
    scope: 'html',
    win: [],
    mac: [],
    web: { win: ['Ctrl+U'], mac: ['Cmd+U'] },
    match: 'key',
    guard: {},
  },
  // Insert hyperlink
  {
    id: 'html-018',
    scope: 'html',
    win: [],
    mac: [],
    web: { win: ['Ctrl+K'], mac: ['Cmd+K'] },
    match: 'key',
    guard: {},
  },
  // Zoom in
  {
    id: 'html-019',
    scope: 'html',
    win: ['Ctrl+Equal'],
    mac: ['Cmd+Equal'],
    match: 'key',
    guard: {},
  },
  // Zoom out
  {
    id: 'html-020',
    scope: 'html',
    win: ['Ctrl+Minus'],
    mac: ['Cmd+Minus'],
    match: 'key',
    guard: {},
  },
  // Zoom 100%
  {
    id: 'html-021',
    scope: 'html',
    win: ['Ctrl+0'],
    mac: ['Cmd+0'],
    match: 'key',
    guard: {},
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
    guard: {},
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
    id: 'html-005',
    part: 'desktop',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'html-005',
    part: 'web.mac',
    reason: 'mac: no web chord (not documented)',
  },
  {
    id: 'html-014',
    part: 'desktop',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'html-017',
    part: 'desktop',
    reason: 'proposal has prose: "same"',
  },
  {
    id: 'html-018',
    part: 'desktop',
    reason: 'proposal has prose: "same"',
  },
  {
    id: 'html-022',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; web: proposal has prose: "Ctrl+Scroll / Cmd+Scroll"',
  },
  {
    id: 'html-023',
    part: 'web.mac',
    reason: 'mac: no web chord (not documented)',
  },
  {
    id: 'html-024',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; web: proposal has prose: "Esc / Esc"',
  },
  {
    id: 'html-025',
    part: 'desktop',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'html-026',
    part: 'row',
    reason: "KEEP: no Microsoft win chord confirmed by today's binding",
  },
  {
    id: 'html-027',
    part: 'row',
    reason: "KEEP: no Microsoft win chord confirmed by today's binding",
  },
  {
    id: 'html-028',
    part: 'row',
    reason: "KEEP: no Microsoft win chord confirmed by today's binding",
  },
]
// @generated-end

/** Hand-maintained rows: an entry with a generated id replaces that row. */
const manual: readonly ShortcutAction[] = []

export const htmlShortcuts: readonly ShortcutAction[] = mergeRows(generated, manual)
