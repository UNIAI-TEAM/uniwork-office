/**
 * Workbench Forms library → My AI fill_form.
 * Uploaded files are read on-device via readAttachment; slots reuse clients when useful.
 */
import type { PracticeId } from '@uniwork/practice-core'
import {
  getTemplateById,
  type PracticeDocTemplate,
} from './my-ai-templates'
import {
  readClients,
  readForms,
  type WbClientItem,
  type WbFormItem,
} from './workbench-pins'

const FORM_EXCERPT_CHARS = 5_500

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '')
}

function norm(s: string): string {
  return stripDiacritics(s).toLowerCase().trim()
}

export function getFormById(practiceId: PracticeId, formId: string): WbFormItem | undefined {
  return readForms(practiceId).find((f) => f.id === formId)
}

export function listFormsWithFiles(practiceId: PracticeId): WbFormItem[] {
  return readForms(practiceId).filter((f) => Boolean(f.filePath?.trim()))
}

/** Fuzzy title match against Forms library (prefers uploaded files). */
export function matchFormByQuery(practiceId: PracticeId, query: string): WbFormItem | undefined {
  const q = norm(query)
  if (!q || q.length < 2) return undefined
  const all = readForms(practiceId)
  const pool = (() => {
    const withFile = all.filter((f) => f.filePath?.trim())
    return withFile.length > 0 ? withFile : all
  })()

  const scored = pool
    .map((f) => {
      const t = norm(f.title)
      const n = f.fileName ? norm(f.fileName.replace(/\.[^.]+$/, '')) : ''
      let score = 0
      if (t === q || n === q) score = 100
      else if (t.includes(q) || q.includes(t)) score = 80 - Math.abs(t.length - q.length)
      else if (n && (n.includes(q) || q.includes(n))) score = 60
      else if (f.note && norm(f.note).includes(q)) score = 40
      return { f, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)

  return scored[0]?.f
}

/** Match a built-in practice template to an uploaded form (templateId or title). */
export function findFormForTemplate(
  practiceId: PracticeId,
  template: PracticeDocTemplate,
): WbFormItem | undefined {
  const forms = listFormsWithFiles(practiceId)
  const byId = forms.find((f) => f.templateId === template.id)
  if (byId) return byId
  const labels = [template.labelVi, template.labelEn].map(norm)
  return forms.find((f) => {
    const t = norm(f.title)
    return labels.some((lab) => lab && (t === lab || t.includes(lab) || lab.includes(t)))
  })
}

export function looksLikeFormFill(raw: string): boolean {
  const lower = raw.toLowerCase()
  const n = norm(raw)
  return (
    /(?:điền|dien|soạn|soan|fill|draft|dùng|dung|theo)\s+(?:biểu mẫu|bieu mau|form|mẫu|mau)\b/i.test(
      lower,
    ) ||
    /(?:biểu mẫu|bieu mau)\b/i.test(lower) ||
    /(?:fill|use)\s+(?:the\s+)?(?:form|template)\b/i.test(n) ||
    /(?:theo\s+mẫu|theo\s+mau)\b/i.test(n)
  )
}

export function extractFormQuery(raw: string): string {
  const m =
    /(?:điền|dien|soạn|soan|fill|draft|dùng|dung)?\s*(?:theo\s+)?(?:biểu mẫu|bieu mau|form|mẫu|mau)\s*[:\-–]?\s*(.+)$/i.exec(
      raw.trim(),
    ) ||
    /(?:theo\s+mẫu|theo\s+mau)\s*[:\-–]?\s*(.+)$/i.exec(raw.trim())
  let q = (m?.[1] ?? raw).trim()
  q = q
    .replace(
      /^(?:điền|dien|soạn|soan|fill|draft|dùng|dung|theo)\s+/i,
      '',
    )
    .replace(/^(?:biểu mẫu|bieu mau|form|mẫu|mau)\s*/i, '')
    .replace(/\b(?:word|excel|slide|pdf|văn bản|van ban)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return q.slice(0, 160)
}

export type FormFillRoute =
  | { kind: 'form'; formId: string }
  | { kind: 'pick'; forms: WbFormItem[] }
  | null

/** Route NL → fill a library form (uploaded preferred). */
export function routeFormFill(practiceId: PracticeId, raw: string): FormFillRoute {
  const forms = readForms(practiceId)
  if (forms.length === 0) return null

  const withFile = listFormsWithFiles(practiceId)
  const pool = withFile.length > 0 ? withFile : forms
  const query = extractFormQuery(raw)
  const matched = matchFormByQuery(practiceId, query)

  if (matched) return { kind: 'form', formId: matched.id }

  // Title mentioned without “biểu mẫu” keyword
  if (!looksLikeFormFill(raw)) {
    const byTitle = matchFormByQuery(practiceId, raw)
    if (
      byTitle &&
      /(?:điền|dien|soạn|soan|fill|draft|viết|viet)\b/i.test(raw) &&
      byTitle.filePath
    ) {
      return { kind: 'form', formId: byTitle.id }
    }
    return null
  }

  if (pool.length === 1) return { kind: 'form', formId: pool[0]!.id }
  if (pool.length > 1) return { kind: 'pick', forms: pool.slice(0, 8) }
  return null
}

export async function readFormFileExcerpt(filePath: string): Promise<string> {
  const api = window.aiOffice
  if (!api?.readAttachment) return ''
  const res = await api.readAttachment(filePath, 0, FORM_EXCERPT_CHARS)
  if (res.ok && res.text?.trim()) return res.text.trim()
  return ''
}

function matchClientHint(hint: string, clients: WbClientItem[]): WbClientItem | undefined {
  const n = norm(
    /(?:cho khách|cho|for client|for|khách)\s+([^,.;\n]+)/i.exec(hint)?.[1]?.trim() || hint,
  )
  if (n.length < 2) return undefined
  return (
    clients.find((c) => norm(c.name) === n) ||
    clients.find((c) => norm(c.name).includes(n) || n.includes(norm(c.name)))
  )
}

export function buildFormFillBrief(opts: {
  form: WbFormItem
  vi: boolean
  userHint: string
  excerpt?: string
  clientRow?: WbClientItem
}): string {
  const { form, vi, userHint, excerpt, clientRow } = opts
  const lines: string[] = []
  lines.push(
    vi
      ? `Điền / soạn theo biểu mẫu thư viện “${form.title}”. Giữ khung mục / trường của mẫu gốc; chỉ điền chỗ trống bằng thông tin đã có — không bịa.`
      : `Fill / draft from library form “${form.title}”. Keep the original sections/fields; only fill blanks with known facts — do not invent.`,
  )
  if (form.note?.trim()) {
    lines.push(vi ? `Ghi chú thư viện: ${form.note.trim()}` : `Library note: ${form.note.trim()}`)
  }
  if (form.fileName) {
    lines.push(vi ? `File mẫu: ${form.fileName}` : `Template file: ${form.fileName}`)
  }
  lines.push('')
  lines.push(vi ? 'Thông tin đã có:' : 'Known facts:')
  if (clientRow) {
    lines.push(`- ${vi ? 'Khách hàng' : 'Client'}: ${clientRow.name}`)
    if (clientRow.contact) lines.push(`- ${vi ? 'Liên hệ' : 'Contact'}: ${clientRow.contact}`)
    if (clientRow.phone) lines.push(`- ${vi ? 'Điện thoại' : 'Phone'}: ${clientRow.phone}`)
    if (clientRow.email) lines.push(`- Email: ${clientRow.email}`)
    if (clientRow.note) lines.push(`- ${vi ? 'Ghi chú KH' : 'Client note'}: ${clientRow.note}`)
  }
  const residual = userHint
    .replace(/(?:điền|dien|soạn|soan|fill|draft|theo)\s+(?:biểu mẫu|bieu mau|form|mẫu|mau)/gi, ' ')
    .replace(new RegExp(form.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
  if (residual.length >= 3) {
    lines.push(`- ${vi ? 'Yêu cầu thêm' : 'Extra request'}: ${residual}`)
  }
  if (excerpt?.trim()) {
    lines.push('')
    lines.push(
      vi
        ? 'Nội dung mẫu gốc (excerpt trên máy — bám sát cấu trúc này):'
        : 'Original template excerpt (on-device — follow this structure):',
    )
    lines.push(excerpt.trim().slice(0, FORM_EXCERPT_CHARS))
  } else {
    lines.push('')
    lines.push(
      vi
        ? 'Chưa đọc được nội dung file mẫu — soạn khung hợp lý theo tiêu đề biểu mẫu và ghi chú.'
        : 'Could not read the template file — draft a reasonable structure from the form title and note.',
    )
  }
  lines.push('')
  lines.push(
    vi
      ? 'Viết tiếng Việt, rõ ràng, sẵn sàng dùng. Để trống rõ ràng các mục chưa có số liệu.'
      : 'Write clearly, ready to use. Leave explicit placeholders where data is missing.',
  )
  return lines.join('\n')
}

/** Resolve client hint for a form fill; optional built-in template for richer slots later. */
export function resolveFormFillContext(
  practiceId: PracticeId,
  form: WbFormItem,
  userHint: string,
): { clientRow?: WbClientItem; template?: PracticeDocTemplate } {
  const clients = readClients(practiceId)
  const clientRow =
    matchClientHint(userHint, clients) || (clients.length === 1 ? clients[0] : undefined)
  const template = form.templateId ? getTemplateById(form.templateId) : undefined
  return { clientRow, template }
}
