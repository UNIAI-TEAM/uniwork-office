// What the Version history sheet decides without drawing anything: who may write, which
// documents have the entry, how a row reads and which sentence a refusal gets. The web's
// version-history-sheet.tsx rules, on the bridge's coded results.
import type { DocHistoryResult, DocVersion } from '../../../shared/doc-history-api'
import type { UniworkDocSummary } from '../../../shared/home-api'
import type { StringKey } from '../locale'

/** what the sheet reads of a document: a list row satisfies it as is */
export type VersionHistoryTarget = Pick<UniworkDocSummary, 'id' | 'title'> &
  Partial<
    Pick<
      UniworkDocSummary,
      'workspaceId' | 'kind' | 'myLevel' | 'shelvedAt' | 'archived' | 'archivedAt'
    >
  >

type Failed = Extract<DocHistoryResult<never>, { ok: false }>

const isShelved = (row: Pick<VersionHistoryTarget, 'shelvedAt'>): boolean => !!row.shelvedAt
const isTrashed = (row: Pick<VersionHistoryTarget, 'archived' | 'archivedAt'>): boolean =>
  row.archived === true || !!row.archivedAt

/**
 * Create and restore need the edit or manage level, and a document that is neither on the
 * shelf (Lưu trữ keeps its history readable, ARCHIVE-01 §3) nor in the trash.
 */
export function canWriteVersions(
  row: Pick<VersionHistoryTarget, 'myLevel' | 'shelvedAt' | 'archived' | 'archivedAt'>,
): boolean {
  return !isShelved(row) && !isTrashed(row) && (row.myLevel === 'edit' || row.myLevel === 'manage')
}

/** every reader of a file or a page has the entry; a folder keeps no versions, the trash has its own menu */
export function versionsEntryAllowed(
  row: Pick<VersionHistoryTarget, 'kind' | 'archived' | 'archivedAt'>,
): boolean {
  return row.kind !== 'folder' && !isTrashed(row)
}

/** the version reason is a schema identifier; only its label is translated */
const REASON_KEYS: Record<string, StringKey> = {
  upload: 'vhsReasonUpload',
  manual: 'vhsReasonManual',
  auto: 'vhsReasonAuto',
  restore: 'vhsReasonRestore',
  agent: 'vhsReasonAgent',
}

export function reasonKey(version: Pick<DocVersion, 'reason'>): StringKey {
  return REASON_KEYS[version.reason] ?? 'vhsReasonUnknown'
}

/** today is named by its clock, any other day carries the date too (the web's formatWhen) */
export function formatWhen(
  at: string | null | undefined,
  locale: string,
  now = new Date(),
): string {
  if (!at) return ''
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return ''
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  return new Intl.DateTimeFormat(
    locale,
    sameDay ? { hour: '2-digit', minute: '2-digit' } : { dateStyle: 'medium', timeStyle: 'short' },
  ).format(date)
}

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'listItem',
  'tableRow',
  'horizontalRule',
])

/**
 * A page version's text for the read-only preview: the ProseMirror JSON flattened to its
 * lines (one per block, empty blocks dropped). Marks, tables and assets are not drawn; the
 * app has no page editor, and the preview says what the page said.
 */
export function pageText(content: unknown): string {
  const lines: string[] = []
  let line = ''
  const flush = () => {
    if (line.trim()) lines.push(line)
    line = ''
  }
  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== 'object' || depth > 64) return
    const n = node as { type?: unknown; text?: unknown; content?: unknown }
    if (typeof n.text === 'string') line += n.text
    else if (n.type === 'hardBreak') line += '\n'
    if (Array.isArray(n.content)) for (const child of n.content) walk(child, depth + 1)
    if (typeof n.type === 'string' && BLOCK_TYPES.has(n.type)) flush()
  }
  walk(content, 0)
  flush()
  return lines.join('\n')
}

/** an Idempotency-Key the way the web mints one: [A-Za-z0-9_-]{8,128} */
export function newIntentKey(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined
  const random =
    c && typeof c.randomUUID === 'function'
      ? c.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  return `v${random}`.slice(0, 64)
}

/** the sentence of a refused write that shares the web's shelved / needs-edit wording, else null */
function writeRefusalKey(error: Failed['error']): StringKey | null {
  if (error === 'document_shelved') return 'vhsShelvedBlocked'
  if (error === 'forbidden') return 'vhsManageOnly'
  return null
}

/** the sentence of a failed checkpoint; what was typed stays in the field */
export function createErrorKey(failed: Failed): StringKey {
  if (failed.error === 'version_unchanged') return 'vhsNameUnchanged'
  return writeRefusalKey(failed.error) ?? 'vhsNameFailed'
}

export interface RestoreRefusal {
  key: StringKey
  /** the next try is a new intent: the rejected payload is not replayed (web: key cleared) */
  dropKey: boolean
}

/** the sentence of a failed restore, and whether its key is dropped */
export function restoreRefusal(failed: Failed): RestoreRefusal {
  if (failed.error === 'edit_locked') {
    return {
      key: failed.editLock?.heldByMe === true ? 'vhsLockedByMe' : 'vhsLockedByOther',
      dropKey: true,
    }
  }
  if (failed.error === 'conflict') return { key: 'vhsRestoreConflict', dropKey: true }
  return { key: writeRefusalKey(failed.error) ?? 'vhsRestoreFailed', dropKey: false }
}
