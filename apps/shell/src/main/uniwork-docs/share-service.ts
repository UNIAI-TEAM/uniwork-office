import {
  FOLDER_CONTENTS_ACCESS_MAX_ITEMS,
  FOLDER_CONTENTS_ACCESS_MODES,
  SHARE_LEVELS,
  SHARE_OWNER_KEEP_LEVELS,
  SHARE_PRINCIPAL_TYPES,
  type FolderContentsAccessRequest,
  type ShareAccess,
  type ShareBulkFailure,
  type ShareBulkPlan,
  type ShareBulkResult,
  type ShareErrorCode,
  type ShareOwnerCandidate,
  type ShareResult,
  type ShareUpdateItem,
  type UniworkShareApi,
} from '../../shared/share-api'
import type { FetchLike, UniworkDocsClientOptions } from './client'
import { UniworkDocError } from './errors'
import { createUniworkShareClient, type UniworkShareClient } from './share-client'
import type { ShareOwnerGate } from './share-parse'

/**
 * UNI-2047 SD-A: the service behind the `uniwork-share:*` channels. It resolves
 * the signed-in session and the selected organization, answers every call with a
 * `ShareResult` (never a rejection, so nothing crosses IPC as an exception), maps
 * the server's refusals the way the web does, and runs the bulk plan one document
 * after another like the web's `hooks-bulk-share.ts` (there is no multi-document
 * route, so each document gets the calls its own Share dialog makes).
 */

export interface UniworkShareServiceDeps {
  /** the client of the current profile; throws `not_signed_in` without one */
  client(): UniworkShareClient
  isSignedIn(): boolean
  /** the selected organization (the links policy is read for it) */
  selectedOrgId(): string | null
  /** the selected organization's slug (its member list is read by it) */
  selectedOrgSlug(): string | null
  /** UNI-2078: the signed-in user's id (an admin may not take a restricted document for themselves) */
  selfUserId?(): string | null
  /** waits out a throttle between the two tries of one call; a test seam */
  wait?(ms: number): Promise<void>
}

type Failure = Extract<ShareResult<never>, { ok: false }>

/** server verdicts the dialog names, each kept as the code the server sent */
const KEPT_SERVER_CODES: ReadonlySet<string> = new Set<ShareErrorCode>([
  'document_access_rejected',
  'document_link_limit',
  'document_links_disabled',
  'document_shelved',
  'my_folder_locked',
  'folder_not_shareable',
  'break_glass_required',
  'break_glass_reason_invalid',
  'access_request_closed',
  'owner_target_not_member',
  'document_owned_by_work_product',
  'not_a_folder',
  'folder_access_batch_running',
])

/** the app's transport / session codes, kept as they are */
const KEPT_DOC_CODES: ReadonlySet<string> = new Set<ShareErrorCode>([
  'not_signed_in',
  'session_expired',
  'wrong_deployment',
  'network',
  'timeout',
  'malformed_response',
  'folder_not_shareable',
  'document_archived',
])

const FORBIDDEN_DOC_CODES: ReadonlySet<string> = new Set([
  'forbidden',
  'permission_revoked',
  'member_deactivated',
  'organization_suspended',
])
const NOT_FOUND_DOC_CODES: ReadonlySet<string> = new Set([
  'not_found',
  'deleted',
  'document_deleted',
])

/** UNI-2078: the answers of a server that has no owner route yet (UNI-2084 lands it) */
const MISSING_ROUTE_STATUSES: ReadonlySet<number> = new Set([404, 405, 501])
/** UNI-2078: the active-member walk stops here (the web's bound: 40 pages) */
const MAX_MEMBER_PAGES = 40

/** a run id the 409 `folder_access_batch_running` names (a ULID); anything else is not passed on */
const BATCH_ID = /^[A-Za-z0-9_-]{1,128}$/

const DEFAULT_THROTTLE_WAIT_MS = 1000
const MAX_THROTTLE_WAIT_MS = 5000

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function isThrottle(error: unknown): boolean {
  return error instanceof UniworkDocError && (error.status === 429 || error.status === 503)
}

/** the renderer is untrusted: the web's own bounds, and a ceiling on how long one run can go */
const MAX_BULK_DOCS = 500
const MAX_BULK_PEOPLE = 100
const MIN_LINK_DAYS = 1
const MAX_LINK_DAYS = 90

function batchIdOf(error: UniworkDocError): { batchId?: string } {
  const id = error.fields?.batch_id
  return typeof id === 'string' && BATCH_ID.test(id) ? { batchId: id } : {}
}

/**
 * A thrown error as the failure result of the contract: the server's own verdicts
 * keep their names (`document_access_rejected` carries the refused items), a 403 is
 * `forbidden` and a 404 `not_found`, the transport codes pass through, and a throttle
 * is marked `retryable`. Anything that is not a UniworkDocError is `server_error`.
 */
export function shareErrorOf(error: unknown): Failure {
  if (!(error instanceof UniworkDocError)) return { ok: false, error: 'server_error' }
  const status = error.status
  const at = status === undefined ? {} : { status }
  const serverCode = error.serverCode
  if (serverCode === 'invalid_input') return { ok: false, error: 'invalid_request' }
  if (serverCode && KEPT_SERVER_CODES.has(serverCode)) {
    return {
      ok: false,
      error: serverCode as ShareErrorCode,
      ...at,
      ...(serverCode === 'document_access_rejected' && error.rejected
        ? { rejected: error.rejected }
        : {}),
      // UNI-2244: the run that holds the folder, so the caller can attach to its progress
      ...(serverCode === 'folder_access_batch_running' ? batchIdOf(error) : {}),
    }
  }
  if (FORBIDDEN_DOC_CODES.has(error.code)) return { ok: false, error: 'forbidden', ...at }
  if (NOT_FOUND_DOC_CODES.has(error.code)) return { ok: false, error: 'not_found', ...at }
  if (KEPT_DOC_CODES.has(error.code)) {
    return { ok: false, error: error.code as ShareErrorCode, ...at }
  }
  return {
    ok: false,
    error: 'server_error',
    ...at,
    ...(isThrottle(error) ? { retryable: true } : {}),
  }
}

const invalidRequest = (): Failure => ({ ok: false, error: 'invalid_request' })

/** UNI-2078: the owner route is not on this server (the button hides for the session) */
class MissingRoute extends Error {
  constructor(readonly refusal: UniworkDocError) {
    super('endpoint_missing')
  }
}

/**
 * UNI-2244: a plain 404 / 405 / 501 (no envelope) is a server without the route; a coded one
 * (a foreign batch, a folder that is gone) came from a handler that ran and stays a normal failure.
 */
function missingRouteOf(error: unknown): unknown {
  return error instanceof UniworkDocError &&
    !error.serverCode &&
    MISSING_ROUTE_STATUSES.has(error.status ?? 0)
    ? new MissingRoute(error)
    : error
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0

/** the structural check of a bulk plan; the client checks each value when it sends it */
function isBulkPlan(plan: unknown): plan is ShareBulkPlan {
  if (!isObject(plan)) return false
  if (!Array.isArray(plan.docs) || !Array.isArray(plan.people)) return false
  if (plan.docs.length > MAX_BULK_DOCS || plan.people.length > MAX_BULK_PEOPLE) return false
  if (!plan.docs.every((d) => isObject(d) && isText(d.id) && isText(d.workspaceId))) return false
  if (
    !plan.people.every(
      (p) =>
        isObject(p) &&
        (SHARE_PRINCIPAL_TYPES as readonly string[]).includes(p.principalType as string) &&
        isText(p.principalId) &&
        (SHARE_LEVELS as readonly string[]).includes(p.level as string),
    )
  ) {
    return false
  }
  if (plan.onExisting !== 'update' && plan.onExisting !== 'keep') return false
  if (!['keep', 'none', 'view', 'comment', 'edit'].includes(plan.workspace as string)) return false
  if (!['keep', 'create', 'revoke'].includes(plan.link as string)) return false
  // a bad expiry would fail only at the link call, after the access update was already written
  return (
    plan.expiresInDays === undefined ||
    (Number.isInteger(plan.expiresInDays) &&
      (plan.expiresInDays as number) >= MIN_LINK_DAYS &&
      (plan.expiresInDays as number) <= MAX_LINK_DAYS)
  )
}

/** the structural check of a folder contents access request; the client checks each value again */
function isFolderContentsRequest(input: unknown): input is FolderContentsAccessRequest {
  if (!isObject(input) || !isText(input.folderId)) return false
  if (!(FOLDER_CONTENTS_ACCESS_MODES as readonly string[]).includes(input.mode as string)) {
    return false
  }
  if (typeof input.dryRun !== 'boolean' || !Array.isArray(input.items)) return false
  if (input.items.length > FOLDER_CONTENTS_ACCESS_MAX_ITEMS) return false
  // an empty list only removes shares, which only `replace` does
  if (input.items.length === 0 && input.mode !== 'replace') return false
  return input.items.every(
    (item) =>
      isObject(item) &&
      (SHARE_PRINCIPAL_TYPES as readonly string[]).includes(item.principalType as string) &&
      isText(item.principalId) &&
      (SHARE_LEVELS as readonly string[]).includes(item.level as string),
  )
}

/** a refusal of the owner gate, by the code shareErrorOf keeps */
const refused = (serverCode: string): UniworkDocError =>
  new UniworkDocError('server_error', { serverCode })

/**
 * UNI-2078: the owner transfer gate the web applies (canAdministerDocument), checked in main
 * because the renderer is not trusted: manage or admin_scope, not owned by a work product, not
 * shelved. `selfExcluded` = an admin reaching a restricted document only through admin_scope,
 * who may not take it (the server answers break_glass_required).
 */
function ownerGateOf(access: ShareAccess, doc: ShareOwnerGate): { selfExcluded: boolean } {
  if (access.myLevel !== 'manage' && !access.adminScope) throw new UniworkDocError('forbidden')
  if (doc.ownerKind) throw refused('document_owned_by_work_product')
  if (doc.shelved) throw refused('document_shelved')
  return {
    selfExcluded:
      access.adminScope && access.myLevel !== 'manage' && doc.visibility === 'restricted',
  }
}

/** the access items one document gets: the same people, then its own home-workspace row */
function bulkItems(plan: ShareBulkPlan, workspaceId: string): ShareUpdateItem[] {
  const items: ShareUpdateItem[] = plan.people.map((person) => ({
    principalType: person.principalType,
    principalId: person.principalId,
    level: person.level,
    onExisting: plan.onExisting,
  }))
  if (plan.workspace === 'none') {
    items.push({ principalType: 'workspace', principalId: workspaceId, level: null })
  } else if (plan.workspace !== 'keep') {
    items.push({
      principalType: 'workspace',
      principalId: workspaceId,
      level: plan.workspace,
      onExisting: 'update',
    })
  }
  return items
}

export function createUniworkShareService(deps: UniworkShareServiceDeps): UniworkShareApi {
  const wait = deps.wait ?? sleep

  async function run<T>(call: (client: UniworkShareClient) => Promise<T>): Promise<ShareResult<T>> {
    try {
      if (!deps.isSignedIn()) return { ok: false, error: 'not_signed_in' }
      return { ok: true, value: await call(deps.client()) }
    } catch (error) {
      if (error instanceof MissingRoute) {
        return { ...shareErrorOf(error.refusal), endpointMissing: true }
      }
      return shareErrorOf(error)
    }
  }

  /**
   * one call, repeated once after the wait when the server throttled it. A call that is not
   * idempotent (a link create) is repeated on a 429 only: a 503 may have come after the commit.
   */
  async function withRetry<T>(call: () => Promise<T>, idempotent = true): Promise<T> {
    try {
      return await call()
    } catch (error) {
      if (!isThrottle(error)) throw error
      if (!idempotent && (error as UniworkDocError).status !== 429) throw error
      const asked = (error as UniworkDocError).retryAfterMs
      await wait(Math.min(asked ?? DEFAULT_THROTTLE_WAIT_MS, MAX_THROTTLE_WAIT_MS))
      return call()
    }
  }

  /** the overview (level, admin scope, owner) and the document, both read fresh */
  async function readOwnerGate(client: UniworkShareClient, documentId: string) {
    const access = await withRetry(() => client.getDocumentShares(documentId))
    const doc = await withRetry(() => client.getOwnerGate(documentId))
    return { access, doc, ...ownerGateOf(access, doc) }
  }

  async function shareOne(
    client: UniworkShareClient,
    plan: ShareBulkPlan,
    doc: { id: string; workspaceId: string },
    links: Map<string, string>,
  ): Promise<void> {
    const items = bulkItems(plan, doc.workspaceId)
    if (items.length > 0) {
      await withRetry(() => client.updateDocumentAccess(doc.id, { items, dryRun: false }))
    }
    if (plan.link === 'create') {
      const created = await withRetry(
        () => client.createDocumentLink(doc.id, plan.expiresInDays),
        false,
      )
      // a link nobody can copy is not a created link
      if (!created.url) throw new UniworkDocError('malformed_response')
      links.set(doc.id, created.url)
    } else if (plan.link === 'revoke') {
      const access = await withRetry(() => client.getDocumentShares(doc.id))
      for (const link of access.links ?? []) {
        await withRetry(() => client.revokeDocumentLink(doc.id, link.id))
      }
    }
  }

  return {
    get(documentId) {
      if (!isText(documentId)) return Promise.resolve(invalidRequest())
      return run((client) => client.getDocumentShares(documentId))
    },

    update(input) {
      if (!isObject(input) || !isText(input.documentId) || !Array.isArray(input.items)) {
        return Promise.resolve(invalidRequest())
      }
      const { documentId, items, dryRun } = input
      return run((client) =>
        client.updateDocumentAccess(documentId, {
          items,
          ...(typeof dryRun === 'boolean' ? { dryRun } : {}),
        }),
      )
    },

    candidates(input) {
      if (!isObject(input) || !isText(input.documentId)) return Promise.resolve(invalidRequest())
      const { documentId, q, cursor, limit } = input
      return run((client) =>
        client.listShareCandidates(documentId, {
          ...(typeof q === 'string' ? { q } : {}),
          ...(typeof cursor === 'string' ? { cursor } : {}),
          ...(typeof limit === 'number' ? { limit } : {}),
        }),
      )
    },

    linkCreate(input) {
      if (!isObject(input) || !isText(input.documentId)) return Promise.resolve(invalidRequest())
      return run((client) => client.createDocumentLink(input.documentId, input.expiresInDays))
    },

    linkRevoke(input) {
      if (!isObject(input) || !isText(input.documentId) || !isText(input.linkId)) {
        return Promise.resolve(invalidRequest())
      }
      const { documentId, linkId } = input
      return run(async (client) => {
        await client.revokeDocumentLink(documentId, linkId)
        return { documentId, linkId }
      })
    },

    settings() {
      return run((client) => {
        const orgId = deps.selectedOrgId()
        if (!orgId) throw new UniworkDocError('not_found')
        return client.getDocumentSettings(orgId)
      })
    },

    requests(documentId) {
      if (!isText(documentId)) return Promise.resolve(invalidRequest())
      return run((client) => client.listAccessRequests(documentId))
    },

    requestApprove(input) {
      if (!isObject(input) || !isText(input.documentId) || !isText(input.requestId)) {
        return Promise.resolve(invalidRequest())
      }
      const { documentId, requestId, level } = input
      return run((client) => client.approveAccessRequest(documentId, requestId, level))
    },

    requestDecline(input) {
      if (!isObject(input) || !isText(input.documentId) || !isText(input.requestId)) {
        return Promise.resolve(invalidRequest())
      }
      const { documentId, requestId } = input
      return run((client) => client.declineAccessRequest(documentId, requestId))
    },

    breakGlassGrant(input) {
      if (!isObject(input) || !isText(input.documentId) || typeof input.reason !== 'string') {
        return Promise.resolve(invalidRequest())
      }
      const { documentId, reason } = input
      return run((client) => client.createDocumentBreakGlass(documentId, reason))
    },

    breakGlassRevoke(input) {
      if (!isObject(input) || !isText(input.documentId) || !isText(input.grantId)) {
        return Promise.resolve(invalidRequest())
      }
      const { documentId, grantId } = input
      return run(async (client) => {
        await client.revokeDocumentBreakGlass(documentId, grantId)
        return { documentId, grantId }
      })
    },

    members(input) {
      if (!isObject(input)) return Promise.resolve(invalidRequest())
      const { cursor, limit } = input
      return run((client) => {
        const orgSlug = deps.selectedOrgSlug()
        if (!orgSlug) throw new UniworkDocError('not_found')
        return client.listOrgMembers({
          orgSlug,
          ...(typeof cursor === 'string' ? { cursor } : {}),
          ...(typeof limit === 'number' ? { limit } : {}),
        })
      })
    },

    ownerCandidates(documentId) {
      if (!isText(documentId)) return Promise.resolve(invalidRequest())
      return run(async (client) => {
        const orgSlug = deps.selectedOrgSlug()
        if (!orgSlug) throw new UniworkDocError('not_found')
        const { access, doc, selfExcluded } = await readOwnerGate(client, documentId)
        const memberIds = await withRetry(() => client.listWorkspaceMemberIds(doc.workspaceId))
        // agents are never workspace members; a deactivated person is absent from the active list
        const active = new Map<string, ShareOwnerCandidate>()
        let cursor = ''
        for (let page = 0; page < MAX_MEMBER_PAGES; page++) {
          const at = cursor
          const next = await withRetry(() =>
            client.listActiveOrgMembers({ orgSlug, ...(at ? { cursor: at } : {}) }),
          )
          for (const member of next.members) active.set(member.userId, member)
          cursor = next.nextCursor
          if (!cursor) break
        }
        const self = deps.selfUserId?.() ?? null
        const ownerId = access.owner?.userId
        return [...new Set(memberIds)].flatMap((userId) => {
          const member = active.get(userId)
          if (!member || userId === ownerId) return []
          if (selfExcluded && userId === self) return []
          return [{ ...member }]
        })
      })
    },

    transferOwner(input) {
      if (
        !isObject(input) ||
        !isText(input.documentId) ||
        !isText(input.userId) ||
        (input.previousOwnerLevel !== undefined &&
          !(SHARE_OWNER_KEEP_LEVELS as readonly string[]).includes(input.previousOwnerLevel))
      ) {
        return Promise.resolve(invalidRequest())
      }
      const { documentId, userId, previousOwnerLevel } = input
      return run(async (client) => {
        const { access, selfExcluded } = await readOwnerGate(client, documentId)
        // the owner already owns it: nothing to transfer
        if (userId === access.owner?.userId) throw refused('invalid_input')
        if (selfExcluded && userId === deps.selfUserId?.()) throw refused('break_glass_required')
        try {
          // a 503 may come after the commit: only a 429 is repeated
          return await withRetry(
            () =>
              client.transferDocumentOwner(documentId, {
                userId,
                ...(previousOwnerLevel ? { previousOwnerLevel } : {}),
              }),
            false,
          )
        } catch (error) {
          // a missing route answers a plain 404/405 (the router has no custom NotFound handler); a
          // coded one came from a handler that ran, a normal failure
          if (
            error instanceof UniworkDocError &&
            !error.serverCode &&
            MISSING_ROUTE_STATUSES.has(error.status ?? 0)
          ) {
            throw new MissingRoute(error)
          }
          throw error
        }
      })
    },

    folderContentsAccess(request) {
      if (!isFolderContentsRequest(request)) return Promise.resolve(invalidRequest())
      // only the plain request is forwarded: whatever else the renderer put on the object stays here
      const { folderId, mode, items, dryRun } = request
      const plain = {
        folderId,
        mode,
        dryRun,
        items: items.map(({ principalType, principalId, level }) => ({
          principalType,
          principalId,
          level,
        })),
      }
      return run(async (client) => {
        try {
          // a dry run repeats safely; a write is never repeated (a 503 may come after the commit)
          return await withRetry(() => client.updateFolderContentsAccess(plain), dryRun)
        } catch (error) {
          throw missingRouteOf(error)
        }
      })
    },

    folderContentsAccessBatch(request) {
      if (!isObject(request) || !isText(request.folderId) || !isText(request.batchId)) {
        return Promise.resolve(invalidRequest())
      }
      const { folderId, batchId } = request
      return run(async (client) => {
        try {
          return await withRetry(() => client.getFolderContentsAccessBatch(folderId, batchId))
        } catch (error) {
          throw missingRouteOf(error)
        }
      })
    },

    bulk(plan) {
      if (!isBulkPlan(plan)) return Promise.resolve(invalidRequest())
      return run(async (client) => {
        // each document once, in the order given
        const docs = new Map(plan.docs.map((doc) => [doc.id, doc]))
        const links = new Map<string, string>()
        const result: ShareBulkResult = { ok: [], failed: [], links: [] }
        for (const doc of docs.values()) {
          try {
            await shareOne(client, plan, doc, links)
            result.ok.push(doc.id)
          } catch (error) {
            const failure = shareErrorOf(error)
            const entry: ShareBulkFailure = {
              id: doc.id,
              error: failure.error,
              ...(failure.rejected ? { rejected: failure.rejected } : {}),
              ...(failure.retryable ? { retryable: true } : {}),
            }
            result.failed.push(entry)
          }
        }
        for (const id of result.ok) {
          const url = links.get(id)
          if (url) result.links.push({ id, url })
        }
        return result
      })
    },
  }
}

/**
 * The share client of the current profile, rebuilt when the origin changes (the
 * same lifecycle as the documents service's own `api()`). No profile = not signed in.
 */
export function createShareClientProvider(deps: {
  profile(): { apiOrigin: string } | null
  authorized: UniworkDocsClientOptions['authorized']
  isSignedIn(): boolean
  fetch?: FetchLike
}): () => UniworkShareClient {
  let client: UniworkShareClient | null = null
  let origin: string | null = null
  return () => {
    const profile = deps.profile()
    if (!profile) throw new UniworkDocError('not_signed_in')
    if (!client || origin !== profile.apiOrigin) {
      client = createUniworkShareClient({
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
