import { useEffect, useRef } from 'react'
import { useI18n } from '../locale'
import { announce } from '../uniwork-live'
import { batchEndMessage } from './folder-contents-access-model'
import { onFolderBatchSettled } from './folder-contents-access-store'

export interface FolderBatchEndHandlers {
  /** the end of a background run in words, once for the whole window (the newest host raises it) */
  onToast: (message: string, tone: 'ok' | 'error') => void
  /** the run ended: the host refetches its list (every mounted host does) */
  onRefetch: () => void
}

/**
 * A screen that lists documents hears of the background runs of "share the documents inside a
 * folder" here. The run itself lives in the module store, so it goes on when the dialog closes;
 * every mounted host refetches at its end, but the toast and the screen-reader line come once.
 */
export function useFolderBatchEnd(handlers: FolderBatchEndHandlers): void {
  const { t } = useI18n()
  // the listener is bound once; it reads the live handlers and the live `t` (not referentially stable)
  const latest = useRef({ handlers, t })
  useEffect(() => {
    latest.current = { handlers, t }
  })
  useEffect(
    () =>
      onFolderBatchSettled((batch, end) => {
        const { handlers: live, t: liveT } = latest.current
        live.onRefetch()
        if (!end.toast) return
        const message = batchEndMessage(liveT, batch)
        const tone = batch.phase === 'completed' ? 'ok' : 'error'
        announce(message, { assertive: tone === 'error' })
        live.onToast(message, tone)
      }),
    [],
  )
}
