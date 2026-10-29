/**
 * Which way a marked line of text runs, for the underline / strikeout / squiggly stroke.
 *
 * The stroke sits on the line's baseline edge, and where that edge is depends on the text
 * direction in PDF space, which a quad (an axis-aligned box) does not carry. On an upright
 * page it is the bottom edge. A page /Rotate of 90 or 270 is applied either to content
 * written upright in the rotated view (text runs along PDF y: a tall quad) or to ordinary
 * content (text runs along PDF x: a wide quad, sideways on screen). The box's long side
 * tells the two apart; a roughly square box keeps the page-rotation reading.
 */

const normRot = (r: number) => ((r % 360) + 360) % 360

/** a wide box has to be this much wider than tall before it counts as sideways text */
const SIDEWAYS_RATIO = 1.5

/**
 * The page rotation the stroke is laid out for: `pageRot`, except that a wide quad on a page
 * rotated by 90/270 is ordinary content (baseline at the low-y edge, as on an upright page).
 */
export function markupLineRotation(
  pageRot: number,
  bounds: readonly [number, number, number, number],
): number {
  const rot = normRot(pageRot)
  if (rot % 180 === 0) return rot
  const [x1, y1, x2, y2] = bounds
  return x2 - x1 > (y2 - y1) * SIDEWAYS_RATIO ? 0 : rot
}
