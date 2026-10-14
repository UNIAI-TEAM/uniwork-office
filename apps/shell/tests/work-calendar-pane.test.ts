/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkWorkspaceRef } from '../src/shared/home-api'
import type { WorkCalendarEvent } from '../src/shared/uniwork-work-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { WorkCalendarPane } from '../src/renderer/src/WorkCalendarPane'
import { agendaRequest } from '../src/renderer/src/work-calendar'
import { localIsoDate } from '../src/renderer/src/work-tasks'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const WS: UniworkWorkspaceRef = { id: 'w1', name: 'Ops', orgId: 'o1', slug: 'ops', orgSlug: 'acme' }
// A fixed morning, so "in one hour" never crosses midnight on a CI clock.
const NOW = new Date(2026, 9, 15, 10, 0)
const TODAY = localIsoDate(NOW)
const inOneHour = new Date(NOW.getTime() + 3_600_000)
const EVENTS: WorkCalendarEvent[] = [
  {
    id: 'task:t1',
    kind: 'task',
    entity_id: 't1',
    title: 'File the report',
    start: TODAY,
    all_day: true,
  },
  {
    id: 'meeting:m1',
    kind: 'meeting',
    entity_id: 'm1',
    title: 'Weekly sync',
    start: inOneHour.toISOString(),
    all_day: false,
  },
]

let host: HTMLDivElement
let root: Root
const api = {
  calendarEvents: vi.fn(async () => ({ ok: true as const, value: EVENTS })),
  openWeb: vi.fn(async () => true),
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  api.calendarEvents.mockClear()
  api.openWeb.mockClear()
  ;(window as unknown as { uniworkWork: unknown }).uniworkWork = api
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(WorkCalendarPane, {
          workspace: WS,
          workspaceError: null,
          onReload: () => undefined,
        }),
      ),
    )
  })
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

describe('Calendar tab', () => {
  it('asks for my 14 days plus a day on each side and tells tasks from meetings', async () => {
    await mount()
    expect(api.calendarEvents).toHaveBeenCalledWith({ workspaceId: 'w1', ...agendaRequest(TODAY) })
    // the kind is a tinted bar plus its name in the sub-line (no tick icon that reads as "done")
    const bars = Array.from(host.querySelectorAll('.wb-agenda-bar')).map((n) => n.className)
    expect(bars).toEqual(['wb-agenda-bar is-task', 'wb-agenda-bar is-meeting'])
    const subs = Array.from(host.querySelectorAll('.wb-agenda-row .wb-row-sub')).map(
      (n) => n.textContent,
    )
    expect(subs).toEqual(['Task', 'Meeting'])
    expect(host.querySelector('.wb-agenda-row svg')).toBeNull()
    expect(host.textContent).toContain('All day')
    expect(host.textContent).toContain('Today')
  })

  it('a row title opens the item on the web', async () => {
    await mount()
    const meeting = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.wb-agenda-row .wb-row-title'),
    ).find((b) => b.textContent?.includes('Weekly sync'))!
    await act(async () => meeting.click())
    expect(api.openWeb).toHaveBeenCalledWith({
      kind: 'meeting',
      orgSlug: 'acme',
      wsSlug: 'ops',
      id: 'm1',
    })
  })

  it('an event kind the desktop does not know shows as external and opens the web calendar', async () => {
    api.calendarEvents.mockResolvedValueOnce({
      ok: true,
      value: [
        {
          id: 'x:1',
          kind: 'reminder',
          entity_id: 'r1',
          title: 'Renew licence',
          start: TODAY,
          all_day: true,
        },
      ],
    })
    await mount()
    expect(host.querySelector('.wb-agenda-bar')?.classList.contains('is-external')).toBe(true)
    expect(host.querySelector('.wb-agenda-row .wb-row-sub')?.textContent).toBe('External calendar')
    expect(host.textContent).toContain('Renew licence')
    const title = host.querySelector<HTMLButtonElement>('.wb-agenda-row .wb-row-title')!
    await act(async () => title.click())
    expect(api.openWeb).toHaveBeenCalledWith({ kind: 'calendar', orgSlug: 'acme', wsSlug: 'ops' })
  })

  it('one card; day heads are sticky heads with a count; today has the dot', async () => {
    await mount()
    expect(host.querySelectorAll('.wb-block')).toHaveLength(1)
    expect(host.querySelector('.wb-block')!.classList.contains('wb-agenda')).toBe(true)
    const head = host.querySelector('.wb-agenda-day > h3')!
    expect(head.classList.contains('wb-agenda-head')).toBe(true)
    expect(head.classList.contains('is-today')).toBe(true)
    expect(head.querySelector('.wb-agenda-dot')).not.toBeNull()
    expect(head.querySelector('strong')?.textContent).toBe('Today')
    expect(head.querySelector('.wb-agenda-head-count')?.textContent).toBe('Items: 2')
  })

  it('times lead the row in the text face (600, tabular), never mono; All day is a chip', async () => {
    await mount()
    const rows = Array.from(host.querySelectorAll('.wb-agenda-row'))
    for (const row of rows) {
      expect(row.firstElementChild?.classList.contains('wb-agenda-time')).toBe(true)
    }
    expect(host.querySelector('.wb-agenda-time.wb-mono, .wb-agenda-row .wb-mono')).toBeNull()
    expect(host.querySelector('.wb-agenda-time .wb-agenda-allday')?.textContent).toBe('All day')
    const css = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
    const rule = (sel: string) =>
      css.slice(css.indexOf(`\n${sel} {\n`), css.indexOf('\n}', css.indexOf(`\n${sel} {\n`)))
    expect(rule('.wb-agenda-time')).toMatch(
      /font-weight: 600;\n {2}font-variant-numeric: tabular-nums;/,
    )
  })

  it('the sticky day head sits at top: 0 of the scroll area, with no negative offset', () => {
    const css = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
    const at = css.indexOf('\n.wb-agenda-head {\n')
    const head = css.slice(at, css.indexOf('\n}', at))
    expect(head).toMatch(/position: sticky;\n {2}top: 0;/)
    expect(head).not.toMatch(/top: -/)
    // overflow: hidden on the card would make it the sticky container and the heads would never stick
    const card = css.slice(
      css.indexOf('\n.wb-agenda {\n'),
      css.indexOf('\n}', css.indexOf('\n.wb-agenda {\n')),
    )
    expect(card).toMatch(/overflow: clip;/)
  })

  // mid-morning: no row of these tests can fall on yesterday, so every assert runs
  const atTenAm = () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 15, 10, 0))
    return Date.now()
  }
  afterEach(() => vi.useRealTimers())

  it('a meeting under way: success pill and Join opens the room; an ended one is quieter', async () => {
    const now = atTenAm()
    api.calendarEvents.mockResolvedValueOnce({
      ok: true,
      value: [
        {
          id: 'meeting:live',
          kind: 'meeting',
          entity_id: 'live',
          title: 'Stand-up',
          start: new Date(now - 600_000).toISOString(),
          end: new Date(now + 1_800_000).toISOString(),
          all_day: false,
        },
        {
          id: 'meeting:past',
          kind: 'meeting',
          entity_id: 'past',
          title: 'Early review',
          start: new Date(now - 2_100_000).toISOString(),
          end: new Date(now - 300_000).toISOString(),
          all_day: false,
        },
      ],
    })
    await mount()
    const row = (title: string) =>
      Array.from(host.querySelectorAll('.wb-agenda-row')).find((r) =>
        r.textContent?.includes(title),
      )
    const live = row('Stand-up')!
    expect(live).toBeTruthy()
    {
      expect(live.querySelector('.wb-pill.is-success')?.textContent).toBe('In progress')
      expect(live.querySelector('.wb-agenda-dur')?.textContent).toBe('40 min')
      const join = Array.from(live.querySelectorAll('button')).find(
        (b) => b.textContent === 'Join',
      )!
      expect(join.className).toBe('wb-btn wb-btn-secondary wb-btn-sm')
      // each Join names its meeting in a screen reader's list of buttons
      expect(join.getAttribute('aria-label')).toBe('Join: Stand-up')
      await act(async () => join.click())
      expect(api.openWeb).toHaveBeenCalledWith({
        kind: 'room',
        orgSlug: 'acme',
        wsSlug: 'ops',
        id: 'live',
      })
    }
    const past = row('Early review')!
    expect(past).toBeTruthy()
    {
      expect(past.classList.contains('is-past')).toBe(true)
      expect(past.querySelector('.wb-row-sub')?.textContent).toBe('Meeting · Ended')
      expect(past.querySelector('button.wb-btn')).toBeNull()
    }
  })

  it('a meeting inside its slot is not live when the server says it is not running (C-I2)', async () => {
    const now = atTenAm()
    const slot = (id: string, status: string) => ({
      id: `meeting:${id}`,
      kind: 'meeting',
      entity_id: id,
      title: `Meeting ${id}`,
      start: new Date(now - 60_000).toISOString(),
      end: new Date(now + 1_800_000).toISOString(),
      all_day: false,
      status,
    })
    api.calendarEvents.mockResolvedValueOnce({
      ok: true,
      value: [slot('ended', 'ENDED'), slot('scheduled', 'SCHEDULED'), slot('on', 'IN_PROGRESS')],
    })
    await mount()
    const row = (title: string) =>
      Array.from(host.querySelectorAll('.wb-agenda-row')).find((r) =>
        r.textContent?.includes(title),
      )
    for (const title of ['Meeting ended', 'Meeting scheduled']) {
      expect(row(title)!.querySelector('.wb-pill.is-success')).toBeNull()
      expect(
        Array.from(row(title)!.querySelectorAll('button')).some((b) => b.textContent === 'Join'),
      ).toBe(false)
    }
    expect(row('Meeting on')!.querySelector('.wb-pill.is-success')?.textContent).toBe('In progress')
    // ended early: muted and marked ended, not read as an upcoming meeting
    expect(row('Meeting ended')!.classList.contains('is-past')).toBe(true)
    expect(row('Meeting ended')!.querySelector('.wb-row-sub')?.textContent).toBe('Meeting · Ended')
    expect(row('Meeting scheduled')!.classList.contains('is-past')).toBe(false)
  })

  it('live and ended follow the clock while the tab stays open', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date(2026, 9, 15, 10, 0))
    const now = Date.now()
    api.calendarEvents.mockResolvedValueOnce({
      ok: true,
      value: [
        {
          id: 'meeting:soon',
          kind: 'meeting',
          entity_id: 'soon',
          title: 'Short sync',
          start: new Date(now - 600_000).toISOString(),
          end: new Date(now + 90_000).toISOString(),
          all_day: false,
        },
      ],
    })
    await mount()
    const row = () => host.querySelector('.wb-agenda-row')!
    expect(row().querySelector('.wb-pill.is-success')).not.toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(120_000)
    })
    expect(row().querySelector('.wb-pill.is-success')).toBeNull()
    expect(row().classList.contains('is-past')).toBe(true)
  })

  it('with a head: the toolbar says 14 days and the item count, the legend, and opens the web calendar', async () => {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(WorkCalendarPane, {
            workspace: WS,
            workspaceError: null,
            onReload: () => undefined,
            head: { title: 'Calendar', summary: 'Due tasks and meetings' },
          }),
        ),
      )
    })
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
    const text = host.querySelector('.wb-toolbar-text')!
    expect(text.querySelector('strong')?.textContent).toBe('Next 14 days')
    expect(text.textContent).toContain(' · Items: 2')
    const legend = text.querySelector('.wb-agenda-legend[role="group"]')!
    expect(legend.getAttribute('aria-label')).toBe('Legend')
    expect(
      Array.from(legend.querySelectorAll('.wb-agenda-swatch')).map((s) => s.className),
    ).toEqual([
      'wb-agenda-swatch is-meeting',
      'wb-agenda-swatch is-task',
      'wb-agenda-swatch is-external',
    ])
    const web = host.querySelector<HTMLButtonElement>('.wb-toolbar-actions .wb-btn-ghost')!
    expect(web.textContent).toBe('Open calendar on the web')
    await act(async () => web.click())
    expect(api.openWeb).toHaveBeenCalledWith({ kind: 'calendar', orgSlug: 'acme', wsSlug: 'ops' })
  })

  it('nothing in the next 14 days: the empty state panel', async () => {
    api.calendarEvents.mockResolvedValueOnce({ ok: true as const, value: [] })
    await mount()
    expect(host.querySelector('.wb-state')?.textContent).toContain(
      'No tasks or meetings in the next 14 days',
    )
    expect(host.querySelector('.wb-work-state')).toBeNull()
  })
})
