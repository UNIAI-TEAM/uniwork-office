/** Session handlers: Text edits, find/replace, text-body props, raw transactions and the edit-script surface. */
import { materializeSlide } from '@genoffice/pptx-engine'
import { mapScriptOps, runTxn } from '@genoffice/pptx-ops'
import type {
  ApplyEditScriptOp,
  ApplyTxnOp,
  ApplyTxnResult,
  EditTextOp,
  FindReplaceOp,
  SetElementFontOp,
  SetElementParagraphFormatOp,
} from '../../shared/ipc'
import { applySessionTxn } from '../apply-txn'
import type { HandlerContext } from '../host-io'
import { applyAutofitResize, buildAllRenderSlides, rebuildSlide, syncAutofitScale } from '../render'
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
      fontSizeStep: op.fontSizeStep,
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

  // AI batch surface: raw ops arrive as one transaction — the shared core in
  // applySessionTxn (validation, atomicity/rollback/journal, autofit render pass)
  // is the same code the shell's MCP slides bridge drives.
  'slides:apply-txn': (ctx: HandlerContext, req: ApplyTxnOp): ApplyTxnResult | null => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    return applySessionTxn(session, req)
  },
}
