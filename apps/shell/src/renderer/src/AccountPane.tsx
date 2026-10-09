import { Dropdown } from '@genoffice/ui'
import type { ReactNode } from 'react'
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
  'not-configured': {
    title: 'acctNotConfiguredTitle',
    body: 'acctNotConfiguredBody',
    tone: 'info',
  },
  'keyring-unavailable': { title: 'acctKeyringTitle', body: 'acctKeyringBody', tone: 'warn' },
}

/** states whose notice body is the whole explanation (the error code would repeat it) */
const SELF_EXPLAINED: ReadonlySet<AccountView> = new Set([
  'session-expired',
  'session-revoked',
  'not-configured',
  'keyring-unavailable',
  'wrong-deployment',
])

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
  const withProfile = showsProfile(view, status)
  // a cancelled attempt was the user's own choice, not a failure worth a red line;
  // states whose notice body already says it all get no repeated error line
  const errorText =
    error && error !== 'cancelled' && !SELF_EXPLAINED.has(view) ? t(errorKeyFor(error, view)) : null

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
            disabled={busy === 'retrying'}
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
    case 'signed-in':
    case 'refreshing':
      actions = signOutBtn
      break
    // not-configured / keyring-unavailable / loading: nothing the user can press here
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

      {actions && <div className="set-pane-footer acct-actions">{actions}</div>}
    </section>
  )
}
