import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { isStoreSegment, type StoreScope } from '../keys'

/** one scope's records live under `<root>/<deploymentId>/<accountId>` */
export function scopeDir(root: string, scope: StoreScope): string {
  return join(root, segment(scope.deploymentId), segment(scope.accountId))
}

/** one registered store's records live under its own folder of the scope */
export function storeDirFor(root: string, scope: StoreScope, store: string): string {
  return join(scopeDir(root, scope), segment(store))
}

/** records are named by the hash of their key: opaque, and path-safe for any key */
export function recordFileName(key: string): string {
  return `${createHash('sha256').update(key, 'utf8').digest('hex')}.rec`
}

export function recordPath(root: string, scope: StoreScope, store: string, key: string): string {
  return join(storeDirFor(root, scope, store), recordFileName(key))
}

function segment(value: string): string {
  if (!isStoreSegment(value)) throw new Error('invalid store path segment')
  return value
}
