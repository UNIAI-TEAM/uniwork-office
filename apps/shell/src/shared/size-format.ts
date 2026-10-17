/**
 * SIZE-F1 (UNI-1861): Human-readable document size formatting (contract §6.1)
 * and fallback limit constants.
 */

export const MB_BYTES = 1024 * 1024
export const DEFAULT_MAX_DOCUMENT_BYTES = 200 * MB_BYTES // 209_715_200
export const DEFAULT_WARN_RATIO = 0.9
export const DEFAULT_WARN_BYTES = Math.floor(DEFAULT_MAX_DOCUMENT_BYTES * DEFAULT_WARN_RATIO) // 188_743_680

export type SizeFormatMode = 'exact' | 'over' | 'warn'

/**
 * Formats a byte count in MiB with display unit `"MB"` per SIZE-F1 contract §6.1:
 * - Whole numbers render with 0 decimals (`"200 MB"`).
 * - Non-whole numbers render with at most 1 decimal via `Intl.NumberFormat(locale, { maximumFractionDigits: 1 })`
 *   (`vi` -> `"185,4 MB"`, `en` -> `"185.4 MB"`).
 * - Boundary safety:
 *   - `'over'` (when `bytes > max_bytes`): rounds up to 0.1 MB (`Math.ceil((bytes / MB_BYTES) * 10) / 10`)
 *     so `200 MiB + 1 B` displays `"200,1 MB"` / `"200.1 MB"`.
 *   - `'warn'` (when `warn_bytes <= bytes <= max_bytes`): floors to 0.1 MB (`Math.floor((bytes / MB_BYTES) * 10) / 10`)
 *     so `{size}` never exceeds `{max}`.
 *   - `'exact'` (default, for `{max}`): formats `bytes / MB_BYTES` with at most 1 decimal.
 */
export function formatSizeMB(bytes: number, locale = 'en', mode: SizeFormatMode = 'exact'): string {
  const safeBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  const rawMb = safeBytes / MB_BYTES
  let value: number
  if (mode === 'over') {
    value = Math.ceil(rawMb * 10) / 10
  } else if (mode === 'warn') {
    value = Math.floor(rawMb * 10) / 10
  } else {
    value = rawMb
  }
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value)
  return `${formatted} MB`
}
