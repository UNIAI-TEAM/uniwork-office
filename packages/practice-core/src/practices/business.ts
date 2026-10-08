import { DEFAULT_PILLARS } from '../pillars.js'
import type { PracticeDefinition, PracticeId, PracticeSkillDef } from '../types.js'

type BusinessPracticeId = Exclude<
  PracticeId,
  'teacher' | 'legal' | 'construction' | 'procurement' | 'principal'
>

interface BusinessPracticeInput {
  id: BusinessPracticeId
  labelVi: string
  labelEn: string
  subtitleVi: string
  subtitleEn: string
  /** Primary work-item facet label */
  workVi: string
  workEn: string
  categories: readonly string[]
  skillHints: readonly { id: string; labelVi: string; labelEn: string; descVi: string; descEn: string }[]
}

function skill(
  id: string,
  labelVi: string,
  labelEn: string,
  descVi: string,
  descEn: string,
  seedRole: string,
): PracticeSkillDef {
  return {
    id,
    category: 'ai',
    labelVi,
    labelEn,
    descVi,
    descEn,
    app: 'docs',
    seedRole,
    usesAi: true,
  }
}

function defineBusinessPractice(input: BusinessPracticeInput): PracticeDefinition {
  return {
    id: input.id,
    projectKind: input.id,
    labelVi: input.labelVi,
    labelEn: input.labelEn,
    subtitleVi: input.subtitleVi,
    subtitleEn: input.subtitleEn,
    titleFacetId: 'workTitle',
    facets: [
      {
        id: 'org',
        labelVi: 'Tổ chức / thương hiệu',
        labelEn: 'Org / brand',
        required: true,
      },
      {
        id: 'category',
        labelVi: 'Nhóm công việc',
        labelEn: 'Work category',
        required: true,
        options: input.categories,
      },
      {
        id: 'workTitle',
        labelVi: input.workVi,
        labelEn: input.workEn,
        required: true,
      },
      {
        id: 'status',
        labelVi: 'Trạng thái',
        labelEn: 'Status',
        options: ['Đang làm', 'Chờ phản hồi', 'Hoàn thành', 'Tạm dừng'],
      },
    ],
    pillars: DEFAULT_PILLARS,
    materialRoles: [
      { id: 'brief', labelVi: 'Brief / mô tả', labelEn: 'Brief', app: 'docs' },
      { id: 'email-draft', labelVi: 'Nháp email', labelEn: 'Email draft', app: 'docs' },
      { id: 'checklist', labelVi: 'Checklist', labelEn: 'Checklist', app: 'sheets' },
      { id: 'report', labelVi: 'Báo cáo', labelEn: 'Report', app: 'docs' },
      { id: 'slide', labelVi: 'Slide trình bày', labelEn: 'Deck', app: 'slides' },
      { id: 'khac', labelVi: 'Khác', labelEn: 'Other', app: 'docs' },
    ],
    templates: [
      { id: 'brief', labelVi: 'Brief', labelEn: 'Brief', app: 'docs', materialRole: 'brief' },
      {
        id: 'email-draft',
        labelVi: 'Nháp email',
        labelEn: 'Email draft',
        app: 'docs',
        materialRole: 'email-draft',
      },
      { id: 'report', labelVi: 'Báo cáo', labelEn: 'Report', app: 'docs', materialRole: 'report' },
    ],
    skills: input.skillHints.map((s) =>
      skill(s.id, s.labelVi, s.labelEn, s.descVi, s.descEn, 'brief'),
    ),
    freeChainTemplateIds: ['brief', 'email-draft', 'report'],
  }
}

export const salesPractice = defineBusinessPractice({
  id: 'sales',
  labelVi: 'Bán hàng',
  labelEn: 'Sales',
  subtitleVi: 'Deal · báo giá · follow-up khách hàng',
  subtitleEn: 'Deals · quotes · customer follow-up',
  workVi: 'Tên deal / cơ hội',
  workEn: 'Deal / opportunity',
  categories: ['Lead mới', 'Demo', 'Báo giá', 'Đàm phán', 'Chốt đơn', 'After-sales'],
  skillHints: [
    {
      id: 'sales-outreach',
      labelVi: 'Email tiếp cận',
      labelEn: 'Outreach email',
      descVi: 'Thư ngắn gọn mở hội thoại với lead.',
      descEn: 'Short outreach email to start a conversation.',
    },
    {
      id: 'sales-quote',
      labelVi: 'Nháp báo giá',
      labelEn: 'Quote draft',
      descVi: 'Tóm phạm vi, giá trị, điều kiện thương mại.',
      descEn: 'Scope, value, and commercial terms outline.',
    },
    {
      id: 'sales-followup',
      labelVi: 'Follow-up sau demo',
      labelEn: 'Post-demo follow-up',
      descVi: 'Nhắc lợi ích, bước tiếp, CTA rõ.',
      descEn: 'Recap value, next step, clear CTA.',
    },
  ],
})

export const customerCarePractice = defineBusinessPractice({
  id: 'customer-care',
  labelVi: 'Chăm sóc khách hàng',
  labelEn: 'Customer care',
  subtitleVi: 'Ticket · phản hồi · giữ chân khách',
  subtitleEn: 'Tickets · replies · retention',
  workVi: 'Ticket / vụ việc CSKH',
  workEn: 'Support ticket / case',
  categories: ['Hỗ trợ kỹ thuật', 'Khiếu nại', 'Hoàn tiền', 'Onboarding', 'Gia hạn', 'Khác'],
  skillHints: [
    {
      id: 'cs-reply',
      labelVi: 'Trả lời khách lịch sự',
      labelEn: 'Polite customer reply',
      descVi: 'Thừa nhận vấn đề, hướng xử lý, thời hạn.',
      descEn: 'Acknowledge issue, resolution path, timeline.',
    },
    {
      id: 'cs-escalation',
      labelVi: 'Tóm tắt escalate',
      labelEn: 'Escalation summary',
      descVi: 'Tóm ticket cho team nội bộ / cấp trên.',
      descEn: 'Internal escalation brief for the team.',
    },
    {
      id: 'cs-retention',
      labelVi: 'Thư giữ chân',
      labelEn: 'Retention note',
      descVi: 'Xin lỗi + ưu đãi / bước bù đắp phù hợp.',
      descEn: 'Apology plus a fitting goodwill next step.',
    },
  ],
})

export const entrepreneurPractice = defineBusinessPractice({
  id: 'entrepreneur',
  labelVi: 'Doanh nhân',
  labelEn: 'Entrepreneur',
  subtitleVi: 'Ý tưởng · kế hoạch · vận hành startup',
  subtitleEn: 'Ideas · plans · startup ops',
  workVi: 'Sáng kiến / dự án',
  workEn: 'Initiative / project',
  categories: ['Ý tưởng', 'Gọi vốn', 'Sản phẩm', 'Vận hành', 'Đối tác', 'Tài chính'],
  skillHints: [
    {
      id: 'ent-pitch',
      labelVi: 'Pitch ngắn',
      labelEn: 'Short pitch',
      descVi: 'Problem–solution–traction trong 1 trang.',
      descEn: 'Problem–solution–traction on one page.',
    },
    {
      id: 'ent-plan',
      labelVi: 'Kế hoạch 30 ngày',
      labelEn: '30-day plan',
      descVi: 'Mục tiêu, việc ưu tiên, chỉ số theo dõi.',
      descEn: 'Goals, priorities, and tracking metrics.',
    },
    {
      id: 'ent-partner',
      labelVi: 'Email đối tác',
      labelEn: 'Partner email',
      descVi: 'Đề xuất hợp tác rõ lợi ích hai bên.',
      descEn: 'Partnership ask with mutual value.',
    },
  ],
})

export const freelancerPractice = defineBusinessPractice({
  id: 'freelancer',
  labelVi: 'Lao động tự do',
  labelEn: 'Freelancer',
  subtitleVi: 'Khách hàng · báo giá · giao hàng dự án',
  subtitleEn: 'Clients · quotes · project delivery',
  workVi: 'Tên dự án / gói dịch vụ',
  workEn: 'Project / service package',
  categories: ['Discovery', 'Báo giá', 'Đang làm', 'Review', 'Bàn giao', 'Bảo hành'],
  skillHints: [
    {
      id: 'fl-proposal',
      labelVi: 'Proposal dịch vụ',
      labelEn: 'Service proposal',
      descVi: 'Phạm vi, timeline, phí, điều khoản.',
      descEn: 'Scope, timeline, fees, terms.',
    },
    {
      id: 'fl-status',
      labelVi: 'Cập nhật tiến độ',
      labelEn: 'Status update',
      descVi: 'Đã làm / đang làm / cần quyết định.',
      descEn: 'Done / in progress / decisions needed.',
    },
    {
      id: 'fl-invoice',
      labelVi: 'Nhắc thanh toán',
      labelEn: 'Payment reminder',
      descVi: 'Thư nhắc lịch sự kèm số tiền và hạn.',
      descEn: 'Polite reminder with amount and due date.',
    },
  ],
})

export const contentCreatorPractice = defineBusinessPractice({
  id: 'content-creator',
  labelVi: 'Nhà sáng tạo nội dung',
  labelEn: 'Content creator',
  subtitleVi: 'Ý tưởng · kịch bản · lịch đăng',
  subtitleEn: 'Ideas · scripts · publishing calendar',
  workVi: 'Tên nội dung / series',
  workEn: 'Content / series title',
  categories: ['YouTube', 'TikTok/Reels', 'Blog', 'Newsletter', 'Podcast', 'Livestream'],
  skillHints: [
    {
      id: 'cc-script',
      labelVi: 'Kịch bản video',
      labelEn: 'Video script',
      descVi: 'Hook–thân–CTA, thời lượng gợi ý.',
      descEn: 'Hook–body–CTA with timing cues.',
    },
    {
      id: 'cc-caption',
      labelVi: 'Caption + hashtag',
      labelEn: 'Caption + hashtags',
      descVi: 'Caption hấp dẫn, CTA, hashtag phù hợp.',
      descEn: 'Catchy caption, CTA, relevant hashtags.',
    },
    {
      id: 'cc-calendar',
      labelVi: 'Lịch nội dung tuần',
      labelEn: 'Weekly content plan',
      descVi: '7 ý tưởng theo chủ đề và nền tảng.',
      descEn: 'Seven ideas by theme and platform.',
    },
  ],
})

export const marketingPractice = defineBusinessPractice({
  id: 'marketing',
  labelVi: 'Marketing',
  labelEn: 'Marketing',
  subtitleVi: 'Chiến dịch · landing · đo lường',
  subtitleEn: 'Campaigns · landing · measurement',
  workVi: 'Tên chiến dịch',
  workEn: 'Campaign name',
  categories: ['Brand', 'Performance', 'Content', 'Email', 'Event', 'PR'],
  skillHints: [
    {
      id: 'mkt-brief',
      labelVi: 'Brief chiến dịch',
      labelEn: 'Campaign brief',
      descVi: 'Mục tiêu, audience, message, KPI.',
      descEn: 'Goals, audience, message, KPIs.',
    },
    {
      id: 'mkt-copy',
      labelVi: 'Copy quảng cáo',
      labelEn: 'Ad copy',
      descVi: '3 biến thể headline + mô tả ngắn.',
      descEn: 'Three headline + short-description variants.',
    },
    {
      id: 'mkt-report',
      labelVi: 'Báo cáo tuần',
      labelEn: 'Weekly report',
      descVi: 'Số liệu chính, insight, việc tuần tới.',
      descEn: 'Key metrics, insights, next-week actions.',
    },
  ],
})

export const hrPractice = defineBusinessPractice({
  id: 'hr',
  labelVi: 'Nhân sự',
  labelEn: 'HR',
  subtitleVi: 'Tuyển dụng · onboarding · nội bộ',
  subtitleEn: 'Hiring · onboarding · internal HR',
  workVi: 'Vị trí / vụ việc NS',
  workEn: 'Role / HR case',
  categories: ['Tuyển dụng', 'Onboarding', 'Đánh giá', 'Chính sách', 'Đào tạo', 'Offboarding'],
  skillHints: [
    {
      id: 'hr-jd',
      labelVi: 'Mô tả công việc (JD)',
      labelEn: 'Job description',
      descVi: 'Trách nhiệm, yêu cầu, đãi ngộ khung.',
      descEn: 'Responsibilities, requirements, banded benefits.',
    },
    {
      id: 'hr-offer',
      labelVi: 'Thư offer',
      labelEn: 'Offer letter draft',
      descVi: 'Thư mời nhận việc lịch sự, rõ điều khoản chính.',
      descEn: 'Polite offer note with key terms.',
    },
    {
      id: 'hr-onboard',
      labelVi: 'Checklist onboarding',
      labelEn: 'Onboarding checklist',
      descVi: 'Việc 7 ngày đầu cho nhân sự mới.',
      descEn: 'First-week checklist for a new hire.',
    },
  ],
})

export const accountingPractice = defineBusinessPractice({
  id: 'accounting',
  labelVi: 'Kế toán',
  labelEn: 'Accounting',
  subtitleVi: 'Chứng từ · báo cáo · đối soát',
  subtitleEn: 'Vouchers · reports · reconciliation',
  workVi: 'Kỳ / vụ kế toán',
  workEn: 'Period / accounting case',
  categories: ['Thu', 'Chi', 'Đối soát', 'Thuế', 'Báo cáo', 'Khác'],
  skillHints: [
    {
      id: 'acc-memo',
      labelVi: 'Giải trình số liệu',
      labelEn: 'Variance memo',
      descVi: 'Giải thích chênh lệch ngắn gọn cho quản lý.',
      descEn: 'Short variance explanation for management.',
    },
    {
      id: 'acc-request',
      labelVi: 'Yêu cầu chứng từ',
      labelEn: 'Document request',
      descVi: 'Email nhắc nộp hoá đơn / chứng từ còn thiếu.',
      descEn: 'Email requesting missing invoices/docs.',
    },
    {
      id: 'acc-summary',
      labelVi: 'Tóm tắt dòng tiền tuần',
      labelEn: 'Weekly cash summary',
      descVi: 'Thu–chi–tồn và điểm cần lưu ý.',
      descEn: 'In–out–balance and watchouts.',
    },
  ],
})

export const itPractice = defineBusinessPractice({
  id: 'it',
  labelVi: 'Công nghệ / IT',
  labelEn: 'IT / Technology',
  subtitleVi: 'Ticket kỹ thuật · đặc tả · bàn giao',
  subtitleEn: 'Tech tickets · specs · handoff',
  workVi: 'Ticket / hạng mục kỹ thuật',
  workEn: 'Ticket / tech item',
  categories: ['Bug', 'Feature', 'Infra', 'Bảo mật', 'Hỗ trợ nội bộ', 'Tài liệu'],
  skillHints: [
    {
      id: 'it-spec',
      labelVi: 'Đặc tả ngắn',
      labelEn: 'Short spec',
      descVi: 'Vấn đề, giải pháp đề xuất, tiêu chí xong.',
      descEn: 'Problem, proposed fix, done criteria.',
    },
    {
      id: 'it-incident',
      labelVi: 'Báo cáo sự cố',
      labelEn: 'Incident report',
      descVi: 'Timeline, impact, root cause giả định, hành động.',
      descEn: 'Timeline, impact, likely cause, actions.',
    },
    {
      id: 'it-handoff',
      labelVi: 'Handoff kỹ thuật',
      labelEn: 'Tech handoff',
      descVi: 'Ngữ cảnh, cách chạy, rủi ro còn lại.',
      descEn: 'Context, how to run, remaining risks.',
    },
  ],
})

export const realEstatePractice = defineBusinessPractice({
  id: 'real-estate',
  labelVi: 'Bất động sản',
  labelEn: 'Real estate',
  subtitleVi: 'Listing · khách xem · chốt giao dịch',
  subtitleEn: 'Listings · viewings · closings',
  workVi: 'Sản phẩm / giao dịch',
  workEn: 'Listing / deal',
  categories: ['Listing mới', 'Lead', 'Xem nhà', 'Đàm phán', 'Công chứng', 'After-sales'],
  skillHints: [
    {
      id: 're-listing',
      labelVi: 'Mô tả listing',
      labelEn: 'Listing copy',
      descVi: 'Điểm nổi bật, tiện ích, CTA liên hệ.',
      descEn: 'Highlights, amenities, contact CTA.',
    },
    {
      id: 're-followup',
      labelVi: 'Follow-up sau xem nhà',
      labelEn: 'Post-viewing follow-up',
      descVi: 'Cảm ơn, tóm ưu điểm, bước tiếp.',
      descEn: 'Thanks, key upsides, next step.',
    },
    {
      id: 're-offer',
      labelVi: 'Nháp đề nghị giá',
      labelEn: 'Offer note',
      descVi: 'Đề xuất giá và điều kiện chính.',
      descEn: 'Price proposal and key conditions.',
    },
  ],
})

export const BUSINESS_PRACTICES: readonly PracticeDefinition[] = [
  salesPractice,
  customerCarePractice,
  entrepreneurPractice,
  freelancerPractice,
  contentCreatorPractice,
  marketingPractice,
  hrPractice,
  accountingPractice,
  itPractice,
  realEstatePractice,
]
