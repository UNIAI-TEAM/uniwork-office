/**
 * The real renderer App on a view-only UniWork copy: the renderer leaves every
 * save to main, so an agent saving the document to another path still works.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../src/renderer/App'
import { LocaleProvider } from '../src/renderer/i18n/locale'

vi.mock('../src/renderer/ai/AiPanel', () => ({
  GensparkMark: () => null,
  AiPanel: () => null,
}))

const PATH = 'C:/u/uniwork-documents/dep/user/doc1/page.html'
const RAW = '<!doctype html><html><head><title>t</title></head><body><p>Hello</p></body></html>'

/** how the browser harness may differ from the desktop preload */
type StateApi = { bound: boolean; readOnly: boolean } | 'missing' | 'rejects'

async function mount(uniwork: StateApi) {
  const handlers: Record<string, (...args: never[]) => void> = {}
  const stubs: Record<string, ReturnType<typeof vi.fn>> = {
    consumePending: vi.fn(async () => PATH),
    getPreviewInfo: vi.fn(async () => ({ url: 'about:blank' })),
    readFile: vi.fn(async () => RAW),
    uniworkState: vi.fn(async () => {
      if (uniwork === 'rejects') throw new Error('no handler')
      return uniwork as { bound: boolean; readOnly: boolean }
    }),
    save: vi.fn(async () => ({ ok: true, canceled: true })),
  }
  const api = new Proxy(stubs, {
    get(target, prop: string) {
      // the browser harness mocks the API without the method
      if (prop === 'uniworkState' && uniwork === 'missing') return undefined
      // web-frame-only members (capabilities, draft recovery, text provider) are absent on the desktop preload
      if (prop === 'capabilities' || prop === 'consumeRecovered' || prop === 'provideText')
        return undefined
      if (prop in target) return target[prop]
      if (/^on[A-Z]/.test(prop)) {
        target[prop] = vi.fn((cb: (...args: never[]) => void) => {
          handlers[prop] = cb
          return () => {}
        })
      } else {
        target[prop] = vi.fn(async () => undefined)
      }
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
  return {
    container,
    api: stubs,
    saveRequest: () => handlers.onSaveRequest as unknown as (mode: string) => void,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

const open: Array<{ unmount: () => void }> = []
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
afterEach(() => {
  open.splice(0).forEach((h) => h.unmount())
  vi.unstubAllGlobals()
})

describe('html App on a view-only UniWork copy', () => {
  it.each(['missing', 'rejects'] as const)(
    'still renders and saves as a plain local file when the UniWork state query is %s',
    async (kind) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const h = await mount(kind)
      open.push(h)
      expect(h.container.childElementCount).toBeGreaterThan(0)
      await act(async () => {
        h.saveRequest()('save')
        await new Promise((r) => setTimeout(r, 20))
      })
      expect(h.api.save).toHaveBeenCalledTimes(1)
    },
  )

  it('hands a save request to main instead of refusing it in the renderer', async () => {
    const h = await mount({ bound: true, readOnly: true })
    open.push(h)
    await act(async () => {
      h.saveRequest()('save')
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(h.api.save).toHaveBeenCalledTimes(1)
  })
})
