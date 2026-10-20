// UNI-2011 S-html-md fix1: RS-html-md M1 (zoom aliases), L3/L4 (preview relay), L6/L7 (link popover, handler claims)
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { parseChord, type ShortcutKeyEvent } from '@genoffice/shortcuts'
import {
  htmlShortcutCommand,
  htmlWindowCommand,
  type HtmlShortcutCommand,
} from '../src/renderer/shortcuts'
import { LinkPopover, normalizeLinkHref } from '../src/renderer/components/LinkPopover'
import { parseFromInspector } from '../src/renderer/preview/inspector-validate'

/** a keydown as a layout types it: `key` is the character, `code` the physical key */
function typed(
  key: string,
  code: string,
  mods: Partial<ShortcutKeyEvent> = { ctrlKey: true },
): ShortcutKeyEvent {
  return {
    key,
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    getModifierState: () => false,
    ...mods,
  }
}

const NAMED: Record<string, string> = { Equal: '=', Minus: '-', Backslash: '\\' }

/** a keydown for a canonical chord on a US layout */
function press(chord: string): ShortcutKeyEvent {
  const p = parseChord(chord)!
  const isLetter = /^[A-Z]$/.test(p.key)
  const isDigit = /^[0-9]$/.test(p.key)
  return typed(
    isLetter ? p.key.toLowerCase() : isDigit ? p.key : (NAMED[p.key] ?? p.key),
    isLetter ? `Key${p.key}` : isDigit ? `Digit${p.key}` : p.key,
    { ctrlKey: p.ctrl, altKey: p.alt, shiftKey: p.shift, metaKey: p.cmd },
  )
}

describe('zoom keys keep Ctrl+Shift+=, the numpad and non-US layouts (RS-html-md M1)', () => {
  const win = (event: ShortcutKeyEvent) => htmlShortcutCommand(event, 'win', 'desktop')

  it('Ctrl and "+" on a US keyboard is Ctrl+Shift+=', () => {
    expect(win(typed('+', 'Equal', { ctrlKey: true, shiftKey: true }))).toBe('zoomIn')
    expect(win(typed('=', 'Equal'))).toBe('zoomIn')
  })

  it('the keypad zooms', () => {
    expect(win(typed('+', 'NumpadAdd'))).toBe('zoomIn')
    expect(win(typed('-', 'NumpadSubtract'))).toBe('zoomOut')
    expect(win(typed('0', 'Numpad0'))).toBe('zoomReset')
  })

  it('German "+" and "-" zoom although they sit on other physical keys', () => {
    expect(win(typed('+', 'BracketRight'))).toBe('zoomIn')
    expect(win(typed('-', 'Slash'))).toBe('zoomOut')
  })

  it('macOS Cmd forms zoom too', () => {
    const cmd = { metaKey: true }
    expect(htmlShortcutCommand(typed('+', 'Equal', { ...cmd, shiftKey: true }), 'mac', 'web')).toBe(
      'zoomIn',
    )
    expect(htmlShortcutCommand(typed('+', 'NumpadAdd', cmd), 'mac', 'desktop')).toBe('zoomIn')
    expect(htmlShortcutCommand(typed('0', 'Numpad0', cmd), 'mac', 'desktop')).toBe('zoomReset')
  })
})

describe('what the window handler claims (RS-html-md L7)', () => {
  it('a focused text field keeps bold, italic, underline, link, undo and redo', () => {
    for (const chord of ['Ctrl+B', 'Ctrl+I', 'Ctrl+U', 'Ctrl+K', 'Ctrl+Z', 'Ctrl+Y']) {
      expect(htmlWindowCommand(press(chord), true, 'win', 'desktop'), chord).toBeNull()
      expect(htmlWindowCommand(press(chord), false, 'win', 'desktop'), chord).not.toBeNull()
    }
  })

  it('file, find, view and zoom commands are claimed in a text field too', () => {
    const cases: Array<[string, HtmlShortcutCommand]> = [
      ['Ctrl+S', 'save'],
      ['F12', 'saveAs'],
      ['Ctrl+F', 'find'],
      ['Ctrl+H', 'replace'],
      ['Shift+F4', 'findNext'],
      ['Ctrl+Backslash', 'cycleView'],
      ['Ctrl+Equal', 'zoomIn'],
    ]
    for (const [chord, command] of cases) {
      expect(htmlWindowCommand(press(chord), true, 'win', 'desktop'), chord).toBe(command)
    }
  })

  it('a key the table does not know is not claimed', () => {
    expect(htmlWindowCommand(press('Ctrl+Shift+K'), false, 'win', 'desktop')).toBeNull()
    expect(htmlWindowCommand(press('Ctrl+Shift+U'), false, 'win', 'desktop')).toBeNull()
  })
})

describe('link address with a port (RS-html-md L6)', () => {
  it.each([
    ['localhost:3000/x', 'https://localhost:3000/x'],
    ['example.com:8080', 'https://example.com:8080'],
    ['tel:5551234', 'tel:5551234'],
  ])('%s -> %s', (raw, out) => {
    expect(normalizeLinkHref(raw)).toBe(out)
  })

  it.each(['javascript:1', 'data:1', 'vbscript:alert(1)', 'file:///etc/passwd'])(
    'still refuses %j',
    (raw) => {
      expect(normalizeLinkHref(raw)).toBeNull()
    },
  )
})

describe('link popover (RS-html-md L6, L7)', () => {
  beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
  const cleanups: Array<() => void> = []
  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup())
    vi.unstubAllGlobals()
  })

  function mountPopover() {
    const onApply = vi.fn()
    const onCancel = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => root.render(createElement(LinkPopover, { onApply, onCancel })))
    cleanups.push(() => {
      act(() => root.unmount())
      container.remove()
    })
    const input = container.querySelector('input')!
    const type = (value: string) =>
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
        setter.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    const key = (init: KeyboardEventInit & { keyCode?: number }) =>
      act(() => {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
        )
      })
    return { container, input, onApply, onCancel, type, key }
  }

  it('Enter applies a safe address', () => {
    const { onApply, type, key } = mountPopover()
    type('example.com')
    key({ key: 'Enter' })
    expect(onApply).toHaveBeenCalledWith('https://example.com')
  })

  it('Enter on a refused address says so and marks the field invalid; typing clears it', () => {
    const { container, input, onApply, type, key } = mountPopover()
    type('javascript:alert(1)')
    key({ key: 'Enter' })
    expect(onApply).not.toHaveBeenCalled()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(container.querySelector('[role="alert"]')?.textContent).toBeTruthy()
    type('example.com')
    expect(input.getAttribute('aria-invalid')).toBe('false')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('Esc cancels', () => {
    const { onCancel, key } = mountPopover()
    key({ key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('an IME composition owns Enter and Esc', () => {
    const { onApply, onCancel, type, key } = mountPopover()
    type('example.com')
    key({ key: 'Enter', isComposing: true })
    key({ key: 'Enter', keyCode: 229 })
    key({ key: 'Escape', isComposing: true })
    expect(onApply).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })
})

describe('preview relay surface (RS-html-md L3, L4)', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const source = readFileSync(join(here, '../src/renderer/preview/inspector.js'), 'utf8')

  it('askAi is no longer an accepted frame command', () => {
    const input = { type: 'gx:keyCommand', command: 'askAi', version: 4 }
    expect(parseFromInspector(input)).toBeNull()
    expect(source).not.toContain('askAi')
  })

  it('the frame relays b / i / u / k for the platform command key, without Shift or Alt', () => {
    expect(source).toContain('const cmdKey = /mac/i.test(navigator.platform)')
    expect(source).toContain('cmdKey && !e.altKey && !e.shiftKey && inlineCommand[')
    // the edited-run branch relays the same four keys, not only b / i
    expect(source).toContain("{ b: 'bold', i: 'italic', u: 'underline', k: 'link' }")
    expect(source).not.toMatch(/=== 'b' \|\| e\.key\.toLowerCase\(\) === 'i'/)
  })
})
