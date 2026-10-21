// Small hooks of the Share dialog over `UniworkShareApi`. No query library: each read keeps the
// last answer while it reloads, a mutation's caller reloads what it changed, and a stale answer
// (the document changed, the dialog closed) is dropped by a sequence number.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ShareAccess,
  ShareAccessRequest,
  ShareCandidate,
  ShareErrorCode,
  ShareResult,
  UniworkShareApi,
} from '../../../shared/share-api'

export interface ShareQuery<T> {
  /** `loading`: first answer pending; `error`: the last attempt failed (the old data, if any, stays) */
  status: 'idle' | 'loading' | 'ready' | 'error'
  data: T | undefined
  error: ShareErrorCode | undefined
  /** reload; resolves once the new answer is in */
  refetch: () => Promise<void>
}

/** one read of the bridge; `key` changes (or `enabled` turns on) start a new load */
function useShareQuery<T>(
  load: () => Promise<ShareResult<T>>,
  key: string,
  enabled: boolean,
): ShareQuery<T> {
  const loadRef = useRef(load)
  loadRef.current = load
  const sequence = useRef(0)
  const [state, setState] = useState<{
    status: ShareQuery<T>['status']
    data: T | undefined
    error: ShareErrorCode | undefined
  }>({ status: 'idle', data: undefined, error: undefined })

  const run = useCallback(async () => {
    const mine = ++sequence.current
    setState((s) => ({ ...s, status: s.data === undefined ? 'loading' : s.status }))
    let result: ShareResult<T>
    try {
      result = await loadRef.current()
    } catch {
      result = { ok: false, error: 'network' }
    }
    if (mine !== sequence.current) return
    setState((s) =>
      result.ok
        ? { status: 'ready', data: result.value, error: undefined }
        : { status: 'error', data: s.data, error: result.error },
    )
  }, [])

  useEffect(() => {
    if (!enabled) return
    setState({ status: 'idle', data: undefined, error: undefined })
    void run()
    return () => {
      sequence.current++
    }
  }, [enabled, key, run])

  return { ...state, refetch: run }
}

/** the access overview of one document (a manager's grants, or a reader's own level) */
export function useShareAccess(
  api: UniworkShareApi,
  documentId: string,
  enabled: boolean,
): ShareQuery<ShareAccess> {
  return useShareQuery(() => api.get(documentId), documentId, enabled)
}

/** the organization's public-link policy; unknown (undefined) when the account may not read it */
export function useShareSettings(api: UniworkShareApi, enabled: boolean): boolean | undefined {
  const query = useShareQuery(() => api.settings(), 'settings', enabled)
  return query.data?.publicLinksEnabled
}

/** the pending access requests; `null` data = the server has no such route */
export function useAccessRequests(
  api: UniworkShareApi,
  documentId: string,
  enabled: boolean,
): ShareQuery<ShareAccessRequest[] | null> {
  return useShareQuery(() => api.requests(documentId), documentId, enabled)
}

/** pages of the member walk (50 per page) after which the walk stops with a "limit" line */
const MAX_DIRECTORY_PAGES = 40
const DIRECTORY_PAGE_SIZE = 50

/**
 * Why the directory is not whole: `first` = no page arrived, `partial` = a later page failed (the
 * walk stopped there), `limit` = the page bound was hit with a cursor left. Only the first two
 * can be retried.
 */
export type ShareDirectoryError = 'first' | 'partial' | 'limit'

export interface ShareDirectory {
  rows: readonly ShareCandidate[]
  loading: boolean
  /** a name that is missing may sit on a page not loaded yet: not "unknown" */
  namesPending: boolean
  error: ShareDirectoryError | null
  retry: () => void
  userName: (userId: string) => string | undefined
  workspaceName: (workspaceId: string) => string | undefined
}

/**
 * Names for the people and workspaces that appear in the access list. The bridge has no member
 * call, so the unfiltered candidate list (which carries every person, workspace and the
 * organization, with their display names) is read page after page while the dialog is open.
 */
export function useShareDirectory(
  api: UniworkShareApi,
  documentId: string,
  enabled: boolean,
): ShareDirectory {
  const [rows, setRows] = useState<ShareCandidate[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [pages, setPages] = useState(0)
  const [failed, setFailed] = useState<'first' | 'partial' | null>(null)
  const [fetching, setFetching] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const sequence = useRef(0)

  useEffect(() => {
    if (!enabled) return
    sequence.current++
    setRows([])
    setCursor(null)
    setPages(0)
    setFailed(null)
    setAttempt((n) => n + 1)
  }, [enabled, documentId])

  // walk: fetch the page at `cursor` (null = first) while one is wanted
  const wanted =
    enabled && failed === null && pages < MAX_DIRECTORY_PAGES && (pages === 0 || !!cursor)
  useEffect(() => {
    if (!wanted || fetching || attempt === 0) return
    const mine = sequence.current
    setFetching(true)
    void api
      .candidates({
        documentId,
        limit: DIRECTORY_PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      })
      .catch((): ShareResult<never> => ({ ok: false, error: 'network' }))
      .then((result) => {
        if (mine !== sequence.current) return
        setFetching(false)
        if (!result.ok) {
          setFailed(pages === 0 ? 'first' : 'partial')
          return
        }
        setRows((prev) => [...prev, ...result.value.items])
        setCursor(result.value.nextCursor || '')
        setPages((n) => n + 1)
      })
  }, [wanted, fetching, attempt, api, documentId, cursor, pages])

  const byUser = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of rows) if (row.principalType === 'user') map.set(row.principalId, row.name)
    return map
  }, [rows])
  const byWorkspace = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of rows)
      if (row.principalType === 'workspace') map.set(row.principalId, row.name)
    return map
  }, [rows])

  const atLimit = enabled && pages >= MAX_DIRECTORY_PAGES && !!cursor
  const error: ShareDirectoryError | null = failed ?? (atLimit ? 'limit' : null)
  const loading = enabled && (fetching || wanted)

  return {
    rows,
    loading,
    namesPending: loading || failed !== null,
    error,
    retry: () => {
      setFailed(null)
      setAttempt((n) => n + 1)
    },
    userName: (userId) => byUser.get(userId),
    workspaceName: (workspaceId) => byWorkspace.get(workspaceId),
  }
}

export interface ShareCandidates {
  items: ShareCandidate[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  /** the first page failed: there is no answer worth keeping */
  loadError: boolean
  /** a later page failed: the pages already read stay */
  loadMoreError: boolean
  loadMore: () => void
  retry: () => void
}

/** the picker's candidates for one search text, paged; nothing is asked until `enabled` */
export function useShareCandidates(
  api: UniworkShareApi,
  documentId: string,
  query: string,
  enabled: boolean,
): ShareCandidates {
  const [state, setState] = useState<{
    items: ShareCandidate[]
    next: string
    loading: boolean
    loadingMore: boolean
    loadError: boolean
    loadMoreError: boolean
  }>({
    items: [],
    next: '',
    loading: false,
    loadingMore: false,
    loadError: false,
    loadMoreError: false,
  })
  const sequence = useRef(0)
  const nextRef = useRef('')
  nextRef.current = state.next

  const fetchPage = useCallback(
    async (cursor: string) => {
      const mine = ++sequence.current
      setState((s) =>
        cursor
          ? { ...s, loadingMore: true, loadMoreError: false }
          : { ...s, loading: true, loadError: false },
      )
      const result = await api
        .candidates({
          documentId,
          ...(query ? { q: query } : {}),
          ...(cursor ? { cursor } : {}),
        })
        .catch((): ShareResult<never> => ({ ok: false, error: 'network' }))
      if (mine !== sequence.current) return
      setState((s) => {
        if (!result.ok) {
          return cursor
            ? { ...s, loadingMore: false, loadMoreError: true }
            : { ...s, items: [], next: '', loading: false, loadError: true }
        }
        return {
          items: cursor ? [...s.items, ...result.value.items] : result.value.items,
          next: result.value.nextCursor,
          loading: false,
          loadingMore: false,
          loadError: false,
          loadMoreError: false,
        }
      })
    },
    [api, documentId, query],
  )

  useEffect(() => {
    if (!enabled) return
    setState((s) => ({ ...s, items: [], next: '' }))
    void fetchPage('')
    return () => {
      sequence.current++
    }
  }, [enabled, fetchPage])

  return {
    items: state.items,
    loading: state.loading,
    loadingMore: state.loadingMore,
    hasMore: state.next !== '',
    loadError: state.loadError,
    loadMoreError: state.loadMoreError,
    loadMore: () => {
      if (nextRef.current) void fetchPage(nextRef.current)
    },
    retry: () => void fetchPage(state.loadMoreError ? state.next : ''),
  }
}
