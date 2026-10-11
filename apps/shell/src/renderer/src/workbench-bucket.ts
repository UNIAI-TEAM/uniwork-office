/**
 * The workbench bucket the Home renderer shows: a UniWork account, or
 * signed-out use (opaque id from main, see apps/shell/src/main/workbench-accounts.ts).
 * '' = no main-process store (tests, web): unscoped names.
 */
let current = ''

export function currentWorkbenchBucket(): string {
  return current
}

export function setCurrentWorkbenchBucket(bucket: string): void {
  current = bucket
}

/** IndexedDB media database of the current bucket (base name = the pre-upgrade shared one) */
export function wbMediaDbName(base: string): string {
  return current ? `${base}@${current}` : base
}
