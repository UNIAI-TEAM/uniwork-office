/**
 * View-only UniWork workbook: the workbook permission must not veto the
 * loader's own installs (an empty grid), and status texts name the opened file.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { workbookDisplayName } from '../src/main/workbook-name'
import { journalSuppression } from '../src/renderer/univer-state'
import { createViewOnlyLock, viewOnlyLock } from '../src/renderer/view-only-lock'

function fakeWorkbook() {
  const calls: boolean[] = []
  return { calls, setEditable: vi.fn((value: boolean) => void calls.push(value)) }
}

afterEach(() => {
  journalSuppression.active = false
  viewOnlyLock.set(null)
})

describe('view-only lock', () => {
  it('locks the workbook when set', () => {
    const workbook = fakeWorkbook()
    viewOnlyLock.set(workbook)
    expect(workbook.calls).toEqual([false])
  })

  it('opens for a programmatic install and closes again afterwards', () => {
    const workbook = fakeWorkbook()
    viewOnlyLock.set(workbook)
    journalSuppression.active = true
    expect(workbook.calls.at(-1)).toBe(true)
    journalSuppression.active = false
    expect(workbook.calls.at(-1)).toBe(false)
  })

  it('stays locked when set during an install window until it ends', () => {
    journalSuppression.active = true
    const workbook = fakeWorkbook()
    viewOnlyLock.set(workbook)
    expect(workbook.calls).toEqual([true])
    journalSuppression.active = false
    expect(workbook.calls).toEqual([true, false])
  })

  it('does nothing for an editable workbook or after release', () => {
    const workbook = fakeWorkbook()
    viewOnlyLock.set(workbook)
    viewOnlyLock.set(null)
    workbook.setEditable.mockClear()
    journalSuppression.active = true
    journalSuppression.active = false
    expect(workbook.setEditable).not.toHaveBeenCalled()
  })

  it('survives a workbook whose permission call throws', () => {
    const lock = createViewOnlyLock(() => () => undefined)
    expect(() =>
      lock.set({
        setEditable: () => {
          throw new Error('disposed')
        },
      }),
    ).not.toThrow()
  })
})

describe('workbookDisplayName', () => {
  it('shows the opened file, not the engine temp snapshot', () => {
    expect(workbookDisplayName({ path: 'C:/u/UniWork/Budget.xlsx' })).toBe('Budget.xlsx')
  })

  it('shows the original of a recovered copy and the source of a CSV import', () => {
    expect(
      workbookDisplayName({ path: '/tmp/rec/3f2a.xlsx', restoreTarget: '/home/u/Plan.xlsx' }),
    ).toBe('Plan.xlsx')
    expect(
      workbookDisplayName({ path: '/tmp/imp/3f2a.xlsx', csvSourcePath: '/home/u/data.csv' }),
    ).toBe('data.csv')
  })
})
