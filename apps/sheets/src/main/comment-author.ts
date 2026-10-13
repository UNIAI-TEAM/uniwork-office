import { uniworkCommentAuthor } from './uniwork-policy'

/** The session fields that name the file the user knows a workbook as. */
export interface SessionDocumentFields {
  readonly path: string
  readonly suggestSaveAs?: string
  readonly csvSourcePath?: string
  readonly restoreTarget?: string
}

/**
 * UniWork seam: the file the user knows this workbook session as — none yet for
 * an unsaved new workbook or a converted import, whose first save is a Save As.
 * A CSV session is its original .csv, a restored recovery copy its original.
 */
export function sessionDocumentPath(session: SessionDocumentFields): string | null {
  return session.suggestSaveAs !== undefined
    ? null
    : (session.csvSourcePath ?? session.restoreTarget ?? session.path)
}

/**
 * G8-02: the author written into new threaded comments of the workbook session
 * `sessionId` names in this tab. The session follows Save As / reopen / CSV
 * import (each swaps it), so the answer is always about the file the renderer
 * has open; an unknown or missing session means nothing to comment on and
 * answers the neutral constant. Never the OS account name.
 */
export function workbookCommentAuthor(
  sessions: ReadonlyMap<string, SessionDocumentFields>,
  sessionId: unknown,
): string {
  const session = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined
  return uniworkCommentAuthor(session ? sessionDocumentPath(session) : null)
}
