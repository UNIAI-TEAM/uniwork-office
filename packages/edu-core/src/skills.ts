import type { EduMeta } from './types.js'
import type { EduMaterialRole } from './materials.js'

/**
 * Local Teacher Skills — reusable AI prompts for classroom work.
 * Running a skill may spend Hub Tokens; opening templates does not.
 */
export type EduSkillId =
  | 'soan-giao-an'
  | 'rut-muc-tieu'
  | 'sinh-slide'
  | 'sinh-phieu'
  | 'ngan-hang-cau-hoi'
  | 'dieu-chinh-phu-hop'
  | 'tom-tat-bai-hoc'
  | 'goi-y-hoat-dong'

export interface EduSkillDef {
  id: EduSkillId
  category: 'soan-thao' | 'hoc-lieu' | 'danh-gia' | 'tri-thuc'
  labelVi: string
  labelEn: string
  descVi: string
  descEn: string
  app: 'docs' | 'slides'
  /** Prefer seeding this material role when running the skill */
  seedRole?: EduMaterialRole
  usesAi: true
}

export const EDU_SKILLS: readonly EduSkillDef[] = [
  {
    id: 'soan-giao-an',
    category: 'soan-thao',
    labelVi: 'Soạn giáo án đầy đủ',
    labelEn: 'Full lesson plan',
    descVi: 'Hoàn thiện giáo án theo CT 2018 từ thông tin bài.',
    descEn: 'Complete a CT 2018 lesson plan from pack metadata.',
    app: 'docs',
    seedRole: 'giao-an',
    usesAi: true,
  },
  {
    id: 'rut-muc-tieu',
    category: 'tri-thuc',
    labelVi: 'Rút mục tiêu / CĐR',
    labelEn: 'Extract objectives',
    descVi: 'Đề xuất kiến thức – năng lực – phẩm chất cho bài.',
    descEn: 'Suggest knowledge / competency / character goals.',
    app: 'docs',
    seedRole: 'giao-an',
    usesAi: true,
  },
  {
    id: 'sinh-slide',
    category: 'hoc-lieu',
    labelVi: 'Sinh slide bài giảng',
    labelEn: 'Generate slides',
    descVi: 'Tạo dàn ý slide rõ ràng, chữ ngắn cho lớp học.',
    descEn: 'Build a clear short-text slide outline.',
    app: 'slides',
    seedRole: 'slide',
    usesAi: true,
  },
  {
    id: 'sinh-phieu',
    category: 'hoc-lieu',
    labelVi: 'Sinh phiếu học tập',
    labelEn: 'Generate worksheet',
    descVi: 'Câu hỏi phân tầng nhận biết → vận dụng cao.',
    descEn: 'Tiered questions from recall to transfer.',
    app: 'docs',
    seedRole: 'phieu-hoc-tap',
    usesAi: true,
  },
  {
    id: 'ngan-hang-cau-hoi',
    category: 'danh-gia',
    labelVi: 'Ngân hàng câu hỏi',
    labelEn: 'Question bank',
    descVi: 'Sinh 10–15 câu trắc nghiệm / tự luận theo bài.',
    descEn: 'Generate 10–15 MCQ / open questions for the lesson.',
    app: 'docs',
    seedRole: 'de-kiem-tra',
    usesAi: true,
  },
  {
    id: 'dieu-chinh-phu-hop',
    category: 'soan-thao',
    labelVi: 'Điều chỉnh phân hoá',
    labelEn: 'Differentiate activities',
    descVi: 'Gợi ý hoạt động cho HS khá / TB / cần hỗ trợ.',
    descEn: 'Suggest activities for strong / mid / support learners.',
    app: 'docs',
    seedRole: 'giao-an',
    usesAi: true,
  },
  {
    id: 'tom-tat-bai-hoc',
    category: 'tri-thuc',
    labelVi: 'Tóm tắt bài học',
    labelEn: 'Lesson summary',
    descVi: 'Tóm tắt 1 trang: ý chính, từ khóa, câu hỏi ôn.',
    descEn: 'One-page summary: key ideas, terms, review Qs.',
    app: 'docs',
    seedRole: 'tai-lieu-tham-khao',
    usesAi: true,
  },
  {
    id: 'goi-y-hoat-dong',
    category: 'hoc-lieu',
    labelVi: 'Gợi ý hoạt động khởi động',
    labelEn: 'Warm-up ideas',
    descVi: '3–5 hoạt động khởi động ngắn, dễ tổ chức.',
    descEn: '3–5 short, easy-to-run warm-up activities.',
    app: 'docs',
    seedRole: 'giao-an',
    usesAi: true,
  },
] as const

export type EduSkillCategory = EduSkillDef['category']

export function getEduSkill(id: EduSkillId): EduSkillDef | undefined {
  return EDU_SKILLS.find((s) => s.id === id)
}

export function eduSkillCategoryLabel(cat: EduSkillCategory, vi: boolean): string {
  const map = {
    'soan-thao': { vi: 'Soạn thảo', en: 'Authoring' },
    'hoc-lieu': { vi: 'Học liệu', en: 'Materials' },
    'danh-gia': { vi: 'Đánh giá', en: 'Assessment' },
    'tri-thuc': { vi: 'Tri thức', en: 'Knowledge' },
  } as const
  return vi ? map[cat].vi : map[cat].en
}

export function eduSkillPrompt(skillId: EduSkillId, meta: EduMeta): string {
  const ctx = [
    `Môn: ${meta.subject}`,
    `Lớp: ${meta.grade}`,
    meta.week ? `Tuần: ${meta.week}` : null,
    `Bài: ${meta.lessonTitle}`,
    typeof meta.durationMinutes === 'number' ? `Thời lượng: ${meta.durationMinutes} phút` : null,
    meta.objectives.length > 0 ? `Mục tiêu đã có: ${meta.objectives.join('; ')}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const common = [
    'Bạn là trợ lý sư phạm cho giáo viên phổ thông Việt Nam (CT GDPT 2018).',
    'Không sao chép nguyên văn sách giáo khoa; diễn giải và bài tập gốc.',
    '',
    'Thông tin bài:',
    ctx,
    '',
  ]

  switch (skillId) {
    case 'soan-giao-an':
      return [
        ...common,
        'Hoàn thiện giáo án trong tài liệu: mục tiêu (KT/NL/PQ), đồ dùng, tiến trình từng hoạt động có thời gian.',
      ].join('\n')
    case 'rut-muc-tieu':
      return [
        ...common,
        'Đề xuất mục tiêu kiến thức, năng lực (chung + đặc thù), phẩm chất. Liệt kê gạch đầu dòng, ngắn gọn.',
      ].join('\n')
    case 'sinh-slide':
      return [
        ...common,
        'Thiết kế dàn ý slide: mở đầu, mục tiêu, nội dung, luyện tập, củng cố. Mỗi slide ngắn, chữ lớn.',
      ].join('\n')
    case 'sinh-phieu':
      return [
        ...common,
        'Soạn phiếu học tập phân tầng A nhận biết / B vận dụng / C vận dụng cao + đáp án gợi ý cho GV.',
      ].join('\n')
    case 'ngan-hang-cau-hoi':
      return [
        ...common,
        'Tạo ngân hàng 12 câu: 8 trắc nghiệm 4 lựa chọn + 4 tự luận ngắn, kèm đáp án/gợi ý chấm.',
      ].join('\n')
    case 'dieu-chinh-phu-hop':
      return [
        ...common,
        'Đề xuất điều chỉnh phân hoá cho 3 nhóm học sinh (khá – trung bình – cần hỗ trợ) trong cùng tiết.',
      ].join('\n')
    case 'tom-tat-bai-hoc':
      return [
        ...common,
        'Viết tóm tắt 1 trang: ý chính, từ khóa, 5 câu hỏi ôn tập nhanh.',
      ].join('\n')
    case 'goi-y-hoat-dong':
      return [
        ...common,
        'Gợi ý 5 hoạt động khởi động (mỗi cái ≤ 5 phút): mục tiêu, cách tổ chức, sản phẩm.',
      ].join('\n')
  }
}
