// docs shortcut table. The block between the @generated markers is written
// by scripts/gen-tables.mjs from tests/fixtures/shortcuts.csv: change the CSV and
// regenerate, or put hand-maintained rows in `manual` below.
import { mergeRows } from '../table'
import type { ShortcutAction, ShortcutNote, UnmappedShortcut } from '../types'

// @generated-begin
const generated: readonly ShortcutAction[] = [
  // New document
  {
    id: 'docs-001',
    scope: 'docs',
    win: ['Ctrl+N'],
    mac: ['Cmd+N'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Open
  {
    id: 'docs-003',
    scope: 'docs',
    win: ['Ctrl+O'],
    mac: ['Cmd+O'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Save
  {
    id: 'docs-004',
    scope: 'docs',
    win: ['Ctrl+S'],
    mac: ['Cmd+S'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Print
  {
    id: 'docs-006',
    scope: 'docs',
    win: ['Ctrl+P'],
    mac: ['Cmd+P'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Print preview
  {
    id: 'docs-007',
    scope: 'docs',
    win: ['Ctrl+Alt+I'],
    mac: [],
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  // Close document
  {
    id: 'docs-008',
    scope: 'docs',
    win: ['Ctrl+W'],
    mac: ['Cmd+W'],
    web: { win: [], mac: [] },
    webAlt: { win: 'Alt+Shift+W' },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Undo
  {
    id: 'docs-010',
    scope: 'docs',
    win: ['Ctrl+Z'],
    mac: ['Cmd+Z'],
    match: 'key',
    guard: {},
  },
  // Redo
  {
    id: 'docs-011',
    scope: 'docs',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Y'], mac: ['Cmd+Y'] },
    match: 'key',
    guard: {},
  },
  // Cut
  {
    id: 'docs-013',
    scope: 'docs',
    win: ['Ctrl+X'],
    mac: ['Cmd+X'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Copy
  {
    id: 'docs-014',
    scope: 'docs',
    win: ['Ctrl+C'],
    mac: ['Cmd+C'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Paste
  {
    id: 'docs-015',
    scope: 'docs',
    win: ['Ctrl+V'],
    mac: ['Cmd+V'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Paste text only
  {
    id: 'docs-016',
    scope: 'docs',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Shift+V'], mac: ['Shift+Cmd+V'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Select all
  {
    id: 'docs-017',
    scope: 'docs',
    win: ['Ctrl+A'],
    mac: ['Cmd+A'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Find (Navigation pane)
  {
    id: 'docs-018',
    scope: 'docs',
    win: ['Ctrl+F'],
    mac: ['Cmd+F'],
    web: { win: ['Ctrl+F', 'Ctrl+G'], mac: ['Cmd+F'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Find next / repeat Find
  {
    id: 'docs-019',
    scope: 'docs',
    win: ['Shift+F4'],
    mac: ['Shift+F4'],
    match: 'key',
    guard: {},
  },
  // Replace
  {
    id: 'docs-020',
    scope: 'docs',
    win: ['Ctrl+H'],
    mac: ['Ctrl+H'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Go To
  {
    id: 'docs-021',
    scope: 'docs',
    win: ['Ctrl+G'],
    mac: ['Alt+Cmd+G'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Bold
  {
    id: 'docs-022',
    scope: 'docs',
    win: ['Ctrl+B'],
    mac: ['Cmd+B'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Italic
  {
    id: 'docs-023',
    scope: 'docs',
    win: ['Ctrl+I'],
    mac: ['Cmd+I'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Underline
  {
    id: 'docs-024',
    scope: 'docs',
    win: ['Ctrl+U'],
    mac: ['Cmd+U'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Double underline
  {
    id: 'docs-025',
    scope: 'docs',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Shift+D'], mac: ['Shift+Cmd+D'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Strikethrough
  {
    id: 'docs-026',
    scope: 'docs',
    win: [],
    mac: [],
    web: { win: [], mac: ['Shift+Cmd+X'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Subscript
  {
    id: 'docs-027',
    scope: 'docs',
    win: ['Ctrl+Shift+Minus'],
    mac: ['Shift+Cmd+Minus'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Superscript
  {
    id: 'docs-028',
    scope: 'docs',
    win: ['Ctrl+Shift+Equal'],
    mac: [],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Increase font size (preset steps)
  {
    id: 'docs-029',
    scope: 'docs',
    win: ['Ctrl+Shift+Period'],
    mac: ['Shift+Cmd+Period'],
    match: 'key',
    guard: {},
  },
  // Decrease font size (preset steps)
  {
    id: 'docs-030',
    scope: 'docs',
    win: ['Ctrl+Shift+Comma'],
    mac: ['Shift+Cmd+Comma'],
    match: 'key',
    guard: {},
  },
  // Increase font size 1 point
  {
    id: 'docs-031',
    scope: 'docs',
    win: ['Ctrl+BracketRight'],
    mac: ['Cmd+BracketRight'],
    match: 'key',
    guard: {},
  },
  // Decrease font size 1 point
  {
    id: 'docs-032',
    scope: 'docs',
    win: ['Ctrl+BracketLeft'],
    mac: ['Cmd+BracketLeft'],
    match: 'key',
    guard: {},
  },
  // Font dialog
  {
    id: 'docs-033',
    scope: 'docs',
    win: [],
    mac: [],
    web: { win: ['Ctrl+D'], mac: ['Cmd+D'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Change case
  {
    id: 'docs-034',
    scope: 'docs',
    win: ['Shift+F3'],
    mac: ['Shift+F3'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // All caps
  {
    id: 'docs-035',
    scope: 'docs',
    win: ['Ctrl+Shift+A'],
    mac: ['Shift+Cmd+A'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Small caps
  {
    id: 'docs-036',
    scope: 'docs',
    win: ['Ctrl+Shift+K'],
    mac: ['Shift+Cmd+K'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Hidden text
  {
    id: 'docs-037',
    scope: 'docs',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Shift+H'], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Underline words only
  {
    id: 'docs-038',
    scope: 'docs',
    win: ['Ctrl+Shift+W'],
    mac: [],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Clear character formatting
  {
    id: 'docs-039',
    scope: 'docs',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Space'], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Copy formatting
  {
    id: 'docs-040',
    scope: 'docs',
    win: ['Ctrl+Alt+C'],
    mac: ['Alt+Cmd+C'],
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  // Paste formatting
  {
    id: 'docs-041',
    scope: 'docs',
    win: ['Ctrl+Alt+V'],
    mac: ['Alt+Cmd+V'],
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  // Show / hide formatting marks
  {
    id: 'docs-042',
    scope: 'docs',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Shift+8'], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Align left
  {
    id: 'docs-043',
    scope: 'docs',
    win: ['Ctrl+L'],
    mac: ['Cmd+L'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Center
  {
    id: 'docs-044',
    scope: 'docs',
    win: ['Ctrl+E'],
    mac: ['Cmd+E'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Align right
  {
    id: 'docs-045',
    scope: 'docs',
    win: ['Ctrl+R'],
    mac: ['Cmd+R'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Justify
  {
    id: 'docs-046',
    scope: 'docs',
    win: ['Ctrl+J'],
    mac: ['Cmd+J'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Line spacing 1.0
  {
    id: 'docs-047',
    scope: 'docs',
    win: ['Ctrl+1'],
    mac: ['Cmd+1'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Line spacing 2.0
  {
    id: 'docs-048',
    scope: 'docs',
    win: ['Ctrl+2'],
    mac: ['Cmd+2'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Line spacing 1.5
  {
    id: 'docs-049',
    scope: 'docs',
    win: ['Ctrl+5'],
    mac: ['Cmd+5'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Decrease indent
  {
    id: 'docs-051',
    scope: 'docs',
    win: ['Ctrl+Shift+M'],
    mac: ['Shift+Cmd+M'],
    web: { win: ['Alt+Shift+Left', 'Shift+Tab'], mac: ['Shift+Tab'] },
    match: 'key',
    guard: {},
  },
  // Hanging indent
  {
    id: 'docs-052',
    scope: 'docs',
    win: ['Ctrl+T'],
    mac: ['Cmd+T'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Remove hanging indent
  {
    id: 'docs-053',
    scope: 'docs',
    win: ['Ctrl+Shift+T'],
    mac: ['Shift+Cmd+T'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Remove paragraph formatting
  {
    id: 'docs-054',
    scope: 'docs',
    win: ['Ctrl+Q'],
    mac: [],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Normal style
  {
    id: 'docs-055',
    scope: 'docs',
    win: [],
    mac: [],
    webAlt: { win: 'Ctrl+Alt+0', mac: 'Alt+Cmd+0' },
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  // Heading 1
  {
    id: 'docs-056',
    scope: 'docs',
    win: ['Ctrl+Alt+1'],
    mac: ['Alt+Cmd+1'],
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  // Heading 2
  {
    id: 'docs-057',
    scope: 'docs',
    win: ['Ctrl+Alt+2'],
    mac: ['Alt+Cmd+2'],
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  // Heading 3
  {
    id: 'docs-058',
    scope: 'docs',
    win: ['Ctrl+Alt+3'],
    mac: ['Alt+Cmd+3'],
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  // Bulleted list
  {
    id: 'docs-060',
    scope: 'docs',
    win: ['Ctrl+Shift+L'],
    mac: ['Shift+Cmd+L'],
    web: { win: [], mac: [] },
    webAlt: { win: 'Ctrl+Period' },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Numbered list
  {
    id: 'docs-061',
    scope: 'docs',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Slash'], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Insert line break
  {
    id: 'docs-065',
    scope: 'docs',
    win: ['Shift+Enter'],
    mac: ['Shift+Enter'],
    match: 'key',
    guard: {},
  },
  // Insert page break
  {
    id: 'docs-066',
    scope: 'docs',
    win: ['Ctrl+Enter'],
    mac: ['Cmd+Enter'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Insert column break
  {
    id: 'docs-067',
    scope: 'docs',
    win: ['Ctrl+Shift+Enter'],
    mac: ['Shift+Cmd+Enter'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Insert non-breaking space
  {
    id: 'docs-068',
    scope: 'docs',
    win: ['Ctrl+Shift+Space'],
    mac: ['Alt+Space'],
    match: 'key',
    guard: {},
  },
  // Insert non-breaking hyphen
  {
    id: 'docs-069',
    scope: 'docs',
    win: ['Alt+Shift+Minus'],
    mac: ['Alt+Shift+Minus'],
    match: 'key',
    guard: {},
  },
  // Insert optional hyphen
  {
    id: 'docs-070',
    scope: 'docs',
    win: ['Ctrl+Alt+Minus'],
    mac: ['Alt+Cmd+Minus'],
    match: 'key',
    guard: { altGraph: true },
  },
  // Insert hyperlink
  {
    id: 'docs-071',
    scope: 'docs',
    win: ['Ctrl+K'],
    mac: ['Cmd+K'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Insert comment
  {
    id: 'docs-072',
    scope: 'docs',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Alt+M'], mac: ['Alt+Cmd+A'] },
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  // Insert footnote
  {
    id: 'docs-073',
    scope: 'docs',
    win: ['Ctrl+Alt+F'],
    mac: ['Alt+Cmd+F'],
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  // Insert endnote
  {
    id: 'docs-074',
    scope: 'docs',
    win: ['Ctrl+Alt+D'],
    mac: ['Alt+Cmd+E'],
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  // Insert DATE field
  {
    id: 'docs-075',
    scope: 'docs',
    win: ['Alt+Shift+D'],
    mac: ['Ctrl+Shift+D'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Insert TIME field
  {
    id: 'docs-076',
    scope: 'docs',
    win: ['Alt+Shift+T'],
    mac: ['Ctrl+Shift+T'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Update fields
  {
    id: 'docs-077',
    scope: 'docs',
    win: ['F9'],
    mac: ['F9'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Toggle field codes (all)
  {
    id: 'docs-078',
    scope: 'docs',
    win: ['Alt+F9'],
    mac: [],
    web: { win: ['Alt+F9'], mac: ['Alt+F9'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Track changes on/off
  {
    id: 'docs-079',
    scope: 'docs',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Shift+E'], mac: ['Shift+Cmd+E'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Spelling and grammar (Editor pane)
  {
    id: 'docs-080',
    scope: 'docs',
    win: ['F7'],
    mac: ['F7'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Word count
  {
    id: 'docs-081',
    scope: 'docs',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Shift+G'], mac: ['Shift+Cmd+G'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Zoom in
  {
    id: 'docs-082',
    scope: 'docs',
    win: ['Ctrl+Equal', 'Ctrl+NumpadAdd'],
    mac: ['Cmd+Equal', 'Cmd+NumpadAdd'],
    match: 'key',
    guard: {},
  },
  // Zoom out
  {
    id: 'docs-083',
    scope: 'docs',
    win: ['Ctrl+Minus', 'Ctrl+NumpadSubtract'],
    mac: ['Cmd+Minus', 'Cmd+NumpadSubtract'],
    match: 'key',
    guard: {},
  },
  // Zoom 100%
  {
    id: 'docs-084',
    scope: 'docs',
    win: ['Ctrl+0', 'Ctrl+Numpad0'],
    mac: ['Cmd+0', 'Cmd+Numpad0'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Expand or collapse the ribbon
  {
    id: 'docs-086',
    scope: 'docs',
    win: ['Ctrl+F1'],
    mac: ['Alt+Cmd+R'],
    web: { win: [], mac: [] },
    webAlt: { win: 'Ctrl+F3' },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Compact ribbon
  {
    id: 'docs-087',
    scope: 'docs',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Alt+K'], mac: ['Alt+Cmd+K'] },
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  // Context menu key
  {
    id: 'docs-089',
    scope: 'docs',
    win: ['Shift+F10'],
    mac: ['Shift+F10'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Cycle panes
  {
    id: 'docs-091',
    scope: 'docs',
    win: ['F6'],
    mac: ['F6'],
    web: { win: [], mac: [] },
    webAlt: { win: 'Ctrl+F6', mac: 'Cmd+F6' },
    match: 'key',
    guard: {},
  },
  // Cycle panes backward
  {
    id: 'docs-092',
    scope: 'docs',
    win: ['Shift+F6'],
    mac: ['Shift+F6'],
    web: { win: [], mac: [] },
    webAlt: { win: 'Ctrl+Shift+F6', mac: 'Shift+Cmd+F6' },
    match: 'key',
    guard: {},
  },
  // Go to last change / previous revision
  {
    id: 'docs-093',
    scope: 'docs',
    win: ['Shift+F5'],
    mac: ['Shift+F5'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: {},
  },
  // Help / shortcut sheet
  {
    id: 'docs-094',
    scope: 'docs',
    win: ['F1', 'Ctrl+Slash'],
    mac: [],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Delete word left / right
  {
    id: 'docs-098',
    scope: 'docs',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Backspace'], mac: ['Alt+Backspace'] },
    match: 'key',
    guard: {},
  },
]

export const docsUnmapped: readonly UnmappedShortcut[] = [
  {
    id: 'docs-001',
    part: 'web.win',
    reason:
      'proposal has prose: "no in-frame key (Ctrl+N is Chromium-reserved); New document by menu item or the MS web address-bar route Word.new"',
  },
  {
    id: 'docs-001',
    part: 'web.mac',
    reason:
      'proposal has prose: "no in-frame key (Ctrl+N is Chromium-reserved); New document by menu item or the MS web address-bar route Word.new"',
  },
  {
    id: 'docs-002',
    part: 'row',
    reason:
      'desktop: proposal has prose: "menu-only, no accelerator (Ctrl+Shift+N is MS Normal style, see docs Normal style row)"; web: proposal has prose: "none (browser-reserved; no frame key)"',
  },
  {
    id: 'docs-003',
    part: 'web.win',
    reason:
      'proposal has prose: "Ctrl+O / Cmd+O handled in the frame where UniWork has an Open action (capability-gated); MS Word web says Ctrl+O applies to the browser and prints no alternative or override setting, so the MS desktop key is kept ( where there is no Open action the browser keeps it"',
  },
  {
    id: 'docs-003',
    part: 'web.mac',
    reason:
      'proposal has prose: "Ctrl+O / Cmd+O handled in the frame where UniWork has an Open action (capability-gated); MS Word web says Ctrl+O applies to the browser and prints no alternative or override setting, so the MS desktop key is kept ( where there is no Open action the browser keeps it"',
  },
  {
    id: 'docs-005',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Win: F12 (MS). Mac: Shift+Cmd+S (keep). Ctrl+Shift+S has to leave Save As: MS binds it to Apply Styles"; web: proposal is conditional: "F12 / Cmd+Shift+S (F12 is the DevTools key: preventDefault only while the frame has focus; validate before shipping, fallback = File menu only)"',
  },
  {
    id: 'docs-007',
    part: 'desktop.mac',
    reason: "Microsoft prints no Mac key; keep today's Mac binding (contract 3.1)",
  },
  {
    id: 'docs-009',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: proposal has prose: "Esc / Esc"',
  },
  {
    id: 'docs-011',
    part: 'desktop.win',
    reason:
      'proposal has prose: "KEEP both; make the menu label show Ctrl+Y (MS) so the hint matches Word"',
  },
  {
    id: 'docs-011',
    part: 'desktop.mac',
    reason:
      'proposal has prose: "KEEP both; make the menu label show Ctrl+Y (MS) so the hint matches Word"',
  },
  {
    id: 'docs-012',
    part: 'row',
    reason:
      'desktop: proposal is conditional: "F4 (same; defer)"; web: proposal is conditional: "F4 / Cmd+Y (MS desktop: Mac repeat is Cmd+Y; needs a repeat-last-command mechanism, defer)"',
  },
  {
    id: 'docs-016',
    part: 'desktop.win',
    reason:
      'proposal has prose: "KEEP; Mac menu accelerator should read Shift+Cmd+V (MS) - ProseMirror already pastes plain on it"',
  },
  {
    id: 'docs-016',
    part: 'desktop.mac',
    reason:
      'proposal has prose: "KEEP; Mac menu accelerator should read Shift+Cmd+V (MS) - ProseMirror already pastes plain on it"',
  },
  {
    id: 'docs-021',
    part: 'web.win',
    reason:
      'proposal is conditional: "F5 / Cmd+Option+G (Ctrl+G is Find in the MS web Editing view and MS web prints no Editing-view Go To; F5 is the MS desktop Windows Go To key, desktop Mac Go To is Cmd+Option+G; F5 reloads the browser, so preventDefault only while the frame has focus, validate)"',
  },
  {
    id: 'docs-021',
    part: 'web.mac',
    reason:
      'proposal is conditional: "F5 / Cmd+Option+G (Ctrl+G is Find in the MS web Editing view and MS web prints no Editing-view Go To; F5 is the MS desktop Windows Go To key, desktop Mac Go To is Cmd+Option+G; F5 reloads the browser, so preventDefault only while the frame has focus, validate)"',
  },
  {
    id: 'docs-025',
    part: 'desktop.win',
    reason: 'proposal has prose: "Ctrl+Shift+D / Cmd+Shift+D (MS) if the mark exists"',
  },
  {
    id: 'docs-025',
    part: 'desktop.mac',
    reason: 'proposal has prose: "Ctrl+Shift+D / Cmd+Shift+D (MS) if the mark exists"',
  },
  {
    id: 'docs-026',
    part: 'desktop.win',
    reason: 'proposal has prose: "Mac Cmd+Shift+X (MS); Windows: none documented"',
  },
  {
    id: 'docs-026',
    part: 'desktop.mac',
    reason: 'proposal has prose: "Mac Cmd+Shift+X (MS); Windows: none documented"',
  },
  {
    id: 'docs-027',
    part: 'web.win',
    reason:
      'proposal is conditional: "Ctrl+Shift+Minus (-) / Cmd+Shift+Minus (-) (as printed by MS desktop; current Ctrl+, / Cmd+, needs a product decision)"',
  },
  {
    id: 'docs-027',
    part: 'web.mac',
    reason:
      'proposal is conditional: "Ctrl+Shift+Minus (-) / Cmd+Shift+Minus (-) (as printed by MS desktop; current Ctrl+, / Cmd+, needs a product decision)"',
  },
  {
    id: 'docs-028',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'docs-033',
    part: 'desktop.win',
    reason: 'proposal has prose: "KEEP Ctrl+D. Optional alias Ctrl+Shift+F (MS)"',
  },
  {
    id: 'docs-033',
    part: 'desktop.mac',
    reason: 'proposal has prose: "KEEP Ctrl+D. Optional alias Ctrl+Shift+F (MS)"',
  },
  {
    id: 'docs-037',
    part: 'desktop.win',
    reason:
      'proposal has prose: "Ctrl+Shift+H (MS). Conflicts with the shell\'s Back to Home (see Back to Home row)"',
  },
  {
    id: 'docs-037',
    part: 'desktop.mac',
    reason:
      'proposal has prose: "Ctrl+Shift+H (MS). Conflicts with the shell\'s Back to Home (see Back to Home row)"',
  },
  {
    id: 'docs-038',
    part: 'web.win',
    reason:
      'proposal has prose: "none on web (Ctrl+Shift+W / Cmd+Shift+W close the browser window and Chromium reserves them); action not in UniWork Docs"',
  },
  {
    id: 'docs-038',
    part: 'web.mac',
    reason:
      'proposal has prose: "none on web (Ctrl+Shift+W / Cmd+Shift+W close the browser window and Chromium reserves them); action not in UniWork Docs"',
  },
  {
    id: 'docs-038',
    part: 'desktop.mac',
    reason: 'no mac chord in proposal_desktop',
  },
  {
    id: 'docs-039',
    part: 'desktop.win',
    reason:
      'proposal has prose: "Windows: Ctrl+Space (keep). Mac: needs a decision (Control+Space is Apple\'s input-source switch)"',
  },
  {
    id: 'docs-039',
    part: 'desktop.mac',
    reason:
      'proposal has prose: "Windows: Ctrl+Space (keep). Mac: needs a decision (Control+Space is Apple\'s input-source switch)"',
  },
  {
    id: 'docs-042',
    part: 'desktop.win',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'docs-042',
    part: 'desktop.mac',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'docs-050',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Win KEEP. Mac: Control+Shift+M (MS); Cmd+M stays the OS minimize"; web: proposal has prose: "Alt+Shift+Right or Tab / Tab"',
  },
  {
    id: 'docs-052',
    part: 'web.win',
    reason: 'proposal has prose: "none on web (Ctrl+T / Cmd+T are Chromium-reserved: new tab)"',
  },
  {
    id: 'docs-052',
    part: 'web.mac',
    reason: 'proposal has prose: "none on web (Ctrl+T / Cmd+T are Chromium-reserved: new tab)"',
  },
  {
    id: 'docs-053',
    part: 'web.win',
    reason:
      'proposal has prose: "none on web (Ctrl+Shift+T / Cmd+Shift+T are Chromium-reserved: restore tab)"',
  },
  {
    id: 'docs-053',
    part: 'web.mac',
    reason:
      'proposal has prose: "none on web (Ctrl+Shift+T / Cmd+Shift+T are Chromium-reserved: restore tab)"',
  },
  {
    id: 'docs-054',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'docs-055',
    part: 'desktop.win',
    reason:
      'proposal has prose: "Ctrl+Shift+N / Cmd+Shift+N (MS); free it by removing New window\'s accelerator"',
  },
  {
    id: 'docs-055',
    part: 'desktop.mac',
    reason:
      'proposal has prose: "Ctrl+Shift+N / Cmd+Shift+N (MS); free it by removing New window\'s accelerator"',
  },
  {
    id: 'docs-059',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Ctrl+Shift+S (MS) once Save As moves to F12"; web: proposal is conditional: "Ctrl+Shift+S / not documented (once Save As is F12 only)"',
  },
  {
    id: 'docs-061',
    part: 'desktop.win',
    reason: 'proposal has prose: "none until MS documents one"',
  },
  {
    id: 'docs-061',
    part: 'desktop.mac',
    reason: 'proposal has prose: "none until MS documents one"',
  },
  {
    id: 'docs-062',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: proposal has prose: "Tab / Shift+Tab (both OS; MS web prints TAB / SHIFT+TAB for indent / outdent)"',
  },
  {
    id: 'docs-063',
    part: 'row',
    reason:
      'desktop: proposal has prose: "menu-only, no accelerator (Ctrl+Alt+M is MS Insert comment)"; web: proposal has prose: "none (Ctrl+Alt+M is Insert comment in MS web, docs-072)"',
  },
  {
    id: 'docs-064',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: proposal has prose: "Alt+Shift+Up|Down / Control+Shift+Up|Down (MS web prints Alt+Shift+Up/Down only for moving a page in the Navigation pane)"',
  },
  {
    id: 'docs-072',
    part: 'desktop.win',
    reason:
      'proposal has prose: "Win: Ctrl+Alt+M (MS); Paragraph dialog moves off it. Mac: keep Alt+Cmd+A"',
  },
  {
    id: 'docs-072',
    part: 'desktop.mac',
    reason:
      'proposal has prose: "Win: Ctrl+Alt+M (MS); Paragraph dialog moves off it. Mac: keep Alt+Cmd+A"',
  },
  {
    id: 'docs-078',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'docs-079',
    part: 'desktop.win',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'docs-079',
    part: 'desktop.mac',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'docs-081',
    part: 'desktop.win',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'docs-081',
    part: 'desktop.mac',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'docs-085',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "Ctrl+Scroll / Cmd+Scroll"',
  },
  {
    id: 'docs-087',
    part: 'desktop.win',
    reason: 'proposal has prose: "same"',
  },
  {
    id: 'docs-087',
    part: 'desktop.mac',
    reason: 'proposal has prose: "same"',
  },
  {
    id: 'docs-088',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Mac keep. Windows: F11 is MS Go to next field; keep the role but be aware"; web: proposal has prose: "none"',
  },
  {
    id: 'docs-090',
    part: 'row',
    reason:
      'desktop: proposal is conditional: "none (defer); Alt currently shows the native menu instead of KeyTips"; web: proposal has prose: "Alt+Period (.) / Control+Period (.)"',
  },
  {
    id: 'docs-093',
    part: 'web.win',
    reason:
      'proposal is conditional: "Shift+F5 / Shift+F5 (once track changes has a jump-to-change command)"',
  },
  {
    id: 'docs-093',
    part: 'web.mac',
    reason:
      'proposal is conditional: "Shift+F5 / Shift+F5 (once track changes has a jump-to-change command)"',
  },
  {
    id: 'docs-094',
    part: 'desktop.mac',
    reason: "Microsoft prints no Mac key; keep today's Mac binding (contract 3.1)",
  },
  {
    id: 'docs-094',
    part: 'web.win',
    reason:
      'proposal has prose: "no in-frame key (MS Word web: F1 \'applies to the web browser\'); the shortcut sheet is reached by a menu item or button"',
  },
  {
    id: 'docs-094',
    part: 'web.mac',
    reason:
      'proposal has prose: "no in-frame key (MS Word web: F1 \'applies to the web browser\'); the shortcut sheet is reached by a menu item or button"',
  },
  {
    id: 'docs-095',
    part: 'row',
    reason:
      'desktop: proposal has prose: "menu-only or another key (Ctrl+Shift+H is MS Hide selected text)"; web: proposal has prose: "n/a (shell only)"',
  },
  {
    id: 'docs-096',
    part: 'desktop.win',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'docs-096',
    part: 'desktop.mac',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'docs-096',
    part: 'row',
    reason: 'no chord left on any platform',
  },
  {
    id: 'docs-097',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "Ctrl+Left|Right (word), Ctrl+Up|Down (paragraph), Home / End (line), Ctrl+Home / End (document), Shift added to select / Option+Left|Right (word), Cmd+Up|Down (paragraph), Cmd+Left|Right (line) (native browser editing)"',
  },
  {
    id: 'docs-098',
    part: 'desktop.win',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'docs-098',
    part: 'desktop.mac',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'docs-099',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: proposal has prose: "Tab / Shift+Tab (MS web, older Word-web article: Tab = next table cell, Shift+Tab = previous table cell; same on Windows and Mac)"',
  },
  {
    id: 'docs-100',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: proposal has prose: "n/a (product behaviour, not an MS key)"',
  },
  {
    id: 'docs-101',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: proposal has prose: "n/a (product behaviour, not an MS key)"',
  },
  {
    id: 'docs-102',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: proposal has prose: "n/a (dialog keys, not an MS key)"',
  },
  {
    id: 'docs-103',
    part: 'row',
    reason:
      'desktop: same as web, and web is unmapped; web: proposal has prose: "none until a Paste Special feature exists; MS desktop key then: not documented / Cmd+Control+V"',
  },
]

export const docsNotes: readonly ShortcutNote[] = [
  {
    id: 'docs-003',
    part: 'web',
    detail:
      'ALT-PROPOSED without a single chord: ", not Chromium-reserved); where there is no Open action the"',
  },
  {
    id: 'docs-007',
    part: 'web.mac',
    detail: 'no web chord (not documented)',
  },
  {
    id: 'docs-008',
    part: 'web.mac',
    detail: 'no web chord (not documented)',
  },
  {
    id: 'docs-026',
    part: 'web.win',
    detail: 'no web chord (not documented)',
  },
  {
    id: 'docs-028',
    part: 'web.mac',
    detail: 'no web chord (not documented)',
  },
  {
    id: 'docs-037',
    part: 'web.mac',
    detail: 'no web chord (not documented)',
  },
  {
    id: 'docs-039',
    part: 'web.mac',
    detail: 'no web chord (not documented)',
  },
  {
    id: 'docs-042',
    part: 'web.mac',
    detail: 'no web chord (not documented)',
  },
  {
    id: 'docs-054',
    part: 'web.mac',
    detail: 'no web chord (not documented)',
  },
  {
    id: 'docs-060',
    part: 'web.mac',
    detail: 'no web chord (not documented)',
  },
  {
    id: 'docs-061',
    part: 'web.mac',
    detail: 'no web chord (not documented)',
  },
  {
    id: 'docs-086',
    part: 'web.mac',
    detail: 'no web chord (not documented)',
  },
  {
    id: 'docs-096',
    part: 'web',
    detail: 'the browser keeps the Microsoft key',
  },
]
// @generated-end

/** Hand-maintained rows: an entry with a generated id replaces that row. */
const manual: readonly ShortcutAction[] = [
  // Save As: Word's F12 / Shift+Cmd+S. Ctrl+Shift+S leaves it: Word binds it to Apply Styles
  // (docs-059, not bound yet).
  // Web: the same keys (DESKTOP-FALLBACK), F12 only while the frame has focus
  {
    id: 'docs-005',
    scope: 'docs',
    win: ['F12'],
    mac: ['Shift+Cmd+S'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Redo: Word's Ctrl+Y first (menus show it); the old Ctrl+Shift+Z stays as an alias
  {
    id: 'docs-011',
    scope: 'docs',
    win: ['Ctrl+Y', 'Ctrl+Shift+Z'],
    mac: ['Cmd+Y', 'Shift+Cmd+Z'],
    match: 'key',
    guard: {},
  },
  // Paste text only: Electron's pasteAndMatchStyle role on Word's Shift+Cmd+V
  {
    id: 'docs-016',
    scope: 'docs',
    win: ['Ctrl+Shift+V'],
    mac: ['Shift+Cmd+V'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Go To on web: Ctrl+G is Find there; F5 (reload) is not bound until tested in a browser
  {
    id: 'docs-021',
    scope: 'docs',
    win: ['Ctrl+G'],
    mac: ['Alt+Cmd+G'],
    web: { win: [], mac: ['Alt+Cmd+G'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Strikethrough: Word for Mac only, Windows Word prints no key
  {
    id: 'docs-026',
    scope: 'docs',
    win: [],
    mac: ['Shift+Cmd+X'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Subscript: Word's Ctrl+Shift+Minus. Windows keeps the old Ctrl+Comma; Cmd+Comma is
  // Word for Mac's Preferences, so the Mac alias goes
  {
    id: 'docs-027',
    scope: 'docs',
    win: ['Ctrl+Shift+Minus', 'Ctrl+Comma'],
    mac: ['Shift+Cmd+Minus'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Superscript: Word's Ctrl+Shift+Plus plus the old Period alias; on Windows web
  // Ctrl+Period is the bulleted list (docs-060)
  {
    id: 'docs-028',
    scope: 'docs',
    win: ['Ctrl+Shift+Equal', 'Ctrl+Period'],
    mac: ['Shift+Cmd+Equal', 'Cmd+Period'],
    web: { win: ['Ctrl+Shift+Equal'], mac: ['Shift+Cmd+Equal', 'Cmd+Period'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Font dialog: Ctrl+D, Word's Ctrl+Shift+F alias on Windows
  {
    id: 'docs-033',
    scope: 'docs',
    win: ['Ctrl+D', 'Ctrl+Shift+F'],
    mac: ['Cmd+D'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Clear character formatting: Ctrl+Space; the Mac key keeps today's Control+Space
  // until a product decision (it is also macOS' input-source switch)
  {
    id: 'docs-039',
    scope: 'docs',
    win: ['Ctrl+Space'],
    mac: ['Ctrl+Space'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Copy / paste formatting: Word's Ctrl+Alt+C/V. Desktop keeps the old Shift chords that
  // do not collide (Shift+Cmd+V is Paste text only); web drops Ctrl+Shift+C (DevTools)
  {
    id: 'docs-040',
    scope: 'docs',
    win: ['Ctrl+Alt+C', 'Ctrl+Shift+C'],
    mac: ['Alt+Cmd+C', 'Shift+Cmd+C'],
    web: { win: ['Ctrl+Alt+C'], mac: ['Alt+Cmd+C'] },
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  {
    id: 'docs-041',
    scope: 'docs',
    win: ['Ctrl+Alt+V', 'Ctrl+Alt+Shift+V'],
    mac: ['Alt+Cmd+V'],
    web: { win: ['Ctrl+Alt+V'], mac: ['Alt+Cmd+V'] },
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  // Formatting marks: Word's Ctrl+Shift+8; Mac keeps today's Cmd+8 (not documented)
  {
    id: 'docs-042',
    scope: 'docs',
    win: ['Ctrl+Shift+8'],
    mac: ['Cmd+8'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Increase / decrease indent: Word's Ctrl+M / Ctrl+Shift+M; Word for Mac Control+Shift+M /
  // Shift+Cmd+M (Cmd+M is the OS minimize). Web: Word web's Alt+Shift+Right/Left on Windows and
  // the desktop Mac keys on the Mac (DESKTOP-FALLBACK); Word web's Tab / Shift+Tab are left out
  // because the editor keymap owns Tab (list level, tab character, table cells)
  {
    id: 'docs-050',
    scope: 'docs',
    win: ['Ctrl+M'],
    mac: ['Ctrl+Shift+M'],
    web: { win: ['Alt+Shift+Right'], mac: ['Ctrl+Shift+M'] },
    match: 'key',
    guard: {},
  },
  {
    id: 'docs-051',
    scope: 'docs',
    win: ['Ctrl+Shift+M'],
    mac: ['Shift+Cmd+M'],
    web: { win: ['Alt+Shift+Left'], mac: ['Shift+Cmd+M'] },
    match: 'key',
    guard: {},
  },
  // Remove paragraph formatting: Ctrl+Q; Mac keeps Control+Q (Cmd+Q quits)
  {
    id: 'docs-054',
    scope: 'docs',
    win: ['Ctrl+Q'],
    mac: ['Ctrl+Q'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Normal style: Word's Ctrl+Shift+N (New window is menu-only now) plus the old Ctrl+Alt+0,
  // which is the only web key (the browser keeps Ctrl+Shift+N)
  {
    id: 'docs-055',
    scope: 'docs',
    win: ['Ctrl+Shift+N', 'Ctrl+Alt+0'],
    mac: ['Shift+Cmd+N', 'Alt+Cmd+0'],
    web: { win: [], mac: [] },
    webAlt: { win: 'Ctrl+Alt+0', mac: 'Alt+Cmd+0' },
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  // Insert comment: Word's Ctrl+Alt+M (the Paragraph dialog is menu-only now) / Cmd+Option+A
  {
    id: 'docs-072',
    scope: 'docs',
    win: ['Ctrl+Alt+M'],
    mac: ['Alt+Cmd+A'],
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  {
    id: 'docs-078',
    scope: 'docs',
    win: ['Alt+F9'],
    mac: ['Alt+F9'],
    match: 'key',
    guard: { noRepeat: true },
  },
  {
    id: 'docs-079',
    scope: 'docs',
    win: ['Ctrl+Shift+E'],
    mac: ['Shift+Cmd+E'],
    match: 'key',
    guard: { noRepeat: true },
  },
  {
    id: 'docs-081',
    scope: 'docs',
    win: ['Ctrl+Shift+G'],
    mac: ['Shift+Cmd+G'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Shortcut sheet: F1 (Word's Help) and the old Ctrl+/ on Windows. On the Mac F1 is Word's
  // Undo alias, so Cmd+/ stays. Web: menu item only (Word web leaves F1 to the browser)
  {
    id: 'docs-094',
    scope: 'docs',
    win: ['F1', 'Ctrl+Slash'],
    mac: ['Cmd+Slash'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
]

export const docsShortcuts: readonly ShortcutAction[] = mergeRows(generated, manual)

/** Why a manual row has no chord on a surface or platform, and remarks on manual rows:
 * merged after the generated lists into `SHORTCUT_UNMAPPED` / `SHORTCUT_NOTES`. */
export const docsManualUnmapped: readonly UnmappedShortcut[] = []
export const docsManualNotes: readonly ShortcutNote[] = []
