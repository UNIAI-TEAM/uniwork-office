import { describe, expect, it, vi } from 'vitest'

import {
  executeWorkbookTool,
  type SheetsSkillDeps,
  type ToolExecution,
} from '../src/renderer/ai/tools'

function deps(overrides: Partial<SheetsSkillDeps> = {}): SheetsSkillDeps {
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

async function run(addresses: string[], d: SheetsSkillDeps): Promise<ToolExecution> {
  return executeWorkbookTool({ id: 'c1', name: 'read_cells', input: { addresses } }, d)
}

const column = (count: number): string[] => Array.from({ length: count }, (_, i) => `A${i + 1}`)

describe('g6-12 #23: read_cells reports truncation above 100 addresses', () => {
  it('says how many were asked, how many were read, and how to get the rest', async () => {
    const readCells = vi.fn((addresses: readonly string[]) =>
      Object.fromEntries(addresses.map((address) => [address, { value: 1 }])),
    )
    const result = await run(column(130), deps({ readCells }))
    expect(readCells).toHaveBeenCalledWith(column(100), undefined)
    expect(result.isError).toBeFalsy()
    expect(result.output).toContain('130 addresses were requested')
    expect(result.output).toContain('only the first 100 were read')
    expect(result.output).toContain('30 were NOT read')
    // the first unread address, so the model can continue from it
    expect(result.output).toContain('A101')
    expect(result.output).toContain('call read_cells again')
    // every read address is still listed
    expect(result.output).toContain('A100: 1')
    expect(result.output).not.toContain('A101: ')
  })

  it('adds nothing when the request fits', async () => {
    const readCells = vi.fn((addresses: readonly string[]) =>
      Object.fromEntries(addresses.map((address) => [address, { value: 1 }])),
    )
    const result = await run(column(100), deps({ readCells }))
    expect(result.output.split('\n')).toHaveLength(100)
    expect(result.output).not.toContain('NOT read')
  })
})
