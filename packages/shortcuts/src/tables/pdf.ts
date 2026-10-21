// pdf shortcut table. The block between the @generated markers is written
// by scripts/gen-tables.mjs from tests/fixtures/shortcuts.csv: change the CSV and
// regenerate, or put hand-maintained rows in `manual` below.
import { mergeRows } from '../table'
import type { ShortcutAction, ShortcutNote, UnmappedShortcut } from '../types'

// @generated-begin
const generated: readonly ShortcutAction[] = [
  // Save (write the PDF)
  {
    id: 'pdf-01',
    scope: 'pdf',
    win: ['Ctrl+S'],
    mac: ['Cmd+S'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Redo document edit (ours-only)
  {
    id: 'pdf-04',
    scope: 'pdf',
    win: ['Ctrl+Y', 'Ctrl+Shift+Z'],
    mac: ['Shift+Cmd+Z'],
    web: { win: ['Ctrl+Y', 'Ctrl+Shift+Z'], mac: ['Cmd+Y', 'Shift+Cmd+Z'] },
    match: 'key',
    guard: {},
  },
  // Find in document
  {
    id: 'pdf-05',
    scope: 'pdf',
    win: ['Ctrl+F'],
    mac: ['Cmd+F'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Print
  {
    id: 'pdf-07',
    scope: 'pdf',
    win: ['Ctrl+P'],
    mac: ['Cmd+P'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Zoom in
  {
    id: 'pdf-08',
    scope: 'pdf',
    win: [],
    mac: [],
    web: {
      win: ['Ctrl+Equal', 'Ctrl+Shift+Equal', 'Ctrl+NumpadAdd'],
      mac: ['Cmd+Equal', 'Shift+Cmd+Equal', 'Cmd+NumpadAdd'],
    },
    match: 'key',
    guard: {},
  },
  // Zoom out
  {
    id: 'pdf-09',
    scope: 'pdf',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Minus', 'Ctrl+NumpadSubtract'], mac: ['Cmd+Minus', 'Cmd+NumpadSubtract'] },
    match: 'key',
    guard: {},
  },
  // Toggle fit to page / fit to width
  {
    id: 'pdf-11',
    scope: 'pdf',
    win: ['Ctrl+Backslash'],
    mac: ['Cmd+Backslash'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
]

export const pdfUnmapped: readonly UnmappedShortcut[] = [
  {
    id: 'pdf-02',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Ctrl+Shift+S / Shift+Cmd+S = Save As; renderer must let the menu win"; web: proposal has prose: "Ctrl+Shift+S / Cmd+Shift+S (PowerPoint desktop chord; Edge PDF has none); test shiftKey in the renderer; F12 stays with Docs (common-05)"',
  },
  {
    id: 'pdf-03',
    part: 'row',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'pdf-06',
    part: 'row',
    reason:
      'desktop: several chords for one row (sub-actions): "Ctrl+G / Ctrl+Shift+G (Windows), Cmd+G / Cmd+Shift+G (Mac), F3 / Shift+F3"; web: proposal has prose: "Ctrl+G / Ctrl+Shift+G and F3 / Shift+F3 while the PDF frame has focus / Cmd+G / Cmd+Shift+G (Edge PDF keys; preventDefault)"',
  },
  {
    id: 'pdf-08',
    part: 'desktop.win',
    reason:
      'KEEP: the Microsoft win cell lists several sub-actions; KEEP: the Microsoft mac cell lists several sub-actions',
  },
  {
    id: 'pdf-08',
    part: 'desktop.mac',
    reason:
      'KEEP: the Microsoft win cell lists several sub-actions; KEEP: the Microsoft mac cell lists several sub-actions',
  },
  {
    id: 'pdf-09',
    part: 'desktop.win',
    reason:
      'KEEP: the Microsoft win cell lists several sub-actions; KEEP: the Microsoft mac cell lists several sub-actions',
  },
  {
    id: 'pdf-09',
    part: 'desktop.mac',
    reason:
      'KEEP: the Microsoft win cell lists several sub-actions; KEEP: the Microsoft mac cell lists several sub-actions',
  },
  {
    id: 'pdf-10',
    part: 'row',
    reason:
      'desktop: same as web, and web is unmapped; web: proposal has prose: "Ctrl+0 = 100% / Cmd+0 (Edge reset zoom); fit-width on Ctrl+\\ (pdf-11)"',
  },
  {
    id: 'pdf-11',
    part: 'web.win',
    reason: 'proposal has prose: "Ctrl+\\ toggles fit page / fit width / Cmd+\\ (Edge PDF key)"',
  },
  {
    id: 'pdf-11',
    part: 'web.mac',
    reason: 'proposal has prose: "Ctrl+\\ toggles fit page / fit width / Cmd+\\ (Edge PDF key)"',
  },
  {
    id: 'pdf-12',
    part: 'row',
    reason:
      'desktop: several chords for one row (sub-actions): "Ctrl+[ / Ctrl+] (Windows), Cmd+[ / Cmd+] (Mac)"; web: proposal has prose: "Ctrl+[ / Ctrl+] rotate inside the PDF frame / Cmd+[ / Cmd+] (Edge PDF keys; preventDefault: Chrome Mac uses Cmd+[ for history back)"',
  },
  {
    id: 'pdf-13',
    part: 'row',
    reason:
      'desktop: same as web, and web is unmapped; web: proposal has prose: "KEEP Enter in the box; no chord (Ctrl+G is Find next)"',
  },
  {
    id: 'pdf-14',
    part: 'row',
    reason:
      'desktop: same as web, and web is unmapped; web: proposal has prose: "Space / Shift+Space scroll down / up, PageDown / PageUp (Edge PDF keys)"',
  },
  {
    id: 'pdf-15',
    part: 'row',
    reason:
      'desktop: same as web, and web is unmapped; web: proposal has prose: "Home / End (Edge PDF keys); Ctrl+Home / Ctrl+End not bound"',
  },
  {
    id: 'pdf-16',
    part: 'row',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'pdf-17',
    part: 'row',
    reason:
      'desktop: proposal has prose: "KEEP none"; web: proposal has prose: "KEEP none (not documented for Edge PDF or MS web)"',
  },
  {
    id: 'pdf-18',
    part: 'row',
    reason:
      'desktop: proposal has prose: "KEEP none"; web: proposal has prose: "KEEP none (not documented for Edge PDF or MS web)"',
  },
  {
    id: 'pdf-19',
    part: 'desktop.win',
    reason:
      'proposal has prose: "F11 / Command+Ctrl+F: add the togglefullscreen role to the PDF menu"',
  },
  {
    id: 'pdf-19',
    part: 'desktop.mac',
    reason:
      'proposal has prose: "F11 / Command+Ctrl+F: add the togglefullscreen role to the PDF menu"',
  },
  {
    id: 'pdf-19',
    part: 'row',
    reason: 'no chord left on any platform',
  },
  {
    id: 'pdf-20',
    part: 'row',
    reason:
      'desktop: proposal has prose: "KEEP none"; web: proposal has prose: "KEEP none until a read-aloud feature exists (Edge PDF: Ctrl+Shift+U)"',
  },
  {
    id: 'pdf-21',
    part: 'row',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'pdf-22',
    part: 'row',
    reason: 'KEEP on a row that names several sub-actions',
  },
  {
    id: 'pdf-23',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "KEEP Esc"',
  },
  {
    id: 'pdf-24',
    part: 'row',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'pdf-25',
    part: 'row',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'pdf-dialog-keys',
    part: 'row',
    reason:
      'desktop: proposal has prose: "same"; web: "WIN / MAC" pair on a row with several sub-actions: "KEEP Enter / Esc; add isComposing guard to every Enter confirm"',
  },
  {
    id: 'pdf-open',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "same as common-03 (Ctrl+O / Cmd+O only where an Open action exists)"',
  },
]

export const pdfNotes: readonly ShortcutNote[] = [
  {
    id: 'pdf-19',
    part: 'web',
    detail: 'the browser keeps the Microsoft key',
  },
]
// @generated-end

/** Hand-maintained rows: an entry with a generated id replaces that row. */
const manual: readonly ShortcutAction[] = [
  // Save As: the shell menu (desktop) or the host (web frame) owns the dialog. The
  // renderer matches the chord only so that it is not mistaken for Save.
  {
    id: 'pdf-02',
    scope: 'pdf',
    win: ['Ctrl+Shift+S'],
    mac: ['Shift+Cmd+S'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Undo document edit (ours-only; a text field keeps its own undo)
  {
    id: 'pdf-03',
    scope: 'pdf',
    win: ['Ctrl+Z'],
    mac: ['Cmd+Z'],
    match: 'key',
    guard: {},
  },
  // Find next (F3 / Ctrl+G / Cmd+G) and previous (the same with Shift)
  {
    id: 'pdf-06',
    scope: 'pdf',
    win: ['Ctrl+G', 'Ctrl+Shift+G', 'F3', 'Shift+F3'],
    mac: ['Cmd+G', 'Shift+Cmd+G', 'F3', 'Shift+F3'],
    match: 'key',
    guard: {},
  },
  // Zoom in / out (Edge PDF: Ctrl+Plus / Ctrl+Minus), with the Shift and keypad aliases
  {
    id: 'pdf-08',
    scope: 'pdf',
    win: ['Ctrl+Equal', 'Ctrl+Shift+Equal', 'Ctrl+NumpadAdd'],
    mac: ['Cmd+Equal', 'Shift+Cmd+Equal', 'Cmd+NumpadAdd'],
    match: 'key',
    guard: {},
  },
  {
    id: 'pdf-09',
    scope: 'pdf',
    win: ['Ctrl+Minus', 'Ctrl+NumpadSubtract'],
    mac: ['Cmd+Minus', 'Cmd+NumpadSubtract'],
    match: 'key',
    guard: {},
  },
  // Reset zoom to 100%
  {
    id: 'pdf-10',
    scope: 'pdf',
    win: ['Ctrl+0', 'Ctrl+Numpad0'],
    mac: ['Cmd+0', 'Cmd+Numpad0'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Toggle fit to page / fit to width (Edge PDF key; the web frame has it too)
  {
    id: 'pdf-11',
    scope: 'pdf',
    win: ['Ctrl+Backslash'],
    mac: ['Cmd+Backslash'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Rotate counterclockwise / clockwise (Edge PDF: Ctrl+[ / Ctrl+])
  {
    id: 'pdf-12',
    scope: 'pdf',
    win: ['Ctrl+BracketLeft', 'Ctrl+BracketRight'],
    mac: ['Cmd+BracketLeft', 'Cmd+BracketRight'],
    match: 'key',
    guard: {},
  },
  // The bare keys below are module-local: they never leave their `context`, so the window-level
  // keymap (no context) is not shadowed. Win and Mac print the same keys.
  // Go to page: Enter in the page box
  {
    id: 'pdf-13',
    scope: 'pdf',
    context: 'page-box',
    win: ['Enter'],
    mac: ['Enter'],
    match: 'key',
    guard: {},
  },
  // Scroll one screen down / up (Edge PDF: Space, Shift+Space, PageDown, PageUp)
  {
    id: 'pdf-14',
    scope: 'pdf',
    context: 'nav',
    win: ['Space', 'Shift+Space', 'PageDown', 'PageUp'],
    mac: ['Space', 'Shift+Space', 'PageDown', 'PageUp'],
    match: 'key',
    guard: {},
  },
  // Top / bottom (Edge PDF: Home / End) and the 60 px scroll (ours: Up / Down)
  {
    id: 'pdf-15',
    scope: 'pdf',
    context: 'nav',
    win: ['Home', 'End', 'Up', 'Down'],
    mac: ['Home', 'End', 'Up', 'Down'],
    match: 'key',
    guard: {},
  },
  // Next / previous page (ours: Right / Left, spread aware)
  {
    id: 'pdf-16',
    scope: 'pdf',
    context: 'nav',
    win: ['Right', 'Left'],
    mac: ['Right', 'Left'],
    match: 'key',
    guard: {},
  },
  // Margin note box: Ctrl+Enter submits, Esc cancels
  {
    id: 'pdf-21',
    scope: 'pdf',
    context: 'note',
    win: ['Ctrl+Enter', 'Escape'],
    mac: ['Cmd+Enter', 'Escape'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Delete the selected annotation / object (ours-only; not while focus is in a field)
  {
    id: 'pdf-22',
    scope: 'pdf',
    context: 'selection',
    win: ['Delete', 'Backspace'],
    mac: ['Delete', 'Backspace'],
    match: 'key',
    guard: {},
  },
  // Esc closes the innermost tool or overlay (ours-only)
  {
    id: 'pdf-23',
    scope: 'pdf',
    context: 'overlay',
    win: ['Escape'],
    mac: ['Escape'],
    match: 'key',
    guard: {},
  },
  // In-place text edit: Ctrl+Enter commits, Esc cancels, Backspace / Delete on an empty draft
  // removes the run (ours-only)
  {
    id: 'pdf-24',
    scope: 'pdf',
    context: 'text-edit',
    win: ['Ctrl+Enter', 'Escape', 'Backspace', 'Delete'],
    mac: ['Cmd+Enter', 'Escape', 'Backspace', 'Delete'],
    match: 'key',
    guard: { noRepeat: true },
  },
  // Ask-AI popover: Enter submits, Esc closes (ours-only)
  {
    id: 'pdf-25',
    scope: 'pdf',
    context: 'ask',
    win: ['Enter', 'Escape'],
    mac: ['Enter', 'Escape'],
    match: 'key',
    guard: {},
  },
  // Dialogs: Enter confirms, Esc cancels. The id is the CSV's own (shortcuts.csv line 332),
  // not a `pdf-<n>`: a trace that keys on a numeric suffix must not assume one.
  {
    id: 'pdf-dialog-keys',
    scope: 'pdf',
    context: 'dialog',
    win: ['Enter', 'Escape'],
    mac: ['Enter', 'Escape'],
    match: 'key',
    guard: {},
  },
]

export const pdfShortcuts: readonly ShortcutAction[] = mergeRows(generated, manual)

/** Why a manual row has no chord on a surface or platform, and remarks on manual rows:
 * merged after the generated lists into `SHORTCUT_UNMAPPED` / `SHORTCUT_NOTES`. */
export const pdfManualUnmapped: readonly UnmappedShortcut[] = []
export const pdfManualNotes: readonly ShortcutNote[] = []
