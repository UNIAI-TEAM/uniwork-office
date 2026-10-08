/** Roles for files inside a teacher lesson pack (Học liệu). */

export type EduMaterialRole =
  | 'giao-an'
  | 'khdh'
  | 'slide'
  | 'phieu-hoc-tap'
  | 'ppct'
  | 'de-kiem-tra'
  | 'tai-lieu-tham-khao'
  | 'khac'

export interface EduMaterialRoleDef {
  id: EduMaterialRole
  labelVi: string
  labelEn: string
  /** Suggested app when creating empty material */
  app: 'docs' | 'sheets' | 'slides'
}

export const EDU_MATERIAL_ROLES: readonly EduMaterialRoleDef[] = [
  { id: 'giao-an', labelVi: 'Giáo án', labelEn: 'Lesson plan', app: 'docs' },
  { id: 'khdh', labelVi: 'Kế hoạch bài dạy', labelEn: 'Teaching plan', app: 'docs' },
  { id: 'slide', labelVi: 'Slide bài giảng', labelEn: 'Slides', app: 'slides' },
  { id: 'phieu-hoc-tap', labelVi: 'Phiếu học tập', labelEn: 'Worksheet', app: 'docs' },
  { id: 'ppct', labelVi: 'Phân phối chương trình', labelEn: 'Curriculum map', app: 'sheets' },
  { id: 'de-kiem-tra', labelVi: 'Đề kiểm tra', labelEn: 'Test / quiz', app: 'docs' },
  {
    id: 'tai-lieu-tham-khao',
    labelVi: 'Tài liệu tham khảo',
    labelEn: 'Reference',
    app: 'docs',
  },
  { id: 'khac', labelVi: 'Khác', labelEn: 'Other', app: 'docs' },
] as const

export function materialRoleLabel(role: EduMaterialRole, vi: boolean): string {
  const def = EDU_MATERIAL_ROLES.find((r) => r.id === role)
  if (!def) return role
  return vi ? def.labelVi : def.labelEn
}

/** Infer a material role from a file basename (best-effort). */
export function inferMaterialRole(fileName: string): EduMaterialRole {
  const n = fileName.toLowerCase()
  if (n.includes('giao-an') || n.includes('giao_an') || n.includes('lesson')) return 'giao-an'
  if (n.includes('khdh') || n.includes('ke-hoach') || n.includes('ke_hoach')) return 'khdh'
  if (n.endsWith('.pptx') || n.includes('bai-giang') || n.includes('slide')) return 'slide'
  if (n.includes('phieu') || n.includes('worksheet')) return 'phieu-hoc-tap'
  if (n.includes('ppct') || n.includes('phan-phoi') || n.endsWith('.xlsx')) return 'ppct'
  if (n.includes('kiem-tra') || n.includes('de-thi') || n.includes('quiz')) return 'de-kiem-tra'
  if (n.includes('tham-khao') || n.includes('reference')) return 'tai-lieu-tham-khao'
  return 'khac'
}
