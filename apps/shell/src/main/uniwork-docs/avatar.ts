import type { UniworkDocSummary } from '../../shared/home-api'
import type { FetchLike } from './client'

/**
 * UNI-2275 R1-1 / R2-1..R2-4: Main-process avatar fetcher for `updated_by_user.avatar_url`.
 *
 * Fetches an editor's avatar in main so the shell renderer keeps its strict
 * `img-src 'self' data: blob:` CSP and never receives or requests raw
 * presigned storage URLs directly.
 *
 * Trust model & security invariants:
 * - The avatar URL comes from the authenticated UniWork deployment (presigned
 *   storage URLs or Google photo URLs). There is no private-address policy, by
 *   design, under that trusted-deployment threat model; normal TLS validation
 *   applies and main fetching is not a network sandbox.
 * - Only `https:` URLs (without embedded credentials) are accepted.
 * - Redirects are not followed: avatar URLs are direct presigned storage URLs
 *   or Google photo URLs, so a redirect is not expected. Any 3xx response or
 *   transport redirect rejection (`redirect: 'manual'`) resolves to `null` and
 *   falls back to initials (fail closed).
 * - Credentials omitted, no Referer, cache bypassed on the wire, short timeout.
 * - Body stream capped at 2 MiB (`2 << 20`, matching the server's `MaxBytes`),
 *   plus a 256 KiB display cap (`AVATAR_DISPLAY_MAX_BYTES`) so oversized rows
 *   fall back to initials rather than duplicating multi-megabyte `data:` URLs
 *   across IPC and React props.
 * - Magic-byte sniffing accepts only PNG, JPEG, GIF, and WebP (raster MIME
 *   containment under `<img>`; not a polyglot sanitizer); SVG, HTML, and all
 *   other prefixes are refused regardless of `Content-Type`.
 * - Cached in memory by `origin + pathname` (ignoring rotating presigned query
 *   signatures) with a TTL under 12 hours, brief 5-minute negative caching per
 *   key on failure so a dead host is not refetched on every list load (while a
 *   changed URL path still fetches), and in-flight requests are deduped per
 *   cache key.
 * - `clear()` increments a cache generation and aborts in-flight requests so
 *   outgoing account/deployment completions never seed or delete the next
 *   session's entries.
 * - List delivery never waits for network fetches: `materializeRows` reads only
 *   cached `data:` URLs synchronously, while `warmRows` populates missing keys
 *   in the background and reports whether any new `data:` URL entered the cache.
 */

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
export const AVATAR_DISPLAY_MAX_BYTES = 256 * 1024
export const AVATAR_TIMEOUT_MS = 5_000
/** 6 hours (< 12 h server presign window) */
export const AVATAR_CACHE_TTL_MS = 6 * 60 * 60_000
/** 5 minutes negative cache per key on failure */
export const AVATAR_NEGATIVE_TTL_MS = 5 * 60_000
const AVATAR_CACHE_MAX_ENTRIES = 500

export interface AvatarCacheOptions {
  fetch?: FetchLike
  now?: () => number
  timeoutMs?: number
  ttlMs?: number
  negativeTtlMs?: number
  maxBytes?: number
  displayMaxBytes?: number
}

export interface AvatarCache {
  resolveUrl(rawUrl: string): Promise<string | null>
  resolveRows(rows: readonly UniworkDocSummary[]): Promise<UniworkDocSummary[]>
  materializeRows(rows: readonly UniworkDocSummary[]): UniworkDocSummary[]
  warmRows(rows: readonly UniworkDocSummary[]): Promise<boolean>
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
 * Sniffs PNG, JPEG, GIF, or WebP magic bytes from the start of the payload
 * (raster MIME containment under `<img>`; not a polyglot sanitizer).
 * Returns the canonical MIME type, or `null` for SVG, HTML, or any other bytes.
 */
export function sniffAvatarMime(
  bytes: Uint8Array,
): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | null {
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
  const negativeTtlMs = options.negativeTtlMs ?? AVATAR_NEGATIVE_TTL_MS
  const maxBytes = options.maxBytes ?? AVATAR_MAX_BYTES
  const displayMaxBytes = options.displayMaxBytes ?? AVATAR_DISPLAY_MAX_BYTES
  const effectiveByteCap = Math.min(maxBytes, displayMaxBytes)

  const entries = new Map<string, { dataUrl: string; expiresAt: number }>()
  const failures = new Map<string, number>()
  const inFlight = new Map<
    string,
    { generation: number; controller: AbortController; promise: Promise<string | null> }
  >()
  let generation = 0

  async function fetchDataUrl(
    initialUrl: URL,
    controller: AbortController,
  ): Promise<string | null> {
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      if (controller.signal.aborted) return null
      let response: Response
      try {
        response = await fetchImpl(initialUrl.toString(), {
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
      // Redirects are not expected for direct presigned storage or Google avatar URLs:
      // fail closed on any 3xx or transparently redirected response.
      if ((response.status >= 300 && response.status < 400) || response.redirected) {
        void response.body?.cancel().catch(() => undefined)
        return null
      }
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => undefined)
        return null
      }
      const bytes = await readCappedBytes(response, effectiveByteCap, controller.signal)
      if (!bytes) return null
      const mime = sniffAvatarMime(bytes)
      if (!mime) return null
      return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
    } finally {
      clearTimeout(timer)
    }
  }

  function getCachedDataUrl(rawUrl: string, ts = now()): string | null {
    const key = avatarCacheKey(rawUrl)
    if (!key) return null
    const hit = entries.get(key)
    if (!hit) return null
    if (ts < hit.expiresAt) return hit.dataUrl
    entries.delete(key)
    return null
  }

  function setBounded<V>(map: Map<string, V>, key: string, value: V): void {
    if (!map.has(key) && map.size >= AVATAR_CACHE_MAX_ENTRIES) {
      const oldest = map.keys().next().value
      if (oldest !== undefined) map.delete(oldest)
    }
    map.set(key, value)
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
    const failedUntil = failures.get(key)
    if (failedUntil !== undefined) {
      if (ts < failedUntil) return Promise.resolve(null)
      failures.delete(key)
    }
    const existing = inFlight.get(key)
    if (existing && existing.generation === generation) return existing.promise

    const myGen = generation
    const controller = new AbortController()
    const promise = fetchDataUrl(parsed, controller)
      .then((dataUrl) => {
        if (generation !== myGen) return null
        if (dataUrl) {
          failures.delete(key)
          setBounded(entries, key, { dataUrl, expiresAt: now() + ttlMs })
        } else if (negativeTtlMs > 0) {
          setBounded(failures, key, now() + negativeTtlMs)
        }
        return dataUrl
      })
      .catch(() => null)
      .finally(() => {
        const current = inFlight.get(key)
        if (current && current.promise === promise && current.generation === myGen) {
          inFlight.delete(key)
        }
      })
    inFlight.set(key, { generation: myGen, controller, promise })
    return promise
  }

  function materializeRows(rows: readonly UniworkDocSummary[]): UniworkDocSummary[] {
    let anyWithAvatar = false
    for (const row of rows) {
      if (row.updatedByUser?.avatarUrl) {
        anyWithAvatar = true
        break
      }
    }
    if (!anyWithAvatar) return rows as UniworkDocSummary[]
    const ts = now()
    return rows.map((row) => {
      const user = row.updatedByUser
      if (!user?.avatarUrl) return row
      const dataUrl = getCachedDataUrl(user.avatarUrl, ts)
      return {
        ...row,
        updatedByUser: dataUrl ? { name: user.name, avatarUrl: dataUrl } : { name: user.name },
      }
    })
  }

  async function warmRows(rows: readonly UniworkDocSummary[]): Promise<boolean> {
    const ts = now()
    const missingByKey = new Map<string, string>()
    for (const row of rows) {
      const raw = row.updatedByUser?.avatarUrl
      if (!raw) continue
      const key = avatarCacheKey(raw)
      if (!key || missingByKey.has(key)) continue
      const hit = entries.get(key)
      if (hit && ts < hit.expiresAt) continue
      const failedUntil = failures.get(key)
      if (failedUntil !== undefined && ts < failedUntil) continue
      const existing = inFlight.get(key)
      if (existing && existing.generation === generation) continue
      missingByKey.set(key, raw)
    }
    if (missingByKey.size === 0) return false
    const myGen = generation
    const results = await Promise.all([...missingByKey.values()].map((raw) => resolveUrl(raw)))
    if (generation !== myGen) return false
    return results.some((dataUrl) => dataUrl !== null)
  }

  async function resolveRows(rows: readonly UniworkDocSummary[]): Promise<UniworkDocSummary[]> {
    const urls = new Set<string>()
    for (const row of rows) {
      const raw = row.updatedByUser?.avatarUrl
      if (raw) urls.add(raw)
    }
    await Promise.all([...urls].map((raw) => resolveUrl(raw)))
    return materializeRows(rows)
  }

  function clear(): void {
    generation += 1
    for (const task of inFlight.values()) {
      task.controller.abort()
    }
    inFlight.clear()
    entries.clear()
    failures.clear()
  }

  return {
    resolveUrl,
    resolveRows,
    materializeRows,
    warmRows,
    clear,
  }
}
