import type {
  DeskDraft,
  DeskToolId,
  RecentEntry,
  UniworkDocStatus,
  UniworkDocSummary,
  UniworkSaveState,
} from '../../shared/home-api'
import type { WorkNotification, WorkRecentDocument } from '../../shared/uniwork-work-api'

const PDF = /\.pdf$/i
/** what Export PDF takes; mirrors desk-tools.ts EXPORTABLE (main checks again) */
const EXPORTABLE = /\.(docx|xlsx|xlsm|xls|csv|tsv|pptx|md|markdown|html|htm)$/i

/** the tools that fit a set of dropped files (office desk spec §4.2) */
export function applicableTools(paths: readonly string[]): DeskToolId[] {
  if (paths.length === 0) return []
  if (paths.every((p) => PDF.test(p))) {
    return paths.length === 1
      ? ['pdf-to-docx', 'pdf-to-xlsx', 'pdf-to-pptx', 'split-pdf']
      : ['merge-pdf']
  }
  return paths.length === 1 && EXPORTABLE.test(paths[0]!) ? ['export-pdf'] : []
}

const DOC_KINDS = new Set(['document_commented', 'document_mentioned'])

/** unread comments and mentions on a document */
export function docNotifications(inbox: readonly WorkNotification[]): WorkNotification[] {
  return inbox.filter((n) => !n.read_at && n.resource_type === 'document' && DOC_KINDS.has(n.kind))
}

const WEEK_MS = 7 * 86_400_000

/** shared with me in the last 7 days and never opened on this device */
export function freshShared(
  shared: readonly UniworkDocSummary[],
  recents: readonly RecentEntry[],
  now: number,
): UniworkDocSummary[] {
  const opened = new Set(recents.flatMap((r) => (r.uniwork ? [r.uniwork.documentId] : [])))
  return shared.filter(
    (d) => !d.archived && !opened.has(d.id) && now - (Date.parse(d.updatedAt) || 0) <= WEEK_MS,
  )
}

/** save states the person has to act on (not saving, queued or simply offline) */
const PROBLEMS: ReadonlySet<UniworkSaveState> = new Set<UniworkSaveState>([
  'conflict',
  'failed',
  'error',
  'blocked',
  'paused_user',
  'paused_admin',
  'reconciling-stuck',
])

export function syncProblems(statuses: readonly UniworkDocStatus[]): UniworkDocStatus[] {
  return statuses.filter((s) => PROBLEMS.has(s.state))
}

export type InTrayRow =
  | { kind: 'sync'; status: UniworkDocStatus }
  | { kind: 'note'; note: WorkNotification }
  | { kind: 'shared'; doc: UniworkDocSummary }

const newestBy =
  <T>(at: (x: T) => string | undefined) =>
  (a: T, b: T) =>
    (Date.parse(at(b) ?? '') || 0) - (Date.parse(at(a) ?? '') || 0)

/** "Needs you": sync problems, then comments and mentions, then shares; newest first in each */
export function inTrayRows(i: {
  notes: readonly WorkNotification[]
  shared: readonly UniworkDocSummary[]
  sync: readonly UniworkDocStatus[]
}): InTrayRow[] {
  return [
    ...[...i.sync]
      .sort(newestBy((s) => s.lastSavedAt))
      .map((status) => ({ kind: 'sync' as const, status })),
    ...[...i.notes]
      .sort(newestBy((n) => n.created_at))
      .map((note) => ({ kind: 'note' as const, note })),
    ...[...i.shared]
      .sort(newestBy((d) => d.updatedAt))
      .map((doc) => ({ kind: 'shared' as const, doc })),
  ]
}

export type InProgressRow =
  { kind: 'draft'; draft: DeskDraft } | { kind: 'recent'; doc: WorkRecentDocument }

/**
 * "In progress": drafts first, then recent documents a draft does not already show.
 * `local` is this device's raw recents: it maps a draft's working copy to its UniWork document.
 */
export function inProgressRows(
  drafts: readonly DeskDraft[],
  recent: readonly WorkRecentDocument[],
  local: readonly RecentEntry[],
  limit = 10,
): InProgressRow[] {
  const shown = new Set(drafts.flatMap((d) => (d.filePath ? [d.filePath] : [])))
  const draftDocIds = new Set(
    local.flatMap((e) => (e.uniwork && shown.has(e.path) ? [e.uniwork.documentId] : [])),
  )
  return [
    ...drafts.map((draft) => ({ kind: 'draft' as const, draft })),
    ...recent
      .filter((r) => (r.source === 'local' ? !shown.has(r.entry.path) : !draftDocIds.has(r.doc.id)))
      .map((doc) => ({ kind: 'recent' as const, doc })),
  ].slice(0, limit)
}
