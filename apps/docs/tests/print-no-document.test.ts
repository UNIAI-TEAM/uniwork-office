// UNI-1931 (RFF-2): Ctrl/Cmd+P (and File > Print) with no document open used to do nothing and say
// nothing. printDoc now answers with the "open a document" status line; with a document it opens the
// print dialog and sets no message.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { printDoc, type FileActionContext } from '../src/renderer/file-actions'
import {
  setToastEmitter,
  toastStatusLine,
  type ToastData,
} from '../src/renderer/components/toast-bus'
import { setModuleLang, t } from '../src/renderer/i18n/locale'

function ctxWith(doc: unknown) {
  const setStatus = vi.fn()
  const setShowPrintDialog = vi.fn()
  const setShowPagePreview = vi.fn()
  const ctx = {
    doc,
    setStatus,
    setShowPrintDialog,
    setShowPagePreview,
    printAutoOpenedPreviewRef: { current: false },
  } as unknown as FileActionContext
  return { ctx, setStatus, setShowPrintDialog, setShowPagePreview }
}

afterEach(() => {
  document.body.innerHTML = ''
  setModuleLang('en')
  setToastEmitter(null)
  vi.unstubAllGlobals()
})

describe('printDoc with no document', () => {
  it.each([
    ['en', 'Open a document to print it.'],
    ['vi', 'Hãy mở một tài liệu để in.'],
  ] as const)('says what to do (%s) and opens no dialog', (lang, text) => {
    setModuleLang(lang)
    const { ctx, setStatus, setShowPrintDialog, setShowPagePreview } = ctxWith(null)
    printDoc(ctx)
    expect(setStatus).toHaveBeenCalledExactlyOnceWith(text)
    expect(t('appPrintNoDocument')).toBe(text)
    expect(setShowPrintDialog).not.toHaveBeenCalled()
    expect(setShowPagePreview).not.toHaveBeenCalled()
  })
})

// UNI-1931 (FE1-3): a phone-width frame shows the message as a toast. A repeat sets the identical
// status (React bails out, App's status effect does not run), so printDoc toasts it itself.
describe('printDoc with no document at phone width', () => {
  it('toasts on every press, and the status toast does not double a press', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const seen: ToastData[] = []
    setToastEmitter((toast) => seen.push(toast))
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { ctx, setStatus } = ctxWith(null)
    // App's status effect runs after the render that followed the first press, i.e. after printDoc
    let pending: unknown = null
    setStatus.mockImplementation((line) => (pending = line))
    printDoc(ctx)
    toastStatusLine(pending as string, t)
    expect(seen).toEqual([{ text: 'Open a document to print it.', kind: 'info' }])
    // second press: same status string, no effect run, still a toast
    setStatus.mockImplementation(() => {})
    vi.advanceTimersByTime(1000)
    printDoc(ctx)
    expect(seen).toHaveLength(2)
    vi.useRealTimers()
  })

  it('does not toast on a wide frame (the status bar shows the message)', () => {
    const seen: ToastData[] = []
    setToastEmitter((toast) => seen.push(toast))
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const { ctx, setStatus } = ctxWith(null)
    printDoc(ctx)
    expect(setStatus).toHaveBeenCalledOnce()
    expect(seen).toEqual([])
  })
})

// UNI-1931 (V1-1): the web open-refused screen hides the status bar message at every width, so the
// wide frame has nowhere to show the no-document print message: printDoc toasts it there too.
describe('printDoc with no document on the open-refused screen', () => {
  const refused = { refusedMessage: 'Open refused' }

  it('toasts on a wide frame, once per press', () => {
    const seen: ToastData[] = []
    setToastEmitter((toast) => seen.push(toast))
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const { ctx } = ctxWith(null)
    Object.assign(ctx, refused)
    printDoc(ctx)
    expect(seen).toEqual([{ text: 'Open a document to print it.', kind: 'info' }])
    printDoc(ctx)
    expect(seen).toHaveLength(2)
  })

  it('does not double the toast at phone width', () => {
    const seen: ToastData[] = []
    setToastEmitter((toast) => seen.push(toast))
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { ctx, setStatus } = ctxWith(null)
    Object.assign(ctx, refused)
    let pending: unknown = null
    setStatus.mockImplementation((line) => (pending = line))
    printDoc(ctx)
    toastStatusLine(pending as string, t)
    expect(seen).toEqual([{ text: 'Open a document to print it.', kind: 'info' }])
  })
})

describe('printDoc with a document', () => {
  it('opens the print dialog and sets no message', () => {
    setModuleLang('en')
    const { ctx, setStatus, setShowPrintDialog } = ctxWith({ fileName: 'a.docx' })
    // the pagination preview is already mounted: nothing to auto-open
    document.body.innerHTML = '<div class="pagination-preview"></div>'
    printDoc(ctx)
    expect(setShowPrintDialog).toHaveBeenCalledExactlyOnceWith(true)
    expect(setStatus).not.toHaveBeenCalled()
  })
})
