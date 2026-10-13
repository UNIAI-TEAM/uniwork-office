/**
 * Tasks tab helpers (pure): due-date groups like the web My work list, plus
 * the catalogue statuses that close a task.
 */
import type { WorkTask, WorkTaskStatus } from '../../shared/uniwork-work-api'

export type TaskDueGroup = 'overdue' | 'today' | 'week' | 'later' | 'none'

const ORDER: readonly TaskDueGroup[] = ['overdue', 'today', 'week', 'later', 'none']

/** YYYY-MM-DD of `d` in the local time zone */
export function localIsoDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** The Sunday that closes the (Monday-first) week holding `today` (YYYY-MM-DD). */
export function endOfWeek(today: string): string {
  const d = new Date(`${today}T00:00:00`)
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7))
  return localIsoDate(d)
}

function groupOf(due: string | undefined, today: string, weekEnd: string): TaskDueGroup {
  if (!due) return 'none'
  const day = due.slice(0, 10)
  if (day < today) return 'overdue'
  if (day === today) return 'today'
  return day <= weekEnd ? 'week' : 'later'
}

/** Non-empty groups in display order; inside a group by due date, then title. */
export function groupTasksByDue(
  tasks: readonly WorkTask[],
  today: string,
): { group: TaskDueGroup; tasks: WorkTask[] }[] {
  const weekEnd = endOfWeek(today)
  const byGroup = new Map<TaskDueGroup, WorkTask[]>()
  for (const task of tasks) {
    const group = groupOf(task.due_date, today, weekEnd)
    byGroup.set(group, [...(byGroup.get(group) ?? []), task])
  }
  return ORDER.filter((group) => byGroup.has(group)).map((group) => ({
    group,
    tasks: byGroup
      .get(group)!
      .sort(
        (a, b) =>
          (a.due_date ?? '').localeCompare(b.due_date ?? '') || a.title.localeCompare(b.title),
      ),
  }))
}

/** Status keys that close a task: catalogue rows in the done / cancelled categories, plus the built-in keys. */
export function closedStatusKeys(statuses: readonly WorkTaskStatus[]): Set<string> {
  const keys = new Set(['done', 'cancelled'])
  for (const s of statuses) if (s.category === 'done' || s.category === 'cancelled') keys.add(s.key)
  return keys
}
