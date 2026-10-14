import { describe, expect, it } from 'vitest'
import {
  SKILL_DOMAINS,
  WORKBENCH_MODULES,
  createPracticeMeta,
  defaultPinnedModules,
  ensureCorePinnedModules,
  isCorePinnedModule,
  defaultPinnedSkillDomains,
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
  it('registers the 13 business practices and no education role', () => {
    const ids = listPractices().map((p) => p.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'legal',
        'construction',
        'procurement',
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
    expect(ids).toHaveLength(13)
    expect(ids).not.toContain('teacher')
    expect(ids).not.toContain('principal')
    expect(practiceProjectKind('legal')).toBe('legal')
    expect(practiceProjectKind('sales')).toBe('sales')
    expect(practiceIdFromProjectKind('education')).toBeNull()
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
    expect(WORKBENCH_MODULES.map((m) => m.id)).toEqual([
      'desk',
      'calendar',
      'tasks',
      'notes',
      'forms',
      'personal',
    ])
    const core = ['desk', 'tasks', 'calendar']
    expect(defaultPinnedModules('legal')).toEqual(core)
    expect(defaultPinnedModules('construction')).toEqual(core)
    expect(isCorePinnedModule('desk')).toBe(true)
    expect(isCorePinnedModule('forms')).toBe(false)
    expect(ensureCorePinnedModules(['desk', 'forms'])).toEqual([
      'desk',
      'tasks',
      'calendar',
      'forms',
    ])
    expect(ensureCorePinnedModules(['desk', 'health' as never, 'notes'])).toEqual([
      'desk',
      'tasks',
      'calendar',
      'notes',
    ])
  })

  it('exposes skill domains with starter skills and role-based defaults', () => {
    const ids = SKILL_DOMAINS.map((d) => d.id)
    expect(ids).toEqual(
      expect.arrayContaining([
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
    expect(ids).not.toContain('education')
    expect(isSkillDomainId('education')).toBe(false)
    expect(defaultPinnedSkillDomains('entrepreneur')).toEqual(['sales', 'admin'])
    expect(defaultPinnedSkillDomains('legal')).toEqual(['legal', 'admin'])
    expect(defaultPinnedSkillDomains('accounting')).toEqual(['admin'])
    expect(isSkillDomainId('sales')).toBe(true)
    expect(skillsForDomain('legal').length).toBeGreaterThan(0)
    expect(skillsForDomain('personal').every((s) => s.domainId === 'personal')).toBe(true)
  })
})
