import { useCallback, useEffect, useRef, useState } from 'react'
import {
  SIGN_OUT_RECEIPT_WAIT_MS,
  type AccountErrorCode,
  type AccountSetServerResult,
  type AccountProfile,
  type AccountState,
  type AccountStatus,
  type SignOutPlan,
} from '../../shared/home-api'
import type { StringKey } from './locale'

/** what the account UI shows: the main-process state, or `loading` before the first answer */
export type AccountView = AccountState | 'loading'

/** login-flow error, plus `launch` when main could not start the attempt at all */
export type AccountUiError = AccountErrorCode | 'launch'

export type AccountBusy = 'signing-out' | 'retrying' | 'switching' | 'connecting' | null

/** why a typed server address was not accepted */
export type ServerConnectError = Extract<AccountSetServerResult, { ok: false }>['error']

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
  // locked (transient), not missing: its own sentence (the notice title/body above already say the state)
  keystore_locked: 'acctErrKeystoreLocked',
  server_error: 'acctErrServerError',
  malformed_response: 'acctErrMalformedResponse',
}

/**
 * The view for a main-process status. server-unreachable without a profile
 * means sign-in itself could not reach UniWork (no session to keep): that is
 * a failed sign-in, shown as signed-out with the error and a Sign in button,
 * never as the "you're still signed in" session outage.
 */
export function viewOf(status: AccountStatus): AccountState {
  const state = stateOf(status)
  if (state === 'server-unreachable' && !(status.profile || status.email)) return 'signed-out'
  return state
}

/** copy for an error in this view; a sign-in that never had a session is not "no longer valid" */
export function errorKeyFor(error: AccountUiError, view: AccountView): StringKey {
  if (error === 'unauthorized' && view === 'signed-out') return ACCOUNT_ERROR_KEYS.server_error
  return ACCOUNT_ERROR_KEYS[error]
}

/**
 * Login events that reject a stray callback (wrong state, malformed URL)
 * while the real attempt goes on: shown as a passing notice, never as a
 * failed sign-in.
 */
export const CALLBACK_NOTICE_ERRORS: ReadonlySet<AccountErrorCode> = new Set([
  'state_mismatch',
  'invalid_callback',
])
export const CALLBACK_NOTICE_MS = 8000

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

/** whether signing out needs confirmation (S3): unsent saves or RAM-only working copies */
export function signOutNeedsPrompt(plan: SignOutPlan): boolean {
  return plan.count > 0 || plan.ramOnly > 0
}

/** whether the sign-out prompt shows the keychain warning variant (danger button + uwSignOutKeystore) */
export function signOutIsKeystoreVariant(plan: SignOutPlan): boolean {
  return plan.keystoreLocked && plan.ramOnly > 0
}

/**
 * FE d1-n1 / d2-2: safety ceiling (SIGN_OUT_RECEIPT_WAIT_MS + 10_000) so a missing
 * `done` push after confirming sign-out never leaves the renderer stuck waiting.
 */
export const SIGN_OUT_WAIT_SAFETY_MS = SIGN_OUT_RECEIPT_WAIT_MS + 10_000

export interface AccountController {
  status: AccountStatus | null
  view: AccountView
  /** last sign-in error worth showing (null once signed in) */
  error: AccountUiError | null
  /** the error reported by this window's own sign-in attempt (not main's status) */
  loginError: AccountUiError | null
  /** a stray sign-in link was ignored; the attempt is still live (passing notice) */
  callbackNotice: boolean
  /** pending browser sign-in URL (open again / copy) */
  loginUrl: string | null
  urlCopied: boolean
  busy: AccountBusy
  orgSwitchFailed: boolean
  /** the last typed server address failed (null once one is accepted) */
  connectError: ServerConnectError | null
  /** S3 sign-out confirmation plan when a prompt is open */
  signOutPrompt?: SignOutPlan | null
  /** true while main is waiting for an in-flight save before finishing sign-out */
  signOutWaiting?: boolean
  /** d1-2: true after a sign-out whose done event reported captureFailed > 0 */
  signOutCaptureFailed?: boolean
  signIn(): void
  cancelSignIn(): void
  openLoginUrl(): void
  copyLoginUrl(): void
  signOut(): void
  confirmSignOut?(): void
  cancelSignOut?(): void
  retry(): void
  selectOrg(orgId: string): void
  /** connect to the server at a typed address; main validates it and saves the profile */
  connectServer(address: string): void
  /** re-read the status from main (e.g. when Settings opens) */
  refresh(): void
}

/**
 * Account state for the sidebar entry and Settings → Account. Main pushes every
 * state change (onAccountStatus); the initial value comes from accountStatus().
 */
export function useAccount(options?: { ownsSignOutPrompt?: boolean }): AccountController {
  const ownsSignOutPrompt = options?.ownsSignOutPrompt ?? false
  const [status, setStatus] = useState<AccountStatus | null>(null)
  // click → accountLogin() resolved: main has not reported signing-in yet
  const [launching, setLaunching] = useState(false)
  const [localError, setLocalError] = useState<AccountUiError | null>(null)
  const [loginUrl, setLoginUrl] = useState<string | null>(null)
  const [urlCopied, setUrlCopied] = useState(false)
  const [busy, setBusy] = useState<AccountBusy>(null)
  const [orgSwitchFailed, setOrgSwitchFailed] = useState(false)
  const [connectError, setConnectError] = useState<ServerConnectError | null>(null)
  const [callbackNotice, setCallbackNotice] = useState(false)
  const [signOutPrompt, setSignOutPrompt] = useState<SignOutPlan | null>(null)
  const [signOutWaiting, setSignOutWaiting] = useState(false)
  const [signOutCaptureFailed, setSignOutCaptureFailed] = useState(false)
  const noticeTimer = useRef<number | null>(null)
  // bumped on sign-out so an in-flight status read (which can still report
  // signed-in) is discarded instead of resurrecting the profile
  const seq = useRef(0)
  // set when main reported why the current sign-in failed (more specific than `launch`)
  const loginErrorSeen = useRef(false)
  const copiedTimer = useRef<number | null>(null)
  const waitTimer = useRef<number | null>(null)
  const retrying = useRef(false)
  const signingOut = useRef(false)
  const logoutInFlight = useRef(false)
  const waitingForDone = useRef(false)
  const promptReqId = useRef<string | null>(null)

  const clearWaitTimer = useCallback(() => {
    if (waitTimer.current !== null) {
      window.clearTimeout(waitTimer.current)
      waitTimer.current = null
    }
  }, [])

  const apply = useCallback((next: AccountStatus) => {
    setStatus(next)
    const state = stateOf(next)
    if (state !== 'signing-in') {
      setLoginUrl(null)
      setCallbackNotice(false)
    }
    if (state === 'signed-in' || state === 'refreshing') {
      setLocalError(null)
      setSignOutCaptureFailed(false)
    }
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

  const startWaitTimer = useCallback(() => {
    clearWaitTimer()
    waitTimer.current = window.setTimeout(() => {
      waitTimer.current = null
      waitingForDone.current = false
      setSignOutWaiting(false)
      // FE d2-1: when renderer-initiated accountLogout() is still in flight, only clear
      // the waiting UI; leave busy/signingOut/signOutPrompt/refresh to runLogout's finally.
      if (!logoutInFlight.current) {
        signingOut.current = false
        setBusy(null)
        setSignOutPrompt(null)
        refresh()
      }
    }, SIGN_OUT_WAIT_SAFETY_MS)
  }, [clearWaitTimer, refresh])

  useEffect(() => {
    refresh()
    const offStatus = window.aiOffice.onAccountStatus?.((s) => apply(s))
    const offLogin = window.aiOffice.onAccountLogin?.((ev) => {
      if (ev.phase === 'url') {
        if (ev.url) setLoginUrl(ev.url)
      } else if (ev.phase === 'success') {
        setLocalError(null)
        setLoginUrl(null)
      } else if (ev.phase === 'error' && ev.error && CALLBACK_NOTICE_ERRORS.has(ev.error)) {
        // the attempt is still live: keep the link and the waiting state
        setCallbackNotice(true)
        if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
        noticeTimer.current = window.setTimeout(() => {
          noticeTimer.current = null
          setCallbackNotice(false)
        }, CALLBACK_NOTICE_MS)
      } else if (ev.phase === 'error') {
        loginErrorSeen.current = true
        setLaunching(false)
        setLoginUrl(null)
        setLocalError(ev.error ?? 'server_error')
      }
    })
    const offProgress = ownsSignOutPrompt
      ? window.aiOffice.onSignOutProgress?.((p) => {
          if (p.phase === 'waiting') {
            waitingForDone.current = true
            setSignOutWaiting(true)
            startWaitTimer()
          } else if (p.phase === 'done') {
            clearWaitTimer()
            waitingForDone.current = false
            setSignOutWaiting(false)
            setSignOutPrompt(null)
            setSignOutCaptureFailed((p.captureFailed ?? 0) > 0)
            // FE d1-n2: keep busy/signingOut while a renderer-initiated accountLogout() is still in flight
            if (!logoutInFlight.current) {
              signingOut.current = false
              setBusy(null)
              refresh()
            }
          }
        })
      : undefined
    const offPrompt = ownsSignOutPrompt
      ? window.aiOffice.onSignOutPrompt?.((req) => {
          if (promptReqId.current !== null) {
            const stale = promptReqId.current
            promptReqId.current = null
            void window.aiOffice.answerSignOutPrompt?.(stale, false)
          }
          clearWaitTimer()
          promptReqId.current = req.requestId
          waitingForDone.current = false
          setSignOutWaiting(false)
          setSignOutPrompt(req.plan)
        })
      : undefined
    return () => {
      offStatus?.()
      offLogin?.()
      offProgress?.()
      offPrompt?.()
      if (promptReqId.current !== null) {
        const stale = promptReqId.current
        promptReqId.current = null
        void window.aiOffice.answerSignOutPrompt?.(stale, false)
      }
      clearWaitTimer()
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    }
  }, [apply, clearWaitTimer, ownsSignOutPrompt, refresh, startWaitTimer])

  const mainState = status ? viewOf(status) : null
  const view: AccountView =
    launching && (mainState === null || needsSignIn(mainState))
      ? 'signing-in'
      : (mainState ?? 'loading')
  const error =
    view === 'signed-in' || view === 'refreshing' ? null : (localError ?? status?.error ?? null)

  const signIn = () => {
    setLocalError(null)
    setSignOutCaptureFailed(false)
    setCallbackNotice(false)
    setLoginUrl(null)
    setUrlCopied(false)
    setLaunching(true)
    loginErrorSeen.current = false
    void window.aiOffice
      .accountLogin()
      .then((launched) => {
        if (!launched && !loginErrorSeen.current) setLocalError('launch')
      })
      .catch(() => {
        if (!loginErrorSeen.current) setLocalError('launch')
      })
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
    void navigator.clipboard
      .writeText(loginUrl)
      .then(() => {
        setUrlCopied(true)
        if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
        copiedTimer.current = window.setTimeout(() => {
          copiedTimer.current = null
          setUrlCopied(false)
        }, 2000)
      })
      .catch(() => undefined)
  }

  const runLogout = () => {
    if (signingOut.current) return
    signingOut.current = true
    logoutInFlight.current = true
    seq.current++
    setBusy('signing-out')
    void window.aiOffice
      .accountLogout({ confirmed: true })
      .catch(() => undefined)
      .finally(() => {
        clearWaitTimer()
        logoutInFlight.current = false
        waitingForDone.current = false
        signingOut.current = false
        setSignOutWaiting(false)
        setSignOutPrompt(null)
        setBusy(null)
        setLocalError(null)
        // main pushes the new state too; this covers a push that raced the logout
        refresh()
      })
  }

  const signOut = () => {
    if (signingOut.current) return
    const planFn = window.aiOffice.signOutPlan
    if (!planFn) {
      runLogout()
      return
    }
    void planFn()
      .then((plan) => {
        if (!plan || !signOutNeedsPrompt(plan)) {
          runLogout()
          return
        }
        if (promptReqId.current !== null) {
          const stale = promptReqId.current
          promptReqId.current = null
          void window.aiOffice.answerSignOutPrompt?.(stale, false)
        }
        waitingForDone.current = false
        setSignOutWaiting(false)
        setSignOutPrompt(plan)
      })
      .catch(() => {
        runLogout()
      })
  }

  const confirmSignOut = () => {
    if (signingOut.current || signOutWaiting) return
    if (promptReqId.current !== null) {
      const reqId = promptReqId.current
      promptReqId.current = null
      signingOut.current = true
      setBusy('signing-out')
      if ((signOutPrompt?.waiting ?? 0) > 0) {
        waitingForDone.current = true
        setSignOutWaiting(true)
        startWaitTimer()
      }
      void Promise.resolve(window.aiOffice.answerSignOutPrompt?.(reqId, true))
        .catch(() => undefined)
        .finally(() => {
          if (waitingForDone.current) return
          clearWaitTimer()
          signingOut.current = false
          setBusy(null)
          setSignOutWaiting(false)
          setSignOutPrompt(null)
        })
      return
    }
    runLogout()
  }

  const cancelSignOut = () => {
    if (signingOut.current || signOutWaiting) return
    if (promptReqId.current !== null) {
      const reqId = promptReqId.current
      promptReqId.current = null
      void window.aiOffice.answerSignOutPrompt?.(reqId, false)
    }
    clearWaitTimer()
    waitingForDone.current = false
    setSignOutPrompt(null)
    setSignOutWaiting(false)
  }

  const retry = () => {
    // one restore at a time: a second click before the busy state renders must not start another
    if (retrying.current) return
    retrying.current = true
    setBusy('retrying')
    // an absent accountRetry (older main) resolves at once, so the busy state never sticks
    void Promise.resolve(window.aiOffice.accountRetry?.())
      .then((s) => {
        if (s) apply(s)
      })
      .catch(() => undefined)
      .finally(() => {
        retrying.current = false
        setBusy(null)
      })
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

  const connectServer = (address: string) => {
    setConnectError(null)
    setBusy('connecting')
    void window.aiOffice
      .accountSetServer?.(address)
      .then((result) => {
        if (!result) return
        apply(result.status)
        if (!result.ok) setConnectError(result.error)
      })
      .catch(() => setConnectError('unreachable'))
      .finally(() => setBusy(null))
  }

  return {
    status,
    view,
    error,
    loginError: localError,
    callbackNotice: callbackNotice && view === 'signing-in',
    loginUrl,
    urlCopied,
    busy,
    orgSwitchFailed,
    connectError,
    signOutPrompt,
    signOutWaiting,
    signOutCaptureFailed,
    signIn,
    cancelSignIn,
    openLoginUrl: () => void window.aiOffice.openLoginUrl?.(),
    copyLoginUrl,
    signOut,
    confirmSignOut,
    cancelSignOut,
    retry,
    selectOrg,
    connectServer,
    refresh,
  }
}
