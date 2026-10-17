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
  expandParentAndAncestorsFor,
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
  /** number of loaded pages (1 = first page, +1 per Load more), re-read across soft refreshes (R2-2) */
  const loadedContentsPages = useRef(1)
  const loadedResultsPages = useRef(1)
  const softMoreContents = useRef<{
    items: UniworkDocSummary[]
    nextCursor: string | null
    pages: number
  } | null>(null)
  const softMoreResults = useRef<{
    items: UniworkDocSummary[]
    nextCursor: string | null
    pages: number
  } | null>(null)
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
        loadedContentsPages.current = 1
        softMoreContents.current = null
        setContents(LOADING_LIST)
      }
      const pagesToRead = loadedContentsPages.current
      const pendingMore = opts.soft
        ? { items: [] as UniworkDocSummary[], nextCursor: null as string | null, pages: 0 }
        : null
      if (opts.soft) softMoreContents.current = pendingMore
      void (async () => {
        const first = await readContents(target)
        if (!mounted.current || !contentsGate.current.isCurrent(request)) return
        if (!first.ok) {
          if (softMoreContents.current === pendingMore) softMoreContents.current = null
          if (target !== null && isGone(first.error)) {
            // the open folder is not there for me any more: its nearest live ancestor
            const path = openPath.current
            const parent = path.length > 1 ? path[path.length - 2]! : null
            setGone(true)
            openFolder(parent, { keepNotice: true })
            return
          }
          loadedContentsPages.current = 1
          setContents({ ...EMPTY_LIST, status: 'error', error: first.error })
          return
        }
        const items = [...first.value.items]
        const seen = new Set(items.map((i) => i.id))
        let nextCursor = first.value.nextCursor
        let pagesLoaded = 1
        let moreError: UniworkDocErrorCode | undefined
        while (opts.soft && pagesLoaded < pagesToRead && nextCursor !== null) {
          const page = await readContents(target, nextCursor)
          if (!mounted.current || !contentsGate.current.isCurrent(request)) return
          if (!page.ok) {
            moreError = page.error
            break
          }
          for (const item of page.value.items) {
            if (!seen.has(item.id)) {
              seen.add(item.id)
              items.push(item)
            }
          }
          nextCursor = page.value.nextCursor
          pagesLoaded++
        }
        if (softMoreContents.current === pendingMore) softMoreContents.current = null
        if (pendingMore && pendingMore.pages > 0 && !moreError && nextCursor !== null) {
          for (const item of pendingMore.items) {
            if (!seen.has(item.id)) {
              seen.add(item.id)
              items.push(item)
            }
          }
          nextCursor = pendingMore.nextCursor
          pagesLoaded += pendingMore.pages
        }
        loadedContentsPages.current = pagesLoaded
        setContents((now) => ({
          status: 'ready',
          items,
          nextCursor,
          loadingMore: opts.soft ? now.loadingMore : false,
          moreError,
        }))
      })()
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
      if (result.ok) {
        loadedContentsPages.current += 1
        if (softMoreContents.current) {
          softMoreContents.current.items.push(...result.value.items)
          softMoreContents.current.nextCursor = result.value.nextCursor
          softMoreContents.current.pages += 1
        }
      }
      setContents((now) => {
        if (!result.ok) return { ...now, loadingMore: false, moreError: result.error }
        const existingIds = new Set(now.items.map((i) => i.id))
        const added = result.value.items.filter((i) => !existingIds.has(i.id))
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
        loadedResultsPages.current = 1
        softMoreResults.current = null
      }
      if (!query) {
        loadedResultsPages.current = 1
        softMoreResults.current = null
        setResults(EMPTY_LIST)
        return
      }
      if (!opts.soft) setResults(LOADING_LIST)
      const pagesToRead = loadedResultsPages.current
      const pendingMore = opts.soft
        ? { items: [] as UniworkDocSummary[], nextCursor: null as string | null, pages: 0 }
        : null
      if (opts.soft) softMoreResults.current = pendingMore
      void (async () => {
        const first = await searchDocuments({ workspaceId, query, kind, limit: BROWSER_PAGE_SIZE })
        if (!mounted.current || !searchGate.current.isCurrent(request)) return
        if (!first.ok) {
          if (softMoreResults.current === pendingMore) softMoreResults.current = null
          loadedResultsPages.current = 1
          setResults({ ...EMPTY_LIST, status: 'error', error: first.error })
          return
        }
        const items = [...first.value.items]
        const seen = new Set(items.map((i) => i.id))
        let nextCursor = first.value.nextCursor
        let pagesLoaded = 1
        let moreError: UniworkDocErrorCode | undefined
        while (opts.soft && pagesLoaded < pagesToRead && nextCursor !== null) {
          const page = await searchDocuments({
            workspaceId,
            query,
            kind,
            cursor: nextCursor,
            limit: BROWSER_PAGE_SIZE,
          })
          if (!mounted.current || !searchGate.current.isCurrent(request)) return
          if (!page.ok) {
            moreError = page.error
            break
          }
          for (const item of page.value.items) {
            if (!seen.has(item.id)) {
              seen.add(item.id)
              items.push(item)
            }
          }
          nextCursor = page.value.nextCursor
          pagesLoaded++
        }
        if (softMoreResults.current === pendingMore) softMoreResults.current = null
        if (pendingMore && pendingMore.pages > 0 && !moreError && nextCursor !== null) {
          for (const item of pendingMore.items) {
            if (!seen.has(item.id)) {
              seen.add(item.id)
              items.push(item)
            }
          }
          nextCursor = pendingMore.nextCursor
          pagesLoaded += pendingMore.pages
        }
        loadedResultsPages.current = pagesLoaded
        setResults((now) => ({
          status: 'ready',
          items,
          nextCursor,
          loadingMore: opts.soft ? now.loadingMore : false,
          moreError,
        }))
      })()
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
      if (result.ok) {
        loadedResultsPages.current += 1
        if (softMoreResults.current) {
          softMoreResults.current.items.push(...result.value.items)
          softMoreResults.current.nextCursor = result.value.nextCursor
          softMoreResults.current.pages += 1
        }
      }
      setResults((now) => {
        if (!result.ok) return { ...now, loadingMore: false, moreError: result.error }
        const existingIds = new Set(now.items.map((i) => i.id))
        const added = result.value.items.filter((i) => !existingIds.has(i.id))
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
    contentsGate.current.next()
    contentsMoreGate.current.next()
    searchGate.current.next()
    searchMoreGate.current.next()
    setTree({ status: 'loading', nodes: [] })
    indexRef.current = new Map()
    setFolderId(initialFolderId)
    folderRef.current = initialFolderId
    setContents(LOADING_LIST)
    setExpanded(new Set([ROOT_KEY]))
    openPath.current = initialFolderId ? [initialFolderId] : []
    loadedContentsPages.current = 1
    loadedResultsPages.current = 1
    softMoreContents.current = null
    softMoreResults.current = null
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

  const expandParent = useCallback((parentId: string | null) => {
    setExpanded(
      (prev) => new Set([...prev, ...expandParentAndAncestorsFor(indexRef.current, parentId)]),
    )
  }, [])

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
    expandParent,
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
