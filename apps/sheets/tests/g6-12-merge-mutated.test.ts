// @vitest-environment jsdom
// §9 / tool table §3.1: merge_attached_workbooks writes sheets into the open
// workbook, so it declares `mutated: true` (run bookkeeping + the extractor's
// editor_write column), and the merge reports how many undo steps revert it so
// the AI panel's [Undo] can roll it back — or null when Univer's bounded undo
// history cannot hold the whole merge.
import {
  ICommandService,
  IUndoRedoService,
  IUniverInstanceService,
  LocaleType,
  LogLevel,
  Univer,
} from '@univerjs/core'
import { UniverSheetsPlugin } from '@univerjs/sheets'
import '@univerjs/sheets/facade'
import { FUniver } from '@univerjs/core/lib/facade'
import { afterEach, describe, expect, it } from 'vitest'

import { createMergeSkill } from '../src/renderer/ai/merge-skill'
import { mergeSourcesIntoCurrent, type MergeSourcesResult } from '../src/renderer/merge-workbooks'
import type { AttachmentMeta, WorkbookFile } from '../src/shared/desktop-api'
import type { UniverRuntime } from '../src/renderer/univer-state'

const attachments: AttachmentMeta[] = [
  { path: '/home/u/q3.xlsx', name: 'q3.xlsx', ext: 'xlsx', sizeBytes: 2048 },
]

function mergeSkill(result: MergeSourcesResult) {
  return createMergeSkill({ getAttachments: () => attachments, mergePaths: async () => result })
}

const call = { id: 'm1', name: 'merge_attached_workbooks', input: {} }

describe('g6-12 merge_attached_workbooks declaration', () => {
  it('declares mutated: true on success', async () => {
    const execution = await mergeSkill({
      importedSheets: 1,
      files: 1,
      sheetNames: ['q3'],
      undoSteps: 2,
    }).executeTool(call)
    expect(execution.isError).toBeFalsy()
    expect(execution.mutated).toBe(true)
    expect(execution.output).toMatch(/Undo/)
  })

  it('says so when the undo history cannot hold the merge', async () => {
    const execution = await mergeSkill({
      importedSheets: 3,
      files: 1,
      sheetNames: ['a', 'b', 'c'],
      undoSteps: null,
    }).executeTool(call)
    expect(execution.mutated).toBe(true)
    expect(execution.output).toMatch(/cannot be undone/i)
  })
})

// ── rollback against a real Univer workbook ────────────────────────────────

const UNIT_ID = 'g6-12-merge-wb'
const SHEET_ID = 'g6-12-merge-sheet'
const g = globalThis as { window?: { desktopApi?: unknown } }
const previousDesktopApi = g.window?.desktopApi

afterEach(() => {
  if (g.window) g.window.desktopApi = previousDesktopApi
})

function boot() {
  const univer = new Univer({
    logLevel: LogLevel.SILENT,
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: {} },
  })
  univer.registerPlugin(UniverSheetsPlugin)
  const univerAPI = FUniver.newAPI(univer)
  univerAPI.createWorkbook({
    id: UNIT_ID,
    name: 'book',
    sheetOrder: [SHEET_ID],
    sheets: { [SHEET_ID]: { id: SHEET_ID, name: 'Sheet1', rowCount: 1000, columnCount: 26 } },
  })
  const injector = univer.__getInjector()
  // undo/redo act on the focused unit (the grid has focus in the app)
  injector.get(IUniverInstanceService).focusUnit(UNIT_ID)
  return {
    runtime: { univer, univerAPI } as unknown as UniverRuntime,
    univerAPI,
    commandService: injector.get(ICommandService),
    undoRedoService: injector.get(IUndoRedoService),
  }
}

function undoDepth(service: IUndoRedoService): number {
  return (
    (service as unknown as { _undoStacks: Map<string, unknown[]> })._undoStacks.get(UNIT_ID)
      ?.length ?? 0
  )
}

/** One source workbook whose single sheet holds a 2×2 block and `customRows` row heights. */
function source(customRows: number): WorkbookFile {
  ;(g.window ??= {} as { desktopApi?: unknown }).desktopApi = {
    readWorkbookRange: async () => ({
      cells: [
        { row: 0, column: 0, value: 'Region' },
        { row: 0, column: 1, value: 'Total' },
        { row: 1, column: 0, value: 'North' },
        { row: 1, column: 1, value: 42 },
      ],
      merges: [],
      rows: Array.from({ length: customRows }, (_, row) => ({
        row,
        height: 15 + row,
        customHeight: true,
      })),
      indexingComplete: true,
      indexedThroughRow: 1,
    }),
    closeWorkbook: async () => undefined,
  }
  return {
    sessionId: 'src-session',
    name: 'q3.xlsx',
    styles: [],
    sheets: [{ id: 'src-sheet', name: 'Q3', rowCount: Math.max(2, customRows), columnCount: 2 }],
  } as unknown as WorkbookFile
}

describe('g6-12 merge rollback', () => {
  it('reports undo steps that restore the workbook and keep earlier history', async () => {
    const { runtime, univerAPI, commandService, undoRedoService } = boot()
    // the user's own edit before the AI turn
    await commandService.executeCommand('sheet.command.set-range-values', {
      unitId: UNIT_ID,
      subUnitId: SHEET_ID,
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
      value: { 0: { 0: { v: 'mine' } } },
    })
    const before = undoDepth(undoRedoService)
    expect(before).toBe(1)

    const result = await mergeSourcesIntoCurrent(
      { runtime, lazyWorkbookRef: { current: null }, setMessage: () => {} },
      [source(0)],
    )
    expect(result.sheetNames).toEqual(['Q3'])
    expect(
      univerAPI
        .getActiveWorkbook()!
        .getSheets()
        .map((s) => s.getSheetName()),
    ).toEqual(['Sheet1', 'Q3'])
    expect(result.undoSteps).toBeGreaterThan(0)

    // what the panel's [Undo] does with the recorded steps
    for (let step = 0; step < (result.undoSteps ?? 0); step += 1) await univerAPI.undo()

    const workbook = univerAPI.getActiveWorkbook()!
    expect(workbook.getSheets().map((s) => s.getSheetName())).toEqual(['Sheet1'])
    expect(workbook.getSheetBySheetId(SHEET_ID)!.getRange('A1').getValue()).toBe('mine')
    expect(undoDepth(undoRedoService)).toBe(before)
  })

  it('reports null when the merge overflows the bounded undo history', async () => {
    const { runtime } = boot()
    const result = await mergeSourcesIntoCurrent(
      { runtime, lazyWorkbookRef: { current: null }, setMessage: () => {} },
      [source(40)],
    )
    expect(result.importedSheets).toBe(1)
    expect(result.undoSteps).toBeNull()
  })
})
