/** Session handlers: Master edit view: only parts the user actively changed are written back. */
import { EMU_PER_PT, listMasterParts, parseMasterPart, type Slide } from '@genoffice/pptx-engine'
import type { Op, TxnResult } from '@genoffice/pptx-ops'
import { EMU_PER_PX_96, buildRenderSlide, type RenderSlide } from '@genoffice/pptx-render'
import type {
  MasterDeleteElementOp,
  MasterEditFillOp,
  MasterEditStrokeOp,
  MasterEditTextOp,
  MasterEditTransformOp,
  MasterEnterResult,
} from '../../shared/ipc'
import { gradientFillTo, gradientPathKind, gradientStops } from '../fill'
import type { HandlerContext } from '../host-io'
import { getFontMetrics } from '../platform'
import { buildAllRenderSlides, makeMediaResolver } from '../render'
import { pushHistory, sessions, type Session } from '../state'
import { journaledTxn, sessionTxn } from '../txn'

// Exception to the fidelity rule: only parts the user actively changed in master view are
// written back, using the same byte surgery as slides. Every commit writes the entry + fully
// reparses all slides — inheritance takes effect immediately, and each undo snapshot's
// (slides model, entries) pair stays self-consistent (rendering and file don't diverge after
// undo).
const buildMasterRenderSlide = (session: Session): RenderSlide | null => {
  const me = session.masterEdit
  if (!me) return null
  return buildRenderSlide(me.slide, session.opened.deck.size, {
    fitWidthPx: session.fitWidthPx,
    media: makeMediaResolver(session.opened),
    metrics: getFontMetrics(),
  })
}

// Master edits run as part-addressed op transactions seeded with the live
// master slide: ops mutate me.slide itself (parse-time ids stay stable for
// the renderer's selection/editing state — a fresh parse would re-mint them)
// and the executor's flush serializes that same object to the entry.
const masterTxn = (session: Session, me: { partPath: string; slide: Slide }, op: Op) =>
  sessionTxn(session, { ops: [op], parts: new Map([[me.partPath, me.slide]]) })

const masterEditDone = (session: Session): RenderSlide | null => {
  session.metaDirty = true
  return buildMasterRenderSlide(session)
}

export const masterHandlers = {
  'slides:master-enter': (ctx: HandlerContext, fitWidthPx: number): MasterEnterResult | null => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    session.fitWidthPx = fitWidthPx
    const items: MasterEnterResult['items'] = []
    for (const p of listMasterParts(session.opened.archive)) {
      const slide = parseMasterPart(session.opened.archive, p.partPath)
      if (!slide) continue
      const rendered = buildRenderSlide(slide, session.opened.deck.size, {
        fitWidthPx,
        media: makeMediaResolver(session.opened),
        metrics: getFontMetrics(),
      })
      items.push({ partPath: p.partPath, kind: p.kind, name: p.name, slide: rendered })
      if (!session.masterEdit) session.masterEdit = { partPath: p.partPath, slide }
    }
    return items.length ? { items } : null
  },

  'slides:master-open': (ctx: HandlerContext, partPath: string) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const slide = parseMasterPart(session.opened.archive, partPath)
    if (!slide) return null
    session.masterEdit = { partPath, slide }
    return buildMasterRenderSlide(session)
  },

  'slides:master-close': (ctx: HandlerContext) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    session.masterEdit = null
    // Edits were materialized one by one; here we only fetch the full render tree
    return buildAllRenderSlides(session.opened, session.fitWidthPx)
  },

  'slides:master-edit-text': (ctx: HandlerContext, op: MasterEditTextOp) => {
    const session = sessions.get(ctx.clientId)
    const me = session?.masterEdit
    if (!session || !me) return null
    const r = masterTxn(session, me, {
      op: 'setText',
      target: { part: me.partPath, el: op.sourceId },
      paragraphs: op.paragraphs,
    })
    if (!r) return null
    return masterEditDone(session)
  },

  'slides:master-edit-transform': (ctx: HandlerContext, op: MasterEditTransformOp) => {
    const session = sessions.get(ctx.clientId)
    const me = session?.masterEdit
    if (!session || !me) return null
    const el = me.slide.elements.find((x) => x.id === op.sourceId)
    if (!el) return null
    const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
    const scale = op.fitWidthPx / baseWidthPx
    const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
    if (op.preview) {
      // Previews are not persisted: mutate the live master slide only (the final
      // commit at drag end goes through the op executor against the entry bytes)
      if (!session.transformPreview) {
        pushHistory(session)
        session.transformPreview = true
      }
      el.transform = {
        ...el.transform,
        offset: { x: toEmu(op.xPx), y: toEmu(op.yPx), cx: toEmu(op.wPx), cy: toEmu(op.hPx) },
        rot: Math.round(op.rotationDeg * 60000),
      }
      return buildMasterRenderSlide(session)
    }
    const payload = {
      op: 'setTransform',
      target: { part: me.partPath, el: op.sourceId },
      box: { x: toEmu(op.xPx), y: toEmu(op.yPx), cx: toEmu(op.wPx), cy: toEmu(op.hPx) },
      rotDeg: op.rotationDeg,
    }
    const seed = new Map([[me.partPath, me.slide]])
    let r: TxnResult | null
    if (session.transformPreview) {
      // The gesture's first preview frame already pushed the undo step
      session.transformPreview = false
      const applied = journaledTxn(session, 'edit', { ops: [payload], parts: seed })
      r = applied.applied ? applied : null
    } else {
      r = sessionTxn(session, { ops: [payload], parts: seed })
    }
    if (!r) return null
    return masterEditDone(session)
  },

  'slides:master-edit-fill': (ctx: HandlerContext, op: MasterEditFillOp) => {
    const session = sessions.get(ctx.clientId)
    const me = session?.masterEdit
    if (!session || !me) return null
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
    const r = masterTxn(session, me, {
      op: 'setFill',
      target: { part: me.partPath, el: op.sourceId },
      fill,
    })
    if (!r) return null
    return masterEditDone(session)
  },

  'slides:master-edit-stroke': (ctx: HandlerContext, op: MasterEditStrokeOp) => {
    const session = sessions.get(ctx.clientId)
    const me = session?.masterEdit
    if (!session || !me) return null
    const r = masterTxn(session, me, {
      op: 'setStroke',
      target: { part: me.partPath, el: op.sourceId },
      stroke: op.stroke
        ? { color: op.stroke.color, widthEmu: Math.round(op.stroke.widthPt * EMU_PER_PT) }
        : null,
    })
    if (!r) return null
    return masterEditDone(session)
  },

  'slides:master-delete-element': (ctx: HandlerContext, op: MasterDeleteElementOp) => {
    const session = sessions.get(ctx.clientId)
    const me = session?.masterEdit
    if (!session || !me) return null
    const r = masterTxn(session, me, {
      op: 'deleteElement',
      target: { part: me.partPath, el: op.sourceId },
    })
    if (!r) return null
    return masterEditDone(session)
  },
}
