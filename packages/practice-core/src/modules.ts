import type { PracticeId } from './types.js'

/**
 * Optional Workbench modules (pinned via Tab +).
 * Pillars (knowledge / materials / skills / compose) are also opt-in via Tab +.
 * Core always-on modules: My Space / Tasks / Calendar.
 * "Projects" is intentionally omitted — it maps to the Knowledge pillar.
 */
export type WorkbenchModuleId = 'desk' | 'tasks' | 'calendar' | 'forms' | 'notes' | 'personal'

export interface WorkbenchModuleDef {
  id: WorkbenchModuleId
  labelVi: string
  labelEn: string
  hintVi: string
  hintEn: string
  /** false = listed in + menu but pane shows “soon” guidance */
  available: boolean
}

export const WORKBENCH_MODULES: readonly WorkbenchModuleDef[] = [
  {
    id: 'desk',
    labelVi: 'Tổng quan',
    labelEn: 'Overview',
    hintVi: 'Việc, lịch họp và thông báo hôm nay',
    hintEn: 'Today’s work, meetings and notifications',
    available: true,
  },
  {
    id: 'calendar',
    labelVi: 'Lịch',
    labelEn: 'Calendar',
    hintVi: 'Xem dạng Calendar hoặc danh sách · mốc hạn theo vai trò',
    hintEn: 'Calendar or list view · role deadlines',
    available: true,
  },
  {
    id: 'tasks',
    labelVi: 'Công việc',
    labelEn: 'Tasks',
    hintVi: 'Việc của bạn trên UniWork, chia theo hạn',
    hintEn: 'Your UniWork tasks, grouped by due date',
    available: true,
  },
  {
    id: 'notes',
    labelVi: 'Ghi chú',
    labelEn: 'Notes',
    hintVi: 'Bảng ghim giấy note — kéo thả, đổi màu',
    hintEn: 'Sticky pinboard — drag, recolor, pin notes',
    available: true,
  },
  {
    id: 'forms',
    labelVi: 'Biểu mẫu',
    labelEn: 'Forms',
    hintVi: 'Thư viện biểu mẫu / mẫu giấy tờ hay dùng',
    hintEn: 'Reusable forms and paperwork templates',
    available: true,
  },
  {
    id: 'personal',
    labelVi: 'Cá nhân',
    labelEn: 'Personal',
    hintVi: 'Hồ sơ cá nhân dùng khi soạn văn bản',
    hintEn: 'Personal profile for drafting',
    available: true,
  },
] as const

/**
 * Always-on Workbench tabs (cannot be removed via Tab ×).
 * Order: My Space → Tasks → Calendar. Everything else is opt-in via +.
 */
export const CORE_PINNED_MODULES: readonly WorkbenchModuleId[] = ['desk', 'tasks', 'calendar']

/** Suggested pins when a practice has never customized Tab +. */
export function defaultPinnedModules(_practiceId: PracticeId): WorkbenchModuleId[] {
  return [...CORE_PINNED_MODULES]
}

export function isCorePinnedModule(id: WorkbenchModuleId): boolean {
  return (CORE_PINNED_MODULES as readonly string[]).includes(id)
}

/**
 * Ensure core tabs are present. Preserves existing pin order; inserts any
 * missing cores after the last already-pinned core (or at the front).
 */
export function ensureCorePinnedModules(pins: readonly WorkbenchModuleId[]): WorkbenchModuleId[] {
  const valid = pins.filter(isWorkbenchModuleId)
  const have = new Set(valid)
  const missing = CORE_PINNED_MODULES.filter((id) => !have.has(id))
  if (missing.length === 0) return valid
  if (valid.length === 0) return [...CORE_PINNED_MODULES]
  let insertAt = 0
  for (let i = 0; i < valid.length; i++) {
    if (isCorePinnedModule(valid[i]!)) insertAt = i + 1
  }
  const out = [...valid]
  out.splice(insertAt, 0, ...missing)
  return out
}

export function getWorkbenchModule(id: WorkbenchModuleId): WorkbenchModuleDef | undefined {
  return WORKBENCH_MODULES.find((m) => m.id === id)
}

export function isWorkbenchModuleId(value: unknown): value is WorkbenchModuleId {
  return typeof value === 'string' && WORKBENCH_MODULES.some((m) => m.id === value)
}
