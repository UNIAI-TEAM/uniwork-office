import type { PracticeId } from '@uniwork/practice-core'
import { wbStoreGetRaw, wbStoreSetRaw } from './workbench-store-client'

/** Dashboard widget ids for Tab My Space (module id: desk). */
export type DeskWidgetId =
  | 'kpi-strip'
  | 'reminders'
  | 'finance-bar'
  | 'finance-donut'
  | 'tasks-ring'
  | 'calendar-14d'
  | 'growth-bars'
  | 'health-dots'
  | 'events-upcoming'
  | 'family-upcoming'
  | 'clients-kpi'
  | 'contracts-status'
  | 'matters-status'

export type DeskWidgetGroup = 'personal' | 'extra'

export interface DeskWidgetDef {
  id: DeskWidgetId
  group: DeskWidgetGroup
  labelVi: string
  labelEn: string
  hintVi: string
  hintEn: string
  /** Default visible for new layouts */
  defaultOn: boolean
  /** Wider card (full row) */
  wide?: boolean
}

export const DESK_WIDGETS: readonly DeskWidgetDef[] = [
  {
    id: 'kpi-strip',
    group: 'personal',
    labelVi: 'Nhịp sống nhanh',
    labelEn: 'Life pulse',
    hintVi: 'Việc · sự kiện · thu/chi tháng (dải hero)',
    hintEn: 'Tasks · events · month cash (hero strip)',
    defaultOn: true,
    wide: true,
  },
  {
    id: 'reminders',
    group: 'personal',
    labelVi: 'Nhắc việc quan trọng',
    labelEn: 'Important reminders',
    hintVi: 'Hạn gần từ lịch, việc, sự kiện…',
    hintEn: 'Upcoming from calendar, tasks, events…',
    defaultOn: true,
    wide: true,
  },
  {
    id: 'finance-bar',
    group: 'personal',
    labelVi: 'Thu · Chi 6 tháng',
    labelEn: 'Income · Expense 6 months',
    hintVi: 'Biểu đồ cột theo tháng',
    hintEn: 'Monthly grouped bars',
    defaultOn: true,
  },
  {
    id: 'finance-donut',
    group: 'personal',
    labelVi: 'Cơ cấu chi tháng',
    labelEn: 'Expense mix (month)',
    hintVi: 'Donut theo nhãn chi',
    hintEn: 'Donut by expense label',
    defaultOn: true,
  },
  {
    id: 'tasks-ring',
    group: 'personal',
    labelVi: 'Tiến độ công việc',
    labelEn: 'Task progress',
    hintVi: 'Vòng hoàn thành việc',
    hintEn: 'Completion ring',
    defaultOn: true,
  },
  {
    id: 'calendar-14d',
    group: 'personal',
    labelVi: 'Lịch 14 ngày',
    labelEn: '14-day calendar',
    hintVi: 'Mật độ mốc / sự kiện',
    hintEn: 'Deadline & event density',
    defaultOn: true,
  },
  {
    id: 'growth-bars',
    group: 'personal',
    labelVi: 'Mục tiêu phát triển',
    labelEn: 'Growth goals',
    hintVi: 'Thanh tiến độ self-growth',
    hintEn: 'Self-growth progress bars',
    defaultOn: true,
  },
  {
    id: 'health-dots',
    group: 'personal',
    labelVi: 'Sức khoẻ gần đây',
    labelEn: 'Recent health',
    hintVi: 'Ghi nhận theo loại',
    hintEn: 'Entries by kind',
    defaultOn: true,
  },
  {
    id: 'events-upcoming',
    group: 'extra',
    labelVi: 'Sự kiện sắp tới',
    labelEn: 'Upcoming events',
    hintVi: 'Danh sách sự kiện',
    hintEn: 'Event list',
    defaultOn: false,
  },
  {
    id: 'family-upcoming',
    group: 'extra',
    labelVi: 'Gia đình · sinh nhật',
    labelEn: 'Family · birthdays',
    hintVi: 'Thành viên & ngày sinh gần',
    hintEn: 'Members & upcoming birthdays',
    defaultOn: false,
  },
  {
    id: 'clients-kpi',
    group: 'extra',
    labelVi: 'Khách hàng',
    labelEn: 'Clients',
    hintVi: 'Số lượng & liên hệ gần',
    hintEn: 'Count & recent contacts',
    defaultOn: false,
  },
  {
    id: 'contracts-status',
    group: 'extra',
    labelVi: 'Hợp đồng theo trạng thái',
    labelEn: 'Contracts by status',
    hintVi: 'Bar ngang trạng thái HĐ',
    hintEn: 'Horizontal status bars',
    defaultOn: false,
  },
  {
    id: 'matters-status',
    group: 'extra',
    labelVi: 'Vụ việc theo trạng thái',
    labelEn: 'Matters by status',
    hintVi: 'Bar ngang trạng thái vụ',
    hintEn: 'Horizontal status bars',
    defaultOn: false,
  },
] as const

/** Bright, elegant series palette for desk charts (screen UI). */
export const DESK_CHART = {
  income: '#2BB673',
  expense: '#FF8A5B',
  tasks: '#4C8DFF',
  events: '#F5C542',
  health: '#3ECFBE',
  growth: '#9B7EDE',
  legal: '#6B7CFF',
  matter: '#FF6B8A',
  family: '#FF9F43',
  clients: '#2563EB',
  muted: '#94A3B8',
  track: 'color-mix(in srgb, var(--border) 70%, transparent)',
  series: ['#4C8DFF', '#2BB673', '#FF8A5B', '#F5C542', '#9B7EDE', '#3ECFBE', '#FF6B8A'] as const,
} as const

const LAYOUT_PREFIX = 'uniwork.wb.desk.layout.'

export function defaultDeskLayout(): DeskWidgetId[] {
  return DESK_WIDGETS.filter((w) => w.defaultOn).map((w) => w.id)
}

export function getDeskWidget(id: DeskWidgetId): DeskWidgetDef | undefined {
  return DESK_WIDGETS.find((w) => w.id === id)
}

export function isDeskWidgetId(value: unknown): value is DeskWidgetId {
  return typeof value === 'string' && DESK_WIDGETS.some((w) => w.id === value)
}

export function readDeskLayout(practiceId: PracticeId): DeskWidgetId[] {
  try {
    const raw = wbStoreGetRaw(LAYOUT_PREFIX + practiceId)
    if (raw === null) return defaultDeskLayout()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return defaultDeskLayout()
    const ids = parsed.filter(isDeskWidgetId)
    return ids.length > 0 ? ids : defaultDeskLayout()
  } catch {
    return defaultDeskLayout()
  }
}

export function writeDeskLayout(practiceId: PracticeId, ids: DeskWidgetId[]): void {
  wbStoreSetRaw(LAYOUT_PREFIX + practiceId, JSON.stringify(ids))
}

export function monthKey(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d.slice(0, 10) + 'T12:00:00') : d
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function formatMonthShort(key: string, vi: boolean): string {
  const [y, m] = key.split('-').map(Number)
  if (!y || !m) return key
  if (vi) return `T${m}`
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return names[m - 1] ?? key
}

export function lastNMonthKeys(n: number, from = new Date()): string[] {
  const out: string[] = []
  const d = new Date(from.getFullYear(), from.getMonth(), 1)
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1)
    out.push(monthKey(x))
  }
  return out
}

export function daysFromToday(isoDate: string): number {
  const a = new Date()
  a.setHours(12, 0, 0, 0)
  const b = new Date(isoDate.slice(0, 10) + 'T12:00:00')
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

export function addDaysIso(base: Date, delta: number): string {
  const d = new Date(base)
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + delta)
  return d.toISOString().slice(0, 10)
}
