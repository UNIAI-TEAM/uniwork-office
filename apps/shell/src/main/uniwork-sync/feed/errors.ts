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
 * coded 410 from the feed is never read as a deleted document.
 */
export type FeedFailure =
  | { kind: 'cursor_expired' }
  | { kind: 'cursor_invalid' }
  | { kind: 'session_expired' }
  | { kind: 'other'; error: UniworkDocError }

export function parseFeedError(status: number, body: unknown): FeedFailure {
  const code = readEnvelope(body)?.code
  if (code === CHANGE_CURSOR_EXPIRED) return { kind: 'cursor_expired' }
  if (code === CHANGE_CURSOR_INVALID) return { kind: 'cursor_invalid' }
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
