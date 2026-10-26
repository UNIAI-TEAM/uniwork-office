import type {
  DriveConnection,
  DriveFile,
  DriveFileListPage,
  DriveHistoryEvent,
  DriveLinkedTaskRef,
  DriveTaskCreationGroup,
  DriveTasksCreatedSummary,
} from '../../shared/uniwork-drive-api'
import { UniworkDocError } from '../uniwork-docs/errors'

/**
 * Readers for the UniWork Google Drive routes (UNI-2194, D1): converts the
 * server's snake_case DTOs into the camelCase shapes the renderer reads.
 *
 * Parse policy:
 * - Never throws an uncaught error on malformed JSON: top-level envelope or
 *   required row field failures throw `UniworkDocError('malformed_response')`,
 *   which `wiring.ts` converts into `{ ok: false, error: 'server_error' }`.
 * - Optional fields (`omitempty` on the server, or `null` if drifted) read as
 *   `undefined` (except `next_cursor: string | null`, which stays `null` on the
 *   last page).
 * - Unknown enum strings (`status`, `icon_kind`, `sharing_state`,
 *   `viewer_access`, `actor_kind`, `created_by_kind`) are preserved as strings
 *   so a newer server enum value never breaks the client.
 * - Nested informational entries (`used_in_tasks`, `task_creations`) drop
 *   unreadable sub-entries rather than failing the whole file record.
 */

function bad(): never {
  throw new UniworkDocError('malformed_response')
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad()
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  if (typeof value !== 'string') bad()
  return value
}

function id(value: unknown): string {
  const v = text(value)
  if (!v) bad()
  return v
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') bad()
  return value
}

function nonNegInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) bad()
  return value
}

/** absent and null both read as undefined */
function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') bad()
  return value
}

function optionalNonNegInt(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  return nonNegInt(value)
}

function plainMap(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) return {}
  return { ...(value as Record<string, unknown>) }
}

export function parseDriveConnection(value: unknown): DriveConnection {
  const r = record(value)
  const authFailedAt = optionalText(r.auth_failed_at)
  const authFailedReason = optionalText(r.auth_failed_reason)
  return {
    id: id(r.id),
    provider: text(r.provider),
    googleEmail: text(r.google_email),
    status: text(r.status),
    needsReconnect: bool(r.needs_reconnect),
    ...(authFailedAt !== undefined ? { authFailedAt } : {}),
    ...(authFailedReason !== undefined ? { authFailedReason } : {}),
    linkedFileCount: nonNegInt(r.linked_file_count),
    connectedAt: text(r.connected_at),
    updatedAt: text(r.updated_at),
  }
}

/** `{ connections: DriveConnectionDTO[] }` */
export function parseDriveConnectionList(raw: unknown): DriveConnection[] {
  const list = record(raw).connections
  if (!Array.isArray(list)) bad()
  return list.map(parseDriveConnection)
}

function parseLinkedTaskRef(value: unknown): DriveLinkedTaskRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const r = value as Record<string, unknown>
  if (
    typeof r.task_id !== 'string' ||
    !r.task_id ||
    typeof r.identifier !== 'string' ||
    typeof r.title !== 'string' ||
    typeof r.status !== 'string'
  ) {
    return null
  }
  return {
    taskId: r.task_id,
    identifier: r.identifier,
    title: r.title,
    status: r.status,
  }
}

function parseLinkedTaskRefList(value: unknown): DriveLinkedTaskRef[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) bad()
  const out: DriveLinkedTaskRef[] = []
  for (const item of value) {
    const parsed = parseLinkedTaskRef(item)
    if (parsed) out.push(parsed)
  }
  return out
}

function parseTasksCreatedSummary(value: unknown): DriveTasksCreatedSummary {
  if (value === undefined || value === null) return { count: 0 }
  const r = record(value)
  const count = nonNegInt(r.count)
  const lastCreatedAt = optionalText(r.last_created_at)
  const lastCreatedByName = optionalText(r.last_created_by_name)
  return {
    count,
    ...(lastCreatedAt !== undefined ? { lastCreatedAt } : {}),
    ...(lastCreatedByName !== undefined ? { lastCreatedByName } : {}),
  }
}

function parseTaskCreationGroup(value: unknown): DriveTaskCreationGroup | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const r = value as Record<string, unknown>
  if (
    typeof r.proposal_id !== 'string' ||
    !r.proposal_id ||
    typeof r.created_at !== 'string' ||
    typeof r.created_by_id !== 'string' ||
    !r.created_by_id ||
    typeof r.created_by_name !== 'string'
  ) {
    return null
  }
  const tasks = Array.isArray(r.tasks)
    ? r.tasks.map(parseLinkedTaskRef).filter((t): t is DriveLinkedTaskRef => t !== null)
    : []
  return {
    proposalId: r.proposal_id,
    createdAt: r.created_at,
    createdById: r.created_by_id,
    createdByName: r.created_by_name,
    tasks,
  }
}

function parseTaskCreationGroups(value: unknown): DriveTaskCreationGroup[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) bad()
  const out: DriveTaskCreationGroup[] = []
  for (const item of value) {
    const parsed = parseTaskCreationGroup(item)
    if (parsed) out.push(parsed)
  }
  return out
}

export function parseDriveFile(value: unknown): DriveFile {
  const r = record(value)
  const driveId = optionalText(r.drive_id)
  const driveModifiedAt = optionalText(r.drive_modified_at)
  const driveModifiedByDisplay = optionalText(r.drive_modified_by_display)
  const sharedUserCount = optionalNonNegInt(r.shared_user_count)
  const accessLostAt = optionalText(r.access_lost_at)
  const metadataRefreshedAt = optionalText(r.metadata_refreshed_at)
  const viewerConnectionId = optionalText(r.viewer_connection_id)
  const viewerAccountEmail = optionalText(r.viewer_account_email)
  const taskCreations = parseTaskCreationGroups(r.task_creations)

  return {
    id: id(r.id),
    organizationId: optionalText(r.organization_id) ?? '',
    workspaceId: id(r.workspace_id),
    externalFileId: id(r.external_file_id),
    ...(driveId !== undefined ? { driveId } : {}),
    name: text(r.name),
    mimeType: text(r.mime_type),
    iconKind: text(r.icon_kind),
    webViewLink: text(r.web_view_link),
    openUrl: text(r.open_url),
    ownerDisplay: optionalText(r.owner_display) ?? '',
    ...(driveModifiedAt !== undefined ? { driveModifiedAt } : {}),
    ...(driveModifiedByDisplay !== undefined ? { driveModifiedByDisplay } : {}),
    sharingState: text(r.sharing_state),
    ...(sharedUserCount !== undefined ? { sharedUserCount } : {}),
    connectionId: id(r.connection_id),
    boundAccountEmail: text(r.bound_account_email),
    boundConnectionLost: bool(r.bound_connection_lost),
    ...(accessLostAt !== undefined ? { accessLostAt } : {}),
    boundById: id(r.bound_by_id),
    boundByName: text(r.bound_by_name),
    createdBy: id(r.created_by),
    createdByKind: optionalText(r.created_by_kind) ?? 'human',
    createdByName: text(r.created_by_name),
    createdAt: text(r.created_at),
    updatedAt: text(r.updated_at),
    ...(metadataRefreshedAt !== undefined ? { metadataRefreshedAt } : {}),
    viewerAccess: text(r.viewer_access),
    ...(viewerConnectionId !== undefined ? { viewerConnectionId } : {}),
    ...(viewerAccountEmail !== undefined ? { viewerAccountEmail } : {}),
    canUnlink: bool(r.can_unlink),
    canRebind: bool(r.can_rebind),
    canPropose: bool(r.can_propose),
    canAsk: bool(r.can_ask),
    usedInCount: optionalNonNegInt(r.used_in_count) ?? 0,
    usedInTasks: parseLinkedTaskRefList(r.used_in_tasks),
    tasksCreated: parseTasksCreatedSummary(r.tasks_created),
    ...(taskCreations !== undefined ? { taskCreations } : {}),
  }
}

/** `{ files: DriveFileDTO[], total_count: number, next_cursor: string | null }` */
export function parseDriveFileList(raw: unknown): DriveFileListPage {
  const r = record(raw)
  if (!Array.isArray(r.files)) bad()
  const files = r.files.map(parseDriveFile)
  const totalCount =
    r.total_count === undefined || r.total_count === null ? files.length : nonNegInt(r.total_count)
  let nextCursor: string | null = null
  if (r.next_cursor !== undefined && r.next_cursor !== null) {
    const c = text(r.next_cursor)
    nextCursor = c.length > 0 ? c : null
  }
  return {
    files,
    totalCount,
    nextCursor,
  }
}

/** `{ file: DriveFileDTO }` */
export function parseOneDriveFile(raw: unknown): DriveFile {
  return parseDriveFile(record(raw).file)
}

/** `{ status: "ok" }` */
export function parseDriveStatus(raw: unknown): null {
  const r = record(raw)
  if (r.status !== 'ok') bad()
  return null
}

export function parseDriveHistoryEvent(value: unknown): DriveHistoryEvent {
  const r = record(value)
  const workspaceId = optionalText(r.workspace_id)
  const resId = id(r.resource_id)
  return {
    id: id(r.id),
    organizationId: optionalText(r.organization_id) ?? '',
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    actorKind: text(r.actor_kind),
    actorId: text(r.actor_id),
    action: text(r.action),
    resourceType: text(r.resource_type),
    resourceID: resId,
    resourceId: resId,
    changes: plainMap(r.changes),
    metadata: plainMap(r.metadata),
    correlationId: optionalText(r.correlation_id) ?? '',
    occurredAt: text(r.occurred_at),
  }
}

/** `{ events: AuditEventDTO[] }` */
export function parseDriveHistoryList(raw: unknown): DriveHistoryEvent[] {
  const list = record(raw).events
  if (!Array.isArray(list)) bad()
  return list.map(parseDriveHistoryEvent)
}
