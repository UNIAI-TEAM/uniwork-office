import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { currentWorkbenchBucket } from './workbench-bucket'
import { hydrateWorkbenchStore, resetWorkbenchStore } from './workbench-store-client'

/**
 * Mounts its children (Home) only once the workbench data of the signed-in
 * UniWork account (or of signed-out use) is loaded. When the account changes
 * (sign-out, sign-in, another account) the children unmount at once, so no
 * My AI chat or workbench item of the previous account stays in the DOM, and
 * mount again fresh on the new account's data.
 */
export function WorkbenchAccountGate({ children }: { children: ReactNode }) {
  // null = loading: nothing rendered
  const [bucket, setBucket] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let seq = 0
    const load = () => {
      const mine = ++seq
      setBucket(null)
      resetWorkbenchStore()
      void hydrateWorkbenchStore().then(() => {
        if (alive && mine === seq) setBucket(currentWorkbenchBucket())
      })
    }
    load()
    const off = window.aiOffice?.wb?.onBucketChanged?.(() => load())
    return () => {
      alive = false
      off?.()
    }
  }, [])

  if (bucket === null) return null
  return <Fragment key={bucket}>{children}</Fragment>
}
