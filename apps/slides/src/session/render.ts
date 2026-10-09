/**
 * RenderSlide building for the session core: full-deck and single-slide rebuilds, the
 * image media resolver (data URLs for the renderer), Office SVG theme retinting, and the
 * text autofit write-backs that run after text edits.
 */
import {
  materializeSlide,
  parseClrMap,
  parseTheme,
  patchBodyPrAutofit,
  resolveSchemeColor,
  type OpenedPptx,
  type Slide,
  type TextElement,
} from '@genoffice/pptx-engine'
import { matchesElementRef } from '@genoffice/pptx-engine/identity'
import {
  buildRenderSlide,
  layoutText,
  makeViewport,
  EMU_PER_PX_96,
  type RenderSlide,
} from '@genoffice/pptx-render'
import { displayMime } from '../main/media-mime'
import { neutralizeJpegOrientation } from '../main/jpeg-orientation'
import { bytesToBase64, utf8Decode, utf8Encode } from './bytes'
import { getFontMetrics, sessionPlatform } from './platform'
import type { Session } from './state'

export function buildAllRenderSlides(opened: OpenedPptx, fitWidthPx: number): RenderSlide[] {
  return opened.deck.slides.map((s, i) =>
    buildRenderSlide(s, opened.deck.size, {
      fitWidthPx,
      media: makeMediaResolver(opened, s.path),
      metrics: getFontMetrics(),
      slideNo: i + 1,
    }),
  )
}

/** Office theme-class slot (MsftOfcThm_<slot>_Fill/_Stroke) → schemeClr name. */
const SVG_THEME_SLOTS: Record<string, string> = {
  background1: 'bg1',
  text1: 'tx1',
  background2: 'bg2',
  text2: 'tx2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hyperlink: 'hlink',
  followedhyperlink: 'folHlink',
}

/**
 * Office-exported SVGs carry `.MsftOfcThm_<slot>_Fill/_Stroke` CSS classes whose baked
 * values PowerPoint rewrites to the CURRENT theme's colors at render time (the static
 * value is just the export-time snapshot — probe deck: a bg1-classed blob draws white
 * on a white theme, not its baked blue). Mirror that rewrite before serving the SVG.
 */
export function retintThemedSvg(svg: string, opened: OpenedPptx, slidePath?: string): string {
  const path = slidePath ?? opened.deck.slides[0]?.path
  if (!path) return svg
  let theme
  try {
    const chain = opened.archive.resolveSlideChain(path)
    const themeXml = chain.themePath ? opened.archive.readText(chain.themePath) : null
    if (!themeXml) return svg
    theme = parseTheme(themeXml)
    const masterXml = chain.masterPath ? opened.archive.readText(chain.masterPath) : undefined
    const layoutXml = chain.layoutPath ? opened.archive.readText(chain.layoutPath) : undefined
    theme.clrMap = parseClrMap(
      masterXml ?? undefined,
      layoutXml ?? undefined,
      opened.archive.readText(path) ?? undefined,
    )
  } catch {
    return svg
  }
  return svg.replace(
    /\.MsftOfcThm_(\w+?)_(Fill|Stroke)\w*\s*\{[^}]*\}/g,
    (rule, slot: string, kind: string) => {
      const scheme = SVG_THEME_SLOTS[slot.toLowerCase()]
      const color = scheme ? resolveSchemeColor(scheme, theme) : undefined
      if (!color) return rule
      const prop = kind === 'Stroke' ? 'stroke' : 'fill'
      return rule.replace(new RegExp(`${prop}\\s*:\\s*[^;}]+`, 'g'), `${prop}:${color}`)
    },
  )
}

/** Image mediaRef -> dataUrl (lazily decoded). TIFF is transcoded to PNG for display
    (Chromium can't decode it); the archive keeps the original bytes for save fidelity.
    The mime comes from magic-byte sniffing first (legacy decks mislabel media — a PNG
    stored as .emf must not enter the EMF parser), extension second. */
export function makeMediaResolver(opened: OpenedPptx, slidePath?: string) {
  const cache = new Map<string, string | undefined>()
  return (mediaRef: string): string | undefined => {
    if (cache.has(mediaRef)) return cache.get(mediaRef)
    const bytes = opened.archive.readBytes(mediaRef)
    let url: string | undefined
    if (bytes) {
      const mime = displayMime(mediaRef, bytes)
      if (mime === 'image/tiff') {
        const decoded = sessionPlatform().decodeTiff(bytes)
        if (decoded) url = `data:image/png;base64,${bytesToBase64(decoded.png)}`
      } else if (mime === 'image/svg+xml') {
        let text = utf8Decode(bytes)
        if (text.includes('MsftOfcThm_')) text = retintThemedSvg(text, opened, slidePath)
        url = `data:${mime};base64,${bytesToBase64(utf8Encode(text))}`
      } else {
        // PowerPoint ignores EXIF orientation; Chromium applies it on decode — neutralize
        // the flag so rotated-pixel JPEGs with a shape-level rot don't double-rotate
        const served = mime === 'image/jpeg' ? neutralizeJpegOrientation(bytes) : bytes
        url = `data:${mime};base64,${bytesToBase64(served)}`
      }
    }
    cache.set(mediaRef, url)
    return url
  }
}

/** Rebuild a single page's RenderSlide (sent back to the renderer after an edit). */
export function rebuildSlide(session: Session, slideIndex: number): RenderSlide | null {
  const slide = session.opened.deck.slides[slideIndex]
  if (!slide) return null
  return buildRenderSlide(slide, session.opened.deck.size, {
    fitWidthPx: session.fitWidthPx,
    media: makeMediaResolver(session.opened, slide.path),
    metrics: getFontMetrics(),
    slideNo: slideIndex + 1,
  })
}

/**
 * Rebuild the RenderSlide after re-parsing the whole page (the model is stale after a chart
 * edit and needs a reparse). Equivalent to materializeSlide then rebuildSlide, but without the
 * structureDirty save logic.
 */
export function rebuildSlideWithReparse(session: Session, slideIndex: number): RenderSlide | null {
  const fresh = materializeSlide(session.opened, slideIndex)
  if (!fresh) return null
  return buildRenderSlide(fresh, session.opened.deck.size, {
    fitWidthPx: session.fitWidthPx,
    media: makeMediaResolver(session.opened, fresh.path),
    metrics: getFontMetrics(),
    slideNo: slideIndex + 1,
  })
}

/** Theme body (minor) Latin font: fallback shown in the ribbon font box when the selection has no text element. */
export function deckDefaultFont(opened: OpenedPptx): string | undefined {
  try {
    const slidePath = opened.archive.readPresentation().slidePaths[0]
    if (!slidePath) return undefined
    const themePath = opened.archive.resolveSlideChain(slidePath).themePath
    const xml = themePath ? opened.archive.readText(themePath) : undefined
    return xml ? parseTheme(xml).minorFont : undefined
  } catch {
    return undefined
  }
}

function findEl(slide: Slide, sourceId: string): TextElement | undefined {
  const el = slide.elements.find((e) => matchesElementRef(e, sourceId))
  if (el && (el.type === 'text' || el.type === 'shape')) return el as TextElement
  return undefined
}

/**
 * spAutoFit (autofit='resize', "resize shape to fit text"): after a text change, the box height
 * grows/shrinks with the content and is written back to cy. rendered = the
 * rebuilt result after this change; when the height changed, update the transform and rebuild
 * once more. Top-level elements only (group children use a different coordinate system, skip).
 */
export function applyAutofitResize(
  session: Session,
  slideIndex: number,
  sourceId: string,
  rendered: RenderSlide | null,
): RenderSlide | null {
  if (!rendered) return rendered
  const slide = session.opened.deck.slides[slideIndex]
  const el = slide ? findEl(slide, sourceId) : undefined
  if (!el?.text || el.text.autofit !== 'resize') return rendered
  const node = rendered.nodes.find((n) => n.sourceId === el.id)
  if (!node || (node.type !== 'shape' && node.type !== 'text') || !node.text) return rendered
  const needH = node.text.contentHeight + node.text.insets.t + node.text.insets.b
  if (Math.abs(needH - node.box.h) < 1) return rendered
  const baseWidthPx = session.opened.deck.size.cx / EMU_PER_PX_96
  const scale = session.fitWidthPx / baseWidthPx
  el.transform = {
    ...el.transform,
    offset: {
      ...el.transform.offset,
      cy: Math.max(Math.round((needH / scale) * EMU_PER_PX_96), 1),
    },
  }
  el.dirtyTransform = true
  return rebuildSlide(session, slideIndex)
}

/**
 * normAutofit fontScale write-back: when the shrink ratio the layout actually used after a text
 * edit (≤ the stored cap, shrink-only) differs from the stored model value, sync the model and
 * patch the bodyPr attribute — only then does PowerPoint show the same size on open.
 * Triggered only by text edits (resize gestures do not write: the layout cap locks the stored
 * value, and writing back during a gesture would ratchet one way); top-level elements only.
 */
export function syncAutofitScale(
  session: Session,
  slideIndex: number,
  sourceId: string,
  rendered: RenderSlide | null,
): RenderSlide | null {
  if (!rendered) return rendered
  const slide = session.opened.deck.slides[slideIndex]
  const el = slide ? findEl(slide, sourceId) : undefined
  if (!el?.text || el.text.autofit !== 'shrink') return rendered
  const node = rendered.nodes.find((n) => n.sourceId === el.id)
  if (!node || (node.type !== 'shape' && node.type !== 'text') || !node.text) return rendered
  // The plain render honors the stored fontScale as-is (PowerPoint-on-open semantics);
  // after a text edit, re-run the layout with the autofit ladder enabled to find the
  // ratio PowerPoint would now use (still capped at the stored value).
  const refit = layoutText({
    body: el.text,
    boxWidthPx: node.box.w,
    boxHeightPx: node.box.h,
    metrics: getFontMetrics(),
    vp: makeViewport(session.opened.deck.size, session.fitWidthPx),
    refitAutofit: true,
  })
  const effective = refit.fontScale
  const effectiveRed = refit.lnSpcReduction ?? 0
  if (
    Math.abs(effective - (el.text.fontScale ?? 1)) < 0.005 &&
    Math.abs(effectiveRed - (el.text.lnSpcReduction ?? 0)) < 0.005
  )
    return rendered
  el.text.fontScale = effective
  if (effectiveRed) el.text.lnSpcReduction = effectiveRed
  else delete el.text.lnSpcReduction
  el.anchor.originalXml = patchBodyPrAutofit(el.anchor.originalXml, effective, effectiveRed)
  slide!.structureDirty = true
  // The render above used the pre-edit stored scale; redo it at the written-back value
  return rebuildSlide(session, slideIndex) ?? rendered
}
