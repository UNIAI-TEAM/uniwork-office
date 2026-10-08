/**
 * Practice document templates for My AI — slot catalog + resolve from Workbench.
 * Playbooks start with fill_template; missing required slots are asked in chat.
 */
import type { PracticeId } from '@uniwork/practice-core'
import type { OfficeApp } from './my-ai-router'
import { readClients, readContracts, readMatters, type WbClientItem } from './workbench-pins'

export type TemplateSlotId =
  | 'client'
  | 'party'
  | 'topic'
  | 'scope'
  | 'amount'
  | 'deadline'
  | 'investor'
  | 'project'
  | 'subject'

export interface TemplateSlotDef {
  id: TemplateSlotId
  required: boolean
  labelVi: string
  labelEn: string
}

export interface PracticeDocTemplate {
  id: string
  /** Matches MyAiPlaybook.id */
  playbookId: string
  labelVi: string
  labelEn: string
  app: OfficeApp
  slots: readonly TemplateSlotDef[]
  outlineVi: readonly string[]
  outlineEn: readonly string[]
}

const TEMPLATES: readonly PracticeDocTemplate[] = [
  {
    id: 'sales-quote',
    playbookId: 'sales-quote',
    labelVi: 'Báo giá',
    labelEn: 'Quote',
    app: 'docs',
    slots: [
      { id: 'client', required: true, labelVi: 'Khách hàng', labelEn: 'Client' },
      { id: 'topic', required: true, labelVi: 'Sản phẩm / gói', labelEn: 'Product / package' },
      { id: 'scope', required: false, labelVi: 'Phạm vi', labelEn: 'Scope' },
      { id: 'amount', required: false, labelVi: 'Mức giá', labelEn: 'Price' },
      { id: 'deadline', required: false, labelVi: 'Hiệu lực', labelEn: 'Validity' },
    ],
    outlineVi: [
      'Thông tin bên bán / bên mua',
      'Mô tả sản phẩm / gói dịch vụ',
      'Phạm vi công việc',
      'Bảng giá (hạng mục, SL, đơn giá, thành tiền)',
      'Điều khoản thanh toán & hiệu lực báo giá',
      'CTA / bước tiếp theo',
    ],
    outlineEn: [
      'Seller / buyer details',
      'Product / package description',
      'Scope of work',
      'Pricing table',
      'Payment terms & quote validity',
      'CTA / next steps',
    ],
  },
  {
    id: 'legal-contract',
    playbookId: 'legal-contract',
    labelVi: 'Hợp đồng',
    labelEn: 'Contract',
    app: 'docs',
    slots: [
      { id: 'party', required: true, labelVi: 'Đối tác / bên B', labelEn: 'Counterparty' },
      { id: 'topic', required: true, labelVi: 'Đối tượng hợp đồng', labelEn: 'Subject matter' },
      { id: 'deadline', required: false, labelVi: 'Thời hạn', labelEn: 'Term' },
      { id: 'amount', required: false, labelVi: 'Giá trị', labelEn: 'Value' },
    ],
    outlineVi: [
      'Bên A / Bên B',
      'Đối tượng & phạm vi',
      'Thời hạn, giá trị, thanh toán',
      'Quyền & nghĩa vụ',
      'Chấm dứt / tranh chấp',
    ],
    outlineEn: [
      'Party A / Party B',
      'Subject & scope',
      'Term, value, payment',
      'Rights & obligations',
      'Termination / disputes',
    ],
  },
  {
    id: 'construction-site',
    playbookId: 'construction-site',
    labelVi: 'Nhật ký / hồ sơ hiện trường',
    labelEn: 'Site log / pack',
    app: 'docs',
    slots: [
      { id: 'investor', required: true, labelVi: 'Chủ đầu tư', labelEn: 'Investor / owner' },
      { id: 'project', required: true, labelVi: 'Công trình / hạng mục', labelEn: 'Project / package' },
      { id: 'deadline', required: false, labelVi: 'Ngày / đợt GS', labelEn: 'Date / visit' },
      { id: 'scope', required: false, labelVi: 'Nội dung kiểm tra', labelEn: 'Inspection focus' },
    ],
    outlineVi: [
      'Thông tin chủ đầu tư & công trình',
      'Thời tiết, nhân lực, thiết bị',
      'Khối lượng / hạng mục trong ngày',
      'Tồn đọng & kiến nghị',
      'Người lập / xác nhận',
    ],
    outlineEn: [
      'Investor & project info',
      'Weather, manpower, equipment',
      'Work done today',
      'Punch list & recommendations',
      'Prepared / approved by',
    ],
  },
  {
    id: 'marketing-campaign',
    playbookId: 'marketing-campaign',
    labelVi: 'Brief chiến dịch',
    labelEn: 'Campaign brief',
    app: 'docs',
    slots: [
      { id: 'topic', required: true, labelVi: 'Tên / mục tiêu chiến dịch', labelEn: 'Campaign name / goal' },
      { id: 'client', required: false, labelVi: 'Thương hiệu / khách', labelEn: 'Brand / client' },
      { id: 'scope', required: false, labelVi: 'Audience / kênh', labelEn: 'Audience / channels' },
      { id: 'deadline', required: false, labelVi: 'Timeline', labelEn: 'Timeline' },
    ],
    outlineVi: [
      'Mục tiêu & KPI',
      'Audience & insight',
      'Message / big idea',
      'Kênh & lịch triển khai',
      'Ngân sách & đo lường',
    ],
    outlineEn: [
      'Goals & KPIs',
      'Audience & insight',
      'Message / big idea',
      'Channels & timeline',
      'Budget & measurement',
    ],
  },
  {
    id: 'teacher-lesson',
    playbookId: 'teacher-lesson',
    labelVi: 'Giáo án',
    labelEn: 'Lesson plan',
    app: 'docs',
    slots: [
      { id: 'subject', required: true, labelVi: 'Môn / chủ đề', labelEn: 'Subject / topic' },
      { id: 'scope', required: false, labelVi: 'Lớp / thời lượng', labelEn: 'Grade / duration' },
      { id: 'deadline', required: false, labelVi: 'Tiết / ngày dạy', labelEn: 'Period / date' },
    ],
    outlineVi: [
      'Mục tiêu bài học',
      'Chuẩn bị đồ dùng',
      'Các hoạt động (mở đầu / luyện tập / củng cố)',
      'Đánh giá & bài tập về nhà',
    ],
    outlineEn: [
      'Learning objectives',
      'Materials',
      'Activities (warm-up / practice / wrap-up)',
      'Assessment & homework',
    ],
  },
  {
    id: 'cs-reply',
    playbookId: 'cs-reply',
    labelVi: 'Trả lời CSKH',
    labelEn: 'CS reply',
    app: 'docs',
    slots: [
      { id: 'client', required: true, labelVi: 'Khách hàng', labelEn: 'Customer' },
      { id: 'topic', required: true, labelVi: 'Vấn đề / ticket', labelEn: 'Issue / ticket' },
      { id: 'scope', required: false, labelVi: 'Hướng xử lý', labelEn: 'Resolution' },
      { id: 'deadline', required: false, labelVi: 'Cam kết thời hạn', labelEn: 'SLA / promise' },
    ],
    outlineVi: [
      'Chào & thừa nhận vấn đề',
      'Tóm tắt tình trạng đã kiểm tra',
      'Hướng xử lý / bồi hoàn',
      'Thời hạn & kênh liên hệ tiếp',
    ],
    outlineEn: [
      'Greeting & acknowledge issue',
      'What we checked',
      'Resolution / remedy',
      'Timeline & next contact',
    ],
  },
]

export function getTemplateById(id: string): PracticeDocTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id)
}

export function getTemplateForPlaybook(playbookId: string): PracticeDocTemplate | undefined {
  return TEMPLATES.find((t) => t.playbookId === playbookId)
}

export function listTemplates(): readonly PracticeDocTemplate[] {
  return TEMPLATES
}

export type ResolvedSlots = Partial<Record<TemplateSlotId, string>>

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '')
}

/** Pull slot cues from free text (vi/en). */
export function extractSlotsFromUserText(text: string): ResolvedSlots {
  const raw = text.trim()
  const out: ResolvedSlots = {}
  if (!raw) return out

  const client =
    /(?:cho khách(?: hàng)?|khách(?: hàng)?|client|customer)\s*[:\-–]?\s*([^,.;\n]+?)(?=\s+(?:gói|goi|package|về|ve|phạm vi|pham vi|giá|gia|,|$))/i.exec(
      raw,
    ) ||
    /(?:cho khách(?: hàng)?|khách(?: hàng)?|client|customer)\s*[:\-–]?\s*([^,.;\n]+)/i.exec(raw) ||
    /(?:gửi|gui)\s+([^,.;\n]+?)\s+(?:báo giá|bao gia|quote)/i.exec(raw)
  if (client?.[1]?.trim()) out.client = client[1].trim().slice(0, 120)

  const party =
    /(?:với|với bên|đối tác|doi tac|bên b|ben b|counterparty)\s*[:\-–]?\s*([^,.;\n]+)/i.exec(raw)
  if (party?.[1]?.trim()) out.party = party[1].trim().slice(0, 120)

  const investor =
    /(?:chủ đầu tư|chu dau tu|investor|CĐT|cdt)\s*[:\-–]?\s*([^,.;\n]+)/i.exec(raw)
  if (investor?.[1]?.trim()) out.investor = investor[1].trim().slice(0, 120)

  const project =
    /(?:công trình|cong trinh|hạng mục|hang muc|dự án|du an|project)\s*[:\-–]?\s*([^,.;\n]+)/i.exec(
      raw,
    )
  if (project?.[1]?.trim()) out.project = project[1].trim().slice(0, 120)

  const topic =
    /(?:gói|goi|sản phẩm|san pham|package|về|ve|chủ đề|chu de|topic|môn|mon)\s*[:\-–]?\s*([^,.;\n]+)/i.exec(
      raw,
    ) || /(?:báo giá|bao gia|quote)\s+(.+)$/i.exec(raw)
  if (topic?.[1]?.trim() && topic[1].trim().length >= 3) {
    const cleaned = topic[1]
      .trim()
      .replace(/\s+(?:và|rồi|and|,).*$/i, '')
      .replace(/^(?:word|excel|slide|pdf|văn bản|van ban)\b/i, '')
      .trim()
      .slice(0, 160)
    if (cleaned.length >= 3) out.topic = cleaned
  }

  const subject = /(?:môn|mon|bài|bai|lesson)\s*[:\-–]?\s*([^,.;\n]+)/i.exec(raw)
  if (subject?.[1]?.trim()) out.subject = subject[1].trim().slice(0, 120)

  const amount =
    /(?:giá|gia|price|amount|giá trị|gia tri)\s*[:\-–]?\s*([0-9][0-9.\s]*\s*(?:đ|vnd|usd|\$)?)/i.exec(
      raw,
    )
  if (amount?.[1]?.trim()) out.amount = amount[1].trim().slice(0, 40)

  const deadline =
    /(?:hiệu lực|hieu luc|deadline|hạn|han|trước|truoc|ngày|ngay)\s*[:\-–]?\s*([^,.;\n]+)/i.exec(
      raw,
    )
  if (deadline?.[1]?.trim()) out.deadline = deadline[1].trim().slice(0, 80)

  const scope =
    /(?:phạm vi|pham vi|scope|audience|kênh|kenh)\s*[:\-–]?\s*([^,.;\n]+)/i.exec(raw)
  if (scope?.[1]?.trim()) out.scope = scope[1].trim().slice(0, 160)

  return out
}

function matchClient(nameHint: string, clients: WbClientItem[]): WbClientItem | undefined {
  const n = stripDiacritics(nameHint.toLowerCase())
  if (!n) return undefined
  return (
    clients.find((c) => stripDiacritics(c.name.toLowerCase()) === n) ||
    clients.find((c) => stripDiacritics(c.name.toLowerCase()).includes(n)) ||
    clients.find((c) => n.includes(stripDiacritics(c.name.toLowerCase())))
  )
}

export interface TemplateResolveResult {
  template: PracticeDocTemplate
  slots: ResolvedSlots
  missing: TemplateSlotDef[]
  /** Client row when matched */
  clientRow?: WbClientItem
}

export function resolveTemplateSlots(
  practiceId: PracticeId,
  templateId: string,
  userText: string,
): TemplateResolveResult | null {
  const template = getTemplateById(templateId)
  if (!template) return null

  const slots: ResolvedSlots = { ...extractSlotsFromUserText(userText) }
  const clients = readClients(practiceId)
  const contracts = readContracts(practiceId)
  let clientRow: WbClientItem | undefined

  if (slots.client) {
    clientRow = matchClient(slots.client, clients)
    if (clientRow) {
      slots.client = clientRow.name
      if (clientRow.contact && !slots.scope) {
        /* keep contact for brief via clientRow */
      }
    }
  } else if (clients.length === 1) {
    clientRow = clients[0]
    slots.client = clientRow!.name
  }

  // party / investor can reuse client list
  if (!slots.party && slots.client) slots.party = slots.client
  if (!slots.investor && slots.client) slots.investor = slots.client
  if (!slots.party && clients.length === 1) slots.party = clients[0]!.name
  if (!slots.investor && clients.length === 1) slots.investor = clients[0]!.name

  if (!slots.party && contracts[0]?.party) slots.party = contracts[0].party
  if (!slots.topic && contracts[0]?.title) slots.topic = contracts[0].title

  try {
    const matters = readMatters(practiceId)
    if (!slots.project && matters[0]?.title) slots.project = matters[0].title
    if (!slots.client && matters[0]?.client) slots.client = matters[0].client
  } catch {
    /* matters may be absent in some builds */
  }

  // topic from residual: strip playbook noise if still empty
  if (!slots.topic && !slots.subject && !slots.project) {
    const residual = userText
      .replace(
        /(?:soạn|soan|tạo|tao|viết|viet|draft|create|báo giá|bao gia|quote|hợp đồng|hop dong|chiến dịch|chien dich|giáo án|giao an|nhật ký|nhat ky|word|excel|và.+$)/gi,
        ' ',
      )
      .replace(/\s+/g, ' ')
      .trim()
    if (residual.length >= 4) {
      if (template.slots.some((s) => s.id === 'subject')) slots.subject = residual.slice(0, 160)
      else if (template.slots.some((s) => s.id === 'project')) slots.project = residual.slice(0, 160)
      else slots.topic = residual.slice(0, 160)
    }
  }

  const missing = template.slots.filter((s) => s.required && !slots[s.id]?.trim())
  return { template, slots, missing, clientRow }
}

export function buildTemplateBrief(
  result: TemplateResolveResult,
  vi: boolean,
): string {
  const { template, slots, clientRow } = result
  const lines: string[] = []
  const title = vi ? template.labelVi : template.labelEn
  lines.push(
    vi
      ? `Soạn mẫu “${title}” đúng khung sau. Chỉ dùng thông tin đã cung cấp — không bịa số liệu.`
      : `Draft the “${title}” template using only the facts below — do not invent data.`,
  )
  lines.push('')
  lines.push(vi ? 'Thông tin đã có:' : 'Known fields:')
  for (const slot of template.slots) {
    const v = slots[slot.id]?.trim()
    if (!v) continue
    const lab = vi ? slot.labelVi : slot.labelEn
    lines.push(`- ${lab}: ${v}`)
  }
  if (clientRow) {
    if (clientRow.contact) lines.push(`- ${vi ? 'Liên hệ' : 'Contact'}: ${clientRow.contact}`)
    if (clientRow.phone) lines.push(`- ${vi ? 'Điện thoại' : 'Phone'}: ${clientRow.phone}`)
    if (clientRow.email) lines.push(`- Email: ${clientRow.email}`)
    if (clientRow.note) lines.push(`- ${vi ? 'Ghi chú KH' : 'Client note'}: ${clientRow.note}`)
  }
  lines.push('')
  lines.push(vi ? 'Khung mục lục bắt buộc:' : 'Required outline:')
  const outline = vi ? template.outlineVi : template.outlineEn
  outline.forEach((s, i) => lines.push(`${i + 1}. ${s}`))
  lines.push('')
  lines.push(
    vi
      ? 'Viết tiếng Việt, rõ ràng, sẵn sàng gửi khách. Để trống rõ ràng các mục chưa có số liệu.'
      : 'Write clearly, ready to send. Leave explicit placeholders where data is missing.',
  )
  return lines.join('\n')
}

export function slotPromptPrefix(slot: TemplateSlotDef, template: PracticeDocTemplate, vi: boolean): string {
  const tpl = vi ? template.labelVi : template.labelEn
  const lab = vi ? slot.labelVi : slot.labelEn
  if (slot.id === 'client' || slot.id === 'party' || slot.id === 'investor') {
    return vi ? `Soạn ${tpl} cho khách ` : `Draft ${tpl} for client `
  }
  if (slot.id === 'topic' || slot.id === 'subject' || slot.id === 'project') {
    return vi ? `Soạn ${tpl} về ` : `Draft ${tpl} about `
  }
  return vi ? `Soạn ${tpl} — ${lab}: ` : `Draft ${tpl} — ${lab}: `
}
