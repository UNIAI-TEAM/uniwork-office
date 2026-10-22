import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DOC_ACCESS_LOG_PAGE_SIZE,
  type DocAccessLog,
  type DocAccessLogAction,
  type DocAccessLogPage,
  type DocHistoryResult,
  type UniworkDocHistoryApi,
} from '../../../shared/doc-history-api'

export interface AccessLogsState {
  status: 'loading' | 'ready' | 'error' | 'forbidden'
  rows: DocAccessLog[]
  hasMore: boolean
  /** the next page is on its way */
  loadingMore: boolean
  /** the next page failed: the rows stay, the button stays */
  moreFailed: boolean
  retry: () => void
  loadMore: () => void
}

/** a bridge call that rejects (a handler that threw, a channel the main side lacks) reads as offline */
const rejected = (): DocHistoryResult<DocAccessLogPage> => ({ ok: false, error: 'network' })

/**
 * The access log of one document under one action filter, newest first. A change of document or
 * filter starts over from the first page; an answer of an earlier request is dropped. `forbidden`
 * is the server's own "not a manager" (the level dropped while the sheet was open).
 */
export function useAccessLogs(
  api: UniworkDocHistoryApi | null,
  documentId: string,
  action: '' | DocAccessLogAction,
  enabled: boolean,
): AccessLogsState {
  const [status, setStatus] = useState<AccessLogsState['status']>('loading')
  const [rows, setRows] = useState<DocAccessLog[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreFailed, setMoreFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // the request the screen currently waits for; a late answer of another one is ignored
  const current = useRef(0)
  const moreInFlight = useRef(false)

  useEffect(() => {
    if (!enabled) return
    const mine = ++current.current
    moreInFlight.current = false
    setStatus('loading')
    setRows([])
    setCursor(null)
    setLoadingMore(false)
    setMoreFailed(false)
    if (!api) {
      setStatus('error')
      return
    }
    void api
      .accessLogs({ documentId, limit: DOC_ACCESS_LOG_PAGE_SIZE, action })
      .catch(rejected)
      .then((result) => {
        if (current.current !== mine) return
        if (result.ok) {
          setRows(result.value.logs)
          setCursor(result.value.next_cursor)
          setStatus('ready')
        } else {
          setStatus(result.error === 'forbidden' ? 'forbidden' : 'error')
        }
      })
  }, [api, documentId, action, enabled, attempt])

  const loadMore = useCallback(() => {
    if (!api || !cursor || moreInFlight.current) return
    const mine = current.current
    moreInFlight.current = true
    setLoadingMore(true)
    setMoreFailed(false)
    void api
      .accessLogs({ documentId, limit: DOC_ACCESS_LOG_PAGE_SIZE, action, cursor })
      .catch(rejected)
      .then((result) => {
        if (current.current !== mine) return
        moreInFlight.current = false
        setLoadingMore(false)
        if (result.ok) {
          setRows((previous) => [...previous, ...result.value.logs])
          setCursor(result.value.next_cursor)
        } else {
          setMoreFailed(true)
        }
      })
  }, [api, cursor, documentId, action])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return { status, rows, hasMore: cursor !== null, loadingMore, moreFailed, retry, loadMore }
}
