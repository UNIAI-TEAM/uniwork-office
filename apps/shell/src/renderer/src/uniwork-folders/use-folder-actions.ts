import { useState } from 'react'
import type { UniworkDocSummary } from '../../../shared/home-api'
import { useI18n } from '../locale'
import { announce } from '../uniwork-live'
import { publishLocalRename } from '../uniwork-notice-bus'
import { createFolder, moveDocument, renameDocument } from '../uniwork-library-api'
import type { FolderNameOutcome } from './FolderNameDialog'
import type { PickedFolder } from './UniworkFolderPicker'
import type { TreeRename } from './UniworkFolderTree'
import { checkFolderName, folderActionFailure, type MovingItem } from './uniwork-folders-model'

/** the name dialog: a new folder in `parentId` (null = root), or a rename from the contents list */
export type NameDialogState =
  | { mode: 'create'; parentId: string | null; sub: boolean }
  | { mode: 'rename'; id: string; title: string }

export interface MoveRequest extends MovingItem {
  title: string
}

/**
 * FD-11 S3 folder actions of the browser: New folder / New subfolder, Rename
 * (inline in the tree, a dialog from the contents list) and Move to… for
 * folders and files. A name refusal stays at the field; every other refusal
 * is one toast (403 reads "no permission to change this folder"). Success is
 * said once through the uniwork-live region and the browser re-reads the tree.
 */
export function useFolderActions({
  workspaceId,
  onChanged,
  notify,
}: {
  workspaceId: string
  /** re-read tree + open folder after an own action */
  onChanged: () => void
  /** show a toast (`ok` = done note, `error` = refusal) */
  notify: (message: string, tone: 'ok' | 'error') => void
}) {
  const { t } = useI18n()
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [treeRename, setTreeRename] = useState<TreeRename | null>(null)
  const [moving, setMoving] = useState<MoveRequest | null>(null)

  /** a failed action: the field error to show, or null after a toast */
  const failed = (error: Parameters<typeof folderActionFailure>[0], max?: number) => {
    const failure = folderActionFailure(error, max)
    if ('field' in failure) return failure.field
    notify(t(failure.key, failure.params), 'error')
    return null
  }

  const create = async (parentId: string | null, name: string): Promise<FolderNameOutcome> => {
    const result = await createFolder({ workspaceId, parentId, title: name }).catch(() => ({
      ok: false as const,
      error: 'network' as const,
    }))
    if (!result.ok) {
      const field = failed(result.error, result.max)
      if (!field) setNameDialog(null)
      return { ok: false, field }
    }
    setNameDialog(null)
    announce(t('ufFolderCreated', { name: result.value.title || name }))
    onChanged()
    return { ok: true }
  }

  const rename = async (id: string, name: string): Promise<FolderNameOutcome> => {
    const result = await renameDocument(id, name).catch(() => ({
      ok: false as const,
      error: 'network' as const,
    }))
    if (!result.ok) {
      const field = failed(result.error, result.max)
      return { ok: false, field }
    }
    // main does not push a rename made here back: say it once in the live region
    publishLocalRename(result.value.title || name)
    onChanged()
    return { ok: true }
  }

  /** submit of the name dialog */
  const submitName = (name: string): Promise<FolderNameOutcome> => {
    if (!nameDialog) return Promise.resolve({ ok: true })
    if (nameDialog.mode === 'create') return create(nameDialog.parentId, name)
    if (name === nameDialog.title) {
      setNameDialog(null)
      return Promise.resolve({ ok: true })
    }
    return rename(nameDialog.id, name).then((outcome) => {
      if (outcome.ok || !outcome.field) setNameDialog(null)
      return outcome
    })
  }

  /** Enter in the tree's inline rename field */
  const saveTreeRename = (id: string, value: string, before: string) => {
    const checked = checkFolderName(value)
    if (!checked.ok) {
      setTreeRename({ id, error: checked.error, busy: false })
      return
    }
    if (checked.name === before) {
      setTreeRename(null)
      return
    }
    setTreeRename({ id, error: null, busy: true })
    void rename(id, checked.name).then((outcome) => {
      if (!outcome.ok && outcome.field) setTreeRename({ id, error: outcome.field, busy: false })
      else setTreeRename(null)
    })
  }

  const move = async (item: MoveRequest, picked: PickedFolder) => {
    setMoving(null)
    const result = await moveDocument({ documentId: item.id, parentId: picked.folderId }).catch(
      () => ({
        ok: false as const,
        error: 'network' as const,
      }),
    )
    if (!result.ok) {
      const error = result.error === 'folder_name_taken' ? 'move_name_taken' : result.error
      failed(error, result.max)
      return
    }
    const folder = picked.path[picked.path.length - 1]?.title ?? t('ufRoot')
    const message = result.value.renamedTo
      ? t('ufMovedRenamed', { title: result.value.renamedTo })
      : t('ufMoved', { folder })
    notify(message, 'ok')
    announce(message)
    onChanged()
  }

  return {
    nameDialog,
    openCreate: (parentId: string | null, sub = false) =>
      setNameDialog({ mode: 'create', parentId, sub }),
    openRename: (doc: Pick<UniworkDocSummary, 'id' | 'title'>) =>
      setNameDialog({ mode: 'rename', id: doc.id, title: doc.title }),
    closeNameDialog: () => setNameDialog(null),
    submitName,
    treeRename,
    startTreeRename: (id: string) => setTreeRename({ id, error: null, busy: false }),
    clearTreeRenameError: () =>
      setTreeRename((prev) => (prev && prev.error ? { ...prev, error: null } : prev)),
    cancelTreeRename: () => setTreeRename(null),
    saveTreeRename,
    moving,
    startMove: (item: MoveRequest) => setMoving(item),
    cancelMove: () => setMoving(null),
    move,
  }
}

export type FolderActions = ReturnType<typeof useFolderActions>
