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
  const current = `/api/v1/documents/${encodeURIComponent(descriptor.id)}/download`
  const expected = descriptor.version > 0 ? `${current}?version=${descriptor.version}` : current
  if (descriptor.downloadPath !== expected) bad()
  return descriptor
}
