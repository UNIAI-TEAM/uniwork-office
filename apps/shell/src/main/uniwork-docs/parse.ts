import type {
  UniworkDocFormat,
  UniworkDocSummary,
  UniworkEntryKind,
  UniworkFolderNode,
  UniworkSourceFile,
  UniworkSourceListPage,
  UniworkSystemKind,
} from '../../shared/home-api'
import { UniworkDocError } from './errors'
import { formatForMime, formatForName, isDecimalString } from './formats'

/**
 * Strict readers for the server's snake_case DTOs (documents, uploads,
 * commit, launch exchange). A missing or mistyped field fails closed with
 * `malformed_response`; nothing is guessed.
 */

export interface DocumentDetail {
  id: string
  organizationId: string
  workspaceId: string
  title: string
  /** decimal string, never a JS number */
  revision: string
  currentVersion: number
  myLevel: string | null
  /** `archived_at`: present while the document sits in the trash */
  archivedAt: string | null
  /** G5-12: the folder or page holding the document; null = at the root, absent = not sent */
  parentId?: string | null
  file: {
    filename: string
    mimeType: string
    version: number
    /**
     * G8-12: the server version id of the current bytes (`file.version_id`),
     * the comments anchor base; absent when the server sent none
     */
    versionId?: string
    checksumSha256: string
    sizeBytes: number
  }
}

export interface DocumentListResult {
  documents: UniworkDocSummary[]
  nextCursor: string | null
}

/**
 * The properties panel of one document (S17). Names are never in
 * `GET /documents/{id}`: only ids ride here; the service resolves display
 * names separately and the renderer shows "—" for what stays unknown.
 */
export interface DocumentProperties {
  id: string
  workspaceId: string
  title: string
  ownerId: string | null
  /** D `owner_kind`; only a person owner resolves to a name */
  ownerKind: string | null
  createdById: string | null
  createdByKind: string | null
  createdAt: string | null
  updatedById: string | null
  updatedByKind: string | null
  updatedAt: string | null
  myLevel: string | null
  currentVersion: number | null
}

export interface UploadReceipt {
  uploadId: string
  checksumSha256: string
  sizeBytes: number
  claimExpiresAt: string
}

export interface CommitReceipt {
  documentId: string
  revision: string
  versionId: string
  version: number
  checksumSha256: string | null
}

export interface LaunchDescriptor {
  receiptId: string
  redeemedAt: string
  id: string
  organizationId: string
  workspaceId: string
  title: string
  operation: 'view' | 'edit'
  version: number
  revision: string
  downloadPath: string
  /**
   * G8-08: the comment a launch ticket named (contract §2.9), when the server
   * kept one. The shell sends `comments.reveal` for it once the editor is ready.
   */
  commentId?: string
}

const HEX64 = /^[0-9a-f]{64}$/

/**
 * S18 action flags off one effective level (view|edit|manage) and an
 * `archived_at`. Absent/unknown fields leave the flag false, so the renderer
 * offers no action it cannot prove the person has.
 */
export function actionFlags(
  myLevel: string | null,
  archivedAt: string | null,
): { canEdit: boolean; canManage: boolean; archived: boolean } {
  return {
    canEdit: myLevel === 'edit' || myLevel === 'manage',
    canManage: myLevel === 'manage',
    archived: typeof archivedAt === 'string' && archivedAt.length > 0,
  }
}

function summaryFlags(row: Record<string, unknown>): {
  canEdit: boolean
  canManage: boolean
  archived: boolean
} {
  return actionFlags(
    typeof row.my_level === 'string' ? row.my_level : null,
    typeof row.archived_at === 'string' ? row.archived_at : null,
  )
}

/**
 * The format of a document row: D's `file.mime_type` / `file.filename` first -
 * every kind=file document carries the block, and the title is the one name
 * that may not carry an extension (a blank document keeps the name the person
 * typed, while its first version's file is `untitled.docx`). The title's
 * extension is only the fallback for a row that omits `file` (`omitempty`).
 */
function formatOf(doc: Record<string, unknown>, title: string): UniworkDocFormat | null {
  const file = isRecord(doc.file) ? doc.file : null
  if (file) {
    if (typeof file.mime_type === 'string') {
      const byMime = formatForMime(file.mime_type)
      if (byMime) return byMime
    }
    if (typeof file.filename === 'string') {
      const byName = formatForName(file.filename)
      if (byName) return byName
    }
  }
  return formatForName(title)
}

/** FD-11: the three entry kinds; a row of any other kind is skipped, never guessed */
function kindOf(value: unknown): UniworkEntryKind | null {
  return value === 'folder' || value === 'file' || value === 'page' ? value : null
}

/**
 * MYFOLDER-01 / SAVE-01: `system_kind` is a loose enum and omitempty. Only the
 * known `my_folder` marker is kept; an unknown value the server adds later is
 * dropped (the row stays an ordinary entry, never a malformed one).
 */
function systemKindOf(value: unknown): UniworkSystemKind | undefined {
  return value === 'my_folder' ? 'my_folder' : undefined
}

/**
 * FD-11: `parent_id` as the renderer's `parentId`. Absent, `null` and `''` all
 * mean the workspace root; a malformed one fails closed.
 */
function parentIdOf(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 128) bad()
  return value
}

/**
 * FD-11: the ancestors a search row carries, root first (D cuts the list at
 * the first ancestor the caller cannot read). Absent on every other route.
 */
function pathOf(row: Record<string, unknown>): { id: string; title: string }[] | undefined {
  const path = row.path
  if (path === undefined || path === null) return undefined
  if (!Array.isArray(path)) bad()
  const ancestors: { id: string; title: string }[] = []
  for (const value of path) {
    const node = record(value)
    ancestors.push({ id: str(node.id, 128), title: str(node.title) })
  }
  return ancestors
}

/**
 * DESKTOP-HOME: `visibility` is a loose enum (`private` | `workspace` |
 * `restricted`); unknown or absent values are dropped at parse.
 */
function visibilityOf(value: unknown): UniworkDocSummary['visibility'] {
  return value === 'private' || value === 'workspace' || value === 'restricted' ? value : undefined
}

/**
 * DESKTOP-HOME: `my_level` on list rows (`view` | `comment` | `edit` |
 * `manage`); unknown or absent values are dropped at parse.
 */
function rowMyLevelOf(value: unknown): UniworkDocSummary['myLevel'] {
  return value === 'view' || value === 'comment' || value === 'edit' || value === 'manage'
    ? value
    : undefined
}

/** one list row as the renderer's summary (title is the only name the server sends) */
function summaryRow(
  row: Record<string, unknown>,
  workspaceId: string,
  kind: UniworkEntryKind,
): UniworkDocSummary {
  const title = str(row.title)
  const path = pathOf(row)
  const visibility = visibilityOf(row.visibility)
  const myLevel = rowMyLevelOf(row.my_level)
  const updatedById = optId(row.updated_by) ?? undefined
  return {
    id: str(row.id, 128),
    workspaceId:
      typeof row.workspace_id === 'string' && row.workspace_id ? row.workspace_id : workspaceId,
    title,
    // a folder has no document format, whatever its name ends in: only the
    // row's own file block (or a file/page title) decides that
    format: kind === 'folder' ? null : formatOf(row, title),
    updatedAt: str(row.updated_at, 64),
    ...(updatedById ? { updatedById } : {}),
    ...(visibility ? { visibility } : {}),
    ...(myLevel ? { myLevel } : {}),
    ...summaryFlags(row),
    kind,
    parentId: parentIdOf(row.parent_id),
    ...(path ? { path } : {}),
    ...(systemKindOf(row.system_kind) ? { systemKind: 'my_folder' as const } : {}),
    ...editLockOf(row.edit_lock),
    ...fileSizeOf(row, kind),
  }
}

/**
 * UNI-1961: the web's Size column reads a file row's `size_bytes`; a page or
 * folder, a zero, and a mistyped value show no size (never a guess).
 */
function fileSizeOf(
  row: Record<string, unknown>,
  kind: UniworkEntryKind,
): { sizeBytes: number } | Record<string, never> {
  const size = row.size_bytes
  return kind === 'file' && typeof size === 'number' && Number.isSafeInteger(size) && size > 0
    ? { sizeBytes: size }
    : {}
}

/** EL-1(b): optional list-row `edit_lock` summary. Malformed objects are dropped, not the row. */
function editLockOf(
  raw: unknown,
): { editLock: import('../../shared/home-api').UniworkDocEditLock } | Record<string, never> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const row = raw as Record<string, unknown>
  const holderName =
    typeof row.holder_name === 'string' && row.holder_name.trim() && row.holder_name.length <= 256
      ? row.holder_name
      : null
  const since = typeof row.since === 'string' && row.since.length <= 64 ? row.since : null
  const expiresAt =
    typeof row.expires_at === 'string' && row.expires_at.length <= 64 ? row.expires_at : null
  const offline =
    typeof row.offline_hold_until === 'string' && row.offline_hold_until.length <= 64
      ? row.offline_hold_until
      : undefined
  return {
    editLock: {
      holderName,
      since,
      expiresAt,
      heldByMe: row.held_by_me === true,
      ...(offline ? { offlineHoldUntil: offline } : {}),
    },
  }
}

function bad(): never {
  throw new UniworkDocError('malformed_response')
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad()
  return value as Record<string, unknown>
}

function str(value: unknown, max = 1024): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) bad()
  return value
}

function nonNegInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) bad()
  return value
}

function revision(value: unknown): string {
  if (!isDecimalString(value)) bad()
  return value
}

function checksum(value: unknown): string {
  if (typeof value !== 'string') bad()
  const hex = value.startsWith('sha256:') ? value.slice(7) : value
  if (!HEX64.test(hex)) bad()
  return hex
}

export type DocumentCommentsLevel = 'view' | 'comment' | 'edit' | 'manage'

/**
 * Maps a server `my_level` field to `commentsLevel` (G8-18 / DOC-05):
 * `'view'`, `'comment'`, `'edit'`, and `'manage'` pass through; `null`,
 * `undefined`, or `""` stay `null`; any unknown non-empty string downgrades to
 * `'view'` (read-only, never more). A non-string value is `malformed_response`.
 */
export function commentsLevelOf(myLevel: unknown): DocumentCommentsLevel | null {
  if (myLevel === undefined || myLevel === null || myLevel === '') return null
  if (typeof myLevel !== 'string') bad()
  if (myLevel === 'view' || myLevel === 'comment' || myLevel === 'edit' || myLevel === 'manage') {
    return myLevel
  }
  return 'view'
}

export function parseDetail(raw: unknown): DocumentDetail {
  const doc = record(record(raw).document)
  if (doc.kind !== 'file') throw new UniworkDocError('unsupported_format')
  const file = record(doc.file)
  const myLevel = commentsLevelOf(doc.my_level)
  // G8-12: optional - a missing or odd one only leaves the comments base unknown
  const versionId = file.version_id
  const knownVersionId =
    typeof versionId === 'string' && versionId.length > 0 && versionId.length <= 128
  return {
    id: str(doc.id, 128),
    organizationId: str(doc.organization_id, 128),
    workspaceId: str(doc.workspace_id, 128),
    title: str(doc.title),
    revision: revision(doc.revision),
    currentVersion: nonNegInt(doc.current_version),
    myLevel,
    archivedAt: typeof doc.archived_at === 'string' && doc.archived_at ? doc.archived_at : null,
    ...(typeof doc.parent_id === 'string' && doc.parent_id.length > 0 && doc.parent_id.length <= 128
      ? { parentId: doc.parent_id }
      : doc.parent_id === null
        ? { parentId: null }
        : {}),
    file: {
      filename: str(file.filename),
      mimeType: typeof file.mime_type === 'string' ? file.mime_type : '',
      version: nonNegInt(file.version),
      ...(knownVersionId ? { versionId } : {}),
      checksumSha256: checksum(file.checksum_sha256),
      sizeBytes: nonNegInt(file.size_bytes),
    },
  }
}

/**
 * FD-11: one document's own fields, whatever its kind (a folder has no `file`
 * block, so `parseDetail` cannot read it). The rename and move flows read this
 * to learn the revision, the title to compare a move's answer with, the kind
 * for the name cap, and the level to gate the action on.
 */
export interface DocumentRef {
  id: string
  workspaceId: string
  title: string
  /** decimal string, never a JS number */
  revision: string
  kind: UniworkEntryKind
  parentId: string | null
  myLevel: string | null
  archivedAt: string | null
  format: UniworkDocFormat | null
}

export function parseDocumentRef(raw: unknown): DocumentRef {
  const doc = record(record(raw).document)
  const kind = kindOf(doc.kind)
  if (!kind) bad()
  const title = str(doc.title)
  const myLevel = doc.my_level
  if (myLevel !== undefined && myLevel !== null && typeof myLevel !== 'string') bad()
  return {
    id: str(doc.id, 128),
    workspaceId: str(doc.workspace_id, 128),
    title,
    revision: revision(doc.revision),
    kind,
    parentId: parentIdOf(doc.parent_id),
    myLevel: typeof myLevel === 'string' ? myLevel : null,
    archivedAt: typeof doc.archived_at === 'string' && doc.archived_at ? doc.archived_at : null,
    format: kind === 'folder' ? null : formatOf(doc, title),
  }
}

export function parseDocumentList(raw: unknown, workspaceId: string): DocumentListResult {
  const body = record(raw)
  if (!Array.isArray(body.documents)) bad()
  const next = body.next_cursor
  if (next !== null && next !== undefined && typeof next !== 'string') bad()
  const documents: UniworkDocSummary[] = []
  for (const value of body.documents) {
    const row = record(value)
    // FD-11: the children route lists folders and pages too; a caller that
    // wants files only (the library list) filters on the carried `kind`
    const kind = kindOf(row.kind)
    if (!kind) continue
    documents.push(summaryRow(row, workspaceId, kind))
  }
  return { documents, nextCursor: typeof next === 'string' && next ? next : null }
}

/**
 * UNI-1961: `GET /workspaces/{ws}/documents/sources`, read the way the web reads
 * it (D sources-schema.ts): the id, source, parent and name are required; every
 * other field takes its default when absent or mistyped. A body that is not a
 * list fails closed - an empty list would read as "no files".
 */
export function parseSourceList(raw: unknown): UniworkSourceListPage {
  const body = record(raw)
  if (!Array.isArray(body.items)) bad()
  const next = body.next_cursor
  if (next !== null && next !== undefined && typeof next !== 'string') bad()
  const items = body.items.map(sourceFile)
  return { items, nextCursor: typeof next === 'string' && next ? next : null }
}

function sourceFile(value: unknown): UniworkSourceFile {
  const row = record(value)
  const parent = record(row.parent)
  const text = (field: unknown, max = 1024) =>
    typeof field === 'string' && field.length <= max ? field : ''
  const owner = isRecord(row.owner) ? row.owner : null
  return {
    id: str(row.id, 128),
    source: str(row.source, 64),
    parent: { kind: str(parent.kind, 64), id: str(parent.id, 128), title: text(parent.title) },
    name: str(row.name),
    mimeType: text(row.mime_type, 255),
    extension: text(row.extension, 32),
    sizeBytes:
      typeof row.size_bytes === 'number' &&
      Number.isSafeInteger(row.size_bytes) &&
      row.size_bytes >= 0
        ? row.size_bytes
        : 0,
    updatedAt: text(row.updated_at, 64),
    owner:
      owner && typeof owner.id === 'string' && owner.id && typeof owner.name === 'string'
        ? { id: owner.id, name: owner.name }
        : null,
    canOpenInApp: row.can_open_in_app === true,
    canSave: row.can_save === true,
  }
}

export function parseUpload(raw: unknown): UploadReceipt {
  const body = record(raw)
  return {
    uploadId: str(body.upload_id, 128),
    checksumSha256: checksum(body.checksum_sha256),
    sizeBytes: nonNegInt(body.size_bytes),
    claimExpiresAt: str(body.claim_expires_at, 64),
  }
}

/** BIGUP-A1: one presigned part PUT the client sends directly to the storage */
export interface UploadSessionPartUrl {
  partNumber: number
  /** the server's method for the URL; always PUT today */
  method: string
  url: string
  /** headers the PUT must carry (empty with plain S3) */
  headers: Record<string, string>
  expiresAt: string
}

/** BIGUP-A1: one part the storage already holds (the server's ListParts view) */
export interface UploadSessionCompletedPart {
  partNumber: number
  etag: string
  size: number
}

/** BIGUP-A1: what the session is doing right now */
export type UploadSessionStatus = 'open' | 'validating' | 'completed'

/**
 * BIGUP-A1: the create/GET answer of an upload session. `status` and `parts`
 * are optional on the wire (the create answer carries neither): `status` is
 * absent until the first GET, and `parts` is present only while the session is
 * `open` - once the server validates the assembled object there is nothing
 * left to PUT. `parts` and `completedParts` are always arrays here, so callers
 * never branch on an absent field.
 */
export interface UploadSessionState {
  sessionId: string
  status: UploadSessionStatus | null
  partSize: number
  totalParts: number
  completedParts: UploadSessionCompletedPart[]
  parts: UploadSessionPartUrl[]
  expiresAt: string
}

/** one `{part_number, url, headers, expires_at}` row of the session answer */
function partUrl(value: unknown): UploadSessionPartUrl {
  const row = record(value)
  const headers = record(row.headers ?? {})
  const out: Record<string, string> = {}
  for (const [name, header] of Object.entries(headers)) {
    if (typeof header === 'string') out[name] = header
  }
  return {
    partNumber: nonNegInt(row.part_number),
    method: typeof row.method === 'string' && row.method ? row.method : 'PUT',
    url: str(row.url, 4096),
    headers: out,
    expiresAt: str(row.expires_at, 64),
  }
}

function completedPart(value: unknown): UploadSessionCompletedPart {
  const row = record(value)
  return {
    partNumber: nonNegInt(row.part_number),
    etag: str(row.etag, 256),
    size: nonNegInt(row.size ?? 0),
  }
}

function sessionStatus(value: unknown): UploadSessionStatus | null {
  if (value === undefined || value === null || value === '') return null
  if (value === 'open' || value === 'validating' || value === 'completed') return value
  bad()
}

export function parseUploadSession(raw: unknown): UploadSessionState {
  const body = record(raw)
  const parts = body.parts
  if (parts !== undefined && parts !== null && !Array.isArray(parts)) bad()
  const completed = body.completed_parts
  if (completed !== undefined && completed !== null && !Array.isArray(completed)) bad()
  return {
    sessionId: str(body.session_id, 128),
    status: sessionStatus(body.status),
    partSize: nonNegInt(body.part_size),
    totalParts: nonNegInt(body.total_parts),
    completedParts: (completed ?? []).map(completedPart),
    parts: (parts ?? []).map(partUrl),
    expiresAt: str(body.expires_at, 64),
  }
}

/**
 * BIGUP-A1: the `complete` answer, by the route family that opened the
 * session. The workspace route answers the created document (the
 * `POST .../documents/files` shape); the document route answers the staged
 * upload the existing `versions/commit` claims. The two are told apart by the
 * body itself (`upload_id` vs `document`), so the caller cannot mis-read one
 * as the other.
 */
export type UploadSessionComplete =
  { kind: 'document'; document: UniworkDocSummary } | { kind: 'upload'; upload: UploadReceipt }

export function parseUploadSessionComplete(raw: unknown): UploadSessionComplete {
  const body = record(raw)
  if (body.upload_id !== undefined) return { kind: 'upload', upload: parseUpload(raw) }
  return { kind: 'document', document: parseDocumentSummary(raw) }
}

export function parseCommit(raw: unknown): CommitReceipt {
  const body = record(raw)
  const doc = record(body.document)
  const version = record(body.version)
  const sum = version.checksum_sha256
  return {
    documentId: str(doc.id, 128),
    revision: revision(doc.revision),
    versionId: str(version.id, 128),
    version: nonNegInt(version.version_no ?? version.version),
    checksumSha256: sum === undefined || sum === null ? null : checksum(sum),
  }
}

/** the receipt of a looked-up commit that already committed (G5-07) */
export interface CommitLookupReceipt {
  versionId: string
  version: number
  /** decimal string, never a JS number */
  revision: string
}

/** what became of a commit intent (G5-07); `unknown` never carries a receipt */
export type CommitLookup =
  | { outcome: 'committed'; receipt: CommitLookupReceipt }
  | { outcome: 'in_flight' }
  | { outcome: 'not_committed' }
  | { outcome: 'unknown' }

/**
 * The commit-intent lookup body (GET .../versions/commit). `committed` needs
 * the produced version id, version number and the document revision as a
 * decimal string (bigint-safe); `unknown` is only ever carried by the 410
 * envelope, never a 200 body, so on a 200 it is malformed. Anything else is
 * `malformed_response`.
 */
export function parseCommitLookup(raw: unknown): CommitLookup {
  const body = record(raw)
  const outcome = body.outcome
  if (outcome === 'committed') {
    return {
      outcome,
      receipt: {
        versionId: str(body.version_id, 128),
        version: nonNegInt(body.version),
        revision: revision(body.revision),
      },
    }
  }
  if (outcome === 'in_flight' || outcome === 'not_committed') return { outcome }
  bad()
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 64 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  )
}

/**
 * The launch exchange receipt. The download path must be exactly the
 * first-party route for this document (plus `?version=N` for a historical
 * version): a storage URL or any other path is refused.
 */
export function parseExchange(raw: unknown): LaunchDescriptor {
  const body = record(raw)
  const doc = record(body.document)
  if (doc.kind !== 'file') bad()
  if (doc.operation !== 'view' && doc.operation !== 'edit') bad()
  for (const key of ['contract_version', 'protocol_version']) {
    if (doc[key] !== undefined && typeof doc[key] !== 'string') bad()
  }
  if (!isTimestamp(body.redeemed_at)) bad()
  const descriptor: LaunchDescriptor = {
    receiptId: str(body.receipt_id, 128),
    redeemedAt: body.redeemed_at,
    id: str(doc.id, 128),
    organizationId: str(doc.organization_id, 128),
    workspaceId: str(doc.workspace_id, 128),
    title: str(doc.title, 512),
    operation: doc.operation,
    version: nonNegInt(doc.version),
    revision: revision(doc.revision),
    downloadPath: str(doc.download_path, 512),
  }
  // the ticket may name a comment (contract §2.9); a malformed one is ignored
  // (the server drops it silently), a well-formed one reaches the editor reveal
  const commentId = body.comment_id
  if (commentId !== undefined && commentId !== null) {
    if (typeof commentId === 'string' && commentId.length > 0 && commentId.length <= 128) {
      descriptor.commentId = commentId
    }
  }
  const current = `/api/v1/documents/${encodeURIComponent(descriptor.id)}/download`
  const expected = descriptor.version > 0 ? `${current}?version=${descriptor.version}` : current
  if (descriptor.downloadPath !== expected) bad()
  return descriptor
}

function optTimestamp(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !isTimestamp(value)) return null
  return value
}

function optId(value: unknown, max = 128): string | null {
  if (value === undefined || value === null || value === '') return null
  return typeof value === 'string' && value.length <= max ? value : null
}

/**
 * The properties of one document. Lenient where the field is optional on the
 * server: a missing id/time/version becomes null (the renderer prints "—"),
 * while a malformed core (id, workspace, title) still fails closed.
 */
export function parseProperties(raw: unknown): DocumentProperties {
  const doc = record(record(raw).document)
  const version = doc.current_version
  return {
    id: str(doc.id, 128),
    workspaceId: str(doc.workspace_id, 128),
    title: str(doc.title),
    ownerId: optId(doc.owner_id),
    ownerKind: optId(doc.owner_kind, 32),
    createdById: optId(doc.created_by),
    createdByKind: optId(doc.created_by_kind, 16),
    createdAt: optTimestamp(doc.created_at),
    updatedById: optId(doc.updated_by),
    updatedByKind: optId(doc.updated_by_kind, 16),
    updatedAt: optTimestamp(doc.updated_at),
    myLevel: optId(doc.my_level, 16),
    currentVersion:
      typeof version === 'number' && Number.isSafeInteger(version) && version >= 0 ? version : null,
  }
}

/**
 * GET /workspaces/{ws}/documents/shared-with-me (a list page like `documents`).
 * Files only unless `includePages` (UNI-1953: the Documents home lists a shared
 * UniNote too).
 */
export function parseSharedWithMe(
  raw: unknown,
  workspaceId: string,
  includePages = false,
): DocumentListResult {
  const body = record(raw)
  if (!Array.isArray(body.documents)) bad()
  const next = body.next_cursor
  if (next !== null && next !== undefined && typeof next !== 'string') bad()
  const documents: UniworkDocSummary[] = []
  for (const value of body.documents) {
    const row = record(value)
    // "shared with me" is the library: files (and pages when asked), a folder is never shared
    if (row.kind === 'page' && includePages) {
      documents.push(summaryRow(row, workspaceId, 'page'))
      continue
    }
    if (row.kind !== 'file') continue
    documents.push(summaryRow(row, workspaceId, 'file'))
  }
  return { documents, nextCursor: typeof next === 'string' && next ? next : null }
}

/**
 * GET /workspaces/{ws}/me -> the caller's effective role. `role` is the only
 * field the S17 row needs; a malformed body fails closed, but a body that
 * simply omits the role (an older server) yields null rather than an error.
 */
export function parseMembershipRole(raw: unknown): string | null {
  const membership = record(raw).membership
  if (!isRecord(membership)) return null
  const role = membership.role
  return typeof role === 'string' && role.length > 0 ? role : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export interface OrgMemberName {
  userId: string
  displayName: string
}

/** one page of GET /orgs/{slug}/members: rows plus D's opaque next cursor */
export interface OrgMemberPage {
  members: OrgMemberName[]
  /** `next_cursor`; null on the last page */
  nextCursor: string | null
}

/**
 * GET /orgs/{slug}/members -> one page of id + display name rows for the
 * properties panel, with the opaque cursor of the next page (null at the end).
 * A row without a usable id or name is skipped rather than failing the panel.
 */
export function parseOrgMembers(raw: unknown): OrgMemberPage {
  const body = record(raw)
  if (!Array.isArray(body.members)) bad()
  const next = body.next_cursor
  if (next !== null && next !== undefined && typeof next !== 'string') bad()
  const members: OrgMemberName[] = []
  for (const value of body.members) {
    if (!isRecord(value)) continue
    const userId = value.user_id
    const displayName = value.display_name
    if (typeof userId !== 'string' || !userId || typeof displayName !== 'string') continue
    if (displayName.length === 0) continue
    members.push({ userId, displayName })
  }
  return { members, nextCursor: typeof next === 'string' && next ? next : null }
}

/**
 * `POST .../documents/files[/blank]`, `PATCH /documents/{id}` and the FD-11
 * folder/move routes answer with a full `DocumentSDO`. The library row only
 * needs the summary fields plus the S18 action flags, so this reads exactly
 * that and fails closed on a malformed core (id, title, revision, workspace).
 * FD-11 adds the entry's kind and where it sits, when the answer carries them.
 */
export function parseDocumentSummary(raw: unknown): UniworkDocSummary {
  const doc = record(record(raw).document)
  const title = str(doc.title)
  const workspaceId = str(doc.workspace_id, 128)
  const kind = kindOf(doc.kind)
  return {
    id: str(doc.id, 128),
    workspaceId,
    title,
    // a folder has no document format, whatever its name ends in
    format: kind === 'folder' ? null : formatOf(doc, title),
    updatedAt: typeof doc.updated_at === 'string' ? doc.updated_at.slice(0, 64) : '',
    ...actionFlags(
      typeof doc.my_level === 'string' ? doc.my_level : null,
      typeof doc.archived_at === 'string' ? doc.archived_at : null,
    ),
    ...(kind ? { kind } : {}),
    ...(doc.parent_id === undefined ? {} : { parentId: parentIdOf(doc.parent_id) }),
    ...(systemKindOf(doc.system_kind) ? { systemKind: 'my_folder' as const } : {}),
  }
}

/**
 * `GET /workspaces/{ws}/documents/tree?folders_only=true` -> the folder tree,
 * root nodes first. Every node is a folder (the route asks for folders only),
 * `children` is always present (empty at a leaf), and a node past the server's
 * own depth cap (20) fails closed rather than recursing for ever.
 */
const MAX_TREE_DEPTH = 20

function folderNode(value: unknown, depth: number): UniworkFolderNode {
  if (depth > MAX_TREE_DEPTH) bad()
  const node = record(value)
  if (node.kind !== 'folder') bad()
  const children = node.children
  if (!Array.isArray(children)) bad()
  const position = node.position
  if (typeof position !== 'number' || !Number.isFinite(position)) bad()
  return {
    id: str(node.id, 128),
    parentId: parentIdOf(node.parent_id),
    title: str(node.title),
    position,
    children: children.map((child) => folderNode(child, depth + 1)),
    ...(systemKindOf(node.system_kind) ? { systemKind: 'my_folder' as const } : {}),
  }
}

export function parseFolderTree(raw: unknown): UniworkFolderNode[] {
  const body = record(raw)
  if (!Array.isArray(body.documents)) bad()
  return body.documents.map((value) => folderNode(value, 1))
}

/**
 * The revision a full `DocumentSDO` answer carries (create/rename): the value
 * the rename produced, which keys the feed-echo suppression (R1-6).
 */
export function documentRevisionOf(raw: unknown): string {
  return revision(record(record(raw).document).revision)
}

/** the new title a rename answered with, or null when the server sent none */
export function parseRenamedTitle(raw: unknown): string | null {
  const doc = record(record(raw).document)
  const title = doc.title
  return typeof title === 'string' && title.length > 0 && title.length <= 512 ? title : null
}
