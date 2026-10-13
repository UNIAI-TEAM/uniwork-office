/**
 * @vitest-environment jsdom
 */
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
const TODAY = localIsoDate(new Date())
const inOneHour = new Date(Date.now() + 3_600_000)
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
    const labels = Array.from(host.querySelectorAll('.wb-agenda-icon')).map((n) =>
      n.getAttribute('aria-label'),
    )
    expect(labels).toEqual(['Task', 'Meeting'])
    expect(host.textContent).toContain('All day')
    expect(host.textContent).toContain('Today')
  })

  it('a row opens the item on the web', async () => {
    await mount()
    const meeting = Array.from(host.querySelectorAll<HTMLButtonElement>('.wb-agenda-row')).find(
      (b) => b.textContent?.includes('Weekly sync'),
    )!
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
    expect(host.querySelector('.wb-agenda-icon')?.getAttribute('aria-label')).toBe(
      'External calendar',
    )
    expect(host.textContent).toContain('Renew licence')
    const row = host.querySelector<HTMLButtonElement>('.wb-agenda-row')!
    await act(async () => row.click())
    expect(api.openWeb).toHaveBeenCalledWith({ kind: 'calendar', orgSlug: 'acme', wsSlug: 'ops' })
  })
})
