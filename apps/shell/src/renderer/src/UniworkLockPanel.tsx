import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import type { UniworkDocLock } from '../../shared/home-api'
import { useI18n } from './locale'
import { pathKey } from './uniwork-docs-model'
import { lockCopyOf, mergeLocks, shownLock, withoutLock } from './uniwork-lock-model'

type LockApi = Pick<
  Window['aiOffice'],
  'onUniworkLock' | 'onUniworkLocksChanged' | 'uniworkLocks' | 'dismissUniworkLock'
>

/**
 * Locks main currently shows: the pushed ones, plus the ones read from main. The
 * list is read on mount (a reload of the shell window must not lose a panel) and
 * again whenever the signed-in account changes (the signal the workbench gate
 * reloads Home on): the new list REPLACES the old one, because main forgets the
 * previous account's locks without sending an event. A lock pushed or dismissed
 * while a read is in flight is not overwritten by it. `onPush` hears every pushed
 * lock: a push counts as the lock newly shown, even when it is already listed.
 * Main also pushes the whole list when a lock clears on its own (the keychain
 * unlocked and the store opened): that list REPLACES this one and outranks a read
 * still in flight, which may have been answered before the lock cleared.
 */
export function useUniworkLocks(
  api: LockApi,
  onPush?: (lock: UniworkDocLock) => void,
): {
  locks: UniworkDocLock[]
  dismiss: (path: string) => void
  /** read the list again (a retry that races the store open can still see the lock; main pushes the cleared list) */
  refresh: () => void
} {
  const [locks, setLocks] = useState<UniworkDocLock[]>([])
  /** what happened while the latest read was in flight (null = no read in flight) */
  const reading = useRef<{ dismissed: Set<string>; pushed: UniworkDocLock[] } | null>(null)
  const readSeq = useRef(0)
  const readRef = useRef<() => void>(() => undefined)
  const onPushRef = useRef(onPush)
  onPushRef.current = onPush

  useEffect(() => {
    let live = true
    const readLocks = () => {
      const mine = ++readSeq.current
      const during = { dismissed: new Set<string>(), pushed: [] as UniworkDocLock[] }
      reading.current = during
      void api
        .uniworkLocks()
        .catch((): UniworkDocLock[] => [])
        .then((fresh) => {
          if (!live || mine !== readSeq.current) return
          reading.current = null
          const keep = fresh.filter((lock) => !during.dismissed.has(pathKey(lock.path)))
          setLocks(mergeLocks(keep, during.pushed))
        })
    }
    const offPush = api.onUniworkLock((lock) => {
      const during = reading.current
      if (during) {
        during.dismissed.delete(pathKey(lock.path))
        during.pushed = mergeLocks(during.pushed, [lock])
      }
      onPushRef.current?.(lock)
      setLocks((prev) => mergeLocks(prev, [lock]))
    })
    const offChanged = api.onUniworkLocksChanged?.((next) => {
      const during = reading.current
      // a read answered before this list was built is stale now; what the user closed meanwhile stays closed
      const keep = during ? next.filter((lock) => !during.dismissed.has(pathKey(lock.path))) : next
      readSeq.current++
      reading.current = null
      setLocks(mergeLocks([], keep))
    })
    const offAccount = window.aiOffice?.wb?.onBucketChanged?.(readLocks)
    readRef.current = readLocks
    readLocks()
    return () => {
      live = false
      reading.current = null
      offPush()
      offChanged?.()
      offAccount?.()
    }
  }, [api])

  const dismiss = useCallback(
    (path: string) => {
      const during = reading.current
      if (during) {
        during.dismissed.add(pathKey(path))
        during.pushed = withoutLock(during.pushed, path)
      }
      setLocks((prev) => withoutLock(prev, path))
      void api.dismissUniworkLock(path).catch(() => undefined)
    },
    [api],
  )

  const refresh = useCallback(() => readRef.current(), [])

  return { locks, dismiss, refresh }
}

/** input types that take no typed text: focusing past them cannot eat a keystroke */
const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

/** true while the user could be typing into the element (a key still on its way would land there) */
function isEditable(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(el.type)
  if (el instanceof HTMLTextAreaElement) return true
  return el.closest('[contenteditable]:not([contenteditable="false"])') !== null
}

/** the element exists in the layout and is not hidden (`checkVisibility` is Chromium's; elsewhere only `hidden` is checked) */
function isVisible(el: HTMLElement): boolean {
  if (el.closest('[hidden]')) return false
  return typeof el.checkVisibility === 'function' ? el.checkVisibility() : true
}

/** the Home targets focus can land on after the last lock closes, best first */
const HOME_FOCUS_TARGETS = ['h1', 'main, [role="main"]', 'nav, aside']

/**
 * Focus Home's main heading, else its first landmark, with a visible ring. They are
 * not focusable by themselves: tabindex -1 and the ring marker last only until the
 * element loses focus again, so Home's own focus behavior is unchanged.
 */
function focusHomeTarget(region: HTMLElement | null): void {
  if (!region) return
  for (const selector of HOME_FOCUS_TARGETS) {
    const target = Array.from(region.querySelectorAll<HTMLElement>(selector)).find(isVisible)
    if (!target) continue
    const addedTabIndex = !target.hasAttribute('tabindex')
    if (addedTabIndex) target.setAttribute('tabindex', '-1')
    target.setAttribute('data-uw-focus-fallback', '')
    target.addEventListener(
      'blur',
      () => {
        target.removeAttribute('data-uw-focus-fallback')
        if (addedTabIndex) target.removeAttribute('tabindex')
      },
      { once: true },
    )
    target.focus()
    return
  }
}

/**
 * S11 lock panel, in the shell content area. `region` labelled by its title; the
 * host moves focus to the title (tabindex -1), so the Close button is the next
 * Tab stop. The window's alert node lives in the host, outside this keyed panel.
 */
export function UniworkLockPanel({
  lock,
  titleRef,
  onDismiss,
  onRetry,
  retrying = false,
}: {
  lock: UniworkDocLock
  titleRef: RefObject<HTMLHeadingElement | null>
  onDismiss: (path: string) => void
  onRetry?: () => void
  /** the retry is in flight: its button waits (a second click would restore the account again) */
  retrying?: boolean
}) {
  const { t } = useI18n()
  const copy = lockCopyOf(lock)

  return (
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
          disabled={copy.action === 'retry' && retrying}
          aria-busy={copy.action === 'retry' && retrying ? true : undefined}
          onClick={() => (copy.action === 'retry' ? onRetry?.() : onDismiss(lock.path))}
        >
          {t(copy.actionKey)}
        </button>
      </section>
    </div>
  )
}

/**
 * Wraps the Home area (`children`) and mounts the newest lock's panel over it.
 * While a lock is shown the Home subtree is `inert` (the panel replaces the area:
 * nothing behind it is focusable or in the a11y tree); the window's single
 * `role=alert` node sits outside both. An editor tab in front is switched to Home
 * once per newly shown lock; closing the last lock puts focus back where it was,
 * or on Home's heading when that is gone.
 */
export function UniworkLockHost({
  homeActive,
  children,
}: {
  homeActive: boolean
  children?: ReactNode
}) {
  const { t } = useI18n()
  /** lock keys already brought forward: a tab the user picks afterwards is not overridden */
  const activated = useRef<Set<string>>(new Set())
  // a push of a lock that is already listed is newly shown again: Home comes forward again
  const { locks, dismiss, refresh } = useUniworkLocks(window.aiOffice, (pushed) =>
    activated.current.delete(pathKey(pushed.path)),
  )
  const lock = shownLock(locks)
  // Retry (keystore locked): the account re-reads the keychain; main pushes the cleared list once the
  // store opens, which can come after this re-read. One retry at a time: the ref also covers a second click
  // that lands before the busy state has rendered.
  const [retrying, setRetrying] = useState(false)
  const retryRunning = useRef(false)
  const retry = useCallback(() => {
    if (retryRunning.current) return
    retryRunning.current = true
    setRetrying(true)
    void (window.aiOffice.accountRetry?.() ?? Promise.resolve())
      .catch(() => undefined)
      .finally(() => {
        retryRunning.current = false
        setRetrying(false)
        refresh()
      })
  }, [refresh])
  const shownKey = lock ? pathKey(lock.path) : null
  const titleRef = useRef<HTMLHeadingElement>(null)
  const regionRef = useRef<HTMLDivElement>(null)
  /** what had focus when the first lock appeared (null = nothing usable), restored on the last Close */
  const returnFocus = useRef<{ el: HTMLElement | null } | null>(null)
  /** the path whose "{title}. {sentence}" was already written to the alert node */
  const [announcedFor, setAnnouncedFor] = useState<string | null>(null)

  // a lock that left the list (Close, or the account changed) is forgotten: shown again later = newly shown
  useEffect(() => {
    const listed = new Set(locks.map((entry) => pathKey(entry.path)))
    for (const key of activated.current) if (!listed.has(key)) activated.current.delete(key)
  }, [locks])

  // editor views paint above shell DOM: without Home in front the panel could not be seen or focused
  useEffect(() => {
    if (!shownKey || activated.current.has(shownKey)) return
    activated.current.add(shownKey)
    if (!homeActive) void window.aiOfficeTabs.activate('home').catch(() => undefined)
    // `lock`: a re-push replaces the object, which is what re-runs this after the push cleared its key
  }, [shownKey, homeActive, lock])

  // Layout effect: the browser drops focus from a field that turns inert in its next
  // rendering step, so what was focused (and whether it was being typed in) is read first.
  useLayoutEffect(() => {
    if (!shownKey || !homeActive) return
    const active = document.activeElement
    const typing = isEditable(active)
    if (!returnFocus.current) {
      const usable =
        active instanceof HTMLElement &&
        active !== document.body &&
        !active.closest('.uw-lock-layer')
      returnFocus.current = { el: usable ? active : null }
    }
    setAnnouncedFor(shownKey)
    const focusTitle = () => titleRef.current?.focus()
    if (!typing) {
      focusTitle()
      return
    }
    // typing: the alert is written now, focus follows the current keystroke
    const frame = requestAnimationFrame(focusTitle)
    return () => cancelAnimationFrame(frame)
  }, [shownKey, homeActive])

  // last lock closed: the panel unmounted with focus inside it, so put focus somewhere visible
  const wasShown = useRef(false)
  useEffect(() => {
    if (lock) {
      wasShown.current = true
      return
    }
    if (!wasShown.current) return
    wasShown.current = false
    const saved = returnFocus.current?.el
    returnFocus.current = null
    // focus that already went somewhere (the user moved on) is left alone
    if (document.activeElement && document.activeElement !== document.body) return
    if (saved?.isConnected && !saved.closest('[inert]') && isVisible(saved)) saved.focus()
    else focusHomeTarget(regionRef.current)
  }, [lock])

  const alertText =
    lock && announcedFor === shownKey
      ? `${t(lockCopyOf(lock).titleKey)}. ${t(lockCopyOf(lock).bodyKey)}`
      : ''

  return (
    <>
      <div className="uw-sr-only" role="alert" data-testid="uw-lock-alert">
        {alertText}
      </div>
      <div className="uw-home-region" ref={regionRef} inert={lock ? true : undefined}>
        {children}
      </div>
      {lock && (
        <UniworkLockPanel
          key={shownKey}
          lock={lock}
          titleRef={titleRef}
          onDismiss={dismiss}
          onRetry={retry}
          retrying={retrying}
        />
      )}
    </>
  )
}
