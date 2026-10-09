import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AccountErrorCode,
  AccountProfile,
  AccountState,
  AccountStatus,
} from '../../shared/home-api'
import type { StringKey } from './locale'

/** what the account UI shows: the main-process state, or `loading` before the first answer */
export type AccountView = AccountState | 'loading'

/** login-flow error, plus `launch` when main could not start the attempt at all */
export type AccountUiError = AccountErrorCode | 'launch'

export type AccountBusy = 'signing-out' | 'retrying' | 'switching' | null

/** human copy for every error the main process can report */
export const ACCOUNT_ERROR_KEYS: Record<AccountUiError, StringKey> = {
  launch: 'acctErrLaunch',
  network: 'acctErrNetwork',
  timeout: 'acctErrTimeout',
  login_timeout: 'acctErrLoginTimeout',
  cancelled: 'acctErrCancelled',
  invalid_callback: 'acctErrInvalidCallback',
  state_mismatch: 'acctErrStateMismatch',
  auth_code_invalid: 'acctErrAuthCodeInvalid',
  rate_limited: 'acctErrRateLimited',
  unauthorized: 'acctErrUnauthorized',
  device_revoked: 'acctErrDeviceRevoked',
  refresh_reused: 'acctErrRefreshReused',
  wrong_deployment: 'acctErrWrongDeployment',
  not_configured: 'acctErrNotConfigured',
  keyring_unavailable: 'acctErrKeyringUnavailable',
  server_error: 'acctErrServerError',
  malformed_response: 'acctErrMalformedResponse',
}

/** states in which the cached profile is shown */
export function showsProfile(view: AccountView, status: AccountStatus | null): boolean {
  if (view === 'signed-in' || view === 'refreshing') return true
  return view === 'server-unreachable' && !!(status?.profile || status?.email)
}

/** states whose only way forward is a fresh browser sign-in */
export function needsSignIn(view: AccountView): boolean {
  return view === 'signed-out' || view === 'session-expired' || view === 'session-revoked'
}

/** a status from a main process that predates `state` still maps onto the new states */
export function stateOf(status: AccountStatus): AccountState {
  return status.state ?? (status.loggedIn ? 'signed-in' : 'signed-out')
}

export function displayNameOf(status: AccountStatus | null): string {
  const name = status?.profile?.displayName?.trim()
  if (name) return name
  const email = status?.profile?.email || status?.email || ''
  return email.split('@')[0] ?? ''
}

/** one or two letters for the avatar: first + last word of the name, else the email */
export function initialsOf(profile: AccountProfile | undefined, email = ''): string {
  const words = (profile?.displayName ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length > 0) {
    const first = Array.from(words[0]!)[0] ?? ''
    const last = words.length > 1 ? (Array.from(words[words.length - 1]!)[0] ?? '') : ''
    return (first + last).toUpperCase()
  }
  const mail = profile?.email || email
  return mail ? (Array.from(mail)[0] ?? '?').toUpperCase() : '?'
}

export interface AccountController {
  status: AccountStatus | null
  view: AccountView
  /** last sign-in error worth showing (null once signed in) */
  error: AccountUiError | null
  /** pending browser sign-in URL (open again / copy) */
  loginUrl: string | null
  urlCopied: boolean
  busy: AccountBusy
  orgSwitchFailed: boolean
  signIn(): void
  cancelSignIn(): void
  openLoginUrl(): void
  copyLoginUrl(): void
  signOut(): void
  retry(): void
  selectOrg(orgId: string): void
  /** re-read the status from main (e.g. when Settings opens) */
  refresh(): void
}

/**
 * Account state for the sidebar entry and Settings → Account. Main pushes every
 * state change (onAccountStatus); the initial value comes from accountStatus().
 */
export function useAccount(): AccountController {
  const [status, setStatus] = useState<AccountStatus | null>(null)
  // click → accountLogin() resolved: main has not reported signing-in yet
  const [launching, setLaunching] = useState(false)
  const [localError, setLocalError] = useState<AccountUiError | null>(null)
  const [loginUrl, setLoginUrl] = useState<string | null>(null)
  const [urlCopied, setUrlCopied] = useState(false)
  const [busy, setBusy] = useState<AccountBusy>(null)
  const [orgSwitchFailed, setOrgSwitchFailed] = useState(false)
  // bumped on sign-out so an in-flight status read (which can still report
  // signed-in) is discarded instead of resurrecting the profile
  const seq = useRef(0)

  const apply = useCallback((next: AccountStatus) => {
    setStatus(next)
    const state = stateOf(next)
    if (state !== 'signing-in') setLoginUrl(null)
    if (state === 'signed-in' || state === 'refreshing') setLocalError(null)
  }, [])

  const refresh = useCallback(() => {
    const mine = seq.current
    void window.aiOffice
      .accountStatus?.()
      .then((s) => {
        if (mine === seq.current && s) apply(s)
      })
      .catch(() => undefined)
  }, [apply])

  useEffect(() => {
    refresh()
    const offStatus = window.aiOffice.onAccountStatus?.((s) => apply(s))
    const offLogin = window.aiOffice.onAccountLogin?.((ev) => {
      if (ev.phase === 'url') {
        if (ev.url) setLoginUrl(ev.url)
      } else if (ev.phase === 'success') {
        setLocalError(null)
        setLoginUrl(null)
      } else if (ev.phase === 'error') {
        setLaunching(false)
        setLoginUrl(null)
        setLocalError(ev.error ?? 'server_error')
      }
    })
    return () => {
      offStatus?.()
      offLogin?.()
    }
  }, [apply, refresh])

  const mainState = status ? stateOf(status) : null
  const view: AccountView =
    launching && (mainState === null || needsSignIn(mainState))
      ? 'signing-in'
      : (mainState ?? 'loading')
  const error =
    view === 'signed-in' || view === 'refreshing' ? null : (localError ?? status?.error ?? null)

  const signIn = () => {
    setLocalError(null)
    setLoginUrl(null)
    setUrlCopied(false)
    setLaunching(true)
    void window.aiOffice
      .accountLogin()
      .then((launched) => {
        if (!launched) setLocalError('launch')
      })
      .catch(() => setLocalError('launch'))
      .finally(() => {
        setLaunching(false)
        refresh()
      })
  }

  const cancelSignIn = () => {
    setLaunching(false)
    setLoginUrl(null)
    void window.aiOffice
      .accountCancelLogin?.()
      .catch(() => undefined)
      .finally(refresh)
  }

  const copyLoginUrl = () => {
    if (!loginUrl) return
    void navigator.clipboard.writeText(loginUrl).then(() => {
      setUrlCopied(true)
      window.setTimeout(() => setUrlCopied(false), 2000)
    })
  }

  const signOut = () => {
    seq.current++
    setBusy('signing-out')
    void window.aiOffice
      .accountLogout()
      .catch(() => undefined)
      .finally(() => {
        setBusy(null)
        setLocalError(null)
        // main pushes the new state too; this covers a push that raced the logout
        refresh()
      })
  }

  const retry = () => {
    setBusy('retrying')
    void window.aiOffice
      .accountRetry?.()
      .then((s) => {
        if (s) apply(s)
      })
      .catch(() => undefined)
      .finally(() => setBusy(null))
  }

  const selectOrg = (orgId: string) => {
    setOrgSwitchFailed(false)
    setBusy('switching')
    void window.aiOffice
      .accountSelectOrg?.(orgId)
      .then((s) => {
        if (s) apply(s)
      })
      .catch(() => setOrgSwitchFailed(true))
      .finally(() => setBusy(null))
  }

  return {
    status,
    view,
    error,
    loginUrl,
    urlCopied,
    busy,
    orgSwitchFailed,
    signIn,
    cancelSignIn,
    openLoginUrl: () => void window.aiOffice.openLoginUrl?.(),
    copyLoginUrl,
    signOut,
    retry,
    selectOrg,
    refresh,
  }
}
