import {
  SHARE_LEVELS,
  SHARE_PRINCIPAL_TYPES,
  type ShareAccess,
  type ShareAccessRequest,
  type ShareCandidatePage,
  type ShareLinkCreated,
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
