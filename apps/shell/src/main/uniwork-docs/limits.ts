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
  /**
   * BIGUP-A1: `chunked_upload_threshold_bytes` of `documents.limits` - the
   * size above which the app opens an upload session instead of one request.
   * Optional on purpose: the server emits it only where the storage can
   * presign parts (a `local` backend never does), and an absent field means
   * "no chunked path" - the single-request flow with its own cap stays.
   */
  readonly chunked_upload_threshold_bytes?: number
  /**
   * UNI-2052: `documents.limits.folder_upload`. Null = the server has no
   * folder uploads (an older one), so the entry points stay hidden; absent only
   * on hand-built literals that predate the field (read as null).
   */
  readonly folderUpload?: FolderUploadLimitsBlock | null
  /** UNI-2052: `documents.limits.upload_extensions` (lower case, no dot); absent = the app's own list */
  readonly upload_extensions?: readonly string[]
}

/** `documents.limits.folder_upload` as the server spells it (e6-server contract section 8) */
export interface FolderUploadLimitsBlock {
  readonly max_files: number
  /** folders one upload creates, the root included */
  readonly max_folders: number
  readonly max_total_bytes: number
  readonly max_depth: number
  /** concurrent storage PUTs */
  readonly parallel: number
  /** files per complete call */
  readonly complete_batch: number
}

/** what a drifted or missing field of the block falls back to (the web client's defaults) */
export const FOLDER_UPLOAD_DEFAULTS: FolderUploadLimitsBlock = Object.freeze({
  max_files: 500,
  max_folders: 500,
  max_total_bytes: 2 * 1024 * 1024 * 1024,
  max_depth: 20,
  parallel: 6,
  complete_batch: 50,
})

export const DEFAULT_DOCUMENT_LIMITS: DocumentLimits = Object.freeze({
  max_bytes: DEFAULT_MAX_DOCUMENT_BYTES,
  warn_ratio: DEFAULT_WARN_RATIO,
  warn_bytes: DEFAULT_WARN_BYTES,
  folderUpload: null,
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
 * (the web-open warning band) belongs to another card and is ignored here.
 * `chunked_upload_threshold_bytes` (BIGUP-A1) is kept only when it is a safe
 * positive integer; anything else - absent, fractional, zero, negative, a
 * string - leaves the chunked path off, never a guessed threshold.
 * `folder_upload` (UNI-2052) is `folderUpload: null` when the block is absent
 * or not an object, else each field on its own falls back to the web default;
 * `upload_extensions` keeps its clean entries and is absent when none remain.
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

  const rawChunked = obj.chunked_upload_threshold_bytes
  const chunked_upload_threshold_bytes =
    typeof rawChunked === 'number' && Number.isSafeInteger(rawChunked) && rawChunked >= 1
      ? rawChunked
      : undefined

  const upload_extensions = parseUploadExtensions(obj.upload_extensions)

  return {
    max_bytes,
    warn_ratio,
    warn_bytes,
    ...(chunked_upload_threshold_bytes !== undefined ? { chunked_upload_threshold_bytes } : {}),
    // `folderUpload` is the spelling of a value this function already parsed: the cache
    // reads the docs client's answer, which went through here once (FU-V1)
    folderUpload: parseFolderUploadBlock(obj.folder_upload ?? obj.folderUpload),
    ...(upload_extensions ? { upload_extensions } : {}),
  }
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : fallback
}

/** a block that is not an object stays absent: only the server knows whether folder uploads exist */
function parseFolderUploadBlock(raw: unknown): FolderUploadLimitsBlock | null {
  const block = objectOf(raw)
  if (!block) return null
  return {
    max_files: positiveInt(block.max_files, FOLDER_UPLOAD_DEFAULTS.max_files),
    max_folders: positiveInt(block.max_folders, FOLDER_UPLOAD_DEFAULTS.max_folders),
    max_total_bytes: positiveInt(block.max_total_bytes, FOLDER_UPLOAD_DEFAULTS.max_total_bytes),
    max_depth: positiveInt(block.max_depth, FOLDER_UPLOAD_DEFAULTS.max_depth),
    parallel: positiveInt(block.parallel, FOLDER_UPLOAD_DEFAULTS.parallel),
    complete_batch: positiveInt(block.complete_batch, FOLDER_UPLOAD_DEFAULTS.complete_batch),
  }
}

/** entries that are not non-empty strings are dropped; an empty allow-list would refuse every file */
function parseUploadExtensions(raw: unknown): readonly string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const clean = raw.flatMap((entry): string[] => {
    if (typeof entry !== 'string') return []
    const ext = entry.trim().replace(/^\./, '').toLowerCase()
    return ext ? [ext] : []
  })
  return clean.length > 0 ? clean : undefined
}

/**
 * The planner limits and runner knobs of one upload from `documents.limits`
 * (parallel clamped to 1-6, the complete lot to 1-50). Null = the server has no
 * folder uploads: the entry points hide, there is no client fallback.
 */
export interface FolderUploadRunLimits {
  maxFiles: number
  /** folders the upload creates, root included */
  maxFolders: number
  maxTotalBytes: number
  maxDepth: number
  perFileMaxBytes: number
  parallel: number
  completeBatch: number
  /** files above this need a probe in the plan; absent when storage is local */
  chunkedThresholdBytes?: number
  /** the server allow-list (lower case, no dot); absent = the app's own list */
  uploadExtensions?: readonly string[]
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.floor(value)))

export function folderUploadRunLimits(limits: DocumentLimits): FolderUploadRunLimits | null {
  const block = limits.folderUpload
  if (!block) return null
  return {
    maxFiles: block.max_files,
    maxFolders: block.max_folders,
    maxTotalBytes: block.max_total_bytes,
    maxDepth: block.max_depth,
    perFileMaxBytes: limits.max_bytes,
    parallel: clamp(block.parallel, 1, 6),
    completeBatch: clamp(block.complete_batch, 1, 50),
    ...(limits.upload_extensions ? { uploadExtensions: limits.upload_extensions } : {}),
    ...(limits.chunked_upload_threshold_bytes !== undefined
      ? { chunkedThresholdBytes: limits.chunked_upload_threshold_bytes }
      : {}),
  }
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
      const key = keyOf()
      return inFlight.get(key) ?? byOrigin.get(key) ?? refresh()
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
