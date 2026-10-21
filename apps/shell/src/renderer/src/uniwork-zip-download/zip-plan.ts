// UNI-2068: what one bulk Download does with the selected rows, decided before anything is asked
// of main: which rows are sent (one plain file, or up to 100 into a zip) and which are left out
// with the reason the result lists (the web's `zipOf`, desktop rules D4, D5, D7, D10).
import type { ZipSkipReason } from '../../../shared/zip-download-api'
import type { DocListScreen } from '../doclist/columns'
import { rowCanDownload } from '../doclist/row-menu'
import type { DocumentsHomeDoc } from '../uniwork-home/documents-home-model'

/** the files one zip holds (the server refuses more than 100 ids) */
export const ZIP_MAX_FILES = 100

/**
 * One "title: reason" line of a result. The title comes from the selection (the server never
 * sends one); `failed` is the single-file download that did not go through.
 */
export interface ResultLine {
  documentId: string
  title: string
  reason: ZipSkipReason | 'failed'
}

/** a row left out of the run before anything was asked of main */
export interface PlannedSkip extends ResultLine {
  reason: ZipSkipReason
}

export type ZipPlan =
  | { mode: 'none'; skipped: PlannedSkip[] }
  | { mode: 'file'; doc: DocumentsHomeDoc; skipped: PlannedSkip[] }
  | { mode: 'zip'; docs: DocumentsHomeDoc[]; skipped: PlannedSkip[] }

export function planZipDownload(input: {
  docs: readonly DocumentsHomeDoc[]
  workspaceId: string
  screen: DocListScreen
}): ZipPlan {
  const { docs, workspaceId, screen } = input
  const skipped: PlannedSkip[] = []
  const skip = (doc: DocumentsHomeDoc, reason: ZipSkipReason) =>
    skipped.push({ documentId: doc.id, title: doc.title, reason })

  const sendable: DocumentsHomeDoc[] = []
  for (const doc of docs) {
    // the job belongs to one workspace: another workspace's id would only come back not_found
    if (doc.workspaceId && doc.workspaceId !== workspaceId) skip(doc, 'other_workspace')
    else if (!rowCanDownload(screen, doc)) skip(doc, 'not_a_file')
    else sendable.push(doc)
  }

  if (sendable.length === 0) return { mode: 'none', skipped }
  if (sendable.length === 1) return { mode: 'file', doc: sendable[0]!, skipped }
  for (const doc of sendable.slice(ZIP_MAX_FILES)) skip(doc, 'zip_limit')
  return { mode: 'zip', docs: sendable.slice(0, ZIP_MAX_FILES), skipped }
}
