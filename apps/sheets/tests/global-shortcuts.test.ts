/**
 * Window-level Excel chords from the sheets shortcut table (UNI-2011): routing
 * per row on each platform and surface, the Excel-for-Mac inversions, the keys
 * the table dropped, and the guards (text field, in-cell edit, open modal,
 * already-handled key, IME composition, AltGr, auto-repeat). Nothing may reach
 * the sheet while a modal is open: the grid keeps focus behind the overlay, so
 * the grid-target guard alone cannot see the dialog.
 */
import { describe, expect, it } from 'vitest'
import { NUMBER_FORMAT_SHORTCUTS } from '../src/renderer/excel-format-shortcuts'
import {
  isModalOpen,
  resolveGlobalShortcut,
  type GlobalShortcutAction,
  type GlobalShortcutGuards,
  type GlobalShortcutKeyEvent,
} from '../src/renderer/global-shortcuts'

type Mods = Partial<Omit<GlobalShortcutKeyEvent, 'code'>>

/** `event.key` as a US layout types it, from the physical key. */
function keyOf(code: string, shift: boolean): string {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return shift ? letter[1]! : letter[1]!.toLowerCase()
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit) return digit[1]!
  return code
}

function keyEvent(code: string, mods: Mods = {}): GlobalShortcutKeyEvent {
  return {
    code,
    key: keyOf(code, mods.shiftKey ?? false),
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    // a real keydown reports AltGraph; without it the matcher assumes AltGr
    getModifierState: () => false,
    ...mods,
  }
}

const ctrl = { ctrlKey: true }
const meta = { metaKey: true }
const alt = { altKey: true }
const shift = { shiftKey: true }
const ctrlShift = { ctrlKey: true, shiftKey: true }
const metaShift = { metaKey: true, shiftKey: true }
const altShift = { altKey: true, shiftKey: true }
const metaAlt = { metaKey: true, altKey: true }
const ctrlAlt = { ctrlKey: true, altKey: true }

const GRID: GlobalShortcutGuards = {
  platform: 'win',
  surface: 'desktop',
  modalOpen: false,
  cellEditing: false,
  gridTarget: true,
  formulaBarTarget: false,
}
const MAC: GlobalShortcutGuards = { ...GRID, platform: 'mac' }
const WEB: GlobalShortcutGuards = { ...GRID, surface: 'web' }
const WEB_MAC: GlobalShortcutGuards = { ...MAC, surface: 'web' }
const TEXT_FIELD: GlobalShortcutGuards = { ...GRID, gridTarget: false }
const FORMULA_BAR: GlobalShortcutGuards = { ...TEXT_FIELD, formulaBarTarget: true }
const EDITING: GlobalShortcutGuards = { ...GRID, cellEditing: true }
const BEHIND_MODAL: GlobalShortcutGuards = { ...GRID, modalOpen: true }
const FORMAT_CELLS: GlobalShortcutAction = { kind: 'dialog', dialog: 'formatCells' }
const FONT_TAB: GlobalShortcutAction = { kind: 'dialog', dialog: 'formatCells', tab: 'Font' }
const GO_TO: GlobalShortcutAction = { kind: 'dialog', dialog: 'goTo' }
const SAVE_AS: GlobalShortcutAction = { kind: 'menu', action: 'save-as' }
const REDO: GlobalShortcutAction = { kind: 'menu', action: 'redo' }
const cmd = (command: string): GlobalShortcutAction => ({ kind: 'command', command })

type Case = [string, GlobalShortcutKeyEvent, GlobalShortcutAction]

function expectRoutes(guards: GlobalShortcutGuards, cases: readonly Case[]): void {
  for (const [name, event, action] of cases) {
    expect(resolveGlobalShortcut(event, guards), name).toEqual(action)
  }
}

function expectUnbound(
  guards: GlobalShortcutGuards,
  cases: ReadonlyArray<[string, GlobalShortcutKeyEvent]>,
): void {
  for (const [name, event] of cases) {
    expect(resolveGlobalShortcut(event, guards), name).toBeNull()
  }
}

describe('isModalOpen', () => {
  const stub = (hit: unknown) => ({ querySelector: () => hit }) as unknown as Document

  it('is true while a dialog backdrop is mounted', () => {
    expect(isModalOpen(stub({ className: 'dialog-backdrop' }))).toBe(true)
  })

  it('is false with no dialog and false for a null root', () => {
    expect(isModalOpen(stub(null))).toBe(false)
    expect(isModalOpen(null)).toBe(false)
  })
})

describe('Windows / Linux desktop', () => {
  it('routes the Excel chords of each row', () => {
    expectRoutes(GRID, [
      ['Ctrl+1', keyEvent('Digit1', ctrl), FORMAT_CELLS],
      ['Ctrl+Shift+F', keyEvent('KeyF', ctrlShift), FONT_TAB],
      ['Ctrl+G', keyEvent('KeyG', ctrl), GO_TO],
      ['F5', keyEvent('F5'), GO_TO],
      ['Ctrl+`', keyEvent('Backquote', ctrl), cmd('toggle-show-formulas')],
      ['Ctrl+K', keyEvent('KeyK', ctrl), cmd('link-open')],
      ['Shift+F2', keyEvent('F2', shift), cmd('note-open')],
      ['Ctrl+Shift+F2', keyEvent('F2', ctrlShift), cmd('comment-new')],
      ['Ctrl+Shift+M', keyEvent('KeyM', ctrlShift), cmd('comment-new')],
      ['Ctrl+E', keyEvent('KeyE', ctrl), cmd('flash-fill')],
      ['Shift+F3', keyEvent('F3', shift), cmd('insert-function-open')],
      ['Ctrl+F3', keyEvent('F3', ctrl), cmd('name-manager-open')],
      ['Shift+F11', keyEvent('F11', shift), cmd('insert-sheet')],
      ['Ctrl+Shift+V', keyEvent('KeyV', ctrlShift), cmd('paste-special:value')],
      ['Ctrl+Alt+V', keyEvent('KeyV', ctrlAlt), cmd('paste-special-open')],
      ['Ctrl+[', keyEvent('BracketLeft', ctrl), cmd('trace-precedents')],
      ['Ctrl+]', keyEvent('BracketRight', ctrl), cmd('trace-dependents')],
      ['Alt+Shift+Right', keyEvent('ArrowRight', altShift), cmd('outline-group:auto')],
      ['Alt+Shift+Left', keyEvent('ArrowLeft', altShift), cmd('outline-ungroup:auto')],
      ['Ctrl+Shift+>', keyEvent('Period', ctrlShift), cmd('font-size-step:1')],
      ['Ctrl+Shift+<', keyEvent('Comma', ctrlShift), cmd('font-size-step:-1')],
      ['Ctrl+Shift+U', keyEvent('KeyU', ctrlShift), cmd('formula-bar-toggle')],
      ['Ctrl+5', keyEvent('Digit5', ctrl), cmd('strike')],
      ['Alt+=', keyEvent('Equal', alt), cmd('autofn:SUM')],
      ['Ctrl+Shift+T', keyEvent('KeyT', ctrlShift), cmd('autofn:SUM')],
      ['Ctrl+;', keyEvent('Semicolon', ctrl), cmd('insert-now:date')],
      ['Ctrl+Shift+;', keyEvent('Semicolon', ctrlShift), cmd('insert-now:time')],
      ['F9', keyEvent('F9'), cmd('calculate-now')],
      ['Shift+F9', keyEvent('F9', shift), cmd('calculate-sheet')],
      ['PageDown', keyEvent('PageDown'), cmd('page-row:1')],
      ['PageUp', keyEvent('PageUp'), cmd('page-row:-1')],
      ['Alt+PageDown', keyEvent('PageDown', alt), cmd('page-col:1')],
      ['Alt+PageUp', keyEvent('PageUp', alt), cmd('page-col:-1')],
      ['Ctrl+Shift+L', keyEvent('KeyL', ctrlShift), cmd('filter-toggle')],
      ['Ctrl+T', keyEvent('KeyT', ctrl), cmd('table-create-open')],
      ['Ctrl+L', keyEvent('KeyL', ctrl), cmd('table-create-open')],
    ])
  })

  it('leaves the menu its primary chord and runs the secondary one', () => {
    // F12 and Ctrl+Y are the File / Edit menu accelerators (sheets-main.ts)
    expectUnbound(GRID, [
      ['F12', keyEvent('F12')],
      ['Ctrl+Y', keyEvent('KeyY', ctrl)],
    ])
    expectRoutes(GRID, [
      ['Ctrl+Shift+S', keyEvent('KeyS', ctrlShift), SAVE_AS],
      ['Ctrl+Shift+Z', keyEvent('KeyZ', ctrlShift), REDO],
    ])
  })

  it('requires the exact modifier set and keeps Mac chords off Windows', () => {
    expectUnbound(GRID, [
      ['Ctrl+Shift+G', keyEvent('KeyG', ctrlShift)],
      ['Ctrl+V', keyEvent('KeyV', ctrl)],
      ['F11', keyEvent('F11')],
      ['Alt+Right', keyEvent('ArrowRight', alt)],
      ['Cmd+Ctrl+V', keyEvent('KeyV', { metaKey: true, ctrlKey: true })],
      ['Cmd+1', keyEvent('Digit1', meta)],
      ['Alt+Cmd+0', keyEvent('Digit0', metaAlt)],
      ['Shift+Cmd+F', keyEvent('KeyF', metaShift)],
    ])
  })

  it('leaves unrelated keys to the rest of the app', () => {
    expectUnbound(GRID, [
      ['A', keyEvent('KeyA')],
      ['G', keyEvent('KeyG')],
      ['Enter', keyEvent('Enter')],
    ])
  })
})

describe('Excel for Mac desktop', () => {
  it('routes the Excel for Mac column', () => {
    expectRoutes(MAC, [
      ['Cmd+1', keyEvent('Digit1', meta), FORMAT_CELLS],
      // Excel for Mac prints "Cmd+1 or Ctrl+1" and "Cmd+K or Ctrl+K" (RS-sheets M2)
      ['Control+1', keyEvent('Digit1', ctrl), FORMAT_CELLS],
      ['Control+K', keyEvent('KeyK', ctrl), cmd('link-open')],
      ['Cmd+G', keyEvent('KeyG', meta), GO_TO],
      ['Control+G', keyEvent('KeyG', ctrl), GO_TO],
      ['Control+`', keyEvent('Backquote', ctrl), cmd('toggle-show-formulas')],
      ['Cmd+K', keyEvent('KeyK', meta), cmd('link-open')],
      ['Shift+Cmd+F2', keyEvent('F2', metaShift), cmd('comment-new')],
      ['Cmd+E', keyEvent('KeyE', meta), cmd('flash-fill')],
      ['Control+E', keyEvent('KeyE', ctrl), cmd('flash-fill')],
      ['Cmd+F3', keyEvent('F3', meta), cmd('name-manager-open')],
      ['Ctrl+Cmd+V', keyEvent('KeyV', { metaKey: true, ctrlKey: true }), cmd('paste-special-open')],
      ['Alt+Cmd+V', keyEvent('KeyV', metaAlt), cmd('paste-special-open')],
      ['Shift+Cmd+V', keyEvent('KeyV', metaShift), cmd('paste-special:value')],
      ['Control+Shift+[', keyEvent('BracketLeft', ctrlShift), cmd('trace-precedents')],
      ['Control+]', keyEvent('BracketRight', ctrl), cmd('trace-dependents')],
      ['Shift+Cmd+K', keyEvent('KeyK', metaShift), cmd('outline-group:auto')],
      ['Shift+Cmd+J', keyEvent('KeyJ', metaShift), cmd('outline-ungroup:auto')],
      ['Shift+Cmd+>', keyEvent('Period', metaShift), cmd('font-size-step:1')],
      ['Shift+Cmd+<', keyEvent('Comma', metaShift), cmd('font-size-step:-1')],
      ['Shift+Cmd+U', keyEvent('KeyU', metaShift), cmd('formula-bar-toggle')],
      ['Shift+Cmd+X', keyEvent('KeyX', metaShift), cmd('strike')],
      ['Cmd+5', keyEvent('Digit5', meta), cmd('strike')],
      ['Shift+Cmd+T', keyEvent('KeyT', metaShift), cmd('autofn:SUM')],
      ['Alt+Cmd+=', keyEvent('Equal', metaAlt), cmd('autofn:SUM')],
      ['Shift+Cmd+F', keyEvent('KeyF', metaShift), cmd('filter-toggle')],
      ['Control+Shift+L', keyEvent('KeyL', ctrlShift), cmd('filter-toggle')],
      ['Cmd+T', keyEvent('KeyT', meta), cmd('table-create-open')],
      ['F12', keyEvent('F12'), SAVE_AS],
      ['Shift+Cmd+Z', keyEvent('KeyZ', metaShift), REDO],
    ])
  })

  it('inserts the date with Control+; and the time with Cmd+; (P0)', () => {
    expectRoutes(MAC, [
      ['Control+;', keyEvent('Semicolon', ctrl), cmd('insert-now:date')],
      ['Cmd+;', keyEvent('Semicolon', meta), cmd('insert-now:time')],
      ['Shift+Cmd+;', keyEvent('Semicolon', metaShift), cmd('insert-now:time')],
    ])
  })

  it('drops the old chords that collided with Excel for Mac', () => {
    expectUnbound(MAC, [
      // Shift+Cmd+M: comment was a guess, Excel for Mac has none
      ['Shift+Cmd+M', keyEvent('KeyM', metaShift)],
      // Cmd+`: the macOS window cycler
      ['Cmd+`', keyEvent('Backquote', meta)],
      ['Cmd+[', keyEvent('BracketLeft', meta)],
      ['Cmd+]', keyEvent('BracketRight', meta)],
      // number formats are Control+Shift+digit on a Mac too
      ['Shift+Cmd+5', keyEvent('Digit5', metaShift)],
      ['Shift+Cmd+7', keyEvent('Digit7', metaShift)],
      // Shift+Cmd+L belongs to nothing (sheets-81 is Shift+Cmd+F)
      ['Shift+Cmd+L', keyEvent('KeyL', metaShift)],
      // Ctrl+Shift+F has no Excel for Mac chord
      ['Control+Shift+F', keyEvent('KeyF', ctrlShift)],
    ])
  })

  it('leaves the menu its primary chord', () => {
    expectUnbound(MAC, [
      ['Shift+Cmd+S', keyEvent('KeyS', metaShift)],
      ['Cmd+Y', keyEvent('KeyY', meta)],
    ])
  })
})

describe('Excel for the web', () => {
  it('saves a copy with Alt+F2; the browser keeps F12 and Ctrl+Shift+S', () => {
    expect(resolveGlobalShortcut(keyEvent('F2', alt), WEB)).toEqual(SAVE_AS)
    expectUnbound(WEB, [
      ['F12', keyEvent('F12')],
      ['Ctrl+Shift+S', keyEvent('KeyS', ctrlShift)],
    ])
    expectUnbound(WEB_MAC, [
      ['F12', keyEvent('F12')],
      ['Shift+Cmd+S', keyEvent('KeyS', metaShift)],
    ])
  })

  it('has no application menu, so the primary redo chord is the renderer’s', () => {
    expect(resolveGlobalShortcut(keyEvent('KeyY', ctrl), WEB)).toEqual(REDO)
    expect(resolveGlobalShortcut(keyEvent('KeyY', meta), WEB_MAC)).toEqual(REDO)
  })

  it('creates a table with Ctrl+L (Ctrl+T / Cmd+T open a browser tab)', () => {
    expect(resolveGlobalShortcut(keyEvent('KeyL', ctrl), WEB)).toEqual(cmd('table-create-open'))
    expect(resolveGlobalShortcut(keyEvent('KeyL', ctrl), WEB_MAC)).toEqual(cmd('table-create-open'))
    expect(resolveGlobalShortcut(keyEvent('KeyT', ctrl), WEB)).toBeNull()
    expect(resolveGlobalShortcut(keyEvent('KeyT', meta), WEB_MAC)).toBeNull()
  })

  it('keeps Excel for the web’s own column', () => {
    expect(resolveGlobalShortcut(keyEvent('Digit5', ctrl), WEB)).toEqual(cmd('strike'))
    expect(resolveGlobalShortcut(keyEvent('Digit5', meta), WEB_MAC)).toBeNull()
    expect(resolveGlobalShortcut(keyEvent('KeyX', metaShift), WEB_MAC)).toEqual(cmd('strike'))
    expect(resolveGlobalShortcut(keyEvent('Equal', alt), WEB)).toEqual(cmd('autofn:SUM'))
    expect(resolveGlobalShortcut(keyEvent('KeyT', ctrlShift), WEB)).toBeNull()
  })
})

describe('number-format and border shortcuts', () => {
  const formats: Array<[string, string]> = [
    ['sheets-68', 'Backquote'],
    ['sheets-69', 'Digit1'],
    ['sheets-70', 'Digit2'],
    ['sheets-71', 'Digit3'],
    ['sheets-72', 'Digit4'],
    ['sheets-73', 'Digit5'],
    ['sheets-74', 'Digit6'],
  ]

  it('Ctrl+Shift+` and 1..6 apply the Excel number formats on every platform', () => {
    for (const [row, code] of formats) {
      const action = cmd(`format:${NUMBER_FORMAT_SHORTCUTS[row]}`)
      for (const guards of [GRID, MAC, WEB, WEB_MAC]) {
        expect(resolveGlobalShortcut(keyEvent(code, ctrlShift), guards), row).toEqual(action)
      }
    }
  })

  it('outline and no border', () => {
    expectRoutes(GRID, [
      ['Ctrl+Shift+7', keyEvent('Digit7', ctrlShift), cmd('border:outer')],
      ['Ctrl+Shift+-', keyEvent('Minus', ctrlShift), cmd('border:none')],
    ])
    expectRoutes(MAC, [
      ['Alt+Cmd+0', keyEvent('Digit0', metaAlt), cmd('border:outer')],
      ['Alt+Cmd+-', keyEvent('Minus', metaAlt), cmd('border:none')],
    ])
  })

  it('stay out of text fields, cell editing and modals', () => {
    const percent = keyEvent('Digit5', ctrlShift)
    expect(resolveGlobalShortcut(percent, TEXT_FIELD)).toBeNull()
    expect(resolveGlobalShortcut(percent, EDITING)).toBeNull()
    expect(resolveGlobalShortcut(percent, BEHIND_MODAL)).toBeNull()
  })
})

describe('guards', () => {
  const combos: Array<[string, GlobalShortcutKeyEvent]> = [
    ['Ctrl+1 (Format Cells)', keyEvent('Digit1', ctrl)],
    ['Ctrl+G (Go To)', keyEvent('KeyG', ctrl)],
    ['F5 (Go To)', keyEvent('F5')],
    ['Ctrl+K (Link)', keyEvent('KeyK', ctrl)],
    ['Ctrl+` (Show Formulas)', keyEvent('Backquote', ctrl)],
    ['F9 (recalculate)', keyEvent('F9')],
    ['Shift+F9 (calculate sheet)', keyEvent('F9', shift)],
    ['Ctrl+5 (strikethrough)', keyEvent('Digit5', ctrl)],
    ['Alt+= (AutoSum)', keyEvent('Equal', alt)],
    ['Ctrl+; (insert date)', keyEvent('Semicolon', ctrl)],
    ['Shift+F11 (insert sheet)', keyEvent('F11', shift)],
    ['PageDown', keyEvent('PageDown')],
  ]

  for (const [name, event] of combos) {
    it(`ignores ${name} while a modal is open`, () => {
      expect(resolveGlobalShortcut(event, BEHIND_MODAL)).toBeNull()
    })
  }

  it('never fires from a text field, dialog openers included', () => {
    for (const [name, event] of combos) {
      if (name.startsWith('F9') || name.startsWith('Shift+F9')) continue
      expect(resolveGlobalShortcut(event, TEXT_FIELD), name).toBeNull()
    }
  })

  it('runs Save As from anywhere outside a modal', () => {
    expect(resolveGlobalShortcut(keyEvent('KeyS', ctrlShift), TEXT_FIELD)).toEqual(SAVE_AS)
    expect(resolveGlobalShortcut(keyEvent('KeyS', ctrlShift), BEHIND_MODAL)).toBeNull()
  })

  it('toggles the formula bar from the formula bar itself, never from app fields', () => {
    expect(resolveGlobalShortcut(keyEvent('KeyU', ctrlShift), FORMULA_BAR)).toEqual(
      cmd('formula-bar-toggle'),
    )
    expect(resolveGlobalShortcut(keyEvent('KeyU', ctrlShift), GRID)).toEqual(
      cmd('formula-bar-toggle'),
    )
    expect(resolveGlobalShortcut(keyEvent('KeyU', ctrlShift), TEXT_FIELD)).toBeNull()
    expect(resolveGlobalShortcut(keyEvent('Digit1', ctrl), FORMULA_BAR)).toBeNull()
  })

  it('keeps range-writing commands off while a cell is being edited', () => {
    expect(resolveGlobalShortcut(keyEvent('Digit5', ctrl), EDITING)).toBeNull()
    expect(resolveGlobalShortcut(keyEvent('KeyE', ctrl), EDITING)).toBeNull()
    expect(resolveGlobalShortcut(keyEvent('F9'), EDITING)).toBeNull()
    expect(resolveGlobalShortcut(keyEvent('Digit1', ctrl), EDITING)).toEqual(FORMAT_CELLS)
    expect(resolveGlobalShortcut(keyEvent('KeyG', ctrl), EDITING)).toEqual(GO_TO)
  })

  it('bails once something already handled the key', () => {
    expect(
      resolveGlobalShortcut(keyEvent('Equal', { ...alt, defaultPrevented: true }), GRID),
    ).toBeNull()
    expect(resolveGlobalShortcut(keyEvent('PageDown', { defaultPrevented: true }), GRID)).toBeNull()
  })

  it('never fires while an IME composes (Telex / VNI)', () => {
    for (const mods of [{ isComposing: true }, { keyCode: 229 }]) {
      expect(resolveGlobalShortcut(keyEvent('Semicolon', { ...ctrl, ...mods }), GRID)).toBeNull()
      expect(resolveGlobalShortcut(keyEvent('Semicolon', { ...meta, ...mods }), MAC)).toBeNull()
      expect(resolveGlobalShortcut(keyEvent('PageDown', mods), GRID)).toBeNull()
    }
  })

  it('treats Ctrl+Alt as AltGr on Windows only', () => {
    const altGr = { ...ctrlAlt, getModifierState: (key: string) => key === 'AltGraph' }
    expect(resolveGlobalShortcut(keyEvent('KeyV', altGr), GRID)).toBeNull()
    expect(resolveGlobalShortcut(keyEvent('KeyV', ctrlAlt), MAC)).toEqual(cmd('paste-special-open'))
  })

  it('does not repeat a one-shot command while the key is held', () => {
    expect(resolveGlobalShortcut(keyEvent('Digit1', { ...ctrl, repeat: true }), GRID)).toBeNull()
    expect(resolveGlobalShortcut(keyEvent('KeyV', { ...ctrlShift, repeat: true }), GRID)).toBeNull()
    // stepping the font size keeps going while held
    expect(resolveGlobalShortcut(keyEvent('Period', { ...ctrlShift, repeat: true }), GRID)).toEqual(
      cmd('font-size-step:1'),
    )
  })
})
