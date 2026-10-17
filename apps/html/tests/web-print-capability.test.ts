/**
 * UNI-1876 RFW2-1: the UniWork host grants HTML `print` without `exportPdf`. The host Print flow
 * reaches the renderer as an `onExportRequest('pdf')`, so the renderer's PDF render must run on
 * `print` alone; a plain Export PDF stays an `exportPdf` grant (the bridge refuses it there).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../src/renderer/App'
import { resetForTest } from '../src/renderer/capabilities'
import { LocaleProvider } from '../src/renderer/i18n/locale'

vi.mock('../src/renderer/ai/AiPanel', () => ({
  AiPanel: () => null,
}))

const RAW = '<!doctype html><html><head><title>t</title></head><body><p>Hello</p></body></html>'

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  const zeroRects = () => [] as unknown as DOMRectList
  Range.prototype.getClientRects ||= zeroRects
  Range.prototype.getBoundingClientRect ||= () => new DOMRect()
  Element.prototype.getClientRects ||= zeroRects
})
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
  resetForTest()
})

async function mountApp(caps: Record<string, unknown>) {
  resetForTest()
  let exportRequest: ((format: string) => void) | undefined
  const exportPdf = vi.fn(async () => ({ ok: true, path: 'page.pdf' }))
  let previewMessage: ((data: unknown) => void) | undefined
  const stubs: Record<string, (...args: unknown[]) => unknown> = {
    consumePending: vi.fn(async () => '/u/page.html'),
    getPreviewInfo: vi.fn(async () => ({ url: 'about:blank' })),
    readFile: vi.fn(async () => RAW),
    uniworkState: vi.fn(async () => ({ bound: false, readOnly: false })),
    exportPdf,
    connectPreview: vi.fn((_win: unknown, handlers: { onMessage: (data: unknown) => void }) => {
      previewMessage = handlers.onMessage
      return { post: () => {}, close: () => {} }
    }),
    onExportRequest: vi.fn((cb: (format: string) => void) => {
      exportRequest = cb
      return () => {}
    }),
  }
  const api = new Proxy(stubs, {
    get(target, prop: string) {
      if (prop === 'capabilities') return caps
      if (prop === 'consumeRecovered' || prop === 'provideText') return undefined
      if (prop in target) return target[prop]
      target[prop] = /^on[A-Z]/.test(prop) ? vi.fn(() => () => {}) : vi.fn(async () => undefined)
      return target[prop]
    },
  })
  ;(window as unknown as { htmlApi: unknown }).htmlApi = api
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(App)))
  })
  for (let i = 0; i < 20; i++) await act(async () => await new Promise((r) => setTimeout(r, 10)))
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  return {
    container,
    exportPdf,
    request: (format: string) => exportRequest!(format),
    sendPreview: (data: unknown) => previewMessage?.(data),
  }
}

describe('host Print without an exportPdf grant', () => {
  it('print granted, exportPdf withheld: the PDF render behind Print still runs', async () => {
    const { exportPdf, request } = await mountApp({
      platform: 'web',
      print: true,
      exportPdf: false,
    })
    await act(async () => request('pdf'))
    await act(async () => await new Promise((r) => setTimeout(r, 50)))
    expect(exportPdf).toHaveBeenCalledTimes(1)
  })

  it('neither print nor exportPdf granted: no PDF render', async () => {
    const { exportPdf, request } = await mountApp({
      platform: 'web',
      print: false,
      exportPdf: false,
    })
    await act(async () => request('pdf'))
    await act(async () => await new Promise((r) => setTimeout(r, 50)))
    expect(exportPdf).not.toHaveBeenCalled()
  })
})

describe('preview iframe Escape relay (UNI-1876 SVF-5)', () => {
  it('dispatches a cancelable window Escape keydown when gx:keyCommand escape arrives with no selected element', async () => {
    const { container, sendPreview } = await mountApp({
      platform: 'web',
      htmlPreviewScripts: true,
    })
    const frame = container.querySelector('iframe.preview-frame')!
    await act(async () => {
      frame.dispatchEvent(new Event('load'))
    })
    const seen: KeyboardEvent[] = []
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') seen.push(e)
    }
    window.addEventListener('keydown', onKey)
    cleanups.push(() => window.removeEventListener('keydown', onKey))

    await act(async () => {
      sendPreview({ type: 'gx:keyCommand', command: 'escape', version: 0 })
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.defaultPrevented).toBe(false)
  })
})
