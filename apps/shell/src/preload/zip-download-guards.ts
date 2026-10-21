import type {
  FileDownloadResult,
  ZipDownloadErrorCode,
  ZipDownloadPhase,
  ZipDownloadProgress,
  ZipDownloadSkip,
  ZipDownloadStartResult,
  ZipSkipReason,
} from '../shared/zip-download-api'

/**
 * UNI-2068: what main answers or pushes for the zip download is narrowed here
 * before the renderer sees it, like every other uniwork-doc bridge: a reply of
 * the wrong shape becomes a refusal / null and a field the contract does not
 * name never crosses.
 */

const ERROR_CODES: ReadonlySet<string> = new Set<ZipDownloadErrorCode>([
  'zip_too_large',
  'zip_expired',
  'zip_busy',
  'zip_failed',
  'zip_timeout',
  'zip_unavailable',
  'forbidden_target',
  'write_failed',
  'canceled',
  'too_large',
  'server_error',
  'network',
  'signed_out',
])

const PHASES: ReadonlySet<string> = new Set<ZipDownloadPhase>([
  'saving',
  'building',
  'downloading',
  'done',
  'canceled',
  'failed',
])

const SKIP_REASONS: ReadonlySet<string> = new Set<ZipSkipReason>([
  'not_found',
  'not_a_file',
  'too_large',
  'zip_limit',
  'other_workspace',
])

function obj(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

const knownCode = (value: unknown): value is ZipDownloadErrorCode =>
  typeof value === 'string' && ERROR_CODES.has(value)

const REFUSED: ZipDownloadStartResult = { ok: false, code: 'server_error' }

export function asZipStartResult(raw: unknown): ZipDownloadStartResult {
  const r = obj(raw)
  if (r?.ok === true && text(r.runId)) return { ok: true, runId: r.runId }
  if (r?.ok === false) {
    if (r.code === 'dialog_canceled') return { ok: false, code: 'dialog_canceled' }
    if (knownCode(r.code)) return { ok: false, code: r.code }
  }
  return REFUSED
}

export function asFileDownloadResult(raw: unknown): FileDownloadResult {
  const r = obj(raw)
  if (r?.ok === true && text(r.path)) return { ok: true, path: r.path }
  if (r?.ok === false && r.path === null) {
    if (r.code === 'dialog_canceled') return { ok: false, path: null, code: 'dialog_canceled' }
    if (knownCode(r.code)) return { ok: false, path: null, code: r.code }
  }
  return { ok: false, path: null, code: 'server_error' }
}

function skipOf(raw: unknown): ZipDownloadSkip | null {
  const r = obj(raw)
  if (!r || !text(r.documentId) || typeof r.reason !== 'string' || !SKIP_REASONS.has(r.reason)) {
    return null
  }
  return { documentId: r.documentId, reason: r.reason as ZipSkipReason }
}

/** a progress push, or null when it is not one (the renderer then hears nothing) */
export function asZipDownloadProgress(raw: unknown): ZipDownloadProgress | null {
  const r = obj(raw)
  if (
    !r ||
    !text(r.runId) ||
    typeof r.phase !== 'string' ||
    !PHASES.has(r.phase) ||
    !count(r.bytes) ||
    !(r.totalBytes === null || count(r.totalBytes)) ||
    !(r.fileCount === null || count(r.fileCount)) ||
    !Array.isArray(r.skipped) ||
    !(r.path === null || text(r.path))
  ) {
    return null
  }
  let error: ZipDownloadProgress['error'] = null
  if (r.error !== null && r.error !== undefined) {
    const e = obj(r.error)
    if (!e || !knownCode(e.code)) return null
    error = {
      code: e.code,
      ...(count(e.retryAfterSeconds) ? { retryAfterSeconds: e.retryAfterSeconds } : {}),
    }
  }
  return {
    runId: r.runId,
    phase: r.phase as ZipDownloadPhase,
    bytes: r.bytes,
    totalBytes: r.totalBytes as number | null,
    fileCount: r.fileCount as number | null,
    skipped: r.skipped.map(skipOf).filter((skip): skip is ZipDownloadSkip => skip !== null),
    path: r.path as string | null,
    error,
  }
}
