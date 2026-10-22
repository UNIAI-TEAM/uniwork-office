const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * "5 minutes ago" / "yesterday" in the viewer's language; a week or more back, the day itself.
 * An unreadable time is an empty string, a time slightly in the future reads as now.
 */
export function relativeNoticeTime(iso: string, now: number, locale: string): string {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const age = Math.max(0, now - at)
  if (age >= 7 * DAY) {
    const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear()
    return new Intl.DateTimeFormat(
      locale,
      sameYear ? { day: 'numeric', month: 'short' } : { dateStyle: 'medium' },
    ).format(at)
  }
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (age < MINUTE) return rtf.format(0, 'second')
  if (age < HOUR) return rtf.format(-Math.floor(age / MINUTE), 'minute')
  if (age < DAY) return rtf.format(-Math.floor(age / HOUR), 'hour')
  return rtf.format(-Math.floor(age / DAY), 'day')
}
