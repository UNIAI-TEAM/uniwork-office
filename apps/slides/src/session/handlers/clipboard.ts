/** Session handlers: In-app slide/element clipboard and the system clipboard probes (through HostIO). */
import { copyElementData, copySlide } from '@genoffice/pptx-engine'
import type { RenderSlide } from '@genoffice/pptx-render'
import { EMU_PER_PX_96 } from '@genoffice/pptx-render'
import type {
  CopyElementsOp,
  PasteElementsOp,
  PasteSlideOp,
  RepasteSlideOp,
} from '../../shared/ipc'
import { ELEMENTS_MARKER, SLIDE_MARKER, appClipboard, lastSlidePaste } from '../app-clipboard'
import { bytesToBase64 } from '../bytes'
import type { HandlerContext } from '../host-io'
import { buildAllRenderSlides, rebuildSlide } from '../render'
import { pushHistory, restoreSnapshot, sessions, type Session } from '../state'
import { journaledTxn, sessionTxn } from '../txn'

const performSlidePaste = (
  session: Session,
  op: PasteSlideOp,
): { slides: RenderSlide[]; index: number; sourceId?: string } | null => {
  const clip = appClipboard.slide
  if (!clip) return null
  if (op.mode === 'picture' && !clip.png) return null
  const r = journaledTxn(session, 'edit', {
    ops: [
      {
        op: 'pasteSlide',
        afterIndex: op.afterIndex,
        mode: op.mode,
        ...(op.mode === 'picture' ? { png: clip.png } : { bundle: clip.bundle }),
      },
    ],
  })
  if (!r.applied) return null
  const rec = r.records![0]!
  session.fitWidthPx = op.fitWidthPx
  return {
    slides: buildAllRenderSlides(session.opened, op.fitWidthPx),
    index: (rec.after as { index: number }).index,
    ...(rec.created?.[0] ? { sourceId: rec.created[0] } : {}),
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
      appClipboard.elements = { items, pasteCount: 0 }
      // Write our marker to the OS clipboard: an external copy overwrites it, so at paste time it tells whether internal or external is newer
      ctx.host.clipboard.writeMarker(ELEMENTS_MARKER)
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
    // Cascading offset: each paste shifts another 16px relative to the original
    const shift = Math.round(((16 * (clip.pasteCount + 1)) / scale) * EMU_PER_PX_96)
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
    clip.pasteCount++
    session.fitWidthPx = op.fitWidthPx
    const rebuilt = rebuildSlide(session, op.slideIndex)
    return rebuilt ? { slide: rebuilt, sourceIds: r.records![0]!.created! } : null
  },

  // Menu-enable probe: is there anything a paste would act on? (no image decode)
  'slides:clipboard-probe': (ctx: HandlerContext) => {
    const clipboard = ctx.host.clipboard
    if (appClipboard.slide && clipboard.hasMarker(SLIDE_MARKER)) return true
    if (appClipboard.elements && clipboard.hasMarker(ELEMENTS_MARKER)) return true
    if (clipboard.hasImage()) return true
    return clipboard.readText().trim().length > 0
  },

  'slides:clipboard-external': (ctx: HandlerContext) => {
    const clipboard = ctx.host.clipboard
    if (appClipboard.slide && clipboard.hasMarker(SLIDE_MARKER)) return { kind: 'slide' }
    if (appClipboard.elements && clipboard.hasMarker(ELEMENTS_MARKER)) return { kind: 'internal' }
    const png = clipboard.readImagePng()
    if (png) return { kind: 'image', base64: bytesToBase64(png), ext: 'png' }
    const text = clipboard.readText()
    if (text.trim()) return { kind: 'text', text }
    return { kind: 'none' }
  },

  // App-wide, so a slide copied in one tab can be pasted into another deck.
  'slides:copy-slide': (ctx: HandlerContext, slideIndex: number, pngBase64?: string) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return false
    const bundle = copySlide(session.opened, slideIndex)
    if (!bundle) return false
    appClipboard.slide = { bundle, ...(pngBase64 ? { png: pngBase64 } : {}) }
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
