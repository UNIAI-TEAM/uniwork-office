import { useId, useRef, useState } from 'react'
import { useI18n, type StringKey } from '../locale'
import { ActionModal } from '../UniworkDocActions'
import { purgeDocument } from '../uniwork-library-api'
import { UNIWORK_ERROR_KEYS } from '../uniwork-docs-model'
import type { UniworkDocErrorCode } from '../../../shared/home-api'

/** the sentence of a refused purge; a bare failure says it the web's way ("Nothing changed") */
function errorKeyOf(error: string): StringKey {
  if (error === 'server_error' || error === 'network') return 'dlPurgeFailed'
  return UNIWORK_ERROR_KEYS[error as UniworkDocErrorCode] ?? 'dlPurgeFailed'
}

/**
 * UNI-2078: Delete forever of one trashed item (the web's document-purge-dialog). It cannot be
 * undone, so the focus starts on Cancel and the destructive button is red. A failure stays in the
 * dialog (the person may retry); `document_not_in_trash` (the item left the trash meanwhile) is
 * handed to the host, which toasts it, reads the list again and closes. One purge in flight at a
 * time, and nothing closes the dialog while it runs.
 */
export function DocPurgeConfirm({
  doc,
  onPurged,
  onNotInTrash,
  onCancel,
}: {
  doc: { id: string; title: string; kind?: string | null }
  /** the item is gone: the host toasts its title, closes and refreshes the list */
  onPurged: (title: string) => void
  /** the item is no longer in the trash: the host toasts the refusal, refreshes and closes */
  onNotInTrash: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<StringKey | null>(null)
  // one in-flight purge at a time, even before React re-renders the busy button
  const sending = useRef(false)

  const cancel = () => {
    if (!busy) onCancel()
  }

  const confirm = async () => {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await purgeDocument(doc.id)
      if (res.ok) {
        onPurged(doc.title)
        return
      }
      if (res.error === 'document_not_in_trash') {
        onNotInTrash()
        return
      }
      setError(errorKeyOf(res.error))
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <ActionModal
      labelledBy={`${id}-title`}
      describedBy={`${id}-desc`}
      onCancel={cancel}
      initialFocus="[data-purge-cancel]"
    >
      <h3 id={`${id}-title`} className="uw-act-heading">
        {t('dlPurgeTitle', { title: doc.title })}
      </h3>
      <p id={`${id}-desc`}>
        {t(doc.kind === 'folder' ? 'dlPurgeFolderDescription' : 'dlPurgeDescription')}
      </p>
      {error && (
        <p role="alert" className="uw-act-error">
          {t(error)}
        </p>
      )}
      <div className="modal-buttons">
        <button type="button" className="btn btn-secondary" data-purge-cancel onClick={cancel}>
          {t('cancel')}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          data-purge-confirm
          aria-disabled={busy || undefined}
          aria-busy={busy || undefined}
          onClick={() => void confirm()}
        >
          {busy ? t('dlPurgeSubmitting') : t('dlPurgeSubmit')}
        </button>
      </div>
    </ActionModal>
  )
}
