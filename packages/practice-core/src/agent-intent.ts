import {
  WORKBENCH_MODULES,
  getWorkbenchModule,
  isWorkbenchModuleId,
  type WorkbenchModuleId,
} from './modules.js'
import { isSkillDomainId, type SkillDomainId } from './skill-domains.js'
import type { PracticePillarId } from './types.js'

/** Where the AI command originated. */
export type AgentIntentSource = 'pwa' | 'desktop' | 'hub' | 'dev'

/** Data scope the intent may touch. */
export type AgentIntentScope = 'local' | 'cloud' | 'dual'

/**
 * Actions the desktop Agent Host can apply to a Workbench tab / pillar.
 * Keep this list small and explicit — PWA NL maps here before touching stores.
 */
export type AgentIntentAction =
  | 'open'
  | 'navigate'
  | 'add_item'
  | 'summarize'
  | 'run_skill'

export type AgentIntentTarget =
  | { kind: 'module'; id: WorkbenchModuleId }
  | { kind: 'pillar'; id: PracticePillarId }
  | { kind: 'skill-domain'; id: SkillDomainId }

export interface AgentIntent {
  /** Opaque id from PWA / Hub (or generated on desktop). */
  intentId: string
  target: AgentIntentTarget
  action: AgentIntentAction
  scope: AgentIntentScope
  source: AgentIntentSource
  /** Short user-visible summary (max ~200 chars). */
  summary: string
  /** Free text for add_item / NL residue. */
  text?: string
  /** Optional structured fields (dates, amounts) — no file paths / secrets. */
  fields?: Record<string, string | number | boolean>
  /** Require on-device consent before mutate / open. Default true for pwa/hub. */
  requireConsent: boolean
  createdAt: string
}

export interface AgentIntentActionDef {
  id: AgentIntentAction
  labelVi: string
  labelEn: string
  /** Mutates local stores (needs consent). */
  mutates: boolean
}

export const AGENT_INTENT_ACTIONS: readonly AgentIntentActionDef[] = [
  {
    id: 'open',
    labelVi: 'Mở tab',
    labelEn: 'Open tab',
    mutates: false,
  },
  {
    id: 'navigate',
    labelVi: 'Điều hướng',
    labelEn: 'Navigate',
    mutates: false,
  },
  {
    id: 'add_item',
    labelVi: 'Thêm mục',
    labelEn: 'Add item',
    mutates: true,
  },
  {
    id: 'summarize',
    labelVi: 'Tóm tắt ngữ cảnh',
    labelEn: 'Summarize context',
    mutates: false,
  },
  {
    id: 'run_skill',
    labelVi: 'Chạy kỹ năng',
    labelEn: 'Run skill',
    mutates: false,
  },
] as const

const PILLARS: readonly PracticePillarId[] = ['knowledge', 'materials', 'skills', 'compose']

/** Keywords (vi/en, lowercase) → module id for NL routing. */
const MODULE_KEYWORDS: readonly { id: WorkbenchModuleId; keys: readonly string[] }[] = [
  { id: 'desk', keys: ['my space', 'không gian', 'myspace', 'desk', 'bàn cá nhân'] },
  { id: 'calendar', keys: ['lịch', 'calendar', 'hẹn', 'deadline', 'cuộc họp'] },
  { id: 'tasks', keys: ['công việc', 'tasks', 'todo', 'việc cần', 'to-do', 'task'] },
  { id: 'notes', keys: ['ghi chú', 'notes', 'note', 'nháp'] },
  { id: 'email', keys: ['email', 'e-mail', 'thư', 'mail', 'hộp thư', 'inbox'] },
  { id: 'assistant', keys: ['trợ lý', 'assistant', 'ai assistant'] },
  { id: 'forms', keys: ['biểu mẫu', 'forms', 'form', 'mẫu giấy'] },
  { id: 'personal', keys: ['hồ sơ', 'personal', 'cá nhân profile'] },
  {
    id: 'personal-finance',
    keys: ['tài chính', 'finance', 'chi tiêu', 'thu chi', 'đầu tư', 'money'],
  },
  { id: 'events', keys: ['sự kiện', 'events', 'hội thảo', 'event'] },
  { id: 'health', keys: ['sức khoẻ', 'sức khỏe', 'health', 'khám', 'yoga', 'chạy bộ'] },
  { id: 'self-growth', keys: ['phát triển', 'self-growth', 'growth', 'thói quen'] },
  { id: 'family', keys: ['gia đình', 'family', 'con cái', 'gia phả'] },
  { id: 'friends', keys: ['bạn bè', 'friends', 'bạn'] },
  {
    id: 'pets',
    keys: ['thú cưng', 'pets', 'pet', 'chó', 'mèo', 'dog', 'cat'],
  },
  { id: 'travel', keys: ['du lịch', 'travel', 'chuyến đi', 'trip'] },
  { id: 'clients', keys: ['khách hàng', 'clients', 'client', 'đối tác'] },
  { id: 'contracts', keys: ['hợp đồng', 'contracts', 'contract'] },
  { id: 'matters', keys: ['vụ việc', 'matters', 'hồ sơ vụ'] },
]

const PILLAR_KEYWORDS: readonly { id: PracticePillarId; keys: readonly string[] }[] = [
  { id: 'knowledge', keys: ['tri thức', 'knowledge', 'thư viện gói'] },
  { id: 'materials', keys: ['tài liệu', 'materials', 'học liệu'] },
  { id: 'skills', keys: ['kỹ năng', 'skills', 'skill'] },
  { id: 'compose', keys: ['soạn mới', 'compose', 'tạo gói'] },
]

const ADD_KEYS = ['thêm', 'add', 'tạo', 'create', 'ghi', 'nhập'] as const
const SUM_KEYS = ['tóm tắt', 'summarize', 'summary', 'tổng hợp'] as const
const OPEN_KEYS = ['mở', 'open', 'vào', 'go to', 'chuyển'] as const

export function isAgentIntentAction(value: unknown): value is AgentIntentAction {
  return (
    typeof value === 'string' && AGENT_INTENT_ACTIONS.some((a) => a.id === value)
  )
}

export function isPracticePillarId(value: unknown): value is PracticePillarId {
  return typeof value === 'string' && (PILLARS as readonly string[]).includes(value)
}

export function tabIdForTarget(target: AgentIntentTarget): string {
  if (target.kind === 'module') return target.id
  if (target.kind === 'pillar') return target.id
  return 'skills'
}

export function labelForTarget(target: AgentIntentTarget, vi: boolean): string {
  if (target.kind === 'module') {
    const m = getWorkbenchModule(target.id)
    return m ? (vi ? m.labelVi : m.labelEn) : target.id
  }
  if (target.kind === 'pillar') {
    const map: Record<PracticePillarId, { vi: string; en: string }> = {
      knowledge: { vi: 'Tri thức', en: 'Knowledge' },
      materials: { vi: 'Tài liệu', en: 'Materials' },
      skills: { vi: 'Kỹ năng', en: 'Skills' },
      compose: { vi: 'Soạn mới', en: 'Compose' },
    }
    return vi ? map[target.id].vi : map[target.id].en
  }
  return target.id
}

export function actionDef(action: AgentIntentAction): AgentIntentActionDef {
  return AGENT_INTENT_ACTIONS.find((a) => a.id === action) ?? AGENT_INTENT_ACTIONS[0]!
}

function newIntentId(): string {
  return `intent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createAgentIntent(
  partial: Omit<AgentIntent, 'intentId' | 'createdAt' | 'requireConsent'> & {
    intentId?: string
    createdAt?: string
    requireConsent?: boolean
  },
): AgentIntent {
  const source = partial.source
  return {
    intentId: partial.intentId ?? newIntentId(),
    target: partial.target,
    action: partial.action,
    scope: partial.scope ?? 'local',
    source,
    summary: (partial.summary || '').slice(0, 200),
    text: partial.text?.slice(0, 2000),
    fields: partial.fields,
    requireConsent:
      partial.requireConsent ?? (source === 'pwa' || source === 'hub' || partial.action === 'add_item'),
    createdAt: partial.createdAt ?? new Date().toISOString(),
  }
}

/** Map free text (vi/en) → best-effort AgentIntent for desktop / PWA pre-routing. */
export function resolveAgentIntentFromText(
  text: string,
  source: AgentIntentSource = 'desktop',
): AgentIntent | null {
  const raw = text.trim()
  if (!raw) return null
  const lower = raw.toLowerCase()

  const RUN_SKILL_KEYS = ['chạy kỹ năng', 'chay ky nang', 'run skill', 'run_skill'] as const
  let action: AgentIntentAction = 'open'
  if (RUN_SKILL_KEYS.some((k) => lower.includes(k))) action = 'run_skill'
  else if (ADD_KEYS.some((k) => lower.includes(k))) action = 'add_item'
  else if (SUM_KEYS.some((k) => lower.includes(k))) action = 'summarize'
  else if (OPEN_KEYS.some((k) => lower.includes(k))) action = 'open'

  let target: AgentIntentTarget | null = null
  let bestLen = 0
  for (const row of MODULE_KEYWORDS) {
    for (const key of row.keys) {
      if (lower.includes(key) && key.length >= bestLen) {
        bestLen = key.length
        target = { kind: 'module', id: row.id }
      }
    }
  }
  for (const row of PILLAR_KEYWORDS) {
    for (const key of row.keys) {
      if (lower.includes(key) && key.length >= bestLen) {
        bestLen = key.length
        target = { kind: 'pillar', id: row.id }
      }
    }
  }
  if (!target) {
    // add_item without a module cue → tasks. Otherwise do not invent a tab
    // (My AI must stay in chat for free-form / local Q&A).
    if (action === 'add_item') {
      target = { kind: 'module', id: 'tasks' }
    } else {
      return null
    }
  }

  const modLabel =
    target.kind === 'module'
      ? getWorkbenchModule(target.id)?.labelVi ?? target.id
      : labelForTarget(target, true)

  return createAgentIntent({
    target,
    action,
    scope: 'local',
    source,
    summary: `${actionDef(action).labelVi}: ${modLabel}`,
    text: raw,
  })
}

export function parseAgentIntentTarget(
  tab: string | null | undefined,
  skillDomain?: string | null,
): AgentIntentTarget | null {
  if (skillDomain && isSkillDomainId(skillDomain)) {
    return { kind: 'skill-domain', id: skillDomain }
  }
  if (!tab) return null
  if (isWorkbenchModuleId(tab)) return { kind: 'module', id: tab }
  if (isPracticePillarId(tab)) return { kind: 'pillar', id: tab }
  return null
}

/** Modules that support add_item on-device today (must write a real row). */
export function moduleSupportsAddItem(id: WorkbenchModuleId): boolean {
  return (
    id === 'tasks' ||
    id === 'notes' ||
    id === 'email' ||
    id === 'calendar' ||
    id === 'events' ||
    id === 'personal-finance' ||
    id === 'health' ||
    id === 'self-growth'
  )
}

/** Catalog export for PWA / Hub documentation. */
export function listAgentRoutableTabs(): {
  id: string
  kind: 'module' | 'pillar'
  labelVi: string
  labelEn: string
  actions: AgentIntentAction[]
}[] {
  const modules = WORKBENCH_MODULES.map((m) => ({
    id: m.id,
    kind: 'module' as const,
    labelVi: m.labelVi,
    labelEn: m.labelEn,
    actions: (
      ['open', 'navigate'] as AgentIntentAction[]
    ).concat(moduleSupportsAddItem(m.id) ? (['add_item'] as AgentIntentAction[]) : []),
  }))
  const pillars = PILLARS.map((id) => ({
    id,
    kind: 'pillar' as const,
    labelVi: labelForTarget({ kind: 'pillar', id }, true),
    labelEn: labelForTarget({ kind: 'pillar', id }, false),
    actions: ['open', 'navigate', 'summarize', 'run_skill'] as AgentIntentAction[],
  }))
  return [...modules, ...pillars]
}
