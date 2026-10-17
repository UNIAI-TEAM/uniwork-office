import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import type { UniworkDocSummary } from '../../../shared/home-api'
import { useI18n } from '../locale'
import { ActionToast } from '../UniworkDocActions'
import { UNIWORK_ERROR_KEYS } from '../uniwork-docs-model'
import { loadFolderTree } from '../uniwork-library-api'
import { BROWSER_HIDDEN_HINT_ID, BrowserContents } from './BrowserContents'
import { BrowserCrumbs } from './BrowserCrumbs'
import type { FolderMenuItem } from './FolderMenu'
import { FolderNameDialog } from './FolderNameDialog'
import { UniworkFolderPicker } from './UniworkFolderPicker'
import { UniworkFolderTree } from './UniworkFolderTree'
import {
  ROOT_KEY,
  contentsView,
  isFolderEntry,
  readSortMode,
  writeSortMode,
  type PathPart,
  type SortMode,
  type TreeRow,
} from './uniwork-folders-model'
import { useFolderActions } from './use-folder-actions'
import { useFolderBrowser, type SearchKind } from './use-folder-browser'
import './uniwork-folders.css'

const SEARCH_KINDS: {
  kind: SearchKind
  key: 'ufSearchAll' | 'ufSearchFolders' | 'ufSearchDocs'
}[] = [
  { kind: 'all', key: 'ufSearchAll' },
  { kind: 'folder', key: 'ufSearchFolders' },
  { kind: 'document', key: 'ufSearchDocs' },
]

/**
 * FD-11 S1-S3: the UniWork browser - folder tree on the left (workspace root
 * "UniWork" + folders), breadcrumb, sort and New folder above the open
 * folder's contents on the right, title search with kind chips. Host-agnostic:
 * the Open dialog mounts it today (`variant: 'dialog'`), FD-13 mounts it in the
 * home UniWork area (`'pane'`). The host opens files (`onOpenDocument`), may
 * put its own views above the tree (`sidebarTop`, e.g. Recent / Shared) and
 * may show one of them instead of the contents (`mainOverride`). Without a
 * `query` prop the browser has its own search box.
 */
export function UniworkBrowser({
  workspaceId,
  variant,
  onOpenDocument,
  openingId,
  initialFolderId = null,
  onFolderChange,
  sidebarTop,
  sidebarHost,
  mainOverride,
  query: hostQuery,
  onClearQuery,
  folderSelected = true,
  onSelectFolder,
  onHiddenHintChange,
}: {
  workspaceId: string
  variant: 'dialog' | 'pane'
  onOpenDocument: (doc: UniworkDocSummary) => void
  /** the file being opened (its row shows busy) */
  openingId?: string | null
  initialFolderId?: string | null
  /** the open folder changed (the host's New / Upload default to it) */
  onFolderChange?: (folderId: string | null, path: PathPart[]) => void
  sidebarTop?: ReactNode
  /** optional external container to portal the `.uwf-side` column into (FD-13 single-sidebar frame) */
  sidebarHost?: HTMLElement | null
  /** host content shown instead of the folder contents (its Recent / Shared views) */
  mainOverride?: ReactNode
  /** the host's committed search text; undefined = the browser's own search box */
  query?: string
  onClearQuery?: () => void
  /** false while the host shows another view: no tree row reads as selected */
  folderSelected?: boolean
  /** a tree row or breadcrumb was chosen (the host leaves its other view) */
  onSelectFolder?: () => void
  /** whether the hidden-formats status line is shown in the folder/search view (R2-3) */
  onHiddenHintChange?: (shown: boolean) => void
}) {
  const { t, dateLocale } = useI18n()
  const uid = useId()
  const browser = useFolderBrowser(workspaceId, initialFolderId)
  const [sort, setSort] = useState<SortMode>(() => readSortMode())
  const [ownDraft, setOwnDraft] = useState('')
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)
  const clearToast = useCallback(() => setToast(null), [])
  const actions = useFolderActions({
    workspaceId,
    onChanged: browser.refresh,
    onCreated: browser.expandParent,
    notify: (message, tone) => setToast({ message, tone }),
  })
  const query = (hostQuery ?? ownDraft).trim()
  const { runSearch } = browser

  // the committed search text (host debounced; the own box on each change) drives the title search
  useEffect(() => {
    runSearch(query, browser.search.kind)
    // the kind is changed through the chips, which search themselves
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, runSearch])

  const onFolderChangeRef = useRef(onFolderChange)
  onFolderChangeRef.current = onFolderChange
  const pathKey = browser.path.map((p) => p.id).join('/')
  useEffect(() => {
    onFolderChangeRef.current?.(browser.folderId, browser.path)
    // keyed on the path ids: the same folder re-read is not a change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browser.folderId, pathKey])

  const openFolder = (id: string | null) => {
    onSelectFolder?.()
    if (query) {
      setOwnDraft('')
      onClearQuery?.()
    }
    browser.openFolder(id)
  }

  const treeMenu = (row: TreeRow): FolderMenuItem[] => {
    const items: FolderMenuItem[] = [
      {
        id: 'new',
        label: row.id ? t('ufNewSubfolder') : t('ufNewFolder'),
        onSelect: () => actions.openCreate(row.id, row.id !== null),
      },
    ]
    if (!row.id) return items
    const id = row.id
    const parentId = browser.index.get(id)?.parentId ?? null
    items.push(
      { id: 'rename', label: t('ufRename'), onSelect: () => actions.startTreeRename(id) },
      {
        id: 'move',
        label: t('ufMoveTo'),
        onSelect: () => actions.startMove({ id, kind: 'folder', parentId, title: row.title }),
      },
    )
    return items
  }

  const rowMenu = (doc: UniworkDocSummary): FolderMenuItem[] => {
    // a row the server says I cannot edit gets no actions; no flag = offer them (403 is a toast)
    if (doc.canEdit === false) return []
    const parentId = doc.parentId ?? browser.folderId
    const move: FolderMenuItem = {
      id: 'move',
      label: t('ufMoveTo'),
      onSelect: () =>
        actions.startMove({ id: doc.id, kind: doc.kind ?? 'file', parentId, title: doc.title }),
    }
    if (!isFolderEntry(doc)) return [move]
    return [
      { id: 'new', label: t('ufNewSubfolder'), onSelect: () => actions.openCreate(doc.id, true) },
      { id: 'rename', label: t('ufRename'), onSelect: () => actions.openRename(doc) },
      move,
    ]
  }

  const searching = query.length > 0
  const list = searching ? browser.results : browser.contents
  const view = contentsView(list.items, searching ? null : sort, dateLocale)
  const showHiddenHint = !mainOverride && list.status === 'ready' && view.hiddenCount > 0
  const hiddenHintId = onHiddenHintChange ? BROWSER_HIDDEN_HINT_ID : `${uid}-hidden`

  const onHiddenHintChangeRef = useRef(onHiddenHintChange)
  onHiddenHintChangeRef.current = onHiddenHintChange
  useEffect(() => {
    onHiddenHintChangeRef.current?.(showHiddenHint)
  }, [showHiddenHint])

  const renderTree = () => {
    const { tree } = browser
    if (tree.status === 'loading') {
      return (
        <p className="uwf-side-state" role="status">
          {t('uwPickLoading')}
        </p>
      )
    }
    if (tree.status === 'error') {
      return (
        <div className="uwf-side-state" role="alert">
          <p>{t('ufTreeError')}</p>
          <p className="uwf-side-hint">{t(UNIWORK_ERROR_KEYS[tree.error ?? 'server_error'])}</p>
          <button type="button" className="btn btn-secondary" onClick={browser.refresh}>
            {t('acctRetry')}
          </button>
        </div>
      )
    }
    return (
      <UniworkFolderTree
        idPrefix={`${uid}-tree`}
        nodes={tree.nodes}
        label={t('ufTreeLabel')}
        expanded={browser.expanded}
        onExpandedChange={browser.setExpanded}
        selectedKey={folderSelected ? (browser.folderId ?? ROOT_KEY) : '\u0000none'}
        onOpen={openFolder}
        menuFor={treeMenu}
        rename={actions.treeRename}
        onRenameSave={(id, value) =>
          actions.saveTreeRename(id, value, browser.index.get(id)?.title ?? '')
        }
        onRenameCancel={actions.cancelTreeRename}
        onRenameEdit={actions.clearTreeRenameError}
      />
    )
  }

  const chipsRef = useRef<HTMLDivElement>(null)
  const onChipKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (index + 1) % SEARCH_KINDS.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (index - 1 + SEARCH_KINDS.length) % SEARCH_KINDS.length
    } else if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = SEARCH_KINDS.length - 1
    }
    if (next === null) return
    event.preventDefault()
    event.stopPropagation()
    const target = SEARCH_KINDS[next]!
    runSearch(query, target.kind)
    chipsRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
  }

  const renderMain = () => (
    <>
      <div className="uwf-bar">
        {searching ? (
          <div
            className="uwf-chips"
            role="radiogroup"
            aria-label={t('ufSearchKind')}
            ref={chipsRef}
          >
            {SEARCH_KINDS.map(({ kind, key }, index) => {
              const checked = browser.search.kind === kind
              return (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={checked ? 0 : -1}
                  className={`uwf-chip${checked ? ' on' : ''}`}
                  onClick={() => runSearch(query, kind)}
                  onKeyDown={(e) => onChipKeyDown(e, index)}
                >
                  {t(key)}
                </button>
              )
            })}
          </div>
        ) : (
          <BrowserCrumbs path={browser.path} onOpen={openFolder} />
        )}
        {!searching && (
          <div className="uwf-bar-tools">
            <select
              className="uwf-sort"
              aria-label={t('ufSortBy')}
              value={sort}
              onChange={(e) => {
                const next = e.target.value === 'updated' ? 'updated' : 'name'
                setSort(next)
                writeSortMode(next)
              }}
            >
              <option value="name">{t('ufSortName')}</option>
              <option value="updated">{t('ufSortUpdated')}</option>
            </select>
            <button
              type="button"
              className="btn btn-secondary uwf-new-folder"
              onClick={() => actions.openCreate(browser.folderId)}
            >
              {t('ufNewFolder')}
            </button>
          </div>
        )}
      </div>
      {browser.gone && (
        <p className="uwf-notice" role="status">
          {t('ufFolderGone')}
        </p>
      )}
      <div className="uwf-list">
        <BrowserContents
          key={searching ? 'search' : (browser.folderId ?? 'root')}
          list={list}
          rows={view.rows}
          hiddenCount={view.hiddenCount}
          hiddenHintId={hiddenHintId}
          emptyText={searching ? t('ufNoResults', { query }) : t('ufEmptyFolder')}
          search={searching}
          openingId={openingId}
          menuFor={rowMenu}
          onOpenFolder={(doc) => openFolder(doc.id)}
          onOpenFile={onOpenDocument}
          onLoadMore={searching ? browser.loadMoreResults : browser.loadMore}
          onRetry={() => (searching ? runSearch(query, browser.search.kind) : browser.refresh())}
        />
      </div>
    </>
  )

  const nameDialog = actions.nameDialog
  const sideNode = (
    <div className="uwf-side">
      {sidebarTop}
      {hostQuery === undefined && (
        <input
          className="uw-pick-search uwf-own-search"
          type="search"
          aria-label={t('uwPickSearch')}
          aria-describedby={showHiddenHint ? hiddenHintId : undefined}
          placeholder={t('ufSearchPh')}
          value={ownDraft}
          spellCheck={false}
          onChange={(e) => setOwnDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && ownDraft) {
              e.preventDefault()
              e.stopPropagation()
              setOwnDraft('')
            }
          }}
        />
      )}
      {renderTree()}
    </div>
  )
  return (
    <div
      className={`uwf-browser uwf-${variant}${sidebarHost !== undefined ? ' has-sidebar-host' : ''}${mainOverride ? ' has-main-override' : ''}`}
    >
      {sidebarHost !== undefined
        ? sidebarHost
          ? createPortal(sideNode, sidebarHost)
          : null
        : sideNode}
      <div className="uwf-main">{mainOverride ?? renderMain()}</div>
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
          onSubmit={actions.submitName}
          onCancel={actions.closeNameDialog}
        />
      )}
      {actions.moving && (
        <UniworkFolderPicker
          title={t('ufMoveTitle', { name: actions.moving.title })}
          confirmLabel={t('ufMove')}
          workspaceId={workspaceId}
          loadTree={loadFolderTree}
          nodes={browser.tree.status === 'ready' ? browser.tree.nodes : undefined}
          moving={actions.moving}
          initialFolderId={actions.moving.parentId}
          onPick={(picked) => void actions.move(actions.moving!, picked)}
          onCancel={actions.cancelMove}
        />
      )}
      {toast && <ActionToast message={toast.message} tone={toast.tone} onDone={clearToast} />}
    </div>
  )
}
