/**
 * Window-level Excel key chords that map onto ribbon commands (Univer-native
 * ones live in excel-shortcuts.ts). Every chord comes from a row of the sheets
 * shortcut table (`@genoffice/shortcuts`, UNI-2011) for the current platform
 * and surface; this file only says which command a row runs and when. Pure so
 * the table can be unit-tested; ExcelShell's keydown handler resolves and
 * dispatches.
 *
 * Gates: `grid` fires whenever a text field does not own focus (dialog
 * openers work on a selected cell); `sheet` additionally requires no in-cell
 * edit because the command writes to the range; `idle` only checks editing;
 * `formulaBar` also accepts Univer's formula bar, which `grid` skips; `always`
 * fires anywhere (file commands). Nothing fires while a modal is open: the grid
 * keeps focus behind the overlay, so the grid-target guard alone cannot see
 * the dialog.
 */
import {
  isComposingEvent,
  type ParsedChord,
  type ShortcutKeyEvent,
  type ShortcutPlatform,
  type ShortcutSurface,
} from '@genoffice/shortcuts'
import { sheetsShortcut } from '../shared/sheets-shortcuts'
import { BORDER_SHORTCUT_ROW, NUMBER_FORMAT_SHORTCUTS } from './excel-format-shortcuts'
import { isSecondSubAction, matchedChord } from './sheets-keymap'

export const MODAL_MASK_SELECTOR = '.dialog-backdrop'

export function isModalOpen(root: Pick<Document, 'querySelector'> | null = document): boolean {
  if (!root) return false
  return root.querySelector(MODAL_MASK_SELECTOR) !== null
}

export type GlobalShortcutAction =
  | {
      readonly kind: 'dialog'
      readonly dialog: 'formatCells' | 'goTo'
      /** Format Cells opens on this tab */
      readonly tab?: 'Font'
    }
  | { readonly kind: 'command'; readonly command: string }
  /** an application-menu action (the menu owns the primary chord on desktop) */
  | { readonly kind: 'menu'; readonly action: 'save-as' | 'redo' }

export interface GlobalShortcutKeyEvent extends ShortcutKeyEvent {
  readonly defaultPrevented: boolean
}

export interface GlobalShortcutGuards {
  readonly platform: ShortcutPlatform
  readonly surface: ShortcutSurface
  readonly modalOpen: boolean
  readonly cellEditing: boolean
  readonly gridTarget: boolean
  readonly formulaBarTarget: boolean
}

type Gate = 'grid' | 'sheet' | 'idle' | 'formulaBar' | 'always'

interface Binding {
  /** `shortcuts.csv` row id of the sheets table */
  readonly id: string
  readonly gate: Gate
  /** the action, or per chord for a row that names two sub-actions */
  readonly action: GlobalShortcutAction | ((chord: ParsedChord) => GlobalShortcutAction)
  /** the application menu carries the row's primary chord on desktop (sheets-main.ts) */
  readonly menu?: true
}

const command = (command: string): GlobalShortcutAction => ({ kind: 'command', command })
const bySubAction =
  (id: string, first: string, second: string) =>
  (chord: ParsedChord): GlobalShortcutAction =>
    command(isSecondSubAction(id, chord) ? second : first)

const BINDINGS: readonly Binding[] = [
  { id: 'sheets-04', gate: 'always', menu: true, action: { kind: 'menu', action: 'save-as' } },
  { id: 'sheets-08', gate: 'sheet', menu: true, action: { kind: 'menu', action: 'redo' } },
  { id: 'sheets-61', gate: 'grid', action: { kind: 'dialog', dialog: 'formatCells' } },
  { id: 'sheets-62', gate: 'grid', action: { kind: 'dialog', dialog: 'formatCells', tab: 'Font' } },
  { id: 'sheets-42', gate: 'grid', action: { kind: 'dialog', dialog: 'goTo' } },
  // Excel's F7: the Spelling dialog (Review ▸ Proofing here)
  { id: 'sheets-58', gate: 'grid', action: command('spell-check') },
  { id: 'sheets-55', gate: 'grid', action: command('toggle-show-formulas') },
  { id: 'sheets-78', gate: 'grid', action: command('link-open') },
  { id: 'sheets-79', gate: 'grid', action: command('note-open') },
  { id: 'sheets-80', gate: 'grid', action: command('comment-new') },
  { id: 'sheets-49', gate: 'grid', action: command('insert-function-open') },
  { id: 'sheets-50', gate: 'grid', action: command('name-manager-open') },
  { id: 'sheets-51', gate: 'formulaBar', action: command('formula-bar-toggle') },
  { id: 'sheets-66', gate: 'sheet', action: command('strike') },
  // Univer's own QuickSum already owns Alt+= (and Cmd+Option+= on a Mac); a key
  // it consumed arrives defaultPrevented and does not fire twice here
  { id: 'sheets-48', gate: 'sheet', action: command('autofn:SUM') },
  { id: 'sheets-76', gate: 'sheet', action: command('insert-now:date') },
  { id: 'sheets-77', gate: 'sheet', action: command('insert-now:time') },
  { id: 'sheets-45', gate: 'sheet', action: command('insert-sheet') },
  // Alt+F1 (web only) inserts the default chart; F11 (chart sheet) clashes with the Electron
  // fullscreen role on desktop, so desktop has no chart chord
  { id: 'sheets-46', gate: 'sheet', action: command('insert-chart:column') },
  { id: 'sheets-52', gate: 'sheet', action: command('flash-fill') },
  { id: 'sheets-12', gate: 'sheet', action: command('paste-special:value') },
  { id: 'sheets-11', gate: 'sheet', action: command('paste-special-open') },
  {
    id: 'sheets-56',
    gate: 'sheet',
    action: bySubAction('sheets-56', 'trace-precedents', 'trace-dependents'),
  },
  {
    id: 'sheets-91',
    gate: 'sheet',
    action: bySubAction('sheets-91', 'outline-group:auto', 'outline-ungroup:auto'),
  },
  {
    id: 'sheets-67',
    gate: 'sheet',
    action: bySubAction('sheets-67', 'font-size-step:1', 'font-size-step:-1'),
  },
  // Windows' Ctrl+Shift+L is Univer's own SmartToggleFilterShortcut (consumed first)
  { id: 'sheets-81', gate: 'sheet', action: command('filter-toggle') },
  { id: 'sheets-82', gate: 'sheet', action: command('table-create-open') },
  { id: 'sheets-53', gate: 'idle', action: command('calculate-now') },
  { id: 'sheets-54', gate: 'idle', action: command('calculate-sheet') },
  { id: 'sheets-38', gate: 'grid', action: bySubAction('sheets-38', 'page-col:1', 'page-col:-1') },
  // number-format / border chords write to the range
  ...Object.entries(NUMBER_FORMAT_SHORTCUTS).map(([id, pattern]): Binding => ({
    id,
    gate: 'sheet',
    action: command(`format:${pattern}`),
  })),
  {
    id: BORDER_SHORTCUT_ROW,
    gate: 'sheet',
    action: bySubAction(BORDER_SHORTCUT_ROW, 'border:outer', 'border:none'),
  },
]

/**
 * Page down / Page up one screen (sheets-37): bare keys, which the table's
 * chord check (modified keys and F-keys only) cannot hold.
 */
function pageRowCommand(event: GlobalShortcutKeyEvent): string | null {
  if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return null
  if (event.key === 'PageDown') return 'page-row:1'
  if (event.key === 'PageUp') return 'page-row:-1'
  return null
}

function gateOpen(gate: Gate, guards: GlobalShortcutGuards): boolean {
  switch (gate) {
    case 'grid':
      return guards.gridTarget
    case 'sheet':
      return !guards.cellEditing && guards.gridTarget
    case 'idle':
      return !guards.cellEditing
    case 'formulaBar':
      return guards.gridTarget || guards.formulaBarTarget
    case 'always':
      return true
  }
}

/**
 * Action for a keydown, or null. A key Univer's dispatcher already
 * consumed arrives with defaultPrevented (its own Alt+= QuickSum on
 * win/linux, for one) and must not fire a second time here. Composition
 * (Telex/VNI), AltGr on a Windows Ctrl+Alt chord and auto-repeat of a
 * one-shot command never match (sheets-keymap.ts).
 */
export function resolveGlobalShortcut(
  event: GlobalShortcutKeyEvent,
  guards: GlobalShortcutGuards,
): GlobalShortcutAction | null {
  if (guards.modalOpen || event.defaultPrevented) return null
  const target = { platform: guards.platform, surface: guards.surface }
  for (const binding of BINDINGS) {
    const action = sheetsShortcut(binding.id)
    // on desktop the menu's accelerator already runs the primary chord
    const menuChord =
      binding.menu && guards.surface === 'desktop' ? action[guards.platform][0] : null
    const chord = matchedChord(action, event, target, (candidate) => candidate === menuChord)
    if (!chord) continue
    if (!gateOpen(binding.gate, guards)) return null
    return typeof binding.action === 'function' ? binding.action(chord) : binding.action
  }
  const pageRow = pageRowCommand(event)
  if (pageRow && !isComposingEvent(event) && gateOpen('grid', guards)) return command(pageRow)
  return null
}
