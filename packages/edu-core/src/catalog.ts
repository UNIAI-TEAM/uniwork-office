import type { EduTemplateDef, EduWorkflowDef } from './types.js'

/** Common VN secondary subjects for Teacher compose / filters. */
export const EDU_SUBJECTS = [
  'Toán',
  'Ngữ văn',
  'Tiếng Anh',
  'Vật lí',
  'Hóa học',
  'Sinh học',
  'Lịch sử',
  'Địa lí',
  'GDCD',
  'Tin học',
  'Công nghệ',
  'Âm nhạc',
  'Mĩ thuật',
  'Thể dục',
] as const

export const EDU_GRADES = [
  'Lớp 6',
  'Lớp 7',
  'Lớp 8',
  'Lớp 9',
  'Lớp 10',
  'Lớp 11',
  'Lớp 12',
] as const

export const EDU_TEMPLATES: readonly EduTemplateDef[] = [
  {
    id: 'giao-an',
    fileStem: 'giao-an',
    app: 'docs',
    labelVi: 'Giáo án',
    labelEn: 'Lesson plan',
  },
  {
    id: 'khdh',
    fileStem: 'ke-hoach-bai-day',
    app: 'docs',
    labelVi: 'Kế hoạch bài dạy',
    labelEn: 'Teaching plan',
  },
  {
    id: 'slide',
    fileStem: 'bai-giang',
    app: 'slides',
    labelVi: 'Slide bài giảng',
    labelEn: 'Lesson slides',
  },
  {
    id: 'phieu-hoc-tap',
    fileStem: 'phieu-hoc-tap',
    app: 'docs',
    labelVi: 'Phiếu học tập',
    labelEn: 'Worksheet',
  },
  {
    id: 'ppct',
    fileStem: 'phan-phoi-chuong-trinh',
    app: 'sheets',
    labelVi: 'Phân phối chương trình',
    labelEn: 'Curriculum map',
  },
] as const

export const EDU_WORKFLOWS: readonly EduWorkflowDef[] = [
  {
    id: 'draft-lesson-plan',
    app: 'docs',
    labelVi: 'Soạn giáo án',
    labelEn: 'Draft lesson plan',
    seedTemplate: 'giao-an',
  },
  {
    id: 'slides-from-plan',
    app: 'slides',
    labelVi: 'Sinh slide từ giáo án',
    labelEn: 'Slides from plan',
    seedTemplate: 'slide',
  },
  {
    id: 'worksheet-from-plan',
    app: 'docs',
    labelVi: 'Sinh phiếu học tập',
    labelEn: 'Worksheet from plan',
    seedTemplate: 'phieu-hoc-tap',
  },
  {
    id: 'lesson-chain-templates',
    app: 'docs',
    labelVi: 'Chuỗi tiết dạy (mẫu, không AI)',
    labelEn: 'Lesson chain (templates, no AI)',
    seedTemplate: 'giao-an',
  },
] as const

/** Ordered free seeds for the personal-teacher lesson chain. */
export const EDU_LESSON_CHAIN_TEMPLATES = ['giao-an', 'slide', 'phieu-hoc-tap'] as const
