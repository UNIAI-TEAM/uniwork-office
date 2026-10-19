import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement, ReactNode, RefObject } from 'react'
import { WbGlyph } from './WorkbenchIcons'

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
    // a menu with nothing to choose (only its caption) takes the focus itself, so Escape still closes it
    ;(menu?.querySelector<HTMLElement>(ITEMS) ?? menu)?.focus()
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
      tabIndex={-1}
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
  expanded,
  controls,
  children,
}: {
  onSelect: () => void
  icon?: ReactNode
  title?: string
  hint?: string
  disabled?: boolean
  danger?: boolean
  expanded?: boolean
  controls?: string
  children: ReactNode
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={`wb-menu-item${danger ? ' is-danger' : ''}`}
      title={title}
      aria-expanded={expanded}
      aria-controls={controls}
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

export interface WbMenuEntry {
  label: string
  icon?: ReactNode
  hint?: string
  danger?: boolean
  disabled?: boolean
  /** the entry is a disclosure trigger: state and the region it reveals */
  expanded?: boolean
  controls?: string
  onSelect: () => void
}

/**
 * A trigger plus its WbMenu: the ⋯ of a row or a card by default, or any button (`className`,
 * `children`). Choosing an entry puts focus back on the trigger first, so a WbConfirm the entry
 * opens anchors to the trigger and returns focus there.
 */
export function WbMenuButton({
  label,
  menuLabel,
  items,
  empty,
  className = 'wb-icon-btn',
  disabled,
  children,
}: {
  /** the trigger's accessible name (and tooltip when it shows only a glyph) */
  label: string
  menuLabel?: string
  items: readonly WbMenuEntry[]
  /** shown, as a caption, when there is nothing to choose */
  empty?: string
  className?: string
  disabled?: boolean
  /** the trigger's content; ⋯ when omitted */
  children?: ReactNode
}): ReactElement {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <div className="wb-menu-wrap">
      <button
        ref={ref}
        type="button"
        className={className}
        aria-label={children ? undefined : label}
        title={children ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {children ?? <WbGlyph id="more" />}
      </button>
      <WbMenu open={open} onClose={() => setOpen(false)} anchorRef={ref} label={menuLabel ?? label}>
        {items.length === 0 && empty ? <WbMenuLabel>{empty}</WbMenuLabel> : null}
        {items.map((it, i) => (
          <WbMenuItem
            // two entries may share a label (user data): the position keeps the keys apart
            key={`${i}:${it.label}`}
            icon={it.icon}
            hint={it.hint}
            danger={it.danger}
            disabled={it.disabled}
            expanded={it.expanded}
            controls={it.controls}
            onSelect={() => {
              ref.current?.focus()
              setOpen(false)
              it.onSelect()
            }}
          >
            {it.label}
          </WbMenuItem>
        ))}
      </WbMenu>
    </div>
  )
}
