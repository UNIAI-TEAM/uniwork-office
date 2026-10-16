import { useEffect, useId, useMemo, useState } from 'react'
import type {
  UniworkDocErrorCode,
  UniworkFolderNode,
  UniworkResult,
} from '../../../shared/home-api'
import { useI18n } from '../locale'
import { ActionModal } from '../UniworkDocActions'
import { UNIWORK_ERROR_KEYS } from '../uniwork-docs-model'
import { UniworkFolderTree } from './UniworkFolderTree'
import {
  ROOT_KEY,
  buildFolderIndex,
  expandKeysFor,
  folderPath,
  moveBlockOf,
  type MovingItem,
  type PathPart,
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
}) {
  const { t } = useI18n()
  const id = useId()
  const [load, setLoad] = useState<TreeLoad>(
    givenNodes ? { status: 'ready', nodes: givenNodes } : { status: 'loading' },
  )
  const [tick, setTick] = useState(0)
  const [chosen, setChosen] = useState<string | null>(initialFolderId)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([ROOT_KEY]))

  useEffect(() => {
    if (givenNodes) return
    let live = true
    setLoad({ status: 'loading' })
    void loadTree(workspaceId)
      .catch((): UniworkResult<UniworkFolderNode[]> => ({ ok: false, error: 'network' }))
      .then((result) => {
        if (!live) return
        setLoad(
          result.ok
            ? { status: 'ready', nodes: result.value }
            : { status: 'error', error: result.error },
        )
      })
    return () => {
      live = false
    }
    // the tree is read once per workspace (and on Retry)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, tick])

  const nodes = load.status === 'ready' ? load.nodes : null
  const index = useMemo(() => buildFolderIndex(nodes ?? []), [nodes])

  // the starting folder is visible once the tree is in
  useEffect(() => {
    if (!nodes) return
    setExpanded((prev) => new Set([...prev, ...expandKeysFor(index, initialFolderId)]))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per loaded tree
  }, [index])

  const blockOf = (folderId: string | null) => moveBlockOf(index, moving, folderId)
  // a chosen folder that vanished from the tree falls back to the root
  const chosenId = chosen !== null && !index.has(chosen) && nodes ? null : chosen
  const blocked = nodes ? blockOf(chosenId) !== null : true
  const path = folderPath(index, chosenId)

  return (
    <ActionModal labelledBy={`${id}-title`} className="uwf-picker" onCancel={onCancel}>
      <h3 id={`${id}-title`} className="uw-act-heading">
        {title}
      </h3>
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
            nodes={nodes}
            label={t('ufTreeLabel')}
            expanded={expanded}
            onExpandedChange={setExpanded}
            selectedKey={chosenId ?? ROOT_KEY}
            onOpen={setChosen}
            blockOf={blockOf}
          />
        )}
      </div>
      {nodes && (
        <p className="uwf-picker-path" aria-live="polite">
          {t('ufPathLabel', {
            path: [t('ufRoot'), ...path.map((p) => p.title)].join(' › '),
          })}
        </p>
      )}
      <div className="modal-buttons">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          {t('cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          aria-disabled={blocked || undefined}
          onClick={() => {
            if (!blocked) onPick({ folderId: chosenId, path })
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </ActionModal>
  )
}
