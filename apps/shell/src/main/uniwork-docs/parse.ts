import type {
  UniworkDocFolderRef,
  UniworkDocFormat,
  UniworkDocSummary,
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
  file: {
    filename: string
    mimeType: string
    version: number
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

/** one list row as the renderer's summary (title is the only name the server sends) */
function summaryRow(row: Record<string, unknown>, workspaceId: string): UniworkDocSummary {
  const title = str(row.title)
  return {
    id: str(row.id, 128),
    workspaceId:
      typeof row.workspace_id === 'string' && row.workspace_id ? row.workspace_id : workspaceId,
    title,
    format: formatOf(row, title),
    updatedAt: str(row.updated_at, 64),
    ...summaryFlags(row),
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

export function parseDetail(raw: unknown): DocumentDetail {
  const doc = record(record(raw).document)
  if (doc.kind !== 'file') throw new UniworkDocError('unsupported_format')
  const file = record(doc.file)
  const myLevel = doc.my_level
  if (myLevel !== undefined && myLevel !== null && typeof myLevel !== 'string') bad()
  return {
    id: str(doc.id, 128),
    organizationId: str(doc.organization_id, 128),
    workspaceId: str(doc.workspace_id, 128),
    title: str(doc.title),
    revision: revision(doc.revision),
    currentVersion: nonNegInt(doc.current_version),
    myLevel: typeof myLevel === 'string' ? myLevel : null,
    archivedAt: typeof doc.archived_at === 'string' && doc.archived_at ? doc.archived_at : null,
    file: {
      filename: str(file.filename),
      mimeType: typeof file.mime_type === 'string' ? file.mime_type : '',
      version: nonNegInt(file.version),
      checksumSha256: checksum(file.checksum_sha256),
      sizeBytes: nonNegInt(file.size_bytes),
    },
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
    if (row.kind !== 'file') continue
    documents.push(summaryRow(row, workspaceId))
  }
  return { documents, nextCursor: typeof next === 'string' && next ? next : null }
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

/** GET /workspaces/{ws}/documents/shared-with-me (a list page like `documents`) */
export function parseSharedWithMe(raw: unknown, workspaceId: string): DocumentListResult {
  const body = record(raw)
  if (!Array.isArray(body.documents)) bad()
  const next = body.next_cursor
  if (next !== null && next !== undefined && typeof next !== 'string') bad()
  const documents: UniworkDocSummary[] = []
  for (const value of body.documents) {
    const row = record(value)
    if (row.kind !== 'file') continue
    documents.push(summaryRow(row, workspaceId))
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
 * `POST .../documents/files[/blank]` and `PATCH /documents/{id}` answer with a
 * full `DocumentSDO`. The library row only needs the summary fields plus the
 * S18 action flags, so this reads exactly that and fails closed on a malformed
 * core (id, title, revision, workspace).
 */
export function parseDocumentSummary(raw: unknown): UniworkDocSummary {
  const doc = record(record(raw).document)
  const title = str(doc.title)
  const workspaceId = str(doc.workspace_id, 128)
  return {
    id: str(doc.id, 128),
    workspaceId,
    title,
    format: formatOf(doc, title),
    updatedAt: typeof doc.updated_at === 'string' ? doc.updated_at.slice(0, 64) : '',
    ...actionFlags(
      typeof doc.my_level === 'string' ? doc.my_level : null,
      typeof doc.archived_at === 'string' ? doc.archived_at : null,
    ),
  }
}

/**
 * `GET /workspaces/{ws}/documents?kind=folder` -> one page of folder choices
 * for the "Location" field, plus D's opaque `next_cursor` (null at the end). A
 * row without a usable id or title is skipped rather than failing the dialog.
 */
export function parseFolders(raw: unknown): {
  folders: UniworkDocFolderRef[]
  nextCursor: string | null
} {
  const body = record(raw)
  if (!Array.isArray(body.documents)) bad()
  const next = body.next_cursor
  if (next !== null && next !== undefined && typeof next !== 'string') bad()
  const folders: UniworkDocFolderRef[] = []
  for (const value of body.documents) {
    if (!isRecord(value)) continue
    if (value.kind !== 'folder') continue
    const id = value.id
    const title = value.title
    if (typeof id !== 'string' || !id || typeof title !== 'string' || !title) continue
    folders.push({ id, title })
  }
  return { folders, nextCursor: typeof next === 'string' && next ? next : null }
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
