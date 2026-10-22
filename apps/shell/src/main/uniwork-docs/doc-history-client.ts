import {
  DOC_ACCESS_LOG_ACTIONS,
  DOC_ACCESS_LOG_PAGE_SIZE,
  DOC_VERSION_PAGE_SIZE,
  type DocAccessLog,
  type DocAccessLogAction,
  type DocAccessLogActor,
  type DocAccessLogPage,
  type DocHistoryDocument,
  type DocRestoreResult,
  type DocVersion,
  type DocVersionPage,
} from '../../shared/doc-history-api'
import {
  METADATA_TIMEOUT_MS,
  createUniworkSend,
  uniworkId,
  type UniworkDocsClientOptions,
} from './client'
import { UniworkDocError } from './errors'
import { isDecimalString } from './formats'

/**
 * UNI-2077: the version and access-log routes of the documents server, the same
 * routes, queries and bodies the web calls (`documents-versions.ts`,
 * `documents-sharing.ts` listDocumentAccessLogs). It rides `createUniworkSend`,
 * so the egress rules of every UniWork client apply (fixed origin + `/api/v1`,
 * no redirects, deadline over the whole exchange, bearer only inside
 * `authorized`, one refresh on 401).
 *
 * Rows are read the way the web's zod schemas read them: the identifying
 * fields must be there, the rest takes the web's default. A page with a row
 * that does not read is `malformed_response` as a whole - an empty or short
 * history over a document that has one would be a false answer.
 *
 * A call the client itself refuses (a bad version number, base revision or
 * action) throws `server_error` with `serverCode: 'invalid_input'` before any
 * request; an id that is not an id is `not_found`, like every UniWork client.
 */
export interface DocHistoryClient {
  /** `GET /documents/{id}/versions?cursor&limit` */
  listVersions(
    documentId: string,
    opts?: { cursor?: string; limit?: number },
  ): Promise<DocVersionPage>
  /** `GET /documents/{id}`: only the kind and revision a restore names as its base */
  getDocumentHead(documentId: string): Promise<{ kind: string; revision: string }>
  /** `GET /documents/{id}/versions/{no}` */
  getVersion(documentId: string, versionNo: number): Promise<DocVersion>
  /** `POST /documents/{id}/versions` with `{label?}` and an Idempotency-Key */
  createVersion(
    documentId: string,
    body: { label?: string },
    idempotencyKey: string,
  ): Promise<DocVersion>
  /** `POST /documents/{id}/versions/{no}/restore` with `{base_revision?, edit_lock_id?}` */
  restoreVersion(
    documentId: string,
    versionNo: number,
    opts: { idempotencyKey: string; baseRevision?: string; editLockId?: string },
  ): Promise<DocRestoreResult>
  /** `GET /documents/{id}/access-logs?cursor&limit&action` */
  listAccessLogs(
    documentId: string,
    opts?: { cursor?: string; limit?: number; action?: DocAccessLogAction },
  ): Promise<DocAccessLogPage>
}

/** the server's page cap (`limit` <= 100) */
const MAX_PAGE = 100

type Json = Record<string, unknown>

const objectOf = (value: unknown): Json | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null

const textOr = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback
const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const intOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null

function malformed(): never {
  throw new UniworkDocError('malformed_response')
}

/** a call this client will not send */
function invalid(): never {
  throw new UniworkDocError('server_error', { serverCode: 'invalid_input' })
}

function versionNumber(versionNo: number): string {
  if (!Number.isSafeInteger(versionNo) || versionNo < 1) throw new UniworkDocError('not_found')
  return String(versionNo)
}

function pageLimit(limit: number | undefined, fallback: number): string {
  const value = typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : fallback
  return String(Math.min(MAX_PAGE, Math.max(1, value)))
}

function parseVersion(raw: unknown): DocVersion {
  const row = objectOf(raw)
  if (
    !row ||
    typeof row.id !== 'string' ||
    typeof row.document_id !== 'string' ||
    typeof row.version !== 'number' ||
    !Number.isSafeInteger(row.version)
  ) {
    malformed()
  }
  const size = row.size_bytes
  return {
    id: row.id,
    document_id: row.document_id,
    version: row.version,
    kind: textOr(row.kind, 'page'),
    reason: textOr(row.reason, 'manual'),
    label: textOrNull(row.label),
    file_id: textOrNull(row.file_id),
    mime_type: textOrNull(row.mime_type),
    size_bytes: typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : 0,
    checksum_sha256: textOrNull(row.checksum_sha256),
    restored_from: intOrNull(row.restored_from),
    created_by: textOr(row.created_by, ''),
    created_by_kind: textOr(row.created_by_kind, 'human'),
    created_at: textOr(row.created_at, ''),
    ...(row.content !== undefined ? { content: row.content } : {}),
  }
}

/** `{version: {...}}` */
function parseVersionEnvelope(raw: unknown): DocVersion {
  return parseVersion(objectOf(raw)?.version)
}

function parseVersionPage(raw: unknown): DocVersionPage {
  const page = objectOf(raw)
  if (!page || !Array.isArray(page.versions)) malformed()
  return { versions: page.versions.map(parseVersion), next_cursor: textOrNull(page.next_cursor) }
}

function parseHistoryDocument(raw: unknown): DocHistoryDocument {
  const doc = objectOf(raw)
  if (
    !doc ||
    typeof doc.id !== 'string' ||
    !isDecimalString(doc.revision) ||
    typeof doc.current_version !== 'number' ||
    !Number.isSafeInteger(doc.current_version)
  ) {
    malformed()
  }
  return {
    id: doc.id,
    kind: textOr(doc.kind, ''),
    title: textOr(doc.title, ''),
    revision: doc.revision as string,
    current_version: doc.current_version,
  }
}

function parseActor(raw: unknown): DocAccessLogActor | null {
  const actor = objectOf(raw)
  if (
    !actor ||
    typeof actor.id !== 'string' ||
    typeof actor.kind !== 'string' ||
    typeof actor.display_name !== 'string'
  ) {
    return null
  }
  return {
    id: actor.id,
    kind: actor.kind,
    display_name: actor.display_name,
    ...(typeof actor.avatar_url === 'string' ? { avatar_url: actor.avatar_url } : {}),
  }
}

function parseAccessLog(raw: unknown): DocAccessLog {
  const row = objectOf(raw)
  if (
    !row ||
    typeof row.id !== 'string' ||
    typeof row.action !== 'string' ||
    typeof row.actor_kind !== 'string'
  ) {
    malformed()
  }
  return {
    id: row.id,
    action: row.action,
    via: textOr(row.via, ''),
    version: intOrNull(row.version),
    actor_kind: row.actor_kind,
    actor_id: textOrNull(row.actor_id),
    // a name the server could not resolve is shown by kind, never guessed
    actor: parseActor(row.actor),
    share_link_id: textOrNull(row.share_link_id),
    occurred_at: textOr(row.occurred_at, ''),
  }
}

function parseAccessLogPage(raw: unknown): DocAccessLogPage {
  const page = objectOf(raw)
  if (!page || !Array.isArray(page.logs)) malformed()
  return { logs: page.logs.map(parseAccessLog), next_cursor: textOrNull(page.next_cursor) }
}

export function createDocHistoryClient(options: UniworkDocsClientOptions): DocHistoryClient {
  const timeoutMs = options.metadataTimeoutMs ?? METADATA_TIMEOUT_MS
  const send = createUniworkSend(options)
  const json = (response: Response): Promise<unknown> => response.json()
  const docRoute = (documentId: string): string => `/documents/${uniworkId(documentId)}`

  return {
    async listVersions(documentId, opts) {
      const route = `${docRoute(documentId)}/versions`
      const query = new URLSearchParams()
      if (opts?.cursor) query.set('cursor', opts.cursor.slice(0, 512))
      query.set('limit', pageLimit(opts?.limit, DOC_VERSION_PAGE_SIZE))
      return parseVersionPage(await send({ method: 'GET', route, query, timeoutMs, read: json }))
    },

    async getDocumentHead(documentId) {
      const route = docRoute(documentId)
      const raw = await send({ method: 'GET', route, timeoutMs, read: json })
      const doc = objectOf(objectOf(raw)?.document)
      if (!doc || typeof doc.kind !== 'string' || !isDecimalString(doc.revision)) malformed()
      return { kind: doc.kind, revision: doc.revision as string }
    },

    async getVersion(documentId, versionNo) {
      const route = `${docRoute(documentId)}/versions/${versionNumber(versionNo)}`
      const version = parseVersionEnvelope(
        await send({ method: 'GET', route, timeoutMs, read: json }),
      )
      // an answer for another version is never shown as this one
      if (version.version !== versionNo) malformed()
      return version
    },

    async createVersion(documentId, body, idempotencyKey) {
      const route = `${docRoute(documentId)}/versions`
      const raw = await send({
        method: 'POST',
        route,
        json: body.label ? { label: body.label } : {},
        idempotencyKey,
        timeoutMs,
        read: json,
      })
      return parseVersionEnvelope(raw)
    },

    async restoreVersion(documentId, versionNo, opts) {
      if (opts.baseRevision !== undefined && !isDecimalString(opts.baseRevision)) invalid()
      const route = `${docRoute(documentId)}/versions/${versionNumber(versionNo)}/restore`
      const body = {
        ...(opts.baseRevision ? { base_revision: opts.baseRevision } : {}),
        ...(opts.editLockId ? { edit_lock_id: opts.editLockId } : {}),
      }
      const raw = await send({
        method: 'POST',
        route,
        // a page restore carries nothing, like the web's
        ...(Object.keys(body).length > 0 ? { json: body } : {}),
        idempotencyKey: opts.idempotencyKey,
        timeoutMs,
        read: json,
      })
      const answer = objectOf(raw)
      return {
        document: parseHistoryDocument(answer?.document),
        version: parseVersion(answer?.version),
      }
    },

    async listAccessLogs(documentId, opts) {
      if (
        opts?.action !== undefined &&
        !(DOC_ACCESS_LOG_ACTIONS as readonly string[]).includes(opts.action)
      ) {
        invalid()
      }
      const route = `${docRoute(documentId)}/access-logs`
      const query = new URLSearchParams()
      if (opts?.cursor) query.set('cursor', opts.cursor.slice(0, 512))
      query.set('limit', pageLimit(opts?.limit, DOC_ACCESS_LOG_PAGE_SIZE))
      if (opts?.action) query.set('action', opts.action)
      return parseAccessLogPage(await send({ method: 'GET', route, query, timeoutMs, read: json }))
    },
  }
}
