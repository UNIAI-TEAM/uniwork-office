import { useId, useRef, useState } from 'react'
import { useI18n } from '../locale'
import { ActionModal, FieldError } from '../UniworkDocActions'
import type { DocNameError } from '../uniwork-docs-model'
import { FOLDER_NAME_ERROR_KEYS, checkFolderName } from './uniwork-folders-model'

/** what the host's create/rename call answers: done, an error at the field, or a toast it showed */
export type FolderNameOutcome = { ok: true } | { ok: false; field: DocNameError | null }

/**
 * FD-11: name a new folder (New folder / New subfolder) or rename one from the
 * contents list. The name rule (NFC, trim, 1-255) is checked before any call;
 * `folder_name_taken` comes back from the server and shows at the field. A create
 * under the workspace root or a workspace folder adds the workspace note.
 */
export function FolderNameDialog({
  title,
  initial = '',
  submitLabel,
  workspaceNote = false,
  onSubmit,
  onCancel,
}: {
  title: string
  initial?: string
  submitLabel: string
  /** a new folder whose name shows to everyone in the workspace (UNI-2066): a note under the field */
  workspaceNote?: boolean
  onSubmit: (name: string) => Promise<FolderNameOutcome>
  onCancel: () => void
}) {
  const { t } = useI18n()
  const id = useId()
  const [name, setName] = useState(initial)
  const [error, setError] = useState<DocNameError | null>(null)
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  const submit = () => {
    if (busy) return
    const checked = checkFolderName(name)
    if (!checked.ok) {
      setError(checked.error)
      nameRef.current?.focus()
      return
    }
    setBusy(true)
    void onSubmit(checked.name)
      .then((outcome) => {
        setBusy(false)
        if (outcome.ok || !outcome.field) return
        setError(outcome.field)
        nameRef.current?.focus()
      })
      .catch(() => {
        setBusy(false)
      })
  }

  return (
    <ActionModal labelledBy={`${id}-title`} onCancel={onCancel}>
      <form
        className="uw-act-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <h3 id={`${id}-title`} className="uw-act-heading">
          {title}
        </h3>
        <div className="uw-act-field">
          <label className="uw-act-label" htmlFor={`${id}-name`}>
            {t('ufFolderName')}
          </label>
          <input
            id={`${id}-name`}
            ref={nameRef}
            className="uw-act-input"
            type="text"
            value={name}
            required
            aria-required="true"
            aria-invalid={error !== null}
            aria-describedby={workspaceNote ? `${id}-note ${id}-error` : `${id}-error`}
            spellCheck={false}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              setName(e.target.value)
              if (error) setError(null)
            }}
          />
          {workspaceNote && (
            <p id={`${id}-note`} className="uw-act-note">
              {t('ufCreateWorkspaceNote')}
            </p>
          )}
          <FieldError id={`${id}-error`} error={error} keys={FOLDER_NAME_ERROR_KEYS} />
        </div>
        <div className="modal-buttons">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </ActionModal>
  )
}
