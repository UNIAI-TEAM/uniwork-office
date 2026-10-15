import type { ReactElement } from 'react'
import { useI18n } from '../i18n/locale'
import type { RunUndoState } from './edit-history'

/**
 * "Undo this run" under the answer of a run that changed the document. It undoes exactly that run
 * while it is still the latest undo step. When it cannot (later edits sit on top of it, or the
 * assistant is working again) the button stays in the tab order with aria-disabled and the reason
 * is written next to it, so a keyboard or screen-reader user is told why instead of meeting a dead
 * control. After the run is undone only a quiet note stays; a run no step holds shows nothing.
 */
export function RunUndoAction({
  runId,
  state,
  busy,
  onUndo,
}: {
  runId: string
  state: RunUndoState
  /** the assistant is running again: the document is still changing under this run */
  busy: boolean
  onUndo: () => void
}): ReactElement | null {
  const { t } = useI18n()
  if (state === 'none') return null
  if (state === 'undone') {
    return (
      <div className="ai-run-undo">
        <span className="ai-run-undo-note" role="status">
          {t('aiRunUndoDone')}
        </span>
      </div>
    )
  }
  const blocked = busy || state === 'later'
  const noteId = `ai-run-undo-note-${runId.replace(/[^\w-]/g, '')}`
  return (
    <div className="ai-run-undo">
      <button
        type="button"
        className="ai-run-undo-btn"
        aria-disabled={blocked ? 'true' : undefined}
        aria-describedby={blocked ? noteId : undefined}
        onClick={() => {
          if (!blocked) onUndo()
        }}
      >
        {t('aiRunUndo')}
      </button>
      {blocked && (
        <span id={noteId} className="ai-run-undo-note">
          {t(busy ? 'aiRunUndoBusy' : 'aiRunUndoLater')}
        </span>
      )}
    </div>
  )
}
