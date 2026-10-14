/**
 * G8-15 (UNI-1410): the toast for a note-tool click that cannot start a server thread.
 *
 * `needsSave` (the open version is unknown) is already said by the comments panel footer, and the
 * click opens that panel in the same step, so a toast would say it twice (the second one covers
 * the page edge at narrow widths): no toast then. Any other refusal keeps the generic line.
 */
export type StartNoticeKey = 'serverCommentStartUnavailable'

export function startFailureNotice(needsSave: boolean): StartNoticeKey | null {
  return needsSave ? null : 'serverCommentStartUnavailable'
}
