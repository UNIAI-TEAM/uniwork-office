import type { WebContents } from 'electron'

type PdfFlush = (contents: WebContents, options?: { explicit?: boolean }) => Promise<boolean>

/**
 * Write a PDF tab's pending edits to disk before an app-internal step (the Word,
 * PowerPoint and Excel exports). It is never the user's explicit Save of that
 * file, so a UniWork-bound PDF must not turn it into a save intent: the flush
 * is marked `{ explicit: false }`, which keeps the UniWork user-save hook quiet.
 * Only the File > Save menu item calls `flushPdfSave` without this marker.
 */
export function flushPdfForExport(flush: PdfFlush, contents: WebContents): Promise<boolean> {
  return flush(contents, { explicit: false })
}
