/**
 * UNI-1876 RFW2-1: the UniWork host grants Markdown `print` without `exportPdf`. The host Print flow
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

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
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
  const exportPdf = vi.fn(async () => ({ ok: true, path: 'notes.pdf' }))
  const stubs: Record<string, ReturnType<typeof vi.fn>> = {
    consumePending: vi.fn(async () => '/u/notes.md'),
    readFile: vi.fn(async () => '# Notes\n\nHello world\n'),
    uniworkState: vi.fn(async () => ({ bound: false, readOnly: false })),
    exportPdf,
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
  ;(window as unknown as { markdownApi: unknown }).markdownApi = api
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
  return { exportPdf, request: (format: string) => exportRequest!(format) }
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
