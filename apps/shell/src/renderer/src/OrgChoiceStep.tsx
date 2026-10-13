import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useI18n } from './locale'
import {
  allOrgsBlocked,
  firstSelectableOrg,
  moveOrgChoice,
  orgBlockKey,
  roleLabel,
  type OrgChoiceRow,
} from './uniwork-docs-model'

/** the radio row of an organization (ids are server data, so no selector built from them) */
function rowOf(group: HTMLElement | null, id: string): HTMLElement | undefined {
  return Array.from(group?.querySelectorAll<HTMLElement>('[data-org]') ?? []).find(
    (el) => el.dataset.org === id,
  )
}

/**
 * The organization step after sign-in (account in several organizations, no
 * remembered choice). Nothing is picked for the user: the radio group starts
 * with no checked row, focus lands on the first row that can be chosen, and
 * Continue stays aria-disabled until a row is checked. Rows the user cannot
 * work in stay visible with their reason.
 */
export function OrgChoiceStep({
  orgs,
  rememberedGone,
  busy,
  failed,
  onChoose,
  onSignOut,
}: {
  orgs: OrgChoiceRow[]
  rememberedGone: boolean
  busy: boolean
  failed: boolean
  onChoose: (orgId: string) => void
  onSignOut: () => void
}) {
  const { t } = useI18n()
  const [choice, setChoice] = useState<string | null>(null)
  const groupRef = useRef<HTMLDivElement>(null)
  const firstId = firstSelectableOrg(orgs)
  // the roving tab stop: the checked row, else the first one that can be chosen
  const tabStop = choice ?? firstId
  const blocked = allOrgsBlocked(orgs)

  useEffect(() => {
    if (blocked || !firstId) return
    rowOf(groupRef.current, firstId)?.focus()
    // focus once when the step appears, not on every status push
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked])

  if (blocked) {
    return (
      <div className="acct-notice warn uw-org-blocked" role="alert">
        <div className="acct-notice-text">
          <div className="acct-notice-title">{t('uwLockOrgTitle')}</div>
          <div className="acct-notice-body">{t('uwOrgAllBlocked')}</div>
        </div>
        <button type="button" className="set-btn danger" onClick={onSignOut}>
          {t('acctSignOut')}
        </button>
      </div>
    )
  }

  const pick = (id: string) => {
    if (orgBlockKey(orgs.find((o) => o.id === id)) !== null) return
    setChoice(id)
    rowOf(groupRef.current, id)?.focus()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = (event.target as HTMLElement).dataset.org ?? tabStop ?? null
    const step =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 'next'
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? 'prev'
          : null
    if (step) {
      // radio group pattern: arrows move the focus and the choice together
      event.preventDefault()
      const next = moveOrgChoice(orgs, current, step)
      if (next) pick(next)
      return
    }
    if (event.key !== ' ' && event.key !== 'Enter') return
    event.preventDefault()
    // Enter on the checked row continues; otherwise Space/Enter checks the focused row
    if (event.key === 'Enter' && choice && choice === current) {
      if (!busy) onChoose(choice)
    } else if (current) {
      pick(current)
    }
  }

  const canContinue = choice !== null && !busy

  return (
    <div className="uw-org-step" aria-labelledby="uw-org-title" role="group">
      <div className="uw-org-head">
        <h5 className="uw-org-title" id="uw-org-title">
          {t('uwOrgPickTitle')}
        </h5>
        <p className="uw-org-body" id="uw-org-body">
          {t('uwOrgPickBody')}
        </p>
        {rememberedGone && (
          <p className="uw-org-gone" role="status">
            {t('uwOrgPickRememberedGone')}
          </p>
        )}
      </div>
      <div
        className="uw-org-list"
        role="radiogroup"
        aria-labelledby="uw-org-title"
        aria-describedby="uw-org-body"
        ref={groupRef}
        onKeyDown={onKeyDown}
      >
        {orgs.map((org) => {
          const reasonKey = orgBlockKey(org)
          const checked = org.id === choice
          const reasonId = `uw-org-reason-${org.id}`
          return (
            <div
              key={org.id}
              role="radio"
              data-org={org.id}
              aria-checked={checked}
              aria-disabled={reasonKey ? true : undefined}
              aria-describedby={reasonKey ? reasonId : undefined}
              tabIndex={org.id === tabStop && !reasonKey ? 0 : -1}
              className={`uw-org-row${checked ? ' checked' : ''}${reasonKey ? ' locked' : ''}`}
              onClick={() => pick(org.id)}
            >
              <span className="uw-org-radio" aria-hidden="true" />
              <span className="uw-org-text">
                <span className="uw-org-name">{org.name}</span>
                {reasonKey ? (
                  <span className="uw-org-reason" id={reasonId}>
                    {t(reasonKey)}
                  </span>
                ) : (
                  org.role && (
                    <span className="uw-org-role">
                      {t('uwOrgPickRole', { role: roleLabel(org.role, t) })}
                    </span>
                  )
                )}
              </span>
            </div>
          )
        })}
      </div>
      {failed && (
        <div className="acct-inline-error" role="alert">
          {t('acctSwitchOrgFailed')}
        </div>
      )}
      <div className="uw-org-actions">
        <button type="button" className="set-btn" onClick={onSignOut}>
          {t('acctSignOut')}
        </button>
        <button
          type="button"
          className="set-btn primary"
          aria-disabled={!canContinue}
          onClick={() => {
            if (choice && !busy) onChoose(choice)
          }}
        >
          {busy ? <span className="acct-dot-spinner" aria-hidden="true" /> : null}
          {t('uwOrgPickContinue')}
        </button>
      </div>
    </div>
  )
}
