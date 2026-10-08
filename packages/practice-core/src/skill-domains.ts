/**
 * Specialized Skill domains — mini-tabs under the Skills pillar.
 * Pin / add / reorder mirrors workbench modules; skills are domain-scoped.
 */

export type SkillDomainId =
  | 'education'
  | 'health'
  | 'legal'
  | 'design'
  | 'project-mgmt'
  | 'sales'
  | 'admin'
  | 'hr'
  | 'customer-care'
  | 'personal'

export interface SkillDomainDef {
  id: SkillDomainId
  labelVi: string
  labelEn: string
  hintVi: string
  hintEn: string
  /** Accent for tab badge (chart/UI color, not chrome CSS) */
  color: string
  available: boolean
}

export interface DomainSkillDef {
  id: string
  domainId: SkillDomainId
  category: string
  labelVi: string
  labelEn: string
  descVi: string
  descEn: string
  app: 'docs' | 'slides'
  usesAi: true
}

export const SKILL_DOMAINS: readonly SkillDomainDef[] = [
  {
    id: 'education',
    labelVi: 'Giáo dục',
    labelEn: 'Education',
    hintVi: 'Giảng dạy, học liệu, đánh giá',
    hintEn: 'Teaching, materials, assessment',
    color: '#3276CD',
    available: true,
  },
  {
    id: 'health',
    labelVi: 'Y tế',
    labelEn: 'Healthcare',
    hintVi: 'Hồ sơ, tư vấn, theo dõi sức khoẻ',
    hintEn: 'Records, counselling, health follow-up',
    color: '#EF4444',
    available: true,
  },
  {
    id: 'legal',
    labelVi: 'Luật & Pháp chế',
    labelEn: 'Law & Compliance',
    hintVi: 'Hợp đồng, tư vấn, hồ sơ pháp lý',
    hintEn: 'Contracts, advice, legal files',
    color: '#7C3AED',
    available: true,
  },
  {
    id: 'design',
    labelVi: 'Tư vấn thiết kế',
    labelEn: 'Design consulting',
    hintVi: 'Brief, đề xuất, thuyết minh thiết kế',
    hintEn: 'Briefs, proposals, design narratives',
    color: '#EA580C',
    available: true,
  },
  {
    id: 'project-mgmt',
    labelVi: 'Quản lý dự án',
    labelEn: 'Project management',
    hintVi: 'Kế hoạch, báo cáo, rủi ro',
    hintEn: 'Plans, reports, risks',
    color: '#0284C7',
    available: true,
  },
  {
    id: 'sales',
    labelVi: 'Bán hàng',
    labelEn: 'Sales',
    hintVi: 'Pitch, báo giá, chăm sóc lead',
    hintEn: 'Pitches, quotes, lead care',
    color: '#16A34A',
    available: true,
  },
  {
    id: 'admin',
    labelVi: 'Hành chính văn phòng',
    labelEn: 'Office admin',
    hintVi: 'Công văn, biên bản, lịch họp',
    hintEn: 'Memos, minutes, schedules',
    color: '#64748B',
    available: true,
  },
  {
    id: 'hr',
    labelVi: 'Nhân sự',
    labelEn: 'Human resources',
    hintVi: 'Tuyển dụng, đánh giá, nội quy',
    hintEn: 'Hiring, reviews, policies',
    color: '#DB2777',
    available: true,
  },
  {
    id: 'customer-care',
    labelVi: 'Chăm sóc khách hàng',
    labelEn: 'Customer care',
    hintVi: 'Phản hồi, khiếu nại, CSAT',
    hintEn: 'Replies, complaints, CSAT',
    color: '#0D9488',
    available: true,
  },
  {
    id: 'personal',
    labelVi: 'Cá nhân',
    labelEn: 'Personal',
    hintVi: 'Kế hoạch đời sống, ghi chú, mục tiêu',
    hintEn: 'Life plans, notes, goals',
    color: '#F59E0B',
    available: true,
  },
] as const

function skill(
  domainId: SkillDomainId,
  id: string,
  category: string,
  labelVi: string,
  labelEn: string,
  descVi: string,
  descEn: string,
  app: 'docs' | 'slides' = 'docs',
): DomainSkillDef {
  return {
    id: `${domainId}:${id}`,
    domainId,
    category,
    labelVi,
    labelEn,
    descVi,
    descEn,
    app,
    usesAi: true,
  }
}

/** Curated starter skills per domain (expandable later). */
export const DOMAIN_SKILLS: readonly DomainSkillDef[] = [
  // Education
  skill(
    'education',
    'giao-an',
    'soan-thao',
    'Khung giáo án',
    'Lesson plan outline',
    'Lập khung giáo án theo môn/lớp/bài, mục tiêu và hoạt động.',
    'Outline a lesson plan by subject/grade with goals and activities.',
  ),
  skill(
    'education',
    'hoc-lieu',
    'hoc-lieu',
    'Học liệu tóm tắt',
    'Study sheet',
    'Tóm tắt kiến thức trọng tâm thành học liệu ngắn cho học sinh.',
    'Summarize key knowledge into a short student study sheet.',
  ),
  skill(
    'education',
    'de-kiem-tra',
    'danh-gia',
    'Đề kiểm tra ngắn',
    'Short quiz',
    'Soạn đề kiểm tra 10–15 phút kèm đáp án gợi ý.',
    'Draft a 10–15 minute quiz with suggested answers.',
  ),
  skill(
    'education',
    'slide-bai',
    'hoc-lieu',
    'Slide bài giảng',
    'Lecture slides',
    'Dàn ý slide bài giảng rõ mục tiêu và hoạt động.',
    'Slide outline with objectives and activities.',
    'slides',
  ),

  // Health
  skill(
    'health',
    'tom-tat-kham',
    'ho-so',
    'Tóm tắt lần khám',
    'Visit summary',
    'Tóm tắt triệu chứng, ghi nhận và việc cần theo dõi (không chẩn đoán thay bác sĩ).',
    'Summarize symptoms, notes, and follow-ups (not a medical diagnosis).',
  ),
  skill(
    'health',
    'cau-hoi-bac-si',
    'tu-van',
    'Câu hỏi gặp bác sĩ',
    'Doctor visit questions',
    'Chuẩn bị danh sách câu hỏi trước khi đi khám.',
    'Prepare questions before a doctor visit.',
  ),
  skill(
    'health',
    'ke-hoach-cham-soc',
    'theo-doi',
    'Kế hoạch chăm sóc tại nhà',
    'Home care plan',
    'Gợi ý lịch uống thuốc / nghỉ ngơi / dấu hiệu cần tái khám.',
    'Suggest meds/rest schedule and red-flag signs.',
  ),

  // Legal
  skill(
    'legal',
    'tom-tat-vu',
    'ho-so',
    'Tóm tắt hồ sơ',
    'Matter summary',
    'Tóm tắt sự kiện, yêu cầu và điểm pháp lý cần kiểm chứng.',
    'Summarize facts, asks, and legal points to verify.',
  ),
  skill(
    'legal',
    'dieu-khoan',
    'hop-dong',
    'Rà điều khoản hợp đồng',
    'Contract clause check',
    'Liệt kê điều khoản rủi ro và câu hỏi cần làm rõ (không thay luật sư).',
    'List risky clauses and clarifying questions (not legal advice).',
  ),
  skill(
    'legal',
    'thu-yeu-cau',
    'thu-tin',
    'Nháp thư yêu cầu',
    'Demand letter draft',
    'Nháp thư lịch sự nêu căn cứ và yêu cầu.',
    'Polite demand letter with grounds and asks.',
  ),

  // Design consulting
  skill(
    'design',
    'brief',
    'brief',
    'Design brief',
    'Design brief',
    'Làm rõ mục tiêu, đối tượng, ràng buộc và deliverable.',
    'Clarify goals, audience, constraints, and deliverables.',
  ),
  skill(
    'design',
    'de-xuat',
    'de-xuat',
    'Đề xuất phương án',
    'Concept proposal',
    'Nháp đề xuất 2–3 phương án kèm ưu/nhược.',
    'Draft 2–3 concepts with pros/cons.',
  ),
  skill(
    'design',
    'thuyet-minh',
    'thuyet-minh',
    'Thuyết minh thiết kế',
    'Design narrative',
    'Viết thuyết minh ngắn cho khách / hội đồng.',
    'Short design narrative for clients or reviews.',
  ),

  // Project management
  skill(
    'project-mgmt',
    'ke-hoach',
    'ke-hoach',
    'Kế hoạch dự án tuần',
    'Weekly project plan',
    'Lập mục tiêu tuần, việc ưu tiên và rủi ro.',
    'Weekly goals, priorities, and risks.',
  ),
  skill(
    'project-mgmt',
    'bao-cao',
    'bao-cao',
    'Báo cáo tiến độ',
    'Progress report',
    'Báo cáo tiến độ: đã làm / đang làm / blocker.',
    'Progress: done / doing / blockers.',
  ),
  skill(
    'project-mgmt',
    'rui-ro',
    'rui-ro',
    'Ma trận rủi ro nhanh',
    'Quick risk matrix',
    'Liệt kê rủi ro, mức độ, biện pháp giảm thiểu.',
    'List risks, severity, and mitigations.',
  ),

  // Sales
  skill(
    'sales',
    'pitch',
    'pitch',
    'Pitch ngắn',
    'Short pitch',
    'Pitch 1 trang: vấn đề, giải pháp, giá trị, CTA.',
    'One-page pitch: problem, solution, value, CTA.',
  ),
  skill(
    'sales',
    'bao-gia',
    'bao-gia',
    'Khung báo giá',
    'Quote outline',
    'Khung báo giá rõ hạng mục, điều kiện, thời hạn.',
    'Quote outline with items, terms, validity.',
  ),
  skill(
    'sales',
    'follow-up',
    'cham-soc',
    'Email follow-up',
    'Follow-up email',
    'Email theo dõi lịch sự sau buổi demo / gặp khách.',
    'Polite follow-up after a demo or meeting.',
  ),

  // Admin
  skill(
    'admin',
    'cong-van',
    'cong-van',
    'Nháp công văn',
    'Official memo draft',
    'Nháp công văn / tờ trình hành chính rõ căn cứ và đề xuất.',
    'Draft an admin memo with grounds and proposal.',
  ),
  skill(
    'admin',
    'bien-ban',
    'hop',
    'Biên bản họp',
    'Meeting minutes',
    'Biên bản họp: thành phần, nội dung, kết luận, việc giao.',
    'Minutes: attendees, discussion, decisions, actions.',
  ),
  skill(
    'admin',
    'lich-tuan',
    'lich',
    'Lịch tuần văn phòng',
    'Office week plan',
    'Sắp lịch tuần theo ưu tiên và deadline.',
    'Plan the week by priority and deadlines.',
  ),

  // HR
  skill(
    'hr',
    'jd',
    'tuyen-dung',
    'Mô tả công việc (JD)',
    'Job description',
    'Viết JD rõ trách nhiệm, yêu cầu, quyền lợi.',
    'JD with responsibilities, requirements, benefits.',
  ),
  skill(
    'hr',
    'phong-van',
    'tuyen-dung',
    'Câu hỏi phỏng vấn',
    'Interview questions',
    'Bộ câu hỏi phỏng vấn theo năng lực vị trí.',
    'Competency-based interview questions.',
  ),
  skill(
    'hr',
    'danh-gia',
    'danh-gia',
    'Khung đánh giá nhân sự',
    'Review framework',
    'Khung đánh giá định kỳ: tiêu chí và gợi ý phản hồi.',
    'Periodic review framework: criteria and feedback prompts.',
  ),

  // Customer care
  skill(
    'customer-care',
    'phan-hoi',
    'phan-hoi',
    'Trả lời khách hàng',
    'Customer reply',
    'Thư/tin trả lời lịch sự, rõ bước xử lý tiếp theo.',
    'Polite reply with clear next steps.',
  ),
  skill(
    'customer-care',
    'khieu-nai',
    'khieu-nai',
    'Xử lý khiếu nại',
    'Complaint handling',
    'Khung xin lỗi – giải thích – bồi hoàn – phòng ngừa.',
    'Apology – explain – remedy – prevent framework.',
  ),
  skill(
    'customer-care',
    'faq',
    'faq',
    'FAQ sản phẩm/dịch vụ',
    'Product/service FAQ',
    'Soạn FAQ ngắn gọn từ vấn đề hay gặp.',
    'Short FAQ from common issues.',
  ),

  // Personal
  skill(
    'personal',
    'ke-hoach-tuan',
    'ke-hoach',
    'Kế hoạch tuần cá nhân',
    'Personal week plan',
    'Cân bằng việc – sức khoẻ – gia đình trong tuần.',
    'Balance work, health, and family for the week.',
  ),
  skill(
    'personal',
    'muc-tieu',
    'muc-tieu',
    'Làm rõ mục tiêu',
    'Clarify goals',
    'Chia mục tiêu thành việc nhỏ đo được trong 30 ngày.',
    'Break goals into measurable 30-day actions.',
  ),
  skill(
    'personal',
    'nhat-ky',
    'ghi-chep',
    'Nhật ký phản tư',
    'Reflection journal',
    'Gợi ý nhật ký cuối ngày: biết ơn, học được, việc mai.',
    'End-of-day journal: gratitude, lessons, tomorrow.',
  ),
]

/** Domains pinned when the user has never customized Skill tabs. */
export function defaultPinnedSkillDomains(): SkillDomainId[] {
  return ['education', 'personal', 'admin']
}

export function getSkillDomain(id: SkillDomainId): SkillDomainDef | undefined {
  return SKILL_DOMAINS.find((d) => d.id === id)
}

export function isSkillDomainId(value: unknown): value is SkillDomainId {
  return typeof value === 'string' && SKILL_DOMAINS.some((d) => d.id === value)
}

export function skillsForDomain(domainId: SkillDomainId): DomainSkillDef[] {
  return DOMAIN_SKILLS.filter((s) => s.domainId === domainId)
}

export function getDomainSkill(skillId: string): DomainSkillDef | undefined {
  return DOMAIN_SKILLS.find((s) => s.id === skillId)
}

/** Prompt for a domain skill with free-form context lines. */
export function domainSkillPrompt(
  skillLabel: string,
  skillDesc: string,
  domainLabel: string,
  contextLines: string[],
): string {
  const ctx = contextLines.filter((l) => l.trim()).join('\n')
  return [
    `Bạn là trợ lý chuyên môn lĩnh vực «${domainLabel}» trên UniOffice (soạn thảo tại máy, ngữ cảnh Việt Nam khi phù hợp).`,
    'Không bịa số liệu chuyên môn; nêu rõ giả định.',
    '',
    `Nhiệm vụ: ${skillLabel}`,
    skillDesc,
    '',
    ctx ? `Ngữ cảnh:\n${ctx}` : 'Ngữ cảnh: (chưa chọn gói — viết khung chung có thể điền sau).',
    '',
    'Viết nội dung sẵn đưa vào tài liệu đang mở, cấu trúc rõ ràng, tiếng Việt.',
  ].join('\n')
}
