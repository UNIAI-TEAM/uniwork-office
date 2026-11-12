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
  // a key is only valid for the lock id it was minted under (web: version-history-sheet)
  if (failed.error === 'edit_lock_lost') return { key: 'vhsRestoreFailed', dropKey: true }
  // UNI-2502: a released version is answered with its own sentence and is never the stale-base
  // conflict above; the key stays (web: documentErrorMessage on the coded error)
  if (failed.error === 'version_coalesced') return { key: 'vhsErrVersionCoalesced', dropKey: false }
  if (failed.error === 'file_chunk_missing')
    return { key: 'vhsErrFileChunkMissing', dropKey: false }
  return { key: writeRefusalKey(failed.error) ?? 'vhsRestoreFailed', dropKey: false }
}

/**
 * True when a version gave its file back after its editing session settled (UNI-2502): nothing can
 * open, download, preview or restore it. A server that predates the fields never sends them, so a
 * plain row is never released (web: isReleasedVersion).
 */
export function isReleasedVersion(
  version: Pick<DocVersion, 'coalesced_into' | 'restorable'> | null | undefined,
): boolean {
  return !!version && (version.coalesced_into != null || version.restorable === false)
}

/**
 * One line of the history list. A `version` row is a version of the list; `coalesced` are the
 * versions of its editing session that gave their file back and show only as a count under it.
 * An `orphan` is such a group whose last version is not in the loaded pages (web: VersionHistoryRow).
 */
export type VersionHistoryRow =
  | { kind: 'version'; version: DocVersion; coalesced: DocVersion[] }
  | { kind: 'orphan'; into: number; coalesced: DocVersion[] }

/**
 * Folds the versions that point at a session's last version (`coalesced_into`) under that version.
 * The order of the rest is kept; a version with no pointer is never folded, even when the server
 * says it is not restorable (web: groupVersionRows).
 */
export function groupVersionRows(versions: readonly DocVersion[]): VersionHistoryRow[] {
  const folded = new Map<number, DocVersion[]>()
  const kept = new Set<number>()
  for (const version of versions) {
    if (version.coalesced_into == null) {
      kept.add(version.version)
      continue
    }
    const group = folded.get(version.coalesced_into)
    if (group) group.push(version)
    else folded.set(version.coalesced_into, [version])
  }
  const rows: VersionHistoryRow[] = []
  const orphaned = new Set<number>()
  for (const version of versions) {
    if (version.coalesced_into == null) {
      rows.push({ kind: 'version', version, coalesced: folded.get(version.version) ?? [] })
      continue
    }
    // the group of a last version that is not loaded surfaces where its first member sits
    const into = version.coalesced_into
    if (!kept.has(into) && !orphaned.has(into)) {
      orphaned.add(into)
      rows.push({ kind: 'orphan', into, coalesced: folded.get(into) ?? [] })
    }
  }
  return rows
}

/** the sentence under a failed download: a released version and a missing storage block have their own */
export function downloadErrorKey(failed: Failed): StringKey {
  if (failed.error === 'version_coalesced') return 'vhsErrVersionCoalesced'
  if (failed.error === 'file_chunk_missing') return 'vhsErrFileChunkMissing'
  return 'vhsDownloadFailed'
}

/** the sentence under a failed open (file version) or preview (page version) of a row */
export function openErrorKey(failed: Failed): StringKey {
  if (failed.error === 'unsupported_format') return 'vhsOpenUnsupported'
  if (failed.error === 'version_coalesced') return 'vhsErrVersionCoalesced'
  return 'vhsPreviewError'
}
