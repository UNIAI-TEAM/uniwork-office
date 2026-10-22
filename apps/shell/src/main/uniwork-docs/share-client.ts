import { randomUUID } from 'node:crypto'
import {
  BREAK_GLASS_REASON_MAX,
  BREAK_GLASS_REASON_MIN,
  SHARE_LEVELS,
  SHARE_OWNER_KEEP_LEVELS,
  SHARE_PRINCIPAL_TYPES,
  type ShareAccess,
  type ShareAccessRequest,
  type ShareBreakGlassGrant,
  type ShareCandidatePage,
  type ShareLinkCreated,
  type ShareMemberPage,
  type ShareOwnerCandidate,
  type ShareOwnerKeepLevel,
  type ShareOwnerTransfer,
  type ShareRequestDecision,
  type ShareRequestLevel,
  type ShareSettings,
  type ShareUpdate,
  type ShareUpdateItem,
} from '../../shared/share-api'
import {
  METADATA_TIMEOUT_MS,
  createUniworkSend,
  uniworkId,
  type UniworkDocsClientOptions,
} from './client'
import { UniworkDocError } from './errors'
import {
  parseAccessRequests,
  parseActiveOrgMembers,
  parseOwnerGate,
  parseOwnerTransfer,
  parseWorkspaceMemberIds,
  type ShareOwnerGate,
  parseBreakGlassGrant,
  parseBreakGlassRevoke,
  parseShareMembers,
  parseRequestDecision,
  parseShareAccess,
  parseShareCandidates,
  parseShareLinkCreated,
  parseShareSettings,
  parseShareUpdate,
} from './share-parse'

/**
 * UNI-2047 SD-A: the sharing routes of the Share dialog, the same routes and
 * bodies the web calls (documents-sharing.ts, documents-access-requests.ts):
 * the access overview, the unified access update with `dry_run`, the candidate
 * search, public links, the organization's links policy (read only) and the
 * access requests. It rides `createUniworkSend`, so the egress rules of every
 * UniWork client apply (fixed origin + `/api/v1`, no redirects, deadline over the
 * whole exchange, bearer only inside `authorized`, one refresh on 401).
 *
 * A call the client itself refuses (an unknown level, an expiry outside 1-90
 * days, ...) throws `server_error` with `serverCode: 'invalid_input'` before any
 * request; the service maps it to `invalid_request`.
 */

const PRINCIPAL_ID = /^[A-Za-z0-9_-]{1,128}$/
const MAX_CANDIDATES_LIMIT = 100
const MAX_LINK_DAYS = 90
const MAX_MEMBERS_LIMIT = 100
const ORG_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/

export interface UniworkShareClient {
  /** `GET /documents/{id}/shares` */
  getDocumentShares(documentId: string): Promise<ShareAccess>
  /** `PUT /documents/{id}/access` (`dryRun` previews, nothing is written) */
  updateDocumentAccess(
    documentId: string,
    body: { items: ShareUpdateItem[]; dryRun?: boolean },
  ): Promise<ShareUpdate>
  /** `GET /documents/{id}/share-candidates?q=` */
  listShareCandidates(
    documentId: string,
    opts?: { q?: string; cursor?: string; limit?: number },
  ): Promise<ShareCandidatePage>
  /** `POST /documents/{id}/links` */
  createDocumentLink(documentId: string, expiresInDays?: number): Promise<ShareLinkCreated>
  /** `DELETE /documents/{id}/links/{linkId}` */
  revokeDocumentLink(documentId: string, linkId: string): Promise<void>
  /** `GET /orgs/{orgId}/documents/settings` (the public-links policy, read only) */
  getDocumentSettings(orgId: string): Promise<ShareSettings>
  /** `GET /documents/{id}/access-requests`; null when the server has no such route (404) */
  listAccessRequests(documentId: string): Promise<ShareAccessRequest[] | null>
  /** `POST .../access-requests/{id}/approve` */
  approveAccessRequest(
    documentId: string,
    requestId: string,
    level?: ShareRequestLevel,
  ): Promise<ShareRequestDecision>
  /** `POST .../access-requests/{id}/decline` */
  declineAccessRequest(documentId: string, requestId: string): Promise<ShareRequestDecision>
  /** `POST /documents/{id}/break-glass` (a 24 h read-only grant); null = no readable grant in the answer */
  createDocumentBreakGlass(documentId: string, reason: string): Promise<ShareBreakGlassGrant | null>
  /** `DELETE /documents/{id}/break-glass/{grantId}` */
  revokeDocumentBreakGlass(documentId: string, grantId: string): Promise<void>
  /** `GET /orgs/{slug}/members`: one page (`limit` is capped at the server's 100) */
  listOrgMembers(input: {
    orgSlug: string
    cursor?: string
    limit?: number
  }): Promise<ShareMemberPage>
  /**
   * UNI-2078: `PUT /documents/{id}/owner` (the web's documents-owner.ts). An answer that does
   * not name the requested document and owner is not proof of the write: malformed_response.
   */
  transferDocumentOwner(
    documentId: string,
    body: { userId: string; previousOwnerLevel?: ShareOwnerKeepLevel },
  ): Promise<ShareOwnerTransfer>
  /** UNI-2078: `GET /documents/{id}`, what the owner gate reads */
  getOwnerGate(documentId: string): Promise<ShareOwnerGate>
  /** UNI-2078: `GET /workspaces/{ws}/members` as user ids */
  listWorkspaceMemberIds(workspaceId: string): Promise<string[]>
  /** UNI-2078: one page of `GET /orgs/{slug}/members?status=active` */
  listActiveOrgMembers(input: {
    orgSlug: string
    cursor?: string
  }): Promise<{ members: ShareOwnerCandidate[]; nextCursor: string }>
}

/** a call this client will not send */
function invalid(): never {
  throw new UniworkDocError('server_error', { serverCode: 'invalid_input' })
}

function wireItem(item: ShareUpdateItem): Record<string, unknown> {
  if (!item || typeof item !== 'object') invalid()
  if (!(SHARE_PRINCIPAL_TYPES as readonly string[]).includes(item.principalType)) invalid()
  if (typeof item.principalId !== 'string' || !PRINCIPAL_ID.test(item.principalId)) invalid()
  if (item.level !== null && !(SHARE_LEVELS as readonly string[]).includes(item.level as string)) {
    invalid()
  }
  if (item.onExisting !== undefined && item.onExisting !== 'update' && item.onExisting !== 'keep') {
    invalid()
  }
  return {
    principal_type: item.principalType,
    principal_id: item.principalId,
    level: item.level,
    ...(item.onExisting ? { on_existing: item.onExisting } : {}),
  }
}

export function createUniworkShareClient(options: UniworkDocsClientOptions): UniworkShareClient {
  const timeoutMs = options.metadataTimeoutMs ?? METADATA_TIMEOUT_MS
  const send = createUniworkSend(options)
  const json = (response: Response): Promise<unknown> => response.json()
  const nothing = async (): Promise<undefined> => undefined
  const docRoute = (documentId: string): string => `/documents/${uniworkId(documentId)}`

  return {
    async getDocumentShares(documentId) {
      const raw = await send({
        method: 'GET',
        route: `${docRoute(documentId)}/shares`,
        timeoutMs,
        read: json,
      })
      return parseShareAccess(raw)
    },

    async updateDocumentAccess(documentId, body) {
      if (!body || !Array.isArray(body.items) || body.items.length === 0) invalid()
      const route = `${docRoute(documentId)}/access`
      const items = body.items.map(wireItem)
      const raw = await send({
        method: 'PUT',
        route,
        json: { items, ...(typeof body.dryRun === 'boolean' ? { dry_run: body.dryRun } : {}) },
        timeoutMs,
        read: json,
      })
      return parseShareUpdate(raw)
    },

    async listShareCandidates(documentId, opts) {
      const query = new URLSearchParams()
      const q = typeof opts?.q === 'string' ? opts.q.trim() : ''
      if (q) query.set('q', q)
      if (typeof opts?.cursor === 'string' && opts.cursor) query.set('cursor', opts.cursor)
      if (typeof opts?.limit === 'number' && Number.isFinite(opts.limit) && opts.limit > 0) {
        query.set('limit', String(Math.min(Math.floor(opts.limit), MAX_CANDIDATES_LIMIT)))
      }
      const raw = await send({
        method: 'GET',
        route: `${docRoute(documentId)}/share-candidates`,
        query,
        timeoutMs,
        read: json,
      })
      return parseShareCandidates(raw)
    },

    async createDocumentLink(documentId, expiresInDays) {
      if (
        expiresInDays !== undefined &&
        (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > MAX_LINK_DAYS)
      ) {
        invalid()
      }
      const raw = await send({
        method: 'POST',
        route: `${docRoute(documentId)}/links`,
        json: expiresInDays === undefined ? {} : { expires_in_days: expiresInDays },
        timeoutMs,
        read: json,
      })
      return parseShareLinkCreated(raw)
    },

    async revokeDocumentLink(documentId, linkId) {
      await send({
        method: 'DELETE',
        route: `${docRoute(documentId)}/links/${uniworkId(linkId)}`,
        timeoutMs,
        read: nothing,
      })
    },

    async getDocumentSettings(orgId) {
      const raw = await send({
        method: 'GET',
        route: `/orgs/${uniworkId(orgId)}/documents/settings`,
        timeoutMs,
        read: json,
      })
      return parseShareSettings(raw)
    },

    async listAccessRequests(documentId) {
      let raw: unknown
      try {
        raw = await send({
          method: 'GET',
          route: `${docRoute(documentId)}/access-requests`,
          timeoutMs,
          read: json,
        })
      } catch (error) {
        // the feature is not on this server: no section in the dialog, not an error
        if (error instanceof UniworkDocError && error.status === 404) return null
        throw error
      }
      return parseAccessRequests(raw)
    },

    async approveAccessRequest(documentId, requestId, level) {
      if (level !== undefined && level !== 'view' && level !== 'comment' && level !== 'edit') {
        invalid()
      }
      const raw = await send({
        method: 'POST',
        route: `${docRoute(documentId)}/access-requests/${uniworkId(requestId)}/approve`,
        json: level ? { level } : {},
        timeoutMs,
        read: json,
      })
      return parseRequestDecision(raw)
    },

    async createDocumentBreakGlass(documentId, reason) {
      // the web trims, then counts code points like the server counts runes
      const trimmed = typeof reason === 'string' ? reason.trim() : ''
      const length = Array.from(trimmed).length
      if (length < BREAK_GLASS_REASON_MIN || length > BREAK_GLASS_REASON_MAX) {
        throw new UniworkDocError('server_error', { serverCode: 'break_glass_reason_invalid' })
      }
      const raw = await send({
        method: 'POST',
        route: `${docRoute(documentId)}/break-glass`,
        json: { reason: trimmed },
        idempotencyKey: randomUUID(),
        timeoutMs,
        read: json,
      })
      return parseBreakGlassGrant(raw)
    },

    async revokeDocumentBreakGlass(documentId, grantId) {
      const raw = await send({
        method: 'DELETE',
        route: `${docRoute(documentId)}/break-glass/${uniworkId(grantId)}`,
        timeoutMs,
        read: json,
      })
      parseBreakGlassRevoke(raw)
    },

    async listOrgMembers(input) {
      // a slug is lowercase alphanumerics and dashes; anything else never leaves
      if (!ORG_SLUG.test(input.orgSlug)) throw new UniworkDocError('not_found')
      const query = new URLSearchParams()
      // ask for the largest page so a big tenant needs as few reads as possible
      const limit = Math.min(MAX_MEMBERS_LIMIT, Math.max(1, Math.floor(Number(input.limit) || 100)))
      query.set('limit', String(limit))
      if (input.cursor) query.set('cursor', input.cursor.slice(0, 512))
      const raw = await send({
        method: 'GET',
        route: `/orgs/${input.orgSlug}/members`,
        query,
        timeoutMs,
        read: json,
      })
      return parseShareMembers(raw)
    },

    async transferDocumentOwner(documentId, body) {
      const level = body?.previousOwnerLevel ?? 'edit'
      if (!(SHARE_OWNER_KEEP_LEVELS as readonly string[]).includes(level)) invalid()
      if (typeof body.userId !== 'string' || !PRINCIPAL_ID.test(body.userId)) invalid()
      const raw = await send({
        method: 'PUT',
        route: `${docRoute(documentId)}/owner`,
        json: { user_id: body.userId, previous_owner_level: level },
        timeoutMs,
        read: json,
      })
      const transfer = parseOwnerTransfer(raw)
      if (transfer.documentId !== documentId || transfer.aclOwnerId !== body.userId) {
        throw new UniworkDocError('malformed_response')
      }
      return transfer
    },

    async getOwnerGate(documentId) {
      const route = docRoute(documentId)
      let raw: unknown
      try {
        raw = await send({ method: 'GET', route, timeoutMs, read: json })
      } catch (error) {
        if (!(error instanceof UniworkDocError) || error.serverCode !== 'document_restricted') {
          throw error
        }
        // an admin who reaches a restricted document only through admin_scope cannot read it (the
        // same fallback as client.ts documentManageRef). The summary carries workspace_id and
        // visibility but no owner_kind / shelved_at: for this read those two stay '' / false and the
        // server decides (409 document_owned_by_work_product / document_shelved, both kept).
        try {
          raw = await send({
            method: 'GET',
            route: `${route}/admin-summary`,
            timeoutMs,
            read: json,
          })
        } catch (summaryError) {
          if (
            summaryError instanceof UniworkDocError &&
            summaryError.code === 'permission_revoked'
          ) {
            throw new UniworkDocError('forbidden', { status: summaryError.status })
          }
          throw summaryError
        }
      }
      const gate = parseOwnerGate(raw)
      // another document's flags must not gate this transfer
      if (gate.id !== documentId) throw new UniworkDocError('malformed_response')
      return gate
    },

    async listWorkspaceMemberIds(workspaceId) {
      const raw = await send({
        method: 'GET',
        route: `/workspaces/${uniworkId(workspaceId)}/members`,
        timeoutMs,
        read: json,
      })
      return parseWorkspaceMemberIds(raw)
    },

    async listActiveOrgMembers(input) {
      if (!ORG_SLUG.test(input.orgSlug)) throw new UniworkDocError('not_found')
      // only active people may own a document (the web reads the same list)
      const query = new URLSearchParams({ status: 'active', limit: String(MAX_MEMBERS_LIMIT) })
      if (input.cursor) query.set('cursor', input.cursor.slice(0, 512))
      const raw = await send({
        method: 'GET',
        route: `/orgs/${input.orgSlug}/members`,
        query,
        timeoutMs,
        read: json,
      })
      return parseActiveOrgMembers(raw)
    },

    async declineAccessRequest(documentId, requestId) {
      const raw = await send({
        method: 'POST',
        route: `${docRoute(documentId)}/access-requests/${uniworkId(requestId)}/decline`,
        timeoutMs,
        read: json,
      })
      return parseRequestDecision(raw)
    },
  }
}
