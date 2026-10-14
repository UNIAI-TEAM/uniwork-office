import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { useI18n, type StringKey, type TFunc } from './locale'
import { WbGlyph } from './WorkbenchIcons'

/** a key (translated at render, so a language switch applies) or text from elsewhere (a server error) */
export type WbToastText = { key: StringKey; params?: Parameters<TFunc>[1] } | { text: string }

export interface WbToastInput {
  /** a toast with the same id replaces the one on screen (one failing write, one tool result) */
  id?: string
  message: WbToastText
  /** `alert` for failures; `status` (default) for results and notices */
  tone?: 'status' | 'alert'
  /** Open / Undo / Retry; such a toast lives ACTION_DISMISS_MS, one without actions AUTO_DISMISS_MS */
  actions?: readonly { label: StringKey; onClick: () => void }[]
}

interface Shown extends WbToastInput {
  id: string
}

export const AUTO_DISMISS_MS = 6000
/** long enough to reach Undo / Retry by keyboard; the clock stops while the stack is hovered or focused */
export const ACTION_DISMISS_MS = 10_000
/** the newest toasts kept on screen; an older one gives way (spec 1.6: they never pile over the page) */
export const MAX_TOASTS = 3

export interface WbToasts {
  show: (toast: WbToastInput) => void
  dismiss: (id: string) => void
  /** hover or focus in the stack: every toast's clock stops until `resume` */
  pause: () => void
  resume: () => void
  subscribe: (fn: () => void) => () => void
  list: () => readonly Shown[]
}

/** the toast list of one Workbench page; the host renders it, any pane below pushes to it */
export function createWbToasts(): WbToasts {
  let shown: readonly Shown[] = []
  let seq = 0
  let paused = false
  // per toast: the time it has left, and since when that clock runs
  const clocks = new Map<
    string,
    { left: number; since: number; timer?: ReturnType<typeof setTimeout> }
  >()
  const fns = new Set<() => void>()
  const emit = () => fns.forEach((fn) => fn())
  const stop = (id: string) => {
    clearTimeout(clocks.get(id)?.timer)
    clocks.delete(id)
  }
  const run = (id: string) => {
    const c = clocks.get(id)
    if (!c) return
    c.since = Date.now()
    c.timer = setTimeout(() => dismiss(id), c.left)
  }
  const dismiss = (id: string) => {
    stop(id)
    if (!shown.some((x) => x.id === id)) return
    shown = shown.filter((x) => x.id !== id)
    emit()
  }
  return {
    show: (toast) => {
      const id = toast.id ?? `t${++seq}`
      stop(id)
      shown = [...shown.filter((x) => x.id !== id), { ...toast, id }]
      for (const old of shown.slice(0, -MAX_TOASTS)) stop(old.id)
      shown = shown.slice(-MAX_TOASTS)
      clocks.set(id, {
        left: toast.actions?.length ? ACTION_DISMISS_MS : AUTO_DISMISS_MS,
        since: 0,
      })
      if (!paused) run(id)
      emit()
    },
    dismiss,
    pause: () => {
      if (paused) return
      paused = true
      for (const c of clocks.values()) {
        clearTimeout(c.timer)
        c.left = Math.max(0, c.left - (Date.now() - c.since))
      }
    },
    resume: () => {
      if (!paused) return
      paused = false
      for (const id of clocks.keys()) run(id)
    },
    subscribe: (fn) => {
      fns.add(fn)
      return () => fns.delete(fn)
    },
    list: () => shown,
  }
}

// outside a host (a pane rendered on its own) toasts go nowhere
const Ctx = createContext<WbToasts>(createWbToasts())

/** the toasts of the Workbench page this pane sits in */
export function useWbToast(): WbToasts {
  return useContext(Ctx)
}

/**
 * The single Workbench toast host (redesign spec 2.3): provides `toasts` to the
 * panes below, and stacks them at the bottom right of the content column. The stack
 * takes real room at the end of the page, so scrolling down always uncovers what it hid.
 */
export function WbToastHost({
  toasts,
  children,
}: {
  toasts: WbToasts
  children?: ReactNode
}): ReactElement {
  const { t } = useI18n()
  const shown = useSyncExternalStore(toasts.subscribe, toasts.list)
  const text = (m: WbToastText) => ('key' in m ? t(m.key, m.params) : m.text)
  const stackRef = useRef<HTMLDivElement>(null)
  const hovered = useRef(false)
  // where the focus was before it entered the stack: a closing toast hands it back there
  const before = useRef<HTMLElement | null>(null)
  const close = (id: string) => {
    const back = before.current
    if (stackRef.current?.contains(document.activeElement) && back?.isConnected) {
      back.focus({ preventScroll: true })
    }
    toasts.dismiss(id)
  }
  // the clocks run again once neither the pointer nor the focus is in the stack
  const settle = () => {
    const focused = stackRef.current?.contains(document.activeElement) ?? false
    if (hovered.current || focused) toasts.pause()
    else toasts.resume()
  }
  // a closed toast can take the focus with it, and no blur says so
  useEffect(() => {
    // the last toast closed under a still pointer: no mouseleave follows
    if (!shown.length) hovered.current = false
    if (!hovered.current && !stackRef.current?.contains(document.activeElement)) toasts.resume()
  }, [shown, toasts])
  return (
    <Ctx.Provider value={toasts}>
      {children}
      <div className="wb-toast-host">
        {/* the live region is always there: a region inserted with its text is often not announced;
            a failure is its own role=alert node, which is announced on insertion */}
        <div
          ref={stackRef}
          className="wb-toast-stack"
          aria-live="polite"
          onMouseEnter={() => {
            hovered.current = true
            settle()
          }}
          onMouseLeave={() => {
            hovered.current = false
            settle()
          }}
          onFocus={(e) => {
            const from = e.relatedTarget
            if (from instanceof HTMLElement && !stackRef.current?.contains(from)) {
              before.current = from
            }
            settle()
          }}
          // focus is still on the old element during blur: decide once it has moved
          onBlur={() => setTimeout(settle)}
        >
          {shown.map((toast) => (
            <div
              key={toast.id}
              className="wb-toast"
              role={toast.tone === 'alert' ? 'alert' : undefined}
            >
              <span className="wb-toast-text">{text(toast.message)}</span>
              {toast.actions?.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className="wb-link"
                  onClick={() => {
                    close(toast.id)
                    a.onClick()
                  }}
                >
                  {t(a.label)}
                </button>
              ))}
              <button
                type="button"
                className="wb-icon-btn wb-toast-close"
                aria-label={t('wbOvDismiss')}
                title={t('wbOvDismiss')}
                onClick={() => close(toast.id)}
              >
                <WbGlyph id="close" size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </Ctx.Provider>
  )
}
