/**
 * Excel-standard shortcuts Univer doesn't ship: worksheet-tab switching,
 * Ctrl+Home/End, Home, whole row/column selection, hide / unhide, insert /
 * delete. The chords come from the sheets shortcut table (UNI-2011) and are
 * registered as Univer keyCode bindings per platform and surface.
 */
import { describe, expect, it, vi } from 'vitest'
import { ICommandService, Styles, Worksheet } from '@univerjs/core'
import type { ICommand, IWorksheetData } from '@univerjs/core'
import { IShortcutService, MetaKeys } from '@univerjs/ui'
import type { IShortcutItem } from '@univerjs/ui'
import { SheetCopyDownCommand, SheetCopyRightCommand } from '@univerjs/sheets-ui'
import { _shortcutInternals, registerExcelShortcuts } from '../src/renderer/excel-shortcuts'
import type { SheetsKeyTarget } from '../src/renderer/sheets-keymap'
import type { UniverRuntime } from '../src/renderer/univer-state'

const {
  unfrozenOrigin,
  KEY_HOME,
  ACTIVATE_ADJACENT_SHEET_ID,
  SELECT_SHEET_HOME_ID,
  HIDE_SELECTED_ROWS_ID,
  UNHIDE_SELECTED_ROWS_ID,
  HIDE_SELECTED_COLS_ID,
  UNHIDE_SELECTED_COLS_ID,
  INSERT_CELLS_ID,
  DELETE_CELLS_ID,
  EXTEND_TO_SHEET_HOME_ID,
  EXTEND_TO_SHEET_END_ID,
  RUN_APP_COMMAND_ID,
  RELEASED_SHORTCUT_ID,
} = _shortcutInternals

const { SHIFT, ALT, CTRL_COMMAND, MAC_CTRL } = MetaKeys
// browser keyCodes
const PAGE_UP = 33
const PAGE_DOWN = 34
const END = 35
const HOME = 36
const RIGHT = 39
const KEY_0 = 48
const KEY_9 = 57
const KEY_D = 68
const KEY_L = 76
const KEY_R = 82
const EQUAL = 187
const MINUS = 189

function makeSheet(freeze?: IWorksheetData['freeze']): Worksheet {
  const snapshot: Partial<IWorksheetData> = {
    id: 's1',
    name: 'Test',
    rowCount: 100,
    columnCount: 26,
    cellData: {},
    mergeData: [],
    ...(freeze ? { freeze } : {}),
  }
  return new Worksheet('unit', snapshot as IWorksheetData, new Styles())
}

interface Registered {
  readonly items: IShortcutItem[]
  readonly commands: Map<string, ICommand>
  readonly dispatched: ReturnType<typeof vi.fn>
  readonly dispatch: (event: Partial<KeyboardEvent>) => unknown
  readonly appCommands: string[]
}

/** Runs the registration against stub services and records what it bound. */
function register(keys: SheetsKeyTarget): Registered {
  const items: IShortcutItem[] = []
  const commands = new Map<string, ICommand>()
  const dispatched = vi.fn()
  const appCommands: string[] = []
  const commandService = {
    registerCommand: (command: ICommand) => commands.set(command.id, command),
  }
  const shortcutService = {
    registerShortcut: (item: IShortcutItem) => items.push(item),
    dispatch: dispatched as (event: KeyboardEvent) => unknown,
  }
  const injector = {
    get: (token: unknown) => {
      if (token === ICommandService) return commandService
      if (token === IShortcutService) return shortcutService
      throw new Error('unexpected service')
    },
  }
  const runtime = { univer: { __getInjector: () => injector } } as unknown as UniverRuntime
  registerExcelShortcuts(
    runtime,
    undefined,
    undefined,
    (command) => appCommands.push(command),
    keys,
  )
  return {
    items,
    commands,
    dispatched,
    dispatch: (event) => shortcutService.dispatch(event as KeyboardEvent),
    appCommands,
  }
}

const WIN = register({ platform: 'win', surface: 'desktop' })
const MAC = register({ platform: 'mac', surface: 'desktop' })
const WEB = register({ platform: 'win', surface: 'web' })
const WEB_MAC = register({ platform: 'mac', surface: 'web' })

/** The bindings registered for a command, optionally narrowed by its static parameters. */
function bindings(reg: Registered, id: string, params?: object): number[] {
  return reg.items
    .filter((item) => item.id === id)
    .filter((item) => !params || JSON.stringify(item.staticParameters) === JSON.stringify(params))
    .map((item) => item.binding as number)
    .sort((a, b) => a - b)
}

const sorted = (...values: number[]) => [...values].sort((a, b) => a - b)

describe('unfrozenOrigin (Ctrl+Home target)', () => {
  it('is A1 without frozen panes', () => {
    expect(unfrozenOrigin(makeSheet())).toEqual({ row: 0, column: 0 })
  })

  it('is the first cell below/right of the freeze', () => {
    expect(
      unfrozenOrigin(makeSheet({ xSplit: 1, ySplit: 2, startRow: 2, startColumn: 1 })),
    ).toEqual({ row: 2, column: 1 })
  })

  it('ignores a freeze on one axis only for the other axis', () => {
    expect(
      unfrozenOrigin(makeSheet({ xSplit: 0, ySplit: 3, startRow: 3, startColumn: -1 })),
    ).toEqual({ row: 3, column: 0 })
  })
})

describe('unfrozenOrigin skips hidden lines', () => {
  it('lands on the first visible column when column A is hidden', () => {
    const snapshot: Partial<IWorksheetData> = {
      id: 's1',
      name: 'Test',
      rowCount: 100,
      columnCount: 26,
      cellData: {},
      mergeData: [],
      columnData: { 0: { hd: 1 } },
    }
    const sheet = new Worksheet('unit', snapshot as IWorksheetData, new Styles())
    expect(unfrozenOrigin(sheet)).toEqual({ row: 0, column: 1 })
  })

  it('lands below hidden top rows', () => {
    const snapshot: Partial<IWorksheetData> = {
      id: 's1',
      name: 'Test',
      rowCount: 100,
      columnCount: 26,
      cellData: {},
      mergeData: [],
      rowData: { 0: { hd: 1 }, 1: { hd: 1 } },
    }
    const sheet = new Worksheet('unit', snapshot as IWorksheetData, new Styles())
    expect(unfrozenOrigin(sheet)).toEqual({ row: 2, column: 0 })
  })
})

describe('hide / unhide rows and columns (sheets-22, sheets-23)', () => {
  it('hides with Ctrl+9 / Ctrl+0 and unhides with Ctrl+Shift+9 / 0 on Windows', () => {
    expect(bindings(WIN, HIDE_SELECTED_ROWS_ID)).toEqual([KEY_9 | CTRL_COMMAND])
    expect(bindings(WIN, UNHIDE_SELECTED_ROWS_ID)).toEqual([KEY_9 | SHIFT | CTRL_COMMAND])
    expect(bindings(WIN, HIDE_SELECTED_COLS_ID)).toEqual([KEY_0 | CTRL_COMMAND])
    expect(bindings(WIN, UNHIDE_SELECTED_COLS_ID)).toEqual([KEY_0 | SHIFT | CTRL_COMMAND])
  })

  it('unhides only with Control+Shift on a Mac; Cmd+( / Cmd+) hide (P0)', () => {
    expect(bindings(MAC, HIDE_SELECTED_ROWS_ID)).toEqual(
      sorted(KEY_9 | MAC_CTRL, KEY_9 | CTRL_COMMAND, KEY_9 | SHIFT | CTRL_COMMAND),
    )
    expect(bindings(MAC, UNHIDE_SELECTED_ROWS_ID)).toEqual([KEY_9 | SHIFT | MAC_CTRL])
    expect(bindings(MAC, HIDE_SELECTED_COLS_ID)).toEqual(
      sorted(KEY_0 | MAC_CTRL, KEY_0 | CTRL_COMMAND, KEY_0 | SHIFT | CTRL_COMMAND),
    )
    expect(bindings(MAC, UNHIDE_SELECTED_COLS_ID)).toEqual([KEY_0 | SHIFT | MAC_CTRL])
  })

  it('outranks Univer’s own header-only hide and zoom items', () => {
    for (const item of MAC.items.filter((i) => i.id === UNHIDE_SELECTED_ROWS_ID)) {
      expect(item.priority).toBe(100)
    }
  })
})

describe('sheet navigation', () => {
  const next = { step: 1 }
  const previous = { step: -1 }

  it('switches sheets with Ctrl+PageDown / PageUp on Windows', () => {
    expect(bindings(WIN, ACTIVATE_ADJACENT_SHEET_ID, next)).toEqual([PAGE_DOWN | CTRL_COMMAND])
    expect(bindings(WIN, ACTIVATE_ADJACENT_SHEET_ID, previous)).toEqual([PAGE_UP | CTRL_COMMAND])
  })

  it('adds Ctrl+Alt in the browser, which keeps Ctrl+PageDown for its tabs', () => {
    expect(bindings(WEB, ACTIVATE_ADJACENT_SHEET_ID, next)).toEqual([
      PAGE_DOWN | ALT | CTRL_COMMAND,
    ])
  })

  it('takes Control+PageDown, Option+Right and Cmd+PageDown on a Mac', () => {
    expect(bindings(MAC, ACTIVATE_ADJACENT_SHEET_ID, next)).toEqual(
      sorted(PAGE_DOWN | MAC_CTRL, RIGHT | ALT, PAGE_DOWN | CTRL_COMMAND),
    )
    expect(bindings(WEB_MAC, ACTIVATE_ADJACENT_SHEET_ID, next)).toEqual([RIGHT | ALT])
  })

  it('goes to the sheet start with Control+Home or Cmd+Home on a Mac', () => {
    expect(bindings(WIN, SELECT_SHEET_HOME_ID)).toEqual([HOME | CTRL_COMMAND])
    expect(bindings(MAC, SELECT_SHEET_HOME_ID)).toEqual(
      sorted(HOME | MAC_CTRL, HOME | CTRL_COMMAND),
    )
  })

  it('extends the selection with Ctrl+Shift+Home / End', () => {
    expect(bindings(WIN, EXTEND_TO_SHEET_HOME_ID)).toEqual([HOME | SHIFT | CTRL_COMMAND])
    expect(bindings(WIN, EXTEND_TO_SHEET_END_ID)).toEqual([END | SHIFT | CTRL_COMMAND])
    expect(bindings(MAC, EXTEND_TO_SHEET_END_ID)).toEqual(
      sorted(END | SHIFT | MAC_CTRL, END | SHIFT | CTRL_COMMAND),
    )
  })

  it('keeps the bare Home key', () => {
    expect(KEY_HOME).toBe(HOME)
  })
})

describe('fill, insert and delete', () => {
  it('leaves Ctrl+D / Ctrl+R to Univer and adds Excel for Mac’s Control+D / R', () => {
    expect(bindings(WIN, SheetCopyDownCommand.id)).toEqual([])
    expect(bindings(WIN, SheetCopyRightCommand.id)).toEqual([])
    expect(bindings(MAC, SheetCopyDownCommand.id)).toEqual([KEY_D | MAC_CTRL])
    expect(bindings(MAC, SheetCopyRightCommand.id)).toEqual([KEY_R | MAC_CTRL])
  })

  it('inserts with Ctrl+Shift+= and deletes with Ctrl+-', () => {
    expect(bindings(WIN, INSERT_CELLS_ID)).toContain(EQUAL | SHIFT | CTRL_COMMAND)
    expect(bindings(WIN, DELETE_CELLS_ID)).toContain(MINUS | CTRL_COMMAND)
    expect(bindings(MAC, INSERT_CELLS_ID)).toEqual(
      expect.arrayContaining([EQUAL | SHIFT | MAC_CTRL, EQUAL | SHIFT | CTRL_COMMAND]),
    )
    expect(bindings(MAC, DELETE_CELLS_ID)).toEqual(
      expect.arrayContaining([MINUS | CTRL_COMMAND, MINUS | MAC_CTRL]),
    )
  })
})

describe('Univer defaults the table overrides', () => {
  it('runs Calculate Now on Cmd+= on a Mac (Univer zooms there)', () => {
    expect(bindings(MAC, RUN_APP_COMMAND_ID, { command: 'calculate-now' })).toEqual([
      EQUAL | CTRL_COMMAND,
    ])
    expect(bindings(WIN, RUN_APP_COMMAND_ID)).toEqual([])
    const handler = MAC.commands.get(RUN_APP_COMMAND_ID)!.handler
    handler({} as never, { command: 'calculate-now' })
    expect(MAC.appCommands).toEqual(['calculate-now'])
  })

  it('silences Univer’s Shift+Cmd+L filter on a Mac only', () => {
    expect(bindings(MAC, RELEASED_SHORTCUT_ID)).toEqual([KEY_L | SHIFT | CTRL_COMMAND])
    expect(bindings(WIN, RELEASED_SHORTCUT_ID)).toEqual([])
  })

  it('never registers a binding twice for one command', () => {
    for (const reg of [WIN, MAC, WEB, WEB_MAC]) {
      const keys = reg.items.map(
        (item) => `${item.id}|${String(item.binding)}|${JSON.stringify(item.staticParameters)}`,
      )
      expect(new Set(keys).size).toBe(keys.length)
    }
  })
})

describe('IME / AltGr guard in front of Univer', () => {
  const plain = {
    keyCode: KEY_9,
    key: '9',
    code: 'Digit9',
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    getModifierState: () => false,
  }

  it('passes ordinary keys through', () => {
    WIN.dispatched.mockClear()
    WIN.dispatch(plain)
    expect(WIN.dispatched).toHaveBeenCalledTimes(1)
  })

  it('swallows keys while an IME composes', () => {
    WIN.dispatched.mockClear()
    WIN.dispatch({ ...plain, isComposing: true })
    WIN.dispatch({ ...plain, keyCode: 229 })
    expect(WIN.dispatched).not.toHaveBeenCalled()
  })

  it('swallows AltGr on Windows but not Control+Option on a Mac', () => {
    const altGr = {
      ...plain,
      altKey: true,
      getModifierState: (key: string) => key === 'AltGraph',
    }
    WIN.dispatched.mockClear()
    WIN.dispatch(altGr)
    expect(WIN.dispatched).not.toHaveBeenCalled()
    MAC.dispatched.mockClear()
    MAC.dispatch(altGr)
    expect(MAC.dispatched).toHaveBeenCalledTimes(1)
  })
})
