import {
  DEFAULT_MAX_DOCUMENT_BYTES,
  DEFAULT_WARN_BYTES,
  DEFAULT_WARN_RATIO,
} from '../../shared/size-format'

export { DEFAULT_MAX_DOCUMENT_BYTES, DEFAULT_WARN_BYTES, DEFAULT_WARN_RATIO }

/**
 * The document size limits a client enforces (contract `contract-size-frame-v0.1`
 * r4 §1.2): `max_bytes` for upload and save, `warn_bytes` = `floor(max_bytes *
 * warn_ratio)` for the 90 % warning. `snake_case` is the wire spelling; the app
 * maps the server's `upload_max_bytes` / `save_warn_ratio` onto it (r4 §Changes 2).
 */
export interface DocumentLimits {
  readonly max_bytes: number
  readonly warn_ratio: number
  readonly warn_bytes: number
}

export const DEFAULT_DOCUMENT_LIMITS: DocumentLimits = Object.freeze({
  max_bytes: DEFAULT_MAX_DOCUMENT_BYTES,
  warn_ratio: DEFAULT_WARN_RATIO,
  warn_bytes: DEFAULT_WARN_BYTES,
})

/** a non-array object, for the three shapes below (no shared guard in this package) */
function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** the limits object of `GET /api/v1/config`, a bare `{limits}`, or the limits itself */
function limitsObjectOf(raw: unknown): Record<string, unknown> | null {
  const record = objectOf(raw)
  if (!record) return null
  const documents = objectOf(record.documents)
  const nested = documents ? objectOf(documents.limits) : null
  if (nested) return nested
  return objectOf(record.limits) ?? record
}

/**
 * Leniently parses `documents.limits` (r4 §Changes 2):
 *
 * `{ upload_max_bytes, save_warn_ratio, web_open: { docx|pptx|pdf|xlsx: { warn_bytes } },
 *    chunked_upload_threshold_bytes? }`
 *
 * Every field is optional: `upload_max_bytes -> max_bytes` and `save_warn_ratio ->
 * warn_ratio`, each falling back on its own to `209,715,200` / `0.9`. `web_open`
 * (the web-open warning band) and `chunked_upload_threshold_bytes` (the >= 20 MiB
 * upload-session flow) belong to other cards and are ignored here.
 */
export function parseDocumentLimits(raw: unknown): DocumentLimits {
  const obj = limitsObjectOf(raw)
  if (!obj) return DEFAULT_DOCUMENT_LIMITS

  const rawMax = obj.upload_max_bytes ?? obj.max_bytes
  const max_bytes =
    typeof rawMax === 'number' && Number.isSafeInteger(rawMax) && rawMax >= 1
      ? rawMax
      : DEFAULT_MAX_DOCUMENT_BYTES

  const rawRatio = obj.save_warn_ratio ?? obj.warn_ratio
  const warn_ratio =
    typeof rawRatio === 'number' && Number.isFinite(rawRatio) && rawRatio > 0 && rawRatio < 1
      ? rawRatio
      : DEFAULT_WARN_RATIO

  const rawWarnBytes = Math.floor(max_bytes * warn_ratio)
  const warn_bytes =
    Number.isSafeInteger(rawWarnBytes) && rawWarnBytes >= 0 ? rawWarnBytes : DEFAULT_WARN_BYTES

  return { max_bytes, warn_ratio, warn_bytes }
}

export interface DocumentLimitsCacheDeps {
  /** the active deployment origin; a different value is a different entry */
  origin?: () => string | null
  /** the loader (e.g. the docs client's `getDocumentLimits`); `null` = nothing to read yet */
  fetchLimits?: (origin?: string | null) => Promise<unknown> | unknown
  /** default loader when `fetchLimits` is absent: `GET <origin>/api/v1/config` */
  fetch?: (
    input: string,
    init?: RequestInit,
  ) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>
}

export interface DocumentLimitsCache {
  /** the active deployment's limits, read once if not cached yet */
  get(): Promise<DocumentLimits>
  /** the cached limits (or the defaults) without a read */
  peek(): DocumentLimits
  /** a fresh read: session boot and a deployment switch both come through here */
  refresh(): Promise<DocumentLimits>
  reset(): void
}

/**
 * One cached `documents.limits` per deployment origin. A loader that answers
 * `null` (no signed-in session, nothing to read) leaves the entry empty, so the
 * next `get()` after sign-in reads for real instead of pinning the fallback.
 * A generation counter bumped on `reset()` and on every origin switch ensures an
 * in-flight read from an older session or origin never commits after a boundary.
 */
export function createDocumentLimitsCache(deps: DocumentLimitsCacheDeps = {}): DocumentLimitsCache {
  const byOrigin = new Map<string, DocumentLimits>()
  const inFlight = new Map<string, Promise<DocumentLimits>>()
  let generation = 0
  let activeKey: string | null = null

  const normalizedOrigin = (): string | null => {
    const origin = deps.origin?.()?.trim().replace(/\/+$/, '')
    return origin ? origin : null
  }

  const keyOf = (): string => {
    const key = normalizedOrigin() ?? '__default__'
    if (activeKey !== null && activeKey !== key) {
      generation += 1
      inFlight.clear()
    }
    activeKey = key
    return key
  }

  const canCommit = (key: string, gen: number): boolean => keyOf() === key && generation === gen

  const read = async (
    key: string,
    startedOrigin: string | null,
    gen: number,
  ): Promise<DocumentLimits> => {
    const fallback = (): DocumentLimits => byOrigin.get(key) ?? DEFAULT_DOCUMENT_LIMITS
    try {
      if (deps.fetchLimits) {
        const raw = await deps.fetchLimits(startedOrigin)
        if (raw == null || !canCommit(key, gen)) return fallback()
        const parsed = parseDocumentLimits(raw)
        byOrigin.set(key, parsed)
        return parsed
      }
      const fetchImpl =
        deps.fetch ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch : null)
      if (!startedOrigin || !fetchImpl) return fallback()
      const response = await fetchImpl(`${startedOrigin}/api/v1/config`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })
      if (!response.ok || !canCommit(key, gen)) return fallback()
      const raw = await response.json()
      if (!canCommit(key, gen)) return fallback()
      const parsed = parseDocumentLimits(raw)
      byOrigin.set(key, parsed)
      return parsed
    } catch {
      return fallback()
    }
  }

  const refresh = (): Promise<DocumentLimits> => {
    const startedOrigin = normalizedOrigin()
    const key = keyOf()
    const running = inFlight.get(key)
    if (running) return running
    const gen = generation
    const promise = read(key, startedOrigin, gen).finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key)
    })
    inFlight.set(key, promise)
    return promise
  }

  return {
    async get(): Promise<DocumentLimits> {
      return byOrigin.get(keyOf()) ?? refresh()
    },
    peek(): DocumentLimits {
      return byOrigin.get(keyOf()) ?? DEFAULT_DOCUMENT_LIMITS
    },
    refresh,
    reset(): void {
      generation += 1
      byOrigin.clear()
      inFlight.clear()
    },
  }
}
