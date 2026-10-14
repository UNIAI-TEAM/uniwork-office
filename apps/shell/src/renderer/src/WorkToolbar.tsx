import type { ReactElement, ReactNode } from 'react'
import { LocalTag } from './LocalTag'

export interface WorkToolbarProps {
  /** the tab's name: a heading for screen readers only, the tab row already shows it */
  title: string
  /** id of that heading, for the pane section's aria-labelledby */
  titleId?: string
  /** one line about the tab's real state ("6 open · 1 overdue"), else the tab hint */
  summary?: ReactNode
  /** local-only data: adds the "On this device" tag */
  local?: boolean
  /** the tab's own actions, on the right */
  actions?: ReactNode
}

/** The bar every Workbench tab opens with (redesign spec 3): summary left, actions right. */
export function WorkToolbar({
  title,
  titleId,
  summary,
  local = false,
  actions,
}: WorkToolbarProps): ReactElement {
  return (
    <div className="wb-toolbar">
      <h2 className="uw-sr-only" id={titleId}>
        {title}
      </h2>
      <div className="wb-toolbar-summary">
        {summary ? <p className="wb-toolbar-text">{summary}</p> : null}
        {local ? <LocalTag /> : null}
      </div>
      {actions ? <div className="wb-toolbar-actions">{actions}</div> : null}
    </div>
  )
}
