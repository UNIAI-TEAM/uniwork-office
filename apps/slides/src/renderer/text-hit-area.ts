import type { RenderNode, ShapeRenderNode } from '@genoffice/pptx-render'

/** Text frames need a full-box hit target because their glyph runs do not cover spacing/insets. */
export function needsTextFrameHitArea(shape: ShapeRenderNode): boolean {
  return !!shape.text
}

const PROMPT_PLACEHOLDERS = new Set(['title', 'ctrTitle', 'subTitle', 'body'])

/** Empty placeholder that draws a click-to-add prompt in its frame. */
export function isPromptPlaceholder(shape: ShapeRenderNode): boolean {
  if (!shape.placeholder || !PROMPT_PLACEHOLDERS.has(shape.placeholder)) return false
  return !shape.text?.lines.some((l) => l.runs.some((r) => !r.isBullet && r.text.trim()))
}

/** Shape/text node whose own text has a visible character (bullets alone do not count). */
function hasVisibleText(node: RenderNode): boolean {
  if (node.type !== 'shape' && node.type !== 'text') return false
  return !!node.text?.lines.some((l) => l.runs.some((r) => !r.isBullet && r.text.trim()))
}

/** Overlap needed on each axis (px) for text to count as sitting in a frame, not just touching its edge. */
const PROMPT_OVERLAP_PX = 4

/**
 * Empty prompt placeholders whose frame is covered by other visible text on the slide: the
 * slide's own text box, or a master/layout shape that draws text there (a converted .ppt
 * leaves an empty title placeholder beside a free text box). The prompt would be painted
 * over that text, so these placeholders draw no prompt; the others keep it.
 */
export function coveredPromptIds(nodes: readonly RenderNode[]): Set<string> {
  const covered = new Set<string>()
  const texts = nodes.filter(hasVisibleText)
  for (const n of nodes) {
    if (n.type !== 'shape' && n.type !== 'text') continue
    if (!isPromptPlaceholder(n)) continue
    const a = n.box
    const hit = texts.some((t) => {
      const b = t.box
      return (
        Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > PROMPT_OVERLAP_PX &&
        Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > PROMPT_OVERLAP_PX
      )
    })
    if (hit) covered.add(n.id)
  }
  return covered
}

/** Frame-edge grip band (screen px, each side of the edge): PowerPoint's border grabs about this wide */
export const EDGE_GRIP_PX = 6

/**
 * PowerPoint/WPS: a single click on the text itself places the caret (edit mode), while
 * the frame around the text still selects the shape for dragging. The text region is the
 * union of the laid-out line boxes (glyph extent plus a small pad, in box-local px); an
 * empty prompt placeholder counts as text over its whole frame. A band along the frame
 * edge always stays a grip, or a tight autofit box could only be dragged by its blank end.
 */
export function textHitAtPoint(
  shape: ShapeRenderNode,
  box: { w: number; h: number },
  p: { x: number; y: number },
  padPx = 4,
  edgePx = EDGE_GRIP_PX,
): boolean {
  const ex = Math.min(edgePx, box.w / 4)
  const ey = Math.min(edgePx, box.h / 4)
  if (p.x < ex || p.y < ey || p.x > box.w - ex || p.y > box.h - ey) return false
  // Empty placeholders carry no layout at all; their prompt makes the whole frame text
  if (isPromptPlaceholder(shape)) return true
  const text = shape.text
  if (!text || text.txWarp) return false
  // vert/vert270 lines keep pre-rotation geometry; eaVert/wordArtVert columns are real boxes
  if (text.vert === 'vert' || text.vert === 'vert270') return false
  for (const line of text.lines) {
    const top = text.insets.t + line.top
    if (p.y < top - padPx || p.y > top + line.height + padPx) continue
    let x0 = Infinity
    let x1 = -Infinity
    for (const r of line.runs) {
      if (!r.text) continue
      // A rotated Latin word in a column: x is the rotation anchor at the glyph box's right edge
      x0 = Math.min(x0, r.rotate90 ? r.x - r.fontSizePx : r.x)
      x1 = Math.max(x1, r.rotate90 ? r.x : r.x + r.widthPx)
    }
    if (x0 === Infinity) continue
    if (p.x >= text.insets.l + x0 - padPx && p.x <= text.insets.l + x1 + padPx) return true
  }
  return false
}
