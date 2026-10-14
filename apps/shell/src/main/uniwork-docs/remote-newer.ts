import type { UniworkRemoteBar } from '../../shared/home-api'
import { compareRevision, REVISION } from '../uniwork-sync/feed/revision'
import { isTerminalQueueState, type QueueState } from '../uniwork-sync/queue/record'

/**
 * G5-03a: the pure "a newer version exists on the server" decision. The feed
 * hands a notice (document id, revision, version, version id), the service
 * hands everything it knows about the local copy, and the decision says what
 * the S6 surface may do: ignore it, wait for an intent to settle, do the
 * guarded clean reload, or show one bar.
 *
 * The rule order is fixed (first match wins) and lives here so the service
 * never grows a second opinion:
 *   malformed · other-doc · feed-off · locked · not-newer · own-echo ·
 *   hold · reconciling(reconciling-stuck) · other-live-intent or dirty ·
 *   aiRunning · reload
 * Revisions compare ONLY through compareRevision (BigInt): '10' is newer
 * than '9'.
 */

/** one committed change of a document, as the feed reports it */
export interface RemoteNotice {
  documentId: string
  /** int64 as a decimal string */
  revision: string
  version: number
  versionId: string | null
}

/** everything the service knows about the bound local copy of that document */
export interface RemoteLocal {
  documentId: string
  /** the revision the local base sits on (binding baseRevision) */
  baseRevision: string
  /** the org capability `sync_feed`: off = the feed is not authoritative here */
  feedOn: boolean
  /** the binding is dirty, or a view of the path holds unsaved edits */
  dirty: boolean
  /** any view of the path (tab, detached, present-of-owner) runs an AI turn */
  aiRunning: boolean
  /** the document's intent record state; null = none / terminal */
  queue: QueueState | null
  /** record.receipt.revision when the intent already carries a receipt */
  receiptRevision?: string
  /** revisions this app produced (settled receipts + selfRenamed) */
  ownEcho: ReadonlySet<string>
  /** the copy is locked from the feed side (a reload/metadata 403/404/410) */
  locked: 'revoked' | 'deleted' | null
}

export type RemoteDecision =
  | {
      kind: 'ignore'
      reason: 'malformed' | 'other-doc' | 'feed-off' | 'locked' | 'not-newer' | 'own-echo'
    }
  /** an intent is validating/uploading/committing: wait for its receipt */
  | { kind: 'hold' }
  | { kind: 'reload' }
  | { kind: 'bar'; bar: UniworkRemoteBar }

/** the intent states whose outcome is still unknown: the notice waits for it */
const HOLDING_STATES: ReadonlySet<QueueState> = new Set<QueueState>([
  'validating',
  'uploading',
  'committing',
])

export function decideRemote(n: RemoteNotice, l: RemoteLocal): RemoteDecision {
  if (!REVISION.test(n.revision)) return { kind: 'ignore', reason: 'malformed' }
  if (n.documentId !== l.documentId) return { kind: 'ignore', reason: 'other-doc' }
  if (!l.feedOn) return { kind: 'ignore', reason: 'feed-off' }
  if (l.locked) return { kind: 'ignore', reason: 'locked' }
  if (compareRevision(n.revision, l.baseRevision) <= 0)
    return { kind: 'ignore', reason: 'not-newer' }
  if (l.ownEcho.has(n.revision) || l.receiptRevision === n.revision) {
    return { kind: 'ignore', reason: 'own-echo' }
  }
  const queue = l.queue
  if (queue && HOLDING_STATES.has(queue)) return { kind: 'hold' }
  if (queue === 'reconciling') {
    return { kind: 'bar', bar: { kind: 'newer-dirty', version: n.version, wait: 'commit' } }
  }
  if (queue === 'reconciling-stuck') {
    return { kind: 'bar', bar: { kind: 'newer-dirty', version: n.version, wait: 'stuck' } }
  }
  // any other intent still on its way to the server keeps the copy "not saved
  // here yet": the bar says why the reload waits
  if (queue && !isTerminalQueueState(queue)) {
    return { kind: 'bar', bar: { kind: 'newer-dirty', version: n.version } }
  }
  if (l.dirty) return { kind: 'bar', bar: { kind: 'newer-dirty', version: n.version } }
  if (l.aiRunning) return { kind: 'bar', bar: { kind: 'newer-ai', version: n.version } }
  return { kind: 'reload' }
}
