/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requirePractice } from '@uniwork/practice-core'

const store = new Map<string, string>()
vi.mock('../src/renderer/src/workbench-store-client', () => ({
  wbStoreGetRaw: (key: string) => store.get(key) ?? null,
  wbStoreSetRaw: (key: string, value: string) => {
    store.set(key, value)
  },
  wbStoreRemove: (key: string) => {
    store.delete(key)
  },
  wbStoreRead: <T>(key: string, fallback: T): T => {
    const raw = store.get(key)
    return raw === undefined ? fallback : (JSON.parse(raw) as T)
  },
  wbStoreWrite: (key: string, value: unknown) => {
    store.set(key, JSON.stringify(value))
  },
}))

import { LocaleProvider } from '../src/renderer/src/locale'
import { WorkbenchTabs } from '../src/renderer/src/WorkbenchTabs'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

type Props = Parameters<typeof WorkbenchTabs>[0]

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  store.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function mount(over: Partial<Props> = {}): Promise<void> {
  const props: Props = {
    practiceId: 'sales',
    pillars: requirePractice('sales').pillars,
    active: 'desk',
    onSelect: () => {},
    vi: false,
    ...over,
  }
  await act(async () => {
    root.render(
      createElement(LocaleProvider, { initial: 'en' }, createElement(WorkbenchTabs, props)),
    )
  })
}

// pinned module tabs first (core order desk, tasks, calendar), then pinned pillars
const tabs = () => Array.from(host.querySelectorAll<HTMLButtonElement>('.wb-tab-module'))

describe('Workbench tab counts', () => {
  it('shows each count after the label, with a sentence for screen readers', async () => {
    await mount({
      counts: {
        tasks: { n: 3, key: 'wbTabCountOverdue', tone: 'danger' },
        calendar: { n: 2, key: 'wbTabCountMeetings', tone: 'muted' },
      },
    })
    const [desk, tasks, calendar] = tabs()
    expect(desk!.querySelector('.wb-tab-count')).toBeNull()
    const badge = tasks!.querySelector('.wb-tab-count')!
    expect(badge.textContent).toBe('3')
    // a pill: danger when tasks are overdue, neutral otherwise
    expect(badge.className).toBe('wb-tab-count wb-num is-danger')
    expect(badge.getAttribute('aria-hidden')).toBe('true')
    expect(tasks!.querySelector('.uw-sr-only')?.textContent).toBe('Overdue tasks: 3')
    expect(calendar!.querySelector('.wb-tab-count')?.className).toBe('wb-tab-count wb-num is-muted')
    expect(calendar!.querySelector('.uw-sr-only')?.textContent).toBe('Meetings today: 2')
  })

  it('shows no count when it is given none', async () => {
    await mount()
    expect(host.querySelector('.wb-tab-count')).toBeNull()
    expect(host.querySelector('.wb-tab .uw-sr-only')).toBeNull()
  })
})

describe('Workbench tab unpin', () => {
  it('core tabs have no unpin button; a pinned module and a pinned pillar do', async () => {
    store.set('uniwork.wb.pins.sales', JSON.stringify(['desk', 'tasks', 'calendar', 'personal']))
    store.set('uniwork.wb.pillarPins.sales', JSON.stringify(['knowledge']))
    await mount()
    const all = tabs()
    expect(all).toHaveLength(5)
    const unpinOf = (tab: HTMLButtonElement) =>
      tab.parentElement!.querySelector<HTMLButtonElement>(':scope > .wb-tab-unpin')
    expect(all.slice(0, 3).map(unpinOf)).toEqual([null, null, null])
    expect(unpinOf(all[3]!)?.getAttribute('aria-label')).toBe('Unpin tab: Profile')
    expect(unpinOf(all[4]!)?.getAttribute('aria-label')).toBe('Unpin tab: Knowledge')
  })

  it('unpin is its own button beside the tab, never nested inside the tab button', async () => {
    store.set('uniwork.wb.pins.sales', JSON.stringify(['desk', 'tasks', 'calendar', 'personal']))
    store.set('uniwork.wb.pillarPins.sales', JSON.stringify(['knowledge']))
    const onSelect = vi.fn()
    await mount({ onSelect, active: 'personal' })
    // no interactive content inside a tab button
    for (const tab of tabs()) {
      expect(tab.querySelector('button, [role="button"], [tabindex]')).toBeNull()
    }
    const unpins = Array.from(host.querySelectorAll<HTMLButtonElement>('.wb-tab-unpin'))
    expect(unpins).toHaveLength(2)
    for (const u of unpins) {
      expect(u.tagName).toBe('BUTTON')
      expect(u.type).toBe('button')
      expect(u.closest('.wb-tab')).toBeNull()
      expect(u.previousElementSibling?.classList.contains('wb-tab')).toBe(true)
    }
    // unpinning the open tab goes back to the Desk, and the tab is gone
    await act(async () => unpins[0]!.click())
    expect(onSelect).toHaveBeenCalledWith('desk')
    expect(tabs().map((b) => b.textContent)).not.toContain('Profile')
  })

  it('Alt+arrow moves a focused non-core tab; core tabs stay put', async () => {
    store.set(
      'uniwork.wb.pins.sales',
      JSON.stringify(['desk', 'tasks', 'calendar', 'personal', 'notes']),
    )
    await mount()
    const ids = () => tabs().map((b) => b.dataset.tabId)
    const press = (el: HTMLElement, key: string) =>
      act(() => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key, altKey: true, bubbles: true }))
      })
    const notes = tabs()[4]!
    notes.focus()
    press(notes, 'ArrowLeft')
    expect(ids()).toEqual(['desk', 'tasks', 'calendar', 'notes', 'personal'])
    expect(JSON.parse(store.get('uniwork.wb.pins.sales')!)).toEqual([
      'desk',
      'tasks',
      'calendar',
      'notes',
      'personal',
    ])
    // focus stays on the moved tab
    expect(document.activeElement).toBe(tabs()[3])
    press(tabs()[3]!, 'ArrowRight')
    expect(ids()).toEqual(['desk', 'tasks', 'calendar', 'personal', 'notes'])
    // nor does a non-core tab swap places with a core neighbour (spec 3)
    press(tabs()[3]!, 'ArrowLeft')
    expect(ids()).toEqual(['desk', 'tasks', 'calendar', 'personal', 'notes'])
    // a core tab does not move
    press(tabs()[1]!, 'ArrowRight')
    expect(ids()).toEqual(['desk', 'tasks', 'calendar', 'personal', 'notes'])
    // the last tab has no right neighbour
    press(tabs()[4]!, 'ArrowRight')
    expect(ids()).toEqual(['desk', 'tasks', 'calendar', 'personal', 'notes'])
  })

  it('marks only the active tab, module or pillar, with aria-current="page"', async () => {
    store.set('uniwork.wb.pillarPins.sales', JSON.stringify(['knowledge']))
    await mount({ active: 'tasks' })
    expect(tabs().map((b) => b.getAttribute('aria-current'))).toEqual([null, 'page', null, null])
    await mount({ active: 'knowledge' })
    expect(tabs().map((b) => b.getAttribute('aria-current'))).toEqual([null, null, null, 'page'])
  })

  it('CSS hides unpin and the grip until hover, focus or selection, and rounds the underline', () => {
    const css = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
    expect(css).toMatch(/\n\.wb-tab-unpin \{[^}]*\n {2}opacity: 0;/)
    expect(css).toContain(
      '\n.wb-tab-item:hover .wb-tab-unpin,\n.wb-tab-item:focus-within .wb-tab-unpin,\n.wb-tab-item .wb-tab.active + .wb-tab-unpin {\n  opacity: 1;\n}',
    )
    expect(css).toContain(
      '\n.wb-tab-module:hover .wb-tab-grip,\n.wb-tab-module:focus-visible .wb-tab-grip,\n.wb-tab-module.active .wb-tab-grip {\n  opacity: 1;\n}',
    )
    expect(css).toMatch(
      /\n\.wb-tab\.active::after \{[^}]*border-radius: 2px;[^}]*background: var\(--accent\);/,
    )
    expect(css).not.toMatch(/\n\.wb-tab \{[^}]*border-bottom:/)
  })
})

describe('Workbench tab row (one row, scrolls sideways)', () => {
  const css = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
  const rule = (selector: string) => {
    const start = css.indexOf(`\n${selector} {\n`)
    expect(start, selector).toBeGreaterThanOrEqual(0)
    return css.slice(start, css.indexOf('\n}', start + 1))
  }

  it('tabs sit in a scroller; + stays outside it at the end of the bar', async () => {
    store.set('uniwork.wb.pillarPins.sales', JSON.stringify(['knowledge']))
    await mount()
    const nav = host.querySelector('nav.wb-tabs')!
    const scroller = nav.querySelector(':scope > .wb-tabs-scroll')!
    expect(scroller.querySelectorAll('.wb-tab-module')).toHaveLength(tabs().length)
    expect(scroller.querySelector('.wb-tab-add')).toBeNull()
    expect(nav.lastElementChild?.className).toBe('wb-menu-wrap')
    expect(nav.lastElementChild?.querySelector('.wb-tab-add')).not.toBeNull()
  })

  it('scrolls the selected tab into view when the selection changes', async () => {
    const scrollIntoView = vi.fn()
    const had = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      await mount({ active: 'desk' })
      scrollIntoView.mockClear()
      await mount({ active: 'calendar' })
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(scrollIntoView.mock.contexts[0]).toBe(tabs()[2])
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
    } finally {
      if (had) Object.defineProperty(Element.prototype, 'scrollIntoView', had)
      else delete (Element.prototype as Partial<Element>).scrollIntoView
    }
  })

  it('a vertical wheel scrolls the row sideways only when it overflows', async () => {
    await mount()
    const scroller = host.querySelector<HTMLDivElement>('.wb-tabs-scroll')!
    const wheel = (deltaX: number, deltaY: number) => {
      const e = new WheelEvent('wheel', { deltaX, deltaY, cancelable: true })
      scroller.dispatchEvent(e)
      return e.defaultPrevented
    }
    // jsdom lays nothing out: widths are 0, so the row does not overflow
    expect(wheel(0, 40)).toBe(false)
    expect(scroller.scrollLeft).toBe(0)
    Object.defineProperty(scroller, 'scrollWidth', { value: 900, configurable: true })
    Object.defineProperty(scroller, 'clientWidth', { value: 400, configurable: true })
    expect(wheel(0, 40)).toBe(true)
    expect(scroller.scrollLeft).toBe(40)
    // a sideways trackpad swipe is left to the browser
    expect(wheel(30, 5)).toBe(false)
  })

  it('a vertical wheel at either end of the row is left to the page', async () => {
    await mount()
    const scroller = host.querySelector<HTMLDivElement>('.wb-tabs-scroll')!
    Object.defineProperty(scroller, 'scrollWidth', { value: 900, configurable: true })
    Object.defineProperty(scroller, 'clientWidth', { value: 400, configurable: true })
    // clamp like a browser: scrollLeft stays within 0..scrollWidth-clientWidth
    let left = 0
    Object.defineProperty(scroller, 'scrollLeft', {
      configurable: true,
      get: () => left,
      set: (v: number) => {
        left = Math.max(0, Math.min(500, v))
      },
    })
    const wheel = (deltaY: number) => {
      const e = new WheelEvent('wheel', { deltaY, cancelable: true })
      scroller.dispatchEvent(e)
      return e.defaultPrevented
    }
    expect(wheel(-40)).toBe(false) // already at the start
    expect(wheel(40)).toBe(true)
    expect(left).toBe(40)
    left = 500
    expect(wheel(40)).toBe(false) // already at the end
    expect(left).toBe(500)
    expect(wheel(-40)).toBe(true)
    expect(left).toBe(460)
  })

  it('CSS: the bar never wraps; the scroller hides its bar and keeps the underline on the border', () => {
    expect(rule('.wb-tabs')).not.toMatch(/flex-wrap/)
    const scroller = rule('.wb-tabs-scroll')
    expect(scroller).toMatch(/overflow-x: auto;/)
    expect(scroller).toMatch(/scrollbar-width: none;/)
    expect(scroller).toMatch(/margin-bottom: -1px;/)
    expect(rule('.wb-menu-wrap')).toMatch(/flex: none;/)
  })

  it('CSS: a 40px tab as wide as its label; the grip and the 24px unpin overlay the side padding', () => {
    const tab = rule('.wb-tab')
    expect(tab).toMatch(/flex: none;/)
    expect(tab).toMatch(/height: 40px;/)
    expect(tab).toMatch(/white-space: nowrap;/)
    expect(tab).not.toMatch(/min-width/)
    expect(rule('.wb-tab-grip')).toMatch(/position: absolute;/)
    const unpin = rule('.wb-tab-unpin')
    expect(unpin).toMatch(/position: absolute;/)
    // a 24px target (WCAG 2.5.8) inside the tab's 30px right padding
    expect(unpin).toMatch(/width: 24px;\n {2}height: 24px;/)
    expect(rule('.wb-tab-item.has-unpin > .wb-tab')).toMatch(/padding-right: 30px;/)
  })

  it('an overflowing row fades its clipped edges and offers step buttons', async () => {
    await mount()
    const scroller = host.querySelector<HTMLDivElement>('.wb-tabs-scroll')!
    expect(scroller.className).toBe('wb-tabs-scroll')
    expect(host.querySelector('.wb-tabs-step')).toBeNull()
    Object.defineProperty(scroller, 'scrollWidth', { value: 900, configurable: true })
    Object.defineProperty(scroller, 'clientWidth', { value: 400, configurable: true })
    await act(async () => scroller.dispatchEvent(new Event('scroll')))
    expect(scroller.className).toBe('wb-tabs-scroll is-fade-end')
    const steps = host.querySelectorAll<HTMLButtonElement>('.wb-tabs-step')
    expect(steps).toHaveLength(1)
    // a mouse affordance: keyboard users reach every tab by Tab, which scrolls it into view
    expect(steps[0]!.tabIndex).toBe(-1)
    scroller.scrollLeft = 200
    await act(async () => scroller.dispatchEvent(new Event('scroll')))
    expect(scroller.className).toBe('wb-tabs-scroll is-fade-start is-fade-end')
    expect(host.querySelectorAll('.wb-tabs-step')).toHaveLength(2)
    expect(rule('.wb-tabs-scroll.is-fade-end')).toMatch(/mask-image: linear-gradient/)
  })
})
