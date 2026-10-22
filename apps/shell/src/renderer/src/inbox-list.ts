import type { WorkNotification, WorkNotificationPage } from '../../shared/uniwork-work-api'

/**
 * A fresh first page over what the Inbox shows: the page itself, then the older rows already loaded
 * (the ones past the page's last row), so a reload does not throw away "show older". The cursor of the
 * older pages stays when rows of them are kept.
 */
export function mergeFirstPage(
  rows: readonly WorkNotification[] | null,
  next: string | null,
  fresh: WorkNotificationPage,
): { rows: WorkNotification[]; next: string | null } {
  if (!rows || fresh.next_before === null)
    return { rows: fresh.notifications, next: fresh.next_before }
  const last = Date.parse(fresh.notifications.at(-1)?.created_at ?? '')
  const ids = new Set(fresh.notifications.map((n) => n.id))
  const tail = Number.isNaN(last)
    ? []
    : rows.filter((n) => !ids.has(n.id) && Date.parse(n.created_at) < last)
  return {
    rows: [...fresh.notifications, ...tail],
    next: tail.length > 0 ? next : fresh.next_before,
  }
}

/** An older page after the rows on screen, without a row the two share. */
export function appendOlder(
  rows: readonly WorkNotification[],
  page: WorkNotificationPage,
): { rows: WorkNotification[]; next: string | null } {
  const have = new Set(rows.map((n) => n.id))
  return {
    rows: [...rows, ...page.notifications.filter((n) => !have.has(n.id))],
    next: page.next_before,
  }
}
