/** Session handlers: Slide-level operations: new deck, add/delete/move slides, layouts, size, transitions, animations. */
import {
  BUILTIN_LAYOUT_PREFIX,
  builtinLayoutInfos,
  createBlankPptx,
  elementSpid,
  ensureBuiltinLayout,
  getSections,
  normalizeSections,
  getSlideAnimations,
  getSlideTransition,
  listSlideLayouts,
  openPptx,
  shouldOfferBuiltinLayouts,
} from '@genoffice/pptx-engine'
import { runTxn } from '@genoffice/pptx-ops'
import { tm } from '../../main/i18n-main'
import type {
  AddBlankSlideOp,
  AddSlideOp,
  AddSlideWithLayoutOp,
  DeleteSlidesOp,
  DuplicateSlidesOp,
  AnimationItem,
  MoveSlideOp,
  MoveSlidesOp,
  RemoveSectionSlidesOp,
  OpenResult,
  SetAdvanceTimesOp,
  SetAnimationsOp,
  SetSlideHiddenOp,
  SetSlidesHiddenOp,
  SetSlideLayoutOp,
  SetSlideSizeOp,
  SetTransitionOp,
  ShapeKey,
} from '../../shared/ipc'
import type { HandlerContext } from '../host-io'
import { buildAllRenderSlides, deckDefaultFont, rebuildSlide } from '../render'
import { planSlideDuplicates, planSlideMoves } from '../../shared/slide-selection'
import { createSession, markMetaDirty, pushHistory, sessions, type Session } from '../state'
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
    markMetaDirty(session)
    return {
      slides: buildAllRenderSlides(session.opened, op.fitWidthPx),
      index: op.sourceIndex + 1,
    }
  },

  'slides:add-blank-slide': (ctx: HandlerContext, op: AddBlankSlideOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, {
      ops: [
        { op: 'addBlankSlide', target: { slide: op.sourceIndex } },
        // ops are validated against the pre-transaction deck, so move the existing
        // source slide down past the new one rather than targeting the new index
        ...(op.before
          ? [{ op: 'moveSlide', target: { slide: op.sourceIndex }, to: op.sourceIndex + 1 }]
          : []),
      ],
    })
    if (!r) return null
    session.fitWidthPx = op.fitWidthPx
    // Always: the blank slide is parsed fresh, so neither structureDirty nor an
    // element dirty flag is set and the insert would otherwise be unsaveable.
    markMetaDirty(session)
    return {
      slides: buildAllRenderSlides(session.opened, op.fitWidthPx),
      index: op.before ? op.sourceIndex : op.sourceIndex + 1,
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
    markMetaDirty(session)
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
    markMetaDirty(session)
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
    if (!r) return null
    markMetaDirty(session)
    return buildAllRenderSlides(session.opened, session.fitWidthPx)
  },

  // Drag to reorder slides (sldIdLst + deck.slides + section membership); must send back the full RenderSlide set
  'slides:move-slide': (ctx: HandlerContext, op: MoveSlideOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, {
      ops: [{ op: 'moveSlide', target: { slide: op.fromIndex }, to: op.toIndex }],
    })
    if (!r) return null
    markMetaDirty(session)
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
        // a modelled directional effect carries its own direction; a top wipe must not
        // come back to the player as a bare 'wipe' and play bottom-up
        ...(a.direction != null ? { direction: a.direction } : {}),
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
  // Highest index first: every op is validated against the pre-transaction deck
  // and applied in sequence, so the remaining indexes stay valid.
  'slides:delete-slides': (ctx: HandlerContext, op: DeleteSlidesOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const indexes = [...new Set(op.slideIndexes)].sort((a, b) => b - a)
    if (!indexes.length || indexes.length >= session.opened.deck.slides.length) return null
    const r = sessionTxn(session, {
      ops: indexes.map((i) => ({ op: 'deleteSlide' as const, target: { slide: i } })),
    })
    if (!r) return null
    markMetaDirty(session)
    return buildAllRenderSlides(session.opened, session.fitWidthPx)
  },

  'slides:duplicate-slides': (ctx: HandlerContext, op: DuplicateSlidesOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const steps = planSlideDuplicates(op.slideIndexes)
    if (!steps.length) return null
    const r = sessionTxn(session, {
      ops: steps.map((st) =>
        'duplicate' in st
          ? { op: 'duplicateSlide' as const, target: { slide: st.duplicate } }
          : { op: 'moveSlide' as const, target: { slide: st.from }, to: st.to },
      ),
    })
    if (!r) return null
    session.fitWidthPx = op.fitWidthPx
    // Not just for multi-slide plans: a single duplicate is parsed fresh too and
    // would otherwise leave the deck changed but reported clean.
    markMetaDirty(session)
    return {
      slides: buildAllRenderSlides(session.opened, op.fitWidthPx),
      index: Math.max(...op.slideIndexes) + 1,
    }
  },

  'slides:set-slides-hidden': (ctx: HandlerContext, op: SetSlidesHiddenOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session || !op.slideIndexes.length) return null
    const r = sessionTxn(session, {
      ops: op.slideIndexes.map((i) => ({
        op: 'setHidden' as const,
        target: { slide: i },
        hidden: op.hidden,
      })),
    })
    return r ? buildAllRenderSlides(session.opened, session.fitWidthPx) : null
  },

  'slides:move-slides': (ctx: HandlerContext, op: MoveSlidesOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const steps = planSlideMoves(session.opened.deck.slides.length, op.slideIndexes, op.insertAt)
    if (!steps.length) return null
    const r = sessionTxn(session, {
      ops: steps.map((st) => ({ op: 'moveSlide' as const, target: { slide: st.from }, to: st.to })),
    })
    if (!r) return null
    markMetaDirty(session)
    return {
      slides: buildAllRenderSlides(session.opened, session.fitWidthPx),
      sections: getSections(session.opened),
    }
  },

  // Section header + its slides in one undo step. Slides go highest index first so the
  // numeric targets stay valid as the deck shrinks; the deck keeps at least one slide.
  'slides:remove-section-slides': (ctx: HandlerContext, op: RemoveSectionSlidesOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const total = session.opened.deck.slides.length
    const { lead, sections } = normalizeSections(getSections(session.opened), total)
    const indices = op.id == null ? lead : sections.find((s) => s.id === op.id)?.slideIndices
    if (!indices || indices.length >= total) return null
    const ops: Parameters<typeof runTxn>[1]['ops'] = [...indices]
      .reverse()
      .map((i) => ({ op: 'deleteSlide', target: { slide: i } }))
    if (op.id != null) ops.push({ op: 'removeSection', id: op.id })
    if (!ops.length) return null
    const r = sessionTxn(session, { ops })
    if (!r) return null
    markMetaDirty(session)
    return {
      slides: buildAllRenderSlides(session.opened, session.fitWidthPx),
      sections: getSections(session.opened),
    }
  },
}
