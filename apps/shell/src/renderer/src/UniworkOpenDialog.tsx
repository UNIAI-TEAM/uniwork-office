import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { UniworkDocErrorCode, UniworkDocListPage, UniworkResult } from '../../shared/home-api'
import { FileBadge } from './FileBadge'
import { UniworkDocInfoPanel, type DocInfoLoad } from './UniworkDocInfoPanel'
import {
  ActionToast,
  ArchiveConfirm,
  NewDocDialog,
  RenameField,
  RowMenu,
  UploadDocDialog,
  type ActionOutcome,
  type DocTarget,
  type RowAction,
  type UploadProgress,
} from './UniworkDocActions'
import { useI18n } from './locale'
import { needsSignIn, type AccountView } from './account-model'
import { publishLocalRename, publishUniworkNotice } from './uniwork-notice-bus'
import {
  PICKER_PAGE_SIZE,
  PICKER_SEARCH_DEBOUNCE_MS,
  SHARED_SOURCE_VALUE,
  UNIWORK_ERROR_KEYS,
  checkDocName,
  docExtension,
  errorActionOf,
  hasRowActions,
  isDocNameError,
  isDocTitleTooLong,
  initialPickerState,
  hiddenDocCount,
  isOpenable,
  pickerBodyOf,
  pickerReducer,
  pickerRowMeta,
  renameParts,
  retryActionOf,
  rowActionsOf,
  visibleDocs,
  workspaceLabel,
  type DocNameError,
  type LibraryDocRow,
  type PickerBody,
  type PickerState,
} from './uniwork-docs-model'
import { readActiveWorkspaceId, writeActiveWorkspaceId } from './active-workspace'
import { BROWSER_HIDDEN_HINT_ID } from './uniwork-folders/BrowserContents'
import { UniworkBrowser } from './uniwork-folders/UniworkBrowser'
import type { PathPart } from './uniwork-folders/uniwork-folders-model'
import {
  archiveDocument,
  cancelUploadDocument,
  createDocument,
  loadFolderTree,
  listSharedDocuments,
  loadDocProperties,
  onDocRenamed,
  onUploadProgress,
  pickUploadFile,
  renameDocument,
  restoreDocument,
  uploadDocument,
  type DocActionResult,
  type SharedDocSummary,
} from './uniwork-library-api'

/** a rejected IPC call is a network failure to the person using the picker */
function settle<T>(call: Promise<UniworkResult<T>>): Promise<UniworkResult<T>> {
  return call.catch((): UniworkResult<T> => ({ ok: false, error: 'network' }))
}

function Spinner() {
  return (
    <svg className="uw-spinner" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeDasharray="26"
        strokeDashoffset="18"
        strokeLinecap="round"
      />
    </svg>
  )
}

const FOCUSABLE =
  'button:not([disabled]):not([tabindex="-1"]), select:not([disabled]), input:not([disabled]), [tabindex="0"]'

/** an action call that rejected is a failure like any other (toast, nothing applied) */
function settleAction<T>(call: Promise<DocActionResult<T>>): Promise<DocActionResult<T>> {
  return call.catch((): DocActionResult<T> => ({ ok: false, error: 'network' }))
}

/** one page of the current source: the workspace's documents, or the shared list */
function fetchPage(s: PickerState, cursor?: string): Promise<UniworkResult<UniworkDocListPage>> {
  const workspaceId = s.workspaceId!
  if (s.source === 'shared') {
    return settle(listSharedDocuments({ cursor, limit: PICKER_PAGE_SIZE }))
  }
  return settle(
    window.aiOffice.uniworkListDocuments({
      workspaceId,
      query: s.query || undefined,
      cursor,
      limit: PICKER_PAGE_SIZE,
    }),
  )
}

/** the bodies that sit on a loaded list, where a count of hidden rows makes sense */
const HIDDEN_HINT_BODIES: readonly PickerBody['kind'][] = [
  'list',
  'empty',
  'shared-empty',
  'no-results',
]

/** id of the muted "hidden because the format does not open" line the search box is described by */
const HIDDEN_HINT_ID = 'uw-pick-hidden'

/**
 * "Open from UniWork" picker: workspace selector, debounced search, a paged
 * document list. The search box owns focus (combobox pattern): arrow keys move
 * the highlighted row, Enter opens it, Escape closes. Documents UniWork Office
 * cannot open are not listed: they are hidden and counted in one muted status
 * line, and every body that can end up with hidden rows still offers Load more,
 * so a later page that holds openable documents stays reachable.
 *
 * FD-11: the body is the UniWork browser - Recent and Shared with me stay as
 * views above the folder tree; choosing the root or a folder shows its
 * contents, and the search box then searches titles across the workspace.
 */
export function UniworkOpenDialog({
  onClose,
  accountView,
  onSignIn,
}: {
  onClose: () => void
  accountView: AccountView
  onSignIn: () => void
}) {
  const { t, dateLocale } = useI18n()
  const [state, dispatch] = useReducer(pickerReducer, undefined, () =>
    initialPickerState(readActiveWorkspaceId()),
  )
  const stateRef = useRef(state)
  stateRef.current = state
  const mounted = useRef(true)
  /** the document the last open attempt was for (Retry / sign-in resumes it) */
  const lastOpen = useRef<{ id: string; title: string } | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [draft, setDraft] = useState('')
  const [composing, setComposing] = useState(false)
  const [workspaceTick, setWorkspaceTick] = useState(0)
  /** the document whose details panel is open */
  const [info, setInfo] = useState<{ id: string; title: string; load: DocInfoLoad } | null>(null)
  const infoRequest = useRef(0)
  /** S18: the New document / Upload dialog, the row being renamed, the archive prompt */
  const [form, setForm] = useState<'new' | 'upload' | null>(null)
  const [upload, setUpload] = useState<UploadProgress | null>(null)
  /** bumped by every upload start and cancel: a result of an older upload is ignored */
  const uploadRun = useRef(0)
  /** the id of the upload under way: progress of any other upload is not ours */
  const uploadId = useRef<string | null>(null)
  /** rows with an archive/restore call in flight (one call per row at a time) */
  const rowBusy = useRef(new Set<string>())
  const [renaming, setRenaming] = useState<{
    id: string
    error: DocNameError | null
    busy: boolean
  } | null>(null)
  const [archiving, setArchiving] = useState<{ id: string; title: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])
  /** FD-11: the workspace's Recent list, or the folder browser's contents */
  const [view, setView] = useState<'recent' | 'folder'>('recent')
  /** the committed title search of the folder view (the recent list keeps state.query) */
  const [folderQuery, setFolderQuery] = useState('')
  const [folderHiddenHint, setFolderHiddenHint] = useState(false)
  /** the folder open in the browser: New / Upload default to it */
  const browsed = useRef<{ folderId: string | null; path: PathPart[] }>({
    folderId: null,
    path: [],
  })
  const folderView = view === 'folder' && state.source === 'workspace'

  useEffect(() => {
    mounted.current = true
    const before = document.activeElement as HTMLElement | null
    return () => {
      mounted.current = false
      before?.focus?.()
    }
  }, [])

  // workspaces (again after Retry)
  useEffect(() => {
    let live = true
    void settle(window.aiOffice.uniworkListWorkspaces()).then((result) => {
      if (live) dispatch({ type: 'workspaces-loaded', result })
    })
    return () => {
      live = false
    }
  }, [workspaceTick])

  // a document renamed elsewhere (or by main after a save) shows its new title in place
  useEffect(
    () =>
      onDocRenamed(({ documentId, title }) =>
        dispatch({ type: 'doc-renamed', id: documentId, title }),
      ),
    [],
  )

  useEffect(
    () =>
      onUploadProgress((event) => {
        if (event.uploadId !== uploadId.current) return
        setUpload((prev) => (prev ? { ...prev, loaded: event.loaded, total: event.total } : prev))
      }),
    [],
  )

  // a fresh document fetch starts whenever the reducer bumps the request id
  const requestId = state.list.requestId
  useEffect(() => {
    if (requestId === 0 || !stateRef.current.workspaceId) return
    void fetchPage(stateRef.current).then((result) =>
      dispatch({ type: 'list-loaded', requestId, append: false, result }),
    )
  }, [requestId])

  // debounced search; IME composition waits for the committed text
  useEffect(() => {
    const next = draft.trim()
    const committed = folderView ? folderQuery : state.query
    if (composing || next === committed) return
    const timer = window.setTimeout(
      () => (folderView ? setFolderQuery(next) : dispatch({ type: 'set-query', query: next })),
      PICKER_SEARCH_DEBOUNCE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [draft, composing, state.query, folderQuery, folderView])

  /** FD-11: leave one view for another; the search box starts empty in the new one */
  const switchView = (next: 'recent' | 'shared' | 'folder') => {
    const current = state.source === 'shared' ? 'shared' : view
    if (next === current) return
    setDraft('')
    setFolderQuery('')
    if (state.query) dispatch({ type: 'set-query', query: '' })
    infoRequest.current++
    setInfo(null)
    if (next === 'shared') {
      dispatch({ type: 'select-shared' })
      return
    }
    if (state.source === 'shared' && state.workspaceId) {
      dispatch({ type: 'select-workspace', id: state.workspaceId })
    }
    setView(next)
  }

  const retry = useCallback(() => {
    const action = retryActionOf(stateRef.current)
    dispatch(action)
    if (action.type === 'workspaces-retry') setWorkspaceTick((n) => n + 1)
  }, [])

  const loadMore = () => {
    const s = stateRef.current
    const { nextCursor } = s.list
    if (!nextCursor || s.list.loadingMore || !s.workspaceId) return
    const { requestId: id } = s.list
    dispatch({ type: 'load-more' })
    void fetchPage(s, nextCursor).then((result) =>
      dispatch({ type: 'list-loaded', requestId: id, append: true, result }),
    )
  }

  const showInfo = (id: string, title: string) => {
    const request = ++infoRequest.current
    setInfo({ id, title, load: { status: 'loading' } })
    void settle(loadDocProperties(id)).then((result) => {
      if (!mounted.current || request !== infoRequest.current) return
      setInfo({
        id,
        title,
        load: result.ok
          ? { status: 'ready', info: result.value }
          : { status: 'error', error: result.error },
      })
    })
  }

  /** close the details panel and give focus back to the row's Details button */
  const closeInfo = () => {
    const id = info?.id
    infoRequest.current++
    setInfo(null)
    if (id) {
      window.setTimeout(() => {
        Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('[data-info-for]') ?? [])
          .find((el) => el.dataset.infoFor === id)
          ?.focus()
      })
    }
  }

  const openDoc = (id: string) => {
    const doc = stateRef.current.list.docs.find((d) => d.id === id)
    if (!doc || !isOpenable(doc)) return
    openById(doc)
  }

  /** open a document by its id (a listed row, or the one just created / uploaded) */
  const openById = (doc: { id: string; title: string }) => {
    if (stateRef.current.opening) return
    lastOpen.current = { id: doc.id, title: doc.title }
    dispatch({ type: 'open-start', id: doc.id, title: doc.title })
    void settle(window.aiOffice.uniworkOpenDocument(doc.id)).then((result) => {
      if (result.ok) {
        // lets the recents list pick the document up at once
        publishUniworkNotice({ phase: 'opened', path: result.value.path, title: doc.title })
        if (mounted.current) onClose()
      } else if (mounted.current) {
        dispatch({ type: 'open-failed', error: result.error })
      } else {
        // the dialog was closed while the document was still opening
        publishUniworkNotice({ phase: 'failed', error: result.error })
      }
    })
  }

  // ── S18: create, upload, rename, archive ──

  /** where a new document goes by default: the folder open in the browser, else the top level */
  const defaultTarget = (): DocTarget => {
    const s = stateRef.current
    if (folderView && s.workspaceId) {
      const { folderId, path } = browsed.current
      return { workspaceId: s.workspaceId, folderId, folderPath: path }
    }
    return { workspaceId: s.workspaceId ?? s.workspaces.items[0]?.id ?? '', folderId: null }
  }

  /** a name or format error stays at the field; anything else is a toast and nothing applies */
  const outcomeOf = (error: string): ActionOutcome => {
    if (isDocNameError(error) || error === 'unsupported_format') return { ok: false, error }
    setToast(t('uwDocActionFailed'))
    return { ok: false, error: 'failed' }
  }

  /** a new or uploaded document opens by its id: the server's document, no local copy first */
  const created = (result: DocActionResult<{ id: string; title: string }>): ActionOutcome => {
    if (!mounted.current) return { ok: true }
    if (!result.ok) return outcomeOf(result.error)
    setForm(null)
    openById(result.value)
    return { ok: true }
  }

  const createDoc = (input: Parameters<typeof createDocument>[0]) =>
    settleAction(createDocument(input)).then(created)

  /**
   * Cancel / Esc / overlay on the Upload dialog. Main aborts the upload by its
   * id; if the server had already answered, the document exists anyway, so the
   * renderer also stops listening: a late result neither opens it nor toasts.
   */
  const cancelUpload = () => {
    uploadRun.current++
    if (uploadId.current) void cancelUploadDocument(uploadId.current).catch(() => undefined)
    uploadId.current = null
    setUpload(null)
    setForm(null)
  }

  const uploadDoc = (input: DocTarget & { path: string; name: string }) => {
    const run = ++uploadRun.current
    const id = crypto.randomUUID()
    uploadId.current = id
    setUpload({ name: input.name, loaded: 0, total: 0 })
    return settleAction(
      uploadDocument({
        workspaceId: input.workspaceId,
        folderId: input.folderId,
        path: input.path,
        uploadId: id,
      }),
    ).then((result): ActionOutcome => {
      if (run !== uploadRun.current) return { ok: true }
      uploadId.current = null
      if (mounted.current) setUpload(null)
      // a cancelled upload is never an error to show
      if (!result.ok && result.error === 'upload_cancelled') return { ok: true }
      return created(result)
    })
  }

  /** focus back on a row's "…" button (after rename / archive) */
  const focusRowMenu = (id: string) => {
    window.setTimeout(() => {
      Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('[data-menu-for]') ?? [])
        .find((el) => el.dataset.menuFor === id)
        ?.focus()
    })
  }

  const endRename = (id: string) => {
    setRenaming(null)
    focusRowMenu(id)
  }

  const saveRename = (doc: LibraryDocRow, value: string) => {
    const { ext } = renameParts(doc.title, doc.format)
    const checked = checkDocName(value)
    if (!checked.ok) {
      setRenaming({ id: doc.id, error: checked.error, busy: false })
      return
    }
    const next = checked.name + ext
    // the limit counts the whole title, so a long name plus its extension is caught here too
    if (isDocTitleTooLong(next)) {
      setRenaming({ id: doc.id, error: 'name_too_long', busy: false })
      return
    }
    if (next === doc.title) {
      endRename(doc.id)
      return
    }
    const before = doc.title
    setRenaming({ id: doc.id, error: null, busy: true })
    dispatch({ type: 'doc-renamed', id: doc.id, title: next })
    void settleAction(renameDocument(doc.id, next)).then((result) => {
      if (!mounted.current) return
      if (result.ok) {
        const title = result.value.title || next
        dispatch({ type: 'doc-renamed', id: doc.id, title })
        // main does not push a rename made here back: say it once in the live region
        publishLocalRename(title)
        endRename(doc.id)
        return
      }
      // not applied: the row goes back to the name it had
      dispatch({ type: 'doc-renamed', id: doc.id, title: before })
      if (isDocNameError(result.error)) {
        setRenaming({ id: doc.id, error: result.error, busy: false })
      } else {
        outcomeOf(result.error)
        endRename(doc.id)
      }
    })
  }

  const setArchived = (id: string, archived: boolean) => {
    if (rowBusy.current.has(id)) return
    rowBusy.current.add(id)
    const call = archived ? archiveDocument(id) : restoreDocument(id)
    void settleAction(call).then((result) => {
      rowBusy.current.delete(id)
      if (!mounted.current) return
      if (result.ok) dispatch({ type: 'doc-archived', id, archived })
      else outcomeOf(result.error)
      focusRowMenu(id)
    })
  }

  const onRowAction = (doc: LibraryDocRow, action: RowAction) => {
    setToast(null)
    if (action === 'rename') setRenaming({ id: doc.id, error: null, busy: false })
    else if (action === 'archive') setArchiving({ id: doc.id, title: doc.title })
    else setArchived(doc.id, false)
  }

  // signed in again from the dialog: pick up where the failed call left off
  const previousView = useRef(accountView)
  useEffect(() => {
    const was = previousView.current
    previousView.current = accountView
    if (!needsSignIn(was) || (accountView !== 'signed-in' && accountView !== 'refreshing')) return
    const s = stateRef.current
    if (s.openError && lastOpen.current) {
      dispatch({ type: 'clear-open-error' })
      openById(lastOpen.current)
    } else if (pickerBodyOf(s).kind === 'error') {
      retry()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the account state only
  }, [accountView])

  const body = pickerBodyOf(state)
  const docs = visibleDocs(state)
  const hiddenCount = hiddenDocCount(state)
  const activeIndex = docs.findIndex((d) => d.id === state.activeId)
  const optionId = (index: number) => `uw-doc-${index}`
  const showHiddenHint = hiddenCount > 0 && HIDDEN_HINT_BODIES.includes(body.kind)

  useEffect(() => {
    if (activeIndex < 0) return
    const el = listRef.current?.querySelector<HTMLElement>(`#${optionId(activeIndex)}`)
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      // the details panel closes first, then a folder search (back to the open folder), then the dialog
      if (info) closeInfo()
      else if (folderView && draft) {
        setDraft('')
        setFolderQuery('')
      } else onClose()
      return
    }
    if (event.key === 'Tab') {
      const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      if (nodes.length === 0) return
      const first = nodes[0]!
      const last = nodes[nodes.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
      return
    }
    if (event.nativeEvent.isComposing || target.tagName === 'SELECT') return
    // keys inside the details panel, the folder tree and the folder contents are their own
    if (target.closest('.uw-info, .uw-rename, .uw-row-menu, .uwf-side, .uwf-bar, .uwf-contents')) {
      return
    }
    // the folder view's search box only types: its hits are reached with Tab
    if (folderView) return
    const inSearch = target.tagName === 'INPUT'
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      dispatch({ type: 'move-active', to: event.key === 'ArrowDown' ? 'next' : 'prev' })
    } else if ((event.key === 'Home' || event.key === 'End') && !inSearch) {
      event.preventDefault()
      dispatch({ type: 'move-active', to: event.key === 'Home' ? 'first' : 'last' })
    } else if (event.key === 'Enter' && target.tagName !== 'BUTTON') {
      event.preventDefault()
      // text still waiting on the debounce: Enter searches for it first
      if (inSearch && draft.trim() !== stateRef.current.query) {
        dispatch({ type: 'set-query', query: draft.trim() })
      } else if (stateRef.current.activeId) {
        openDoc(stateRef.current.activeId)
      }
    }
  }

  const renderError = (error: UniworkDocErrorCode, action: ReturnType<typeof errorActionOf>) => (
    <div className="uw-pick-state" role="alert">
      <p className="uw-pick-state-title">{t(UNIWORK_ERROR_KEYS[error])}</p>
      {action !== 'none' && (
        <button className="btn btn-secondary" onClick={action === 'sign-in' ? onSignIn : retry}>
          {action === 'sign-in' ? t('acctSignIn') : t('acctRetry')}
        </button>
      )}
    </div>
  )

  const renderLoadMore = () => (
    <>
      {state.list.moreError && (
        <p className="uw-pick-more-error" role="alert">
          {t(UNIWORK_ERROR_KEYS[state.list.moreError])}
        </p>
      )}
      {state.list.nextCursor && (
        <button
          className="btn btn-secondary uw-pick-more"
          onClick={loadMore}
          disabled={state.list.loadingMore}
        >
          {state.list.loadingMore ? t('uwPickLoadingMore') : t('uwPickLoadMore')}
        </button>
      )}
    </>
  )

  const renderBody = () => {
    switch (body.kind) {
      case 'loading':
        return (
          <div className="uw-pick-skeleton" role="status" aria-busy="true">
            <span className="uw-sr-only">{t('uwPickLoading')}</span>
            {[0, 1, 2, 3].map((i) => (
              <div className="uw-pick-skel-row" key={i} aria-hidden="true">
                <span className="uw-skel uw-skel-icon" />
                <span className="uw-skel-lines">
                  <span className="uw-skel uw-skel-line" />
                  <span className="uw-skel uw-skel-line short" />
                </span>
              </div>
            ))}
          </div>
        )
      case 'no-workspaces':
        return (
          <div className="uw-pick-state">
            <p className="uw-pick-state-title">{t('uwPickNoWorkspaces')}</p>
            <p className="uw-pick-state-hint">{t('uwPickNoWorkspacesHint')}</p>
          </div>
        )
      case 'error':
        return renderError(body.error, body.action)
      case 'empty':
        return (
          <div className="uw-pick-state">
            <p className="uw-pick-state-title">{t('uwPickEmpty')}</p>
            {/* rows hidden or pages not loaded yet: the count line / Load more explain it, "add documents" would not be true */}
            {hiddenCount === 0 && !state.list.nextCursor && (
              <p className="uw-pick-state-hint">{t('uwPickEmptyHint')}</p>
            )}
            {/* every loaded row may be one that cannot open: a later page can still hold some */}
            {renderLoadMore()}
          </div>
        )
      case 'shared-empty':
        return (
          <div className="uw-pick-state">
            <p className="uw-pick-state-title">{t('uwLibSharedEmpty')}</p>
            {/* same dead end as the workspace list: the first page may hold only rows that cannot open */}
            {renderLoadMore()}
          </div>
        )
      case 'no-results':
        return (
          <div className="uw-pick-state">
            <p className="uw-pick-state-title">{t('uwPickNoResults', { query: body.query })}</p>
            {/* the shared list is filtered here, so a match may sit on a page not loaded yet */}
            {state.list.nextCursor && (
              <p className="uw-pick-state-hint">{t('uwLibSharedPartial')}</p>
            )}
            {renderLoadMore()}
          </div>
        )
      case 'list':
        return (
          <>
            <div className="uw-pick-heading">
              {state.query
                ? t('uwPickHeadingResults')
                : t(state.source === 'shared' ? 'uwLibShared' : 'uwPickHeadingRecent')}
            </div>
            <ul
              className="uw-pick-list"
              id="uw-pick-list"
              role="listbox"
              aria-label={t('uwPickListLabel')}
              ref={listRef}
            >
              {docs.map((doc, index) => {
                const openable = isOpenable(doc)
                const row = doc as LibraryDocRow
                const editing = renaming?.id === doc.id ? renaming : null
                const active = doc.id === state.activeId
                const archived = row.archived === true
                // an archived row is a supported document that is parked; rows that cannot open are not listed
                const updated = pickerRowMeta(doc, t, dateLocale)
                const meta = archived
                  ? [t('uwDocArchived'), updated].filter(Boolean).join(' · ')
                  : updated
                // shared rows come from several workspaces: name the one each lives in
                const where =
                  state.source === 'shared' ? (doc as SharedDocSummary).workspaceName?.trim() : ''
                return (
                  <li key={doc.id} role="presentation" className="uw-pick-item">
                    <div
                      id={optionId(index)}
                      role="option"
                      aria-selected={active}
                      aria-disabled={archived ? undefined : !openable}
                      className={`uw-pick-row${active ? ' active' : ''}${openable ? '' : ' disabled'}${archived ? ' archived' : ''}${state.opening?.id === doc.id ? ' opening' : ''}`}
                      onMouseMove={() => {
                        if (!active) dispatch({ type: 'set-active', id: doc.id })
                      }}
                      onClick={() => {
                        if (!editing) openDoc(doc.id)
                      }}
                    >
                      <FileBadge ext={docExtension(doc)} size={24} />
                      <span className="uw-pick-row-text">
                        {editing ? (
                          <RenameField
                            initial={renameParts(doc.title, doc.format).base}
                            label={doc.title}
                            error={editing.error}
                            busy={editing.busy}
                            onSave={(value) => saveRename(row, value)}
                            onCancel={() => endRename(doc.id)}
                            onEdit={() => {
                              if (editing.error) setRenaming({ ...editing, error: null })
                            }}
                          />
                        ) : (
                          <span className="uw-pick-row-title">{doc.title}</span>
                        )}
                        {(meta || where) && (
                          <span className="uw-pick-row-meta">
                            {where && <span className="uw-pick-row-where">{where}</span>}
                            {where && meta ? ' · ' : ''}
                            {meta}
                          </span>
                        )}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={`uw-pick-info-btn${info?.id === doc.id ? ' on' : ''}`}
                      data-info-for={doc.id}
                      aria-label={t('uwDocInfoFor', { name: doc.title })}
                      data-tip={t('uwDocInfo')}
                      aria-expanded={info?.id === doc.id}
                      tabIndex={active || info?.id === doc.id ? 0 : -1}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (info?.id === doc.id) closeInfo()
                        else showInfo(doc.id, doc.title)
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                        <circle
                          cx="8"
                          cy="8"
                          r="6.25"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          fill="none"
                        />
                        <path
                          d="M8 7.25v4"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                        <circle cx="8" cy="5" r="0.9" fill="currentColor" />
                      </svg>
                    </button>
                    {hasRowActions(row) && (
                      <RowMenu
                        docId={doc.id}
                        title={doc.title}
                        actions={rowActionsOf(row)}
                        tabbable={active}
                        onAction={(action) => onRowAction(row, action)}
                      />
                    )}
                  </li>
                )
              })}
            </ul>
            {renderLoadMore()}
          </>
        )
    }
  }

  const openErrorAction = state.openError ? errorActionOf(state.openError) : 'none'
  const showBrowser =
    state.workspaces.status === 'ready' && state.workspaces.items.length > 0 && !!state.workspaceId
  const sideView = state.source === 'shared' ? 'shared' : view
  const pickBody = (
    <div className="uw-pick-body" aria-busy={body.kind === 'loading'}>
      {renderBody()}
      {showHiddenHint && (
        <p className="uw-pick-hidden" id={HIDDEN_HINT_ID} role="status">
          {t('uwPickHiddenFormats', { count: hiddenCount })}
        </p>
      )}
    </div>
  )
  const views = (
    <>
      <button
        type="button"
        className="uwf-view"
        aria-pressed={sideView === 'recent'}
        onClick={() => switchView('recent')}
      >
        {t('ufRecent')}
      </button>
      <button
        type="button"
        className="uwf-view"
        aria-pressed={sideView === 'shared'}
        onClick={() => switchView('shared')}
      >
        {t('ufShared')}
      </button>
      <div className="uwf-view-sep" role="separator" />
    </>
  )

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal uw-pick${info ? ' with-info' : ''}${showBrowser ? ' with-browser' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="uw-pick-title"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="uw-pick-head">
          <h3 id="uw-pick-title">{t('uwPickTitle')}</h3>
          {state.workspaces.items.length > 0 && (
            <div className="uw-pick-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setForm('upload')}>
                {t('uwDocUpload')}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setForm('new')}>
                {t('uwDocNew')}
              </button>
            </div>
          )}
          <button className="uw-pick-close" aria-label={t('uwPickClose')} onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M3 3l8 8M11 3l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="uw-pick-tools">
          {state.workspaces.items.length > 0 && (
            <select
              className="uw-pick-ws"
              aria-label={t('uwPickWorkspace')}
              value={state.source === 'shared' ? SHARED_SOURCE_VALUE : (state.workspaceId ?? '')}
              onChange={(e) => {
                // a details read still in flight belongs to the old source: drop its answer
                infoRequest.current++
                setInfo(null)
                if (e.target.value === SHARED_SOURCE_VALUE) dispatch({ type: 'select-shared' })
                else {
                  writeActiveWorkspaceId(e.target.value)
                  dispatch({ type: 'select-workspace', id: e.target.value })
                }
              }}
            >
              <optgroup label={t('uwPickWorkspace')}>
                {state.workspaces.items.map((w) => (
                  <option key={w.id} value={w.id}>
                    {workspaceLabel(w, t)}
                  </option>
                ))}
              </optgroup>
              <option value={SHARED_SOURCE_VALUE}>{t('uwLibShared')}</option>
            </select>
          )}
          <input
            className="uw-pick-search"
            type="search"
            role="combobox"
            aria-label={t('uwPickSearch')}
            aria-expanded={!folderView && body.kind === 'list'}
            aria-controls={!folderView && body.kind === 'list' ? 'uw-pick-list' : undefined}
            aria-activedescendant={
              !folderView && activeIndex >= 0 ? optionId(activeIndex) : undefined
            }
            aria-describedby={
              folderView
                ? folderHiddenHint
                  ? BROWSER_HIDDEN_HINT_ID
                  : undefined
                : showHiddenHint
                  ? HIDDEN_HINT_ID
                  : undefined
            }
            placeholder={folderView ? t('ufSearchPh') : t('uwPickSearchPh')}
            value={draft}
            autoFocus
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
          />
        </div>
        <div className="uw-pick-main">
          {showBrowser ? (
            <UniworkBrowser
              key={state.workspaceId}
              workspaceId={state.workspaceId!}
              variant="dialog"
              query={folderView ? folderQuery : ''}
              onClearQuery={() => {
                setDraft('')
                setFolderQuery('')
              }}
              onOpenDocument={openById}
              openingId={state.opening?.id ?? null}
              onFolderChange={(folderId, path) => {
                browsed.current = { folderId, path }
              }}
              folderSelected={folderView}
              onSelectFolder={() => switchView('folder')}
              onHiddenHintChange={setFolderHiddenHint}
              sidebarTop={views}
              mainOverride={folderView ? undefined : pickBody}
            />
          ) : (
            pickBody
          )}
          {info && (
            <UniworkDocInfoPanel
              key={info.id}
              title={info.title}
              load={info.load}
              onClose={closeInfo}
              onRetry={() => showInfo(info.id, info.title)}
            />
          )}
        </div>
        {state.opening && (
          <div className="uw-pick-progress" role="status">
            <Spinner />
            <span>{t('uwPickOpening', { title: state.opening.title })}</span>
          </div>
        )}
        {state.openError && (
          <div className="uw-pick-open-error" role="alert">
            <span>{t(UNIWORK_ERROR_KEYS[state.openError])}</span>
            {openErrorAction === 'sign-in' && (
              <button className="btn btn-secondary" onClick={onSignIn}>
                {t('acctSignIn')}
              </button>
            )}
            {openErrorAction === 'retry' && lastOpen.current && (
              <button className="btn btn-secondary" onClick={() => openById(lastOpen.current!)}>
                {t('acctRetry')}
              </button>
            )}
          </div>
        )}
        {form === 'new' && (
          <NewDocDialog
            workspaces={state.workspaces.items}
            initialTarget={defaultTarget()}
            loadTree={loadFolderTree}
            onCreate={createDoc}
            onCancel={() => setForm(null)}
          />
        )}
        {form === 'upload' && (
          <UploadDocDialog
            workspaces={state.workspaces.items}
            initialTarget={defaultTarget()}
            loadTree={loadFolderTree}
            pickFile={pickUploadFile}
            onUpload={uploadDoc}
            progress={upload}
            onCancel={cancelUpload}
          />
        )}
        {archiving && (
          <ArchiveConfirm
            name={archiving.title}
            onCancel={() => {
              const id = archiving.id
              setArchiving(null)
              focusRowMenu(id)
            }}
            onConfirm={() => {
              setArchiving(null)
              setArchived(archiving.id, true)
            }}
          />
        )}
        {toast && <ActionToast message={toast} onDone={clearToast} />}
      </div>
    </div>
  )
}
