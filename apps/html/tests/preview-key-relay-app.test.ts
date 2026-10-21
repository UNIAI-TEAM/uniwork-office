// UNI-2011 fix-win1-r2 (L6, M2): the real html App's `gx:keyEvent` case. A key pressed inside the
// Preview frame is replayed on the window only while the frame holds the host's focus, and a forged
// message cannot repeat a command faster than a person can press it. Removing the case fails here.
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
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
  const zeroRects = () => [] as unknown as DOMRectList
  Range.prototype.getClientRects ||= zeroRects
  Range.prototype.getBoundingClientRect ||= () => new DOMRect()
  Element.prototype.getClientRects ||= zeroRects
})
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resetForTest()
})

async function mountApp() {
  resetForTest()
  let previewMessage: ((data: unknown) => void) | undefined
  const stubs: Record<string, (...args: unknown[]) => unknown> = {
    consumePending: vi.fn(async () => '/u/page.html'),
    getPreviewInfo: vi.fn(async () => ({ url: 'about:blank' })),
    readFile: vi.fn(async () => RAW),
    uniworkState: vi.fn(async () => ({ bound: false, readOnly: false })),
    connectPreview: vi.fn((_win: unknown, handlers: { onMessage: (data: unknown) => void }) => {
      previewMessage = handlers.onMessage
      return { post: () => {}, close: () => {} }
    }),
  }
  const api = new Proxy(stubs, {
    get(target, prop: string) {
      if (prop === 'capabilities') return { platform: 'web', htmlPreviewScripts: true }
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
  const frame = container.querySelector<HTMLIFrameElement>('iframe.preview-frame')!
  await act(async () => {
    frame.dispatchEvent(new Event('load'))
  })
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  const seen: KeyboardEvent[] = []
  const onKey = (e: KeyboardEvent) => void seen.push(e)
  window.addEventListener('keydown', onKey)
  cleanups.push(() => window.removeEventListener('keydown', onKey))
  const key = (init: Record<string, unknown>) =>
    act(async () => {
      previewMessage!({
        type: 'gx:keyEvent',
        version: 0,
        key: '',
        code: '',
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        altGraph: false,
        repeat: false,
        composing: false,
        ...init,
      })
    })
  return { frame, seen, key }
}

const CTRL_F = { key: 'f', code: 'KeyF', ctrlKey: true }

describe('the App replays a key relayed from the Preview frame', () => {
  it('replays a table key on the window while the frame holds the focus', async () => {
    const { frame, seen, key } = await mountApp()
    frame.focus()
    expect(document.activeElement).toBe(frame)
    await key(CTRL_F)
    expect(seen.map((e) => [e.key, e.ctrlKey])).toEqual([['f', true]])
  })

  it('drops it when the frame does not hold the focus (a page forged the message)', async () => {
    const { seen, key } = await mountApp()
    expect(document.activeElement).not.toBeInstanceOf(HTMLIFrameElement)
    await key(CTRL_F)
    await key({ key: 'F1', code: 'F1', ctrlKey: true })
    expect(seen).toEqual([])
  })

  it('replays a forged key once, not once per message', async () => {
    const { frame, seen, key } = await mountApp()
    frame.focus()
    await key(CTRL_F)
    await key(CTRL_F)
    await key(CTRL_F)
    expect(seen).toHaveLength(1)
  })

  it('ignores a key that is not an app command, and one the frame already owns', async () => {
    const { frame, seen, key } = await mountApp()
    frame.focus()
    await key({ key: 'a', code: 'KeyA' })
    await key({ key: 'b', code: 'KeyB', ctrlKey: true })
    expect(seen).toEqual([])
  })
})
