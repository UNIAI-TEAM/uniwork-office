import type { PracticeId } from '@uniwork/practice-core'
import { wbStoreGetRaw, wbStoreSetRaw } from './workbench-store-client'

/** Dashboard widget ids for Tab My Space (module id: desk). */
export type DeskWidgetId = 'kpi-strip' | 'reminders' | 'tasks-ring' | 'calendar-14d'

export interface DeskWidgetDef {
  id: DeskWidgetId
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
    labelVi: 'Nhịp làm việc',
    labelEn: 'Work pulse',
    hintVi: 'Việc đang mở · lịch 7 ngày (dải hero)',
    hintEn: 'Open tasks · 7-day calendar (hero strip)',
    defaultOn: true,
    wide: true,
  },
  {
    id: 'reminders',
    labelVi: 'Nhắc việc quan trọng',
    labelEn: 'Important reminders',
    hintVi: 'Hạn gần từ lịch và việc',
    hintEn: 'Upcoming from calendar and tasks',
    defaultOn: true,
    wide: true,
  },
  {
    id: 'tasks-ring',
    labelVi: 'Tiến độ công việc',
    labelEn: 'Task progress',
    hintVi: 'Vòng hoàn thành việc',
    hintEn: 'Completion ring',
    defaultOn: true,
  },
  {
    id: 'calendar-14d',
    labelVi: 'Lịch 14 ngày',
    labelEn: '14-day calendar',
    hintVi: 'Mật độ mốc lịch',
    hintEn: 'Calendar density',
    defaultOn: true,
  },
] as const

/** Series colors for desk charts (screen UI). */
export const DESK_CHART = {
  tasks: '#4C8DFF',
  events: '#F5C542',
  track: 'color-mix(in srgb, var(--border) 70%, transparent)',
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
