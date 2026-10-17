/**
 * Compact icon actions for Workbench list rows (Linear / Notion style).
 * Keeps Edit / Delete / Open on one line with tooltips — no wrapping text buttons.
 */
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'

function Svg({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

export function IconPencil(): ReactElement {
  return (
    <Svg>
      <path d="M11.5 2.5 13.5 4.5 6 12H4v-2z" />
      <path d="M10 4 12 6" />
    </Svg>
  )
}

export function IconTrash(): ReactElement {
  return (
    <Svg>
      <path d="M3.5 5h9" />
      <path d="M6 5V3.5h4V5" />
      <path d="M5 5.5 5.5 13h5L11 5.5" />
    </Svg>
  )
}

export function IconOpen(): ReactElement {
  return (
    <Svg>
      <path d="M7 3.5H4.5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V9" />
      <path d="M9.5 3.5H12.5V6.5" />
      <path d="M7.5 8.5 12.5 3.5" />
    </Svg>
  )
}

export function IconDoc(): ReactElement {
  return (
    <Svg>
      <path d="M5 2.5h4.5L12 5v8.5H5z" />
      <path d="M9.5 2.5V5H12" />
      <path d="M7 8h3.5M7 10.5h2.5" />
    </Svg>
  )
}

export function IconFile(): ReactElement {
  return (
    <Svg>
      <path d="M5 2.5h4l3 3v8H5z" />
      <path d="M9 2.5V5.5h3" />
    </Svg>
  )
}

/** G5-05u: "Dùng khi không có mạng" / "Bỏ dùng khi không có mạng" (a cloud with a down arrow) */
export function IconOfflinePin(): ReactElement {
  return (
    <Svg>
      <path d="M4.6 12.5a2.85 2.85 0 0 1-.35-5.67 3.9 3.9 0 0 1 7.55.8 2.45 2.45 0 0 1-.35 4.87" />
      <path d="M8 7.5v5.5" />
      <path d="M6 11l2 2 2-2" />
    </Svg>
  )
}

type IconBtnProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string
  variant?: 'default' | 'danger' | 'accent'
  children: ReactNode
}

export function WbIconBtn({
  label,
  variant = 'default',
  className,
  children,
  ...rest
}: IconBtnProps): ReactElement {
  return (
    <button
      type="button"
      className={`wb-icon-btn${variant !== 'default' ? ` is-${variant}` : ''}${className ? ` ${className}` : ''}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  )
}

export function WbRowActions({ children }: { children: ReactNode }): ReactElement {
  return <div className="wb-row-actions">{children}</div>
}

export function WbEditBtn({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}): ReactElement {
  return (
    <WbIconBtn label={label} onClick={onClick} disabled={disabled}>
      <IconPencil />
    </WbIconBtn>
  )
}

export function WbDeleteBtn({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}): ReactElement {
  return (
    <WbIconBtn label={label} variant="danger" onClick={onClick} disabled={disabled}>
      <IconTrash />
    </WbIconBtn>
  )
}

export function WbOpenBtn({
  label,
  onClick,
  disabled,
  title,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}): ReactElement {
  return (
    <WbIconBtn
      label={label}
      variant="accent"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
    >
      <IconOpen />
    </WbIconBtn>
  )
}

export function WbDraftBtn({
  label,
  onClick,
  disabled,
  title,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}): ReactElement {
  return (
    <WbIconBtn
      label={label}
      variant="accent"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
    >
      <IconDoc />
    </WbIconBtn>
  )
}

export function WbFileBtn({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}): ReactElement {
  return (
    <WbIconBtn label={label} onClick={onClick} disabled={disabled}>
      <IconFile />
    </WbIconBtn>
  )
}
