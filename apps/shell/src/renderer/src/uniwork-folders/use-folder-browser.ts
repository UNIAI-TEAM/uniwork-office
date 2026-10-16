import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  UniworkDocErrorCode,
  UniworkDocSummary,
  UniworkFolderChildren,
  UniworkFolderNode,
  UniworkResult,
} from '../../../shared/home-api'
import {
  listFolderChildren,
  loadFolderTree,
  onTreeChanged,
  searchDocuments,
} from '../uniwork-library-api'
import {
  ROOT_KEY,
  buildFolderIndex,
  createRequestGate,
  expandKeysFor,
  folderPath,
  liveFallback,
  type FolderIndex,
} from './uniwork-folders-model'

/** contents page size: the server caps `limit` at 100 */
export const BROWSER_PAGE_SIZE = 100

export type SearchKind = 'all' | 'folder' | 'document'

export interface ListState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: UniworkDocSummary[]
  nextCursor: string | null
  loadingMore: boolean
  error?: UniworkDocErrorCode
  moreError?: UniworkDocErrorCode
}

export interface TreeState {
  status: 'loading' | 'ready' | 'error'
  nodes: UniworkFolderNode[]
  error?: UniworkDocErrorCode
}

const EMPTY_LIST: ListState = { status: 'idle', items: [], nextCursor: null, loadingMore: false }
const LOADING_LIST: ListState = { ...EMPTY_LIST, status: 'loading' }

/** a folder read that says the folder is not there for me any more */
function isGone(error: UniworkDocErrorCode): boolean {
  return error === 'not_found' || error === 'forbidden' || error === 'deleted'
}

/**
 * FD-11 browser data: the workspace's folder tree, the open folder's
 * contents and the title search, all read from the server (in-memory only).
 * Every read carries a request id; an answer for an older folder, search or
 * tree is dropped. The tree and the open folder are re-read on the
 * tree-changed push for this workspace, on window focus and after the
 * browser's own actions; an open folder that vanished falls back to its
 * nearest live ancestor (else the root) and raises the `gone` notice.
 */
export function useFolderBrowser(workspaceId: string, initialFolderId: string | null) {
  const [tree, setTree] = useState<TreeState>({ status: 'loading', nodes: [] })
  const [folderId, setFolderId] = useState<string | null>(initialFolderId)
  const [contents, setContents] = useState<ListState>(LOADING_LIST)
  const [search, setSearch] = useState<{ query: string; kind: SearchKind }>({
    query: '',
    kind: 'all',
  })
  const [results, setResults] = useState<ListState>(EMPTY_LIST)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([ROOT_KEY]))
  const [gone, setGone] = useState(false)

  const index = useMemo(() => buildFolderIndex(tree.nodes), [tree.nodes])
  const indexRef = useRef<FolderIndex>(index)
  indexRef.current = index
  const folderRef = useRef(folderId)
  folderRef.current = folderId
  const contentsRef = useRef(contents)
  contentsRef.current = contents
  const searchRef = useRef(search)
  searchRef.current = search
  /** the open folder's root-first id path, kept across tree re-reads for the fallback */
  const openPath = useRef<string[]>([])
  const treeGate = useRef(createRequestGate())
  const contentsGate = useRef(createRequestGate())
  const searchGate = useRef(createRequestGate())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const readContents = useCallback(
    (target: string | null, cursor?: string): Promise<UniworkResult<UniworkFolderChildren>> =>
      listFolderChildren({ workspaceId, parentId: target, cursor, limit: BROWSER_PAGE_SIZE }),
    [workspaceId],
  )

  /**
   * open a folder (null = the root) and read its first page; `soft` re-reads
   * the folder already shown and keeps its rows on screen until the answer
   */
  const openFolder = useCallback(
    (target: string | null, opts: { keepNotice?: boolean; soft?: boolean } = {}) => {
      const request = contentsGate.current.next()
      setFolderId(target)
      folderRef.current = target
      if (!opts.keepNotice) setGone(false)
      const known = folderPath(indexRef.current, target).map((p) => p.id)
      if (target === null) openPath.current = []
      else if (known.length > 0) openPath.current = known
      else openPath.current = [...openPath.current.filter((id) => id !== target), target]
      if (target !== null) {
        setExpanded((prev) => new Set([...prev, ...expandKeysFor(indexRef.current, target)]))
      }
      if (!opts.soft) setContents(LOADING_LIST)
      void readContents(target).then((result) => {
        if (!mounted.current || !contentsGate.current.isCurrent(request)) return
        if (!result.ok) {
          if (target !== null && isGone(result.error)) {
            // the open folder is not there for me any more: its nearest live ancestor
            const path = openPath.current
            const parent = path.length > 1 ? path[path.length - 2]! : null
            setGone(true)
            openFolder(parent, { keepNotice: true })
            return
          }
          setContents({ ...EMPTY_LIST, status: 'error', error: result.error })
          return
        }
        setContents({
          status: 'ready',
          items: result.value.items,
          nextCursor: result.value.nextCursor,
          loadingMore: false,
        })
      })
    },
    [readContents],
  )

  const loadMore = useCallback(() => {
    const prev = contentsRef.current
    if (!prev.nextCursor || prev.loadingMore || prev.status !== 'ready') return
    const request = contentsGate.current.next()
    setContents({ ...prev, loadingMore: true, moreError: undefined })
    void readContents(folderRef.current, prev.nextCursor).then((result) => {
      if (!mounted.current || !contentsGate.current.isCurrent(request)) return
      setContents((now) =>
        result.ok
          ? {
              ...now,
              items: [...now.items, ...result.value.items],
              nextCursor: result.value.nextCursor,
              loadingMore: false,
            }
          : { ...now, loadingMore: false, moreError: result.error },
      )
    })
  }, [readContents])

  /** re-read the tree, then the open folder (or its fallback when it vanished) */
  const refresh = useCallback(() => {
    const request = treeGate.current.next()
    void loadFolderTree(workspaceId).then((result) => {
      if (!mounted.current || !treeGate.current.isCurrent(request)) return
      if (!result.ok) {
        setTree((prev) =>
          prev.status === 'ready' ? prev : { status: 'error', nodes: [], error: result.error },
        )
        openFolder(folderRef.current, { keepNotice: true, soft: true })
        return
      }
      const nextIndex = buildFolderIndex(result.value)
      indexRef.current = nextIndex
      setTree({ status: 'ready', nodes: result.value })
      const fallback = liveFallback(nextIndex, openPath.current)
      if (fallback.gone) setGone(true)
      const target = fallback.gone ? fallback.folderId : folderRef.current
      openFolder(target, { keepNotice: true, soft: !fallback.gone })
      if (searchRef.current.query) runSearch(searchRef.current.query, searchRef.current.kind)
    })
    // runSearch is stable for a workspace
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, openFolder])

  const runSearch = useCallback(
    (query: string, kind: SearchKind) => {
      const request = searchGate.current.next()
      setSearch({ query, kind })
      if (!query) {
        setResults(EMPTY_LIST)
        return
      }
      setResults(LOADING_LIST)
      void searchDocuments({ workspaceId, query, kind, limit: BROWSER_PAGE_SIZE }).then(
        (result) => {
          if (!mounted.current || !searchGate.current.isCurrent(request)) return
          setResults(
            result.ok
              ? {
                  status: 'ready',
                  items: result.value.items,
                  nextCursor: result.value.nextCursor,
                  loadingMore: false,
                }
              : { ...EMPTY_LIST, status: 'error', error: result.error },
          )
        },
      )
    },
    [workspaceId],
  )

  const resultsRef = useRef(results)
  resultsRef.current = results
  const loadMoreResults = useCallback(() => {
    const prev = resultsRef.current
    const { query, kind } = searchRef.current
    if (!query || !prev.nextCursor || prev.loadingMore || prev.status !== 'ready') return
    const request = searchGate.current.next()
    setResults({ ...prev, loadingMore: true, moreError: undefined })
    void searchDocuments({
      workspaceId,
      query,
      kind,
      cursor: prev.nextCursor,
      limit: BROWSER_PAGE_SIZE,
    }).then((result) => {
      if (!mounted.current || !searchGate.current.isCurrent(request)) return
      setResults((now) =>
        result.ok
          ? {
              ...now,
              items: [...now.items, ...result.value.items],
              nextCursor: result.value.nextCursor,
              loadingMore: false,
            }
          : { ...now, loadingMore: false, moreError: result.error },
      )
    })
  }, [workspaceId])

  // a new workspace: start over at the given folder
  useEffect(() => {
    setTree({ status: 'loading', nodes: [] })
    setExpanded(new Set([ROOT_KEY]))
    openPath.current = initialFolderId ? [initialFolderId] : []
    setGone(false)
    setSearch({ query: '', kind: 'all' })
    setResults(EMPTY_LIST)
    refresh()
    // initialFolderId only seeds the first view of a workspace
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  // the server's tree changed (feed page or an own action elsewhere), or the window came back
  useEffect(() => {
    const off = onTreeChanged((event) => {
      if (event.workspaceId === workspaceId) refresh()
    })
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      off()
      window.removeEventListener('focus', onFocus)
    }
  }, [workspaceId, refresh])

  return {
    tree,
    index,
    folderId,
    path: folderPath(index, folderId),
    contents,
    search,
    results,
    expanded,
    setExpanded,
    gone,
    dismissGone: () => setGone(false),
    openFolder,
    loadMore,
    loadMoreResults,
    refresh,
    runSearch,
  }
}

export type FolderBrowser = ReturnType<typeof useFolderBrowser>
