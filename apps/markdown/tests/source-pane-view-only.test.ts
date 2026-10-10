/**
 * UNI-1232 A3: the source panes of a view-only document refuse edits: no input, no dirty flag, no
 * save. The .txt/.json source editor (CodeMirror) and the Markdown source view (textarea) both take
 * the read-only state of the document; an editable one keeps working.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { insertNewlineAndIndent } from '@codemirror/commands'
import App from '../src/renderer/App'
import { SourcePane } from '../src/renderer/components/SourcePane'
import { resetForTest } from '../src/renderer/capabilities'
import { LocaleProvider } from '../src/renderer/i18n/locale'

vi.mock('../src/renderer/ai/AiPanel', () => ({
  GensparkMark: () => null,
  AiPanel: () => null,
}))

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // CodeMirror measures text ranges; jsdom has no layout
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

async function mountApp(path: string, raw: string, caps: Record<string, boolean>) {
  resetForTest()
  const stubs: Record<string, ReturnType<typeof vi.fn>> = {
    consumePending: vi.fn(async () => path),
    readFile: vi.fn(async () => raw),
    uniworkState: vi.fn(async () => ({ bound: false, readOnly: false })),
    save: vi.fn(async () => ({ ok: true, canceled: true })),
  }
  const api = new Proxy(stubs, {
    get(target, prop: string) {
      if (prop === 'capabilities') return caps
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

function cmView(container: HTMLElement): EditorView {
  const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)
  if (!view) throw new Error('no CodeMirror view mounted')
  return view
}

describe('.txt source editor', () => {
  it('view only (no save grant): not editable, an edit command changes nothing, never dirty', async () => {
    const { container, stubs } = await mountApp('/u/notes.txt', 'plain text', { save: false })
    const content = container.querySelector('.cm-content') as HTMLElement
    expect(content.getAttribute('contenteditable')).toBe('false')
    const view = cmView(container)
    expect(view.state.readOnly).toBe(true)
    view.dispatch({ selection: { anchor: 5 } })
    expect(insertNewlineAndIndent(view)).toBe(false)
    expect(view.state.doc.toString()).toBe('plain text')
    // the api proxy only creates a stub when the renderer touches the member
    expect((stubs.setDirty?.mock.calls ?? []).some(([dirty]) => dirty === true)).toBe(false)
    expect(stubs.save!).not.toHaveBeenCalled()
  })

  it('with the save grant the same pane is editable and marks the document dirty', async () => {
    const { container, stubs } = await mountApp('/u/notes.txt', 'plain text', {})
    const view = cmView(container)
    expect(view.contentDOM.getAttribute('contenteditable')).toBe('true')
    view.dispatch({ selection: { anchor: 5 } })
    expect(insertNewlineAndIndent(view)).toBe(true)
    await act(async () => await new Promise((r) => setTimeout(r, 10)))
    expect(stubs.setDirty!.mock.calls.some(([dirty]) => dirty === true)).toBe(true)
  })

  it('the .json pane is read-only too', async () => {
    const { container } = await mountApp('/u/data.json', '{"a":1}', { save: false })
    expect(cmView(container).state.readOnly).toBe(true)
  })
})

describe('Markdown source view', () => {
  function render(readOnly: boolean, onChange = vi.fn()) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() =>
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(SourcePane, {
            value: '# Title',
            onChange,
            onFocusChange: vi.fn(),
            readOnly,
          }),
        ),
      ),
    )
    cleanups.push(() => {
      act(() => root.unmount())
      container.remove()
    })
    return { area: container.querySelector('textarea') as HTMLTextAreaElement, onChange }
  }

  function type(area: HTMLTextAreaElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    act(() => {
      setter.call(area, value)
      area.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('a read-only pane is a read-only textarea and reports no edit', () => {
    const { area, onChange } = render(true)
    expect(area.readOnly).toBe(true)
    type(area, '# Changed')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('an editable pane reports the edit', () => {
    const { area, onChange } = render(false)
    expect(area.readOnly).toBe(false)
    type(area, '# Changed')
    expect(onChange).toHaveBeenCalledWith('# Changed')
  })
})
