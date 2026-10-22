import { useId, useRef } from 'react'
import { useI18n } from '../locale'
import { ActionModal } from '../UniworkDocActions'

/**
 * UNI-2078: the one confirm of a Delete forever batch (the web's bulk purge confirm). It cannot be
 * undone and the batch skips what the person does not manage, so the sentence says both. The
 * focus starts on Cancel, and a second click before the host re-renders confirms nothing twice.
 */
export function BulkPurgeConfirm({
  count,
  onConfirm,
  onCancel,
}: {
  count: number
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const id = useId()
  const confirmed = useRef(false)
  return (
    <ActionModal
      labelledBy={`${id}-title`}
      describedBy={`${id}-body`}
      onCancel={onCancel}
      initialFocus="[data-bulk-cancel]"
    >
      <h3 id={`${id}-title`} className="uw-act-heading">
        {t(count === 1 ? 'dlBulkPurgeTitleOne' : 'dlBulkPurgeTitleOther', { n: count })}
      </h3>
      <p id={`${id}-body`}>{t('dlBulkPurgeDescription')}</p>
      <div className="modal-buttons">
        <button type="button" className="btn btn-secondary" data-bulk-cancel onClick={onCancel}>
          {t('cancel')}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          data-bulk-confirm
          onClick={() => {
            if (confirmed.current) return
            confirmed.current = true
            onConfirm()
          }}
        >
          {t('dlPurgeSubmit')}
        </button>
      </div>
    </ActionModal>
  )
}
