import {
  EDU_GRADES,
  EDU_MATERIAL_ROLES,
  EDU_SKILLS,
  EDU_SUBJECTS,
  EDU_TEMPLATES,
} from '@uniwork/edu-core'
import { DEFAULT_PILLARS } from '../pillars.js'
import type { PracticeDefinition } from '../types.js'

export const teacherPractice: PracticeDefinition = {
  id: 'teacher',
  projectKind: 'education',
  labelVi: 'Giáo viên',
  labelEn: 'Teacher',
  subtitleVi: 'Soạn bài · học liệu · kỹ năng sư phạm trên máy',
  subtitleEn: 'Lesson packs · materials · pedagogy skills on device',
  titleFacetId: 'lessonTitle',
  facets: [
    {
      id: 'subject',
      labelVi: 'Môn',
      labelEn: 'Subject',
      required: true,
      options: EDU_SUBJECTS,
    },
    {
      id: 'grade',
      labelVi: 'Lớp',
      labelEn: 'Grade',
      required: true,
      options: EDU_GRADES,
    },
    {
      id: 'week',
      labelVi: 'Tuần',
      labelEn: 'Week',
      placeholderVi: 'VD: Tuần 12',
      placeholderEn: 'e.g. Week 12',
    },
    {
      id: 'lessonTitle',
      labelVi: 'Tên bài',
      labelEn: 'Lesson title',
      required: true,
      placeholderVi: 'VD: Phân số',
      placeholderEn: 'e.g. Fractions',
    },
  ],
  pillars: DEFAULT_PILLARS.map((p) =>
    p.id === 'materials'
      ? { ...p, labelVi: 'Học liệu', hintVi: 'File theo vai trò trong bài' }
      : p.id === 'knowledge'
        ? { ...p, hintVi: 'Thư viện bài / tìm kiếm' }
        : p,
  ),
  materialRoles: EDU_MATERIAL_ROLES.map((r) => ({
    id: r.id,
    labelVi: r.labelVi,
    labelEn: r.labelEn,
    app: r.app,
  })),
  templates: EDU_TEMPLATES.map((t) => ({
    id: t.id,
    labelVi: t.labelVi,
    labelEn: t.labelEn,
    app: t.app,
    materialRole: t.id,
  })),
  skills: EDU_SKILLS.map((s) => ({
    id: s.id,
    category: s.category,
    labelVi: s.labelVi,
    labelEn: s.labelEn,
    descVi: s.descVi,
    descEn: s.descEn,
    app: s.app,
    seedRole: s.seedRole,
    usesAi: true,
  })),
  freeChainTemplateIds: ['giao-an', 'slide', 'phieu-hoc-tap'],
}
