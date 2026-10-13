import {
  CHANGE_CURSOR_EXPIRED,
  CHANGE_CURSOR_INVALID,
  UniworkDocError,
  errorFromResponse,
  readEnvelope,
} from '../../uniwork-docs/errors'

/**
 * What a failed change-feed call means to the consumer. The two cursor
 * verdicts are classified here, before the generic documents mapping, so a
 * coded 410 from the feed is never read as a deleted document. The 501 the
 * G5-01a server answers a genuine feed cursor with (errChangeFeedPending,
 * until G5-01b serves the incremental feed) is classified here too: it is a
 * verdict on the cursor, not a document error.
 */
export type FeedFailure =
  | { kind: 'cursor_expired' }
  | { kind: 'cursor_invalid' }
  /** the server cannot serve a feed cursor yet: drop it and rebuild from a snapshot */
  | { kind: 'feed_cursor_unsupported'; error: UniworkDocError }
  | { kind: 'session_expired' }
  | { kind: 'other'; error: UniworkDocError }

export function parseFeedError(status: number, body: unknown): FeedFailure {
  const code = readEnvelope(body)?.code
  if (code === CHANGE_CURSOR_EXPIRED) return { kind: 'cursor_expired' }
  if (code === CHANGE_CURSOR_INVALID) return { kind: 'cursor_invalid' }
  // G5-01a refuses a feed cursor with 501 unsupported_operation; the same code
  // on another status (a proxy page, a future command) is not this verdict.
  if (code === 'unsupported_operation' && status === 501) {
    return { kind: 'feed_cursor_unsupported', error: errorFromResponse(status, body) }
  }
  if (status === 401) return { kind: 'session_expired' }
  return { kind: 'other', error: errorFromResponse(status, body) }
}

/** a rejected feed call; never carries a URL, cursor, body or token */
export class FeedError extends Error {
  readonly failure: FeedFailure

  constructor(failure: FeedFailure) {
    super(
      `uniwork change feed failed: ${failure.kind === 'other' ? failure.error.code : failure.kind}`,
    )
    this.name = 'FeedError'
    this.failure = failure
  }
}
