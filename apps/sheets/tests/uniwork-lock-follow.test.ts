/**
 * EL-1(b) fix6 / VEL-1+VEL-2 (sheets): the workbook's read-only and bound
 * flags follow the shell's `uniwork:doc-state-changed` ping (re-queries
 * `uniworkState()`, updates the file and flips `viewOnlyLock` without touching
 * pending journal edits), and an explicit Save on a read-only bound workbook
 * calls `uniworkReadOnlySave` once instead of silently doing nothing.
 */
import { describe, expect, it, vi } from 'vitest'
import type { WorkbookFile } from '../src/shared/desktop-api'
import { createViewOnlyLock, type EditableWorkbook } from '../src/renderer/view-only-lock'
import {
  applySheetsUniworkAnswer,
  sheetsBlocksReadOnlySave,
  sheetsMatchesUniworkPath,
  watchSheetsUniworkState,
} from '../src/renderer/uniwork-state'

const PATH = 'C:/u/uniwork-documents/dep/user/doc1/budget.xlsx'
const OTHER = 'C:/u/uniwork-documents/dep/user/doc2/other.xlsx'

function makeFile(overrides: Partial<WorkbookFile> = {}): WorkbookFile {
  return {
    sessionId: '00000000-0000-4000-8000-000000000001',
    name: 'budget.xlsx',
    path: PATH,
    sha256: '0'.repeat(64),
    entryCount: 1,
    sheets: [
      {
        id: 'sheet-1',
        name: 'Sheet1',
        rowCount: 10,
        columnCount: 5,
        nonEmptyCellCount: 0,
        formulaCellCount: 0,
        mergedRanges: [],
        rowHeights: [],
        columnWidths: [],
        hiddenRows: [],
        hiddenColumns: [],
        outlineRows: [],
        outlineColumns: [],
        conditionalFormatting: [],
        dataValidations: [],
        hyperlinks: [],
        sparklines: [],
        tables: [],
        autoFilter: null,
        freeze: { xSplit: 0, ySplit: 0 },
        showGridlines: true,
        tabColor: null,
        notes: [],
        threadedComments: [],
        pageSetup: { orientation: 'portrait' },
        cellImages: [],
      },
    ],
    activeTab: 0,
    styles: [],
    dxfStyles: [],
    visuals: [],
    definedNames: [],
    readOnly: true,
    uniworkBound: true,
    ...overrides,
  }
}

describe('watchSheetsUniworkState follows the lock ping', () => {
  it('flips read-only -> editable -> read-only on a ping for the open path and updates viewOnlyLock', async () => {
    let file: WorkbookFile | null = makeFile({ readOnly: true, uniworkBound: true })
    let answer = { bound: true, readOnly: false }
    let ping: ((path: string) => void) | null = null
    let unsubscribes = 0
    const editableHistory: boolean[] = []
    const workbook: EditableWorkbook = {
      setEditable: (v: boolean) => {
        editableHistory.push(v)
      },
    }
    const lock = createViewOnlyLock(() => () => {})
    // Initial open locked the view-only workbook
    lock.set(workbook)
    expect(editableHistory).toEqual([false])

    const uniworkState = vi.fn(async () => answer)
    const unsubscribe = watchSheetsUniworkState({
      api: {
        uniworkState,
        onUniworkStateChanged: (cb) => {
          ping = cb
          return () => {
            unsubscribes += 1
          }
        },
      },
      getFile: () => file,
      setFile: (next) => {
        file = next
      },
      getWorkbook: () => workbook,
      lock,
      webViewOnly: false,
    })

    // Ping for another document is ignored
    ping?.(OTHER)
    await Promise.resolve()
    await Promise.resolve()
    expect(uniworkState).not.toHaveBeenCalled()
    expect(file?.readOnly).toBe(true)

    // Ping for this workbook -> becomes editable, viewOnlyLock releases (setEditable(true))
    ping?.(PATH)
    await Promise.resolve()
    await Promise.resolve()
    expect(uniworkState).toHaveBeenCalledTimes(1)
    expect(file?.readOnly).toBe(false)
    expect(file?.uniworkBound).toBe(true)
    expect(editableHistory).toEqual([false, true])

    // Ping -> lock lost, becomes read-only again, viewOnlyLock re-locks (setEditable(false))
    answer = { bound: true, readOnly: true }
    ping?.(PATH)
    await Promise.resolve()
    await Promise.resolve()
    expect(uniworkState).toHaveBeenCalledTimes(2)
    expect(file?.readOnly).toBe(true)
    expect(editableHistory).toEqual([false, true, false])

    unsubscribe()
    expect(unsubscribes).toBe(1)
  })

  it('matches the ping regardless of Windows slash / case spelling or csvPath', () => {
    const xlsx = makeFile({ path: 'C:\\U\\Doc1\\budget.xlsx' })
    expect(sheetsMatchesUniworkPath(xlsx, 'c:/u/doc1/budget.xlsx')).toBe(true)
    expect(sheetsMatchesUniworkPath(xlsx, OTHER)).toBe(false)
    const csv = makeFile({ path: 'C:/tmp/snap.xlsx', csvPath: 'C:/u/doc1/data.csv' })
    expect(sheetsMatchesUniworkPath(csv, 'C:/u/doc1/data.csv')).toBe(true)
  })

  it('keeps converted .xls imports editable and unbound even if main answers otherwise', () => {
    const converted = makeFile({ readOnly: false, uniworkBound: undefined, needsSaveAs: true })
    const next = applySheetsUniworkAnswer(converted, { bound: true, readOnly: true })
    expect(next.readOnly).toBe(false)
    expect(next.uniworkBound).toBeUndefined()
  })
})

describe('sheetsBlocksReadOnlySave', () => {
  const boundView = makeFile({ readOnly: true, uniworkBound: true })
  const boundEdit = makeFile({ readOnly: false, uniworkBound: true })
  const localView = makeFile({ readOnly: true, uniworkBound: undefined })

  it('calls uniworkReadOnlySave once and blocks the save on a read-only bound workbook', () => {
    const uniworkReadOnlySave = vi.fn(async () => undefined)
    expect(sheetsBlocksReadOnlySave({ uniworkReadOnlySave }, boundView, 'save', false)).toBe(true)
    expect(uniworkReadOnlySave).toHaveBeenCalledTimes(1)
    expect(uniworkReadOnlySave).toHaveBeenCalledWith(PATH)
  })

  it('blocks the save of an unbound read-only workbook without calling uniworkReadOnlySave', () => {
    const uniworkReadOnlySave = vi.fn(async () => undefined)
    expect(sheetsBlocksReadOnlySave({ uniworkReadOnlySave }, localView, 'save', false)).toBe(true)
    expect(uniworkReadOnlySave).not.toHaveBeenCalled()
  })

  it('allows an editable bound workbook to proceed to the normal save', () => {
    const uniworkReadOnlySave = vi.fn(async () => undefined)
    expect(sheetsBlocksReadOnlySave({ uniworkReadOnlySave }, boundEdit, 'save', false)).toBe(false)
    expect(uniworkReadOnlySave).not.toHaveBeenCalled()
  })

  it('never calls uniworkReadOnlySave on Save As, recovery, or quiet AutoSave', () => {
    const uniworkReadOnlySave = vi.fn(async () => undefined)
    expect(sheetsBlocksReadOnlySave({ uniworkReadOnlySave }, boundView, 'save-as', false)).toBe(
      false,
    )
    expect(sheetsBlocksReadOnlySave({ uniworkReadOnlySave }, boundView, 'recovery', false)).toBe(
      false,
    )
    expect(sheetsBlocksReadOnlySave({ uniworkReadOnlySave }, boundView, 'save', true)).toBe(true)
    expect(uniworkReadOnlySave).not.toHaveBeenCalled()
  })
})
