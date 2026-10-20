// markdown shortcut table. The block between the @generated markers is written
// by scripts/gen-tables.mjs from tests/fixtures/shortcuts.csv: change the CSV and
// regenerate, or put hand-maintained rows in `manual` below.
import { mergeRows } from '../table'
import type { ShortcutAction, ShortcutNote, UnmappedShortcut } from '../types'

// @generated-begin
const generated: readonly ShortcutAction[] = [
  // Open
  {
    id: 'markdown-001',
    scope: 'markdown',
    win: ['Ctrl+O'],
    mac: ['Cmd+O'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Save
  {
    id: 'markdown-002',
    scope: 'markdown',
    win: ['Ctrl+S'],
    mac: ['Cmd+S'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Save As
  {
    id: 'markdown-003',
    scope: 'markdown',
    win: ['F12'],
    mac: ['Shift+Cmd+S'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Print
  {
    id: 'markdown-004',
    scope: 'markdown',
    win: ['Ctrl+P'],
    mac: ['Cmd+P'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Close document
  {
    id: 'markdown-005',
    scope: 'markdown',
    win: ['Ctrl+W'],
    mac: [],
    web: { win: [], mac: [] },
    webAlt: { win: 'Alt+Shift+W' },
    match: 'key',
    guard: { noRepeat: true },
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
    guard: { noRepeat: true },
  },
  // Copy
  {
    id: 'markdown-009',
    scope: 'markdown',
    win: ['Ctrl+C'],
    mac: ['Cmd+C'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Paste
  {
    id: 'markdown-010',
    scope: 'markdown',
    win: ['Ctrl+V'],
    mac: ['Cmd+V'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Paste text only
  {
    id: 'markdown-011',
    scope: 'markdown',
    win: ['Ctrl+Shift+V'],
    mac: ['Shift+Cmd+V'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Select all
  {
    id: 'markdown-012',
    scope: 'markdown',
    win: ['Ctrl+A'],
    mac: ['Cmd+A'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Find
  {
    id: 'markdown-013',
    scope: 'markdown',
    win: ['Ctrl+F'],
    mac: ['Cmd+F'],
    web: { win: ['Ctrl+F', 'Ctrl+G'], mac: ['Cmd+F'] },
    match: 'key',
    guard: { noRepeat: true },
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
    win: ['Ctrl+H'],
    mac: [],
    web: { win: ['Ctrl+H'], mac: ['Ctrl+H'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Bold
  {
    id: 'markdown-016',
    scope: 'markdown',
    win: ['Ctrl+B'],
    mac: ['Cmd+B'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Italic
  {
    id: 'markdown-017',
    scope: 'markdown',
    win: ['Ctrl+I'],
    mac: ['Cmd+I'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Strikethrough
  {
    id: 'markdown-019',
    scope: 'markdown',
    win: [],
    mac: ['Shift+Cmd+X'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Heading 1
  {
    id: 'markdown-022',
    scope: 'markdown',
    win: ['Ctrl+Alt+1'],
    mac: ['Alt+Cmd+1'],
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  // Heading 2
  {
    id: 'markdown-023',
    scope: 'markdown',
    win: ['Ctrl+Alt+2'],
    mac: ['Alt+Cmd+2'],
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  // Heading 3
  {
    id: 'markdown-024',
    scope: 'markdown',
    win: ['Ctrl+Alt+3'],
    mac: ['Alt+Cmd+3'],
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  // Normal text (paragraph)
  {
    id: 'markdown-025',
    scope: 'markdown',
    win: [],
    mac: [],
    webAlt: { win: 'Ctrl+Alt+0', mac: 'Alt+Cmd+0' },
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
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
    guard: { noRepeat: true },
  },
  // Numbered list
  {
    id: 'markdown-027',
    scope: 'markdown',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Slash'], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Insert hyperlink
  {
    id: 'markdown-029',
    scope: 'markdown',
    win: ['Ctrl+K'],
    mac: ['Cmd+K'],
    match: 'key',
    guard: { noRepeat: true },
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
    guard: { noRepeat: true },
  },
  // Zoom in
  {
    id: 'markdown-033',
    scope: 'markdown',
    win: ['Ctrl+Equal', 'Ctrl+Shift+Equal', 'Ctrl+NumpadAdd'],
    mac: ['Cmd+Equal', 'Shift+Cmd+Equal', 'Cmd+NumpadAdd'],
    match: 'key',
    guard: {},
  },
  // Zoom out
  {
    id: 'markdown-034',
    scope: 'markdown',
    win: ['Ctrl+Minus', 'Ctrl+NumpadSubtract'],
    mac: ['Cmd+Minus', 'Cmd+NumpadSubtract'],
    match: 'key',
    guard: {},
  },
  // Zoom 100%
  {
    id: 'markdown-035',
    scope: 'markdown',
    win: ['Ctrl+0', 'Ctrl+Numpad0'],
    mac: ['Cmd+0', 'Cmd+Numpad0'],
    match: 'key',
    guard: { noRepeat: true },
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
    guard: { noRepeat: true },
  },
]

export const markdownUnmapped: readonly UnmappedShortcut[] = [
  {
    id: 'markdown-001',
    part: 'web.win',
    reason:
      'proposal has prose: "Ctrl+O / Cmd+O handled in the frame where UniWork has an Open action (capability-gated); MS Word web says Ctrl+O applies to the browser and prints no alternative or override setting, so the MS desktop key is kept ( where there is no Open action the browser keeps it"',
  },
  {
    id: 'markdown-001',
    part: 'web.mac',
    reason:
      'proposal has prose: "Ctrl+O / Cmd+O handled in the frame where UniWork has an Open action (capability-gated); MS Word web says Ctrl+O applies to the browser and prints no alternative or override setting, so the MS desktop key is kept ( where there is no Open action the browser keeps it"',
  },
  {
    id: 'markdown-005',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'markdown-015',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'markdown-018',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "KEEP (no underline mark in Markdown); if ever added: Ctrl+U / Cmd+U (MS web)"',
  },
  {
    id: 'markdown-019',
    part: 'web.win',
    reason:
      'proposal is conditional: "Ctrl+Shift+S / Cmd+Shift+X (Windows: MS prints no key, current Ctrl+Shift+S stays once Save As is F12 only; Mac: Cmd+Shift+S goes to Save As)"',
  },
  {
    id: 'markdown-019',
    part: 'web.mac',
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
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "none: Ctrl+E / Cmd+E belongs to the source toggle (markdown-021); inline code stays on the toolbar and backticks (MS web prints no inline-code key; pick a free chord with"',
  },
  {
    id: 'markdown-021',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: proposal has prose: "KEEP Ctrl+E / Cmd+E for the source toggle (ours-only; MS web Ctrl+E = Center, Markdown has no alignment; the only action on this chord, markdown-020 gave it up)"',
  },
  {
    id: 'markdown-025',
    part: 'desktop.win',
    reason: 'proposal has prose: "Ctrl+Shift+N / Cmd+Shift+N (MS) when the shell frees it"',
  },
  {
    id: 'markdown-025',
    part: 'desktop.mac',
    reason: 'proposal has prose: "Ctrl+Shift+N / Cmd+Shift+N (MS) when the shell frees it"',
  },
  {
    id: 'markdown-027',
    part: 'desktop.win',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'markdown-027',
    part: 'desktop.mac',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
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
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "Ctrl+Scroll / Cmd+Scroll"',
  },
  {
    id: 'markdown-038',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "Esc / Esc"',
  },
  {
    id: 'markdown-039',
    part: 'row',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'markdown-040',
    part: 'row',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
]

export const markdownNotes: readonly ShortcutNote[] = [
  {
    id: 'markdown-001',
    part: 'web',
    detail:
      'ALT-PROPOSED without a single chord: ", not Chromium-reserved); where there is no Open action the"',
  },
  {
    id: 'markdown-005',
    part: 'web.mac',
    detail: 'no web chord (not documented)',
  },
  {
    id: 'markdown-026',
    part: 'web.mac',
    detail: 'no web chord (not documented)',
  },
  {
    id: 'markdown-027',
    part: 'web.mac',
    detail: 'no web chord (not documented)',
  },
  {
    id: 'markdown-037',
    part: 'web.mac',
    detail: 'no web chord (not documented)',
  },
]
// @generated-end

/** Hand-maintained rows: an entry with a generated id replaces that row. */
const manual: readonly ShortcutAction[] = [
  // Redo: Ctrl+Y (Word); the existing Ctrl+Shift+Z / Cmd+Shift+Z stays
  {
    id: 'markdown-007',
    scope: 'markdown',
    win: ['Ctrl+Y', 'Ctrl+Shift+Z'],
    mac: ['Cmd+Y', 'Shift+Cmd+Z'],
    match: 'key',
    guard: {},
  },
  // Replace: macOS keeps Control+H (the menu's Cmd+H is the system Hide role)
  {
    id: 'markdown-015',
    scope: 'markdown',
    win: ['Ctrl+H'],
    mac: ['Ctrl+H'],
    web: { win: ['Ctrl+H'], mac: ['Ctrl+H'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Strikethrough: Word for Mac's Shift+Cmd+X; on Windows Save As is F12 only, so Ctrl+Shift+S is free for it
  {
    id: 'markdown-019',
    scope: 'markdown',
    win: ['Ctrl+Shift+S'],
    mac: ['Shift+Cmd+X'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Toggle source / edit view: ours-only, the only action on Ctrl+E now that inline code gave it up
  {
    id: 'markdown-021',
    scope: 'markdown',
    win: ['Ctrl+E'],
    mac: ['Cmd+E'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Normal text: the existing Ctrl+Alt+0 keeps the primary slot until the shell frees Ctrl+Shift+N
  {
    id: 'markdown-025',
    scope: 'markdown',
    win: ['Ctrl+Alt+0'],
    mac: ['Alt+Cmd+0'],
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  // Bulleted list: Ctrl+Shift+L (Word) first, the existing Ctrl+Shift+8 stays as a second chord
  {
    id: 'markdown-026',
    scope: 'markdown',
    win: ['Ctrl+Shift+L', 'Ctrl+Shift+8'],
    mac: ['Shift+Cmd+L', 'Shift+Cmd+8'],
    web: { win: ['Ctrl+Shift+8'], mac: ['Shift+Cmd+8'] },
    webAlt: { win: 'Ctrl+Period' },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Numbered list: the existing Ctrl+Shift+7 stays; the web adds Microsoft's Ctrl+/
  {
    id: 'markdown-027',
    scope: 'markdown',
    win: ['Ctrl+Shift+7'],
    mac: ['Shift+Cmd+7'],
    web: { win: ['Ctrl+Slash', 'Ctrl+Shift+7'], mac: ['Shift+Cmd+7'] },
    match: 'key',
    guard: { noRepeat: true },
  },
]

export const markdownShortcuts: readonly ShortcutAction[] = mergeRows(generated, manual)

/** Why a manual row has no chord on a surface or platform, and remarks on manual rows:
 * merged after the generated lists into `SHORTCUT_UNMAPPED` / `SHORTCUT_NOTES`. */
export const markdownManualUnmapped: readonly UnmappedShortcut[] = []
export const markdownManualNotes: readonly ShortcutNote[] = []
