import type { ReactElement, ReactNode } from 'react'
import type { PracticePillarId, WorkbenchModuleId } from '@uniwork/practice-core'
import { WorkbenchIcon } from './WorkbenchIcons'

export interface WorkPaneHeaderProps {
  /** the module or pillar whose tinted tile leads the title */
  module: WorkbenchModuleId | PracticePillarId
  title: string
  /** one caption line under the title (the module hint, the open context) */
  meta?: ReactNode
  /** the right-hand slot: a summary count or the pane's own actions */
  aside?: ReactNode
}

/** The title every Workbench tab shares (redesign spec 4.2): tile, title, meta, no card around it. */
export function WorkPaneHeader({ module, title, meta, aside }: WorkPaneHeaderProps): ReactElement {
  return (
    <header className="wb-pane-head">
      <WorkbenchIcon id={module} size={20} />
      <div className="wb-pane-text">
        <h2 className="wb-pane-title">{title}</h2>
        {meta ? <p className="wb-pane-meta">{meta}</p> : null}
      </div>
      {aside ? <div className="wb-pane-aside">{aside}</div> : null}
    </header>
  )
}
