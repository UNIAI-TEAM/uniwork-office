// sheets shortcut table. The block between the @generated markers is written
// by scripts/gen-tables.mjs from tests/fixtures/shortcuts.csv: change the CSV and
// regenerate, or put hand-maintained rows in `manual` below.
import { mergeRows } from '../table'
import type { ShortcutAction, ShortcutNote, UnmappedShortcut } from '../types'

// @generated-begin
const generated: readonly ShortcutAction[] = [
  // Open workbook
  {
    id: 'sheets-02',
    scope: 'sheets',
    win: ['Ctrl+O'],
    mac: ['Cmd+O'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Save workbook
  {
    id: 'sheets-03',
    scope: 'sheets',
    win: ['Ctrl+S'],
    mac: ['Cmd+S'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Save As
  {
    id: 'sheets-04',
    scope: 'sheets',
    win: ['F12', 'Ctrl+Shift+S'],
    mac: ['Shift+Cmd+S', 'F12'],
    web: { win: [], mac: [] },
    webAlt: { win: 'Alt+F2' },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Print
  {
    id: 'sheets-05',
    scope: 'sheets',
    win: [],
    mac: ['Cmd+P'],
    web: { win: ['Ctrl+P'], mac: ['Cmd+P'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Close workbook
  {
    id: 'sheets-06',
    scope: 'sheets',
    win: ['Ctrl+W'],
    mac: ['Cmd+W'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Undo
  {
    id: 'sheets-07',
    scope: 'sheets',
    win: ['Ctrl+Z'],
    mac: ['Cmd+Z'],
    match: 'key',
    guard: {},
  },
  // Redo / repeat
  {
    id: 'sheets-08',
    scope: 'sheets',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Y'], mac: ['Cmd+Y'] },
    match: 'key',
    guard: {},
  },
  // Repeat last command (F4 outside cell edit)
  {
    id: 'sheets-09',
    scope: 'sheets',
    win: ['F4'],
    mac: [],
    web: { win: ['F4'], mac: ['F4'] },
    match: 'key',
    guard: {},
  },
  // Paste Special dialog
  {
    id: 'sheets-11',
    scope: 'sheets',
    win: ['Ctrl+Alt+V'],
    mac: ['Ctrl+Cmd+V', 'Alt+Cmd+V'],
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  // Paste values only (outside the dialog)
  {
    id: 'sheets-12',
    scope: 'sheets',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Shift+V'], mac: ['Shift+Cmd+V'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Edit active cell
  {
    id: 'sheets-14',
    scope: 'sheets',
    win: ['F2'],
    mac: ['F2'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // New line inside cell
  {
    id: 'sheets-15',
    scope: 'sheets',
    win: ['Alt+Enter'],
    mac: ['Alt+Enter', 'Ctrl+Alt+Enter'],
    web: { win: ['Alt+Enter'], mac: ['Alt+Enter'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Fill selected range with the current entry
  {
    id: 'sheets-16',
    scope: 'sheets',
    win: ['Ctrl+Enter'],
    mac: ['Cmd+Enter', 'Ctrl+Enter'],
    web: { win: ['Ctrl+Enter'], mac: ['Cmd+Enter'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Fill down
  {
    id: 'sheets-17',
    scope: 'sheets',
    win: ['Ctrl+D'],
    mac: ['Cmd+D'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Fill right
  {
    id: 'sheets-18',
    scope: 'sheets',
    win: [],
    mac: ['Cmd+R'],
    web: { win: ['Ctrl+R'], mac: ['Cmd+R'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Insert cells / rows / columns
  {
    id: 'sheets-19',
    scope: 'sheets',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Shift+Equal'], mac: ['Ctrl+Shift+Equal'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Delete cells / rows / columns
  {
    id: 'sheets-20',
    scope: 'sheets',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Minus'], mac: ['Cmd+Minus'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Select entire column
  {
    id: 'sheets-24',
    scope: 'sheets',
    win: ['Ctrl+Space'],
    mac: ['Ctrl+Space'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Select entire row
  {
    id: 'sheets-25',
    scope: 'sheets',
    win: ['Shift+Space'],
    mac: ['Shift+Space'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Select all / current region
  {
    id: 'sheets-26',
    scope: 'sheets',
    win: [],
    mac: [],
    web: { win: ['Ctrl+A'], mac: ['Cmd+A'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Select the current region (Ctrl+Shift+*)
  {
    id: 'sheets-27',
    scope: 'sheets',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Shift+8'], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Go to start of sheet
  {
    id: 'sheets-34',
    scope: 'sheets',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Home'], mac: ['Ctrl+Home'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Go to last used cell
  {
    id: 'sheets-35',
    scope: 'sheets',
    win: [],
    mac: [],
    web: { win: ['Ctrl+End'], mac: ['Ctrl+End'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Next sheet
  {
    id: 'sheets-39',
    scope: 'sheets',
    win: ['Ctrl+PageDown'],
    mac: ['Alt+Right'],
    web: { win: [], mac: ['Alt+Right'] },
    webAlt: { win: 'Ctrl+Alt+PageDown' },
    match: 'key',
    guard: { altGraph: true },
  },
  // Previous sheet
  {
    id: 'sheets-40',
    scope: 'sheets',
    win: ['Ctrl+PageUp'],
    mac: ['Alt+Left'],
    web: { win: [], mac: ['Alt+Left'] },
    webAlt: { win: 'Ctrl+Alt+PageUp' },
    match: 'key',
    guard: { altGraph: true },
  },
  // Go To
  {
    id: 'sheets-42',
    scope: 'sheets',
    win: ['F5'],
    mac: ['F5'],
    web: { win: ['Ctrl+G'], mac: ['Ctrl+G'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Find
  {
    id: 'sheets-43',
    scope: 'sheets',
    win: [],
    mac: [],
    web: { win: ['Ctrl+F'], mac: ['Ctrl+F'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Replace
  {
    id: 'sheets-44',
    scope: 'sheets',
    win: [],
    mac: ['Shift+Cmd+H'],
    web: { win: ['Ctrl+H'], mac: ['Shift+Cmd+H'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Insert new worksheet
  {
    id: 'sheets-45',
    scope: 'sheets',
    win: ['Shift+F11'],
    mac: ['Shift+F11'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Create chart (F11 chart sheet / Alt+F1 embedded chart)
  {
    id: 'sheets-46',
    scope: 'sheets',
    win: [],
    mac: [],
    webAlt: { win: 'Alt+F1' },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Insert function
  {
    id: 'sheets-49',
    scope: 'sheets',
    win: ['Shift+F3'],
    mac: ['Shift+F3'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Define name / Name Manager
  {
    id: 'sheets-50',
    scope: 'sheets',
    win: [],
    mac: [],
    web: { win: ['Ctrl+F3'], mac: ['Cmd+F3'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Expand / collapse formula bar
  {
    id: 'sheets-51',
    scope: 'sheets',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Shift+U'], mac: ['Ctrl+Shift+U'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Flash Fill
  {
    id: 'sheets-52',
    scope: 'sheets',
    win: ['Ctrl+E'],
    mac: [],
    web: { win: ['Ctrl+E'], mac: ['Ctrl+E'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Calculate all (F9)
  {
    id: 'sheets-53',
    scope: 'sheets',
    win: ['F9'],
    mac: [],
    web: { win: ['F9'], mac: ['F9'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Calculate active sheet (Shift+F9)
  {
    id: 'sheets-54',
    scope: 'sheets',
    win: ['Shift+F9'],
    mac: ['Shift+F9'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Show formulas (Ctrl+`)
  {
    id: 'sheets-55',
    scope: 'sheets',
    win: ['Ctrl+Backquote'],
    mac: [],
    web: { win: ['Ctrl+Backquote'], mac: ['Ctrl+Backquote'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Spell check
  {
    id: 'sheets-58',
    scope: 'sheets',
    win: ['F7'],
    mac: ['F7'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Format Cells dialog
  {
    id: 'sheets-61',
    scope: 'sheets',
    win: ['Ctrl+1'],
    mac: ['Cmd+1'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Format Cells: Font tab (Ctrl+Shift+F)
  {
    id: 'sheets-62',
    scope: 'sheets',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Shift+F'], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Bold
  {
    id: 'sheets-63',
    scope: 'sheets',
    win: ['Ctrl+B'],
    mac: ['Cmd+B'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Italic
  {
    id: 'sheets-64',
    scope: 'sheets',
    win: ['Ctrl+I'],
    mac: ['Cmd+I'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Underline
  {
    id: 'sheets-65',
    scope: 'sheets',
    win: ['Ctrl+U'],
    mac: ['Cmd+U'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Strikethrough
  {
    id: 'sheets-66',
    scope: 'sheets',
    win: ['Ctrl+5'],
    mac: ['Shift+Cmd+X'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Number format: General
  {
    id: 'sheets-68',
    scope: 'sheets',
    win: ['Ctrl+Shift+Backquote'],
    mac: [],
    web: { win: ['Ctrl+Shift+Backquote'], mac: ['Ctrl+Shift+Backquote'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Number format: Number (2 decimals, thousands)
  {
    id: 'sheets-69',
    scope: 'sheets',
    win: ['Ctrl+Shift+1'],
    mac: [],
    web: { win: ['Ctrl+Shift+1'], mac: ['Ctrl+Shift+1'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Number format: Time
  {
    id: 'sheets-70',
    scope: 'sheets',
    win: ['Ctrl+Shift+2'],
    mac: [],
    web: { win: ['Ctrl+Shift+2'], mac: ['Ctrl+Shift+2'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Number format: Date
  {
    id: 'sheets-71',
    scope: 'sheets',
    win: ['Ctrl+Shift+3'],
    mac: [],
    web: { win: ['Ctrl+Shift+3'], mac: ['Ctrl+Shift+3'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Number format: Currency
  {
    id: 'sheets-72',
    scope: 'sheets',
    win: ['Ctrl+Shift+4'],
    mac: [],
    web: { win: ['Ctrl+Shift+4'], mac: ['Ctrl+Shift+4'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Number format: Percentage
  {
    id: 'sheets-73',
    scope: 'sheets',
    win: ['Ctrl+Shift+5'],
    mac: [],
    web: { win: ['Ctrl+Shift+5'], mac: ['Ctrl+Shift+5'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Number format: Scientific
  {
    id: 'sheets-74',
    scope: 'sheets',
    win: ['Ctrl+Shift+6'],
    mac: [],
    web: { win: ['Ctrl+Shift+6'], mac: ['Ctrl+Shift+6'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Enter current date
  {
    id: 'sheets-76',
    scope: 'sheets',
    win: ['Ctrl+Semicolon'],
    mac: [],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Insert hyperlink
  {
    id: 'sheets-78',
    scope: 'sheets',
    win: ['Ctrl+K'],
    mac: ['Cmd+K'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Insert note
  {
    id: 'sheets-79',
    scope: 'sheets',
    win: ['Shift+F2'],
    mac: ['Shift+F2'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Insert threaded comment
  {
    id: 'sheets-80',
    scope: 'sheets',
    win: ['Ctrl+Shift+F2'],
    mac: ['Shift+Cmd+F2'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Add or remove a filter
  {
    id: 'sheets-81',
    scope: 'sheets',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Shift+L'], mac: ['Ctrl+Shift+L', 'Shift+Cmd+F'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Create table
  {
    id: 'sheets-82',
    scope: 'sheets',
    win: ['Ctrl+T', 'Ctrl+L'],
    mac: [],
    web: { win: ['Ctrl+L'], mac: [] },
    webAlt: { mac: 'Ctrl+L' },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Expand or collapse ribbon
  {
    id: 'sheets-83',
    scope: 'sheets',
    win: ['Ctrl+F1'],
    mac: ['Alt+Cmd+R'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Help
  {
    id: 'sheets-86',
    scope: 'sheets',
    win: ['F1'],
    mac: ['F1', 'Cmd+Slash'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
]

export const sheetsUnmapped: readonly UnmappedShortcut[] = [
  {
    id: 'sheets-01',
    part: 'row',
    reason:
      'desktop: proposal has prose: "mac: Cmd+N (MS). Windows: MS Excel page prints no New key; Ctrl+N is the Office convention but not on this page, so decide before adding"; web: proposal has prose: "no in-app key; Ctrl+N stays the browser\'s; New by File menu / documents-list button (MS web equivalent = the Excel.new address-bar route) / same"',
  },
  {
    id: 'sheets-02',
    part: 'web.win',
    reason:
      "proposal has prose: \"Ctrl+O / Cmd+O handled by the page (preventDefault) as Excel web's opt-in 'Override browser shortcuts' lets Excel keep it; mac from desktop, Excel web has no Mac column\"",
  },
  {
    id: 'sheets-02',
    part: 'web.mac',
    reason:
      "proposal has prose: \"Ctrl+O / Cmd+O handled by the page (preventDefault) as Excel web's opt-in 'Override browser shortcuts' lets Excel keep it; mac from desktop, Excel web has no Mac column\"",
  },
  {
    id: 'sheets-05',
    part: 'desktop.win',
    reason: "KEEP: no Microsoft win chord confirmed by today's binding",
  },
  {
    id: 'sheets-06',
    part: 'web.win',
    reason:
      'proposal has prose: "Ctrl+W / Cmd+W stay the browser\'s (Chromium-reserved: the page cannot intercept them; the browser closes the tab)"',
  },
  {
    id: 'sheets-06',
    part: 'web.mac',
    reason:
      'proposal has prose: "Ctrl+W / Cmd+W stay the browser\'s (Chromium-reserved: the page cannot intercept them; the browser closes the tab)"',
  },
  {
    id: 'sheets-08',
    part: 'desktop.win',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'sheets-08',
    part: 'desktop.mac',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'sheets-09',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'sheets-10',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: several chords for one row (sub-actions): "Ctrl+X / Ctrl+C / Ctrl+V / Cmd+X / Cmd+C / Cmd+V"',
  },
  {
    id: 'sheets-12',
    part: 'desktop.win',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'sheets-12',
    part: 'desktop.mac',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'sheets-13',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Letters inside the dialog (same as MS)"; web: proposal has prose: "Letters inside the dialog (A, F, V, T, C, N, H, X, W, R, U) / same"',
  },
  {
    id: 'sheets-18',
    part: 'desktop.win',
    reason: "KEEP: no Microsoft win chord confirmed by today's binding",
  },
  {
    id: 'sheets-19',
    part: 'desktop.win',
    reason:
      'proposal has prose: "mac: add Ctrl+Shift+= (MS) next to Cmd+Shift+= (register with MetaKeys.MAC_CTRL)"',
  },
  {
    id: 'sheets-19',
    part: 'desktop.mac',
    reason:
      'proposal has prose: "mac: add Ctrl+Shift+= (MS) next to Cmd+Shift+= (register with MetaKeys.MAC_CTRL)"',
  },
  {
    id: 'sheets-20',
    part: 'desktop.win',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'sheets-20',
    part: 'desktop.mac',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'sheets-21',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "Delete / Delete"',
  },
  {
    id: 'sheets-22',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Windows: KEEP. mac: hide = Ctrl+9 (outline table) and Cmd+( = Cmd+Shift+9 on a US keyboard; drop our Cmd+Shift+9 = unhide"; web: proposal has prose: "Ctrl+9 hide / Ctrl+Shift+9 unhide / mac: Ctrl+9 hide, Cmd+( hide (MS desktop)"',
  },
  {
    id: 'sheets-23',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Windows: KEEP. mac: hide = Ctrl+0 and Cmd+) = Cmd+Shift+0; drop our Cmd+Shift+0 = unhide"; web: proposal has prose: "Ctrl+0 hide / Ctrl+Shift+0 unhide / mac: Ctrl+0 hide, Cmd+) hide (MS desktop)"',
  },
  {
    id: 'sheets-26',
    part: 'desktop.win',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'sheets-26',
    part: 'desktop.mac',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'sheets-27',
    part: 'desktop.win',
    reason: 'proposal has prose: "Ctrl+Shift+* ; mac Cmd+A already expands the region"',
  },
  {
    id: 'sheets-27',
    part: 'desktop.mac',
    reason: 'proposal has prose: "Ctrl+Shift+* ; mac Cmd+A already expands the region"',
  },
  {
    id: 'sheets-27',
    part: 'web.mac',
    reason: "Cmd+A is already sheets-26's chord",
  },
  {
    id: 'sheets-28',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: proposal has prose: "Arrow, Tab, Shift+Tab, Enter, Shift+Enter / same with Return"',
  },
  {
    id: 'sheets-29',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "Esc / Esc"',
  },
  {
    id: 'sheets-30',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "Ctrl+Arrow / Cmd+Arrow"',
  },
  {
    id: 'sheets-31',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "Ctrl+Shift+Arrow / Shift+Cmd+Arrow"',
  },
  {
    id: 'sheets-32',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "Shift+Arrow / Shift+Arrow"',
  },
  {
    id: 'sheets-33',
    part: 'row',
    reason:
      'desktop: several chords for one row (sub-actions): "Ctrl+Shift+Home / Ctrl+Shift+End; mac Ctrl+Shift+Home/End (MS)"; web: "WIN / MAC" pair on a row with several sub-actions: "Ctrl+Shift+Home / Ctrl+Shift+End (win and mac)"',
  },
  {
    id: 'sheets-34',
    part: 'desktop.win',
    reason:
      'proposal has prose: "mac: register Ctrl+Home with MetaKeys.MAC_CTRL (MS lists Ctrl+Home); keep Cmd+Home"',
  },
  {
    id: 'sheets-34',
    part: 'desktop.mac',
    reason:
      'proposal has prose: "mac: register Ctrl+Home with MetaKeys.MAC_CTRL (MS lists Ctrl+Home); keep Cmd+Home"',
  },
  {
    id: 'sheets-35',
    part: 'desktop.win',
    reason: 'proposal has prose: "mac: register Ctrl+End with MetaKeys.MAC_CTRL; keep Cmd+End"',
  },
  {
    id: 'sheets-35',
    part: 'desktop.mac',
    reason: 'proposal has prose: "mac: register Ctrl+End with MetaKeys.MAC_CTRL; keep Cmd+End"',
  },
  {
    id: 'sheets-36',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "Home / Home"',
  },
  {
    id: 'sheets-37',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: "WIN / MAC" pair on a row with several sub-actions: "Page down / Page up (one screen = 28 rows)"',
  },
  {
    id: 'sheets-38',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: several chords for one row (sub-actions): "Alt+PageDown / Alt+PageUp / Option+PageDown / Option+PageUp"',
  },
  {
    id: 'sheets-41',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Ctrl+Shift+PageDown / PageUp (MS)"; web: proposal has prose: "Ctrl+Shift+Page down / Ctrl+Shift+Page up / not documented"',
  },
  {
    id: 'sheets-43',
    part: 'desktop.win',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'sheets-43',
    part: 'desktop.mac',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'sheets-44',
    part: 'desktop.win',
    reason: "KEEP: no Microsoft win chord confirmed by today's binding",
  },
  {
    id: 'sheets-44',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'sheets-46',
    part: 'desktop.win',
    reason:
      'proposal has prose: "F11 on Windows would clash with the Electron fullscreen role: decide"',
  },
  {
    id: 'sheets-46',
    part: 'desktop.mac',
    reason:
      'proposal has prose: "F11 on Windows would clash with the Electron fullscreen role: decide"',
  },
  {
    id: 'sheets-47',
    part: 'desktop.win',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'sheets-47',
    part: 'desktop.mac',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'sheets-47',
    part: 'web.win',
    reason: "F4 is already sheets-09's chord",
  },
  {
    id: 'sheets-47',
    part: 'web.mac',
    reason: "F4 is already sheets-09's chord",
  },
  {
    id: 'sheets-47',
    part: 'row',
    reason: 'no chord left on any platform',
  },
  {
    id: 'sheets-48',
    part: 'row',
    reason:
      'desktop: proposal has prose: "KEEP; Ctrl+Shift+T is not an MS Windows key, keep or drop by decision"; web: proposal has prose: "Alt+= / no key on web Mac (ribbon/button; Shift+Cmd+T is the Chromium restore-tab chord)"',
  },
  {
    id: 'sheets-50',
    part: 'desktop.win',
    reason:
      'proposal has prose: "Windows: add Alt+M, M, D access chord only with ribbon key tips (see key tips row); mac Cmd+F3 already matches"',
  },
  {
    id: 'sheets-50',
    part: 'desktop.mac',
    reason:
      'proposal has prose: "Windows: add Alt+M, M, D access chord only with ribbon key tips (see key tips row); mac Cmd+F3 already matches"',
  },
  {
    id: 'sheets-51',
    part: 'desktop.win',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'sheets-51',
    part: 'desktop.mac',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'sheets-52',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'sheets-53',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'sheets-55',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'sheets-56',
    part: 'row',
    reason:
      'desktop: proposal has prose: "mac: use Ctrl+Shift+[ and Ctrl+] (MS) instead of Cmd+[ / Cmd+] (browser back/forward on mac)"; web: several chords for one row (sub-actions): "Ctrl+[ / Ctrl+] (precedents / dependents) / Ctrl+Shift+[ / Ctrl+]"',
  },
  {
    id: 'sheets-57',
    part: 'row',
    reason:
      'desktop: several chords for one row (sub-actions): "Ctrl+\' / Ctrl+Shift+" (MS)"; web: several chords for one row (sub-actions): "Ctrl+\' / Ctrl+Shift+\' (= Ctrl+Shift+") / Ctrl+\' / Ctrl+Shift+""',
  },
  {
    id: 'sheets-59',
    part: 'row',
    reason:
      'desktop: several chords for one row (sub-actions): "F8 / Shift+F8 (MS)"; web: "WIN / MAC" pair on a row with several sub-actions: "F8 / Shift+F8"',
  },
  {
    id: 'sheets-60',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Shift+F10 / Menu key"; web: proposal has prose: "Shift+F10 or Menu key / Shift+F10"',
  },
  {
    id: 'sheets-62',
    part: 'desktop.win',
    reason: 'proposal has prose: "Ctrl+Shift+F (MS Windows); mac: MS lists no Font-tab key"',
  },
  {
    id: 'sheets-62',
    part: 'desktop.mac',
    reason: 'proposal has prose: "Ctrl+Shift+F (MS Windows); mac: MS lists no Font-tab key"',
  },
  {
    id: 'sheets-67',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: several chords for one row (sub-actions): "Ctrl+Shift+> / Ctrl+Shift+< / Shift+Cmd+> / Shift+Cmd+< (Mac half from the MS desktop Mac key; the MS desktop Windows key is not documented, so the WEBMAP equality test cannot be shown)"',
  },
  {
    id: 'sheets-68',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'sheets-69',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'sheets-70',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'sheets-71',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'sheets-72',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'sheets-73',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'sheets-74',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'sheets-75',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: proposal has prose: "Ctrl+Shift+& (= Ctrl+Shift+7) outline; Ctrl+Shift+_ (= Ctrl+Shift+-) remove outline / Cmd+Option+0 / Cmd+Option+Hyphen"',
  },
  {
    id: 'sheets-76',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'sheets-76',
    part: 'web.win',
    reason: 'proposal has prose: "Ctrl+; / Ctrl+;"',
  },
  {
    id: 'sheets-76',
    part: 'web.mac',
    reason: 'proposal has prose: "Ctrl+; / Ctrl+;"',
  },
  {
    id: 'sheets-77',
    part: 'row',
    reason:
      'desktop: proposal has prose: "mac: make Cmd+; = time (MS) and Ctrl+; = date; drop Cmd+; as date"; web: proposal has prose: "Ctrl+Shift+; (= Ctrl+Shift+:) / Cmd+;"',
  },
  {
    id: 'sheets-81',
    part: 'desktop.win',
    reason:
      'proposal has prose: "mac: keep Cmd+Shift+F; drop Cmd+Shift+L (MS Cmd+Shift+L opens Modify Cell Style); add Ctrl+Shift+L on mac (MS)"',
  },
  {
    id: 'sheets-81',
    part: 'desktop.mac',
    reason:
      'proposal has prose: "mac: keep Cmd+Shift+F; drop Cmd+Shift+L (MS Cmd+Shift+L opens Modify Cell Style); add Ctrl+Shift+L on mac (MS)"',
  },
  {
    id: 'sheets-82',
    part: 'desktop.mac',
    reason: 'no mac chord in proposal_desktop',
  },
  {
    id: 'sheets-84',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Alt / F10 (MS Windows; mac not documented)"; web: proposal has prose: "Alt+Period (.) / Control+Option (Alt+Period is MS\'s Narrator key for the classic ribbon, borrowed because the default MS web key, Alt+Windows logo key, cannot reach a page; Mac Control+Option is printed in prose)"',
  },
  {
    id: 'sheets-85',
    part: 'row',
    reason:
      'desktop: several chords for one row (sub-actions): "F6 / Shift+F6 (MS)"; web: several chords for one row (sub-actions): "Ctrl+F6 / Ctrl+Shift+F6 / Cmd+F6 / Shift+Cmd+F6"',
  },
  {
    id: 'sheets-86',
    part: 'web.win',
    reason:
      'proposal has prose: "no key: F1 stays the browser\'s; Help by button (MS web override: Help > Keyboard Shortcuts > Override browser shortcuts) / none"',
  },
  {
    id: 'sheets-86',
    part: 'web.mac',
    reason:
      'proposal has prose: "no key: F1 stays the browser\'s; Help by button (MS web override: Help > Keyboard Shortcuts > Override browser shortcuts) / none"',
  },
  {
    id: 'sheets-87',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Windows: add Ctrl+Alt+= / Ctrl+Alt+- (MS) only if AltGr layouts are excluded"; web: proposal has prose: "Ctrl+Alt+= / Ctrl+Alt+- / not documented"',
  },
  {
    id: 'sheets-88',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: proposal has prose: "n/a (browser F11 / window roles belong to the browser)"',
  },
  {
    id: 'sheets-89',
    part: 'row',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'sheets-90',
    part: 'row',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'sheets-91',
    part: 'row',
    reason:
      'desktop: proposal has prose: "mac: add Cmd+Shift+K / Cmd+Shift+J (MS); keep Alt+Shift+Arrow"; web: several chords for one row (sub-actions): "Alt+Shift+Right / Alt+Shift+Left / Cmd+Shift+K / Cmd+Shift+J"',
  },
  {
    id: 'sheets-92',
    part: 'row',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'sheets-93',
    part: 'row',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'sheets-94',
    part: 'row',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'sheets-95',
    part: 'row',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'sheets-96',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "Esc / Esc"',
  },
  {
    id: 'sheets-97',
    part: 'row',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'sheets-dialog-keys',
    part: 'row',
    reason: 'KEEP on a row that names several sub-actions',
  },
]

export const sheetsNotes: readonly ShortcutNote[] = [
  {
    id: 'sheets-04',
    part: 'web.mac',
    detail: 'no web chord (not documented)',
  },
  {
    id: 'sheets-46',
    part: 'web.mac',
    detail: 'no web chord (not documented)',
  },
  {
    id: 'sheets-62',
    part: 'web.mac',
    detail: 'no web chord (not documented)',
  },
]
// @generated-end

/**
 * Hand-maintained rows: an entry with a generated id replaces that row.
 *
 * A row that names two sub-actions (hide / unhide, Home / End, Page down / Page
 * up...) keeps every chord in one row, since a row id is a `shortcuts.csv` id;
 * apps/sheets picks the sub-action from the chord that matched (see
 * `isSecondSubAction` in apps/sheets/src/renderer/sheets-keymap.ts).
 *
 * Rows apps/sheets leaves unbound are listed in `sheetsManualUnmapped` below.
 */
const manual: readonly ShortcutAction[] = [
  // Cut / Copy / Paste: Univer and the browser clipboard own the keys; the row is the one
  // source of the tooltip text (clipboardHint in apps/sheets picks X / C / V from it)
  {
    id: 'sheets-10',
    scope: 'sheets',
    win: ['Ctrl+X', 'Ctrl+C', 'Ctrl+V'],
    mac: ['Cmd+X', 'Cmd+C', 'Cmd+V'],
    web: { win: ['Ctrl+X', 'Ctrl+C', 'Ctrl+V'], mac: ['Cmd+X', 'Cmd+C', 'Cmd+V'] },
    match: 'key',
    guard: {},
  },
  // Find: Univer binds Ctrl+F / Cmd+F on desktop (the Excel Windows page prints no Find key);
  // Excel for the web's Ctrl+F in the frame. Excel for Mac's Shift+F5 is not wired
  {
    id: 'sheets-43',
    scope: 'sheets',
    win: ['Ctrl+F'],
    mac: ['Cmd+F'],
    web: { win: ['Ctrl+F'], mac: ['Ctrl+F'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Format Cells: Excel for Mac prints "Cmd+1 or Ctrl+1"
  {
    id: 'sheets-61',
    scope: 'sheets',
    win: ['Ctrl+1'],
    mac: ['Cmd+1', 'Ctrl+1'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Insert hyperlink: Excel for Mac prints "Cmd+K or Ctrl+K"
  {
    id: 'sheets-78',
    scope: 'sheets',
    win: ['Ctrl+K'],
    mac: ['Cmd+K', 'Ctrl+K'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Print: Ctrl+P on Windows too (the Excel Windows page prints no Print row)
  {
    id: 'sheets-05',
    scope: 'sheets',
    win: ['Ctrl+P'],
    mac: ['Cmd+P'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Redo: Excel's Ctrl+Y / Cmd+Y first (menus show it); Shift+Ctrl+Z stays an alias
  {
    id: 'sheets-08',
    scope: 'sheets',
    win: ['Ctrl+Y', 'Ctrl+Shift+Z'],
    mac: ['Cmd+Y', 'Shift+Cmd+Z'],
    match: 'key',
    guard: {},
  },
  // Paste Special: Excel for Mac also prints Ctrl+Option+V
  {
    id: 'sheets-11',
    scope: 'sheets',
    win: ['Ctrl+Alt+V'],
    mac: ['Ctrl+Cmd+V', 'Alt+Cmd+V', 'Ctrl+Alt+V'],
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  // Paste values: ours only (Excel goes through Paste Special, V)
  {
    id: 'sheets-12',
    scope: 'sheets',
    win: ['Ctrl+Shift+V'],
    mac: ['Shift+Cmd+V'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // New line in a cell: the old Cmd+Option+Return stays next to Excel for Mac's two keys
  {
    id: 'sheets-15',
    scope: 'sheets',
    win: ['Alt+Enter'],
    mac: ['Alt+Enter', 'Ctrl+Alt+Enter', 'Alt+Cmd+Enter'],
    web: { win: ['Alt+Enter'], mac: ['Alt+Enter'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Fill down / right: Excel for Mac prints Cmd and Control
  {
    id: 'sheets-17',
    scope: 'sheets',
    win: ['Ctrl+D'],
    mac: ['Cmd+D', 'Ctrl+D'],
    match: 'key',
    guard: { noRepeat: true },
  },
  {
    id: 'sheets-18',
    scope: 'sheets',
    win: ['Ctrl+R'],
    mac: ['Cmd+R', 'Ctrl+R'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Insert cells: Excel for Mac's Control+Shift+=, the old Cmd+Shift+= kept
  {
    id: 'sheets-19',
    scope: 'sheets',
    win: ['Ctrl+Shift+Equal'],
    mac: ['Ctrl+Shift+Equal', 'Shift+Cmd+Equal'],
    web: { win: ['Ctrl+Shift+Equal'], mac: ['Ctrl+Shift+Equal'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  {
    id: 'sheets-20',
    scope: 'sheets',
    win: ['Ctrl+Minus'],
    mac: ['Cmd+Minus', 'Ctrl+Minus'],
    web: { win: ['Ctrl+Minus'], mac: ['Cmd+Minus'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Hide / unhide rows. Sub-action: Ctrl (Control) with Shift unhides, anything else
  // hides. Mac follows Excel for Mac: Control+9 and Cmd+( (= Shift+Cmd+9) hide; the old
  // Cmd+Shift+9 = unhide was the inverse (P0). The old Cmd+9 hide stays an alias.
  {
    id: 'sheets-22',
    scope: 'sheets',
    win: ['Ctrl+9', 'Ctrl+Shift+9'],
    mac: ['Ctrl+9', 'Shift+Cmd+9', 'Cmd+9', 'Ctrl+Shift+9'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Hide / unhide columns: same rule with 0 and Cmd+) (= Shift+Cmd+0)
  {
    id: 'sheets-23',
    scope: 'sheets',
    win: ['Ctrl+0', 'Ctrl+Shift+0'],
    mac: ['Ctrl+0', 'Shift+Cmd+0', 'Cmd+0', 'Ctrl+Shift+0'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Select all: Excel's Ctrl+Shift+Space next to Ctrl+A
  {
    id: 'sheets-26',
    scope: 'sheets',
    win: ['Ctrl+A', 'Ctrl+Shift+Space'],
    mac: ['Cmd+A', 'Shift+Cmd+Space'],
    match: 'key',
    guard: {},
  },
  // Current region (Ctrl+Shift+*); on a Mac Cmd+A (sheets-26) already grows to the region
  {
    id: 'sheets-27',
    scope: 'sheets',
    win: ['Ctrl+Shift+8'],
    mac: [],
    web: { win: ['Ctrl+Shift+8'], mac: [] },
    match: 'key',
    guard: {},
  },
  // Extend the selection to the sheet start / last used cell. Sub-action by key.
  {
    id: 'sheets-33',
    scope: 'sheets',
    win: ['Ctrl+Shift+Home', 'Ctrl+Shift+End'],
    mac: ['Ctrl+Shift+Home', 'Ctrl+Shift+End', 'Shift+Cmd+Home', 'Shift+Cmd+End'],
    match: 'key',
    guard: {},
  },
  // Ctrl+Home / Ctrl+End: Excel for Mac's Control keys, the old Cmd keys kept
  {
    id: 'sheets-34',
    scope: 'sheets',
    win: ['Ctrl+Home'],
    mac: ['Ctrl+Home', 'Cmd+Home'],
    match: 'key',
    guard: {},
  },
  {
    id: 'sheets-35',
    scope: 'sheets',
    win: ['Ctrl+End'],
    mac: ['Ctrl+End', 'Cmd+End'],
    match: 'key',
    guard: {},
  },
  // One screen right / left. Sub-action by key.
  {
    id: 'sheets-38',
    scope: 'sheets',
    win: ['Alt+PageDown', 'Alt+PageUp'],
    mac: ['Alt+PageDown', 'Alt+PageUp'],
    match: 'key',
    guard: {},
  },
  // Next / previous sheet. Mac desktop: Excel for Mac's Control+PgDn and Option+arrow,
  // the old Cmd+PgDn kept (the browser keeps Control+PgDn on the web)
  {
    id: 'sheets-39',
    scope: 'sheets',
    win: ['Ctrl+PageDown'],
    mac: ['Ctrl+PageDown', 'Alt+Right', 'Cmd+PageDown'],
    web: { win: [], mac: ['Alt+Right'] },
    webAlt: { win: 'Ctrl+Alt+PageDown' },
    match: 'key',
    guard: { altGraph: true },
  },
  // Previous sheet: the Excel for Mac page prints Ctrl+Page down here (typo); Ctrl+Page up
  {
    id: 'sheets-40',
    scope: 'sheets',
    win: ['Ctrl+PageUp'],
    mac: ['Ctrl+PageUp', 'Alt+Left', 'Cmd+PageUp'],
    web: { win: [], mac: ['Alt+Left'] },
    webAlt: { win: 'Ctrl+Alt+PageUp' },
    match: 'key',
    guard: { altGraph: true },
  },
  // Go To: F5 first on Windows, Ctrl+G first on a Mac (the order Excel prints them); the old Cmd+G kept
  {
    id: 'sheets-42',
    scope: 'sheets',
    win: ['F5', 'Ctrl+G'],
    mac: ['Ctrl+G', 'F5', 'Cmd+G'],
    web: { win: ['Ctrl+G'], mac: ['Ctrl+G'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Absolute / relative reference while a formula is edited (cell-edit keymap: F4 and
  // Cmd+T mean Repeat and Create Table outside it)
  {
    id: 'sheets-47',
    scope: 'sheets',
    context: 'edit',
    win: ['F4'],
    mac: ['Cmd+T', 'F4'],
    web: { win: ['F4'], mac: ['F4'] },
    match: 'key',
    guard: {},
  },
  // AutoSum: Alt+= / Shift+Cmd+T. The old Ctrl+Shift+T (Windows) and Univer's
  // Cmd+Option+= (Mac) stay aliases; the browser keeps both T chords on the web.
  {
    id: 'sheets-48',
    scope: 'sheets',
    win: ['Alt+Equal', 'Ctrl+Shift+T'],
    mac: ['Shift+Cmd+T', 'Alt+Cmd+Equal', 'Alt+Equal'],
    web: { win: ['Alt+Equal'], mac: ['Alt+Cmd+Equal', 'Alt+Equal'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Name Manager: Ctrl+F3 / Cmd+F3 (Excel's Windows key is the Alt+M, M, D access sequence)
  {
    id: 'sheets-50',
    scope: 'sheets',
    win: ['Ctrl+F3'],
    mac: ['Cmd+F3'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Expand / collapse the formula bar: Control+Shift+U on both, the old Cmd form kept
  {
    id: 'sheets-51',
    scope: 'sheets',
    win: ['Ctrl+Shift+U'],
    mac: ['Ctrl+Shift+U', 'Shift+Cmd+U'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Flash Fill: Excel for Mac's Control+E, the old Cmd+E kept
  {
    id: 'sheets-52',
    scope: 'sheets',
    win: ['Ctrl+E'],
    mac: ['Ctrl+E', 'Cmd+E'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Calculate now: Excel for Mac's Cmd+= (it outranks Univer's zoom-in there), F9 kept
  {
    id: 'sheets-53',
    scope: 'sheets',
    win: ['F9'],
    mac: ['Cmd+Equal', 'F9'],
    web: { win: ['F9'], mac: ['F9'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Show formulas: Control+` on a Mac too (Cmd+` cycles the app's windows in macOS)
  {
    id: 'sheets-55',
    scope: 'sheets',
    win: ['Ctrl+Backquote'],
    mac: ['Ctrl+Backquote'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Precedents / dependents. Sub-action by key. Mac: Excel for Mac's Control keys
  // instead of Cmd+[ / Cmd+] (back / forward)
  {
    id: 'sheets-56',
    scope: 'sheets',
    win: ['Ctrl+BracketLeft', 'Ctrl+BracketRight'],
    mac: ['Ctrl+Shift+BracketLeft', 'Ctrl+BracketRight'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Format Cells on its Font tab (Windows only; Excel for Mac prints none)
  {
    id: 'sheets-62',
    scope: 'sheets',
    win: ['Ctrl+Shift+F'],
    mac: [],
    web: { win: ['Ctrl+Shift+F'], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Strikethrough: the old Cmd+5 stays next to Excel for Mac's Shift+Cmd+X
  {
    id: 'sheets-66',
    scope: 'sheets',
    win: ['Ctrl+5'],
    mac: ['Shift+Cmd+X', 'Cmd+5'],
    web: { win: ['Ctrl+5'], mac: ['Shift+Cmd+X'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Font size up / down one step. Sub-action by key (> grows, < shrinks).
  {
    id: 'sheets-67',
    scope: 'sheets',
    win: ['Ctrl+Shift+Period', 'Ctrl+Shift+Comma'],
    mac: ['Shift+Cmd+Period', 'Shift+Cmd+Comma'],
    match: 'key',
    guard: {},
  },
  // Number formats: Excel for Mac prints Control+Shift; Cmd+Shift+3/4/5 are the macOS
  // screenshot keys, so the old Cmd forms go
  {
    id: 'sheets-68',
    scope: 'sheets',
    win: ['Ctrl+Shift+Backquote'],
    mac: ['Ctrl+Shift+Backquote'],
    match: 'key',
    guard: { noRepeat: true },
  },
  {
    id: 'sheets-69',
    scope: 'sheets',
    win: ['Ctrl+Shift+1'],
    mac: ['Ctrl+Shift+1'],
    match: 'key',
    guard: { noRepeat: true },
  },
  {
    id: 'sheets-70',
    scope: 'sheets',
    win: ['Ctrl+Shift+2'],
    mac: ['Ctrl+Shift+2'],
    match: 'key',
    guard: { noRepeat: true },
  },
  {
    id: 'sheets-71',
    scope: 'sheets',
    win: ['Ctrl+Shift+3'],
    mac: ['Ctrl+Shift+3'],
    match: 'key',
    guard: { noRepeat: true },
  },
  {
    id: 'sheets-72',
    scope: 'sheets',
    win: ['Ctrl+Shift+4'],
    mac: ['Ctrl+Shift+4'],
    match: 'key',
    guard: { noRepeat: true },
  },
  {
    id: 'sheets-73',
    scope: 'sheets',
    win: ['Ctrl+Shift+5'],
    mac: ['Ctrl+Shift+5'],
    match: 'key',
    guard: { noRepeat: true },
  },
  {
    id: 'sheets-74',
    scope: 'sheets',
    win: ['Ctrl+Shift+6'],
    mac: ['Ctrl+Shift+6'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Outline border / no border. Sub-action by key (Minus removes). Mac: Excel for Mac's
  // Cmd+Option+0 / Cmd+Option+Hyphen, the Control+Shift forms kept
  {
    id: 'sheets-75',
    scope: 'sheets',
    win: ['Ctrl+Shift+7', 'Ctrl+Shift+Minus'],
    mac: ['Alt+Cmd+0', 'Alt+Cmd+Minus', 'Ctrl+Shift+7', 'Ctrl+Shift+Minus'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Current date: Control+; on a Mac; Cmd+; is the time there (sheets-77, P0)
  {
    id: 'sheets-76',
    scope: 'sheets',
    win: ['Ctrl+Semicolon'],
    mac: ['Ctrl+Semicolon'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Current time: Excel for Mac's Cmd+;, the old Cmd+Shift+; kept
  {
    id: 'sheets-77',
    scope: 'sheets',
    win: ['Ctrl+Shift+Semicolon'],
    mac: ['Cmd+Semicolon', 'Shift+Cmd+Semicolon'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Threaded comment: the old Ctrl+Shift+M stays on Windows; Cmd+Shift+M is
  // PowerPoint for Mac's key, not Excel's, so it goes on a Mac
  {
    id: 'sheets-80',
    scope: 'sheets',
    win: ['Ctrl+Shift+F2', 'Ctrl+Shift+M'],
    mac: ['Shift+Cmd+F2'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Filter: Ctrl+Shift+L; Mac Shift+Cmd+F and Control+Shift+L. Shift+Cmd+L (Excel for
  // Mac: Modify Cell Style) no longer toggles the filter.
  {
    id: 'sheets-81',
    scope: 'sheets',
    win: ['Ctrl+Shift+L'],
    mac: ['Shift+Cmd+F', 'Ctrl+Shift+L'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Create table: Ctrl+T / Ctrl+L, Cmd+T on a Mac; the browser keeps both T chords
  {
    id: 'sheets-82',
    scope: 'sheets',
    win: ['Ctrl+T', 'Ctrl+L'],
    mac: ['Cmd+T'],
    web: { win: ['Ctrl+L'], mac: [] },
    webAlt: { mac: 'Ctrl+L' },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Group / ungroup. Sub-action by key (Right / K groups). Mac: Excel for Mac's
  // Cmd+Shift+K / J, the old Option+Shift+arrows kept
  {
    id: 'sheets-91',
    scope: 'sheets',
    win: ['Alt+Shift+Right', 'Alt+Shift+Left'],
    mac: ['Shift+Cmd+K', 'Shift+Cmd+J', 'Alt+Shift+Right', 'Alt+Shift+Left'],
    match: 'key',
    guard: { noRepeat: true },
  },
]

export const sheetsShortcuts: readonly ShortcutAction[] = mergeRows(generated, manual)

/** Why a manual row has no chord on a surface or platform, and remarks on manual rows:
 * merged after the generated lists into `SHORTCUT_UNMAPPED` / `SHORTCUT_NOTES`. */
export const sheetsManualUnmapped: readonly UnmappedShortcut[] = [
  {
    id: 'sheets-41',
    part: 'row',
    reason: 'no command behind the key in apps/sheets (multi-select sheet tabs)',
  },
  {
    id: 'sheets-57',
    part: 'row',
    reason:
      'no command behind the key in apps/sheets (copy from the cell above), and the quote chords depend on the layout',
  },
  {
    id: 'sheets-58',
    part: 'row',
    reason: 'F7 spell check: the key is in the table, but no spell-check command listens',
  },
  {
    id: 'sheets-59',
    part: 'row',
    reason: 'no command behind the key in apps/sheets (extend selection mode, F8 / Shift+F8)',
  },
  {
    id: 'sheets-60',
    part: 'row',
    reason: 'the context menu opens from the pointer only, so Shift+F10 / Menu key is not wired',
  },
  {
    id: 'sheets-84',
    part: 'row',
    reason: 'no command behind the key in apps/sheets (ribbon key tips)',
  },
  {
    id: 'sheets-85',
    part: 'row',
    reason: 'no command behind the key in apps/sheets (cycle panes, F6)',
  },
  {
    id: 'sheets-86',
    part: 'desktop.win',
    reason: 'F1 help: the key is in the table, but nothing listens',
  },
  {
    id: 'sheets-86',
    part: 'desktop.mac',
    reason: 'F1 / Cmd+/ help: the keys are in the table, but nothing listens',
  },
  {
    id: 'sheets-87',
    part: 'row',
    reason:
      'zoom stays on Univer (Ctrl+= and the wheel); Ctrl+Alt+= / Ctrl+Alt+- is AltGr on many layouts',
  },
  {
    id: 'sheets-46',
    part: 'web.win',
    reason:
      'Alt+F1 chart is in the table, but no chart command is bound to it; F11 clashes with the Electron fullscreen role on desktop',
  },
  {
    id: 'sheets-43',
    part: 'desktop.mac',
    reason: "Excel for Mac's Shift+F5 Find is not added; Cmd+F stays Univer's",
  },
]
export const sheetsManualNotes: readonly ShortcutNote[] = []
