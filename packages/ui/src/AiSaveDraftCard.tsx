import React, { useId } from 'react'
import type { Lang } from '@genoffice/i18n'
import { AI_SAVE_DRAFT_LABELS } from './strings-ai-save-draft'
import './ai-save-draft-card.css'

export interface AiSaveDraftCardProps {
  readonly lang: Lang
  /** the file name a Save would offer; empty when none could be derived (the line is left out) */
  readonly name: string
  /** Save: the app runs its normal first-save flow with `name` */
  readonly onSave: () => void
  /** Not now: dismiss; the document stays unsaved and dirty */
  readonly onLater: () => void
}

/**
 * The one question after an AI run changed a never-saved document: save it now? An inline card
 * under the assistant's answer, not a modal, and it takes no focus when it appears. The apps keep
 * at most one per run and write nothing before the Save click.
 */
export function AiSaveDraftCard(props: AiSaveDraftCardProps): React.JSX.Element {
  const labels = AI_SAVE_DRAFT_LABELS[props.lang] ?? AI_SAVE_DRAFT_LABELS.en
  const questionId = useId()
  return (
    <div className="ai-save-draft" role="group" aria-labelledby={questionId}>
      <div className="ai-save-draft-question" id={questionId}>
        {labels.question}
      </div>
      {props.name && (
        <div className="ai-save-draft-name" dir="auto" title={props.name}>
          {labels.saveAs(props.name)}
        </div>
      )}
      <div className="ai-save-draft-actions">
        <button type="button" className="ai-save-draft-save" onClick={props.onSave}>
          {labels.save}
        </button>
        <button type="button" className="ai-save-draft-later" onClick={props.onLater}>
          {labels.later}
        </button>
      </div>
    </div>
  )
}
