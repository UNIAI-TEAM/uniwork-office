// UNI-2011 fix-win1 #22: with focus inside the Preview frame a keydown never reaches the host window,
// so Ctrl+F1 (ribbon collapse) and the other app-level keys did nothing there. The inspector relays the
// raw key; the host matches it against the table and replays it on its own window.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { resetForTest } from '../src/renderer/capabilities'
import { Ribbon } from '../src/renderer/components/Ribbon'
import { parseFromInspector } from '../src/renderer/preview/inspector-validate'
import { htmlFrameKeyReplay } from '../src/renderer/shortcuts'

const here = dirname(fileURLToPath(import.meta.url))
const inspectorSrc = readFileSync(join(here, '../src/renderer/preview/inspector.js'), 'utf8')

/** the inspector running in its own document, as it does inside the Preview iframe */
function makeFrame(html = '<!doctype html><html><body><p data-gx-sid="1">Hello</p></body></html>') {
  const messages: Array<Record<string, unknown>> = []
  const dom = new JSDOM(html, { runScripts: 'dangerously' })
  Object.assign(dom.window, {
    requestAnimationFrame: () => 0,
    __gxPreviewPort: {
      start: () => {},
      addEventListener: () => {},
      postMessage: (msg: Record<string, unknown>) => messages.push(msg),
    },
  })
  dom.window.eval(inspectorSrc.replace('__GX_VERSION__', '1'))
  messages.length = 0
  const press = (init: KeyboardEventInit, target?: Element) => {
    const ev = new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    ;(target ?? dom.window.document.body).dispatchEvent(ev)
    return ev
  }
  return { dom, messages, press }
}

const keyEvents = (messages: Array<Record<string, unknown>>) =>
  messages.filter((m) => m.type === 'gx:keyEvent')

describe('the inspector relays app-level keys from inside the frame', () => {
  it('Ctrl+F1 goes to the host as a raw key event', () => {
    const { messages, press } = makeFrame()
    press({ key: 'F1', code: 'F1', ctrlKey: true })
    expect(keyEvents(messages)).toEqual([
      expect.objectContaining({ key: 'F1', code: 'F1', ctrlKey: true, altKey: false }),
    ])
  })

  it('a plain letter, a bare modifier press and a key the frame already relayed are not sent twice', () => {
    const { messages, press } = makeFrame()
    press({ key: 'a', code: 'KeyA' })
    press({ key: 'Control', code: 'ControlLeft', ctrlKey: true })
    press({ key: 'z', code: 'KeyZ', ctrlKey: true })
    expect(keyEvents(messages)).toEqual([])
    expect(messages.filter((m) => m.type === 'gx:keyCommand')).toEqual([
      expect.objectContaining({ command: 'undo' }),
    ])
  })

  it('a text field in the page keeps its Ctrl chords but still passes a function key', () => {
    const { dom, messages, press } = makeFrame(
      '<!doctype html><html><body><input id="f"><p data-gx-sid="1">x</p></body></html>',
    )
    const input = dom.window.document.getElementById('f')!
    press({ key: 'f', code: 'KeyF', ctrlKey: true }, input)
    expect(keyEvents(messages)).toEqual([])
    press({ key: 'F1', code: 'F1', ctrlKey: true }, input)
    expect(keyEvents(messages)).toHaveLength(1)
  })

  it('carries the composition, repeat and AltGr state the host matcher guards on', () => {
    const { messages, press } = makeFrame()
    press({ key: 'F1', code: 'F1', ctrlKey: true, repeat: true, modifierAltGraph: true })
    expect(keyEvents(messages)[0]).toMatchObject({ repeat: true, altGraph: true, composing: false })
  })
})

describe('the host accepts only table keys the frame cannot reach otherwise', () => {
  const msg = (init: Record<string, unknown>) =>
    parseFromInspector({
      type: 'gx:keyEvent',
      version: 1,
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

  it('parses a key event and rejects a malformed one', () => {
    expect(msg({ key: 'F1', code: 'F1', ctrlKey: true })).toMatchObject({ type: 'gx:keyEvent' })
    expect(msg({ key: 'F1', ctrlKey: 'yes' })).toBeNull()
    expect(msg({ key: 'x'.repeat(100) })).toBeNull()
  })

  it('replays collapse, find and save; never bold, another surface key or a plain key', () => {
    const replay = (init: Record<string, unknown>) => {
      const m = msg(init)
      return m && m.type === 'gx:keyEvent' ? htmlFrameKeyReplay(m, 'win', 'desktop') : null
    }
    expect(replay({ key: 'F1', code: 'F1', ctrlKey: true })).not.toBeNull()
    expect(replay({ key: 'f', code: 'KeyF', ctrlKey: true })).not.toBeNull()
    expect(replay({ key: 's', code: 'KeyS', ctrlKey: true })).not.toBeNull()
    expect(replay({ key: 'F3', code: 'F3', ctrlKey: true })).toBeNull()
    expect(replay({ key: 'b', code: 'KeyB', ctrlKey: true })).toBeNull()
    expect(replay({ key: 'a', code: 'KeyA' })).toBeNull()
    expect(replay({ key: 'F1', code: 'F1', ctrlKey: true, composing: true })).toBeNull()
  })
})

describe('Ctrl+F1 pressed inside the Preview collapses the host ribbon', () => {
  const store = new Map<string, string>()
  const cleanups: Array<() => void> = []
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    store.clear()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    })
    resetForTest()
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
  })
  afterEach(() => {
    cleanups.splice(0).forEach((c) => c())
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    resetForTest()
  })

  function renderRibbon(): HTMLElement {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() =>
      root.render(
        createElement(Ribbon, {
          disabled: false,
          dirty: false,
          onSave: vi.fn(),
          onSaveAs: vi.fn(),
          onFind: vi.fn(),
          autoSave: false,
          onToggleAutoSave: vi.fn(),
          aiOpen: false,
          onToggleAi: vi.fn(),
          onAiPreset: vi.fn(),
          canUndo: false,
          canRedo: false,
          onUndo: vi.fn(),
          onRedo: vi.fn(),
          view: 'preview' as const,
          onView: vi.fn(),
          canInsert: true,
          onInsert: vi.fn(),
          canvasMode: 'edit' as const,
          onPresent: vi.fn(),
        }),
      ),
    )
    cleanups.push(() => {
      act(() => root.unmount())
      container.remove()
    })
    return container.querySelector<HTMLElement>('.ribbon')!
  }

  it('relays the key through the parser and the host replay', () => {
    const ribbon = renderRibbon()
    const { messages, press } = makeFrame()
    press({ key: 'F1', code: 'F1', ctrlKey: true })
    const relayed = parseFromInspector(keyEvents(messages)[0])
    expect(relayed?.type).toBe('gx:keyEvent')
    const replay = htmlFrameKeyReplay(relayed as never, 'win', 'desktop')
    expect(replay).not.toBeNull()
    expect(ribbon.classList.contains('ribbon-collapsed')).toBe(false)
    act(() => {
      window.dispatchEvent(replay!)
    })
    expect(ribbon.classList.contains('ribbon-collapsed')).toBe(true)
  })
})
