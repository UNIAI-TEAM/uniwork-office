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
import {
  createHtmlFrameKeyReplay,
  hostHasUserActivation,
  htmlFrameKeyClaims,
  htmlFrameKeyReplay,
} from '../src/renderer/shortcuts'

const here = dirname(fileURLToPath(import.meta.url))
const inspectorSrc = readFileSync(join(here, '../src/renderer/preview/inspector.js'), 'utf8')

/** the inspector running in its own document, as it does inside the Preview iframe */
function makeFrame(html = '<!doctype html><html><body><p data-gx-sid="1">Hello</p></body></html>') {
  const messages: Array<Record<string, unknown>> = []
  const hostListeners: Array<(e: { data: unknown }) => void> = []
  const dom = new JSDOM(html, { runScripts: 'dangerously' })
  Object.assign(dom.window, {
    requestAnimationFrame: () => 0,
    __gxPreviewPort: {
      start: () => {},
      addEventListener: (_type: string, fn: (e: { data: unknown }) => void) => {
        hostListeners.push(fn)
      },
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
  /** a message from the host, as the port delivers it */
  const send = (data: unknown) => hostListeners.forEach((fn) => fn({ data }))
  return { dom, messages, press, send }
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

  it('a text field in the page keeps its editing chords but still passes a function key', () => {
    const { dom, messages, press } = makeFrame(
      '<!doctype html><html><body><input id="f"><p data-gx-sid="1">x</p></body></html>',
    )
    const input = dom.window.document.getElementById('f')!
    press({ key: 'b', code: 'KeyB', ctrlKey: true }, input)
    expect(keyEvents(messages)).toEqual([])
    press({ key: 'F1', code: 'F1', ctrlKey: true }, input)
    expect(keyEvents(messages)).toHaveLength(1)
  })

  it('carries the composition and AltGr state the host matcher guards on', () => {
    const { messages, press } = makeFrame()
    press({ key: 'F1', code: 'F1', ctrlKey: true, modifierAltGraph: true })
    expect(keyEvents(messages)[0]).toMatchObject({
      repeat: false,
      altGraph: true,
      composing: false,
    })
  })

  it('a held key and plain clipboard / select-all chords are not posted', () => {
    const { messages, press } = makeFrame()
    press({ key: 'F1', code: 'F1', ctrlKey: true, repeat: true })
    for (const key of ['c', 'v', 'x', 'a'])
      press({ key, code: `Key${key.toUpperCase()}`, ctrlKey: true })
    press({ key: 'c', code: 'KeyC', metaKey: true })
    expect(keyEvents(messages)).toEqual([])
    // with another modifier it is a different chord
    press({ key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true })
    expect(keyEvents(messages)).toHaveLength(1)
  })

  it('inline editing and page fields keep b / i / u / k / z / y / h but pass the other chords', () => {
    const { dom, messages, press } = makeFrame(
      '<!doctype html><html><body><input id="f"><p data-gx-sid="1">x</p></body></html>',
    )
    const input = dom.window.document.getElementById('f')!
    for (const key of ['b', 'i', 'u', 'k', 'z', 'y', 'h'])
      press({ key, code: `Key${key.toUpperCase()}`, ctrlKey: true }, input)
    expect(keyEvents(messages)).toEqual([])
    press({ key: 'f', code: 'KeyF', ctrlKey: true }, input)
    press({ key: 's', code: 'KeyS', ctrlKey: true }, input)
    expect(keyEvents(messages).map((m) => m.key)).toEqual(['f', 's'])
  })

  it('cancels the browser default for a chord the host claimed, and only that one', () => {
    const { press, send } = makeFrame()
    const claims = [
      null,
      'f',
      { ctrlKey: true },
      { key: 7 },
      { key: 'f', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
      { key: '\\', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false },
    ]
    expect(press({ key: 'f', code: 'KeyF', ctrlKey: true }).defaultPrevented).toBe(false)
    send({ type: 'gx:keyClaims', claims })
    const claimed = press({ key: 'F', code: 'KeyF', ctrlKey: true })
    const backslash = press({ key: '\\', code: 'Backslash', ctrlKey: true })
    const other = press({ key: 'g', code: 'KeyG', ctrlKey: true })
    const withShift = press({ key: 'f', code: 'KeyF', ctrlKey: true, shiftKey: true })
    expect([claimed, backslash, other, withShift].map((e) => e.defaultPrevented)).toEqual([
      true,
      true,
      false,
      false,
    ])
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

  it('replays collapse and find; never bold, another surface key or a plain key', () => {
    const replay = (init: Record<string, unknown>) => {
      const m = msg(init)
      return m && m.type === 'gx:keyEvent' ? htmlFrameKeyReplay(m, 'win', 'desktop') : null
    }
    expect(replay({ key: 'F1', code: 'F1', ctrlKey: true })).not.toBeNull()
    expect(replay({ key: 'f', code: 'KeyF', ctrlKey: true })).not.toBeNull()
    expect(replay({ key: 'F3', code: 'F3', ctrlKey: true })).toBeNull()
    expect(replay({ key: 'b', code: 'KeyB', ctrlKey: true })).toBeNull()
    expect(replay({ key: 'a', code: 'KeyA' })).toBeNull()
    expect(replay({ key: 'F1', code: 'F1', ctrlKey: true, composing: true })).toBeNull()
  })
})

const relayed = (init: Record<string, unknown>) => ({
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

describe('the host replay keeps the matcher guards', () => {
  const win = (init: Record<string, unknown>) => htmlFrameKeyReplay(relayed(init), 'win', 'desktop')
  const mac = (init: Record<string, unknown>) => htmlFrameKeyReplay(relayed(init), 'mac', 'desktop')

  it('a held key does not replay a one-shot row', () => {
    expect(win({ key: 'f', code: 'KeyF', ctrlKey: true })).not.toBeNull()
    expect(win({ key: 'f', code: 'KeyF', ctrlKey: true, repeat: true })).toBeNull()
    expect(win({ key: 'F1', code: 'F1', ctrlKey: true, repeat: true })).toBeNull()
  })

  it('AltGr and Ctrl+Alt do not replay on Windows', () => {
    expect(win({ key: 'f', code: 'KeyF', ctrlKey: true, altKey: true })).toBeNull()
    expect(win({ key: 'F1', code: 'F1', ctrlKey: true, altKey: true, altGraph: true })).toBeNull()
  })

  it('macOS takes Cmd chords, not Ctrl ones', () => {
    expect(mac({ key: 'f', code: 'KeyF', metaKey: true })).not.toBeNull()
    expect(mac({ key: 'r', code: 'KeyR', altKey: true, metaKey: true })).not.toBeNull()
    expect(mac({ key: 'f', code: 'KeyF', ctrlKey: true })).toBeNull()
    expect(win({ key: 'f', code: 'KeyF', metaKey: true })).toBeNull()
  })

  it('undo, redo and zoom keys are not replayed (they have their own relay)', () => {
    expect(win({ key: 'z', code: 'KeyZ', ctrlKey: true })).toBeNull()
    expect(win({ key: 'y', code: 'KeyY', ctrlKey: true })).toBeNull()
    expect(win({ key: '=', code: 'Equal', ctrlKey: true })).toBeNull()
    expect(win({ key: '-', code: 'Minus', ctrlKey: true })).toBeNull()
    expect(win({ key: '0', code: 'Digit0', ctrlKey: true })).toBeNull()
  })
})

describe('desktop leaves the File menu accelerators to the menu (no second Save / Save As)', () => {
  const press = (
    init: Record<string, unknown>,
    platform: 'win' | 'mac',
    surface: 'desktop' | 'web',
  ) => htmlFrameKeyReplay(relayed(init), platform, surface)

  it('Ctrl+S and F12 on Windows desktop are the menu accelerators: not replayed', () => {
    expect(press({ key: 's', code: 'KeyS', ctrlKey: true }, 'win', 'desktop')).toBeNull()
    expect(press({ key: 'F12', code: 'F12' }, 'win', 'desktop')).toBeNull()
  })

  it('Cmd+S and Shift+Cmd+S on macOS desktop are the menu accelerators: not replayed', () => {
    expect(press({ key: 's', code: 'KeyS', metaKey: true }, 'mac', 'desktop')).toBeNull()
    const saveAs = { key: 'S', code: 'KeyS', metaKey: true, shiftKey: true }
    expect(press(saveAs, 'mac', 'desktop')).toBeNull()
  })

  it('the Ctrl+Shift+S alias has no accelerator, so desktop still replays it', () => {
    const alias = { key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true }
    expect(press(alias, 'win', 'desktop')).not.toBeNull()
  })

  it('the web surface has no menu: Ctrl+S still replays', () => {
    expect(press({ key: 's', code: 'KeyS', ctrlKey: true }, 'win', 'web')).not.toBeNull()
  })
})

describe('a forged key message cannot drive the app', () => {
  const ctrlShiftS = relayed({ key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true })
  const f12 = relayed({ key: 'F12', code: 'F12' })
  const ctrlF = relayed({ key: 'f', code: 'KeyF', ctrlKey: true })
  const web = {
    platform: 'win',
    surface: 'web',
    saving: false,
    frameFocused: true,
    userActive: true,
  } as const

  it('is dropped unless the preview frame holds the focus', () => {
    const replay = createHtmlFrameKeyReplay()
    expect(replay(f12, { ...web, frameFocused: false, now: 1000 })).toBeNull()
    expect(replay(f12, { ...web, now: 1001 })).not.toBeNull()
  })

  it('is dropped unless the host window has transient user activation', () => {
    const replay = createHtmlFrameKeyReplay()
    expect(replay(f12, { ...web, userActive: false, now: 1000 })).toBeNull()
    expect(replay(ctrlF, { ...web, userActive: false, now: 1001 })).toBeNull()
    // a dropped attempt does not start the gap
    expect(replay(f12, { ...web, now: 1002 })).not.toBeNull()
  })

  it('treats a missing userActivation API as active, and reads isActive when present', () => {
    const nav = navigator as Navigator & { userActivation?: unknown }
    const had = Object.getOwnPropertyDescriptor(nav, 'userActivation')
    const set = (value: unknown) =>
      Object.defineProperty(nav, 'userActivation', { value, configurable: true })
    try {
      set(undefined)
      expect(hostHasUserActivation()).toBe(true)
      set({ isActive: true })
      expect(hostHasUserActivation()).toBe(true)
      set({ isActive: false })
      expect(hostHasUserActivation()).toBe(false)
    } finally {
      if (had) Object.defineProperty(nav, 'userActivation', had)
      else delete (nav as { userActivation?: unknown }).userActivation
    }
  })

  it('two forged F12 in a row replay once; the same key later replays again', () => {
    const replay = createHtmlFrameKeyReplay()
    expect(replay(f12, { ...web, now: 1000 })).not.toBeNull()
    expect(replay(f12, { ...web, now: 1010 })).toBeNull()
    expect(replay(f12, { ...web, now: 1400 })).not.toBeNull()
  })

  it('the limit covers the dialogs only: Save and Save As share it, other commands are not held back', () => {
    const replay = createHtmlFrameKeyReplay()
    expect(replay(f12, { ...web, now: 1000 })).not.toBeNull()
    expect(replay(ctrlShiftS, { ...web, now: 1001 })).toBeNull()
    expect(replay(ctrlF, { ...web, now: 1002 })).not.toBeNull()
  })

  it('real fast taps of Find, Find next and view cycling all replay', () => {
    const replay = createHtmlFrameKeyReplay()
    const findNext = relayed({ key: 'g', code: 'KeyG', ctrlKey: true })
    const cycle = relayed({ key: '\\', code: 'Backslash', ctrlKey: true })
    for (const [i, key] of [ctrlF, ctrlF, findNext, findNext, cycle, cycle].entries())
      expect(replay(key, { ...web, now: 1000 + i * 10 })).not.toBeNull()
  })

  it('the desktop Ctrl+Shift+S alias is limited the same way', () => {
    const replay = createHtmlFrameKeyReplay()
    const desktop = { ...web, surface: 'desktop' } as const
    expect(replay(ctrlShiftS, { ...desktop, now: 1000 })).not.toBeNull()
    expect(replay(ctrlShiftS, { ...desktop, now: 1005 })).toBeNull()
  })

  it('Save and Save As are dropped while a save runs, other commands are not', () => {
    const replay = createHtmlFrameKeyReplay()
    expect(replay(f12, { ...web, saving: true, now: 1000 })).toBeNull()
    expect(replay(f12, { ...web, saving: true, now: 5000 })).toBeNull()
    expect(replay(ctrlF, { ...web, saving: true, now: 6000 })).not.toBeNull()
    // a dropped attempt does not start the gap
    expect(replay(f12, { ...web, now: 6001 })).not.toBeNull()
  })
})

describe('the chords the frame cancels the browser default for', () => {
  const find = { key: 'f', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }

  it('are the replayed web chords: find, save, view cycling, collapse', () => {
    const claims = htmlFrameKeyClaims('win', 'web')
    expect(claims).toEqual(
      expect.arrayContaining([
        find,
        expect.objectContaining({ key: 's', ctrlKey: true }),
        expect.objectContaining({ key: 'h', ctrlKey: true }),
        expect.objectContaining({ key: '\\', ctrlKey: true }),
        expect.objectContaining({ key: 'f3', ctrlKey: true }),
      ]),
    )
    // bold / undo / zoom keys are not claimed: they have their own relay
    expect(claims.some((c) => c.key === 'b' || c.key === 'z')).toBe(false)
  })

  it('are empty on desktop, where the menu accelerators must still run', () => {
    expect(htmlFrameKeyClaims('win', 'desktop')).toEqual([])
    expect(htmlFrameKeyClaims('mac', 'desktop')).toEqual([])
  })

  it('use Cmd on macOS', () => {
    expect(htmlFrameKeyClaims('mac', 'web')).toEqual(
      expect.arrayContaining([{ ...find, ctrlKey: false, metaKey: true }]),
    )
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
