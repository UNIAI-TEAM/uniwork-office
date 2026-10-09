/** Session handlers: Text edits, find/replace, text-body props, raw transactions and the edit-script surface. */
import { materializeSlide, slideDurableId } from '@genoffice/pptx-engine'
import { mapScriptOps, runTxn, type OpRecord } from '@genoffice/pptx-ops'
import type {
  ApplyEditScriptOp,
  ApplyTxnOp,
  ApplyTxnResult,
  EditTextOp,
  FindReplaceOp,
  SetElementFontOp,
  SetElementParagraphFormatOp,
} from '../../shared/ipc'
import type { HandlerContext } from '../host-io'
import {
  applyAutofitResize,
  buildAllRenderSlides,
  rebuildSlide,
  rebuildSlideWithReparse,
  syncAutofitScale,
} from '../render'
import { pushHistory, sessions } from '../state'
import { journaledTxn, sessionTxn } from '../txn'

export const textHandlers = {
  // Read-only: RenderSlide for every page of the current session (E2E driver/debug use, no state change)
  'slides:get-render-slides': (ctx: HandlerContext) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    return session.opened.deck.slides.map((_, i) => rebuildSlide(session, i))
  },

  // Shim over the canonical setText op (rich-text rebuild, link rels, resource cleanup,
  // level rematerialization live in the op); autofit is a render concern and stays here.
  'slides:edit-text': (ctx: HandlerContext, op: EditTextOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    pushHistory(session)
    const r = journaledTxn(session, 'edit', {
      ops: [
        {
          op: 'setText',
          target: { slide: op.slideIndex, el: op.sourceId },
          paragraphs: op.paragraphs,
          ...(op.groupId ? { group: op.groupId } : {}),
        },
      ],
    })
    if (!r.applied) {
      session.undoStack.pop()
      return null
    }
    const levelDirty = (r.records?.[0]?.after as { levelDirty?: boolean } | undefined)?.levelDirty
    if (op.groupId || levelDirty) return rebuildSlide(session, op.slideIndex)
    const rendered = applyAutofitResize(
      session,
      op.slideIndex,
      op.sourceId,
      rebuildSlide(session, op.slideIndex),
    )
    return syncAutofitScale(session, op.slideIndex, op.sourceId, rendered)
  },

  // Shim over the canonical setFont op: one per_op transaction covers the whole
  // selection (non-text elements fail their own op and are skipped, matching the
  // legacy "changed if any succeeded" semantics).
  'slides:set-element-font': (ctx: HandlerContext, op: SetElementFontOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const font = {
      fontFamily: op.fontFamily,
      fontSizePt: op.fontSizePt,
      strike: op.strike,
      bold: op.bold,
      italic: op.italic,
      underline: op.underline,
      color: op.color,
    }
    pushHistory(session)
    const r = journaledTxn(session, 'edit', {
      isolation: 'per_op',
      ops: op.sourceIds.map((id) => ({
        op: 'setFont',
        target: { slide: op.slideIndex, el: id },
        font,
        ...(op.groupId ? { group: op.groupId } : {}),
      })),
    })
    if (!r.applied) {
      session.undoStack.pop() // All non-text elements (images etc.): nothing happened, pop the just-pushed history
      return null
    }
    let rendered = rebuildSlide(session, op.slideIndex)
    for (const id of op.sourceIds) {
      rendered = applyAutofitResize(session, op.slideIndex, id, rendered)
      rendered = syncAutofitScale(session, op.slideIndex, id, rendered)
    }
    return rendered
  },

  // Shim over the canonical setParagraphFormat op (same per_op selection semantics as setFont).
  'slides:set-element-paragraph-format': (ctx: HandlerContext, op: SetElementParagraphFormatOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const format = {
      bullet: op.bullet,
      bulletChar: op.bulletChar,
      bulletFont: op.bulletFont,
      numType: op.numType,
      startAt: op.startAt,
      bulletImage: op.bulletImage,
      bulletHangEmu: op.bulletHangEmu,
      bulletSizePct: op.bulletSizePct,
      bulletColor: op.bulletColor,
      lineSpacingPct: op.lineSpacingPct,
      spaceBeforePt: op.spaceBeforePt,
      spaceAfterPt: op.spaceAfterPt,
      align: op.align,
      rtl: op.rtl,
      indentDelta: op.indentDelta,
    }
    pushHistory(session)
    const r = journaledTxn(session, 'edit', {
      isolation: 'per_op',
      ops: op.sourceIds.map((id) => ({
        op: 'setParagraphFormat',
        target: { slide: op.slideIndex, el: id },
        format,
        ...(op.groupId ? { group: op.groupId } : {}),
      })),
    })
    if (!r.applied) {
      session.undoStack.pop()
      return null
    }
    if (op.indentDelta) {
      // Level changes affect inherited defaults; bake into bytes then reparse
      materializeSlide(session.opened, op.slideIndex)
      return rebuildSlide(session, op.slideIndex)
    }
    let rendered = rebuildSlide(session, op.slideIndex)
    for (const id of op.sourceIds) {
      rendered = applyAutofitResize(session, op.slideIndex, id, rendered)
      rendered = syncAutofitScale(session, op.slideIndex, id, rendered)
    }
    return rendered
  },

  'slides:find-replace': (ctx: HandlerContext, op: FindReplaceOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'findReplace',
          find: op.find,
          replace: op.replace,
          matchCase: op.matchCase,
          firstOnly: op.firstOnly,
          slideIndex: op.slideIndex,
          elementId: op.elementId,
        },
      ],
    })
    if (!r) return { count: 0, slides: null }
    const count = (r.records![0]!.after as { count: number }).count
    return { count, slides: buildAllRenderSlides(session.opened, session.fitWidthPx) }
  },

  'slides:set-text-anchor': (
    ctx: HandlerContext,
    op: { slideIndex: number; sourceId: string; anchor: 'top' | 'middle' | 'bottom' },
  ) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'setTextAnchor',
          target: { slide: op.slideIndex, el: op.sourceId },
          anchor: op.anchor,
        },
      ],
    })
    return r ? rebuildSlide(session, op.slideIndex) : null
  },

  'slides:set-text-body-props': (
    ctx: HandlerContext,
    op: {
      slideIndex: number
      sourceId: string
      props: {
        vert?: 'horz' | 'eaVert' | 'vert' | 'vert270' | 'wordArtVert'
        autofit?: 'none' | 'shrink' | 'resize'
        insets?: Partial<{ l: number; t: number; r: number; b: number }>
        wrap?: boolean
      }
    },
  ) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'setTextBodyProps',
          target: { slide: op.slideIndex, el: op.sourceId },
          props: op.props,
        },
      ],
    })
    if (!r) return null
    // Autofit must take effect immediately on toggle, not only on the next text edit:
    // 'resize' fits the shape height to the content now, 'shrink' runs the ladder and
    // writes the used fontScale back into bodyPr (a bare <a:normAutofit/> opens at
    // 100% in PowerPoint). Insets/wrap/vert changes re-fit under the same rules.
    const rendered = applyAutofitResize(
      session,
      op.slideIndex,
      op.sourceId,
      rebuildSlide(session, op.slideIndex),
    )
    return syncAutofitScale(session, op.slideIndex, op.sourceId, rendered)
  },

  // The whole edit script as ONE transaction: the collected primitives arrive in a
  // single IPC, compile to ops (script-map), and apply atomically — the executor
  // owns validation, rollback and the journal. Autofit is a render concern and
  // stays here, mirroring the per-op shims the script used to fan out to.
  'slides:apply-edit-script': (ctx: HandlerContext, op: ApplyEditScriptOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const ops = mapScriptOps(session.opened, op)
    if (ops.length === 0) return null
    const plan = runTxn(session.opened, { ops, dryRun: true })
    if (plan.failures?.length) return { error: plan.failures[0]!.error }
    pushHistory(session)
    const r = journaledTxn(session, 'script', { ops })
    if (!r.applied) {
      session.undoStack.pop()
      return { error: r.failures?.[0]?.error ?? 'the transaction could not be applied' }
    }
    let rendered = rebuildSlide(session, op.slideIndex)
    for (const rec of r.records ?? []) {
      const o = rec.op
      const id = o.target?.el
      if (!id || o.group || !rendered) continue
      if (o.op === 'setText') {
        // Level changes rematerialized inside the op; autofit would fight the reparse
        if ((rec.after as { levelDirty?: boolean } | undefined)?.levelDirty) continue
        rendered = applyAutofitResize(session, op.slideIndex, id, rendered)
        rendered = syncAutofitScale(session, op.slideIndex, id, rendered)
      } else if (o.op === 'setFont' || o.op === 'setParagraphFormat') {
        rendered = applyAutofitResize(session, op.slideIndex, id, rendered)
        rendered = syncAutofitScale(session, op.slideIndex, id, rendered)
      }
    }
    return rendered ? { slide: rendered } : null
  },

  // AI batch surface: raw ops arrive as one transaction. The registry validates
  // (guided errors), the executor owns atomicity/rollback/journal; dry-run
  // rehearses the plan without touching the deck or its history.
  'slides:apply-txn': (ctx: HandlerContext, req: ApplyTxnOp): ApplyTxnResult | null => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
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
  },
}
