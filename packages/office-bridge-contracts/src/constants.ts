/** Opaque launch token TTL for exchange. Short on purpose. */
export const LAUNCH_TOKEN_TTL_MS = 3 * 60 * 1000

/** Scoped Office session credential TTL after successful exchange. */
export const OFFICE_SESSION_CREDENTIAL_TTL_MS = 8 * 60 * 60 * 1000

export const OFFICE_LAUNCH_SCHEME = 'uniwork'
export const OFFICE_LAUNCH_PATH = '/office/open'
/** Open a blank / new editor tab in UniWork Office (no file path in the URL). */
export const OFFICE_APP_PATH = '/office/app'
export const OFFICE_APP_KINDS = [
  'docs',
  'sheets',
  'slides',
  'pdf',
  'markdown',
  'html',
] as const
export type OfficeAppKind = (typeof OFFICE_APP_KINDS)[number]

/** Obsolete extract scheme. Live session operations use Bearer <sessionToken>. */
export const OFFICE_AUTH_SCHEME = 'Office'

export const LIVE_OFFICE_PATHS = {
  download: '/api/office/download',
  savePrepare: '/api/office/save/prepare',
  saveComplete: '/api/office/save/complete',
} as const

export const SUPPORTED_OFFICE_EXTENSIONS = ['docx', 'xlsx', 'pptx', 'pdf'] as const
export type SupportedOfficeExtension = (typeof SUPPORTED_OFFICE_EXTENSIONS)[number]

export const OFFICE_MIME_BY_EXT: Record<SupportedOfficeExtension, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
}

export const OFFICE_SESSION_STATUSES = [
  'CREATED',
  'EXCHANGED',
  'OPEN',
  'SAVING',
  'SAVED',
  'CLOSED',
  'EXPIRED',
  'REVOKED',
  'FAILED',
] as const
export type OfficeSessionStatus = (typeof OFFICE_SESSION_STATUSES)[number]

export const OFFICE_PERMISSIONS = ['READ', 'SAVE_NEW_VERSION'] as const
export type OfficePermission = (typeof OFFICE_PERMISSIONS)[number]

export const OFFICE_ERROR_CODES = [
  'INVALID_REQUEST',
  'BAD_REQUEST',
  'UNAUTHENTICATED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'UNSUPPORTED_FORMAT',
  'EXPIRED',
  'TOKEN_EXPIRED',
  'TOKEN_REPLAY',
  'TOKEN_CONSUMED',
  'SESSION_REVOKED',
  'VERSION_CONFLICT',
  'SAVE_DENIED',
  'CHECKSUM_MISMATCH',
  'UPLOAD_INCOMPLETE',
  'UPLOAD_NOT_FOUND',
  'INTERNAL',
] as const
export type OfficeErrorCode = (typeof OFFICE_ERROR_CODES)[number]

export const OFFICE_AUDIT_EVENTS = [
  'OFFICE_SESSION_CREATED',
  'OFFICE_DOCUMENT_OPENED',
  'OFFICE_SAVE_STARTED',
  'WORK_PRODUCT_VERSION_CREATED',
  'OFFICE_SAVE_COMPLETED',
  'OFFICE_SESSION_CLOSED',
  'OFFICE_SESSION_FAILED',
] as const
export type OfficeAuditEvent = (typeof OFFICE_AUDIT_EVENTS)[number]

export const OFFICE_OUTBOX_EVENTS = ['WORK_PRODUCT_VERSION_CREATED'] as const
export type OfficeOutboxEvent = (typeof OFFICE_OUTBOX_EVENTS)[number]
