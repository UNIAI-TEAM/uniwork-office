import { ID, createAuthorizedGet, jsonOrUndefined, type AuthorizedGetOptions } from '../feed/http'
import type { CapabilityFetch } from './cache'

/**
 * CapabilityFetch over the deployment's `GET /api/v1/orgs/{orgID}/office/capabilities`.
 * A session the refresh could not save answers status 401; network, timeout
 * and egress refusals reject (the cache reads them as offline).
 */
export function createCapabilityFetch(options: AuthorizedGetOptions): CapabilityFetch {
  const get = createAuthorizedGet(options)
  return async (orgId) => {
    if (!ID.test(orgId)) throw new Error('uniwork capabilities: invalid org id')
    const outcome = await get(`/orgs/${encodeURIComponent(orgId)}/office/capabilities`)
    if (outcome.kind === 'session_expired') return { status: 401, body: undefined }
    if (outcome.kind === 'failed') throw outcome.error
    return { status: outcome.status, body: jsonOrUndefined(outcome.text) }
  }
}
