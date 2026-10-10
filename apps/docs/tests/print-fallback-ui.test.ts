// DOCX → PDF without a printer, renderer side: the ribbon File menu offers Export as PDF and
// Print, and the print dialog turns "no printer" / a print failure into a message with a
// Save as PDF button instead of doing nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { computeFormatState } from '../src/renderer/components/ribbon-format-state'
import { Ribbon } from '../src/renderer/components/Ribbon'
import { PrintDialog } from '../src/renderer/components/PrintDialog'
import { LocaleProvider, setModuleLang, t } from '../src/renderer/i18n/locale'
import { resetCapabilitiesForTest } from '../src/renderer/capabilities'
import { ribbonProps } from './helpers/ribbon-props'

setModuleLang('en')

let root: Root
let container: HTMLElement

beforeEach(() => {
  Object.assign(window, { desktop: { onLanguageChanged: () => () => undefined } })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  Object.assign(window, { desktop: undefined })
  vi.unstubAllGlobals()
  resetCapabilitiesForTest()
  document.body.innerHTML = ''
})

const mount = (child: ReturnType<typeof createElement>) =>
  act(() => root.render(createElement(LocaleProvider, { initial: 'en', children: child })))

const buttonByText = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    (b.textContent ?? '').includes(text),
  )

describe('ribbon File menu', () => {
  let editor: Editor
  beforeEach(() => {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: {
        type: 'doc',
        content: [{ type: 'docParagraph', content: [{ type: 'text', text: 'hi' }] }],
      },
    })
  })
  afterEach(() => editor.destroy())

  it('lists Export as PDF and Print and wires them to the file actions', () => {
    const onExportPdf = vi.fn()
    const onPrint = vi.fn()
    mount(
      createElement(Ribbon, {
        ...ribbonProps(editor, computeFormatState(editor)),
        onExportPdf,
        onPrint,
      }),
    )
    act(() => buttonByText(t('ribbonTabFile'))!.click())
    act(() => buttonByText(t('appFileExportPdf'))!.click())
    expect(onExportPdf).toHaveBeenCalledTimes(1)
    act(() => buttonByText(t('ribbonTabFile'))!.click())
    act(() => buttonByText(t('appFilePrint'))!.click())
    expect(onPrint).toHaveBeenCalledTimes(1)
  })
})

describe('print dialog fallback', () => {
  /** the dialog prints the .pv-page sheets of the pagination preview */
  function mountPreviewPages(): void {
    const preview = document.createElement('div')
    preview.className = 'pagination-preview'
    const page = document.createElement('div')
    page.className = 'pv-page'
    preview.appendChild(page)
    document.body.appendChild(preview)
  }

  async function openDialog(
    print: () => Promise<unknown>,
    onSavePdf = vi.fn(async () => true),
    onClose = vi.fn(),
  ) {
    mountPreviewPages()
    Object.assign(window, { desktop: { print, onLanguageChanged: () => () => undefined } })
    vi.useFakeTimers()
    mount(createElement(PrintDialog, { onClose, setStatus: vi.fn(), onSavePdf }))
    // the dialog polls until the page count is stable
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    vi.useRealTimers()
    return { onSavePdf, onClose }
  }

  const clickPrint = async () => {
    const printBtn = document.querySelector<HTMLButtonElement>('.modal-actions .primary')!
    await act(async () => {
      printBtn.click()
    })
  }

  it('no printer: shows the message and a Save as PDF button that exports and closes', async () => {
    const { onSavePdf, onClose } = await openDialog(async () => ({ ok: false, noPrinter: true }))
    expect(document.querySelector('.print-problem')).toBeNull()
    await clickPrint()
    const problem = document.querySelector('.print-problem')!
    expect(problem.textContent).toContain(t('appPrintNoPrinter'))
    await act(async () => {
      buttonByText(t('appPrintSaveAsPdf'))!.click()
    })
    expect(onSavePdf).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a print failure also offers Save as PDF, and a cancelled export keeps the dialog open', async () => {
    const { onSavePdf, onClose } = await openDialog(
      async () => ({ ok: false, error: 'CUPS broke' }),
      vi.fn(async () => false),
    )
    await clickPrint()
    expect(document.querySelector('.print-problem')!.textContent).toContain('CUPS broke')
    await act(async () => {
      buttonByText(t('appPrintSaveAsPdf'))!.click()
    })
    expect(onSavePdf).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a cancelled system dialog shows no fallback', async () => {
    await openDialog(async () => ({ ok: false }))
    await clickPrint()
    expect(document.querySelector('.print-problem')).toBeNull()
  })
})
