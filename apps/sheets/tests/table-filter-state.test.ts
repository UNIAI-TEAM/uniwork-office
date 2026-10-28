import { LocaleType, LogLevel, Univer, UniverInstanceType } from '@univerjs/core'
import { FUniver } from '@univerjs/core/facade'
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula'
import { UniverSheetsPlugin } from '@univerjs/sheets'
import '@univerjs/sheets/facade'
import {
  TABLE_FILTER_EMPTY_VALUE,
  TableColumnFilterTypeEnum,
  type ITableFilterItem,
} from '@univerjs/preset-sheets-table'
import { UniverSheetsTablePlugin } from '@univerjs/sheets-table'
import '@univerjs/sheets-table/facade'
import tableLocale from '@univerjs/sheets-table/locale/en-US'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TABLE_FILTER_COMMAND, TABLE_FILTER_MUTATION } from '../src/renderer/app-constants'
import { createEditJournal, journalSize } from '../src/renderer/edit-journal'
import { tableColumnCriteria, tableFilterState } from '../src/renderer/table-filter-state'
import type { LazyWorkbookState, UniverRuntime } from '../src/renderer/univer-state'
import {
  clearSheetTableFilters,
  collectFilterStates,
  noteTableFilterEdit,
} from '../src/renderer/univer-sync'

const manual = (...values: string[]): ITableFilterItem => ({
  filterType: TableColumnFilterTypeEnum.manual,
  values,
})
const condition = (filterInfo: Record<string, unknown>): ITableFilterItem =>
  ({ filterType: 'condition', filterInfo }) as unknown as ITableFilterItem

describe('tableColumnCriteria', () => {
  it('maps a manual filter to values, splitting out the blank marker', () => {
    expect(tableColumnCriteria(manual('East', TABLE_FILTER_EMPTY_VALUE, 'West'), 2)).toEqual({
      colId: 2,
      values: ['East', 'West'],
      blank: true,
    })
    expect(tableColumnCriteria(manual('East'), 0)).toEqual({ colId: 0, values: ['East'] })
  })

  it('maps a select-all manual filter to nothing', () => {
    expect(
      tableColumnCriteria(
        { filterType: TableColumnFilterTypeEnum.manual, values: ['a'], isAllSelected: true },
        0,
      ),
    ).toBeNull()
  })

  it('maps simple number conditions to a custom filter', () => {
    expect(
      tableColumnCriteria(
        condition({ conditionType: 'number', compareType: 'greaterThan', expectedValue: 5 }),
        1,
      ),
    ).toEqual({ colId: 1, customs: { filters: [{ val: 5, operator: 'greaterThan' }] } })
  })

  it('maps between / notBetween to an AND / OR pair', () => {
    const between = condition({
      conditionType: 'number',
      compareType: 'between',
      expectedValue: [1, 9],
    })
    expect(tableColumnCriteria(between, 0)?.customs).toEqual({
      and: true,
      filters: [
        { val: 1, operator: 'greaterThanOrEqual' },
        { val: 9, operator: 'lessThanOrEqual' },
      ],
    })
    const outside = condition({
      conditionType: 'number',
      compareType: 'notBetween',
      expectedValue: [1, 9],
    })
    expect(tableColumnCriteria(outside, 0)?.customs).toEqual({
      filters: [
        { val: 1, operator: 'lessThan' },
        { val: 9, operator: 'greaterThan' },
      ],
    })
  })

  it('maps text conditions to Excel wildcard patterns, escaping literal wildcards', () => {
    const text = (compareType: string, expectedValue: string) =>
      tableColumnCriteria(condition({ conditionType: 'string', compareType, expectedValue }), 0)
        ?.customs?.filters
    expect(text('equal', 'abc')).toEqual([{ val: 'abc' }])
    expect(text('notEqual', 'abc')).toEqual([{ val: 'abc', operator: 'notEqual' }])
    expect(text('contains', 'a*b')).toEqual([{ val: '*a~*b*' }])
    expect(text('notContains', 'x')).toEqual([{ val: '*x*', operator: 'notEqual' }])
    expect(text('startsWith', 'x')).toEqual([{ val: 'x*' }])
    expect(text('endsWith', 'x')).toEqual([{ val: '*x' }])
  })

  it('fails closed on conditions the file format cannot hold', () => {
    expect(() =>
      tableColumnCriteria(
        condition({ conditionType: 'number', compareType: 'topN', expectedValue: 3 }),
        0,
      ),
    ).toThrow(/topN/)
    expect(() =>
      tableColumnCriteria(condition({ conditionType: 'date', compareType: 'today' }), 0),
    ).toThrow(/today/)
  })
})

describe('tableFilterState', () => {
  it('snapshots header-to-data range, criteria and hidden rows', () => {
    const state = tableFilterState('s1', {
      id: 't1',
      range: { startRow: 0, startColumn: 1, endRow: 5, endColumn: 3 },
      columnFilters: [undefined, manual('East')],
      filteredOutRows: new Set([4, 2]),
    })
    expect(state).toEqual({
      sheetId: 's1',
      filter: {
        range: { startRow: 0, startColumn: 1, endRow: 5, endColumn: 3 },
        columns: [{ colId: 1, values: ['East'] }],
      },
      hiddenRows: [2, 4],
      // Header row included, like a worksheet autoFilter (SH-W4-V8).
      visibilityRange: { startRow: 0, startColumn: 1, endRow: 5, endColumn: 3 },
    })
  })
})

describe('a table filter edit reaches the save (SH-W4-V1) and Clear releases the rows (SH-W4-V2)', () => {
  let univer: Univer
  let api: FUniver
  let runtime: UniverRuntime
  let state: LazyWorkbookState
  let tableId = ''

  beforeAll(async () => {
    univer = new Univer({
      locale: LocaleType.EN_US,
      locales: { [LocaleType.EN_US]: tableLocale },
      logLevel: LogLevel.ERROR,
    })
    univer.registerPlugin(UniverFormulaEnginePlugin)
    univer.registerPlugin(UniverSheetsPlugin)
    univer.registerPlugin(UniverSheetsTablePlugin)
    const regions = ['North', 'East', 'North', 'East', 'West']
    univer.createUnit(UniverInstanceType.UNIVER_SHEET, {
      id: 'wb',
      sheetOrder: ['s1'],
      sheets: {
        s1: {
          id: 's1',
          name: 'Data',
          rowCount: 20,
          columnCount: 6,
          cellData: Object.fromEntries([
            [0, { 0: { v: 'Region' }, 1: { v: 'Amount' } }],
            ...regions.map((region, index) => [
              index + 1,
              { 0: { v: region }, 1: { v: (index + 1) * 10 } },
            ]),
          ]),
        },
      },
    })
    api = FUniver.newAPI(univer)
    runtime = { univer, univerAPI: api }
    tableId = 'file-table-s1-0'
    const worksheet = api.getActiveWorkbook()!.getSheetBySheetId('s1')!
    await worksheet.addTable(
      'Table1',
      { startRow: 0, startColumn: 0, endRow: 5, endColumn: 1 },
      tableId,
      {
        columns: [
          { id: 'c0', displayName: 'Region' },
          { id: 'c1', displayName: 'Amount' },
        ],
      } as never,
    )
    // The App's journal listener, reduced to the table filter wiring.
    api.addEvent(api.Event.CommandExecuted, (event) => {
      if (event.id !== TABLE_FILTER_MUTATION) return
      const params = event.params as { unitId: string; tableId: string }
      noteTableFilterEdit(runtime, state, params.unitId, params.tableId)
    })
    // Rows 2 and 4 (North) were hidden by the file's old filter at open.
    state = {
      editJournal: createEditJournal(),
      hiddenFileRows: new Map([['s1', new Set([1, 3])]]),
      filterOrigins: new Map([
        [
          's1',
          { origin: 'table', range: { startRow: 0, startColumn: 0, endRow: 5, endColumn: 1 } },
        ],
      ]),
    } as unknown as LazyWorkbookState
  }, 30_000)

  afterAll(() => {
    univer.dispose()
  })

  it('journals the table, snapshots its criteria and hidden rows, and releases the file rows', () => {
    const before = journalSize(state.editJournal)
    api.syncExecuteCommand(TABLE_FILTER_COMMAND, {
      unitId: 'wb',
      tableId,
      column: 0,
      tableFilter: manual('East'),
    })
    expect(state.editJournal.filterDirty.has('s1')).toBe(true)
    expect(journalSize(state.editJournal)).toBeGreaterThan(before)
    // The unknown file criteria no longer own those rows.
    expect(state.hiddenFileRows.get('s1')?.size).toBe(0)

    const states = collectFilterStates(runtime, state)
    expect(states).toHaveLength(1)
    expect(states[0]).toEqual({
      sheetId: 's1',
      filter: {
        range: { startRow: 0, startColumn: 0, endRow: 5, endColumn: 1 },
        columns: [{ colId: 0, values: ['East'] }],
      },
      // Everything that is not East: rows 1, 3 (North) and 5 (West).
      hiddenRows: [1, 3, 5],
      visibilityRange: { startRow: 0, startColumn: 0, endRow: 5, endColumn: 1 },
    })
  })

  it('Clear removes the criteria and snapshots an unfiltered table', () => {
    clearSheetTableFilters(runtime, state, 's1')
    const states = collectFilterStates(runtime, state)
    expect(states).toHaveLength(1)
    expect(states[0]?.filter?.columns).toEqual([])
    expect(states[0]?.hiddenRows).toEqual([])
  })

  it('an unrelated dirty sheet without table edits keeps the sheet-filter path', () => {
    state.editJournal.tableFilterDirty.clear()
    state.editJournal.filterDirty.clear()
    expect(collectFilterStates(runtime, state)).toEqual([])
  })
})
