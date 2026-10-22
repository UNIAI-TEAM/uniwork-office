// UNI-2117: a Delete pressed in the preview right after a click used to be dropped. The frame only
// posted `gx:keyCommand delete`; the host acted on `selectedSidRef`, which is assigned during the
// render that follows the `gx:select` handler, so a Delete landing first saw no selection. The frame
// now names the sid it acted on and the host uses it (when it still exists), else the ref.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import App from '../src/renderer/App'
import { buildParseMap } from '../src/renderer/document/parse-map'
import { resetForTest } from '../src/renderer/capabilities'
import { LocaleProvider } from '../src/renderer/i18n/locale'

vi.mock('../src/renderer/ai/AiPanel', () => ({
  AiPanel: () => null,
}))

const RAW =
  '<!doctype html><html><head><title>t</title></head><body><p>Hello</p><p>World</p></body></html>'
const sidOfText = (word: string) =>
  buildParseMap(RAW, 0).elements.find((e) => e.tag === 'p' && RAW.slice(...e.range).includes(word))!
    .sid

const COMPUTED = {
  color: '#000000',
  fontSize: '16',
  fontWeight: '400',
  fontStyle: 'normal',
  textAlign: 'start',
  background: '',
  backgroundImage: 'none',
  width: '100',
  height: '20',
  borderRadius: '0',
  padding: '0',
  opacity: '1',
  transform: '',
  marginLeft: '',
  marginRight: '',
  objectFit: 'fill',
}

const store = new Map<string, string>()
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  })
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
  const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!
  const send = (data: Record<string, unknown>) =>
    act(async () => {
      previewMessage!({ version: 0, ...data })
    })
  const select = (sid: number) =>
    send({
      type: 'gx:select',
      dynamic: false,
      element: {
        sid,
        tag: 'p',
        className: '',
        text: sid === sidOfText('Hello') ? 'Hello' : 'World',
        childElementCount: 0,
        rect: { x: 0, y: 0, width: 10, height: 10 },
        computed: COMPUTED,
        textRun: null,
        textRunIndex: -1,
        inlineEditable: false,
      },
    })
  return { text: () => view.state.doc.toString(), send, select }
}

describe('the host acts on the sid a frame key command carries (UNI-2117)', () => {
  it('deletes the element named by the message although the host selection is still null', async () => {
    const { text, send } = await mountApp()
    expect(text()).toContain('Hello')
    await send({ type: 'gx:keyCommand', command: 'delete', sid: sidOfText('Hello') })
    expect(text()).not.toContain('Hello')
    expect(text()).toContain('World')
  })

  it('moves the element named by the message although the host selection is still null', async () => {
    const { text, send } = await mountApp()
    await send({ type: 'gx:keyCommand', command: 'moveDown', sid: sidOfText('Hello') })
    expect(text().indexOf('World')).toBeLessThan(text().indexOf('Hello'))
  })

  it('prefers the message sid over a different host selection', async () => {
    const { text, send, select } = await mountApp()
    await select(sidOfText('World'))
    await send({ type: 'gx:keyCommand', command: 'delete', sid: sidOfText('Hello') })
    expect(text()).not.toContain('Hello')
    expect(text()).toContain('World')
  })

  it('falls back to the host selection when the message has no sid (older frame)', async () => {
    const { text, send, select } = await mountApp()
    await select(sidOfText('Hello'))
    await send({ type: 'gx:keyCommand', command: 'delete' })
    expect(text()).not.toContain('Hello')
    expect(text()).toContain('World')
  })

  it('ignores a message sid that is not in the document, even with a host selection', async () => {
    const { text, send, select } = await mountApp()
    await select(sidOfText('Hello'))
    await send({ type: 'gx:keyCommand', command: 'delete', sid: 9999 })
    expect(text()).toContain('Hello')
    expect(text()).toContain('World')
  })
})

describe('the frame names the selected element in a key command (UNI-2117)', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const inspectorSrc = readFileSync(join(here, '../src/renderer/preview/inspector.js'), 'utf8')

  function makePreview() {
    const messages: Array<Record<string, unknown>> = []
    const hostMessages: Array<(e: { data: Record<string, unknown> }) => void> = []
    const dom = new JSDOM('<!doctype html><html><body><p data-gx-sid="1">Hello</p></body></html>', {
      runScripts: 'dangerously',
    })
    Object.assign(dom.window, {
      requestAnimationFrame: () => 0,
      __gxPreviewPort: {
        start: () => {},
        addEventListener: (type: string, fn: (e: { data: Record<string, unknown> }) => void) => {
          if (type === 'message') hostMessages.push(fn)
        },
        postMessage: (msg: Record<string, unknown>) => messages.push(msg),
      },
    })
    dom.window.Element.prototype.scrollIntoView = () => {}
    dom.window.eval(inspectorSrc.replace('__GX_VERSION__', '1'))
    messages.length = 0
    const press = (key: string, init: KeyboardEventInit = {}) =>
      dom.window.document.body.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
      )
    const send = (msg: Record<string, unknown>) => hostMessages.forEach((fn) => fn({ data: msg }))
    return { messages, press, send }
  }

  it('posts the selected sid with Delete', () => {
    const { messages, press, send } = makePreview()
    send({ type: 'gx:select', sid: 1 })
    messages.length = 0
    press('Delete')
    expect(messages).toEqual([{ type: 'gx:keyCommand', command: 'delete', sid: 1, version: 1 }])
  })

  it('posts no sid for a command that targets no element (Escape with nothing selected)', () => {
    const { messages, press } = makePreview()
    press('Escape')
    expect(messages).toEqual([{ type: 'gx:keyCommand', command: 'escape', version: 1 }])
  })
})
