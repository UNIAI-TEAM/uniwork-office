/**
 * The AI batch transaction (slides:apply-txn), shared with the shell's MCP slides bridge through
 * slides-main's re-export.
 */
import { materializeSlide, slideDurableId } from '@genoffice/pptx-engine'
import { runTxn, type OpRecord } from '@genoffice/pptx-ops'
import type { ApplyTxnOp, ApplyTxnResult } from '../shared/ipc'
import {
  applyAutofitResize,
  buildAllRenderSlides,
  rebuildSlide,
  rebuildSlideWithReparse,
  syncAutofitScale,
} from './render'
import { markMetaDirty, pushHistory, type Session } from './state'
import { journaledTxn } from './txn'

/**
 * AI batch surface core, shared by the `slides:apply-txn` IPC handler and the
 * shell's MCP slides bridge (one implementation so both stay behaviorally
 * identical): raw ops arrive as one transaction. The registry validates (guided
 * errors), the executor owns atomicity/rollback/journal; dry-run rehearses the
 * plan without touching the deck or its history.
 */
export function applySessionTxn(session: Session, req: ApplyTxnOp): ApplyTxnResult | null {
  const ops = Array.isArray(req?.ops) ? (req.ops as Parameters<typeof runTxn>[1]['ops']) : []
  if (ops.length === 0 || ops.length > 50) {
    return {
      applied: false,
      failures: [
        { index: 0, error: 'ops must be a non-empty array (at most 50 per transaction).' },
      ],
    }
  }
  const isolation = req.isolation === 'per_op' ? ('per_op' as const) : ('atomic' as const)
  const compact = (fails?: Array<{ index: number; error: string }>) =>
    fails?.map((f) => ({ index: f.index, error: f.error }))
  if (req.dryRun) {
    const r = runTxn(session.opened, { ops, isolation, dryRun: true })
    return {
      applied: false,
      dryRun: true,
      plan: r.plan ?? [],
      ...(r.failures?.length ? { failures: compact(r.failures) } : {}),
    }
  }
  // Plan before pushing history (a no-op request must not clear the redo stack)
  const plan = runTxn(session.opened, { ops, isolation, dryRun: true })
  const invalid = plan.failures?.length ?? 0
  if (isolation === 'atomic' ? invalid > 0 : invalid >= ops.length) {
    return { applied: false, failures: compact(plan.failures) }
  }
  pushHistory(session)
  const r = journaledTxn(session, 'batch', { ops, isolation })
  if (!r.applied) {
    session.undoStack.pop()
    return { applied: false, failures: compact(r.failures) }
  }
  // Some ops change only package state (setNotes, a theme commit) and leave no
  // element dirty, so without this the session would still look clean and a
  // close could discard the edit. Element-level ops set their own flags; this
  // covers the archive-only ones.
  markMetaDirty(session)
  // Post-pass mirroring the dedicated shims (autofit/reparse are render concerns and live
  // outside the executor): text ops get autofit resize + fontScale write-back, level changes
  // materialize, and XML-patching ops reparse the page so the final render reflects them.
  // Slides are re-found by the executor-stamped durable id: a numeric target.slide drifts
  // when a later structural op (deleteSlide/moveSlide/duplicateSlide) shifts pages.
  const slideIdxOf = (rec: OpRecord): number => {
    if (rec.slideId)
      return session.opened.deck.slides.findIndex((s) => slideDurableId(s) === rec.slideId)
    return -1
  }
  const renderedByIdx = new Map<number, ReturnType<typeof rebuildSlide>>()
  for (const rec of r.records ?? []) {
    const o = rec.op
    const idx = slideIdxOf(rec)
    if (idx < 0) continue
    if (o.op === 'setTableStyle' || o.op === 'setChart') {
      rebuildSlideWithReparse(session, idx)
      renderedByIdx.delete(idx)
      continue
    }
    const id = o.target?.el
    if (!id || o.group) continue
    if (o.op !== 'setText' && o.op !== 'setFont' && o.op !== 'setParagraphFormat') continue
    if (o.op === 'setText' && (rec.after as { levelDirty?: boolean } | undefined)?.levelDirty)
      continue
    if (
      o.op === 'setParagraphFormat' &&
      (o.format as { indentDelta?: number } | undefined)?.indentDelta
    ) {
      materializeSlide(session.opened, idx)
      renderedByIdx.delete(idx)
      continue
    }
    let rendered = renderedByIdx.has(idx) ? renderedByIdx.get(idx)! : rebuildSlide(session, idx)
    rendered = applyAutofitResize(session, idx, id, rendered)
    rendered = syncAutofitScale(session, idx, id, rendered)
    renderedByIdx.set(idx, rendered)
  }
  return {
    applied: true,
    records: (r.records ?? []).map((rec) => ({
      op: rec.op.op,
      ...(rec.op.target
        ? { target: `${rec.op.target.slide}${rec.op.target.el ? `/${rec.op.target.el}` : ''}` }
        : {}),
      ...(rec.created ? { created: rec.created } : {}),
    })),
    ...(r.failures?.length ? { failures: compact(r.failures) } : {}),
    slides: buildAllRenderSlides(session.opened, session.fitWidthPx),
  }
}
