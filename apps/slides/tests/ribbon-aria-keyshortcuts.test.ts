// UNI-2060: a ribbon button's accessible name is the plain command name; the chord goes into
// aria-keyshortcuts (from the same @genoffice/shortcuts row) and stays in the visible tooltip.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  ariaKeyshortcuts,
  findDisplayChord,
  findShortcut,
  type ShortcutPlatform,
} from '@genoffice/shortcuts'

vi.mock('react-konva', () => {
  const stub = () => null
  return { Stage: stub, Layer: stub, Rect: stub, Group: stub, Line: stub, Text: stub, Image: stub }
})

import { Ribbon } from '../src/renderer/components/Ribbon'
import { ContextMenu } from '../src/renderer/components/ContextMenu'
import { LocaleProvider, setModuleLang } from '../src/renderer/i18n/locale'
import { resetForTest } from '../src/renderer/capabilities'
import { shortcutSurface, slidesHint } from '../src/renderer/shortcuts'

const here = dirname(fileURLToPath(import.meta.url))

/** every prop name Ribbon destructures, so the test renders it like App does */
function ribbonProps(): Record<string, unknown> {
  const src = readFileSync(join(here, '../src/renderer/components/Ribbon.tsx'), 'utf8')
  const head = src.slice(src.indexOf('export function Ribbon({'), src.indexOf('}: Props) {'))
  const names = [...head.matchAll(/^ {2}([A-Za-z0-9]+),?$/gm)].map((m) => m[1]!)
  const props: Record<string, unknown> = {}
  for (const n of names) props[n] = /^on[A-Z]/.test(n) ? vi.fn() : undefined
  return {
    ...props,
    hasDoc: true,
    deckEmpty: false,
    dirty: true,
    zoom: 1,
    selectedIds: [],
    collapsedGroups: [],
    autoSave: false,
    showThumbs: true,
    canUndo: true,
    canRedo: true,
  }
}

let root: Root | null = null
let container: HTMLElement | null = null

function mount(): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  setModuleLang('en')
  act(() =>
    root!.render(
      createElement(LocaleProvider, {
        initial: 'en',
        children: createElement(Ribbon as never, ribbonProps() as never) as never,
      }),
    ),
  )
  return container
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  ;(window as unknown as { slidesApi?: unknown }).slidesApi = new Proxy(
    {},
    {
      get: (_obj, key: string) =>
        key === 'capabilities'
          ? undefined
          : key.startsWith('on')
            ? () => () => {}
            : () => Promise.resolve(undefined),
    },
  )
  resetForTest()
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** the accessible name: aria-label, else the text without aria-hidden parts */
function nameOf(el: Element): string {
  const label = el.getAttribute('aria-label')
  if (label !== null) return label
  const clone = el.cloneNode(true) as Element
  clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove())
  return (clone.textContent ?? '').trim()
}

const fileTab = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.ribbon-tab-file')!
const otherTabs = (el: HTMLElement) => [
  ...el.querySelectorAll<HTMLButtonElement>('.ribbon-tab:not(.ribbon-tab-file)'),
]

/** every control the ribbon shows on each tab and in the open File menu */
function allControls(el: HTMLElement): Element[] {
  const out: Element[] = []
  const grab = () => out.push(...el.querySelectorAll('button, [role="menuitem"], [role="tab"]'))
  act(() => fileTab(el).click())
  grab()
  act(() => fileTab(el).click())
  expect(otherTabs(el).length).toBeGreaterThan(3)
  for (const tab of otherTabs(el)) {
    act(() => tab.click())
    grab()
  }
  return out
}

describe.each<ShortcutPlatform>(['win', 'mac'])(
  'Slides ribbon accessible names (%s)',
  (platform) => {
    beforeEach(() => {
      vi.spyOn(navigator, 'platform', 'get').mockReturnValue(
        platform === 'mac' ? 'MacIntel' : 'Win32',
      )
    })

    it('no ribbon control carries a chord in its accessible name', () => {
      const controls = allControls(mount())
      expect(controls.length).toBeGreaterThan(40)
      // the shared collapse / expand buttons live in packages/ui and are covered by its own lock test
      const own = controls.filter((c) => !c.matches('.ribbon-collapse-btn, .ribbon-expand-btn'))
      const bad = own
        .map((c) => ({ name: nameOf(c), tag: c.outerHTML.slice(0, 120) }))
        .filter(({ name }) => findDisplayChord(name) !== null)
      expect(bad).toEqual([])
    })

    it('table-bound quick-access and File menu buttons carry the platform aria-keyshortcuts', () => {
      const el = mount()
      const surface = shortcutSurface()
      const want = (id: string) => ariaKeyshortcuts(findShortcut('slides', id)!, platform, surface)
      const qa = (prefix: string) =>
        el.querySelector<HTMLElement>(`.qa-btn[data-tip^="${prefix}"]`)!
      expect(qa('Save').getAttribute('aria-keyshortcuts')).toBe(want('slides-03'))
      expect(qa('Undo').getAttribute('aria-keyshortcuts')).toBe(want('slides-07'))
      expect(qa('Redo').getAttribute('aria-keyshortcuts')).toBe(want('slides-08'))
      // the visible tooltip keeps its hand-written chord (it follows the i18n layer's platform)
      expect(qa('Save').getAttribute('data-tip')).toMatch(/^Save \(.+\)$/)

      act(() => fileTab(el).click())
      const menu = (label: string) =>
        [...el.querySelectorAll<HTMLElement>('.file-menu button')].find((b) =>
          nameOf(b).startsWith(label),
        )!
      expect(menu('Open').getAttribute('aria-keyshortcuts')).toBe(want('slides-02'))
      expect(menu('Print').getAttribute('aria-keyshortcuts')).toBe(want('slides-05'))
    })

    it('every ScreenTip key (data-tip-kbd) has its chord in aria-keyshortcuts', () => {
      const el = mount()
      const surface = shortcutSurface()
      const want = (...ids: string[]) =>
        ids.map((id) => ariaKeyshortcuts(findShortcut('slides', id)!, platform, surface)).join(' ')
      const byKbd = new Map<string, string>([
        [slidesHint('slides-14', platform), want('slides-14')],
        [slidesHint('slides-22', platform), want('slides-22')],
        [slidesHint('slides-23', platform), want('slides-23')],
        [slidesHint('slides-60', platform), want('slides-60')],
        // Format Painter: copy format / paste format
        [
          `${slidesHint('slides-11', platform)} / ${slidesHint('slides-12', platform)}`,
          want('slides-11', 'slides-12'),
        ],
      ])
      const seen: string[] = []
      for (const tab of otherTabs(el)) {
        act(() => tab.click())
        for (const tipped of el.querySelectorAll('[data-tip-kbd]')) {
          const kbd = tipped.getAttribute('data-tip-kbd')!
          seen.push(kbd)
          const keys = tipped.getAttribute('aria-keyshortcuts')
          expect(keys, `${nameOf(tipped)} (${kbd})`).toBeTruthy()
          if (byKbd.has(kbd)) expect(keys).toBe(byKbd.get(kbd))
        }
      }
      expect(seen.length).toBeGreaterThan(3)
    })
  },
)

describe('Slides context menu', () => {
  it('the hint is hidden from the name; a table-bound item carries aria-keyshortcuts', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() =>
      root!.render(
        createElement(ContextMenu, {
          x: 0,
          y: 0,
          onClose: () => {},
          items: [
            { label: 'Cut', hint: '⌘X' },
            { label: 'Group', hint: 'Ctrl+G', keys: 'Control+G' },
          ],
        }),
      ),
    )
    const items = [...container.querySelectorAll<HTMLElement>('.ctx-item')]
    expect(items.map(nameOf)).toEqual(['Cut', 'Group'])
    expect(items.map((i) => i.getAttribute('aria-keyshortcuts'))).toEqual([null, 'Control+G'])
    expect(items[1]!.querySelector('.ctx-hint')!.textContent).toBe('Ctrl+G')
  })
})
