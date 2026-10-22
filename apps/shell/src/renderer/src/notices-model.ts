import type { WorkNotification } from '../../shared/uniwork-work-api'
import { documentChangedSentenceKey, documentChangedTitleParams } from './desk-doc-change'
import type { StringKey, TFunc } from './locale'
import { notificationKey } from './work-home'

/** the document kinds the server sends (server/internal/notification/kinds.go) */
export const DOCUMENT_KINDS = [
  'document_commented',
  'document_mentioned',
  'document_body_mentioned',
  'document_comment_replied',
  'document_discussion_mentioned',
  'document_discussion_replied',
  'document_comment_resolved',
  'document_edit_requested',
  'document_edit_request_answered',
  'document_edit_taken_over',
  'document_break_glass',
  'document_access_requested',
  'document_access_approved',
  'document_access_declined',
  'document_shared',
  'document_owner_transferred',
  'document_trashed_by_other',
  'document_changed',
] as const

export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

const DOCUMENT_KIND_SET: ReadonlySet<string> = new Set(DOCUMENT_KINDS)

export const isDocumentKind = (kind: string): kind is DocumentKind => DOCUMENT_KIND_SET.has(kind)

// ── Categories and day groups (ports of the web's notification-category.ts and inbox-groups.ts) ──

/** what the person has to do about a row; a kind from a newer server falls into the last one */
export const INBOX_CATEGORIES = [
  'mentions',
  'assigned',
  'meetings',
  'updates',
  'workspace',
] as const
export type InboxCategory = (typeof INBOX_CATEGORIES)[number]

const KIND_CATEGORY: Readonly<Record<string, InboxCategory>> = {
  mentioned: 'mentions',
  task_commented: 'mentions',
  chat_follow_up: 'mentions',
  chat_reminder: 'mentions',
  document_commented: 'mentions',
  document_mentioned: 'mentions',
  document_body_mentioned: 'mentions',
  document_comment_replied: 'mentions',
  document_discussion_mentioned: 'mentions',
  document_discussion_replied: 'mentions',
  document_comment_resolved: 'mentions',
  document_edit_requested: 'mentions',
  chat_mentioned: 'mentions',
  chat_dm: 'mentions',
  chat_thread_replied: 'mentions',
  chat_call_incoming: 'mentions',
  document_access_requested: 'mentions',
  task_assigned: 'assigned',
  meeting_invited: 'meetings',
  meeting_starting: 'meetings',
  meeting_summary_reminder: 'meetings',
  task_status_changed: 'updates',
  document_edit_request_answered: 'updates',
  document_edit_taken_over: 'updates',
  member_added: 'workspace',
  role_changed: 'workspace',
  audit_export_ready: 'workspace',
  document_break_glass: 'workspace',
  document_trashed_by_other: 'workspace',
  document_changed: 'updates',
  email_hub_new_mail: 'updates',
  document_access_approved: 'updates',
  document_access_declined: 'updates',
  document_shared: 'updates',
  document_owner_transferred: 'updates',
}

export function inboxCategory(kind: string): InboxCategory {
  return Object.hasOwn(KIND_CATEGORY, kind) ? KIND_CATEGORY[kind]! : 'workspace'
}

/** unread rows per category among `rows` */
export function unreadByCategory(rows: readonly WorkNotification[]): Record<InboxCategory, number> {
  const out = Object.fromEntries(INBOX_CATEGORIES.map((c) => [c, 0])) as Record<
    InboxCategory,
    number
  >
  for (const n of rows) if (!n.read_at) out[inboxCategory(n.kind)] += 1
  return out
}

export type InboxGroupKey = 'unread' | 'today' | 'yesterday' | 'week' | 'older'

export interface InboxGroup {
  key: InboxGroupKey
  rows: WorkNotification[]
}

const DAY_MS = 86_400_000
const GROUP_ORDER: readonly InboxGroupKey[] = ['unread', 'today', 'yesterday', 'week', 'older']

/**
 * Unread first, all of it; then what the person has seen, by the viewer's calendar day: today,
 * yesterday, the rest of the last seven days, older. Rows keep the server's newest-first order
 * inside each group and empty groups are dropped. A row in `pinned` stays in the group recorded
 * for it whatever its read state is now (so a row marked read does not jump away under the cursor).
 */
export function groupInbox(
  rows: readonly WorkNotification[],
  now: Date,
  pinned: ReadonlyMap<string, InboxGroupKey> = new Map(),
): InboxGroup[] {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const start = today.getTime()
  const buckets: Record<InboxGroupKey, WorkNotification[]> = {
    unread: [],
    today: [],
    yesterday: [],
    week: [],
    older: [],
  }
  for (const n of rows) {
    const pin = pinned.get(n.id)
    if (pin) {
      buckets[pin].push(n)
      continue
    }
    if (!n.read_at) {
      buckets.unread.push(n)
      continue
    }
    const at = new Date(n.created_at).getTime()
    if (Number.isNaN(at) || at >= start) buckets.today.push(n)
    else if (at >= start - DAY_MS) buckets.yesterday.push(n)
    else if (at >= start - 6 * DAY_MS) buckets.week.push(n)
    else buckets.older.push(n)
  }
  return GROUP_ORDER.filter((key) => buckets[key].length > 0).map((key) => ({
    key,
    rows: buckets[key],
  }))
}

// ── Sentence ──

/** the share levels the app words; any other value (a newer server) reads level-less */
const LEVEL_KEYS: Readonly<Record<string, StringKey>> = {
  view: 'shrLevelView',
  comment: 'shrLevelComment',
  edit: 'shrLevelEdit',
  manage: 'shrLevelManage',
}

/** the string key of a share level, or null for a level the app does not word */
export function shareLevelKey(level: string): StringKey | null {
  return Object.hasOwn(LEVEL_KEYS, level) ? LEVEL_KEYS[level]! : null
}

const isDate = (raw: string) => raw !== '' && !Number.isNaN(new Date(raw).getTime())

/** the day a trash notice falls on, in the viewer's zone and no time ("" when unreadable) */
function purgeDate(raw: string, locale: string, now: Date): string {
  if (!isDate(raw)) return ''
  const date = new Date(raw)
  // the year is noise inside the viewer's current year
  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === now.getFullYear()
      ? { day: 'numeric', month: 'short' }
      : { dateStyle: 'medium' }
  return new Intl.DateTimeFormat(locale, options).format(new Date(raw))
}

/**
 * The params of a sentence in the reader's words: `level` becomes its label, `date` the purge day.
 * Every other param goes through as the server sent it.
 */
export function localizeNoticeParams(
  params: Record<string, string>,
  t: TFunc,
  dateLocale: string,
  now: Date = new Date(),
): Record<string, string> {
  const out = { ...params }
  if (out.level !== undefined) {
    const key = shareLevelKey(out.level)
    out.level = key ? t(key) : ''
  }
  if (out.date !== undefined) out.date = purgeDate(out.date, dateLocale, now)
  return out
}

/** document kinds whose sentence always names the document, so they have no untitled variant */
const NEVER_UNTITLED: ReadonlySet<string> = new Set([
  'document_edit_requested',
  'document_edit_request_answered',
  'document_edit_taken_over',
  'document_access_declined',
])

/**
 * The sentence of a notice and the params it places. A document notice whose title is gone (the
 * server drops it once the reader lost access) uses the untitled variant, never an empty quoted
 * name; a decline of an edit request reads "still editing"; a share without a known level and a
 * trash notice without a readable date drop that clause. A change row words itself by verb and shape.
 */
export function noticeSentence(n: WorkNotification): {
  key: StringKey
  params: Record<string, string>
} {
  if (n.kind === 'document_changed')
    return { key: documentChangedSentenceKey(n), params: documentChangedTitleParams(n) }
  if (n.resource_type !== 'document' || !isDocumentKind(n.kind))
    return { key: notificationKey(n.kind), params: n.params }

  if (n.kind === 'document_edit_request_answered' && n.params.decision === 'decline')
    return { key: 'wbNotif_document_edit_request_answered_declined', params: n.params }

  let name = `wbNotif_${n.kind}`
  if (!NEVER_UNTITLED.has(n.kind) && !n.params.document?.trim()) name += '_untitled'
  if (n.kind === 'document_shared' && shareLevelKey(n.params.level ?? '') === null)
    name += '_nolevel'
  if (n.kind === 'document_trashed_by_other' && !isDate(n.params.date ?? '')) name += '_nodate'
  return { key: name as StringKey, params: n.params }
}

/** the pill of a notice: one word per family; a kind outside the document families reads Comment */
export function notePillKey(n: WorkNotification): StringKey {
  switch (n.kind) {
    case 'document_mentioned':
    case 'document_body_mentioned':
    case 'document_discussion_mentioned':
      return 'wbDeskPillMention'
    case 'document_comment_replied':
    case 'document_discussion_replied':
      return 'wbDeskPillReply'
    case 'document_comment_resolved':
      return 'wbDeskPillResolved'
    case 'document_changed':
      return 'wbDeskPillChanged'
    case 'document_edit_requested':
    case 'document_edit_request_answered':
    case 'document_edit_taken_over':
      return 'wbDeskPillEdit'
    case 'document_access_requested':
    case 'document_access_approved':
    case 'document_access_declined':
      return 'wbDeskPillAccess'
    case 'document_shared':
    case 'document_owner_transferred':
      return 'wbDeskPillShared'
    case 'document_trashed_by_other':
      return 'wbDeskPillTrash'
    case 'document_break_glass':
      return 'wbDeskPillBreakGlass'
    default:
      return 'wbDeskPillComment'
  }
}

// ── Target ──

/** a web page a non-document notice opens: WorkWebTarget without the slugs the caller adds */
export type NoticeWebTarget = { kind: 'task' | 'meeting' | 'room'; id: string } | { kind: 'inbox' }

export type NoticeTarget =
  | { to: 'document'; documentId: string; commentId?: string; discussion?: true }
  | { to: 'share'; documentId: string; workspaceId: string; section: 'requests' | 'break_glass' }
  | { to: 'trash'; documentId: string; workspaceId: string }
  /** document_changed: the UNI-2067 dialog / open code decides */
  | { to: 'changed' }
  | { to: 'web'; target: NoticeWebTarget }
  | { to: 'none' }

/** the kinds that point at one comment or discussion post to reveal */
const COMMENT_KINDS: ReadonlySet<string> = new Set([
  'document_commented',
  'document_mentioned',
  'document_comment_replied',
  'document_discussion_mentioned',
  'document_discussion_replied',
  'document_comment_resolved',
])

/**
 * Where a click on a notice goes in the app, mirroring the web's resource-href.ts. A document or
 * resource that is gone or out of reach opens nothing: the caller says why (`noticeState`) and marks it read.
 * A change row always answers `changed` because its click depends on the count and the verb.
 */
export function noticeTarget(n: WorkNotification): NoticeTarget {
  if (n.kind === 'document_changed') return { to: 'changed' }
  if (n.resource_deleted || n.resource_access_lost) return { to: 'none' }

  if (n.resource_type === 'document') {
    const documentId = n.resource_id
    switch (n.kind) {
      case 'document_access_declined':
        return { to: 'none' }
      case 'document_access_requested':
        return { to: 'share', documentId, workspaceId: n.workspace_id, section: 'requests' }
      case 'document_break_glass':
        return { to: 'share', documentId, workspaceId: n.workspace_id, section: 'break_glass' }
      case 'document_trashed_by_other':
        return { to: 'trash', documentId, workspaceId: n.workspace_id }
    }
    const commentId = n.params.comment_id
    if (!COMMENT_KINDS.has(n.kind) || !commentId || n.comment_deleted)
      return { to: 'document', documentId }
    return n.params.kind === 'discussion'
      ? { to: 'document', documentId, commentId, discussion: true }
      : { to: 'document', documentId, commentId }
  }

  switch (n.resource_type) {
    case 'task':
      return { to: 'web', target: { kind: 'task', id: n.resource_id } }
    case 'meeting':
      return { to: 'web', target: { kind: 'meeting', id: n.resource_id } }
    case 'chat_message':
      return n.resource_parent_id
        ? { to: 'web', target: { kind: 'room', id: n.resource_parent_id } }
        : { to: 'web', target: { kind: 'inbox' } }
    case 'chat_room':
      return { to: 'web', target: { kind: 'room', id: n.resource_id } }
    default:
      return { to: 'web', target: { kind: 'inbox' } }
  }
}
