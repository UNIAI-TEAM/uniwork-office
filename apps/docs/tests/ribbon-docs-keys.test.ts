// UNI-2011: the Docs ribbon collapse / compact keys come from the docs table (docs-086 / docs-087),
// not from the hard-coded pair in the shared hook: Ctrl+F1 on the desktop, Ctrl+F3 in the web frame
// (the browser keeps Ctrl+F1), Ctrl+Alt+K for the compact density on both.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useRibbonCollapse } from '@genoffice/ui'
import type { ShortcutSurface } from '@genoffice/shortcuts'
import { docsShortcut } from '../src/shared/docs-shortcuts'

const LABELS = { collapse: 'Collapse', expand: 'Expand', compact: 'Compact', expandFull: 'Full' }

function Ribbon({ surface }: { surface: ShortcutSurface }) {
  const collapse = useRibbonCollapse('t.docs-keys', LABELS, {
    action: docsShortcut('docs-086'),
    compactAction: docsShortcut('docs-087'),
    surface,
    platform: 'win',
  })
  return createElement(
    'div',
    { className: collapse.rootClass },
    createElement('button', { id: 'tab', 'data-tip': collapse.tabTip(true) }, 'home'),
    createElement('div', { 'data-ribbon-body': '' }),
  )
}

const root = () => document.querySelector('.ribbon-collapsible') as HTMLElement
const collapsed = () => root().classList.contains('ribbon-collapsed')
const compact = () => root().classList.contains('ribbon-compact')

/** dispatches a keydown and reports whether the handler swallowed it */
function press(init: KeyboardEventInit, altGraph = false): boolean {
  const event = new KeyboardEvent('keydown', { cancelable: true, ...init })
  event.getModifierState = (key: string) => key === 'AltGraph' && altGraph
  act(() => {
    window.dispatchEvent(event)
  })
  return event.defaultPrevented
}
const F1 = { key: 'F1', code: 'F1', ctrlKey: true }
const F3 = { key: 'F3', code: 'F3', ctrlKey: true }
const CTRL_ALT_K = { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true }

let unmount: (() => void) | undefined
function mount(surface: ShortcutSurface) {
  localStorage.removeItem('t.docs-keys')
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  unmount = () => act(() => root.unmount())
  act(() => root.render(createElement(Ribbon, { surface })))
}
afterEach(() => unmount?.())

describe('desktop', () => {
  beforeEach(() => mount('desktop'))

  it('Ctrl+F1 collapses, Ctrl+F3 does nothing', () => {
    expect(press(F3)).toBe(false)
    expect(collapsed()).toBe(false)
    expect(press(F1)).toBe(true)
    expect(collapsed()).toBe(true)
  })

  it('Ctrl+Alt+K toggles the compact density; a held key does not repeat', () => {
    expect(press({ ...CTRL_ALT_K, repeat: true })).toBe(false)
    expect(compact()).toBe(false)
    expect(press(CTRL_ALT_K, true)).toBe(false)
    expect(compact()).toBe(false)
    expect(press(CTRL_ALT_K)).toBe(true)
    expect(compact()).toBe(true)
  })

  it('the tip shows the table key', () => {
    expect(document.getElementById('tab')?.dataset.tip).toContain('Collapse (Ctrl+F1)')
    expect(document.getElementById('tab')?.dataset.tip).toContain('Compact (Ctrl+Alt+K)')
  })
})

describe('web frame', () => {
  beforeEach(() => mount('web'))

  it('Ctrl+F3 collapses and leaves Ctrl+F1 to the browser', () => {
    expect(press(F1)).toBe(false)
    expect(collapsed()).toBe(false)
    expect(press(F3)).toBe(true)
    expect(collapsed()).toBe(true)
  })

  it('the tip shows Ctrl+F3', () => {
    expect(document.getElementById('tab')?.dataset.tip).toContain('Collapse (Ctrl+F3)')
  })
})

describe('Ribbon.tsx', () => {
  it('passes the docs rows to the hook and keeps no key listener of its own', () => {
    const source = readFileSync(join(__dirname, '../src/renderer/components/Ribbon.tsx'), 'utf8')
    expect(source).toMatch(/action: docsShortcut\('docs-086'\)/)
    expect(source).toMatch(/compactAction: docsShortcut\('docs-087'\)/)
    expect(source).not.toMatch(/ribbon-toggle/)
  })
})
