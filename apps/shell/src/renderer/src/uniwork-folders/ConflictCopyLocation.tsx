import { useEffect, useId, useState } from 'react'
import type { UniworkFolderNode } from '../../../shared/home-api'
import type { UniworkConflictView } from '../../../shared/uniwork-conflict'
import { useI18n } from '../locale'
import { loadFolderTree } from '../uniwork-library-api'
import { UniworkFolderPicker, type PickedFolder } from './UniworkFolderPicker'
import { buildFolderIndex, folderPath } from './uniwork-folders-model'
import './uniwork-folders.css'

/**
 * FD-11 S5: where Save a copy puts the copy. The view carries the source's
 * workspace and parent once main sends them (contract §3, W3); until then the
 * control is not shown and the copy lands next to the source, as before.
 *
 * The "Location" row of the Save-a-copy step: the chosen folder's path (by
 * default the source's own folder) and a button opening the folder picker.
 * Rendered inside the conflict dialog (not portalled), so the dialog's
 * inert sweep and focus trap keep working; the picker's own modal takes the
 * keys while it is open.
 */
export function ConflictCopyLocation({
  view,
  chosen,
  disabled,
  onChoose,
}: {
  view: UniworkConflictView
  /** null = not changed: the source's parent */
  chosen: PickedFolder | null
  disabled: boolean
  onChoose: (picked: PickedFolder) => void
}) {
  const { t } = useI18n()
  const id = useId()
  const [nodes, setNodes] = useState<UniworkFolderNode[] | null>(null)
  const [treeFailed, setTreeFailed] = useState(false)
  const [picking, setPicking] = useState(false)
  const workspaceId = view.workspaceId

  // the tree names the source's folder for the default label (and feeds the picker)
  useEffect(() => {
    if (!workspaceId) return
    let live = true
    setNodes(null)
    setTreeFailed(false)
    void loadFolderTree(workspaceId)
      .catch(() => ({ ok: false as const, error: 'network' as const }))
      .then((result) => {
        if (!live) return
        if (result.ok) setNodes(result.value)
        else setTreeFailed(true)
      })
    return () => {
      live = false
    }
  }, [workspaceId])

  if (!workspaceId) return null
  const sourceParent = view.parentId ?? null
  let label: string
  if (chosen) {
    label =
      chosen.path.length > 0
        ? [t('ufRoot'), ...chosen.path.map((p) => p.title)].join(' › ')
        : t('ufLocationRoot')
  } else if (view.parentId === null) {
    label = t('ufLocationRoot')
  } else if (view.parentId === undefined) {
    label = t('ufSameFolder')
  } else if (nodes !== null) {
    const path = folderPath(buildFolderIndex(nodes), view.parentId)
    label =
      path.length > 0 ? [t('ufRoot'), ...path.map((p) => p.title)].join(' › ') : t('ufSameFolder')
  } else if (treeFailed) {
    label = t('ufSameFolder')
  } else {
    label = '…'
  }
  return (
    <div className="uw-conflict-location">
      <span className="uw-conflict-location-label" id={`${id}-label`}>
        {t('ufLocation')}
      </span>
      <button
        type="button"
        className="uwf-location-btn"
        data-conflict-action="copy-location"
        aria-label={`${t('ufLocation')}: ${label}`}
        aria-haspopup="dialog"
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) setPicking(true)
        }}
      >
        <span className="uwf-location-path">{label}</span>
      </button>
      {picking && (
        <UniworkFolderPicker
          title={t('ufChooseLocation')}
          confirmLabel={t('ufChoose')}
          workspaceId={workspaceId}
          loadTree={loadFolderTree}
          nodes={nodes ?? undefined}
          initialFolderId={chosen ? chosen.folderId : sourceParent}
          onPick={(picked) => {
            setPicking(false)
            onChoose(picked)
          }}
          onCancel={() => setPicking(false)}
        />
      )}
    </div>
  )
}
