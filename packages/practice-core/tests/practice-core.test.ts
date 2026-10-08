import { describe, expect, it } from 'vitest'
import {
  SKILL_DOMAINS,
  WORKBENCH_MODULES,
  createPracticeMeta,
  defaultPinnedModules,
  ensureCorePinnedModules,
  isCorePinnedModule,
  defaultPinnedSkillDomains,
  getPractice,
  isPracticeMeta,
  isSkillDomainId,
  listPractices,
  practiceIdFromProjectKind,
  practiceMatchesFilter,
  practiceMaterialSeedHtml,
  practiceProjectKind,
  practiceSkillPrompt,
  skillsForDomain,
} from '../src/index.js'

describe('practice-core', () => {
  it('registers profession practices including teacher and business roles', () => {
    const ids = listPractices().map((p) => p.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'teacher',
        'legal',
        'construction',
        'procurement',
        'principal',
        'sales',
        'customer-care',
        'entrepreneur',
        'freelancer',
        'content-creator',
        'marketing',
        'hr',
        'accounting',
        'it',
        'real-estate',
      ]),
    )
    expect(ids).toHaveLength(15)
    expect(getPractice('teacher')?.projectKind).toBe('education')
    expect(practiceProjectKind('legal')).toBe('legal')
    expect(practiceProjectKind('sales')).toBe('sales')
    expect(practiceIdFromProjectKind('education')).toBe('teacher')
    expect(practiceIdFromProjectKind('content-creator')).toBe('content-creator')
  })

  it('creates and filters practice meta', () => {
    const meta = createPracticeMeta({
      practiceId: 'legal',
      title: 'HĐ thuê VP',
      facets: { client: 'ABC', matterType: 'Hợp đồng' },
      tags: ['thuê'],
    })
    expect(isPracticeMeta(meta)).toBe(true)
    const item = {
      id: 'p1',
      name: 'pack',
      fileCount: 0,
      lastActiveAt: meta.updatedAt,
      meta,
    }
    expect(practiceMatchesFilter(item, { facetKey: 'client', facetValue: 'ABC' })).toBe(true)
    expect(practiceMatchesFilter(item, { query: 'thuê' })).toBe(true)
  })

  it('builds seeds and skill prompts', () => {
    const meta = createPracticeMeta({
      practiceId: 'construction',
      title: 'Đợt GS tuần 12',
      facets: { projectName: 'Chung cư A', phase: 'Thi công' },
    })
    expect(practiceMaterialSeedHtml('nhat-ky-gs', 'Nhật ký GS', meta)).toContain('Nhật ký GS')
    expect(practiceSkillPrompt('Nhật ký', 'Viết nhật ký', meta)).toContain('Chung cư A')
  })

  it('exposes workbench modules and role defaults', () => {
    const ids = WORKBENCH_MODULES.map((m) => m.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'desk',
        'calendar',
        'tasks',
        'notes',
        'email',
        'assistant',
        'forms',
        'personal',
        'personal-finance',
        'events',
        'health',
        'self-growth',
        'family',
        'friends',
        'pets',
        'travel',
        'clients',
        'contracts',
        'matters',
      ]),
    )
    const core = ['desk', 'tasks', 'calendar', 'forms']
    expect(defaultPinnedModules('principal')).toEqual(core)
    expect(defaultPinnedModules('legal')).toEqual(core)
    expect(defaultPinnedModules('teacher')).toEqual(core)
    expect(defaultPinnedModules('construction')).toEqual(core)
    expect(isCorePinnedModule('desk')).toBe(true)
    expect(isCorePinnedModule('clients')).toBe(false)
    expect(ensureCorePinnedModules(['desk', 'clients'])).toEqual([
      'desk',
      'tasks',
      'calendar',
      'forms',
      'clients',
    ])
  })

  it('exposes skill domains with starter skills', () => {
    expect(SKILL_DOMAINS.map((d) => d.id)).toEqual(
      expect.arrayContaining([
        'education',
        'health',
        'legal',
        'design',
        'project-mgmt',
        'sales',
        'admin',
        'hr',
        'customer-care',
        'personal',
      ]),
    )
    expect(defaultPinnedSkillDomains()).toEqual(['education', 'personal', 'admin'])
    expect(isSkillDomainId('sales')).toBe(true)
    expect(skillsForDomain('legal').length).toBeGreaterThan(0)
    expect(skillsForDomain('personal').every((s) => s.domainId === 'personal')).toBe(true)
  })
})
