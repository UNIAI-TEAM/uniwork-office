import {
  createUniworkSend,
  METADATA_TIMEOUT_MS,
  TRANSFER_TIMEOUT_MS,
  uniworkId,
  type FetchLike,
  type UniworkDocsClientOptions,
} from './client'
import { UniworkDocError } from './errors'
import {
  FolderUploadApiError,
  FolderUploadError,
  type FileTarget,
  type FolderUploadBatch,
  type FolderUploadBatchFile,
  type FolderUploadBatchStatus,
  type FolderUploadCompleteItem,
  type FolderUploadCompleteResponse,
  type FolderUploadCounts,
  type FolderUploadFileError,
  type FolderUploadFileStatus,
  type FolderUploadPlanBody,
  type FolderUploadPutOpts,
  type FolderUploadTransport,
  type StoredObject,
} from './folder-upload/transport'

/**
 * UNI-2052: the five folder-upload routes of the e6-server contract
 * (`…/workspaces/{ws}/documents/folder-uploads`, v0.2 + amendments), the PUT
 * of a file's bytes to its target, and the `FolderUploadTransport` the runner
 * codes against. Same rules as the rest of this client: every URL is the API
 * origin + `/api/v1` + a fixed route with validated ids, the bearer travels
 * only inside `send`, and answers are read leniently (a drifted field takes
 * its default, a list entry that does not parse is dropped) so a server that
 * grows a field never breaks an upload - only an answer with no usable batch
 * id is refused as `malformed_response`.
 */

const MIN_UPLOAD_BYTES_PER_SECOND = 256 * 1024

const base = (workspaceId: string): string =>
  `/workspaces/${uniworkId(workspaceId)}/documents/folder-uploads`

// ---- lenient readers ---------------------------------------------------

type Json = Record<string, unknown>

const objectOf = (value: unknown): Json | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null
const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback
const nonEmpty = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0

const BATCH_STATUSES: readonly FolderUploadBatchStatus[] = [
  'open',
  'completed',
  'canceled',
  'expired',
]
const FILE_STATUSES: readonly FolderUploadFileStatus[] = ['pending', 'done', 'failed']

// An unknown batch status reads as open (the runner asks again), an unknown
// file status as pending: the file is then retried, never counted as done.
const batchStatus = (value: unknown): FolderUploadBatchStatus =>
  BATCH_STATUSES.find((s) => s === value) ?? 'open'
const fileStatus = (value: unknown): FolderUploadFileStatus =>
  FILE_STATUSES.find((s) => s === value) ?? 'pending'

function readHeaders(value: unknown): Record<string, string> {
  const record = objectOf(value)
  if (!record) return {}
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

function readCounts(value: unknown): FolderUploadCounts {
  const record = objectOf(value)
  return {
    total: count(record?.total),
    done: count(record?.done),
    failed: count(record?.failed),
    pending: count(record?.pending),
  }
}

/** a target that does not parse is null: the file is then retried through a fresh GET */
function readTarget(value: unknown): FileTarget | null {
  const raw = objectOf(value)
  if (!raw) return null
  if (raw.kind === 'put') {
    const url = nonEmpty(raw.url)
    if (!url) return null
    const target = {
      kind: 'put' as const,
      method: nonEmpty(raw.method) ?? 'PUT',
      url,
      headers: readHeaders(raw.headers),
      expires_at: text(raw.expires_at),
    }
    return raw.auth === 'session' ? { ...target, auth: 'session' } : target
  }
  if (raw.kind === 'multipart') {
    const sessionId = nonEmpty(raw.session_id)
    const partSize = raw.part_size
    if (
      !sessionId ||
      typeof partSize !== 'number' ||
      !Number.isSafeInteger(partSize) ||
      partSize <= 0
    ) {
      return null
    }
    if (!Array.isArray(raw.parts)) return null
    const parts: Extract<FileTarget, { kind: 'multipart' }>['parts'] = []
    for (const entry of raw.parts) {
      const part = objectOf(entry)
      const url = nonEmpty(part?.url)
      const number = part?.part_number
      if (
        !part ||
        !url ||
        typeof number !== 'number' ||
        !Number.isSafeInteger(number) ||
        number <= 0
      ) {
        return null
      }
      parts.push({
        part_number: number,
        method: nonEmpty(part.method) ?? 'PUT',
        url,
        headers: readHeaders(part.headers),
        expires_at: text(part.expires_at),
      })
    }
    return {
      kind: 'multipart',
      session_id: sessionId,
      part_size: partSize,
      parts,
      expires_at: text(raw.expires_at),
    }
  }
  return null
}

function readFileError(value: unknown): FolderUploadFileError | null {
  const raw = objectOf(value)
  const code = nonEmpty(raw?.code)
  if (!raw || !code) return null
  const reason = typeof raw.reason === 'string' ? raw.reason : undefined
  return reason !== undefined
    ? { code, message: text(raw.message), reason }
    : { code, message: text(raw.message) }
}

function readList<T>(value: unknown, read: (entry: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const parsed = read(entry)
    return parsed === null ? [] : [parsed]
  })
}

function readBatchFile(value: unknown): FolderUploadBatchFile | null {
  const raw = objectOf(value)
  const fileKey = nonEmpty(raw?.file_key)
  if (!raw || !fileKey) return null
  return {
    file_key: fileKey,
    path: text(raw.path),
    filename: text(raw.filename),
    size_bytes: count(raw.size_bytes),
    status: fileStatus(raw.status),
    document_id: nonEmpty(raw.document_id),
    error: readFileError(raw.error),
    target: readTarget(raw.target),
  }
}

/** only the id is load-bearing: without it nothing can be completed, so the answer is refused (null) */
function readBatch(value: unknown): FolderUploadBatch | null {
  const raw = objectOf(value)
  const id = nonEmpty(raw?.id)
  if (!raw || !id) return null
  const rootFolderId = nonEmpty(raw.root_folder_id)
  return {
    id,
    status: batchStatus(raw.status),
    parent_id: nonEmpty(raw.parent_id),
    // missing or unknown reads as absent: derived from the root (files mode has none)
    mode:
      raw.mode === 'files' || raw.mode === 'folder'
        ? raw.mode
        : rootFolderId === null
          ? 'files'
          : 'folder',
    root_folder_id: rootFolderId,
    root_title: nonEmpty(raw.root_title),
    share_with_workspace: raw.share_with_workspace === true,
    folders: readList(raw.folders, (entry) => {
      const folder = objectOf(entry)
      const folderId = nonEmpty(folder?.id)
      return folder && typeof folder.path === 'string' && folderId
        ? { path: folder.path, id: folderId }
        : null
    }),
    files: readList(raw.files, readBatchFile),
    counts: readCounts(raw.counts),
    total_bytes: count(raw.total_bytes),
    expires_at: text(raw.expires_at),
    created_at: text(raw.created_at),
  }
}

const EMPTY_COMPLETE: FolderUploadCompleteResponse = {
  results: [],
  batch: { status: 'open', counts: { total: 0, done: 0, failed: 0, pending: 0 } },
}

function readComplete(value: unknown): FolderUploadCompleteResponse {
  const raw = objectOf(value)
  if (!raw) return EMPTY_COMPLETE
  const results = readList(
    raw.results,
    (entry): FolderUploadCompleteResponse['results'][number] | null => {
      const result = objectOf(entry)
      const fileKey = nonEmpty(result?.file_key)
      if (!result || !fileKey || typeof result.status !== 'string') return null
      const documentId = nonEmpty(result.document_id)
      // Only "done" with a document counts as done; anything else is a failure.
      // A "done" without a document is one the user can retry (the server answers done again).
      if (result.status === 'done' && documentId) {
        return { file_key: fileKey, status: 'done', document_id: documentId, error: null }
      }
      return {
        file_key: fileKey,
        status: 'failed',
        document_id: null,
        error: readFileError(result.error) ?? { code: 'unknown', message: '' },
        ...(result.status === 'done'
          ? { retryable: true }
          : typeof result.retryable === 'boolean'
            ? { retryable: result.retryable }
            : {}),
      }
    },
  )
  const batch = objectOf(raw.batch)
  return {
    results,
    batch: batch
      ? { status: batchStatus(batch.status), counts: readCounts(batch.counts) }
      : EMPTY_COMPLETE.batch,
  }
}

// ---- request bodies ----------------------------------------------------

/** the probe is always the full four-field shape; null directory fields are zeros (as the upload sessions send it) */
function planJson(body: FolderUploadPlanBody): FolderUploadPlanBody {
  return {
    ...body,
    files: body.files.map((file) => {
      if (!file.probe) return file
      return {
        ...file,
        probe: {
          head_b64: file.probe.head_b64,
          central_dir_b64: file.probe.central_dir_b64,
          cd_offset: file.probe.cd_offset ?? 0,
          cd_size: file.probe.cd_size ?? 0,
        },
      }
    }),
  }
}

// ---- the client --------------------------------------------------------

export interface FolderUploadClient {
  /** POST …/folder-uploads (Idempotency-Key required): 201 batch */
  createFolderUpload(
    workspaceId: string,
    body: FolderUploadPlanBody,
    opts: { idempotencyKey: string; signal?: AbortSignal },
  ): Promise<FolderUploadBatch>
  /** GET …/folder-uploads/{batchID}: the batch with fresh targets for its pending files */
  getFolderUpload(
    workspaceId: string,
    batchId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<FolderUploadBatch>
  /** DELETE …/folder-uploads/{batchID}: the canceled batch (idempotent) */
  cancelFolderUpload(workspaceId: string, batchId: string): Promise<FolderUploadBatch>
  /**
   * POST …/folder-uploads/{batchID}/complete, at most 50 items. A malformed
   * answer reads as no results: those files stay pending and the next call
   * asks again (complete is idempotent per file_key).
   */
  completeFolderUpload(
    workspaceId: string,
    batchId: string,
    items: FolderUploadCompleteItem[],
    opts?: { signal?: AbortSignal },
  ): Promise<FolderUploadCompleteResponse>
  /**
   * PUT …/files/{fileKey}/content: the server's own content route (the target
   * with `auth: "session"`), with the session bearer. `route` is the part of
   * the target URL after `/api/v1`, already checked by `contentRouteOf`.
   * Resolves with the quoted ETag (header first, `{etag}` body second), or
   * null when the answer had neither.
   */
  putFolderUploadContent(
    route: string,
    blob: Blob,
    opts?: { headers?: Record<string, string>; signal?: AbortSignal },
  ): Promise<string | null>
}

export function createFolderUploadClient(options: UniworkDocsClientOptions): FolderUploadClient {
  const metadataTimeout = options.metadataTimeoutMs ?? METADATA_TIMEOUT_MS
  const transferTimeout = options.transferTimeoutMs ?? TRANSFER_TIMEOUT_MS
  const send = createUniworkSend(options)
  const json = (response: Response): Promise<unknown> => response.json()
  const batchOf = (raw: unknown): FolderUploadBatch => {
    const batch = readBatch(raw)
    if (!batch) throw new UniworkDocError('malformed_response')
    return batch
  }

  return {
    async createFolderUpload(workspaceId, body, opts) {
      const raw = await send({
        method: 'POST',
        route: base(workspaceId),
        json: planJson(body),
        idempotencyKey: opts.idempotencyKey,
        ...(opts.signal ? { signal: opts.signal } : {}),
        timeoutMs: metadataTimeout,
        read: json,
      })
      return batchOf(raw)
    },

    async getFolderUpload(workspaceId, batchId, opts = {}) {
      const raw = await send({
        method: 'GET',
        route: `${base(workspaceId)}/${uniworkId(batchId)}`,
        ...(opts.signal ? { signal: opts.signal } : {}),
        timeoutMs: metadataTimeout,
        read: json,
      })
      return batchOf(raw)
    },

    async cancelFolderUpload(workspaceId, batchId) {
      const raw = await send({
        method: 'DELETE',
        route: `${base(workspaceId)}/${uniworkId(batchId)}`,
        timeoutMs: metadataTimeout,
        read: json,
      })
      return batchOf(raw)
    },

    async completeFolderUpload(workspaceId, batchId, items, opts = {}) {
      const raw = await send({
        method: 'POST',
        route: `${base(workspaceId)}/${uniworkId(batchId)}/complete`,
        json: { files: items },
        ...(opts.signal ? { signal: opts.signal } : {}),
        // the server validates up to 50 files before it answers
        timeoutMs: transferTimeout,
        read: json,
      })
      return readComplete(raw)
    },

    async putFolderUploadContent(route, blob, opts = {}) {
      return send({
        method: 'PUT',
        route,
        raw: { body: blob, headers: forwardable(opts.headers) },
        ...(opts.signal ? { signal: opts.signal } : {}),
        timeoutMs: uploadTimeout(blob.size, transferTimeout),
        read: async (response) => {
          const header = response.headers.get('ETag')?.trim()
          if (header) return header
          const body = objectOf(await response.json().catch(() => null))
          return nonEmpty(typeof body?.etag === 'string' ? body.etag.trim() : null)
        },
      })
    },
  }
}

// ---- storage PUT + the runner's transport ------------------------------

/** the deadline of one PUT: the transfer deadline, longer for a file a slow link needs more time for */
function uploadTimeout(bytes: number, transferTimeout: number): number {
  return Math.max(transferTimeout, Math.ceil(bytes / MIN_UPLOAD_BYTES_PER_SECOND) * 1000)
}

/** headers a target may not make us forward: the bearer is the transport's, Host and Cookie the network stack's */
function forwardable(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers ?? {})) {
    const lower = key.toLowerCase()
    if (lower !== 'authorization' && lower !== 'host' && lower !== 'cookie') out[key] = value
  }
  return out
}

const CONTENT_ROUTE =
  /^\/workspaces\/[A-Za-z0-9_-]{1,128}\/documents\/folder-uploads\/[A-Za-z0-9_-]{1,128}\/files\/[A-Za-z0-9_-]{1,64}\/content$/

/**
 * The route (after `/api/v1`) of an `auth: "session"` target, or null when the
 * URL is not exactly the content route of a batch file on the API origin. The
 * session bearer never goes anywhere else: `//host`, `/\host`, another origin,
 * dot segments, query strings and control characters all fail the pattern.
 */
export function contentRouteOf(url: string, apiOrigin: string): string | null {
  const origin = new URL(apiOrigin).origin
  const path = url.startsWith('/')
    ? url
    : url.startsWith(`${origin}/`)
      ? url.slice(origin.length)
      : null
  if (path === null || !path.startsWith('/api/v1/')) return null
  const route = path.slice('/api/v1'.length)
  return CONTENT_ROUTE.test(route) ? route : null
}

/** a presigned URL has to be a plain http(s) URL */
function isStorageUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

/** Retry-After in whole seconds, when the header is delta-seconds */
function retryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get('Retry-After')?.trim()
  return header && /^\d+$/.test(header) ? Number(header) : undefined
}

export interface FolderUploadTransportDeps {
  /**
   * The fetch used for presigned storage URLs and parts (the wiring passes
   * Electron's `net.fetch`); API calls go through `options.fetch`. Defaults to
   * the global fetch.
   */
  storageFetch?: FetchLike
}

/**
 * A runner-readable error for one thing the client threw: an abort stays an
 * AbortError, an HTTP answer is a FolderUploadApiError (status + the server's
 * code + fields + Retry-After), a network failure or timeout a TypeError (the
 * runner retries those), a lost session the "session" failure. Anything else
 * (a malformed answer) passes through and reads as "unknown".
 */
function asRunnerError(error: unknown, signal?: AbortSignal): unknown {
  if (signal?.aborted) return abortError()
  if (!(error instanceof UniworkDocError)) return error
  if (error.status !== undefined) {
    return new FolderUploadApiError(
      error.status,
      error.serverCode ?? `http_${error.status}`,
      error.fields ?? {},
      error.retryAfterMs !== undefined ? Math.ceil(error.retryAfterMs / 1000) : undefined,
    )
  }
  switch (error.code) {
    case 'network':
    case 'timeout':
      return new TypeError(error.code)
    case 'not_signed_in':
    case 'session_expired':
    case 'wrong_deployment':
      return new FolderUploadError('session', `The session ended (${error.code})`)
    default:
      return error
  }
}

/** The HTTP FolderUploadTransport for one workspace. */
export function createFolderUploadTransport(
  options: UniworkDocsClientOptions,
  workspaceId: string,
  deps: FolderUploadTransportDeps = {},
): FolderUploadTransport {
  const api = createFolderUploadClient(options)
  const storageFetch: FetchLike = deps.storageFetch ?? ((input, init) => fetch(input, init))
  const transferTimeout = options.transferTimeoutMs ?? TRANSFER_TIMEOUT_MS

  async function guard<T>(call: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    try {
      return await call()
    } catch (error) {
      throw asRunnerError(error, signal)
    }
  }

  /**
   * One PUT straight to storage: a presigned URL is the credential, so no
   * bearer, cookie or Idempotency-Key, and a redirect is never followed. The
   * ETag header is what complete needs.
   */
  async function putStorage(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: Blob,
    signal: AbortSignal | undefined,
  ): Promise<string | null> {
    if (!isStorageUrl(url))
      throw new FolderUploadError('untrusted_target', 'Storage target is not an http(s) URL')
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(
      () => {
        timedOut = true
        controller.abort()
      },
      uploadTimeout(body.size, transferTimeout),
    )
    const abortFromCaller = (): void => controller.abort()
    if (signal) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener('abort', abortFromCaller, { once: true })
    }
    try {
      let response: Response
      try {
        response = await storageFetch(url, {
          method: method || 'PUT',
          headers: forwardable(headers),
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
          body,
        } as RequestInit)
      } catch (error) {
        if (signal?.aborted) throw abortError()
        throw timedOut
          ? new TypeError('timeout')
          : error instanceof TypeError
            ? error
            : new TypeError('network')
      }
      if (!response.ok) {
        throw new FolderUploadApiError(
          response.status,
          `http_${response.status}`,
          {},
          retryAfterSeconds(response),
        )
      }
      return response.headers.get('ETag')?.trim() || null
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abortFromCaller)
    }
  }

  async function putOne(
    target: Extract<FileTarget, { kind: 'put' }>,
    blob: Blob,
    signal?: AbortSignal,
  ) {
    if (target.auth === 'session') {
      const route = contentRouteOf(target.url, options.apiOrigin)
      if (route === null) {
        throw new FolderUploadError('untrusted_target', 'Session target outside the API origin')
      }
      return guard(
        () => api.putFolderUploadContent(route, blob, { headers: target.headers, signal }),
        signal,
      )
    }
    return putStorage(target.method, target.url, target.headers, blob, signal)
  }

  return {
    plan: (body, opts) => guard(() => api.createFolderUpload(workspaceId, body, opts), opts.signal),
    status: (batchId, opts) =>
      guard(() => api.getFolderUpload(workspaceId, batchId, opts), opts?.signal),
    cancel: (batchId) => guard(() => api.cancelFolderUpload(workspaceId, batchId)),
    complete: (batchId, items, opts) =>
      guard(() => api.completeFolderUpload(workspaceId, batchId, items, opts), opts?.signal),

    /**
     * Refusals reject as FolderUploadApiError with the HTTP status; a missing
     * ETag as FolderUploadError("missing_etag"). Parts of a multipart target go
     * one after another (the runner parallelises across files); parts already
     * in `storedParts` are not sent again, and each part is recorded as it lands.
     */
    async put(
      target: FileTarget,
      blob: Blob,
      opts: FolderUploadPutOpts = {},
    ): Promise<StoredObject> {
      if (target.kind === 'put') {
        const etag = await putOne(target, blob, opts.signal)
        if (!etag) throw new FolderUploadError('missing_etag', 'Storage answered without an ETag')
        return { etag }
      }
      const stored = opts.storedParts ?? new Map<number, string>()
      const urls = new Map(target.parts.map((part) => [part.part_number, part]))
      const partCount = Math.max(1, Math.ceil(blob.size / target.part_size))
      for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
        if (stored.has(partNumber)) continue
        const part = urls.get(partNumber)
        if (!part) throw new FolderUploadError('missing_part_url', `No URL for part ${partNumber}`)
        const start = (partNumber - 1) * target.part_size
        const etag = await putStorage(
          part.method,
          part.url,
          part.headers,
          blob.slice(start, start + target.part_size),
          opts.signal,
        )
        if (!etag) {
          throw new FolderUploadError(
            'missing_etag',
            `Storage answered part ${partNumber} without an ETag`,
          )
        }
        stored.set(partNumber, etag)
      }
      const parts = [...stored.entries()]
        .filter(([partNumber]) => partNumber <= partCount)
        .sort(([a], [b]) => a - b)
        .map(([part_number, etag]) => ({ part_number, etag }))
      return { parts }
    },
  }
}
