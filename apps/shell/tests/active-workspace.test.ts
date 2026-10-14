import { describe, expect, it } from 'vitest'
import type { UniworkWorkspaceRef } from '../src/shared/home-api'
import {
  afterWorkspaceList,
  pickActiveWorkspace,
  type WorkspaceListState,
} from '../src/renderer/src/active-workspace'
import {
  initialPickerState,
  pickerReducer,
  type PickerAction,
} from '../src/renderer/src/uniwork-docs-model'

const ws = (id: string): UniworkWorkspaceRef => ({
  id,
  name: id,
  orgId: 'org_a',
  slug: id,
  orgSlug: 'acme',
})
const ITEMS = [ws('w1'), ws('w2')]

describe('active workspace', () => {
  it('keeps the stored workspace while it is still listed', () => {
    expect(pickActiveWorkspace(ITEMS, 'w2')).toBe('w2')
  })

  it('falls back to the first workspace when nothing is stored or the stored one is gone', () => {
    expect(pickActiveWorkspace(ITEMS, null)).toBe('w1')
    expect(pickActiveWorkspace(ITEMS, 'w_removed')).toBe('w1')
  })

  it('is null when the org has no workspace (empty state + onboarding link)', () => {
    expect(pickActiveWorkspace([], 'w2')).toBeNull()
  })

  it('the Open from UniWork picker starts on the stored workspace', () => {
    const loaded: PickerAction = { type: 'workspaces-loaded', result: { ok: true, value: ITEMS } }
    expect(pickerReducer(initialPickerState('w2'), loaded).workspaceId).toBe('w2')
    expect(pickerReducer(initialPickerState('w_removed'), loaded).workspaceId).toBe('w1')
    expect(pickerReducer(initialPickerState(), loaded).workspaceId).toBe('w1')
  })
})

describe('afterWorkspaceList', () => {
  const START: WorkspaceListState = { workspaces: null, workspaceId: null, workspaceError: null }

  it('picks the stored workspace while listed, else the first, and clears an old error', () => {
    expect(
      afterWorkspaceList({ ...START, workspaceError: 'offline' }, { ok: true, value: ITEMS }, 'w2'),
    ).toEqual({ workspaces: ITEMS, workspaceId: 'w2', workspaceError: null })
    expect(afterWorkspaceList(START, { ok: true, value: ITEMS }, null).workspaceId).toBe('w1')
  })

  it('a failed reload keeps the last good list and pick and says why (offline Refresh)', () => {
    const loaded = afterWorkspaceList(START, { ok: true, value: ITEMS }, 'w2')
    expect(afterWorkspaceList(loaded, { ok: false, error: 'network' }, 'w2')).toEqual({
      workspaces: ITEMS,
      workspaceId: 'w2',
      workspaceError: 'offline',
    })
  })

  it('a failed first load is an empty list with the error, never "still loading"', () => {
    expect(afterWorkspaceList(START, { ok: false, error: 'not_signed_in' }, null)).toEqual({
      workspaces: [],
      workspaceId: null,
      workspaceError: 'signed-out',
    })
  })
})
