import type { UniworkDocFormat, UniworkWorkspaceRef } from '../../shared/home-api'
import { TransportError } from '../uniwork-auth/transport'
import { UniworkDocError, errorFromResponse } from './errors'
import { formatForName, isDecimalString, mimeForFormat } from './formats'
import { parseCommit, parseDetail, parseDocumentList, parseExchange, parseUpload } from './parse'
import type {
  CommitReceipt,
  DocumentDetail,
  DocumentListResult,
  LaunchDescriptor,
  UploadReceipt,
} from './parse'

/**
 * Main-process client for the UniWork documents routes this app uses, and
 * nothing else: every URL is the deployment's API origin + `/api/v1` + one
 * fixed route with validated ids. Requests never follow a redirect, never use
 * a cache, carry a deadline over the whole exchange (body included), and send
 * the bearer token only inside `authorized` (single in-flight refresh, one
 * retry on 401). Responses are parsed strictly from the server's snake_case
 * DTOs; anything else is `malformed_response`.
 */

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export const METADATA_TIMEOUT_MS = 30_000
export const TRANSFER_TIMEOUT_MS = 120_000
/** the server stages at most 50 MiB per upload; a download far past that is refused */
const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024
const ID = /^[A-Za-z0-9_-]{1,128}$/

export interface UniworkDocsClientOptions {
  /** normalized deployment origin (no trailing slash), validated by the profile */
  apiOrigin: string
  /** the auth module's authorizedRequest */
  authorized<T>(call: (token: string) => Promise<T>): Promise<T>
  isSignedIn(): boolean
  fetch?: FetchLike
  metadataTimeoutMs?: number
  transferTimeoutMs?: number
}

export interface DownloadResult {
  bytes: Uint8Array
}

export interface UniworkDocsClient {
  listWorkspaces(orgId: string): Promise<UniworkWorkspaceRef[]>
  listDocuments(input: {
    workspaceId: string
    query?: string
    cursor?: string
    limit?: number
  }): Promise<DocumentListResult>
  getDocument(documentId: string): Promise<DocumentDetail>
  download(documentId: string, version?: number): Promise<DownloadResult>
  upload(input: {
    documentId: string
    bytes: Uint8Array
    filename: string
    format: UniworkDocFormat
    idempotencyKey: string
  }): Promise<UploadReceipt>
  commit(input: {
    documentId: string
    uploadId: string
    baseRevision: string
    idempotencyKey: string
  }): Promise<CommitReceipt>
  exchange(input: {
    launchTicket: string
    deploymentId: string
    clientId: string
    deviceSessionId: string
  }): Promise<LaunchDescriptor>
}

function id(value: string): string {
  if (!ID.test(value)) throw new UniworkDocError('not_found')
  return encodeURIComponent(value)
}

/** a refused redirect surfaces as a fetch TypeError whose cause names it */
function isRedirectRefusal(error: unknown): boolean {
  const text = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ''))
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined
  return /redirect/i.test(text(error)) || /redirect/i.test(text(cause))
}

function fromAuthFailure(error: unknown): UniworkDocError {
  if (error instanceof UniworkDocError) return error
  if (error instanceof TransportError) {
    if (error.code === 'network') return new UniworkDocError('network')
    if (error.code === 'timeout') return new UniworkDocError('timeout')
    if (error.code === 'wrong_deployment') return new UniworkDocError('wrong_deployment')
    if (
      error.code === 'unauthorized' ||
      error.code === 'device_revoked' ||
      error.code === 'refresh_reused'
    ) {
      return new UniworkDocError('session_expired')
    }
  }
  return new UniworkDocError('server_error')
}

export function createUniworkDocsClient(options: UniworkDocsClientOptions): UniworkDocsClient {
  const origin = new URL(options.apiOrigin).origin
  const base = `${origin}/api/v1`
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
  const metadataTimeout = options.metadataTimeoutMs ?? METADATA_TIMEOUT_MS
  const transferTimeout = options.transferTimeoutMs ?? TRANSFER_TIMEOUT_MS

  interface Call<T> {
    method: 'GET' | 'POST'
    route: string
    query?: URLSearchParams
    json?: unknown
    form?: FormData
    idempotencyKey?: string
    timeoutMs: number
    /** false: a 401 is final (the launch exchange never replays a ticket) */
    retryOn401?: boolean
    read(response: Response): Promise<T>
  }

  async function send<T>(call: Call<T>): Promise<T> {
    if (!options.isSignedIn()) throw new UniworkDocError('not_signed_in')
    const query = call.query?.toString()
    const url = `${base}${call.route}${query ? `?${query}` : ''}`
    if (!url.startsWith(`${base}/`)) throw new UniworkDocError('server_error')
    try {
      return await options.authorized(async (token) => {
        const headers: Record<string, string> = {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        }
        if (call.json !== undefined) headers['Content-Type'] = 'application/json'
        if (call.idempotencyKey) headers['Idempotency-Key'] = call.idempotencyKey
        const controller = new AbortController()
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          controller.abort()
        }, call.timeoutMs)
        try {
          let response: Response
          try {
            response = await fetchImpl(url, {
              method: call.method,
              headers,
              cache: 'no-store',
              redirect: 'error',
              signal: controller.signal,
              ...(call.json !== undefined ? { body: JSON.stringify(call.json) } : {}),
              ...(call.form ? { body: call.form } : {}),
            })
          } catch (error) {
            if (timedOut) throw new UniworkDocError('timeout')
            // a redirect means another host or path answered: never followed
            throw new UniworkDocError(isRedirectRefusal(error) ? 'server_error' : 'network')
          }
          if (
            response.redirected ||
            (response.status >= 300 && response.status < 400) ||
            (response.url && !response.url.startsWith(`${base}/`))
          ) {
            throw new UniworkDocError('server_error')
          }
          if (response.status === 401 && call.retryOn401 !== false) {
            // authorized() refreshes once and calls again; a second 401 ends it
            throw new TransportError('unauthorized', 401)
          }
          if (!response.ok) {
            const body: unknown = await response.json().catch(() => undefined)
            throw timedOut
              ? new UniworkDocError('timeout')
              : errorFromResponse(response.status, body)
          }
          try {
            return await call.read(response)
          } catch (error) {
            if (timedOut) throw new UniworkDocError('timeout')
            throw error instanceof UniworkDocError
              ? error
              : new UniworkDocError('malformed_response')
          }
        } finally {
          clearTimeout(timer)
        }
      })
    } catch (error) {
      throw fromAuthFailure(error)
    }
  }

  const json = (response: Response): Promise<unknown> => response.json()

  return {
    async listWorkspaces(orgId) {
      const raw = await send({
        method: 'GET',
        route: `/orgs/${id(orgId)}/workspaces`,
        timeoutMs: metadataTimeout,
        read: json,
      })
      if (
        !raw ||
        typeof raw !== 'object' ||
        !Array.isArray((raw as { workspaces?: unknown }).workspaces)
      ) {
        throw new UniworkDocError('malformed_response')
      }
      return (raw as { workspaces: unknown[] }).workspaces.map((row) => {
        const r = (row ?? {}) as Record<string, unknown>
        if (typeof r.id !== 'string' || !r.id || typeof r.name !== 'string') {
          throw new UniworkDocError('malformed_response')
        }
        const rowOrg =
          typeof r.organization_id === 'string' && r.organization_id ? r.organization_id : orgId
        return { id: r.id, name: r.name, orgId: rowOrg }
      })
    },

    async listDocuments(input) {
      const params = new URLSearchParams()
      const q = input.query?.trim().slice(0, 200) ?? ''
      if (q) params.set('q', q)
      if (input.cursor) params.set('cursor', input.cursor.slice(0, 512))
      const limit = Math.min(100, Math.max(1, Math.floor(Number(input.limit) || 50)))
      params.set('limit', String(limit))
      params.set('kind', 'file')
      const ws = id(input.workspaceId)
      const raw = await send({
        method: 'GET',
        route: q ? `/workspaces/${ws}/documents` : `/workspaces/${ws}/documents/recent`,
        query: params,
        timeoutMs: metadataTimeout,
        read: json,
      })
      return parseDocumentList(raw, input.workspaceId)
    },

    async getDocument(documentId) {
      const raw = await send({
        method: 'GET',
        route: `/documents/${id(documentId)}`,
        timeoutMs: metadataTimeout,
        read: json,
      })
      const detail = parseDetail(raw)
      if (detail.id !== documentId) throw new UniworkDocError('malformed_response')
      return detail
    },

    async download(documentId, version) {
      const query = new URLSearchParams()
      if (version !== undefined && version > 0) query.set('version', String(Math.floor(version)))
      return send({
        method: 'GET',
        route: `/documents/${id(documentId)}/download`,
        query,
        timeoutMs: transferTimeout,
        async read(response) {
          const length = Number(response.headers.get('Content-Length') ?? '0')
          if (length > MAX_DOWNLOAD_BYTES) throw new UniworkDocError('too_large')
          const bytes = new Uint8Array(await response.arrayBuffer())
          if (bytes.byteLength > MAX_DOWNLOAD_BYTES) throw new UniworkDocError('too_large')
          return { bytes }
        },
      })
    },

    async upload(input) {
      const form = new FormData()
      const name = formatForName(input.filename) ? input.filename : `document.${input.format}`
      form.set(
        'file',
        new Blob([input.bytes as BlobPart], { type: mimeForFormat(input.format) }),
        name,
      )
      const raw = await send({
        method: 'POST',
        route: `/documents/${id(input.documentId)}/uploads`,
        form,
        idempotencyKey: input.idempotencyKey,
        timeoutMs: transferTimeout,
        read: json,
      })
      return parseUpload(raw)
    },

    async commit(input) {
      if (!isDecimalString(input.baseRevision)) throw new UniworkDocError('malformed_response')
      const raw = await send({
        method: 'POST',
        route: `/documents/${id(input.documentId)}/versions/commit`,
        json: { upload_id: input.uploadId, base_revision: input.baseRevision },
        idempotencyKey: input.idempotencyKey,
        timeoutMs: metadataTimeout,
        read: json,
      })
      return parseCommit(raw)
    },

    async exchange(input) {
      let raw: unknown
      try {
        raw = await send({
          method: 'POST',
          route: '/office/sessions/exchange',
          json: {
            launch_ticket: input.launchTicket,
            deployment_id: input.deploymentId,
            client_id: input.clientId,
            device_session_id: input.deviceSessionId,
          },
          timeoutMs: metadataTimeout,
          retryOn401: false,
          read: json,
        })
      } catch (error) {
        const failure = fromAuthFailure(error)
        if (failure.status === 403) throw new UniworkDocError('forbidden', { status: 403 })
        if (failure.status === 404 || failure.status === 410) {
          throw new UniworkDocError('ticket_invalid', { status: failure.status })
        }
        if (failure.status !== undefined && failure.status !== 401) {
          throw new UniworkDocError('server_error', { status: failure.status })
        }
        throw failure
      }
      return parseExchange(raw)
    },
  }
}
