import { FeedError } from '../../src/main/uniwork-sync/feed/errors'
import type { FeedChange, FeedClient, FeedPage } from '../../src/main/uniwork-sync/feed/client'

/**
 * G5-03a: a scripted change feed for tests. Rows are written in the
 * contract-p0 §3 wire shape (`document_id`, `kind`, `revision` as a decimal
 * string, `current_version`, `version_id`), so a test cannot pass a row the
 * real parser would refuse. Pages are served in call order; the last one
 * repeats, and an empty script answers one empty snapshot page.
 */

/** one `DocumentChangeSDO` row, as the wire carries it */
export interface FakeFeedRow {
  document_id: string
  kind?: string
  revision: string
  current_version?: number
  version_id?: string | null
}

export interface FakeFeedPage {
  phase?: string
  rows?: FakeFeedRow[]
  has_more?: boolean
  next_cursor?: string
  expires_at?: string
}

/** one scripted answer: a page, or the error the call rejects with */
export type FakeFeedScript = FakeFeedPage | Error

function rowOf(row: FakeFeedRow): FeedChange {
  return {
    documentId: row.document_id,
    kind: row.kind ?? 'file',
    revision: row.revision,
    currentVersion: row.current_version ?? 1,
    versionId: row.version_id ?? null,
  }
}

/** the client's own change shape, for a test that drives noteFeedChange directly */
export function fakeFeedChange(
  documentId: string,
  revision: string,
  version = 1,
  versionId: string | null = null,
): FeedChange {
  return { documentId, kind: 'file', revision, currentVersion: version, versionId }
}

/** the cursor verdicts a scripted failure can name */
export const cursorExpired = (): FeedError => new FeedError({ kind: 'cursor_expired' })
export const cursorInvalid = (): FeedError => new FeedError({ kind: 'cursor_invalid' })

export class FakeFeedClient implements FeedClient {
  /** every call, in order (cursor undefined = the first, cursorless page) */
  readonly calls: Array<{ workspaceId: string; cursor?: string; limit?: number }> = []
  private index = 0

  constructor(private readonly script: FakeFeedScript[] = []) {}

  /** scripted answers not yet served */
  get remaining(): number {
    return Math.max(0, this.script.length - this.index)
  }

  async listChanges(workspaceId: string, cursor?: string, limit?: number): Promise<FeedPage> {
    this.calls.push({
      workspaceId,
      ...(cursor === undefined ? {} : { cursor }),
      ...(limit === undefined ? {} : { limit }),
    })
    const scripted =
      this.script.length === 0
        ? undefined
        : this.script[Math.min(this.index, this.script.length - 1)]
    this.index += 1
    if (scripted instanceof Error) throw scripted
    return {
      phase: scripted?.phase ?? 'snapshot',
      changes: (scripted?.rows ?? []).map(rowOf),
      hasMore: scripted?.has_more === true,
      nextCursor: scripted?.next_cursor ?? `c${this.index}`,
      expiresAt: scripted?.expires_at ?? '',
    }
  }
}
