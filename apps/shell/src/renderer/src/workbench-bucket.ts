/**
 * The workbench bucket the Home renderer shows: a UniWork account, or
 * signed-out use (opaque id from main, see apps/shell/src/main/workbench-accounts.ts).
 * '' = no main-process store (tests, web): unscoped names.
 * `null` = cleared (the account changed, nothing loaded yet): no bucket at all,
 * which is not the same as "no main-process store".
 */
let current: string | null = ''

/** '' while cleared too: a call naming it is refused by main, a name built from it never matches a bucket */
export function currentWorkbenchBucket(): string {
  return current ?? ''
}

export function setCurrentWorkbenchBucket(bucket: string): void {
  current = bucket
}

/** after an account change, until the next load names the bucket */
export function clearCurrentWorkbenchBucket(): void {
  current = null
}

export function isWorkbenchBucketCleared(): boolean {
  return current === null
}

/** IndexedDB media database of a bucket (default: the current one; base name = the pre-upgrade shared one) */
export function wbMediaDbName(base: string, bucket: string = currentWorkbenchBucket()): string {
  return bucket ? `${base}@${bucket}` : base
}
