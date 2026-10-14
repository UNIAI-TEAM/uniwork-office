import type {
  WorkCalendarEvent,
  WorkHomeSource,
  WorkHomeSummary,
  WorkMeeting,
  WorkNotification,
  WorkPerson,
  WorkTask,
  WorkTaskStatus,
} from '../../shared/uniwork-work-api'
import { UniworkDocError } from '../uniwork-docs/errors'

/**
 * Readers for the UniWork work routes: the server's snake_case DTOs, only the
 * fields the Workbench reads (anything else, a token echoed back included,
 * never reaches the renderer). A bad list or object is `malformed_response`;
 * the Home sections instead degrade on their own into `partial`, like the web
 * client (uniwork:packages/core/api/endpoints/home.ts).
 */

function bad(): never {
  throw new UniworkDocError('malformed_response')
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad()
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  if (typeof value !== 'string') bad()
  return value
}

function id(value: unknown): string {
  const v = text(value)
  if (!v) bad()
  return v
}

/** absent and null both read as undefined */
function optional(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : text(value)
}

function nullable(value: unknown): string | null | undefined {
  return value === null ? null : optional(value)
}

function rows<T>(raw: unknown, key: string, one: (value: unknown) => T): T[] {
  const list = record(raw)[key]
  if (!Array.isArray(list)) bad()
  return list.map(one)
}

export function parseTask(value: unknown): WorkTask {
  const r = record(value)
  return {
    id: id(r.id),
    workspace_id: id(r.workspace_id),
    identifier: optional(r.identifier) ?? '',
    title: text(r.title),
    status: id(r.status),
    priority: text(r.priority),
    due_date: optional(r.due_date),
    due_at: optional(r.due_at),
    project_id: nullable(r.project_id),
    updated_at: text(r.updated_at),
  }
}

function parseMeeting(value: unknown): WorkMeeting {
  const r = record(value)
  return {
    id: id(r.id),
    workspace_id: id(r.workspace_id),
    title: text(r.title),
    starts_at: text(r.starts_at),
    ends_at: text(r.ends_at),
    status: optional(r.status),
  }
}

function params(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {}
  const out: Record<string, string> = {}
  for (const [key, v] of Object.entries(record(value))) out[key] = text(v)
  return out
}

function parseNotification(value: unknown): WorkNotification {
  const r = record(value)
  return {
    id: id(r.id),
    kind: text(r.kind),
    workspace_id: optional(r.workspace_id) ?? '',
    resource_type: text(r.resource_type),
    resource_id: text(r.resource_id),
    actor_kind: optional(r.actor_kind) ?? 'system',
    title_key: text(r.title_key),
    params: params(r.params),
    read_at: optional(r.read_at),
    created_at: text(r.created_at),
  }
}

const SOURCES: readonly WorkHomeSource[] = ['tasks', 'meetings', 'notifications']

/** null for a missing or drifted count: the page shows "—", never a made-up 0 */
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null

/** the rows, or null when one of them (or the list itself) does not parse */
function section<T>(value: unknown, one: (value: unknown) => T): T[] | null {
  if (!Array.isArray(value)) return null
  try {
    return value.map(one)
  } catch {
    return null
  }
}

export function parseHome(raw: unknown): WorkHomeSummary {
  const r = record(raw)
  const today = id(r.today)
  const reported: unknown[] = Array.isArray(r.partial) ? r.partial : []
  const partial = SOURCES.filter((source) => reported.includes(source))
  const pick = <T>(value: unknown, source: WorkHomeSource, one: (value: unknown) => T): T[] => {
    const parsed = section(value, one)
    if (parsed) return parsed
    // a list the parse had to empty is a source the page cannot trust
    if (!partial.includes(source)) partial.push(source)
    return []
  }
  const c = r.counts && typeof r.counts === 'object' ? (r.counts as Record<string, unknown>) : {}
  const my_work = pick(r.my_work, 'tasks', parseTask)
  const upcoming_meetings = pick(r.upcoming_meetings, 'meetings', parseMeeting)
  const inbox = pick(r.inbox, 'notifications', parseNotification)
  return {
    today,
    timezone: typeof r.timezone === 'string' ? r.timezone : '',
    counts: {
      open: count(c.open),
      overdue: count(c.overdue),
      due_today: count(c.due_today),
      meetings_today: count(c.meetings_today),
      unread: count(c.unread),
    },
    my_work,
    upcoming_meetings,
    inbox,
    partial,
    generated_at: typeof r.generated_at === 'string' ? r.generated_at : '',
  }
}

/** `{tasks: [...]}` (my-tasks) */
export function parseTaskList(raw: unknown): WorkTask[] {
  return rows(raw, 'tasks', parseTask)
}

/** `{task}` (PATCH /tasks/{id}, POST /workspaces/{ws}/tasks) */
export function parseOneTask(raw: unknown): WorkTask {
  return parseTask(record(raw).task)
}

/** `{statuses: [...]}` without the archived rows */
export function parseTaskStatuses(raw: unknown): WorkTaskStatus[] {
  return rows(raw, 'statuses', record)
    .filter((r) => !r.archived_at)
    .map((r) => ({
      id: id(r.id),
      key: id(r.key),
      name: text(r.name),
      category: text(r.category),
      color: text(r.color),
      position: typeof r.position === 'number' ? r.position : bad(),
    }))
}

function parseEvent(value: unknown): WorkCalendarEvent {
  const r = record(value)
  if (typeof r.all_day !== 'boolean') bad()
  return {
    id: id(r.id),
    kind: text(r.kind),
    entity_id: text(r.entity_id),
    title: text(r.title),
    start: text(r.start),
    end: nullable(r.end),
    all_day: r.all_day,
    status: nullable(r.status),
    project_id: nullable(r.project_id),
  }
}

/** `{events: [...]}` */
export function parseCalendarEvents(raw: unknown): WorkCalendarEvent[] {
  return rows(raw, 'events', parseEvent)
}

/** `{person, reports}`; `reports` is not read */
export function parsePerson(raw: unknown): WorkPerson {
  const r = record(record(raw).person)
  const department = r.department == null ? null : record(r.department)
  const manager = r.manager == null ? null : record(r.manager)
  return {
    user_id: id(r.user_id),
    display_name: text(r.display_name),
    email: text(r.email),
    avatar_url: optional(r.avatar_url),
    title: optional(r.title) ?? '',
    department: department ? { id: id(department.id), name: text(department.name) } : null,
    manager: manager
      ? { id: id(manager.id), kind: text(manager.kind), display_name: text(manager.display_name) }
      : null,
    timezone: optional(r.timezone) ?? '',
  }
}
