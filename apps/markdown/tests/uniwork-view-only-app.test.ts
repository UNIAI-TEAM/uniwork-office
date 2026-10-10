/**
 * The real renderer App on a UniWork copy: a view-only document has no editable
 * properties, and the renderer leaves the decision about a save to main.
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

async function mount(uniwork: StateApi): Promise<Harness> {
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

  it('hands every save request to main, even for a view-only copy', async () => {
    const h = await mount({ bound: true, readOnly: true })
    open.push(h)
    await act(async () => {
      h.saveRequest()('save')
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(h.api.save).toHaveBeenCalledTimes(1)
  })
})
