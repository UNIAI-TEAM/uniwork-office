/** Calendar tab helpers (pure): the 14-day agenda, the wider window asked of the server, and day groups. */
import type { WorkCalendarEvent } from '../../shared/uniwork-work-api'
import { localIsoDate } from './work-tasks'

export const AGENDA_DAYS = 14

const DATE = /^\d{4}-\d{2}-\d{2}/

/** `day` (YYYY-MM-DD) moved by `n` calendar days */
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`)
  d.setDate(d.getDate() + n)
  return localIsoDate(d)
}

/** [from, to] shown (local YYYY-MM-DD, both inclusive), starting on `today` */
export function agendaRange(today: string, days = AGENDA_DAYS): { from: string; to: string } {
  return { from: today, to: addDays(today, days - 1) }
}

/**
 * What to ask the server. It cuts on UTC days (uniwork:server calendar.go ListEvents), so a
 * local day can start on the UTC day before (UTC+) or end on the UTC day after (UTC−). One
 * extra day on each side; groupAgenda drops what falls outside the shown days.
 */
export function agendaRequest(today: string, days = AGENDA_DAYS): { from: string; to: string } {
  return { from: addDays(today, -1), to: addDays(today, days) }
}

/** a date-only (all-day) or RFC 3339 value as a local day; null when unreadable */
function localDayOf(value: string, allDay: boolean): string | null {
  if (allDay) return DATE.test(value) ? value.slice(0, 10) : null
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? null : localIsoDate(at)
}

/**
 * The local day a row belongs on. A task sits on its due day: the server sends an
 * all-day task as [start_date, due_date + 1) and a timed one as [start_at, due_at].
 * Any other row sits on its start. Null when unreadable.
 */
export function eventDay(e: WorkCalendarEvent): string | null {
  if (e.kind === 'task' && e.end) {
    const due = localDayOf(e.end, e.all_day)
    if (due) return e.all_day ? addDays(due, -1) : due
  }
  return localDayOf(e.start, e.all_day)
}

/** the time a row shows and sorts by: a timed task's due time, otherwise its start */
export function rowTime(e: WorkCalendarEvent): string {
  return e.kind === 'task' && e.end ? e.end : e.start
}

/** a non-task row that began before `from` and is still running on it (multi-day, or across midnight) */
function runsInto(e: WorkCalendarEvent, from: string): boolean {
  if (e.kind === 'task' || !e.end) return false
  if (e.all_day) return DATE.test(e.end) && e.end.slice(0, 10) > from // all-day ends are exclusive
  return Date.parse(e.end) > new Date(`${from}T00:00:00`).getTime()
}

/**
 * Days of [from, to] that have rows, in order; all-day rows first, then by rowTime,
 * then title. A row still running on `from` lands on `from`; anything else
 * outside [from, to] (the extra request days, an overdue task) is dropped.
 */
export function groupAgenda(
  events: readonly WorkCalendarEvent[],
  from: string,
  to: string,
): { day: string; events: WorkCalendarEvent[] }[] {
  const byDay = new Map<string, WorkCalendarEvent[]>()
  for (const e of events) {
    const raw = eventDay(e)
    if (!raw || raw > to) continue
    if (raw < from && !runsInto(e, from)) continue
    const day = raw < from ? from : raw
    byDay.set(day, [...(byDay.get(day) ?? []), e])
  }
  return [...byDay.keys()].sort().map((day) => ({
    day,
    events: byDay
      .get(day)!
      .sort(
        (a, b) =>
          Number(b.all_day) - Number(a.all_day) ||
          Date.parse(rowTime(a)) - Date.parse(rowTime(b)) ||
          a.title.localeCompare(b.title),
      ),
  }))
}
