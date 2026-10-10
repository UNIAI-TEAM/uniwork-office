/**
 * The text of an on-canvas text box that is still in edit mode. It lives in the editor's DOM
 * until the box commits (blur / Escape), so the session cannot see it; the web frame's draft
 * copy reads it through here and folds it into a throwaway copy of the deck, without ending
 * the edit.
 */
import type { EditParagraph } from '../shared/ipc'

export interface PendingTextEdit {
  slideIndex: number
  sourceId: string
  groupId?: string
  paragraphs: EditParagraph[]
}

let probe: (() => PendingTextEdit | null) | null = null

/** registered by the renderer while a text box is being edited; null when the edit ends */
export function setPendingTextEditProbe(next: (() => PendingTextEdit | null) | null): void {
  probe = next
}

/** the uncommitted edit of the open text box, or null (none open, or unchanged) */
export function readPendingTextEdit(): PendingTextEdit | null {
  return probe?.() ?? null
}
