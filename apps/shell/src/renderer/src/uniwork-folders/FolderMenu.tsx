import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { placeMenu } from '../UniworkDocActions'

export interface FolderMenuItem {
  id: string
  label: string
  onSelect: () => void
}

/**
 * FD-11: the "…" menu of a tree row or a contents row (menu button pattern,
 * the same placement and keys as the library's RowMenu). Controlled, so the
 * tree can open it from Shift+F10 / the context-menu key / a right click.
 */
export function FolderMenu({
  label,
  items,
  open,
  onOpenChange,
  dataFor,
  tabbable = false,
}: {
  /** accessible name of the button and the menu ("Actions for X") */
  label: string
  items: FolderMenuItem[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** marks the button so the host can give focus back to it */
  dataFor: string
  /** a tab stop of its own (breadcrumb); rows reach theirs by Shift+F10 instead */
  tabbable?: boolean
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      if (buttonRef.current && menuRef.current) placeMenu(buttonRef.current, menuRef.current)
    }
    place()
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && e.target !== buttonRef.current) {
        onOpenChange(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, onOpenChange])

  const close = (refocus: boolean) => {
    onOpenChange(false)
    if (refocus) buttonRef.current?.focus()
  }

  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const nodes = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    )
    const at = nodes.indexOf(document.activeElement as HTMLElement)
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      nodes[(at + step + nodes.length) % nodes.length]?.focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      nodes[event.key === 'Home' ? 0 : nodes.length - 1]?.focus()
    } else if (event.key === 'Tab') {
      close(true)
    }
  }

  if (items.length === 0) return null
  return (
    <span className="uw-row-menu uwf-menu">
      <button
        type="button"
        ref={buttonRef}
        className={`uw-pick-info-btn uw-row-menu-btn${open ? ' on' : ''}`}
        data-folder-menu-for={dataFor}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        tabIndex={tabbable ? 0 : -1}
        onClick={(e) => {
          e.stopPropagation()
          onOpenChange(!open)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.stopPropagation()
            onOpenChange(true)
          }
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
          <circle cx="8" cy="8" r="1.3" fill="currentColor" />
          <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            className="uw-row-menu-list"
            role="menu"
            id={menuId}
            aria-label={label}
            ref={menuRef}
            onKeyDown={onMenuKey}
            onClick={(e) => e.stopPropagation()}
          >
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="uw-row-menu-item"
                data-folder-action={item.id}
                onClick={() => {
                  onOpenChange(false)
                  // park focus on the button so a modal opened by the item gives it back
                  buttonRef.current?.focus()
                  item.onSelect()
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </span>
  )
}
