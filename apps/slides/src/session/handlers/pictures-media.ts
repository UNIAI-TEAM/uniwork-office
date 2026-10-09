/** Session handlers: Pictures, picture/background fills, ink, audio/video and 3D models (pickers go through HostIO). */
import { EMU_PER_PX_96 } from '@genoffice/pptx-render'
import { tm } from '../../main/i18n-main'
import { unplayableAudioCodec } from '../../main/mp4-audio-sniff'
import type {
  AddImageBytesOp,
  AddInkOp,
  AddMediaBytesOp,
  EditBackgroundOp,
  EditFillImageOp,
  EditPictureOpacityOp,
  EditPictureSrcRectOp,
  ReplacePictureBytesOp,
} from '../../shared/ipc'
import { base64ToBytes, bytesToBase64 } from '../bytes'
import type { HandlerContext } from '../host-io'
import { sessionPlatform } from '../platform'
import { buildAllRenderSlides, rebuildSlide } from '../render'
import { pushHistory, sessions } from '../state'
import { journaledTxn, sessionTxn } from '../txn'

// Playback mime per media extension
const AV_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  // Chromium refuses to even load video/quicktime, but demuxes QuickTime bytes
  // fine through the ISO-BMFF path when served as video/mp4
  mov: 'video/mp4',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
}

export const pictureMediaHandlers = {
  'slides:insert-image': async (ctx: HandlerContext, slideIndex: number, fitWidthPx: number) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const slide = session.opened.deck.slides[slideIndex]
    if (!slide) return null
    const file = await ctx.host.pickImage('insert')
    if (!file) return null
    const { bytes, ext } = file

    // Scale proportionally to at most half the page width/height, centered
    const deckSize = session.opened.deck.size
    let natural = { width: 4, height: 3 }
    if (ext === 'tif' || ext === 'tiff') {
      const decoded = sessionPlatform().decodeTiff(bytes)
      if (decoded) natural = { width: decoded.width, height: decoded.height }
    } else {
      const size = await ctx.host.imageSize(file)
      if (size) natural = size
    }
    const maxW = deckSize.cx / 2
    const maxH = deckSize.cy / 2
    const scale = Math.min(maxW / natural.width, maxH / natural.height)
    const cx = Math.round(natural.width * scale)
    const cy = Math.round(natural.height * scale)
    const offset = {
      x: Math.round((deckSize.cx - cx) / 2),
      y: Math.round((deckSize.cy - cy) / 2),
      cx,
      cy,
    }

    const txn = sessionTxn(session, {
      ops: [
        {
          op: 'addPicture',
          target: { slide: slideIndex },
          bytes: new Uint8Array(bytes),
          ext,
          offset,
        },
      ],
    })
    if (!txn) return { error: 'unsupported' as const, ext }
    session.fitWidthPx = fitWidthPx
    const rebuilt = rebuildSlide(session, slideIndex)
    return rebuilt ? { slide: rebuilt, sourceId: txn.records![0]!.created![0]! } : null
  },

  // Replace picture: the renderer swaps the bytes in place through replacePictureBytes
  'slides:pick-picture-file': async (ctx: HandlerContext) => {
    const file = await ctx.host.pickImage('replace')
    if (!file) return null
    return { base64: bytesToBase64(file.bytes), ext: file.ext }
  },

  'slides:add-image-bytes': (ctx: HandlerContext, op: AddImageBytesOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const slide = session.opened.deck.slides[op.slideIndex]
    if (!slide) return null
    const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
    const scale = op.fitWidthPx / baseWidthPx
    const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'addPicture',
          target: { slide: op.slideIndex },
          bytes: base64ToBytes(op.base64),
          ext: op.ext,
          offset: {
            x: toEmu(op.xPx),
            y: toEmu(op.yPx),
            cx: Math.max(1, toEmu(op.wPx)),
            cy: Math.max(1, toEmu(op.hPx)),
          },
          ...(op.name ? { name: op.name } : {}),
        },
      ],
    })
    if (!r) return { error: 'unsupported' as const, ext: op.ext }
    session.fitWidthPx = op.fitWidthPx
    const rebuilt = rebuildSlide(session, op.slideIndex)
    return rebuilt ? { slide: rebuilt, sourceId: r.records![0]!.created![0]! } : null
  },

  'slides:replace-picture-bytes': (ctx: HandlerContext, op: ReplacePictureBytesOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const slide = session.opened.deck.slides[op.slideIndex]
    if (!slide) return null
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'replacePicture',
          target: { slide: op.slideIndex, el: op.sourceId },
          bytes: base64ToBytes(op.base64),
          ext: op.ext,
          ...(op.keepSrcRect ? { keepSrcRect: true } : {}),
        },
      ],
    })
    if (!r) return { error: 'unsupported' as const, ext: op.ext }
    return rebuildSlide(session, op.slideIndex)
  },

  'slides:edit-picture-opacity': (ctx: HandlerContext, op: EditPictureOpacityOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'setPictureOpacity',
          target: { slide: op.slideIndex, el: op.sourceId },
          opacity: op.opacity,
        },
      ],
    })
    return r ? rebuildSlide(session, op.slideIndex) : null
  },

  'slides:edit-picture-src-rect': (ctx: HandlerContext, op: EditPictureSrcRectOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    let box: { x: number; y: number; cx: number; cy: number } | undefined
    if (op.boxPx && op.fitWidthPx) {
      const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
      const scale = op.fitWidthPx / baseWidthPx
      const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
      box = {
        x: toEmu(op.boxPx.x),
        y: toEmu(op.boxPx.y),
        cx: toEmu(op.boxPx.w),
        cy: toEmu(op.boxPx.h),
      }
    }
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'setPictureSrcRect',
          target: { slide: op.slideIndex, el: op.sourceId },
          srcRect: op.srcRect,
          ...(box ? { box } : {}),
        },
      ],
    })
    return r ? rebuildSlide(session, op.slideIndex) : null
  },

  'slides:edit-image-fill': async (ctx: HandlerContext, op: EditFillImageOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const slide = session.opened.deck.slides[op.slideIndex]
    if (!slide || op.targets.length === 0) return null
    let bytes: Uint8Array
    let ext: string
    if (op.source) {
      // bundled texture preset: bytes shipped inline, no picker
      bytes = base64ToBytes(op.source.base64)
      ext = op.source.ext.toLowerCase()
    } else {
      const file = await ctx.host.pickImage('insert')
      if (!file) return null
      bytes = file.bytes
      ext = file.ext
    }
    pushHistory(session)
    // The picked bytes land as one media part; further targets only add rels to it
    // (each op reports the landed media path, threaded into the next op's source)
    let landed: string | null = null
    let applied = 0
    for (const target of op.targets) {
      const r = journaledTxn(session, 'edit', {
        ops: [
          {
            op: 'setImageFill',
            target: { slide: op.slideIndex, el: target.sourceId },
            source: landed ? { mediaPath: landed } : { bytes, ext },
            tile: op.mode === 'tile',
            ...(target.groupId ? { group: target.groupId } : {}),
          },
        ],
      })
      if (r.applied) {
        applied += 1
        const used = (r.records![0]!.after as { mediaPath?: string } | undefined)?.mediaPath
        if (used) landed = used
      }
    }
    if (!applied) {
      session.undoStack.pop()
      return null
    }
    return rebuildSlide(session, op.slideIndex)
  },

  // Shim over the canonical setBackground op (one slide per op; apply-to-all fans out;
  // the full-bleed backdrop repaint lives in the op). The picker goes through HostIO.
  'slides:edit-background': async (ctx: HandlerContext, op: EditBackgroundOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const slides = session.opened.deck.slides
    const targets = op.slideIndex === -1 ? slides : [slides[op.slideIndex]].filter(Boolean)
    if (targets.length === 0) return null

    if (op.kind === 'image') {
      let source: { bytes: Uint8Array; ext: string } | { mediaPath: string }
      if (op.pick !== false) {
        const file = await ctx.host.pickImage('insert')
        if (!file) return null
        source = { bytes: file.bytes, ext: file.ext }
      } else {
        // Reuse an already-landed background image (mode change / apply-to-all)
        const src = slides[op.sourceSlideIndex ?? op.slideIndex]
        if (src?.background?.type !== 'image') return null
        source = { mediaPath: src.background.mediaRef }
      }
      pushHistory(session)
      // The picked bytes land as one media part; further slides only add a rel to it
      // (each op reports the landed media path, threaded into the next op's source)
      let landed: string | null = null
      for (const [i, s] of slides.entries()) {
        if (!targets.includes(s)) continue
        const r = journaledTxn(session, 'edit', {
          ops: [
            {
              op: 'setBackground',
              target: { slide: i },
              kind: 'image',
              source: landed ? { mediaPath: landed } : source,
              tile: op.mode === 'tile',
            },
          ],
        })
        if (r.applied) {
          const used = (r.records![0]!.after as { mediaPath?: string } | undefined)?.mediaPath
          if (used) landed = used
        }
      }
      if (!landed) {
        session.undoStack.pop()
        return null
      }
    } else {
      const common: Record<string, unknown> =
        op.kind === 'solid'
          ? { kind: 'solid', color: op.color }
          : op.kind === 'gradient'
            ? {
                kind: 'gradient',
                from: op.from,
                to: op.to,
                ...(op.angleDeg !== undefined ? { angleDeg: op.angleDeg } : {}),
                ...(op.radial ? { radial: true } : {}),
              }
            : op.kind === 'reset'
              ? { kind: 'reset' }
              : { kind: 'graphics', hidden: op.hidden }
      pushHistory(session)
      const r = journaledTxn(session, 'edit', {
        ops: slides
          .map((s, i) => ({ s, i }))
          .filter(({ s }) => targets.includes(s))
          .map(({ i }) => ({ op: 'setBackground', target: { slide: i }, ...common })),
      })
      if (!r.applied) {
        session.undoStack.pop()
        return null
      }
    }
    session.fitWidthPx = op.fitWidthPx
    return buildAllRenderSlides(session.opened, op.fitWidthPx)
  },

  // Freehand ink stroke commit: one transparent PNG picture element per stroke (cNvPr name has
  // the aislides-ink prefix, descr stores the vector points as JSON); undo/save/thumbnails all
  // go through the existing picture-element pipeline.
  'slides:add-ink': (ctx: HandlerContext, op: AddInkOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const slide = session.opened.deck.slides[op.slideIndex]
    if (!slide) return null
    const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
    const scale = op.fitWidthPx / baseWidthPx
    const toEmu = (px: number) => Math.round((px / scale) * EMU_PER_PX_96)
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'addPicture',
          target: { slide: op.slideIndex },
          bytes: base64ToBytes(op.base64),
          ext: 'png',
          offset: {
            x: toEmu(op.xPx),
            y: toEmu(op.yPx),
            cx: Math.max(1, toEmu(op.wPx)),
            cy: Math.max(1, toEmu(op.hPx)),
          },
          name: `aislides-ink ${Date.now().toString(36)}`,
          descr: op.payload,
        },
      ],
    })
    if (!r) return null
    session.fitWidthPx = op.fitWidthPx
    const rebuilt = rebuildSlide(session, op.slideIndex)
    return rebuilt ? { slide: rebuilt, sourceId: r.records![0]!.created![0]! } : null
  },

  // Show a dialog to pick video/audio and embed it. Video poster frame prefers the system thumbnail (QuickLook), falling back to a solid color on failure.
  'slides:insert-media': async (
    ctx: HandlerContext,
    slideIndex: number,
    kind: 'video' | 'audio',
    fitWidthPx: number,
  ) => {
    const session = sessions.get(ctx.clientId)
    if (!session || !session.opened.deck.slides[slideIndex]) return null
    const file = await ctx.host.pickMedia(kind)
    if (!file) return null
    const { bytes, ext, name: fileName } = file

    // Warn up front when in-app playback will be broken — AVI has no
    // Chromium demuxer at all; mp4/m4v/mov with e.g. AC-3/DTS audio plays silent.
    if (kind === 'video') {
      let detail: string | null = null
      if (ext === 'avi') detail = tm('mediaAviBody')
      else if (ext === 'mp4' || ext === 'm4v' || ext === 'mov') {
        const codec = unplayableAudioCodec(new Uint8Array(bytes))
        if (codec) detail = tm('mediaNoAudioBody', { codec })
      }
      if (detail) {
        await ctx.host.confirm({
          type: 'warning',
          buttons: [tm('legacyPptOk')],
          message: tm('mediaUnsupportedTitle'),
          detail,
        })
      }
    }

    // Solid-color fallback when the host has no poster frame
    const poster = kind === 'video' ? await ctx.host.readMediaPoster(file, 'video') : undefined

    const deckSize = session.opened.deck.size
    const offset =
      kind === 'video'
        ? (() => {
            const cx = Math.round(deckSize.cx * 0.6)
            const cy = Math.round((cx * 9) / 16)
            return {
              x: Math.round((deckSize.cx - cx) / 2),
              y: Math.round((deckSize.cy - cy) / 2),
              cx,
              cy,
            }
          })()
        : (() => {
            const cx = Math.round(deckSize.cx * 0.24)
            const cy = Math.round(deckSize.cy * 0.09)
            return {
              x: Math.round((deckSize.cx - cx) / 2),
              y: Math.round((deckSize.cy - cy) / 2),
              cx,
              cy,
            }
          })()

    const txn = sessionTxn(session, {
      ops: [
        {
          op: 'addMedia',
          target: { slide: slideIndex },
          kind,
          bytes: new Uint8Array(bytes),
          ext,
          ...(poster ? { poster } : {}),
          offset,
          name: fileName,
        },
      ],
    })
    if (!txn) return null
    session.fitWidthPx = fitWidthPx
    const rebuilt = rebuildSlide(session, slideIndex)
    return rebuilt ? { slide: rebuilt, sourceId: txn.records![0]!.created![0]! } : null
  },

  // Double-click playback: read the media bytes of an audio/video element (embedded converts to dataUrl, external links return as-is)
  'slides:media-data': (ctx: HandlerContext, slideIndex: number, sourceId: string) => {
    const session = sessions.get(ctx.clientId)
    const slide = session?.opened.deck.slides[slideIndex]
    if (!session || !slide) return null
    const el = slide.elements.find((x) => x.id === sourceId)
    if (!el || el.type !== 'picture') return null
    const media = (
      el as { media?: { kind: 'video' | 'audio'; target?: string; external?: boolean } }
    ).media
    if (!media?.target) return null
    if (media.external) return { kind: media.kind, dataUrl: media.target }
    const bytes = session.opened.archive.readBytes(media.target)
    if (!bytes) return null
    const ext = media.target.split('.').pop()?.toLowerCase() ?? ''
    const mime = AV_MIME[ext] ?? (media.kind === 'video' ? 'video/mp4' : 'audio/mpeg')
    return {
      kind: media.kind,
      dataUrl: `data:${mime};base64,${bytesToBase64(bytes)}`,
    }
  },

  // Media recorded by the renderer (screen-recording webm): placed centered at 16:9
  'slides:add-media-bytes': (ctx: HandlerContext, op: AddMediaBytesOp) => {
    const session = sessions.get(ctx.clientId)
    if (!session || !session.opened.deck.slides[op.slideIndex]) return null
    const deckSize = session.opened.deck.size
    const cx = Math.round(deckSize.cx * 0.6)
    const cy = Math.round((cx * 9) / 16)
    const r = sessionTxn(session, {
      ops: [
        {
          op: 'addMedia',
          target: { slide: op.slideIndex },
          kind: op.kind,
          bytes: base64ToBytes(op.base64),
          ext: op.ext,
          offset: {
            x: Math.round((deckSize.cx - cx) / 2),
            y: Math.round((deckSize.cy - cy) / 2),
            cx,
            cy,
          },
          ...(op.name ? { name: op.name } : {}),
        },
      ],
    })
    if (!r) return null
    session.fitWidthPx = op.fitWidthPx
    const rebuilt = rebuildSlide(session, op.slideIndex)
    return rebuilt ? { slide: rebuilt, sourceId: r.records![0]!.created![0]! } : null
  },

  // 3D model (simplified): glb embed + poster placeholder image
  'slides:insert-model3d': async (ctx: HandlerContext, slideIndex: number, fitWidthPx: number) => {
    const session = sessions.get(ctx.clientId)
    if (!session || !session.opened.deck.slides[slideIndex]) return null
    const file = await ctx.host.pickMedia('model3d')
    if (!file) return null
    const { bytes, ext } = file

    // Dark-gray fallback when the host has no poster frame
    const poster = await ctx.host.readMediaPoster(file, 'model3d')

    const deckSize = session.opened.deck.size
    const cy = Math.round(deckSize.cy * 0.5)
    const cx = cy
    const txn = sessionTxn(session, {
      ops: [
        {
          op: 'addModel3d',
          target: { slide: slideIndex },
          bytes: new Uint8Array(bytes),
          ext,
          ...(poster ? { poster } : {}),
          offset: {
            x: Math.round((deckSize.cx - cx) / 2),
            y: Math.round((deckSize.cy - cy) / 2),
            cx,
            cy,
          },
          name: file.name,
        },
      ],
    })
    if (!txn) return null
    session.fitWidthPx = fitWidthPx
    const rebuilt = rebuildSlide(session, slideIndex)
    return rebuilt ? { slide: rebuilt, sourceId: txn.records![0]!.created![0]! } : null
  },
}
