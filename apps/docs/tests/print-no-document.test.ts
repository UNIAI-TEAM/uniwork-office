// UNI-1931 (RFF-2): Ctrl/Cmd+P (and File > Print) with no document open used to do nothing and say
// nothing. printDoc now answers with the "open a document" status line; with a document it opens the
// print dialog and sets no message.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { printDoc, type FileActionContext } from '../src/renderer/file-actions'
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
