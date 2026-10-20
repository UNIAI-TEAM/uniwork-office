// slides shortcut table. The block between the @generated markers is written
// by scripts/gen-tables.mjs from tests/fixtures/shortcuts.csv: change the CSV and
// regenerate, or put hand-maintained rows in `manual` below.
import { mergeRows } from '../table'
import type { ShortcutAction, ShortcutNote, UnmappedShortcut } from '../types'

// @generated-begin
const generated: readonly ShortcutAction[] = [
  // New presentation
  {
    id: 'slides-01',
    scope: 'slides',
    win: ['Ctrl+N'],
    mac: ['Cmd+N'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Open presentation
  {
    id: 'slides-02',
    scope: 'slides',
    win: ['Ctrl+O'],
    mac: ['Cmd+O'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Save
  {
    id: 'slides-03',
    scope: 'slides',
    win: ['Ctrl+S'],
    mac: ['Cmd+S'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Save As
  {
    id: 'slides-04',
    scope: 'slides',
    win: ['Ctrl+Shift+S'],
    mac: ['Shift+Cmd+S'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Print
  {
    id: 'slides-05',
    scope: 'slides',
    win: ['Ctrl+P'],
    mac: ['Cmd+P'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Close presentation
  {
    id: 'slides-06',
    scope: 'slides',
    win: ['Ctrl+W'],
    mac: ['Cmd+W'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Undo
  {
    id: 'slides-07',
    scope: 'slides',
    win: ['Ctrl+Z'],
    mac: ['Cmd+Z'],
    match: 'key',
    guard: {},
  },
  // Redo
  {
    id: 'slides-08',
    scope: 'slides',
    win: ['Ctrl+Y'],
    mac: [],
    web: { win: ['Ctrl+Y'], mac: ['Cmd+Y'] },
    match: 'key',
    guard: {},
  },
  // Paste Special
  {
    id: 'slides-10',
    scope: 'slides',
    win: ['Ctrl+Alt+V'],
    mac: ['Ctrl+Cmd+V'],
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  // Copy formatting
  {
    id: 'slides-11',
    scope: 'slides',
    win: ['Ctrl+Shift+C'],
    mac: ['Shift+Cmd+C'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Paste formatting
  {
    id: 'slides-12',
    scope: 'slides',
    win: ['Ctrl+Shift+V'],
    mac: ['Shift+Cmd+V'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Select all (objects / slides)
  {
    id: 'slides-13',
    scope: 'slides',
    win: [],
    mac: [],
    web: { win: ['Ctrl+A'], mac: ['Cmd+A'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // New slide
  {
    id: 'slides-14',
    scope: 'slides',
    win: ['Ctrl+M'],
    mac: ['Shift+Cmd+N'],
    web: { win: ['Ctrl+M'], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Duplicate selected slide
  {
    id: 'slides-15',
    scope: 'slides',
    win: ['Ctrl+Shift+D'],
    mac: ['Shift+Cmd+D'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Duplicate selected object
  {
    id: 'slides-16',
    scope: 'slides',
    win: ['Ctrl+D'],
    mac: [],
    web: { win: ['Ctrl+D'], mac: ['Cmd+D'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Start slide show from the beginning
  {
    id: 'slides-22',
    scope: 'slides',
    win: [],
    mac: ['Shift+Cmd+Enter', 'F5'],
    web: { win: ['Ctrl+F5'], mac: ['Shift+Cmd+Enter'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Start slide show from the current slide
  {
    id: 'slides-23',
    scope: 'slides',
    win: ['Shift+F5'],
    mac: ['Cmd+Enter'],
    web: { win: ['Ctrl+Shift+F5'], mac: ['Shift+Cmd+F5'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Presenter view
  {
    id: 'slides-24',
    scope: 'slides',
    win: ['Alt+F5'],
    mac: ['Alt+Enter'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Show: hide pointer / navigation buttons
  {
    id: 'slides-32',
    scope: 'slides',
    context: 'slideshow',
    win: ['Ctrl+H'],
    mac: ['Cmd+I'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Group
  {
    id: 'slides-37',
    scope: 'slides',
    win: [],
    mac: [],
    web: { win: ['Ctrl+G'], mac: ['Alt+Cmd+G'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Ungroup
  {
    id: 'slides-38',
    scope: 'slides',
    win: [],
    mac: ['Alt+Shift+Cmd+G'],
    web: { win: ['Ctrl+Shift+G'], mac: ['Alt+Shift+Cmd+G'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Regroup
  {
    id: 'slides-39',
    scope: 'slides',
    win: ['Ctrl+Shift+J'],
    mac: ['Alt+Cmd+J'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Insert comment
  {
    id: 'slides-47',
    scope: 'slides',
    win: ['Ctrl+Alt+M'],
    mac: ['Shift+Cmd+M'],
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  // Bold
  {
    id: 'slides-48',
    scope: 'slides',
    win: ['Ctrl+B'],
    mac: ['Cmd+B'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Italic
  {
    id: 'slides-49',
    scope: 'slides',
    win: ['Ctrl+I'],
    mac: ['Cmd+I'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Underline
  {
    id: 'slides-50',
    scope: 'slides',
    win: ['Ctrl+U'],
    mac: ['Cmd+U'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Clear character formatting
  {
    id: 'slides-53',
    scope: 'slides',
    win: ['Ctrl+Space'],
    mac: ['Ctrl+Space'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Find
  {
    id: 'slides-60',
    scope: 'slides',
    win: ['Ctrl+F'],
    mac: ['Cmd+F'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Replace
  {
    id: 'slides-61',
    scope: 'slides',
    win: ['Ctrl+H'],
    mac: ['Shift+Cmd+H'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Next placeholder / commit text (Ctrl+Enter)
  {
    id: 'slides-62',
    scope: 'slides',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Enter'], mac: ['Ctrl+Enter'] },
    match: 'key',
    guard: {},
  },
  // Soft line break (Shift+Enter)
  {
    id: 'slides-66',
    scope: 'slides',
    win: [],
    mac: [],
    web: { win: ['Shift+Enter'], mac: ['Shift+Enter'] },
    match: 'key',
    guard: {},
  },
  // Zoom to fit
  {
    id: 'slides-68',
    scope: 'slides',
    win: ['Ctrl+Alt+O'],
    mac: ['Alt+Cmd+O'],
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  },
  // Toggle Outline and Thumbnail panes (Ctrl+Shift+Tab)
  {
    id: 'slides-70',
    scope: 'slides',
    win: ['Ctrl+Shift+Tab'],
    mac: ['Ctrl+Shift+Tab'],
    web: { win: [], mac: [] },
    webAlt: { win: 'Alt+Shift+O', mac: 'Alt+Shift+O' },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Expand or collapse ribbon
  {
    id: 'slides-71',
    scope: 'slides',
    win: ['Ctrl+F1'],
    mac: [],
    web: { win: ['Ctrl+F1'], mac: ['Alt+Cmd+R'] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Help
  {
    id: 'slides-73',
    scope: 'slides',
    win: ['F1'],
    mac: ['F1'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
]

export const slidesUnmapped: readonly UnmappedShortcut[] = [
  {
    id: 'slides-01',
    part: 'web.win',
    reason:
      'proposal has prose: "no in-app key; Ctrl+N / Cmd+N stay the browser\'s; New by File menu / documents-list button (MS web equivalent = the PowerPoint.new address-bar route) / same"',
  },
  {
    id: 'slides-01',
    part: 'web.mac',
    reason:
      'proposal has prose: "no in-app key; Ctrl+N / Cmd+N stay the browser\'s; New by File menu / documents-list button (MS web equivalent = the PowerPoint.new address-bar route) / same"',
  },
  {
    id: 'slides-02',
    part: 'web.win',
    reason:
      'proposal has prose: "Ctrl+O / Cmd+O handled in the frame where UniWork has an Open action; MS PowerPoint web says Ctrl+O applies to the browser and prints no alternative or override setting, so the MS desktop key is kept ( where there is no Open action the browser keeps it"',
  },
  {
    id: 'slides-02',
    part: 'web.mac',
    reason:
      'proposal has prose: "Ctrl+O / Cmd+O handled in the frame where UniWork has an Open action; MS PowerPoint web says Ctrl+O applies to the browser and prints no alternative or override setting, so the MS desktop key is kept ( where there is no Open action the browser keeps it"',
  },
  {
    id: 'slides-08',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'slides-09',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: several chords for one row (sub-actions): "Ctrl+X / Ctrl+C / Ctrl+V / Cmd+X / Cmd+C / Cmd+V"',
  },
  {
    id: 'slides-12',
    part: 'web.win',
    reason:
      'proposal has prose: "no web key for Paste formatting (Ctrl+Shift+V / Cmd+Shift+V is Paste text, unformatted on MS web: shell-07, docs-016); Paste formatting by ribbon / context menu"',
  },
  {
    id: 'slides-12',
    part: 'web.mac',
    reason:
      'proposal has prose: "no web key for Paste formatting (Ctrl+Shift+V / Cmd+Shift+V is Paste text, unformatted on MS web: shell-07, docs-016); Paste formatting by ribbon / context menu"',
  },
  {
    id: 'slides-13',
    part: 'desktop.win',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'slides-13',
    part: 'desktop.mac',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'slides-16',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'slides-17',
    part: 'row',
    reason:
      'desktop: proposal is conditional: "mac: MS page prints Control+Drag; ours is Option+drag (decide which to follow)"; web: proposal has prose: "Ctrl+drag / Option+drag"',
  },
  {
    id: 'slides-18',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: proposal has prose: "Delete / Delete (Backspace kept)"',
  },
  {
    id: 'slides-19',
    part: 'row',
    reason:
      'desktop: several chords for one row (sub-actions): "Ctrl+Up / Ctrl+Down; mac Cmd+Up / Cmd+Down (MS)"; web: several chords for one row (sub-actions): "Ctrl+Up / Ctrl+Down / Cmd+Up / Cmd+Down"',
  },
  {
    id: 'slides-20',
    part: 'row',
    reason:
      'desktop: several chords for one row (sub-actions): "Ctrl+Shift+Up / Ctrl+Shift+Down; mac Cmd+Shift+Up / Cmd+Shift+Down (MS)"; web: several chords for one row (sub-actions): "Ctrl+Shift+Up / Ctrl+Shift+Down / Cmd+Shift+Up / Cmd+Shift+Down"',
  },
  {
    id: 'slides-21',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: proposal has prose: "Page down / Page up / Fn+Down / Fn+Up (= Page down / Page up key events)"',
  },
  {
    id: 'slides-22',
    part: 'desktop.win',
    reason: 'no win chord in proposal_desktop',
  },
  {
    id: 'slides-25',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: proposal has prose: "N / Enter (Return) / Page down / Right / Down / Space"',
  },
  {
    id: 'slides-26',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: proposal has prose: "P / Page up / Left / Up / Backspace (mac: Delete)"',
  },
  {
    id: 'slides-27',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: "WIN / MAC" pair on a row with several sub-actions: "Home / End (mac Fn+Left / Fn+Right = Home / End)"',
  },
  {
    id: 'slides-28',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "G, then Right / Left arrow, then Enter (Return) / same"',
  },
  {
    id: 'slides-29',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "Esc / Esc"',
  },
  {
    id: 'slides-30',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: "WIN / MAC" pair on a row with several sub-actions: "B or . = black; W or , = white / same (B, W, Shift variants on mac)"',
  },
  {
    id: 'slides-31',
    part: 'row',
    reason: 'desktop: proposal has prose: "H"; web: proposal has prose: "H / H"',
  },
  {
    id: 'slides-33',
    part: 'row',
    reason:
      'desktop: proposal has prose: "same as MS (inside the show only)"; web: proposal has prose: "Ctrl+L / Ctrl+P / Ctrl+A / Ctrl+E / Ctrl+M / E / Cmd+L / Cmd+P / Cmd+A / Shift+E"',
  },
  {
    id: 'slides-34',
    part: 'row',
    reason:
      'desktop: same as web, and web is unmapped; web: proposal has prose: "Ctrl+S (All Slides, show-scoped); Ctrl+T and F1: no key / Control+click"',
  },
  {
    id: 'slides-35',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Tab / Shift+Tab / Return (MS)"; web: proposal has prose: "Tab / Shift+Tab / Enter (Return) while a hyperlink is selected"',
  },
  {
    id: 'slides-36',
    part: 'row',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'slides-37',
    part: 'desktop.win',
    reason: 'proposal has prose: "mac: add Cmd+Option+G (MS); ours Cmd+G also stays"',
  },
  {
    id: 'slides-37',
    part: 'desktop.mac',
    reason: 'proposal has prose: "mac: add Cmd+Option+G (MS); ours Cmd+G also stays"',
  },
  {
    id: 'slides-38',
    part: 'desktop.win',
    reason: 'no win chord in proposal_desktop',
  },
  {
    id: 'slides-40',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "Arrow keys / Arrow keys (Ctrl+Arrow fine step kept)"',
  },
  {
    id: 'slides-41',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "Shift+Arrow / Shift+Arrow"',
  },
  {
    id: 'slides-42',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: proposal has prose: "Tab / Shift+Tab"',
  },
  {
    id: 'slides-43',
    part: 'row',
    reason:
      'desktop: several chords for one row (sub-actions): "Alt+Left / Alt+Right; mac Option+Left / Option+Right (MS)"; web: several chords for one row (sub-actions): "Alt+Right / Alt+Left / Option+Right / Option+Left"',
  },
  {
    id: 'slides-44',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Ctrl+Shift+] / [ ; mac Cmd+Option+Shift+F / B (MS)"; web: proposal has prose: "Ctrl+] / Ctrl+[ one step; Ctrl+Shift+] / Ctrl+Shift+[ front / back / Cmd+Shift+Option+F / B one step; Cmd+Shift+F front; Cmd+Shift+Option+[ back"',
  },
  {
    id: 'slides-45',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Ctrl+Space; mac Space (MS)"; web: proposal has prose: "Space (media object selected) / Space"',
  },
  {
    id: 'slides-46',
    part: 'row',
    reason:
      'desktop: several chords for one row (sub-actions): "Alt+F9 / Shift+F9 / Alt+F10; mac Cmd+Option+Ctrl+G / Shift+F9"; web: several chords for one row (sub-actions): "Alt+F9 / Shift+F9 / Alt+F10 / Cmd+Option+Control+G / Shift+F9"',
  },
  {
    id: 'slides-51',
    part: 'row',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'slides-52',
    part: 'row',
    reason:
      'desktop: proposal has prose: "same as MS in the text editor"; web: proposal has prose: "Ctrl+= / Ctrl+Shift++ while editing text / Cmd+Control+= / Cmd+Control+Shift+="',
  },
  {
    id: 'slides-54',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: several chords for one row (sub-actions): "Ctrl+Shift+> / Ctrl+Shift+< / Cmd+Shift+> / Cmd+Shift+<"',
  },
  {
    id: 'slides-55',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: "WIN / MAC" pair on a row with several sub-actions: "Ctrl+] / Ctrl+[ font size +/-1 pt only while text is edited; with an object selected they are z-order one step (slides-44)"',
  },
  {
    id: 'slides-56',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: several chords for one row (sub-actions): "Ctrl+E / Ctrl+L / Ctrl+R / Ctrl+J / Cmd+E / Cmd+Shift+L / Cmd+Shift+R / Cmd+J"',
  },
  {
    id: 'slides-57',
    part: 'row',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'slides-58',
    part: 'row',
    reason:
      'desktop: proposal has prose: "add Alt+Shift+Right / Left; mac Cmd+] / Cmd+[ (MS)"; web: proposal has prose: "Tab / Shift+Tab kept; Alt+Shift+Right / Alt+Shift+Left / Cmd+]"',
  },
  {
    id: 'slides-59',
    part: 'row',
    reason:
      'desktop: same as web, and web is unmapped; web: proposal has prose: "Ctrl+K / Cmd+K = hyperlink; Ask AI popover by button only"',
  },
  {
    id: 'slides-62',
    part: 'desktop.win',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'slides-62',
    part: 'desktop.mac',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'slides-63',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: "WIN / MAC" pair on a row with several sub-actions: "Enter or F2 edit; F2 end editing / Return or F2; F2 (Esc kept as an end-edit alias)"',
  },
  {
    id: 'slides-64',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: proposal has prose: "Tab / Shift+Tab"',
  },
  {
    id: 'slides-65',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: "WIN / MAC" pair on a row with several sub-actions: "native browser text-editing keys / same"',
  },
  {
    id: 'slides-66',
    part: 'desktop.win',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'slides-66',
    part: 'desktop.mac',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'slides-67',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: proposal has prose: "Ctrl+= or Ctrl++ zoom in / Ctrl+- zoom out / Ctrl+0 reset / Cmd variants"',
  },
  {
    id: 'slides-69',
    part: 'row',
    reason:
      'desktop: several chords for one row (sub-actions): "F6 / Shift+F6 (MS)"; web: several chords for one row (sub-actions): "Ctrl+F6 / Shift+Ctrl+F6 / Cmd+F6 / Shift+Cmd+F6"',
  },
  {
    id: 'slides-71',
    part: 'desktop.mac',
    reason: "KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'slides-72',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Alt / F10 (MS Windows)"; web: proposal has prose: "Alt+Period (.) / Ctrl+Period (.)"',
  },
  {
    id: 'slides-73',
    part: 'web.win',
    reason: 'proposal has prose: "no key: F1 stays the browser\'s; Help by button / none"',
  },
  {
    id: 'slides-73',
    part: 'web.mac',
    reason: 'proposal has prose: "no key: F1 stays the browser\'s; Help by button / none"',
  },
  {
    id: 'slides-74',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "Esc / Esc"',
  },
  {
    id: 'slides-75',
    part: 'row',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'slides-76',
    part: 'row',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'slides-78',
    part: 'row',
    reason:
      'desktop: proposal is conditional: "KEEP (decide whether DevTools stays in packaged builds; docs and sheets hide it)"; web: KEEP on a row that names several sub-actions',
  },
  {
    id: 'slides-dialog-keys',
    part: 'row',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
]

export const slidesNotes: readonly ShortcutNote[] = [
  {
    id: 'slides-02',
    part: 'web',
    detail:
      'ALT-PROPOSED without a single chord: ", not Chromium-reserved); where there is no Open action the"',
  },
  {
    id: 'slides-06',
    part: 'web.win',
    detail: 'Ctrl+W is browser-reserved',
  },
  {
    id: 'slides-06',
    part: 'web.mac',
    detail: 'Cmd+W is browser-reserved',
  },
  {
    id: 'slides-14',
    part: 'web.mac',
    detail: 'no web chord (none)',
  },
]
// @generated-end

/** Hand-maintained rows: an entry with a generated id replaces that row. */
const manual: readonly ShortcutAction[] = []

export const slidesShortcuts: readonly ShortcutAction[] = mergeRows(generated, manual)

/** Why a manual row has no chord on a surface or platform, and remarks on manual rows:
 * merged after the generated lists into `SHORTCUT_UNMAPPED` / `SHORTCUT_NOTES`. */
export const slidesManualUnmapped: readonly UnmappedShortcut[] = []
export const slidesManualNotes: readonly ShortcutNote[] = []
