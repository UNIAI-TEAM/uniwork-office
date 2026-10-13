import type {
  UniworkDocFolderRef,
  UniworkDocFormat,
  UniworkDocNewFormat,
  UniworkDocSummary,
  UniworkWorkspaceRef,
} from '../../shared/home-api'
import { TransportError } from '../uniwork-auth/transport'
import { UniworkDocError, errorFromResponse } from './errors'
import { formatForName, isDecimalString, mimeForFormat } from './formats'
import {
  documentRevisionOf,
  parseCommit,
  parseDetail,
  parseDocumentList,
  parseDocumentSummary,
  parseExchange,
  parseFolders,
  parseMembershipRole,
  parseOrgMembers,
  parseProperties,
  parseSharedWithMe,
  parseUpload,
} from './parse'
import type {
  CommitReceipt,
  DocumentDetail,
  DocumentListResult,
  DocumentProperties,
  LaunchDescriptor,
  OrgMemberPage,
  UploadReceipt,
} from './parse'

/**
 * Main-process client for the UniWork documents routes this app uses, and
 * nothing else: every URL is the deployment's API origin + `/api/v1` + one
 * fixed route with validated ids. Requests never follow a redirect, never use
 * a cache, carry a deadline over the whole exchange (body included), and send
 * the bearer token only inside `authorized` (single in-flight refresh, one
 * retry on 401). Responses are parsed strictly from the server's snake_case
 * DTOs; anything else is `malformed_response`. `send` is shared with the work
 * client via createUniworkSend.
 */

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export const METADATA_TIMEOUT_MS = 30_000
export const TRANSFER_TIMEOUT_MS = 120_000
/** the server stages at most 50 MiB per upload; a download far past that is refused */
const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024
/**
 * The folder list follows D's `next_cursor` for the "Location" field. D caps a
 * page at 100 rows; 10 pages bound one read at 1000 folders, so a pathological
 * workspace cannot make the dialog read for ever (residual: past the bound the
 * remaining folders are not offered).
 */
const FOLDERS_PAGE_SIZE = 100
const FOLDERS_MAX_PAGES = 10
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
  /** the caller's effective role in one workspace, or null when the server sends none */
  workspaceRole(workspaceId: string): Promise<string | null>
  listDocuments(input: {
    workspaceId: string
    query?: string
    cursor?: string
    limit?: number
  }): Promise<DocumentListResult>
  /** documents shared directly with the caller in one workspace (paged) */
  listSharedWithMe(input: {
    workspaceId: string
    cursor?: string
    limit?: number
  }): Promise<DocumentListResult>
  /** the properties panel of one document (ids/times/level/version, no names) */
  documentProperties(documentId: string): Promise<DocumentProperties>
  /**
   * the workspace's folders (S18 location field): every `kind=folder` page,
   * following `next_cursor` up to `FOLDERS_MAX_PAGES` (a bigger workspace's
   * remaining folders are simply not offered - documented residual, no D change)
   */
  listFolders(workspaceId: string): Promise<UniworkDocFolderRef[]>
  /** create a blank document (S18); `format` must have a blank generator */
  createBlank(input: {
    workspaceId: string
    format: UniworkDocNewFormat
    title: string
    parentId: string | null
    idempotencyKey: string
  }): Promise<UniworkDocSummary>
  /** create one file document from local bytes (S18 upload); `signal` aborts the POST */
  createFile(input: {
    workspaceId: string
    bytes: Uint8Array
    filename: string
    title: string
    parentId: string | null
    idempotencyKey: string
    signal?: AbortSignal
  }): Promise<UniworkDocSummary>
  /**
   * rename a document (S18); the server compares `revision` and may answer a
   * conflict. The answer carries the row the renderer shows and the revision
   * this rename produced (the feed echo of it is recognisable by that revision)
   */
  rename(input: {
    documentId: string
    revision: string
    title: string
  }): Promise<{ summary: UniworkDocSummary; revision: string }>
  /** archive a document (S18); there is no hard-delete route */
  archive(documentId: string, idempotencyKey: string): Promise<UniworkDocSummary>
  /** restore an archived document (S18) */
  restore(documentId: string, idempotencyKey: string): Promise<UniworkDocSummary>
  /**
   * one page of org members (id + display name) for resolving the properties
   * panel's names; `cursor` is D's opaque `next_cursor` and `limit` is capped
   * at D's maximum (100)
   */
  listOrgMembers(input: {
    orgSlug: string
    cursor?: string
    limit?: number
  }): Promise<OrgMemberPage>
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

/** a route segment: an id the server issued, never a path (the work client uses it too) */
export function uniworkId(value: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new UniworkDocError('not_found')
  return encodeURIComponent(value)
}
const id = uniworkId

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

/** one request to a UniWork route (documents, and the Workbench's work routes) */
export interface UniworkCall<T> {
  method: 'GET' | 'POST' | 'PATCH'
  route: string
  query?: URLSearchParams
  json?: unknown
  form?: FormData
  idempotencyKey?: string
  /** the caller's abort (S18 upload cancel): aborts the request like a timeout */
  signal?: AbortSignal
  timeoutMs: number
  read(response: Response): Promise<T>
}

/** the hardened request every UniWork client in main goes through (see the header) */
export function createUniworkSend(
  options: UniworkDocsClientOptions,
): <T>(call: UniworkCall<T>) => Promise<T> {
  const origin = new URL(options.apiOrigin).origin
  const base = `${origin}/api/v1`
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))

  return async function send<T>(call: UniworkCall<T>): Promise<T> {
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
        // the caller's own abort rides the same controller as the deadline: one
        // signal ends the request, whatever started it. Once D answers an
        // accepted 2xx the bridge is detached (below), so a Cancel that lands
        // after the write was accepted still lets the answer be read
        const abortFromCaller = () => controller.abort()
        if (call.signal) {
          if (call.signal.aborted) controller.abort()
          else call.signal.addEventListener('abort', abortFromCaller, { once: true })
        }
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
          // D accepted the request (2xx): the caller's abort ends its job here,
          // so its created document is parsed and returned as usual (R2-2).
          // The deadline above stays armed for a body that never arrives.
          if (response.ok) call.signal?.removeEventListener('abort', abortFromCaller)
          if (
            response.redirected ||
            (response.status >= 300 && response.status < 400) ||
            (response.url && !response.url.startsWith(`${base}/`))
          ) {
            throw new UniworkDocError('server_error')
          }
          if (response.status === 401) {
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
          call.signal?.removeEventListener('abort', abortFromCaller)
        }
      })
    } catch (error) {
      throw fromAuthFailure(error)
    }
  }
}

export function createUniworkDocsClient(options: UniworkDocsClientOptions): UniworkDocsClient {
  const metadataTimeout = options.metadataTimeoutMs ?? METADATA_TIMEOUT_MS
  const transferTimeout = options.transferTimeoutMs ?? TRANSFER_TIMEOUT_MS
  const send = createUniworkSend(options)
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
        // the role is a second read per workspace (GET /workspaces/{id}/me); it
        // is filled by the service, not here, so this list stays one request
        return {
          id: r.id,
          name: r.name,
          orgId: rowOrg,
          slug: typeof r.slug === 'string' ? r.slug : '',
          orgSlug: typeof r.organization_slug === 'string' ? r.organization_slug : '',
          myRole: null,
        }
      })
    },

    async workspaceRole(workspaceId) {
      const raw = await send({
        method: 'GET',
        route: `/workspaces/${id(workspaceId)}/me`,
        timeoutMs: metadataTimeout,
        read: json,
      })
      return parseMembershipRole(raw)
    },

    async listSharedWithMe(input) {
      const params = new URLSearchParams()
      if (input.cursor) params.set('cursor', input.cursor.slice(0, 512))
      const limit = Math.min(100, Math.max(1, Math.floor(Number(input.limit) || 50)))
      params.set('limit', String(limit))
      const ws = id(input.workspaceId)
      const raw = await send({
        method: 'GET',
        route: `/workspaces/${ws}/documents/shared-with-me`,
        query: params,
        timeoutMs: metadataTimeout,
        read: json,
      })
      return parseSharedWithMe(raw, input.workspaceId)
    },

    async documentProperties(documentId) {
      const raw = await send({
        method: 'GET',
        route: `/documents/${id(documentId)}`,
        timeoutMs: metadataTimeout,
        read: json,
      })
      const properties = parseProperties(raw)
      if (properties.id !== documentId) throw new UniworkDocError('malformed_response')
      return properties
    },

    async listFolders(workspaceId) {
      const ws = id(workspaceId)
      const folders: UniworkDocFolderRef[] = []
      let cursor: string | undefined
      let pages = 0
      do {
        const params = new URLSearchParams()
        params.set('kind', 'folder')
        params.set('limit', String(FOLDERS_PAGE_SIZE))
        if (cursor) params.set('cursor', cursor.slice(0, 512))
        const raw = await send({
          method: 'GET',
          route: `/workspaces/${ws}/documents`,
          query: params,
          timeoutMs: metadataTimeout,
          read: json,
        })
        const page = parseFolders(raw)
        folders.push(...page.folders)
        cursor = page.nextCursor ?? undefined
        pages += 1
      } while (cursor && pages < FOLDERS_MAX_PAGES)
      return folders
    },

    async createBlank(input) {
      const raw = await send({
        method: 'POST',
        route: `/workspaces/${id(input.workspaceId)}/documents/files/blank`,
        json: {
          format: input.format,
          title: input.title,
          ...(input.parentId ? { parent_id: input.parentId } : {}),
        },
        idempotencyKey: input.idempotencyKey,
        timeoutMs: metadataTimeout,
        read: json,
      })
      return parseDocumentSummary(raw)
    },

    async createFile(input) {
      const form = new FormData()
      // the text fields precede the file part: the server streams the file part
      // and a title that trails it would fall back to the file name
      if (input.parentId) form.set('parent_id', input.parentId)
      form.set('title', input.title)
      form.set(
        'file',
        new Blob([input.bytes as BlobPart], { type: 'application/octet-stream' }),
        input.filename,
      )
      const raw = await send({
        method: 'POST',
        route: `/workspaces/${id(input.workspaceId)}/documents/files`,
        form,
        idempotencyKey: input.idempotencyKey,
        ...(input.signal ? { signal: input.signal } : {}),
        timeoutMs: transferTimeout,
        read: json,
      })
      return parseDocumentSummary(raw)
    },

    async rename(input) {
      if (!isDecimalString(input.revision)) throw new UniworkDocError('malformed_response')
      const raw = await send({
        method: 'PATCH',
        route: `/documents/${id(input.documentId)}`,
        json: { revision: input.revision, title: input.title },
        timeoutMs: metadataTimeout,
        read: json,
      })
      return { summary: parseDocumentSummary(raw), revision: documentRevisionOf(raw) }
    },

    async archive(documentId, idempotencyKey) {
      const raw = await send({
        method: 'POST',
        route: `/documents/${id(documentId)}/archive`,
        idempotencyKey,
        timeoutMs: metadataTimeout,
        read: json,
      })
      return parseDocumentSummary(raw)
    },

    async restore(documentId, idempotencyKey) {
      const raw = await send({
        method: 'POST',
        route: `/documents/${id(documentId)}/restore`,
        idempotencyKey,
        timeoutMs: metadataTimeout,
        read: json,
      })
      return parseDocumentSummary(raw)
    },

    async listOrgMembers(input) {
      // a slug is lowercase alphanumerics and dashes; anything else never leaves
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.orgSlug)) throw new UniworkDocError('not_found')
      const params = new URLSearchParams()
      // D caps `limit` at 100 (maxMemberPageSize); ask for the largest page so
      // a big tenant needs as few reads as possible
      const limit = Math.min(100, Math.max(1, Math.floor(Number(input.limit) || 100)))
      params.set('limit', String(limit))
      if (input.cursor) params.set('cursor', input.cursor.slice(0, 512))
      const raw = await send({
        method: 'GET',
        route: `/orgs/${input.orgSlug}/members`,
        query: params,
        timeoutMs: metadataTimeout,
        read: json,
      })
      return parseOrgMembers(raw)
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
      // a 401 refreshes once and retries like every other call: the server's
      // auth rejects before the ticket is consumed, so this never replays a
      // redeemed ticket; a second 401 is session_expired
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
