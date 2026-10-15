import { TransportError } from '../../uniwork-auth/transport'
import { METADATA_TIMEOUT_MS, type FetchLike } from '../../uniwork-docs/client'
import { UniworkDocError, readEnvelope } from '../../uniwork-docs/errors'
import { ID, jsonOrUndefined, type AuthorizedGetOptions } from '../feed/http'
import { REVISION } from '../feed/revision'
import { isLeaseLevel, type LeaseLevel } from './record'

/**
 * HTTP client for `PUT|DELETE /api/v1/documents/{documentID}/office/offline-lease`
 * (DOC-005 §6.2 / contract-p0 §3–§4).
 *
 * - `grant(documentId)` sends `PUT` with an empty body.
 * - `renew(documentId, lease)` sends `PUT` with `{"lease": "<previous signed lease>"}`.
 * - `release(documentId)` sends `DELETE`.
 * - Errors are mapped per contract-p0 (`offline_lease_revoked`,
 *   `offline_lease_device_required`, `offline_lease_limit_reached`,
 *   `document_archived`, `office_capability_off` with `fields.capability = offline_library`,
 *   401 session, network/offline). The server never emits `offline_lease_expired`.
 */

export interface OfficeOfflineLeaseSDO {
  lease: string
  lease_id: string
  document_id: string
  organization_id: string
  workspace_id: string
  version_id: string
  version: number
  revision: string
  level: LeaseLevel
  policy_epoch: number
  generation: number
  renewed: boolean
  issued_at: string
  expires_at: string
  renew_after: string
  server_time: string
}

export type LeaseFailureKind =
  | 'revoked'
  | 'device_required'
  | 'limit_reached'
  | 'archived'
  | 'capability_off'
  | 'session_expired'
  | 'offline'
  | 'access_denied'
  | 'malformed_response'
  | 'server_error'

export interface LeaseFailure {
  kind: LeaseFailureKind
  code: string
  status?: number
  capability?: string
  limit?: number
}

export class LeaseClientError extends Error {
  readonly failure: LeaseFailure
  readonly kind: LeaseFailureKind
  readonly code: string
  readonly status?: number

  constructor(failure: LeaseFailure) {
    super(`uniwork offline lease failed: ${failure.code}`)
    this.name = 'LeaseClientError'
    this.failure = failure
    this.kind = failure.kind
    this.code = failure.code
    this.status = failure.status
  }
}

export interface LeaseClient {
  grant(documentId: string): Promise<OfficeOfflineLeaseSDO>
  renew(documentId: string, lease: string): Promise<OfficeOfflineLeaseSDO>
  release(documentId: string): Promise<void>
}

const MAX_BODY_CHARS = 1024 * 1024

function malformed(): never {
  throw new LeaseClientError({ kind: 'malformed_response', code: 'malformed_response' })
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value))
}

function parseKeepingRevision(text: string): unknown {
  return JSON.parse(text, function (key, value: unknown, context?: { source?: string }) {
    if (key !== 'revision' || typeof value !== 'number') return value
    if (typeof context?.source === 'string') return context.source
    return Number.isSafeInteger(value) ? String(value) : undefined
  }) as unknown
}

export function parseLeaseSDO(input: string | unknown): OfficeOfflineLeaseSDO {
  let raw: unknown = input
  if (typeof input === 'string') {
    try {
      raw = parseKeepingRevision(input)
    } catch {
      malformed()
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) malformed()
  const row = raw as Record<string, unknown>

  const lease = row.lease
  const lease_id = row.lease_id
  const document_id = row.document_id
  const organization_id = row.organization_id
  const workspace_id = row.workspace_id
  const version_id = row.version_id
  const version = row.version
  const revision = row.revision
  const level = row.level
  const generation = row.generation
  const expires_at = row.expires_at
  const renew_after = row.renew_after
  const server_time = row.server_time
  const issued_at = row.issued_at ?? server_time
  const policy_epoch = row.policy_epoch ?? 0
  const renewed = row.renewed ?? false

  if (typeof lease !== 'string' || lease.trim().length === 0) malformed()
  if (typeof lease_id !== 'string' || !ID.test(lease_id)) malformed()
  if (typeof document_id !== 'string' || !ID.test(document_id)) malformed()
  if (typeof organization_id !== 'string' || !ID.test(organization_id)) malformed()
  if (typeof workspace_id !== 'string' || !ID.test(workspace_id)) malformed()
  if (typeof version_id !== 'string' || !ID.test(version_id)) malformed()
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) malformed()
  if (typeof revision !== 'string' || !REVISION.test(revision)) malformed()
  if (!isLeaseLevel(level)) malformed()
  if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1) {
    malformed()
  }
  if (!isIsoDate(expires_at) || !isIsoDate(renew_after) || !isIsoDate(server_time) || !isIsoDate(issued_at)) {
    malformed()
  }
  if (typeof policy_epoch !== 'number' || !Number.isSafeInteger(policy_epoch) || policy_epoch < 0) {
    malformed()
  }
  if (typeof renewed !== 'boolean') malformed()

  return {
    lease,
    lease_id,
    document_id,
    organization_id,
    workspace_id,
    version_id,
    version,
    revision,
    level,
    policy_epoch,
    generation,
    renewed,
    issued_at,
    expires_at,
    renew_after,
    server_time,
  }
}

export function parseLeaseError(status: number, body: unknown): LeaseFailure {
  const envelope = readEnvelope(body)
  const code = envelope?.code

  if (status === 401 || code === 'unauthorized' || code === 'device_revoked' || code === 'refresh_reused') {
    return {
      kind: 'session_expired',
      code: code === 'device_revoked' || code === 'refresh_reused' ? code : 'session_expired',
      status,
    }
  }

  if (code === 'offline_lease_revoked') {
    return {
      kind: 'revoked',
      code: 'offline_lease_revoked',
      status,
    }
  }

  if (code === 'offline_lease_device_required') {
    return {
      kind: 'device_required',
      code: 'offline_lease_device_required',
      status,
    }
  }

  if (code === 'offline_lease_limit_reached') {
    const rawLimit = envelope?.fields?.limit
    return {
      kind: 'limit_reached',
      code: 'offline_lease_limit_reached',
      status,
      ...(typeof rawLimit === 'number' && Number.isSafeInteger(rawLimit) ? { limit: rawLimit } : {}),
    }
  }

  if (code === 'document_archived') {
    return {
      kind: 'archived',
      code: 'document_archived',
      status,
    }
  }

  if (code === 'office_capability_off') {
    const capability =
      typeof envelope?.fields?.capability === 'string' && envelope.fields.capability
        ? envelope.fields.capability
        : 'offline_library'
    return {
      kind: 'capability_off',
      code: 'office_capability_off',
      status,
      capability,
    }
  }

  if (
    code === 'forbidden' ||
    code === 'permission_revoked' ||
    code === 'member_deactivated' ||
    code === 'organization_suspended' ||
    code === 'document_deleted' ||
    (status === 404 && code === 'not_found') ||
    (status === 410 && Boolean(code))
  ) {
    return {
      kind: 'access_denied',
      code: code ?? 'forbidden',
      status,
    }
  }

  return {
    kind: 'server_error',
    code: code ?? 'server_error',
    status,
  }
}

function isRedirectRefusal(error: unknown): boolean {
  const text = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ''))
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined
  return /redirect/i.test(text(error)) || /redirect/i.test(text(cause))
}

function classifyThrown(error: unknown): LeaseClientError {
  if (error instanceof LeaseClientError) return error
  if (error instanceof TransportError) {
    if (
      error.code === 'unauthorized' ||
      error.code === 'device_revoked' ||
      error.code === 'refresh_reused'
    ) {
      return new LeaseClientError({
        kind: 'session_expired',
        code: 'session_expired',
        status: error.status ?? 401,
      })
    }
    if (error.code === 'network' || error.code === 'timeout') {
      return new LeaseClientError({ kind: 'offline', code: error.code })
    }
  }
  if (error instanceof UniworkDocError) {
    if (error.code === 'network' || error.code === 'timeout') {
      return new LeaseClientError({ kind: 'offline', code: error.code })
    }
    if (error.code === 'session_expired' || error.code === 'not_signed_in') {
      return new LeaseClientError({ kind: 'session_expired', code: error.code })
    }
    if (error.code === 'malformed_response') {
      return new LeaseClientError({ kind: 'malformed_response', code: 'malformed_response' })
    }
  }
  return new LeaseClientError({ kind: 'server_error', code: 'server_error' })
}

export function createLeaseClient(options: AuthorizedGetOptions): LeaseClient {
  const base = `${new URL(options.apiOrigin).origin}/api/v1`
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
  const timeoutMs = options.timeoutMs ?? METADATA_TIMEOUT_MS

  const send = async (
    method: 'PUT' | 'DELETE',
    documentId: string,
    body?: { lease: string },
  ): Promise<{ status: number; text: string }> => {
    if (!ID.test(documentId)) {
      throw new LeaseClientError({ kind: 'access_denied', code: 'not_found', status: 404 })
    }
    if (!options.isSignedIn()) {
      throw new LeaseClientError({ kind: 'session_expired', code: 'not_signed_in' })
    }
    const url = `${base}/documents/${encodeURIComponent(documentId)}/office/offline-lease`
    try {
      return await options.authorized(async (token) => {
        const controller = new AbortController()
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          controller.abort()
        }, timeoutMs)
        try {
          const headers: Record<string, string> = {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          }
          if (body !== undefined) {
            headers['Content-Type'] = 'application/json'
          }
          let response: Response
          try {
            response = await fetchImpl(url, {
              method,
              headers,
              cache: 'no-store',
              redirect: 'error',
              signal: controller.signal,
              ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            })
          } catch (error) {
            if (timedOut) throw new UniworkDocError('timeout')
            throw new UniworkDocError(isRedirectRefusal(error) ? 'server_error' : 'network')
          }
          if (
            response.redirected ||
            (response.status >= 300 && response.status < 400) ||
            (response.url && !response.url.startsWith(`${base}/`))
          ) {
            throw new UniworkDocError('server_error')
          }
          if (response.status === 401) {
            throw new TransportError('unauthorized', 401)
          }
          let text: string
          try {
            text = await response.text()
          } catch {
            throw new UniworkDocError(timedOut ? 'timeout' : 'network')
          }
          if (timedOut) throw new UniworkDocError('timeout')
          if (text.length > MAX_BODY_CHARS) throw new UniworkDocError('malformed_response')
          return { status: response.status, text }
        } finally {
          clearTimeout(timer)
        }
      })
    } catch (error) {
      throw classifyThrown(error)
    }
  }

  return {
    async grant(documentId) {
      const outcome = await send('PUT', documentId)
      if (outcome.status < 200 || outcome.status >= 300) {
        throw new LeaseClientError(parseLeaseError(outcome.status, jsonOrUndefined(outcome.text)))
      }
      const sdo = parseLeaseSDO(outcome.text)
      if (sdo.document_id !== documentId) malformed()
      return sdo
    },

    async renew(documentId, lease) {
      if (typeof lease !== 'string' || lease.trim().length === 0) {
        return this.grant(documentId)
      }
      const outcome = await send('PUT', documentId, { lease })
      if (outcome.status < 200 || outcome.status >= 300) {
        throw new LeaseClientError(parseLeaseError(outcome.status, jsonOrUndefined(outcome.text)))
      }
      const sdo = parseLeaseSDO(outcome.text)
      if (sdo.document_id !== documentId) malformed()
      return sdo
    },

    async release(documentId) {
      const outcome = await send('DELETE', documentId)
      if (outcome.status < 200 || outcome.status >= 300) {
        throw new LeaseClientError(parseLeaseError(outcome.status, jsonOrUndefined(outcome.text)))
      }
    },
  }
}
