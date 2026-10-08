import { BUSINESS_PRACTICES } from './practices/business.js'
import { constructionPractice } from './practices/construction.js'
import { legalPractice } from './practices/legal.js'
import { principalPractice } from './practices/principal.js'
import { procurementPractice } from './practices/procurement.js'
import { teacherPractice } from './practices/teacher.js'
import type { PracticeDefinition, PracticeId } from './types.js'

export const PRACTICE_REGISTRY: readonly PracticeDefinition[] = [
  teacherPractice,
  legalPractice,
  constructionPractice,
  procurementPractice,
  principalPractice,
  ...BUSINESS_PRACTICES,
] as const

/** Ordered groups for the Role selector UI. */
export const PRACTICE_GROUPS: readonly {
  id: string
  labelVi: string
  labelEn: string
  ids: readonly PracticeId[]
}[] = [
  {
    id: 'education',
    labelVi: 'Giáo dục',
    labelEn: 'Education',
    ids: ['teacher', 'principal'],
  },
  {
    id: 'professional',
    labelVi: 'Chuyên môn',
    labelEn: 'Professional',
    ids: ['legal', 'construction', 'procurement'],
  },
  {
    id: 'business',
    labelVi: 'Kinh doanh',
    labelEn: 'Business',
    ids: ['sales', 'customer-care', 'entrepreneur', 'freelancer', 'marketing', 'real-estate'],
  },
  {
    id: 'creator-tech',
    labelVi: 'Sáng tạo & công nghệ',
    labelEn: 'Creator & tech',
    ids: ['content-creator', 'it'],
  },
  {
    id: 'operations',
    labelVi: 'Vận hành',
    labelEn: 'Operations',
    ids: ['hr', 'accounting'],
  },
] as const

export function listPractices(): readonly PracticeDefinition[] {
  return PRACTICE_REGISTRY
}

export function getPractice(id: PracticeId): PracticeDefinition | undefined {
  return PRACTICE_REGISTRY.find((p) => p.id === id)
}

export function requirePractice(id: PracticeId): PracticeDefinition {
  const p = getPractice(id)
  if (!p) throw new Error(`Unknown practice: ${id}`)
  return p
}

export function listPracticeGroups(vi: boolean): {
  label: string
  practices: PracticeDefinition[]
}[] {
  return PRACTICE_GROUPS.map((g) => ({
    label: vi ? g.labelVi : g.labelEn,
    practices: g.ids
      .map((id) => getPractice(id))
      .filter((p): p is PracticeDefinition => Boolean(p)),
  })).filter((g) => g.practices.length > 0)
}
