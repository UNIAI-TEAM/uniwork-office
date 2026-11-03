// The AI wash in the html source pane outlives its run (G6-09, as in markdown): a hand edit and the
// end of the run keep it; a user Save clears it, an autosave does not. The next run clearing it lives
// in AiPanel's send path. The panel is stubbed and hands back the deps the App gives it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../src/renderer/App'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import type { HtmlAiDeps } from '../src/renderer/ai/AiPanel'
import { EditorView } from '@codemirror/view'
import { aiHighlightField } from '../src/renderer/source/cm-highlight'

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

function marks(): number {
  const dom = document.querySelector('.cm-editor')
  const view = dom ? EditorView.findFromDOM(dom as HTMLElement) : null
  expect(view).toBeTruthy()
  return view!.state.field(aiHighlightField).size
}

function view(): EditorView {
  return EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!
}

describe('the AI wash on an html page, through the real App', () => {
  it('stays through a hand edit and the end of the run, and goes with the user Save', async () => {
    const h = await mount(PATH)
    await act(async () => h.deps().access.replaceAll(GENERATED))
    await settle()
    expect(marks()).toBeGreaterThan(0)

    await act(async () => {
      view().dispatch({ changes: { from: 0, insert: ' ' }, userEvent: 'input.type' })
    })
    await settle()
    expect(marks()).toBeGreaterThan(0)

    await act(async () => {
      h.deps().onRunDone(true)
    })
    await settle()
    expect(marks()).toBeGreaterThan(0)

    h.api.save!.mockResolvedValue({ ok: true, path: PATH })
    const onSave = h.api.onSaveRequest!.mock.calls[0]![0] as (mode: string) => void
    await act(async () => onSave('save'))
    await settle()
    expect(h.api.save).toHaveBeenCalledTimes(1)
    expect(marks()).toBe(0)
  })
})
