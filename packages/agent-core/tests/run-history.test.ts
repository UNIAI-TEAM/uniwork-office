import { describe, expect, it } from 'vitest'
import { createFakeRunHistoryGroup, runHistoryEvents } from '../src'

describe('createFakeRunHistoryGroup', () => {
  it('records begin/end pairs in order and tracks the open group', () => {
    const group = createFakeRunHistoryGroup()
    expect(group.activeRunId).toBeNull()
    group.begin('r1')
    expect(group.activeRunId).toBe('r1')
    group.end('r1', true)
    expect(group.activeRunId).toBeNull()
    group.begin('r2')
    group.end('r2', false)
    expect(group.calls).toEqual([
      ['begin', 'r1'],
      ['end', 'r1', true],
      ['begin', 'r2'],
      ['end', 'r2', false],
    ])
    expect(group.errors).toEqual([])
  })

  it('flags a nested begin', () => {
    const group = createFakeRunHistoryGroup()
    group.begin('r1')
    group.begin('r2')
    expect(group.errors).toHaveLength(1)
    expect(group.errors[0]).toContain('r2')
  })

  it('flags an end without a matching begin', () => {
    const group = createFakeRunHistoryGroup()
    group.end('r1', true)
    group.begin('r2')
    group.end('r3', false)
    expect(group.errors).toHaveLength(2)
    expect(group.errors[0]).toContain('r1')
    expect(group.errors[1]).toContain('r3')
  })
})

describe('runHistoryEvents', () => {
  it('maps the loop run hooks onto begin/end', () => {
    const group = createFakeRunHistoryGroup()
    const events = runHistoryEvents(group)
    events.onRunStart?.('run-1')
    events.onRunEnd?.('run-1', { mutated: true, outcome: 'aborted' })
    expect(group.calls).toEqual([
      ['begin', 'run-1'],
      ['end', 'run-1', true],
    ])
    expect(group.errors).toEqual([])
  })
})
