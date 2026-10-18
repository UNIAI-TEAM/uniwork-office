import { useEffect, useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  UniworkDocErrorCode,
  UniworkFolderNode,
  UniworkResult,
} from '../../../shared/home-api'
import { useI18n } from '../locale'
import { ActionModal } from '../UniworkDocActions'
import { UNIWORK_ERROR_KEYS } from '../uniwork-docs-model'
import { onTreeChanged } from '../uniwork-library-api'
import { UniworkFolderTree } from './UniworkFolderTree'
import {
  MY_FOLDER_LABEL_KEY,
  ROOT_KEY,
  buildFolderIndex,
  expandKeysFor,
  expandParentAndAncestorsFor,
  filterFolderTree,
  folderPath,
  moveBlockOf,
  withMyFolderLabel,
  type MovingItem,
  type PathPart,
  type TreeRow,
} from './uniwork-folders-model'

/** the folder the person chose: null = the workspace root, with its root-first path */
export interface PickedFolder {
  folderId: string | null
  path: PathPart[]
}

type TreeLoad =
  | { status: 'loading' }
  | { status: 'ready'; nodes: UniworkFolderNode[] }
  | { status: 'error'; error: UniworkDocErrorCode }

/**
 * FD-11: modal tree picker behind "Location" (New, Upload, Save a copy) and
 * "Move to…". Every folder is listed; one that cannot take the item (its
 * current place, its own subtree, deeper than the server allows) stays
 * visible but aria-disabled with the reason on the row, and the confirm
 * button is inert while such a row is chosen.
 *
 * SAVE-01 State 2 ("Chọn nơi lưu") is this picker with its optional parts:
 * a back button instead of Cancel, a header action ("Thư mục mới"), a folder
 * search, a tag and a check per row, a note under the tree and a confirm that
 * names the chosen folder. `rootBlocked` (default false) keeps the root out
 * for hosts that place into folders only.
 */
export function UniworkFolderPicker({
  title,
  confirmLabel,
  workspaceId,
  loadTree,
  nodes: givenNodes,
  moving = null,
  initialFolderId,
  onPick,
  onCancel,
  rootBlocked = false,
  onBack,
  backLabel,
  headerAction,
  searchLabel,
  note,
  confirmLabelFor,
  tagOf,
  checkLabel,
  className,
  revealChildrenOf,
}: {
  title: string
  confirmLabel: string
  workspaceId: string
  /** reads the tree when the host has none in hand */
  loadTree: (workspaceId: string) => Promise<UniworkResult<UniworkFolderNode[]>>
  nodes?: UniworkFolderNode[]
  /** the item being moved; null = a new document being placed */
  moving?: MovingItem | null
  initialFolderId: string | null
  onPick: (picked: PickedFolder) => void
  onCancel: () => void
  /** the root cannot be chosen (its row is disabled with a reason) */
  rootBlocked?: boolean
  /** a back button in the header replaces Cancel */
  onBack?: () => void
  backLabel?: string
  /** a header control, told the chosen folder (null = the root) */
  headerAction?: (chosenId: string | null) => ReactNode
  /** shows a folder search box with this placeholder / name */
  searchLabel?: string
  /** a line under the tree */
  note?: string
  /** the confirm's label from the chosen folder's title (else `confirmLabel`) */
  confirmLabelFor?: (title: string) => string
  tagOf?: (row: TreeRow) => string | null
  checkLabel?: string
  className?: string
  /** a folder just created inside this one (null = the root): its row is expanded */
  revealChildrenOf?: string | null
}) {
  const { t } = useI18n()
  const id = useId()
  const [load, setLoad] = useState<TreeLoad>(
    givenNodes ? { status: 'ready', nodes: givenNodes } : { status: 'loading' },
  )
  const [tick, setTick] = useState(0)
  const [chosen, setChosen] = useState<string | null>(initialFolderId)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([ROOT_KEY]))
  const [query, setQuery] = useState('')
  const myFolderLabel = t(MY_FOLDER_LABEL_KEY)

  useEffect(() => {
    if (givenNodes) return
    return onTreeChanged((event) => {
      if (event.workspaceId === workspaceId) setTick((n) => n + 1)
    })
  }, [workspaceId, givenNodes])

  useEffect(() => {
    if (givenNodes) return
    let live = true
    setLoad((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }))
    void loadTree(workspaceId)
      .catch((): UniworkResult<UniworkFolderNode[]> => ({ ok: false, error: 'network' }))
      .then((result) => {
        if (!live) return
        if (result.ok) {
          setLoad({ status: 'ready', nodes: result.value })
        } else {
          setLoad((prev) =>
            prev.status === 'ready' ? prev : { status: 'error', error: result.error },
          )
        }
      })
    return () => {
      live = false
    }
    // the tree is read per workspace, on Retry, and on tree-changed when no host nodes are passed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, tick, Boolean(givenNodes)])

  const rawNodes = givenNodes ?? (load.status === 'ready' ? load.nodes : null)
  // My Folder carries its label into the index, so the path and the pick name it too
  const nodes = useMemo(
    () => (rawNodes ? withMyFolderLabel(rawNodes, myFolderLabel) : null),
    [rawNodes, myFolderLabel],
  )
  const index = useMemo(() => buildFolderIndex(nodes ?? []), [nodes])
  const filtered = useMemo(() => filterFolderTree(nodes ?? [], query), [nodes, query])

  // the starting folder is visible once the tree is in
  useEffect(() => {
    if (!nodes) return
    setExpanded((prev) => new Set([...prev, ...expandKeysFor(index, initialFolderId)]))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per loaded tree
  }, [index])

  // the host created a folder: its parent opens so the new row shows once the tree is re-read
  useEffect(() => {
    if (revealChildrenOf === undefined || !nodes) return
    setExpanded(
      (prev) => new Set([...prev, ...expandParentAndAncestorsFor(index, revealChildrenOf)]),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- per reveal and per re-read tree
  }, [revealChildrenOf, index])

  const blockOf = (folderId: string | null) =>
    rootBlocked && folderId === null ? 'root' : moveBlockOf(index, moving, folderId)
  // a chosen folder that vanished from the tree falls back to the root
  const chosenId = chosen !== null && !index.has(chosen) && nodes ? null : chosen
  const blocked = nodes ? blockOf(chosenId) !== null : true
  const path = folderPath(index, chosenId)
  const chosenTitle = path[path.length - 1]?.title ?? t('ufRoot')
  const shownExpanded = query.trim() ? new Set([...expanded, ...filtered.expand]) : expanded

  const heading = (
    <h3 id={`${id}-title`} className="uw-act-heading">
      {title}
    </h3>
  )
  return (
    <ActionModal
      labelledBy={`${id}-title`}
      className={`uwf-picker${className ? ` ${className}` : ''}`}
      onCancel={onCancel}
    >
      {onBack || headerAction ? (
        <div className="uwf-picker-head">
          {onBack && (
            <button
              type="button"
              className="uwf-picker-back"
              aria-label={backLabel}
              onClick={onBack}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M10 3.5 5.5 8l4.5 4.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          {heading}
          {headerAction?.(chosenId)}
        </div>
      ) : (
        heading
      )}
      {searchLabel && nodes && (
        <div className="uwf-picker-search-wrap">
          <svg
            className="uwf-picker-search-icon"
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
            className="uw-pick-search uwf-picker-search"
            type="search"
            aria-label={searchLabel}
            placeholder={searchLabel}
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.preventDefault()
                e.stopPropagation()
                setQuery('')
              }
            }}
          />
        </div>
      )}
      <div className="uwf-picker-body">
        {load.status === 'loading' && (
          <p className="uwf-picker-state" role="status">
            {t('uwPickLoading')}
          </p>
        )}
        {load.status === 'error' && (
          <div className="uwf-picker-state" role="alert">
            <p>{t(UNIWORK_ERROR_KEYS[load.error])}</p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setTick((n) => n + 1)}
            >
              {t('acctRetry')}
            </button>
          </div>
        )}
        {nodes && (
          <UniworkFolderTree
            idPrefix={`${id}-tree`}
            nodes={filtered.nodes}
            label={t('ufTreeLabel')}
            expanded={shownExpanded}
            onExpandedChange={setExpanded}
            selectedKey={chosenId ?? ROOT_KEY}
            onOpen={setChosen}
            blockOf={blockOf}
            tagOf={tagOf}
            checkLabel={checkLabel}
          />
        )}
      </div>
      {note && <p className="uwf-picker-note">{note}</p>}
      {nodes && (
        <p className="uwf-picker-path" aria-live="polite">
          {t('ufPathLabel', {
            path: [t('ufRoot'), ...path.map((p) => p.title)].join(' › '),
          })}
        </p>
      )}
      <div className="modal-buttons">
        {!onBack && (
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {t('cancel')}
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary uwf-picker-confirm"
          aria-disabled={blocked || undefined}
          onClick={() => {
            if (!blocked) onPick({ folderId: chosenId, path })
          }}
        >
          {confirmLabelFor ? confirmLabelFor(chosenTitle) : confirmLabel}
        </button>
      </div>
    </ActionModal>
  )
}
