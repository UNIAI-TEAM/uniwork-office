import type {
  UniworkCreateVisibility,
  UniworkDocErrorCode,
  UniworkDocFormat,
  UniworkDocNewFormat,
  UniworkDocSummary,
  UniworkFolderNode,
  UniworkListFilters,
  UniworkWorkspaceRef,
} from '../../shared/home-api'
import { TransportError } from '../uniwork-auth/transport'
import { UniworkDocError, errorFromResponse, parseRetryAfter } from './errors'
import { formatForName, isDecimalString, mimeForFormat } from './formats'
import { DEFAULT_DOCUMENT_LIMITS, parseDocumentLimits, type DocumentLimits } from './limits'
import {
  documentRevisionOf,
  parseCommit,
  parseCommitLookup,
  parseDetail,
  parseDocumentList,
  parseDocumentRef,
  parseDocumentSummary,
  parseExchange,
  parseFolderTree,
  parseMembershipRole,
  parseOrgMembers,
  parseProperties,
  parseSharedWithMe,
  parseUpload,
} from './parse'
import type {
  CommitLookup,
  CommitReceipt,
  DocumentDetail,
  DocumentListResult,
  DocumentProperties,
  DocumentRef,
  LaunchDescriptor,
  OrgMemberName,
  OrgMemberPage,
  UploadReceipt,
  UploadSessionComplete,
  UploadSessionState,
} from './parse'
import { parseUploadSession, parseUploadSessionComplete } from './parse'

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
/**
 * R5BE-9: the overall ceiling of one streamed download. Its deadline is an
 * idle one (TRANSFER_TIMEOUT_MS with no chunk), so a slow link that keeps
 * delivering finishes; this bounds a body that trickles for ever (256 MiB in
 * an hour is ~75 KB/s on average).
 */
export const STREAM_CEILING_MS = 60 * 60_000
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
  /** R5BE-9: test seam for STREAM_CEILING_MS */
  streamCeilingMs?: number
}

export interface DownloadResult {
  bytes: Uint8Array
}

/** G5-05: what a streamed download reports and how it is cancelled */
export interface DownloadStreamOptions {
  /** aborts the request, and the body read once the server answered */
  signal?: AbortSignal
  /** after every received chunk; `totalBytes` is the Content-Length when sent */
  onProgress?(progress: { receivedBytes: number; totalBytes: number | null }): void
}

/**
 * MYFOLDER-01 / SAVE-01: where a create lands. `parentId` (null = the
 * workspace root) or `destination: 'my_folder'` (the caller's personal My
 * Folder, ensured lazily by the server) - D's validateDocumentDestination
 * refuses a request carrying both with 400 `invalid_destination`, so the type
 * makes it unwritable: a set `parentId` never shares the call with
 * `destination` (`destination?: never`). `parentId: null` beside
 * `destination` stays legal because it never reaches the wire.
 */
export type UniworkCreateTarget =
  { parentId: string; destination?: never } | { parentId?: null; destination?: 'my_folder' }

export interface UniworkDocsClient {
  /**
   * MYFOLDER-01 / SAVE-01: `POST /workspaces/{ws}/documents/my-folder` -
   * lazily creates and returns the caller's personal "My Folder"
   * (system_kind='my_folder'), always a 200 DocumentSDO. The Save dialog
   * calls it on open so the "Đang lưu trong" row can name it.
   */
  ensureMyFolder(workspaceId: string): Promise<UniworkDocSummary>
  listWorkspaces(orgId: string): Promise<UniworkWorkspaceRef[]>
  /** the caller's effective role in one workspace, or null when the server sends none */
  workspaceRole(workspaceId: string): Promise<string | null>
  listDocuments(
    input: {
      workspaceId: string
      query?: string
      cursor?: string
      limit?: number
      /** UNI-1953: keep UniNote pages too (the Documents home); default files only */
      includePages?: boolean
    } & UniworkListFilters,
  ): Promise<DocumentListResult>
  /** documents shared directly with the caller in one workspace (paged) */
  listSharedWithMe(input: {
    workspaceId: string
    cursor?: string
    limit?: number
    /** UNI-1953: keep UniNote pages too (the Documents home); default files only */
    includePages?: boolean
  }): Promise<DocumentListResult>
  /** DESKTOP-HOME: documents shared by the caller in one workspace (paged) */
  listSharedByMe(
    input: {
      workspaceId: string
      cursor?: string
      limit?: number
    } & UniworkListFilters,
  ): Promise<DocumentListResult>
  /** DESKTOP-HOME: archived documents in the workspace's trash (`archived=1`, paged) */
  listTrash(
    input: {
      workspaceId: string
      cursor?: string
      limit?: number
    } & UniworkListFilters,
  ): Promise<DocumentListResult>
  /** DESKTOP-HOME: workspace members (`GET /workspaces/{ws}/members`) for row updater names */
  listWorkspaceMembers(workspaceId: string): Promise<OrgMemberName[]>
  /** the properties panel of one document (ids/times/level/version, no names) */
  documentProperties(documentId: string): Promise<DocumentProperties>
  /**
   * FD-11: the workspace's whole folder tree (`folders_only=true`), root nodes
   * first, following no cursor (the route answers the tree in one body).
   */
  folderTree(workspaceId: string): Promise<UniworkFolderNode[]>
  /**
   * FD-11: one folder's contents - folders, files and pages in the server's
   * order. `parentId: null` is the workspace root, sent as an empty
   * `parent_id` (omitting it would mean the workspace's whole list).
   */
  listChildren(
    input: {
      workspaceId: string
      parentId: string | null
      cursor?: string
      limit?: number
    } & UniworkListFilters,
  ): Promise<DocumentListResult>
  /**
   * FD-11: title search across a workspace (`match=title`); every row carries
   * the ancestors it sits under. `kind: 'all'` sends no kind filter.
   */
  searchDocuments(input: {
    workspaceId: string
    query: string
    kind: 'all' | 'folder' | 'document'
    cursor?: string
    limit?: number
  }): Promise<DocumentListResult>
  /** FD-11: create one folder in a workspace/folder (root when `parentId` is null) */
  createFolder(input: {
    workspaceId: string
    parentId: string | null
    title: string
    idempotencyKey: string
  }): Promise<UniworkDocSummary>
  /** FD-11: one document's own fields, whatever its kind (rename/move read this) */
  documentRef(documentId: string): Promise<DocumentRef>
  /**
   * FD-11: move a document or folder under another folder (null = the root).
   * The current revision is read first; a `revision_conflict` re-reads it once
   * and retries. `renamedTo` is the title the server gave the document when a
   * name collision made it rename itself.
   */
  moveDocument(input: {
    documentId: string
    parentId: string | null
    idempotencyKey: string
  }): Promise<{ summary: UniworkDocSummary; renamedTo: string | null }>
  /** create a blank document (S18); `format` must have a blank generator */
  createBlank(
    input: {
      workspaceId: string
      format: UniworkDocNewFormat
      title: string
      /** UNI-1959: "Share with workspace"; absent = the server's default (a document only; a folder is never shared) */
      visibility?: UniworkCreateVisibility
      idempotencyKey: string
    } & UniworkCreateTarget,
  ): Promise<UniworkDocSummary>
  /** UNI-1953: create a UniNote (`kind: 'page'`) on the documents route, placed like a blank file */
  createPage(
    input: {
      workspaceId: string
      title: string
      /** UNI-1959: "Share with workspace"; absent = the server's default (a document only; a folder is never shared) */
      visibility?: UniworkCreateVisibility
      idempotencyKey: string
    } & UniworkCreateTarget,
  ): Promise<UniworkDocSummary>
  /** create one file document from local bytes (S18 upload); `signal` aborts the POST */
  createFile(
    input: {
      workspaceId: string
      bytes: Uint8Array
      filename: string
      title: string
      idempotencyKey: string
      signal?: AbortSignal
    } & UniworkCreateTarget,
  ): Promise<UniworkDocSummary>
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
  /**
   * G5-12: `POST /documents/{id}/copies` - a standalone copy that keeps the
   * source's ACL and provenance. `consent: "copy"` is the only accepted value
   * (an explicit choice). The answer is the new document and its revision
   * (the copy's version 1), the base of the commit that follows.
   */
  copyDocument(input: {
    documentId: string
    title: string
    parentId: string | null
    idempotencyKey: string
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
  /**
   * G5-05: the same download read chunk by chunk, with progress and cancel.
   * Same route and the same 256 MiB cap, checked from Content-Length and again
   * while the body streams. A cancel or a broken body is `network`.
   */
  downloadStream(
    documentId: string,
    version: number | undefined,
    options?: DownloadStreamOptions,
  ): Promise<DownloadResult>
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
    /** EL-1(b): the held lock of this path; omitted on the copy flow */
    editLockId?: string
  }): Promise<CommitReceipt>
  /**
   * What became of a commit intent (G5-07). A 410 `commit_intent_unknown` is
   * the `unknown` verdict, not a failure: the caller keeps reconciling and
   * never mints a new key on it.
   */
  lookupCommit(input: { documentId: string; idempotencyKey: string }): Promise<CommitLookup>
  exchange(input: {
    launchTicket: string
    deploymentId: string
    clientId: string
    deviceSessionId: string
  }): Promise<LaunchDescriptor>
  /** SIZE-F1: reads `documents.limits` from `GET /api/v1/config` with fallback defaults */
  getDocumentLimits?(): Promise<DocumentLimits>
  /**
   * BIGUP-A1: opens a multipart upload session for a NEW file document
   * (`POST /workspaces/{ws}/documents/upload-sessions`). `parent_id`/`title`/
   * `visibility` are this route's alone; `Idempotency-Key` is mandatory (the
   * server answers 400 without one) and the same key with the same body
   * replays the same session. Its `complete` answers the created document.
   */
  createWorkspaceUploadSession(input: {
    workspaceId: string
    filename: string
    sizeBytes: number
    probe: LocalFileProbePayload
    idempotencyKey: string
    parentId?: string | null
    title?: string
    visibility?: string | null
    signal?: AbortSignal
  }): Promise<UploadSessionState>
  /**
   * BIGUP-A1: opens a multipart upload session for a NEW VERSION of an
   * existing document (`POST /documents/{id}/upload-sessions`). Its `complete`
   * answers the staged upload the existing `versions/commit` claims.
   */
  createDocumentUploadSession(input: {
    documentId: string
    filename: string
    sizeBytes: number
    probe: LocalFileProbePayload
    idempotencyKey: string
    signal?: AbortSignal
  }): Promise<UploadSessionState>
  /**
   * BIGUP-A1: the session's status plus a fresh presigned URL for every part
   * still missing (`GET /upload-sessions/{id}`). A session that expired, was
   * aborted or GC'd answers 410; an unknown one 404.
   */
  getUploadSession(sessionId: string, signal?: AbortSignal): Promise<UploadSessionState>
  /**
   * BIGUP-A1: assembles the parts and validates the file
   * (`POST /upload-sessions/{id}/complete`). Idempotent: a repeat of a
   * finished session answers the same result. `signal` (R1-BE-02) cancels the
   * call like every other `send()` route: an abort BEFORE D accepted the
   * request ends it, an abort after the accepted 2xx is ignored and the answer
   * is read as usual (the same boundary the create paths use).
   */
  completeUploadSession(input: {
    sessionId: string
    parts: Array<{ partNumber: number; etag: string }>
    signal?: AbortSignal
  }): Promise<UploadSessionComplete>
  /** BIGUP-A1: aborts the session and releases its reserved quota (204) */
  deleteUploadSession(sessionId: string): Promise<void>
  /**
   * BIGUP-A1: one part straight to the presigned storage URL - no UniWork auth
   * header, no cookies, `credentials: 'omit'`; the answer's `ETag` header is
   * what `complete` needs. A part PUT never goes through `send()`: it is not a
   * UniWork route and must not carry the session token.
   */
  putUploadPart(input: {
    partNumber: number
    url: string
    headers?: Record<string, string>
    bytes: Uint8Array
    signal?: AbortSignal
  }): Promise<{ etag: string }>
}

/**
 * BIGUP-A1: the probe of the local file a session is opened for, as the wire
 * spells it (snake_case). `readLocalFileProbe` builds it; the client only sends
 * it. `cd_offset`/`cd_size` are null for a container that has no central
 * directory (PDF, plain text).
 */
export interface LocalFileProbePayload {
  head_b64: string
  central_dir_b64: string
  cd_offset: number | null
  cd_size: number | null
}

/** a route segment: an id the server issued, never a path (the work client uses it too) */
export function uniworkId(value: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new UniworkDocError('not_found')
  return encodeURIComponent(value)
}
const id = uniworkId
/**
 * SAVE-01 r2 (S01-R1-5): a `parent_id` that reaches the wire. Absent/null is
 * the caller's "no folder" (the field is then omitted - the absence IS the
 * root); a non-empty string passes through. An EMPTY or blank string is a
 * malformed target: refused `invalid_destination`, never silently omitted -
 * omitting it would create the document at the workspace root instead of the
 * intended destination.
 */
function parentOf(parentId: string | null | undefined): string | null {
  if (parentId === undefined || parentId === null) return null
  if (typeof parentId !== 'string' || !parentId.trim()) {
    throw new UniworkDocError('invalid_destination' as UniworkDocErrorCode)
  }
  return parentId
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

/** one request to a UniWork route (documents, and the Workbench's work routes) */
export interface UniworkCall<T> {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  route: string
  query?: URLSearchParams
  json?: unknown
  form?: FormData
  idempotencyKey?: string
  /** the caller's abort (S18 upload cancel): aborts the request like a timeout */
  signal?: AbortSignal
  timeoutMs: number
  /**
   * R5BE-9: `timeoutMs` is an idle deadline instead of a whole-exchange one -
   * it starts again every time `read` reports progress - and `ceilingMs`
   * bounds the whole exchange. Only the streamed download sets it.
   */
  idle?: { ceilingMs: number }
  read(response: Response, progress?: () => void): Promise<T>
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
        const expire = () => {
          timedOut = true
          controller.abort()
        }
        let timer = setTimeout(expire, call.timeoutMs)
        const ceiling = call.idle ? setTimeout(expire, call.idle.ceilingMs) : undefined
        // R5BE-9: a chunk arrived - the idle deadline starts again
        const progress = () => {
          if (!call.idle || timedOut) return
          clearTimeout(timer)
          timer = setTimeout(expire, call.timeoutMs)
        }
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
              : errorFromResponse(
                  response.status,
                  body,
                  // a Retry-After on a throttle / the in-flight idempotency
                  // verdict rides on the error (see errorFromResponse)
                  parseRetryAfter(response.headers.get('Retry-After')),
                )
          }
          try {
            return await call.read(response, progress)
          } catch (error) {
            if (timedOut) throw new UniworkDocError('timeout')
            throw error instanceof UniworkDocError
              ? error
              : new UniworkDocError('malformed_response')
          }
        } finally {
          clearTimeout(timer)
          clearTimeout(ceiling)
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
  const streamCeiling = options.streamCeilingMs ?? STREAM_CEILING_MS
  const send = createUniworkSend(options)
  const json = (response: Response): Promise<unknown> => response.json()
  /**
   * DESKTOP-HOME list filters. Returns whether the flat `/documents` route is
   * REQUIRED: the server forwards `format` to `/documents/recent`
   * (`internal/service/document_search.go:650,665-675`), but not `updated_by` or
   * `updated_from`, so only those two force the wider workspace list.
   */
  const applyListFilters = (params: URLSearchParams, input: UniworkListFilters): boolean => {
    let flatRequired = false
    if (typeof input.format === 'string' && input.format) {
      params.set('format', input.format)
    }
    const updatedBy =
      typeof input.updatedBy === 'string' ? input.updatedBy.trim().slice(0, 128) : ''
    if (updatedBy) {
      params.set('updated_by', updatedBy)
      flatRequired = true
    }
    const updatedFrom =
      typeof input.updatedFrom === 'string' ? input.updatedFrom.trim().slice(0, 64) : ''
    if (updatedFrom) {
      params.set('updated_from', updatedFrom)
      flatRequired = true
    }
    return flatRequired
  }
  /**
   * FD-11: one document's own fields, whatever its kind (a folder has no file
   * block, so the detail reader cannot serve it). Rename and move read the
   * revision, the current title and the level from here.
   */
  const readDocumentRef = async (documentId: string): Promise<DocumentRef> => {
    const raw = await send({
      method: 'GET',
      route: `/documents/${id(documentId)}`,
      timeoutMs: metadataTimeout,
      read: json,
    })
    const ref = parseDocumentRef(raw)
    if (ref.id !== documentId) throw new UniworkDocError('malformed_response')
    return ref
  }

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

    async ensureMyFolder(workspaceId) {
      // MYFOLDER-01: empty-body POST; the server creates the folder on the
      // first call and answers the same DocumentSDO on every later one
      const raw = await send({
        method: 'POST',
        route: `/workspaces/${id(workspaceId)}/documents/my-folder`,
        timeoutMs: metadataTimeout,
        read: json,
      })
      return parseDocumentSummary(raw)
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
      return parseSharedWithMe(raw, input.workspaceId, input.includePages === true)
    },

    async listSharedByMe(input) {
      const params = new URLSearchParams()
      params.set('shared_by_me', 'true')
      const limit = Math.min(100, Math.max(1, Math.floor(Number(input.limit) || 50)))
      params.set('limit', String(limit))
      if (input.cursor) params.set('cursor', input.cursor.slice(0, 512))
      applyListFilters(params, input)
      const ws = id(input.workspaceId)
      const raw = await send({
        method: 'GET',
        route: `/workspaces/${ws}/documents`,
        query: params,
        timeoutMs: metadataTimeout,
        read: json,
      })
      return parseDocumentList(raw, input.workspaceId)
    },

    async listTrash(input) {
      const params = new URLSearchParams()
      params.set('archived', '1')
      const limit = Math.min(100, Math.max(1, Math.floor(Number(input.limit) || 50)))
      params.set('limit', String(limit))
      if (input.cursor) params.set('cursor', input.cursor.slice(0, 512))
      applyListFilters(params, input)
      const ws = id(input.workspaceId)
      const raw = await send({
        method: 'GET',
        route: `/workspaces/${ws}/documents`,
        query: params,
        timeoutMs: metadataTimeout,
        read: json,
      })
      return parseDocumentList(raw, input.workspaceId)
    },

    async listWorkspaceMembers(workspaceId) {
      const raw = await send({
        method: 'GET',
        route: `/workspaces/${id(workspaceId)}/members`,
        timeoutMs: metadataTimeout,
        read: json,
      })
      return parseOrgMembers(raw).members
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

    async folderTree(workspaceId) {
      const params = new URLSearchParams()
      // the tree route answers folders only; without the flag it lists everything
      params.set('folders_only', 'true')
      const raw = await send({
        method: 'GET',
        route: `/workspaces/${id(workspaceId)}/documents/tree`,
        query: params,
        timeoutMs: metadataTimeout,
        read: json,
      })
      return parseFolderTree(raw)
    },

    async listChildren(input) {
      const params = new URLSearchParams()
      // the root is an EMPTY `parent_id` on purpose: with the parameter absent
      // the route answers the workspace's whole list, not the root's children
      params.set('parent_id', input.parentId === null ? '' : id(input.parentId))
      const limit = Math.min(100, Math.max(1, Math.floor(Number(input.limit) || 50)))
      params.set('limit', String(limit))
      if (input.cursor) params.set('cursor', input.cursor.slice(0, 512))
      applyListFilters(params, input)
      const ws = id(input.workspaceId)
      const raw = await send({
        method: 'GET',
        route: `/workspaces/${ws}/documents`,
        query: params,
        timeoutMs: metadataTimeout,
        read: json,
      })
      return parseDocumentList(raw, input.workspaceId)
    },

    async searchDocuments(input) {
      const params = new URLSearchParams()
      // D matches the query against the title only on this route
      params.set('match', 'title')
      const q = input.query.trim().slice(0, 200)
      if (q) params.set('q', q)
      // `document` is the server's value for "everything that is not a folder"
      // (pages included); 'all' sends no kind at all
      if (input.kind !== 'all') params.set('kind', input.kind)
      const limit = Math.min(100, Math.max(1, Math.floor(Number(input.limit) || 50)))
      params.set('limit', String(limit))
      if (input.cursor) params.set('cursor', input.cursor.slice(0, 512))
      const ws = id(input.workspaceId)
      const raw = await send({
        method: 'GET',
        route: `/workspaces/${ws}/documents`,
        query: params,
        timeoutMs: metadataTimeout,
        read: json,
      })
      return parseDocumentList(raw, input.workspaceId)
    },

    async createFolder(input) {
      const raw = await send({
        method: 'POST',
        route: `/workspaces/${id(input.workspaceId)}/documents`,
        json: {
          kind: 'folder',
          title: input.title,
          // the root is the field's absence, never an empty string; an
          // empty/blank parent_id is refused outright (S01-R1-5)
          ...(parentOf(input.parentId) ? { parent_id: parentOf(input.parentId) } : {}),
        },
        idempotencyKey: input.idempotencyKey,
        timeoutMs: metadataTimeout,
        read: json,
      })
      return parseDocumentSummary(raw)
    },

    documentRef: readDocumentRef,

    async moveDocument(input) {
      const documentId = input.documentId
      const target = input.parentId === null ? null : id(input.parentId)
      let ref = await readDocumentRef(documentId)
      for (let attempt = 0; ; attempt += 1) {
        try {
          const raw = await send({
            method: 'POST',
            route: `/documents/${id(documentId)}/move`,
            // `parent_id` is always sent: null IS the root, while the absent
            // field would leave the document where it is
            json: { parent_id: target, revision: ref.revision },
            idempotencyKey: input.idempotencyKey,
            timeoutMs: metadataTimeout,
            read: json,
          })
          const summary = parseDocumentSummary(raw)
          // the server renamed it on a name collision ("Name (2)"): that is the
          // only case in which its title differs from the one read before
          return { summary, renamedTo: summary.title === ref.title ? null : summary.title }
        } catch (error) {
          // the head moved between our read and the move: re-read it once and
          // retry; a second conflict is the caller's to report
          const raced =
            attempt === 0 &&
            error instanceof UniworkDocError &&
            error.serverCode === 'revision_conflict'
          if (!raced) throw error
          ref = await readDocumentRef(documentId)
        }
      }
    },

    async createBlank(input) {
      const raw = await send({
        method: 'POST',
        route: `/workspaces/${id(input.workspaceId)}/documents/files/blank`,
        json: {
          format: input.format,
          title: input.title,
          // MYFOLDER-01: mutually exclusive with destination (the input type
          // cannot carry both); an empty/blank parent_id is refused outright,
          // never silently demoted to a root create (S01-R1-5)
          ...(parentOf(input.parentId) ? { parent_id: parentOf(input.parentId) } : {}),
          ...(input.destination ? { destination: input.destination } : {}),
          ...(input.visibility ? { visibility: input.visibility } : {}),
        },
        idempotencyKey: input.idempotencyKey,
        timeoutMs: metadataTimeout,
        read: json,
      })
      return parseDocumentSummary(raw)
    },

    async createPage(input) {
      const raw = await send({
        method: 'POST',
        route: `/workspaces/${id(input.workspaceId)}/documents`,
        json: {
          kind: 'page',
          title: input.title,
          // the same exclusive placement as createBlank (S01-R1-5)
          ...(parentOf(input.parentId) ? { parent_id: parentOf(input.parentId) } : {}),
          ...(input.destination ? { destination: input.destination } : {}),
          ...(input.visibility ? { visibility: input.visibility } : {}),
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
      const parent = parentOf(input.parentId)
      if (parent) form.set('parent_id', parent)
      // MYFOLDER-01: `destination` is a form field too, exclusive with
      // parent_id (the input type cannot carry both)
      if (input.destination) form.set('destination', input.destination)
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

    async copyDocument(input) {
      const raw = await send({
        method: 'POST',
        route: `/documents/${id(input.documentId)}/copies`,
        json: {
          consent: 'copy',
          title: input.title,
          ...(parentOf(input.parentId) ? { parent_id: parentOf(input.parentId) } : {}),
        },
        idempotencyKey: input.idempotencyKey,
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
      // UNI-1953: the Documents home also lists pages (`document` = files and
      // pages, no folders); every other caller stays files only
      params.set('kind', input.includePages ? 'document' : 'file')
      // DH1-BE-1: `/documents/recent` forwards `format` (server
      // document_search.go:650,665-675), so a format-only Recent keeps the
      // caller's recent scope. `q` and the non-forwardable updater/date filters
      // still need the flat workspace list.
      const flatRequired = applyListFilters(params, input)
      const ws = id(input.workspaceId)
      const raw = await send({
        method: 'GET',
        route:
          q || flatRequired ? `/workspaces/${ws}/documents` : `/workspaces/${ws}/documents/recent`,
        query: params,
        timeoutMs: metadataTimeout,
        read: json,
      })
      const page = parseDocumentList(raw, input.workspaceId)
      // FD-11: the reader now carries folders and pages as well (the children
      // route needs them); this library list is files only, plus pages when the
      // Documents home asks (`/documents/recent` ignores `kind`, so a folder is
      // dropped here too)
      return {
        documents: page.documents.filter(
          (doc) => doc.kind === 'file' || (input.includePages === true && doc.kind === 'page'),
        ),
        nextCursor: page.nextCursor,
      }
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

    async downloadStream(documentId, version, streamOptions = {}) {
      const query = new URLSearchParams()
      if (version !== undefined && version > 0) query.set('version', String(Math.floor(version)))
      const { signal, onProgress } = streamOptions
      return send({
        method: 'GET',
        route: `/documents/${id(documentId)}/download`,
        query,
        // R5BE-9: no chunk for transferTimeout ends it, not the whole transfer
        timeoutMs: transferTimeout,
        idle: { ceilingMs: streamCeiling },
        ...(signal ? { signal } : {}),
        async read(response, progress) {
          const header = response.headers.get('Content-Length')
          const declared = header === null ? NaN : Number(header)
          if (declared > MAX_DOWNLOAD_BYTES) throw new UniworkDocError('too_large')
          const totalBytes = Number.isSafeInteger(declared) && declared >= 0 ? declared : null
          // R5BE-8: a 200 with no readable body is refused, never buffered
          // whole (the cap could only be checked after the bytes were in memory)
          if (!response.body) throw new UniworkDocError('malformed_response')
          const reader = response.body.getReader()
          // send() detaches the caller's abort once the server answered: the
          // body read listens to it itself, so a cancel ends the stream too
          const stop = () => void reader.cancel().catch(() => undefined)
          signal?.addEventListener('abort', stop, { once: true })
          const chunks: Uint8Array[] = []
          let receivedBytes = 0
          try {
            for (;;) {
              if (signal?.aborted) throw new UniworkDocError('network')
              let step: ReadableStreamReadResult<Uint8Array>
              try {
                step = await reader.read()
              } catch {
                throw new UniworkDocError('network')
              }
              if (signal?.aborted) throw new UniworkDocError('network')
              if (step.done) break
              receivedBytes += step.value.byteLength
              if (receivedBytes > MAX_DOWNLOAD_BYTES) {
                stop()
                throw new UniworkDocError('too_large')
              }
              chunks.push(step.value)
              progress?.()
              onProgress?.({ receivedBytes, totalBytes })
            }
          } finally {
            signal?.removeEventListener('abort', stop)
          }
          const bytes = new Uint8Array(receivedBytes)
          let offset = 0
          for (const chunk of chunks) {
            bytes.set(chunk, offset)
            offset += chunk.byteLength
          }
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
        json: {
          upload_id: input.uploadId,
          base_revision: input.baseRevision,
          ...(input.editLockId ? { edit_lock_id: input.editLockId } : {}),
        },
        idempotencyKey: input.idempotencyKey,
        timeoutMs: metadataTimeout,
        read: json,
      })
      return parseCommit(raw)
    },

    async lookupCommit(input) {
      try {
        const raw = await send({
          method: 'GET',
          route: `/documents/${id(input.documentId)}/versions/commit`,
          idempotencyKey: input.idempotencyKey,
          timeoutMs: metadataTimeout,
          read: json,
        })
        return parseCommitLookup(raw)
      } catch (error) {
        // the server holds no intent for this key any more: `unknown` is a
        // verdict, not a failure; the caller keeps reconciling and never
        // mints a new key on it
        if (error instanceof UniworkDocError && error.code === 'intent_unknown') {
          return { outcome: 'unknown' }
        }
        throw error
      }
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

    async getDocumentLimits() {
      const fetchImpl: FetchLike = options.fetch ?? fetch
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), metadataTimeout)
      try {
        const response = await fetchImpl(`${options.apiOrigin}/api/v1/config`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          redirect: 'error',
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) return DEFAULT_DOCUMENT_LIMITS
        const body = await response.json()
        return parseDocumentLimits(body)
      } catch {
        return DEFAULT_DOCUMENT_LIMITS
      } finally {
        clearTimeout(timer)
      }
    },

    // ---- BIGUP-A1: large upload sessions --------------------------------
    //
    // The three create routes and the three session routes all answer the
    // same session shape; only `complete` differs by route family, and the
    // reader tells the two answers apart by the body itself.

    async createWorkspaceUploadSession(input) {
      const raw = await send({
        method: 'POST',
        route: `/workspaces/${id(input.workspaceId)}/documents/upload-sessions`,
        json: sessionOpenBody(input),
        idempotencyKey: input.idempotencyKey,
        ...(input.signal ? { signal: input.signal } : {}),
        timeoutMs: metadataTimeout,
        read: json,
      })
      return parseUploadSession(raw)
    },

    async createDocumentUploadSession(input) {
      const raw = await send({
        method: 'POST',
        route: `/documents/${id(input.documentId)}/upload-sessions`,
        json: sessionOpenBody(input),
        idempotencyKey: input.idempotencyKey,
        ...(input.signal ? { signal: input.signal } : {}),
        timeoutMs: metadataTimeout,
        read: json,
      })
      return parseUploadSession(raw)
    },

    async getUploadSession(sessionId, signal) {
      const raw = await send({
        method: 'GET',
        route: `/upload-sessions/${id(sessionId)}`,
        ...(signal ? { signal } : {}),
        timeoutMs: metadataTimeout,
        read: json,
      })
      return parseUploadSession(raw)
    },

    async completeUploadSession(input) {
      const raw = await send({
        method: 'POST',
        route: `/upload-sessions/${id(input.sessionId)}/complete`,
        json: {
          parts: input.parts.map((part) => ({
            part_number: part.partNumber,
            etag: part.etag,
          })),
        },
        ...(input.signal ? { signal: input.signal } : {}),
        // R4: validating a 200 MiB file takes a while; the request holds the
        // connection until the server is done, so it gets the transfer
        // deadline, not the metadata one
        timeoutMs: transferTimeout,
        read: json,
      })
      return parseUploadSessionComplete(raw)
    },

    async deleteUploadSession(sessionId) {
      await send({
        method: 'DELETE',
        route: `/upload-sessions/${id(sessionId)}`,
        timeoutMs: metadataTimeout,
        read: async () => undefined,
      })
    },

    async putUploadPart(input) {
      // The part URL is the storage's own presigned URL: it is NOT a UniWork
      // route, so it must not carry the bearer token, the Idempotency-Key or
      // any cookie, and its host is not `apiOrigin` (the egress rule that
      // rejects a foreign host applies to UniWork calls only). `send()` is
      // therefore bypassed on purpose.
      //
      // R1-BE-01: bypassing `send()` also bypasses its transport normalization
      // and its deadline, so this call carries its own: the transfer deadline
      // (a stalled PUT can otherwise hold a worker for ever) composed with the
      // caller's abort, and a native fetch rejection (`TypeError`) turned into
      // the typed `network`/`timeout` the part retry ladder switches on. A
      // caller abort stays distinguishable: the core re-checks its own signal
      // and answers `upload_cancelled` (see upload-session.ts).
      const fetchImpl: FetchLike = options.fetch ?? ((url, init) => fetch(url, init))
      const controller = new AbortController()
      let timedOut = false
      const expire = (): void => {
        timedOut = true
        controller.abort()
      }
      const timer = setTimeout(expire, transferTimeout)
      const abortFromCaller = (): void => controller.abort()
      if (input.signal) {
        if (input.signal.aborted) controller.abort()
        else input.signal.addEventListener('abort', abortFromCaller, { once: true })
      }
      try {
        let response: Response
        try {
          response = await fetchImpl(input.url, {
            method: 'PUT',
            headers: { ...(input.headers ?? {}) },
            // the presigned URL is the credential: no cookie, no ambient auth
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'error',
            signal: controller.signal,
            body: input.bytes as unknown as BodyInit,
          } as RequestInit)
        } catch (error) {
          if (timedOut) throw new UniworkDocError('timeout')
          // a redirect means another host or path answered: never followed
          throw new UniworkDocError(isRedirectRefusal(error) ? 'server_error' : 'network')
        }
        if (!response.ok) {
          const body: unknown = await response.json().catch(() => undefined)
          throw timedOut ? new UniworkDocError('timeout') : errorFromResponse(response.status, body)
        }
        const etag = response.headers.get('ETag') ?? response.headers.get('etag')
        if (!etag)
          throw new UniworkDocError('malformed_response', { serverCode: 'part_etag_missing' })
        return { etag }
      } finally {
        clearTimeout(timer)
        input.signal?.removeEventListener('abort', abortFromCaller)
      }
    },
  }
}

/**
 * BIGUP-A1: the create body of both scoped routes. `parent_id`/`title`/
 * `visibility` belong to the workspace route alone (the document route's
 * parent is on the path), and the probe is always the full four-field shape -
 * the server refuses a probe whose head is not exactly `min(size, 64 KiB)`.
 */
function sessionOpenBody(input: {
  filename: string
  sizeBytes: number
  probe: LocalFileProbePayload
  parentId?: string | null
  title?: string
  visibility?: string | null
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    filename: input.filename,
    size_bytes: input.sizeBytes,
    probe: {
      head_b64: input.probe.head_b64,
      central_dir_b64: input.probe.central_dir_b64,
      cd_offset: input.probe.cd_offset ?? 0,
      cd_size: input.probe.cd_size ?? 0,
    },
  }
  if (input.parentId !== undefined) body.parent_id = parentOf(input.parentId)
  if (input.title !== undefined) body.title = input.title
  if (input.visibility !== undefined) body.visibility = input.visibility
  return body
}
