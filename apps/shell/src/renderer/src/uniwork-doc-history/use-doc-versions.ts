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
  // a reload and a page read each have their own sequence: a page read must never cancel the
  // reload a checkpoint or a restore just started (its new row would never show)
  const reloadSeq = useRef(0)
  const moreSeq = useRef(0)
  const reloading = useRef(false)
  const cursorRef = useRef<string | null>(null)
  cursorRef.current = cursor

  const reload = useCallback(() => {
    const mine = ++reloadSeq.current
    reloading.current = true
    // the first page replaces the list: a page read in flight belongs to the old one
    moreSeq.current++
    setLoadingMore(false)
    setMoreFailed(false)
    // Retry after a failed first read shows the loading state again
    setStatus((now) => (now === 'error' ? 'loading' : now))
    void bridge
      .versions({ documentId })
      .catch((): DocHistoryResult<DocVersionPage> => ({ ok: false, error: 'network' }))
      .then((result) => {
        if (mine !== reloadSeq.current) return
        reloading.current = false
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
      reloadSeq.current++
      moreSeq.current++
      reloading.current = false
    }
  }, [enabled, reload])

  const loadMore = useCallback(() => {
    const next = cursorRef.current
    if (!next || reloading.current) return
    const mine = ++moreSeq.current
    setLoadingMore(true)
    setMoreFailed(false)
    void bridge
      .versions({ documentId, cursor: next })
      .catch((): DocHistoryResult<DocVersionPage> => ({ ok: false, error: 'network' }))
      .then((result) => {
        if (mine !== moreSeq.current) return
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
