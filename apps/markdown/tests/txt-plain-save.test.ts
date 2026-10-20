/**
 * UNI-2046 TXT-ALWAYS-ON (desktop half): proof of the UNI-1905 save contract for a .txt file.
 * An edit and Save in the plain source editor hands the bridge exactly the edited text with the
 * file's own line endings: no markdown re-serialization, no front matter, no image bookkeeping,
 * no new name (the save keeps the opened path, so the .txt extension stays).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import App from '../src/renderer/App'
import { resetForTest } from '../src/renderer/capabilities'
import { LocaleProvider } from '../src/renderer/i18n/locale'

vi.mock('../src/renderer/ai/AiPanel', () => ({
  AiPanel: () => null,
}))

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const zeroRects = () => [] as unknown as DOMRectList
  Range.prototype.getClientRects ||= zeroRects
  Range.prototype.getBoundingClientRect ||= () => new DOMRect()
  Element.prototype.getClientRects ||= zeroRects
})
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
  resetForTest()
})

async function mountApp(path: string, raw: string) {
  resetForTest()
  const stubs: Record<string, ReturnType<typeof vi.fn>> = {
    consumePending: vi.fn(async () => path),
    readFile: vi.fn(async () => raw),
    uniworkState: vi.fn(async () => ({ bound: false, readOnly: false })),
    save: vi.fn(async () => ({ ok: true, path })),
  }
  const api = new Proxy(stubs, {
    get(target, prop: string) {
      if (prop === 'capabilities') return undefined
      if (prop === 'consumeRecovered' || prop === 'provideText') return undefined
      if (prop in target) return target[prop]
      target[prop] = /^on[A-Z]/.test(prop) ? vi.fn(() => () => {}) : vi.fn(async () => undefined)
      return target[prop]
    },
  })
  ;(window as unknown as { markdownApi: unknown }).markdownApi = api
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
  return { container, stubs }
}

describe('Save of a .txt file', () => {
  it('writes the edited text as plain text: same line endings, no front matter, same path', async () => {
    // the contract fixture: a line that looks like front matter, emphasis and a list
    const raw = '---\r\n*x*\r\n1. first\r\n'
    const { container, stubs } = await mountApp('/home/u/notes.txt', raw)
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!
    expect(view.state.doc.toString()).toBe('---\n*x*\n1. first\n')
    await act(async () => view.dispatch({ changes: { from: 0, insert: 'note\n' } }))
    const save = container.querySelector<HTMLButtonElement>('button[aria-label^="Save ("]')!
    await act(async () => save.click())
    for (let i = 0; i < 5; i++) await act(async () => await new Promise((r) => setTimeout(r, 10)))
    expect(stubs.save).toHaveBeenCalledTimes(1)
    const request = stubs.save!.mock.calls[0]![0] as Record<string, unknown>
    expect(request.text).toBe('note\r\n---\r\n*x*\r\n1. first\r\n')
    expect(request.mode).toBe('save')
    expect(request.imageSources).toEqual([])
    // no name is proposed: main keeps the opened .txt path
    expect(request.suggestedName).toBeUndefined()
  })
})
