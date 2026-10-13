import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  executeWorkbookTool,
  type SheetsSkillDeps,
  type ToolExecution,
} from '../src/renderer/ai/tools'
import { readCells, type WorkbookReadContext } from '../src/renderer/ai/workbook-readers'
import { setSupportedFunctionProbe, unsupportedFunctionNames } from '../src/renderer/univer-sync'

afterEach(() => {
  setSupportedFunctionProbe(null)
})

const MISSING = new Set(['WEBSERVICE', 'FILTERXML', 'FOOBAR'])

function installProbe() {
  setSupportedFunctionProbe({ ready: () => true, supports: (name) => !MISSING.has(name) })
}

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

describe('g6-12: unsupportedFunctionNames', () => {
  it('lists the functions the running engine lacks', () => {
    installProbe()
    expect(unsupportedFunctionNames('=IFERROR(WEBSERVICE("https://x"),0)+SUM(A1)')).toEqual([
      'WEBSERVICE',
    ])
    expect(unsupportedFunctionNames('=SUM(A1:A3)')).toEqual([])
  })

  it('says nothing before the registry is ready', () => {
    setSupportedFunctionProbe({ ready: () => false, supports: () => false })
    expect(unsupportedFunctionNames('=FOOBAR(1)')).toEqual([])
  })
})

describe('g6-12: readers report unsupported functions', () => {
  it('demo read of a #NAME? formula names the missing function', () => {
    installProbe()
    const range = {
      getValue: () => '#NAME?',
      getDisplayValue: () => '#NAME?',
      getNumberFormat: () => 'General',
      getCellDatas: () => [[{ f: '=WEBSERVICE("https://x")', v: '#NAME?' }]],
    }
    const worksheet = { getSheetId: () => 'sheet-1', getRange: () => range }
    const ctx = {
      univerRef: {
        current: {
          univerAPI: {
            getActiveWorkbook: () => ({
              getActiveSheet: () => worksheet,
              getSheetBySheetId: () => worksheet,
            }),
          },
        },
      },
      lazyWorkbookRef: { current: null },
      adapterRef: {
        current: {
          getSnapshot: () => ({
            revision: 0,
            sheets: [
              {
                id: 'sheet-1',
                name: 'S',
                cells: { A1: { value: null, formula: '=WEBSERVICE("https://x")' } },
              },
            ],
          }),
        },
      },
    } as unknown as WorkbookReadContext
    expect(readCells(ctx, ['A1'])['A1']).toMatchObject({ unsupportedFunctions: ['WEBSERVICE'] })
  })
})

describe('g6-12: tool output names unsupported functions', () => {
  it('read_cells explains a #NAME? and a blank fallback instead of passing them on silently', async () => {
    const readCellsDep = vi.fn().mockReturnValue({
      A1: {
        value: '#NAME?',
        formula: '=WEBSERVICE("https://x")',
        type: 'error',
        unsupportedFunctions: ['WEBSERVICE'],
      },
      A2: {
        value: null,
        formula: '=IFERROR(FILTERXML(B1,"//a"),"")',
        type: 'empty',
        unsupportedFunctions: ['FILTERXML'],
      },
    })
    const result = (await executeWorkbookTool(
      { id: 'c', name: 'read_cells', input: { addresses: ['A1', 'A2'] } },
      deps({ readCells: readCellsDep }),
    )) as ToolExecution
    const [first, second] = result.output.split('\n')
    expect(first).toContain('unsupported function: WEBSERVICE')
    expect(first).toContain('cannot calculate')
    expect(second).toContain('unsupported function: FILTERXML')
  })

  it('propose_operations read-back names the unsupported function of a written formula', async () => {
    const plan = {
      transactionId: 't',
      baseRevision: 0,
      cellChanges: [
        {
          sheetId: 'sheet-1',
          address: 'B2',
          before: { value: null },
          after: { value: null, formula: '=FOOBAR(A1)' },
        },
      ],
      sheetRenames: [],
      structuralChanges: [],
      formatChanges: [],
      warnings: [],
    }
    const result = (await executeWorkbookTool(
      {
        id: 'c',
        name: 'propose_operations',
        input: {
          operations: [
            { op: 'set_formula', sheetId: 'sheet-1', address: 'B2', formula: '=FOOBAR(A1)' },
          ],
          summary: 'write',
        },
      },
      deps({
        proposeOperations: () => ({ ok: true, plan }),
        readCells: () => ({
          B2: {
            value: '#NAME?',
            formula: '=FOOBAR(A1)',
            type: 'error',
            unsupportedFunctions: ['FOOBAR'],
          },
        }),
      }),
    )) as ToolExecution
    expect(result.output).toContain('B2 = #NAME?')
    expect(result.output).toContain('unsupported function: FOOBAR')
  })
})
