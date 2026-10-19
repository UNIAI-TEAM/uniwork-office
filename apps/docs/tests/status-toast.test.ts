// UNI-1931 (SVF-2): a phone-width frame hides the status message in the bar, so App raises it as a
// toast. showStatusToast adds the info toast, but never doubles an action's own toast (a failed
// save already calls showToast with the same text and its error kind).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isOutcomeStatus,
  setToastEmitter,
  showStatusToast,
  showToast,
  toastStatusLine,
  type ToastData,
} from '../src/renderer/components/toast-bus'
import { setModuleLang, t, type StatusLine } from '../src/renderer/i18n/locale'

let seen: ToastData[]

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  seen = []
  setToastEmitter((toast) => seen.push(toast))
  setModuleLang('en')
})

afterEach(() => {
  setToastEmitter(null)
  vi.unstubAllGlobals()
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

// UNI-1931 (FE1-2): only outcomes toast. Progress, autosave and opened lines stay in the bar.
const QUIET: StatusLine[] = [
  { key: 'appSaving' },
  { key: 'appSavingAs' },
  { key: 'appAutoSavedAt', params: { time: '10:00:00' } },
  { key: 'appExportingPdf' },
  { key: 'appExportingHtml' },
  { key: 'appExportingImages' },
  { key: 'appExportImagesProgress', params: { count: 12 } },
  { key: 'appMixedExportOpening' },
  { key: 'appOpenedFile', params: { name: 'a.docx' } },
]

describe('isOutcomeStatus', () => {
  it.each(QUIET)('progress / housekeeping line %j is not an outcome', (line) => {
    expect(isOutcomeStatus(line)).toBe(false)
  })

  it('an empty line is not an outcome', () => {
    expect(isOutcomeStatus('')).toBe(false)
  })

  it('ready text and other keyed lines are outcomes', () => {
    expect(isOutcomeStatus('Save failed: 500')).toBe(true)
    expect(isOutcomeStatus({ key: 'appPrintNoDocument' })).toBe(true)
    expect(isOutcomeStatus({ key: 'appSaveFailed', params: { error: 'x' } })).toBe(true)
  })
})

describe('toastStatusLine at phone width', () => {
  it('toasts an outcome, translated, and none of the progress lines', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    for (const line of QUIET) toastStatusLine(line, t)
    expect(seen).toEqual([])
    toastStatusLine({ key: 'appPrintNoDocument' }, t)
    expect(seen).toEqual([{ text: 'Open a document to print it.', kind: 'info' }])
  })
})

// UNI-1931 (FE1-5/6): the status -> toast bridge only acts where the bar hides the message
describe('toastStatusLine matchMedia gate', () => {
  it('skips a wide frame (the bar shows the message)', () => {
    const matchMedia = vi.fn(() => ({ matches: false }))
    vi.stubGlobal('matchMedia', matchMedia)
    toastStatusLine({ key: 'appPrintNoDocument' }, t)
    toastStatusLine('Save failed: 500', t)
    expect(matchMedia).toHaveBeenCalledWith('(max-width: 640px)')
    expect(seen).toEqual([])
  })

  it('toasts at 640px and below', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    toastStatusLine('Save failed: 500', t)
    expect(seen).toEqual([{ text: 'Save failed: 500', kind: 'info' }])
  })

  it('without matchMedia (jsdom, a bare test mount) it does nothing and does not throw', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(() => toastStatusLine('Save failed: 500', t)).not.toThrow()
    expect(seen).toEqual([])
  })
})
