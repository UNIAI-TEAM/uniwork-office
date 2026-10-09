/** Session handlers: In-app slide/element clipboard and the system clipboard probes (through HostIO). */
import { copyElementData, copySlide, type SlideBundle } from '@genoffice/pptx-engine'
import { EMU_PER_PX_96 } from '@genoffice/pptx-render'
import { newPasteCascade, pageKey, pasteShiftPx, recordPaste } from '../../main/paste-cascade'
import type {
  CopyElementsOp,
  CopySlidesOp,
  PasteElementsOp,
  PasteSlideOp,
  PasteSlideResult,
  RepasteSlideOp,
} from '../../shared/ipc'
import {
  ELEMENTS_MARKER,
  SLIDE_MARKER,
  appClipboard,
  isElementClipboardToken,
  lastSlidePaste,
} from '../app-clipboard'
import { bytesToBase64 } from '../bytes'
import type { HandlerContext } from '../host-io'
import { buildAllRenderSlides, rebuildSlide } from '../render'
import { markMetaDirty, pushHistory, restoreSnapshot, sessions, type Session } from '../state'
import { journaledTxn, sessionTxn } from '../txn'

// Several copied slides paste in order; 'picture' mode stacks every bitmap on the anchor slide.
const performSlidePaste = (session: Session, op: PasteSlideOp): PasteSlideResult | null => {
  const clip = appClipboard.slide
  if (!clip) return null
  const picture = op.mode === 'picture'
  const { bundles, pngs } = clip
  if (picture && !pngs) return null
  const r = journaledTxn(session, 'edit', {
    ops: bundles.map((bundle, j) => ({
      op: 'pasteSlide',
      afterIndex: picture ? op.afterIndex : op.afterIndex + j,
      mode: op.mode,
      ...(picture ? { png: pngs![j] } : { bundle }),
    })),
  })
  if (!r.applied) return null
  const rec = r.records![0]!
  session.fitWidthPx = op.fitWidthPx
  // Pasted slides are parsed fresh, so no element dirty flag is set: flag the
  // session here or the paste is invisible to the close guard and autosave.
  // repaste-slide re-runs this after restoring a snapshot that cleared the flag.
  markMetaDirty(session)
  const created = r.records!.flatMap((x) => x.created ?? [])
  return {
    slides: buildAllRenderSlides(session.opened, op.fitWidthPx),
    index: (rec.after as { index: number }).index,
    count: picture ? 0 : bundles.length,
    ...(created.length ? { sourceIds: created } : {}),
  }
}

export const clipboardHandlers = {
  'slides:copy-elements': (ctx: HandlerContext, op: CopyElementsOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return 0
    const slide = session.opened.deck.slides[op.slideIndex]
    if (!slide) return 0
    const items = op.sourceIds
      .map((id) => slide.elements.find((el) => el.id === id))
      .filter((el): el is NonNullable<typeof el> => !!el)
      .map((el) => copyElementData(session.opened, slide, el))
    if (items.length) {
      const token = isElementClipboardToken(op.clipboardToken)
        ? op.clipboardToken
        : globalThis.crypto.randomUUID()
      appClipboard.elements = {
        items,
        cascade: newPasteCascade(op.cut ? null : pageKey(ctx.clientId, op.slideIndex)),
        token,
        senderId: ctx.clientId,
      }
      // Write our marker to the OS clipboard: an external copy overwrites it, so at paste time it tells whether internal or external is newer
      ctx.host.clipboard.writeMarker(ELEMENTS_MARKER, token)
    }
    return items.length
  },

  'slides:paste-elements': (ctx: HandlerContext, op: PasteElementsOp) => {
    const session = sessions.get(ctx.clientId)
    const clip = appClipboard.elements
    if (!session || !clip?.items.length) return null
    if (!session.opened.deck.slides[op.slideIndex]) return null
    const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
    const scale = op.fitWidthPx / baseWidthPx
    // Cascade only past occupied spots: the first paste onto another page lands
    // at the source coordinates exactly; the copy page and repeat
    // pastes keep shifting 16px per landing relative to the original.
    const target = pageKey(ctx.clientId, op.slideIndex)
    const shiftPx = pasteShiftPx(clip.cascade, target)
    const shift = Math.round((shiftPx / scale) * EMU_PER_PX_96)
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'pasteElements',
          target: { slide: op.slideIndex },
          items: clip.items,
          dx: shift,
          dy: shift,
        },
      ],
    })
    if (!r) return null
    recordPaste(clip.cascade, target)
    session.fitWidthPx = op.fitWidthPx
    const rebuilt = rebuildSlide(session, op.slideIndex)
    return rebuilt ? { slide: rebuilt, sourceIds: r.records![0]!.created! } : null
  },

  // Menu-enable probe: is there anything a paste would act on? (no image decode)
  'slides:clipboard-probe': (ctx: HandlerContext) => {
    const clipboard = ctx.host.clipboard
    const elements = appClipboard.elements
    if (appClipboard.slide && clipboard.hasMarker(SLIDE_MARKER)) return true
    if (elements && clipboard.hasMarker(ELEMENTS_MARKER, elements.token)) return true
    if (clipboard.hasImage()) return true
    return clipboard.readText().trim().length > 0
  },

  'slides:clipboard-external': (ctx: HandlerContext) => {
    const clipboard = ctx.host.clipboard
    const elements = appClipboard.elements
    if (appClipboard.slide && clipboard.hasMarker(SLIDE_MARKER)) return { kind: 'slide' }
    if (elements && clipboard.hasMarker(ELEMENTS_MARKER, elements.token))
      return { kind: 'internal' }
    const png = clipboard.readImagePng()
    if (png) return { kind: 'image', base64: bytesToBase64(png), ext: 'png' }
    const text = clipboard.readText()
    if (text.trim()) return { kind: 'text', text }
    return { kind: 'none' }
  },

  // App-wide, so slides copied in one tab can be pasted into another deck.
  'slides:copy-slides': (ctx: HandlerContext, op: CopySlidesOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session || !op.slideIndexes.length) return false
    const bundles: SlideBundle[] = []
    for (const i of op.slideIndexes) {
      const bundle = copySlide(session.opened, i)
      if (!bundle) return false
      bundles.push(bundle)
    }
    const pngs = op.pngs?.length === bundles.length ? op.pngs : undefined
    appClipboard.slide = { bundles, ...(pngs ? { pngs } : {}) }
    // Marker so plain ⌘V knows the latest copy was a slide (element copies / external copies overwrite it)
    ctx.host.clipboard.writeMarker(SLIDE_MARKER)
    return true
  },

  'slides:has-slide-clipboard': () => appClipboard.slide !== null,

  'slides:paste-slide': (ctx: HandlerContext, op: PasteSlideOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session || !appClipboard.slide) return null
    pushHistory(session)
    const r = performSlidePaste(session, op)
    if (!r) {
      session.undoStack.pop()
      return null
    }
    lastSlidePaste.set(ctx.clientId, {
      afterIndex: op.afterIndex,
      undoLen: session.undoStack.length,
    })
    return r
  },

  // Paste-options floater: undo the just-completed paste and redo it with another
  // mode. Refused when anything (edits, ⌘Z) touched the deck in between.
  'slides:repaste-slide': (ctx: HandlerContext, op: RepasteSlideOp) => {
    const session = sessions.get(ctx.clientId)
    const rec = lastSlidePaste.get(ctx.clientId)
    if (!session || !appClipboard.slide || !rec) return null
    if (session.undoStack.length !== rec.undoLen) return null
    const snap = session.undoStack.pop()
    if (!snap) return null
    restoreSnapshot(session, snap)
    pushHistory(session)
    const r = performSlidePaste(session, {
      afterIndex: rec.afterIndex,
      fitWidthPx: op.fitWidthPx,
      mode: op.mode,
    })
    if (!r) {
      session.undoStack.pop()
      return null
    }
    rec.undoLen = session.undoStack.length
    return r
  },
}
