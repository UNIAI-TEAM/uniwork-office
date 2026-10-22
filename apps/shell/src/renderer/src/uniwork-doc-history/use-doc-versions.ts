import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DocHistoryResult,
  DocVersion,
  DocVersionPage,
  UniworkDocHistoryApi,
} from '../../../shared/doc-history-api'

export interface DocVersionsState {
  /** the first page: reading, in, or failed with nothing to show */
  status: 'loading' | 'ready' | 'error'
  rows: DocVersion[]
  /** more pages follow */
  hasMore: boolean
  loadingMore: boolean
  /** the last Load more failed; the rows read so far stay */
  moreFailed: boolean
  loadMore: () => void
  /** read the first page again (after Retry, a checkpoint, a restore); the rows stay until it lands */
  reload: () => void
}

/**
 * The versions of one document, newest first, paged with the server's cursor like the web's
 * infinite query. Nothing is asked until `enabled`; an answer of an older request (another
 * document, a reload that was overtaken) is dropped.
 */
export function useDocVersions(
  bridge: UniworkDocHistoryApi,
  documentId: string,
  enabled: boolean,
): DocVersionsState {
  const [status, setStatus] = useState<DocVersionsState['status']>('loading')
  const [rows, setRows] = useState<DocVersion[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreFailed, setMoreFailed] = useState(false)
  const sequence = useRef(0)
  const cursorRef = useRef<string | null>(null)
  cursorRef.current = cursor

  const reload = useCallback(() => {
    const mine = ++sequence.current
    setLoadingMore(false)
    setMoreFailed(false)
    // Retry after a failed first read shows the loading state again
    setStatus((now) => (now === 'error' ? 'loading' : now))
    void bridge
      .versions({ documentId })
      .catch((): DocHistoryResult<DocVersionPage> => ({ ok: false, error: 'network' }))
      .then((result) => {
        if (mine !== sequence.current) return
        if (!result.ok) {
          // a failed refresh keeps what is on screen; only an empty screen turns into the error
          setStatus((now) => (now === 'ready' ? now : 'error'))
          return
        }
        setRows(result.value.versions)
        setCursor(result.value.next_cursor)
        setStatus('ready')
      })
  }, [bridge, documentId])

  useEffect(() => {
    if (!enabled) return
    setStatus('loading')
    setRows([])
    setCursor(null)
    reload()
    return () => {
      sequence.current++
    }
  }, [enabled, reload])

  const loadMore = useCallback(() => {
    const next = cursorRef.current
    if (!next) return
    const mine = ++sequence.current
    setLoadingMore(true)
    setMoreFailed(false)
    void bridge
      .versions({ documentId, cursor: next })
      .catch((): DocHistoryResult<DocVersionPage> => ({ ok: false, error: 'network' }))
      .then((result) => {
        if (mine !== sequence.current) return
        setLoadingMore(false)
        if (!result.ok) {
          setMoreFailed(true)
          return
        }
        setRows((prev) => [...prev, ...result.value.versions])
        setCursor(result.value.next_cursor)
      })
  }, [bridge, documentId])

  return { status, rows, hasMore: !!cursor, loadingMore, moreFailed, loadMore, reload }
}
