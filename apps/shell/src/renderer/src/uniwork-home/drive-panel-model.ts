import type {
  DriveFile,
  DriveHistoryEvent,
  DriveIconKind,
  DriveTaskCreationGroup,
  DriveViewerAccess,
  UniworkDriveErrorCode,
} from '../../../shared/home-api'
import type { StringKey, TFunc } from '../locale'
import { UNIWORK_ERROR_KEYS, formatFullWhen } from '../uniwork-docs-model'

/**
 * View models for the Google Drive detail panel (UNI-2196, D3): what each Drive error says, how a
 * file type reads, who the file is bound to, and how the audit history is worded. Pure (no React,
 * no window) so the mapping is unit-tested.
 */

/** the sentence of a Drive error (spec §7.10); the generic load error is the fallback */
export function driveErrorKey(error: UniworkDriveErrorCode): StringKey {
  switch (error) {
    case 'network':
      return 'uhDriveOffline'
    case 'not_signed_in':
      return UNIWORK_ERROR_KEYS.not_signed_in
    case 'session_expired':
      return UNIWORK_ERROR_KEYS.session_expired
    case 'forbidden':
      return UNIWORK_ERROR_KEYS.forbidden
    case 'feature_disabled':
      return 'uhDriveFeatureOff'
    case 'auth_failed':
      return 'uhDriveErrAuthFailed'
    case 'not_found':
      return 'uhDriveNotFound'
    default:
      return 'uhDriveLoadError'
  }
}

/** errors after which the person has to sign in again: no retry would help */
export function isDriveSessionError(error: UniworkDriveErrorCode): boolean {
  return error === 'not_signed_in' || error === 'session_expired'
}

const TYPE_LABELS: Partial<Record<string, string>> = {
  google_doc: 'Google Docs',
  google_sheet: 'Google Sheets',
  google_slide: 'Google Slides',
  pdf: 'PDF',
  docx: 'Word',
  xlsx: 'Excel',
  pptx: 'PowerPoint',
  markdown: 'Markdown',
}

/** "Google Docs", "PDF", ...; plain text and unknown kinds read through the dictionary */
export function driveTypeLabel(iconKind: DriveIconKind, t: TFunc): string {
  const label = TYPE_LABELS[iconKind]
  if (label) return label
  return t(iconKind === 'text' ? 'uhDriveTypeText' : 'uhDriveTypeFile')
}

/** a file bound by someone other than the person who linked it was rebound (spec §7.7) */
export function reboundByName(file: DriveFile): string | null {
  if (!file.boundById || !file.createdBy || file.boundById === file.createdBy) return null
  return file.boundByName?.trim() || null
}

/** `granted` unless the server says otherwise; a missing value is read like the web does (unknown) */
export function viewerAccessOf(file: DriveFile): DriveViewerAccess {
  return file.viewerAccess || 'unknown'
}

/** the viewer's account is not usable for this file: a button hands off to the web page */
export function viewerNeedsWeb(access: DriveViewerAccess): boolean {
  return access === 'unknown' || access === 'lost' || access === 'connection_lost'
}

/** "Create tasks" and "Ask UNI" stay locked until the viewer reads the file (spec §7.4) */
export function viewerLocksUni(access: DriveViewerAccess): boolean {
  return access !== 'granted'
}

/** the bound connection is lost and the person may re-link with another account */
export function showRebind(file: DriveFile): boolean {
  return file.canRebind && (file.boundConnectionLost || Boolean(file.accessLostAt))
}

/** a day as every date line of the panel reads it ('' when the server sent no usable time) */
export function formatDriveDay(iso: string | undefined, locale: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

/** one group of the "Tasks created from this document" block */
export interface DriveCreationRow {
  key: string
  label: string
  tasks: DriveTaskCreationGroup['tasks']
}

/** "{date} · {name} · {count} tasks" per creation, newest first as the server sends them */
export function driveCreationRows(
  groups: readonly DriveTaskCreationGroup[] | undefined,
  t: TFunc,
  locale: string,
): DriveCreationRow[] {
  return (groups ?? [])
    .filter((g) => g.tasks.length > 0)
    .map((g) => ({
      key: g.proposalId,
      label: t(g.tasks.length === 1 ? 'uhDriveTasksCreatedGroupOne' : 'uhDriveTasksCreatedGroup', {
        date: formatDriveDay(g.createdAt, locale),
        name: g.createdByName,
        count: g.tasks.length,
      }),
      tasks: g.tasks,
    }))
}

const ACTIVITY_KEYS: Record<string, StringKey> = {
  'drive_file.linked': 'uhDriveActLinked',
  'drive_file.unlinked': 'uhDriveActUnlinked',
  'drive_file.rebound': 'uhDriveActRebound',
  'drive_file.access_granted': 'uhDriveActAccessGranted',
  'drive_file.access_changed': 'uhDriveActAccessChanged',
  'drive_file.access_lost': 'uhDriveActAccessLost',
  'drive_task_proposal.tasks_created': 'uhDriveActTasksCreated',
}

/** an action that is only a read or an open is not activity worth listing (spec Q7) */
function isReadAction(action: string): boolean {
  return action === 'drive_file.read' || /(^|[._])opened$/.test(action)
}

export interface DriveActivityRow {
  id: string
  text: string
  when: string
}

function actorName(event: DriveHistoryEvent): string {
  const meta = event.metadata ?? {}
  for (const key of ['actor_name', 'actorName', 'actor_display']) {
    const value = meta[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/** the history rows of the panel, newest first; reads and opens are dropped */
export function driveActivityRows(
  events: readonly DriveHistoryEvent[],
  t: TFunc,
  locale: string,
): DriveActivityRow[] {
  return events
    .filter((e) => !isReadAction(e.action))
    .slice()
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .map((e) => {
      const what = t(ACTIVITY_KEYS[e.action] ?? 'uhDriveActOther')
      const who = actorName(e)
      return {
        id: e.id,
        text: who ? `${who} · ${what}` : what,
        when: formatFullWhen(e.occurredAt, locale),
      }
    })
}
