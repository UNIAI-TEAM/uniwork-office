import { useId } from 'react'
import { useI18n } from '../locale'
import { ActionModal } from '../UniworkDocActions'

/**
 * UNI-2066: asked before a folder leaves My Folder, because it and its sub-folders then
 * become workspace folders (the name is visible to the whole workspace; the documents
 * inside keep their own access). Client-only: the move request goes out only after the
 * confirm. Focus starts on Cancel, the safe answer.
 */
export function MoveOutConfirm({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const id = useId()
  return (
    <ActionModal
      labelledBy={`${id}-title`}
      describedBy={`${id}-body`}
      onCancel={onCancel}
      initialFocus=".btn-secondary"
    >
      <h3 id={`${id}-title`} className="uw-act-heading">
        {t('ufMoveOutTitle')}
      </h3>
      <p id={`${id}-body`}>{t('ufMoveOutBody')}</p>
      <div className="modal-buttons">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          {t('cancel')}
        </button>
        <button type="button" className="btn btn-primary" onClick={onConfirm}>
          {t('ufMoveOutConfirm')}
        </button>
      </div>
    </ActionModal>
  )
}
