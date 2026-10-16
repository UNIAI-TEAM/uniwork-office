/**
 * G6-09 RBG-HTML-5: the AI run's no-write guarantee through the real App. The panel is stubbed and
 * hands back the deps the App gives it; a run is driven the way the panel drives it (the document
 * changes, then onRunDone), and nothing may reach htmlApi.save until the user's click on the
 * offer (onSaveOffer).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../src/renderer/App'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import type { HtmlAiDeps } from '../src/renderer/ai/AiPanel'

const panel = vi.hoisted(() => ({ deps: null as unknown }))
vi.mock('../src/renderer/ai/AiPanel', () => ({
  AiPanel: (props: { deps: unknown }) => {
    panel.deps = props.deps
    return null
  },
}))

const PATH = '/home/u/docs/titled.html'
const TITLED =
  '<!doctype html><html><head><title>Titled page</title></head><body><p>x</p></body></html>'
const GENERATED =
  '<!doctype html><html><head></head><body><h1>Quarterly report</h1><p>Numbers.</p></body></html>'

async function mount(pending: string | null) {
  const stubs: Record<string, ReturnType<typeof vi.fn>> = {
    consumePending: vi.fn(async () => pending),
    getPreviewInfo: vi.fn(async () => ({ url: 'about:blank' })),
    readFile: vi.fn(async () => TITLED),
    uniworkState: vi.fn(async () => ({ bound: false, readOnly: false })),
    save: vi.fn(async () => ({ ok: true, canceled: true })),
    setProvisionalTitle: vi.fn(),
  }
  const api = new Proxy(stubs, {
    get(target, prop: string) {
      if (prop === 'capabilities' || prop === 'consumeRecovered' || prop === 'provideText')
        return undefined
      if (prop in target) return target[prop]
      target[prop] = /^on[A-Z]/.test(prop) ? vi.fn(() => () => {}) : vi.fn(async () => undefined)
      return target[prop]
    },
  })
  ;(window as unknown as { htmlApi: unknown }).htmlApi = api
  panel.deps = null
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
  // the deps object is rebuilt on every render: always read the latest
  return { api: stubs, deps: () => panel.deps as HtmlAiDeps }
}

const cleanups: Array<() => void> = []
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
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
})

async function settle() {
  await act(async () => await new Promise((r) => setTimeout(r, 30)))
}

describe('AI run on a never-saved page, through the real App', () => {
  it('offers the page name and writes nothing until the offer is clicked', async () => {
    const h = await mount(null)
    expect(h.deps()).toBeTruthy()

    // the run changes the blank document
    await act(async () => h.deps().access.replaceAll(GENERATED))
    await settle()
    let offer: string | null = null
    await act(async () => {
      offer = h.deps().onRunDone(true)
    })
    await settle()

    expect(offer).toBe('Quarterly report')
    expect(h.api.save).not.toHaveBeenCalled()
    expect(h.api.setProvisionalTitle).toHaveBeenCalledWith('Quarterly report')

    // the click on the offer card: the normal first-save flow, pre-filled with that name
    await act(async () => h.deps().onSaveOffer('Quarterly report'))
    await settle()
    expect(h.api.save).toHaveBeenCalledTimes(1)
    expect(h.api.save.mock.calls[0]![0]).toMatchObject({
      mode: 'save',
      suggestedName: 'Quarterly report',
    })
  })

  it('a run that changed nothing offers nothing and writes nothing', async () => {
    const h = await mount(null)
    await act(async () => h.deps().access.replaceAll(GENERATED))
    await settle()
    let offer: string | null = 'unset'
    await act(async () => {
      offer = h.deps().onRunDone(false)
    })
    await settle()
    expect(offer).toBeNull()
    expect(h.api.save).not.toHaveBeenCalled()
  })

  it('a titled page offers nothing after a run: the edit stays in the open document, unsaved', async () => {
    const h = await mount(PATH)
    await act(async () => h.deps().access.replaceAll(GENERATED))
    await settle()
    let offer: string | null = 'unset'
    await act(async () => {
      offer = h.deps().onRunDone(true)
    })
    await settle()
    expect(offer).toBeNull()
    expect(h.api.save).not.toHaveBeenCalled()
    expect(h.api.setProvisionalTitle).not.toHaveBeenCalled()
  })
})
