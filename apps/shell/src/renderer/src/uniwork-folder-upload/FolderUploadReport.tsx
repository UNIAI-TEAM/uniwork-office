import { useId } from 'react'
import { ActionModal } from '../UniworkDocActions'
import { useI18n } from '../locale'
import { failureReasonMessage, hasRetryable, pluralKey } from './copy'
import type { FolderUploadRun } from './use-folder-upload'
import './folder-upload.css'

/** The files that did not go up, each with its reason, and the one action that retries only them */
export function FolderUploadReport({
  run,
  onRetry,
  onClose,
}: {
  run: FolderUploadRun
  onRetry: () => void
  /** Esc, the overlay and "Close" only close the report; the bar's × dismisses the batch */
  onClose: () => void
}) {
  const { t } = useI18n()
  const id = useId()
  // a run that failed as a whole left nothing at the server to retry
  const canRetry = run.phase === 'done' && hasRetryable(run.failures)
  // the retry cannot help a final failure: say what to do, also next to the ones it can
  const needsFix = !canRetry || run.failures.some((failure) => !failure.retryable)
  return (
    <ActionModal
      labelledBy={`${id}-title`}
      describedBy={`${id}-desc`}
      className="fu-dialog"
      onCancel={onClose}
    >
      <h3 id={`${id}-title`}>{t('fuRepTitle')}</h3>
      <p id={`${id}-desc`} className="fu-desc">
        {t(pluralKey('fuRepDescription', run.failures.length), {
          name: run.name,
          count: run.failures.length,
        })}
      </p>
      <ul className="fu-failures" aria-label={t('fuRepList')} data-testid="folder-upload-failures">
        {run.failures.map((failure, index) => (
          // files mode keeps same-named files: the path alone is not a key
          <li key={`${index}:${failure.path}`}>
            <span className="fu-failure-path" title={failure.path}>
              {failure.path}
            </span>
            <span className="fu-failure-reason">{failureReasonMessage(t, failure.code)}</span>
          </li>
        ))}
      </ul>
      {needsFix && <p className="fu-note">{t('fuRepFinalHint')}</p>}
      <div className="modal-buttons">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t('fuRepClose')}
        </button>
        {canRetry && (
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            {t('fuRepRetry')}
          </button>
        )}
      </div>
    </ActionModal>
  )
}
