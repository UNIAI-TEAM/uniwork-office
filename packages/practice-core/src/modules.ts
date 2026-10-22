import type { PracticeId } from './types.js'

/**
 * Optional Workbench modules (pinned via Tab +).
 * Pillars (knowledge / materials / skills / compose) are also opt-in via Tab +.
 * Core always-on modules: Desk / Inbox / Tasks / Calendar.
 * "Projects" is intentionally omitted — it maps to the Knowledge pillar.
 */
export type WorkbenchModuleId =
  'desk' | 'inbox' | 'tasks' | 'calendar' | 'forms' | 'notes' | 'personal'

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
    labelVi: 'Mặt bàn',
    labelEn: 'Desk',
    hintVi: 'Tài liệu cần xử lý, đang làm dở và dụng cụ',
    hintEn: 'Documents to handle, work in progress and tools',
    available: true,
  },
  {
    id: 'inbox',
    labelVi: 'Thông báo',
    labelEn: 'Inbox',
    hintVi: 'Thông báo từ UniWork: nhắc đến bạn, được giao, chia sẻ, bình luận',
    hintEn: 'UniWork notifications: mentions, assignments, shares and comments',
    available: true,
  },
  {
    id: 'calendar',
    labelVi: 'Lịch',
    labelEn: 'Calendar',
    hintVi: 'Việc có hạn và cuộc họp trong 14 ngày tới',
    hintEn: 'Due tasks and meetings in the next 14 days',
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
    hintVi: 'Ghi chú nhanh, lưu trên máy này',
    hintEn: 'Quick notes, stored on this device',
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
    labelVi: 'Hồ sơ',
    labelEn: 'Profile',
    hintVi: 'Hồ sơ UniWork của bạn, chỉ đọc',
    hintEn: 'Your UniWork profile, read-only',
    available: true,
  },
] as const

/**
 * Always-on Workbench tabs (cannot be removed via Tab ×).
 * Order: My Space → Inbox → Tasks → Calendar. Everything else is opt-in via +.
 */
export const CORE_PINNED_MODULES: readonly WorkbenchModuleId[] = [
  'desk',
  'inbox',
  'tasks',
  'calendar',
]

/** Suggested pins when a practice has never customized Tab +. */
export function defaultPinnedModules(_practiceId: PracticeId): WorkbenchModuleId[] {
  return [...CORE_PINNED_MODULES]
}

export function isCorePinnedModule(id: WorkbenchModuleId): boolean {
  return (CORE_PINNED_MODULES as readonly string[]).includes(id)
}

/**
 * Ensure core tabs are present. Preserves existing pin order; each missing core goes right after
 * the core that precedes it in CORE_PINNED_MODULES (or at the front), so pins saved before a core
 * existed get it next to its neighbour, not at the end of the cores.
 */
export function ensureCorePinnedModules(pins: readonly WorkbenchModuleId[]): WorkbenchModuleId[] {
  const out = pins.filter(isWorkbenchModuleId)
  CORE_PINNED_MODULES.forEach((id, i) => {
    if (out.includes(id)) return
    const before = CORE_PINNED_MODULES.slice(0, i).reduce(
      (at, core) => Math.max(at, out.indexOf(core)),
      -1,
    )
    out.splice(before + 1, 0, id)
  })
  return out
}

export function getWorkbenchModule(id: WorkbenchModuleId): WorkbenchModuleDef | undefined {
  return WORKBENCH_MODULES.find((m) => m.id === id)
}

export function isWorkbenchModuleId(value: unknown): value is WorkbenchModuleId {
  return typeof value === 'string' && WORKBENCH_MODULES.some((m) => m.id === value)
}
