import type { IpcMain } from 'electron'
import {
  UNIWORK_DOC_CHANNELS,
  type UniworkFirstSaveNameAnswer,
  type UniworkFirstSaveNameRequest,
} from '../../shared/home-api'

/**
 * What an ask ended in. `continue` / `cancel` are the person's verdict (or, for
 * `cancel`, the loss of the dialog they were looking at); `unavailable` means
 * no dialog was ever shown - there is nobody to ask, and the caller must not
 * treat it as a confirmation.
 */
export type FirstSaveNameOutcome = 'continue' | 'cancel' | 'unavailable'

/** how long the renderer has to acknowledge that the dialog is up (not how long the person has) */
const DELIVERY_MS = 5_000

/** the slice of a WebContents the broker uses (the lifecycle events are the comments panel's) */
export interface FirstSaveNameRealm {
  id: number
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
  on(event: string, listener: (...args: never[]) => void): unknown
  removeListener(event: string, listener: (...args: never[]) => void): unknown
}
type Realm = FirstSaveNameRealm

interface Pending {
  /** the WebContents that was asked: only it may answer */
  realm: Realm
  settle(outcome: FirstSaveNameOutcome): void
  /** the renderer confirmed the dialog is up */
  shown(): void
  /** main takes the ask back: settle `cancel` and tell the renderer to drop it */
  cancel(): void
}

/**
 * UNI-1959: the round trip of the "Name the document" dialog. `request` pushes
 * the ask to the shell renderer and resolves with its outcome; the renderer
 * answers through `uniwork-doc:first-save-name-answer`.
 *
 * Each ask belongs to the renderer realm it was pushed to (the same lifecycle
 * the comments panel follows): a main-frame navigation (reload), a crashed
 * render process or a destroyed WebContents settles `cancel` once, and every
 * lifecycle listener is removed on every settlement. No dialog host (no window,
 * a send that threw, or no acknowledgement within the delivery window) is the
 * explicit `unavailable` outcome; once the dialog acknowledged, the person has
 * no deadline. An answer counts only from the WebContents that was asked; an
 * unknown id (a stale dialog, a hand-typed invoke) is a no-op.
 */
export function createFirstSaveNameBroker(options: { deliveryMs?: number } = {}) {
  const deliveryMs = options.deliveryMs ?? DELIVERY_MS
  const pending = new Map<string, Pending>()

  function request(
    wc: Realm | null,
    ask: UniworkFirstSaveNameRequest,
  ): Promise<FirstSaveNameOutcome> {
    if (!wc || wc.isDestroyed()) return Promise.resolve('unavailable')
    return new Promise((resolve) => {
      const requestId = ask.requestId
      let timer: ReturnType<typeof setTimeout> | null = null
      const onNavigate = (details?: { isMainFrame?: boolean; isSameDocument?: boolean }) => {
        if (details && (!details.isMainFrame || details.isSameDocument)) return
        settle('cancel')
      }
      const onGone = () => settle('cancel')
      const events: Array<[string, (...args: never[]) => void]> = [
        ['did-start-navigation', onNavigate],
        ['did-navigate', onGone],
        ['render-process-gone', onGone],
        ['destroyed', onGone],
      ]
      const clearTimer = () => {
        if (timer) clearTimeout(timer)
        timer = null
      }
      const dismiss = () => {
        try {
          if (!wc.isDestroyed()) wc.send(UNIWORK_DOC_CHANNELS.firstSaveNameDismiss, { requestId })
        } catch {
          // the window is going away; there is no dialog left to drop
        }
      }
      const settle = (outcome: FirstSaveNameOutcome) => {
        if (pending.get(requestId)?.settle !== settle) return
        pending.delete(requestId)
        clearTimer()
        for (const [event, listener] of events) wc.removeListener(event, listener)
        resolve(outcome)
      }
      pending.set(requestId, {
        realm: wc,
        settle,
        shown: clearTimer,
        cancel: () => {
          dismiss()
          settle('cancel')
        },
      })
      try {
        for (const [event, listener] of events) wc.on(event, listener)
        wc.send(UNIWORK_DOC_CHANNELS.firstSaveName, ask)
      } catch {
        settle('unavailable')
        return
      }
      // a send into a page with no listener succeeds silently: the dialog host
      // must say it is up, or nobody is going to answer
      timer = setTimeout(() => {
        if (pending.get(requestId)?.settle !== settle) return
        dismiss()
        settle('unavailable')
      }, deliveryMs)
      ;(timer as { unref?: () => void }).unref?.()
    })
  }

  function answer(raw: unknown, sender: { id: number }): void {
    if (!raw || typeof raw !== 'object') return
    const { requestId, answer: verdict } = raw as Partial<UniworkFirstSaveNameAnswer>
    if (typeof requestId !== 'string') return
    if (verdict !== 'continue' && verdict !== 'cancel' && verdict !== 'shown') return
    const entry = pending.get(requestId)
    if (!entry || entry.realm.id !== sender.id) return
    if (verdict === 'shown') entry.shown()
    else entry.settle(verdict)
  }

  /** main takes an ask back (its tab closed, its session ended): cancel + dismiss; unknown ids are a no-op */
  function cancel(requestId: string): void {
    pending.get(requestId)?.cancel()
  }

  return { request, answer, cancel }
}

export function registerFirstSaveNameAnswer(
  ipc: Pick<IpcMain, 'handle'>,
  broker: ReturnType<typeof createFirstSaveNameBroker>,
): void {
  ipc.handle(UNIWORK_DOC_CHANNELS.firstSaveNameAnswer, (event, raw: unknown) => {
    broker.answer(raw, event.sender)
  })
}
