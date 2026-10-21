/**
 * Avatar loader of a web frame (UNI-1986). The host rewrites `avatar_url` of comments and mention
 * candidates to `/api/v1/office-frame/documents/<doc>/avatars/<user>`; that route wants the frame
 * token as a Bearer header, which an `<img>` cannot send, and the frame CSP only allows `blob:`
 * images. So the frame fetches the path itself and hands the collab kit a `blob:` url.
 *
 * - same origin only, `credentials: 'omit'`, `mode: 'same-origin'`; one retry after a 401 with a
 *   refreshed token (the AI client's pattern); the token never goes to another url
 * - PNG / JPEG / GIF / WebP up to 2 MiB; anything else (SVG included) shows initials
 * - `blob:` urls are cached per path (64, least recently used revoked) and revoked on dispose
 * - one request per path in flight, a 404 (or a body we refuse) is remembered for 5 minutes,
 *   at most four requests at a time
 */
import type { AvatarSource } from '../../../../packages/ui/src/collab/avatar-source'

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
export const AVATAR_CACHE_MAX = 64
export const AVATAR_NOT_FOUND_TTL_MS = 5 * 60 * 1000
export const AVATAR_MAX_PARALLEL = 4

const ALLOWED_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

const AVATAR_PATH =
  /^\/api\/v1\/office-frame\/documents\/[0-9A-Za-z]{26}\/avatars\/[0-9A-Za-z]{26}$/

/** exactly `/api/v1/office-frame/documents/<ULID>/avatars/<ULID>` (no query, no host): the only urls the frame token may go to */
export function isAvatarPath(url: string): boolean {
  return AVATAR_PATH.test(url)
}

export interface AvatarLoaderOptions {
  getToken(): Promise<string>
  refreshToken(reason: 'expiring' | 'unauthorized'): Promise<string>
  /** the frame's own origin; default location.origin */
  origin?: string
  doFetch?: typeof fetch
}

export interface AvatarLoader extends AvatarSource {
  dispose(): void
}

export function createAvatarLoader(options: AvatarLoaderOptions): AvatarLoader {
  const origin = options.origin ?? location.origin
  const doFetch = options.doFetch ?? ((input, init) => fetch(input, init))
  /** path -> blob url, in use order (the first key is the least recently used) */
  const cache = new Map<string, string>()
  const inFlight = new Map<string, Promise<string | null>>()
  /** path -> when the memo of its 404 ends */
  const absent = new Map<string, number>()
  const queue: Array<() => void> = []
  let running = 0
  // bumped by dispose: answers of earlier requests are dropped
  let epoch = 0
  let ctl = new AbortController()

  function slot(): Promise<void> {
    if (running < AVATAR_MAX_PARALLEL) {
      running++
      return Promise.resolve()
    }
    return new Promise((resolve) => queue.push(resolve))
  }
  function release(): void {
    const next = queue.shift()
    if (next) next()
    else running--
  }

  async function attempt(url: string, token: string): Promise<Response> {
    return doFetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'omit',
      mode: 'same-origin',
      redirect: 'error',
      signal: ctl.signal,
    })
  }

  /** the blob url of one path, null for "nothing to show"; never rejects */
  async function fetchBlobUrl(path: string, mine: number): Promise<string | null> {
    await slot()
    try {
      if (mine !== epoch) return null
      const url = `${origin}${path}`
      let res = await attempt(url, await options.getToken())
      if (res.status === 401) res = await attempt(url, await options.refreshToken('unauthorized'))
      const remember = (): null => {
        if (mine === epoch) absent.set(path, Date.now() + AVATAR_NOT_FOUND_TTL_MS)
        return null
      }
      if (res.status === 404) return remember()
      if (!res.ok) return null
      const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
      if (!ALLOWED_TYPES.has(type)) return remember()
      // refuse an announced oversize body before buffering it; the real bytes are checked below
      if (Number(res.headers.get('content-length')) > AVATAR_MAX_BYTES) return remember()
      const blob = await res.blob()
      if (blob.size > AVATAR_MAX_BYTES) return remember()
      if (mine !== epoch) return null
      const blobUrl = URL.createObjectURL(blob)
      cache.set(path, blobUrl)
      while (cache.size > AVATAR_CACHE_MAX) {
        const [oldest, oldestUrl] = cache.entries().next().value as [string, string]
        cache.delete(oldest)
        URL.revokeObjectURL(oldestUrl)
      }
      return blobUrl
    } catch {
      return null
    } finally {
      release()
    }
  }

  function untilAborted(signal: AbortSignal): Promise<null> {
    return new Promise((resolve) => {
      if (signal.aborted) resolve(null)
      else signal.addEventListener('abort', () => resolve(null), { once: true })
    })
  }

  return {
    load(path, signal) {
      if (!isAvatarPath(path) || signal.aborted) return Promise.resolve(null)
      const cached = cache.get(path)
      if (cached) {
        cache.delete(path)
        cache.set(path, cached)
        return Promise.resolve(cached)
      }
      const until = absent.get(path)
      if (until !== undefined) {
        if (Date.now() < until) return Promise.resolve(null)
        absent.delete(path)
      }
      let pending = inFlight.get(path)
      if (!pending) {
        const request: Promise<string | null> = fetchBlobUrl(path, epoch).finally(() => {
          if (inFlight.get(path) === request) inFlight.delete(path)
        })
        pending = request
        inFlight.set(path, request)
      }
      // a caller that goes away gets null at once; the shared request still fills the cache
      return Promise.race([pending, untilAborted(signal)])
    },
    dispose() {
      epoch++
      ctl.abort()
      ctl = new AbortController()
      for (const blobUrl of cache.values()) URL.revokeObjectURL(blobUrl)
      cache.clear()
      inFlight.clear()
      absent.clear()
    },
  }
}
