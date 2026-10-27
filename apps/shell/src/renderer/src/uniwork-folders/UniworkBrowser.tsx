import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import type { UniworkDocSummary } from '../../../shared/home-api'
import { useI18n } from '../locale'
import { ActionToast } from '../UniworkDocActions'
import { FolderContentsAccessBar } from '../uniwork-share/FolderContentsAccessBar'
import {
  FolderContentsAccessDialog,
  type FolderContentsTarget,
} from '../uniwork-share/FolderContentsAccessDialog'
import { shareBridgeAvailable } from '../uniwork-share/share-dialog-target'
import { UNIWORK_ERROR_KEYS } from '../uniwork-docs-model'
import { loadFolderTree } from '../uniwork-library-api'
import { BROWSER_HIDDEN_HINT_ID, BrowserContents } from './BrowserContents'
import { BrowserCrumbs } from './BrowserCrumbs'
import type { FolderMenuItem } from './FolderMenu'
import { FolderNameDialog } from './FolderNameDialog'
import { UniworkFolderPicker } from './UniworkFolderPicker'
import { UniworkFolderTree } from './UniworkFolderTree'
import {
  MY_FOLDER_LABEL_KEY,
  ROOT_KEY,
  contentsView,
  folderEditActionsOffered,
  isFolderEntry,
  isMyFolder,
  labelMyFolderPath,
  myFolderIdOf,
  readSortMode,
  treeRowAccess,
  writeSortMode,
  type PathPart,
  type SortMode,
  type TreeRow,
} from './uniwork-folders-model'
import { useFolderActions } from './use-folder-actions'
import { useFolderLevels } from './use-folder-levels'
import { canCreateInsideFolder } from './ws-folder'
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
  offlineOf,
  onOffline,
  hidePages = false,
  myRole,
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
  /** G5-05u F5: optional offline item for a file row's "…" menu */
  offlineOf?: (doc: UniworkDocSummary) => 'pin' | 'unpin' | null
  onOffline?: (doc: UniworkDocSummary) => void
  /** UNI-1953: a picker cannot take a UniNote page, so its rows are left out (not counted as hidden) */
  hidePages?: boolean
  /** UNI-2066: my role in this workspace (owner|admin|member|...); a human member creates inside a workspace folder at view level */
  myRole?: string | null
}) {
  const { t, dateLocale } = useI18n()
  const uid = useId()
  const browser = useFolderBrowser(workspaceId, initialFolderId)
  const [sort, setSort] = useState<SortMode>(() => readSortMode())
  const [ownDraft, setOwnDraft] = useState('')
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)
  const clearToast = useCallback(() => setToast(null), [])
  // UNI-2244: the folder whose documents "Share documents inside…" writes to (no entry without the bridge)
  const [folderContents, setFolderContents] = useState<FolderContentsTarget | null>(null)
  const folderContentsItems = (id: string, title: string): FolderMenuItem[] =>
    shareBridgeAvailable()
      ? [
          {
            id: 'share-contents',
            label: t('shrFcMenu'),
            onSelect: () => setFolderContents({ id, workspaceId, title }),
          },
        ]
      : []
  const actions = useFolderActions({
    workspaceId,
    onChanged: browser.refresh,
    onCreated: browser.expandParent,
    notify: (message, tone) => setToast({ message, tone }),
    index: browser.index,
  })
  const query = (hostQuery ?? ownDraft).trim()
  const { runSearch } = browser
  // My Folder is named by its label wherever a path shows (crumbs, the host's Location)
  const myFolderLabel = t(MY_FOLDER_LABEL_KEY)
  const myFolderId = useMemo(() => myFolderIdOf(browser.tree.nodes), [browser.tree.nodes])
  const shownPath = labelMyFolderPath(browser.path, myFolderId, myFolderLabel)

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
    onFolderChangeRef.current?.(browser.folderId, shownPath)
    // keyed on the path ids: the same folder re-read is not a change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browser.folderId, pathKey, myFolderId, myFolderLabel])

  const openFolder = (id: string | null) => {
    onSelectFolder?.()
    if (query) {
      setOwnDraft('')
      onClearQuery?.()
    }
    browser.openFolder(id)
  }

  // UNI-2080: a tree node has no level; the folder's menu reads it when it opens (as the web does)
  const folderLevels = useFolderLevels(workspaceId)
  const treeMenu = (row: TreeRow): FolderMenuItem[] => {
    const id = row.id
    if (id === null) {
      return [
        { id: 'new', label: t('ufNewFolder'), onSelect: () => actions.openCreate(null, false) },
      ]
    }
    const access = treeRowAccess(row, folderLevels.levelOf(id), browser.index, myRole)
    // Mở leads the menu: a viewer's folder still has this read action
    const items: FolderMenuItem[] = [
      { id: 'open', label: t('dlActOpen'), onSelect: () => openFolder(id) },
    ]
    items.push(...folderContentsItems(id, row.title))
    if (access.create) {
      items.push({
        id: 'new',
        label: t('ufNewSubfolder'),
        onSelect: () => actions.openCreate(id, true),
      })
    }
    if (!access.edit) return items
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
    const canEdit = doc.canEdit !== false
    const parentId = doc.parentId ?? browser.folderId
    const move: FolderMenuItem = {
      id: 'move',
      label: t('ufMoveTo'),
      onSelect: () =>
        actions.startMove({ id: doc.id, kind: doc.kind ?? 'file', parentId, title: doc.title }),
    }
    if (!isFolderEntry(doc)) {
      const items: FolderMenuItem[] = canEdit ? [move] : []
      const offline = offlineOf?.(doc) ?? null
      if (offline && onOffline) {
        items.push({
          id: 'offline',
          label: t(offline === 'pin' ? 'uwOfflinePin' : 'uwOfflineUnpin'),
          onSelect: () => onOffline(doc),
        })
      }
      return items
    }
    // UNI-2066: new content follows its own rule (a workspace folder takes every human member at
    // view level); rename and move still follow the level
    const newItem: FolderMenuItem = {
      id: 'new',
      label: t('ufNewSubfolder'),
      onSelect: () => actions.openCreate(doc.id, true, { parentRow: doc }),
    }
    const shareContents = folderContentsItems(doc.id, doc.title)
    if (!canEdit) {
      return canCreateInsideFolder({ ...doc, canEdit }, browser.index, myRole)
        ? [...shareContents, newItem]
        : shareContents
    }
    if (!folderEditActionsOffered(doc)) return [...shareContents, newItem]
    return [
      ...shareContents,
      newItem,
      { id: 'rename', label: t('ufRename'), onSelect: () => actions.openRename(doc) },
      move,
    ]
  }

  const searching = query.length > 0
  const list = searching ? browser.results : browser.contents
  const view = contentsView(
    hidePages ? list.items.filter((doc) => doc.kind !== 'page') : list.items,
    searching ? null : sort,
    dateLocale,
  )
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
        onMenuIntent={(row, focus) => {
          // My Folder is the caller's own: its menu needs no level; a bare focus asks only while the level is unknown
          if (!row.id || isMyFolder(row)) return
          if (focus && folderLevels.levelOf(row.id) !== undefined) return
          folderLevels.load(row.id)
        }}
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
          <BrowserCrumbs path={shownPath} onOpen={openFolder} />
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
          myFolderId={myFolderId}
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
          workspaceNote={actions.workspaceNote}
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
      {folderContents && (
        <FolderContentsAccessDialog
          open
          folder={folderContents}
          onClose={() => setFolderContents(null)}
          onChanged={browser.refresh}
          onNotice={(message, tone) => setToast({ message, tone })}
        />
      )}
      <FolderContentsAccessBar
        onSettled={(message, tone) => {
          setToast({ message, tone })
          browser.refresh()
        }}
      />
      {toast && <ActionToast message={toast.message} tone={toast.tone} onDone={clearToast} />}
    </div>
  )
}
