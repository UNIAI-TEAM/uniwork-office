import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import {
  SHARE_OWNER_KEEP_LEVELS,
  type ShareOwnerCandidate,
  type ShareOwnerKeepLevel,
  type ShareResult,
  type UniworkShareApi,
} from '../../../shared/share-api'
import { ActionModal } from '../UniworkDocActions'
import { useI18n, type StringKey } from '../locale'
import { levelLabel } from './share-model'

/**
 * UNI-2078 slice 4: "Transfer ownership" on the Share dialog's owner row, a clone of the web's
 * owner-transfer-dialog.tsx. Main gates the call again and lists the candidates (workspace
 * members active in the organization, minus the owner, minus an admin who reaches a restricted
 * document only through admin_scope); this side awaits the server (no optimistic owner) and names
 * each refusal. A server without the route (UNI-2084 lands it) hides the button for the session.
 */

let ownerTransferMissing = false

/** whether this session has not yet met a server without the owner route */
export function ownerTransferAvailable(): boolean {
  return !ownerTransferMissing
}

/** test seam: a new session */
export function resetOwnerTransferSession(): void {
  ownerTransferMissing = false
}

type Failure = Extract<ShareResult<never>, { ok: false }>

/** a bridge call that rejects (a main without the channel, a handler that threw) is a network failure */
const bridgeFailed = (): Failure => ({ ok: false, error: 'network' })

/** every refusal has a sentence of ours: the server's own text is English (or internal) */
function refusalKey(failure: Failure): StringKey {
  if (failure.endpointMissing) return 'shrOwnerUnavailable'
  switch (failure.error) {
    case 'owner_target_not_member':
      return 'shrOwnerTargetNotMember'
    case 'break_glass_required':
      return 'shrOwnerSelfTransferError'
    case 'document_owned_by_work_product':
      return 'shrOwnerOwnedByWorkProduct'
    default:
      return 'shrOwnerFailed'
  }
}

export interface OwnerTransferActionProps {
  api: UniworkShareApi
  documentId: string
  documentTitle: string
  /** the current owner's name (the keep-level label names them) */
  ownerName: string
  /** the id of the line saying why the transfer is off (a shelved document): the button stays in
   *  the tab order, aria-disabled and described by it, and opens nothing */
  lockedBy?: string
  /** the transfer landed: the dialog reads the access list again and says so */
  onTransferred: (name: string) => Promise<void> | void
  /** the server has no owner route: the button goes away for the session */
  onUnavailable: () => void
}

export function OwnerTransferAction({
  lockedBy,
  onUnavailable,
  ...props
}: OwnerTransferActionProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)

  // focus goes back to the owner row's button, not the Share dialog's start
  useEffect(() => {
    if (wasOpen.current && !open) opener.current?.focus()
    wasOpen.current = open
  }, [open])

  return (
    <>
      <button
        ref={opener}
        type="button"
        className="btn uw-share-owner-transfer"
        data-owner-transfer
        aria-haspopup="dialog"
        aria-disabled={lockedBy ? true : undefined}
        aria-describedby={lockedBy}
        onClick={() => {
          if (!lockedBy) setOpen(true)
        }}
      >
        {t('shrOwnerTransferButton')}
      </button>
      {open && (
        <OwnerTransferDialog
          {...props}
          onClose={(missing) => {
            setOpen(false)
            if (missing) {
              ownerTransferMissing = true
              onUnavailable()
            }
          }}
        />
      )}
    </>
  )
}

function OwnerTransferDialog({
  api,
  documentId,
  documentTitle,
  ownerName,
  onTransferred,
  onClose,
}: Omit<OwnerTransferActionProps, 'lockedBy' | 'onUnavailable'> & {
  onClose: (missing: boolean) => void
}) {
  const { t } = useI18n()
  const id = useId()
  const [candidates, setCandidates] = useState<ShareOwnerCandidate[] | null>(null)
  const [query, setQuery] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [picked, setPicked] = useState<ShareOwnerCandidate | null>(null)
  const [keep, setKeep] = useState<ShareOwnerKeepLevel>('edit')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ key: StringKey; name: string } | null>(null)
  const [missing, setMissing] = useState(false)
  const sending = useRef(false)

  useEffect(() => {
    let live = true
    void api
      .ownerCandidates(documentId)
      .catch(bridgeFailed)
      .then((res) => {
        if (!live) return
        if (res.ok) setCandidates(res.value)
        else {
          setCandidates([])
          setError({ key: refusalKey(res), name: '' })
        }
      })
    return () => {
      live = false
    }
  }, [api, documentId])

  const needle = query.trim().toLowerCase()
  const options =
    candidates?.filter(
      (c) =>
        !needle ||
        (picked && c.userId === picked.userId) ||
        c.name.toLowerCase().includes(needle) ||
        c.email.toLowerCase().includes(needle),
    ) ?? []
  const optionId = (index: number) => `${id}-person-${index}`

  const choose = (person: ShareOwnerCandidate) => {
    setPicked(person)
    setQuery(person.name)
    setListOpen(false)
    setActive(-1)
    setError(null)
  }

  const onComboKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!listOpen) {
        setListOpen(true)
        setActive(options.length > 0 ? 0 : -1)
        return
      }
      if (options.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((i) => Math.min(options.length - 1, Math.max(0, i + step)))
    } else if (event.key === 'Enter') {
      if (listOpen && options[active]) {
        event.preventDefault()
        choose(options[active]!)
      }
    } else if (event.key === 'Escape' && listOpen) {
      // the first Escape closes the list only, not the dialog
      event.preventDefault()
      event.stopPropagation()
      setListOpen(false)
    }
  }

  const blocked = !picked || busy || missing
  const submit = async () => {
    if (blocked || !picked || sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    const person = picked
    const res = await api
      .transferOwner({ documentId, userId: person.userId, previousOwnerLevel: keep })
      .catch(bridgeFailed)
    sending.current = false
    setBusy(false)
    if (res.ok) {
      onClose(false)
      await onTransferred(person.name)
      return
    }
    if (res.endpointMissing) setMissing(true)
    setError({ key: refusalKey(res), name: person.name })
  }

  const keepText = (level: ShareOwnerKeepLevel) =>
    level === 'none' ? t('shrOwnerPreviousLevelNone') : levelLabel(t, level)
  const title = documentTitle.trim()
  const listId = `${id}-people`

  return (
    <ActionModal
      labelledBy={`${id}-title`}
      describedBy={`${id}-note`}
      className="uw-owner-transfer"
      restoreFocus={false}
      // Escape and the overlay wait for the answer like the Cancel button does
      onCancel={() => {
        if (!busy) onClose(missing)
      }}
    >
      <h3 id={`${id}-title`} className="uw-act-heading">
        {title ? t('shrOwnerTransferTitle', { document: title }) : t('shrOwnerTitleUntitled')}
      </h3>
      <p id={`${id}-note`} className="uw-share-muted">
        {t('shrOwnerTransferNote')}
      </p>

      <div
        className="uw-act-field"
        onBlur={(event) => {
          // the list stays open while focus is inside the field or the list, as in ShareCandidatePicker
          const next = event.relatedTarget as Node | null
          if (!next || !event.currentTarget.contains(next)) setListOpen(false)
        }}
      >
        <label htmlFor={`${id}-person`} className="uw-act-label">
          {t('shrOwnerNewOwnerLabel')}
        </label>
        <input
          id={`${id}-person`}
          className="uw-act-input"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={listOpen}
          aria-controls={listOpen ? listId : undefined}
          aria-activedescendant={listOpen && options[active] ? optionId(active) : undefined}
          placeholder={t('shrOwnerSearchPlaceholder')}
          value={query}
          disabled={busy}
          onChange={(e) => {
            setQuery(e.target.value)
            setPicked(null)
            setListOpen(true)
            setActive(0)
          }}
          onClick={() => setListOpen(true)}
          onKeyDown={onComboKey}
        />
        {listOpen && (
          <ul id={listId} role="listbox" className="uw-share-listbox">
            {options.length === 0 ? (
              <li className="uw-share-listbox-note">
                {candidates === null ? t('shrOwnerLoading') : t('shrOwnerNoCandidates')}
              </li>
            ) : (
              options.map((person, index) => (
                <li
                  key={person.userId}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  className={`uw-share-option${index === active ? ' active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(person)}
                >
                  <span className="uw-share-option-text">
                    <span className="uw-share-option-name">{person.name}</span>
                    {person.email && person.email !== person.name && (
                      <span className="uw-share-option-sub">{person.email}</span>
                    )}
                  </span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      <div className="uw-act-field">
        <label htmlFor={`${id}-keep`} className="uw-act-label">
          {t('shrOwnerPreviousLevelLabel', { name: ownerName })}
        </label>
        <select
          id={`${id}-keep`}
          className="uw-act-select"
          value={keep}
          disabled={busy}
          onChange={(e) => setKeep(e.target.value as ShareOwnerKeepLevel)}
        >
          {SHARE_OWNER_KEEP_LEVELS.map((level) => (
            <option key={level} value={level}>
              {keepText(level)}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" className="uw-act-error">
          {t(error.key, { name: error.name })}
        </p>
      )}

      <div className="modal-buttons">
        <button
          type="button"
          className="btn btn-secondary"
          data-owner-transfer-cancel
          disabled={busy}
          onClick={() => onClose(missing)}
        >
          {t('cancel')}
        </button>
        {/* aria-disabled keeps the button in the tab order while it waits */}
        <button
          type="button"
          className="btn btn-primary"
          aria-disabled={blocked || undefined}
          aria-busy={busy || undefined}
          onClick={() => void submit()}
        >
          {t('shrOwnerTransferConfirm')}
        </button>
      </div>
    </ActionModal>
  )
}
