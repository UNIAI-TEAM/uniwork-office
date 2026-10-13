import type { UniworkDocSummary } from '../../shared/home-api'
import { UniworkDocError } from './errors'
import { formatForName, isDecimalString } from './formats'

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
    const title = str(row.title)
    documents.push({
      id: str(row.id, 128),
      workspaceId:
        typeof row.workspace_id === 'string' && row.workspace_id ? row.workspace_id : workspaceId,
      title,
      format: formatForName(title),
      updatedAt: str(row.updated_at, 64),
    })
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
      typeof version === 'number' && Number.isSafeInteger(version) && version >= 0
        ? version
        : null,
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
    const title = str(row.title)
    documents.push({
      id: str(row.id, 128),
      workspaceId:
        typeof row.workspace_id === 'string' && row.workspace_id ? row.workspace_id : workspaceId,
      title,
      format: formatForName(title),
      updatedAt: str(row.updated_at, 64),
    })
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

/**
 * GET /orgs/{slug}/members -> id + display name rows for the properties panel.
 * A row without a usable id or name is skipped rather than failing the panel.
 */
export function parseOrgMembers(raw: unknown): OrgMemberName[] {
  const body = record(raw)
  if (!Array.isArray(body.members)) bad()
  const out: OrgMemberName[] = []
  for (const value of body.members) {
    if (!isRecord(value)) continue
    const userId = value.user_id
    const displayName = value.display_name
    if (typeof userId !== 'string' || !userId || typeof displayName !== 'string') continue
    if (displayName.length === 0) continue
    out.push({ userId, displayName })
  }
  return out
}
