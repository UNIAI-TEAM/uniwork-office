/**
 * G6-09 RBG-HTML-3: the desktop preview now blocks fetch/XHR, nested frames, forms and workers
 * (html-preview:// policy), so a page that uses them shows the same one-line note the web preview
 * shows, in wording that is true on the desktop (no "web preview", nothing to "open in the app").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../src/renderer/App'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { resetForTest } from '../src/renderer/capabilities'
import { appStrings } from '../src/renderer/i18n/strings-app'

vi.mock('../src/renderer/ai/AiPanel', () => ({ AiPanel: () => null }))

const PATH = '/home/u/docs/gallery.html'
const page = (body: string) =>
  `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`
const FETCHING = page('<ul id="list"></ul><script>fetch("/photos.json").then(() => {})</script>')
const EMBEDDING = page('<iframe src="https://example.test/map"></iframe>')
const PLAIN = page('<p>Hello</p>')

const DESKTOP_NOTE =
  'This page asks the network for data or embeds other pages, which the preview blocks.'

async function mount(raw: string, capabilities?: Record<string, unknown>) {
  const stubs: Record<string, ReturnType<typeof vi.fn>> = {
    consumePending: vi.fn(async () => PATH),
    getPreviewInfo: vi.fn(async () => ({ url: 'about:blank' })),
    readFile: vi.fn(async () => raw),
    uniworkState: vi.fn(async () => ({ bound: false, readOnly: false })),
  }
  const api = new Proxy(stubs, {
    get(target, prop: string) {
      if (prop === 'capabilities') return capabilities
      if (prop === 'consumeRecovered' || prop === 'provideText') return undefined
      if (prop in target) return target[prop]
      target[prop] = /^on[A-Z]/.test(prop) ? vi.fn(() => () => {}) : vi.fn(async () => undefined)
      return target[prop]
    },
  })
  ;(window as unknown as { htmlApi: unknown }).htmlApi = api
  resetForTest()
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
  return container
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
  resetForTest()
})

describe('html App, desktop (no capabilities object): the preview blocked-features note', () => {
  it.each([
    ['a fetch() call', FETCHING],
    ['a nested iframe', EMBEDDING],
  ])(
    'shows the note for a page with %s, in desktop wording and with no app-switch action',
    async (_n, raw) => {
      const container = await mount(raw)
      const note = container.querySelector('.preview-limit-note')
      expect(note, 'the note is rendered on the desktop').toBeTruthy()
      expect(note!.getAttribute('role')).toBe('note')
      expect(note!.textContent).toBe(DESKTOP_NOTE)
      expect(note!.textContent).not.toMatch(/web/i)
      expect(note!.querySelector('button')).toBeNull()
    },
  )

  it('shows nothing for a page that uses none of the blocked features', async () => {
    const container = await mount(PLAIN)
    expect(container.querySelector('.preview-limit-note')).toBeNull()
  })
})

describe('html App, web frame: the note keeps its web wording and the open-in-app action', () => {
  it('says the web preview blocks it and offers Open in app while the host grants it', async () => {
    const container = await mount(FETCHING, {
      platform: 'web',
      htmlPreviewNetwork: false,
      desktopOpen: true,
    })
    const note = container.querySelector('.preview-limit-note')
    expect(note).toBeTruthy()
    expect(note!.textContent).toContain('which the web preview blocks.')
    expect(note!.textContent).toContain('Open in the UniWork Office app to use this feature')
    expect(note!.querySelector('button')?.textContent).toBe('Open in app')
  })
})

describe('previewLimitNoteApp string', () => {
  it('exists in every locale and never names the web preview', () => {
    const dicts = appStrings as unknown as Record<string, Record<string, string>>
    expect(Object.keys(dicts).length).toBeGreaterThanOrEqual(20)
    expect(dicts.en.previewLimitNoteApp).toBe(DESKTOP_NOTE)
    for (const [lang, dict] of Object.entries(dicts)) {
      expect(dict.previewLimitNoteApp, lang).toBeTruthy()
      expect(dict.previewLimitNoteApp, lang).not.toBe(dict.previewLimitNote)
    }
  })
})
