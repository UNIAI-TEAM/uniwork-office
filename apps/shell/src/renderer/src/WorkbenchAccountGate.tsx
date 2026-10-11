import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { useI18n } from './locale'
import { currentWorkbenchBucket } from './workbench-bucket'
import {
  hydrateWorkbenchStore,
  isWorkbenchLoadFailed,
  resetWorkbenchStore,
} from './workbench-store-client'

/** waits before the 2nd and 3rd attempt at a load that failed */
export const LOAD_RETRY_DELAYS_MS: readonly number[] = [800, 2000]

/**
 * Mounts its children (Home) only once the workbench data of the signed-in
 * UniWork account (or of signed-out use) is loaded. When the account changes
 * (sign-out, sign-in, another account) the children unmount at once, so no
 * My AI chat or workbench item of the previous account stays in the DOM, and
 * mount again fresh on the new account's data.
 *
 * A load that fails is tried again a couple of times; if it still fails the
 * store stays closed (never another account's copy) and a quiet notice with a
 * retry button sits above Home, since nothing is saved until a load works.
 */
export function WorkbenchAccountGate({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  // null = loading: nothing rendered
  const [bucket, setBucket] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    let seq = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () => {
      const mine = ++seq
      clearTimeout(timer)
      setBucket(null)
      setFailed(false)
      resetWorkbenchStore()
      const attempt = (n: number) => {
        void hydrateWorkbenchStore().then(() => {
          if (!alive || mine !== seq) return
          const retryIn = LOAD_RETRY_DELAYS_MS[n]
          if (isWorkbenchLoadFailed() && retryIn !== undefined) {
            timer = setTimeout(() => attempt(n + 1), retryIn)
            return
          }
          setFailed(isWorkbenchLoadFailed())
          setBucket(currentWorkbenchBucket())
        })
      }
      attempt(0)
    }
    load()
    const off = window.aiOffice?.wb?.onBucketChanged?.(() => load())
    return () => {
      alive = false
      clearTimeout(timer)
      off?.()
    }
  }, [reloadKey])

  if (bucket === null) return null
  if (!failed) return <Fragment key={bucket}>{children}</Fragment>
  // the notice is a bar above Home that Home shrinks for, so it never covers the composer
  return (
    <div className="wb-gate-failed" key={bucket}>
      <div className="wb-load-failed" role="alert">
        <div className="acct-notice-text">
          <div className="acct-notice-title">{t('wbLoadFailedTitle')}</div>
          <div className="acct-notice-body">{t('wbLoadFailedBody')}</div>
        </div>
        <button type="button" className="set-btn" onClick={() => setReloadKey((k) => k + 1)}>
          {t('acctRetry')}
        </button>
      </div>
      {children}
    </div>
  )
}
