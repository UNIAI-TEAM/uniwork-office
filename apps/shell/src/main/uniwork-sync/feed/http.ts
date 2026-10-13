import { TransportError } from '../../uniwork-auth/transport'
import { METADATA_TIMEOUT_MS, type FetchLike } from '../../uniwork-docs/client'
import { UniworkDocError } from '../../uniwork-docs/errors'

/**
 * One authorized GET against the deployment's `/api/v1`, with the same egress
 * rules as the documents client: fixed origin, no redirect, no cache, a
 * deadline over the whole exchange, the bearer token only inside
 * `authorized` (one refresh + retry on 401). The raw status and text come
 * back so each caller parses its own body (the feed keeps int64 revisions).
 */
export interface AuthorizedGetOptions {
  /** normalized deployment origin (no trailing slash), validated by the profile */
  apiOrigin: string
  /** the auth module's authorizedRequest */
  authorized<T>(call: (token: string) => Promise<T>): Promise<T>
  isSignedIn(): boolean
  fetch?: FetchLike
  timeoutMs?: number
}

export type GetOutcome =
  | { kind: 'response'; status: number; text: string }
  | { kind: 'session_expired' }
  | { kind: 'failed'; error: UniworkDocError }

/** a feed page is at most 500 rows of ids; anything far past that is refused */
const MAX_BODY_CHARS = 8 * 1024 * 1024
export const ID = /^[A-Za-z0-9_-]{1,128}$/

function isRedirectRefusal(error: unknown): boolean {
  const text = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ''))
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined
  return /redirect/i.test(text(error)) || /redirect/i.test(text(cause))
}

function fromFailure(error: unknown): GetOutcome {
  if (error instanceof UniworkDocError) return { kind: 'failed', error }
  if (error instanceof TransportError) {
    if (
      error.code === 'unauthorized' ||
      error.code === 'device_revoked' ||
      error.code === 'refresh_reused'
    ) {
      return { kind: 'session_expired' }
    }
    if (error.code === 'network' || error.code === 'timeout' || error.code === 'wrong_deployment') {
      return { kind: 'failed', error: new UniworkDocError(error.code) }
    }
  }
  return { kind: 'failed', error: new UniworkDocError('server_error') }
}

export function createAuthorizedGet(
  options: AuthorizedGetOptions,
): (route: string, query?: URLSearchParams) => Promise<GetOutcome> {
  const base = `${new URL(options.apiOrigin).origin}/api/v1`
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
  const timeoutMs = options.timeoutMs ?? METADATA_TIMEOUT_MS

  return async (route, query) => {
    if (!options.isSignedIn())
      return { kind: 'failed', error: new UniworkDocError('not_signed_in') }
    const search = query?.toString()
    const url = `${base}${route}${search ? `?${search}` : ''}`
    if (!url.startsWith(`${base}/`)) {
      return { kind: 'failed', error: new UniworkDocError('server_error') }
    }
    try {
      return await options.authorized(async (token): Promise<GetOutcome> => {
        const controller = new AbortController()
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          controller.abort()
        }, timeoutMs)
        try {
          let response: Response
          try {
            response = await fetchImpl(url, {
              method: 'GET',
              headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
              cache: 'no-store',
              redirect: 'error',
              signal: controller.signal,
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
          // authorized() refreshes once and calls again; a second 401 ends it
          if (response.status === 401) throw new TransportError('unauthorized', 401)
          let text: string
          try {
            text = await response.text()
          } catch {
            throw new UniworkDocError(timedOut ? 'timeout' : 'network')
          }
          if (timedOut) throw new UniworkDocError('timeout')
          if (text.length > MAX_BODY_CHARS) throw new UniworkDocError('malformed_response')
          return { kind: 'response', status: response.status, text }
        } finally {
          clearTimeout(timer)
        }
      })
    } catch (error) {
      return fromFailure(error)
    }
  }
}

/** the body as JSON, or undefined when it is not (a gateway page, an empty body) */
export function jsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}
