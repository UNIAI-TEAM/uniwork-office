import type { SavePdfRequest } from '../shared/ipc'

/** Whether a save request carries any edit to apply (staticFormFills is the complete
 * resulting set, sent on every save, so it does not count as pending on its own). */
export function hasPendingSaveEdits(request: SavePdfRequest): boolean {
  return !!(
    request.markups?.length ||
    request.annotDeletes?.length ||
    request.drawings?.length ||
    request.noteEdits?.length ||
    request.formValues?.length ||
    request.stamps?.length ||
    request.textEdits?.length ||
    request.textInserts?.length ||
    request.imageEdits?.length ||
    request.redactions !== undefined ||
    request.rotations?.length ||
    request.deletedPages?.length ||
    request.pageOrder?.length ||
    request.metadata ||
    // an empty tree is a deliberate "no bookmarks", which is still a write
    request.outline !== undefined ||
    request.attachments?.add?.length ||
    request.attachments?.remove?.length
  )
}
