import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { UniworkDocSummary } from '../../../shared/home-api'
import { DocPickerList } from '../doclist/PickerList'
import { useI18n } from '../locale'
import { UNIWORK_ERROR_KEYS, errorActionOf } from '../uniwork-docs-model'
import { FolderMenu, type FolderMenuItem } from './FolderMenu'
import {
  MY_FOLDER_LABEL_KEY,
  entryTitleOf,
  isFolderEntry,
  labelMyFolderPath,
  shortPath,
} from './uniwork-folders-model'
import type { ListState } from './use-folder-browser'

/** id of the muted hidden-formats count line referenced by aria-describedby (R2-3) */
export const BROWSER_HIDDEN_HINT_ID = 'uwf-hidden'

/**
 * FD-11 S1/S2 right-hand list of the browser: the open folder's contents or
 * the title search's hits (listbox, one tab stop). Arrows / Home / End move,
 * Enter or a double click opens a folder (browse into it) or a file (the
 * existing open path); a single click selects. Search hits show their path
 * left-truncated, the full path in `title` and for screen readers. Pages and
 * files the app cannot open are left out by the caller and counted here.
 */
export function BrowserContents({
  list,
  rows,
  hiddenCount,
  hiddenHintId,
  emptyText,
  search,
  myFolderId = null,
  openingId,
  menuFor,
  onOpenFolder,
  onOpenFile,
  onLoadMore,
  onRetry,
}: {
  list: ListState
  rows: UniworkDocSummary[]
  hiddenCount: number
  hiddenHintId?: string
  emptyText: string
  /** search hits: show each row's path */
  search: boolean
  /** MYFOLDER-01: names My Folder by its label inside a search hit's path */
  myFolderId?: string | null
  openingId?: string | null
  menuFor: (doc: UniworkDocSummary) => FolderMenuItem[]
  onOpenFolder: (doc: UniworkDocSummary) => void
  onOpenFile: (doc: UniworkDocSummary) => void
  onLoadMore: () => void
  onRetry: () => void
}) {
  const { t } = useI18n()
  const ownHiddenId = useId()
  const resolvedHiddenId = hiddenHintId ?? ownHiddenId
  const [activeId, setActiveId] = useState<string | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const moveFocus = useRef(false)
  const active = rows.some((r) => r.id === activeId) ? activeId : (rows[0]?.id ?? null)

  useEffect(() => {
    if (!moveFocus.current) return
    moveFocus.current = false
    Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
      .find((el) => el.dataset.id === active)
      ?.focus()
  }, [active])

  const open = (doc: UniworkDocSummary) => {
    if (isFolderEntry(doc)) onOpenFolder(doc)
    else onOpenFile(doc)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>, doc: UniworkDocSummary) => {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing) return
    const at = rows.findIndex((r) => r.id === doc.id)
    let next: number | null = null
    if (event.key === 'ArrowDown') next = Math.min(at + 1, rows.length - 1)
    else if (event.key === 'ArrowUp') next = Math.max(at - 1, 0)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = rows.length - 1
    else if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      open(doc)
      return
    } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault()
      event.stopPropagation()
      if (menuFor(doc).length > 0) setMenuId(doc.id)
      return
    }
    if (next === null) return
    event.preventDefault()
    event.stopPropagation()
    moveFocus.current = true
    setActiveId(rows[next]!.id)
  }

  if (list.status === 'loading' || list.status === 'idle') {
    return (
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
    )
  }
  if (list.status === 'error') {
    const error = list.error ?? 'server_error'
    return (
      <div className="uw-pick-state" role="alert">
        <p className="uw-pick-state-title">{t(UNIWORK_ERROR_KEYS[error])}</p>
        {errorActionOf(error) === 'retry' && (
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            {t('acctRetry')}
          </button>
        )}
      </div>
    )
  }

  // a search hit's path, left-truncated: the one second line this list has
  const pathOf = (doc: UniworkDocSummary) =>
    search && doc.path
      ? shortPath(labelMyFolderPath(doc.path, myFolderId, t(MY_FOLDER_LABEL_KEY)), t('ufRoot'))
      : null

  const hiddenLine =
    hiddenCount > 0 ? (
      <p className="uwf-hidden" id={resolvedHiddenId} role="status">
        {t('uwPickHiddenFormats', { count: hiddenCount })}
      </p>
    ) : null

  const loadMoreBlock = (
    <>
      {list.moreError && (
        <p className="uw-pick-more-error" role="alert">
          {t(UNIWORK_ERROR_KEYS[list.moreError])}
        </p>
      )}
      {list.nextCursor && (
        <button
          type="button"
          className="btn btn-secondary uw-pick-more"
          onClick={onLoadMore}
          disabled={list.loadingMore}
        >
          {list.loadingMore ? t('uwPickLoadingMore') : t('uwPickLoadMore')}
        </button>
      )}
    </>
  )

  if (rows.length === 0) {
    return (
      <div className="uw-pick-state">
        <p className="uw-pick-state-title">{emptyText}</p>
        {hiddenLine}
        {loadMoreBlock}
      </div>
    )
  }

  return (
    <>
      <DocPickerList
        className="uwf-contents"
        label={t('ufContentsLabel')}
        describedBy={hiddenCount > 0 ? resolvedHiddenId : undefined}
        listRef={listRef}
        // only the "…" sits beside a row here, at the row's end
        reserve={44}
        docs={rows}
        activeId={active}
        stateOf={(doc) => ({ opening: openingId === doc.id })}
        titleOf={(doc) => entryTitleOf(doc, t(MY_FOLDER_LABEL_KEY))}
        sublineFor={(doc) => {
          const path = pathOf(doc)
          return path ? { ...path, path: true } : null
        }}
        optionProps={(doc) => {
          const items = menuFor(doc)
          return {
            'data-id': doc.id,
            tabIndex: doc.id === active ? 0 : -1,
            className: 'uwf-row',
            title: pathOf(doc)?.full,
            onClick: () => setActiveId(doc.id),
            onDoubleClick: () => open(doc),
            onKeyDown: (e) => onKeyDown(e, doc),
            onFocus: (e) => {
              if (e.target === e.currentTarget) setActiveId(doc.id)
            },
            onContextMenu: (e) => {
              if (items.length === 0) return
              e.preventDefault()
              setActiveId(doc.id)
              setMenuId(doc.id)
            },
          }
        }}
        trailing={(doc) => {
          const items = menuFor(doc)
          if (items.length === 0) return null
          const title = entryTitleOf(doc, t(MY_FOLDER_LABEL_KEY))
          return (
            <FolderMenu
              label={t('ufActionsFor', { name: title })}
              items={items}
              dataFor={doc.id}
              open={menuId === doc.id}
              onOpenChange={(o) => setMenuId(o ? doc.id : null)}
            />
          )
        }}
      />
      {hiddenLine}
      {loadMoreBlock}
    </>
  )
}
