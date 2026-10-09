/**
 * The transaction funnels every edit goes through: one undo step per transaction and
 * an entry in the session's op journal for every applied batch.
 */
import { runTxn, type TxnRequest, type TxnResult } from '@genoffice/pptx-ops'
import {
  journalOps,
  pushHistory,
  scheduleDeckBroadcast,
  type OpLogEntry,
  type Session,
} from './state'

/**
 * The single funnel for non-dry transactions: every applied batch lands in the
 * session's op journal (collab groundwork) and is broadcast to other attached clients.
 */
export function journaledTxn(
  session: Session,
  source: Exclude<OpLogEntry['source'], 'reset'>,
  req: TxnRequest,
): TxnResult {
  const r = runTxn(session.opened, req)
  if (r.applied) {
    journalOps(session, source, r.records ?? [])
    scheduleDeckBroadcast(session)
  }
  return r
}

/**
 * Shared shim core: one undo step wrapping a transaction; on failure the step is
 * erased (the executor already restored the model, so history stays consistent).
 * Handlers keep only surface translation and result shaping around this.
 * Plan first: pushHistory clears the redo stack (and can evict the oldest undo
 * entry at the cap), so an invalid request must not touch history at all —
 * legacy handlers validated existence before their history push.
 */
export function sessionTxn(
  session: Session,
  req: TxnRequest,
  source: Exclude<OpLogEntry['source'], 'reset'> = 'edit',
): TxnResult | null {
  const plan = runTxn(session.opened, { ...req, dryRun: true })
  const invalid = plan.failures?.length ?? 0
  if ((req.isolation ?? 'atomic') === 'atomic' ? invalid > 0 : invalid >= req.ops.length)
    return null
  pushHistory(session)
  const r = journaledTxn(session, source, req)
  if (!r.applied) {
    session.undoStack.pop()
    return null
  }
  return r
}
