/**
 * Web frame without the host's `save` grant: the document is view-only, and the host (banner + live
 * region) is the one place that says so. The frame footer must not add a third "View only" copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../src/renderer/App'
import { resetForTest } from '../src/renderer/capabilities'
import { LocaleProvider } from '../src/renderer/i18n/locale'

vi.mock('../src/renderer/ai/AiPanel', () => ({
  GensparkMark: () => null,
  AiPanel: () => null,
}))

const PATH = 'C:/u/uniwork-documents/dep/user/doc1/notes.md'
const RAW = '---\ntitle: Quarterly\n---\n\nHello world\n'

interface Harness {
  container: HTMLElement
  api: Record<string, ReturnType<typeof vi.fn>>
  saveRequest: () => (mode: string) => void
  unmount: () => void
}

/** how the browser harness may differ from the desktop preload */
type StateApi = { bound: boolean; readOnly: boolean } | 'missing' | 'rejects'

async function mount(uniwork: StateApi, caps?: Record<string, boolean>): Promise<Harness> {
  resetForTest()
  const handlers: Record<string, (...args: never[]) => void> = {}
  const stubs: Record<string, ReturnType<typeof vi.fn>> = {
    consumePending: vi.fn(async () => PATH),
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
      if (prop === 'capabilities') return caps
      if (prop === 'consumeRecovered' || prop === 'provideText') return undefined
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
  vi.stubGlobal('markdownApi', api)
  ;(window as unknown as { markdownApi: unknown }).markdownApi = api
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(App)))
  })
  // let the open sequence (pending path, file read, state query) settle
  for (let i = 0; i < 20; i++) await act(async () => await new Promise((r) => setTimeout(r, 10)))
  return {
    container,
    api: stubs,
    saveRequest: () => handlers.onSaveRequest as never,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

const open: Harness[] = []
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const zeroRects = () => [] as unknown as DOMRectList
  Range.prototype.getClientRects ||= zeroRects
  Range.prototype.getBoundingClientRect ||= () => new DOMRect()
  Element.prototype.getClientRects ||= zeroRects
})
afterEach(() => {
  open.splice(0).forEach((h) => h.unmount())
  vi.unstubAllGlobals()
  resetForTest()
})

describe('markdown footer on a view-only web document', () => {
  it('has no "View only" chip of its own (the host announces it)', async () => {
    const h = await mount({ bound: false, readOnly: false }, { save: false })
    open.push(h)
    // the editor opened (file name in the footer) and is view-only (the grant is off)
    expect(h.container.querySelector('.status-file')).not.toBeNull()
    expect(h.container.querySelector('.status-view-only')).toBeNull()
    expect(h.container.querySelector('.status-bar')!.textContent).not.toMatch(/view only|chỉ xem/i)
  })
})
