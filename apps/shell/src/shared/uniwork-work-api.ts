import type { RecentEntry, UniworkDocErrorCode, UniworkDocSummary } from './home-api'

/**
 * The Workbench's UniWork work data (home, my tasks, statuses, calendar,
 * profile) as main hands it to the renderer: the server's snake_case DTOs,
 * only the fields the UI reads. Handlers live in main/uniwork-work; the
 * token never leaves main.
 */

/** The only failures the renderer ever sees from a work call. */
export type UniworkWorkError = 'signed-out' | 'forbidden' | 'offline' | 'server'

export type UniworkWorkResult<T> = { ok: true; value: T } | { ok: false; error: UniworkWorkError }

/** UniworkDocError codes -> work errors (main handlers, and the renderer for the docs list calls) */
export function workErrorOfDocCode(code: UniworkDocErrorCode): UniworkWorkError {
  switch (code) {
    case 'not_signed_in':
    case 'session_expired':
    case 'wrong_deployment':
      return 'signed-out'
    // access lost, including the G5-06 split of the server refusals
    case 'forbidden':
    case 'not_found':
    case 'deleted':
    case 'permission_revoked':
    case 'member_deactivated':
    case 'organization_suspended':
    case 'document_deleted':
    case 'document_archived':
      return 'forbidden'
    case 'network':
    case 'timeout':
      return 'offline'
    default:
      return 'server'
  }
}

/** Server catalogue key. The built-in keys are listed; the server may send others. */
export type WorkTaskStatusKey =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'blocked'
  | 'cancelled'
  | (string & {})

export interface WorkTask {
  id: string
  workspace_id: string
  /** "PREFIX-N"; '' when absent (shown in the project column, C9) */
  identifier: string
  title: string
  status: WorkTaskStatusKey
  /** none|low|medium|high|urgent (wider at runtime) */
  priority: string
  /** YYYY-MM-DD */
  due_date?: string
  /** RFC3339 */
  due_at?: string
  project_id?: string | null
  updated_at: string
}

/** GET /workspaces/{ws}/task-statuses -> `statuses[]` (archived rows dropped) */
export interface WorkTaskStatus {
  id: string
  /** what PATCH /tasks/{id} takes in `status` */
  key: string
  name: string
  /** one of the 7 built-in categories */
  category: string
  color: string
  position: number
}

export interface WorkMeeting {
  id: string
  workspace_id: string
  title: string
  starts_at: string
  ends_at: string
  /** 'IN_PROGRESS' = live */
  status?: string
}

export interface WorkNotification {
  id: string
  /** NOTIFICATION_KINDS, wider at runtime */
  kind: string
  workspace_id: string
  resource_type: string
  resource_id: string
  actor_kind: string
  /** e.g. "notifications.kind.task_assigned" */
  title_key: string
  params: Record<string, string>
  read_at?: string
  created_at: string
  /** `document_changed`: DISTINCT documents affected (a fold grows it) */
  count?: number
  /** RFC3339; a fold bumps it */
  updated_at?: string
  /** the single document the row names is trashed or purged */
  resource_deleted?: boolean
  /** the reader lost access to the document */
  resource_access_lost?: boolean
  /** the comment the row names is gone */
  comment_deleted?: boolean
  /** `document_changed`: up to 3 documents the reader can still read (ids and titles); [] when the field arrived unreadable */
  sample_documents?: { id: string; title: string }[]
  /** where a resource with no page of its own lives (a chat message's room) */
  resource_parent_id?: string
  /** who caused the row; absent for system rows */
  actor_id?: string
}

/** GET /me/notifications -> one page, newest first */
export interface WorkNotificationPage {
  notifications: WorkNotification[]
  /** pass back as `before` for the older page; null at the end */
  next_before: string | null
}

/** GET /me/notifications/unread-count (organization-level rows count only in `total`) */
export interface WorkUnreadCount {
  total: number
  /** workspace id -> unread rows */
  by_workspace: Record<string, number>
}

/** the inbox list query; every field is checked in main */
export interface WorkNotificationQuery {
  workspaceId?: string
  /** true = unread rows only */
  unread?: boolean
  /** the previous page's `next_before` */
  before?: string
  /** 1-100, default 30 */
  limit?: number
}

/** GET /me/notifications/{id}/documents -> `documents[]` (title and kind are '' when the server leaves them out) */
export interface WorkNotificationDocument {
  id: string
  title: string
  kind: string
  /** in the trash and the caller manages it */
  trashed: boolean
  /** in the archive, still readable */
  shelved: boolean
  /** purged */
  deleted: boolean
}

/** one page of the affected documents; `next_cursor` goes back verbatim, null at the end */
export interface WorkNotificationDocumentPage {
  documents: WorkNotificationDocument[]
  next_cursor: string | null
}

export type WorkHomeSource = 'tasks' | 'meetings' | 'notifications'

export interface WorkHomeCounts {
  open: number | null
  overdue: number | null
  due_today: number | null
  meetings_today: number | null
  unread: number | null
}

/**
 * GET /workspaces/{ws}/home. Each section degrades on its own: a section that
 * fails its schema becomes [] and its source is added to `partial`.
 */
export interface WorkHomeSummary {
  /** YYYY-MM-DD in `timezone`; a response without it is 'server' */
  today: string
  /** '' when absent */
  timezone: string
  counts: WorkHomeCounts
  my_work: WorkTask[]
  upcoming_meetings: WorkMeeting[]
  inbox: WorkNotification[]
  partial: WorkHomeSource[]
  generated_at: string
}

/** GET /workspaces/{ws}/calendar/events?from&to&mine=true -> `events[]` */
export interface WorkCalendarEvent {
  id: string
  kind: 'task' | 'meeting' | 'external' | (string & {})
  entity_id: string
  title: string
  start: string
  end?: string | null
  all_day: boolean
  status?: string | null
  project_id?: string | null
}

/** GET /orgs/{orgSlug}/people/{userId} -> `person` (`reports` ignored) */
export interface WorkPerson {
  user_id: string
  display_name: string
  email: string
  avatar_url?: string
  title: string
  department: { id: string; name: string } | null
  manager: { id: string; kind: string; display_name: string } | null
  timezone: string
}

export interface WorkCreateTaskInput {
  workspaceId: string
  title: string
  /** YYYY-MM-DD */
  dueDate?: string
  /** the renderer mints one (crypto.randomUUID()) per intent and reuses it on Retry */
  idempotencyKey: string
}

/** Overview "recent documents": UniWork rows (aiOffice.uniworkListDocuments) plus local recents */
export type WorkRecentDocument =
  { source: 'uniwork'; doc: UniworkDocSummary } | { source: 'local'; entry: RecentEntry }

/**
 * A UniWork web page to open. Main builds the URL; the renderer never passes
 * one (paths follow uniwork:packages/core/paths/paths.ts).
 */
export type WorkWebTarget =
  | {
      kind: 'task' | 'meeting' | 'room' | 'person' | 'document'
      orgSlug: string
      wsSlug: string
      id: string
    }
  | { kind: 'my-tasks' | 'calendar' | 'inbox' | 'tasks'; orgSlug: string; wsSlug: string }
  | { kind: 'onboarding' }
  | { kind: 'drive-pick'; orgSlug: string; wsSlug: string; accountId?: string }
  | { kind: 'drive-connect'; orgSlug: string; wsSlug: string }
  | {
      kind: 'drive-name-folder'
      orgSlug: string
      wsSlug: string
      accountId: string
      folderId: string
    }
  | { kind: 'drive-file'; orgSlug: string; wsSlug: string; id: string; action?: 'propose' | 'ask' }

export const UNIWORK_WORK_CHANNELS = {
  homeSummary: 'uniwork-work:home-summary',
  myTasks: 'uniwork-work:my-tasks',
  taskStatuses: 'uniwork-work:task-statuses',
  setTaskStatus: 'uniwork-work:set-task-status',
  createTask: 'uniwork-work:create-task',
  calendarEvents: 'uniwork-work:calendar-events',
  myProfile: 'uniwork-work:my-profile',
  markNotificationsRead: 'uniwork-work:mark-notifications-read',
  notificationDocuments: 'uniwork-work:notification-documents',
  listNotifications: 'uniwork-work:list-notifications',
  unreadCount: 'uniwork-work:unread-count',
  markNotificationsUnread: 'uniwork-work:mark-notifications-unread',
  archiveNotifications: 'uniwork-work:archive-notifications',
  unarchiveNotifications: 'uniwork-work:unarchive-notifications',
  markAllNotificationsRead: 'uniwork-work:mark-all-notifications-read',
  openWeb: 'uniwork-work:open-web',
  webUrl: 'uniwork-work:web-url',
} as const

/**
 * window.uniworkWork. Workspaces and recent cloud documents are not here:
 * reuse aiOffice.uniworkListWorkspaces() and
 * aiOffice.uniworkListDocuments({ workspaceId, limit: 20 }) (slice to 6).
 */
export interface UniworkWorkApi {
  homeSummary(workspaceId: string): Promise<UniworkWorkResult<WorkHomeSummary>>
  myTasks(workspaceId: string): Promise<UniworkWorkResult<WorkTask[]>>
  taskStatuses(workspaceId: string): Promise<UniworkWorkResult<WorkTaskStatus[]>>
  /** `status` is a catalogue key ('done', 'todo', ...), not a status id */
  setTaskStatus(taskId: string, status: string): Promise<UniworkWorkResult<WorkTask>>
  createTask(input: WorkCreateTaskInput): Promise<UniworkWorkResult<WorkTask>>
  calendarEvents(input: {
    workspaceId: string
    from: string
    to: string
  }): Promise<UniworkWorkResult<WorkCalendarEvent[]>>
  /** the signed-in user in the selected org (main resolves the org slug and account id) */
  myProfile(): Promise<UniworkWorkResult<WorkPerson>>
  /** POST /me/notifications/read: the caller's own ids (1-100); someone else's id is a 404 */
  markNotificationsRead(ids: string[]): Promise<UniworkWorkResult<null>>
  /**
   * GET /me/notifications/{id}/documents: the documents a `document_changed` row covers, 50 per page
   * by default (limit 1-100). `cursor` is the previous page's `next_cursor`, untouched. Does not mark the row read.
   */
  notificationDocuments(
    id: string,
    q?: { cursor?: string; limit?: number },
  ): Promise<UniworkWorkResult<WorkNotificationDocumentPage>>
  /** GET /me/notifications: the caller's inbox, newest first, archived rows left out */
  listNotifications(q?: WorkNotificationQuery): Promise<UniworkWorkResult<WorkNotificationPage>>
  /** GET /me/notifications/unread-count: for the badges */
  unreadCount(): Promise<UniworkWorkResult<WorkUnreadCount>>
  /** POST /me/notifications/unread: the caller's own ids (1-100) */
  markNotificationsUnread(ids: string[]): Promise<UniworkWorkResult<null>>
  /** POST /me/notifications/archive: hides the rows (no delete); undo with unarchiveNotifications */
  archiveNotifications(ids: string[]): Promise<UniworkWorkResult<null>>
  /** POST /me/notifications/unarchive: back into the inbox */
  unarchiveNotifications(ids: string[]): Promise<UniworkWorkResult<null>>
  /**
   * POST /me/notifications/read {all: true}: every unread row, or one workspace's. Answers the
   * ids it read, so Undo can send them to markNotificationsUnread.
   */
  markAllNotificationsRead(q?: { workspaceId?: string }): Promise<UniworkWorkResult<string[]>>
  /** false when the target fails validation or no deployment profile is set */
  openWeb(target: WorkWebTarget): Promise<boolean>
  /** the URL openWeb would open (for Copy link), or null on the same conditions */
  webUrl(target: WorkWebTarget): Promise<string | null>
}
