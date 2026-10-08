/**
 * Phase C — practice-scoped playbooks for My AI (1 command → multi-step).
 */
import {
  createAgentIntent,
  getPractice,
  type PracticeId,
} from '@uniwork/practice-core'
import type { MyAiStep } from './my-ai-router'

export interface MyAiPlaybookChip {
  id: string
  labelVi: string
  labelEn: string
  promptVi: string
  promptEn: string
}

export interface MyAiPlaybook {
  id: string
  /** Empty = all practices */
  practiceIds: readonly PracticeId[]
  labelVi: string
  labelEn: string
  chip: MyAiPlaybookChip
  /** Match NL (already lowercased + diacritics-stripped variants checked by caller) */
  match: (lower: string, lowerNorm: string) => boolean
  buildSteps: (raw: string) => MyAiStep[]
}

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '')
}

function wb(
  action: 'open' | 'add_item',
  moduleId: 'tasks' | 'clients' | 'contracts' | 'calendar' | 'email' | 'notes',
  text: string,
  summary: string,
): MyAiStep {
  return {
    kind: 'workbench',
    intent: createAgentIntent({
      target: { kind: 'module', id: moduleId },
      action,
      scope: 'local',
      source: 'desktop',
      requireConsent: false,
      summary,
      text,
    }),
  }
}

function createDocs(brief: string): MyAiStep {
  return { kind: 'create_file', app: 'docs', blank: false, brief }
}

function fillTemplate(templateId: string, raw: string): MyAiStep {
  return { kind: 'fill_template', templateId, hint: raw }
}

function createSlides(brief: string): MyAiStep {
  return { kind: 'create_file', app: 'slides', blank: false, brief }
}

function createSheets(brief: string): MyAiStep {
  return { kind: 'create_file', app: 'sheets', blank: false, brief }
}

function residualBrief(raw: string, junk: RegExp[]): string {
  let s = raw
  for (const re of junk) s = s.replace(re, ' ')
  return s.replace(/\s+/g, ' ').trim().slice(0, 240)
}

const AND_TAIL = /(?:và|rồi|then|and).+$/i

const PLAYBOOKS: readonly MyAiPlaybook[] = [
  {
    id: 'sales-quote',
    practiceIds: ['sales', 'entrepreneur', 'freelancer', 'real-estate'],
    labelVi: 'Báo giá + follow-up',
    labelEn: 'Quote + follow-up',
    chip: {
      id: 'sales-quote',
      labelVi: 'Báo giá + việc + Clients',
      labelEn: 'Quote + task + Clients',
      promptVi: 'Soạn báo giá Word và thêm việc follow-up, mở tab Clients',
      promptEn: 'Draft a Word quote and add a follow-up task, open Clients',
    },
    match: (lower, norm) =>
      /(?:báo giá|bao gia|quote|pricing|đề xuất giá|de xuat gia)/i.test(lower) ||
      /(?:bao gia|quote)/i.test(norm),
    buildSteps: (raw) => {
      const topic =
        residualBrief(raw, [
          AND_TAIL,
          /(?:soạn|soan|tạo|tao|viết|viet|draft|create)/gi,
          /(?:báo giá|bao gia|quote)/gi,
          /(?:word|văn bản|van ban)/gi,
        ]) || 'báo giá'
      return [
        fillTemplate('sales-quote', raw),
        wb('add_item', 'tasks', `Follow-up báo giá: ${topic.slice(0, 80)}`, 'Thêm việc follow-up'),
        wb('open', 'clients', 'Mở tab Clients', 'Mở Clients'),
      ]
    },
  },
  {
    id: 'marketing-campaign',
    practiceIds: ['marketing'],
    labelVi: 'Chiến dịch marketing',
    labelEn: 'Marketing campaign',
    chip: {
      id: 'marketing-campaign',
      labelVi: 'Brief + slide + lịch',
      labelEn: 'Brief + deck + calendar',
      promptVi: 'Soạn brief chiến dịch Word, tạo slide pitch, thêm việc kickoff, mở lịch',
      promptEn: 'Draft a campaign brief, create a pitch deck, add a kickoff task, open calendar',
    },
    match: (lower, norm) =>
      /(?:chiến dịch|chien dich|campaign|go[\s-]?to[\s-]?market|gtm|brief chiến dịch|brief chien dich)/i.test(
        lower,
      ) || /(?:chien dich|campaign|gtm)/i.test(norm),
    buildSteps: (raw) => {
      const topic =
        residualBrief(raw, [
          AND_TAIL,
          /(?:soạn|soan|tạo|tao|viết|viet|draft|create)/gi,
          /(?:brief|chiến dịch|chien dich|campaign|word|slide|pitch)/gi,
        ]) || 'Chiến dịch — mục tiêu, audience, message, KPI, ngân sách'
      return [
        fillTemplate('marketing-campaign', raw),
        createSlides(`Pitch chiến dịch: ${topic}`),
        wb('add_item', 'tasks', `Kickoff chiến dịch: ${topic.slice(0, 80)}`, 'Thêm việc kickoff'),
        wb('open', 'calendar', 'Mở lịch', 'Open calendar'),
      ]
    },
  },
  {
    id: 'accounting-invoice',
    practiceIds: ['accounting', 'freelancer', 'entrepreneur'],
    labelVi: 'Hóa đơn / chứng từ',
    labelEn: 'Invoice / voucher',
    chip: {
      id: 'accounting-invoice',
      labelVi: 'Hóa đơn Excel + việc',
      labelEn: 'Invoice sheet + task',
      promptVi: 'Tạo bảng hóa đơn Excel, nháp email yêu cầu chứng từ (tab Email), thêm việc đối soát',
      promptEn: 'Create an invoice sheet, draft a voucher-request in Email tab, add a reconcile task',
    },
    match: (lower, norm) =>
      /(?:hóa đơn|hoa don|invoice|chứng từ|chung tu|billing|xuất hóa đơn|xuat hoa don|nhắc thanh toán|nhac thanh toan)/i.test(
        lower,
      ) || /(?:hoa don|invoice|chung tu|billing)/i.test(norm),
    buildSteps: (raw) => {
      const topic =
        residualBrief(raw, [
          AND_TAIL,
          /(?:tạo|tao|soạn|soan|viết|viet|draft|create)/gi,
          /(?:bảng|bang|excel|sheet|word|email)/gi,
          /(?:hóa đơn|hoa don|invoice|chứng từ|chung tu)/gi,
        ]) || 'Hóa đơn / chứng từ — khách hàng, hạng mục, VAT, hạn thanh toán'
      return [
        createSheets(
          `Bảng hóa đơn / theo dõi chứng từ: ${topic}. Cột: STT, mô tả, SL, đơn giá, VAT, thành tiền, hạn TT, trạng thái.`,
        ),
        wb(
          'add_item',
          'email',
          `Yêu cầu chứng từ / nhắc thanh toán: ${topic.slice(0, 120)}`,
          'Nháp email chứng từ',
        ),
        wb('add_item', 'tasks', `Đối soát hóa đơn: ${topic.slice(0, 80)}`, 'Thêm việc đối soát'),
      ]
    },
  },
  {
    id: 'it-runbook',
    practiceIds: ['it'],
    labelVi: 'Runbook / sự cố IT',
    labelEn: 'IT runbook / incident',
    chip: {
      id: 'it-runbook',
      labelVi: 'Runbook + việc + Notes',
      labelEn: 'Runbook + task + Notes',
      promptVi: 'Soạn runbook xử lý sự cố Word, thêm việc theo dõi, mở Notes',
      promptEn: 'Draft an incident runbook in Word, add a tracking task, open Notes',
    },
    match: (lower, norm) =>
      /(?:runbook|sự cố|su co|incident|sop|quy trình xử lý|quy trinh xu ly|handoff|đặc tả|dac ta|postmortem)/i.test(
        lower,
      ) || /(?:runbook|su co|incident|sop|dac ta|handoff)/i.test(norm),
    buildSteps: (raw) => {
      const topic =
        residualBrief(raw, [
          AND_TAIL,
          /(?:soạn|soan|tạo|tao|viết|viet|draft)/gi,
          /(?:runbook|sự cố|su co|incident|sop|word)/gi,
        ]) || 'Sự cố / dịch vụ — triệu chứng, bước kiểm tra, rollback, liên hệ on-call'
      return [
        createDocs(
          `Runbook / báo cáo sự cố: ${topic}. Gồm: triệu chứng, impact, bước xử lý, rollback, tiêu chí xong, liên hệ.`,
        ),
        wb('add_item', 'tasks', `Theo dõi sự cố: ${topic.slice(0, 80)}`, 'Thêm việc theo dõi sự cố'),
        wb('open', 'notes', 'Mở Notes', 'Open Notes'),
      ]
    },
  },
  {
    id: 'construction-site',
    practiceIds: ['construction'],
    labelVi: 'Nhật ký / biên bản HT',
    labelEn: 'Site log / minutes',
    chip: {
      id: 'construction-site',
      labelVi: 'Nhật ký + checklist GS',
      labelEn: 'Site log + checklist',
      promptVi: 'Soạn nhật ký giám sát Word và checklist Excel, thêm việc theo dõi tồn đọng',
      promptEn: 'Draft a supervision log and Excel checklist, add a punch-list task',
    },
    match: (lower, norm) =>
      /(?:nhật ký|nhat ky|biên bản|bien ban|hiện trường|hien truong|giám sát|giam sat|checklist gs|site (?:log|minutes)|punch.?list)/i.test(
        lower,
      ) || /(?:nhat ky|bien ban|hien truong|giam sat)/i.test(norm),
    buildSteps: (raw) => {
      const topic =
        residualBrief(raw, [
          AND_TAIL,
          /(?:soạn|soan|tạo|tao|viết|viet|draft)/gi,
          /(?:nhật ký|nhat ky|biên bản|bien ban|word|excel|checklist)/gi,
        ]) || 'Hạng mục / đợt GS — thời tiết, nhân lực, khối lượng, tồn đọng'
      return [
        fillTemplate('construction-site', raw),
        createSheets(`Checklist giám sát: ${topic}. Cột: hạng mục, tiêu chí, đạt/không, ghi chú, ảnh.`),
        wb('add_item', 'tasks', `Tồn đọng hiện trường: ${topic.slice(0, 80)}`, 'Thêm việc tồn đọng'),
      ]
    },
  },
  {
    id: 'content-calendar',
    practiceIds: ['content-creator', 'marketing'],
    labelVi: 'Lịch / kịch bản nội dung',
    labelEn: 'Content calendar / script',
    chip: {
      id: 'content-calendar',
      labelVi: 'Kịch bản + lịch ND',
      labelEn: 'Script + content calendar',
      promptVi: 'Soạn kịch bản video Word, tạo lịch nội dung Excel, mở lịch',
      promptEn: 'Draft a video script, create a content calendar sheet, open calendar',
    },
    match: (lower, norm) =>
      /(?:kịch bản|kich ban|caption|hashtag|lịch nội dung|lich noi dung|content calendar|script video|reel)/i.test(
        lower,
      ) || /(?:kich ban|lich noi dung|content calendar|caption)/i.test(norm),
    buildSteps: (raw) => {
      const topic =
        residualBrief(raw, [
          AND_TAIL,
          /(?:soạn|soan|tạo|tao|viết|viet|draft)/gi,
          /(?:kịch bản|kich ban|lịch nội dung|lich noi dung|word|excel|video)/gi,
        ]) || 'Nội dung tuần — chủ đề, CTA, kênh đăng'
      return [
        createDocs(`Kịch bản / caption: ${topic}`),
        createSheets(
          `Lịch nội dung: ${topic}. Cột: ngày, kênh, format, tiêu đề, CTA, trạng thái.`,
        ),
        wb('open', 'calendar', 'Mở lịch', 'Open calendar'),
      ]
    },
  },
  {
    id: 'entrepreneur-pitch',
    practiceIds: ['entrepreneur'],
    labelVi: 'Pitch / kế hoạch',
    labelEn: 'Pitch / plan',
    chip: {
      id: 'entrepreneur-pitch',
      labelVi: 'Pitch slide + kế hoạch',
      labelEn: 'Pitch deck + plan',
      promptVi: 'Tạo slide pitch gọi vốn và soạn kế hoạch 30 ngày Word, thêm việc follow-up',
      promptEn: 'Create a fundraising pitch deck and a 30-day plan doc, add a follow-up task',
    },
    match: (lower, norm) =>
      /(?:pitch|gọi vốn|goi von|kế hoạch 30|ke hoach 30|deck nhà đầu tư|nha dau tu)/i.test(lower) ||
      /(?:pitch|goi von|ke hoach 30)/i.test(norm),
    buildSteps: (raw) => {
      const topic =
        residualBrief(raw, [
          AND_TAIL,
          /(?:soạn|soan|tạo|tao|viết|viet|draft|create)/gi,
          /(?:pitch|slide|word|deck|kế hoạch|ke hoach)/gi,
        ]) || 'Sản phẩm / thị trường — vấn đề, giải pháp, mô hình, roadmap 30 ngày'
      return [
        createSlides(`Pitch deck: ${topic}`),
        createDocs(`Kế hoạch 30 ngày: ${topic}`),
        wb('add_item', 'tasks', `Follow-up pitch: ${topic.slice(0, 80)}`, 'Thêm việc follow-up pitch'),
      ]
    },
  },
  {
    id: 'procurement-rfp',
    practiceIds: ['procurement'],
    labelVi: 'RFP / yêu cầu NCC',
    labelEn: 'RFP / vendor request',
    chip: {
      id: 'procurement-rfp',
      labelVi: 'RFP + Contracts',
      labelEn: 'RFP + Contracts',
      promptVi: 'Soạn RFP / yêu cầu báo giá NCC Word, thêm việc chấm thầu, mở Contracts',
      promptEn: 'Draft an RFP / vendor RFQ in Word, add an evaluation task, open Contracts',
    },
    match: (lower, norm) =>
      /(?:\brfp\b|rfq|yêu cầu báo giá|yeu cau bao gia|nhà cung cấp|nha cung cap|chào thầu|chao thau|đấu thầu|dau thau)/i.test(
        lower,
      ) || /(?:rfp|rfq|nha cung cap|chao thau|dau thau)/i.test(norm),
    buildSteps: (raw) => {
      const topic =
        residualBrief(raw, [AND_TAIL]) ||
        'RFP: phạm vi cung cấp, tiêu chí kỹ thuật, lịch nộp, tiêu chí chấm'
      return [
        createDocs(topic),
        wb('add_item', 'tasks', `Chấm thầu / RFP: ${topic.slice(0, 80)}`, 'Thêm việc chấm thầu'),
        wb('open', 'contracts', 'Mở Contracts', 'Open Contracts'),
      ]
    },
  },
  {
    id: 'hr-onboard',
    practiceIds: ['hr'],
    labelVi: 'Onboarding / JD',
    labelEn: 'Onboarding / JD',
    chip: {
      id: 'hr-onboard',
      labelVi: 'JD + checklist onboard',
      labelEn: 'JD + onboard checklist',
      promptVi: 'Soạn JD Word và checklist onboarding Excel, thêm việc 7 ngày đầu',
      promptEn: 'Draft a JD in Word and an onboarding checklist sheet, add a first-week task',
    },
    match: (lower, norm) =>
      /(?:onboard|onboarding|mô tả công việc|\bjd\b|job description|checklist (?:nhân sự|hr|onboard))/i.test(
        lower,
      ) || /(?:onboard|mo ta cong viec|\bjd\b|job description)/i.test(norm),
    buildSteps: (raw) => {
      const topic =
        residualBrief(raw, [
          AND_TAIL,
          /(?:soạn|soan|tạo|tao|viết|viet|draft)/gi,
          /(?:jd|mô tả công việc|mo ta cong viec|onboard|checklist|word|excel)/gi,
        ]) || 'Vị trí mới — trách nhiệm, yêu cầu, đãi ngộ khung'
      return [
        createDocs(`Mô tả công việc (JD): ${topic}`),
        createSheets(
          `Checklist onboarding 7 ngày: ${topic}. Cột: ngày, việc, phụ trách, xong/chưa, ghi chú.`,
        ),
        wb('add_item', 'tasks', `Onboarding: ${topic.slice(0, 80)}`, 'Thêm việc onboarding'),
      ]
    },
  },
  {
    id: 're-listing',
    practiceIds: ['real-estate'],
    labelVi: 'Listing BĐS',
    labelEn: 'Property listing',
    chip: {
      id: 're-listing',
      labelVi: 'Listing + Clients',
      labelEn: 'Listing + Clients',
      promptVi: 'Soạn mô tả listing BĐS Word, thêm việc hẹn xem nhà, mở Clients',
      promptEn: 'Draft a property listing in Word, add a viewing task, open Clients',
    },
    match: (lower, norm) =>
      /(?:listing|tin đăng|tin dang|mô tả (?:nhà|căn|bđs)|mo ta (?:nha|can|bds)|xem nhà|xem nha)/i.test(
        lower,
      ) || /(?:listing|tin dang|mo ta nha|xem nha)/i.test(norm),
    buildSteps: (raw) => {
      const topic =
        residualBrief(raw, [AND_TAIL]) ||
        'Listing: diện tích, vị trí, giá, điểm nổi bật, pháp lý, CTA xem nhà'
      return [
        createDocs(topic),
        wb('add_item', 'tasks', `Hẹn xem nhà: ${topic.slice(0, 80)}`, 'Thêm việc xem nhà'),
        wb('open', 'clients', 'Mở Clients', 'Open Clients'),
      ]
    },
  },
  {
    id: 'sales-followup',
    practiceIds: ['sales', 'customer-care', 'marketing'],
    labelVi: 'Follow-up khách',
    labelEn: 'Customer follow-up',
    chip: {
      id: 'sales-followup',
      labelVi: 'Follow-up + Clients',
      labelEn: 'Follow-up + Clients',
      promptVi: 'Soạn thư follow-up sau demo và thêm việc gọi lại, mở Clients',
      promptEn: 'Draft a post-demo follow-up and add a callback task, open Clients',
    },
    match: (lower, norm) =>
      /(?:follow[\s-]?up|theo dõi|theo doi|gọi lại|goi lai|sau demo)/i.test(lower) ||
      /(?:follow.?up|theo doi)/i.test(norm),
    buildSteps: (raw) => {
      const brief =
        residualBrief(raw, [AND_TAIL]) ||
        'Thư follow-up: nhắc lợi ích, bước tiếp, CTA rõ'
      return [
        createDocs(brief),
        wb('add_item', 'tasks', `Follow-up: ${brief.slice(0, 80)}`, 'Thêm việc follow-up'),
        wb('open', 'clients', 'Mở tab Clients', 'Mở Clients'),
      ]
    },
  },
  {
    id: 'cs-reply',
    practiceIds: ['customer-care', 'sales'],
    labelVi: 'Trả lời CSKH',
    labelEn: 'CS reply',
    chip: {
      id: 'cs-reply',
      labelVi: 'Trả lời khách + task',
      labelEn: 'Reply + task',
      promptVi: 'Soạn thư trả lời khách khiếu nại và thêm việc theo dõi, mở Clients',
      promptEn: 'Draft a complaint reply and add a follow-up task, open Clients',
    },
    match: (lower) =>
      /(?:trả lời khách|tra loi khach|khiếu nại|khieu nai|csat|ticket|phản hồi khách|phan hoi khach)/i.test(
        lower,
      ),
    buildSteps: (raw) => {
      const brief =
        residualBrief(raw, [AND_TAIL]) ||
        'Trả lời khách: thừa nhận vấn đề, hướng xử lý, thời hạn'
      return [
        fillTemplate('cs-reply', raw),
        wb('add_item', 'tasks', `CS follow-up: ${brief.slice(0, 80)}`, 'Thêm việc CS'),
        wb('open', 'clients', 'Mở Clients', 'Open Clients'),
      ]
    },
  },
  {
    id: 'legal-contract',
    practiceIds: ['legal', 'procurement', 'real-estate'],
    labelVi: 'Hợp đồng + việc',
    labelEn: 'Contract + task',
    chip: {
      id: 'legal-contract',
      labelVi: 'Hợp đồng + Contracts',
      labelEn: 'Contract + Contracts',
      promptVi: 'Soạn hợp đồng thuê nhà Word và thêm việc rà soát, mở tab Contracts',
      promptEn: 'Draft a lease contract in Word and add a review task, open Contracts',
    },
    match: (lower, norm) =>
      /(?:hợp đồng|hop dong|contract|thoả thuận|thoa thuan)/i.test(lower) ||
      /(?:hop dong|contract)/i.test(norm),
    buildSteps: (raw) => {
      const brief =
        residualBrief(raw, [AND_TAIL]) ||
        'Hợp đồng: bên A/B, đối tượng, thời hạn, thanh toán, điều khoản'
      return [
        fillTemplate('legal-contract', raw),
        wb('add_item', 'tasks', `Rà soát hợp đồng: ${brief.slice(0, 80)}`, 'Thêm việc rà soát'),
        wb('open', 'contracts', 'Mở Contracts', 'Open Contracts'),
      ]
    },
  },
  {
    id: 'teacher-lesson',
    practiceIds: ['teacher', 'principal'],
    labelVi: 'Giáo án + slide',
    labelEn: 'Lesson + slides',
    chip: {
      id: 'teacher-lesson',
      labelVi: 'Giáo án + Slide + việc',
      labelEn: 'Lesson + slides + task',
      promptVi: 'Soạn giáo án Word và tạo slide bài giảng, thêm việc chuẩn bị tiết dạy',
      promptEn: 'Draft a lesson plan in Word and create slides, add a prep task',
    },
    match: (lower, norm) =>
      /(?:giáo án|giao an|bài giảng|bai giang|lesson plan|tiết dạy|tiet day)/i.test(lower) ||
      /(?:giao an|bai giang|lesson)/i.test(norm),
    buildSteps: (raw) => {
      const topic =
        residualBrief(raw, [
          AND_TAIL,
          /(?:soạn|soan|tạo|tao|viết|viet|draft)/gi,
          /(?:giáo án|giao an|bài giảng|bai giang|lesson plan|word|slide)/gi,
        ]) || 'Chủ đề tiết học'
      return [
        fillTemplate('teacher-lesson', raw),
        createSlides(`Bài giảng / slide: ${topic}`),
        wb('add_item', 'tasks', `Chuẩn bị tiết dạy: ${topic.slice(0, 80)}`, 'Thêm việc chuẩn bị'),
      ]
    },
  },
  {
    id: 'hr-offer',
    practiceIds: ['hr'],
    labelVi: 'Thư mời / offer',
    labelEn: 'Offer letter',
    chip: {
      id: 'hr-offer',
      labelVi: 'Offer + việc HR',
      labelEn: 'Offer + HR task',
      promptVi: 'Soạn thư mời nhận việc Word và thêm việc gửi offer',
      promptEn: 'Draft an offer letter in Word and add a send-offer task',
    },
    match: (lower) =>
      /(?:thư mời nhận việc|thu moi nhan viec|offer letter|thư mời làm việc|offer)/i.test(lower),
    buildSteps: (raw) => {
      const brief =
        residualBrief(raw, [AND_TAIL]) ||
        'Thư mời nhận việc: vị trí, lương, ngày bắt đầu, điều kiện'
      return [
        createDocs(brief),
        wb('add_item', 'tasks', `Gửi offer: ${brief.slice(0, 80)}`, 'Thêm việc gửi offer'),
      ]
    },
  },
]

function practiceAllows(book: MyAiPlaybook, practiceId: PracticeId): boolean {
  return book.practiceIds.length === 0 || book.practiceIds.includes(practiceId)
}

/** Match a practice playbook for the utterance (Phase C). */
export function matchPracticePlaybook(
  practiceId: PracticeId,
  text: string,
): { playbook: MyAiPlaybook; steps: MyAiStep[] } | null {
  const raw = text.trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  const lowerNorm = stripDiacritics(lower)
  for (const book of PLAYBOOKS) {
    if (!practiceAllows(book, practiceId)) continue
    if (!book.match(lower, lowerNorm)) continue
    const steps = book.buildSteps(raw).slice(0, 4)
    if (steps.length < 2) continue
    return { playbook: book, steps }
  }
  return null
}

/** Hero chips: playbooks for this practice + top skills as Word drafts. */
export function practiceMyAiChips(practiceId: PracticeId): MyAiPlaybookChip[] {
  const chips: MyAiPlaybookChip[] = []
  for (const book of PLAYBOOKS) {
    if (!practiceAllows(book, practiceId)) continue
    chips.push(book.chip)
  }
  const practice = getPractice(practiceId)
  if (practice) {
    for (const skill of practice.skills.slice(0, 2)) {
      chips.push({
        id: `skill:${skill.id}`,
        labelVi: skill.labelVi,
        labelEn: skill.labelEn,
        promptVi: `Soạn văn bản Word: ${skill.labelVi} — ${skill.descVi}`,
        promptEn: `Draft a Word doc: ${skill.labelEn} — ${skill.descEn}`,
      })
    }
  }
  return chips.slice(0, 6)
}
