import { describe, expect, it, vi } from 'vitest'

import { classifyCellType } from '../src/renderer/ai/cell-read'
import {
  executeWorkbookTool,
  type SheetsSkillDeps,
  type ToolExecution,
} from '../src/renderer/ai/tools'
import { readCells, type WorkbookReadContext } from '../src/renderer/ai/workbook-readers'

type Scalar = string | number | boolean | null

function deps(overrides: Partial<SheetsSkillDeps>): SheetsSkillDeps {
  return {
    getActiveSheetInfo: () => ({
      mode: 'demo',
      sheetId: 'sheet-1',
      sheetName: 'Sheet1',
      revision: 0,
      knownAddresses: [],
      sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
    }),
    readCells: () => ({}),
    readFormats: () => ({}),
    readSheetFeatures: () => '',
    findCells: () => ({ matches: [], truncated: false, incompleteSheets: [] }),
    selectRange: () => ({ ok: true, sheetName: 'Sheet1' }),
    tracePrecedents: () => ({ refs: [] }),
    traceDependents: () => ({ dependents: [], truncated: false, incompleteSheets: [] }),
    proposeOperations: () => ({ ok: false, error: 'not configured' }),
    ...overrides,
  }
}

const exec = (name: string, input: Record<string, unknown>, d: SheetsSkillDeps) =>
  executeWorkbookTool({ id: 'c', name, input }, d) as ToolExecution

describe('g6-12 #19: classifyCellType', () => {
  it.each([
    [0.1, '0%', 'percent'],
    [0.125, '0.00%', 'percent'],
    [10, 'General', 'number'],
    [10, '', 'number'],
    [1234.5, '#,##0.00', 'number'],
    [45000, 'yyyy-mm-dd', 'date'],
    [0.5, 'h:mm AM/PM', 'date'],
    [1.5, '[h]:mm', 'date'],
    [1200, '"$"#,##0.00', 'currency'],
    [1200, '[$₫-42A]#,##0', 'currency'],
    [1200, '#,##0 "đ"', 'currency'],
    [1200, '#,##0 "VND"', 'currency'],
    ['10', '@', 'text'],
    ['10%', 'General', 'text'],
    [true, 'General', 'boolean'],
    ['#DIV/0!', 'General', 'error'],
    [null, '0%', 'empty'],
  ] as [Scalar, string, string][])('%j with format %j is %s', (raw, format, expected) => {
    expect(classifyCellType(raw, format)).toBe(expected)
  })

  it('does not read date letters inside quoted text or escapes', () => {
    expect(classifyCellType(5, '0 "days"')).toBe('number')
    expect(classifyCellType(5, '0\\h')).toBe('number')
  })
})

describe('g6-12 #19: read_cells / read_range carry type, raw value and format', () => {
  const cells = {
    A1: { value: '10%', rawValue: 0.1, type: 'percent', numberFormat: '0%' },
    A2: { value: 10, rawValue: 10, type: 'number' },
    A3: { value: '10', rawValue: '10', type: 'text' },
    A4: { value: 'Hà Nội', rawValue: 'Hà Nội', type: 'text' },
  } as const

  it('read_cells tells 10 % from 10 and from the text "10"', () => {
    const result = exec(
      'read_cells',
      { addresses: ['A1', 'A2', 'A3', 'A4'] },
      deps({ readCells: vi.fn().mockReturnValue(cells) }),
    )
    expect(result.output.split('\n')).toEqual([
      'A1: 10% [percent; raw 0.1; format 0%]',
      'A2: 10',
      'A3: 10 [text]',
      'A4: Hà Nội',
    ])
  })

  it('read_range keeps the grid and lists typed cells below it', () => {
    const result = exec(
      'read_range',
      { range: 'A1:A4' },
      deps({ readCells: vi.fn().mockReturnValue(cells) }),
    )
    const lines = result.output.split('\n')
    expect(lines.slice(1, 6)).toEqual(['\tA', '1\t10%', '2\t10', '3\t10', '4\tHà Nội'])
    expect(result.output).toContain('Cell types')
    expect(result.output).toContain('A1: percent; raw 0.1; format 0%')
    expect(result.output).toContain('A3: text')
    expect(result.output).not.toContain('A2: number')
  })

  it('describes the convention in the tool descriptions', async () => {
    const { WORKBOOK_TOOLS } = await import('../src/renderer/ai/tools')
    for (const name of ['read_cells', 'read_range']) {
      const tool = WORKBOOK_TOOLS.find((entry) => entry.name === name)
      expect(tool?.description).toContain('[type; raw')
    }
  })
})

/** One Univer cell as both the demo and the lazy reader see it: the view model
 * returns the display text in lazy mode, the facade exposes the raw model. */
function univerWith(cell: { display: string; raw: Scalar; format: string; lazyView: boolean }) {
  const range = {
    getValue: () => (cell.lazyView ? cell.display : cell.raw),
    getDisplayValue: () => cell.display,
    getNumberFormat: () => cell.format,
    getFormula: () => '',
    getCellDatas: () => [[{ v: cell.raw }]],
  }
  // The lazy reader bounds-checks against the grid like a real FWorksheet.
  const worksheet = {
    getSheetId: () => 'sheet-1',
    getMaxRows: () => 1000,
    getMaxColumns: () => 26,
    getRange: () => range,
  }
  return {
    current: {
      univerAPI: {
        getActiveWorkbook: () => ({
          getActiveSheet: () => worksheet,
          getSheetBySheetId: () => worksheet,
        }),
      },
    },
  }
}

describe('g6-12 #19: demo and lazy readers give the same shape', () => {
  const PERCENT = { display: '10%', raw: 0.1, format: '0%' }

  it('a 10 % cell reads the same in both modes', () => {
    const demo: WorkbookReadContext = {
      univerRef: univerWith({ ...PERCENT, lazyView: false }),
      lazyWorkbookRef: { current: null },
      adapterRef: {
        current: {
          getSnapshot: () => ({
            revision: 0,
            sheets: [{ id: 'sheet-1', name: 'S', cells: { A1: { value: 0.1 } } }],
          }),
        },
      },
    } as unknown as WorkbookReadContext
    const lazy: WorkbookReadContext = {
      univerRef: univerWith({ ...PERCENT, lazyView: true }),
      lazyWorkbookRef: { current: { formulaMode: true, editJournal: { cells: new Map() } } },
      adapterRef: { current: { getSnapshot: () => ({ revision: 0, sheets: [] }) } },
    } as unknown as WorkbookReadContext
    const expected = { value: '10%', rawValue: 0.1, type: 'percent', numberFormat: '0%' }
    expect(readCells(demo, ['A1'])['A1']).toEqual(expected)
    expect(readCells(lazy, ['A1'])['A1']).toEqual(expected)
  })

  it('a plain General number reads the same in both modes', () => {
    const plain = { display: '10', raw: 10, format: 'General' }
    const demo = {
      univerRef: univerWith({ ...plain, lazyView: false }),
      lazyWorkbookRef: { current: null },
      adapterRef: {
        current: {
          getSnapshot: () => ({
            revision: 0,
            sheets: [{ id: 'sheet-1', name: 'S', cells: { A1: { value: 10 } } }],
          }),
        },
      },
    } as unknown as WorkbookReadContext
    const lazy = {
      univerRef: univerWith({ ...plain, lazyView: true }),
      lazyWorkbookRef: { current: { formulaMode: true, editJournal: { cells: new Map() } } },
      adapterRef: { current: { getSnapshot: () => ({ revision: 0, sheets: [] }) } },
    } as unknown as WorkbookReadContext
    expect(readCells(demo, ['A1'])['A1']).toEqual(readCells(lazy, ['A1'])['A1'])
    expect(readCells(demo, ['A1'])['A1']).toMatchObject({ rawValue: 10, type: 'number' })
  })
})
