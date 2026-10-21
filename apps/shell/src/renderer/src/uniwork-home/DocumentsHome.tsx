import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  UniworkCreateVisibility,
  UniworkDocErrorCode,
  UniworkDocSummary,
  UniworkFolderNode,
  UniworkSourceFile,
  UniworkWorkspaceRef,
} from '../../../shared/home-api'
import { FileBadge } from '../FileBadge'
import { useI18n, type StringKey } from '../locale'
import {
  ActionToast,
  ArchiveConfirm,
  NEW_KIND_LABEL_KEY,
  UploadDocDialog,
  type ActionOutcome,
  type DocTarget,
  type UploadProgress,
} from '../UniworkDocActions'
import {
  QUICK_CREATE_KINDS,
  UNIWORK_ERROR_KEYS,
  checkDocName,
  errorActionOf,
  isDocNameError,
  isDocTitleTooLong,
  renameFormatOf,
  renameParts,
  workspaceLabel,
  type DocNameError,
  type NewDocKind,
} from '../uniwork-docs-model'
import { BrowserCrumbs } from '../uniwork-folders/BrowserCrumbs'
import { useOfflineToggle } from '../OfflineToggle'
import { FolderMenu, type FolderMenuItem } from '../uniwork-folders/FolderMenu'
import { FolderNameDialog } from '../uniwork-folders/FolderNameDialog'
import { UniworkFolderPicker } from '../uniwork-folders/UniworkFolderPicker'
import { FolderGlyph, MyFolderGlyph, UniworkFolderTree } from '../uniwork-folders/UniworkFolderTree'
import {
  MY_FOLDER_LABEL_KEY,
  ROOT_KEY,
  buildFolderIndex,
  entryTitleOf,
  expandKeysFor,
  expandParentAndAncestorsFor,
  folderEditActionsOffered,
  folderPath,
  isMyFolder,
  labelMyFolderPath,
  liveFallback,
  myFolderFirst,
  myFolderIdOf,
  shortPath,
  type FolderIndex,
  type PathPart,
  type TreeRow,
} from '../uniwork-folders/uniwork-folders-model'
import { useFolderActions } from '../uniwork-folders/use-folder-actions'
import {
  archiveDocument,
  cancelUploadDocument,
  createDocument,
  createPage,
  downloadSource,
  loadFolderTree,
  onDocRenamed,
  onTreeChanged,
  onUploadProgress,
  openSource,
  pickUploadFile,
  renameDocument,
  restoreDocument,
  searchDocuments,
  uploadDocument,
} from '../uniwork-library-api'
import { openPageOnWeb } from '../uniwork-page-web'
import { publishUniworkNotice } from '../uniwork-notice-bus'
import { announce } from '../uniwork-live'
import {
  canManageShelved,
  collectUpdatedByOptions,
  fetchDocumentsHomePage,
  fetchDocumentsHomeSources,
  getDocumentsHomeNavEntry,
  docMatchesUpdated,
  hasActiveFilters,
  mergeNewestFirst,
  rowMatchesType,
  sourceMatchesFilters,
  splitAndSortItems,
  toUniworkListFilters,
  visibleDocumentsHomeNavEntries,
  type DocumentsHomeApiAdapter,
  type DocumentsHomeDoc,
  type DocumentsHomeSubViewId,
  type DocumentsHomeTableRow,
  type UpdatedByOption,
} from './documents-home-model'
import {
  canFavoriteDocuments,
  favoriteDocument,
  loadDocProperties,
  shelveDocument,
  trashShelvedDocument,
  unfavoriteDocument,
  unshelveDocument,
} from '../uniwork-library-api'
import { UniworkDocInfoPanel, type DocInfoLoad } from '../UniworkDocInfoPanel'
import { ShelvedToolbar, filterByShelver, shelvedDescendantIds } from './ShelvedDocumentsView'
import { BulkBar, BulkTrashConfirm } from '../doclist/BulkBar'
import {
  bulkActionsFor,
  bulkSummary,
  bulkWorkFor,
  runBulkAction,
  type BulkActionId,
} from '../doclist/bulk'
import { DocList } from '../doclist/DocList'
import { defaultSort } from '../doclist/columns'
import { copyDocLink } from '../doclist/copy-link'
import { ContinueStrip, continueDocsOf } from '../doclist/ContinueStrip'
import { FilterBar, useDocListFilters } from '../doclist/FilterBar'
import { buildRowMenu } from '../doclist/row-menu'
import type { DocSubline } from '../doclist/DocRow'
import { pruneSelection, selectedDocsOf } from '../doclist/selection'
import { screenOfSubView, specialPresent, wireSortOf } from '../doclist/table-model'
import { RecentSegmentControl, useRecentSegment } from '../doclist/RecentSegment'
import { useDocListSort } from '../doclist/use-doc-list-sort'
import { DocumentsSourceRow } from './DocumentsSourceRow'
import { sourceOpenExtension, sourceOpenFailureOf } from './source-open-model'
import { NewMenu } from './NewMenu'
import { CREATE_SPECIFIC_ERRORS, NEW_DEFAULT_NAME_KEY, NEW_KIND_EXT } from './new-menu-model'
import '../uniwork-folders/uniwork-folders.css'
import './documents-home.css'

function SubNavIcon({ id }: { id: DocumentsHomeSubViewId }) {
  switch (id) {
    case 'workspace':
      return (
        <svg
          className="dh-nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      )
    case 'my-folder':
      return (
        <svg
          className="dh-nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <rect x="9.5" y="11.5" width="5" height="4" rx="0.8" />
          <path d="M10.7 11.5v-1a1.3 1.3 0 0 1 2.6 0v1" />
        </svg>
      )
    case 'recent':
      return (
        <svg
          className="dh-nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      )
    case 'starred':
      return (
        <svg
          className="dh-nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
        </svg>
      )
    case 'shared-with-me':
      return (
        <svg
          className="dh-nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      )
    case 'shared-by-me':
      return (
        <svg
          className="dh-nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
      )
    case 'archive':
      // UNI-1961: the Lưu trữ shelf (an archive box)
      return (
        <svg
          className="dh-nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="4" rx="1" />
          <path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
          <path d="M10 12h4" />
        </svg>
      )
    case 'trash':
    default:
      return (
        <svg
          className="dh-nav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        </svg>
      )
  }
}

export interface DocumentsHomeProps {
  workspaceId: string
  workspaces: UniworkWorkspaceRef[]
  onWorkspaceChange: (workspaceId: string) => void
  onOpenDocument: (doc: UniworkDocSummary) => void
  openingId?: string | null
  sidebarHost?: HTMLElement | null
  /** the host shows another surface (My AI / Workbench) in the main pane: no nav item reads as current */
  sidebarIdle?: boolean
  /** a sidebar nav item or folder was picked (lets the host leave My AI / Workbench) */
  onSidebarNavigate?: () => void
  initialFolderId?: string | null
  /** sub-view to mount with (kept by the host so an area switch can restore it — VDH-7) */
  initialSubView?: DocumentsHomeSubViewId
  onSubViewChange?: (subView: DocumentsHomeSubViewId) => void
  onFolderChange?: (folderId: string | null, path: PathPart[]) => void
}

type TreeState =
  | { status: 'loading'; nodes: UniworkFolderNode[] }
  | { status: 'ready'; nodes: UniworkFolderNode[] }
  | { status: 'error'; nodes: UniworkFolderNode[]; error: UniworkDocErrorCode }

type PageState = {
  status: 'loading' | 'ready' | 'error'
  items: DocumentsHomeDoc[]
  nextCursor: string | null
  loadingMore: boolean
  error?: UniworkDocErrorCode
  moreError?: UniworkDocErrorCode
}

export function DocumentsHome({
  workspaceId,
  workspaces,
  onWorkspaceChange,
  onOpenDocument,
  openingId,
  sidebarHost,
  sidebarIdle = false,
  onSidebarNavigate,
  initialFolderId = null,
  initialSubView = 'workspace',
  onSubViewChange,
  onFolderChange,
}: DocumentsHomeProps) {
  const { t, dateLocale } = useI18n()
  const uid = useId()

  const [subView, setSubView] = useState<DocumentsHomeSubViewId>(initialSubView)
  const [folderId, setFolderId] = useState<string | null>(initialFolderId)
  const [myFolderId, setMyFolderId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([ROOT_KEY]))
  const [tree, setTree] = useState<TreeState>({ status: 'loading', nodes: [] })
  const [treeTick, setTreeTick] = useState(0)
  const [folderNotice, setFolderNotice] = useState<'ufFolderGone' | 'ufFolderNoAccess' | null>(null)
  const subViewRef = useRef(subView)
  subViewRef.current = subView
  const folderIdRef = useRef(folderId)
  folderIdRef.current = folderId
  const openPathRef = useRef<string[]>(initialFolderId ? [initialFolderId] : [])
  const treeLoadingRef = useRef(false)

  // UNI-2047: one table sorted from its headers, the sort remembered per screen; the grid view
  // and Group by are gone. The quick filters are per screen too (doclist/FilterBar).
  const screen = screenOfSubView(subView)
  const [filters, setFilters, resetFilters] = useDocListFilters(screen)
  const [docSort, setDocSort] = useDocListSort(screen)
  const [recentSegment, setRecentSegment] = useRecentSegment()
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [searchDraft, setSearchDraft] = useState('')
  const [page, setPage] = useState<PageState>({
    status: 'loading',
    items: [],
    nextCursor: null,
    loadingMore: false,
  })
  const [listTick, setListTick] = useState(0)
  // UNI-1961: the workspace root also lists the files of the other modules
  // (the web's "other sources"), paged on their own
  const [sources, setSources] = useState<{
    items: UniworkSourceFile[]
    nextCursor: string | null
    loadingMore: boolean
  }>({ items: [], nextCursor: null, loadingMore: false })
  const [knownAuthors, setKnownAuthors] = useState<readonly UpdatedByOption[]>([])

  // Dialogs & inline actions
  // UNI-1959: "Share with workspace" of the New menu and the strip: off by default, kept while
  // this view is open, reset after a create from the strip (the web's page-view behaviour)
  const [shareWithWorkspace, setShareWithWorkspace] = useState(false)
  const quickShareHintId = useId()
  // UNI-1959: kinds the server answered 404 / 501 for: disabled for the session
  const [unavailableKinds, setUnavailableKinds] = useState<ReadonlySet<NewDocKind>>(new Set())
  const [creating, setCreating] = useState(false)
  const creatingRef = useRef(false)
  const [uploadModal, setUploadModal] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)
  const uploadIdRef = useRef<string | null>(null)
  const uploadRunRef = useRef(0)
  // DH1-R4-8: an in-flight upload must never call onOpenDocument after unmount
  useEffect(
    () => () => {
      uploadRunRef.current++
    },
    [],
  )
  const [docRename, setDocRename] = useState<{
    doc: DocumentsHomeDoc
    error: DocNameError | null
    busy: boolean
  } | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<DocumentsHomeDoc | null>(null)
  const [toast, setToast] = useState<{
    message: string
    tone: 'ok' | 'error'
    action?: { label: string; onClick: () => void }
  } | null>(null)
  const clearToast = useCallback(() => setToast(null), [])

  // G5-05u / NET-OFF-01: pin/unpin entry in each document row's "…" menu (hidden while the capability is off)
  const offlineToggle = useOfflineToggle()
  const myFolderLabel = t(MY_FOLDER_LABEL_KEY)
  const labeledNodes = useMemo(
    () => tree.nodes.map((n) => (isMyFolder(n) ? { ...n, title: myFolderLabel } : n)),
    [tree.nodes, myFolderLabel],
  )
  const index = useMemo(() => buildFolderIndex(labeledNodes), [labeledNodes])
  const indexRef = useRef<FolderIndex>(index)
  indexRef.current = index
  const resolvedMyFolderId = myFolderId ?? myFolderIdOf(tree.nodes)
  const rawPath = useMemo(() => folderPath(index, folderId), [index, folderId])
  const shownPath = useMemo(
    () => labelMyFolderPath(rawPath, resolvedMyFolderId, myFolderLabel),
    [rawPath, resolvedMyFolderId, myFolderLabel],
  )

  const refreshAll = useCallback(() => {
    setTreeTick((n) => n + 1)
    setListTick((n) => n + 1)
  }, [])

  const expandParent = useCallback(
    (parentId: string | null) => {
      setExpanded((prev) => new Set([...prev, ...expandParentAndAncestorsFor(index, parentId)]))
    },
    [index],
  )

  const folderActions = useFolderActions({
    workspaceId,
    onChanged: refreshAll,
    onCreated: expandParent,
    notify: (message, tone) => setToast({ message, tone }),
  })

  // Reset workspace-scoped state when workspaceId changes
  const prevWsRef = useRef(workspaceId)
  if (prevWsRef.current !== workspaceId) {
    prevWsRef.current = workspaceId
    subViewRef.current = 'workspace'
    folderIdRef.current = null
    openPathRef.current = []
    setSubView('workspace')
    setFolderId(null)
    setFolderNotice(null)
    setMyFolderId(null)
    setExpanded(new Set([ROOT_KEY]))
    resetFilters()
    setSearchDraft('')
    setKnownAuthors([])
  }

  // Subscribe to tree changes and doc renames
  useEffect(() => {
    const unsubTree = onTreeChanged((ev) => {
      if (ev.workspaceId === workspaceId) {
        refreshAll()
      }
    })
    const unsubRename = onDocRenamed((ev) => {
      setPage((prev) => ({
        ...prev,
        items: prev.items.map((item) =>
          item.id === ev.documentId ? { ...item, title: ev.title } : item,
        ),
      }))
    })
    return () => {
      unsubTree()
      unsubRename()
    }
  }, [workspaceId, refreshAll])

  // Load folder tree
  const treeSeqRef = useRef(0)
  useEffect(() => {
    const seq = ++treeSeqRef.current
    treeLoadingRef.current = true
    setTree((prev) => (prev.nodes.length > 0 ? prev : { status: 'loading', nodes: [] }))
    void loadFolderTree(workspaceId)
      .then((res) => {
        if (treeSeqRef.current !== seq) return
        treeLoadingRef.current = false
        if (res.ok) {
          const nextIndex = buildFolderIndex(res.value)
          indexRef.current = nextIndex
          setTree({ status: 'ready', nodes: res.value })
          const foundMine = myFolderIdOf(res.value)
          if (foundMine) setMyFolderId(foundMine)
          if (subViewRef.current === 'workspace' && folderIdRef.current !== null) {
            const currentId = folderIdRef.current
            const known = folderPath(nextIndex, currentId).map((p) => p.id)
            if (known.length > 0) {
              openPathRef.current = known
            } else {
              const chain = openPathRef.current.length > 0 ? openPathRef.current : [currentId]
              const fallback = liveFallback(nextIndex, chain)
              if (fallback.gone) {
                ++listSeqRef.current
                openPathRef.current = fallback.folderId
                  ? folderPath(nextIndex, fallback.folderId).map((p) => p.id)
                  : []
                folderIdRef.current = fallback.folderId
                setFolderNotice('ufFolderGone')
                setFolderId(fallback.folderId)
              }
            }
          }
        } else {
          setTree((prev) => ({
            status: 'error',
            nodes: prev.nodes,
            error: res.error,
          }))
        }
      })
      .catch(() => {
        if (treeSeqRef.current !== seq) return
        treeLoadingRef.current = false
        setTree((prev) => ({
          status: 'error',
          nodes: prev.nodes,
          error: 'network',
        }))
      })
  }, [workspaceId, treeTick])

  // Expand ancestors when initialFolderId or folderId is set
  useEffect(() => {
    if (!folderId || tree.nodes.length === 0) return
    setExpanded((prev) => new Set([...prev, ...expandKeysFor(index, folderId)]))
  }, [folderId, index, tree.nodes.length])

  // Notify host of open folder changes so area switches preserve open folder
  const onFolderChangeRef = useRef(onFolderChange)
  onFolderChangeRef.current = onFolderChange
  const pathKey = shownPath.map((p) => p.id).join('/')
  useEffect(() => {
    onFolderChangeRef.current?.(folderId, shownPath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId, pathKey])

  // Notify host of sub-view changes so an area switch can restore it on remount (VDH-7)
  const onSubViewChangeRef = useRef(onSubViewChange)
  onSubViewChangeRef.current = onSubViewChange
  useEffect(() => {
    onSubViewChangeRef.current?.(subView)
  }, [subView])
  // Load sub-view / folder / search items with sequence guard
  const query = searchDraft.trim()
  const listSeqRef = useRef(0)
  // Người sửa / Cập nhật put Recent on the flat list, which has no activity filter and no
  // last-activity sort: the segment is off while they are on, and Cập nhật is the sort
  const recentFlat =
    subView === 'recent' && (filters.updatedBy.trim() !== '' || filters.updatedPreset !== 'any')
  // the Recent segment rides on the same filters: only Recent's route takes `activity`
  const recentActivity =
    subView === 'recent' && !recentFlat && recentSegment !== 'all' ? recentSegment : null
  const wireFilters = useMemo(
    () => ({
      ...toUniworkListFilters(filters),
      ...(recentActivity ? { activity: recentActivity } : {}),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters.format, filters.updatedBy, filters.updatedPreset, recentActivity],
  )
  // the header sort goes to the server too: nothing until the person sorts (the server's own
  // order), except the Trash, which asks for Đã xóa oldest first from the first read like the web
  // so its groups hold across pages
  const trashDefault = subView === 'trash' && !docSort
  const flatActivitySort = recentFlat && docSort?.column === 'activity'
  const wireSort = useMemo(
    () =>
      wireSortOf(
        flatActivitySort
          ? defaultSort('workspace')
          : (docSort ?? (trashDefault ? defaultSort('trash') : null)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docSort?.column, docSort?.dir, trashDefault, flatActivitySort],
  )

  useEffect(() => {
    const seq = ++listSeqRef.current
    setPage((prev) => ({
      status: 'loading',
      items: prev.status === 'ready' ? prev.items : [],
      nextCursor: null,
      loadingMore: false,
    }))

    if (query.length > 0) {
      void searchDocuments({ workspaceId, query, kind: 'all' })
        .then((res) => {
          if (listSeqRef.current !== seq) return
          if (res.ok) {
            const items = res.value.items as DocumentsHomeDoc[]
            setPage({
              status: 'ready',
              items,
              nextCursor: res.value.nextCursor,
              loadingMore: false,
            })
          } else {
            setPage({
              status: 'error',
              items: [],
              nextCursor: null,
              loadingMore: false,
              error: res.error,
            })
          }
        })
        .catch(() => {
          if (listSeqRef.current !== seq) return
          setPage({
            status: 'error',
            items: [],
            nextCursor: null,
            loadingMore: false,
            error: 'network',
          })
        })
      return
    }

    const knownChain =
      folderId !== null ? folderPath(indexRef.current, folderId).map((p) => p.id) : []
    const chainForFolder =
      folderId === null
        ? []
        : knownChain.length > 0
          ? knownChain
          : openPathRef.current.includes(folderId)
            ? openPathRef.current.slice(0, openPathRef.current.indexOf(folderId) + 1)
            : [...openPathRef.current, folderId]

    const api = window.aiOffice as unknown as DocumentsHomeApiAdapter
    void fetchDocumentsHomePage(api, {
      workspaceId,
      subView,
      folderId,
      myFolderId: resolvedMyFolderId,
      filters: wireFilters,
      sort: wireSort,
    })
      .then(({ result, ensuredMyFolder }) => {
        if (listSeqRef.current !== seq) return
        if (ensuredMyFolder) {
          setMyFolderId(ensuredMyFolder.id)
          // the tree row takes the stand-in's place
          setTreeTick((n) => n + 1)
        }
        if (result.ok) {
          const items = result.value.items
          setPage({
            status: 'ready',
            items,
            nextCursor: result.value.nextCursor,
            loadingMore: false,
          })
          if (subView !== 'shared-with-me') {
            setKnownAuthors((prev) => {
              const merged = new Map<string, string>()
              for (const opt of prev) merged.set(opt.id, opt.name)
              for (const opt of collectUpdatedByOptions(items)) merged.set(opt.id, opt.name)
              return Array.from(merged.entries()).map(([id, name]) => ({ id, name }))
            })
          }
        } else {
          if (
            subView === 'workspace' &&
            folderId !== null &&
            (result.error === 'not_found' ||
              result.error === 'forbidden' ||
              result.error === 'deleted')
          ) {
            const ancestors = chainForFolder.slice(0, -1)
            const fallbackId =
              indexRef.current.size > 0
                ? liveFallback(indexRef.current, ancestors).folderId
                : (ancestors[ancestors.length - 1] ?? null)
            ++listSeqRef.current
            openPathRef.current = fallbackId
              ? ancestors.slice(0, ancestors.indexOf(fallbackId) + 1)
              : []
            folderIdRef.current = fallbackId
            setFolderNotice(result.error === 'forbidden' ? 'ufFolderNoAccess' : 'ufFolderGone')
            setFolderId(fallbackId)
            if (!treeLoadingRef.current) {
              setTreeTick((n) => n + 1)
            }
            return
          }
          setPage({
            status: 'error',
            items: [],
            nextCursor: null,
            loadingMore: false,
            error: result.error,
          })
        }
      })
      .catch(() => {
        if (listSeqRef.current !== seq) return
        setPage({
          status: 'error',
          items: [],
          nextCursor: null,
          loadingMore: false,
          error: 'network',
        })
      })
  }, [workspaceId, subView, folderId, resolvedMyFolderId, wireFilters, wireSort, query, listTick])

  // UNI-1961: as on the web, the sources merge only at the workspace root (no
  // folder, no search); a failed sources read (an older server's 404/501 or any
  // other) leaves the documents as they are
  const sourcesWanted =
    subView === 'workspace' &&
    folderId === null &&
    query.length === 0 &&
    // UniNote is no file: the other-source list has nothing to show under it
    filters.format !== 'page'
  const sourcesSeqRef = useRef(0)
  useEffect(() => {
    const seq = ++sourcesSeqRef.current
    setSources({ items: [], nextCursor: null, loadingMore: false })
    if (!sourcesWanted) return
    const api = window.aiOffice as unknown as DocumentsHomeApiAdapter
    void fetchDocumentsHomeSources(api, { workspaceId, filters: wireFilters })
      .then((res) => {
        if (sourcesSeqRef.current !== seq || !res?.ok) return
        setSources({ items: res.value.items, nextCursor: res.value.nextCursor, loadingMore: false })
      })
      .catch(() => undefined)
  }, [workspaceId, sourcesWanted, wireFilters, listTick])
  const sourcesMerged = sourcesWanted && sources.items.length > 0

  const loadMoreSources = () => {
    const cursor = sources.nextCursor
    if (!cursor || sources.loadingMore) return
    const seq = sourcesSeqRef.current
    setSources((prev) => ({ ...prev, loadingMore: true }))
    const api = window.aiOffice as unknown as DocumentsHomeApiAdapter
    void fetchDocumentsHomeSources(api, { workspaceId, filters: wireFilters, cursor })
      .then((res) => {
        if (sourcesSeqRef.current !== seq) return
        setSources((prev) =>
          res?.ok
            ? {
                items: [...prev.items, ...res.value.items],
                nextCursor: res.value.nextCursor,
                loadingMore: false,
              }
            : { ...prev, loadingMore: false },
        )
      })
      .catch(() => {
        if (sourcesSeqRef.current === seq) setSources((prev) => ({ ...prev, loadingMore: false }))
      })
  }

  const loadMore = () => {
    // UNI-1961: "Load more" asks both lists for their next page (the web's rule)
    if (sourcesMerged) loadMoreSources()
    if (!page.nextCursor || page.loadingMore || page.status !== 'ready') return
    const cursor = page.nextCursor
    const seq = listSeqRef.current
    setPage((prev) => ({ ...prev, loadingMore: true, moreError: undefined }))

    if (query.length > 0) {
      void searchDocuments({ workspaceId, query, cursor, kind: 'all' })
        .then((res) => {
          if (listSeqRef.current !== seq) return
          if (res.ok) {
            setPage((prev) => ({
              ...prev,
              items: [...prev.items, ...(res.value.items as DocumentsHomeDoc[])],
              nextCursor: res.value.nextCursor,
              loadingMore: false,
            }))
          } else {
            setPage((prev) => ({
              ...prev,
              loadingMore: false,
              moreError: res.error,
            }))
          }
        })
        .catch(() => {
          if (listSeqRef.current !== seq) return
          setPage((prev) => ({
            ...prev,
            loadingMore: false,
            moreError: 'network',
          }))
        })
      return
    }

    const api = window.aiOffice as unknown as DocumentsHomeApiAdapter
    void fetchDocumentsHomePage(api, {
      workspaceId,
      subView,
      folderId,
      myFolderId: resolvedMyFolderId,
      cursor,
      filters: wireFilters,
      sort: wireSort,
    })
      .then(({ result }) => {
        if (listSeqRef.current !== seq) return
        if (result.ok) {
          const nextItems = result.value.items
          setPage((prev) => ({
            ...prev,
            items: [...prev.items, ...nextItems],
            nextCursor: result.value.nextCursor,
            loadingMore: false,
          }))
          if (subView !== 'shared-with-me') {
            setKnownAuthors((prev) => {
              const merged = new Map<string, string>()
              for (const opt of prev) merged.set(opt.id, opt.name)
              for (const opt of collectUpdatedByOptions(nextItems)) merged.set(opt.id, opt.name)
              return Array.from(merged.entries()).map(([id, name]) => ({ id, name }))
            })
          }
        } else {
          setPage((prev) => ({
            ...prev,
            loadingMore: false,
            moreError: result.error,
          }))
        }
      })
      .catch(() => {
        if (listSeqRef.current !== seq) return
        setPage((prev) => ({
          ...prev,
          loadingMore: false,
          moreError: 'network',
        }))
      })
  }

  // Subscribe to upload progress while upload modal is open
  useEffect(() => {
    if (!uploadModal) return
    return onUploadProgress((ev) => {
      if (ev.uploadId === uploadIdRef.current) {
        setUploadProgress({
          name: ev.path.split(/[\\/]/).pop() ?? '',
          loaded: ev.loaded,
          total: ev.total,
          phase: ev.phase,
        })
      }
    })
  }, [uploadModal])

  const selectSubView = (next: DocumentsHomeSubViewId) => {
    setSearchDraft('')
    setFolderNotice(null)
    subViewRef.current = next
    setSubView(next)
    if (next === 'workspace') {
      openPathRef.current = []
      folderIdRef.current = null
      setFolderId(null)
    }
  }

  const openFolderInWorkspace = (id: string | null) => {
    setSearchDraft('')
    setFolderNotice(null)
    if (id !== null && id === resolvedMyFolderId) {
      openPathRef.current = [id]
      folderIdRef.current = id
      subViewRef.current = 'my-folder'
      setSubView('my-folder')
      setFolderId(id)
      return
    }
    if (id === null) {
      openPathRef.current = []
    } else {
      const known = folderPath(indexRef.current, id).map((p) => p.id)
      if (known.length > 0) {
        openPathRef.current = known
      } else {
        const at = openPathRef.current.indexOf(id)
        openPathRef.current =
          at >= 0 ? openPathRef.current.slice(0, at + 1) : [...openPathRef.current, id]
      }
    }
    folderIdRef.current = id
    subViewRef.current = 'workspace'
    setSubView('workspace')
    setFolderId(id)
  }

  // Target folder for "Tạo mới" / "Tải lên" / "Tạo nhanh"
  const activeTargetFolder = useMemo((): DocTarget => {
    if (subView === 'my-folder') {
      return {
        workspaceId,
        folderId: resolvedMyFolderId,
        folderPath: resolvedMyFolderId ? [{ id: resolvedMyFolderId, title: myFolderLabel }] : [],
      }
    }
    if (subView === 'workspace' && folderId) {
      return {
        workspaceId,
        folderId,
        folderPath: shownPath,
      }
    }
    return {
      workspaceId,
      folderId: resolvedMyFolderId,
      folderPath: resolvedMyFolderId ? [{ id: resolvedMyFolderId, title: myFolderLabel }] : [],
    }
  }, [workspaceId, subView, folderId, resolvedMyFolderId, myFolderLabel, shownPath])

  // UNI-1953: a page row (UniNote) opens as its web page, every other row through the file flow
  const openDoc = async (doc: UniworkDocSummary): Promise<void> => {
    if (doc.kind !== 'page') {
      onOpenDocument(doc)
      return
    }
    if (!(await openPageOnWeb(workspaces, doc.workspaceId || workspaceId, doc.id))) {
      setToast({ message: t('uwDocActionFailed'), tone: 'error' })
    }
  }

  // UNI-1961: a source row's Download - the web's primary action for a file it
  // cannot view in place; the done note offers the file in its folder
  // a click burst (click, click, dblclick) must open one save dialog, not a stack of them
  const downloadingSourcesRef = useRef<Set<string>>(new Set())
  const downloadSourceFile = async (source: UniworkSourceFile): Promise<void> => {
    if (downloadingSourcesRef.current.has(source.id)) return
    downloadingSourcesRef.current.add(source.id)
    let res: Awaited<ReturnType<typeof downloadSource>>
    try {
      res = await downloadSource({ workspaceId, sourceId: source.id, name: source.name })
    } finally {
      downloadingSourcesRef.current.delete(source.id)
    }
    if (!res.ok) {
      setToast({ message: t('uhSourceDownloadFailed'), tone: 'error' })
      return
    }
    const path = res.value.path
    if (!path) return
    const message = t('uhSourceDownloaded', { name: source.name })
    announce(message)
    setToast({
      message,
      tone: 'ok',
      action: {
        label: t('uhSourceShowInFolder'),
        onClick: () => void window.aiOffice.revealPath(path),
      },
    })
  }

  // UNI-1993: a source row's Open (view only): main downloads a temp copy and opens it in its
  // editor tab as a view-only source; nothing is said when it works, each failure follows the
  // contract (3.4). A click burst (click, click, dblclick) opens one tab, not a stack of them.
  const openingSourcesRef = useRef<Set<string>>(new Set())
  const openSourceFile = async (source: UniworkSourceFile): Promise<void> => {
    const extension = sourceOpenExtension(source)
    if (!extension) {
      await downloadSourceFile(source)
      return
    }
    if (openingSourcesRef.current.has(source.id)) return
    openingSourcesRef.current.add(source.id)
    announce(t('uhSourceOpening', { name: source.name }))
    let res: Awaited<ReturnType<typeof openSource>>
    try {
      res = await openSource({
        workspaceId,
        sourceId: source.id,
        name: source.name,
        extension,
        mimeType: source.mimeType,
        sizeBytes: source.sizeBytes,
        updatedAt: source.updatedAt,
        origin: source.source,
        // the parent's kind and title only: its id never leaves the row
        parent: { kind: source.parent.kind, title: source.parent.title },
      })
    } finally {
      openingSourcesRef.current.delete(source.id)
    }
    if (res.ok) return
    const failure = sourceOpenFailureOf(res.error)
    switch (failure.kind) {
      case 'gone':
        setToast({ message: t('uhSourceOpenGone'), tone: 'error' })
        // the row is stale: read the list again so it goes
        setListTick((n) => n + 1)
        return
      case 'offline':
        setToast({
          message: t('uhSourceOpenOffline'),
          tone: 'error',
          action: { label: t('uhSourceOpenRetry'), onClick: () => void openSourceFile(source) },
        })
        return
      case 'too_large':
        setToast({
          message: t('uhSourceOpenTooLarge'),
          tone: 'error',
          action: { label: t('uhSourceDownload'), onClick: () => void downloadSourceFile(source) },
        })
        return
      case 'notice':
        publishUniworkNotice({ phase: 'failed', error: failure.error })
        return
      default:
        setToast({ message: t('uhSourceOpenFailed'), tone: 'error' })
    }
  }

  // CT1-4: the page exists already, so an opening that fails says that, not "failed"
  const openCreatedPage = async (doc: UniworkDocSummary): Promise<void> => {
    if (!(await openPageOnWeb(workspaces, doc.workspaceId || workspaceId, doc.id))) {
      setToast({ message: t('uwUniNoteOpenFailed'), tone: 'error' })
    }
  }

  // what a create sends: the "Share with workspace" choice, for documents only (a folder is never shared)
  const createVisibility = (): UniworkCreateVisibility | undefined =>
    shareWithWorkspace ? 'workspace' : undefined

  /** My Folder when no folder is known yet: main also places a null-folder create there */
  const ensureTargetFolder = async (target: DocTarget): Promise<string | null> => {
    if (target.folderId) return target.folderId
    if (typeof window.aiOffice?.uniworkEnsureMyFolder !== 'function') return null
    const ensured = await window.aiOffice
      .uniworkEnsureMyFolder(target.workspaceId)
      .catch(() => ({ ok: false as const, error: 'network' as const }))
    if (!ensured.ok) return null
    setMyFolderId(ensured.value.id)
    return ensured.value.id
  }

  // UNI-1959: a menu / strip pick creates at once - the web's default name, the open place -
  // then opens it. No name dialog: the name is asked on the first save.
  const createNow = async (kind: NewDocKind, fromStrip: boolean): Promise<void> => {
    if (creatingRef.current || unavailableKinds.has(kind)) return
    creatingRef.current = true
    setCreating(true)
    const visibility = createVisibility()
    if (fromStrip) setShareWithWorkspace(false)
    try {
      const target = activeTargetFolder
      const folderIdToUse = await ensureTargetFolder(target)
      const name = t(NEW_DEFAULT_NAME_KEY[kind])
      // UNI-1953: a UniNote is a page: its own create call, opened on the web
      const res =
        kind === 'page'
          ? await createPage({
              workspaceId: target.workspaceId,
              folderId: folderIdToUse,
              name,
              ...(visibility ? { visibility } : {}),
            })
          : await createDocument({
              workspaceId: target.workspaceId,
              folderId: folderIdToUse,
              name,
              format: kind,
              ...(visibility ? { visibility } : {}),
            })
      if (res.ok) {
        refreshAll()
        if (kind === 'page') void openCreatedPage(res.value)
        else onOpenDocument(res.value)
        return
      }
      if (res.endpointMissing) {
        setUnavailableKinds((prev) => new Set(prev).add(kind))
        setToast({ message: t('uhCreateUnavailable'), tone: 'error' })
        return
      }
      const specific = (CREATE_SPECIFIC_ERRORS as readonly string[]).includes(res.error)
        ? UNIWORK_ERROR_KEYS[res.error as UniworkDocErrorCode]
        : undefined
      setToast({ message: specific ? t(specific) : t('uhCreateFailed'), tone: 'error' })
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  // the New menu's Folder row: the app's own folder name prompt, the web's default name filled in
  const createFolderHere = () => {
    const parentId = activeTargetFolder.folderId
    if (parentId === null) return
    folderActions.openCreate(parentId, true, { initial: t(NEW_DEFAULT_NAME_KEY.folder) })
  }

  const hasFolderRow =
    (subView === 'workspace' && folderId !== null) ||
    (subView === 'my-folder' && resolvedMyFolderId !== null)

  const handleUploadDoc = async (
    input: DocTarget & { path: string; name: string },
  ): Promise<ActionOutcome> => {
    const run = ++uploadRunRef.current
    let targetFolderId = input.folderId
    if (!targetFolderId && typeof window.aiOffice?.uniworkEnsureMyFolder === 'function') {
      const ensured = await window.aiOffice
        .uniworkEnsureMyFolder(input.workspaceId)
        .catch(() => ({ ok: false as const, error: 'network' as const }))
      if (run !== uploadRunRef.current) return { ok: true }
      if (ensured.ok) {
        targetFolderId = ensured.value.id
        setMyFolderId(ensured.value.id)
      }
    }
    const uploadId = `uw-up-${Date.now()}`
    uploadIdRef.current = uploadId
    setUploadProgress({ name: input.name, loaded: 0, total: 0 })
    const res = await uploadDocument({
      workspaceId: input.workspaceId,
      folderId: targetFolderId,
      path: input.path,
      uploadId,
    })
    if (run !== uploadRunRef.current) {
      if (res.ok) refreshAll()
      return { ok: true }
    }
    uploadIdRef.current = null
    setUploadProgress(null)
    if (res.ok) {
      setUploadModal(false)
      refreshAll()
      onOpenDocument(res.value)
      return { ok: true }
    }
    if (res.error === 'upload_cancelled') {
      return { ok: false, error: 'failed' }
    }
    if (res.error === 'too_large' && res.name && typeof res.sizeBytes === 'number') {
      return {
        ok: false,
        error: {
          kind: 'too_large',
          name: res.name,
          sizeBytes: res.sizeBytes,
          maxBytes: res.maxBytes ?? 50 * 1024 * 1024,
        },
      }
    }
    if (
      isDocNameError(res.error) ||
      res.error === 'unsupported_format' ||
      res.error === 'too_large'
    ) {
      return { ok: false, error: res.error }
    }
    const key = UNIWORK_ERROR_KEYS[res.error as UniworkDocErrorCode]
    setToast({ message: key ? t(key) : t('uwDocActionFailed'), tone: 'error' })
    return { ok: false, error: 'failed' }
  }

  const handleSaveDocRename = async (doc: DocumentsHomeDoc, rawBase: string) => {
    const { ext } = renameParts(doc.title, renameFormatOf(doc))
    const checked = checkDocName(rawBase)
    if (!checked.ok) {
      setDocRename({ doc, error: checked.error, busy: false })
      return
    }
    const fullTitle = `${checked.name}${ext}`
    if (isDocTitleTooLong(fullTitle)) {
      setDocRename({ doc, error: 'name_too_long', busy: false })
      return
    }
    if (fullTitle === doc.title) {
      setDocRename(null)
      return
    }
    setDocRename({ doc, error: null, busy: true })
    const res = await renameDocument(doc.id, fullTitle)
    if (res.ok) {
      setDocRename(null)
      setPage((prev) => ({
        ...prev,
        items: prev.items.map((item) =>
          item.id === doc.id ? { ...item, title: res.value.title } : item,
        ),
      }))
      return
    }
    if (isDocNameError(res.error)) {
      setDocRename({ doc, error: res.error, busy: false })
      return
    }
    setDocRename(null)
    const key = UNIWORK_ERROR_KEYS[res.error as UniworkDocErrorCode]
    setToast({ message: key ? t(key) : t('uwDocActionFailed'), tone: 'error' })
  }

  const handleConfirmArchive = async () => {
    const doc = archiveTarget
    if (!doc) return
    setArchiveTarget(null)
    const res = await archiveDocument(doc.id)
    if (res.ok) {
      announce(t('uwDocArchived'))
      refreshAll()
      return
    }
    const key = UNIWORK_ERROR_KEYS[res.error as UniworkDocErrorCode]
    setToast({ message: key ? t(key) : t('uwDocActionFailed'), tone: 'error' })
  }

  // one restore per row at a time: the row button and the menu entry share it
  const restoringRef = useRef<Set<string>>(new Set())
  const [restoring, setRestoring] = useState<ReadonlySet<string>>(() => new Set())
  const handleRestoreDoc = async (doc: DocumentsHomeDoc) => {
    if (restoringRef.current.has(doc.id)) return
    restoringRef.current.add(doc.id)
    setRestoring(new Set(restoringRef.current))
    const res = await restoreDocument(doc.id)
    restoringRef.current.delete(doc.id)
    setRestoring(new Set(restoringRef.current))
    if (res.ok) {
      announce(t('uwDocRestore'))
      refreshAll()
      return
    }
    const key = UNIWORK_ERROR_KEYS[res.error as UniworkDocErrorCode]
    setToast({ message: key ? t(key) : t('uwDocActionFailed'), tone: 'error' })
  }

  // UNI-1961 (ARCHIVE-01): the Lưu trữ shelf's member filter and row commands.
  // The filter narrows the loaded pages only (the server has no shelved_by).
  const shelfView = subView === 'archive' && query.length === 0
  const starredView = subView === 'starred' && query.length === 0
  // the trash list proper (a search inside it lists live hits on the plain table)
  const trashView = subView === 'trash' && query.length === 0
  const pageShown = page.status !== 'error' && (page.status === 'ready' || page.items.length > 0)
  const [shelvedBy, setShelvedBy] = useState<string | null>(null)
  useEffect(() => {
    setShelvedBy(null)
  }, [workspaceId, subView])
  // UNI-2047: a selection belongs to one list: another screen, folder, search or filter starts clean,
  // (the prune below drops a row that left the table: renamed away, trashed, moved, filtered out)
  useEffect(() => {
    setSelected(new Set())
  }, [workspaceId, subView, folderId, query, wireFilters])

  // UNI-2047 A5: the bulk bar acts on the selected rows (`selectedDocs`, set once the table's rows
  // are known below); the destructive one asks once first
  const [bulkTrashConfirm, setBulkTrashConfirm] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const bulkBusyRef = useRef(false)
  const runBulkById = async (action: BulkActionId) => {
    // the ref answers a second click that lands before React re-renders
    if (bulkBusyRef.current) return
    const docs = selectedDocs
    if (docs.length === 0 || !bulkActionsFor(screen, docs).includes(action)) return
    bulkBusyRef.current = true
    setBulkBusy(true)
    const result = await runBulkAction({
      docs,
      work: bulkWorkFor(action, screen),
      refresh: refreshAll,
    })
    bulkBusyRef.current = false
    setBulkBusy(false)
    setSelected(new Set())
    const { message, tone } = bulkSummary(action, result, t)
    if (tone === 'ok') announce(message)
    setToast({ message, tone })
  }
  const onBulkAction = (action: BulkActionId) => {
    if (action === 'trash') setBulkTrashConfirm(true)
    else void runBulkById(action)
  }
  const [shelvedTrashTarget, setShelvedTrashTarget] = useState<DocumentsHomeDoc | null>(null)
  // the ref answers a second click that lands before React re-renders
  const unshelvingRef = useRef<Set<string>>(new Set())
  const [unshelving, setUnshelving] = useState<ReadonlySet<string>>(() => new Set())
  const trackUnshelving = (documentId: string, on: boolean) => {
    if (on) unshelvingRef.current.add(documentId)
    else unshelvingRef.current.delete(documentId)
    setUnshelving(new Set(unshelvingRef.current))
  }

  const handleUnshelve = async (doc: DocumentsHomeDoc) => {
    if (unshelvingRef.current.has(doc.id)) return
    trackUnshelving(doc.id, true)
    // the descendants a folder unshelve may leave are the rows shown BEFORE it
    const left = doc.kind === 'folder' ? shelvedDescendantIds(doc, page.items) : new Set<string>()
    const res = await unshelveDocument(doc.id)
    trackUnshelving(doc.id, false)
    if (res.ok) {
      const title = res.value.document.title || doc.title
      const base = t('uhShelvedToastUnshelved', { title })
      const partial = [...left].some((id) => !res.value.affected.includes(id))
      const message = partial ? `${base}. ${t('uhShelvedToastLeftShelved')}` : base
      announce(message)
      setToast({ message, tone: 'ok' })
      refreshAll()
      return
    }
    // the row is gone (another client unshelved or trashed it): reread, as the web does
    if (res.error === 'not_found') refreshAll()
    setToast({
      message:
        res.error === 'forbidden' ? t('uhShelvedNoPermission') : t('uhShelvedUnshelveFailed'),
      tone: 'error',
    })
  }

  // UNI-2047 B6: Gắn sao / Bỏ gắn sao from the row menu; an unstar rereads the Starred list, the
  // row is gone from it (no optimistic update)
  const handleFavorite = async (doc: DocumentsHomeDoc, star: boolean) => {
    const res = star ? await favoriteDocument(doc.id) : await unfavoriteDocument(doc.id)
    if (res.ok) {
      const message = t(star ? 'uhStarDone' : 'uhUnstarDone', { title: doc.title })
      announce(message)
      setToast({ message, tone: 'ok' })
      if (!star && subView === 'starred') setListTick((n) => n + 1)
      return
    }
    // the document is gone (another client trashed it): reread the list, as the other row commands do
    if (res.error === 'not_found') setListTick((n) => n + 1)
    setToast({ message: t('uhStarFailed', { title: doc.title }), tone: 'error' })
  }

  // UNI-1961: shelve at once, then a toast whose Hoàn tác unshelves it (no optimistic update)
  const shelvingRef = useRef<Set<string>>(new Set())
  const handleShelve = async (doc: DocumentsHomeDoc) => {
    if (shelvingRef.current.has(doc.id)) return
    shelvingRef.current.add(doc.id)
    const res = await shelveDocument(doc.id)
    shelvingRef.current.delete(doc.id)
    if (!res.ok) {
      setToast({
        message:
          res.error === 'forbidden' ? t('uhShelvedNoPermission') : t('uhShelvedShelveFailed'),
        tone: 'error',
      })
      return
    }
    const title = res.value.document.title || doc.title
    const message = t('uhShelvedToastShelved', { title })
    announce(message)
    setToast({
      message,
      tone: 'ok',
      action: {
        label: t('uhShelvedUndo'),
        onClick: () => {
          void (async () => {
            if (unshelvingRef.current.has(doc.id)) return
            trackUnshelving(doc.id, true)
            const undone = await unshelveDocument(doc.id)
            trackUnshelving(doc.id, false)
            if (undone.ok) {
              const back = t('uhShelvedToastUnshelved', { title })
              announce(back)
              setToast({ message: back, tone: 'ok' })
              refreshAll()
              return
            }
            setToast({
              message:
                undone.error === 'forbidden'
                  ? t('uhShelvedNoPermission')
                  : t('uhShelvedUnshelveFailed'),
              tone: 'error',
            })
          })()
        },
      },
    })
    refreshAll()
  }

  const handleConfirmShelvedTrash = async () => {
    const doc = shelvedTrashTarget
    if (!doc) return
    setShelvedTrashTarget(null)
    const res = await trashShelvedDocument(doc.id)
    if (res.ok) {
      const message = t('uhShelvedToastTrashed', { title: res.value.title || doc.title })
      announce(message)
      setToast({ message, tone: 'ok' })
      refreshAll()
      return
    }
    if (res.error === 'not_found') refreshAll()
    setToast({
      message: res.error === 'forbidden' ? t('uhShelvedNoPermission') : t('uhShelvedTrashFailed'),
      tone: 'error',
    })
  }

  const treeMenuFor = (row: TreeRow): FolderMenuItem[] => {
    const items: FolderMenuItem[] = [
      {
        id: 'new',
        label: row.id ? t('ufNewSubfolder') : t('ufNewFolder'),
        onSelect: () => {
          // the dialog renders inside this pane, which is hidden while My AI / Workbench owns the view
          onSidebarNavigate?.()
          folderActions.openCreate(row.id, row.id !== null)
        },
      },
    ]
    if (!row.id || !folderEditActionsOffered(row)) return items
    const id = row.id
    const parentId = index.get(id)?.parentId ?? null
    items.push(
      { id: 'rename', label: t('ufRename'), onSelect: () => folderActions.startTreeRename(id) },
      {
        id: 'move',
        label: t('ufMoveTo'),
        onSelect: () => {
          onSidebarNavigate?.()
          folderActions.startMove({ id, kind: 'folder', parentId, title: row.title })
        },
      },
    )
    return items
  }

  const folderCardMenuFor = (folder: DocumentsHomeDoc): FolderMenuItem[] => {
    if (folder.canEdit === false) return []
    const items: FolderMenuItem[] = [
      {
        id: 'new',
        label: t('ufNewSubfolder'),
        onSelect: () => folderActions.openCreate(folder.id, true),
      },
    ]
    if (!folderEditActionsOffered(folder)) return items
    items.push(
      { id: 'rename', label: t('ufRename'), onSelect: () => folderActions.openRename(folder) },
      {
        id: 'move',
        label: t('ufMoveTo'),
        onSelect: () =>
          folderActions.startMove({
            id: folder.id,
            kind: 'folder',
            parentId: folder.parentId ?? folderId,
            title: folder.title,
          }),
      },
    )
    return items
  }

  // where Move says a row sits now: its own parent, else the folder this view lists. Only the
  // workspace and My Folder views list a folder, so `folderId` (it outlives the view) is no
  // answer elsewhere; a recipient's row is never inside the owner's folder (UNI-1974)
  const currentParentOf = (doc: DocumentsHomeDoc): string | null => {
    if (subView === 'shared-with-me') return null
    if (doc.parentId) return doc.parentId
    if (subView === 'workspace') return folderId
    return subView === 'my-folder' ? resolvedMyFolderId : null
  }

  /** the open folder's own menu in its header (UNI-1979): the card menu minus the card, no Share */
  const openFolderMenu = (id: string): FolderMenuItem[] => {
    const node = index.get(id)
    const items: FolderMenuItem[] = [
      {
        id: 'new',
        label: t('ufNewSubfolder'),
        onSelect: () => folderActions.openCreate(id, true),
      },
    ]
    if (!node || id === resolvedMyFolderId) return items
    items.push(
      {
        id: 'rename',
        label: t('ufRename'),
        onSelect: () => folderActions.openRename({ id, title: node.title }),
      },
      {
        id: 'move',
        label: t('ufMoveTo'),
        onSelect: () =>
          folderActions.startMove({
            id,
            kind: 'folder',
            parentId: node.parentId,
            title: node.title,
          }),
      },
    )
    return items
  }

  // UNI-2047 A4: every row menu comes from the shared rules (doclist/row-menu.ts): the model owns
  // order, permissions, the delete-last rule; this host only says what it can run
  const rowMenuFor = (doc: DocumentsHomeDoc): FolderMenuItem[] =>
    buildRowMenu({
      screen,
      doc,
      label: t,
      offlineLabel: offlineToggle.labelOf(doc.id),
      run: {
        open: () => void openDoc(doc),
        offline: () =>
          offlineToggle.toggle({
            documentId: doc.id,
            workspaceId: doc.workspaceId ?? workspaceId,
            name: doc.title,
          }),
        'copy-link': () => void handleCopyLink(doc),
        rename: () => setDocRename({ doc, error: null, busy: false }),
        move: () =>
          folderActions.startMove({
            id: doc.id,
            kind: doc.kind === 'folder' ? 'folder' : 'file',
            parentId: currentParentOf(doc),
            title: doc.title,
          }),
        // UNI-2047 B6: no entry when this shell has no star IPC
        ...(canFavoriteDocuments()
          ? {
              star: () => void handleFavorite(doc, true),
              unstar: () => void handleFavorite(doc, false),
            }
          : {}),
        shelve: () => void handleShelve(doc),
        unshelve: () => void handleUnshelve(doc),
        // both confirm first: the dialog of the screen the row is on
        trash: () => (screen === 'shelved' ? setShelvedTrashTarget(doc) : setArchiveTarget(doc)),
        restore: () => void handleRestoreDoc(doc),
        details: () => showDetails(doc),
      },
    })

  const handleCopyLink = async (doc: DocumentsHomeDoc) => {
    const copied = await copyDocLink(workspaces, doc.workspaceId || workspaceId, doc.id)
    const message = t(copied ? 'dlLinkCopied' : 'dlLinkCopyFailed')
    if (copied) announce(message)
    setToast({ message, tone: copied ? 'ok' : 'error' })
  }

  // the row's Xem chi tiết: the properties panel beside the table (read-only, one at a time)
  const detailsRequest = useRef(0)
  const [details, setDetails] = useState<{ id: string; title: string; load: DocInfoLoad } | null>(
    null,
  )
  const showDetails = (doc: DocumentsHomeDoc) => {
    const request = ++detailsRequest.current
    setDetails({ id: doc.id, title: doc.title, load: { status: 'loading' } })
    void loadDocProperties(doc.id).then((result) => {
      if (request !== detailsRequest.current) return
      setDetails({
        id: doc.id,
        title: doc.title,
        load: result.ok
          ? { status: 'ready', info: result.value }
          : { status: 'error', error: result.error },
      })
    })
  }
  const closeDetails = () => {
    detailsRequest.current++
    setDetails(null)
  }

  const shelfActionsFor = (doc: DocumentsHomeDoc) => {
    if (!canManageShelved(doc)) return null
    const busy = unshelving.has(doc.id)
    return (
      <button
        type="button"
        className="btn btn-secondary dh-shelved-unshelve"
        aria-label={t('uhShelvedUnshelveItem', { title: doc.title })}
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => void handleUnshelve(doc)}
      >
        {t('uhShelvedUnshelve')}
      </button>
    )
  }

  // the trash row's Khôi phục before its "…": the same entry the menu has, so the same permission
  const trashActionsFor = (doc: DocumentsHomeDoc) => {
    if (doc.canManage !== true) return null
    const busy = restoring.has(doc.id)
    return (
      <button
        type="button"
        className="btn btn-secondary dh-trash-restore"
        aria-label={`${t('dlActRestore')} ${doc.title}`}
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => void handleRestoreDoc(doc)}
      >
        {t('dlActRestore')}
      </button>
    )
  }

  // the second line under a name: the shelf's folder line, a search hit's path, or the workspace
  // a shared-with-me row lives in
  const sublineFor = (doc: DocumentsHomeDoc): DocSubline | null => {
    if (shelfView) {
      const full =
        doc.path && doc.path.length > 0
          ? doc.path.map((crumb) => crumb.title).join(' › ')
          : t('uhShelvedPathRoot')
      return { short: full, full }
    }
    if (doc.path) {
      const hit = shortPath(
        labelMyFolderPath(doc.path, resolvedMyFolderId, myFolderLabel),
        t('ufRoot'),
      )
      return { short: hit.short, full: hit.full, path: true }
    }
    const workspace = doc.workspaceName?.trim()
    if (subView === 'shared-with-me' && workspace) return { short: workspace, full: workspace }
    if (subView === 'recent') {
      // the board's "where" line: the folder the document sits in (the root has its own name; a
      // folder the loaded tree does not hold is not guessed)
      const parent = doc.parentId ? index.get(doc.parentId)?.title : t('ufRoot')
      return parent ? { short: parent, full: parent } : null
    }
    return null
  }

  // the folder cards keep their own order: the server's position, or the name when the table sorts by it
  const folderOrder = docSort?.column === 'name' ? 'name' : 'recent'
  const folderDesc = folderOrder === 'name' && docSort?.dir === 'desc'
  const { folders, files } = useMemo(() => {
    const split = splitAndSortItems(page.items, folderOrder, dateLocale)
    const ordered = folderDesc ? [...split.folders].reverse() : split.folders
    return { folders: myFolderFirst(ordered), files: split.files }
  }, [page.items, folderOrder, folderDesc, dateLocale])

  // UNI-1961: the table's rows; at the root the source files join the documents
  // newest first under the web's paging cutoff, and the home filters the server
  // could not apply to them run here (the web's merge, use-documents-library.ts).
  // The table orders them itself (UNI-2047: header sort); the shelf lists folders as rows too.
  const tableRows = useMemo<DocumentsHomeTableRow[]>(() => {
    // the type chips the server cannot apply (UniNote, .txt on source files) and, on the shelf,
    // Người sửa / Cập nhật run on what is loaded
    const typed = (rows: DocumentsHomeTableRow[]) =>
      rows.filter((row) => rowMatchesType(row, filters.format))
    if (shelfView) {
      return typed(
        filterByShelver(page.items, shelvedBy)
          .filter((doc) => docMatchesUpdated(doc, wireFilters))
          .map((doc) => ({ type: 'doc' as const, id: doc.id, doc })),
      )
    }
    // Gắn sao: the favorites route reads the type only, so the two filters narrow what is loaded
    if (starredView) {
      return typed(
        files
          .filter((doc) => docMatchesUpdated(doc, wireFilters))
          .map((doc) => ({ type: 'doc' as const, id: doc.id, doc })),
      )
    }
    if (!sourcesMerged) {
      return typed(files.map((doc) => ({ type: 'doc' as const, id: doc.id, doc })))
    }
    return typed(
      mergeNewestFirst(page.items, sources.items, {
        docs: page.nextCursor !== null,
        sources: sources.nextCursor !== null,
      }).filter((row) =>
        row.type === 'source'
          ? sourceMatchesFilters(row.source, wireFilters)
          : row.doc.kind !== 'folder',
      ),
    )
  }, [
    shelfView,
    starredView,
    shelvedBy,
    sourcesMerged,
    files,
    page.items,
    page.nextCursor,
    sources,
    wireFilters,
    filters.format,
  ])

  // UNI-2047: the selection and the bulk bar act on the rows the person sees, not on everything
  // loaded: the shelf's Lưu trữ bởi, the type chips and the source rows narrow the table
  const visibleDocs = useMemo(
    () => tableRows.flatMap((row) => (row.type === 'doc' ? [row.doc] : [])),
    [tableRows],
  )
  useEffect(() => {
    setSelected((prev) => pruneSelection(prev, visibleDocs))
  }, [visibleDocs])
  const selectedDocs = useMemo(() => selectedDocsOf(visibleDocs, selected), [visibleDocs, selected])

  const navEntries = useMemo(() => visibleDocumentsHomeNavEntries(), [])

  const currentHeadingSpec = useMemo<
    { kind: 'literal'; text: string } | { kind: 'key'; key: StringKey }
  >(() => {
    if (subView === 'workspace' && folderId) {
      const node = index.get(folderId)
      if (node) {
        return {
          kind: 'literal',
          text: folderId === resolvedMyFolderId ? myFolderLabel : node.title,
        }
      }
      const lastCrumb = shownPath[shownPath.length - 1]
      if (lastCrumb) return { kind: 'literal', text: lastCrumb.title }
    }
    return { kind: 'key', key: getDocumentsHomeNavEntry(subView).labelKey }
  }, [subView, folderId, index, resolvedMyFolderId, myFolderLabel, shownPath])
  const currentHeading =
    currentHeadingSpec.kind === 'literal' ? currentHeadingSpec.text : t(currentHeadingSpec.key)

  const emptyMessageKey = useMemo<StringKey | null>(() => {
    if (query.length > 0) return null
    if (hasActiveFilters(filters) || (subView === 'recent' && recentSegment !== 'all')) {
      return 'uhEmptyFiltered'
    }
    switch (subView) {
      case 'my-folder':
        return 'uhEmptyMyFolder'
      case 'recent':
        return 'uhEmptyRecent'
      case 'starred':
        return 'uhEmptyStarred'
      case 'shared-with-me':
        return 'uhEmptySharedWithMe'
      case 'shared-by-me':
        return 'uhEmptySharedByMe'
      case 'trash':
        return 'uhEmptyTrash'
      case 'workspace':
      default:
        return folderId ? 'uhEmptyFolder' : 'uhEmptyWorkspace'
    }
  }, [query, filters, subView, folderId, recentSegment])
  const emptyMessage = emptyMessageKey ? t(emptyMessageKey) : t('ufNoResults', { query })

  const treeSelectedKey = useMemo(() => {
    if (sidebarIdle) return '\u0000none'
    if (subView === 'my-folder' && resolvedMyFolderId) return resolvedMyFolderId
    if (subView === 'workspace') return folderId ?? ROOT_KEY
    return '\u0000none'
  }, [sidebarIdle, subView, resolvedMyFolderId, folderId])

  const myFolderStandInCurrent = !sidebarIdle && subView === 'my-folder'

  const sidebarContent = (
    <div className="dh-sidebar-wrap">
      <nav className="dh-subnav home-area-nav" aria-label={t('ufAreaUniwork')}>
        {navEntries.map((entry) => {
          const isActive =
            !sidebarIdle && subView === entry.id && (entry.id !== 'workspace' || folderId === null)
          return (
            <button
              key={entry.id}
              type="button"
              className={`dh-nav-item nav-item${isActive ? ' active' : ''}`}
              data-nav={entry.id}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => {
                onSidebarNavigate?.()
                selectSubView(entry.id)
              }}
            >
              <SubNavIcon id={entry.id} />
              <span className="dh-nav-label">{t(entry.labelKey)}</span>
            </button>
          )
        })}
      </nav>
      <div className="dh-sidebar-folders">
        <div className="dh-sidebar-head">
          <span className="dh-sidebar-label">{t('uhSidebarFolders')}</span>
          <button
            type="button"
            className="dh-sidebar-add"
            aria-label={t('uhNewFolder')}
            title={t('uhNewFolder')}
            onClick={() => {
              onSidebarNavigate?.()
              folderActions.openCreate(
                subView === 'workspace' ? folderId : null,
                subView === 'workspace' && folderId !== null,
              )
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
        <div className="dh-sidebar-tree">
          {/* My Folder lives in the tree; until the server has created it, this row stands in its place and creates it. */}
          {tree.status !== 'loading' && !myFolderIdOf(tree.nodes) && (
            <button
              type="button"
              data-my-folder-standin=""
              className={`uwf-tree-row dh-my-folder-standin${myFolderStandInCurrent ? ' selected' : ''}`}
              aria-current={myFolderStandInCurrent ? 'page' : undefined}
              onClick={() => {
                onSidebarNavigate?.()
                selectSubView('my-folder')
              }}
            >
              <span className="uwf-twisty" aria-hidden="true" />
              <MyFolderGlyph />
              <span className="uwf-tree-text">
                <span className="uwf-tree-title">{myFolderLabel}</span>
              </span>
            </button>
          )}
          {tree.status === 'loading' && (
            <p className="uwf-side-state" role="status">
              {t('uwPickLoading')}
            </p>
          )}
          {tree.status === 'error' && (
            <div className="uwf-side-state" role="alert">
              <p>{t('ufTreeError')}</p>
              <button type="button" className="btn btn-secondary" onClick={refreshAll}>
                {t('acctRetry')}
              </button>
            </div>
          )}
          {tree.status === 'ready' && (
            <UniworkFolderTree
              idPrefix={`${uid}-tree`}
              nodes={tree.nodes}
              label={t('ufTreeLabel')}
              expanded={expanded}
              onExpandedChange={setExpanded}
              selectedKey={treeSelectedKey}
              onOpen={(id) => {
                onSidebarNavigate?.()
                openFolderInWorkspace(id)
              }}
              menuFor={treeMenuFor}
              rename={folderActions.treeRename}
              onRenameSave={(id, value) =>
                folderActions.saveTreeRename(id, value, index.get(id)?.title ?? '')
              }
              onRenameCancel={folderActions.cancelTreeRename}
              onRenameEdit={folderActions.clearTreeRenameError}
            />
          )}
        </div>
      </div>
    </div>
  )

  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const nameDialog = folderActions.nameDialog
  // an open folder (not searching): the breadcrumb leaf is its one title, the actions share the row
  const folderHeader =
    subView === 'workspace' && folderId !== null && !query && shownPath.length > 0
  // the recent-canvas layout: subtitle under the title, a search named after the screen, "Mở tiếp"
  // above the list (the app keeps its own Tải lên / Tạo mới / Tạo nhanh, which the board does not draw)
  const recentView = subView === 'recent'
  const searchLabel = recentView
    ? t('dlSearchIn', { name: currentHeading })
    : t('uhSearchPlaceholder')
  const continueDocs =
    recentView && !query && !hasActiveFilters(filters) && recentSegment === 'all'
      ? continueDocsOf(page.status === 'error' ? [] : page.items)
      : []

  return (
    <div
      className={`dh-home uwf-browser uwf-pane${sidebarHost !== undefined ? ' has-sidebar-host' : ''}`}
    >
      {sidebarHost !== undefined
        ? sidebarHost
          ? createPortal(sidebarContent, sidebarHost)
          : null
        : sidebarContent}

      <div className="dh-main uwf-main">
        <div className={`dh-toolbar${folderHeader ? ' dh-toolbar-folder' : ''}`}>
          {folderHeader && folderId !== null ? (
            <BrowserCrumbs
              path={shownPath}
              onOpen={openFolderInWorkspace}
              leafActions={
                <>
                  {folderId !== resolvedMyFolderId && (
                    <button
                      type="button"
                      className="uwf-crumb-rename"
                      aria-label={t('ufRename')}
                      title={t('ufRename')}
                      onClick={() =>
                        folderActions.openRename({
                          id: folderId,
                          title: index.get(folderId)?.title ?? currentHeading,
                        })
                      }
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                  )}
                  <FolderMenu
                    label={t('ufActionsFor', { name: currentHeading })}
                    items={openFolderMenu(folderId)}
                    dataFor="open-folder"
                    tabbable
                    open={openMenuId === 'open-folder'}
                    onOpenChange={(o) => setOpenMenuId(o ? 'open-folder' : null)}
                  />
                </>
              }
            />
          ) : (
            <div className={`dh-title-group${recentView ? ' dh-title-stack' : ''}`}>
              <h1 className="dh-title">{currentHeading}</h1>
              {recentView && <p className="dh-subtitle">{t('dlRecentSubtitle')}</p>}
            </div>
          )}
          {workspaces.length > 0 && (
            <select
              className="home-uw-ws dh-ws-select"
              aria-label={t('uwPickWorkspace')}
              value={workspaceId}
              onChange={(e) => onWorkspaceChange(e.target.value)}
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {workspaceLabel(ws, t)}
                </option>
              ))}
            </select>
          )}
          {!folderHeader && <div className="dh-toolbar-spacer" />}
          <div className="dh-search-box" role="search">
            <svg
              className="dh-search-icon"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              className="dh-search-input uwf-own-search"
              type="search"
              aria-label={searchLabel}
              placeholder={searchLabel}
              value={searchDraft}
              spellCheck={false}
              onChange={(e) => setSearchDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && searchDraft) {
                  e.preventDefault()
                  e.stopPropagation()
                  setSearchDraft('')
                }
              }}
            />
            {searchDraft && (
              <button
                type="button"
                className="dh-search-clear"
                aria-label={t('searchClear')}
                onClick={() => setSearchDraft('')}
              >
                ×
              </button>
            )}
          </div>
          <div className="dh-toolbar-actions">
            <button
              type="button"
              className="btn btn-secondary dh-toolbar-btn dh-btn-upload"
              onClick={() => setUploadModal(true)}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {t('uhUpload')}
            </button>
            <NewMenu
              label={t('uhCreateNew')}
              hasFolderRow={hasFolderRow}
              unavailable={unavailableKinds}
              unavailableHint={t('uhCreateUnavailableHint')}
              busy={creating}
              share={{ checked: shareWithWorkspace, onChange: setShareWithWorkspace }}
              onPick={(kind) => {
                if (kind === 'folder') createFolderHere()
                else void createNow(kind, false)
              }}
            />
          </div>
        </div>

        {subView !== 'trash' && subView !== 'archive' && (
          <div className="dh-quick-row">
            <span className="dh-quick-label">{t('uhQuickCreate')}</span>
            {QUICK_CREATE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className="dh-quick-pill"
                data-quick-format={kind}
                aria-disabled={creating || unavailableKinds.has(kind) || undefined}
                title={unavailableKinds.has(kind) ? t('uhCreateUnavailableHint') : undefined}
                onClick={() => void createNow(kind, true)}
              >
                <FileBadge ext={kind} size={18} />
                <span>{t(NEW_KIND_LABEL_KEY[kind])}</span>
                <span className="dh-quick-ext">{NEW_KIND_EXT[kind]}</span>
              </button>
            ))}
            <button
              type="button"
              role="switch"
              className="dh-quick-share"
              aria-checked={shareWithWorkspace}
              aria-disabled={creating || undefined}
              aria-describedby={quickShareHintId}
              onClick={() => {
                if (!creating) setShareWithWorkspace(!shareWithWorkspace)
              }}
            >
              <span className="dh-quick-check" aria-hidden="true">
                {shareWithWorkspace && (
                  <svg width="12" height="12" viewBox="0 0 16 16">
                    <path
                      d="m3.5 8.5 3 3 6-7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <span>{t('uhNewShare')}</span>
            </button>
            {/* always mounted and one line tall, so the toggle neither moves the pills nor goes unannounced */}
            <p id={quickShareHintId} role="status" className="dh-quick-share-hint">
              {shareWithWorkspace ? t('uhNewShareHint', { level: t('uhNewShareLevelView') }) : ''}
            </p>
          </div>
        )}

        {subView === 'trash' && <p className="dh-subview-banner">{t('dlTrashBanner30')}</p>}
        {folderNotice && (
          <p className="uwf-notice" role="status">
            {t(folderNotice)}
          </p>
        )}

        {/* UNI-1961: the shelf's intro and Lưu trữ bởi; its type / editor / date are the shared bar below */}
        {shelfView && (
          <ShelvedToolbar items={page.items} shelvedBy={shelvedBy} onShelvedBy={setShelvedBy} />
        )}

        {continueDocs.length > 0 && (
          <ContinueStrip
            docs={continueDocs}
            openingId={openingId}
            onOpen={(doc) => void openDoc(doc)}
          />
        )}

        <FilterBar
          filters={filters}
          onChange={setFilters}
          authors={
            subView === 'shared-with-me' ? collectUpdatedByOptions(page.items) : knownAuthors
          }
          lead={
            // the segment needs the server's last_activity: without it (or an empty pick) it is not offered
            recentView && (recentSegment !== 'all' || specialPresent('recent', page.items)) ? (
              <RecentSegmentControl
                value={recentFlat ? 'all' : recentSegment}
                disabled={recentFlat}
                onChange={setRecentSegment}
              />
            ) : undefined
          }
        />

        {page.status === 'loading' && page.items.length === 0 && (
          <div className="uw-pick-skeleton" role="status" aria-busy="true">
            <span className="uw-sr-only">{t('uwPickLoading')}</span>
            {[0, 1, 2].map((i) => (
              <div className="uw-pick-skel-row" key={i} aria-hidden="true">
                <span className="uw-skel uw-skel-icon" />
                <span className="uw-skel-lines">
                  <span className="uw-skel uw-skel-line" />
                </span>
              </div>
            ))}
          </div>
        )}

        {page.status === 'error' && (
          <div className="uw-pick-state" role="alert">
            <p className="uw-pick-state-title">
              {t(UNIWORK_ERROR_KEYS[page.error ?? 'server_error'])}
            </p>
            {errorActionOf(page.error ?? 'server_error') === 'retry' && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setListTick((n) => n + 1)}
              >
                {t('acctRetry')}
              </button>
            )}
          </div>
        )}

        {pageShown && (
          <>
            {!shelfView && folders.length > 0 && (
              <section className="dh-section dh-folders-section" aria-label={t('uhSectionFolders')}>
                <div className="dh-section-head">
                  <span className="dh-section-title">{t('uhSectionFolders')}</span>
                  <span className="dh-section-count">{folders.length}</span>
                </div>
                <div className="dh-folder-grid">
                  {folders.map((folder) => {
                    const title = entryTitleOf(folder, myFolderLabel)
                    const menuItems = folderCardMenuFor(folder)
                    const mine = isMyFolder(folder)
                    const folderSearchPath =
                      query.length > 0 && folder.path
                        ? shortPath(
                            labelMyFolderPath(folder.path, resolvedMyFolderId, myFolderLabel),
                            t('ufRoot'),
                          )
                        : null
                    return (
                      <div key={folder.id} className="dh-folder-card" data-folder-id={folder.id}>
                        <button
                          type="button"
                          className="dh-folder-open"
                          onClick={() => openFolderInWorkspace(folder.id)}
                        >
                          <span className="dh-folder-icon" aria-hidden="true">
                            {mine ? <MyFolderGlyph /> : <FolderGlyph />}
                          </span>
                          {folderSearchPath ? (
                            <span style={{ minWidth: 0, flex: 1 }}>
                              <span
                                className="dh-folder-name"
                                title={title}
                                style={{ display: 'block' }}
                              >
                                {title}
                              </span>
                              <span
                                className="dh-doc-subpath uwf-path"
                                title={folderSearchPath.full}
                              >
                                <span aria-hidden="true">{folderSearchPath.short}</span>
                                <span className="uw-sr-only">
                                  {t('ufPathLabel', { path: folderSearchPath.full })}
                                </span>
                              </span>
                            </span>
                          ) : (
                            <span className="dh-folder-name" title={title}>
                              {title}
                            </span>
                          )}
                        </button>
                        {menuItems.length > 0 && (
                          <span className="dh-folder-actions" onClick={(e) => e.stopPropagation()}>
                            <FolderMenu
                              label={t('ufActionsFor', { name: title })}
                              items={menuItems}
                              dataFor={folder.id}
                              tabbable
                              open={openMenuId === folder.id}
                              onOpenChange={(o) => setOpenMenuId(o ? folder.id : null)}
                            />
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            <section
              className={`dh-section dh-docs-section${shelfView ? ' dh-shelved-section' : ''} uwf-list`}
              aria-label={shelfView ? t('uhNavArchive') : t('uhSectionDocuments')}
            >
              {!shelfView && !recentView && (
                <div className="dh-section-head">
                  <span className="dh-section-title">{t('uhSectionDocuments')}</span>
                  <span className="dh-section-count">{tableRows.length}</span>
                </div>
              )}

              {tableRows.length === 0 ? (
                shelfView ? (
                  <div className="dh-empty dh-shelved-empty" role="status">
                    <p className="dh-shelved-empty-title">
                      {hasActiveFilters(filters) || shelvedBy !== null
                        ? t('uhShelvedNoMatchTitle')
                        : t('uhShelvedEmptyTitle')}
                    </p>
                    <p className="dh-shelved-empty-desc">
                      {hasActiveFilters(filters) || shelvedBy !== null
                        ? t('uhShelvedNoMatchDesc')
                        : t('uhShelvedEmptyDesc')}
                    </p>
                  </div>
                ) : (
                  <div className="dh-empty" role="status">
                    {emptyMessage}
                  </div>
                )
              ) : (
                <>
                  <BulkBar
                    screen={screen}
                    docs={selectedDocs}
                    busy={bulkBusy}
                    onAction={onBulkAction}
                    onClear={() => setSelected(new Set())}
                  />
                  <DocList
                    screen={screen}
                    rows={tableRows}
                    sort={flatActivitySort ? defaultSort('workspace') : docSort}
                    onSortChange={setDocSort}
                    selected={selected}
                    onSelectedChange={setSelected}
                    label={shelfView ? t('uhNavArchive') : t('uhSectionDocuments')}
                    openingId={trashView ? null : openingId}
                    openMenuId={openMenuId}
                    onOpenMenuChange={setOpenMenuId}
                    menuFor={rowMenuFor}
                    actionsFor={
                      shelfView ? shelfActionsFor : trashView ? trashActionsFor : undefined
                    }
                    onOpen={(doc) => void openDoc(doc)}
                    sublineFor={trashView ? undefined : sublineFor}
                    groups={subView !== 'trash' || trashView}
                    rename={
                      docRename
                        ? {
                            docId: docRename.doc.id,
                            error: docRename.error,
                            busy: docRename.busy,
                            onSave: (value) => void handleSaveDocRename(docRename.doc, value),
                            onCancel: () => setDocRename(null),
                            onEdit: () =>
                              setDocRename((prev) => (prev ? { ...prev, error: null } : null)),
                          }
                        : undefined
                    }
                    renderSource={(source, columns) => (
                      <DocumentsSourceRow
                        key={`source:${source.id}`}
                        source={source}
                        columns={columns}
                        menuOpen={openMenuId === `source:${source.id}`}
                        onMenuOpenChange={(o) => setOpenMenuId(o ? `source:${source.id}` : null)}
                        onOpen={(src) => void openSourceFile(src)}
                        onDownload={(src) => void downloadSourceFile(src)}
                      />
                    )}
                  />
                </>
              )}

              {page.moreError && (
                <p className="uw-pick-more-error" role="alert">
                  {t(UNIWORK_ERROR_KEYS[page.moreError])}
                </p>
              )}

              {(page.nextCursor || (sourcesMerged && sources.nextCursor)) && (
                <div className="dh-load-more-row">
                  <button
                    type="button"
                    className="btn btn-secondary uw-pick-more"
                    disabled={page.loadingMore || sources.loadingMore}
                    onClick={loadMore}
                  >
                    {page.loadingMore || sources.loadingMore
                      ? t('uwPickLoadingMore')
                      : t('uhLoadMore')}
                  </button>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {uploadModal && (
        <UploadDocDialog
          workspaces={workspaces}
          initialTarget={activeTargetFolder}
          loadTree={loadFolderTree}
          pickFile={pickUploadFile}
          onUpload={handleUploadDoc}
          progress={uploadProgress}
          onCancel={() => {
            uploadRunRef.current++
            if (uploadIdRef.current) {
              void cancelUploadDocument(uploadIdRef.current)
              uploadIdRef.current = null
            }
            setUploadProgress(null)
            setUploadModal(false)
          }}
        />
      )}

      {details && (
        <aside className="dl-details">
          <UniworkDocInfoPanel
            key={details.id}
            title={details.title}
            load={details.load}
            onClose={closeDetails}
            onRetry={() => {
              const target = tableRows.find((r) => r.type === 'doc' && r.doc.id === details.id)
              if (target?.type === 'doc') showDetails(target.doc)
            }}
          />
        </aside>
      )}

      {archiveTarget && (
        <ArchiveConfirm
          name={archiveTarget.title}
          onConfirm={() => void handleConfirmArchive()}
          onCancel={() => setArchiveTarget(null)}
        />
      )}

      {shelvedTrashTarget && (
        <ArchiveConfirm
          name={shelvedTrashTarget.title}
          onConfirm={() => void handleConfirmShelvedTrash()}
          onCancel={() => setShelvedTrashTarget(null)}
        />
      )}

      {bulkTrashConfirm && (
        <BulkTrashConfirm
          count={selectedDocs.length}
          onConfirm={() => {
            setBulkTrashConfirm(false)
            void runBulkById('trash')
          }}
          onCancel={() => setBulkTrashConfirm(false)}
        />
      )}

      {nameDialog && (
        <FolderNameDialog
          title={
            nameDialog.mode === 'rename'
              ? `${t('ufRename')} · ${nameDialog.title}`
              : nameDialog.sub
                ? t('ufNewSubfolder')
                : t('ufNewFolder')
          }
          initial={nameDialog.mode === 'rename' ? nameDialog.title : (nameDialog.initial ?? '')}
          submitLabel={nameDialog.mode === 'rename' ? t('ufSave') : t('ufCreate')}
          onSubmit={folderActions.submitName}
          onCancel={folderActions.closeNameDialog}
        />
      )}

      {folderActions.moving && (
        <UniworkFolderPicker
          title={t('ufMoveTitle', { name: folderActions.moving.title })}
          confirmLabel={t('ufMove')}
          workspaceId={workspaceId}
          loadTree={loadFolderTree}
          nodes={tree.status === 'ready' ? tree.nodes : undefined}
          moving={folderActions.moving}
          initialFolderId={folderActions.moving.parentId}
          onPick={(picked) => void folderActions.move(folderActions.moving!, picked)}
          onCancel={folderActions.cancelMove}
        />
      )}

      {offlineToggle.node}

      {toast && (
        <ActionToast
          message={toast.message}
          tone={toast.tone}
          action={toast.action}
          onDone={clearToast}
        />
      )}
    </div>
  )
}
