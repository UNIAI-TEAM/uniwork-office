import { useId, useRef, useState } from 'react'
import { useI18n, type StringKey } from '../locale'
import { ActionModal } from '../UniworkDocActions'
import { copyDocument } from '../uniwork-library-api'
import { DOC_NAME_ERROR_KEYS, UNIWORK_ERROR_KEYS } from '../uniwork-docs-model'
import type { UniworkDocErrorCode } from '../../../shared/home-api'
import './doc-copy-dialog.css'

/** the longest title the copy route takes (runes), the same cap as a document name */
const MAX_TITLE = 500

/** a fresh Idempotency-Key for one dialog open (main re-checks its shape and keys the call itself otherwise) */
function newKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** the sentence of a refused copy: the three copy refusals and the name error have their own */
function errorKeyOf(error: string): StringKey {
  if (error === 'name_too_long') return DOC_NAME_ERROR_KEYS.name_too_long
  // a bare server_error says nothing more than "it failed" - the web's documents.copy.failed
  if (error === 'server_error') return 'dlCopyFailed'
  return UNIWORK_ERROR_KEYS[error as UniworkDocErrorCode] ?? 'dlCopyFailed'
}

/**
 * UNI-2078: Make a copy of a file document (the web's document-copy-dialog). The copy lands at the
 * workspace root and keeps the source's access, so the consent is a real control: the submit stays
 * disabled until it is checked. The title is optional (blank = the server names the copy). One
 * Idempotency-Key per dialog open is kept across a retry of the same request. A route the
 * deployment lacks (404 / 501) says so here and tells the host to hide the entry.
 */
export function DocCopyDialog({
  doc,
  onCopied,
  onUnavailable,
  onCancel,
}: {
  doc: { id: string; title: string }
  /** the copy was made: the host toasts its title, closes and refreshes the list */
  onCopied: (title: string) => void
  /** the deployment has no copy route: hide the action for the rest of the session */
  onUnavailable: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const id = useId()
  const [title, setTitle] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<StringKey | null>(null)
  // one in-flight copy at a time, even before React re-renders the disabled button
  const sending = useRef(false)
  // the key of this open and the title it was made for: a changed title is a different request
  const key = useRef<{ value: string; title: string } | null>(null)

  const cancel = () => {
    if (!busy) onCancel()
  }

  const submit = async () => {
    if (sending.current || !consent) return
    sending.current = true
    setBusy(true)
    setError(null)
    const sent = title.trim()
    if (!key.current || key.current.title !== sent) key.current = { value: newKey(), title: sent }
    try {
      const res = await copyDocument({
        documentId: doc.id,
        ...(sent ? { title: sent } : {}),
        idempotencyKey: key.current.value,
      })
      if (res.ok) {
        key.current = null
        onCopied(res.value.title)
        return
      }
      if (res.endpointMissing) {
        setError('dlCopyUnavailable')
        onUnavailable()
      } else {
        setError(errorKeyOf(res.error))
      }
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
      initialFocus="input[type='text']"
    >
      <form
        className="uw-act-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <h3 id={`${id}-title`} className="uw-act-heading">
          {t('dlCopyTitle')}
        </h3>
        <p id={`${id}-desc`} className="uw-copy-desc">
          {t('dlCopyDescription')}
        </p>
        <div className="uw-act-field">
          <label className="uw-act-label" htmlFor={`${id}-name`}>
            {t('dlCopyTitleLabel')}
          </label>
          <input
            id={`${id}-name`}
            className="uw-act-input"
            type="text"
            value={title}
            maxLength={MAX_TITLE}
            disabled={busy}
            spellCheck={false}
            placeholder={t('dlCopyTitlePlaceholder', { title: doc.title })}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <label className="uw-copy-consent">
          <input
            type="checkbox"
            checked={consent}
            disabled={busy}
            // the wrapping label would name it label + hint: name it by the label, describe by the hint
            aria-labelledby={`${id}-consent-label`}
            aria-describedby={`${id}-consent-hint`}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span className="uw-copy-consent-text">
            <span id={`${id}-consent-label`} className="uw-copy-consent-label">
              {t('dlCopyConsentLabel')}
            </span>
            <span id={`${id}-consent-hint`} className="uw-copy-consent-hint">
              {t('dlCopyConsentHint')}
            </span>
          </span>
        </label>
        {error && (
          <p role="alert" className="uw-act-error">
            {t(error)}
          </p>
        )}
        <div className="modal-buttons">
          <button type="button" className="btn btn-secondary" onClick={cancel}>
            {t('cancel')}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            aria-disabled={!consent || busy || undefined}
            aria-busy={busy || undefined}
          >
            {busy ? t('dlCopySubmitting') : t('dlCopySubmit')}
          </button>
        </div>
      </form>
    </ActionModal>
  )
}
