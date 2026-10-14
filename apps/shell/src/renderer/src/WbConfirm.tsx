import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'

/**
 * A light in-app confirmation (redesign spec 2.3): a title, one line, Cancel
 * (ghost) and the confirm button (primary or danger). It opens next to the
 * control that was focused when it appeared (centred when there is none),
 * focuses Cancel, closes on Escape or a click outside, and gives focus back:
 * to the opener, or when the answer disabled or removed it, to `returnFocus`
 * (else the nearest `tabindex="-1"` container of the opener).
 */
export function WbConfirm({
  title,
  body,
  confirmLabel,
  cancelLabel,
  tone = 'primary',
  onConfirm,
  onCancel,
  returnFocus,
}: {
  title: string
  body?: string
  confirmLabel: string
  cancelLabel: string
  tone?: 'primary' | 'danger'
  onConfirm: () => void
  onCancel: () => void
  /** where focus lands when the opener can no longer take it (a busy, disabled button; a deleted row) */
  returnFocus?: () => HTMLElement | null
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // the control that opened it: the anchor, and where focus goes back
  const [opener] = useState(() =>
    document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null,
  )
  const [pos, setPos] = useState<CSSProperties>({})
  const titleId = useId()
  const bodyId = useId()
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel
  const returnFocusRef = useRef(returnFocus)
  returnFocusRef.current = returnFocus

  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    const w = box.offsetWidth
    const h = box.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const a = opener?.isConnected ? opener.getBoundingClientRect() : null
    if (!a || (a.width === 0 && a.height === 0)) {
      setPos({ left: Math.max(8, (vw - w) / 2), top: Math.max(8, vh / 3 - h / 2) })
      return
    }
    const left = Math.min(Math.max(8, a.right - w), vw - w - 8)
    const below = a.bottom + 6
    const top = below + h <= vh - 8 ? below : Math.max(8, a.top - h - 6)
    setPos({ left, top })
  }, [opener])

  useEffect(() => {
    cancelRef.current?.focus()
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onCancelRef.current()
    }
    document.addEventListener('mousedown', onDoc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      // runs after the answer's re-render: a confirmed action may have disabled or removed the opener
      const back =
        opener?.isConnected && !opener.matches(':disabled')
          ? opener
          : (returnFocusRef.current?.() ?? opener?.closest<HTMLElement>('[tabindex="-1"]'))
      back?.focus()
    }
  }, [opener])

  return (
    <div
      ref={ref}
      className="wb-confirm"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={body ? bodyId : undefined}
      style={pos}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <p className="wb-confirm-title" id={titleId}>
        {title}
      </p>
      {body ? (
        <p className="wb-confirm-body" id={bodyId}>
          {body}
        </p>
      ) : null}
      <div className="wb-confirm-actions">
        <button ref={cancelRef} type="button" className="wb-btn wb-btn-ghost" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" className={`wb-btn wb-btn-${tone}`} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </div>
  )
}
