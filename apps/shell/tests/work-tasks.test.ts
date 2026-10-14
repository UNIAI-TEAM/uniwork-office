import { describe, expect, it } from 'vitest'
import type { WorkTask, WorkTaskStatus } from '../src/shared/uniwork-work-api'
import {
  closedStatusKeys,
  endOfWeek,
  groupTasksByDue,
  localIsoDate,
} from '../src/renderer/src/work-tasks'

const task = (id: string, due?: string, title = id): WorkTask => ({
  id,
  workspace_id: 'w1',
  identifier: `OPS-${id}`,
  title,
  status: 'todo',
  priority: 'medium',
  ...(due ? { due_date: due } : {}),
  updated_at: '2026-10-13T08:00:00Z',
})

describe('localIsoDate', () => {
  it('formats the local calendar day', () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
  })
})

describe('endOfWeek', () => {
  it('is the Sunday that closes the week', () => {
    expect(endOfWeek('2026-10-13')).toBe('2026-10-18') // Tuesday
    expect(endOfWeek('2026-10-12')).toBe('2026-10-18') // Monday
    expect(endOfWeek('2026-10-18')).toBe('2026-10-18') // Sunday
    expect(endOfWeek('2026-12-29')).toBe('2027-01-03') // across the year
  })
})

describe('groupTasksByDue', () => {
  const today = '2026-10-13'

  it('splits into overdue / today / this week / later / no date, in that order', () => {
    const groups = groupTasksByDue(
      [
        task('later', '2026-10-19'),
        task('none'),
        task('week', '2026-10-18'),
        task('today', '2026-10-13'),
        task('late', '2026-10-01'),
      ],
      today,
    )
    expect(groups.map((g) => [g.group, g.tasks.map((t) => t.id)])).toEqual([
      ['overdue', ['late']],
      ['today', ['today']],
      ['week', ['week']],
      ['later', ['later']],
      ['none', ['none']],
    ])
  })

  it('leaves out empty groups and sorts a group by due date, then title', () => {
    const groups = groupTasksByDue(
      [task('b', '2026-10-16', 'Beta'), task('a', '2026-10-16', 'Alpha'), task('c', '2026-10-14')],
      today,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]!.group).toBe('week')
    expect(groups[0]!.tasks.map((t) => t.id)).toEqual(['c', 'a', 'b'])
  })

  it('reads only the date part of a due value', () => {
    expect(groupTasksByDue([task('x', '2026-10-13T23:00:00Z')], today)[0]!.group).toBe('today')
  })
})

describe('closedStatusKeys', () => {
  it('closes the done and cancelled categories, built-in keys included without a catalogue', () => {
    const statuses: WorkTaskStatus[] = [
      { id: '1', key: 'todo', name: 'To do', category: 'todo', color: '', position: 1 },
      { id: '2', key: 'shipped', name: 'Shipped', category: 'done', color: '', position: 2 },
      { id: '3', key: 'dropped', name: 'Dropped', category: 'cancelled', color: '', position: 3 },
    ]
    expect([...closedStatusKeys(statuses)].sort()).toEqual([
      'cancelled',
      'done',
      'dropped',
      'shipped',
    ])
    expect([...closedStatusKeys([])].sort()).toEqual(['cancelled', 'done'])
  })
})
