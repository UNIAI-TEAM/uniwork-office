import { useLayoutEffect, useRef, type RefObject } from 'react'
import { useI18n } from './locale'
import { signOutIsKeystoreVariant, type AccountController } from './account-model'
import type { SignOutPlan } from '../../shared/home-api'

/** puts focus back on the opener, or on it once it is mounted again */
function restoreFocus(returnFocusRef: RefObject<HTMLElement | null>): void {
  if (returnFocusRef.current?.isConnected) {
    returnFocusRef.current.focus()
  } else {
    queueMicrotask(() => {
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus()
    })
  }
}

/**
 * Q2 = a: the notice after an account switch already locked the previous
 * account and RAM-only content of it was lost. Nothing can be cancelled any
 * more, so it has a single acknowledge button (focused on open; Escape does
 * the same) and focus goes back to `returnFocusRef` when it closes.
 */
function SignOutNotice({
  account,
  plan,
  returnFocusRef,
}: {
  account: AccountController
  plan: SignOutPlan
  returnFocusRef: RefObject<HTMLElement | null>
}) {
  const { t } = useI18n()
  const okBtnRef = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    okBtnRef.current?.focus()
    return () => restoreFocus(returnFocusRef)
  }, [returnFocusRef])

  return (
    <div
      className="set-intg-confirm acct-signout-confirm"
      role="alertdialog"
      aria-labelledby="acct-switch-lost-title"
      aria-describedby="acct-switch-lost-body"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        e.stopPropagation()
        account.acknowledgeSignOutNotice?.()
      }}
    >
      <div className="set-field-stack">
        <div className="set-field-label" id="acct-switch-lost-title">
          {t('uwSwitchLostTitle')}
        </div>
        <div className="set-field-desc" id="acct-switch-lost-body">
          {t('uwSwitchLostBody', { count: plan.ramOnly })}
        </div>
      </div>
      <div className="set-btn-row">
        <button
          ref={okBtnRef}
          type="button"
          className="set-btn primary"
          onClick={() => account.acknowledgeSignOutNotice?.()}
        >
          {t('uwSwitchLostOk')}
        </button>
      </div>
    </div>
  )
}

/**
 * S3 sign-out confirmation alertdialog. Renders nothing when `account.signOutPrompt`
 * is null; focuses Quay lại on open and restores focus to `returnFocusRef.current`
 * on every non-confirm close (Quay lại, Escape, or external dismissal). With no
 * prompt open it shows the account-switch notice (`account.signOutNotice`).
 */
export function SignOutPrompt({
  account,
  returnFocusRef,
}: {
  account: AccountController
  returnFocusRef: RefObject<HTMLElement | null>
}) {
  const { t } = useI18n()
  const signOutPrompt = account.signOutPrompt ?? null
  const signOutWaiting = Boolean(account.signOutWaiting)
  const signOutBusy = signOutWaiting || account.busy === 'signing-out'
  const backBtnRef = useRef<HTMLButtonElement>(null)
  const promptWasOpen = useRef(false)
  const confirmingSignOut = useRef(false)

  useLayoutEffect(() => {
    if (signOutPrompt) {
      promptWasOpen.current = true
      confirmingSignOut.current = false
      backBtnRef.current?.focus()
    } else if (promptWasOpen.current) {
      promptWasOpen.current = false
      const shouldRestore = !confirmingSignOut.current
      confirmingSignOut.current = false
      if (shouldRestore) {
        restoreFocus(returnFocusRef)
      }
    }
  }, [signOutPrompt, returnFocusRef])

  useLayoutEffect(
    () => () => {
      if (promptWasOpen.current && !confirmingSignOut.current) restoreFocus(returnFocusRef)
      promptWasOpen.current = false
      confirmingSignOut.current = false
    },
    [returnFocusRef],
  )

  if (!signOutPrompt) {
    const notice = account.signOutNotice ?? null
    return notice ? (
      <SignOutNotice account={account} plan={notice} returnFocusRef={returnFocusRef} />
    ) : null
  }

  const keystoreVariant = signOutIsKeystoreVariant(signOutPrompt)

  return (
    <div
      className="set-intg-confirm acct-signout-confirm"
      role="alertdialog"
      aria-labelledby="acct-signout-title"
      aria-describedby="acct-signout-body"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        e.stopPropagation()
        if (signOutBusy) return
        account.cancelSignOut?.()
      }}
    >
      <div className="set-field-stack">
        <div className="set-field-label" id="acct-signout-title">
          {t('uwSignOutTitle')}
        </div>
        <div className="set-field-desc" id="acct-signout-body">
          {keystoreVariant
            ? t('uwSignOutKeystore')
            : t('uwSignOutBody', { count: signOutPrompt.count })}
        </div>
        <div className="set-field-desc acct-signout-wait" role="status" aria-live="polite">
          {signOutWaiting ? t('uwSignOutWaiting') : null}
        </div>
      </div>
      <div className="set-btn-row">
        <button
          ref={backBtnRef}
          type="button"
          className="set-btn primary"
          autoFocus
          onClick={() => {
            if (signOutBusy) return
            account.cancelSignOut?.()
          }}
        >
          {t('uwActBack')}
        </button>
        <button
          type="button"
          className={`set-btn${keystoreVariant ? ' danger' : ''}`}
          aria-disabled={signOutBusy ? true : undefined}
          aria-busy={signOutBusy ? true : undefined}
          onClick={() => {
            if (signOutBusy) return
            confirmingSignOut.current = true
            ;(account.confirmSignOut ?? account.signOut)()
          }}
        >
          {t('uwSignOutGo')}
        </button>
      </div>
    </div>
  )
}
