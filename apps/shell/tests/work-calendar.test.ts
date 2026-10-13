import { describe, expect, it } from 'vitest'
import type { WorkCalendarEvent } from '../src/shared/uniwork-work-api'
import {
  agendaRange,
  agendaRequest,
  eventDay,
  groupAgenda,
} from '../src/renderer/src/work-calendar'

const ev = (
  id: string,
  start: string,
  allDay: boolean,
  kind = 'task',
  title = id,
  end?: string,
): WorkCalendarEvent => ({
  id,
  kind,
  entity_id: id,
  title,
  start,
  all_day: allDay,
  ...(end ? { end } : {}),
})

/** run with the device clock in `tz` (Node re-reads TZ when it is assigned) */
function inZone(tz: string, run: () => void): void {
  const before = process.env.TZ
  process.env.TZ = tz
  try {
    run()
  } finally {
    if (before === undefined) delete process.env.TZ
    else process.env.TZ = before
  }
}

describe('agendaRange and agendaRequest', () => {
  it('shows 14 days starting today, both ends inclusive', () => {
    expect(agendaRange('2026-10-13')).toEqual({ from: '2026-10-13', to: '2026-10-26' })
    expect(agendaRange('2026-12-25')).toEqual({ from: '2026-12-25', to: '2027-01-07' })
  })

  it('asks the server for one more day on each side (it cuts on UTC days)', () => {
    expect(agendaRequest('2026-10-13')).toEqual({ from: '2026-10-12', to: '2026-10-27' })
  })
})

describe('eventDay', () => {
  it('keeps an all-day date and converts a timed start to the local day', () => {
    expect(eventDay(ev('a', '2026-10-14', true))).toBe('2026-10-14')
    const lateEvening = new Date(2026, 9, 15, 23, 30)
    expect(eventDay(ev('m', lateEvening.toISOString(), false, 'meeting'))).toBe('2026-10-15')
  })

  it('puts a task on its due day: an all-day end is exclusive, a timed task ends at its due time', () => {
    expect(eventDay(ev('a', '2026-10-13', true, 'task', 'a', '2026-10-17'))).toBe('2026-10-16')
    const start = new Date(2026, 9, 13, 9, 0).toISOString()
    const due = new Date(2026, 9, 15, 17, 0).toISOString()
    expect(eventDay(ev('b', start, false, 'task', 'b', due))).toBe('2026-10-15')
  })

  it('is null for an unreadable start', () => {
    expect(eventDay(ev('x', 'soon', false))).toBeNull()
  })
})

describe('groupAgenda', () => {
  const from = '2026-10-13'
  const to = '2026-10-26'

  it('groups by day in order, all-day rows first, then by start time', () => {
    const nine = new Date(2026, 9, 14, 9, 0).toISOString()
    const eight = new Date(2026, 9, 14, 8, 0).toISOString()
    const days = groupAgenda(
      [
        ev('m9', nine, false, 'meeting'),
        ev('t', '2026-10-14', true),
        ev('m8', eight, false, 'meeting'),
        ev('first', '2026-10-13', true),
      ],
      from,
      to,
    )
    expect(days.map((d) => [d.day, d.events.map((e) => e.id)])).toEqual([
      ['2026-10-13', ['first']],
      ['2026-10-14', ['t', 'm8', 'm9']],
    ])
  })

  it('keeps a row still running on the first day, drops what only the wider request brought in', () => {
    const days = groupAgenda(
      [
        ev('trip', '2026-10-11', true, 'external', 'trip', '2026-10-15'), // runs to the 14th
        ev('gone', '2026-10-12', true, 'external', 'gone', '2026-10-13'), // ended yesterday (exclusive end)
        ev('overdue', '2026-10-12', true, 'task', 'overdue', '2026-10-13'), // due yesterday
        ev('late', '2026-10-27', true, 'external'), // after the last day
      ],
      from,
      to,
    )
    expect(days).toEqual([{ day: from, events: [expect.objectContaining({ id: 'trip' })] }])
  })

  it('UTC+7: a 06:30 meeting (23:30Z the day before) is on today', () => {
    inZone('Asia/Ho_Chi_Minh', () => {
      const days = groupAgenda(
        [ev('m', '2026-10-12T23:30:00Z', false, 'meeting', 'm', '2026-10-13T00:30:00Z')],
        from,
        to,
      )
      expect(days).toEqual([{ day: from, events: [expect.objectContaining({ id: 'm' })] }])
    })
  })

  it('UTC−4: yesterday evening’s meeting is not today; the last day’s evening one is kept', () => {
    inZone('America/New_York', () => {
      const days = groupAgenda(
        [
          ev(
            'yesterday',
            '2026-10-13T00:30:00Z',
            false,
            'meeting',
            'yesterday',
            '2026-10-13T01:30:00Z',
          ),
          ev('last', '2026-10-27T01:00:00Z', false, 'meeting', 'last', '2026-10-27T02:00:00Z'),
        ],
        from,
        to,
      )
      expect(days.map((d) => [d.day, d.events.map((e) => e.id)])).toEqual([
        ['2026-10-26', ['last']],
      ])
    })
  })
})
