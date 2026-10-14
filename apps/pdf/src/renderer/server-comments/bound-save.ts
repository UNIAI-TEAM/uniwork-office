/**
 * G8-15 (UNI-1410), invariant 7 + addendum §4.3: a UniWork-bound PDF keeps its
 * comments on the server. The notes that came inside the file are read-only and
 * stay byte-identical on Save; no new note, reply, note rewrite or note deletion
 * is ever written into the file. The UI and the AI tools already route every
 * comment action of a bound document to the server panel; this is the last
 * gate on the save payload, so a note that slipped into the session state (a
 * draft restored from before the document was bound, a racing tool call) is
 * dropped instead of written.
 *
 * Markup annotations (highlight / underline / strike-out) and drawings are
 * document edits, not comments, and pass through unchanged. A local, unbound
 * file keeps today's behaviour: its payload is returned as is.
 */
import type { SavePdfRequest } from '../../shared/ipc'

type NotePayload = Pick<SavePdfRequest, 'drawings' | 'noteEdits' | 'annotDeletes'>

export function withoutFileNoteWrites<T extends NotePayload>(payload: T, bound: boolean): T {
  if (!bound) return payload
  return {
    ...payload,
    drawings: payload.drawings.filter((d) => d.kind !== 'note'),
    ...(payload.noteEdits !== undefined ? { noteEdits: [] } : {}),
    ...(payload.annotDeletes !== undefined
      ? { annotDeletes: payload.annotDeletes.filter((d) => d.subtype !== 'note') }
      : {}),
  }
}
