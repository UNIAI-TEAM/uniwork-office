/**
 * Which My AI steps need hard inline consent vs auto-run.
 * Token / deep-read → confirm. Workbench add_item is soft (auto + Undo in UI).
 */
import { getWorkbenchModule, type WorkbenchModuleId } from '@uniwork/practice-core'
import type { MyAiRoute, MyAiStep } from './my-ai-router'
import { getTemplateById } from './my-ai-templates'

export type ConsentReason = 'deep_read' | 'ai_token'

export interface ConsentNeed {
  reason: ConsentReason
  labelVi: string
  labelEn: string
}

export function workbenchModuleLabel(id: string, vi: boolean): string {
  const meta = getWorkbenchModule(id as WorkbenchModuleId)
  if (meta) return vi ? meta.labelVi : meta.labelEn
  return id
}

function officeAppFriendly(app: string, vi: boolean): string {
  switch (app) {
    case 'docs':
      return vi ? 'Word' : 'Word'
    case 'sheets':
      return vi ? 'Excel' : 'Excel'
    case 'slides':
      return vi ? 'PowerPoint' : 'PowerPoint'
    case 'pdf':
      return 'PDF'
    default:
      return app
  }
}

export function stepNeedsConsent(step: MyAiStep): ConsentNeed | null {
  if (step.kind === 'summarize_recents' || step.kind === 'summarize_active') {
    return {
      reason: 'deep_read',
      labelVi: 'Đọc nội dung trên máy và có thể dùng AI (có thể trừ Token)',
      labelEn: 'Read on-device content and may use AI (may use Tokens)',
    }
  }
  if (step.kind === 'create_file' && !step.blank && step.brief?.trim()) {
    return {
      reason: 'ai_token',
      labelVi: `Tạo ${officeAppFriendly(step.app, true)} với trợ giúp AI (có thể trừ Token)`,
      labelEn: `Create ${officeAppFriendly(step.app, false)} with AI help (may use Tokens)`,
    }
  }
  if (step.kind === 'fill_template') {
    const tpl = getTemplateById(step.templateId)
    const name = tpl ? (/* label filled below */ tpl.labelVi) : step.templateId
    const nameEn = tpl?.labelEn ?? step.templateId
    return {
      reason: 'ai_token',
      labelVi: `Soạn mẫu “${name}” với trợ giúp AI (có thể trừ Token)`,
      labelEn: `Draft “${nameEn}” template with AI help (may use Tokens)`,
    }
  }
  if (step.kind === 'fill_form' && step.formId) {
    return {
      reason: 'ai_token',
      labelVi: 'Điền biểu mẫu thư viện với trợ giúp AI (có thể trừ Token)',
      labelEn: 'Fill a library form with AI help (may use Tokens)',
    }
  }
  if (step.kind === 'continue_active') {
    return {
      reason: 'ai_token',
      labelVi: 'Gửi yêu cầu AI vào tab đang mở (có thể trừ Token)',
      labelEn: 'Send an AI request to the open tab (may use Tokens)',
    }
  }
  // workbench add_item: soft mutate — no hard consent (Undo in chat after run)
  return null
}

export function routeNeedsConsent(route: MyAiRoute): ConsentNeed[] {
  if (route.kind === 'unknown') return []
  if (route.kind === 'plan') {
    const out: ConsentNeed[] = []
    const seen = new Set<string>()
    for (const step of route.steps) {
      const need = stepNeedsConsent(step)
      if (!need) continue
      const key = `${need.reason}:${need.labelEn}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(need)
    }
    return out
  }
  const one = stepNeedsConsent(route)
  return one ? [one] : []
}

function outcomeForStep(step: MyAiStep, vi: boolean): string {
  if (step.kind === 'create_file') {
    const app = officeAppFriendly(step.app, vi)
    if (step.blank) return vi ? `mở ${app} trống` : `open a blank ${app}`
    return vi ? `soạn ${app} (có AI)` : `draft ${app} (with AI)`
  }
  if (step.kind === 'ask_create') {
    const app = officeAppFriendly(step.app, vi)
    return vi ? `hỏi chủ đề rồi soạn ${app}` : `ask for a topic, then draft ${app}`
  }
  if (step.kind === 'fill_template') {
    const tpl = getTemplateById(step.templateId)
    const name = tpl ? (vi ? tpl.labelVi : tpl.labelEn) : step.templateId
    return vi ? `soạn mẫu “${name}”` : `draft “${name}” template`
  }
  if (step.kind === 'fill_form') {
    return vi ? 'điền biểu mẫu thư viện' : 'fill a library form'
  }
  if (step.kind === 'open_file')
    return vi ? `mở file “${step.query}”` : `open “${step.query}”`
  if (step.kind === 'search_files')
    return vi ? `tìm file “${step.query}”` : `find “${step.query}”`
  if (step.kind === 'summarize_recents')
    return vi ? 'tóm tắt file gần đây' : 'summarize recent files'
  if (step.kind === 'summarize_active')
    return vi ? 'tóm tắt tab đang mở' : 'summarize the open tab'
  if (step.kind === 'continue_active')
    return vi ? 'tiếp tục trên tab đang mở' : 'continue on the open tab'
  if (step.kind === 'workbench') {
    const target =
      step.intent.target.kind === 'module'
        ? workbenchModuleLabel(step.intent.target.id, vi)
        : vi
          ? 'Workbench'
          : 'Workbench'
    if (step.intent.action === 'add_item') {
      return vi ? `thêm vào ${target}` : `add to ${target}`
    }
    if (step.intent.action === 'open' || step.intent.action === 'navigate') {
      return vi ? `mở ${target}` : `open ${target}`
    }
    return step.intent.summary || (vi ? `thao tác ${target}` : `${target} action`)
  }
  return vi ? 'tiếp tục' : 'continue'
}

function planGoal(route: Extract<MyAiRoute, { kind: 'plan' }>, vi: boolean): string {
  const g = vi ? route.goalVi || route.summaryVi : route.goalEn || route.summaryEn
  return g.trim()
}

/** One-line human outcome — for consent cards (future tense). Uses P3 goal. */
export function describeRouteOutcome(route: MyAiRoute, vi: boolean): string {
  if (route.kind === 'plan') {
    const goal = planGoal(route, vi)
    if (!goal) return vi ? 'Tôi sẽ giúp bạn.' : 'I’ll help with that.'
    // Goal is already a noun/verb phrase like "Tóm tắt… và lưu vào Ghi chú"
    return vi ? `Tôi sẽ: ${goal}.` : `I’ll: ${goal}.`
  }
  if (route.kind === 'unknown') {
    return vi ? route.hintVi : route.hintEn
  }
  return vi
    ? `Tôi sẽ ${outcomeForStep(route, true)}.`
    : `I’ll ${outcomeForStep(route, false)}.`
}

function doneForStep(step: MyAiStep, vi: boolean): string {
  if (step.kind === 'create_file') {
    const app = officeAppFriendly(step.app, vi)
    if (step.blank) return vi ? `đã mở ${app} trống` : `opened a blank ${app}`
    return vi ? `đã soạn ${app}` : `drafted ${app}`
  }
  if (step.kind === 'ask_create') {
    const app = officeAppFriendly(step.app, vi)
    return vi ? `đang hỏi chủ đề ${app}` : `asked for a ${app} topic`
  }
  if (step.kind === 'fill_template') {
    const tpl = getTemplateById(step.templateId)
    const name = tpl ? (vi ? tpl.labelVi : tpl.labelEn) : step.templateId
    return vi ? `đã soạn mẫu “${name}”` : `drafted “${name}” template`
  }
  if (step.kind === 'fill_form') {
    return vi ? 'đã điền biểu mẫu thư viện' : 'filled a library form'
  }
  if (step.kind === 'open_file')
    return vi ? `đã mở file “${step.query}”` : `opened “${step.query}”`
  if (step.kind === 'search_files')
    return vi ? `đã tìm file “${step.query}”` : `searched for “${step.query}”`
  if (step.kind === 'summarize_recents')
    return vi ? 'đã tóm tắt file gần đây' : 'summarized recent files'
  if (step.kind === 'summarize_active')
    return vi ? 'đã tóm tắt tab đang mở' : 'summarized the open tab'
  if (step.kind === 'continue_active')
    return vi ? 'đã gửi yêu cầu vào tab đang mở' : 'queued a request on the open tab'
  if (step.kind === 'workbench') {
    const target =
      step.intent.target.kind === 'module'
        ? workbenchModuleLabel(step.intent.target.id, vi)
        : 'Workbench'
    if (step.intent.action === 'add_item') {
      return vi ? `đã thêm vào ${target}` : `added to ${target}`
    }
    if (step.intent.action === 'open' || step.intent.action === 'navigate') {
      return vi ? `đã mở ${target}` : `opened ${target}`
    }
    return vi ? `đã cập nhật ${target}` : `updated ${target}`
  }
  return vi ? 'đã xong' : 'finished'
}

/**
 * Past-tense result card after a route finishes (P2/P3).
 * Prefer the single goal; only fall back to step phrases for partial runs.
 */
export function describeRouteDone(
  route: MyAiRoute,
  vi: boolean,
  opts?: { paused?: boolean; completedSteps?: number },
): string {
  if (opts?.paused) {
    // P4: short ask — not “plan paused / pick below to continue”
    return vi ? 'Mở file nào?' : 'Which file?'
  }
  if (route.kind === 'plan') {
    const full = (opts?.completedSteps ?? route.steps.length) >= route.steps.length
    if (full) {
      const goal = planGoal(route, vi)
      if (goal) {
        return vi ? `Đã xong: ${goal}.` : `Done: ${goal}.`
      }
    }
    const n = opts?.completedSteps ?? route.steps.length
    const steps = route.steps.slice(0, Math.max(0, n))
    const parts = steps.map((s) => doneForStep(s, vi))
    if (parts.length === 0) return vi ? 'Đã xong.' : 'Done.'
    if (parts.length === 1) {
      const p = parts[0]!
      return `${p.charAt(0).toUpperCase()}${p.slice(1)}.`
    }
    const head = parts.slice(0, -1).join(vi ? ', ' : ', ')
    const last = parts[parts.length - 1]
    const sentence = vi ? `${head}, rồi ${last}.` : `${head}, then ${last}.`
    return sentence.charAt(0).toUpperCase() + sentence.slice(1)
  }
  if (route.kind === 'unknown') {
    return vi ? route.hintVi : route.hintEn
  }
  const p = doneForStep(route, vi)
  return `${p.charAt(0).toUpperCase()}${p.slice(1)}.`
}

/**
 * Consent card body: one outcome sentence + optional Token note.
 * No duplicate plan pipeline / module ids.
 */
export function describeConsent(route: MyAiRoute, vi: boolean): string {
  const needs = routeNeedsConsent(route)
  if (needs.length === 0) return ''
  const outcome = describeRouteOutcome(route, vi)
  const hasToken = needs.some((n) => n.reason === 'ai_token' || n.reason === 'deep_read')
  const tokenNote = hasToken
    ? vi
      ? '\n\nBước này có thể dùng AI và trừ Token.'
      : '\n\nThis may use AI and spend Tokens.'
    : ''
  return outcome + tokenNote
}
