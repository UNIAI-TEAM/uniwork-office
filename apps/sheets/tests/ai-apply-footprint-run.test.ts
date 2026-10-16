import { describe, expect, it } from 'vitest'
import type { ChangePlan } from '@genoffice/xlsx-gateway/domain/workbook.types'

import { attachRunFootprint, createRunWriteLedger } from '../src/renderer/ai/apply-footprint'
import type { AiChatMessage } from '../src/renderer/ai/AiChatPanel'
import {
  executeWorkbookTool,
  type ActiveSheetInfo,
  type SheetsSkillDeps,
  type ToolExecution,
} from '../src/renderer/ai/tools'

// G6-09 W6: propose_operations hands the panel the writes of its batch; the App folds them into one
// run footprint on the run's assistant message. The next run starts clean.

const info: ActiveSheetInfo = {
  mode: 'demo',
  sheetId: 'sheet-1',
  sheetName: 'Sheet1',
  revision: 0,
  knownAddresses: [],
  sheets: [
    { id: 'sheet-1', name: 'Sheet1' },
    { id: 'sheet-2', name: 'Summary' },
  ],
}

function planOf(cells: [string, string, unknown, unknown][]): ChangePlan {
  return {
    transactionId: 't',
    baseRevision: 0,
    cellChanges: cells.map(([sheetId, address, before, after]) => ({
      sheetId,
      address,
      before: { value: before as never },
      after: { value: after as never },
    })),
    sheetRenames: [],
    structuralChanges: [],
    formatChanges: [],
    warnings: [],
  }
}

function depsWith(plan: ChangePlan): SheetsSkillDeps {
  return {
    getActiveSheetInfo: () => info,
    readCells: () => ({}),
    readFormats: () => ({}),
    readSheetFeatures: () => '',
    findCells: () => ({ matches: [], truncated: false, incompleteSheets: [] }),
    selectRange: () => ({ ok: true, sheetName: 'Sheet1' }),
    tracePrecedents: () => ({ refs: [] }),
    traceDependents: () => ({ dependents: [], truncated: false, incompleteSheets: [] }),
    proposeOperations: () => ({ ok: true, plan }),
  }
}

const propose = (plan: ChangePlan): ToolExecution => {
  const result = executeWorkbookTool(
    {
      id: 'c',
      name: 'propose_operations',
      input: {
        summary: 'fill',
        operations: [{ op: 'set_cell', sheetId: 'sheet-1', address: 'A1', value: 1 }],
      },
    },
    depsWith(plan),
  )
  if (result instanceof Promise) throw new Error('expected sync execution')
  return result
}

describe('propose_operations execution', () => {
  it('carries the batch writes in sheet names, flagging the overwritten cells', () => {
    const execution = propose(
      planOf([
        ['sheet-1', 'A1', 'old', 'new'],
        ['sheet-2', 'B2', null, 5],
      ]),
    )
    expect(execution.mutated).toBe(true)
    expect(execution.write?.activeSheet).toBe('Sheet1')
    expect(execution.write?.cells).toEqual([
      { sheet: 'Sheet1', row: 0, column: 0, overwrote: true },
      { sheet: 'Summary', row: 1, column: 1, overwrote: false },
    ])
  })

  it('a read tool carries no writes', () => {
    const result = executeWorkbookTool(
      { id: 'c', name: 'read_cells', input: { addresses: ['A1'] } },
      depsWith(planOf([])),
    )
    expect((result as ToolExecution).write).toBeUndefined()
  })
})

describe('attachRunFootprint', () => {
  function fakeChat() {
    let last: AiChatMessage = { role: 'assistant', text: '', tools: [] }
    return {
      patch: (fn: (entry: AiChatMessage) => AiChatMessage) => {
        last = fn(last)
      },
      get last() {
        return last
      },
    }
  }

  it('merges the tools of one run onto its message', () => {
    const ledger = createRunWriteLedger()
    const chat = fakeChat()
    attachRunFootprint(ledger, propose(planOf([['sheet-1', 'A1', 'old', 'new']])), chat.patch)
    attachRunFootprint(ledger, propose(planOf([['sheet-1', 'A2', 'old', 'new']])), chat.patch)
    expect(chat.last.applyFootprint).toEqual({
      ranges: ['A1:A2'],
      overwritten: 2,
      overwrittenExact: true,
    })
  })

  it('a read-only tool leaves the message alone', () => {
    const ledger = createRunWriteLedger()
    const chat = fakeChat()
    attachRunFootprint(ledger, { output: '', mutated: false, summary: 'read' }, chat.patch)
    expect(chat.last.applyFootprint).toBeUndefined()
  })

  it('after reset the next run does not inherit the previous run footprint', () => {
    const ledger = createRunWriteLedger()
    const first = fakeChat()
    attachRunFootprint(ledger, propose(planOf([['sheet-1', 'A1', 'old', 'new']])), first.patch)
    ledger.reset()
    const second = fakeChat()
    attachRunFootprint(ledger, propose(planOf([['sheet-1', 'C3', null, 'x']])), second.patch)
    expect(first.last.applyFootprint?.ranges).toEqual(['A1'])
    expect(second.last.applyFootprint).toEqual({
      ranges: ['C3'],
      overwritten: 0,
      overwrittenExact: true,
    })
  })
})
