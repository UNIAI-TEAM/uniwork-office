import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { AnnotationMode, TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { pdfRectToCss, quadToRect } from './annotations'
import { markupLineRotation } from '../shared/markup-line'
import type { LocalMarkup, PageGeom } from './annotations'
import { MAX_PAGE_RENDER_PIXELS } from './view-config'

/** Which items in the container are within the (expanded) viewport — shared lazy-render basis
    for pages/thumbnails. Rebuild the observer when enabled flips (sidebar toggles unmount/remount the root) */
export function useVisibleSet(
  rootRef: RefObject<HTMLElement | null>,
  count: number,
  rootMargin: string,
  enabled = true,
): { visible: Set<number>; setItemRef: (idx: number) => (el: HTMLElement | null) => void } {
  const [visible, setVisible] = useState<Set<number>>(new Set())
  const itemRefs = useRef<(HTMLElement | null)[]>([])
  useEffect(() => {
    const root = rootRef.current
    if (!enabled || !root || count === 0) return
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev)
          for (const e of entries) {
            const idx = Number((e.target as HTMLElement).dataset.idx)
            if (e.isIntersecting) next.add(idx)
            else next.delete(idx)
          }
          return next
        })
      },
      { root, rootMargin },
    )
    for (const el of itemRefs.current) if (el) io.observe(el)
    return () => io.disconnect()
  }, [rootRef, count, rootMargin, enabled])
  return {
    visible,
    setItemRef: (idx) => (el) => {
      itemRefs.current[idx] = el
    },
  }
}

/** Single page: renders canvas + text layer (select/copy) when visible, released once off-viewport */
export function PdfPage({
  doc,
  pageNo,
  scale,
  rotationDelta,
  visible,
  onRenderState,
}: {
  doc: PDFDocumentProxy
  pageNo: number
  scale: number
  /** Unsaved rotation delta (clockwise degrees) */
  rotationDelta: number
  visible: boolean
  onRenderState: (doc: PDFDocumentProxy, pageNo: number, pending: boolean) => void
}) {
  const holderRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const holder = holderRef.current
    if (!holder) return
    // Offscreen pages still release their bitmap. For an in-place rerender (save
    // reload, zoom, rotation), keep the previous canvas visible until its replacement
    // is fully rendered so the page never flashes white between document instances.
    if (!visible) {
      holder.replaceChildren()
      // A page captured by the post-save barrier may scroll out before its replacement
      // renders. Its overlays are no longer mounted, so treat the cleared offscreen page
      // as settled instead of making the whole document wait for the timeout.
      onRenderState(doc, pageNo, false)
      return
    }
    // Visibility may change while a save reload is running. Register newly visible
    // pages dynamically so global preview cleanup cannot outrun their bitmap swap.
    onRenderState(doc, pageNo, true)
    let cancelled = false
    let renderTask: RenderTask | null = null
    void (async () => {
      const page = await doc.getPage(pageNo)
      if (cancelled) return
      const viewport = page.getViewport({ scale, rotation: (page.rotate + rotationDelta) % 360 })
      // Cap at 2x: on hi-dpi screens a 3x-dpr full-page bitmap doubles memory with no visible gain.
      // Deep zoom trades dpr for the pixel budget instead — the page is already magnified.
      const dpr = Math.min(
        window.devicePixelRatio || 1,
        2,
        Math.sqrt(MAX_PAGE_RENDER_PIXELS / (viewport.width * viewport.height)),
      )
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      renderTask = page.render({
        canvas,
        viewport,
        // FormLayer renders interactive widgets as HTML. Exclude their saved appearance
        // streams from the page bitmap or filled values are drawn twice after a reload.
        annotationMode: AnnotationMode.ENABLE_FORMS,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      })
      try {
        await renderTask.promise
      } catch {
        return // cancelled
      }
      if (cancelled) return
      const textDiv = document.createElement('div')
      textDiv.className = 'textLayer'
      holder.replaceChildren(canvas, textDiv)
      // Notify after the bitmap swap, but before the browser paints. A post-save
      // reload uses this to remove the matching edit previews in the same frame.
      onRenderState(doc, pageNo, false)
      const textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: textDiv,
        viewport,
      })
      try {
        await textLayer.render()
      } catch {
        /* cancelled */
      }
    })()
    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [doc, pageNo, scale, rotationDelta, visible, onRenderState])
  return <div ref={holderRef} className="pdf-page-content" />
}

/** Overlay for unsaved markups. Purely visual (pointer-events: none) so the text
 *  underneath stays selectable; clicking is handled by the page-level hit test. */
export function MarkupOverlay({
  markups,
  geom,
  scale,
  selectedId,
}: {
  markups: LocalMarkup[]
  geom: PageGeom
  scale: number
  selectedId: string | null
}) {
  return (
    <>
      {markups.flatMap((m) =>
        m.quads.map((q, i) => {
          const [r, g, b] = m.color
          const rect = quadToRect(q)
          const style: CSSProperties = pdfRectToCss(geom, rect, scale)
          // Ordinary content on a page rotated by 90/270 runs top to bottom on screen: the
          // stroke is then a vertical line on the baseline side (left at 90, right at 270)
          // instead of the box's bottom edge, which is only the end of the line
          const pageRot = ((geom.rot % 360) + 360) % 360
          const sideways = pageRot % 180 !== 0 && markupLineRotation(pageRot, rect) === 0
          const baselineLeft = pageRot === 90
          if (m.type === 'highlight') {
            style.background = `rgba(${r * 255}, ${g * 255}, ${b * 255}, 0.4)`
          } else if (m.type === 'squiggly') {
            // Wavy line pinned to the quad's baseline edge; the stretched viewBox keeps
            // the wave periodic at any quad width while non-scaling-stroke keeps the
            // stroke 2px at any zoom (matches the saved annotation's appearance)
            const bar = `rgb(${r * 255}, ${g * 255}, ${b * 255})`
            const points = Array.from({ length: 21 }, (_, k) => {
              const y = k % 2 === 0 ? 3 : k % 4 === 1 ? 0.7 : 5.3
              return sideways ? `${baselineLeft ? y : 6 - y},${k * 5}` : `${k * 5},${y}`
            }).join(' ')
            return (
              <div
                key={`${m.id}-${i}`}
                className={`pdf-markup pdf-markup-squiggly${m.id === selectedId ? ' pdf-markup-selected' : ''}`}
                style={style}
              >
                <svg
                  width={sideways ? '6' : '100%'}
                  height={sideways ? '100%' : '6'}
                  viewBox={sideways ? '0 0 6 100' : '0 0 100 6'}
                  preserveAspectRatio="none"
                  style={{
                    position: 'absolute',
                    overflow: 'visible',
                    ...(sideways
                      ? { top: 0, ...(baselineLeft ? { left: 0 } : { right: 0 }) }
                      : { bottom: 0, left: 0 }),
                  }}
                  aria-hidden
                >
                  <polyline
                    points={points}
                    fill="none"
                    stroke={bar}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              </div>
            )
          } else {
            const bar = `rgb(${r * 255}, ${g * 255}, ${b * 255})`
            if (m.type === 'underline') {
              if (sideways) style[baselineLeft ? 'borderLeft' : 'borderRight'] = `2px solid ${bar}`
              else style.borderBottom = `2px solid ${bar}`
            } else {
              style.backgroundImage = `linear-gradient(${bar}, ${bar})`
              if (sideways) {
                style.backgroundSize = '2px 100%'
                style.backgroundPosition = baselineLeft ? '46% 0' : '54% 0'
              }
            }
          }
          return (
            <div
              key={`${m.id}-${i}`}
              className={`pdf-markup pdf-markup-${m.type}${m.id === selectedId ? ' pdf-markup-selected' : ''}`}
              style={style}
            />
          )
        }),
      )}
    </>
  )
}
