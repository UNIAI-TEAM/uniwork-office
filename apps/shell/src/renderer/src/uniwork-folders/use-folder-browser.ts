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
/** minimum gap between window-focus refreshes (R1-1) */
export const FOCUS_REFRESH_THROTTLE_MS = 1000

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
  /** items appended by Load more after page 1, preserved across soft refreshes */
  const extraContentsRef = useRef<UniworkDocSummary[]>([])
  const extraResultsRef = useRef<UniworkDocSummary[]>([])
  const treeGate = useRef(createRequestGate())
  const contentsGate = useRef(createRequestGate())
  const contentsMoreGate = useRef(createRequestGate())
  const searchGate = useRef(createRequestGate())
  const searchMoreGate = useRef(createRequestGate())
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
      else {
        const at = openPath.current.indexOf(target)
        openPath.current =
          at >= 0 ? openPath.current.slice(0, at + 1) : [...openPath.current, target]
      }
      if (target !== null) {
        setExpanded((prev) => new Set([...prev, ...expandKeysFor(indexRef.current, target)]))
      }
      if (!opts.soft) {
        contentsMoreGate.current.next()
        extraContentsRef.current = []
        setContents(LOADING_LIST)
      }
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
          extraContentsRef.current = []
          setContents({ ...EMPTY_LIST, status: 'error', error: result.error })
          return
        }
        setContents((now) => {
          if (
            opts.soft &&
            extraContentsRef.current.length > 0 &&
            result.value.nextCursor !== null
          ) {
            const page1Ids = new Set(result.value.items.map((i) => i.id))
            const extra = extraContentsRef.current.filter((i) => !page1Ids.has(i.id))
            extraContentsRef.current = extra
            return {
              status: 'ready',
              items: [...result.value.items, ...extra],
              nextCursor: now.nextCursor,
              loadingMore: now.loadingMore,
              moreError: now.moreError,
            }
          }
          extraContentsRef.current = []
          return {
            status: 'ready',
            items: result.value.items,
            nextCursor: result.value.nextCursor,
            loadingMore: opts.soft ? now.loadingMore : false,
          }
        })
      })
    },
    [readContents],
  )

  const loadMore = useCallback(() => {
    const prev = contentsRef.current
    if (!prev.nextCursor || prev.loadingMore || prev.status !== 'ready') return
    const request = contentsMoreGate.current.next()
    setContents({ ...prev, loadingMore: true, moreError: undefined })
    void readContents(folderRef.current, prev.nextCursor).then((result) => {
      if (!mounted.current || !contentsMoreGate.current.isCurrent(request)) return
      setContents((now) => {
        if (!result.ok) return { ...now, loadingMore: false, moreError: result.error }
        const existingIds = new Set(now.items.map((i) => i.id))
        const added = result.value.items.filter((i) => !existingIds.has(i.id))
        extraContentsRef.current = [...extraContentsRef.current, ...added]
        return {
          ...now,
          items: [...now.items, ...added],
          nextCursor: result.value.nextCursor,
          loadingMore: false,
        }
      })
    })
  }, [readContents])

  const runSearch = useCallback(
    (query: string, kind: SearchKind, opts: { soft?: boolean } = {}) => {
      const request = searchGate.current.next()
      setSearch({ query, kind })
      if (!opts.soft) {
        searchMoreGate.current.next()
        extraResultsRef.current = []
      }
      if (!query) {
        extraResultsRef.current = []
        setResults(EMPTY_LIST)
        return
      }
      if (!opts.soft) setResults(LOADING_LIST)
      void searchDocuments({ workspaceId, query, kind, limit: BROWSER_PAGE_SIZE }).then(
        (result) => {
          if (!mounted.current || !searchGate.current.isCurrent(request)) return
          if (!result.ok) {
            extraResultsRef.current = []
            setResults({ ...EMPTY_LIST, status: 'error', error: result.error })
            return
          }
          setResults((now) => {
            if (
              opts.soft &&
              extraResultsRef.current.length > 0 &&
              result.value.nextCursor !== null
            ) {
              const page1Ids = new Set(result.value.items.map((i) => i.id))
              const extra = extraResultsRef.current.filter((i) => !page1Ids.has(i.id))
              extraResultsRef.current = extra
              return {
                status: 'ready',
                items: [...result.value.items, ...extra],
                nextCursor: now.nextCursor,
                loadingMore: now.loadingMore,
                moreError: now.moreError,
              }
            }
            extraResultsRef.current = []
            return {
              status: 'ready',
              items: result.value.items,
              nextCursor: result.value.nextCursor,
              loadingMore: opts.soft ? now.loadingMore : false,
            }
          })
        },
      )
    },
    [workspaceId],
  )

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
      if (searchRef.current.query) {
        runSearch(searchRef.current.query, searchRef.current.kind, { soft: true })
      }
    })
  }, [workspaceId, openFolder, runSearch])

  const resultsRef = useRef(results)
  resultsRef.current = results
  const loadMoreResults = useCallback(() => {
    const prev = resultsRef.current
    const { query, kind } = searchRef.current
    if (!query || !prev.nextCursor || prev.loadingMore || prev.status !== 'ready') return
    const request = searchMoreGate.current.next()
    setResults({ ...prev, loadingMore: true, moreError: undefined })
    void searchDocuments({
      workspaceId,
      query,
      kind,
      cursor: prev.nextCursor,
      limit: BROWSER_PAGE_SIZE,
    }).then((result) => {
      if (!mounted.current || !searchMoreGate.current.isCurrent(request)) return
      setResults((now) => {
        if (!result.ok) return { ...now, loadingMore: false, moreError: result.error }
        const existingIds = new Set(now.items.map((i) => i.id))
        const added = result.value.items.filter((i) => !existingIds.has(i.id))
        extraResultsRef.current = [...extraResultsRef.current, ...added]
        return {
          ...now,
          items: [...now.items, ...added],
          nextCursor: result.value.nextCursor,
          loadingMore: false,
        }
      })
    })
  }, [workspaceId])

  // a new workspace: start over at the given folder
  useEffect(() => {
    setTree({ status: 'loading', nodes: [] })
    setExpanded(new Set([ROOT_KEY]))
    openPath.current = initialFolderId ? [initialFolderId] : []
    extraContentsRef.current = []
    extraResultsRef.current = []
    setGone(false)
    setSearch({ query: '', kind: 'all' })
    setResults(EMPTY_LIST)
    refresh()
    // initialFolderId only seeds the first view of a workspace
  }, [workspaceId])

  // the server's tree changed (feed page or an own action elsewhere), or the window came back
  useEffect(() => {
    let lastFocusAt = 0
    const off = onTreeChanged((event) => {
      if (event.workspaceId === workspaceId) refresh()
    })
    const onFocus = () => {
      const now = Date.now()
      if (now - lastFocusAt < FOCUS_REFRESH_THROTTLE_MS) return
      lastFocusAt = now
      refresh()
    }
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
