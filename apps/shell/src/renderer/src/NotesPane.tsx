import { useEffect, useId, useRef, useState } from 'react'
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

/** the composer's unsaved text per practice: it outlives a tab switch, not the app */
const composerDrafts = new Map<PracticeId, string>()

/** typing in a note writes the whole list over IPC: once per pause, not per keystroke */
export const NOTE_WRITE_DELAY_MS = 300

/**
 * Notes (spec 4.5): a composer card, then the notes as cards in columns, stored on this device.
 * A note is edited in place and saved as you type (one write per pause in typing, and at once on
 * blur, unmount or window close). The stored paper color and board position
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
  const [draft, setDraftState] = useState(() => composerDrafts.get(practiceId) ?? '')
  const setDraft = (text: string) => {
    if (text) composerDrafts.set(practiceId, text)
    else composerDrafts.delete(practiceId)
    setDraftState(text)
  }
  const ids = useId()
  const wallRef = useRef<HTMLUListElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  // a deleted card took the focus with it: land on the wall (or the composer) after the render
  const refocus = useRef(false)
  // the typed text not yet written, and the timer that writes it
  const pending = useRef<{ id: string; body: string; at: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // every write starts from storage, never this render's list, so a stale pane cannot drop notes
  const flush = () => {
    clearTimeout(timer.current)
    const p = pending.current
    if (!p) return
    pending.current = null
    writeStickyNotes(
      practiceId,
      readStickyNotes(practiceId).map((n) =>
        n.id === p.id ? normalizeStickyNote({ ...n, body: p.body, updatedAt: p.at }) : n,
      ),
    )
  }
  const flushRef = useRef(flush)
  flushRef.current = flush

  // nothing typed is lost: leaving the tab, switching practice or closing the window writes it
  useEffect(() => {
    const onUnload = () => flushRef.current()
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      flushRef.current()
    }
  }, [practiceId])

  useEffect(() => {
    setItems(readStickyNotes(practiceId))
    setDraftState(composerDrafts.get(practiceId) ?? '')
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
    flush()
    setItems(next)
    writeStickyNotes(practiceId, next)
  }

  const add = (e?: FormEvent) => {
    e?.preventDefault()
    const body = draft.trim()
    if (!body) return
    flush()
    createStickyNote(practiceId, body)
    setItems(readStickyNotes(practiceId))
    setDraft('')
    // a clicked Save goes disabled with the empty draft: keep the focus in the composer
    composerRef.current?.focus()
  }

  // shown at once, written after a pause (another note's pending text is written first)
  const edit = (id: string, body: string) => {
    if (pending.current && pending.current.id !== id) flush()
    const at = new Date().toISOString()
    pending.current = { id, body, at }
    setItems((cur) => cur.map((n) => (n.id === id ? { ...n, body, updatedAt: at } : n)))
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, NOTE_WRITE_DELAY_MS)
  }

  const copy = (note: WbStickyNote) =>
    void navigator.clipboard.writeText(note.body).then(
      () => toasts.show({ id: 'notes-copy', message: { key: 'wbNotesCopied' } }),
      // clipboard denied: say so rather than claim success
      () => toasts.show({ id: 'notes-copy', tone: 'alert', message: { key: 'wbNotesCopyFailed' } }),
    )

  // removed at once, with Undo in the toast (spec 5.3); Undo puts it back where it was
  const remove = (note: WbStickyNote) => {
    flush()
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
            // mid-composition (Telex, IME) the Enter belongs to the IME: saving now leaves a fragment
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
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
          {items.map((note, i) => {
            const when = editedWhen(note.updatedAt, dateLocale)
            const bodyId = `${ids}-note-${i}`
            return (
              <li key={note.id} className="wb-block wb-note" data-note-id={note.id}>
                <textarea
                  id={bodyId}
                  value={note.body}
                  rows={1}
                  // each note its own name in a screen reader's list of fields
                  aria-label={t('wbNotesBodyLabel', { n: i + 1 })}
                  onChange={(e) => edit(note.id, e.target.value)}
                  onBlur={flush}
                />
                <div className="wb-note-foot">
                  <span className="wb-row-sub wb-num">{t(when.key, when.params)}</span>
                  <span className="wb-note-actions">
                    {/* described by the note's name ("Note 2"): one card's buttons from another's */}
                    <WbIconBtn
                      label={t('wbNotesCopy')}
                      aria-describedby={bodyId}
                      onClick={() => copy(note)}
                    >
                      <WbGlyph id="copy" />
                    </WbIconBtn>
                    <WbIconBtn
                      label={t('wbNotesDelete')}
                      aria-describedby={bodyId}
                      onClick={() => remove(note)}
                    >
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
