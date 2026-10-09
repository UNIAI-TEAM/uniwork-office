/** Session handlers: Slide-level operations: new deck, add/delete/move slides, layouts, size, transitions, animations. */
import {
  BUILTIN_LAYOUT_PREFIX,
  builtinLayoutInfos,
  createBlankPptx,
  elementSpid,
  ensureBuiltinLayout,
  getSections,
  getSlideAnimations,
  getSlideTransition,
  listSlideLayouts,
  openPptx,
  shouldOfferBuiltinLayouts,
} from '@genoffice/pptx-engine'
import { tm } from '../../main/i18n-main'
import type {
  AddBlankSlideOp,
  AddSlideOp,
  AddSlideWithLayoutOp,
  AnimationItem,
  MoveSlideOp,
  OpenResult,
  SetAdvanceTimesOp,
  SetAnimationsOp,
  SetSlideHiddenOp,
  SetSlideLayoutOp,
  SetSlideSizeOp,
  SetTransitionOp,
  ShapeKey,
} from '../../shared/ipc'
import type { HandlerContext } from '../host-io'
import { buildAllRenderSlides, deckDefaultFont, rebuildSlide } from '../render'
import { createSession, pushHistory, sessions, type Session } from '../state'
import { journaledTxn, sessionTxn } from '../txn'

// 'builtin:<key>' virtual paths get injected into the package on first use
const resolveLayoutPath = (session: Session, layoutPath?: string): string | undefined => {
  if (!layoutPath?.startsWith(BUILTIN_LAYOUT_PREFIX)) return layoutPath
  return (
    ensureBuiltinLayout(
      session.opened.archive,
      session.opened.deck.size,
      layoutPath.slice(BUILTIN_LAYOUT_PREFIX.length),
    ) ?? undefined
  )
}

export const slideHandlers = {
  'slides:new-blank': async (ctx: HandlerContext, fitWidthPx: number): Promise<OpenResult> => {
    const opened = await openPptx(await createBlankPptx())
    createSession(ctx.clientId, { path: '', opened, fitWidthPx })
    return {
      path: '',
      slides: buildAllRenderSlides(opened, fitWidthPx),
      size: { cx: opened.deck.size.cx, cy: opened.deck.size.cy },
      defaultFont: deckDefaultFont(opened),
    }
  },

  'slides:add-slide': (ctx: HandlerContext, op: AddSlideOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'duplicateSlide',
          target: { slide: op.sourceIndex },
          ...(op.clearText ? { clearText: true } : {}),
        },
      ],
    })
    if (!r) return null
    session.fitWidthPx = op.fitWidthPx
    return {
      slides: buildAllRenderSlides(session.opened, op.fitWidthPx),
      index: op.sourceIndex + 1,
    }
  },

  'slides:add-blank-slide': (ctx: HandlerContext, op: AddBlankSlideOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, {
      ops: [{ op: 'addBlankSlide', target: { slide: op.sourceIndex } }],
    })
    if (!r) return null
    session.fitWidthPx = op.fitWidthPx
    return {
      slides: buildAllRenderSlides(session.opened, op.fitWidthPx),
      index: op.sourceIndex + 1,
    }
  },

  'slides:get-layouts': (ctx: HandlerContext) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const layouts = listSlideLayouts(session.opened.archive)
    // Decks whose own layouts carry no placeholders (AI-generated single blank layout)
    // get the built-in standard set, injected into the package on first use
    if (shouldOfferBuiltinLayouts(layouts)) {
      layouts.push(
        ...builtinLayoutInfos(session.opened.deck.size, new Set(layouts.map((l) => l.name))),
      )
    }
    return { layouts, size: { ...session.opened.deck.size } }
  },

  'slides:add-slide-with-layout': (ctx: HandlerContext, op: AddSlideWithLayoutOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    // 'builtin:' resolution may inject a layout part — do it before the undo snapshot
    // is taken so a failed insert still rolls back to a consistent package
    pushHistory(session)
    const layoutPath = resolveLayoutPath(session, op.layoutPath)
    const r = layoutPath
      ? journaledTxn(session, 'edit', {
          ops: [{ op: 'addSlideWithLayout', target: { slide: op.sourceIndex }, layoutPath }],
        })
      : null
    if (!r?.applied) {
      session.undoStack.pop()
      return null
    }
    session.fitWidthPx = op.fitWidthPx
    return {
      slides: buildAllRenderSlides(session.opened, op.fitWidthPx),
      index: op.sourceIndex + 1,
    }
  },

  'slides:set-slide-layout': (ctx: HandlerContext, op: SetSlideLayoutOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    pushHistory(session)
    const layoutPath = resolveLayoutPath(session, op.layoutPath)
    // A named layout that fails to resolve is an error; an absent layoutPath means reset
    const r =
      op.layoutPath && !layoutPath
        ? null
        : journaledTxn(session, 'edit', {
            ops: [
              {
                op: 'setSlideLayout',
                target: { slide: op.slideIndex },
                ...(layoutPath ? { layoutPath } : {}),
              },
            ],
          })
    if (!r?.applied) {
      session.undoStack.pop()
      return null
    }
    return rebuildSlide(session, op.slideIndex)
  },

  'slides:set-slide-size': (ctx: HandlerContext, op: SetSlideSizeOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, { ops: [{ op: 'setSlideSize', cx: op.cx, cy: op.cy }] })
    if (!r) return null
    session.metaDirty = true
    return buildAllRenderSlides(session.opened, session.fitWidthPx)
  },

  'slides:get-slide-size': (ctx: HandlerContext) => {
    const session = sessions.get(ctx.clientId)
    return session ? { ...session.opened.deck.size } : null
  },

  'slides:delete-slide': (ctx: HandlerContext, slideIndex: number) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, { ops: [{ op: 'deleteSlide', target: { slide: slideIndex } }] })
    return r ? buildAllRenderSlides(session.opened, session.fitWidthPx) : null
  },

  // Drag to reorder slides (sldIdLst + deck.slides + section membership); must send back the full RenderSlide set
  'slides:move-slide': (ctx: HandlerContext, op: MoveSlideOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, {
      ops: [{ op: 'moveSlide', target: { slide: op.fromIndex }, to: op.toIndex }],
    })
    if (!r) return null
    session.metaDirty = true
    return {
      slides: buildAllRenderSlides(session.opened, session.fitWidthPx),
      sections: getSections(session.opened),
    }
  },

  'slides:set-hidden': (ctx: HandlerContext, op: SetSlideHiddenOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, {
      ops: [{ op: 'setHidden', target: { slide: op.slideIndex }, hidden: op.hidden }],
    })
    return r ? rebuildSlide(session, op.slideIndex) : null
  },

  'slides:set-transition': (ctx: HandlerContext, op: SetTransitionOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return false
    const slides = session.opened.deck.slides
    const idxs =
      op.slideIndex === -1 ? slides.map((_, i) => i) : slides[op.slideIndex] ? [op.slideIndex] : []
    if (idxs.length === 0) return false
    const r = sessionTxn(session, {
      ops: idxs.map((i) => ({ op: 'setTransition', target: { slide: i }, kind: op.kind })),
    })
    return r !== null
  },

  'slides:get-transition': (ctx: HandlerContext, slideIndex: number) => {
    const session = sessions.get(ctx.clientId)
    const slide = session?.opened.deck.slides[slideIndex]
    return slide ? getSlideTransition(slide) : 'none'
  },

  // Rehearsal timing save: batch-write each page's auto-advance time (<p:transition advTm>, ms)
  'slides:set-advance-times': (ctx: HandlerContext, op: SetAdvanceTimesOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return false
    const slides = session.opened.deck.slides
    const targets = op.times.filter((t) => slides[t.slideIndex])
    if (targets.length === 0) return false
    const r = sessionTxn(session, {
      ops: targets.map((t) => ({
        op: 'setAdvanceTime',
        target: { slide: t.slideIndex },
        ms: t.ms,
      })),
    })
    return r !== null
  },

  // ── Shape animations (<p:timing>; the spid <-> temporary element id mapping happens here) ──
  'slides:get-animations': (ctx: HandlerContext, slideIndex: number): AnimationItem[] => {
    const session = sessions.get(ctx.clientId)
    const slide = session?.opened.deck.slides[slideIndex]
    if (!slide) return []
    const bySpid = new Map<number, (typeof slide.elements)[number]>()
    for (const el of slide.elements) {
      const spid = elementSpid(el)
      if (spid != null && !bySpid.has(spid)) bySpid.set(spid, el)
    }
    const typeLabel: Record<string, string> = {
      text: tm('labelTextBox'),
      shape: tm('labelShape'),
      picture: tm('labelPicture'),
      group: tm('labelGroup'),
      table: tm('labelTable'),
      chart: tm('labelChart'),
      passthrough: tm('labelObject'),
    }
    const out: AnimationItem[] = []
    for (const a of getSlideAnimations(slide)) {
      const el = bySpid.get(a.spid)
      if (!el) continue // Leftover animations whose target shape was deleted are not echoed back
      out.push({
        sourceId: el.id,
        targetName: el.name || typeLabel[el.type] || tm('labelObject'),
        effect: a.effect,
        trigger: a.trigger,
        durationMs: a.durationMs,
        delayMs: a.delayMs,
        ...(a.motionPath != null ? { motionPath: a.motionPath } : {}),
        ...(a.paragraph != null ? { paragraph: a.paragraph } : {}),
      })
    }
    return out
  },

  // Pairing keys for Morph transitions: sourceId changes on every reparse, so match across pages by cNvPr id/name
  'slides:get-shape-keys': (ctx: HandlerContext, slideIndex: number): ShapeKey[] => {
    const session = sessions.get(ctx.clientId)
    const slide = session?.opened.deck.slides[slideIndex]
    if (!slide) return []
    return slide.elements.map((el) => ({
      sourceId: el.id,
      spid: elementSpid(el),
      name: el.name ?? '',
    }))
  },

  'slides:set-animations': (ctx: HandlerContext, op: SetAnimationsOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return false
    const r = sessionTxn(session, {
      ops: [{ op: 'setAnimations', target: { slide: op.slideIndex }, items: op.items }],
    })
    return r !== null
  },
}
