import { describe, expect, it } from 'vitest'
import {
  daysLeft,
  groupIdsFor,
  groupOf,
  groupRows,
  groupsActive,
} from '../src/renderer/src/doclist/groups'

// the shared vectors pin the day/week edges; these are the screen rules and the
// run-splitting the list uses

const WED = new Date('2099-03-18T09:05:00')

describe('groupOf', () => {
  it('only recent, shared and trash group', () => {
    for (const screen of ['workspace', 'starred', 'shared-by-me', 'shelved', 'device'] as const) {
      expect(groupOf(screen, { at: '2099-03-18T08:00:00' }, WED)).toBeNull()
    }
  })

  it("lists each screen's groups in display order", () => {
    expect(groupIdsFor('recent')).toEqual(['today', 'yesterday', 'this_week', 'earlier'])
    expect(groupIdsFor('shared')).toEqual(['this_week', 'earlier'])
    expect(groupIdsFor('trash')).toEqual(['deleting_soon', 'more_than_7_days'])
    expect(groupIdsFor('workspace')).toEqual([])
  })
})

describe('daysLeft', () => {
  it('is max(1, ceil((purge_after - now) / 24h))', () => {
    expect(daysLeft('2099-03-25T09:05:00', WED)).toBe(7)
    expect(daysLeft('2099-03-25T09:05:01', WED)).toBe(8)
    expect(daysLeft('2099-03-01T00:00:00', WED)).toBe(1)
    expect(daysLeft(undefined, WED)).toBeNull()
  })
})

describe('groupsActive: grouping only while sorted by the screen column', () => {
  it('recent groups by activity, either direction is still contiguous', () => {
    expect(groupsActive('recent', { column: 'activity', dir: 'desc' })).toBe(true)
    expect(groupsActive('recent', { column: 'updated', dir: 'desc' })).toBe(false)
    expect(groupsActive('recent', { column: 'name', dir: 'asc' })).toBe(false)
  })

  it('shared groups by shared; trash by deleted', () => {
    expect(groupsActive('shared', { column: 'shared', dir: 'desc' })).toBe(true)
    expect(groupsActive('trash', { column: 'deleted', dir: 'asc' })).toBe(true)
    expect(groupsActive('trash', { column: 'updated', dir: 'desc' })).toBe(false)
  })

  it('a screen without groups never groups', () => {
    expect(groupsActive('workspace', { column: 'updated', dir: 'desc' })).toBe(false)
    expect(groupsActive('shared-by-me', { column: 'shared_with', dir: 'desc' })).toBe(false)
  })
})

describe('groupRows', () => {
  const rows = [
    { id: 'a', at: '2099-03-18T08:00:00' },
    { id: 'b', at: '2099-03-17T08:00:00' },
    { id: 'c', at: '2099-03-17T07:00:00' },
    { id: 'd', at: '2099-03-01T07:00:00' },
  ]

  it('splits an ordered list into runs and keeps the order', () => {
    const out = groupRows('recent', rows, WED, (r) => ({ at: r.at }))
    expect(out.map((g) => [g.id, g.rows.map((r) => r.id)])).toEqual([
      ['today', ['a']],
      ['yesterday', ['b', 'c']],
      ['earlier', ['d']],
    ])
  })

  it('a later page appends to the last run instead of opening a new one', () => {
    const more = [...rows, { id: 'e', at: '2099-02-01T00:00:00' }]
    const out = groupRows('recent', more, WED, (r) => ({ at: r.at }))
    expect(out.at(-1)).toMatchObject({ id: 'earlier' })
    expect(out.at(-1)!.rows.map((r) => r.id)).toEqual(['d', 'e'])
  })

  it('is one flat run with no id on a screen that does not group', () => {
    const out = groupRows('workspace', rows, WED, (r) => ({ at: r.at }))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: null })
    expect(out[0]!.rows).toHaveLength(4)
  })

  it('an empty list has no runs', () => {
    expect(groupRows('recent', [], WED, () => ({}))).toEqual([])
  })
})
