import { useId } from 'react'
import { useI18n, type StringKey } from '../locale'
import { ActionModal } from '../UniworkDocActions'
import type { DocumentsHomeDoc } from '../uniwork-home/documents-home-model'
import type { DocListScreen } from './columns'
import { bulkActionsFor, type BulkActionId } from './bulk'

const ACTION_LABEL: Record<BulkActionId, StringKey> = {
  share: 'dlActShare',
  restore: 'dlActRestore',
  unshelve: 'dlActUnshelve',
  shelve: 'dlActShelve',
  trash: 'dlActTrash',
}

/**
 * The bar over the table while at least one row is selected: how many, a clear button, and
 * the actions every selected row allows (the row menu's permissions). It stays, without
 * actions, for a selection the person may do nothing with, so the count and Clear remain.
 */
export function BulkBar({
  screen,
  docs,
  busy,
  canShare = false,
  onAction,
  onClear,
}: {
  screen: DocListScreen
  docs: readonly DocumentsHomeDoc[]
  /** a batch is running: the actions wait */
  busy: boolean
  /** this shell has the Share bridge: Chia sẻ may show */
  canShare?: boolean
  onAction: (id: BulkActionId) => void
  onClear: () => void
}) {
  const { t } = useI18n()
  if (docs.length === 0) return null
  const actions = bulkActionsFor(screen, docs, canShare)
  return (
    <div className="dl-bulk-bar" data-bulk-bar role="toolbar" aria-label={t('dlBulkToolbar')}>
      <span className="dl-bulk-count" data-bulk-count>
        {t('dlBulkSelected', { n: docs.length })}
      </span>
      <div className="dl-bulk-actions">
        {actions.map((id) => (
          <button
            key={id}
            type="button"
            className={`btn btn-secondary dl-bulk-action${id === 'trash' ? ' danger' : ''}`}
            data-bulk-action={id}
            disabled={busy}
            onClick={() => onAction(id)}
          >
            {t(ACTION_LABEL[id])}
          </button>
        ))}
      </div>
      <button type="button" className="dl-bulk-clear" data-bulk-clear onClick={onClear}>
        {t('dlBulkClear')}
      </button>
    </div>
  )
}

/** the one confirm of a destructive batch (Chuyển vào thùng rác) */
export function BulkTrashConfirm({
  count,
  hasFolder = false,
  onConfirm,
  onCancel,
}: {
  count: number
  /** a selected row is a folder: one static clause says other people's documents inside go back to their owners (no impact read, no number) */
  hasFolder?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const id = useId()
  return (
    <ActionModal
      labelledBy={`${id}-title`}
      describedBy={`${id}-body`}
      onCancel={onCancel}
      initialFocus="[data-bulk-cancel]"
    >
      <h3 id={`${id}-title`} className="uw-act-heading">
        {t(count === 1 ? 'dlBulkConfirmTitleOne' : 'dlBulkConfirmTitleOther', { n: count })}
      </h3>
      <p id={`${id}-body`}>
        {t('dlBulkConfirmBody')}
        {hasFolder ? ` ${t('ufTrashRelocated')}` : null}
      </p>
      <div className="modal-buttons">
        <button type="button" className="btn btn-secondary" data-bulk-cancel onClick={onCancel}>
          {t('cancel')}
        </button>
        <button type="button" className="btn btn-primary" data-bulk-confirm onClick={onConfirm}>
          {t('dlActTrash')}
        </button>
      </div>
    </ActionModal>
  )
}
