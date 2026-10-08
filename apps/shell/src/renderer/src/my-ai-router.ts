/**
 * My AI router — single actions + multi-tool plans (B4).
 * Maps NL → create/open/search/summarize/workbench (no UI).
 */
import {
  createAgentIntent,
  getWorkbenchModule,
  resolveAgentIntentFromText,
  type AgentIntent,
  type PracticeId,
  type WorkbenchModuleId,
} from '@uniwork/practice-core'
import type { RecentEntry } from '../../shared/home-api'
import { getFormById, routeFormFill } from './my-ai-forms'
import { matchPracticePlaybook } from './my-ai-playbooks'
import { getTemplateById } from './my-ai-templates'

export type OfficeApp = 'docs' | 'sheets' | 'slides' | 'pdf'

export type MyAiStep =
  | {
      kind: 'create_file'
      app: OfficeApp
      /** When set, Docs/Slides/Sheets/PDF open with AI auto-run preset */
      brief?: string
      blank: boolean
    }
  | {
      /** Ask topic in chat before opening an Office app */
      kind: 'ask_create'
      app: OfficeApp
    }
  | {
      /** Practice template: resolve slots from Workbench, ask missing, then draft */
      kind: 'fill_template'
      templateId: string
      /** Original user utterance for slot extraction */
      hint?: string
    }
  | {
      /** Workbench Forms library (uploaded template file) */
      kind: 'fill_form'
      /** When omitted, chat asks which library form to use */
      formId?: string
      hint?: string
    }
  | {
      kind: 'open_file'
      query: string
    }
  | {
      kind: 'search_files'
      query: string
    }
  | {
      kind: 'summarize_recents'
      query?: string
      limit: number
    }
  | {
      /** Continue / instruct the last Office tab (even if Home/My AI is focused) */
      kind: 'continue_active'
      brief?: string
    }
  | {
      /** Summarize the last Office tab’s file (excerpt + AI) */
      kind: 'summarize_active'
    }
  | {
      kind: 'workbench'
      intent: AgentIntent
    }

export type MyAiRoute =
  | MyAiStep
  | {
      kind: 'plan'
      steps: MyAiStep[]
      /**
       * P3 — one user-facing goal (not a step pipeline).
       * Internal `steps` still run in order; UI only shows this goal.
       */
      goalVi: string
      goalEn: string
      /** @deprecated alias of goal — kept for older call sites / resume */
      summaryVi: string
      summaryEn: string
      /** Phase C playbook id when matched */
      playbookId?: string
    }
  | {
      kind: 'unknown'
      hintVi: string
      hintEn: string
    }

const MAX_PLAN_STEPS = 4

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '')
}

function norm(s: string): string {
  return stripDiacritics(s).toLowerCase().trim()
}

function fileName(pathOrName: string): string {
  return pathOrName.split(/[\\/]/).pop() ?? pathOrName
}

/** Score how well `query` matches a recent entry (higher = better). */
export function scoreRecentMatch(entry: RecentEntry, query: string): number {
  const q = norm(query)
  if (!q) return 0
  const name = norm(entry.name || fileName(entry.path))
  const base = name.replace(/\.[^.]+$/, '')
  if (name === q || base === q) return 100
  if (name.startsWith(q) || base.startsWith(q)) return 80
  if (name.includes(q) || base.includes(q)) return 60
  // token overlap
  const qTokens = q.split(/[\s._-]+/).filter((t) => t.length > 1)
  if (qTokens.length === 0) return 0
  let hits = 0
  for (const t of qTokens) {
    if (name.includes(t) || base.includes(t)) hits++
  }
  if (hits === 0) return 0
  return Math.round((hits / qTokens.length) * 50)
}

export interface ScoredRecent {
  entry: RecentEntry
  score: number
}

export function rankRecentsScored(
  entries: RecentEntry[],
  query: string,
  limit = 8,
): ScoredRecent[] {
  return entries
    .map((entry) => ({ entry, score: scoreRecentMatch(entry, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.mtimeMs - a.entry.mtimeMs)
    .slice(0, limit)
}

export function rankRecents(entries: RecentEntry[], query: string, limit = 8): RecentEntry[] {
  return rankRecentsScored(entries, query, limit).map((x) => x.entry)
}

/**
 * True when open/search should ask the user to pick (close scores or weak top hit).
 */
export function isAmbiguousRecentMatch(scored: readonly ScoredRecent[]): boolean {
  if (scored.length <= 1) return false
  const top = scored[0]!.score
  const second = scored[1]!.score
  if (top >= 90 && top - second >= 15) return false
  if (top >= 80 && top - second >= 25) return false
  return top - second < 20 || top < 70
}

/** User text that should pull local Workbench context into create/summarize. */
export function wantsLocalContext(text: string): boolean {
  const lower = text.toLowerCase()
  return /\b(theo|dựa|dua vao|dựa vào|based on|from my|from the|ghi chú|ghi chu|notes?|task|công việc|cong viec|việc đang|email|lịch|lich|context|ngữ cảnh|ngu canh)\b/i.test(
    lower,
  )
}

function detectApp(lower: string): OfficeApp | null {
  if (
    /\b(pdf)\b/i.test(lower) ||
    lower.includes('file pdf') ||
    lower.includes('tài liệu pdf')
  ) {
    return 'pdf'
  }
  if (
    /\b(excel|xlsx|xlsm|spreadsheet|sheets?)\b/i.test(lower) ||
    lower.includes('bang tinh') ||
    lower.includes('bảng tính') ||
    lower.includes('bảng excel')
  ) {
    return 'sheets'
  }
  if (
    /\b(pptx|powerpoint|slides?|deck)\b/i.test(lower) ||
    lower.includes('thuyet trinh') ||
    lower.includes('thuyết trình') ||
    lower.includes('bài giảng slide')
  ) {
    return 'slides'
  }
  if (
    /\b(word|docx|document|docs?)\b/i.test(lower) ||
    lower.includes('van ban') ||
    lower.includes('văn bản') ||
    lower.includes('tai lieu word') ||
    lower.includes('tài liệu word')
  ) {
    return 'docs'
  }
  return null
}

function extractAfter(patterns: RegExp[], text: string): string {
  for (const re of patterns) {
    const m = re.exec(text)
    if (m?.[1]?.trim()) return m[1].trim()
  }
  return ''
}

function stripCreateNoise(text: string, app: OfficeApp | null): string {
  let s = text
  const junk = [
    /\b(tạo|tao|create|new|soạn|soan|viết|viet|draft|write|làm|lam)\b/gi,
    /\b(cho tôi|cho toi|giúp tôi|giup toi|please|help me)\b/gi,
    /\b(một|mot|a|an|the|cái|cai)\b/gi,
    /\b(file|tài liệu|tai lieu|document|workbook|deck)\b/gi,
    /\b(mới|moi|blank|trống|trong)\b/gi,
  ]
  if (app === 'docs') {
    junk.push(/\b(word|docx|docs?|văn bản|van ban)\b/gi)
  } else if (app === 'sheets') {
    junk.push(/\b(excel|xlsx|spreadsheet|sheets?|bảng tính|bang tinh)\b/gi)
  } else if (app === 'slides') {
    junk.push(/\b(pptx|powerpoint|slides?|thuyết trình|thuyet trinh)\b/gi)
  } else if (app === 'pdf') {
    junk.push(/\b(pdf)\b/gi)
  }
  for (const re of junk) s = s.replace(re, ' ')
  return s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[:\-–—|]+\s*/, '')
    .trim()
}

function looksLikeCreate(lower: string): boolean {
  return (
    /\b(tạo|tao|create|new|soạn|soan|viết|viet|draft|write)\b/i.test(lower) ||
    lower.includes('van ban moi') ||
    lower.includes('văn bản mới') ||
    lower.includes('bang tinh moi') ||
    lower.includes('bảng tính mới') ||
    lower.includes('thuyet trinh moi') ||
    lower.includes('thuyết trình mới') ||
    lower.includes('file pdf moi') ||
    lower.includes('file pdf mới')
  )
}

function wantsExplicitBlankCreate(lower: string): boolean {
  return /(?:trống|trong|blank|empty|không nội dung|khong noi dung)/i.test(lower)
}

/**
 * True when the leftover after stripping create-noise is a real topic
 * (not “giúp tôi”, “nhanh”, …) — otherwise My AI must ask first.
 */
export function isSubstantiveCreateBrief(brief: string): boolean {
  const b = brief.replace(/\s+/g, ' ').trim()
  if (b.length < 6) return false
  if (
    /^(giúp|giup|help|nhanh|please|pls|đi|di|với|voi|cho tôi|cho toi|giùm|gium|nhé|nhe|ạ|a)[!?.…]*$/i.test(
      b,
    )
  ) {
    return false
  }
  if (/^(giúp|giup|help)(\s+(tôi|toi|mình|minh|me))?[!?.…]*$/i.test(b)) return false
  if (/^(một|mot|cái|cai|file|document|văn bản|van ban|tài liệu|tai lieu)[!?.…]*$/i.test(b)) {
    return false
  }
  // Mostly filler / politeness
  if (
    /^(giúp|giup|help)\s+(tôi|toi|mình|minh|me)\s+(với|voi|nhé|nhe|đi|di)?[!?.…]*$/i.test(b)
  ) {
    return false
  }
  return true
}

function routeCreateApp(app: OfficeApp, raw: string, lower: string, lowerNorm: string): MyAiStep {
  if (wantsExplicitBlankCreate(lower) || wantsExplicitBlankCreate(lowerNorm)) {
    return { kind: 'create_file', app, blank: true }
  }
  const brief = stripCreateNoise(raw, app)
  if (isSubstantiveCreateBrief(brief)) {
    return { kind: 'create_file', app, blank: false, brief }
  }
  return { kind: 'ask_create', app }
}

function looksLikeOpenFile(lower: string): boolean {
  // "đang mở" must not count as the open-file verb (ASCII `\b` breaks on Vietnamese).
  if (/(?:đang mở|dang mo)/i.test(lower) && !/(?:mở file|mo file|open file)/i.test(lower)) {
    return false
  }
  return (
    /(?:mở file|mo file|open file|mở tài liệu|mo tai lieu|open document|mở doc|open doc)/i.test(
      lower,
    ) ||
    /(?:^|[\s,;])(?:mở|mo|open)\s+.+\.(docx|xlsx|xlsm|pptx|pdf|md|html)\b/i.test(lower) ||
    (/(?:^|[\s,;])(?:mở|mo|open)(?:\s|$)/i.test(lower) &&
      /(?:file|tài liệu|tai lieu|báo cáo|bao cao|hợp đồng|hop dong|report|contract)/i.test(lower) &&
      !looksLikeCreate(lower))
  )
}

function looksLikeSearch(lower: string): boolean {
  return /\b(tìm file|tim file|tìm kiếm file|tim kiem file|search file|find file|tìm tài liệu|tim tai lieu)\b/i.test(
    lower,
  )
}

function looksLikeSummarizeRecents(lower: string): boolean {
  const sum = /\b(tóm tắt|tom tat|summarize|summary|tổng hợp|tong hop)\b/i.test(lower)
  if (!sum) return false
  if (looksLikeSummarizeActive(lower)) return false
  return /\b(file|recent|gần đây|gan day|tài liệu|tai lieu|recents?)\b/i.test(lower)
}

function looksLikeContinueActive(lower: string): boolean {
  // Avoid `\b` around Vietnamese (JS word-boundary is ASCII-only).
  return (
    /(?:^|[\s,;])(?:tiếp tục|tiep tuc|continue|keep (?:working|editing)|resume)(?:\s|:|$)/i.test(
      lower,
    ) ||
    /(?:trên|tren|on)\s+(?:file|tab|document)\s+(?:này|nay|nầy|this|đang mở|dang mo)/i.test(
      lower,
    ) ||
    /(?:file|tab)\s+(?:đang mở|dang mo|này|this|active)/i.test(lower) ||
    /active\s+(?:file|tab|document)/i.test(lower)
  )
}

function looksLikeSummarizeActive(lower: string): boolean {
  const sum = /(?:tóm tắt|tom tat|summarize|summary|tổng hợp|tong hop)/i.test(lower)
  if (!sum) return false
  // Recents summarize is a different route
  if (/(?:gần đây|gan day|recents?)/i.test(lower)) return false
  return /(?:đang mở|dang mo|tab này|tab nay|file này|file nay|this\s+(?:file|tab|document)|active\s+(?:file|tab|document)|open\s+tab)/i.test(
    lower,
  )
}

/** Split compound NL on conjunctions / action-comma (B4).
 * Avoid `\b` after Vietnamese (JS word-boundary is ASCII-only). */
export function splitMyAiClauses(text: string): string[] {
  const raw = text.trim()
  if (!raw) return []
  const parts = raw
    .split(
      /\s*(?:,\s*(?=(?:thêm|tạo|soạn|viết|mở|tìm|tóm\s*tắt|add|create|draft|write|open|find|summarize)(?:\s|:|$))|\s+(?:và rồi|sau đó|and then|và|rồi|then|also|and)\s+)\s*/i,
    )
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length >= 2 ? parts : [raw]
}

/**
 * Peel trailing “thêm công việc…” / “mở tab…” companions from a create-heavy sentence.
 */
export function extractCompanionClauses(text: string): { head: string; companions: string[] } {
  let rest = text.trim()
  const companions: string[] = []

  const openTab =
    /(?:^|[\s,;]|(?:\b(?:và|rồi|then|and)\b)\s+)mở\s+(?:tab\s+)?(?!file\b)([^\n]+)$/i.exec(rest)
  if (openTab && openTab.index != null && !/\.(docx|xlsx|xlsm|pptx|pdf)\b/i.test(openTab[0]!)) {
    const target = openTab[1]!.trim()
    if (target.length >= 2) {
      companions.unshift(`Mở tab ${target}`)
      rest = rest.slice(0, openTab.index).trim()
    }
  }

  const task =
    /(?:^|[\s,;]|(?:\b(?:và|rồi|then|and)\b)\s+)(?:thêm\s+)?(?:công việc|cong viec|task|todo)\s*[:\-–]?\s*([^\n]+)$/i.exec(
      rest,
    )
  if (task && task.index != null) {
    const title = task[1]!.trim()
    if (title.length >= 2) {
      companions.unshift(`Thêm công việc ${title}`)
      rest = rest.slice(0, task.index).trim()
    }
  }

  const note =
    /(?:^|[\s,;]|(?:\b(?:và|rồi|then|and)\b)\s+)(?:thêm\s+)?(?:ghi chú|note)\s*[:\-–]?\s*([^\n]+)$/i.exec(
      rest,
    )
  if (note && note.index != null) {
    const title = note[1]!.trim()
    if (title.length >= 2) {
      companions.unshift(`Thêm ghi chú ${title}`)
      rest = rest.slice(0, note.index).trim()
    }
  }

  return { head: rest || text.trim(), companions }
}

function stepKey(step: MyAiStep): string {
  if (step.kind === 'create_file') return `create:${step.app}:${step.brief ?? ''}:${step.blank}`
  if (step.kind === 'ask_create') return `ask_create:${step.app}`
  if (step.kind === 'fill_template') return `fill_template:${step.templateId}:${step.hint ?? ''}`
  if (step.kind === 'fill_form') return `fill_form:${step.formId ?? ''}:${step.hint ?? ''}`
  if (step.kind === 'open_file') return `open:${step.query}`
  if (step.kind === 'search_files') return `search:${step.query}`
  if (step.kind === 'summarize_recents') return `sum:${step.query ?? ''}:${step.limit}`
  if (step.kind === 'continue_active') return `continue:${step.brief ?? ''}`
  if (step.kind === 'summarize_active') return 'summarize_active'
  return `wb:${step.intent.action}:${step.intent.target.kind}:${'id' in step.intent.target ? step.intent.target.id : ''}:${step.intent.text ?? ''}`
}

function dedupeSteps(steps: MyAiStep[]): MyAiStep[] {
  const seen = new Set<string>()
  const out: MyAiStep[] = []
  for (const s of steps) {
    const k = stepKey(s)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}

function moduleLabel(id: string, vi: boolean): string {
  const meta = getWorkbenchModule(id as WorkbenchModuleId)
  if (meta) return vi ? meta.labelVi : meta.labelEn
  return id
}

/**
 * Collapse internal steps into one human goal (P3).
 * Prefer playbook title; else pattern-match common combos.
 */
export function synthesizePlanGoal(
  steps: MyAiStep[],
  opts?: { playbookLabelVi?: string; playbookLabelEn?: string },
): { goalVi: string; goalEn: string } {
  if (opts?.playbookLabelVi || opts?.playbookLabelEn) {
    return {
      goalVi: opts.playbookLabelVi ?? opts.playbookLabelEn ?? 'Hoàn thành yêu cầu',
      goalEn: opts.playbookLabelEn ?? opts.playbookLabelVi ?? 'Complete the request',
    }
  }

  const creates = steps.filter(
    (
      s,
    ): s is Extract<
      MyAiStep,
      { kind: 'create_file' | 'ask_create' | 'fill_template' | 'fill_form' }
    > =>
      s.kind === 'create_file' ||
      s.kind === 'ask_create' ||
      s.kind === 'fill_template' ||
      s.kind === 'fill_form',
  )
  const adds = steps.filter(
    (s): s is Extract<MyAiStep, { kind: 'workbench' }> =>
      s.kind === 'workbench' && s.intent.action === 'add_item',
  )
  const opens = steps.filter(
    (s): s is Extract<MyAiStep, { kind: 'workbench' }> =>
      s.kind === 'workbench' && (s.intent.action === 'open' || s.intent.action === 'navigate'),
  )
  const hasSummarize = steps.some(
    (s) => s.kind === 'summarize_recents' || s.kind === 'summarize_active',
  )
  const hasContinue = steps.some((s) => s.kind === 'continue_active')
  const hasOpenFile = steps.some((s) => s.kind === 'open_file' || s.kind === 'search_files')

  const addNamesVi = [
    ...new Set(
      adds
        .map((s) => (s.intent.target.kind === 'module' ? moduleLabel(s.intent.target.id, true) : null))
        .filter(Boolean),
    ),
  ] as string[]
  const addNamesEn = [
    ...new Set(
      adds
        .map((s) => (s.intent.target.kind === 'module' ? moduleLabel(s.intent.target.id, false) : null))
        .filter(Boolean),
    ),
  ] as string[]
  const openNamesVi = [
    ...new Set(
      opens
        .map((s) => (s.intent.target.kind === 'module' ? moduleLabel(s.intent.target.id, true) : null))
        .filter(Boolean),
    ),
  ] as string[]
  const openNamesEn = [
    ...new Set(
      opens
        .map((s) => (s.intent.target.kind === 'module' ? moduleLabel(s.intent.target.id, false) : null))
        .filter(Boolean),
    ),
  ] as string[]

  const joinVi = (xs: string[]) =>
    xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} và ${xs[xs.length - 1]}`
  const joinEn = (xs: string[]) =>
    xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`

  if (hasSummarize && addNamesVi.length > 0) {
    return {
      goalVi: `Tóm tắt ngữ cảnh và lưu vào ${joinVi(addNamesVi)}`,
      goalEn: `Summarize context and save to ${joinEn(addNamesEn)}`,
    }
  }

  if (creates.length > 0 && (adds.length > 0 || opens.length > 0)) {
    const c0 = creates[0]!
    const appId =
      c0.kind === 'fill_template'
        ? (getTemplateById(c0.templateId)?.app ?? 'docs')
        : c0.kind === 'fill_form'
          ? 'docs'
          : c0.app
    const app = officeAppLabel(appId, true)
    const appEn = officeAppLabel(appId, false)
    const tailVi = [...addNamesVi, ...openNamesVi.filter((n) => !addNamesVi.includes(n))]
    const tailEn = [...addNamesEn, ...openNamesEn.filter((n) => !addNamesEn.includes(n))]
    if (tailVi.length > 0) {
      return {
        goalVi: `Soạn ${app} và cập nhật ${joinVi(tailVi)}`,
        goalEn: `Draft ${appEn} and update ${joinEn(tailEn)}`,
      }
    }
    return {
      goalVi: `Soạn ${app}`,
      goalEn: `Draft ${appEn}`,
    }
  }

  if (adds.length > 0 && opens.length > 0) {
    return {
      goalVi: `Cập nhật ${joinVi(addNamesVi)} và mở ${joinVi(openNamesVi)}`,
      goalEn: `Update ${joinEn(addNamesEn)} and open ${joinEn(openNamesEn)}`,
    }
  }

  if (adds.length >= 2) {
    return {
      goalVi: `Cập nhật ${joinVi(addNamesVi)}`,
      goalEn: `Update ${joinEn(addNamesEn)}`,
    }
  }

  if (hasContinue && creates.length === 0) {
    return {
      goalVi: 'Tiếp tục trên tài liệu đang mở',
      goalEn: 'Continue on the open document',
    }
  }

  if (hasOpenFile && adds.length > 0) {
    return {
      goalVi: `Mở file và cập nhật ${joinVi(addNamesVi)}`,
      goalEn: `Open a file and update ${joinEn(addNamesEn)}`,
    }
  }

  // Fallback: short goal from first + last step kinds — still one phrase, not a pipeline dump
  if (creates.length > 0) {
    const c0 = creates[0]!
    if (c0.kind === 'fill_template') {
      const tpl = getTemplateById(c0.templateId)
      return {
        goalVi: tpl ? `Soạn mẫu ${tpl.labelVi}` : 'Soạn mẫu tài liệu',
        goalEn: tpl ? `Draft ${tpl.labelEn} template` : 'Draft document template',
      }
    }
    if (c0.kind === 'fill_form') {
      return {
        goalVi: 'Điền biểu mẫu thư viện',
        goalEn: 'Fill a library form',
      }
    }
    const app = officeAppLabel(c0.app, true)
    const appEn = officeAppLabel(c0.app, false)
    return { goalVi: `Soạn ${app}`, goalEn: `Draft ${appEn}` }
  }
  if (addNamesVi.length === 1) {
    return {
      goalVi: `Cập nhật ${addNamesVi[0]}`,
      goalEn: `Update ${addNamesEn[0]}`,
    }
  }
  return {
    goalVi: 'Hoàn thành yêu cầu của bạn',
    goalEn: 'Complete your request',
  }
}

function makePlan(
  steps: MyAiStep[],
  extra?: { playbookId?: string; playbookLabelVi?: string; playbookLabelEn?: string },
): Extract<MyAiRoute, { kind: 'plan' }> {
  const { goalVi, goalEn } = synthesizePlanGoal(steps, {
    playbookLabelVi: extra?.playbookLabelVi,
    playbookLabelEn: extra?.playbookLabelEn,
  })
  return {
    kind: 'plan',
    steps,
    goalVi,
    goalEn,
    summaryVi: goalVi,
    summaryEn: goalEn,
    ...(extra?.playbookId ? { playbookId: extra.playbookId } : {}),
  }
}

function tryBuildPlan(raw: string): Extract<MyAiRoute, { kind: 'plan' }> | null {
  const fromClauses: MyAiStep[] = []
  const clauses = splitMyAiClauses(raw)
  if (clauses.length >= 2) {
    for (const clause of clauses.slice(0, MAX_PLAN_STEPS)) {
      const r = routeMyAiTextSingle(clause)
      if (r.kind !== 'unknown') fromClauses.push(r)
    }
  }

  let steps = dedupeSteps(fromClauses)

  if (steps.length < 2) {
    const { head, companions } = extractCompanionClauses(raw)
    if (companions.length === 0) return null
    const primary = routeMyAiTextSingle(head)
    if (primary.kind === 'unknown') return null
    const built: MyAiStep[] = [primary]
    for (const c of companions) {
      const r = routeMyAiTextSingle(c)
      if (r.kind !== 'unknown') built.push(r)
    }
    steps = dedupeSteps(built)
  }

  steps = steps.slice(0, MAX_PLAN_STEPS)
  if (steps.length < 2) return null

  // Prefer mixed plans (create+workbench) or 2+ distinct kinds
  const kinds = new Set(steps.map((s) => s.kind))
  if (kinds.size < 2 && !(steps[0]!.kind === 'workbench' && steps.length >= 2)) {
    // allow two workbench steps (add task + open clients)
    if (!(steps.every((s) => s.kind === 'workbench') && steps.length >= 2)) return null
  }

  return makePlan(steps)
}

/**
 * Route a single clause (no multi-tool planning).
 * Prefer specific file ops before generic Workbench NL.
 */
export function routeMyAiTextSingle(text: string): MyAiStep | Extract<MyAiRoute, { kind: 'unknown' }> {
  const raw = text.trim()
  if (!raw) {
    return {
      kind: 'unknown',
      hintVi: 'Hãy nhập yêu cầu của bạn.',
      hintEn: 'Please enter a request.',
    }
  }
  const lower = raw.toLowerCase()
  const lowerNorm = norm(raw)

  // 0) Active Office tab (before generic summarize / open)
  if (looksLikeSummarizeActive(lower) || looksLikeSummarizeActive(lowerNorm)) {
    return { kind: 'summarize_active' }
  }
  if (looksLikeContinueActive(lower) || looksLikeContinueActive(lowerNorm)) {
    const brief =
      extractAfter(
        [
          /(?:tiếp tục|tiep tuc|continue|resume)\s+(?:trên|tren|on)\s+(?:file|tab|document)\s+(?:này|nay|this|đang mở|dang mo|active)\s*[:\-–]?\s*(.+)$/i,
          /(?:tiếp tục|tiep tuc|continue|resume)\s*[:\-–]\s*(.+)$/i,
          /(?:với|with|bằng|bang)\s+(.+)$/i,
        ],
        raw,
      ) || ''
    const cleaned = brief
      .replace(/^(?:trên|tren|on)\s+/i, '')
      .replace(/\b(file|tab|document|này|nay|this|đang mở|dang mo|active)\b/gi, ' ')
      .replace(/^[:\-–]+\s*/, '')
      .replace(/\s+/g, ' ')
      .trim()
    return {
      kind: 'continue_active',
      ...(cleaned.length >= 4 ? { brief: cleaned } : {}),
    }
  }

  // 1) Search files
  if (looksLikeSearch(lower) || looksLikeSearch(lowerNorm)) {
    const query =
      extractAfter(
        [
          /(?:tìm file|tim file|tìm kiếm file|tim kiem file|search file|find file|tìm tài liệu|tim tai lieu)\s*[:\-–]?\s*(.+)$/i,
          /(?:tìm|tim|search|find)\s+(.+)$/i,
        ],
        raw,
      ) || raw
    return { kind: 'search_files', query: stripCreateNoise(query, null) || query }
  }

  // 2) Open file by name
  if (looksLikeOpenFile(lower) || looksLikeOpenFile(lowerNorm)) {
    const query =
      extractAfter(
        [
          /(?:mở file|mo file|open file|mở tài liệu|mo tai lieu|open document)\s*[:\-–]?\s*(.+)$/i,
          /(?:mở|mo|open)\s+(.+)$/i,
        ],
        raw,
      ) || raw
    const cleaned = stripCreateNoise(query, detectApp(lower))
      .replace(/\b(file|tai lieu|tài liệu)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return { kind: 'open_file', query: cleaned || query }
  }

  // 3) Create Office file — ask for topic unless brief is clear (or user wants blank)
  if (looksLikeCreate(lower) || looksLikeCreate(lowerNorm)) {
    const app = detectApp(lower) ?? detectApp(lowerNorm)
    if (app) {
      return routeCreateApp(app, raw, lower, lowerNorm)
    }
    // "viết hợp đồng thuê nhà" without saying Word → Docs when topic is clear
    if (/\b(viết|viet|soạn|soan|draft|write)\b/i.test(lower)) {
      return routeCreateApp('docs', raw, lower, lowerNorm)
    }
  }

  // 4) Summarize recent files
  if (looksLikeSummarizeRecents(lower) || looksLikeSummarizeRecents(lowerNorm)) {
    const query = stripCreateNoise(
      extractAfter(
        [
          /(?:tóm tắt|tom tat|summarize|summary|tổng hợp|tong hop)\s+(.+)$/i,
        ],
        raw,
      ),
      null,
    )
    return {
      kind: 'summarize_recents',
      ...(query ? { query } : {}),
      limit: 8,
    }
  }

  // 5) Workbench — add/summarize/run_skill OK; open/navigate need an open verb
  // (bare keywords like “bạn”/“note” must not yank the user out of My AI)
  const resolved = resolveAgentIntentFromText(raw, 'desktop')
  if (resolved) {
    const openVerb =
      /(?:^|[\s,;])(?:mở|mo|open|vào|vao|go to|chuyển tới|chuyen toi|chuyển đến|chuyen den)\b/i.test(
        lower,
      ) ||
      /(?:mở|open)\s+tab\b/i.test(lower) ||
      /(?:mở|open)\s+(?:lịch|lich|calendar|công việc|cong viec|tasks?|ghi chú|ghi chu|notes?|email|khách hàng|clients?)/i.test(
        lower,
      )
    const isOpenish = resolved.action === 'open' || resolved.action === 'navigate'
    if (!(isOpenish && !openVerb)) {
      const intent = createAgentIntent({
        ...resolved,
        source: 'desktop',
        requireConsent: false,
        text: raw,
      })
      return { kind: 'workbench', intent }
    }
  }

  return {
    kind: 'unknown',
    hintVi:
      'Thử: “Soạn báo giá Word và thêm việc follow-up, mở tab Clients”, “Mở file báo cáo”, “Tóm tắt file gần đây”.',
    hintEn:
      'Try: “Draft a Word quote and add a follow-up task, open Clients”, “Open report file”, “Summarize recent files”.',
  }
}

export interface RouteMyAiOptions {
  practiceId?: PracticeId
}

/** Route a user utterance — may return a multi-tool / practice playbook plan. */
export function routeMyAiText(text: string, opts?: RouteMyAiOptions): MyAiRoute {
  const raw = text.trim()
  if (!raw) {
    return {
      kind: 'unknown',
      hintVi: 'Hãy nhập yêu cầu của bạn.',
      hintEn: 'Please enter a request.',
    }
  }

  // Workbench Forms library (uploaded templates) before playbooks
  if (opts?.practiceId) {
    const formHit = routeFormFill(opts.practiceId, raw)
    if (formHit?.kind === 'form') {
      const form = getFormById(opts.practiceId, formHit.formId)
      return makePlan([{ kind: 'fill_form', formId: formHit.formId, hint: raw }], {
        playbookLabelVi: form ? `Điền biểu mẫu ${form.title}` : 'Điền biểu mẫu thư viện',
        playbookLabelEn: form ? `Fill form ${form.title}` : 'Fill library form',
      })
    }
    if (formHit?.kind === 'pick') {
      return {
        kind: 'fill_form',
        hint: raw,
      }
    }

    // Phase C — practice playbook before generic clause split
    const hit = matchPracticePlaybook(opts.practiceId, raw)
    if (hit) {
      return makePlan(hit.steps, {
        playbookId: hit.playbook.id,
        playbookLabelVi: hit.playbook.labelVi,
        playbookLabelEn: hit.playbook.labelEn,
      })
    }
  }

  const plan = tryBuildPlan(raw)
  if (plan) return plan
  return routeMyAiTextSingle(raw)
}

export function officeAppLabel(app: OfficeApp, vi: boolean): string {
  const map: Record<OfficeApp, { vi: string; en: string }> = {
    docs: { vi: 'Word', en: 'Word' },
    sheets: { vi: 'Excel', en: 'Excel' },
    slides: { vi: 'Slides', en: 'Slides' },
    pdf: { vi: 'PDF', en: 'PDF' },
  }
  return vi ? map[app].vi : map[app].en
}
