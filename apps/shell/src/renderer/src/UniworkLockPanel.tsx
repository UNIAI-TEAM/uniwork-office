import { useCallback, useEffect, useRef, useState } from 'react'
import type { UniworkDocLock } from '../../shared/home-api'
import { useI18n } from './locale'
import { pathKey } from './uniwork-docs-model'
import { lockCopyOf, mergeLocks, shownLock, withoutLock } from './uniwork-lock-model'

type LockApi = Pick<Window['aiOffice'], 'onUniworkLock' | 'uniworkLocks' | 'dismissUniworkLock'>

/**
 * Locks main currently shows: the pushed ones, plus the ones read on mount (a
 * reload of the shell window must not lose a panel). A lock dismissed while the
 * mount read is in flight stays dismissed.
 */
export function useUniworkLocks(api: LockApi): {
  locks: UniworkDocLock[]
  dismiss: (path: string) => void
} {
  const [locks, setLocks] = useState<UniworkDocLock[]>([])
  const dismissedWhileReading = useRef<Set<string> | null>(new Set())

  useEffect(() => {
    let live = true
    const off = api.onUniworkLock((lock) => {
      dismissedWhileReading.current?.delete(pathKey(lock.path))
      setLocks((prev) => mergeLocks(prev, [lock]))
    })
    void api
      .uniworkLocks()
      .then((initial) => {
        if (!live) return
        const skipped = dismissedWhileReading.current
        const keep = initial.filter((lock) => !skipped?.has(pathKey(lock.path)))
        setLocks((prev) => mergeLocks(keep, prev))
      })
      .catch(() => undefined)
      .finally(() => {
        dismissedWhileReading.current = null
      })
    return () => {
      live = false
      off()
    }
  }, [api])

  const dismiss = useCallback(
    (path: string) => {
      dismissedWhileReading.current?.add(pathKey(path))
      setLocks((prev) => withoutLock(prev, path))
      void api.dismissUniworkLock(path).catch(() => undefined)
    },
    [api],
  )

  return { locks, dismiss }
}

/**
 * S11 lock panel, in the shell content area. `region` labelled by its title; when it
 * appears the sentence goes once to the window's alert node and focus moves to
 * the title (tabindex -1), so the Close button is the next Tab stop.
 */
export function UniworkLockPanel({
  lock,
  homeActive,
  onDismiss,
}: {
  lock: UniworkDocLock
  /** the panel only paints (and can take focus) while the Home area is the visible one */
  homeActive: boolean
  onDismiss: (path: string) => void
}) {
  const { t } = useI18n()
  const copy = lockCopyOf(lock)
  const titleRef = useRef<HTMLHeadingElement>(null)
  /** the path whose "{title}. {sentence}" was already written to the alert node */
  const [announcedFor, setAnnouncedFor] = useState<string | null>(null)
  const key = pathKey(lock.path)

  useEffect(() => {
    if (!homeActive) return
    titleRef.current?.focus()
    setAnnouncedFor(key)
  }, [key, homeActive])

  return (
    <>
      <div className="uw-sr-only" role="alert" data-testid="uw-lock-alert">
        {announcedFor === key ? `${t(copy.titleKey)}. ${t(copy.bodyKey)}` : ''}
      </div>
      <div className="uw-lock-layer">
        <section className="uw-lock-panel" role="region" aria-labelledby="uw-lock-title">
          <svg
            className="uw-lock-icon"
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <rect x="4" y="9" width="12" height="8" rx="2" />
            <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
          </svg>
          <h3 id="uw-lock-title" className="uw-lock-title" tabIndex={-1} ref={titleRef}>
            {t(copy.titleKey)}
          </h3>
          <p className="uw-lock-body">{t(copy.bodyKey)}</p>
          <button
            type="button"
            className="btn btn-primary uw-lock-action"
            onClick={() => onDismiss(lock.path)}
          >
            {t(copy.actionKey)}
          </button>
        </section>
      </div>
    </>
  )
}

/** mount point: the newest lock's panel over the Home area; brings Home forward when an editor tab is active */
export function UniworkLockHost({ homeActive }: { homeActive: boolean }) {
  const { locks, dismiss } = useUniworkLocks(window.aiOffice)
  const lock = shownLock(locks)
  const shownKey = lock ? pathKey(lock.path) : null

  // editor views paint above shell DOM: without Home in front the panel could not be seen or focused
  useEffect(() => {
    if (!shownKey || homeActive) return
    void window.aiOfficeTabs.activate('home').catch(() => undefined)
  }, [shownKey, homeActive])

  if (!lock) return null
  return <UniworkLockPanel key={shownKey} lock={lock} homeActive={homeActive} onDismiss={dismiss} />
}
