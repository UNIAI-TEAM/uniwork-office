import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Lang } from '@genoffice/i18n'
import {
  ConvertProgressToast,
  usePdfConvertProgress,
  type PdfConvertProgressSeam,
} from '../src/renderer/convert-progress-toast'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import type { PdfConvertProgressEvent } from '../src/shared/ipc'

let root: Root | null = null
let container: HTMLDivElement | null = null
let langHandler: ((lang: Lang) => void) | null = null

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  langHandler = null
  Object.assign(window, {
    pdfApi: {
      onLanguageChanged: (cb: (lang: Lang) => void) => {
        langHandler = cb
        return () => {
          if (langHandler === cb) langHandler = null
        }
      },
    },
  })
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function Harness({ api }: { api?: PdfConvertProgressSeam | null }) {
  const { progress, cancel } = usePdfConvertProgress(api)
  return createElement(ConvertProgressToast, { progress, onCancel: cancel })
}

async function mount(api?: PdfConvertProgressSeam | null, initialLang: Lang = 'en') {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      createElement(LocaleProvider, {
        initial: initialLang,
        children: createElement(Harness, { api }),
      }),
    )
    await Promise.resolve()
  })
  return container
}

describe('PDF conversion progress toast (UNI-2167)', () => {
  it('shows Preparing… before page 1 or when total is 0, then per-page progress for Word, Excel, and PowerPoint', async () => {
    let listener: ((event: PdfConvertProgressEvent) => void) | null = null
    const off = vi.fn()
    const api: PdfConvertProgressSeam = {
      onConvertProgress: (cb) => {
        listener = cb
        return off
      },
      convertCancel: vi.fn().mockResolvedValue(undefined),
    }

    const host = await mount(api, 'en')
    expect(host.querySelector('[role="status"]')).toBeNull()

    await act(async () => {
      listener!({ format: 'docx', page: 0, total: 0 })
    })
    const toast = host.querySelector('.pdf-toast.pdf-toast-notice[role="status"]')
    expect(toast).not.toBeNull()
    expect(toast!.querySelector('span')!.textContent).toBe('Converting to Word… Preparing…')
    expect(toast!.querySelector('button')!.textContent).toBe('Cancel')

    await act(async () => {
      listener!({ format: 'docx', page: 2, total: 5 })
    })
    expect(host.querySelector('span')!.textContent).toBe('Converting to Word… page 2 / 5')

    await act(async () => {
      listener!({ format: 'xlsx', page: 0, total: 4 })
    })
    expect(host.querySelector('span')!.textContent).toBe('Converting to Excel… Preparing…')

    await act(async () => {
      listener!({ format: 'xlsx', page: 1, total: 4 })
    })
    expect(host.querySelector('span')!.textContent).toBe('Converting to Excel… page 1 / 4')

    await act(async () => {
      listener!({ format: 'pptx', page: 3, total: 0 })
    })
    expect(host.querySelector('span')!.textContent).toBe('Converting to PowerPoint… Preparing…')

    await act(async () => {
      listener!({ format: 'pptx', page: 3, total: 10 })
    })
    expect(host.querySelector('span')!.textContent).toBe('Converting to PowerPoint… page 3 / 10')

    await act(async () => {
      root!.unmount()
    })
    root = null
    expect(off).toHaveBeenCalledTimes(1)
  })

  it('calls convertCancel when Cancel is clicked, swallows errors, and closes on done: true', async () => {
    let listener: ((event: PdfConvertProgressEvent) => void) | null = null
    const convertCancel = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('cancel failed'))
    const api: PdfConvertProgressSeam = {
      onConvertProgress: (cb) => {
        listener = cb
        return () => {}
      },
      convertCancel,
    }

    const host = await mount(api, 'en')
    await act(async () => {
      listener!({ format: 'docx', page: 1, total: 3 })
    })
    const btn = host.querySelector<HTMLButtonElement>('button')
    expect(btn).not.toBeNull()

    await act(async () => {
      btn!.click()
      await Promise.resolve()
    })
    expect(convertCancel).toHaveBeenCalledTimes(1)

    // Clicking Cancel when convertCancel rejects must not throw or surface an error
    await act(async () => {
      btn!.click()
      await Promise.resolve()
    })
    expect(convertCancel).toHaveBeenCalledTimes(2)

    await act(async () => {
      listener!({ format: 'docx', page: 1, total: 3, done: true })
    })
    expect(host.querySelector('[role="status"]')).toBeNull()
  })

  it('renders no toast and does not throw when onConvertProgress / convertCancel are missing (web build)', async () => {
    const host = await mount({}, 'en')
    expect(host.querySelector('[role="status"]')).toBeNull()

    const hostNull = await mount(null, 'en')
    expect(hostNull.querySelector('[role="status"]')).toBeNull()
  })

  it('translates the toast and Cancel button in Vietnamese', async () => {
    let listener: ((event: PdfConvertProgressEvent) => void) | null = null
    const api: PdfConvertProgressSeam = {
      onConvertProgress: (cb) => {
        listener = cb
        return () => {}
      },
    }

    const host = await mount(api, 'vi')
    await act(async () => {
      listener!({ format: 'docx', page: 0, total: 0 })
    })
    expect(host.querySelector('span')!.textContent).toBe(
      'Đang chuyển đổi sang Word… Đang chuẩn bị…',
    )
    expect(host.querySelector('button')!.textContent).toBe('Hủy')

    await act(async () => {
      listener!({ format: 'docx', page: 2, total: 6 })
    })
    expect(host.querySelector('span')!.textContent).toBe('Đang chuyển đổi sang Word… trang 2 / 6')
  })

  it('wires ConvertProgressToast in App.tsx and suppresses overlapping ocrRun toast while converting', () => {
    const appSrc = readFileSync(join(__dirname, '../src/renderer/App.tsx'), 'utf8')
    expect(appSrc).toContain(
      '<ConvertProgressToast progress={convertProgress} onCancel={cancelConvert} />',
    )
    expect(appSrc).toContain('{ocrRun && !convertProgress && (')
  })
})
