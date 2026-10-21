import type { ZipDownloadSkip, ZipSkipReason } from '../../../shared/zip-download-api'
import { uniworkId } from '../client'
import { UniworkDocError } from '../errors'

/**
 * UNI-2068: the wire of the server's document download jobs (UNI-2045 SV-9):
 * the ids the create route takes, the job it answers and the one download
 * route its `download_url` may name. Answers are read leniently - a status or
 * a skip reason the server adds later takes a default, a skipped entry that
 * does not parse is dropped - so a server that grows a field never breaks a
 * download; only an answer with no usable job id is `malformed_response`.
 */

/** the server's cap of ids per job (the renderer cuts the rest and lists it as `zip_limit`) */
export const ZIP_MAX_IDS = 100
export const ZIP_MIN_IDS = 2
/** the web polls every 2 s, at most 90 times (~3 minutes) */
export const ZIP_POLL_INTERVAL_MS = 2_000
export const ZIP_MAX_POLLS = 90
/** the server caps a job at 1 GiB of source bytes; zip overhead on top of it, with room to spare */
export const ZIP_MAX_BYTES = Math.floor(1.25 * 1024 * 1024 * 1024)

const ULID = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/
const JOB_ID = /^[A-Za-z0-9_-]{1,128}$/

/** a document id the create route accepts (26-char ULID) */
export const isZipDocumentId = (value: unknown): value is string =>
  typeof value === 'string' && ULID.test(value)

export type ZipJobStatus = 'queued' | 'running' | 'ready' | 'failed' | 'expired'
export type ZipJobError = 'nothing_to_download' | 'build_failed' | 'other'

export interface ZipJob {
  id: string
  status: ZipJobStatus
  downloadUrl: string | null
  fileCount: number | null
  skipped: ZipDownloadSkip[]
  error: ZipJobError | null
}

type Json = Record<string, unknown>

const objectOf = (value: unknown): Json | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null

const STATUSES: readonly ZipJobStatus[] = ['queued', 'running', 'ready', 'failed', 'expired']
const SKIP_REASONS: readonly ZipSkipReason[] = ['not_found', 'not_a_file', 'too_large']

function skippedOf(raw: unknown): ZipDownloadSkip[] {
  if (!Array.isArray(raw)) return []
  const out: ZipDownloadSkip[] = []
  for (const entry of raw) {
    const record = objectOf(entry)
    if (!record || !isZipDocumentId(record.document_id)) continue
    // `not_found` is the server's catch-all (unreadable / foreign / missing)
    const reason = SKIP_REASONS.find((r) => r === record.reason) ?? 'not_found'
    out.push({ documentId: record.document_id, reason })
  }
  return out
}

/** the job of a create / poll answer; an unknown status reads as still running */
export function parseZipJob(raw: unknown): ZipJob {
  const record = objectOf(raw)
  if (!record || typeof record.id !== 'string' || !JOB_ID.test(record.id)) {
    throw new UniworkDocError('malformed_response')
  }
  const status = STATUSES.find((s) => s === record.status) ?? 'running'
  const count = record.file_count
  const url = record.download_url
  const error = record.error
  return {
    id: record.id,
    status,
    downloadUrl: typeof url === 'string' && url.length > 0 ? url : null,
    fileCount:
      typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null,
    skipped: skippedOf(record.skipped),
    error:
      error === 'nothing_to_download' || error === 'build_failed' ? error : error ? 'other' : null,
  }
}

const jobsBase = (workspaceId: string): string =>
  `/workspaces/${uniworkId(workspaceId)}/documents/download-jobs`

export const zipCreateRoute = (workspaceId: string): string => jobsBase(workspaceId)

export const zipJobRoute = (workspaceId: string, jobId: string): string => {
  if (!JOB_ID.test(jobId)) throw new UniworkDocError('not_found')
  return `${jobsBase(workspaceId)}/${encodeURIComponent(jobId)}`
}

/**
 * The route a job's `download_url` names, relative to `/api/v1` - or null when
 * it names anything else. The URL is the server's, but the bearer travels with
 * it, so only this workspace's download route of this very job is followed:
 * never another host, never another path.
 */
export function zipDownloadRoute(
  downloadUrl: string,
  workspaceId: string,
  jobId: string,
): string | null {
  const expected = `${zipJobRoute(workspaceId, jobId)}/download`
  return downloadUrl === `/api/v1${expected}` ? expected : null
}
