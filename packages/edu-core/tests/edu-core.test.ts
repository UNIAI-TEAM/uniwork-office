import { describe, expect, it } from 'vitest'
import {
  createEduMeta,
  eduMatchesFilter,
  eduMaterialSeedHtml,
  eduPackReadme,
  eduSkillPrompt,
  eduTemplateHtml,
  eduWorkflowPrompt,
  OPENROUTER_HUB_BASE_URL,
  extractHubBalanceHint,
  getEduSkill,
  hubModelsUrl,
  inferMaterialRole,
  isEduMeta,
  isOpenRouterHubUrl,
  looksLikeAiCreditError,
  materialRoleLabel,
  normalizeHubBaseUrl,
  packDisplayName,
  EDU_SKILLS,
} from '../src/index.js'

describe('edu-core', () => {
  it('creates meta and display name', () => {
    const meta = createEduMeta({
      subject: 'Toán',
      grade: 'Lớp 6',
      week: 'Tuần 12',
      lessonTitle: 'Phân số',
      durationMinutes: 45,
      objectives: ['Nhận biết phân số'],
    })
    expect(meta.kind).toBe('education')
    expect(isEduMeta(meta)).toBe(true)
    expect(packDisplayName(meta)).toContain('Phân số')
  })

  it('builds giáo án HTML outline', () => {
    const meta = createEduMeta({
      subject: 'Văn',
      grade: 'Lớp 8',
      lessonTitle: 'Nghị luận',
    })
    const html = eduTemplateHtml('giao-an', meta)
    expect(html).toContain('GIÁO ÁN')
    expect(html).toContain('Nghị luận')
  })

  it('builds workflow prompts in Vietnamese', () => {
    const meta = createEduMeta({
      subject: 'Toán',
      grade: 'Lớp 6',
      lessonTitle: 'Phân số',
    })
    expect(eduWorkflowPrompt('draft-lesson-plan', meta)).toContain('giáo án')
    expect(eduWorkflowPrompt('slides-from-plan', meta)).toContain('slide')
    expect(eduWorkflowPrompt('worksheet-from-plan', meta)).toContain('phiếu')
  })

  it('builds pack readme and hub helpers', () => {
    const meta = createEduMeta({
      subject: 'Toán',
      grade: 'Lớp 6',
      lessonTitle: 'Phân số',
    })
    expect(eduPackReadme(meta, ['giao-an.docx'])).toContain('Phân số')
    expect(normalizeHubBaseUrl('https://hub.example')).toBe('https://hub.example/v1')
    expect(hubModelsUrl('https://hub.example/v1')).toBe('https://hub.example/v1/models')
    expect(extractHubBalanceHint({ balance: 12.5 })).toBe('12.5')
    expect(looksLikeAiCreditError('Your credits have been exhausted')).toBe(true)
    expect(isOpenRouterHubUrl('https://openrouter.ai/api/v1')).toBe(true)
    expect(isOpenRouterHubUrl('openrouter.ai')).toBe(true)
    expect(isOpenRouterHubUrl('https://hub.example/v1')).toBe(false)
    expect(normalizeHubBaseUrl('https://openrouter.ai')).toBe(OPENROUTER_HUB_BASE_URL)
  })

  it('filters knowledge library by subject/tag/query', () => {
    const meta = createEduMeta({
      subject: 'Toán',
      grade: 'Lớp 6',
      lessonTitle: 'Phân số',
      tags: ['đại-số'],
      notes: 'ôn giữa kỳ',
    })
    const item = {
      id: 'p1',
      name: 'pack',
      fileCount: 2,
      lastActiveAt: meta.updatedAt,
      edu: meta,
    }
    expect(eduMatchesFilter(item, { subject: 'Toán' })).toBe(true)
    expect(eduMatchesFilter(item, { tag: 'đại-số' })).toBe(true)
    expect(eduMatchesFilter(item, { query: 'giữa kỳ' })).toBe(true)
    expect(eduMatchesFilter(item, { subject: 'Văn' })).toBe(false)
  })

  it('infers material roles and seeds extra HTML', () => {
    expect(inferMaterialRole('giao-an.docx')).toBe('giao-an')
    expect(inferMaterialRole('de-kiem-tra.docx')).toBe('de-kiem-tra')
    expect(materialRoleLabel('phieu-hoc-tap', true)).toContain('Phiếu')
    const meta = createEduMeta({ subject: 'Toán', grade: 'Lớp 6', lessonTitle: 'Phân số' })
    expect(eduMaterialSeedHtml('de-kiem-tra', meta)).toContain('ĐỀ KIỂM TRA')
  })

  it('builds teacher skill prompts', () => {
    expect(EDU_SKILLS.length).toBeGreaterThanOrEqual(6)
    const skill = getEduSkill('sinh-phieu')
    expect(skill?.seedRole).toBe('phieu-hoc-tap')
    const meta = createEduMeta({ subject: 'Toán', grade: 'Lớp 6', lessonTitle: 'Phân số' })
    expect(eduSkillPrompt('ngan-hang-cau-hoi', meta)).toContain('ngân hàng')
  })
})
