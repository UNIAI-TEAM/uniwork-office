import type { IpcMain, WebContents } from 'electron'
import {
  UNIWORK_DOC_CHANNELS,
  type UniworkFirstSaveNameAnswer,
  type UniworkFirstSaveNameRequest,
} from '../../shared/home-api'

/**
 * UNI-1959: the round trip of the "Name the document" dialog. `request` pushes
 * the ask to the shell renderer and resolves with its verdict; the renderer
 * answers through `uniwork-doc:first-save-name-answer`. No shell window (or a
 * send that threw) resolves `continue` at once - the save is never lost to a
 * missing dialog host - and a window that goes away with the dialog open
 * resolves `cancel` (nothing was confirmed). An answer for an unknown id (a
 * stale dialog, a hand-typed invoke) is a no-op.
 */
export function createFirstSaveNameBroker() {
  const pending = new Map<string, (answer: 'continue' | 'cancel') => void>()

  function request(
    wc: Pick<WebContents, 'isDestroyed' | 'send' | 'once'> | null,
    ask: UniworkFirstSaveNameRequest,
  ): Promise<'continue' | 'cancel'> {
    if (!wc || wc.isDestroyed()) return Promise.resolve('continue')
    return new Promise((resolve) => {
      const settle = (answer: 'continue' | 'cancel') => {
        if (pending.delete(ask.requestId)) resolve(answer)
      }
      pending.set(ask.requestId, settle)
      try {
        wc.send(UNIWORK_DOC_CHANNELS.firstSaveName, ask)
        wc.once('destroyed', () => settle('cancel'))
      } catch {
        settle('continue')
      }
    })
  }

  function answer(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return
    const { requestId, answer: verdict } = raw as Partial<UniworkFirstSaveNameAnswer>
    if (typeof requestId !== 'string') return
    if (verdict !== 'continue' && verdict !== 'cancel') return
    pending.get(requestId)?.(verdict)
  }

  return { request, answer }
}

export function registerFirstSaveNameAnswer(
  ipc: Pick<IpcMain, 'handle'>,
  broker: ReturnType<typeof createFirstSaveNameBroker>,
): void {
  ipc.handle(UNIWORK_DOC_CHANNELS.firstSaveNameAnswer, (_event, raw: unknown) => {
    broker.answer(raw)
  })
}
