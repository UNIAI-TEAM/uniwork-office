import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readActiveSkillDomain,
  readPinnedSkillDomains,
  unpinSkillDomain,
} from '../src/renderer/src/skill-domain-pins'

const store = new Map<string, string>()

vi.mock('../src/renderer/src/workbench-store-client', () => ({
  wbStoreGetRaw: (key: string) => store.get(key) ?? null,
  wbStoreSetRaw: (key: string, value: string) => {
    store.set(key, value)
  },
}))

describe('skill domain pins', () => {
  afterEach(() => {
    store.clear()
  })

  it('defaults to the active role, entrepreneur when none is stored', () => {
    expect(readPinnedSkillDomains()).toEqual(['sales', 'admin'])
    store.set('uniwork.activePracticeId', 'legal')
    expect(readPinnedSkillDomains()).toEqual(['legal', 'admin'])
  })

  it('drops a stored education pin and falls back to the role defaults', () => {
    store.set('uniwork.skill.domain.pins', JSON.stringify(['education']))
    store.set('uniwork.activePracticeId', 'hr')
    expect(readPinnedSkillDomains()).toEqual(['hr', 'admin'])
  })

  it('falls back to the first pin, never education', () => {
    store.set('uniwork.skill.domain.active', 'education')
    expect(readActiveSkillDomain(['legal', 'admin'])).toBe('legal')
    expect(readActiveSkillDomain([])).toBe('sales')
  })

  it('unpinning the last tab restores the role defaults', () => {
    store.set('uniwork.activePracticeId', 'accounting')
    store.set('uniwork.skill.domain.pins', JSON.stringify(['legal']))
    expect(unpinSkillDomain('legal')).toEqual(['admin'])
  })
})
