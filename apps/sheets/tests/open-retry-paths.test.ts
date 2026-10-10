import { describe, expect, it, vi } from 'vitest'
import { createOpenRetryPaths } from '../src/main/open-retry-paths'

describe('open retry paths', () => {
  it('a picker open replaces the shell-queued path of the same tab', () => {
    const paths = createOpenRetryPaths()
    paths.remember(1, 'A.xlsx') // shell-queued
    paths.remember(1, 'B.xlsx') // later picked large workbook
    expect(paths.get(1)).toBe('B.xlsx')
  })

  it('keeps tabs apart and registers cleanup once per tab', () => {
    const paths = createOpenRetryPaths()
    const onFirst = vi.fn()
    paths.remember(1, 'A.xlsx', onFirst)
    paths.remember(1, 'B.xlsx', onFirst)
    paths.remember(2, 'C.xlsx', onFirst)
    expect(onFirst).toHaveBeenCalledTimes(2)
    expect(paths.get(1)).toBe('B.xlsx')
    expect(paths.get(2)).toBe('C.xlsx')
    paths.forget(1)
    expect(paths.get(1)).toBeUndefined()
  })
})
