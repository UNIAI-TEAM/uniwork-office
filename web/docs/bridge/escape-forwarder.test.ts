// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installEscapeForwarder, isReadOnlyProfile } from './escape-forwarder'

let off: (() => void) | null = null

afterEach(() => {
  off?.()
  off = null
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

  it('reports escape on plain Escape keydown in the bubble phase', () => {
    const report = vi.fn()
    off = installEscapeForwarder(window, report)

    document.body.innerHTML = '<div id="editor" tabindex="0">text</div>'
    const editor = document.getElementById('editor') as HTMLElement
    editor.focus()

    pressKey(editor, 'Escape')
    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('escape')

    pressKey(editor, 'Enter')
    pressKey(editor, 'a')
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
    expect(report).not.toHaveBeenCalled()

    pressKey(editor, 'Escape')
    expect(report).toHaveBeenCalledTimes(1)
  })

  it('stops reporting once uninstalled', () => {
    const report = vi.fn()
    off = installEscapeForwarder(window, report)

    pressKey(document.body, 'Escape')
    expect(report).toHaveBeenCalledTimes(1)

    off()
    off = null

    pressKey(document.body, 'Escape')
    expect(report).toHaveBeenCalledTimes(1)
  })
})
