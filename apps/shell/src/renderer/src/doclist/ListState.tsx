import type { ReactNode } from 'react'
import './doclist-state.css'

export type ListStateGlyph = 'error' | 'star' | 'search'

/** the 32 px line icon of a list state; its colour is the muted text token (doclist-state.css) */
function Glyph({ glyph }: { glyph: ListStateGlyph }) {
  return (
    <svg
      className="dl-state-icon"
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyph === 'error' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5v5.5" />
          <path d="M12 16.25v.01" />
        </>
      )}
      {glyph === 'star' && (
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />
      )}
      {glyph === 'search' && (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </>
      )}
    </svg>
  )
}

/**
 * The state a document list shows instead of its table: an icon, a title, an optional reason and an
 * optional action (Thử lại, Xóa tìm kiếm). An error reads as an alert, an empty list as a status.
 */
export function ListState({
  kind,
  glyph,
  title,
  hint,
  action,
  returnFocus,
}: {
  kind: 'error' | 'empty'
  glyph: ListStateGlyph
  title: string
  hint?: string
  action?: { label: string; onClick: () => void }
  /** the action's button unmounts when the state clears; this moves focus somewhere that stays (RV-7) */
  returnFocus?: () => void
}): ReactNode {
  return (
    <div className="uw-pick-state dl-state" role={kind === 'error' ? 'alert' : 'status'}>
      <Glyph glyph={glyph} />
      <p className="uw-pick-state-title dl-state-title">{title}</p>
      {hint && <p className="uw-pick-state-hint dl-state-hint">{hint}</p>}
      {action && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            returnFocus?.()
            action.onClick()
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
