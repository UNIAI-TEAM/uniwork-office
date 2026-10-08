import type { EduMaterialRole } from './materials.js'

/** Local education lesson-pack metadata (stored as projects/<id>/edu/meta.json). */

export const EDU_META_VERSION = 2 as const

export interface EduMeta {
  version: 1 | typeof EDU_META_VERSION
  kind: 'education'
  /** Subject name, e.g. Toán */
  subject: string
  /** Grade / class band, e.g. Lớp 6 */
  grade: string
  /** Optional week label, e.g. Tuần 12 */
  week?: string
  /** Lesson title */
  lessonTitle: string
  /** Planned duration in minutes */
  durationMinutes?: number
  /** Learning objectives / chuẩn đầu ra */
  objectives: string[]
  /** Knowledge-library tags (e.g. đại-số, hình-học) */
  tags?: string[]
  /** Free-form teacher notes */
  notes?: string
  /** Absolute file path → material role (Học liệu) */
  materials?: Partial<Record<string, EduMaterialRole>>
  createdAt: string
  updatedAt: string
}

export type EduTemplateId =
  | 'giao-an'
  | 'khdh'
  | 'slide'
  | 'phieu-hoc-tap'
  | 'ppct'

export type EduWorkflowId =
  | 'draft-lesson-plan'
  | 'slides-from-plan'
  | 'worksheet-from-plan'
  /** Free (no AI): open giáo án + slide + phiếu seeds in order */
  | 'lesson-chain-templates'

export interface EduTemplateDef {
  id: EduTemplateId
  /** Suggested file stem (without extension) */
  fileStem: string
  app: 'docs' | 'sheets' | 'slides'
  labelVi: string
  labelEn: string
}

export interface EduWorkflowDef {
  id: EduWorkflowId
  app: 'docs' | 'slides'
  labelVi: string
  labelEn: string
  /** Opens this template outline when the workflow runs */
  seedTemplate: EduTemplateId
}

export interface CreateEduMetaInput {
  subject: string
  grade: string
  week?: string
  lessonTitle: string
  durationMinutes?: number
  objectives?: string[]
  tags?: string[]
  notes?: string
}
