import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FileBadge } from '../FileBadge'
import { useI18n } from '../locale'
import { placeMenu } from '../UniworkDocActions'
import { NEW_DOC_KINDS, type NewDocKind } from '../uniwork-docs-model'
import { FolderGlyph } from '../uniwork-folders/UniworkFolderTree'
import { NEW_KIND_EXT, NEW_MENU_LABEL_KEY, type NewMenuKind } from './new-menu-model'

/**
 * UNI-1959: the Documents home "New" button and the web's menu behind it
 * (documents-home-create.tsx `CreateMenu`): UniNote, a divider, the seven file
 * kinds; inside an open folder a "Folder" row comes first, followed by a divider.
 * A create is always private (web rule UNI-2038): there is no share toggle here, sharing
 * is chosen at first save or in the Share dialog. Every row shows its
 * icon, its name and, right-aligned in muted mono, its extension. Menu-button
 * pattern: arrows move, Home / End jump, Enter / Space pick, Esc closes and
 * hands focus back to the button; a pick closes the menu.
 */
export function NewMenu({
  label,
  hasFolderRow,
  unavailable,
  unavailableHint,
  busy,
  onPick,
}: {
  label: string
  /** inside an open folder: a Folder row opens the menu */
  hasFolderRow: boolean
  /** kinds the server cannot create: their rows stay, disabled, for the session */
  unavailable: ReadonlySet<NewDocKind>
  unavailableHint: string
  busy: boolean
  onPick: (kind: NewMenuKind) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
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
    if (!open) return
    const onOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('click', onOutside)
    return () => document.removeEventListener('click', onOutside)
  }, [open])

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }

  // a disabled row (a kind the server cannot create) is skipped, as the web's menu does
  const focusables = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []).filter(
      (node) => node.getAttribute('aria-disabled') !== 'true',
    )

  // initial focus: the first usable row
  useEffect(() => {
    if (open) focusables()[0]?.focus()
  }, [open])

  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    const nodes = focusables()
    const at = nodes.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      // focus on a row that is not usable (a mouse-focused disabled row): Down starts at the
      // first usable row, Up at the last
      const next =
        at === -1 ? (step === 1 ? 0 : nodes.length - 1) : (at + step + nodes.length) % nodes.length
      nodes[next]?.focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      nodes[event.key === 'Home' ? 0 : nodes.length - 1]?.focus()
    } else if (event.key === 'Enter' || event.key === ' ') {
      const target = document.activeElement as HTMLElement | null
      if (target && nodes.includes(target)) {
        event.preventDefault()
        target.click()
      }
    } else if (event.key === 'Tab') {
      close(true)
    }
  }

  const kinds: NewMenuKind[] = hasFolderRow ? ['folder', ...NEW_DOC_KINDS] : [...NEW_DOC_KINDS]

  const row = (kind: NewMenuKind) => {
    const off = kind !== 'folder' && unavailable.has(kind)
    return (
      <button
        key={kind}
        type="button"
        role="menuitem"
        tabIndex={-1}
        className="dh-new-item"
        data-new-kind={kind}
        aria-disabled={off || busy || undefined}
        title={off ? unavailableHint : undefined}
        onClick={() => {
          if (off || busy) return
          close(false)
          // park focus on the button so a modal a pick opens gives it back
          buttonRef.current?.focus()
          onPick(kind)
        }}
      >
        <span className="dh-new-icon" aria-hidden="true">
          {kind === 'folder' ? <FolderGlyph /> : <FileBadge ext={kind} size={18} />}
        </span>
        <span className="dh-new-label">{t(NEW_MENU_LABEL_KEY[kind])}</span>
        {kind !== 'folder' && <span className="dh-new-ext">{NEW_KIND_EXT[kind]}</span>}
      </button>
    )
  }

  const items: ReactNode[] = []
  for (const kind of kinds) {
    items.push(row(kind))
    // a divider after Folder and after UniNote, as on the web
    if (kind === 'folder' || kind === 'page') {
      items.push(<div key={`${kind}-sep`} role="separator" className="dh-new-sep" />)
    }
  }

  return (
    <>
      <button
        type="button"
        ref={buttonRef}
        className="btn btn-primary dh-toolbar-btn dh-btn-create"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-disabled={busy || undefined}
        onClick={() => {
          if (!busy) setOpen((v) => !v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !busy) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        {label}
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            className="uw-row-menu-list dh-new-menu"
            role="menu"
            id={menuId}
            aria-label={label}
            ref={menuRef}
            onKeyDown={onMenuKey}
            onClick={(e) => e.stopPropagation()}
          >
            {items}
          </div>,
          document.body,
        )}
    </>
  )
}
