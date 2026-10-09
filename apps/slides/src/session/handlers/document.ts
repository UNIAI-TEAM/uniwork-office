/** Session handlers: Links, header/footer, themes, speaker notes, comments and sections. */
import {
  getElementLink,
  getRunLinks,
  getSections,
  getSlideComments,
  getSlideLinks,
  getSlideNotes,
  readHeaderFooter,
  reparseDeck,
  type SectionInfo,
} from '@genoffice/pptx-engine'
import { runTxn } from '@genoffice/pptx-ops'
import type {
  AddCommentOp,
  AddSectionOp,
  ApplyThemeOp,
  DeleteCommentOp,
  HeaderFooterOp,
  MoveSectionOp,
  RemoveSectionOp,
  RenameSectionOp,
  SetLinkOp,
  SetNotesOp,
} from '../../shared/ipc'
import { safeExternalUrl } from '@genoffice/electron-utils/safe-external-url'
import { DECK_LINK_PROTOCOLS } from '../../shared/run-link'
import type { HandlerContext } from '../host-io'
import { buildAllRenderSlides, rebuildSlide } from '../render'
import { markMetaDirty, pushHistory, sessions } from '../state'
import { journaledTxn, sessionTxn } from '../txn'

// Section shims share one shape: single op, metaDirty, echo the op's section payload back.
const sectionShim = (ctx: HandlerContext, op: Record<string, unknown>) => {
  const session = sessions.get(ctx.clientId)
  if (!session) return null
  const r = sessionTxn(session, { ops: [op as Parameters<typeof runTxn>[1]['ops'][0]] })
  if (!r) return null
  markMetaDirty(session)
  return r.records![0]!.after
}

export const documentHandlers = {
  'slides:set-link': (ctx: HandlerContext, op: SetLinkOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    // A javascript:/file: target must never be saved into the package.
    if (
      op.target?.kind === 'url' &&
      safeExternalUrl(op.target.url, { allowedProtocols: DECK_LINK_PROTOCOLS }) === null
    ) {
      return null
    }
    const r = sessionTxn(session, {
      ops: [{ op: 'setLink', target: { slide: op.slideIndex, el: op.sourceId }, link: op.target }],
    })
    return r ? rebuildSlide(session, op.slideIndex) : null
  },

  'slides:get-link': (ctx: HandlerContext, slideIndex: number, sourceId: string) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    return getElementLink(session.opened, slideIndex, sourceId)
  },

  'slides:get-slide-links': (ctx: HandlerContext, slideIndex: number) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return []
    return getSlideLinks(session.opened, slideIndex).map(({ elementId, target }) => ({
      sourceId: elementId,
      target,
    }))
  },

  'slides:get-run-links': (ctx: HandlerContext, slideIndex: number) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return []
    return getRunLinks(session.opened, slideIndex).map(({ elementId, ...rest }) => ({
      sourceId: elementId,
      ...rest,
    }))
  },

  'slides:apply-header-footer': (ctx: HandlerContext, op: HeaderFooterOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'applyHeaderFooter',
          settings: {
            footer: op.footer ?? null,
            slideNum: !!op.slideNum,
            date: op.date ?? null,
            ...(op.dateAuto ? { dateAuto: true } : {}),
          },
        },
      ],
    })
    if (!r) return null
    session.fitWidthPx = op.fitWidthPx
    return buildAllRenderSlides(session.opened, op.fitWidthPx)
  },

  'slides:get-header-footer': (ctx: HandlerContext, slideIndex: number) => {
    const session = sessions.get(ctx.clientId)
    const slide = session?.opened.deck.slides[slideIndex]
    return slide ? readHeaderFooter(slide) : { footer: null, slideNum: false, date: null }
  },

  // Apply a theme (Design tab theme gallery): rewrite theme*.xml colors/fonts (scheme-referenced
  // colors follow), and remap the deck's explicit srgbClr wholesale to the new theme palette
  // (real-world decks have almost entirely explicit colors, so swapping only the theme changes
  // nothing visually). Element resolved colors come from the parse-time inheritance chain, so
  // after the surgery the deck reparses in memory; undo snapshots roll back as usual.
  'slides:apply-theme': (ctx: HandlerContext, op: ApplyThemeOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const payload = {
      op: 'applyTheme',
      name: op.name,
      colors: op.colors,
      ...(op.majorFont ? { majorFont: op.majorFont } : {}),
      ...(op.minorFont ? { minorFont: op.minorFont } : {}),
    }
    // Plan first so an invalid request doesn't clear the redo stack
    const plan = runTxn(session.opened, { ops: [payload], dryRun: true })
    if (plan.failures?.length) return { error: plan.failures[0]!.error }
    pushHistory(session)
    const r = journaledTxn(session, 'edit', { ops: [payload] })
    if (!r.applied) {
      session.undoStack.pop()
      return { error: r.failures?.[0]?.error ?? 'applyTheme failed' }
    }
    const after = r.records![0]!.after as { patched: number; remapped: number }
    if (after.patched === 0 && after.remapped === 0) {
      // Nothing matched the spec; the op only baked pending edits — not an undo step
      session.undoStack.pop()
      return null
    }
    // Reparse so every element's resolved colors/fonts refresh. In-memory
    // (reparseDeck) instead of savePptx -> openPptx: the zip roundtrip's
    // contiguous buffer fails on large decks
    session.opened = reparseDeck(session.opened)
    // Reopening cleared element-level dirty; the session-level flag preserves the "unsaved" state (reset on save)
    markMetaDirty(session)
    session.fitWidthPx = op.fitWidthPx
    return buildAllRenderSlides(session.opened, op.fitWidthPx)
  },

  'slides:set-notes': (ctx: HandlerContext, op: SetNotesOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return false
    const r = sessionTxn(session, {
      ops: [{ op: 'setNotes', target: { slide: op.slideIndex }, text: op.text }],
    })
    if (r) markMetaDirty(session)
    return r !== null
  },

  // ── Speaker notes / comments (archive surgery, riding on snapshot undo and savePptx) ────
  'slides:get-notes': (ctx: HandlerContext, slideIndex: number) => {
    const session = sessions.get(ctx.clientId)
    const slide = session?.opened.deck.slides[slideIndex]
    return session && slide ? getSlideNotes(session.opened.archive, slide.path) : ''
  },

  'slides:add-comment': (ctx: HandlerContext, op: AddCommentOp) => {
    const session = sessions.get(ctx.clientId)
    const slide = session?.opened.deck.slides[op.slideIndex]
    if (!session || !slide) return null
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'addComment',
          target: { slide: op.slideIndex },
          author: ctx.host.commentAuthor(),
          text: op.text,
        },
      ],
    })
    if (!r) return null
    markMetaDirty(session)
    return getSlideComments(session.opened.archive, slide.path)
  },

  'slides:get-comments': (ctx: HandlerContext, slideIndex: number) => {
    const session = sessions.get(ctx.clientId)
    const slide = session?.opened.deck.slides[slideIndex]
    return session && slide ? getSlideComments(session.opened.archive, slide.path) : []
  },

  'slides:delete-comment': (ctx: HandlerContext, op: DeleteCommentOp) => {
    const session = sessions.get(ctx.clientId)
    const slide = session?.opened.deck.slides[op.slideIndex]
    if (!session || !slide) return null
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'deleteComment',
          target: { slide: op.slideIndex },
          authorId: op.authorId,
          idx: op.idx,
        },
      ],
    })
    if (!r) return null
    markMetaDirty(session)
    return getSlideComments(session.opened.archive, slide.path)
  },

  // ── Section management: presentation.xml surgery, riding on snapshot undo and savePptx ──
  'slides:get-sections': (ctx: HandlerContext) => {
    const session = sessions.get(ctx.clientId)
    return session ? getSections(session.opened) : []
  },

  'slides:add-section': (ctx: HandlerContext, op: AddSectionOp) =>
    sectionShim(ctx, { op: 'addSection', atSlideIndex: op.atSlideIndex, name: op.name }),

  'slides:rename-section': (ctx: HandlerContext, op: RenameSectionOp) =>
    sectionShim(ctx, { op: 'renameSection', id: op.id, name: op.name }),

  'slides:remove-section': (ctx: HandlerContext, op: RemoveSectionOp) =>
    sectionShim(ctx, { op: 'removeSection', id: op.id }),

  // Moving a whole section changes slide order (sldIdLst + deck.slides); must send back the full RenderSlide set
  'slides:move-section': (ctx: HandlerContext, op: MoveSectionOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const sections = sectionShim(ctx, { op: 'moveSection', id: op.id, dir: op.dir })
    if (!sections) return null
    return {
      slides: buildAllRenderSlides(session.opened, session.fitWidthPx),
      sections,
    }
  },

  'slides:set-sections': (ctx: HandlerContext, sections: SectionInfo[]) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    if (!sectionShim(ctx, { op: 'setSections', sections })) return null
    return getSections(session.opened)
  },
}
