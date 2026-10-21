/** @vitest-environment jsdom */
// The ribbon collapse key comes from the caller's shortcut table (UNI-2011 common-10, docs-086);
// a caller that passes no action keeps the old hard-coded Ctrl+F1 / ⌥⌘R.
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  accessibleShortcutProblems,
  findDisplayChord,
  findShortcut,
  type ShortcutAction,
} from '@genoffice/shortcuts'
import {
  RibbonCollapseButton,
  RibbonExpandButton,
  useRibbonCollapse,
  type RibbonCollapse,
  type RibbonCollapseOptions,
} from '../src/ribbon-collapse'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const common10 = findShortcut('common', 'common-10')!
const docs086 = findShortcut('docs', 'docs-086')!

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let latest: RibbonCollapse

function Ribbon(props: { options?: RibbonCollapseOptions; withCompact?: boolean }) {
  latest = useRibbonCollapse(
    't.shortcut',
    {
      collapse: 'Collapse',
      expand: 'Expand',
      ...(props.withCompact ? { compact: 'Compact', expandFull: 'Full' } : {}),
    },
    props.options,
  )
  return createElement(
    'div',
    { className: latest.rootClass, ref: latest.rootRef },
    createElement(RibbonCollapseButton, { state: latest, label: 'Collapse the ribbon' }),
    createElement(RibbonExpandButton, { state: latest, label: 'Expand the ribbon' }),
  )
}

const mount = (props: Parameters<typeof Ribbon>[0] = {}) =>
  act(() => root.render(createElement(Ribbon, props)))

interface KeyInit {
  key: string
  code?: string
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
  repeat?: boolean
  isComposing?: boolean
  keyCode?: number
  altGraph?: boolean
}

/** dispatch a keydown at the window; returns whether the page prevented it */
function press(init: KeyInit): boolean {
  const { altGraph, ...rest } = init
  const e = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, code: '', ...rest })
  if (altGraph !== undefined) {
    e.getModifierState = (k: string) => k === 'AltGraph' && altGraph
  }
  act(() => {
    window.dispatchEvent(e)
  })
  return e.defaultPrevented
}

const ctrlF1: KeyInit = { key: 'F1', code: 'F1', ctrlKey: true }
const ctrlF3: KeyInit = { key: 'F3', code: 'F3', ctrlKey: true }
const optCmdR: KeyInit = { key: '®', code: 'KeyR', altKey: true, metaKey: true }

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('the default collapse key (no action passed)', () => {
  it('keeps Ctrl+F1 toggling the ribbon', () => {
    mount()
    expect(press(ctrlF1)).toBe(true)
    expect(latest.collapsed).toBe(true)
    expect(press(ctrlF1)).toBe(true)
    expect(latest.collapsed).toBe(false)
  })

  it('ignores a held (auto-repeated) key', () => {
    mount()
    press({ ...ctrlF1, repeat: true })
    expect(latest.collapsed).toBe(false)
  })
})

describe('an action from the caller’s table', () => {
  it('toggles on the desktop chord of common-10 (Windows Ctrl+F1, macOS ⌥⌘R)', () => {
    mount({ options: { action: common10, platform: 'win', surface: 'desktop' } })
    expect(press(ctrlF1)).toBe(true)
    expect(latest.collapsed).toBe(true)
    // the Mac chord does nothing on the Windows table
    expect(press(optCmdR)).toBe(false)
    expect(latest.collapsed).toBe(true)

    mount({ options: { action: common10, platform: 'mac', surface: 'desktop' } })
    localStorage.clear()
    act(() => latest.toggle())
    expect(latest.collapsed).toBe(false)
    expect(press(optCmdR)).toBe(true)
    expect(latest.collapsed).toBe(true)
  })

  it('does not fire a layout-remapped ⌥⌘R without the Mac platform', () => {
    mount({ options: { action: common10, platform: 'win', surface: 'desktop' } })
    expect(press(optCmdR)).toBe(false)
    expect(latest.collapsed).toBe(false)
  })

  it('follows the web chords: Docs web is Ctrl+F3, not Ctrl+F1 (docs-086)', () => {
    mount({ options: { action: docs086, platform: 'win', surface: 'web' } })
    expect(press(ctrlF1)).toBe(false)
    expect(latest.collapsed).toBe(false)
    expect(press(ctrlF3)).toBe(true)
    expect(latest.collapsed).toBe(true)
  })

  it('keeps Ctrl+F1 / ⌥⌘R on the web for the common row (desktop fallback)', () => {
    mount({ options: { action: common10, platform: 'win', surface: 'web' } })
    expect(press(ctrlF1)).toBe(true)
    expect(latest.collapsed).toBe(true)
    mount({ options: { action: common10, platform: 'mac', surface: 'web' } })
    act(() => latest.toggle())
    expect(press(optCmdR)).toBe(true)
  })

  it('lets a caller-supplied chord replace the old key completely', () => {
    const custom: ShortcutAction = {
      id: 'x-1',
      scope: 'common',
      win: ['Ctrl+F2'],
      mac: ['Alt+Cmd+R'],
      match: 'key',
      guard: { noRepeat: true },
    }
    mount({ options: { action: custom, platform: 'win', surface: 'desktop' } })
    expect(press(ctrlF1)).toBe(false)
    expect(latest.collapsed).toBe(false)
    expect(press({ key: 'F2', code: 'F2', ctrlKey: true })).toBe(true)
    expect(latest.collapsed).toBe(true)
  })

  it('honours noRepeat from the row', () => {
    mount({ options: { action: common10, platform: 'win', surface: 'desktop' } })
    expect(press({ ...ctrlF1, repeat: true })).toBe(false)
    expect(latest.collapsed).toBe(false)
  })

  it('does not fire while an IME composition is in progress', () => {
    mount({ options: { action: common10, platform: 'win', surface: 'desktop' } })
    expect(press({ ...ctrlF1, isComposing: true })).toBe(false)
    expect(press({ ...ctrlF1, keyCode: 229 })).toBe(false)
    expect(latest.collapsed).toBe(false)
  })

  it('does not fire a Windows Ctrl+Alt chord while AltGraph is down', () => {
    const ctrlAltR: ShortcutAction = {
      id: 'x-2',
      scope: 'common',
      win: ['Ctrl+Alt+R'],
      mac: [],
      match: 'key',
      guard: { altGraph: true, noRepeat: true },
    }
    mount({ options: { action: ctrlAltR, platform: 'win', surface: 'desktop' } })
    const chord = { key: 'r', code: 'KeyR', ctrlKey: true, altKey: true }
    expect(press({ ...chord, altGraph: true })).toBe(false)
    expect(latest.collapsed).toBe(false)
    expect(press({ ...chord, altGraph: false })).toBe(true)
    expect(latest.collapsed).toBe(true)
  })

  it('persists the toggle like the old key did', () => {
    mount({ options: { action: common10, platform: 'win', surface: 'desktop' } })
    press(ctrlF1)
    expect(localStorage.getItem('t.shortcut')).toBe('1')
  })
})

describe('the compact action', () => {
  const compactRow: ShortcutAction = {
    id: 'docs-087',
    scope: 'docs',
    win: [],
    mac: [],
    web: { win: ['Ctrl+Alt+K'], mac: ['Alt+Cmd+K'] },
    match: 'key',
    guard: { altGraph: true, noRepeat: true },
  }
  const ctrlAltK: KeyInit = { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true, altGraph: false }

  it('cycles compact from the row’s chord and is inert without the labels', () => {
    mount({
      withCompact: true,
      options: { compactAction: compactRow, platform: 'win', surface: 'web' },
    })
    expect(press(ctrlAltK)).toBe(true)
    expect(latest.density).toBe('compact')

    mount({ options: { compactAction: compactRow, platform: 'win', surface: 'web' } })
    expect(press(ctrlAltK)).toBe(false)
  })

  it('does not cycle compact on AltGr+K', () => {
    mount({
      withCompact: true,
      options: { compactAction: compactRow, platform: 'win', surface: 'web' },
    })
    expect(press({ ...ctrlAltK, altGraph: true })).toBe(false)
    expect(latest.density).toBe('full')
  })

  it('does not cycle compact on desktop, where the row has no chord', () => {
    mount({
      withCompact: true,
      options: { compactAction: compactRow, platform: 'win', surface: 'desktop' },
    })
    expect(press(ctrlAltK)).toBe(false)
    expect(latest.density).toBe('full')
  })
})

describe('the shortcut shown in the tips', () => {
  it('comes from the action and the platform / surface', () => {
    mount({ options: { action: docs086, platform: 'win', surface: 'web' } })
    expect(latest.shortcutLabel).toBe('Ctrl+F3')
    expect(latest.tabTip(true)).toBe('Collapse (Ctrl+F3)')
    expect(host.querySelector('.ribbon-collapse-btn')!.getAttribute('data-tip')).toBe(
      'Collapse the ribbon (Ctrl+F3)',
    )

    mount({ options: { action: common10, platform: 'mac', surface: 'desktop' } })
    expect(latest.shortcutLabel).toBe('⌥⌘R')

    mount({ options: { action: common10, platform: 'win', surface: 'desktop' } })
    expect(latest.shortcutLabel).toBe('Ctrl+F1')
  })

  it('omits the parenthesis for a surface with no chord', () => {
    const none: ShortcutAction = { ...common10, win: [], web: { win: [], mac: [] } }
    mount({ options: { action: none, platform: 'win', surface: 'desktop' } })
    expect(latest.shortcutLabel).toBe('')
    expect(latest.tabTip(true)).toBe('Collapse')
  })

  it('falls back to the old label without an action', () => {
    mount()
    expect(latest.shortcutLabel).toMatch(/^(Ctrl\+F1|⌥⌘R)$/)
  })
})

// UNI-2060: the name stays the plain command; the chord goes to aria-keyshortcuts
describe('the accessible name and aria-keyshortcuts', () => {
  const controls = () =>
    [...host.querySelectorAll('button')].map((el) => ({
      el,
      name: el.getAttribute('aria-label') ?? el.textContent ?? '',
      keyshortcuts: el.getAttribute('aria-keyshortcuts'),
    }))

  for (const platform of ['win', 'mac'] as const) {
    for (const surface of ['desktop', 'web'] as const) {
      it(`collapse / expand buttons: plain name, table chord (${platform}, ${surface})`, () => {
        mount({ options: { action: docs086, platform, surface } })
        const [collapse] = controls()
        expect(collapse!.name).toBe('Collapse the ribbon')
        expect(accessibleShortcutProblems(collapse!, docs086, platform, surface)).toEqual([])
        // the tooltip keeps the chord
        expect(collapse!.el.getAttribute('data-tip')).toBe(
          latest.shortcutLabel
            ? `Collapse the ribbon (${latest.shortcutLabel})`
            : 'Collapse the ribbon',
        )
        expect(latest.ariaKeyshortcuts).toBe(collapse!.keyshortcuts ?? '')

        act(() => latest.toggle())
        const [expand] = controls()
        expect(expand!.name).toBe('Expand the ribbon')
        expect(accessibleShortcutProblems(expand!, docs086, platform, surface)).toEqual([])
      })
    }
  }

  it('the tab keyshortcuts follow the tab tips', () => {
    const compactRow: ShortcutAction = {
      id: 'docs-087',
      scope: 'docs',
      win: [],
      mac: [],
      web: { win: ['Ctrl+Alt+K'], mac: ['Alt+Cmd+K'] },
      match: 'key',
      guard: {},
    }
    mount({
      withCompact: true,
      options: { action: docs086, compactAction: compactRow, platform: 'win', surface: 'web' },
    })
    expect(latest.tabKeyshortcuts(false)).toBeUndefined()
    expect(latest.tabKeyshortcuts(true)).toBe('Control+F3 Control+Alt+K')
    act(() => latest.toggleCompact())
    expect(latest.tabKeyshortcuts(true)).toBe('Control+Alt+K')
    act(() => latest.toggle())
    expect(latest.collapsed).toBe(true)
    expect(latest.tabKeyshortcuts(false)).toBe('Control+F3')
  })

  it('falls back to the old chord without an action, never in the name', () => {
    mount({ options: { platform: 'win' } })
    expect(latest.ariaKeyshortcuts).toBe('Control+F1')
    mount({ options: { platform: 'mac' } })
    expect(latest.ariaKeyshortcuts).toBe('Alt+Meta+R')
    for (const c of controls()) expect(findDisplayChord(c.name)).toBeNull()
  })
})
