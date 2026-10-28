import type { UniworkDocSummary } from '../../shared/home-api'
import type { FetchLike } from './client'

/**
 * UNI-2275 R1-1: Main-process avatar fetcher for `updated_by_user.avatar_url`.
 *
 * Fetches an editor's avatar in main so the shell renderer keeps its strict
 * `img-src 'self' data: blob:` CSP and never receives or requests raw
 * presigned storage URLs directly.
 *
 * Security invariants:
 * - Only `https:` URLs (without embedded credentials) are accepted; redirects
 *   are handled manually (at most 2 hops, every hop validated as `https:`).
 * - Credentials omitted, no Referer, cache bypassed on the wire, short timeout.
 * - Body stream capped at 2 MiB (`2 << 20`, matching the server's `MaxBytes`).
 * - Magic-byte sniffing accepts only PNG, JPEG, GIF, and WebP; SVG, HTML, and
 *   all other payloads are refused regardless of `Content-Type`.
 * - Cached in memory by `origin + pathname` (ignoring rotating presigned query
 *   signatures) with a TTL under 12 hours, and in-flight requests are deduped
 *   per cache key.
 * - Any error or refusal resolves to `null` so the row falls back to initials
 *   and never fails the document list.
 */

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
export const AVATAR_MAX_REDIRECTS = 2
export const AVATAR_TIMEOUT_MS = 5_000
/** 6 hours (< 12 h server presign window) */
export const AVATAR_CACHE_TTL_MS = 6 * 60 * 60_000
const AVATAR_CACHE_MAX_ENTRIES = 500

export interface AvatarCacheOptions {
  fetch?: FetchLike
  now?: () => number
  timeoutMs?: number
  ttlMs?: number
  maxBytes?: number
  maxRedirects?: number
}

export interface AvatarCache {
  resolveUrl(rawUrl: string): Promise<string | null>
  resolveRows(rows: readonly UniworkDocSummary[]): Promise<UniworkDocSummary[]>
  clear(): void
}

function parseHttpsUrl(raw: string): URL | null {
  if (typeof raw !== 'string' || !raw || raw.length > 2048) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    return url
  } catch {
    return null
  }
}

export function avatarCacheKey(raw: string): string | null {
  const url = parseHttpsUrl(raw)
  return url ? `${url.origin}${url.pathname}` : null
}

/**
 * Sniffs PNG, JPEG, GIF, or WebP magic bytes from the start of the payload.
 * Returns the canonical MIME type, or `null` for SVG, HTML, or any other bytes.
 */
export function sniffAvatarMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | null {
  if (bytes.byteLength < 12) return null
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  // GIF87a / GIF89a: 47 49 46 38 (37|39) 61
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif'
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

async function readCappedBytes(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array | null> {
  const lengthHeader = response.headers.get('Content-Length')
  if (lengthHeader !== null) {
    const declared = Number(lengthHeader)
    if (Number.isFinite(declared) && declared > maxBytes) {
      void response.body?.cancel().catch(() => undefined)
      return null
    }
  }
  if (!response.body) return null
  const reader = response.body.getReader()
  const onAbort = () => void reader.cancel().catch(() => undefined)
  signal.addEventListener('abort', onAbort, { once: true })
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      if (signal.aborted) return null
      const step = await reader.read()
      if (signal.aborted) return null
      if (step.done) break
      total += step.value.byteLength
      if (total > maxBytes) {
        onAbort()
        return null
      }
      chunks.push(step.value)
    }
  } catch {
    return null
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
  if (total === 0) return null
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export function createAvatarCache(options: AvatarCacheOptions = {}): AvatarCache {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
  const now = options.now ?? (() => Date.now())
  const timeoutMs = options.timeoutMs ?? AVATAR_TIMEOUT_MS
  const ttlMs = Math.min(options.ttlMs ?? AVATAR_CACHE_TTL_MS, 12 * 60 * 60_000 - 1)
  const maxBytes = options.maxBytes ?? AVATAR_MAX_BYTES
  const maxRedirects = options.maxRedirects ?? AVATAR_MAX_REDIRECTS

  const entries = new Map<string, { dataUrl: string; expiresAt: number }>()
  const inFlight = new Map<string, Promise<string | null>>()

  async function fetchDataUrl(initialUrl: URL): Promise<string | null> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      let current = initialUrl
      for (let hop = 0; hop <= maxRedirects; hop += 1) {
        if (controller.signal.aborted) return null
        let response: Response
        try {
          response = await fetchImpl(current.toString(), {
            method: 'GET',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            referrer: '',
            redirect: 'manual',
            cache: 'no-store',
            headers: {
              Accept: 'image/png, image/jpeg, image/gif, image/webp',
            },
            signal: controller.signal,
          })
        } catch {
          return null
        }
        if (response.status >= 300 && response.status < 400) {
          void response.body?.cancel().catch(() => undefined)
          if (hop >= maxRedirects) return null
          const location = response.headers.get('Location')
          if (!location) return null
          let target: URL
          try {
            target = new URL(location, current)
          } catch {
            return null
          }
          const validated = parseHttpsUrl(target.toString())
          if (!validated) return null
          current = validated
          continue
        }
        if (response.redirected) {
          if (!response.url || !parseHttpsUrl(response.url)) {
            void response.body?.cancel().catch(() => undefined)
            return null
          }
        }
        if (response.status !== 200) {
          void response.body?.cancel().catch(() => undefined)
          return null
        }
        const bytes = await readCappedBytes(response, maxBytes, controller.signal)
        if (!bytes) return null
        const mime = sniffAvatarMime(bytes)
        if (!mime) return null
        return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
      }
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  function resolveUrl(rawUrl: string): Promise<string | null> {
    const parsed = parseHttpsUrl(rawUrl)
    if (!parsed) return Promise.resolve(null)
    const key = `${parsed.origin}${parsed.pathname}`
    const ts = now()
    const hit = entries.get(key)
    if (hit) {
      if (ts < hit.expiresAt) return Promise.resolve(hit.dataUrl)
      entries.delete(key)
    }
    const existing = inFlight.get(key)
    if (existing) return existing
    const task = fetchDataUrl(parsed)
      .then((dataUrl) => {
        if (dataUrl) {
          if (entries.size >= AVATAR_CACHE_MAX_ENTRIES) {
            const oldest = entries.keys().next().value
            if (oldest !== undefined) entries.delete(oldest)
          }
          entries.set(key, { dataUrl, expiresAt: now() + ttlMs })
        }
        return dataUrl
      })
      .catch(() => null)
      .finally(() => {
        inFlight.delete(key)
      })
    inFlight.set(key, task)
    return task
  }

  async function resolveRows(rows: readonly UniworkDocSummary[]): Promise<UniworkDocSummary[]> {
    let anyWithAvatar = false
    for (const row of rows) {
      if (row.updatedByUser?.avatarUrl) {
        anyWithAvatar = true
        break
      }
    }
    if (!anyWithAvatar) return rows as UniworkDocSummary[]

    // Deduplicate per cache key across the page so each unique editor is fetched once
    const byRawUrl = new Map<string, Promise<string | null>>()
    for (const row of rows) {
      const raw = row.updatedByUser?.avatarUrl
      if (raw && !byRawUrl.has(raw)) {
        byRawUrl.set(raw, resolveUrl(raw))
      }
    }
    const resolved = new Map<string, string | null>()
    await Promise.all(
      [...byRawUrl.entries()].map(async ([raw, promise]) => {
        resolved.set(raw, await promise)
      }),
    )

    return rows.map((row) => {
      const user = row.updatedByUser
      if (!user?.avatarUrl) return row
      const dataUrl = resolved.get(user.avatarUrl) ?? null
      return {
        ...row,
        updatedByUser: dataUrl ? { name: user.name, avatarUrl: dataUrl } : { name: user.name },
      }
    })
  }

  function clear(): void {
    entries.clear()
    inFlight.clear()
  }

  return {
    resolveUrl,
    resolveRows,
    clear,
  }
}
