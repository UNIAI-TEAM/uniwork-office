/**
 * UNI-2047 APP-SHARE-DIALOG (SD-A): the renderer-facing contract of the Share
 * dialog. One method per `uniwork-share:*` IPC channel; main (`share-service.ts`)
 * implements it, the preload exposes it as `window.uniworkShare`, and the
 * renderer tests use the in-memory fake (`uniwork-share/fake-share-api.ts`).
 *
 * The shapes mirror the web schemas (`documents-sharing.ts`,
 * `documents-access-requests.ts`, `document-access.ts`): the wire is snake_case,
 * the app speaks camelCase here. Enum-like server strings stay open on the wire
 * and are narrowed at the parse: an unknown level reads as none (`''` / `null`),
 * so a value a newer server adds never breaks a dialog that is already open.
 */

/** the four access levels a grant or a reading can carry */
export type ShareLevel = 'view' | 'comment' | 'edit' | 'manage'
export const SHARE_LEVELS: readonly ShareLevel[] = ['view', 'comment', 'edit', 'manage']

/** the levels a request may ask for or an approval may grant (never manage) */
export type ShareRequestLevel = 'view' | 'comment' | 'edit'

export type SharePrincipalType = 'user' | 'workspace' | 'organization'
export const SHARE_PRINCIPAL_TYPES: readonly SharePrincipalType[] = [
  'user',
  'workspace',
  'organization',
]

/** where a level comes from (the web's DOCUMENT_ACCESS_VIA) */
export type ShareVia = 'member' | 'share' | 'link' | 'ai_context' | 'break_glass'

/** one source of the viewer's (or a grant's) effective level */
export interface ShareSource {
  via: ShareVia
  principalType?: SharePrincipalType
  principalId?: string
  level: ShareLevel
}

/** the document's ACL owner (`acl_owner`) */
export interface SharePersonAccess {
  userId: string
  /** `''` when the server sent a level this client does not list */
  level: ShareLevel | ''
  via: ShareVia | ''
}

/** the home workspace row of the dialog (`home_workspace`); `level` null = not shared to it */
export interface ShareHomeWorkspace {
  workspaceId: string
  workspaceName: string
  level: ShareLevel | null
}

/** one live grant (`shares[]`) */
export interface ShareGrant {
  id: string
  /** kept as sent: a principal type a newer server adds still lists */
  principalType: string
  principalId: string
  level: ShareLevel | null
  active: boolean
  effectiveLevel?: ShareLevel | null
  effectiveVia?: ShareVia | null
  sources?: ShareSource[]
  /** only `direct_below_group` is known */
  warnings?: string[]
  grantedBy: string
  grantedByKind: string
  createdAt: string
}

/** one live public link (`links[]`) */
export interface ShareLink {
  id: string
  expiresAt: string | null
  viewCount: number
  createdBy: string
  createdByKind: string
  createdAt: string
}

/** one live emergency-access grant (`break_glass[]`) */
export interface ShareBreakGlassGrant {
  id: string
  documentId: string
  actorId: string
  actorName: string
  level: ShareLevel
  reason: string
  grantedAt: string
  expiresAt: string
}

/**
 * `GET /documents/{id}/shares`: my level always; grants, links, the ACL owner
 * and break-glass only at manage level or admin scope (the optional keys are
 * absent otherwise, exactly as the web reads them).
 */
export interface ShareAccess {
  myLevel: ShareLevel | ''
  /** a workspace admin administering a restricted document they do not own */
  adminScope: boolean
  via: ShareVia | ''
  mySources?: ShareSource[]
  /** `undefined` = the server did not say, `null` = no home-workspace row */
  homeWorkspace?: ShareHomeWorkspace | null
  owner?: SharePersonAccess | null
  shares?: ShareGrant[]
  links?: ShareLink[]
  breakGlass?: ShareBreakGlassGrant[]
}

/** one row of the add-people picker (`share-candidates`) */
export interface ShareCandidate {
  principalType: SharePrincipalType
  principalId: string
  name: string
  secondary: string
  /** the principal's existing direct grant level, if any */
  directLevel: ShareLevel | null
  isHomeWorkspace: boolean
}

export interface ShareCandidatePage {
  items: ShareCandidate[]
  nextCursor: string
}

export interface ShareCandidatesInput {
  documentId: string
  q?: string
  cursor?: string
  limit?: number
}

/** one change of an access update; `level: null` revokes the principal's direct grant */
export interface ShareUpdateItem {
  principalType: SharePrincipalType
  principalId: string
  level: ShareLevel | null
  /** a picked principal that already has a direct grant: keep it (default) or move it */
  onExisting?: 'update' | 'keep'
}

export interface ShareUpdateInput {
  documentId: string
  items: ShareUpdateItem[]
  /** true = preview only (nothing is written); omitted = write */
  dryRun?: boolean
}

export type ShareResultStatus = 'granted' | 'updated' | 'revoked' | 'kept' | 'unchanged'

export interface ShareUpdateResultItem {
  index: number
  /** narrowed for readers; an unknown status still arrives, so branch with a default */
  status: ShareResultStatus
}

export interface SharePreviewLevel {
  level: ShareLevel | ''
  via: ShareVia | ''
}

export interface SharePreviewUser {
  userId: string
  before: SharePreviewLevel
  after: SharePreviewLevel
}

export interface SharePreviewGroup {
  principalType: 'workspace' | 'organization'
  principalId: string
  memberCount: number
  losingCount: number
}

export type ShareWarningCode = 'wide_scope' | 'direct_below_group' | 'downgrade'

export interface ShareWarning {
  /** narrowed for readers; an unknown code still arrives, so branch with a default */
  code: ShareWarningCode
  index: number
}

export interface SharePreview {
  users: SharePreviewUser[]
  groups: SharePreviewGroup[]
  warnings: ShareWarning[]
}

/** the answer of `PUT /documents/{id}/access` (a dry run carries the preview, a write the results) */
export interface ShareUpdate {
  batchId: string
  dryRun: boolean
  results: ShareUpdateResultItem[]
  preview: SharePreview
}

/** why one item of an update was refused (`document_access_rejected`) */
export type ShareRejectedCode =
  | 'principal_not_in_organization'
  | 'level_not_allowed'
  | 'duplicate_principal'
  | 'break_glass_required'

export interface ShareRejectedItem {
  index: number
  principalType: SharePrincipalType
  principalId: string
  code: ShareRejectedCode
}

export interface ShareLinkCreateInput {
  documentId: string
  /** 1-90 days; omitted = the server's default */
  expiresInDays?: number
}

export interface ShareLinkRevokeInput {
  documentId: string
  linkId: string
}

/** a freshly minted link: the raw token and url ride this answer exactly once */
export interface ShareLinkCreated {
  link: ShareLink
  token: string
  url: string
}

/** the organization's public-links policy (read-only here) */
export interface ShareSettings {
  organizationId: string
  publicLinksEnabled: boolean
}

export interface ShareRequestSource {
  kind: string
  id: string
  title: string
}

/** one pending access request on a document */
export interface ShareAccessRequest {
  id: string
  requesterId: string
  requesterName: string
  /** kept as sent (`view` when absent): approval is limited to {@link ShareRequestLevel} */
  requestedLevel: string
  message: string
  /** null = the request came from a link */
  source: ShareRequestSource | null
  createdAt: string
  expiresAt: string
}

export interface ShareRequestApproveInput {
  documentId: string
  requestId: string
  /** defaults to the requested level on the server */
  level?: ShareRequestLevel
}

export interface ShareRequestDeclineInput {
  documentId: string
  requestId: string
}

export interface ShareRequestDecision {
  id: string
  status: string
  /** empty when the requester already had the access */
  shareId: string
}

/** how a bulk plan changes each document's home-workspace row */
export type ShareBulkWorkspace = 'keep' | 'none' | 'view' | 'comment' | 'edit'
/** what happens to each document's public links */
export type ShareBulkLink = 'keep' | 'create' | 'revoke'

export interface ShareBulkPerson {
  principalType: SharePrincipalType
  principalId: string
  level: ShareLevel
}

export interface ShareBulkPlan {
  /** the documents to share; `workspaceId` is each one's own home workspace */
  docs: { id: string; workspaceId: string }[]
  /** the same people / workspaces / organization for every document */
  people: ShareBulkPerson[]
  onExisting: 'update' | 'keep'
  workspace: ShareBulkWorkspace
  link: ShareBulkLink
  /** days a created link lives (1-90) */
  expiresInDays?: number
}

export interface ShareBulkFailure {
  id: string
  error: ShareErrorCode
  rejected?: ShareRejectedItem[]
  /** the server throttled this document twice; running the plan again for it may work */
  retryable?: boolean
}

/** per-document outcomes, each list in the order the documents were given */
export interface ShareBulkResult {
  ok: string[]
  failed: ShareBulkFailure[]
  /** the one-time URL of each created link */
  links: { id: string; url: string }[]
}

/** the reason of an emergency-access grant is 10-500 characters (code points, after a trim) */
export const BREAK_GLASS_REASON_MIN = 10
export const BREAK_GLASS_REASON_MAX = 500

export interface ShareBreakGlassInput {
  documentId: string
  /** audited reason, 10-500 characters after the trim */
  reason: string
}

export interface ShareBreakGlassRevokeInput {
  documentId: string
  grantId: string
}

/** one organization member (the web's member walk, `GET /orgs/{org}/members`) */
export interface ShareMember {
  userId: string
  /** the display name, else the email */
  displayName: string
}

export interface ShareMembersInput {
  /** the previous page's `nextCursor`; omitted = the first page */
  cursor?: string
  /** 1-100; omitted = the largest page */
  limit?: number
}

export interface ShareMemberPage {
  members: ShareMember[]
  /** `''` = the last page */
  nextCursor: string
}

/**
 * What a share call may fail with. The server's own verdicts keep their names
 * (`document_access_rejected` carries `rejected`); the transport / permission
 * failures are the app's usual ones.
 */
export type ShareErrorCode =
  | 'not_signed_in'
  | 'session_expired'
  | 'wrong_deployment'
  | 'network'
  | 'timeout'
  | 'server_error'
  | 'malformed_response'
  | 'forbidden'
  | 'not_found'
  | 'invalid_request'
  | 'document_access_rejected'
  | 'document_link_limit'
  | 'document_links_disabled'
  | 'document_shelved'
  | 'document_archived'
  | 'my_folder_locked'
  | 'folder_not_shareable'
  | 'break_glass_required'
  | 'break_glass_reason_invalid'
  | 'access_request_closed'

export type ShareResult<T> =
  | { ok: true; value: T }
  | {
      ok: false
      error: ShareErrorCode
      /** the HTTP status the server answered, when it did */
      status?: number
      /** `document_access_rejected`: the refused items, by index of the request */
      rejected?: ShareRejectedItem[]
      /** a throttle (429 / 503): the same call may be repeated once */
      retryable?: boolean
    }

/** one method per `uniwork-share:*` channel */
export interface UniworkShareApi {
  get(documentId: string): Promise<ShareResult<ShareAccess>>
  update(input: ShareUpdateInput): Promise<ShareResult<ShareUpdate>>
  candidates(input: ShareCandidatesInput): Promise<ShareResult<ShareCandidatePage>>
  linkCreate(input: ShareLinkCreateInput): Promise<ShareResult<ShareLinkCreated>>
  linkRevoke(input: ShareLinkRevokeInput): Promise<ShareResult<ShareLinkRevokeInput>>
  /** the selected organization's public-links policy (readable by its owners / admins) */
  settings(): Promise<ShareResult<ShareSettings>>
  /** `null` value = the server has no such route (the dialog shows no section, not an error) */
  requests(documentId: string): Promise<ShareResult<ShareAccessRequest[] | null>>
  requestApprove(input: ShareRequestApproveInput): Promise<ShareResult<ShareRequestDecision>>
  requestDecline(input: ShareRequestDeclineInput): Promise<ShareResult<ShareRequestDecision>>
  bulk(plan: ShareBulkPlan): Promise<ShareResult<ShareBulkResult>>
  /** open a 24 h read-only emergency grant (an administering workspace admin); null value = an answer with no readable grant */
  breakGlassGrant(input: ShareBreakGlassInput): Promise<ShareResult<ShareBreakGlassGrant | null>>
  /** end one live emergency grant by its id */
  breakGlassRevoke(
    input: ShareBreakGlassRevokeInput,
  ): Promise<ShareResult<ShareBreakGlassRevokeInput>>
  /** one page of the selected organization's members (the names of the people in the access list) */
  members(input: ShareMembersInput): Promise<ShareResult<ShareMemberPage>>
}
