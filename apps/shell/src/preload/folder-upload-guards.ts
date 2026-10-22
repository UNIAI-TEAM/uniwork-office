import type {
  BatchUploadFailure,
  BatchUploadMode,
  BatchUploadPhase,
  BatchUploadProgress,
  BatchUploadRefusal,
  BatchUploadRefusalCode,
  BatchUploadSkip,
  BatchUploadSkipReason,
  BatchUploadStartError,
  BatchUploadStartResult,
  PreflightSDO,
} from '../shared/folder-upload-api'

/**
 * UNI-2052: what main sends for a folder / multi-file upload is narrowed here
 * before the renderer sees it, like every other uniwork-doc bridge: a reply of
 * the wrong shape becomes null / [] / invalid_input and a field the contract
 * does not name never crosses (so an absolute path cannot leak through a stray
 * property).
 */

const MODES: ReadonlySet<string> = new Set<BatchUploadMode>(['folder', 'files'])

const REFUSAL_CODES: ReadonlySet<string> = new Set<BatchUploadRefusalCode>([
  'too_many_files',
  'too_many_folders',
  'too_large_total',
  'too_deep',
  'nothing_to_upload',
  'segment_too_long',
  'multiple_roots',
  'folder_upload_unavailable',
  'target_unavailable',
])

const SKIP_REASONS: ReadonlySet<string> = new Set<BatchUploadSkipReason>([
  'hidden',
  'unsupported_format',
  'too_large',
  'name_too_long',
  'invalid_path',
  'link',
  'unreadable',
  'not_a_file',
])

const PHASES: ReadonlySet<string> = new Set<BatchUploadPhase>([
  'planning',
  'waiting',
  'uploading',
  'finishing',
  'done',
  'canceled',
  'failed',
])

const START_ERRORS: ReadonlySet<string> = new Set<BatchUploadStartError>([
  'invalid_input',
  'unknown_preflight',
  'refused',
])

function obj(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0

const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

function skipOf(raw: unknown): BatchUploadSkip | null {
  const r = obj(raw)
  if (!r || !text(r.path) || typeof r.reason !== 'string' || !SKIP_REASONS.has(r.reason)) {
    return null
  }
  return { path: r.path, reason: r.reason as BatchUploadSkipReason }
}

function refusalOf(raw: unknown): BatchUploadRefusal | null | undefined {
  if (raw === null) return null
  const r = obj(raw)
  if (!r || typeof r.code !== 'string' || !REFUSAL_CODES.has(r.code)) return undefined
  return {
    code: r.code as BatchUploadRefusalCode,
    ...(count(r.limit) ? { limit: r.limit } : {}),
    ...(count(r.actual) ? { actual: r.actual } : {}),
  }
}

/** a pre-flight, or null when main sent something else */
export function asPreflightSDO(raw: unknown): PreflightSDO | null {
  const r = obj(raw)
  if (!r || !text(r.preflightId) || typeof r.mode !== 'string' || !MODES.has(r.mode)) return null
  const target = obj(r.target)
  const totals = obj(r.totals)
  if (
    !target ||
    !text(target.workspaceId) ||
    (target.folderId !== null && !text(target.folderId)) ||
    typeof target.label !== 'string' ||
    !totals ||
    !count(totals.files) ||
    !count(totals.bytes) ||
    !Array.isArray(r.skipped) ||
    typeof r.shareAvailable !== 'boolean'
  ) {
    return null
  }
  const refusal = refusalOf(r.refusal)
  if (refusal === undefined) return null
  return {
    preflightId: r.preflightId,
    mode: r.mode as BatchUploadMode,
    ...(text(r.rootName) ? { rootName: r.rootName } : {}),
    ...(text(r.rootNamePreview) ? { rootNamePreview: r.rootNamePreview } : {}),
    target: {
      workspaceId: target.workspaceId,
      folderId: target.folderId as string | null,
      label: target.label,
      ...(target.myFolder === true ? { myFolder: true as const } : {}),
      ...(target.inMyFolder === true ? { inMyFolder: true as const } : {}),
    },
    totals: { files: totals.files, bytes: totals.bytes },
    skipped: r.skipped.map(skipOf).filter((skip): skip is BatchUploadSkip => skip !== null),
    refusal,
    shareAvailable: r.shareAvailable,
    // absent or odd = the switch stays free
    parentShared: r.parentShared === true,
  }
}

/** the pre-flights of a drop: the well-formed ones, in order */
export function asPreflightList(raw: unknown): PreflightSDO[] {
  if (!Array.isArray(raw)) return []
  return raw.map(asPreflightSDO).filter((sdo): sdo is PreflightSDO => sdo !== null)
}

export function asBatchUploadStartResult(raw: unknown): BatchUploadStartResult {
  const r = obj(raw)
  if (r?.ok === true && text(r.runId)) return { ok: true, runId: r.runId }
  if (r?.ok === false && typeof r.error === 'string' && START_ERRORS.has(r.error)) {
    return { ok: false, error: r.error as BatchUploadStartError }
  }
  return { ok: false, error: 'invalid_input' }
}

function failureOf(raw: unknown): BatchUploadFailure | null {
  const r = obj(raw)
  if (!r || !text(r.path) || !text(r.code) || typeof r.retryable !== 'boolean') return null
  return { path: r.path, code: r.code, retryable: r.retryable }
}

/** a progress push, or null when it is not one (the renderer then hears nothing) */
export function asBatchUploadProgress(raw: unknown): BatchUploadProgress | null {
  const r = obj(raw)
  if (
    !r ||
    !text(r.runId) ||
    typeof r.phase !== 'string' ||
    !PHASES.has(r.phase) ||
    !count(r.done) ||
    !count(r.failed) ||
    !count(r.total) ||
    !count(r.sentBytes) ||
    !count(r.totalBytes)
  ) {
    return null
  }
  const failures = Array.isArray(r.failures)
    ? r.failures.map(failureOf).filter((f): f is BatchUploadFailure => f !== null)
    : []
  const error = obj(r.error)
  return {
    runId: r.runId,
    phase: r.phase as BatchUploadPhase,
    done: r.done,
    failed: r.failed,
    total: r.total,
    sentBytes: r.sentBytes,
    totalBytes: r.totalBytes,
    ...(text(r.rootTitle) ? { rootTitle: r.rootTitle } : {}),
    ...(text(r.rootFolderId) ? { rootFolderId: r.rootFolderId } : {}),
    ...(failures.length > 0 ? { failures } : {}),
    ...(error && text(error.code)
      ? {
          error: {
            code: error.code,
            ...(count(error.retryAfterSeconds)
              ? { retryAfterSeconds: error.retryAfterSeconds }
              : {}),
          },
        }
      : {}),
  }
}
