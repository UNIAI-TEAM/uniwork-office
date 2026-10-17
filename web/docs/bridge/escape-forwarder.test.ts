// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installEscapeForwarder, isReadOnlyProfile } from './escape-forwarder'

let off: (() => void) | null = null
const windowListeners: Array<(e: KeyboardEvent) => void> = []

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  off?.()
  off = null
  for (const fn of windowListeners.splice(0)) {
    window.removeEventListener('keydown', fn, false)
  }
  vi.useRealTimers()
  document.body.innerHTML = ''
})

function pressKey(
  target: EventTarget,
  key = 'Escape',
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  })
  target.dispatchEvent(event)
  return event
}

describe('escape-forwarder and isReadOnlyProfile (UNI-1876)', () => {
  it('isReadOnlyProfile returns true only when profile is readOnly', () => {
    expect(isReadOnlyProfile({ profile: 'readOnly' })).toBe(true)
    expect(isReadOnlyProfile({})).toBe(false)
    expect(isReadOnlyProfile({ profile: undefined })).toBe(false)
    expect(isReadOnlyProfile({ profile: 'edit' })).toBe(false)
    expect(isReadOnlyProfile(null)).toBe(false)
    expect(isReadOnlyProfile(undefined)).toBe(false)
  })

  it('reports escape on plain Escape keydown in the bubble phase after the macrotask tick', () => {
    const report = vi.fn()
    off = installEscapeForwarder(window, report)

    document.body.innerHTML = '<div id="editor" tabindex="0">text</div>'
    const editor = document.getElementById('editor') as HTMLElement
    editor.focus()

    pressKey(editor, 'Escape')
    expect(report).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('escape')

    pressKey(editor, 'Enter')
    pressKey(editor, 'a')
    vi.runAllTimers()
    expect(report).toHaveBeenCalledTimes(1)
  })

  it('does not report when a local listener prevents default before window bubble', () => {
    const report = vi.fn()
    off = installEscapeForwarder(window, report)

    document.body.innerHTML = '<button id="local">Local popover trigger</button>'
    const btn = document.getElementById('local') as HTMLElement
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') e.preventDefault()
    })
    btn.focus()

    const ev = pressKey(btn, 'Escape')
    vi.runAllTimers()
    expect(ev.defaultPrevented).toBe(true)
    expect(report).not.toHaveBeenCalled()
  })

  it('does not report when a window keydown listener registered AFTER the forwarder calls preventDefault (RFW3-1)', () => {
    const report = vi.fn()
    off = installEscapeForwarder(window, report)

    const laterAppListener = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') e.preventDefault()
    }
    window.addEventListener('keydown', laterAppListener, false)
    windowListeners.push(laterAppListener)

    const ev = pressKey(document.body, 'Escape')
    vi.runAllTimers()
    expect(ev.defaultPrevented).toBe(true)
    expect(report).not.toHaveBeenCalled()
  })

  it.each([
    ['[role="dialog"]', '<div role="dialog"><button id="focus-target">Close</button></div>'],
    ['[role="menu"]', '<div role="menu"><button id="focus-target">Item</button></div>'],
    ['[aria-modal="true"]', '<div aria-modal="true"><input id="focus-target" /></div>'],
    [
      '[data-esc-local]',
      '<div data-esc-local="true"><textarea id="focus-target"></textarea></div>',
    ],
  ])('does not report when focus is inside %s', (_selector, markup) => {
    const report = vi.fn()
    off = installEscapeForwarder(window, report)

    document.body.innerHTML = markup
    const focusTarget = document.getElementById('focus-target') as HTMLElement
    focusTarget.focus()
    expect(document.activeElement).toBe(focusTarget)

    pressKey(focusTarget, 'Escape')
    vi.runAllTimers()
    expect(report).not.toHaveBeenCalled()
  })

  it('does not report while IME is composing (isComposing or keyCode 229) or on auto-repeat (RFW1-1, RFW1-2)', () => {
    const report = vi.fn()
    off = installEscapeForwarder(window, report)

    document.body.innerHTML = '<div id="editor" tabindex="0">text</div>'
    const editor = document.getElementById('editor') as HTMLElement
    editor.focus()

    pressKey(editor, 'Escape', { isComposing: true })
    pressKey(editor, 'Escape', { keyCode: 229 })
    pressKey(editor, 'Escape', { repeat: true })
    vi.runAllTimers()
    expect(report).not.toHaveBeenCalled()

    pressKey(editor, 'Escape')
    vi.runAllTimers()
    expect(report).toHaveBeenCalledTimes(1)
  })

  it('stops reporting once uninstalled and cancels a pending report if uninstalled before the tick (RFW3-1)', () => {
    const report = vi.fn()
    off = installEscapeForwarder(window, report)

    pressKey(document.body, 'Escape')
    vi.runAllTimers()
    expect(report).toHaveBeenCalledTimes(1)

    // Press Escape again, then uninstall BEFORE the timer tick fires
    pressKey(document.body, 'Escape')
    off()
    off = null
    vi.runAllTimers()
    expect(report).toHaveBeenCalledTimes(1)

    pressKey(document.body, 'Escape')
    vi.runAllTimers()
    expect(report).toHaveBeenCalledTimes(1)
  })
})
