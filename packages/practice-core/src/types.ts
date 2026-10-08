/** Canonical practice ids (profession workbenches on UniOffice). */
export const PRACTICE_IDS = [
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
] as const

/** Stable practice identifiers (profession workbenches on UniOffice). */
export type PracticeId = (typeof PRACTICE_IDS)[number]

export function isPracticeId(value: unknown): value is PracticeId {
  return typeof value === 'string' && (PRACTICE_IDS as readonly string[]).includes(value)
}

/**
 * ProjectStore `kind` for a practice pack.
 * Teacher keeps legacy `education` for backward compatibility.
 */
export type PracticeProjectKind = 'education' | Exclude<PracticeId, 'teacher'>

export type PracticePillarId = 'knowledge' | 'materials' | 'skills' | 'compose'

export interface PracticePillarLabels {
  id: PracticePillarId
  labelVi: string
  labelEn: string
  hintVi: string
  hintEn: string
}

export interface PracticeFacetDef {
  id: string
  labelVi: string
  labelEn: string
  required?: boolean
  /** Optional select options; free text when omitted */
  options?: readonly string[]
  placeholderVi?: string
  placeholderEn?: string
}

export interface PracticeMaterialRoleDef {
  id: string
  labelVi: string
  labelEn: string
  app: 'docs' | 'sheets' | 'slides'
}

export interface PracticeTemplateDef {
  id: string
  labelVi: string
  labelEn: string
  app: 'docs' | 'sheets' | 'slides'
  /** Material role to record when seeding */
  materialRole: string
}

export interface PracticeSkillDef {
  id: string
  category: string
  labelVi: string
  labelEn: string
  descVi: string
  descEn: string
  app: 'docs' | 'slides'
  seedRole?: string
  usesAi: true
}

export interface PracticeDefinition {
  id: PracticeId
  /** Stored on ProjectInfo.kind */
  projectKind: PracticeProjectKind
  labelVi: string
  labelEn: string
  subtitleVi: string
  subtitleEn: string
  /** Primary title facet id (e.g. lessonTitle / matterTitle) */
  titleFacetId: string
  facets: readonly PracticeFacetDef[]
  pillars: readonly PracticePillarLabels[]
  materialRoles: readonly PracticeMaterialRoleDef[]
  templates: readonly PracticeTemplateDef[]
  skills: readonly PracticeSkillDef[]
  /** Ordered free template ids for offline chain (optional) */
  freeChainTemplateIds?: readonly string[]
}

/** Generic practice pack metadata (projects/<id>/practice/meta.json). */
export interface PracticeMeta {
  version: 1
  kind: 'practice'
  practiceId: PracticeId
  title: string
  /** Facet values keyed by facet id */
  facets: Record<string, string>
  tags?: string[]
  notes?: string
  /** path or role:* → material role id */
  materials?: Partial<Record<string, string>>
  createdAt: string
  updatedAt: string
}

export interface CreatePracticeMetaInput {
  practiceId: PracticeId
  title: string
  facets?: Record<string, string>
  tags?: string[]
  notes?: string
}
