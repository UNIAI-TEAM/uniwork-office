/**
 * G8-15 (UNI-1410): the server-comment anchor of a bound PDF (addendum §4.3,
 * contract-collab §4.1): `{format: 'pdf', v: 1, page, rect}`.
 *
 * Coordinate space of `rect` (the contract says "PDF points"; this module pins
 * it down): `[x0, y0, x1, y1]` in the page's PDF user space, in raw PDF units
 * (before /UserUnit), exactly the space of an annotation /Rect: the unrotated
 * page, origin at the user-space origin (the CropBox lower-left is wherever
 * the file puts it), y growing upwards, normalised so x0 <= x1 and y0 <= y1.
 * `/Rotate` and the zoom never change it, so the anchor stays valid when the
 * viewer rotates the page or the reader zooms. `page` is 1-based and counts
 * the pages of the version the anchor was written against.
 *
 * Pure: no React, no pdf.js, so the save path and the tests share it.
 */
import type { CollabAnchor } from '@genoffice/ui/collab'

export const PDF_ANCHOR_FORMAT = 'pdf'
export const PDF_ANCHOR_VERSION = 1

export type PdfRect = [number, number, number, number]

export interface PdfAnchor extends CollabAnchor {
  format: typeof PDF_ANCHOR_FORMAT
  v: typeof PDF_ANCHOR_VERSION
  /** 1-based page number in the anchored version */
  page: number
  rect: PdfRect
}

/** side of the square a point placement (the note tool click) anchors, in PDF points */
export const PDF_POINT_ANCHOR_SIZE = 24

/** two decimals keep the canonical JSON short and stable across float noise */
const round = (n: number): number => Math.round(n * 100) / 100

export function normalizeRect(rect: readonly number[]): PdfRect {
  const [a, b, c, d] = rect as [number, number, number, number]
  return [
    round(Math.min(a, c)),
    round(Math.min(b, d)),
    round(Math.max(a, c)),
    round(Math.max(b, d)),
  ]
}

/** a new anchor on 1-based `page`; `rect` in any corner order */
export function makePdfAnchor(page: number, rect: readonly number[]): PdfAnchor {
  return { format: PDF_ANCHOR_FORMAT, v: PDF_ANCHOR_VERSION, page, rect: normalizeRect(rect) }
}

/** the anchor of a point placement: a small square whose top-left corner sits on the point */
export function pointAnchorRect(at: readonly [number, number]): PdfRect {
  const [x, y] = at
  return normalizeRect([x, y - PDF_POINT_ANCHOR_SIZE, x + PDF_POINT_ANCHOR_SIZE, y])
}

/** a PDF anchor the server sent, or null when the shape is not one (another format, a bad page / rect) */
export function parsePdfAnchor(anchor: CollabAnchor | null | undefined): PdfAnchor | null {
  if (!anchor || anchor.format !== PDF_ANCHOR_FORMAT) return null
  const { page, rect } = anchor
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) return null
  if (!Array.isArray(rect) || rect.length !== 4) return null
  if (!rect.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  return makePdfAnchor(page, rect as number[])
}

/**
 * Sort key of the open list (spine S12: "pdf by page, then top-down"): the page
 * first, then the distance of the rect's top edge from the top of the page as
 * shown (`viewTop`, from the page geometry), so higher on the page sorts first.
 */
export function pdfAnchorOrder(anchor: PdfAnchor, viewTop: number): number {
  const top = Math.min(Math.max(Math.round(viewTop), 0), 999_999)
  return anchor.page * 1_000_000 + top
}

export interface AnchorRemapItem {
  commentId: string
  anchor: Record<string, unknown>
  state: 'exact' | 'lost'
}

/**
 * The `comments.anchors` items after a Save. `pageMap` maps a page index of the
 * file as it was open (0-based, before the save) to its index in the saved file;
 * a page missing from the map was deleted, so its comments become `lost` and keep
 * their old anchor (contract §2.6: "keep the old anchor when state=lost").
 * Comments already `lost` are not re-sent: nothing in the file can find them again.
 */
export function remapAnchorsAfterSave(
  roots: ReadonlyArray<{ id: string; anchor?: CollabAnchor | null; anchor_state?: string | null }>,
  pageMap: ReadonlyMap<number, number>,
): AnchorRemapItem[] {
  const out: AnchorRemapItem[] = []
  for (const root of roots) {
    if (root.anchor_state === 'lost') continue
    const anchor = parsePdfAnchor(root.anchor)
    if (!anchor) continue
    const next = pageMap.get(anchor.page - 1)
    if (next === undefined) {
      out.push({ commentId: root.id, anchor: { ...anchor }, state: 'lost' })
    } else {
      out.push({
        commentId: root.id,
        anchor: makePdfAnchor(next + 1, anchor.rect),
        state: 'exact',
      })
    }
  }
  return out
}

/** contract §2.6: at most 500 items per `PUT anchors` */
export const ANCHORS_PER_REQUEST = 500

export function chunkAnchors<T>(items: readonly T[], size = ANCHORS_PER_REQUEST): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
