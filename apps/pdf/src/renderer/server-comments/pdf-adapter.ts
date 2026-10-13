/**
 * G8-15 (UNI-1410): the kit's `CollabAnchorAdapter` for the PDF viewer.
 *
 * The open file is the version the anchors were re-sent against (or the head
 * the server holds), so anchor page N is the open file's page index N-1. A page
 * deleted in this session but not saved yet cannot be located (the thread reads
 * "position may have changed" until the Save turns it `lost`); a page moved by
 * an unsaved reorder is still found, at its new place in the view.
 */
import type { CollabAnchor, CollabAnchorAdapter } from '@genoffice/ui/collab'
import { parsePdfAnchor, pdfAnchorOrder, type PdfRect } from './pdf-anchor'

export interface PdfAdapterDeps {
  /** pages in the open file */
  pageCount: number
  /** the page (0-based index in the open file) is still in the document as shown */
  isShown(origIdx: number): boolean
  /** distance of the rect's top edge from the top of the page as shown, in points */
  viewTop(origIdx: number, rect: PdfRect): number
  /** scroll the page into view and frame the rect (never moves keyboard focus) */
  goTo(origIdx: number, rect: PdfRect): void
}

/** where an anchor lands in the open file, or null when it cannot be shown */
export function locatePdfAnchor(
  anchor: CollabAnchor,
  deps: Pick<PdfAdapterDeps, 'pageCount' | 'isShown'>,
): { origIdx: number; rect: PdfRect } | null {
  const a = parsePdfAnchor(anchor)
  if (!a) return null
  const origIdx = a.page - 1
  if (origIdx >= deps.pageCount || !deps.isShown(origIdx)) return null
  return { origIdx, rect: a.rect }
}

export function createPdfAnchorAdapter(deps: PdfAdapterDeps): CollabAnchorAdapter {
  return {
    order(anchor) {
      const a = parsePdfAnchor(anchor)
      if (!a) return Number.MAX_SAFE_INTEGER
      const origIdx = a.page - 1
      const top = origIdx < deps.pageCount ? deps.viewTop(origIdx, a.rect) : 0
      return pdfAnchorOrder(a, top)
    },
    locate: (anchor) => locatePdfAnchor(anchor, deps) !== null,
    goTo(anchor) {
      const at = locatePdfAnchor(anchor, deps)
      if (at) deps.goTo(at.origIdx, at.rect)
    },
  }
}
