import { useEffect, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { PracticeId } from '@uniwork/practice-core'
import { useI18n } from './locale'
import { MODULE_TONES } from './module-tones'
import { WbDeleteBtn, WbRowActions } from './WbRowActions'
import { WorkbenchIcon } from './WorkbenchIcons'
import { WorkStatePanel } from './WorkErrorState'
import { WorkToolbar, type WorkToolbarProps } from './WorkToolbar'
import {
  createStickyNote,
  normalizeStickyNote,
  readStickyNotes,
  writeStickyNotes,
  type WbStickyNote,
} from './workbench-pins'

/**
 * Notes: one row per note in a list block, stored on this device. The stored paper
 * color and board position (from the old pinboard) are kept in the data, unused.
 */
export function NotesPane({
  practiceId,
  head,
}: {
  practiceId: PracticeId
  /** the tab toolbar; its summary counts the notes */
  head: WorkToolbarProps
}): ReactElement {
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
      <WorkToolbar {...head} summary={t('wbNotesCount', { count: items.length })} local />
      <form className="wb-notes-add" onSubmit={add}>
        <input
          className="wb-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('wbNotesPlaceholder')}
          aria-label={t('wbNotesPlaceholder')}
        />
        <button type="submit" className="wb-btn wb-btn-primary" disabled={!draft.trim()}>
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
        <ul className="wb-block wb-notes-list">
          {items.map((note) => (
            <li key={note.id} className="wb-row wb-notes-card">
              <div className="wb-notes-text">
                <textarea
                  value={note.body}
                  rows={2}
                  aria-label={t('wbNotesBodyLabel')}
                  onChange={(e) => edit(note.id, e.target.value)}
                />
                <span className="wb-notes-edited wb-num">
                  {t('wbNotesEdited', {
                    time: new Date(note.updatedAt).toLocaleString(dateLocale, {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }),
                  })}
                </span>
              </div>
              <WbRowActions>
                <WbDeleteBtn
                  label={t('wbNotesDelete')}
                  onClick={() => persist(items.filter((n) => n.id !== note.id))}
                />
              </WbRowActions>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
