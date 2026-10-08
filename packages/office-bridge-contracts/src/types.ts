import type {
  OfficeErrorCode,
  OfficePermission,
  OfficeSessionStatus,
  SupportedOfficeExtension,
} from './constants'

export interface OfficeSessionCreateRequest {
  documentId: string
}

export interface OfficeSessionCreateResponse {
  sessionId: string
  launchUrl: string
  expiresAt: string
  baseVersion?: number
  fileName?: string
  format?: string
}

export interface OfficeLaunchExchangeRequest {
  token: string
}

export interface OfficeSessionDocument {
  id: string
  title: string
  fileName: string
  mimeType: string
  baseVersion: number
}

export interface OfficeSessionEndpoints {
  download: string
  savePrepare: string
  saveComplete: string
}

/** Desktop-normalized view of the live document + session payload. */
export interface OfficeFileDescriptor {
  sessionId: string
  workProductId: string
  workProductTitle: string
  versionId: string
  versionNumber: number
  fileName: string
  mimeType: string
  extension: SupportedOfficeExtension
  size: number
  checksumSha256: string
  readOnly: boolean
  canDownload: boolean
  canSaveNewVersion: boolean
}

export interface OfficeLaunchExchangeResponse {
  sessionId: string
  sessionToken: string
  expiresAt: string
  document: OfficeSessionDocument
  endpoints: OfficeSessionEndpoints
  descriptor: OfficeFileDescriptor
}

export interface OfficeSavePrepareRequest {
  idempotencyKey: string
  baseVersion: number
  sessionId: string
}

export interface OfficeSaveUploadDescriptor {
  url: string
  token: string
  method: 'PUT' | string
}

export interface OfficeSavePrepareResponse {
  saveOperationId: string
  baseVersion: number
  nextVersion: number
  upload: OfficeSaveUploadDescriptor
}

export interface OfficeSaveCompleteRequest {
  sessionId: string
  saveOperationId: string
  idempotencyKey: string
}

export interface OfficeSaveCompleteResponse {
  documentId: string
  versionId: string
  version: number
  versionNumber: number
  createdAt: string
  idempotentReplay?: boolean
}

export interface OfficeVersionConflict {
  code: 'VERSION_CONFLICT'
  currentVersionId: string
  currentVersionNumber: number
  baseVersionId: string
}

export interface OfficeErrorBody {
  ok?: false
  error: OfficeErrorCode | { code: OfficeErrorCode; message: string }
  baseVersion?: number
  latestVersion?: number
}

export interface OfficeSessionView {
  id: string
  status: OfficeSessionStatus
  expiresAt: string
}

export type { OfficePermission }
