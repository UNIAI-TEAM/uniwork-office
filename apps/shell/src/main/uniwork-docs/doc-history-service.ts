import { randomUUID } from 'node:crypto'
import type { IpcMain } from 'electron'
import {
  DOC_ACCESS_LOG_ACTIONS,
  DOC_ACCESS_LOG_PAGE_SIZE,
  DOC_HISTORY_CHANNELS,
  DOC_VERSION_LABEL_MAX,
  DOC_VERSION_PAGE_SIZE,
  type DocAccessLogAction,
  type DocHistoryErrorCode,
  type DocHistoryResult,
  type UniworkDocHistoryApi,
} from '../../shared/doc-history-api'
import type { FetchLike, UniworkDocsClientOptions } from './client'
import { createDocHistoryClient, type DocHistoryClient } from './doc-history-client'
import { UniworkDocError } from './errors'
import { isDecimalString } from './formats'

/**
 * UNI-2077: the service behind the `uniwork-doc-history:*` channels (the
 * Version history and Access log sheets). It checks what the renderer sends
 * before anything leaves, answers every call with a `DocHistoryResult` (never
 * a rejection, so nothing crosses IPC as an exception) and maps the server's
 * refusals the way the web's sheets read them (`classifyDocumentError`,
 * `reportWriteRefused`).
 *
 * A restore carries what the web's carries - the writer's edit lock and, for a
 * file, the base revision - but here main holds both: the lock of the open tab
 * and its base, else the server's current revision. A restore that landed is
 * handed to the open tab as a "newer on the server" notice, so the working copy
 * moves through the same guarded flow as a change made on the web.
 */

export interface DocHistoryOpenCopy {
  /** the edit lock this app holds on the open tab, if any */
  editLockId: string | null
  /** the server revision the open working copy is based on */
  baseRevision: string | null
}

export interface DocHistoryServiceDeps {
  /** the client of the current profile; throws `not_signed_in` without one */
  client(): DocHistoryClient
  isSignedIn(): boolean
  /** the open tab of this document in this session, or null when it is not open here */
  openCopy(documentId: string): Promise<DocHistoryOpenCopy | null>
  /** a restore landed: an open tab of the document takes the new revision (S6 flow) */
  noteRestored(notice: {
    documentId: string
    revision: string
    version: number
    versionId: string
  }): void
  /** opens the read-only `@vN` copy of a file version in a tab */
  openVersionView(documentId: string, versionNo: number): Promise<{ path: string; title: string }>
  /**
   * save dialog + the version's bytes to the chosen file; null = the dialog was
   * canceled, `forbidden_target` = the app's own working-copy folder or a link.
   * A server failure throws a UniworkDocError; anything else is the disk's.
   */
  downloadVersion(
    documentId: string,
    versionNo: number,
    suggestedName: string,
  ): Promise<{ path: string } | 'forbidden_target' | null>
}

type Failure = Extract<DocHistoryResult<never>, { ok: false }>

const KEY = /^[A-Za-z0-9_-]{8,128}$/
const MAX_PAGE = 100
const MAX_CURSOR = 512
const FALLBACK_NAME = 'document'

/** the app's transport / session codes, kept as they are */
const KEPT_DOC_CODES: ReadonlySet<string> = new Set<DocHistoryErrorCode>([
  'not_signed_in',
  'session_expired',
  'wrong_deployment',
  'network',
  'timeout',
  'malformed_response',
  'not_found',
  'deleted',
  'document_deleted',
  'document_archived',
  'conflict',
  'too_large',
  'unsupported_format',
])

const FORBIDDEN_DOC_CODES: ReadonlySet<string> = new Set([
  'forbidden',
  'permission_revoked',
  'member_deactivated',
  'organization_suspended',
])

/**
 * A thrown error as the failure result of the contract. The server's verdicts
 * the sheets name keep their own code (`version_unchanged`, `edit_locked` with
 * its holder, `conflict` with the current revision, `edit_lock_lost`), a 403 of
 * any kind is `forbidden`, the transport codes pass through, and a throttle is
 * marked `retryable`. Anything that is not a UniworkDocError is `server_error`.
 */
export function docHistoryErrorOf(error: unknown): Failure {
  if (!(error instanceof UniworkDocError)) return { ok: false, error: 'server_error' }
  const at = error.status === undefined ? {} : { status: error.status }
  const fail = (code: DocHistoryErrorCode): Failure => ({ ok: false, error: code, ...at })
  if (error.serverCode === 'invalid_input') return { ok: false, error: 'invalid_request' }
  if (error.serverCode === 'document_version_unchanged') return fail('version_unchanged')
  if (error.serverCode === 'document_shelved') return fail('document_shelved')
  if (error.code === 'edit_locked') {
    const lock = error.editLock
    return {
      ...fail('edit_locked'),
      ...(lock
        ? {
            editLock: {
              holderName: lock.holderName,
              since: lock.since,
              expiresAt: lock.expiresAt,
              heldByMe: lock.heldByMe,
            },
          }
        : {}),
    }
  }
  if (error.code === 'server_error' && error.lostReason) return fail('edit_lock_lost')
  if (error.code === 'conflict') {
    return {
      ...fail('conflict'),
      ...(error.currentRevision ? { currentRevision: error.currentRevision } : {}),
    }
  }
  if (FORBIDDEN_DOC_CODES.has(error.code)) return fail('forbidden')
  if (KEPT_DOC_CODES.has(error.code)) return fail(error.code as DocHistoryErrorCode)
  const throttled = error.status === 429 || error.status === 503
  return { ...fail('server_error'), ...(throttled ? { retryable: true } : {}) }
}

const invalidRequest = (): Promise<Failure> =>
  Promise.resolve({ ok: false, error: 'invalid_request' })

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const isVersionNo = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1

/** the paging fields every list takes; null = refused */
function pageOf(
  input: Record<string, unknown>,
  fallback: number,
): { cursor?: string; limit: number } | null {
  const { cursor, limit } = input
  if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > MAX_CURSOR)) {
    return null
  }
  if (
    limit !== undefined &&
    (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE)
  ) {
    return null
  }
  return { ...(cursor ? { cursor } : {}), limit: (limit as number | undefined) ?? fallback }
}

/** a renderer key when it is one, else a fresh one; null = a key that is not a key */
function keyOf(value: unknown): string | null {
  if (value === undefined) return randomUUID()
  return typeof value === 'string' && KEY.test(value) ? value : null
}

export function createDocHistoryService(deps: DocHistoryServiceDeps): UniworkDocHistoryApi {
  async function run<T>(
    call: (client: DocHistoryClient) => Promise<T>,
  ): Promise<DocHistoryResult<T>> {
    try {
      if (!deps.isSignedIn()) return { ok: false, error: 'not_signed_in' }
      return { ok: true, value: await call(deps.client()) }
    } catch (error) {
      return docHistoryErrorOf(error)
    }
  }

  return {
    versions(input) {
      if (!isObject(input) || !isText(input.documentId)) return invalidRequest()
      const page = pageOf(input, DOC_VERSION_PAGE_SIZE)
      if (!page) return invalidRequest()
      const { documentId } = input
      return run((client) => client.listVersions(documentId, page))
    },

    version(input) {
      if (!isObject(input) || !isText(input.documentId) || !isVersionNo(input.versionNo)) {
        return invalidRequest()
      }
      const { documentId, versionNo } = input
      return run((client) => client.getVersion(documentId, versionNo))
    },

    createVersion(input) {
      if (!isObject(input) || !isText(input.documentId)) return invalidRequest()
      if (input.label !== undefined && typeof input.label !== 'string') return invalidRequest()
      const label = (input.label ?? '').trim()
      // the server counts characters; so does the web's input (maxLength)
      if (Array.from(label).length > DOC_VERSION_LABEL_MAX) return invalidRequest()
      const key = keyOf(input.idempotencyKey)
      if (!key) return invalidRequest()
      const { documentId } = input
      return run((client) => client.createVersion(documentId, label ? { label } : {}, key))
    },

    restore(input) {
      if (!isObject(input) || !isText(input.documentId) || !isVersionNo(input.versionNo)) {
        return invalidRequest()
      }
      if (input.baseRevision !== undefined && !isDecimalString(input.baseRevision)) {
        return invalidRequest()
      }
      const key = keyOf(input.idempotencyKey)
      if (!key) return invalidRequest()
      const { documentId, versionNo, baseRevision } = input
      return run(async (client) => {
        const open = await deps.openCopy(documentId)
        // the web's base is `doc.kind === 'file' ? doc.revision : undefined`; when neither the
        // renderer nor an open tab names one, the document is asked for its kind and revision
        let base = baseRevision ?? open?.baseRevision ?? undefined
        if (base === undefined) {
          const head = await client.getDocumentHead(documentId)
          if (head.kind === 'file') base = head.revision
        }
        const result = await client.restoreVersion(documentId, versionNo, {
          idempotencyKey: key,
          ...(base ? { baseRevision: base } : {}),
          ...(open?.editLockId ? { editLockId: open.editLockId } : {}),
        })
        deps.noteRestored({
          documentId,
          revision: result.document.revision,
          version: result.document.current_version,
          versionId: result.version.id,
        })
        return result
      })
    },

    openVersion(input) {
      if (!isObject(input) || !isText(input.documentId) || !isVersionNo(input.versionNo)) {
        return invalidRequest()
      }
      const { documentId, versionNo } = input
      return run(async (client) => {
        // a page version has no file to open: the sheet previews its content instead
        const version = await client.getVersion(documentId, versionNo)
        if (version.kind !== 'file') throw new UniworkDocError('unsupported_format')
        return deps.openVersionView(documentId, versionNo)
      })
    },

    async downloadVersion(input) {
      if (!isObject(input) || !isText(input.documentId) || !isVersionNo(input.versionNo)) {
        return invalidRequest()
      }
      if (input.suggestedName !== undefined && typeof input.suggestedName !== 'string') {
        return invalidRequest()
      }
      if (!deps.isSignedIn()) return { ok: false, error: 'not_signed_in' }
      const name = input.suggestedName?.trim() || FALLBACK_NAME
      try {
        const saved = await deps.downloadVersion(input.documentId, input.versionNo, name)
        if (saved === null) return { ok: false, error: 'dialog_canceled' }
        if (saved === 'forbidden_target') return { ok: false, error: 'forbidden_target' }
        return { ok: true, value: saved }
      } catch (error) {
        // the server's answers are coded; anything else came from writing the file
        if (error instanceof UniworkDocError) return docHistoryErrorOf(error)
        return { ok: false, error: 'write_failed' }
      }
    },

    accessLogs(input) {
      if (!isObject(input) || !isText(input.documentId)) return invalidRequest()
      const page = pageOf(input, DOC_ACCESS_LOG_PAGE_SIZE)
      if (!page) return invalidRequest()
      const action = input.action
      if (
        action !== undefined &&
        action !== '' &&
        !(DOC_ACCESS_LOG_ACTIONS as readonly string[]).includes(action as string)
      ) {
        return invalidRequest()
      }
      const { documentId } = input
      return run((client) =>
        client.listAccessLogs(documentId, {
          ...page,
          ...(action ? { action: action as DocAccessLogAction } : {}),
        }),
      )
    },
  }
}

/**
 * The channels. `ipc` is the guarded object from the composition (UNI-2073): `uniwork-doc-history:*`
 * falls under the default `shell` policy, so only the shell window's main frame is answered. A
 * refused sender makes the guard throw `ipc_sender_refused`; the preload turns that into `forbidden`.
 */
export function registerDocHistoryIpc(
  ipc: Pick<IpcMain, 'handle'>,
  service: UniworkDocHistoryApi,
): void {
  const handle = (channel: string, name: keyof UniworkDocHistoryApi): void => {
    ipc.handle(channel, (_event, input: unknown) =>
      (service[name] as (input: unknown) => Promise<unknown>)(input),
    )
  }
  handle(DOC_HISTORY_CHANNELS.versions, 'versions')
  handle(DOC_HISTORY_CHANNELS.version, 'version')
  handle(DOC_HISTORY_CHANNELS.createVersion, 'createVersion')
  handle(DOC_HISTORY_CHANNELS.restore, 'restore')
  handle(DOC_HISTORY_CHANNELS.openVersion, 'openVersion')
  handle(DOC_HISTORY_CHANNELS.downloadVersion, 'downloadVersion')
  handle(DOC_HISTORY_CHANNELS.accessLogs, 'accessLogs')
}

/**
 * The history client of the current profile, rebuilt when the origin changes (the
 * same lifecycle as the share client). No profile = not signed in.
 */
export function createDocHistoryClientProvider(deps: {
  profile(): { apiOrigin: string } | null
  authorized: UniworkDocsClientOptions['authorized']
  isSignedIn(): boolean
  fetch?: FetchLike
}): () => DocHistoryClient {
  let client: DocHistoryClient | null = null
  let origin: string | null = null
  return () => {
    const profile = deps.profile()
    if (!profile) throw new UniworkDocError('not_signed_in')
    if (!client || origin !== profile.apiOrigin) {
      client = createDocHistoryClient({
        apiOrigin: profile.apiOrigin,
        authorized: deps.authorized,
        isSignedIn: deps.isSignedIn,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      })
      origin = profile.apiOrigin
    }
    return client
  }
}
