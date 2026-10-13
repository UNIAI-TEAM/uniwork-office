import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { UniworkDocErrorCode, UniworkDocListPage, UniworkResult } from '../../shared/home-api'
import { FileBadge } from './FileBadge'
import { UniworkDocInfoPanel, type DocInfoLoad } from './UniworkDocInfoPanel'
import { useI18n } from './locale'
import { needsSignIn, type AccountView } from './account-model'
import { publishUniworkNotice } from './uniwork-notice-bus'
import {
  PICKER_PAGE_SIZE,
  PICKER_SEARCH_DEBOUNCE_MS,
  SHARED_SOURCE_VALUE,
  UNIWORK_ERROR_KEYS,
  docExtension,
  errorActionOf,
  initialPickerState,
  isOpenable,
  pickerBodyOf,
  pickerReducer,
  pickerRowMeta,
  retryActionOf,
  visibleDocs,
  workspaceLabel,
  type PickerState,
} from './uniwork-docs-model'
import {
  listSharedDocuments,
  loadDocProperties,
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

/**
 * "Open from UniWork" picker: workspace selector, debounced search, a paged
 * document list. The search box owns focus (combobox pattern): arrow keys move
 * the highlighted row, Enter opens it, Escape closes. Documents UniWork Office
 * cannot open are listed disabled with a reason, never hidden, so paging and
 * the "why isn't my file here" question stay simple.
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
  const [state, dispatch] = useReducer(pickerReducer, undefined, initialPickerState)
  const stateRef = useRef(state)
  stateRef.current = state
  const mounted = useRef(true)
  /** the document the last open attempt was for (Retry / sign-in resumes it) */
  const lastOpenId = useRef<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [draft, setDraft] = useState('')
  const [composing, setComposing] = useState(false)
  const [workspaceTick, setWorkspaceTick] = useState(0)
  /** the document whose details panel is open */
  const [info, setInfo] = useState<{ id: string; title: string; load: DocInfoLoad } | null>(null)
  const infoRequest = useRef(0)

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
    if (composing || next === state.query) return
    const timer = window.setTimeout(
      () => dispatch({ type: 'set-query', query: next }),
      PICKER_SEARCH_DEBOUNCE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [draft, composing, state.query])

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
    if (!doc || !isOpenable(doc) || stateRef.current.opening) return
    lastOpenId.current = doc.id
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

  // signed in again from the dialog: pick up where the failed call left off
  const previousView = useRef(accountView)
  useEffect(() => {
    const was = previousView.current
    previousView.current = accountView
    if (!needsSignIn(was) || (accountView !== 'signed-in' && accountView !== 'refreshing')) return
    const s = stateRef.current
    if (s.openError && lastOpenId.current) {
      dispatch({ type: 'clear-open-error' })
      openDoc(lastOpenId.current)
    } else if (pickerBodyOf(s).kind === 'error') {
      retry()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the account state only
  }, [accountView])

  const body = pickerBodyOf(state)
  const docs = visibleDocs(state)
  const activeIndex = docs.findIndex((d) => d.id === state.activeId)
  const optionId = (index: number) => `uw-doc-${index}`

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
      // the details panel closes first, then the dialog
      if (info) closeInfo()
      else onClose()
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
    // keys inside the details panel are its own
    if (target.closest('.uw-info')) return
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
            <p className="uw-pick-state-hint">{t('uwPickEmptyHint')}</p>
          </div>
        )
      case 'shared-empty':
        return (
          <div className="uw-pick-state">
            <p className="uw-pick-state-title">{t('uwLibSharedEmpty')}</p>
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
                const active = doc.id === state.activeId
                const meta = openable ? pickerRowMeta(doc, t, dateLocale) : t('uwPickUnsupported')
                // shared rows come from several workspaces: name the one each lives in
                const where =
                  state.source === 'shared' ? (doc as SharedDocSummary).workspaceName?.trim() : ''
                return (
                  <li key={doc.id} role="presentation" className="uw-pick-item">
                    <div
                      id={optionId(index)}
                      role="option"
                      aria-selected={active}
                      aria-disabled={!openable}
                      className={`uw-pick-row${active ? ' active' : ''}${openable ? '' : ' disabled'}${state.opening?.id === doc.id ? ' opening' : ''}`}
                      onMouseMove={() => {
                        if (openable && !active) dispatch({ type: 'set-active', id: doc.id })
                      }}
                      onClick={() => openDoc(doc.id)}
                    >
                      <FileBadge ext={docExtension(doc)} size={24} />
                      <span className="uw-pick-row-text">
                        <span className="uw-pick-row-title">{doc.title}</span>
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal uw-pick${info ? ' with-info' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="uw-pick-title"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="uw-pick-head">
          <h3 id="uw-pick-title">{t('uwPickTitle')}</h3>
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
                else dispatch({ type: 'select-workspace', id: e.target.value })
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
            aria-expanded={body.kind === 'list'}
            aria-controls={body.kind === 'list' ? 'uw-pick-list' : undefined}
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            placeholder={t('uwPickSearchPh')}
            value={draft}
            autoFocus
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
          />
        </div>
        <div className="uw-pick-main">
          <div className="uw-pick-body" aria-busy={body.kind === 'loading'}>
            {renderBody()}
          </div>
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
            {openErrorAction === 'retry' && lastOpenId.current && (
              <button className="btn btn-secondary" onClick={() => openDoc(lastOpenId.current!)}>
                {t('acctRetry')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
