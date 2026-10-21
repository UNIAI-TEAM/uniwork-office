import { FileBadge } from '../FileBadge'
import { useI18n } from '../locale'
import type { UniworkDocErrorCode } from '../../../shared/home-api'
import { UNIWORK_ERROR_KEYS, docExtension } from '../uniwork-docs-model'
import { FolderMenu, type FolderMenuItem } from '../uniwork-folders/FolderMenu'
import { FolderGlyph } from '../uniwork-folders/UniworkFolderTree'
import {
  DOCUMENTS_HOME_FORMAT_OPTIONS,
  canManageShelved,
  formatShortWhen,
  shelvedByOptionsOf,
  shelverKeyOf,
  shelverLabelOf,
  type DocumentsHomeDoc,
  type DocumentsHomeTypeFilter,
} from './documents-home-model'

/**
 * UNI-1961 (ARCHIVE-01): the Lưu trữ / Archive shelf of the Documents home,
 * drawn as the web's DocumentsShelvedView (D packages/views/documents
 * documents-shelved-view/-toolbar/-row.tsx): the intro, the type filter, the
 * "Lưu trữ bởi" filter over the loaded rows (the server has no `shelved_by`
 * parameter, so the toolbar says so), the fixed "Lưu trữ gần nhất" sort, and
 * one flat table in the server's shelved_at-newest order. Shelved folders are
 * rows too; they never browse.
 */

const SHELVED_BY_ANY = ''

/** the rows the "Lưu trữ bởi" filter keeps (null = anyone) */
export function filterByShelver(
  docs: readonly DocumentsHomeDoc[],
  shelvedBy: string | null,
): DocumentsHomeDoc[] {
  if (shelvedBy === null) return [...docs]
  return docs.filter((doc) => shelverKeyOf(doc) === shelvedBy)
}

/** the ids of `root`'s descendants that are rows of the loaded shelf (a folder unshelve may leave them) */
export function shelvedDescendantIds(
  root: DocumentsHomeDoc,
  docs: readonly DocumentsHomeDoc[],
): Set<string> {
  const byParent = new Map<string, DocumentsHomeDoc[]>()
  for (const doc of docs) {
    if (!doc.parentId) continue
    const siblings = byParent.get(doc.parentId) ?? []
    siblings.push(doc)
    byParent.set(doc.parentId, siblings)
  }
  const out = new Set<string>()
  const queue = [...(byParent.get(root.id) ?? [])]
  while (queue.length > 0) {
    const next = queue.shift()!
    if (out.has(next.id)) continue
    out.add(next.id)
    queue.push(...(byParent.get(next.id) ?? []))
  }
  return out
}

export function ShelvedToolbar({
  items,
  format,
  onFormat,
  shelvedBy,
  onShelvedBy,
}: {
  items: readonly DocumentsHomeDoc[]
  format: DocumentsHomeTypeFilter
  onFormat: (format: DocumentsHomeTypeFilter) => void
  shelvedBy: string | null
  onShelvedBy: (value: string | null) => void
}) {
  const { t } = useI18n()
  const options = shelvedByOptionsOf(items, t)
  // keep a picked shelver selectable after a reload dropped its rows
  const known = shelvedBy === null || options.some((opt) => opt.id === shelvedBy)
  return (
    <div className="dh-shelved-head">
      <p className="dh-shelved-intro">{t('uhShelvedIntro')}</p>
      <div className="dh-shelved-toolbar">
        <label className="dh-filter-chip">
          <span className="dh-filter-k">{t('uhFilterType')}</span>
          <select
            className="dh-filter-select"
            data-filter="format"
            aria-label={t('uhFilterType')}
            value={format}
            onChange={(e) => onFormat(e.target.value as DocumentsHomeTypeFilter)}
          >
            {DOCUMENTS_HOME_FORMAT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.labelKey ? t(opt.labelKey) : opt.literal}
              </option>
            ))}
          </select>
        </label>
        <div className="dh-shelved-by">
          <label className="dh-filter-chip">
            <span className="dh-filter-k">{t('uhShelvedFilterBy')}</span>
            <select
              className="dh-filter-select"
              data-filter="shelvedBy"
              aria-label={t('uhShelvedFilterBy')}
              value={shelvedBy ?? SHELVED_BY_ANY}
              onChange={(e) =>
                onShelvedBy(e.target.value === SHELVED_BY_ANY ? null : e.target.value)
              }
            >
              <option value={SHELVED_BY_ANY}>{t('uhShelvedFilterAny')}</option>
              {options.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
              {!known && <option value={shelvedBy!}>{t('uwEditLockSomeone')}</option>}
            </select>
          </label>
          {shelvedBy !== null && (
            <span className="dh-shelved-loaded-only">{t('uhShelvedLoadedOnly')}</span>
          )}
        </div>
        <span className="dh-shelved-sort">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m3 16 4 4 4-4M7 20V4M21 8l-4-4-4 4M17 4v16" />
          </svg>
          {t('uhShelvedSort')}
        </span>
      </div>
    </div>
  )
}

export interface ShelvedTableProps {
  /** the loaded rows, already narrowed by the "Lưu trữ bởi" filter */
  items: readonly DocumentsHomeDoc[]
  /** a type or member filter is active: the empty state is the no-match one */
  filtered: boolean
  dateLocale: string
  openingId?: string | null
  nextCursor: string | null
  loadingMore: boolean
  moreError?: UniworkDocErrorCode
  onLoadMore: () => void
  isUnshelving: (documentId: string) => boolean
  onOpen: (doc: DocumentsHomeDoc) => void
  onUnshelve: (doc: DocumentsHomeDoc) => void
  onTrash: (doc: DocumentsHomeDoc) => void
  openMenuId: string | null
  onOpenMenuChange: (documentId: string | null) => void
}

function LockGlyph() {
  return (
    <svg
      className="dh-shelved-lock"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

export function ShelvedTable({
  items,
  filtered,
  dateLocale,
  openingId,
  nextCursor,
  loadingMore,
  moreError,
  onLoadMore,
  isUnshelving,
  onOpen,
  onUnshelve,
  onTrash,
  openMenuId,
  onOpenMenuChange,
}: ShelvedTableProps) {
  const { t } = useI18n()

  const menuFor = (doc: DocumentsHomeDoc): FolderMenuItem[] => {
    const menu: FolderMenuItem[] = []
    // reading is allowed on a shelved item; a shelved folder never browses
    if (doc.kind !== 'folder') {
      menu.push({ id: 'open', label: t('open'), onSelect: () => onOpen(doc) })
    }
    if (canManageShelved(doc)) {
      menu.push(
        { id: 'unshelve', label: t('uhShelvedUnshelve'), onSelect: () => onUnshelve(doc) },
        { id: 'trash', label: t('uhShelvedMoveToTrash'), onSelect: () => onTrash(doc) },
      )
    }
    return menu
  }

  return (
    <section
      className="dh-section dh-docs-section dh-shelved-section uwf-list"
      aria-label={t('uhNavArchive')}
    >
      {items.length === 0 ? (
        <div className="dh-empty dh-shelved-empty" role="status">
          <p className="dh-shelved-empty-title">
            {filtered ? t('uhShelvedNoMatchTitle') : t('uhShelvedEmptyTitle')}
          </p>
          <p className="dh-shelved-empty-desc">
            {filtered ? t('uhShelvedNoMatchDesc') : t('uhShelvedEmptyDesc')}
          </p>
        </div>
      ) : (
        <div className="dh-doc-table dh-shelved-table" role="table" aria-label={t('uhNavArchive')}>
          <div className="dh-doc-head" role="row">
            <div className="dh-col-name" role="columnheader">
              {t('uhColName')}
            </div>
            <div className="dh-col-access" role="columnheader">
              {t('uhColAccess')}
            </div>
            <div className="dh-col-person" role="columnheader">
              {t('uhShelvedColBy')}
            </div>
            <div className="dh-col-time" role="columnheader">
              {t('uhShelvedColAt')}
            </div>
            <div className="dh-col-actions" role="columnheader" aria-label={t('uhColActions')} />
          </div>

          {items.map((doc) => {
            const folder = doc.kind === 'folder'
            const manage = canManageShelved(doc)
            const shelver = shelverLabelOf(doc, t)
            const shelvedAt = formatShortWhen(doc.shelvedAt, dateLocale)
            const pathText =
              doc.path && doc.path.length > 0
                ? doc.path.map((crumb) => crumb.title).join(' › ')
                : t('uhShelvedPathRoot')
            const menuItems = menuFor(doc)
            const busy = isUnshelving(doc.id)
            const isOpening = openingId === doc.id
            return (
              <div
                key={doc.id}
                role="row"
                data-doc-id={doc.id}
                aria-busy={isOpening || undefined}
                className={`dh-doc-row${isOpening ? ' opening' : ''}`}
                onDoubleClick={() => {
                  if (!folder) onOpen(doc)
                }}
              >
                <div className="dh-cell-name" role="cell">
                  {folder ? (
                    <span className="dh-folder-icon" aria-hidden="true">
                      <FolderGlyph />
                    </span>
                  ) : (
                    <FileBadge ext={doc.kind === 'page' ? 'page' : docExtension(doc)} size={28} />
                  )}
                  <div className="dh-shelved-name">
                    {folder ? (
                      <span className="dh-shelved-title" title={doc.title}>
                        {doc.title}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="dh-doc-open"
                        title={doc.title}
                        onClick={() => onOpen(doc)}
                      >
                        {doc.title}
                      </button>
                    )}
                    <span className="dh-doc-subpath dh-shelved-path" title={pathText}>
                      {pathText}
                    </span>
                    {/* narrow widths carry the meta the hidden columns hold */}
                    {shelvedAt && <span className="dh-shelved-meta-at">{shelvedAt}</span>}
                    {shelver && <span className="dh-shelved-meta-by">{shelver}</span>}
                  </div>
                </div>

                <div className="dh-cell-access" role="cell">
                  {doc.visibility === 'workspace' ? (
                    <span className="dh-shelved-access">{t('uhVisWorkspace')}</span>
                  ) : doc.visibility === 'restricted' ? (
                    <span className="dh-shelved-access">
                      <LockGlyph />
                      {t('uhVisPrivate')}
                    </span>
                  ) : (
                    <span className="dh-cell-empty">—</span>
                  )}
                </div>

                <div className="dh-cell-person" role="cell">
                  {shelver ? (
                    <>
                      <span
                        className="dh-avatar dh-shelved-avatar"
                        aria-hidden="true"
                        data-initial={(Array.from(shelver)[0] ?? '').toUpperCase()}
                      />
                      <span className="dh-person-name" title={shelver}>
                        {shelver}
                      </span>
                    </>
                  ) : (
                    <span className="dh-cell-empty">—</span>
                  )}
                </div>

                <div className="dh-cell-time" role="cell">
                  {shelvedAt || '—'}
                </div>

                <div
                  className="dh-cell-actions dh-shelved-actions"
                  role="cell"
                  onClick={(e) => e.stopPropagation()}
                >
                  {manage && (
                    <button
                      type="button"
                      className="btn btn-secondary dh-shelved-unshelve"
                      aria-label={t('uhShelvedUnshelveItem', { title: doc.title })}
                      disabled={busy}
                      aria-busy={busy || undefined}
                      onClick={() => onUnshelve(doc)}
                    >
                      {t('uhShelvedUnshelve')}
                    </button>
                  )}
                  {menuItems.length > 0 && (
                    <FolderMenu
                      label={t('ufActionsFor', { name: doc.title })}
                      items={menuItems}
                      dataFor={doc.id}
                      open={openMenuId === doc.id}
                      onOpenChange={(o) => onOpenMenuChange(o ? doc.id : null)}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {moreError && (
        <p className="uw-pick-more-error" role="alert">
          {t(UNIWORK_ERROR_KEYS[moreError])}
        </p>
      )}

      {nextCursor && (
        <div className="dh-load-more-row">
          <button
            type="button"
            className="btn btn-secondary uw-pick-more"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? t('uwPickLoadingMore') : t('uhLoadMore')}
          </button>
        </div>
      )}
    </section>
  )
}
