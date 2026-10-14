import { createContext, useContext, useSyncExternalStore } from 'react'
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
  /** Open / Undo / Retry; a toast without actions closes itself after AUTO_DISMISS_MS */
  actions?: readonly { label: StringKey; onClick: () => void }[]
}

interface Shown extends WbToastInput {
  id: string
}

export const AUTO_DISMISS_MS = 6000

export interface WbToasts {
  show: (toast: WbToastInput) => void
  dismiss: (id: string) => void
  subscribe: (fn: () => void) => () => void
  list: () => readonly Shown[]
}

/** the toast list of one Workbench page; the host renders it, any pane below pushes to it */
export function createWbToasts(): WbToasts {
  let shown: readonly Shown[] = []
  let seq = 0
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const fns = new Set<() => void>()
  const emit = () => fns.forEach((fn) => fn())
  const dismiss = (id: string) => {
    clearTimeout(timers.get(id))
    timers.delete(id)
    if (!shown.some((x) => x.id === id)) return
    shown = shown.filter((x) => x.id !== id)
    emit()
  }
  return {
    show: (toast) => {
      const id = toast.id ?? `t${++seq}`
      clearTimeout(timers.get(id))
      timers.delete(id)
      shown = [...shown.filter((x) => x.id !== id), { ...toast, id }]
      if (!toast.actions?.length)
        timers.set(
          id,
          setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
        )
      emit()
    },
    dismiss,
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
 * panes below, and stacks them at the bottom right of the content column.
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
  return (
    <Ctx.Provider value={toasts}>
      {children}
      <div className="wb-toast-host">
        {/* the live region is always there: a region inserted with its text is often not announced;
            a failure is its own role=alert node, which is announced on insertion */}
        <div className="wb-toast-stack" aria-live="polite">
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
                    toasts.dismiss(toast.id)
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
                onClick={() => toasts.dismiss(toast.id)}
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
