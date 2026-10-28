import { useId, type ReactNode } from 'react'
import { useI18n, type StringKey } from '../locale'
import { ActionModal } from '../UniworkDocActions'
import type { DocumentsHomeDoc } from '../uniwork-home/documents-home-model'
import type { DocListScreen } from './columns'
import { bulkActionsFor, type BulkActionId } from './bulk'

const ACTION_LABEL: Record<BulkActionId, StringKey> = {
  share: 'dlActShare',
  move: 'dlActMove',
  restore: 'dlActRestore',
  unshelve: 'dlActUnshelve',
  download: 'dlActDownload',
  shelve: 'dlActShelve',
  trash: 'dlActTrash',
  purge: 'dlActPurge',
}

const ACTION_ICON: Record<BulkActionId, { name: string; paths: ReactNode }> = {
  share: {
    name: 'share-2',
    paths: (
      <>
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
        <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
      </>
    ),
  },
  move: {
    name: 'folder-input',
    paths: (
      <>
        <path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1" />
        <path d="M2 13h10" />
        <path d="m9 16 3-3-3-3" />
      </>
    ),
  },
  download: {
    name: 'download',
    paths: (
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" x2="12" y1="15" y2="3" />
      </>
    ),
  },
  shelve: {
    name: 'archive',
    paths: (
      <>
        <rect width="20" height="5" x="2" y="3" rx="1" />
        <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
        <path d="M10 12h4" />
      </>
    ),
  },
  unshelve: {
    name: 'archive-restore',
    paths: (
      <>
        <rect width="20" height="5" x="2" y="3" rx="1" />
        <path d="M4 8v11a2 2 0 0 0 2 2h2" />
        <path d="M20 8v11a2 2 0 0 1-2 2h-2" />
        <path d="m9 15 3-3 3 3" />
        <path d="M12 12v9" />
      </>
    ),
  },
  restore: {
    name: 'archive-restore',
    paths: (
      <>
        <rect width="20" height="5" x="2" y="3" rx="1" />
        <path d="M4 8v11a2 2 0 0 0 2 2h2" />
        <path d="M20 8v11a2 2 0 0 1-2 2h-2" />
        <path d="m9 15 3-3 3 3" />
        <path d="M12 12v9" />
      </>
    ),
  },
  trash: {
    name: 'trash',
    paths: (
      <>
        <path d="M3 6h18" />
        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      </>
    ),
  },
  purge: {
    name: 'trash',
    paths: (
      <>
        <path d="M3 6h18" />
        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      </>
    ),
  },
}

function BulkIcon({ name, children }: { name: string; children: ReactNode }) {
  return (
    <svg
      className="dl-bulk-icon"
      data-icon={name}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
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
  canDownload = false,
  canPurge = false,
  onAction,
  onClear,
}: {
  screen: DocListScreen
  docs: readonly DocumentsHomeDoc[]
  /** a batch is running: the actions wait */
  busy: boolean
  /** this shell has the Share bridge: Chia sẻ may show */
  canShare?: boolean
  /** this shell has the zip-download bridge: Tải xuống may show */
  canDownload?: boolean
  /** this shell has the purge call: Xóa vĩnh viễn may show on the trash (UNI-2078) */
  canPurge?: boolean
  onAction: (id: BulkActionId) => void
  onClear: () => void
}) {
  const { t } = useI18n()
  if (docs.length === 0) return null
  const actions = bulkActionsFor(screen, docs, canShare, canDownload, canPurge)
  return (
    <div className="dl-bulk-bar" data-bulk-bar role="toolbar" aria-label={t('dlBulkToolbar')}>
      <span className="dl-bulk-count" data-bulk-count aria-live="polite">
        {t('dlBulkSelected', { n: docs.length })}
      </span>
      <div className="dl-bulk-actions">
        {actions.map((id) => {
          const icon = ACTION_ICON[id]
          return (
            <button
              key={id}
              type="button"
              className={`dl-bulk-action${id === 'trash' || id === 'purge' ? ' danger' : ''}`}
              data-bulk-action={id}
              disabled={busy}
              onClick={() => onAction(id)}
            >
              <BulkIcon name={icon.name}>{icon.paths}</BulkIcon>
              {t(ACTION_LABEL[id])}
            </button>
          )
        })}
      </div>
      <button type="button" className="dl-bulk-clear" data-bulk-clear onClick={onClear}>
        <BulkIcon name="x">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </BulkIcon>
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
