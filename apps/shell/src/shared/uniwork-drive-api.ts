import type { UniworkDocErrorCode } from './home-api'

/**
 * Google Drive Connector (UNI-2194, D1): IPC contract between main, preload,
 * and renderer for Google Drive references in the Office desktop app.
 *
 * The wire speaks snake_case; the renderer speaks camelCase here. Handlers live
 * in `main/uniwork-drive`; the preload exposes `window.uniworkDrive` and also
 * wires the `uniworkDrive*` methods on `window.aiOffice` (`HomeApi`).
 * No Google token ever reaches the desktop app.
 */

export type UniworkDriveErrorCode =
  | 'network'
  | 'not_signed_in'
  | 'session_expired'
  | 'not_found'
  | 'forbidden'
  | 'feature_disabled'
  | 'auth_failed'
  | 'server_error'

export const UNIWORK_DRIVE_ERROR_CODES: readonly UniworkDriveErrorCode[] = [
  'network',
  'not_signed_in',
  'session_expired',
  'not_found',
  'forbidden',
  'feature_disabled',
  'auth_failed',
  'server_error',
]

export type UniworkDriveResult<T> =
  { ok: true; value: T } | { ok: false; error: UniworkDriveErrorCode }

/**
 * Maps `UniworkDocError` (`code` + optional `serverCode`) onto a
 * `UniworkDriveErrorCode`. Server error codes `feature_disabled` and
 * `auth_failed` take precedence over generic HTTP status codes.
 */
export function driveErrorOfDocError(
  code: UniworkDocErrorCode,
  serverCode?: string,
): UniworkDriveErrorCode {
  if (serverCode === 'feature_disabled') return 'feature_disabled'
  if (serverCode === 'auth_failed') return 'auth_failed'
  switch (code) {
    case 'network':
    case 'timeout':
      return 'network'
    case 'not_signed_in':
      return 'not_signed_in'
    case 'session_expired':
    case 'wrong_deployment':
      return 'session_expired'
    case 'not_found':
    case 'deleted':
    case 'document_deleted':
      return 'not_found'
    case 'forbidden':
    case 'permission_revoked':
    case 'member_deactivated':
    case 'organization_suspended':
    case 'document_archived':
      return 'forbidden'
    case 'capability_off':
      return 'feature_disabled'
    default:
      return 'server_error'
  }
}

export type DriveConnectionStatus = 'active' | 'needs_reconnect' | (string & {})

export type DriveIconKind =
  | 'google_doc'
  | 'google_sheet'
  | 'google_slide'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'text'
  | 'markdown'
  | 'generic'
  | (string & {})

export type DriveSharingState = 'private' | 'shared' | 'unknown' | (string & {})

export type DriveViewerAccess = 'granted' | 'lost' | 'unknown' | 'connection_lost' | (string & {})

/** One connected Google Drive account (`GET /workspaces/{ws}/drive-connections`). */
export interface DriveConnection {
  id: string
  provider: string
  googleEmail: string
  status: DriveConnectionStatus
  needsReconnect: boolean
  authFailedAt?: string
  authFailedReason?: string
  linkedFileCount: number
  connectedAt: string
  updatedAt: string
}

/** Compact task reference in `usedInTasks` and `taskCreations[].tasks`. */
export interface DriveLinkedTaskRef {
  taskId: string
  identifier: string
  title: string
  status: string
}

/** Summary of tasks created from a Drive document via UNI proposals (§8.8). */
export interface DriveTasksCreatedSummary {
  count: number
  lastCreatedAt?: string
  lastCreatedByName?: string
}

/** One proposal conversion batch in `taskCreations` (§8.8). */
export interface DriveTaskCreationGroup {
  proposalId: string
  createdAt: string
  createdById: string
  createdByName: string
  tasks: DriveLinkedTaskRef[]
}

/**
 * A Google Drive file reference in the workspace (`DriveFileDTO` on list 4.1
 * and detail 4.2). `taskCreations` is populated on the detail response.
 */
/**
 * The Drive folder a file sits in (`drive_folder` on the server DTO). `name` is null when the
 * folder exists but its name is not readable (or not fetched yet).
 */
export interface DriveFolderRef {
  id: string
  name: string | null
}

export interface DriveFile {
  id: string
  organizationId: string
  workspaceId: string
  externalFileId: string
  driveId?: string
  name: string
  mimeType: string
  iconKind: DriveIconKind
  webViewLink: string
  openUrl: string
  ownerDisplay: string
  driveModifiedAt?: string
  driveModifiedByDisplay?: string
  sharingState: DriveSharingState
  sharedUserCount?: number
  connectionId: string
  boundAccountEmail: string
  boundConnectionLost: boolean
  accessLostAt?: string
  boundById: string
  boundByName: string
  createdBy: string
  createdByKind: string
  createdByName: string
  createdAt: string
  updatedAt: string
  metadataRefreshedAt?: string
  viewerAccess: DriveViewerAccess
  viewerConnectionId?: string
  viewerAccountEmail?: string
  canUnlink: boolean
  canRebind: boolean
  canPropose: boolean
  canAsk: boolean
  usedInCount: number
  usedInTasks: DriveLinkedTaskRef[]
  tasksCreated: DriveTasksCreatedSummary
  taskCreations?: DriveTaskCreationGroup[]
  /** the parent folder; null or absent = unknown (old server, not refreshed yet, not visible) */
  driveFolder?: DriveFolderRef | null
}

export type DriveFileDetail = DriveFile

export interface DriveFileListQuery {
  workspaceId: string
  connectionId?: string
  cursor?: string
  limit?: number
}

export interface DriveFileListPage {
  files: DriveFile[]
  totalCount: number
  nextCursor: string | null
}

/**
 * One audit event on a Drive file (`GET /workspaces/{ws}/resources/drive_file/{id}/history`).
 */
export interface DriveHistoryEvent {
  id: string
  organizationId: string
  workspaceId?: string
  actorKind: string
  actorId: string
  /** display name of a workspace member actor; absent for an unknown, former or non-person actor */
  actorName?: string
  action: string
  resourceType: string
  resourceID: string
  resourceId: string
  changes: Record<string, unknown>
  metadata: Record<string, unknown>
  correlationId: string
  occurredAt: string
}

export interface DriveFileTarget {
  workspaceId: string
  driveFileId: string
}

export const UNIWORK_DRIVE_CHANNELS = {
  isAvailable: 'uniwork-drive:is-available',
  listConnections: 'uniwork-drive:list-connections',
  listFiles: 'uniwork-drive:list-files',
  getFile: 'uniwork-drive:get-file',
  unlink: 'uniwork-drive:unlink',
  openOnGoogle: 'uniwork-drive:open-on-google',
  getHistory: 'uniwork-drive:get-history',
} as const

export interface UniworkDriveApi {
  /** Org capability `drive_connector` for the active organization; false when offline or never read. */
  isAvailable(): Promise<boolean>
  /** `GET /workspaces/{ws}/drive-connections` */
  listConnections(workspaceId: string): Promise<UniworkDriveResult<DriveConnection[]>>
  /** `GET /workspaces/{ws}/drive-files?connection_id=&cursor=&limit=` */
  listFiles(query: DriveFileListQuery): Promise<UniworkDriveResult<DriveFileListPage>>
  /** `GET /workspaces/{ws}/drive-files/{id}` */
  getFile(input: DriveFileTarget): Promise<UniworkDriveResult<DriveFileDetail>>
  /** `DELETE /workspaces/{ws}/drive-files/{id}` */
  unlink(input: DriveFileTarget): Promise<UniworkDriveResult<null>>
  /**
   * Fetches `open_url` of `driveFileId` in `workspaceId` on main, verifies `https:`
   * with host `docs.google.com` or `drive.google.com` (no userinfo, no port),
   * and opens it in the system browser. The renderer never passes a URL.
   */
  openOnGoogle(input: DriveFileTarget): Promise<UniworkDriveResult<null>>
  /** `GET /workspaces/{ws}/resources/drive_file/{id}/history` */
  getHistory(input: DriveFileTarget): Promise<UniworkDriveResult<DriveHistoryEvent[]>>
}

declare global {
  interface Window {
    uniworkDrive: UniworkDriveApi
  }
}
