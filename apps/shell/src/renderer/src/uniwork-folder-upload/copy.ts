import { formatSizeMB } from '../../../shared/size-format'
import { formatBytes } from '../doclist/format'
import type { StringKey, TFunc } from '../locale'
import type {
  FolderUploadFailure,
  FolderUploadMode,
  FolderUploadSkipReason,
  PreflightSDO,
} from './bridge'

/** The words of the folder / multi-file upload UI: pure, so the keys can be tested without rendering */

const MIB = 1024 * 1024
const GIB = 1024 * MIB

/** one noun phrase whose English differs at 1 ("1 file" / "2 files"): the `One` key is read at exactly 1 */
export function pluralKey<K extends string>(key: K, count: number): `${K}One` | K {
  return count === 1 ? (`${key}One` as `${K}One`) : key
}

export function formatCount(count: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(count)
}

/**
 * A tree of a few KB must not read "0 MB": under a megabyte the size is in B / KB; from a GB it is
 * GB with one decimal. `up` rounds the number up (a refusal's "actual" must never read as equal to
 * its limit: "2 GB — tối đa 2 GB").
 */
export function formatRunSize(
  bytes: number,
  locale: string,
  rounding: 'up' | 'nearest' = 'nearest',
): string {
  if (bytes >= GIB) {
    const tenths =
      rounding === 'up' ? Math.ceil((bytes / GIB) * 10 - 1e-9) : Math.round((bytes / GIB) * 10)
    const whole = tenths % 10 === 0
    const digits = whole ? 0 : 1
    return `${new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(tenths / 10)} GB`
  }
  if (bytes >= MIB) return formatSizeMB(bytes, locale, rounding === 'up' ? 'over' : 'exact')
  return bytes > 0 ? formatBytes(bytes, locale) : '0 B'
}

const SKIP_REASON_KEYS: Record<FolderUploadSkipReason, StringKey> = {
  hidden: 'fuSkipHidden',
  unsupported_format: 'fuSkipUnsupported',
  too_large: 'fuSkipTooLarge',
  name_too_long: 'fuSkipNameTooLong',
  invalid_path: 'fuSkipInvalidPath',
  link: 'fuSkipLink',
  unreadable: 'fuSkipUnreadable',
  not_a_file: 'fuSkipNotAFile',
}

/** The planner's reason order, so the groups always list the same way */
const SKIP_ORDER = Object.keys(SKIP_REASON_KEYS) as FolderUploadSkipReason[]

export function skipReasonLabel(t: TFunc, reason: string): string {
  const key = (SKIP_REASON_KEYS as Record<string, StringKey | undefined>)[reason]
  return t(key ?? 'fuSkipInvalidPath')
}

/** Skipped files grouped by reason; a reason this build has no sentence for joins "invalid path" */
export function groupSkipped(
  skipped: PreflightSDO['skipped'],
): { reason: FolderUploadSkipReason; paths: string[] }[] {
  const known = new Set<string>(SKIP_ORDER)
  const bucket = (reason: FolderUploadSkipReason) =>
    skipped
      .filter((s) => s.reason === reason || (reason === 'invalid_path' && !known.has(s.reason)))
      .map((s) => s.path)
  const groups: { reason: FolderUploadSkipReason; paths: string[] }[] = []
  for (const reason of SKIP_ORDER) {
    const paths = bucket(reason)
    if (paths.length > 0) groups.push({ reason, paths })
  }
  return groups
}

/** The numbers-bearing sentence of a whole-run refusal, e.g. "612 tệp — tối đa 500" */
export function refusalMessage(
  t: TFunc,
  refusal: NonNullable<PreflightSDO['refusal']>,
  mode: FolderUploadMode,
  locale: string,
): string {
  const files = mode === 'files'
  const numbers = {
    actual: formatCount(refusal.actual ?? 0, locale),
    limit: formatCount(refusal.limit ?? 0, locale),
  }
  switch (refusal.code) {
    case 'too_many_files':
      return t('fuRefTooManyFiles', numbers)
    case 'too_many_folders':
      return t('fuRefTooManyFolders', numbers)
    case 'too_deep':
      return t(files ? 'fuRefTooDeepFiles' : 'fuRefTooDeep', numbers)
    case 'too_large_total':
      return t('fuRefTooLargeTotal', {
        actual: formatRunSize(refusal.actual ?? 0, locale, 'up'),
        limit: formatRunSize(refusal.limit ?? 0, locale),
      })
    case 'nothing_to_upload':
      return t(files ? 'fuRefNothingFiles' : 'fuRefNothing')
    case 'segment_too_long':
      return t('fuRefSegment')
    case 'multiple_roots':
      return t('fuRefMultiple')
    default:
      return t(files ? 'fuRefUnknownFiles' : 'fuRefUnknown')
  }
}

const FAILURE_REASON_KEYS: Record<string, StringKey> = {
  upload_missing: 'fuRepUploadMissing',
  size_mismatch: 'fuRepSizeMismatch',
  unsupported_media: 'fuRepUnsupportedMedia',
  storage_quota_exceeded: 'fuRepStorageQuota',
  not_found: 'fuRepNotFound',
  parts_invalid: 'fuRepPartsInvalid',
  missing_etag: 'fuRepMissingEtag',
  network: 'fuRepNetwork',
  target_expired: 'fuRepTargetExpired',
  http_5xx: 'fuRepHttp5xx',
  missing_part_url: 'fuRepMissingPartUrl',
  untrusted_target: 'fuRepUntrustedTarget',
  aborted: 'fuRepAborted',
  folder_upload_file_settled: 'fuRepSettled',
  folder_upload_target_signed: 'fuRepTargetSigned',
  upload_session_busy: 'fuRepSessionBusy',
  unreadable: 'fuRepUnreadable',
  session: 'fuRepSession',
}

/** One sentence per failure code; any `http_5nn` is the server-down sentence, a code this build does not know is the plain one */
export function failureReasonMessage(t: TFunc, code: string): string {
  const known = /^http_5\d\d$/.test(code) ? 'http_5xx' : code
  return t(FAILURE_REASON_KEYS[known] ?? 'fuRepUnknown')
}

/** True when the report has something to retry: a failure the runner marked retryable */
export function hasRetryable(failures: readonly FolderUploadFailure[]): boolean {
  return failures.some((failure) => failure.retryable)
}
