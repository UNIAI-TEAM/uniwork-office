/**
 * EL-1(b) fix6 / VEL-1+VEL-2: the real markdown renderer App on a UniWork copy.
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

const PATH = 'C:/u/uniwork-documents/dep/user/doc1/notes.md'
const OTHER = 'C:/u/uniwork-documents/dep/user/doc2/other.md'
const RAW = '---\ntitle: Quarterly\n---\n\nHello world\n'

interface Harness {
  container: HTMLElement
  api: Record<string, Mock>
  setAnswer: (next: { bound: boolean; readOnly: boolean }) => void
  ping: (p: string) => Promise<void>
  saveRequest: () => (mode: string) => void
  unsubscribes: () => number
  unmount: () => void
}

/** how the browser harness may differ from the desktop preload */
type StateApi = { bound: boolean; readOnly: boolean } | 'missing' | 'rejects'

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }
}

async function mount(
  initial: StateApi,
  saveResult: unknown = { ok: true, canceled: true },
): Promise<Harness> {
  let current = initial
  let unsubscribes = 0
  const handlers: Record<string, (...args: never[]) => void> = {}
  const stubs: Record<string, Mock> = {
    consumePending: vi.fn(async () => PATH),
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
    save: vi.fn(async () => saveResult),
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
  vi.stubGlobal('markdownApi', api)
  Object.assign(window, { markdownApi: api })
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
    setAnswer: (next) => {
      current = next
    },
    ping: async (p) => {
      const cb = handlers.onUniworkStateChanged as ((path: string) => void) | undefined
      cb?.(p)
      await settle()
    },
    saveRequest: () => handlers.onSaveRequest as never,
    unsubscribes: () => unsubscribes,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

/** what a user's keystroke does to a controlled textarea, readOnly or not (jsdom does not enforce it) */
async function typeInto(el: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const open: Harness[] = []
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // jsdom has no layout: ProseMirror measures ranges when it scrolls the caret into view
  const zeroRects = () => [] as unknown as DOMRectList
  Range.prototype.getClientRects ||= zeroRects
  Range.prototype.getBoundingClientRect ||= () => new DOMRect()
  Element.prototype.getClientRects ||= zeroRects
})
afterEach(() => {
  open.splice(0).forEach((h) => h.unmount())
  vi.unstubAllGlobals()
})

describe('markdown App on a UniWork copy', () => {
  it('shows the properties panel of a view-only copy read-only and ignores typing into it', async () => {
    const h = await mount({ bound: true, readOnly: true })
    open.push(h)
    const textarea = h.container.querySelector<HTMLTextAreaElement>('.fm-textarea')!
    expect(textarea).not.toBeNull()
    expect(textarea.readOnly).toBe(true)
    // opening a view-only copy must not mark it dirty, so setDirty may never have been called
    const dirtyCalls = h.api.setDirty?.mock.calls.length ?? 0
    expect(dirtyCalls).toBe(0)
    await typeInto(textarea, 'title: Changed')
    expect(h.container.querySelector<HTMLTextAreaElement>('.fm-textarea')!.value).toBe(
      'title: Quarterly',
    )
    expect(h.api.setDirty?.mock.calls.length ?? 0).toBe(dirtyCalls)
  })

  it('keeps the properties panel editable on an editable copy', async () => {
    const h = await mount({ bound: true, readOnly: false })
    open.push(h)
    const textarea = h.container.querySelector<HTMLTextAreaElement>('.fm-textarea')!
    expect(textarea.readOnly).toBe(false)
    await typeInto(textarea, 'title: Changed')
    expect(h.container.querySelector<HTMLTextAreaElement>('.fm-textarea')!.value).toBe(
      'title: Changed',
    )
    expect(h.api.setDirty!.mock.calls.at(-1)).toEqual([true])
  })

  it.each(['missing', 'rejects'] as const)(
    'renders an editable, unbound copy when the UniWork state query is %s',
    async (kind) => {
      const h = await mount(kind)
      open.push(h)
      const textarea = h.container.querySelector<HTMLTextAreaElement>('.fm-textarea')!
      expect(textarea).not.toBeNull()
      expect(textarea.readOnly).toBe(false)
      await typeInto(textarea, 'title: Changed')
      expect(h.api.setDirty!.mock.calls.at(-1)).toEqual([true])
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
    const fm = () => h.container.querySelector<HTMLTextAreaElement>('.fm-textarea')!
    expect(fm().readOnly).toBe(true)
    expect(h.api.uniworkState).toHaveBeenCalledTimes(1)

    // Ping for another path is ignored
    h.setAnswer({ bound: true, readOnly: false })
    await h.ping(OTHER)
    expect(h.api.uniworkState).toHaveBeenCalledTimes(1)
    expect(fm().readOnly).toBe(true)

    // Ping for this path flips to editable -> properties editable, Ctrl+S saves
    await h.ping(PATH)
    expect(h.api.uniworkState).toHaveBeenCalledTimes(2)
    expect(fm().readOnly).toBe(false)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    })
    await settle()
    expect(h.api.save).toHaveBeenCalledTimes(1)
    expect(h.api.uniworkReadOnlySave).not.toHaveBeenCalled()

    // Ping flips back to read-only (lock lost) -> properties read-only, Ctrl+S explains
    h.setAnswer({ bound: true, readOnly: true })
    await h.ping(PATH)
    expect(h.api.uniworkState).toHaveBeenCalledTimes(3)
    expect(fm().readOnly).toBe(true)
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

  it.each([
    [true, null],
    [false, 'Saved'],
  ] as const)(
    'after a Save of a copy bound=%s the status bar says %s (the chip owns the UniWork outcome)',
    async (bound, expected) => {
      const h = await mount({ bound, readOnly: false }, { ok: true, path: PATH })
      open.push(h)
      h.saveRequest()('save')
      await settle()
      expect(h.api.save).toHaveBeenCalledTimes(1)
      const text = h.container.querySelector('.status-save')?.textContent ?? null
      expect(text).toBe(expected)
    },
  )

  it('Ctrl+S on a UniWork copy is a plain Save (no dialog); only Ctrl+Shift+S is Save As', async () => {
    const h = await mount({ bound: true, readOnly: false }, { ok: true, path: PATH })
    open.push(h)
    const press = async (shiftKey: boolean) => {
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: shiftKey ? 'S' : 's', ctrlKey: true, shiftKey }),
        )
      })
      await settle()
    }
    await press(false)
    expect(h.api.save.mock.calls.at(-1)?.[0]).toMatchObject({ mode: 'save' })
    await press(true)
    expect(h.api.save.mock.calls.at(-1)?.[0]).toMatchObject({ mode: 'saveAs' })
  })
})
