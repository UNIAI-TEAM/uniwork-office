import { useRef, useState, type ReactNode } from 'react'
import type { UniworkFolderNode } from '../../../shared/home-api'
import { useI18n } from '../locale'
import { bulkSummary, bulkWorkFor, runBulkAction } from '../doclist/bulk'
import type { DocListScreen } from '../doclist/columns'
import { UniworkFolderPicker } from '../uniwork-folders/UniworkFolderPicker'
import type { MovingItem } from '../uniwork-folders/uniwork-folders-model'
import { loadFolderTree } from '../uniwork-library-api'
import type { DocumentsHomeDoc } from './documents-home-model'

/** where the picker starts: the folder every item sits in, else the root */
function sharedParent(moving: readonly MovingItem[]): string | null {
  const first = moving[0]?.parentId ?? null
  return moving.every((item) => item.parentId === first) ? first : null
}

export interface BulkMoveHandle {
  /** open the folder picker for these rows (the bar's Di chuyển) */
  open: (docs: readonly DocumentsHomeDoc[]) => void
  /** a batch is running: the bar's actions wait */
  busy: boolean
  /** what the host renders */
  dialog: ReactNode
}

/**
 * UNI-2078: the host hook of the bulk Move. `open(docs)` mounts the folder picker for the
 * selection (title with the count, the batch rules of `moveBlockOf`, one My Folder out-confirm for
 * the whole batch); the pick runs the batch through `runBulkAction` (4 at once, one retry of a
 * throttled call, a failure never stops it) and the list is read again once. `onSettled` gets the
 * one summary toast ("Moved 3/5" + the commonest reason) and is where the host clears the
 * selection; a cancelled picker sends nothing and calls nothing.
 */
export function useBulkMove({
  workspaceId,
  screen,
  nodes,
  currentParentOf,
  refresh,
  onSettled,
}: {
  workspaceId: string
  screen: DocListScreen
  /** the folder tree the host already holds (the picker reads it itself without) */
  nodes?: UniworkFolderNode[]
  /** the folder the row sits in now (null = the root): the picker's "current location" */
  currentParentOf: (doc: DocumentsHomeDoc) => string | null
  refresh: () => void
  onSettled: (summary: { message: string; tone: 'ok' | 'error' }) => void
}): BulkMoveHandle {
  const { t } = useI18n()
  const [batch, setBatch] = useState<{
    docs: readonly DocumentsHomeDoc[]
    moving: MovingItem[]
  } | null>(null)
  const [busy, setBusy] = useState(false)
  // the ref answers a second pick that lands before React re-renders
  const busyRef = useRef(false)

  const run = async (docs: readonly DocumentsHomeDoc[], folderId: string | null) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const result = await runBulkAction({
        docs,
        work: bulkWorkFor('move', screen, folderId),
        refresh,
      })
      onSettled(bulkSummary('move', result, t))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return {
    busy,
    open: (docs) => {
      if (busyRef.current || docs.length === 0) return
      setBatch({
        docs,
        moving: docs.map((doc) => ({
          id: doc.id,
          kind: doc.kind === 'folder' ? 'folder' : 'file',
          parentId: currentParentOf(doc),
        })),
      })
    },
    dialog: batch ? (
      <UniworkFolderPicker
        title={t(batch.docs.length === 1 ? 'dlBulkMoveTitleOne' : 'dlBulkMoveTitleOther', {
          count: batch.docs.length,
        })}
        description={t('dlBulkMoveDescription')}
        confirmLabel={t('ufMove')}
        workspaceId={workspaceId}
        loadTree={loadFolderTree}
        nodes={nodes}
        moving={batch.moving}
        initialFolderId={sharedParent(batch.moving)}
        onPick={(picked) => {
          setBatch(null)
          void run(batch.docs, picked.folderId)
        }}
        onCancel={() => setBatch(null)}
      />
    ) : null,
  }
}
