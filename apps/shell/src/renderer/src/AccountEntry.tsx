import { useEffect } from 'react'
import type { AccountStatus } from '../../shared/home-api'
import { useI18n } from './locale'
import type { StringKey } from './locale'
import {
  ACCOUNT_ERROR_KEYS,
  displayNameOf,
  initialsOf,
  needsSignIn,
  showsProfile,
  useAccount,
  type AccountView,
} from './account-model'
import { SettingsModal, type SettingsSectionId, type SettingsTarget } from './SettingsModal'

/** sidebar sub-line for the states that need attention */
const STATE_SUB: Partial<Record<AccountView, StringKey>> = {
  'session-expired': 'acctExpiredShort',
  'session-revoked': 'acctRevokedShort',
  'server-unreachable': 'acctUnreachableTitle',
  'wrong-deployment': 'acctWrongServerShort',
  'not-configured': 'acctNotConfiguredShort',
  'keyring-unavailable': 'acctKeyringShort',
}

const WARN_STATES: ReadonlySet<AccountView> = new Set([
  'session-expired',
  'session-revoked',
  'server-unreachable',
  'wrong-deployment',
  'keyring-unavailable',
])

function Spinner() {
  return (
    <svg className="account-spinner" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeDasharray="26"
        strokeDashoffset="18"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * Sidebar UniWork account entry (bottom-left). Signed out / expired / revoked:
 * a click starts the browser sign-in. Every other state opens Settings →
 * Account, where the details and actions for that state live. Owns the
 * Settings modal so the account controller is shared by both.
 */
export function AccountEntry({
  onStatusChange,
  settingsOpen,
  settingsSection,
  onOpenSettings,
  onCloseSettings,
  skillUpdate,
  onSkillUpdateDue,
  onFileSearchSettingsChange,
  target,
}: {
  onStatusChange?: (status: AccountStatus | null) => void
  settingsOpen: boolean
  settingsSection: SettingsSectionId
  onOpenSettings: (section?: SettingsSectionId) => void
  onCloseSettings: () => void
  skillUpdate: boolean
  onSkillUpdateDue: (due: boolean) => void
  onFileSearchSettingsChange?: () => void
  /** open on this section / block (e.g. the home list's rerank button) */
  target?: SettingsTarget | null
}) {
  const { t } = useI18n()
  const account = useAccount()
  const { status, view, error } = account

  useEffect(() => {
    onStatusChange?.(status)
  }, [status, onStatusChange])

  const withProfile = showsProfile(view, status)
  const email = status?.profile?.email || status?.email || ''
  const name = withProfile || view === 'wrong-deployment' ? displayNameOf(status) : ''
  const signInFirst = needsSignIn(view)

  let label: string
  if (view === 'signing-in') label = t('acctSigningIn')
  else if (view === 'signed-out') label = t('acctSignIn')
  else if (signInFirst) label = t('acctSignInAgain')
  else label = name || t('acctTitle')

  let sub: string | null = null
  const stateSub = STATE_SUB[view]
  if (stateSub) sub = t(stateSub)
  else if (withProfile) {
    sub = [status?.org?.name, status?.entitlements?.planName].filter(Boolean).join(' · ') || null
  } else if (view === 'signed-out' && error && error !== 'cancelled') {
    sub = t(ACCOUNT_ERROR_KEYS[error])
  }
  const warn = WARN_STATES.has(view) || (view === 'signed-out' && sub !== null)

  const tip =
    view === 'signing-in'
      ? t('acctSigningInHint')
      : signInFirst
        ? t('acctSignInUniwork')
        : withProfile
          ? t('acctSignedInAs', { name: email || name })
          : t('acctOpenSettings')

  const handleClick = () => {
    if (signInFirst) {
      account.signIn()
      return
    }
    account.refresh()
    onOpenSettings('account')
  }

  return (
    <div className="account-entry">
      {settingsOpen && (
        <SettingsModal
          account={account}
          onClose={onCloseSettings}
          onFileSearchChange={onFileSearchSettingsChange}
          skillUpdateDue={skillUpdate}
          onSkillUpdateDue={onSkillUpdateDue}
          initialSection={settingsSection}
          target={target}
        />
      )}
      <button
        type="button"
        className="account-btn"
        data-state={view}
        onClick={handleClick}
        aria-haspopup={signInFirst ? undefined : 'dialog'}
        aria-expanded={signInFirst ? undefined : settingsOpen}
        data-tip={tip}
      >
        <span
          className={`account-avatar${withProfile ? ' logged-in' : ''}${view === 'signing-in' ? ' waiting' : ''}`}
          aria-hidden="true"
        >
          {view === 'signing-in' ? (
            <Spinner />
          ) : withProfile ? (
            initialsOf(status?.profile, email)
          ) : (
            '?'
          )}
          {warn && <span className="account-state-dot" />}
        </span>
        <span className="account-text">
          <span className={`account-name${withProfile ? '' : ' wrap'}`}>{label}</span>
          {sub && (
            <span
              className={`account-sub${withProfile && !stateSub ? '' : ' wrap'}${warn ? ' warn' : ''}${view === 'refreshing' ? ' refreshing' : ''}`}
            >
              {sub}
            </span>
          )}
        </span>
      </button>
    </div>
  )
}
