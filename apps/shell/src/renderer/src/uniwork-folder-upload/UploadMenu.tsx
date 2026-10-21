import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../locale'
import { placeMenu } from '../UniworkDocActions'
import './folder-upload.css'

/**
 * UNI-2052: the Upload button when files and folders can both go up: a small
 * menu with "Tải lên tệp" and "Tải lên thư mục". Menu-button pattern as the
 * New menu: arrows move, Home / End jump, Enter / Space pick, Esc closes and
 * hands the focus back to the button.
 */
export function UploadMenu({
  className,
  label,
  withIcon = false,
  onPickFiles,
  onPickFolder,
}: {
  className: string
  label: string
  /** the toolbar button carries the upload arrow */
  withIcon?: boolean
  onPickFiles: () => void
  onPickFolder: () => void
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

  const items = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])

  useEffect(() => {
    if (open) items()[0]?.focus()
  }, [open])

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }

  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    const nodes = items()
    const at = nodes.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
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

  const pick = (run: () => void) => () => {
    close(false)
    // park the focus on the button so a dialog the pick opens gives it back
    buttonRef.current?.focus()
    run()
  }

  return (
    <>
      <button
        type="button"
        ref={buttonRef}
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        {withIcon && (
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        )}
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
            className="uw-row-menu-list fu-upload-menu"
            role="menu"
            id={menuId}
            aria-label={label}
            ref={menuRef}
            onKeyDown={onMenuKey}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="dh-new-item"
              data-upload-kind="files"
              onClick={pick(onPickFiles)}
            >
              <span className="dh-new-label">{t('fuMenuFiles')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="dh-new-item"
              data-upload-kind="folder"
              onClick={pick(onPickFolder)}
            >
              <span className="dh-new-label">{t('fuMenuFolder')}</span>
            </button>
          </div>,
          document.body,
        )}
    </>
  )
}
