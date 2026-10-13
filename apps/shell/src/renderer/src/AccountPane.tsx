import { Dropdown } from '@genoffice/ui'
import type { ReactNode } from 'react'
import { ServerConnect } from './ServerConnect'
import { useI18n } from './locale'
import type { StringKey } from './locale'
import {
  displayNameOf,
  errorKeyFor,
  initialsOf,
  showsProfile,
  type AccountController,
  type AccountView,
} from './account-model'

/** banner copy for the states that need an explanation */
const NOTICE: Partial<
  Record<AccountView, { title: StringKey; body: StringKey; tone: 'info' | 'warn' }>
> = {
  'signed-out': { title: 'acctSignedOutTitle', body: 'acctSignedOutBody', tone: 'info' },
  'signing-in': { title: 'acctSigningIn', body: 'acctSigningInHint', tone: 'info' },
  'session-expired': { title: 'acctExpiredTitle', body: 'acctExpiredBody', tone: 'warn' },
  'session-revoked': { title: 'acctRevokedTitle', body: 'acctRevokedBody', tone: 'warn' },
  'server-unreachable': {
    title: 'acctUnreachableTitle',
    body: 'acctUnreachableBody',
    tone: 'warn',
  },
  'wrong-deployment': { title: 'acctWrongServerTitle', body: 'acctWrongServerBody', tone: 'warn' },
  // no server chosen yet: the connect screen (the address field sits below)
  'not-configured': { title: 'acctConnectTitle', body: 'acctConnectBody', tone: 'info' },
  'keyring-unavailable': { title: 'acctKeyringTitle', body: 'acctKeyringBody', tone: 'warn' },
  // the keychain exists but is locked: nothing was lost, unlock it and retry
  'keystore-locked': { title: 'uwLockKeystoreTitle', body: 'uwLockKeystore', tone: 'warn' },
}

/** states whose notice body is the whole explanation (the error code would repeat it) */
const SELF_EXPLAINED: ReadonlySet<AccountView> = new Set([
  'session-expired',
  'session-revoked',
  'not-configured',
  'keyring-unavailable',
  'keystore-locked',
  'wrong-deployment',
])

/** whether the error line adds something to the state's notice */
function showsErrorLine(account: AccountController): boolean {
  const { error, view } = account
  if (!error || error === 'cancelled') return false
  // a sign-in the user just tried from here failed: say so, even if the notice explains the state
  if (view === 'keyring-unavailable' || view === 'keystore-locked') {
    return account.loginError === error
  }
  // the outage notice already says to check the connection
  if (view === 'server-unreachable' && error === 'network') return false
  return !SELF_EXPLAINED.has(view)
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="set-field">
      <div className="set-field-text">
        <div className="set-field-label">{label}</div>
        <div className="set-field-value">{children}</div>
      </div>
    </div>
  )
}

/** Settings → Account: the UniWork account block (language picker and license panes stay in SettingsModal) */
export function AccountPane({ account }: { account: AccountController }) {
  const { t } = useI18n()
  const { status, view, error, busy } = account
  const profile = status?.profile
  const email = profile?.email || status?.email || ''
  const name = displayNameOf(status)
  const orgs = status?.orgs ?? []
  const server = status?.serverOrigin || t('acctThisServer')
  const notice = NOTICE[view]
  // the saved server did not answer: name it and offer the address field
  const unreachable =
    view === 'server-unreachable' ||
    (view === 'signed-out' && (error === 'network' || error === 'timeout'))
  const canChangeServer = view !== 'signing-in' && view !== 'loading'
  const withProfile = showsProfile(view, status)
  // a cancelled attempt was the user's own choice, not a failure worth a red line;
  // states whose notice body already says it all get no repeated error line
  const errorText = error && showsErrorLine(account) ? t(errorKeyFor(error, view)) : null

  const signOutBtn = (
    <button
      type="button"
      className="set-btn danger"
      disabled={busy === 'signing-out'}
      onClick={account.signOut}
    >
      {busy === 'signing-out' ? t('acctSigningOut') : t('acctSignOut')}
    </button>
  )
  const signInBtn = (label: StringKey) => (
    <button type="button" className="set-btn primary" onClick={account.signIn}>
      {t(label)}
    </button>
  )
  const retryBtn = (
    <button
      type="button"
      className="set-btn"
      aria-disabled={busy === 'retrying' ? true : undefined}
      aria-busy={busy === 'retrying' ? true : undefined}
      onClick={account.retry}
    >
      {busy === 'retrying' ? t('acctRetrying') : t('acctRetry')}
    </button>
  )

  let actions: ReactNode = null
  switch (view) {
    case 'signed-out':
      actions = signInBtn('acctSignIn')
      break
    case 'session-expired':
    case 'session-revoked':
      actions = signInBtn('acctSignInAgain')
      break
    case 'signing-in':
      actions = (
        <>
          <button type="button" className="set-btn" onClick={account.cancelSignIn}>
            {t('acctCancel')}
          </button>
          {account.loginUrl && (
            <>
              <button type="button" className="set-btn" onClick={account.openLoginUrl}>
                {t('acctOpenAgain')}
              </button>
              <button type="button" className="set-btn" onClick={account.copyLoginUrl}>
                {account.urlCopied ? t('acctLinkCopied') : t('acctCopyLink')}
              </button>
            </>
          )}
        </>
      )
      break
    case 'server-unreachable':
      actions = (
        <>
          {signOutBtn}
          <button
            type="button"
            className="set-btn primary"
            aria-disabled={busy === 'retrying' ? true : undefined}
            aria-busy={busy === 'retrying' ? true : undefined}
            onClick={account.retry}
          >
            {busy === 'retrying' ? t('acctRetrying') : t('acctRetry')}
          </button>
        </>
      )
      break
    case 'wrong-deployment':
      actions = (
        <>
          {signOutBtn}
          {signInBtn('acctSignInAgain')}
        </>
      )
      break
    case 'keyring-unavailable':
      // Retry reads the stored sign-in again (keyring unlocked meanwhile);
      // signing in again replaces one this computer can no longer decrypt
      actions = (
        <>
          {retryBtn}
          {signInBtn('acctSignInAgain')}
        </>
      )
      break
    case 'keystore-locked':
      // Retry re-reads the stored sign-in once the keychain is unlocked; signing in
      // again is refused while locked (it would overwrite the saved sign-in), so
      // there is no second button
      actions = retryBtn
      break
    case 'signed-in':
    case 'refreshing':
      actions = signOutBtn
      break
    // not-configured / loading: nothing the user can press here
  }

  return (
    <section className="acct-pane" aria-labelledby="acct-pane-title" data-state={view}>
      <h4 className="acct-heading" id="acct-pane-title">
        {t('acctTitle')}
      </h4>
      {withProfile && (
        <div className="acct-card">
          <span className="acct-card-avatar" aria-hidden="true">
            {initialsOf(profile, email)}
          </span>
          <span className="acct-card-text">
            <span className="acct-card-name">{name}</span>
            {email && <span className="acct-card-email">{email}</span>}
          </span>
          {view === 'refreshing' && (
            <span className="acct-card-sync" role="status">
              <span className="acct-dot-spinner" aria-hidden="true" />
              {t('acctRefreshing')}
            </span>
          )}
        </div>
      )}

      {notice && (
        <div
          className={`acct-notice ${notice.tone}`}
          role={notice.tone === 'warn' ? 'alert' : 'status'}
        >
          {view === 'signing-in' && <span className="acct-dot-spinner" aria-hidden="true" />}
          <div className="acct-notice-text">
            <div className="acct-notice-title">{t(notice.title)}</div>
            <div className="acct-notice-body">{t(notice.body, { server })}</div>
            {account.callbackNotice && (
              <div className="acct-notice-error" role="alert">
                {t('acctCallbackMismatch')}
              </div>
            )}
            {errorText && <div className="acct-notice-error">{errorText}</div>}
          </div>
        </div>
      )}

      {withProfile && (
        <>
          <Row label={t('acctOrg')}>
            {orgs.length > 1 ? (
              <Dropdown
                className="set-dd acct-org-dd"
                value={status?.org?.id ?? orgs[0]!.id}
                ariaLabel={t('acctSwitchOrg')}
                tip={t('acctSwitchOrg')}
                disabled={busy === 'switching' || view === 'server-unreachable'}
                options={orgs.map((o) => ({ value: o.id, label: o.name }))}
                onPick={(id) => {
                  if (id !== status?.org?.id) account.selectOrg(id)
                }}
              />
            ) : (
              (status?.org?.name ?? orgs[0]?.name ?? '—')
            )}
          </Row>
          {account.orgSwitchFailed && (
            <div className="acct-inline-error" role="alert">
              {t('acctSwitchOrgFailed')}
            </div>
          )}
          <Row label={t('acctPlan')}>{status?.entitlements?.planName || t('acctNoPlan')}</Row>
        </>
      )}
      {status?.serverOrigin && view !== 'not-configured' && (
        <Row label={t('acctServer')}>{status.serverOrigin}</Row>
      )}

      {canChangeServer && (
        <ServerConnect
          key={view === 'not-configured' || unreachable ? 'open' : 'closed'}
          account={account}
          startOpen={view === 'not-configured' || unreachable}
          unreachableServer={unreachable ? server : null}
        />
      )}
      {actions && <div className="set-pane-footer acct-actions">{actions}</div>}
    </section>
  )
}
