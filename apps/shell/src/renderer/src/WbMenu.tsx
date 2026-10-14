import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement, ReactNode, RefObject } from 'react'

const ITEMS = '[role="menuitem"]:not(:disabled)'

/**
 * The one Workbench menu (redesign spec 2.3): + New, + tab, + skill domain.
 * The parent owns `open` and the trigger; the menu focuses its first item,
 * moves with ↑/↓/Home/End, closes on Escape, Tab or a click outside, gives
 * focus back to the trigger, opens upwards when there is no room below, and
 * grows towards the wider side of the window.
 * Render it inside a `position: relative` wrapper next to the trigger.
 */
export function WbMenu({
  open,
  onClose,
  anchorRef,
  label,
  className,
  children,
}: {
  open: boolean
  onClose: () => void
  /** the trigger: focus returns here, and a click on it is not "outside" */
  anchorRef: RefObject<HTMLElement | null>
  label?: string
  className?: string
  children: ReactNode
}): ReactElement | null {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState({ up: false, end: false })
  // a ref, so an inline onClose never re-runs the open effect
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useLayoutEffect(() => {
    const menu = ref.current
    const anchor = anchorRef.current
    if (!open || !menu || !anchor) return
    const a = anchor.getBoundingClientRect()
    const below = window.innerHeight - a.bottom
    setPlace({
      up: menu.offsetHeight + 8 > below && a.top > below,
      // a trigger in the right half opens leftwards, so the menu stays in the window
      end: a.left + a.width / 2 > window.innerWidth / 2,
    })
  }, [open, anchorRef])

  useEffect(() => {
    if (!open) return
    const menu = ref.current
    const anchor = anchorRef.current
    menu?.querySelector<HTMLElement>(ITEMS)?.focus()
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (menu?.contains(t) || anchor?.contains(t)) return
      closeRef.current()
    }
    document.addEventListener('mousedown', onDoc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      // the focused item is gone with the menu: give focus back unless it moved elsewhere
      const now = document.activeElement
      if (!now || now === document.body || menu?.contains(now)) anchor?.focus()
    }
  }, [open, anchorRef])

  if (!open) return null

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])
    const at = items.indexOf(document.activeElement as HTMLElement)
    const go = (i: number) => {
      e.preventDefault()
      items[(i + items.length) % items.length]?.focus()
    }
    if (e.key === 'ArrowDown') go(at + 1)
    else if (e.key === 'ArrowUp') go(at < 0 ? -1 : at - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(-1)
    else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Tab') onClose()
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className={`wb-menu ${place.end ? 'is-end' : 'is-start'}${place.up ? ' is-up' : ''}${
        className ? ` ${className}` : ''
      }`}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  )
}

/** one menu entry; `onSelect` runs after the menu asked to close */
export function WbMenuItem({
  onSelect,
  icon,
  title,
  hint,
  disabled,
  danger,
  children,
}: {
  onSelect: () => void
  icon?: ReactNode
  title?: string
  hint?: string
  disabled?: boolean
  danger?: boolean
  children: ReactNode
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={`wb-menu-item${danger ? ' is-danger' : ''}`}
      title={title}
      disabled={disabled}
      onClick={onSelect}
    >
      {icon ? <span className="wb-menu-icon">{icon}</span> : null}
      <span className="wb-menu-text">
        <span className="wb-menu-label">{children}</span>
        {hint ? <span className="wb-menu-hint">{hint}</span> : null}
      </span>
    </button>
  )
}

/** a group caption or an empty line: presentational, never a menu stop */
export function WbMenuLabel({ children }: { children: ReactNode }): ReactElement {
  return (
    <div role="presentation" className="wb-menu-label-row">
      {children}
    </div>
  )
}
