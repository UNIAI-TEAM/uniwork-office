import { describe, expect, it } from 'vitest'
import { hasPendingSaveEdits } from '../src/main/save-pending'
import type { SavePdfRequest } from '../src/shared/ipc'

const req = (over: Partial<SavePdfRequest> = {}): SavePdfRequest =>
  ({ filePath: '/tmp/a.pdf', ...over }) as SavePdfRequest

describe('hasPendingSaveEdits', () => {
  it('counts an outline-only edit as pending', () => {
    expect(hasPendingSaveEdits(req({ outline: [{ title: 'A', pageIndex: 0 }] }))).toBe(true)
  })

  it('counts an emptied outline as pending (a deliberate "no bookmarks")', () => {
    expect(hasPendingSaveEdits(req({ outline: [] }))).toBe(true)
  })

  it('does not count an empty request as pending', () => {
    expect(hasPendingSaveEdits(req())).toBe(false)
  })
})
