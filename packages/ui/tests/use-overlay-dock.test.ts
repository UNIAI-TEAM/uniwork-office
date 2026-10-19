/**
 * @vitest-environment jsdom
 */
import { act, createElement, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  OVERLAY_DOCK_MAX_PX,
  findDock,
  overlayDockQuery,
  shouldCloseOnEscape,
  shouldFocusComposer,
  useOverlayDock,
} from '../src/use-overlay-dock'

// UNI-1987: the AI dock is a modal sheet while it overlays the document (under 900 px) and a plain
// side panel above it. The pure decisions are tested directly, the hook through a small dock.

describe('overlay dock decisions', () => {
  it('overlays at 900 px and below, the same breakpoint as ai-dock-narrow.css', () => {
    expect(OVERLAY_DOCK_MAX_PX).toBe(900)
    expect(overlayDockQuery()).toBe('(max-width: 900px)')
    expect(overlayDockQuery(719)).toBe('(max-width: 719px)')
    const css = readFileSync(join(__dirname, '../src/ai-dock-narrow.css'), 'utf8')
    expect(css).toContain(`@media ${overlayDockQuery()} {`)
    expect(css).toContain('@media (max-width: 520px) {')
  })

  const esc = {
    key: 'Escape',
    defaultPrevented: false,
    isComposing: false,
    targetInDock: true,
    popupOpen: false,
  }
  it('Esc closes unless a run was cancelled, a popup owns it, or an IME is composing', () => {
    expect(shouldCloseOnEscape(esc)).toBe(true)
    expect(shouldCloseOnEscape({ ...esc, defaultPrevented: true })).toBe(false)
    expect(shouldCloseOnEscape({ ...esc, popupOpen: true })).toBe(false)
    expect(shouldCloseOnEscape({ ...esc, isComposing: true })).toBe(false)
    expect(shouldCloseOnEscape({ ...esc, targetInDock: false })).toBe(false)
    expect(shouldCloseOnEscape({ ...esc, key: 'Enter' })).toBe(false)
  })

  it('opening leaves a focused popover field or an already focused dock control alone', () => {
    expect(shouldFocusComposer({ inDock: false, isTextField: false })).toBe(true)
    expect(shouldFocusComposer({ inDock: false, isTextField: true })).toBe(false)
    expect(shouldFocusComposer({ inDock: true, isTextField: false })).toBe(false)
  })

  it('finds the wrapping dock, or the panel itself when it is its own dock (Sheets)', () => {
    document.body.innerHTML =
      '<div class="ai-dock"><aside id="a"></aside></div><aside id="b" class="copilot"></aside>'
    expect(findDock(document.getElementById('a'))?.className).toBe('ai-dock')
    expect(findDock(document.getElementById('b'))?.id).toBe('b')
    expect(findDock(null)).toBeNull()
  })
})

let host: HTMLDivElement
let root: Root
let narrow = true
const onClose = vi.fn()

/** a dock like the apps': rail while collapsed, the panel (collapse button + composer) while open */
function Dock(props: { open: boolean }) {
  const ref = useRef<HTMLElement>(null)
  useOverlayDock({ rootRef: ref, open: props.open, onClose, label: 'UniAI' })
  return createElement(
    'div',
    { className: 'ai-dock' },
    props.open
      ? createElement(
          'aside',
          { ref, className: 'copilot' },
          createElement('button', { className: 'ai-panel-collapse', 'aria-label': 'Collapse' }),
          createElement(
            'div',
            { className: 'ai-input-box' },
            createElement('textarea', { 'aria-label': 'Message' }),
          ),
          createElement('button', { 'aria-label': 'Send' }),
        )
      : createElement('button', { className: 'ai-rail', 'aria-label': 'Open' }),
  )
}

const render = (open: boolean) => act(() => root.render(createElement(Dock, { open })))
const dock = () => host.querySelector('.ai-dock')!
const key = (k: string, init: KeyboardEventInit = {}, target: Element = document.activeElement!) =>
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
    )
  })
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 30)))

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  narrow = true
  onClose.mockReset()
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: narrow && q === overlayDockQuery(),
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('useOverlayDock', () => {
  it('overlaid and open: a labelled modal dialog, composer focused, Esc closes', async () => {
    render(false)
    const rail = host.querySelector<HTMLElement>('.ai-rail')!
    act(() => rail.focus())
    render(true)
    await settle()
    expect(dock().getAttribute('role')).toBe('dialog')
    expect(dock().getAttribute('aria-modal')).toBe('true')
    expect(dock().getAttribute('aria-label')).toBe('UniAI')
    expect(document.activeElement?.tagName).toBe('TEXTAREA')
    key('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closing hands focus back to the rail, and the dialog attributes go away', async () => {
    render(true)
    await settle()
    key('Escape')
    render(false)
    expect(document.activeElement).toBe(host.querySelector('.ai-rail'))
    expect(dock().getAttribute('role')).toBeNull()
    expect(dock().getAttribute('aria-modal')).toBeNull()
  })

  it('a pressed rail is the opener, even when the editor held focus before it', async () => {
    const editor = document.createElement('div')
    editor.tabIndex = 0
    document.body.append(editor)
    render(false)
    act(() => editor.focus())
    act(() => host.querySelector<HTMLElement>('.ai-rail')!.focus())
    render(true)
    await settle()
    render(false)
    expect(document.activeElement).toBe(host.querySelector('.ai-rail'))
    editor.remove()
  })

  it('closing returns focus to the control that opened the panel when it is still there', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    render(false)
    act(() => opener.focus())
    render(true)
    await settle()
    render(false)
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('Tab and Shift+Tab wrap inside the dock', async () => {
    render(true)
    await settle()
    const [first, , last] = [...host.querySelectorAll<HTMLElement>('button, textarea')]
    act(() => last!.focus())
    key('Tab')
    expect(document.activeElement).toBe(first)
    key('Tab', { shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('Tab from the page body re-enters the dock', async () => {
    render(true)
    await settle()
    act(() => (document.activeElement as HTMLElement).blur())
    expect(document.activeElement).toBe(document.body)
    key('Tab', {}, document.body)
    expect(dock().contains(document.activeElement)).toBe(true)
  })

  it('an Esc another handler already used does not close the panel', async () => {
    render(true)
    await settle()
    // a composer that cancelled a running request calls preventDefault on its own element first
    host.querySelector('textarea')!.addEventListener('keydown', (e) => e.preventDefault())
    act(() => host.querySelector<HTMLElement>('textarea')!.focus())
    key('Escape')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not steal focus from a text field outside the dock that asked for the panel', async () => {
    const popover = document.createElement('input')
    document.body.append(popover)
    render(false)
    act(() => popover.focus())
    render(true)
    await settle()
    expect(document.activeElement).toBe(popover)
    popover.remove()
  })

  it('side by side (wider than the breakpoint): non-modal, no focus move, Esc left alone', async () => {
    narrow = false
    render(true)
    await settle()
    expect(dock().getAttribute('role')).toBeNull()
    expect(dock().getAttribute('aria-modal')).toBeNull()
    expect(document.activeElement).toBe(document.body)
    act(() => host.querySelector<HTMLElement>('textarea')!.focus())
    key('Escape')
    expect(onClose).not.toHaveBeenCalled()
  })
})
