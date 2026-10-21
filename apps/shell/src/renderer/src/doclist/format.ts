// The one set of list formats shared by every Documents list in the app: the
// "Cập nhật" date, the "Dung lượng" size and the text of the screen columns.
// Pure and locale-driven; `now` is a parameter so the day boundaries are
// testable. The strings they must produce are pinned by doclist-vectors.json.
import { daysLeft } from './groups'
import { DEFAULT_LIST_LOCALE, docListText, type DocListKey, type DocListT } from './text'

/** What an empty or unusable value reads as in a list cell. */
export const EMPTY_CELL = '—'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function isVietnamese(locale: string): boolean {
  return locale.toLowerCase().startsWith('vi')
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * A date cell, local time, 24h in both languages: the clock today,
 * "Hôm qua, 16:30" yesterday, `18/10` (en `Oct 18`) in this year and
 * `18/10/2025` (en `Oct 18, 2025`) before. Empty or invalid reads as "—".
 * vi is written out by hand because ICU versions disagree on the separator of
 * a numeric vi date; en uses Intl for the month name only. `locale` is the
 * app's `dateLocale`: vi-* is Vietnamese, every other language (and a missing
 * locale) reads as en.
 * `t` supplies the translated "yesterday" word (default: built-in vi/en copy).
 */
export function formatListDate(
  at: string | number | Date | null | undefined,
  now: Date,
  locale?: string | null,
  t?: DocListT,
): string {
  if (at === null || at === undefined || at === '') return EMPTY_CELL
  const date = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(date.getTime())) return EMPTY_CELL
  const tag = locale || DEFAULT_LIST_LOCALE
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (sameDay(date, now)) return clock
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (sameDay(date, yesterday)) {
    return `${(t ?? docListText(tag))('dlDateYesterday')}, ${clock}`
  }
  const sameYear = date.getFullYear() === now.getFullYear()
  if (isVietnamese(tag)) {
    const day = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`
    return sameYear ? day : `${day}/${date.getFullYear()}`
  }
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date)
}

const UNITS = ['B', 'KB', 'MB', 'GB'] as const

/**
 * A file size: B, KB, MB, GB (1024), one decimal under 10 units and whole
 * from 10, the decimal mark of the locale (`2,9 KB` vi, `2.9 KB` en). Nothing
 * to show (no number, zero, a page or a folder) reads as "—"; UniNote never
 * has a size.
 */
export function formatBytes(bytes: number | null | undefined, locale?: string | null): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) {
    return EMPTY_CELL
  }
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1
  return `${new Intl.NumberFormat(locale || undefined, { maximumFractionDigits: digits }).format(value)} ${UNITS[unit]}`
}

/** "Còn N ngày" / "N days left" for a trashed row; null without a usable `purge_after` (the caller hides the part) */
export function formatDaysLeft(
  purgeAfter: string | null | undefined,
  now: Date,
  t: DocListT,
): string | null {
  const days = daysLeft(purgeAfter, now)
  if (days === null) return null
  return t(days === 1 ? 'dlDaysLeftOne' : 'dlDaysLeftOther', { n: days })
}

export interface ShareSummaryInput {
  /** direct users */
  people?: number | null
  workspaces?: number | null
  /** live public links */
  links?: number | null
}

const count = (n: number | null | undefined): number =>
  typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0

/** `3 người · 1 workspace · 1 link`: the parts that are zero or missing are left out; none at all reads "—" */
export function formatShareWith(
  summary: ShareSummaryInput | null | undefined,
  t: DocListT,
): string {
  const people = count(summary?.people)
  const workspaces = count(summary?.workspaces)
  const links = count(summary?.links)
  const parts = [
    people ? t(people === 1 ? 'dlSharePeopleOne' : 'dlSharePeopleOther', { n: people }) : '',
    workspaces
      ? t(workspaces === 1 ? 'dlShareWorkspaceOne' : 'dlShareWorkspaceOther', { n: workspaces })
      : '',
    links ? t(links === 1 ? 'dlShareLinkOne' : 'dlShareLinkOther', { n: links }) : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : EMPTY_CELL
}

/** the copy key of a recent row's `last_activity.kind` ("Bạn đã sửa|mở|bình luận"); null for a kind this client does not know */
export function activityKey(kind: string | null | undefined): DocListKey | null {
  switch (kind) {
    case 'edited':
      return 'dlActEdited'
    case 'opened':
      return 'dlActOpened'
    case 'commented':
      return 'dlActCommented'
    default:
      return null
  }
}
