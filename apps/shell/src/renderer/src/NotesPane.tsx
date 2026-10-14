import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import type { PracticeId } from '@uniwork/practice-core'
import { useI18n } from './locale'
import { MODULE_TONES } from './module-tones'
import { editedWhen } from './work-home'
import { WbIconBtn } from './WbRowActions'
import { useWbToast } from './WbToastHost'
import { WbGlyph, WorkbenchIcon } from './WorkbenchIcons'
import { WorkStatePanel } from './WorkErrorState'
import { WorkToolbar, type WorkToolbarProps } from './WorkToolbar'
import {
  createStickyNote,
  normalizeStickyNote,
  readStickyNotes,
  WB_NOTES_CHANGED,
  writeStickyNotes,
  type WbStickyNote,
} from './workbench-pins'

const IS_MAC = navigator.platform.toLowerCase().includes('mac')

/**
 * Notes (spec 4.5): a composer card, then the notes as cards in columns, stored on this device.
 * A note is edited in place and saved as you type. The stored paper color and board position
 * (from the old pinboard) are kept in the data, unused.
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
  const toasts = useWbToast()
  const [items, setItems] = useState<WbStickyNote[]>(() => readStickyNotes(practiceId))
  const [draft, setDraft] = useState('')
  const wallRef = useRef<HTMLUListElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  // a deleted card took the focus with it: land on the wall (or the composer) after the render
  const refocus = useRef(false)

  useEffect(() => {
    setItems(readStickyNotes(practiceId))
    setDraft('')
  }, [practiceId])

  // follow storage (an Undo from an earlier mount, an agent write); the note being typed in keeps its text
  useEffect(() => {
    const sync = () =>
      setItems((cur) => {
        const focused = document.activeElement
          ?.closest('[data-note-id]')
          ?.getAttribute('data-note-id')
        const mine = cur.find((n) => n.id === focused)
        return readStickyNotes(practiceId).map((n) => (n.id === mine?.id ? mine : n))
      })
    window.addEventListener(WB_NOTES_CHANGED, sync)
    return () => window.removeEventListener(WB_NOTES_CHANGED, sync)
  }, [practiceId])

  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    ;(wallRef.current ?? composerRef.current)?.focus()
  }, [items])

  const persist = (next: WbStickyNote[]) => {
    setItems(next)
    writeStickyNotes(practiceId, next)
  }

  const add = (e?: FormEvent) => {
    e?.preventDefault()
    const body = draft.trim()
    if (!body) return
    createStickyNote(practiceId, body)
    setItems(readStickyNotes(practiceId))
    setDraft('')
  }

  // every write starts from storage, never this render's list, so a stale pane cannot drop notes
  const edit = (id: string, body: string) =>
    persist(
      readStickyNotes(practiceId).map((n) =>
        n.id === id ? normalizeStickyNote({ ...n, body, updatedAt: new Date().toISOString() }) : n,
      ),
    )

  const copy = (note: WbStickyNote) =>
    void navigator.clipboard.writeText(note.body).then(
      () => toasts.show({ id: 'notes-copy', message: { key: 'wbNotesCopied' } }),
      // clipboard denied: no toast rather than claim success
      () => undefined,
    )

  // removed at once, with Undo in the toast (spec 5.3); Undo puts it back where it was
  const remove = (note: WbStickyNote) => {
    const stored = readStickyNotes(practiceId)
    const at = stored.findIndex((n) => n.id === note.id)
    refocus.current = true
    persist(stored.filter((n) => n.id !== note.id))
    toasts.show({
      id: `notes-delete:${note.id}`,
      message: { key: 'wbNotesDeleted' },
      actions: [
        {
          label: 'wbCommonUndo',
          onClick: () => {
            // the stored list, not this render's: other edits may have landed since
            const now = readStickyNotes(practiceId).filter((n) => n.id !== note.id)
            now.splice(Math.min(at, now.length), 0, note)
            persist(now)
          },
        },
      ],
    })
  }

  return (
    <div className="wb-notes">
      <WorkToolbar
        {...head}
        summary={<strong>{t('wbNotesCount', { count: items.length })}</strong>}
        local
      />
      <form className="wb-block wb-notes-composer" onSubmit={add}>
        <textarea
          ref={composerRef}
          value={draft}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          // ⌘/Ctrl+Enter saves; Enter alone is a new line
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add(e)
          }}
          placeholder={t('wbNotesPlaceholder')}
          aria-label={t('wbNotesNew')}
          aria-keyshortcuts={IS_MAC ? 'Meta+Enter' : 'Control+Enter'}
        />
        <div className="wb-notes-composer-foot">
          <span className="wb-row-sub">
            <kbd className="wb-kbd">{IS_MAC ? '⌘' : 'Ctrl'}</kbd> <kbd className="wb-kbd">↵</kbd>{' '}
            {t('wbNotesSaveHint')}
          </span>
          <button
            type="submit"
            className="wb-btn wb-btn-primary wb-btn-sm"
            disabled={!draft.trim()}
          >
            {t('wbNotesAdd')}
          </button>
        </div>
      </form>
      {items.length === 0 ? (
        <WorkStatePanel
          tone={MODULE_TONES.notes}
          icon={<WorkbenchIcon id="notes" size={20} />}
          title={t('wbNotesEmpty')}
        />
      ) : (
        <ul
          ref={wallRef}
          className="wb-notes-wall"
          tabIndex={-1}
          aria-label={t('wbNotesCount', { count: items.length })}
        >
          {items.map((note) => {
            const when = editedWhen(note.updatedAt, dateLocale)
            return (
              <li key={note.id} className="wb-block wb-note" data-note-id={note.id}>
                <textarea
                  value={note.body}
                  rows={1}
                  aria-label={t('wbNotesBodyLabel')}
                  onChange={(e) => edit(note.id, e.target.value)}
                />
                <div className="wb-note-foot">
                  <span className="wb-row-sub wb-num">{t(when.key, when.params)}</span>
                  <span className="wb-note-actions">
                    <WbIconBtn label={t('wbNotesCopy')} onClick={() => copy(note)}>
                      <WbGlyph id="copy" />
                    </WbIconBtn>
                    <WbIconBtn label={t('wbNotesDelete')} onClick={() => remove(note)}>
                      <WbGlyph id="trash" />
                    </WbIconBtn>
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
