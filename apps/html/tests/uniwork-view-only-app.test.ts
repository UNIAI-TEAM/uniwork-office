/**
 * EL-1(b) fix6 / VEL-1+VEL-2: the real html renderer App on a UniWork copy.
 * Follows the shell's `uniwork:doc-state-changed` ping (re-queries
 * uniworkState and flips read-only -> editable -> read-only), and on Ctrl+S or
 * File > Save while read-only AND bound calls `uniworkReadOnlySave` instead of
 * writing. Save As, autosave and unbound read-only files keep today's path.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../src/renderer/App'
import { LocaleProvider } from '../src/renderer/i18n/locale'

vi.mock('../src/renderer/ai/AiPanel', () => ({
  AiPanel: () => null,
}))

const PATH = 'C:/u/uniwork-documents/dep/user/doc1/page.html'
const OTHER = 'C:/u/uniwork-documents/dep/user/doc2/other.html'
const RAW = '<!doctype html><html><head><title>t</title></head><body><p>Hello</p></body></html>'

/** how the browser harness may differ from the desktop preload */
type StateApi = { bound: boolean; readOnly: boolean } | 'missing' | 'rejects'

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }
}

async function mount(initial: StateApi) {
  let current = initial
  let unsubscribes = 0
  const handlers: Record<string, (...args: never[]) => void> = {}
  const stubs: Record<string, Mock> = {
    consumePending: vi.fn(async () => PATH),
    getPreviewInfo: vi.fn(async () => ({ url: 'about:blank' })),
    readFile: vi.fn(async () => RAW),
    uniworkState: vi.fn(async () => {
      if (current === 'rejects') throw new Error('no handler')
      return current as { bound: boolean; readOnly: boolean }
    }),
    onUniworkStateChanged: vi.fn((cb: (path: string) => void) => {
      handlers.onUniworkStateChanged = cb as never
      return () => {
        unsubscribes += 1
      }
    }),
    uniworkReadOnlySave: vi.fn(async () => undefined),
    save: vi.fn(async () => ({ ok: true, canceled: true })),
  }
  const api = new Proxy(stubs, {
    get(target, prop: string) {
      // the browser harness mocks the API without the method
      if (prop === 'uniworkState' && current === 'missing') return undefined
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
  Object.assign(window, { htmlApi: api })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(App)))
  })
  await settle()
  return {
    container,
    api: stubs,
    setAnswer: (next: { bound: boolean; readOnly: boolean }) => {
      current = next
    },
    ping: async (p: string) => {
      const cb = handlers.onUniworkStateChanged as ((path: string) => void) | undefined
      cb?.(p)
      await settle()
    },
    saveRequest: () => handlers.onSaveRequest as unknown as (mode: string) => void,
    unsubscribes: () => unsubscribes,
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
      h.saveRequest()('save')
      await settle()
      expect(h.api.save).toHaveBeenCalledTimes(1)
    },
  )

  it('explains on Ctrl+S and File > Save instead of saving while read-only and bound; Save As still saves', async () => {
    const h = await mount({ bound: true, readOnly: true })
    open.push(h)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    })
    await settle()
    expect(h.api.uniworkReadOnlySave).toHaveBeenCalledTimes(1)
    expect(h.api.save).not.toHaveBeenCalled()

    h.saveRequest()('save')
    await settle()
    expect(h.api.uniworkReadOnlySave).toHaveBeenCalledTimes(2)
    expect(h.api.save).not.toHaveBeenCalled()

    h.saveRequest()('saveAs')
    await settle()
    expect(h.api.save).toHaveBeenCalledTimes(1)
    expect(h.api.uniworkReadOnlySave).toHaveBeenCalledTimes(2)
  })

  it('flips read-only -> editable -> read-only on the lock ping and gates Save / explain accordingly', async () => {
    const h = await mount({ bound: true, readOnly: true })
    open.push(h)
    const saveBtn = () =>
      h.container.querySelector<HTMLButtonElement>('.ribbon-tabs > button.qa-btn')!
    expect(saveBtn().disabled).toBe(true)
    expect(h.api.uniworkState).toHaveBeenCalledTimes(1)

    // Ping for another path is ignored
    h.setAnswer({ bound: true, readOnly: false })
    await h.ping(OTHER)
    expect(h.api.uniworkState).toHaveBeenCalledTimes(1)
    expect(saveBtn().disabled).toBe(true)

    // Ping for this path flips to editable -> Save button enabled, Ctrl+S writes
    await h.ping(PATH)
    expect(h.api.uniworkState).toHaveBeenCalledTimes(2)
    expect(saveBtn().disabled).toBe(false)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    })
    await settle()
    expect(h.api.save).toHaveBeenCalledTimes(1)
    expect(h.api.uniworkReadOnlySave).not.toHaveBeenCalled()

    // Ping flips back to read-only (lock lost) -> Save button disabled, Ctrl+S explains
    h.setAnswer({ bound: true, readOnly: true })
    await h.ping(PATH)
    expect(h.api.uniworkState).toHaveBeenCalledTimes(3)
    expect(saveBtn().disabled).toBe(true)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    })
    await settle()
    expect(h.api.uniworkReadOnlySave).toHaveBeenCalledTimes(1)
    expect(h.api.save).toHaveBeenCalledTimes(1)

    h.unmount()
    open.pop()
    expect(h.unsubscribes()).toBe(1)
  })

  it('unbound read-only file keeps today’s behaviour (does not call uniworkReadOnlySave)', async () => {
    const h = await mount({ bound: false, readOnly: true })
    open.push(h)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    })
    await settle()
    expect(h.api.uniworkReadOnlySave).not.toHaveBeenCalled()
    expect(h.api.save).toHaveBeenCalledTimes(1)
  })
})
