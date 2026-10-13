import { useEffect, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { PracticeId } from '@uniwork/practice-core'
import { useI18n } from './locale'
import { MODULE_TONES } from './module-tones'
import { WorkStatePanel } from './WorkErrorState'
import { WorkbenchIcon } from './WorkbenchIcons'
import {
  createStickyNote,
  normalizeStickyNote,
  readStickyNotes,
  writeStickyNotes,
  type WbStickyNote,
} from './workbench-pins'

/**
 * Notes: a flat list of cards, stored on this device. The stored paper color
 * and board position (from the old pinboard) are kept in the data, unused.
 */
export function NotesPane({ practiceId }: { practiceId: PracticeId }): ReactElement {
  const { t, dateLocale } = useI18n()
  const [items, setItems] = useState<WbStickyNote[]>(() => readStickyNotes(practiceId))
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setItems(readStickyNotes(practiceId))
    setDraft('')
  }, [practiceId])

  const persist = (next: WbStickyNote[]) => {
    setItems(next)
    writeStickyNotes(practiceId, next)
  }

  const add = (e: FormEvent) => {
    e.preventDefault()
    const body = draft.trim()
    if (!body) return
    createStickyNote(practiceId, body)
    setItems(readStickyNotes(practiceId))
    setDraft('')
  }

  const edit = (id: string, body: string) =>
    persist(
      items.map((n) =>
        n.id === id ? normalizeStickyNote({ ...n, body, updatedAt: new Date().toISOString() }) : n,
      ),
    )

  return (
    <div className="wb-notes">
      <form className="wb-notes-add" onSubmit={add}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('wbNotesPlaceholder')}
          aria-label={t('wbNotesPlaceholder')}
        />
        <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>
          {t('wbNotesAdd')}
        </button>
      </form>
      {items.length === 0 ? (
        <WorkStatePanel
          tone={MODULE_TONES.notes}
          icon={<WorkbenchIcon id="notes" size={20} />}
          title={t('wbNotesEmpty')}
        />
      ) : (
        <ul className="wb-notes-list">
          {items.map((note) => (
            <li key={note.id} className="wb-notes-card">
              <textarea
                value={note.body}
                rows={3}
                aria-label={t('wbNotesBodyLabel')}
                onChange={(e) => edit(note.id, e.target.value)}
              />
              <footer>
                <span>
                  {t('wbNotesEdited', {
                    time: new Date(note.updatedAt).toLocaleString(dateLocale, {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }),
                  })}
                </span>
                <button
                  type="button"
                  className="wb-notes-delete"
                  onClick={() => persist(items.filter((n) => n.id !== note.id))}
                >
                  {t('wbNotesDelete')}
                </button>
              </footer>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
