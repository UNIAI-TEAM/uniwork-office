import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import type { PracticeId } from '@uniwork/practice-core'
import {
  createStickyNote,
  normalizeStickyNote,
  readStickyNotes,
  STICKY_COLORS,
  writeStickyNotes,
  type WbStickyColor,
  type WbStickyNote,
} from './workbench-pins'

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

interface DragState {
  id: string
  startX: number
  startY: number
  originLeft: number
  originTop: number
  boardW: number
  boardH: number
}

export function NotesPane({ practiceId, vi }: { practiceId: PracticeId; vi: boolean }): ReactElement {
  const label = (a: string, b: string) => (vi ? a : b)
  const boardRef = useRef<HTMLDivElement>(null)
  const [items, setItems] = useState<WbStickyNote[]>(() => readStickyNotes(practiceId))
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [pickColor, setPickColor] = useState<WbStickyColor>('yellow')
  const dragRef = useRef<DragState | null>(null)

  useEffect(() => {
    setItems(readStickyNotes(practiceId))
    setActiveId(null)
    setDraft('')
  }, [practiceId])

  const persist = (next: WbStickyNote[]) => {
    const normalized = next.map((n) => normalizeStickyNote(n))
    setItems(normalized)
    writeStickyNotes(practiceId, normalized)
  }

  const bringFront = (id: string) => {
    const maxZ = items.reduce((m, n) => Math.max(m, n.z), 0)
    persist(items.map((n) => (n.id === id ? { ...n, z: maxZ + 1, updatedAt: new Date().toISOString() } : n)))
    setActiveId(id)
  }

  const addNote = (body = '') => {
    const text = body.trim() || draft.trim()
    const note = createStickyNote(practiceId, text, pickColor)
    setItems(readStickyNotes(practiceId))
    setDraft('')
    setActiveId(note.id)
    setPickColor(STICKY_COLORS[(STICKY_COLORS.indexOf(pickColor) + 1) % STICKY_COLORS.length])
  }

  const updateNote = (id: string, patch: Partial<WbStickyNote>) => {
    persist(
      items.map((n) =>
        n.id === id
          ? normalizeStickyNote({ ...n, ...patch, updatedAt: new Date().toISOString() })
          : n,
      ),
    )
  }

  const removeNote = (id: string) => {
    persist(items.filter((n) => n.id !== id))
    if (activeId === id) setActiveId(null)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>, note: WbStickyNote) => {
    if ((e.target as HTMLElement).closest('textarea,button,input')) return
    const board = boardRef.current
    if (!board) return
    const rect = board.getBoundingClientRect()
    bringFront(note.id)
    dragRef.current = {
      id: note.id,
      startX: e.clientX,
      startY: e.clientY,
      originLeft: (note.x / 100) * rect.width,
      originTop: (note.y / 100) * rect.height,
      boardW: rect.width,
      boardH: rect.height,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    const left = Math.max(0, Math.min(drag.boardW - 40, drag.originLeft + dx))
    const top = Math.max(0, Math.min(drag.boardH - 40, drag.originTop + dy))
    const x = (left / drag.boardW) * 100
    const y = (top / drag.boardH) * 100
    setItems((prev) => prev.map((n) => (n.id === drag.id ? { ...n, x, y } : n)))
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    setItems((prev) => {
      const next = prev.map((n) =>
        n.id === drag.id ? normalizeStickyNote({ ...n, updatedAt: new Date().toISOString() }) : n,
      )
      writeStickyNotes(practiceId, next)
      return next
    })
  }

  return (
    <div className="wb-notes-root">
      <header className="wb-notes-toolbar">
        <div className="wb-notes-toolbar-copy">
          <strong>{label('Bảng ghi chú', 'Sticky board')}</strong>
          <p>
            {label(
              'Ghim giấy note lên bảng — kéo thả, đổi màu, lưu trên máy.',
              'Pin sticky notes on the board — drag, recolor, stored on device.',
            )}
          </p>
        </div>
        <div className="wb-notes-toolbar-actions">
          <div className="wb-notes-swatches" role="group" aria-label={label('Màu giấy', 'Paper color')}>
            {STICKY_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`wb-notes-swatch is-${c}${pickColor === c ? ' is-active' : ''}`}
                aria-label={c}
                aria-pressed={pickColor === c}
                onClick={() => setPickColor(c)}
              />
            ))}
          </div>
          <div className="wb-notes-compose">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={label('Viết note mới… Enter để ghim', 'Write a note… Enter to pin')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addNote()
              }}
            />
            <button type="button" className="btn btn-primary" onClick={() => addNote()}>
              {label('Ghim note', 'Pin note')}
            </button>
          </div>
        </div>
      </header>

      <div
        ref={boardRef}
        className="wb-notes-board"
        aria-label={label('Bảng ghim ghi chú', 'Sticky notes board')}
      >
        <div className="wb-notes-board-grain" aria-hidden="true" />
        {items.length === 0 ? (
          <div className="wb-notes-empty">
            <div className="wb-notes-empty-pin" aria-hidden="true">
              <i />
            </div>
            <p>
              {label(
                'Bảng còn trống — ghim note đầu tiên của bạn.',
                'Empty board — pin your first sticky note.',
              )}
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                addNote(
                  vi
                    ? 'Ghi chú nhanh của tôi…'
                    : 'My quick sticky note…',
                )
              }
            >
              {label('Ghim note mẫu', 'Pin a sample')}
            </button>
          </div>
        ) : null}

        {items.map((note) => (
          <article
            key={note.id}
            className={`wb-sticky is-${note.color}${activeId === note.id ? ' is-active' : ''}`}
            style={{
              left: `${note.x}%`,
              top: `${note.y}%`,
              zIndex: note.z,
              transform: `rotate(${note.rotate}deg)`,
            }}
            onPointerDown={(e) => onPointerDown(e, note)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onFocus={() => setActiveId(note.id)}
          >
            <div className="wb-sticky-pin" aria-hidden="true">
              <i />
            </div>
            <textarea
              value={note.body}
              rows={6}
              placeholder={label('Viết gì đó…', 'Write something…')}
              onChange={(e) => updateNote(note.id, { body: e.target.value })}
              onFocus={() => bringFront(note.id)}
            />
            <footer className="wb-sticky-foot">
              <div className="wb-notes-swatches is-compact" role="group">
                {STICKY_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`wb-notes-swatch is-${c}${note.color === c ? ' is-active' : ''}`}
                    aria-label={c}
                    onClick={() => updateNote(note.id, { color: c })}
                  />
                ))}
              </div>
              <button
                type="button"
                className="wb-sticky-del"
                aria-label={label('Gỡ note', 'Remove note')}
                onClick={() => removeNote(note.id)}
              >
                ×
              </button>
            </footer>
          </article>
        ))}

        <button
          type="button"
          className="wb-notes-fab"
          onClick={() => {
            const note = normalizeStickyNote({
              id: newId(),
              body: '',
              color: pickColor,
              x: 20 + Math.random() * 40,
              y: 18 + Math.random() * 35,
              rotate: (Math.random() - 0.5) * 6,
              z: items.reduce((m, n) => Math.max(m, n.z), 0) + 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
            persist([note, ...items])
            setActiveId(note.id)
            setPickColor(STICKY_COLORS[(STICKY_COLORS.indexOf(pickColor) + 1) % STICKY_COLORS.length])
          }}
        >
          + {label('Note mới', 'New note')}
        </button>
      </div>
    </div>
  )
}
