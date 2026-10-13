import { describe, expect, it } from 'vitest'
import type { UniworkWorkspaceRef } from '../src/shared/home-api'
import { pickActiveWorkspace } from '../src/renderer/src/active-workspace'
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
