// markdown shortcut table. The block between the @generated markers is written
// by scripts/gen-tables.mjs from tests/fixtures/shortcuts.csv: change the CSV and
// regenerate, or put hand-maintained rows in `manual` below.
import { mergeRows } from '../table'
import type { ShortcutAction, UnmappedShortcut } from '../types'

// @generated-begin
const generated: readonly ShortcutAction[] = [
  // Open
  {
    id: 'markdown-001',
    scope: 'markdown',
    win: ['Ctrl+O'],
    mac: ['Cmd+O'],
    match: 'key',
    guard: {},
  },
  // Save
  {
    id: 'markdown-002',
    scope: 'markdown',
    win: ['Ctrl+S'],
    mac: ['Cmd+S'],
    match: 'key',
    guard: {},
  },
  // Save As
  {
    id: 'markdown-003',
    scope: 'markdown',
    win: ['F12'],
    mac: ['Shift+Cmd+S'],
    match: 'key',
    guard: {},
  },
  // Print
  {
    id: 'markdown-004',
    scope: 'markdown',
    win: ['Ctrl+P'],
    mac: ['Cmd+P'],
    match: 'key',
    guard: {},
  },
  // Close document
  {
    id: 'markdown-005',
    scope: 'markdown',
    win: [],
    mac: [],
    webAlt: { win: 'Alt+Shift+W' },
    match: 'key',
    guard: {},
  },
  // Undo
  {
    id: 'markdown-006',
    scope: 'markdown',
    win: ['Ctrl+Z'],
    mac: ['Cmd+Z'],
    match: 'key',
    guard: {},
  },
  // Redo
  {
    id: 'markdown-007',
    scope: 'markdown',
    win: ['Ctrl+Y'],
    mac: ['Cmd+Y'],
    match: 'key',
    guard: {},
  },
  // Cut
  {
    id: 'markdown-008',
    scope: 'markdown',
    win: ['Ctrl+X'],
    mac: ['Cmd+X'],
    match: 'key',
    guard: {},
  },
  // Copy
  {
    id: 'markdown-009',
    scope: 'markdown',
    win: ['Ctrl+C'],
    mac: ['Cmd+C'],
    match: 'key',
    guard: {},
  },
  // Paste
  {
    id: 'markdown-010',
    scope: 'markdown',
    win: ['Ctrl+V'],
    mac: ['Cmd+V'],
    match: 'key',
    guard: {},
  },
  // Paste text only
  {
    id: 'markdown-011',
    scope: 'markdown',
    win: ['Ctrl+Shift+V'],
    mac: ['Shift+Cmd+V'],
    match: 'key',
    guard: {},
  },
  // Select all
  {
    id: 'markdown-012',
    scope: 'markdown',
    win: ['Ctrl+A'],
    mac: ['Cmd+A'],
    match: 'key',
    guard: {},
  },
  // Find
  {
    id: 'markdown-013',
    scope: 'markdown',
    win: ['Ctrl+F'],
    mac: ['Cmd+F'],
    web: { win: ['Ctrl+F', 'Ctrl+G'], mac: ['Cmd+F'] },
    match: 'key',
    guard: {},
  },
  // Find next / repeat Find
  {
    id: 'markdown-014',
    scope: 'markdown',
    win: ['Shift+F4'],
    mac: ['Shift+F4'],
    match: 'key',
    guard: {},
  },
  // Replace
  {
    id: 'markdown-015',
    scope: 'markdown',
    win: [],
    mac: [],
    web: { win: ['Ctrl+H'], mac: ['Ctrl+H'] },
    match: 'key',
    guard: {},
  },
  // Bold
  {
    id: 'markdown-016',
    scope: 'markdown',
    win: ['Ctrl+B'],
    mac: ['Cmd+B'],
    match: 'key',
    guard: {},
  },
  // Italic
  {
    id: 'markdown-017',
    scope: 'markdown',
    win: ['Ctrl+I'],
    mac: ['Cmd+I'],
    match: 'key',
    guard: {},
  },
  // Strikethrough
  {
    id: 'markdown-019',
    scope: 'markdown',
    win: [],
    mac: ['Shift+Cmd+X'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: {},
  },
  // Toggle source / edit view
  {
    id: 'markdown-021',
    scope: 'markdown',
    win: [],
    mac: [],
    web: { win: ['Ctrl+E'], mac: ['Cmd+E'] },
    match: 'key',
    guard: {},
  },
  // Heading 1
  {
    id: 'markdown-022',
    scope: 'markdown',
    win: ['Ctrl+Alt+1'],
    mac: ['Alt+Cmd+1'],
    match: 'key',
    guard: { altGraph: true },
  },
  // Heading 2
  {
    id: 'markdown-023',
    scope: 'markdown',
    win: ['Ctrl+Alt+2'],
    mac: ['Alt+Cmd+2'],
    match: 'key',
    guard: { altGraph: true },
  },
  // Heading 3
  {
    id: 'markdown-024',
    scope: 'markdown',
    win: ['Ctrl+Alt+3'],
    mac: ['Alt+Cmd+3'],
    match: 'key',
    guard: { altGraph: true },
  },
  // Normal text (paragraph)
  {
    id: 'markdown-025',
    scope: 'markdown',
    win: [],
    mac: [],
    webAlt: { win: 'Ctrl+Alt+0', mac: 'Alt+Cmd+0' },
    match: 'key',
    guard: { altGraph: true },
  },
  // Bulleted list
  {
    id: 'markdown-026',
    scope: 'markdown',
    win: ['Ctrl+Shift+L'],
    mac: ['Shift+Cmd+L'],
    web: { win: [], mac: [] },
    webAlt: { win: 'Ctrl+Period' },
    match: 'key',
    guard: {},
  },
  // Numbered list
  {
    id: 'markdown-027',
    scope: 'markdown',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Slash'], mac: [] },
    match: 'key',
    guard: {},
  },
  // Insert hyperlink
  {
    id: 'markdown-029',
    scope: 'markdown',
    win: ['Ctrl+K'],
    mac: ['Cmd+K'],
    match: 'key',
    guard: {},
  },
  // Insert line break
  {
    id: 'markdown-030',
    scope: 'markdown',
    win: ['Shift+Enter'],
    mac: ['Shift+Enter'],
    match: 'key',
    guard: {},
  },
  // Duplicate block
  {
    id: 'markdown-031',
    scope: 'markdown',
    win: ['Ctrl+D'],
    mac: ['Cmd+D'],
    match: 'key',
    guard: {},
  },
  // Zoom in
  {
    id: 'markdown-033',
    scope: 'markdown',
    win: ['Ctrl+Equal'],
    mac: ['Cmd+Equal'],
    match: 'key',
    guard: {},
  },
  // Zoom out
  {
    id: 'markdown-034',
    scope: 'markdown',
    win: ['Ctrl+Minus'],
    mac: ['Cmd+Minus'],
    match: 'key',
    guard: {},
  },
  // Zoom 100%
  {
    id: 'markdown-035',
    scope: 'markdown',
    win: ['Ctrl+0'],
    mac: ['Cmd+0'],
    match: 'key',
    guard: {},
  },
  // Expand or collapse the ribbon
  {
    id: 'markdown-037',
    scope: 'markdown',
    win: ['Ctrl+F1'],
    mac: ['Alt+Cmd+R'],
    web: { win: [], mac: [] },
    webAlt: { win: 'Ctrl+F3' },
    match: 'key',
    guard: {},
  },
]

export const markdownUnmapped: readonly UnmappedShortcut[] = [
  {
    id: 'markdown-005',
    part: 'desktop',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'markdown-005',
    part: 'web.mac',
    reason: 'mac: no web chord (not documented)',
  },
  {
    id: 'markdown-015',
    part: 'desktop',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'markdown-018',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; web: proposal has prose: "KEEP (no underline mark in Markdown); if ever added: Ctrl+U / Cmd+U (MS web)"',
  },
  {
    id: 'markdown-019',
    part: 'web',
    reason:
      'proposal is conditional: "Ctrl+Shift+S / Cmd+Shift+X (Windows: MS prints no key, current Ctrl+Shift+S stays once Save As is F12 only; Mac: Cmd+Shift+S goes to Save As)"',
  },
  {
    id: 'markdown-019',
    part: 'desktop.win',
    reason: 'no win chord in proposal_desktop',
  },
  {
    id: 'markdown-020',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; web: proposal has prose: "KEEP Ctrl+E / Cmd+E for the source toggle (MS web Ctrl+E = Center; Markdown has no alignment)"',
  },
  {
    id: 'markdown-021',
    part: 'desktop',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'markdown-025',
    part: 'desktop',
    reason: 'proposal has prose: "Ctrl+Shift+N / Cmd+Shift+N (MS) when the shell frees it"',
  },
  {
    id: 'markdown-026',
    part: 'web.mac',
    reason: 'mac: no web chord (not documented)',
  },
  {
    id: 'markdown-027',
    part: 'desktop',
    reason: "KEEP: no Microsoft win chord confirmed by today's binding",
  },
  {
    id: 'markdown-027',
    part: 'web.mac',
    reason: 'mac: no web chord (not documented)',
  },
  {
    id: 'markdown-028',
    part: 'row',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'markdown-032',
    part: 'row',
    reason:
      'desktop: proposal has prose: "same"; web: proposal has prose: "Alt+Shift+Up|Down for move block (MS desktop paragraph-move key, same chord as docs-064; Delete block keeps its own key)"',
  },
  {
    id: 'markdown-036',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; web: proposal has prose: "Ctrl+Scroll / Cmd+Scroll"',
  },
  {
    id: 'markdown-037',
    part: 'web.mac',
    reason: 'mac: no web chord (not documented)',
  },
  {
    id: 'markdown-038',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; web: proposal has prose: "Esc / Esc"',
  },
  {
    id: 'markdown-039',
    part: 'row',
    reason: "KEEP: no Microsoft win chord confirmed by today's binding",
  },
  {
    id: 'markdown-040',
    part: 'row',
    reason: "KEEP: no Microsoft win chord confirmed by today's binding",
  },
]
// @generated-end

/** Hand-maintained rows: an entry with a generated id replaces that row. */
const manual: readonly ShortcutAction[] = []

export const markdownShortcuts: readonly ShortcutAction[] = mergeRows(generated, manual)
