import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { FileBadge } from '../FileBadge'
import { useI18n, type TFunc } from '../locale'
import {
  DOCUMENTS_HOME_TYPE_OPTIONS,
  toggleTypePick,
  type DocumentsHomeTypePick,
} from '../uniwork-home/documents-home-model'

const BADGE = 16

/** the Type label without its trailing colon: the accessible name of the menu and of the chip group */
export function typeGroupName(label: string): string {
  return label.replace(/[:：]\s*$/, '')
}

/** the visible label of one type (UniNote is a string, the formats are their extension) */
export function typePickLabel(t: TFunc, pick: DocumentsHomeTypePick): string {
  const option = DOCUMENTS_HOME_TYPE_OPTIONS.find((o) => o.value === pick)
  return option?.labelKey ? t(option.labelKey) : (option?.literal ?? pick)
}

function Chevron() {
  return (
    <svg
      className="dh-type-chevron"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  )
}

function Check() {
  return (
    <svg
      className="dh-type-check"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  )
}

export interface TypeFilterProps {
  /** the picked types in menu order; empty = all types */
  types: readonly DocumentsHomeTypePick[]
  onChange: (next: DocumentsHomeTypePick[]) => void
  /** types this screen's rows can never match (Từ nơi khác lists files only: no UniNote) */
  hideTypes?: readonly DocumentsHomeTypePick[]
  /** the trigger, so a removed chip can hand focus back to it */
  triggerRef: RefObject<HTMLButtonElement | null>
}

/**
 * The one Type control of the filter bar: a trigger (`Loại: Tất cả` / `Loại: .xlsx` / `Loại: 3 loại`)
 * and a menu below it with All types first, then one checkable item per type. Items toggle and keep
 * the menu open; Escape closes it and returns focus to the trigger. A menu of `menuitemcheckbox`
 * items (not a listbox): the trigger is a button, the items are real buttons, the arrow keys move
 * focus, and the trigger is the control's one tab stop.
 */
export function TypeFilter({ types, onChange, hideTypes, triggerRef }: TypeFilterProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const options = DOCUMENTS_HOME_TYPE_OPTIONS.filter((o) => !hideTypes?.includes(o.value))

  // a press outside the control closes the menu (focus stays where the person put it)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const menuItems = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]') ?? [])
  const focusAt = (i: number) => {
    const items = menuItems()
    items[(i + items.length) % items.length]?.focus()
  }
  // the menu opens with focus on the first pick, or on All types while nothing is picked; only
  // when it opens (never on a later render: a pick or a removed chip must not steal focus)
  useEffect(() => {
    if (!open) return
    const el = menuRef.current
    if (!el || el.contains(document.activeElement)) return
    const first =
      el.querySelector<HTMLElement>(
        '[role="menuitemcheckbox"][aria-checked="true"]:not([data-type="all"])',
      ) ?? el.querySelector<HTMLElement>('[role="menuitemcheckbox"]')
    first?.focus()
  }, [open])

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' && !open) {
      e.preventDefault()
      setOpen(true)
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
  }
  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems()
    const at = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusAt(at + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusAt(at < 0 ? -1 : at - 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      focusAt(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      focusAt(-1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    } else if (e.key === 'Tab') {
      // hand focus to the trigger first: the browser then tabs on from it, out of the control
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  const pick = (value: DocumentsHomeTypePick) => onChange(toggleTypePick(types, value))

  const one = types.length === 1 ? types[0]! : null
  const value =
    types.length === 0
      ? t('uhFilterTypeAll')
      : one
        ? typePickLabel(t, one)
        : t('uhFilterTypeCount', { count: types.length })
  const label = t('uhFilterType')

  return (
    <div className="dh-type-filter" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="dh-type-trigger"
        data-filter="type"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="dh-filter-k">{label}</span>{' '}
        <span className="dh-type-value">
          {one && <FileBadge ext={one} size={BADGE} />}
          {value}
        </span>
        <Chevron />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={typeGroupName(label)}
          className="dh-type-menu"
          onKeyDown={onMenuKeyDown}
        >
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={types.length === 0}
            tabIndex={-1}
            data-type="all"
            className="dh-type-item"
            onClick={() => {
              // nothing is picked already: the same list would only be read again
              if (types.length > 0) onChange([])
            }}
          >
            <span className="dh-type-spacer" aria-hidden="true" />
            <span className="dh-type-item-label">{t('uhFilterTypeAll')}</span>
            {types.length === 0 && <Check />}
          </button>
          {options.map((o) => {
            const on = types.includes(o.value)
            return (
              <button
                key={o.value}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                tabIndex={-1}
                data-type={o.value}
                className="dh-type-item"
                onClick={() => pick(o.value)}
              >
                <FileBadge ext={o.value} size={BADGE} />
                <span className="dh-type-item-label">{typePickLabel(t, o.value)}</span>
                {on && <Check />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
