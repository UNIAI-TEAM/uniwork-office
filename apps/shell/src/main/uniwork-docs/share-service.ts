import {
  SHARE_LEVELS,
  SHARE_PRINCIPAL_TYPES,
  type ShareBulkFailure,
  type ShareBulkPlan,
  type ShareBulkResult,
  type ShareErrorCode,
  type ShareResult,
  type ShareUpdateItem,
  type UniworkShareApi,
} from '../../shared/share-api'
import type { FetchLike, UniworkDocsClientOptions } from './client'
import { UniworkDocError } from './errors'
import { createUniworkShareClient, type UniworkShareClient } from './share-client'

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
