import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../locale'
import { ActionToast } from '../UniworkDocActions'
import { announce } from '../uniwork-live'
import { batchEndMessage } from './folder-contents-access-model'
import { onFolderBatchSettled } from './folder-contents-access-store'

/**
 * UNI-2244: the one place the end of a background "share the documents inside a folder" run is
 * told, in a toast and (for a done run) a screen-reader line. The shell frame mounts it, so it is
 * there whichever module is up: a Documents screen that unmounted mid-run (the person went to
 * another module or switched workspace) cannot lose the end. The store tells each batch's end to
 * toast once for the life of the window; the Documents screens only refetch.
 */
export function FolderBatchEndHost() {
  const { t } = useI18n()
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)
  const clear = useCallback(() => setToast(null), [])
  // the listener is bound once; it reads the live `t` (not referentially stable)
  const latestT = useRef(t)
  useEffect(() => {
    latestT.current = t
  })
  useEffect(
    () =>
      onFolderBatchSettled((batch, end) => {
        if (!end.toast) return
        const message = batchEndMessage(latestT.current, batch)
        const tone = batch.phase === 'completed' ? 'ok' : 'error'
        // the error toast is role=alert and reads itself; only the ok toast needs the live line
        if (tone === 'ok') announce(message)
        setToast({ message, tone })
      }),
    [],
  )
  return toast ? <ActionToast message={toast.message} tone={toast.tone} onDone={clear} /> : null
}
