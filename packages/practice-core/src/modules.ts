import type { PracticeId } from './types.js'

/**
 * Optional Workbench modules (pinned via Tab +).
 * Pillars (knowledge / materials / skills / compose) are also opt-in via Tab +.
 * Core always-on modules: My Space / Tasks / Calendar / Forms.
 * "Projects" is intentionally omitted — it maps to the Knowledge pillar.
 */
export type WorkbenchModuleId =
  | 'desk'
  | 'calendar'
  | 'tasks'
  | 'notes'
  | 'email'
  | 'assistant'
  | 'forms'
  | 'personal'
  | 'personal-finance'
  | 'events'
  | 'health'
  | 'self-growth'
  | 'family'
  | 'friends'
  | 'pets'
  | 'travel'
  | 'clients'
  | 'contracts'
  | 'matters'

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
    labelVi: 'Không gian của tôi',
    labelEn: 'My Space',
    hintVi: 'Tổng hợp việc làm & đời sống — chỉ số, nhắc, biểu đồ',
    hintEn: 'Work and life at a glance — KPIs, reminders, charts',
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
    hintVi: 'Tự quản trị việc cá nhân — List, Kanban, Lịch, Dashboard',
    hintEn: 'Personal task board — list, kanban, calendar, dashboard',
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
    id: 'email',
    labelVi: 'Email',
    labelEn: 'Email',
    hintVi: 'Soạn thư nháp + AI hỗ trợ — kết nối hộp thư ở bản sau',
    hintEn: 'Draft mail + AI assist — mailbox sync comes next',
    available: true,
  },
  {
    id: 'assistant',
    labelVi: 'Trợ lý AI',
    labelEn: 'AI Assistant',
    hintVi: 'Lối tắt vào uniAI (panel chung)',
    hintEn: 'Shortcut to uniAI (shared panel)',
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
  {
    id: 'personal-finance',
    labelVi: 'Tài chính cá nhân',
    labelEn: 'Personal finance',
    hintVi: 'Mục tiêu · chi tiêu · đầu tư tích luỹ',
    hintEn: 'Goals · spending · investing',
    available: true,
  },
  {
    id: 'events',
    labelVi: 'Sự kiện',
    labelEn: 'Events',
    hintVi: 'Hội thảo, họp, sự kiện sắp tới',
    hintEn: 'Upcoming meetings, talks, events',
    available: true,
  },
  {
    id: 'health',
    labelVi: 'Sức khoẻ',
    labelEn: 'Health',
    hintVi: 'Chỉ số, chạy bộ, yoga, thể thao, ăn kiêng, IF, ăn chay',
    hintEn: 'Metrics, running, yoga, sports, diet, IF, plant-based',
    available: true,
  },
  {
    id: 'self-growth',
    labelVi: 'Phát triển bản thân',
    labelEn: 'Self-growth',
    hintVi: 'Mục tiêu học tập / thói quen phát triển',
    hintEn: 'Learning goals and growth habits',
    available: true,
  },
  {
    id: 'family',
    labelVi: 'Gia đình tôi',
    labelEn: 'My family',
    hintVi: 'Thành viên, đồng hành cùng con, thuốc, chi tiêu, gia phả, cột mốc',
    hintEn: 'Members, parenting, meds, shopping, family tree, milestones',
    available: true,
  },
  {
    id: 'friends',
    labelVi: 'Bạn bè',
    labelEn: 'Friends',
    hintVi: 'Thông tin bạn bè, sự kiện quan trọng, kỷ niệm',
    hintEn: 'Friend profiles, important events, anniversaries',
    available: true,
  },
  {
    id: 'pets',
    labelVi: 'Thú cưng',
    labelEn: 'Pets',
    hintVi: 'Hồ sơ, album ảnh & lịch chăm sóc — lưu trên máy',
    hintEn: 'Profiles, photo albums & care schedule — stored on this device',
    available: true,
  },
  {
    id: 'travel',
    labelVi: 'Du lịch',
    labelEn: 'Travel',
    hintVi: 'Quản lý du lịch, chuẩn bị chuyến đi, lưu hành trình',
    hintEn: 'Trips, packing prep, and saved itineraries',
    available: true,
  },
  {
    id: 'clients',
    labelVi: 'Khách hàng',
    labelEn: 'Clients',
    hintVi: 'Danh bạ khách hàng / đối tác',
    hintEn: 'Client and partner directory',
    available: true,
  },
  {
    id: 'contracts',
    labelVi: 'Hợp đồng',
    labelEn: 'Contracts',
    hintVi: 'Theo dõi hợp đồng & hạn hiệu lực',
    hintEn: 'Track contracts and validity dates',
    available: true,
  },
  {
    id: 'matters',
    labelVi: 'Vụ việc',
    labelEn: 'Matters',
    hintVi: 'Hồ sơ vụ việc cho Luật sư / Pháp lý',
    hintEn: 'Legal matters for counsel / legal teams',
    available: true,
  },
] as const

/**
 * Always-on Workbench tabs (cannot be removed via Tab ×).
 * Order: My Space → Tasks → Calendar → Forms. Everything else is opt-in via +.
 */
export const CORE_PINNED_MODULES: readonly WorkbenchModuleId[] = [
  'desk',
  'tasks',
  'calendar',
  'forms',
]

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
