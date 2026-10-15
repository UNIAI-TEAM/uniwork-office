import { useLayoutEffect, useRef, type RefObject } from 'react'
import { useI18n } from './locale'
import { signOutIsKeystoreVariant, type AccountController } from './account-model'

/**
 * S3 sign-out confirmation alertdialog. Renders nothing when `account.signOutPrompt`
 * is null; focuses Quay lại on open and restores focus to `returnFocusRef.current`
 * on every non-confirm close (Quay lại, Escape, or external dismissal).
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
        if (returnFocusRef.current?.isConnected) {
          returnFocusRef.current.focus()
        } else {
          queueMicrotask(() => {
            if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus()
          })
        }
      }
    }
  }, [signOutPrompt, returnFocusRef])

  useLayoutEffect(
    () => () => {
      if (promptWasOpen.current && !confirmingSignOut.current) {
        if (returnFocusRef.current?.isConnected) {
          returnFocusRef.current.focus()
        } else {
          queueMicrotask(() => {
            if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus()
          })
        }
      }
      promptWasOpen.current = false
      confirmingSignOut.current = false
    },
    [returnFocusRef],
  )

  if (!signOutPrompt) return null

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
