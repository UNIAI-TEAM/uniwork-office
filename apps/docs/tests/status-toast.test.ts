// UNI-1931 (SVF-2): a phone-width frame hides the status message in the bar, so App raises it as a
// toast. showStatusToast adds the info toast, but never doubles an action's own toast (a failed
// save already calls showToast with the same text and its error kind).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  setToastEmitter,
  showStatusToast,
  showToast,
  type ToastData,
} from '../src/renderer/components/toast-bus'

let seen: ToastData[]

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  seen = []
  setToastEmitter((toast) => seen.push(toast))
})

afterEach(() => {
  setToastEmitter(null)
  vi.useRealTimers()
})

describe('showStatusToast', () => {
  it('shows a status line as an info toast', () => {
    showStatusToast('Open a document to print it.')
    expect(seen).toEqual([{ text: 'Open a document to print it.', kind: 'info' }])
  })

  it('ignores an empty line', () => {
    showStatusToast('')
    expect(seen).toEqual([])
  })

  it('keeps the error toast an action already raised for the same text', () => {
    showToast('Save failed: 500', 'error')
    showStatusToast('Save failed: 500')
    expect(seen).toEqual([{ text: 'Save failed: 500', kind: 'error' }])
  })

  it('shows the same text again once the earlier toast is long gone', () => {
    showToast('Save failed: 500', 'error')
    vi.advanceTimersByTime(6000)
    showStatusToast('Save failed: 500')
    expect(seen.map((s) => s.kind)).toEqual(['error', 'info'])
  })
})
