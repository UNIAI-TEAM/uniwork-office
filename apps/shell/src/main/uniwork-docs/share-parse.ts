import {
  SHARE_LEVELS,
  SHARE_PRINCIPAL_TYPES,
  FOLDER_CONTENTS_ACCESS_BATCH_STATUSES,
  FOLDER_CONTENTS_ACCESS_ID,
  FOLDER_CONTENTS_ACCESS_WARNINGS,
  type FolderContentsAccessBatch,
  type FolderContentsAccessBatchStatus,
  type FolderContentsAccessCounts,
  type FolderContentsAccessPreview,
  type FolderContentsAccessResult,
  type FolderContentsAccessWarning,
  type ShareAccess,
  type ShareAccessRequest,
  type ShareBreakGlassGrant,
  type ShareCandidate,
  type ShareCandidatePage,
  type ShareGrant,
  type ShareHomeWorkspace,
  type ShareLevel,
  type ShareLink,
  type ShareLinkCreated,
  type ShareMember,
  type ShareMemberPage,
  type ShareOwnerCandidate,
  type ShareOwnerTransfer,
  type SharePersonAccess,
  type SharePreview,
  type SharePreviewLevel,
  type SharePrincipalType,
  type ShareRequestDecision,
  type ShareSettings,
  type ShareSource,
  type ShareUpdate,
  type ShareVia,
  type ShareResultStatus,
  type ShareWarningCode,
} from '../../shared/share-api'
import { UniworkDocError } from './errors'

/**
 * UNI-2047 SD-A: the lenient parse of the sharing routes (documents-sharing.ts,
 * documents-access-requests.ts, document-access.ts on the web). Unknown fields
 * are ignored, a missing optional field takes its default, an enum value this
 * client does not list narrows to "none", and a malformed top level (or a row
 * the dialog must not silently leave out, like a grant) is `malformed_response`.
 */

const MAX_ID = 256
const MAX_TEXT = 4096
const VIAS: readonly string[] = ['member', 'share', 'link', 'ai_context', 'break_glass']

function bad(): never {
  throw new UniworkDocError('malformed_response')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) bad()
  return value
}

/** a required id / token: a non-empty bounded string */
function required(value: unknown, max = MAX_ID): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) bad()
  return value
}

/** an optional text: the default for anything that is not a bounded string */
function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length <= MAX_TEXT ? value : fallback
}

function levelOf(value: unknown): ShareLevel | null {
  return typeof value === 'string' && (SHARE_LEVELS as readonly string[]).includes(value)
    ? (value as ShareLevel)
    : null
}

function viaOf(value: unknown): ShareVia | '' {
  return typeof value === 'string' && VIAS.includes(value) ? (value as ShareVia) : ''
}

function principalTypeOf(value: unknown): SharePrincipalType | null {
  return typeof value === 'string' && (SHARE_PRINCIPAL_TYPES as readonly string[]).includes(value)
    ? (value as SharePrincipalType)
    : null
}

function nonNegInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function sourceOf(raw: unknown): ShareSource | null {
  if (!isRecord(raw)) return null
  const level = levelOf(raw.level)
  if (typeof raw.via !== 'string' || raw.via.length === 0 || !level) return null
  const principalType = principalTypeOf(raw.principal_type)
  const principalId = typeof raw.principal_id === 'string' ? raw.principal_id : undefined
  return {
    via: raw.via as ShareVia,
    ...(principalType ? { principalType } : {}),
    ...(principalId !== undefined ? { principalId } : {}),
    level,
  }
}

/** the sources of a reading: absent stays absent, a non-list is empty, a bad entry is dropped */
function sourcesOf(raw: unknown): ShareSource[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    const source = sourceOf(entry)
    return source ? [source] : []
  })
}

function personOf(raw: unknown): SharePersonAccess | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  if (!isRecord(raw) || typeof raw.user_id !== 'string' || typeof raw.level !== 'string') {
    return undefined
  }
  return { userId: raw.user_id, level: levelOf(raw.level) ?? '', via: viaOf(raw.via) }
}

function homeWorkspaceOf(raw: unknown): ShareHomeWorkspace | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  if (!isRecord(raw) || typeof raw.workspace_id !== 'string' || raw.workspace_id.length === 0) {
    return undefined
  }
  return {
    workspaceId: raw.workspace_id,
    workspaceName: text(raw.workspace_name),
    level: levelOf(raw.level),
  }
}

function grantOf(raw: unknown): ShareGrant {
  const row = record(raw)
  const sources = sourcesOf(row.sources)
  const effectiveLevel =
    row.effective_level === undefined ? undefined : levelOf(row.effective_level)
  const effectiveVia =
    row.effective_via === undefined ? undefined : viaOf(row.effective_via) || null
  const warnings = Array.isArray(row.warnings)
    ? row.warnings.filter((w): w is string => w === 'direct_below_group')
    : undefined
  return {
    id: required(row.id),
    principalType: required(row.principal_type),
    principalId: required(row.principal_id),
    level: levelOf(row.level),
    active: typeof row.active === 'boolean' ? row.active : true,
    ...(effectiveLevel !== undefined ? { effectiveLevel } : {}),
    ...(effectiveVia !== undefined ? { effectiveVia } : {}),
    ...(sources ? { sources } : {}),
    ...(warnings ? { warnings } : {}),
    grantedBy: text(row.granted_by),
    grantedByKind: text(row.granted_by_kind, 'human'),
    createdAt: text(row.created_at),
  }
}

function linkOf(raw: unknown): ShareLink {
  const row = record(raw)
  return {
    id: required(row.id),
    expiresAt: typeof row.expires_at === 'string' ? row.expires_at : null,
    viewCount: typeof row.view_count === 'number' ? row.view_count : 0,
    createdBy: text(row.created_by),
    createdByKind: text(row.created_by_kind, 'human'),
    createdAt: text(row.created_at),
  }
}

function breakGlassOf(raw: unknown): ShareBreakGlassGrant | null {
  if (!isRecord(raw)) return null
  const { id, document_id, actor_id, granted_at, expires_at } = raw
  for (const value of [id, document_id, actor_id, granted_at, expires_at]) {
    if (typeof value !== 'string' || value.length === 0) return null
  }
  return {
    id: id as string,
    documentId: document_id as string,
    actorId: actor_id as string,
    actorName: text(raw.actor_name),
    level: levelOf(raw.level) ?? 'view',
    reason: text(raw.reason),
    grantedAt: granted_at as string,
    expiresAt: expires_at as string,
  }
}

/**
 * `POST /documents/{id}/break-glass`: the grant is either the body or `{grant}` (the web reads both);
 * an answer with no readable grant is null (the write happened, the list will show it).
 */
export function parseBreakGlassGrant(raw: unknown): ShareBreakGlassGrant | null {
  const body = isRecord(raw) && isRecord(raw.grant) ? raw.grant : raw
  return breakGlassOf(body)
}

/** `DELETE /documents/{id}/break-glass/{grantId}`: only `{status:"ok"}` is an ended grant */
export function parseBreakGlassRevoke(raw: unknown): void {
  if (!isRecord(raw) || raw.status !== 'ok') bad()
}

/**
 * `GET /orgs/{org}/members`: one page of people. The name is the display name, else the email
 * (like the web); a row with neither, or no id, is dropped on its own. `nextCursor` is `''` on the
 * last page.
 */
export function parseShareMembers(raw: unknown): ShareMemberPage {
  const body = record(raw)
  if (!Array.isArray(body.members)) bad()
  const next = body.next_cursor
  if (next !== null && next !== undefined && typeof next !== 'string') bad()
  const members: ShareMember[] = []
  for (const value of body.members) {
    if (!isRecord(value)) continue
    const userId = value.user_id
    if (typeof userId !== 'string' || !userId) continue
    const name =
      typeof value.display_name === 'string' && value.display_name.trim()
        ? value.display_name
        : typeof value.email === 'string' && value.email.trim()
          ? value.email
          : ''
    if (name) members.push({ userId, displayName: name })
  }
  return { members, nextCursor: typeof next === 'string' ? next : '' }
}

/** `GET /documents/{id}/shares` */
export function parseShareAccess(raw: unknown): ShareAccess {
  const body = record(raw)
  const adminScope = body.admin_scope === true
  // the server told us nothing about the viewer: no level and no admin scope
  if (typeof body.my_level !== 'string' && !adminScope) bad()
  const mySources = sourcesOf(body.my_sources)
  const homeWorkspace = homeWorkspaceOf(body.home_workspace)
  const owner = personOf(body.acl_owner)
  if (body.shares !== undefined && !Array.isArray(body.shares)) bad()
  if (body.links !== undefined && !Array.isArray(body.links)) bad()
  const shares = body.shares?.map(grantOf)
  const links = body.links?.map(linkOf)
  const breakGlass =
    body.break_glass === undefined || body.break_glass === null
      ? undefined
      : Array.isArray(body.break_glass)
        ? body.break_glass.flatMap((entry) => {
            const grant = breakGlassOf(entry)
            return grant ? [grant] : []
          })
        : []
  return {
    myLevel: levelOf(body.my_level) ?? '',
    adminScope,
    via: viaOf(body.via),
    ...(mySources ? { mySources } : {}),
    ...(homeWorkspace !== undefined ? { homeWorkspace } : {}),
    ...(owner !== undefined ? { owner } : {}),
    ...(shares ? { shares } : {}),
    ...(links ? { links } : {}),
    ...(breakGlass ? { breakGlass } : {}),
  }
}

function previewLevelOf(raw: unknown): SharePreviewLevel {
  const row = isRecord(raw) ? raw : {}
  return { level: levelOf(row.level) ?? '', via: viaOf(row.via) }
}

function previewOf(raw: unknown): SharePreview {
  const preview: SharePreview = { users: [], groups: [], warnings: [] }
  if (!isRecord(raw)) return preview
  if (Array.isArray(raw.users)) {
    for (const entry of raw.users) {
      if (!isRecord(entry) || typeof entry.user_id !== 'string' || entry.user_id.length === 0)
        continue
      preview.users.push({
        userId: entry.user_id,
        before: previewLevelOf(entry.before),
        after: previewLevelOf(entry.after),
      })
    }
  }
  if (Array.isArray(raw.groups)) {
    for (const entry of raw.groups) {
      if (!isRecord(entry)) continue
      const principalType = entry.principal_type
      const memberCount = nonNegInt(entry.member_count)
      const losingCount = nonNegInt(entry.losing_count)
      if (
        (principalType !== 'workspace' && principalType !== 'organization') ||
        typeof entry.principal_id !== 'string' ||
        entry.principal_id.length === 0 ||
        memberCount === null ||
        losingCount === null
      ) {
        continue
      }
      preview.groups.push({
        principalType,
        principalId: entry.principal_id,
        memberCount,
        losingCount,
      })
    }
  }
  if (Array.isArray(raw.warnings)) {
    for (const entry of raw.warnings) {
      if (!isRecord(entry) || typeof entry.code !== 'string') continue
      const index = nonNegInt(entry.index)
      if (index === null) continue
      preview.warnings.push({ code: entry.code as ShareWarningCode, index })
    }
  }
  return preview
}

/** `PUT /documents/{id}/access`: a write must be provable, so the results are strict */
export function parseShareUpdate(raw: unknown): ShareUpdate {
  const body = record(raw)
  if (!Array.isArray(body.results) || body.results.length === 0) bad()
  const results = body.results.map((entry) => {
    const row = record(entry)
    const index = nonNegInt(row.index)
    if (index === null || typeof row.status !== 'string') bad()
    return { index, status: row.status as ShareResultStatus }
  })
  return {
    batchId: text(body.batch_id),
    dryRun: body.dry_run === true,
    results,
    preview: previewOf(body.preview),
  }
}

function candidateOf(raw: unknown): ShareCandidate | null {
  if (!isRecord(raw)) return null
  const principalType = principalTypeOf(raw.principal_type)
  if (
    !principalType ||
    typeof raw.principal_id !== 'string' ||
    raw.principal_id.length === 0 ||
    typeof raw.name !== 'string'
  ) {
    return null
  }
  return {
    principalType,
    principalId: raw.principal_id,
    name: raw.name,
    secondary: text(raw.secondary),
    directLevel: levelOf(raw.direct_level),
    isHomeWorkspace: raw.is_home_workspace === true,
  }
}

/** `GET /documents/{id}/share-candidates`: a row this client cannot share with is dropped on its own */
export function parseShareCandidates(raw: unknown): ShareCandidatePage {
  const body = record(raw)
  if (!Array.isArray(body.items)) bad()
  return {
    items: body.items.flatMap((entry) => {
      const candidate = candidateOf(entry)
      return candidate ? [candidate] : []
    }),
    nextCursor: text(body.next_cursor),
  }
}

/** `POST /documents/{id}/links`: the link plus the one-time token and url */
export function parseShareLinkCreated(raw: unknown): ShareLinkCreated {
  const body = record(raw)
  return {
    link: linkOf(body.link),
    token: required(body.token, 1024),
    url: required(body.url, 2048),
  }
}

/** `GET /orgs/{id}/documents/settings`: the switch is never guessed */
export function parseShareSettings(raw: unknown): ShareSettings {
  const body = record(raw)
  if (typeof body.public_links_enabled !== 'boolean') bad()
  return {
    organizationId: text(body.organization_id),
    publicLinksEnabled: body.public_links_enabled,
  }
}

function requestOf(raw: unknown): ShareAccessRequest | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.requester_id !== 'string') {
    return null
  }
  const source =
    isRecord(raw.source) && typeof raw.source.kind === 'string' && typeof raw.source.id === 'string'
      ? { kind: raw.source.kind, id: raw.source.id, title: text(raw.source.title) }
      : null
  return {
    id: raw.id,
    requesterId: raw.requester_id,
    requesterName: text(raw.requester_name),
    requestedLevel: text(raw.requested_level, 'view') || 'view',
    message: text(raw.message),
    source,
    createdAt: text(raw.created_at),
    expiresAt: text(raw.expires_at),
  }
}

/** `GET /documents/{id}/access-requests` */
export function parseAccessRequests(raw: unknown): ShareAccessRequest[] {
  const body = record(raw)
  if (!Array.isArray(body.requests)) bad()
  return body.requests.flatMap((entry) => {
    const row = requestOf(entry)
    return row ? [row] : []
  })
}

/** the answer of an approve / decline */
export function parseRequestDecision(raw: unknown): ShareRequestDecision {
  const body = record(raw)
  return {
    id: required(body.id),
    status: required(body.status, 128),
    shareId: text(body.share_id),
  }
}

/** UNI-2078: `PUT /documents/{id}/owner` (DocumentOwnerSDO); the previous owner fields default to empty */
export function parseOwnerTransfer(raw: unknown): ShareOwnerTransfer {
  const body = record(raw)
  return {
    documentId: required(body.document_id),
    aclOwnerId: required(body.acl_owner_id),
    previousOwnerId: text(body.previous_owner_id),
    previousOwnerShareId: text(body.previous_owner_share_id),
  }
}

/** UNI-2078: what main checks of a document before an owner transfer (main only) */
export interface ShareOwnerGate {
  id: string
  workspaceId: string
  /** `owner_kind`: non-empty = owned by a work product, whose owner cannot change */
  ownerKind: string
  shelved: boolean
  /** `restricted` matters: an admin there only through admin_scope may not take it */
  visibility: string
}

/** UNI-2078: `GET /documents/{id}` read for the owner gate; fails closed without an id or workspace */
export function parseOwnerGate(raw: unknown): ShareOwnerGate {
  const doc = record(record(raw).document)
  return {
    id: required(doc.id),
    workspaceId: required(doc.workspace_id),
    ownerKind: text(doc.owner_kind),
    shelved: typeof doc.shelved_at === 'string' && doc.shelved_at.length > 0,
    visibility: text(doc.visibility),
  }
}

/** UNI-2078: `GET /workspaces/{ws}/members` as user ids (the names come from the organization) */
export function parseWorkspaceMemberIds(raw: unknown): string[] {
  const body = record(raw)
  if (!Array.isArray(body.members)) bad()
  return body.members.flatMap((value) =>
    isRecord(value) && typeof value.user_id === 'string' && value.user_id ? [value.user_id] : [],
  )
}

/**
 * UNI-2078: `GET /orgs/{org}/members?status=active`, one page of people who may own a document.
 * A row the server marks anything but active is dropped (no status = active, as asked); the name
 * is the display name, else the email; a row with neither is dropped.
 */
export function parseActiveOrgMembers(raw: unknown): {
  members: ShareOwnerCandidate[]
  nextCursor: string
} {
  const body = record(raw)
  if (!Array.isArray(body.members)) bad()
  const next = body.next_cursor
  if (next !== null && next !== undefined && typeof next !== 'string') bad()
  const members: ShareOwnerCandidate[] = []
  for (const value of body.members) {
    if (!isRecord(value)) continue
    const userId = value.user_id
    if (typeof userId !== 'string' || !userId) continue
    if (value.status !== undefined && value.status !== 'active') continue
    const email = text(value.email).trim()
    const display = text(value.display_name).trim()
    const name = display || email
    if (name) members.push({ userId, name, email })
  }
  return { members, nextCursor: typeof next === 'string' ? next : '' }
}

/** UNI-2244: a count the server must send: a safe non-negative integer, else the whole answer is malformed */
function count(value: unknown): number {
  const n = nonNegInt(value)
  if (n === null) bad()
  return n
}

function folderCountsOf(body: Record<string, unknown>): FolderContentsAccessCounts {
  return {
    changed: count(body.changed),
    unchanged: count(body.unchanged),
    skippedNotManageable: count(body.skipped_not_manageable),
    skippedLocked: count(body.skipped_locked),
  }
}

function folderPreviewOf(raw: unknown): FolderContentsAccessPreview {
  const body = record(raw)
  if (!Array.isArray(body.warnings)) bad()
  // the web keeps the three known codes and ignores the rest
  const warnings = body.warnings.filter((entry): entry is FolderContentsAccessWarning =>
    (FOLDER_CONTENTS_ACCESS_WARNINGS as readonly unknown[]).includes(entry),
  )
  return {
    ...folderCountsOf(body),
    losingUsers: count(body.losing_users),
    downgradedUsers: count(body.downgraded_users),
    warnings,
  }
}

/** what the UI reads as "nothing to change": the web's answer to a dry run it cannot read */
const EMPTY_DRY_RUN: FolderContentsAccessResult = {
  kind: 'dryRun',
  total: 0,
  preview: {
    changed: 0,
    unchanged: 0,
    skippedNotManageable: 0,
    skippedLocked: 0,
    losingUsers: 0,
    downgradedUsers: 0,
    warnings: [],
  },
}

function parseDryRun(raw: unknown, status: number): FolderContentsAccessResult {
  const body = record(raw)
  const total = count(body.total)
  if (status !== 200) bad()
  // a discriminator on a dry run is tolerated; only the write shapes are refused (they have no preview)
  if (body.mode === 'sync' || body.mode === 'background') bad()
  return { kind: 'dryRun', total, preview: folderPreviewOf(body.preview) }
}

/**
 * UNI-2244: `PUT /documents/{folderId}/contents-access`. A write must be provable, so every
 * count is required and the shape has to agree with the request and the HTTP status: a write
 * answers 200 `sync` or 202 `background` with a plain batch id, else `malformed_response`. A dry
 * run writes nothing, so one the app cannot read is "nothing to change" (the web's behaviour),
 * never an error.
 */
export function parseFolderContentsAccess(
  raw: unknown,
  status: number,
  dryRun: boolean,
): FolderContentsAccessResult {
  if (dryRun) {
    try {
      return parseDryRun(raw, status)
    } catch (error) {
      if (error instanceof UniworkDocError && error.code === 'malformed_response') {
        return EMPTY_DRY_RUN
      }
      throw error
    }
  }
  const body = record(raw)
  const total = count(body.total)
  const batchId = required(body.batch_id)
  // the follow-up routes only take a plain id, so a batch id they would refuse is not a success
  if (!FOLDER_CONTENTS_ACCESS_ID.test(batchId)) bad()
  if (body.mode === 'sync' && status === 200) {
    return { kind: 'sync', batchId, total, ...folderCountsOf(body) }
  }
  if (body.mode === 'background' && status === 202) return { kind: 'background', batchId, total }
  return bad()
}

/** UNI-2244: `GET .../contents-access/{batchId}`; a status the app does not list reads as `running` (ask again, like the web) */
export function parseFolderContentsAccessBatch(raw: unknown): FolderContentsAccessBatch {
  const body = record(raw)
  const status = body.status
  if (typeof status !== 'string') bad()
  const total = count(body.total)
  const processed = count(body.processed)
  // progress past the end is not a count a bar can show
  if (processed > total) bad()
  const finishedAt = body.finished_at
  if (finishedAt !== undefined && finishedAt !== null && typeof finishedAt !== 'string') bad()
  return {
    batchId: required(body.batch_id),
    status: (FOLDER_CONTENTS_ACCESS_BATCH_STATUSES as readonly string[]).includes(status)
      ? (status as FolderContentsAccessBatchStatus)
      : 'running',
    total,
    processed,
    ...folderCountsOf(body),
    ...(typeof finishedAt === 'string' && finishedAt ? { finishedAt } : {}),
  }
}

export { parseRejectedItems } from './share-rejected'
