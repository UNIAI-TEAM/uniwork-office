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

/**
 * S11 lock panel, in the shell content area. `region` labelled by its title; the
 * host moves focus to the title (tabindex -1), so the Close button is the next
 * Tab stop. The window's alert node lives in the host, outside this keyed panel.
 */
export function UniworkLockPanel({
  lock,
  titleRef,
  onDismiss,
}: {
  lock: UniworkDocLock
  titleRef: RefObject<HTMLHeadingElement | null>
  onDismiss: (path: string) => void
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
          onClick={() => onDismiss(lock.path)}
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
 * once per newly shown lock; closing the last lock puts focus back where it was.
 */
export function UniworkLockHost({
  homeActive,
  children,
}: {
  homeActive: boolean
  children?: ReactNode
}) {
  const { t } = useI18n()
  const { locks, dismiss } = useUniworkLocks(window.aiOffice)
  const lock = shownLock(locks)
  const shownKey = lock ? pathKey(lock.path) : null
  const titleRef = useRef<HTMLHeadingElement>(null)
  const regionRef = useRef<HTMLDivElement>(null)
  /** lock keys already brought forward: a tab the user picks afterwards is not overridden */
  const activated = useRef<Set<string>>(new Set())
  /** what had focus when the first lock appeared (null = nothing usable), restored on the last Close */
  const returnFocus = useRef<{ el: HTMLElement | null } | null>(null)
  /** the path whose "{title}. {sentence}" was already written to the alert node */
  const [announcedFor, setAnnouncedFor] = useState<string | null>(null)

  // editor views paint above shell DOM: without Home in front the panel could not be seen or focused
  useEffect(() => {
    if (!shownKey || activated.current.has(shownKey)) return
    activated.current.add(shownKey)
    if (!homeActive) void window.aiOfficeTabs.activate('home').catch(() => undefined)
  }, [shownKey, homeActive])

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

  // last lock closed: the panel unmounted with focus inside it, so put focus somewhere stable
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
    const home = regionRef.current
    if (saved?.isConnected && !saved.closest('[inert]')) saved.focus()
    else home?.focus()
  }, [lock])

  const onDismiss = useCallback(
    (path: string) => {
      activated.current.delete(pathKey(path))
      dismiss(path)
    },
    [dismiss],
  )

  const alertText =
    lock && announcedFor === shownKey
      ? `${t(lockCopyOf(lock).titleKey)}. ${t(lockCopyOf(lock).bodyKey)}`
      : ''

  return (
    <>
      <div className="uw-sr-only" role="alert" data-testid="uw-lock-alert">
        {alertText}
      </div>
      <div className="uw-home-region" ref={regionRef} tabIndex={-1} inert={lock ? true : undefined}>
        {children}
      </div>
      {lock && (
        <UniworkLockPanel key={shownKey} lock={lock} titleRef={titleRef} onDismiss={onDismiss} />
      )}
    </>
  )
}
