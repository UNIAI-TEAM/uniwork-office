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
    expect(all.slice(0, 3).map((b) => b.querySelector('.wb-tab-unpin'))).toEqual([null, null, null])
    expect(all[3]!.querySelector('.wb-tab-unpin[aria-label="Unpin tab"]')).not.toBeNull()
    expect(all[4]!.querySelector('.wb-tab-unpin[aria-label="Unpin tab"]')).not.toBeNull()
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
    expect(css).toMatch(/\n\.wb-tab-unpin \{[^}]*\n  opacity: 0;/)
    expect(css).toContain(
      '\n.wb-tab:hover .wb-tab-unpin,\n.wb-tab:focus-within .wb-tab-unpin,\n.wb-tab.active .wb-tab-unpin {\n  opacity: 1;\n}',
    )
    expect(css).toContain(
      '\n.wb-tab-module:hover .wb-tab-grip,\n.wb-tab-module:focus-within .wb-tab-grip,\n.wb-tab-module.active .wb-tab-grip {\n  opacity: 1;\n}',
    )
    expect(css).toMatch(
      /\n\.wb-tab\.active::after \{[^}]*border-radius: 2px;[^}]*background: var\(--accent\);/,
    )
    expect(css).not.toMatch(/\n\.wb-tab \{[^}]*border-bottom:/)
  })
})
