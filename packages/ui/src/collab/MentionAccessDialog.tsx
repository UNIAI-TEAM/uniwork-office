/**
 * G8-18 pre-send dialog: mentioned people cannot view the document. The caller-level capability
 * decides between "Share view access, then send" and the ask-a-manager line (per-person `can_share`
 * only exists after a send, so every person here is shareable or none is). A failed or partial share
 * keeps the dialog open with the retry / send-now choices.
 *
 * Accessibility: focus goes to the primary button on open and again on every state change (the
 * re-rendered buttons would otherwise drop it), and the sharing / failed / partial sentences go to
 * the polite live region.
 */
import { format } from '@genoffice/i18n'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { useModalKeys } from '../modal-keys'
import { formatMentionNames } from './mention-query'

/** the catalogue keys the dialog reads */
export interface MentionAccessStrings {
  collabMentionWarnTitle: string
  /** `{names}` */
  collabMentionWarnBody: string
  collabShareViewThenSend: string
  collabSendWithoutNotify: string
  /** `{names}` */
  collabMentionAskManager: string
  collabSharingView: string
  /** `{failedNames}` */
  collabShareViewFailed: string
  /** `{sharedNames}`, `{failedNames}` */
  collabShareViewPartial: string
  collabSendComment: string
  /** `{failedNames}` */
  collabRetryShareFor: string
  collabRetry: string
  collabCancel: string
}

export interface MentionAccessPerson {
  id: string
  label: string
}

export interface MentionAccessState {
  people: MentionAccessPerson[]
  sharing: boolean
  sharedIds: string[]
  failedIds: string[]
}

type Phase = 'ask' | 'sharing' | 'failed' | 'partial'

interface Action {
  label: string
  run(): void
}

export function MentionAccessDialog({
  state,
  canShare,
  lang,
  strings,
  announce,
  onShare,
  onSendNow,
  onCancel,
}: {
  state: MentionAccessState
  /** the caller-level "may share" capability */
  canShare: boolean
  lang: string
  strings: MentionAccessStrings
  announce(text: string): void
  onShare(targetIds: string[]): void
  /** send the comment as it is (skipped people are not notified) */
  onSendNow(): void
  onCancel(): void
}): ReactNode {
  const id = useId()
  const primaryRef = useRef<HTMLButtonElement>(null)
  const modal = useModalKeys(() => {
    if (!state.sharing) onCancel()
  })

  const names = (ids: readonly string[] | null) =>
    formatMentionNames(
      state.people.filter((p) => ids === null || ids.includes(p.id)).map((p) => p.label),
      lang,
    )
  const allNames = names(null)
  const sharedNames = names(state.sharedIds)
  const failedNames = names(state.failedIds)

  const hasFailed = state.failedIds.length > 0
  const phase: Phase = state.sharing
    ? 'sharing'
    : hasFailed
      ? state.sharedIds.length > 0
        ? 'partial'
        : 'failed'
      : 'ask'
  const message =
    phase === 'partial'
      ? format(strings.collabShareViewPartial, { sharedNames, failedNames })
      : phase === 'failed'
        ? format(strings.collabShareViewFailed, { failedNames })
        : null

  // open + every state change: the buttons were re-rendered, so put focus back on the primary one
  useEffect(() => {
    if (phase !== 'sharing') primaryRef.current?.focus()
    const said = phase === 'sharing' ? strings.collabSharingView : message
    if (said) announce(said)
    // the sentence follows the phase; strings / announce are stable per render of the composer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const retryIds = state.failedIds
  let primary: Action
  let secondary: Action | null
  if (phase === 'partial') {
    primary = { label: strings.collabSendComment, run: onSendNow }
    secondary = {
      label: format(strings.collabRetryShareFor, { failedNames }),
      run: () => onShare(retryIds),
    }
  } else if (phase === 'failed') {
    primary = { label: strings.collabRetry, run: () => onShare(retryIds) }
    secondary = { label: strings.collabSendWithoutNotify, run: onSendNow }
  } else if (canShare) {
    primary = {
      label: strings.collabShareViewThenSend,
      run: () => onShare(state.people.map((p) => p.id)),
    }
    secondary = { label: strings.collabSendWithoutNotify, run: onSendNow }
  } else {
    primary = { label: strings.collabSendWithoutNotify, run: onSendNow }
    secondary = null
  }

  const guard = (run: () => void) => () => {
    if (!state.sharing) run()
  }

  return (
    <div
      className="collab-mention-warn-backdrop"
      ref={modal.ref}
      onKeyDown={modal.onKeyDown}
      tabIndex={-1}
    >
      <div
        className="collab-mention-warn"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
      >
        <h3 className="collab-mention-warn-title" id={`${id}-title`}>
          {strings.collabMentionWarnTitle}
        </h3>
        <div className="collab-mention-warn-body" id={`${id}-body`}>
          {message ? (
            <p className="collab-mention-warn-text">{message}</p>
          ) : (
            <>
              <p className="collab-mention-warn-text">
                {format(strings.collabMentionWarnBody, { names: allNames })}
              </p>
              {canShare ? null : (
                <p className="collab-mention-warn-sub">
                  {format(strings.collabMentionAskManager, { names: allNames })}
                </p>
              )}
            </>
          )}
        </div>
        <div className="collab-mention-warn-actions">
          <button
            type="button"
            ref={primaryRef}
            className="collab-composer-btn collab-composer-send"
            aria-disabled={state.sharing || undefined}
            onClick={guard(primary.run)}
          >
            {state.sharing ? (
              <>
                <span className="collab-spinner" aria-hidden="true" />
                {strings.collabSharingView}
              </>
            ) : (
              primary.label
            )}
          </button>
          {secondary ? (
            <button
              type="button"
              className="collab-composer-btn"
              aria-disabled={state.sharing || undefined}
              onClick={guard(secondary.run)}
            >
              {secondary.label}
            </button>
          ) : null}
          <button
            type="button"
            className="collab-composer-btn"
            aria-disabled={state.sharing || undefined}
            onClick={guard(onCancel)}
          >
            {strings.collabCancel}
          </button>
        </div>
      </div>
    </div>
  )
}
