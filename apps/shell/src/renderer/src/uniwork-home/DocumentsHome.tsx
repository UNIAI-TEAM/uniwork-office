import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  UniworkDocErrorCode,
  UniworkDocSummary,
  UniworkFolderNode,
  UniworkWorkspaceRef,
} from '../../../shared/home-api'
import { FileBadge } from '../FileBadge'
import { useI18n, type StringKey } from '../locale'
import {
  ActionToast,
  ArchiveConfirm,
  NewDocDialog,
  RenameField,
  UploadDocDialog,
  type ActionOutcome,
  type DocTarget,
  type UploadProgress,
} from '../UniworkDocActions'
import {
  DOC_NAME_ERROR_KEYS,
  UNIWORK_ERROR_KEYS,
  checkDocName,
  docExtension,
  errorActionOf,
  formatWhen,
  isDocNameError,
  isDocTitleTooLong,
  renameParts,
  workspaceLabel,
  type DocNameError,
  type NewDocFormat,
} from '../uniwork-docs-model'
import { BrowserCrumbs } from '../uniwork-folders/BrowserCrumbs'
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
  isFolderEntry,
  isMyFolder,
  labelMyFolderPath,
  myFolderIdOf,
  shortPath,
  type PathPart,
  type TreeRow,
} from '../uniwork-folders/uniwork-folders-model'
import { useFolderActions } from '../uniwork-folders/use-folder-actions'
import {
  archiveDocument,
  cancelUploadDocument,
  createDocument,
  loadFolderTree,
  onDocRenamed,
  onTreeChanged,
  onUploadProgress,
  pickUploadFile,
  renameDocument,
  restoreDocument,
  searchDocuments,
  uploadDocument,
} from '../uniwork-library-api'
import { announce } from '../uniwork-live'
import {
  DEFAULT_DOCUMENTS_HOME_FILTERS,
  DOCUMENTS_HOME_FORMAT_OPTIONS,
  DOCUMENTS_HOME_UPDATED_OPTIONS,
  collectUpdatedByOptions,
  fetchDocumentsHomePage,
  formatAccessCell,
  formatUpdatedByCell,
  getDocumentsHomeNavEntry,
  hasActiveFilters,
  splitAndSortItems,
  toUniworkListFilters,
  visibleDocumentsHomeNavEntries,
  type DocumentsHomeApiAdapter,
  type DocumentsHomeDoc,
  type DocumentsHomeFilterState,
  type DocumentsHomeSort,
  type DocumentsHomeSubViewId,
  type DocumentsHomeTypeFilter,
  type DocumentsHomeUpdatedPreset,
  type DocumentsHomeViewMode,
  type UpdatedByOption,
} from './documents-home-model'
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
  initialFolderId?: string | null
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
  initialFolderId = null,
  onFolderChange,
}: DocumentsHomeProps) {
  const { t, dateLocale } = useI18n()
  const uid = useId()

  const [subView, setSubView] = useState<DocumentsHomeSubViewId>('workspace')
  const [folderId, setFolderId] = useState<string | null>(initialFolderId)
  const [myFolderId, setMyFolderId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([ROOT_KEY]))
  const [tree, setTree] = useState<TreeState>({ status: 'loading', nodes: [] })
  const [treeTick, setTreeTick] = useState(0)

  const [filters, setFilters] = useState<DocumentsHomeFilterState>(DEFAULT_DOCUMENTS_HOME_FILTERS)
  const [sort, setSort] = useState<DocumentsHomeSort>('recent')
  const [viewMode, setViewMode] = useState<DocumentsHomeViewMode>('list')
  const [searchDraft, setSearchDraft] = useState('')
  const [page, setPage] = useState<PageState>({
    status: 'loading',
    items: [],
    nextCursor: null,
    loadingMore: false,
  })
  const [listTick, setListTick] = useState(0)
  const [knownAuthors, setKnownAuthors] = useState<readonly UpdatedByOption[]>([])

  // Dialogs & inline actions
  const [newDocModal, setNewDocModal] = useState<{ format: NewDocFormat } | null>(null)
  const [uploadModal, setUploadModal] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)
  const uploadIdRef = useRef<string | null>(null)
  const [docRename, setDocRename] = useState<{
    doc: DocumentsHomeDoc
    error: DocNameError | null
    busy: boolean
  } | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<DocumentsHomeDoc | null>(null)
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)
  const clearToast = useCallback(() => setToast(null), [])

  const myFolderLabel = t(MY_FOLDER_LABEL_KEY)
  const labeledNodes = useMemo(
    () => tree.nodes.map((n) => (isMyFolder(n) ? { ...n, title: myFolderLabel } : n)),
    [tree.nodes, myFolderLabel],
  )
  const index = useMemo(() => buildFolderIndex(labeledNodes), [labeledNodes])
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
    setSubView('workspace')
    setFolderId(null)
    setMyFolderId(null)
    setExpanded(new Set([ROOT_KEY]))
    setFilters(DEFAULT_DOCUMENTS_HOME_FILTERS)
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
    setTree((prev) => (prev.nodes.length > 0 ? prev : { status: 'loading', nodes: [] }))
    void loadFolderTree(workspaceId)
      .then((res) => {
        if (treeSeqRef.current !== seq) return
        if (res.ok) {
          setTree({ status: 'ready', nodes: res.value })
          const foundMine = myFolderIdOf(res.value)
          if (foundMine) setMyFolderId(foundMine)
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

  // Load sub-view / folder / search items with sequence guard
  const query = searchDraft.trim()
  const listSeqRef = useRef(0)
  const wireFilters = useMemo(
    () => toUniworkListFilters(filters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters.format, filters.updatedBy, filters.updatedPreset],
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

    const api = window.aiOffice as unknown as DocumentsHomeApiAdapter
    void fetchDocumentsHomePage(api, {
      workspaceId,
      subView,
      folderId,
      myFolderId: resolvedMyFolderId,
      filters: wireFilters,
    })
      .then(({ result, ensuredMyFolder }) => {
        if (listSeqRef.current !== seq) return
        if (ensuredMyFolder) {
          setMyFolderId(ensuredMyFolder.id)
        }
        if (result.ok) {
          const items = result.value.items
          setPage({
            status: 'ready',
            items,
            nextCursor: result.value.nextCursor,
            loadingMore: false,
          })
          setKnownAuthors((prev) => {
            const merged = new Map<string, string>()
            for (const opt of prev) merged.set(opt.id, opt.name)
            for (const opt of collectUpdatedByOptions(items)) merged.set(opt.id, opt.name)
            return Array.from(merged.entries()).map(([id, name]) => ({ id, name }))
          })
        } else {
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
  }, [workspaceId, subView, folderId, resolvedMyFolderId, wireFilters, query, listTick])

  const loadMore = () => {
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
          setKnownAuthors((prev) => {
            const merged = new Map<string, string>()
            for (const opt of prev) merged.set(opt.id, opt.name)
            for (const opt of collectUpdatedByOptions(nextItems)) merged.set(opt.id, opt.name)
            return Array.from(merged.entries()).map(([id, name]) => ({ id, name }))
          })
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

  // Pre-select the requested format when NewDocDialog opens from a quick-create pill
  useEffect(() => {
    if (!newDocModal || newDocModal.format === 'docx') return
    const radio = document.querySelector<HTMLInputElement>(
      `.modal.uw-act input[type="radio"][value="${newDocModal.format}"]`,
    )
    if (radio && !radio.checked) {
      radio.click()
    }
  }, [newDocModal])

  // Subscribe to upload progress while upload modal is open
  useEffect(() => {
    if (!uploadModal) return
    return onUploadProgress((ev) => {
      if (ev.uploadId === uploadIdRef.current) {
        setUploadProgress({
          name: ev.path.split(/[\\/]/).pop() ?? '',
          loaded: ev.loaded,
          total: ev.total,
        })
      }
    })
  }, [uploadModal])

  const selectSubView = (next: DocumentsHomeSubViewId) => {
    setSearchDraft('')
    setSubView(next)
    if (next === 'workspace') {
      setFolderId(null)
    }
  }

  const openFolderInWorkspace = (id: string | null) => {
    setSearchDraft('')
    if (id !== null && id === resolvedMyFolderId) {
      setSubView('my-folder')
      setFolderId(id)
      return
    }
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

  const handleCreateDoc = async (
    input: DocTarget & { name: string; format: NewDocFormat },
  ): Promise<ActionOutcome> => {
    let targetFolderId = input.folderId
    if (!targetFolderId && typeof window.aiOffice?.uniworkEnsureMyFolder === 'function') {
      const ensured = await window.aiOffice
        .uniworkEnsureMyFolder(input.workspaceId)
        .catch(() => ({ ok: false as const, error: 'network' as const }))
      if (ensured.ok) {
        targetFolderId = ensured.value.id
        setMyFolderId(ensured.value.id)
      }
    }
    const res = await createDocument({
      workspaceId: input.workspaceId,
      folderId: targetFolderId,
      name: input.name,
      format: input.format,
    })
    if (res.ok) {
      setNewDocModal(null)
      refreshAll()
      onOpenDocument(res.value)
      return { ok: true }
    }
    if (isDocNameError(res.error) || res.error === 'unsupported_format') {
      return { ok: false, error: res.error }
    }
    const key = UNIWORK_ERROR_KEYS[res.error as UniworkDocErrorCode]
    setToast({ message: key ? t(key) : t('uwDocActionFailed'), tone: 'error' })
    return { ok: false, error: 'failed' }
  }

  const handleUploadDoc = async (
    input: DocTarget & { path: string; name: string },
  ): Promise<ActionOutcome> => {
    let targetFolderId = input.folderId
    if (!targetFolderId && typeof window.aiOffice?.uniworkEnsureMyFolder === 'function') {
      const ensured = await window.aiOffice
        .uniworkEnsureMyFolder(input.workspaceId)
        .catch(() => ({ ok: false as const, error: 'network' as const }))
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
    uploadIdRef.current = null
    setUploadProgress(null)
    if (res.ok) {
      setUploadModal(false)
      refreshAll()
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
    const { ext } = renameParts(doc.title, doc.format)
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

  const handleRestoreDoc = async (doc: DocumentsHomeDoc) => {
    const res = await restoreDocument(doc.id)
    if (res.ok) {
      announce(t('uwDocRestore'))
      refreshAll()
      return
    }
    const key = UNIWORK_ERROR_KEYS[res.error as UniworkDocErrorCode]
    setToast({ message: key ? t(key) : t('uwDocActionFailed'), tone: 'error' })
  }

  const treeMenuFor = (row: TreeRow): FolderMenuItem[] => {
    const items: FolderMenuItem[] = [
      {
        id: 'new',
        label: row.id ? t('ufNewSubfolder') : t('ufNewFolder'),
        onSelect: () => folderActions.openCreate(row.id, row.id !== null),
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
        onSelect: () => folderActions.startMove({ id, kind: 'folder', parentId, title: row.title }),
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

  const docMenuFor = (doc: DocumentsHomeDoc): FolderMenuItem[] => {
    const items: FolderMenuItem[] = []
    const archived = doc.archived === true || subView === 'trash'
    if (archived) {
      if (doc.canManage) {
        items.push({
          id: 'restore',
          label: t('uwDocRestore'),
          onSelect: () => void handleRestoreDoc(doc),
        })
      }
      return items
    }
    if (doc.canEdit !== false) {
      if (doc.canEdit === true) {
        items.push({
          id: 'rename',
          label: t('uwDocRename'),
          onSelect: () => setDocRename({ doc, error: null, busy: false }),
        })
      }
      items.push({
        id: 'move',
        label: t('ufMoveTo'),
        onSelect: () =>
          folderActions.startMove({
            id: doc.id,
            kind: 'file',
            parentId: doc.parentId ?? folderId,
            title: doc.title,
          }),
      })
    }
    if (doc.canManage === true) {
      items.push({
        id: 'archive',
        label: t('uwDocArchive'),
        onSelect: () => setArchiveTarget(doc),
      })
    }
    return items
  }

  const { folders, files } = useMemo(
    () => splitAndSortItems(page.items, sort, dateLocale),
    [page.items, sort, dateLocale],
  )

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
    if (subView !== 'shared-with-me' && hasActiveFilters(filters)) return 'uhEmptyFiltered'
    switch (subView) {
      case 'my-folder':
        return 'uhEmptyMyFolder'
      case 'recent':
        return 'uhEmptyRecent'
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
  }, [query, filters, subView, folderId])
  const emptyMessage = emptyMessageKey ? t(emptyMessageKey) : t('ufNoResults', { query })

  const treeSelectedKey = useMemo(() => {
    if (subView === 'my-folder' && resolvedMyFolderId) return resolvedMyFolderId
    if (subView === 'workspace') return folderId ?? ROOT_KEY
    return '\u0000none'
  }, [subView, resolvedMyFolderId, folderId])

  const sidebarContent = (
    <div className="dh-sidebar-wrap">
      <nav className="dh-subnav home-area-nav" aria-label={t('ufAreaUniwork')}>
        {navEntries.map((entry) => {
          const isActive = subView === entry.id && (entry.id !== 'workspace' || folderId === null)
          return (
            <button
              key={entry.id}
              type="button"
              className={`dh-nav-item nav-item${isActive ? ' active' : ''}`}
              data-nav={entry.id}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => selectSubView(entry.id)}
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
            onClick={() =>
              folderActions.openCreate(
                subView === 'workspace' ? folderId : null,
                subView === 'workspace' && folderId !== null,
              )
            }
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
              onOpen={openFolderInWorkspace}
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
        {subView === 'workspace' && folderId !== null && !query && (
          <BrowserCrumbs path={shownPath} onOpen={openFolderInWorkspace} />
        )}

        <div className="dh-toolbar">
          <div className="dh-title-group">
            <h1 className="dh-title">{currentHeading}</h1>
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
          </div>
          <div className="dh-toolbar-spacer" />
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
              aria-label={t('uhSearchPlaceholder')}
              placeholder={t('uhSearchPlaceholder')}
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
          <button
            type="button"
            className="btn btn-primary dh-toolbar-btn dh-btn-create"
            onClick={() => setNewDocModal({ format: 'docx' })}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t('uhCreateNew')}
          </button>
        </div>

        {subView !== 'trash' && (
          <div className="dh-quick-row">
            <span className="dh-quick-label">{t('uhQuickCreate')}</span>
            <button
              type="button"
              className="dh-quick-pill"
              data-quick-format="docx"
              onClick={() => setNewDocModal({ format: 'docx' })}
            >
              <FileBadge ext="docx" size={18} />
              <span>{t('uhQuickDocx')}</span>
            </button>
            <button
              type="button"
              className="dh-quick-pill"
              data-quick-format="xlsx"
              onClick={() => setNewDocModal({ format: 'xlsx' })}
            >
              <FileBadge ext="xlsx" size={18} />
              <span>{t('uhQuickXlsx')}</span>
            </button>
            <button
              type="button"
              className="dh-quick-pill"
              data-quick-format="pptx"
              onClick={() => setNewDocModal({ format: 'pptx' })}
            >
              <FileBadge ext="pptx" size={18} />
              <span>{t('uhQuickPptx')}</span>
            </button>
            <span className="dh-quick-hint">
              <svg
                className="dh-quick-hint-icon"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              <span>{t('uhQuickHintPrefix')}</span>
              <button
                type="button"
                className="dh-quick-hint-link"
                onClick={() => selectSubView('my-folder')}
              >
                {t('uhNavMyFolder')}
              </button>
              <span>{t('uhQuickHintSuffix')}</span>
            </span>
          </div>
        )}

        {subView === 'my-folder' && <p className="dh-subview-banner">{t('uhMyFolderNote')}</p>}
        {subView === 'trash' && <p className="dh-subview-banner">{t('uhTrashNote')}</p>}

        <div className="dh-filter-bar">
          {subView !== 'shared-with-me' && (
            <>
              <label className="dh-filter-chip">
                <span className="dh-filter-k">{t('uhFilterType')}</span>
                <select
                  className="dh-filter-select"
                  data-filter="format"
                  aria-label={t('uhFilterType')}
                  value={filters.format}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      format: e.target.value as DocumentsHomeTypeFilter,
                    }))
                  }
                >
                  {DOCUMENTS_HOME_FORMAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.labelKey ? t(opt.labelKey) : opt.literal}
                    </option>
                  ))}
                </select>
              </label>

              <label className="dh-filter-chip">
                <span className="dh-filter-k">{t('uhFilterModifiedBy')}</span>
                <select
                  className="dh-filter-select"
                  data-filter="updatedBy"
                  aria-label={t('uhFilterModifiedBy')}
                  value={filters.updatedBy}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      updatedBy: e.target.value,
                    }))
                  }
                >
                  <option value="">{t('uhFilterAnyPerson')}</option>
                  {knownAuthors.map((author) => (
                    <option key={author.id} value={author.id}>
                      {author.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="dh-filter-chip">
                <span className="dh-filter-k">{t('uhFilterUpdated')}</span>
                <select
                  className="dh-filter-select"
                  data-filter="updatedFrom"
                  aria-label={t('uhFilterUpdated')}
                  value={filters.updatedPreset}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      updatedPreset: e.target.value as DocumentsHomeUpdatedPreset,
                    }))
                  }
                >
                  {DOCUMENTS_HOME_UPDATED_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {t(opt.labelKey)}
                    </option>
                  ))}
                </select>
              </label>

              {hasActiveFilters(filters) && (
                <button
                  type="button"
                  className="dh-filter-clear"
                  onClick={() => setFilters(DEFAULT_DOCUMENTS_HOME_FILTERS)}
                >
                  {t('uhFilterClear')}
                </button>
              )}
            </>
          )}

          <div className="dh-view-tools">
            <button
              type="button"
              className="dh-sort-btn"
              onClick={() => setSort((prev) => (prev === 'recent' ? 'name' : 'recent'))}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m3 16 4 4 4-4M7 20V4M21 8l-4-4-4 4M17 4v16" />
              </svg>
              <span>{sort === 'recent' ? t('uhSortRecent') : t('uhSortName')}</span>
            </button>
            <div className="dh-view-toggle" role="group" aria-label={t('uhViewModeLabel')}>
              <button
                type="button"
                className="dh-view-btn"
                data-view="list"
                aria-pressed={viewMode === 'list'}
                title={t('uhViewList')}
                aria-label={t('uhViewList')}
                onClick={() => setViewMode('list')}
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
                  <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                </svg>
              </button>
              <button
                type="button"
                className="dh-view-btn"
                data-view="grid"
                aria-pressed={viewMode === 'grid'}
                title={t('uhViewGrid')}
                aria-label={t('uhViewGrid')}
                onClick={() => setViewMode('grid')}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
              </button>
            </div>
          </div>
        </div>

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

        {page.status !== 'error' && (page.status === 'ready' || page.items.length > 0) && (
          <>
            {folders.length > 0 && (
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
                          <span className="dh-folder-name" title={title}>
                            {title}
                          </span>
                        </button>
                        {menuItems.length > 0 && (
                          <span
                            className="dh-folder-actions"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <FolderMenu
                              label={t('ufActionsFor', { name: title })}
                              items={menuItems}
                              dataFor={folder.id}
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
              className="dh-section dh-docs-section uwf-list"
              aria-label={t('uhSectionDocuments')}
            >
              <div className="dh-section-head">
                <span className="dh-section-title">{t('uhSectionDocuments')}</span>
                <span className="dh-section-count">{files.length}</span>
              </div>

              {files.length === 0 ? (
                <div className="dh-empty" role="status">
                  {emptyMessage}
                </div>
              ) : (
                <div
                  className={`dh-doc-table${viewMode === 'grid' ? ' grid-mode' : ''}`}
                  role="table"
                  aria-label={t('uhSectionDocuments')}
                >
                  <div className="dh-doc-head" role="row">
                    <div className="dh-col-name" role="columnheader">
                      {t('uhColName')}
                    </div>
                    <div className="dh-col-access" role="columnheader">
                      {t('uhColAccess')}
                    </div>
                    <div className="dh-col-person" role="columnheader">
                      {t('uhColUpdatedBy')}
                    </div>
                    <div className="dh-col-time" role="columnheader">
                      {t('uhColUpdatedAt')}
                    </div>
                    <div
                      className="dh-col-actions"
                      role="columnheader"
                      aria-label={t('uhColActions')}
                    />
                  </div>

                  {files.map((doc) => {
                    const access = formatAccessCell(doc, t)
                    const person = formatUpdatedByCell(doc)
                    const menuItems = docMenuFor(doc)
                    const renaming = docRename?.doc.id === doc.id ? docRename : null
                    const searchPath =
                      query.length > 0 && doc.path
                        ? shortPath(
                            labelMyFolderPath(doc.path, resolvedMyFolderId, myFolderLabel),
                            t('ufRoot'),
                          )
                        : subView === 'shared-with-me' && doc.workspaceName?.trim()
                          ? { short: doc.workspaceName.trim(), full: doc.workspaceName.trim() }
                          : null
                    const isOpening = openingId === doc.id

                    return (
                      <div
                        key={doc.id}
                        role="row"
                        data-doc-id={doc.id}
                        aria-busy={isOpening || undefined}
                        className={`dh-doc-row uw-pick-row${isOpening ? ' opening' : ''}`}
                        onDoubleClick={() => {
                          if (!renaming && !isFolderEntry(doc)) onOpenDocument(doc)
                        }}
                      >
                        <div className="dh-cell-name" role="cell">
                          <FileBadge ext={docExtension(doc)} size={28} />
                          {renaming ? (
                            <RenameField
                              initial={renameParts(doc.title, doc.format).base}
                              label={doc.title}
                              error={renaming.error}
                              busy={renaming.busy}
                              errorKeys={DOC_NAME_ERROR_KEYS}
                              onSave={(val) => void handleSaveDocRename(doc, val)}
                              onCancel={() => setDocRename(null)}
                              onEdit={() =>
                                setDocRename((prev) => (prev ? { ...prev, error: null } : null))
                              }
                            />
                          ) : (
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <button
                                type="button"
                                className="dh-doc-open"
                                title={doc.title}
                                onClick={() => onOpenDocument(doc)}
                              >
                                {doc.title}
                              </button>
                              {searchPath && (
                                <span className="dh-doc-subpath" title={searchPath.full}>
                                  {searchPath.short}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="dh-cell-access" role="cell">
                          {access.isEmpty ? (
                            <span className="dh-cell-empty">—</span>
                          ) : (
                            <>
                              {access.visibilityLabel && (
                                <span className={`dh-vis-badge dh-vis-${access.tone}`}>
                                  {access.visibilityLabel}
                                </span>
                              )}
                              {access.levelLabel && (
                                <span className="dh-level-sub">{access.levelLabel}</span>
                              )}
                            </>
                          )}
                        </div>

                        <div className="dh-cell-person" role="cell">
                          {person.name ? (
                            <>
                              <span className="dh-avatar" aria-hidden="true">
                                {person.initial}
                              </span>
                              <span className="dh-person-name" title={person.name}>
                                {person.name}
                              </span>
                            </>
                          ) : (
                            <span className="dh-cell-empty">—</span>
                          )}
                        </div>

                        <div className="dh-cell-time" role="cell">
                          {formatWhen(doc.updatedAt, dateLocale)}
                        </div>

                        <div
                          className="dh-cell-actions"
                          role="cell"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {menuItems.length > 0 && (
                            <FolderMenu
                              label={t('ufActionsFor', { name: doc.title })}
                              items={menuItems}
                              dataFor={doc.id}
                              open={openMenuId === doc.id}
                              onOpenChange={(o) => setOpenMenuId(o ? doc.id : null)}
                            />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {page.moreError && (
                <p className="uw-pick-more-error" role="alert">
                  {t(UNIWORK_ERROR_KEYS[page.moreError])}
                </p>
              )}

              {page.nextCursor && (
                <div className="dh-load-more-row">
                  <button
                    type="button"
                    className="btn btn-secondary uw-pick-more"
                    disabled={page.loadingMore}
                    onClick={loadMore}
                  >
                    {page.loadingMore ? t('uwPickLoadingMore') : t('uhLoadMore')}
                  </button>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {newDocModal && (
        <NewDocDialog
          workspaces={workspaces}
          initialTarget={activeTargetFolder}
          loadTree={loadFolderTree}
          onCreate={handleCreateDoc}
          onCancel={() => setNewDocModal(null)}
        />
      )}

      {uploadModal && (
        <UploadDocDialog
          workspaces={workspaces}
          initialTarget={activeTargetFolder}
          loadTree={loadFolderTree}
          pickFile={pickUploadFile}
          onUpload={handleUploadDoc}
          progress={uploadProgress}
          onCancel={() => {
            if (uploadIdRef.current) {
              void cancelUploadDocument(uploadIdRef.current)
              uploadIdRef.current = null
            }
            setUploadProgress(null)
            setUploadModal(false)
          }}
        />
      )}

      {archiveTarget && (
        <ArchiveConfirm
          name={archiveTarget.title}
          onConfirm={() => void handleConfirmArchive()}
          onCancel={() => setArchiveTarget(null)}
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
          initial={nameDialog.mode === 'rename' ? nameDialog.title : ''}
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

      {toast && <ActionToast message={toast.message} tone={toast.tone} onDone={clearToast} />}
    </div>
  )
}
