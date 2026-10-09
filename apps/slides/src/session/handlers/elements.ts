/** Session handlers: Shape and element geometry, fill/stroke/effects, z-order, grouping and duplication. */
import { EMU_PER_PT, copyElementData, findGroupChild } from '@genoffice/pptx-engine'
import { resolveGroupChildId, runTxn } from '@genoffice/pptx-ops'
import { EMU_PER_PX_96 } from '@genoffice/pptx-render'
import type {
  AddElementOp,
  BatchEditTransformOp,
  DeleteElementOp,
  DeleteElementsOp,
  DuplicateElementsOp,
  EditConnectorEndpointsOp,
  EditFillOp,
  EditStrokeOp,
  EditTransformOp,
  EditTransformMultiOp,
  FlipElementOp,
  GroupElementsOp,
  ReorderElementOp,
  SetEffectsPatch,
  SetShapeGeometryOp,
  UngroupElementOp,
} from '../../shared/ipc'
import type { Paragraph } from '@genoffice/pptx-engine'
import { gradientFillTo, gradientPathKind, gradientStops } from '../fill'
import type { HandlerContext } from '../host-io'
import { rebuildSlide } from '../render'
import { pushHistory, sessions, type Session } from '../state'
import { journaledTxn, sessionTxn } from '../txn'

// px→EMU (inverting the viewport scale) for one setTransform. In-group editing: the
// pixel box is in group-local coords (with ext/chExt scaling baked in); divide out
// the group scale first, then convert back to the child EMU coordinate system.
const transformPayload = (
  session: Session,
  slideIndex: number,
  fitWidthPx: number,
  item: Omit<EditTransformOp, 'slideIndex' | 'fitWidthPx' | 'preview'>,
) => {
  const slide = session.opened.deck.slides[slideIndex]
  if (!slide) return null
  const childId = item.groupId
    ? resolveGroupChildId(slide, item.groupId, item.sourceId)
    : item.sourceId
  const grpChild = item.groupId ? findGroupChild(slide, item.groupId, childId) : null
  if (item.groupId && !grpChild) return null
  const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
  const scale = fitWidthPx / baseWidthPx
  const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
  let box: { x: number; y: number; cx: number; cy: number }
  if (grpChild) {
    const ch = grpChild.grp.childOffset
    const chX = ch?.x ?? grpChild.grp.transform.offset.x
    const chY = ch?.y ?? grpChild.grp.transform.offset.y
    const gExt = grpChild.grp.transform.offset
    const gsx = ch?.cx ? gExt.cx / ch.cx : 1
    const gsy = ch?.cy ? gExt.cy / ch.cy : 1
    box = {
      x: toEmu(item.xPx / gsx) + chX,
      y: toEmu(item.yPx / gsy) + chY,
      cx: toEmu(item.wPx / gsx),
      cy: toEmu(item.hPx / gsy),
    }
  } else {
    box = { x: toEmu(item.xPx), y: toEmu(item.yPx), cx: toEmu(item.wPx), cy: toEmu(item.hPx) }
  }
  return {
    op: 'setTransform' as const,
    target: { slide: slideIndex, el: item.sourceId },
    box,
    rotDeg: item.rotationDeg,
    // Tables redistribute gridCol widths / tr heights so the file matches the frame
    ...(item.groupId ? { group: item.groupId } : { resizeTableGrid: true }),
  }
}

export const elementHandlers = {
  'slides:add-element': (ctx: HandlerContext, op: AddElementOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
    const scale = op.fitWidthPx / baseWidthPx
    const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
    const paragraphs: Paragraph[] | undefined = op.paragraphs?.length
      ? (op.paragraphs as Paragraph[])
      : op.text
        ? op.text.split('\n').map((line) => ({ runs: [{ text: line }] }))
        : undefined
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'addElement',
          target: { slide: op.slideIndex },
          kind: op.kind,
          offset: { x: toEmu(op.xPx), y: toEmu(op.yPx), cx: toEmu(op.wPx), cy: toEmu(op.hPx) },
          ...(paragraphs ? { paragraphs } : {}),
          ...(op.fillColor ? { fill: op.fillColor } : {}),
          ...(op.stroke
            ? {
                stroke: {
                  color: op.stroke.color,
                  widthEmu: Math.round(op.stroke.widthPt * EMU_PER_PT),
                },
              }
            : {}),
          ...(op.bodyPr ? { bodyPr: op.bodyPr } : {}),
        },
      ],
    })
    if (!r) return null
    const rebuilt = rebuildSlide(session, op.slideIndex)
    return rebuilt ? { slide: rebuilt, sourceId: r.records![0]!.created![0]! } : null
  },

  // Shim over the canonical setTransform op. Preview-gesture undo bookkeeping is a
  // surface concern and stays here.
  'slides:edit-transform': (ctx: HandlerContext, op: EditTransformOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const payload = transformPayload(session, op.slideIndex, op.fitWidthPx, op)
    if (!payload) return null
    // Validate BEFORE the preview bookkeeping: a failed first preview must not set
    // transformPreview (later frames would skip pushHistory and the eventual commit
    // would lose its undo step) and must not clear the redo stack.
    if (runTxn(session.opened, { dryRun: true, ops: [payload] }).failures?.length) return null
    // Undo semantics for preview gestures: one whole drag = one undo step.
    // The first preview pushes a pre-gesture snapshot; later previews and the final commit do not.
    let pushed = false
    if (op.preview) {
      if (!session.transformPreview) {
        pushHistory(session)
        pushed = true
        session.transformPreview = true
      }
    } else if (session.transformPreview) {
      session.transformPreview = false
    } else {
      pushHistory(session)
      pushed = true
    }
    // Journal only the settled commit: preview frames would flood the ring with
    // intermediate boxes (undo coalesces the gesture the same way via transformPreview).
    const r = op.preview
      ? runTxn(session.opened, { ops: [payload] })
      : journaledTxn(session, 'edit', { ops: [payload] })
    if (!r.applied) {
      // Apply-time failure (e.g. a group-child slice that validation cannot see):
      // unwind everything this call did, including the preview flag it set — a stuck
      // flag would make later frames skip pushHistory and cost the commit its undo step.
      if (pushed) {
        session.undoStack.pop()
        if (op.preview) session.transformPreview = false
      }
      return null
    }
    return rebuildSlide(session, op.slideIndex)
  },

  // Connector endpoint drag: box+flip re-derived from the two endpoints;
  // attach/detach writes a:stCxn/a:endCxn so the connector follows later shape moves
  'slides:edit-connector-endpoints': (ctx: HandlerContext, op: EditConnectorEndpointsOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
    const scale = op.fitWidthPx / baseWidthPx
    const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'setConnectorEndpoints',
          target: { slide: op.slideIndex, el: op.sourceId },
          p1: { x: toEmu(op.x1Px), y: toEmu(op.y1Px) },
          p2: { x: toEmu(op.x2Px), y: toEmu(op.y2Px) },
          start: op.start,
          end: op.end,
        },
      ],
    })
    return r ? rebuildSlide(session, op.slideIndex) : null
  },

  // Shim: the whole selection is one atomic transaction of setTransform ops — the
  // executor's plan step reproduces the legacy "every element must exist" gate.
  'slides:batch-edit-transform': (ctx: HandlerContext, op: BatchEditTransformOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
    const scale = op.fitWidthPx / baseWidthPx
    const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
    const r = sessionTxn(session, {
      ops: op.items.map((item) => ({
        op: 'setTransform',
        target: { slide: op.slideIndex, el: item.sourceId },
        box: { x: toEmu(item.xPx), y: toEmu(item.yPx), cx: toEmu(item.wPx), cy: toEmu(item.hPx) },
        rotDeg: item.rotationDeg,
        // Legacy parity: the batch path never redistributed table grids
      })),
    })
    return r ? rebuildSlide(session, op.slideIndex) : null
  },

  // Shim over the canonical op (see @genoffice/pptx-ops): the op owns validation/mutation/journal;
  // the shim keeps session lookup, undo bookkeeping, and RenderSlide rebuilding.
  'slides:delete-element': (ctx: HandlerContext, op: DeleteElementOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    pushHistory(session)
    const r = journaledTxn(session, 'edit', {
      ops: [{ op: 'deleteElement', target: { slide: op.slideIndex, el: op.sourceId } }],
    })
    if (!r.applied) {
      session.undoStack.pop()
      return null
    }
    return rebuildSlide(session, op.slideIndex)
  },

  // Shim over the canonical setFill op: gradient normalization is surface translation
  // and stays here; validation/mutation/journal live in the op.
  'slides:edit-fill': (ctx: HandlerContext, op: EditFillOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const fill =
      typeof op.fill === 'string'
        ? op.fill
        : {
            stops: gradientStops(op.fill.gradient),
            ...((pk) =>
              pk
                ? {
                    path: pk,
                    ...((ft) => (ft ? { fillTo: ft } : {}))(gradientFillTo(op.fill.gradient)),
                  }
                : { angle: Math.round((op.fill.gradient.angleDeg ?? 0) * 60000) })(
              gradientPathKind(op.fill.gradient),
            ),
          }
    pushHistory(session)
    const r = journaledTxn(session, 'edit', {
      ops: [
        {
          op: 'setFill',
          target: { slide: op.slideIndex, el: op.sourceId },
          fill,
          ...(op.groupId ? { group: op.groupId } : {}),
        },
      ],
    })
    if (!r.applied) {
      session.undoStack.pop()
      return null
    }
    return rebuildSlide(session, op.slideIndex)
  },

  // Shim over the canonical setStroke op: pt→EMU/angle conversion is surface translation
  // and stays here; validation/mutation/journal live in the op.
  'slides:edit-stroke': (ctx: HandlerContext, op: EditStrokeOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const patch = op.stroke
      ? {
          color: op.stroke.color,
          widthEmu: Math.round(op.stroke.widthPt * EMU_PER_PT),
          ...(op.stroke.dash ? { dash: op.stroke.dash } : {}),
          ...(op.stroke.cap ? { cap: op.stroke.cap } : {}),
          ...(op.stroke.join ? { join: op.stroke.join } : {}),
          ...(op.stroke.compound ? { compound: op.stroke.compound } : {}),
          ...(op.stroke.gradient
            ? {
                gradient: {
                  stops: op.stroke.gradient.stops,
                  angle: Math.round(op.stroke.gradient.angleDeg * 60000),
                },
              }
            : {}),
        }
      : null
    pushHistory(session)
    const r = journaledTxn(session, 'edit', {
      ops: [
        {
          op: 'setStroke',
          target: { slide: op.slideIndex, el: op.sourceId },
          stroke: patch,
          ...(op.groupId ? { group: op.groupId } : {}),
        },
      ],
    })
    if (!r.applied) {
      session.undoStack.pop()
      return null
    }
    return rebuildSlide(session, op.slideIndex)
  },

  // Mirror elements across their own axis: flipH/flipV is the only way to
  // point an arrow the other way — rotation cannot express a single-axis mirror
  'slides:flip-elements': (ctx: HandlerContext, op: FlipElementOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'flipElements',
          target: { slide: op.slideIndex },
          els: op.sourceIds,
          axis: op.axis,
          ...(op.groupId ? { group: op.groupId } : {}),
        },
      ],
    })
    return r ? rebuildSlide(session, op.slideIndex) : null
  },

  'slides:change-shape': (
    ctx: HandlerContext,
    op: { slideIndex: number; sourceId: string; prst: string; groupId?: string },
  ) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'setShapeGeometry',
          target: { slide: op.slideIndex, el: op.sourceId },
          prst: op.prst,
          ...(op.groupId ? { group: op.groupId } : {}),
        },
      ],
    })
    return r ? rebuildSlide(session, op.slideIndex) : null
  },

  'slides:set-shape-adjust': (
    ctx: HandlerContext,
    op: {
      slideIndex: number
      sourceId: string
      adjust: Record<string, number>
      groupId?: string
      preview?: boolean
    },
  ) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const payload = {
      op: 'setShapeAdjust',
      target: { slide: op.slideIndex, el: op.sourceId },
      adjust: op.adjust,
      ...(op.groupId ? { group: op.groupId } : {}),
    }
    // Validate before the preview bookkeeping (same contract as edit-transform):
    // a failed first preview must not set transformPreview or clear the redo stack.
    if (runTxn(session.opened, { dryRun: true, ops: [payload] }).failures?.length) return null
    // Gesture undo semantics: one whole drag = one undo step. The first preview
    // pushes a pre-gesture snapshot; later previews and the final commit do not.
    let pushed = false
    if (op.preview) {
      if (!session.transformPreview) {
        pushHistory(session)
        session.transformPreview = true
        pushed = true
      }
    } else if (session.transformPreview) {
      session.transformPreview = false
    } else {
      pushHistory(session)
      pushed = true
    }
    const r = journaledTxn(session, 'edit', { ops: [payload] })
    if (!r.applied) {
      if (pushed) {
        session.undoStack.pop()
        if (op.preview) session.transformPreview = false
      }
      return null
    }
    return rebuildSlide(session, op.slideIndex)
  },

  'slides:set-effects': (
    ctx: HandlerContext,
    op: { slideIndex: number; sourceId: string; effects: SetEffectsPatch },
  ) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'setEffects',
          target: { slide: op.slideIndex, el: op.sourceId },
          effects: op.effects,
        },
      ],
    })
    return r ? rebuildSlide(session, op.slideIndex) : null
  },

  'slides:reorder-element': (ctx: HandlerContext, op: ReorderElementOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, {
      ops: [
        { op: 'reorderElement', target: { slide: op.slideIndex, el: op.sourceId }, dir: op.dir },
      ],
    })
    return r ? rebuildSlide(session, op.slideIndex) : null
  },

  'slides:group-elements': (ctx: HandlerContext, op: GroupElementsOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, {
      ops: [{ op: 'groupElements', target: { slide: op.slideIndex }, els: op.sourceIds }],
    })
    if (!r) return null
    const renderSlide = rebuildSlide(session, op.slideIndex)
    return renderSlide ? { slide: renderSlide, groupId: r.records![0]!.created![0]! } : null
  },

  'slides:ungroup-element': (ctx: HandlerContext, op: UngroupElementOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, {
      ops: [{ op: 'ungroupElement', target: { slide: op.slideIndex, el: op.sourceId } }],
    })
    return r ? rebuildSlide(session, op.slideIndex) : null
  },

  // Duplicate in place (⌘D / Option+drag copy): does not touch the app clipboard; the caller supplies the offset
  'slides:duplicate-elements': (ctx: HandlerContext, op: DuplicateElementsOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const slide = session.opened.deck.slides[op.slideIndex]
    if (!slide) return null
    const items = op.sourceIds
      .map((id) => slide.elements.find((el) => el.id === id))
      .filter((el): el is NonNullable<typeof el> => !!el)
      .map((el) => copyElementData(session.opened, slide, el))
    if (!items.length) return null
    const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
    const scale = op.fitWidthPx / baseWidthPx
    const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'pasteElements',
          target: { slide: op.slideIndex },
          items,
          dx: toEmu(op.dxPx),
          dy: toEmu(op.dyPx),
        },
      ],
    })
    if (!r) return null
    session.fitWidthPx = op.fitWidthPx
    const rebuilt = rebuildSlide(session, op.slideIndex)
    return rebuilt ? { slide: rebuilt, sourceIds: r.records![0]!.created! } : null
  },
  // A multi-selection nudge/rotate: every item commits exactly like edit-transform,
  // the whole batch is one undo step (PowerPoint undoes the action, not each shape).
  'slides:edit-transform-multi': (ctx: HandlerContext, op: EditTransformMultiOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const ops: NonNullable<ReturnType<typeof transformPayload>>[] = []
    for (const item of op.items) {
      const payload = transformPayload(session, op.slideIndex, op.fitWidthPx, item)
      if (!payload) return null
      ops.push(payload)
    }
    if (!ops.length) return null
    const r = sessionTxn(session, { ops })
    return r ? rebuildSlide(session, op.slideIndex) : null
  },

  // Whole-selection delete as one undo step. per_op mirrors the old per-element
  // loop: an id that already vanished is skipped instead of aborting the rest.
  'slides:delete-elements': (ctx: HandlerContext, op: DeleteElementsOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session || !op.sourceIds.length) return null
    const r = sessionTxn(session, {
      isolation: 'per_op',
      ops: op.sourceIds.map((id) => ({
        op: 'deleteElement' as const,
        target: { slide: op.slideIndex, el: id },
      })),
    })
    return r ? rebuildSlide(session, op.slideIndex) : null
  },

  // Edit Points: same gesture-undo contract as set-shape-adjust (one drag = one undo step)
  'slides:set-shape-geometry': (ctx: HandlerContext, op: SetShapeGeometryOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const scale = op.fitWidthPx / (session.opened.deck.size.cx / EMU_PER_PX_96)
    const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
    const payload = {
      op: 'setShapeCustomGeometry',
      target: { slide: op.slideIndex, el: op.sourceId },
      path: {
        w: toEmu(op.pathPx.w),
        h: toEmu(op.pathPx.h),
        cmds: op.pathPx.cmds.map((c) => ({ op: c.op, pts: c.pts.map(toEmu) })),
      },
      ...(op.groupId ? { group: op.groupId } : {}),
    }
    if (runTxn(session.opened, { dryRun: true, ops: [payload] }).failures?.length) return null
    let pushed = false
    if (op.preview) {
      if (!session.transformPreview) {
        pushHistory(session)
        session.transformPreview = true
        pushed = true
      }
    } else if (session.transformPreview) {
      session.transformPreview = false
    } else {
      pushHistory(session)
      pushed = true
    }
    const r = journaledTxn(session, 'edit', { ops: [payload] })
    if (!r.applied) {
      if (pushed) {
        session.undoStack.pop()
        if (op.preview) session.transformPreview = false
      }
      return null
    }
    return rebuildSlide(session, op.slideIndex)
  },
}
