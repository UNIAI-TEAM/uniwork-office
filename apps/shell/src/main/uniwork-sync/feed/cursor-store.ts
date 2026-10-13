/** one feed stream: a workspace as seen by one account on one deployment */
export interface FeedScope {
  deploymentId: string
  accountId: string
  orgId: string
  workspaceId: string
}

export function cursorKey(scope: FeedScope): string {
  return `${scope.deploymentId}/${scope.accountId}/${scope.orgId}/${scope.workspaceId}`
}

/** where the consumer keeps each stream's opaque cursor (the durable one is a registered store) */
export interface CursorStore {
  get(key: string): Promise<string | null>
  set(key: string, cursor: string): Promise<void>
  clear(key: string): Promise<void>
}

export interface MemoryCursorStore extends CursorStore {
  readonly entries: ReadonlyMap<string, string>
}

export function createMemoryCursorStore(initial?: Iterable<[string, string]>): MemoryCursorStore {
  const entries = new Map<string, string>(initial)
  return {
    entries,
    async get(key) {
      return entries.get(key) ?? null
    },
    async set(key, cursor) {
      entries.set(key, cursor)
    },
    async clear(key) {
      entries.delete(key)
    },
  }
}
