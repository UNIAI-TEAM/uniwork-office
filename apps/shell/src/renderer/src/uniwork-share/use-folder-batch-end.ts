import { useEffect, useRef } from 'react'
import { onFolderBatchSettled } from './folder-contents-access-store'

export interface FolderBatchEndHandlers {
  /** the run ended: the host refetches its list (every mounted host does) */
  onRefetch: () => void
}

/**
 * A screen that lists documents hears of the background runs of "share the documents inside a
 * folder" here, to refetch its list. The run itself lives in the module store, so it goes on when
 * the dialog closes or the screen unmounts; the toast and the screen-reader line are not the
 * screen's: `FolderBatchEndHost` in the shell frame says them once, whatever screen is up.
 */
export function useFolderBatchEnd(handlers: FolderBatchEndHandlers): void {
  // the listener is bound once; it reads the live handler
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })
  useEffect(() => onFolderBatchSettled(() => latest.current.onRefetch()), [])
}
