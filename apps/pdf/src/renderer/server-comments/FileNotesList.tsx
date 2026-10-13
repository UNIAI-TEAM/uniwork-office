/**
 * G8-15 (UNI-1410): the "Comments in the file" section of the S12 panel for a
 * bound PDF: the note threads saved inside the file, read-only (no reply, edit,
 * delete or resolve; the file keeps them byte for byte). The author is the one
 * stored in the file, with the neutral constant shown in the UI language (G8-02).
 */
import { format, type Lang } from '@genoffice/i18n'
import { displayCommentAuthor } from '../comment-author'
import { flattenThread, type NoteThreadItem } from '../note-threads'

export interface FileNoteThread {
  /** 0-based page index in the open file */
  origIdx: number
  root: NoteThreadItem
}

export interface FileNotesListProps {
  threads: readonly FileNoteThread[]
  lang: Lang
  /** `collabAnchorPage` of the collab strings ("Page {page}") */
  pageLabel: string
  /** the neutral author label (G8-02 `noteNeutralAuthor`) */
  neutralAuthor: string
  /** show the thread on its page */
  onShow(thread: FileNoteThread): void
}

function pageNumber(n: number, lang: Lang): string {
  try {
    return new Intl.NumberFormat(lang).format(n)
  } catch {
    return String(n)
  }
}

export function FileNotesList(p: FileNotesListProps) {
  return (
    <ul className="pdf-file-notes">
      {p.threads.map((th) => {
        const label = format(p.pageLabel, { page: pageNumber(th.origIdx + 1, p.lang) })
        return (
          <li key={`${th.origIdx}:${th.root.key}`} className="pdf-file-note">
            <button type="button" className="pdf-file-note-page" onClick={() => p.onShow(th)}>
              {label}
            </button>
            {flattenThread(th.root).map(({ item, depth }) => (
              <div
                key={item.key}
                className={`pdf-file-note-item${depth > 0 ? ' pdf-file-note-reply' : ''}`}
              >
                <span className="pdf-file-note-author">
                  {displayCommentAuthor(item.author, p.neutralAuthor)}
                </span>
                <span className="pdf-file-note-text">{item.contents}</span>
              </div>
            ))}
          </li>
        )
      })}
    </ul>
  )
}
