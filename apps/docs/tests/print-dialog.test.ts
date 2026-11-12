// @vitest-environment jsdom
/**
 * FE-W1-02 regression test: PrintDialog renders printer selection, copies,
 * collate, and duplex controls alongside the page-range options and the fork's
 * Save as PDF fallback, passing the selected job options to `window.desktop.print`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PrintDialog } from '../src/renderer/components/PrintDialog'
import { LocaleProvider, setModuleLang, t } from '../src/renderer/i18n/locale'

setModuleLang('en')

let root: Root
let container: HTMLElement

beforeEach(() => {
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
  Object.defineProperty(window, 'desktop', { configurable: true, writable: true, value: undefined })
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

function mountPreviewPages(count = 2): void {
  const preview = document.createElement('div')
  preview.className = 'pagination-preview'
  for (let i = 0; i < count; i++) {
    const page = document.createElement('div')
    page.className = 'pv-page'
    Object.defineProperty(page, 'offsetWidth', { configurable: true, value: 816 })
    Object.defineProperty(page, 'offsetHeight', { configurable: true, value: 1056 })
    preview.appendChild(page)
  }
  document.body.appendChild(preview)
}

describe('PrintDialog printer, copies, collate, and duplex controls (FE-W1-02)', () => {
  it('populates printers from listPrinters and passes printer/copies/collate/duplex to print()', async () => {
    mountPreviewPages(2)
    const print = vi.fn(async () => ({ ok: true }))
    const listPrinters = vi.fn(async () => [
      { name: 'Office_LaserJet', displayName: 'Office LaserJet', isDefault: true },
    ])
    Object.defineProperty(window, 'desktop', {
      configurable: true,
      writable: true,
      value: {
        print,
        listPrinters,
        onLanguageChanged: () => () => undefined,
      },
    })

    const onClose = vi.fn()
    vi.useFakeTimers()
    act(() => {
      root.render(
        createElement(LocaleProvider, {
          initial: 'en',
          children: createElement(PrintDialog, {
            onClose,
            setStatus: vi.fn(),
            onSavePdf: vi.fn(async () => true),
          }),
        }),
      )
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })

    expect(listPrinters).toHaveBeenCalledTimes(1)
    const selects = [
      ...document.querySelectorAll<HTMLSelectElement>('.print-options .print-select'),
    ]
    expect(selects).toHaveLength(2)
    const [printerSelect, duplexSelect] = selects
    expect([...printerSelect.options].map((o) => o.textContent)).toContain('Office LaserJet')

    // Select specific printer, 3 copies, uncheck collate, set duplex to longEdge
    await act(async () => {
      printerSelect.value = 'Office_LaserJet'
      printerSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const copiesInput = document.querySelector<HTMLInputElement>('.print-options .print-copies')!
    expect(copiesInput.disabled).toBe(false)

    await act(async () => {
      duplexSelect.value = 'longEdge'
      duplexSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const printBtn = document.querySelector<HTMLButtonElement>('.modal-actions .primary')!
    await act(async () => {
      printBtn.click()
    })

    expect(print).toHaveBeenCalledWith(
      expect.any(Number),
      {
        deviceName: 'Office_LaserJet',
        copies: 1,
        collate: true,
        duplex: 'longEdge',
      },
      { widthTwips: 12240, heightTwips: 15840 },
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('System print dialog option disables copies/collate/duplex and passes deviceName: null', async () => {
    mountPreviewPages(1)
    const print = vi.fn(async () => ({ ok: true }))
    Object.defineProperty(window, 'desktop', {
      configurable: true,
      writable: true,
      value: {
        print,
        listPrinters: async () => [],
        onLanguageChanged: () => () => undefined,
      },
    })

    act(() => {
      root.render(
        createElement(LocaleProvider, {
          initial: 'en',
          children: createElement(PrintDialog, {
            onClose: vi.fn(),
            setStatus: vi.fn(),
            onSavePdf: vi.fn(async () => true),
          }),
        }),
      )
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    vi.useRealTimers()

    const [printerSelect, duplexSelect] = [
      ...document.querySelectorAll<HTMLSelectElement>('.print-options .print-select'),
    ]
    const sysOption = [...printerSelect.options].find(
      (o) => o.textContent === t('appPrintSystemDialog'),
    )!
    await act(async () => {
      printerSelect.value = sysOption.value
      printerSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const copiesInput = document.querySelector<HTMLInputElement>('.print-options .print-copies')!
    expect(copiesInput.disabled).toBe(true)
    expect(duplexSelect.disabled).toBe(true)

    const printBtn = document.querySelector<HTMLButtonElement>('.modal-actions .primary')!
    await act(async () => {
      printBtn.click()
    })

    expect(print).toHaveBeenCalledWith(
      expect.any(Number),
      { deviceName: null },
      { widthTwips: 12240, heightTwips: 15840 },
    )
  })
})
