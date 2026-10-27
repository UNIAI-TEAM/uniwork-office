/**
 * EL-1(b) fix6 / VEL-1+VEL-2 (sheets): the workbook's read-only and bound
 * flags follow the shell's `uniwork:doc-state-changed` ping (re-queries
 * `uniworkState()`, updates the file and flips `viewOnlyLock` without touching
 * pending journal edits), and an explicit Save on a read-only bound workbook
 * calls `uniworkReadOnlySave` once instead of silently doing nothing.
 */
import { describe, expect, it, vi } from 'vitest'
import { createViewOnlyLock, type EditableWorkbook } from '../src/renderer/view-only-lock'
import {
  applySheetsUniworkAnswer,
  sheetsBlocksReadOnlySave,
  sheetsMatchesUniworkPath,
  watchSheetsUniworkState,
  type SheetsUniworkFile,
} from '../src/renderer/uniwork-state'

const PATH = 'C:/u/uniwork-documents/dep/user/doc1/budget.xlsx'
const OTHER = 'C:/u/uniwork-documents/dep/user/doc2/other.xlsx'

function makeFile(overrides: Partial<SheetsUniworkFile> = {}): SheetsUniworkFile {
  return {
    path: PATH,
    readOnly: true,
    uniworkBound: true,
    ...overrides,
  }
}

describe('watchSheetsUniworkState follows the lock ping', () => {
  it('flips read-only -> editable -> read-only on a ping for the open path and updates viewOnlyLock', async () => {
    let file: SheetsUniworkFile | null = makeFile({ readOnly: true, uniworkBound: true })
    let answer = { bound: true, readOnly: false }
    let ping = (_path: string): void => {}
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
    ping(OTHER)
    await Promise.resolve()
    await Promise.resolve()
    expect(uniworkState).not.toHaveBeenCalled()
    expect(file?.readOnly).toBe(true)

    // Ping for this workbook -> becomes editable, viewOnlyLock releases (setEditable(true))
    ping(PATH)
    await Promise.resolve()
    await Promise.resolve()
    expect(uniworkState).toHaveBeenCalledTimes(1)
    expect(file?.readOnly).toBe(false)
    expect(file?.uniworkBound).toBe(true)
    expect(editableHistory).toEqual([false, true])

    // Ping -> lock lost, becomes read-only again, viewOnlyLock re-locks (setEditable(false))
    answer = { bound: true, readOnly: true }
    ping(PATH)
    await Promise.resolve()
    await Promise.resolve()
    expect(uniworkState).toHaveBeenCalledTimes(2)
    expect(file?.readOnly).toBe(true)
    expect(editableHistory).toEqual([false, true, false])

    unsubscribe()
    expect(unsubscribes).toBe(1)
  })

  it('takes the working-copy path from the adoption ping, then follows a later lock ping for it (R1-7)', async () => {
    const TEMP = 'C:/tmp/genoffice-imports/u1/budget.xlsx'
    let file: SheetsUniworkFile | null = makeFile({
      path: TEMP,
      readOnly: false,
      uniworkBound: undefined,
      unsavedNew: true,
      needsSaveAs: true,
    })
    let answer = { bound: true, readOnly: false }
    let ping = (_path: string, _newPath?: string): void => {}
    const editableHistory: boolean[] = []
    const workbook: EditableWorkbook = { setEditable: (v: boolean) => void editableHistory.push(v) }
    const lock = createViewOnlyLock(() => () => {})
    watchSheetsUniworkState({
      api: {
        uniworkState: async () => answer,
        onUniworkStateChanged: (cb) => {
          ping = cb
          return () => {}
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

    // adoption: the ping names the old temp path and carries the working copy
    ping(TEMP, PATH)
    await Promise.resolve()
    await Promise.resolve()
    expect(file).toMatchObject({ path: PATH, uniworkBound: true, readOnly: false })
    expect(file?.unsavedNew).toBeUndefined()

    // the lock changes for the working copy: the editor follows without a save / reopen
    answer = { bound: true, readOnly: true }
    ping(PATH)
    await Promise.resolve()
    await Promise.resolve()
    expect(file?.readOnly).toBe(true)
    expect(editableHistory).toEqual([false])
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
