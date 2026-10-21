// shell shortcut table. The block between the @generated markers is written
// by scripts/gen-tables.mjs from tests/fixtures/shortcuts.csv: change the CSV and
// regenerate, or put hand-maintained rows in `manual` below.
import { mergeRows } from '../table'
import type { ShortcutAction, ShortcutNote, UnmappedShortcut } from '../types'

// @generated-begin
const generated: readonly ShortcutAction[] = [
  // Undo (Edit menu)
  {
    id: 'shell-04',
    scope: 'shell',
    win: ['Ctrl+Z'],
    mac: ['Cmd+Z'],
    match: 'key',
    guard: {},
  },
  // Redo (Edit menu)
  {
    id: 'shell-05',
    scope: 'shell',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Y', 'Ctrl+Shift+Z'], mac: ['Cmd+Y', 'Shift+Cmd+Z'] },
    match: 'key',
    guard: {},
  },
  // Insert hyperlink (Docs menu)
  {
    id: 'shell-09',
    scope: 'shell',
    win: ['Ctrl+K'],
    mac: ['Cmd+K'],
    web: { win: [], mac: [] },
    match: 'key',
    guard: { noRepeat: true },
  },
  // Font dialog (Docs menu)
  {
    id: 'shell-11',
    scope: 'shell',
    win: ['Ctrl+D', 'Ctrl+Shift+F'],
    mac: ['Cmd+D'],
    match: 'key',
    guard: { noRepeat: true },
  },
]

export const shellUnmapped: readonly UnmappedShortcut[] = [
  {
    id: 'shell-01',
    part: 'row',
    reason:
      'desktop: proposal has prose: "ALT-PROPOSED move off Ctrl+Shift+H (Word: Hide the selected text; Excel Mac: Replace is Cmd+Shift+H; macOS Finder Home is Shift-Command-H); candidate Ctrl+Alt+Home is unverified, test in stage 2"; web: proposal has prose: "n/a (no Home page on web)"',
  },
  {
    id: 'shell-02',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "n/a"',
  },
  {
    id: 'shell-03',
    part: 'row',
    reason:
      'desktop: proposal has prose: "ALT-PROPOSED move interface scale to a settings control or Ctrl+Shift chords; keep Ctrl+Alt+= / Ctrl+Alt+- for Sheets grid zoom (Excel). Ctrl+Alt is AltGr on many layouts"; web: proposal has prose: "n/a (interface scale is desktop-only)"',
  },
  {
    id: 'shell-05',
    part: 'desktop.win',
    reason:
      'proposal has prose: "Add Ctrl+Y as a menu accelerator for Docs, Sheets, Slides and PDF; keep Ctrl+Shift+Z"',
  },
  {
    id: 'shell-05',
    part: 'desktop.mac',
    reason:
      'proposal has prose: "Add Ctrl+Y as a menu accelerator for Docs, Sheets, Slides and PDF; keep Ctrl+Shift+Z"',
  },
  {
    id: 'shell-06',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: several chords for one row (sub-actions): "Ctrl+X / Ctrl+C / Ctrl+V / Ctrl+A / Cmd+X / Cmd+C / Cmd+V / Cmd+A"',
  },
  {
    id: 'shell-07',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Docs Windows Ctrl+Shift+V as Word; Mac Cmd+Shift+V (Word Mac) instead of Opt+Shift+Cmd+V"; web: proposal has prose: "Docs: Ctrl+Shift+V / Cmd+Shift+V = paste text only | Slides: Ctrl+Shift+V / Cmd+Shift+V = paste text, unformatted | Sheets: KEEP no Ctrl+Shift+V paste-values (MS web contradicts itself: \'Paste formatting\' Shift+Ctrl+V in the table vs plain text in the copy-paste article)"',
  },
  {
    id: 'shell-08',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Add F5 as Go To alias (Word: Cmd+Option+G or F5; Windows F5 shows Go To); Ctrl+H Replace"; web: several chords for one row (sub-actions): "Ctrl+F / Ctrl+G / Cmd+F / Cmd+Option+G (mac from desktop, web page has no Mac column)"',
  },
  {
    id: 'shell-09',
    part: 'web.win',
    reason:
      'proposal has prose: "Ctrl+K / Cmd+K inside frames and Docs menu (Office key wins while a document is open, USER ADDENDUM 1)"',
  },
  {
    id: 'shell-09',
    part: 'web.mac',
    reason:
      'proposal has prose: "Ctrl+K / Cmd+K inside frames and Docs menu (Office key wins while a document is open, USER ADDENDUM 1)"',
  },
  {
    id: 'shell-10',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: several chords for one row (sub-actions): "Ctrl+B / Ctrl+I / Ctrl+U / Cmd+B / Cmd+I / Cmd+U (mac from desktop, web page has no Mac column)"',
  },
  {
    id: 'shell-12',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Ctrl+Alt+M = Insert comment (Word); Mac Cmd+Option+A = Insert comment (see S1)"; web: proposal has prose: "Free Ctrl+Alt+M / Cmd+Option+A for Word \'Insert comment\' (mac from desktop) and Ctrl+Alt+M / Cmd+Shift+M for Slides (PowerPoint web prints both); paragraph dialog via ribbon or context menu; match with event.code and no AltGraph so Ctrl+Alt+M typing on AltGr layouts is not stolen"',
  },
  {
    id: 'shell-13',
    part: 'row',
    reason:
      'desktop: proposal has prose: "KEEP no Ctrl+M on Windows (PowerPoint Ctrl+M = New slide)"; web: proposal has prose: "n/a (desktop-only window menu)"',
  },
  {
    id: 'shell-14',
    part: 'row',
    reason:
      'desktop: KEEP on a row that names several sub-actions; web: proposal has prose: "n/a (macOS desktop app menu)"',
  },
  {
    id: 'shell-15',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Decision with common-12: ribbon key tips would take over Alt; menu button stays"; web: proposal has prose: "n/a (no native menu bar on web; ribbon access keys are backlog, see common-12)"',
  },
  {
    id: 'shell-16',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Ctrl+P on Home must not mean "search" (Word/Excel/PowerPoint Ctrl+P = Print); KEEP Ctrl+F; match key case-insensitively"; web: proposal has prose: "n/a (no Home page on web)"',
  },
  {
    id: 'shell-17',
    part: 'row',
    reason:
      'desktop: KEEP: no Microsoft win chord confirmed by today\'s binding; KEEP: no Microsoft mac chord confirmed by today\'s binding; web: proposal has prose: "n/a"',
  },
  {
    id: 'shell-18',
    part: 'row',
    reason:
      "KEEP: no Microsoft win chord confirmed by today's binding; KEEP: no Microsoft mac chord confirmed by today's binding",
  },
  {
    id: 'shell-19',
    part: 'row',
    reason:
      'desktop: proposal has prose: "Decide whether UniChat needs a menu: Ctrl+W, Ctrl+Q, zoom and DevTools come from the default menu"; web: proposal has prose: "n/a (desktop shell)"',
  },
  {
    id: 'shell-20',
    part: 'row',
    reason:
      'desktop: proposal has prose: "See common-21 and common-22"; web: proposal has prose: "n/a (desktop shell)"',
  },
  {
    id: 'shell-dialog-keys',
    part: 'row',
    reason:
      'desktop: proposal has prose: "KEEP Esc / Enter; add isComposing / keyCode 229 to the window-level Esc listeners"; web: proposal has prose: "n/a"',
  },
]

export const shellNotes: readonly ShortcutNote[] = []
// @generated-end

/** Hand-maintained rows: an entry with a generated id replaces that row. */
const manual: readonly ShortcutAction[] = [
  // Redo: Ctrl+Y on Windows (Word, Excel, PowerPoint), the Shift variant stays
  {
    id: 'shell-05',
    scope: 'shell',
    win: ['Ctrl+Y', 'Ctrl+Shift+Z'],
    mac: ['Cmd+Y', 'Shift+Cmd+Z'],
    web: { win: ['Ctrl+Y', 'Ctrl+Shift+Z'], mac: ['Cmd+Y', 'Shift+Cmd+Z'] },
    match: 'key',
    guard: {},
  },
]

export const shellShortcuts: readonly ShortcutAction[] = mergeRows(generated, manual)

/** Why a manual row has no chord on a surface or platform, and remarks on manual rows:
 * merged after the generated lists into `SHORTCUT_UNMAPPED` / `SHORTCUT_NOTES`. */
export const shellManualUnmapped: readonly UnmappedShortcut[] = []
export const shellManualNotes: readonly ShortcutNote[] = []
